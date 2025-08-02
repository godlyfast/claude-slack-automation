const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class GlobalRateLimiter {
  constructor(bucketSize = 5, refillRate = 1 / 65) {
    this.stateFile = path.join(__dirname, '..', 'data', 'rate_limit_state.json');
    this.bucketSize = bucketSize; // Max 5 calls in a burst
    this.refillRate = refillRate; // Refill 1 token every 65 seconds
    this.ensureDataDir();
    this.loadState();
  }

  ensureDataDir() {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.state = JSON.parse(data);
        if (this.state.tokens === undefined) {
          this.state.tokens = this.bucketSize;
        }
        if (this.state.lastRefill === undefined) {
          this.state.lastRefill = Date.now();
        }
      } else {
        this.state = {
          tokens: this.bucketSize,
          lastRefill: Date.now(),
          totalCalls: 0,
          blockedCalls: 0
        };
        this.saveState();
      }
    } catch (error) {
      logger.error('Failed to load rate limit state:', error);
      this.state = {
        tokens: this.bucketSize,
        lastRefill: Date.now(),
        totalCalls: 0,
        blockedCalls: 0
      };
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('Failed to save rate limit state:', error);
    }
  }

  refillTokens() {
    const now = Date.now();
    const timeSinceLastRefill = now - this.state.lastRefill;
    const tokensToAdd = timeSinceLastRefill * this.refillRate / 1000;
    this.state.tokens = Math.min(this.bucketSize, this.state.tokens + tokensToAdd);
    this.state.lastRefill = now;
  }

  canMakeApiCall() {
    this.refillTokens();
    if (this.state.tokens >= 1) {
      return { allowed: true, waitTime: 0 };
    } else {
      const timeToNextToken = (1 - this.state.tokens) / this.refillRate * 1000;
      return { allowed: false, waitTime: timeToNextToken };
    }
  }

  async waitForNextSlot() {
    const check = this.canMakeApiCall();
    
    if (!check.allowed) {
      logger.info(`Rate limit: Waiting ${Math.ceil(check.waitTime / 1000)}s before next API call`);
      await new Promise(resolve => setTimeout(resolve, check.waitTime));
    }
    
    return true;
  }

  recordApiCall(endpoint) {
    if (this.state.tokens >= 1) {
      this.state.tokens -= 1;
      this.state.totalCalls++;
      logger.info(`Global rate limiter: API call recorded for ${endpoint}. Tokens left: ${this.state.tokens.toFixed(2)}`);
      this.saveState();
      return true;
    }
    return false;
  }

  recordBlockedCall(endpoint) {
    this.state.blockedCalls++;
    logger.warn(`Global rate limiter: API call blocked for ${endpoint}`);
    this.saveState();
  }

  getStats() {
    this.refillTokens();
    const check = this.canMakeApiCall();
    return {
      totalCalls: this.state.totalCalls,
      blockedCalls: this.state.blockedCalls,
      tokens: this.state.tokens.toFixed(2),
      bucketSize: this.bucketSize,
      refillRate: `${this.refillRate * 1000} tokens/sec`,
      nextCallAllowedIn: check.allowed ? 0 : Math.ceil(check.waitTime / 1000),
      canCallNow: check.allowed,
      description: 'Token bucket rate limiter'
    };
  }

  reset() {
    this.state = {
      tokens: this.bucketSize,
      lastRefill: Date.now(),
      totalCalls: 0,
      blockedCalls: 0
    };
    this.saveState();
    logger.info('Global rate limiter reset');
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new GlobalRateLimiter();
    }
    return instance;
  }
};
