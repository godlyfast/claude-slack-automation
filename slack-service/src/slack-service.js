const { WebClient } = require('@slack/web-api');
const Database = require('./db');
const logger = require('./logger');
const cache = require('./cache');
const rateLimiter = require('./rate-limiter');
const channelRotator = require('./channel-rotator');
const LoopPreventionSystem = require('./loop-prevention');
const FileHandler = require('./file-handler');

class SlackService {
  constructor(token, config) {
    this.client = new WebClient(token);
    
    this.db = new Database();
    this.loopPrevention = new LoopPreventionSystem(this.db);
    this.fileHandler = new FileHandler(token); // Use token for file access
    this.config = {
      channels: config.channels || [],
      triggerKeywords: config.triggerKeywords || [],
      responseMode: config.responseMode || 'mentions',
      maxMessages: config.maxMessages || 15,
      checkWindow: config.checkWindow || 5,
      // Cache configuration
      channelCacheTTL: config.channelCacheTTL || 3600, // 1 hour (channels rarely change)
      messageCacheTTL: config.messageCacheTTL || 90, // 90 seconds
      cacheEnabled: config.cacheEnabled !== false, // Default true
      // Rate limit configuration
      useChannelRotation: config.useChannelRotation !== false, // Default true
      maxChannelsPerRun: config.maxChannelsPerRun || 1, // Based on rate limit
      ...config
    };
  }

  /**
   * Initialize the service (must be called after constructor)
   */
  async init() {
    await this.fileHandler.init();
    logger.info('SlackService initialized with file attachment support');
  }

  async getUnrespondedMessages() {
    const messages = [];
    const since = this._getSinceTimestamp();
    
    // Determine which channels to check this run
    let channelsToCheck = this.config.channels;
    
    if (this.config.useChannelRotation && this.config.channels.length > 1) {
      // Use channel rotation to respect rate limits
      channelsToCheck = await channelRotator.getNextChannels(
        this.config.channels,
        this.config.maxChannelsPerRun
      );
      
      logger.info(`Checking ${channelsToCheck.length} of ${this.config.channels.length} channels this run`);
    }

    // 1. Check channels for new messages
    for (const channel of channelsToCheck) {
      try {
        const channelMessages = await this._fetchChannelMessages(channel, since);
        const filteredMessages = await this._filterMessages(channelMessages, channel);
        messages.push(...filteredMessages);
      } catch (error) {
        logger.error(`Error fetching messages from ${channel}:`, error);
      }
    }

    // 2. Check active threads for new replies
    // TEMPORARILY DISABLED: This causes rate limiting by checking ALL threads every minute
    // TODO: Implement smarter thread checking that only checks recently active threads
    /*
    try {
      const threadMessages = await this._checkActiveThreads();
      messages.push(...threadMessages);
    } catch (error) {
      logger.error('Error checking threads:', error);
    }
    */

    // 3. Remove duplicate messages (same text from same user within short time)
    const uniqueMessages = this._deduplicateMessages(messages);

    return uniqueMessages;
  }

