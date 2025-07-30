const logger = require('./logger');

class RateLimiter {
  constructor() {
    this.retryAfter = new Map(); // Store retry-after times for each endpoint
    this.requestCounts = new Map(); // Track requests per endpoint
    this.windowStart = Date.now();
  }

  /**
   * Check if we should make a request or wait
   * @param {string} endpoint - API endpoint
   * @returns {{allowed: boolean, waitTime: number}}
   */
  checkLimit(endpoint) {
    const now = Date.now();
    
    // Check if we have a retry-after time for this endpoint
    const retryTime = this.retryAfter.get(endpoint);
    if (retryTime && now < retryTime) {
      const waitTime = Math.ceil((retryTime - now) / 1000);
      logger.warn(`Rate limited on ${endpoint}, waiting ${waitTime}s`);
      return { allowed: false, waitTime };
    }

    // Reset window every minute
    if (now - this.windowStart > 60000) {
      this.requestCounts.clear();
      this.windowStart = now;
    }

    // Check request count (conservative: 50 requests per minute)
    const count = this.requestCounts.get(endpoint) || 0;
    if (count >= 50) {
      const waitTime = Math.ceil((60000 - (now - this.windowStart)) / 1000);
      logger.warn(`Approaching rate limit for ${endpoint}, waiting ${waitTime}s`);
      return { allowed: false, waitTime };
    }

    return { allowed: true, waitTime: 0 };
  }

  /**
   * Record a request
   * @param {string} endpoint - API endpoint
   */
  recordRequest(endpoint) {
    const count = this.requestCounts.get(endpoint) || 0;
    this.requestCounts.set(endpoint, count + 1);
  }

  /**
   * Handle rate limit response from Slack
   * @param {string} endpoint - API endpoint
   * @param {number} retryAfterSeconds - Seconds to wait before retry
   */
  setRetryAfter(endpoint, retryAfterSeconds) {
    const retryTime = Date.now() + (retryAfterSeconds * 1000);
    this.retryAfter.set(endpoint, retryTime);
    logger.warn(`Rate limited on ${endpoint}, retry after ${retryAfterSeconds}s`);
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Attempt number (starting from 1)
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(attempt, baseDelay = 1000) {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), 300000); // Max 5 minutes
    const jitter = Math.random() * 1000; // 0-1 second jitter
    return exponentialDelay + jitter;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute function with retry logic
   * @param {Function} fn - Function to execute
   * @param {string} endpoint - API endpoint for rate limiting
   * @param {number} maxRetries - Maximum number of retries
   */
  async executeWithRetry(fn, endpoint, maxRetries = 3) {
    // Log API call attempt
    logger.info(`🔵 SLACK API CALL: ${endpoint}`, {
      timestamp: new Date().toISOString(),
      endpoint,
      stack: new Error().stack.split('\n').slice(2, 5).join('\n')
    });
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check rate limit
      const { allowed, waitTime } = this.checkLimit(endpoint);
      if (!allowed) {
        // Maximum wait time is 3 seconds
        const actualWaitTime = Math.min(waitTime, 3);
        logger.warn(`Rate limited, waiting ${actualWaitTime}s (requested: ${waitTime}s)`);
        await this.sleep(actualWaitTime * 1000);
      }

      try {
        this.recordRequest(endpoint);
        const startTime = Date.now();
        const result = await fn();
        const duration = Date.now() - startTime;
        
        logger.info(`✅ SLACK API SUCCESS: ${endpoint} (${duration}ms)`);
        
        // Check if result indicates rate limiting
        if (result && !result.ok && result.error === 'rate_limited') {
          const retryAfter = result.retry_after || 60;
          this.setRetryAfter(endpoint, retryAfter);
          
          if (attempt < maxRetries) {
            // Maximum wait time is 3 seconds
            const actualWaitTime = Math.min(retryAfter, 3);
            logger.info(`Rate limited, waiting ${actualWaitTime}s before retry ${attempt + 1}/${maxRetries} (requested: ${retryAfter}s)`);
            await this.sleep(actualWaitTime * 1000);
            continue;
          }
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Check for rate limit error
        if (error.data && error.data.error === 'rate_limited') {
          const retryAfter = error.data.retry_after || 60;
          this.setRetryAfter(endpoint, retryAfter);
          
          if (attempt < maxRetries) {
            // Maximum wait time is 3 seconds
            const actualWaitTime = Math.min(retryAfter, 3);
            logger.info(`Rate limited (error), waiting ${actualWaitTime}s before retry ${attempt + 1}/${maxRetries} (requested: ${retryAfter}s)`);
            await this.sleep(actualWaitTime * 1000);
            continue;
          }
        }
        
        // For other errors, use exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(this.calculateBackoff(attempt), 3000); // Max 3 seconds
          logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await this.sleep(delay);
          continue;
        }
      }
    }
    
    throw lastError || new Error(`Failed after ${maxRetries} attempts`);
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;