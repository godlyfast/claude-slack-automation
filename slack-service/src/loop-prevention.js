const logger = require('./logger');

class LoopPreventionSystem {
  constructor(db) {
    this.db = db;
    this.conversationStats = new Map(); // Track conversation patterns
    this.userRateLimits = new Map(); // Per-user rate limiting
    this.threadLimits = new Map(); // Per-thread response limits
    this.emergencyStop = false;
    
    // Configuration from environment variables
    this.config = {
      maxResponsesPerThread: parseInt(process.env.MAX_RESPONSES_PER_THREAD || '10'),
      maxResponsesPerUserPerHour: parseInt(process.env.MAX_RESPONSES_PER_USER_PER_HOUR || '20'),
      maxSimilarResponses: parseInt(process.env.MAX_SIMILAR_RESPONSES || '3'),
      conversationCircleDetection: process.env.CONVERSATION_CIRCLE_DETECTION !== 'false',
      triggerWordInjectionPrevention: process.env.TRIGGER_WORD_INJECTION_PREVENTION !== 'false',
      emergencyStopThreshold: parseInt(process.env.EMERGENCY_STOP_THRESHOLD || '20'),
      monitoringInterval: parseInt(process.env.LOOP_PREVENTION_MONITORING_INTERVAL || '5') * 60 * 1000
    };
    
    // Log loaded configuration
    logger.info('Loop Prevention System initialized with config:', this.config);
    
    this.setupMonitoring();
  }

  /**
   * Layer 1: Pre-Processing Validation
   */
  async shouldAllowResponse(message, threadContext = []) {
    if (this.emergencyStop) {
      logger.warn('Emergency stop active - blocking all responses');
      return { allow: false, reason: 'emergency_stop' };
    }

    // 1. Check thread response limit
    const threadCheck = await this.checkThreadLimit(message.channel, message.thread_ts);
    if (!threadCheck.allow) return threadCheck;

    // 2. Check user rate limit
    const userCheck = this.checkUserRateLimit(message.user);
    if (!userCheck.allow) return userCheck;

    // 3. Check for conversation circles
    const circleCheck = this.detectConversationCircle(threadContext);
    if (!circleCheck.allow) return circleCheck;

    // 4. Check for repeated similar requests
    const similarityCheck = await this.checkResponseSimilarity(message, threadContext);
    if (!similarityCheck.allow) return similarityCheck;

    return { allow: true, reason: 'approved' };
  }

  /**
   * Layer 2: Thread Response Limiting
   */
  async checkThreadLimit(channelId, threadTs) {
    try {
      const result = await this.db.getBotResponseCount(channelId, threadTs, 60); // Last hour
      
      if (result.count >= this.config.maxResponsesPerThread) {
        logger.warn(`Thread limit exceeded: ${result.count} responses in thread ${threadTs}`);
        return { 
          allow: false, 
          reason: 'thread_limit_exceeded',
          count: result.count 
        };
      }

      return { allow: true, count: result.count };
    } catch (error) {
      logger.error('Error checking thread limit:', error);
      return { allow: false, reason: 'database_error' };
    }
  }

  /**
   * Layer 3: User Rate Limiting
   */
  checkUserRateLimit(userId) {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    if (!this.userRateLimits.has(userId)) {
      this.userRateLimits.set(userId, []);
    }
    
    const userRequests = this.userRateLimits.get(userId);
    
    // Clean old requests
    const recentRequests = userRequests.filter(time => time > hourAgo);
    this.userRateLimits.set(userId, recentRequests);
    
    if (recentRequests.length >= this.config.maxResponsesPerUserPerHour) {
      logger.warn(`User rate limit exceeded for ${userId}: ${recentRequests.length} requests`);
      return { 
        allow: false, 
        reason: 'user_rate_limit',
        count: recentRequests.length 
      };
    }

    // Add current request
    recentRequests.push(now);
    return { allow: true, count: recentRequests.length };
  }

  /**
   * Layer 4: Conversation Circle Detection
   */
  detectConversationCircle(threadContext) {
    if (!this.config.conversationCircleDetection || threadContext.length < 6) {
      return { allow: true };
    }

    // Look for patterns in last 6 messages
    const recent = threadContext.slice(-6);
    const botMessages = recent.filter(msg => msg.isBot);
    
    if (botMessages.length < 3) return { allow: true };

    // Check for repeating patterns in bot responses
    const responses = botMessages.map(msg => this.normalizeText(msg.text));
    const uniqueResponses = new Set(responses);
    
    if (responses.length - uniqueResponses.size >= 2) {
      logger.warn('Conversation circle detected - similar bot responses repeating');
      return { 
        allow: false, 
        reason: 'conversation_circle',
        pattern: Array.from(uniqueResponses)
      };
    }

    return { allow: true };
  }

