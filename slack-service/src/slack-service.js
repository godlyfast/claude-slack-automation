const { WebClient, WebClientEvent, ErrorCode } = require('@slack/web-api');
const Database = require('./db');
const logger = require('./logger');
const cache = require('./cache');
const channelRotator = require('./channel-rotator');
const LoopPreventionSystem = require('./loop-prevention');
const FileHandler = require('./file-handler');
const globalRateLimiter = require('./global-rate-limiter').getInstance();

class SlackService {
  constructor(token, config) {
    // Configure WebClient with best practices for rate limiting
    this.client = new WebClient(token, {
      // The SDK automatically handles rate limiting with retries
      retryConfig: {
        retries: parseInt(process.env.SLACK_RETRY_CONFIG_RETRIES) || 10,
        maxRetryTime: parseInt(process.env.MAX_RETRY_TIME) || 300000
      },
      // IMPORTANT: We set this to true so we can handle rate limits ourselves
      // and pass retry-after info back to the shell script
      rejectRateLimitedCalls: true,
      // Add logging for better debugging
      logLevel: process.env.DEBUG_MODE === 'true' ? 'debug' : process.env.LOG_LEVEL || 'info'
    });
    
    // Monitor rate limit events and store the retry-after value
    this.lastRateLimitRetryAfter = null;
    this.client.on(WebClientEvent.RATE_LIMITED, (numSeconds, request) => {
      logger.warn(`Rate limited by Slack API, retry after ${numSeconds} seconds for ${request.url}`);
      this.lastRateLimitRetryAfter = numSeconds;
    });
    
    this.db = new Database();
    this.loopPrevention = new LoopPreventionSystem(this.db);
    this.fileHandler = new FileHandler(token);
    this.config = {
      llm: config.llm || {},
      channels: config.channels || [],
      triggerKeywords: config.triggerKeywords || [],
      responseMode: config.responseMode || 'mentions',
      maxMessages: Math.min(config.maxMessages || 5, 20), // Cap at 20 per best practices
      checkWindow: config.checkWindow || 5,
      botToken: config.botToken || null
    };

    logger.info('SlackService initialized with file attachment support');
    
    // 🚨 CRITICAL: Flag to prevent Slack API calls during processing
    this._processingMode = false;
  }

  /**
   * 🚨 ENFORCEMENT: Block any Slack API calls during message processing
   */
  _enforceNoSlackAPI(operation) {
    if (this._processingMode) {
      const error = new Error(`🚨 FORBIDDEN: Attempted to call Slack API (${operation}) during message processing. This violates the architecture.`);
      logger.error(error.message);
      throw error;
    }
  }

  setProcessingMode(enabled) {
    this._processingMode = enabled;
    if (enabled) {
      logger.warn('🚨 PROCESSING MODE ENABLED: All Slack API calls are now FORBIDDEN');
    } else {
      logger.info('Processing mode disabled: Slack API calls allowed');
    }
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

    // Reset rate limit tracker
    this.lastRateLimitRetryAfter = null;

    // Use channel rotation to only check one channel per run (due to 1 API call/minute limit)
    const channelsToCheck = await channelRotator.getNextChannels(this.config.channels, 1);
    logger.info(`Checking channel(s) this run: ${channelsToCheck.join(', ')}`);

    for (const channel of channelsToCheck) {
      try {
        const channelMessages = await this._fetchChannelMessages(channel, since);
        const filtered = await this._filterMessages(channelMessages, channel);
        messages.push(...filtered);
      } catch (error) {
        logger.error(`Error fetching messages from ${channel}:`, error);
        
        // If we got rate limited, throw the error with retry-after info
        if (error.code === ErrorCode.RateLimitedError) {
          const rateLimitError = new Error(`Rate limited while fetching messages`);
          rateLimitError.retryAfter = error.retryAfter || 60;
          throw rateLimitError;
        }
        
        // For other errors, throw them too instead of silently continuing
        throw error;
      }
    }

    return messages.slice(0, this.config.maxMessages);
  }