  async _fetchChannelMessages(channelId, since) {
    try {
      const normalizedChannel = channelId.replace('#', '');
      
      const channelInfo = await this._getChannelId(normalizedChannel);
      if (!channelInfo) {
        logger.warn(`Channel ${channelId} not found`);
        return [];
      }

      const cacheKey = `messages:${channelInfo.id}:${since}`;
      
      // Try to get from cache first
      if (this.config.cacheEnabled) {
        const cachedMessages = cache.get(cacheKey);
        if (cachedMessages) {
          logger.debug(`Using cached messages for ${channelId}`);
          cache.incrementRateLimitSaves();
          return cachedMessages;
        }
      }

      // Use rate limiter for API call with 3 second timeout
      const result = await rateLimiter.executeWithRetry(
        async () => Promise.race([
          this.client.conversations.history({
            channel: channelInfo.id,
            oldest: since,
            limit: this.config.maxMessages,
            inclusive: false
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Slack API timeout after 3 seconds')), 3000)
          )
        ]),
        'conversations.history'
      );

      if (!result.ok) {
        throw new Error(`Failed to fetch messages: ${result.error}`);
      }

      const messages = result.messages || [];
      
      // Cache the messages
      if (this.config.cacheEnabled) {
        cache.set(cacheKey, messages, this.config.messageCacheTTL);
      }

      return messages;
    } catch (error) {
      logger.error(`Error in _fetchChannelMessages for ${channelId}:`, error);
      return [];
    }
  }

  async _getChannelNameById(channelId) {
    // Check cache first
    const cacheKey = `channel-name:${channelId}`;
    if (this.config.cacheEnabled) {
      const cachedName = cache.get(cacheKey);
      if (cachedName) {
        return cachedName;
      }
    }
    
    // Get all channels and find the one with matching ID
    const result = await this.client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000
    });
    
    if (!result.ok || !result.channels) {
      return null;
    }
    
    const channel = result.channels.find(ch => ch.id === channelId);
    
    if (channel) {
      // Cache the channel name
      cache.set(cacheKey, channel.name, this.config.channelCacheTTL);
      return channel.name;
    }
    