  /**
   * Layer 5: Response Similarity Prevention
   */
  async checkResponseSimilarity(message, threadContext) {
    if (threadContext.length === 0) return { allow: true };

    const botResponses = threadContext
      .filter(msg => msg.isBot)
      .slice(-this.config.maxSimilarResponses)
      .map(msg => this.normalizeText(msg.text));

    if (botResponses.length === 0) return { allow: true };

    const messageText = this.normalizeText(message.text);
    
    // Check if this request is very similar to recent ones
    const similarCount = botResponses.filter(response => {
      const similarity = this.calculateTextSimilarity(messageText, response);
      return similarity > 0.8;
    }).length;

    if (similarCount >= 2) {
      logger.warn('High similarity detected - potential response loop');
      return { 
        allow: false, 
        reason: 'high_similarity',
        similarCount 
      };
    }

    return { allow: true };
  }

  /**
   * Layer 6: Post-Response Validation
   */
  validateResponseContent(responseText) {
    if (!this.config.triggerWordInjectionPrevention) {
      return { valid: true };
    }

    // Check if Claude's response contains trigger words that could cause loops
    // Using word boundaries to match whole words
    const triggerPatterns = [
      /\bAI\b/gi,
      /\bШІ\b/gi
    ];
    const normalizedResponse = responseText;
    
    const foundTriggers = [];
    let cleanedResponse = responseText;
    
    triggerPatterns.forEach(pattern => {
      const matches = responseText.match(pattern);
      if (matches) {
        foundTriggers.push(...matches);
        // Replace with asterisks to prevent loops
        cleanedResponse = cleanedResponse.replace(pattern, (match) => {
          return match.replace(/[AIШІaiші]/g, '*');
        });
      }
    });

    if (foundTriggers.length > 0) {
      logger.warn('Response contains trigger words:', foundTriggers);
      
      return { 
        valid: true, 
        modified: true, 
        original: responseText,
        cleaned: cleanedResponse,
        triggers: foundTriggers
      };
    }

    return { valid: true, modified: false };
  }

  /**
   * Layer 7: Emergency Stop System
   */
  checkEmergencyStop() {
    const now = Date.now();
    const tenMinutesAgo = now - (10 * 60 * 1000);
    
    // Count recent responses across all channels
    let totalResponses = 0;
    for (const [channelThread, times] of this.threadLimits.entries()) {
      totalResponses += times.filter(time => time > tenMinutesAgo).length;
    }

    if (totalResponses >= this.config.emergencyStopThreshold) {
      this.emergencyStop = true;
      logger.error(`EMERGENCY STOP ACTIVATED: ${totalResponses} responses in 10 minutes`);
      
      // Auto-recovery after 30 minutes
      setTimeout(() => {
        this.emergencyStop = false;
        logger.info('Emergency stop auto-recovered');
      }, 30 * 60 * 1000);

      return false;
    }

    return true;
  }

  /**
   * Layer 8: Response Tracking
   */
  recordResponse(channelId, threadTs, responseText) {
    const now = Date.now();
    const key = `${channelId}-${threadTs}`;
    
    if (!this.threadLimits.has(key)) {
      this.threadLimits.set(key, []);
    }
    
    this.threadLimits.get(key).push(now);
    
    // Check emergency stop after recording
    this.checkEmergencyStop();
    
    // Clean old records every 100 responses
    if (Math.random() < 0.01) {
      this.cleanupOldRecords();
    }
  }

  /**
   * Utility Methods
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateTextSimilarity(text1, text2) {
    const words1 = text1.split(' ').filter(w => w.length > 2);
    const words2 = text2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 && words2.length === 0) return 1;
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  cleanupOldRecords() {
    const hourAgo = Date.now() - (60 * 60 * 1000);
    
    // Clean user rate limits
    for (const [userId, times] of this.userRateLimits.entries()) {
      const recent = times.filter(time => time > hourAgo);
      if (recent.length === 0) {
        this.userRateLimits.delete(userId);
      } else {
        this.userRateLimits.set(userId, recent);
      }
    }
    
    // Clean thread limits
    for (const [key, times] of this.threadLimits.entries()) {
      const recent = times.filter(time => time > hourAgo);
      if (recent.length === 0) {
        this.threadLimits.delete(key);
      } else {
        this.threadLimits.set(key, recent);
      }
    }
  }

  setupMonitoring() {
    // Log statistics at configured interval
    setInterval(() => {
      const stats = {
        activeUsers: this.userRateLimits.size,
        activeThreads: this.threadLimits.size,
        emergencyStop: this.emergencyStop,
        totalMemoryUsage: process.memoryUsage()
      };
      
      logger.info('Loop Prevention Stats:', stats);
    }, this.config.monitoringInterval);
  }

  /**
   * Manual Controls
   */
  activateEmergencyStop(reason = 'manual') {
    this.emergencyStop = true;
    logger.warn(`Manual emergency stop activated: ${reason}`);
  }

  deactivateEmergencyStop() {
    this.emergencyStop = false;
    logger.info('Emergency stop manually deactivated');
  }

  getSystemStatus() {
    return {
      emergencyStop: this.emergencyStop,
      activeUsers: this.userRateLimits.size,
      activeThreads: this.threadLimits.size,
      config: this.config
    };
  }
}

module.exports = LoopPreventionSystem;