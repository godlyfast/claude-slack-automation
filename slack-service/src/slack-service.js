const { WebClient, WebClientEvent, ErrorCode } = require('@slack/web-api');
const Database = require('./db');
const logger = require('./logger');
const cache = require('./cache');
const channelRotator = require('./channel-rotator');
const LoopPreventionSystem = require('./loop-prevention');
const FileHandler = require('./file-handler');

class SlackService {
  constructor(token, config) {
    // Configure WebClient with best practices for rate limiting
    this.client = new WebClient(token, {
      // The SDK automatically handles rate limiting with retries
      retryConfig: {
        retries: parseInt(process.env.SLACK_RETRY_CONFIG_RETRIES) || 10,
        maxRetryTime: parseInt(process.env.MAX_RETRY_TIME) || 300000
      },
      // Let SDK handle rate limits automatically
      rejectRateLimitedCalls: false,
      // Add logging for better debugging
      logLevel: process.env.DEBUG_MODE === 'true' ? 'debug' : process.env.LOG_LEVEL || 'info'
    });
    
    // Monitor rate limit events
    this.client.on(WebClientEvent.RATE_LIMITED, (numSeconds, request) => {
      logger.warn(`Rate limited by Slack API, retry after ${numSeconds} seconds for ${request.url}`);
    });
    
    this.db = new Database();
    this.loopPrevention = new LoopPreventionSystem(this.db);
    this.fileHandler = new FileHandler(token);
    this.config = {
      channels: config.channels || [],
      triggerKeywords: config.triggerKeywords || [],
      responseMode: config.responseMode || 'mentions',
      maxMessages: Math.min(config.maxMessages || 5, 20), // Cap at 20 per best practices
      checkWindow: config.checkWindow || 5,
      botToken: config.botToken || null
    };

    logger.info('SlackService initialized with file attachment support');
  }

  /**
   * Initialize the file handler
   */
  async init() {
    await this.fileHandler.init();
  }

  async getUnrespondedMessages() {
    const messages = [];
    const since = new Date(Date.now() - this.config.checkWindow * 60 * 1000).getTime() / 1000;

    for (const channel of this.config.channels) {
      try {
        const channelMessages = await this._fetchChannelMessages(channel, since);
        const filtered = await this._filterMessages(channelMessages, channel);
        messages.push(...filtered);
      } catch (error) {
        logger.error(`Error fetching messages from ${channel}:`, error);
      }
    }

    return messages.slice(0, this.config.maxMessages);
  }