  async _fetchChannelMessages(channelName, since) {
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('_fetchChannelMessages');
    
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

      // Wait for rate limit slot
      await globalRateLimiter.waitForNextSlot();

      logger.info(`🔵 SLACK API CALL: conversations.history for ${channelName}`);
      const startTime = Date.now();

      // Direct API call - SDK handles rate limiting automatically
      const result = await this.client.conversations.history({
        channel: channelInfo.id,
        oldest: since,
        limit: Math.min(this.config.maxMessages, 15),  // Limit to 15 per Slack 2025 API limits
        inclusive: false
      });
      
      // Record the API call
      globalRateLimiter.recordApiCall('conversations.history');

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
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('_getChannelInfo');
    
    // Normalize channel name
    const normalizedName = channelName.replace(/^#/, '');
    
    // Check cache first
    const cacheKey = `channel:${normalizedName}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Wait for rate limit slot
      await globalRateLimiter.waitForNextSlot();
      
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
        
        // Record the API call
        globalRateLimiter.recordApiCall('conversations.list');

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

  async _getUserInfo(userId) {
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('_getUserInfo');

    // Check cache first
    const cacheKey = `user:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Wait for rate limit slot
      await globalRateLimiter.waitForNextSlot();

      logger.info(`🔵 SLACK API CALL: users.info for ${userId}`);
      const startTime = Date.now();

      // Direct API call - SDK handles rate limiting automatically
      const result = await this.client.users.info({
        user: userId,
      });

      // Record the API call
      globalRateLimiter.recordApiCall('users.info');

      const duration = Date.now() - startTime;
      logger.info(`✅ SLACK API SUCCESS: users.info (${duration}ms)`);

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch user info');
      }

      const userInfo = {
        id: result.user.id,
        name: result.user.name,
        real_name: result.user.real_name,
        is_bot: result.user.is_bot,
      };

      // Cache for 1 hour
      cache.set(cacheKey, userInfo, 3600);
      return userInfo;
    } catch (error) {
      if (error.code === ErrorCode.RateLimitedError) {
        logger.warn(`Rate limited while fetching user info for ${userId}, SDK will retry`);
        throw error;
      }

      logger.error(`Error fetching user info for ${userId}:`, error);
      throw error;
    }
  }

  async _filterMessages(messages, channelName) {
    const filteredMessages = [];
    const respondedMessages = (await this.db.getRespondedMessages(1000)) || [];
    const respondedIds = new Set(respondedMessages.map(m => m.message_id));
    
    logger.info(`Filtering ${messages.length} messages from ${channelName}`);

    for (const message of messages) {
      // Skip if already responded
      if (respondedIds.has(message.ts)) {
        logger.debug(`Skipping message ${message.ts} - already responded`);
        continue;
      }

      // Get user info
      const userInfo = await this._getUserInfo(message.user);
      
      // Skip bot messages except MCP messages (which appear as bot messages but should be processed)
      // MCP messages have bot_id B097ML1T6DQ and app_id A097GBJDNAF
      const isMcpMessage = message.bot_id === 'B097ML1T6DQ' || message.app_id === 'A097GBJDNAF';
      
      if ((userInfo.is_bot || message.bot_id || message.subtype === 'bot_message') && !isMcpMessage) {
        logger.debug(`Skipping message ${message.ts} - bot message (not MCP)`);
        continue;
      }
      
      if (isMcpMessage) {
        logger.debug(`Processing MCP message ${message.ts} from user ${message.user}`);
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
      let processedFiles = [];
      if (message.files && message.files.length > 0) {
        const channelInfo = await this._getChannelInfo(channelName);
        processedFiles = await this.fileHandler.processAttachments(message, channelInfo.id);
      }

      filteredMessages.push({
        id: message.ts,
        text: message.text || '',
        user: userInfo,
        channel: message.channel || channelName,
        channelName: channelName,
        ts: message.ts,
        thread_ts: message.thread_ts,
        isThreadReply: !!message.thread_ts,
        hasAttachments: message.files && message.files.length > 0,
        filePaths: processedFiles.map(f => f.filePath).filter(p => p),
        files: processedFiles
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

  async postMessageWithFile(channel, message, file) {
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('files.uploadV2');

    try {
        const channelInfo = await this._getChannelInfo(channel);
        if (!channelInfo) {
            throw new Error(`Channel ${channel} not found`);
        }

        const result = await this.client.files.uploadV2({
            channel_id: channelInfo.id,
            initial_comment: message,
            file: file.path,
            filename: file.name,
        });

        if (!result.ok) {
            throw new Error(result.error || 'Failed to post message with file');
        }

        return {
            success: true,
            ts: result.file.ts
        };
    } catch (error) {
        logger.error('Error posting message with file:', error);
        throw error;
    }
  }

  async postResponse(message, responseText) {
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('chat.postMessage');
    
    try {
      // Record this as a response attempt
      this.loopPrevention.recordResponse(message.channel, message.thread_ts || message.ts, responseText);

      // Wait for rate limit slot
      await globalRateLimiter.waitForNextSlot();

      logger.info(`🔵 SLACK API CALL: chat.postMessage`);
      const startTime = Date.now();

      // Direct API call - SDK handles rate limiting automatically
      const result = await this.client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts || message.ts  // ALWAYS post as thread reply
      });
      
      // Record the API call
      globalRateLimiter.recordApiCall('chat.postMessage');

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
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('conversations.history');
    
    try {
      const channelInfo = await this._getChannelInfo(channelName);
      if (!channelInfo) {
        throw new Error(`Channel ${channelName} not found`);
      }

      logger.info(`Fetching ${limit} messages from channel ${channelName}`);
      
      // Wait for rate limit slot
      await globalRateLimiter.waitForNextSlot();
      
      // Direct API call - SDK handles rate limiting
      const result = await this.client.conversations.history({
        channel: channelInfo.id,
        limit: Math.min(limit, 15) // Cap at 15 per Slack 2025 API limits
      });
      
      // Record the API call
      globalRateLimiter.recordApiCall('conversations.history');

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
    // 🚨 ENFORCEMENT: Block this during processing
    this._enforceNoSlackAPI('warmCache');
    
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