    return null;
  }

  async _getChannelId(channelName) {
    // First check if we have a cached channel ID for this specific channel
    const channelCacheKey = `channel:${channelName}`;
    if (this.config.cacheEnabled) {
      const cachedChannelId = cache.get(channelCacheKey);
      if (cachedChannelId) {
        logger.debug(`Using cached channel ID for ${channelName}`);
        cache.incrementRateLimitSaves();
        return cachedChannelId;
      }
    }
    
    const cacheKey = `channels:list`;
    
    // Try to get from cache first
    if (this.config.cacheEnabled) {
      const cachedChannels = cache.get(cacheKey);
      if (cachedChannels) {
        logger.debug('Using cached channel list');
        cache.incrementRateLimitSaves();
        const channel = cachedChannels.find(ch => ch.name === channelName);
        // Cache the specific channel ID for faster lookups
        if (channel) {
          cache.set(channelCacheKey, channel, this.config.channelCacheTTL);
        }
        return channel || null;
      }
    }

    try {
      // Use rate limiter for API call with 3 second timeout
      const result = await rateLimiter.executeWithRetry(
        async () => Promise.race([
          this.client.conversations.list({
            types: 'public_channel,private_channel',
            limit: 1000
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Slack API timeout after 3 seconds')), 3000)
          )
        ]),
        'conversations.list'
      );

      if (!result.ok) {
        throw new Error(`Failed to list channels: ${result.error}`);
      }


      // Cache the channel list
      if (this.config.cacheEnabled && result.channels) {
        cache.set(cacheKey, result.channels, this.config.channelCacheTTL);
      }

      const channel = result.channels.find(ch => ch.name === channelName);
      // Also cache the specific channel for faster lookups
      if (channel) {
        cache.set(channelCacheKey, channel, this.config.channelCacheTTL);
      }
      return channel;
    } catch (error) {
      logger.error('Error listing channels:', error);
      return null;
    }
  }

  async _filterMessages(messages, channelId) {
    const filteredMessages = [];
    
    logger.debug(`Filtering ${messages.length} messages from ${channelId}`);
    
    // Get channel name once for all messages (to avoid multiple API calls)
    const channelName = await this._getChannelNameById(channelId) || channelId;

    for (const message of messages) {
      if (!message.ts) {
        logger.debug(`Skipping message without timestamp`);
        continue;
      }
      
      logger.debug(`Processing message ${channelId}-${message.ts}: "${(message.text || '').substring(0, 50)}..." user=${message.user} bot_id=${message.bot_id} files=${message.files?.length || 0}`);
      
      // Skip all bot messages (including the bot's own responses)
      if (message.bot_id) {
        // Special handling for user messages sent via apps (like MCP)
        const isMCPMessage = message.app_id === 'A097GBJDNAF' && message.user;
        if (!isMCPMessage) {
          continue;
        }
      }

      // Check if this message is the bot's own response (for user token scenarios)
      const isPotentialBotResponse = await this.db.isBotResponse(
        message.text || '', 
        channelId, 
        message.thread_ts
      );
      if (isPotentialBotResponse) {
        logger.debug(`Skipping message ${channelId}-${message.ts} - detected as bot's own response`);
        continue;
      }

      const messageId = `${channelId}-${message.ts}`;
      
      const hasResponded = await this.db.hasResponded(messageId);
      if (hasResponded) {
        logger.debug(`Message ${messageId} already responded to`);
        continue;
      }

      const shouldRespond = this._shouldRespond(message, false);
      logger.debug(`Should respond to "${(message.text || '').substring(0, 30)}...": ${shouldRespond}`);
      
      if (shouldRespond) {
        // Process file attachments if present
        let attachments = [];
        let attachmentContext = '';
        let filePaths = [];
        
        if (message.files && message.files.length > 0) {
          logger.info(`Channel message ${messageId} has ${message.files.length} file(s): ${message.files.map(f => `${f.name} (${f.mimetype})`).join(', ')}`);
          try {
            attachments = await this.fileHandler.processAttachments(message, channelId);
            const attachmentData = this.fileHandler.formatAttachmentsForClaude(attachments);
            attachmentContext = attachmentData.context;
            filePaths = attachmentData.filePaths;
            logger.info(`Successfully processed ${attachments.length} attachments for message ${messageId}`);
            
            // Log attachment details for debugging
            attachments.forEach(att => {
              logger.debug(`Channel attachment ${att.name}: type=${att.type}, error=${att.error || 'none'}`);
            });
          } catch (error) {
            logger.error(`Failed to process attachments for message ${messageId}:`, error);
            // Continue processing - bot should still respond even if file processing fails
          }
        }

        const messageObj = {
          id: messageId,
          channel: channelId,
          channelName: channelName, // Use actual channel name
          ts: message.ts,
          thread_ts: message.thread_ts || message.ts,
          text: message.text,
          user: message.user,
          mentions: this._extractMentions(message.text),
          attachments: attachments,
          attachmentContext: attachmentContext,
          filePaths: filePaths,
          hasAttachments: attachments.length > 0,
          threadAttachmentCount: 0 // Channel messages don't have thread attachments
        };

        // Apply loop prevention checks
        const allowResponse = await this.loopPrevention.shouldAllowResponse(messageObj);
        if (allowResponse.allow) {
          filteredMessages.push(messageObj);
        } else {
          logger.info(`Blocked message ${messageId} - ${allowResponse.reason}`, allowResponse);
        }
      }
    }

    return filteredMessages;
  }

  _shouldRespond(message, isThreadReply = false) {
    const text = message.text?.toLowerCase() || '';
    
    logger.debug(`Checking trigger keywords ${this.config.triggerKeywords.join(',')} in: "${text}"`);
    
    const hasKeyword = this.config.triggerKeywords.some(keyword => 
      text.includes(keyword.toLowerCase())
    );

    logger.debug(`Has keyword: ${hasKeyword}, response mode: ${this.config.responseMode}`);

    if (!hasKeyword) {
      return false;
    }

    // For both thread replies and channel messages, follow the configured mode
    if (this.config.responseMode === 'all') {
      return true;
    } else if (this.config.responseMode === 'mentions') {
      const hasMention = text.includes('<@') && text.includes('>');
      return hasMention;
    }

    return false;
  }

  _extractMentions(text) {
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  async postResponse(message, responseText) {
    try {
      // Validate response content and clean if necessary
      const validation = this.loopPrevention.validateResponseContent(responseText);
      const finalResponse = validation.modified ? validation.cleaned : responseText;

      if (validation.modified) {
        logger.warn(`Cleaned response to prevent trigger injection`, {
          messageId: message.id,
          triggers: validation.triggers
        });
      }

      // Use rate limiter for API call with 3 second timeout
      const result = await rateLimiter.executeWithRetry(
        async () => Promise.race([
          this.client.chat.postMessage({
            channel: message.channel,
            text: finalResponse,
            thread_ts: message.thread_ts,
            as_user: true // Important for user tokens (xoxp)
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Slack API timeout after 3 seconds')), 3000)
          )
        ]),
        'chat.postMessage'
      );

      if (!result.ok) {
        throw new Error(`Failed to post message: ${result.error}`);
      }

      await this.db.markAsResponded(
        message.id,
        message.channel,
        message.thread_ts,
        finalResponse
      );

      // Record this as a bot response to prevent responding to it later
      await this.db.recordBotResponse(
        message.channel,
        message.thread_ts,
        finalResponse
      );

      // Track this thread for future monitoring
      await this.db.trackThread(message.channel, message.thread_ts);

      // Record response in loop prevention system
      this.loopPrevention.recordResponse(
        message.channel,
        message.thread_ts,
        finalResponse
      );

      logger.info(`Posted response to message ${message.id}`);
      return result;
    } catch (error) {
      logger.error('Error posting response:', error);
      throw error;
    }
  }

  _getSinceTimestamp() {
    const now = Date.now();
    const windowMs = this.config.checkWindow * 60 * 1000;
    return ((now - windowMs) / 1000).toString();
  }

  async close() {
    this.db.close();
  }

  /**
   * Get loop prevention system status
   */
  getLoopPreventionStatus() {
    return this.loopPrevention.getSystemStatus();
  }

  /**
   * Manual emergency stop controls
   */
  activateEmergencyStop(reason = 'manual') {
    this.loopPrevention.activateEmergencyStop(reason);
  }

  deactivateEmergencyStop() {
    this.loopPrevention.deactivateEmergencyStop();
  }

  /**
   * Deduplicate messages by checking for similar text from same user
   */
  _deduplicateMessages(messages) {
    const seen = new Map();
    const unique = [];
    
    for (const message of messages) {
      // Create a key based on user and normalized text
      const normalizedText = message.text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      const key = `${message.user}-${normalizedText}`;
      
      // Check if we've seen this or very similar message
      let isDuplicate = false;
      for (const [seenKey, seenMessage] of seen.entries()) {
        if (seenKey.startsWith(message.user)) {
          // Same user, check similarity
          const seenText = seenKey.split('-')[1];
          if (this._isSimilarText(normalizedText, seenText)) {
            isDuplicate = true;
            logger.debug(`Skipping duplicate message: "${message.text}" similar to "${seenMessage.text}"`);
            break;
          }
        }
      }
      
      if (!isDuplicate) {
        seen.set(key, message);
        unique.push(message);
      }
    }
    
    return unique;
  }

  /**
   * Check if two texts are similar (>80% overlap)
   */
  _isSimilarText(text1, text2) {
    const words1 = text1.split(' ');
    const words2 = text2.split(' ');
    
    // Check if one text contains most of the other
    const overlap1 = words1.filter(word => text2.includes(word)).length;
    const overlap2 = words2.filter(word => text1.includes(word)).length;
    
    const similarity1 = overlap1 / words1.length;
    const similarity2 = overlap2 / words2.length;
    
    return similarity1 > 0.8 || similarity2 > 0.8;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return cache.getStats();
  }

  /**
   * Clear cache
   */
  clearCache() {
    cache.clear();
  }

  /**
   * Get full channel history with file attachments
   * @param {string} channelName - Channel name (with or without #)
   * @param {number} limit - Maximum number of messages to fetch (default: 100)
   * @returns {Array} Array of processed messages with attachments
   */
  async getChannelHistory(channelName, limit = 100) {
    try {
      const normalizedChannel = channelName.replace('#', '');
      
      // Check cache first - use 10 minute TTL for channel history
      const historyCacheKey = `channel-history:${normalizedChannel}:${limit}`;
      if (this.config.cacheEnabled) {
        const cachedHistory = cache.get(historyCacheKey);
        if (cachedHistory) {
          logger.debug(`Using cached channel history for ${channelName}`);
          return cachedHistory;
        }
      }
      
      const channelInfo = await this._getChannelId(normalizedChannel);
      
      if (!channelInfo) {
        throw new Error(`Channel ${channelName} not found`);
      }

      logger.info(`Fetching ${limit} messages from channel ${channelName}`);
      
      // Fetch messages without time constraints
      const result = await rateLimiter.executeWithRetry(
        async () => this.client.conversations.history({
          channel: channelInfo.id,
          limit: limit,
          inclusive: true
        }),
        'conversations.history'
      );

      if (!result.ok) {
        throw new Error(`Failed to fetch channel history: ${result.error}`);
      }

      const messages = result.messages || [];
      const processedMessages = [];

      // Process each message to include file information
      for (const message of messages) {
        const messageObj = {
          id: `${channelInfo.id}-${message.ts}`,
          channel: channelInfo.id,
          channelName: normalizedChannel,
          ts: message.ts,
          user: message.user,
          text: message.text || '',
          timestamp: new Date(parseFloat(message.ts) * 1000).toISOString()
        };

        // Process file attachments if present
        if (message.files && message.files.length > 0) {
          logger.debug(`Message has ${message.files.length} file(s)`);
          try {
            const attachments = await this.fileHandler.processAttachments(message, channelInfo.id);
            const attachmentData = this.fileHandler.formatAttachmentsForClaude(attachments);
            
            messageObj.attachments = attachments;
            messageObj.attachmentContext = attachmentData.context;
            messageObj.filePaths = attachmentData.filePaths;
            messageObj.hasAttachments = true;
          } catch (error) {
            logger.error(`Failed to process attachments for message ${message.ts}:`, error);
            messageObj.attachmentError = error.message;
            messageObj.hasAttachments = true;
          }
        }

        // Check if this is a thread parent
        if (message.thread_ts && message.thread_ts === message.ts) {
          messageObj.isThread = true;
          messageObj.replyCount = message.reply_count || 0;
          
          // Optionally fetch thread replies
          try {
            const threadMessages = await this._getThreadContext(channelInfo.id, message.thread_ts, 50);
            messageObj.threadMessages = threadMessages.messages;
          } catch (error) {
            logger.debug(`Could not fetch thread context: ${error.message}`);
          }
        }

        processedMessages.push(messageObj);
      }

      logger.info(`Retrieved ${processedMessages.length} messages from ${channelName}`);
      
      // Cache the processed history for 10 minutes
      if (this.config.cacheEnabled && processedMessages.length > 0) {
        cache.set(historyCacheKey, processedMessages, 600); // 10 minute TTL
        logger.debug(`Cached channel history for ${channelName} (${processedMessages.length} messages)`);
      }
      
      return processedMessages;
    } catch (error) {
      logger.error(`Error fetching channel history for ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Warm up cache by pre-fetching channel list
   */
  async warmCache() {
    logger.info('Warming up cache...');
    
    // DISABLED: Pre-fetching causes unnecessary API calls on startup
    // Channels and messages will be fetched on-demand when needed
    /*
    // Pre-fetch channel list
    await this._getChannelId('dummy-channel-to-trigger-fetch');
    
    // Pre-fetch recent messages for each channel
    const since = this._getSinceTimestamp();
    for (const channel of this.config.channels) {
      await this._fetchChannelMessages(channel, since);
    }
    */
    
    logger.info('Cache warmed up');
  }

  async _checkActiveThreads() {
    const threadMessages = [];
    
    // Get threads we've participated in recently (last 24 hours)
    const activeThreads = await this.db.getActiveThreads(24 * 60);
    
    logger.debug(`Checking ${activeThreads.length} active threads`);
    
    for (const thread of activeThreads) {
      try {
        const messages = await this._fetchThreadMessages(
          thread.channel_id, 
          thread.thread_ts
        );
        
        const filteredMessages = await this._filterThreadMessages(
          messages, 
          thread.channel_id,
          thread.thread_ts
        );
        
        threadMessages.push(...filteredMessages);
        
        // Update last checked time
        await this.db.updateThreadLastChecked(
          thread.channel_id,
          thread.thread_ts
        );
      } catch (error) {
        logger.error(`Error checking thread ${thread.thread_ts}:`, error);
      }
    }
    
    return threadMessages;
  }

  async _fetchThreadMessages(channelId, threadTs) {
    try {
      const channelInfo = await this._getChannelId(channelId.replace('#', ''));
      if (!channelInfo) {
        logger.warn(`Channel ${channelId} not found`);
        return [];
      }

      const cacheKey = `thread:${channelInfo.id}:${threadTs}`;
      
      // Try to get from cache first
      if (this.config.cacheEnabled) {
        const cachedMessages = cache.get(cacheKey);
        if (cachedMessages) {
          logger.debug(`Using cached thread messages for ${threadTs}`);
          cache.incrementRateLimitSaves();
          return cachedMessages;
        }
      }

      // Use rate limiter for API call
      const result = await rateLimiter.executeWithRetry(
        async () => this.client.conversations.replies({
          channel: channelInfo.id,
          ts: threadTs,
          oldest: this._getSinceTimestamp(),
          inclusive: false
        }),
        'conversations.replies'
      );

      if (!result.ok) {
        throw new Error(`Failed to fetch thread messages: ${result.error}`);
      }

      const messages = result.messages || [];
      
      // Cache the messages
      if (this.config.cacheEnabled) {
        cache.set(cacheKey, messages, this.config.messageCacheTTL);
      }

      return messages;
    } catch (error) {
      logger.error(`Error in _fetchThreadMessages:`, error);
      return [];
    }
  }

  async _filterThreadMessages(messages, channelId, threadTs) {
    const filteredMessages = [];

    for (const message of messages) {
      if (!message.ts || message.ts === threadTs) {
        // Skip the parent message
        continue;
      }
      
      // Skip all bot messages (including the bot's own responses)
      if (message.bot_id) {
        // Special handling for user messages sent via apps (like MCP)
        const isMCPMessage = message.app_id === 'A097GBJDNAF' && message.user;
        if (!isMCPMessage) {
          continue;
        }
      }

      // Check if this message is the bot's own response (for user token scenarios)
      const isPotentialBotResponse = await this.db.isBotResponse(
        message.text || '', 
        channelId, 
        threadTs
      );
      if (isPotentialBotResponse) {
        logger.debug(`Skipping thread message ${channelId}-${message.ts} - detected as bot's own response`);
        continue;
      }

      const messageId = `${channelId}-${message.ts}`;
      
      const hasResponded = await this.db.hasResponded(messageId);
      if (hasResponded) {
        logger.debug(`Thread message ${messageId} already responded to`);
        continue;
      }

      if (this._shouldRespond(message, true)) {
        // TEMPORARILY DISABLED: Thread context causes rate limiting
        // TODO: Implement caching or reduce frequency of thread context fetching
        const threadData = { messages: [], threadAttachments: [] };
        const threadContext = threadData.messages;
        const threadAttachments = threadData.threadAttachments;
        
        // Process file attachments from current message if present
        let attachments = [];
        let attachmentContext = '';
        let filePaths = [];
        
        if (message.files && message.files.length > 0) {
          logger.info(`Thread message ${messageId} has ${message.files.length} file(s): ${message.files.map(f => `${f.name} (${f.mimetype})`).join(', ')}`);
          try {
            attachments = await this.fileHandler.processAttachments(message, channelId);
            const attachmentData = this.fileHandler.formatAttachmentsForClaude(attachments);
            attachmentContext = attachmentData.context;
            filePaths = attachmentData.filePaths;
            logger.info(`Successfully processed ${attachments.length} attachments for thread message ${messageId}`);
            
            // Log attachment details for debugging
            attachments.forEach(att => {
              logger.debug(`Thread attachment ${att.name}: type=${att.type}, error=${att.error || 'none'}`);
            });
          } catch (error) {
            logger.error(`Failed to process attachments for thread message ${messageId}:`, error);
            // Continue processing - bot should still respond even if file processing fails
          }
        }
        
        // Combine current message attachments with thread attachments
        const allAttachments = [...attachments, ...threadAttachments];
        const allThreadAttachmentData = this.fileHandler.formatAttachmentsForClaude(threadAttachments);
        const allFilePaths = [...filePaths, ...allThreadAttachmentData.filePaths];
        
        if (threadAttachments.length > 0) {
          logger.info(`Found ${threadAttachments.length} attachments from earlier messages in thread ${threadTs}`);
        }
        
        const messageObj = {
          id: messageId,
          channel: channelId,
          channelName: channelName, // Use actual channel name
          ts: message.ts,
          thread_ts: threadTs,
          text: message.text,
          user: message.user,
          mentions: this._extractMentions(message.text),
          attachments: allAttachments,
          attachmentContext: attachmentContext,
          filePaths: allFilePaths,
          hasAttachments: allAttachments.length > 0,
          isThreadReply: true,
          threadContext: threadContext,
          threadAttachmentCount: threadAttachments.length
        };

        // Apply loop prevention checks with thread context
        const allowResponse = await this.loopPrevention.shouldAllowResponse(messageObj, threadContext);
        if (allowResponse.allow) {
          filteredMessages.push(messageObj);
        } else {
          logger.info(`Blocked thread message ${messageId} - ${allowResponse.reason}`, allowResponse);
        }
      }
    }

    return filteredMessages;
  }

  async _getThreadContext(channelId, threadTs, limit = 10) {
    try {
      const channelInfo = await this._getChannelId(channelId.replace('#', ''));
      if (!channelInfo) {
        return { messages: [], threadAttachments: [] };
      }

      // Get the full thread history for context
      const result = await rateLimiter.executeWithRetry(
        async () => this.client.conversations.replies({
          channel: channelInfo.id,
          ts: threadTs,
          limit: limit
        }),
        'conversations.replies'
      );

      if (!result.ok || !result.messages) {
        return { messages: [], threadAttachments: [] };
      }

      // Process attachments from all thread messages
      const allThreadAttachments = [];
      
      for (const msg of result.messages) {
        if (msg.files && msg.files.length > 0) {
          logger.debug(`Processing ${msg.files.length} attachments from thread message ${msg.ts}`);
          try {
            const attachments = await this.fileHandler.processAttachments(msg, channelId);
            allThreadAttachments.push(...attachments);
            logger.debug(`Added ${attachments.length} thread attachments from message ${msg.ts}`);
          } catch (error) {
            logger.error(`Failed to process thread attachments from message ${msg.ts}:`, error);
          }
        }
      }

      // Format messages for context
      const messages = result.messages.map(msg => ({
        user: msg.user,
        text: msg.text,
        ts: msg.ts,
        isBot: !!msg.bot_id,
        hasFiles: !!(msg.files && msg.files.length > 0),
        fileCount: msg.files ? msg.files.length : 0
      }));

      return { 
        messages, 
        threadAttachments: allThreadAttachments 
      };
    } catch (error) {
      logger.error('Error getting thread context:', error);
      return { messages: [], threadAttachments: [] };
    }
  }
}

module.exports = SlackService;