  async _fetchChannelMessages(channelName, since) {
    try {
      const channelInfo = await this._getChannelInfo(channelName);
      if (!channelInfo) {
        logger.error(`Channel ${channelName} not found or bot doesn't have access`);
        return [];
      }

      // Check cache first
      const cacheKey = `messages:${channelInfo.id}:${since}`;
      const cachedMessages = cache.get(cacheKey);
      
      if (cachedMessages && Array.isArray(cachedMessages)) {
        logger.info(`Using cached messages for ${channelName}`);
        cache.incrementRateLimitSaves();
        return cachedMessages;
      }

      logger.info(`🔵 SLACK API CALL: conversations.history for ${channelName}`);
      const startTime = Date.now();

      // Direct API call - SDK handles rate limiting automatically
      const result = await this.client.conversations.history({
        channel: channelInfo.id,
        oldest: since,
        limit: Math.min(this.config.maxMessages, 20),  // Limit to 20 per best practices
        inclusive: false
      });

      const duration = Date.now() - startTime;
      logger.info(`✅ SLACK API SUCCESS: conversations.history (${duration}ms)`);

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch channel history');
      }

      const messages = result.messages || [];
      
      // Cache the messages
      cache.set(cacheKey, messages, 30); // Cache for 30 seconds
      
      return messages;
    } catch (error) {
      // Check if it's a rate limit error
      if (error.code === ErrorCode.RateLimitedError) {
        logger.warn(`Rate limited for ${channelName}, SDK will retry automatically`);
        throw error; // Let SDK handle the retry
      }
      
      logger.error(`Error in _fetchChannelMessages for ${channelName}:`, error);
      throw error;
    }
  }

  async _getChannelInfo(channelName) {
    // Normalize channel name
    const normalizedName = channelName.replace(/^#/, '');
    
    // Check cache first
    const cacheKey = `channel:${normalizedName}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      logger.info(`🔵 SLACK API CALL: conversations.list to find ${channelName}`);
      const startTime = Date.now();

      // Use cursor-based pagination for better performance
      let cursor;
      do {
        const result = await this.client.conversations.list({
          types: 'public_channel,private_channel',
          limit: 200,  // Recommended limit per best practices
          cursor: cursor
        });

        if (!result.ok) {
          throw new Error(result.error || 'Failed to list channels');
        }

        // Find the channel
        const channel = result.channels.find(ch => 
          ch.name === normalizedName || 
          ch.name === channelName ||
          ch.id === channelName
        );

        if (channel) {
          const duration = Date.now() - startTime;
          logger.info(`✅ SLACK API SUCCESS: Found channel ${channelName} (${duration}ms)`);
          
          const channelInfo = {
            id: channel.id,
            name: channel.name,
            is_private: channel.is_private
          };
          
          // Cache for 1 hour
          cache.set(cacheKey, channelInfo, 3600);
          return channelInfo;
        }

        cursor = result.response_metadata?.next_cursor;
      } while (cursor);

      logger.warn(`Channel ${channelName} not found`);
      return null;

    } catch (error) {
      if (error.code === ErrorCode.RateLimitedError) {
        logger.warn(`Rate limited while searching for ${channelName}, SDK will retry`);
        throw error;
      }
      
      logger.error(`Error finding channel ${channelName}:`, error);
      throw error;
    }
  }

  async _filterMessages(messages, channelName) {
    const filteredMessages = [];
    const respondedMessages = await this.db.getRespondedMessages(1000);
    const respondedIds = new Set(respondedMessages.map(m => m.message_id));
    
    logger.info(`Filtering ${messages.length} messages from ${channelName}`);

    for (const message of messages) {
      // Skip if already responded
      if (respondedIds.has(message.ts)) {
        logger.debug(`Skipping message ${message.ts} - already responded`);
        continue;
      }

      // Skip bot messages
      if (message.bot_id || message.subtype === 'bot_message') {
        logger.debug(`Skipping message ${message.ts} - bot message`);
        continue;
      }

      // Apply trigger word filtering
      const shouldRespond = this._shouldRespondToMessage(message);
      if (!shouldRespond) {
        logger.debug(`Skipping message ${message.ts} - no trigger words`);
        continue;
      }

      // Check loop prevention
      const loopCheck = await this.loopPrevention.shouldAllowResponse(message);
      if (!loopCheck.allow) {
        logger.warn(`Loop prevention: Blocking response to message ${message.ts} - reason: ${loopCheck.reason}`);
        continue;
      }

      // Process file attachments if any
      let filePaths = [];
      if (message.files && message.files.length > 0) {
        filePaths = await this._processFileAttachments(message.files, channelName);
      }

      filteredMessages.push({
        id: message.ts,
        text: message.text || '',
        user: message.user,
        channel: message.channel || channelName,
        channelName: channelName,
        ts: message.ts,
        thread_ts: message.thread_ts,
        isThreadReply: !!message.thread_ts,
        hasAttachments: message.files && message.files.length > 0,
        filePaths: filePaths
      });
    }

    return filteredMessages;
  }

  _shouldRespondToMessage(message) {
    if (!message.text) {
      logger.debug(`No text in message ${message.ts}`);
      return false;
    }

    if (this.config.responseMode === 'all') {
      // Check for trigger keywords
      const lowerText = message.text.toLowerCase();
      return this.config.triggerKeywords.some(keyword => 
        lowerText.includes(keyword.toLowerCase())
      );
    } else if (this.config.responseMode === 'mentions') {
      // Only respond to mentions (simplified check)
      return message.text.includes('<@');
    }

    return false;
  }

  async _processFileAttachments(files, channelName) {
    const filePaths = [];
    
    for (const file of files) {
      try {
        const savedPath = await this.fileHandler.downloadFile(file, channelName);
        if (savedPath) {
          filePaths.push({
            path: savedPath,
            name: file.name,
            type: file.mimetype || 'unknown'
          });
        }
      } catch (error) {
        logger.error(`Failed to process file ${file.name}:`, error);
      }
    }

    return filePaths;
  }

  async postResponse(message, responseText) {
    try {
      // Record this as a response attempt
      this.loopPrevention.recordResponse(message.channel, message.thread_ts || message.ts, responseText);

      logger.info(`🔵 SLACK API CALL: chat.postMessage`);
      const startTime = Date.now();

      // Direct API call - SDK handles rate limiting automatically
      const result = await this.client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts || message.ts
      });

      const duration = Date.now() - startTime;
      logger.info(`✅ SLACK API SUCCESS: chat.postMessage (${duration}ms)`);

      if (!result.ok) {
        throw new Error(result.error || 'Failed to post message');
      }

      // Record in database
      await this.db.markAsResponded(message.ts, message.channel, message.thread_ts || message.ts, responseText);

      return {
        success: true,
        ts: result.ts
      };
    } catch (error) {
      if (error.code === ErrorCode.RateLimitedError) {
        logger.warn('Rate limited while posting response, SDK will retry');
        throw error;
      }
      
      logger.error('Error posting response:', error);
      throw error;
    }
  }

  async getChannelHistory(channelName, limit = 100) {
    try {
      const channelInfo = await this._getChannelInfo(channelName);
      if (!channelInfo) {
        throw new Error(`Channel ${channelName} not found`);
      }

      logger.info(`Fetching ${limit} messages from channel ${channelName}`);
      
      // Direct API call - SDK handles rate limiting
      const result = await this.client.conversations.history({
        channel: channelInfo.id,
        limit: Math.min(limit, 200) // Cap at 200 per best practices
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch channel history');
      }

      logger.info(`Retrieved ${result.messages.length} messages from ${channelName}`);
      return result.messages || [];

    } catch (error) {
      if (error.code === ErrorCode.RateLimitedError) {
        logger.warn(`Rate limited for channel history ${channelName}`);
        throw error;
      }
      
      logger.error(`Error getting channel history for ${channelName}:`, error);
      throw error;
    }
  }

  // Utility methods
  getCacheStats() {
    return cache.getStats();
  }

  clearCache() {
    cache.clear();
  }

  async warmCache() {
    logger.info('Warming up cache...');
    for (const channel of this.config.channels) {
      try {
        await this._getChannelInfo(channel);
      } catch (error) {
        logger.warn(`Failed to warm cache for ${channel}:`, error);
      }
    }
  }

  getLoopPreventionStatus() {
    return this.loopPrevention.getSystemStatus();
  }

  activateEmergencyStop(reason) {
    this.loopPrevention.activateEmergencyStop(reason);
  }

  deactivateEmergencyStop() {
    this.loopPrevention.deactivateEmergencyStop();
  }

  close() {
    this.db.close();
    this.fileHandler.cleanup();
  }
}

module.exports = SlackService;