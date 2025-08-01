const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class GlobalRateLimiter {
  constructor() {
    this.stateFile = path.join(__dirname, '..', 'data', 'rate_limit_state.json');
    this.minTimeBetweenCalls = 65000; // 65 seconds (small buffer above 60s limit)
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
      } else {
        this.state = {
          lastApiCall: 0,
          totalCalls: 0,
          blockedCalls: 0
        };
        this.saveState();
      }
    } catch (error) {
      logger.error('Failed to load rate limit state:', error);
      this.state = {
        lastApiCall: 0,
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

  canMakeApiCall() {
    const now = Date.now();
    const timeSinceLastCall = now - this.state.lastApiCall;
    
    if (timeSinceLastCall >= this.minTimeBetweenCalls) {
      return {
        allowed: true,
        waitTime: 0
      };
    }
    
    const waitTime = this.minTimeBetweenCalls - timeSinceLastCall;
    return {
      allowed: false,
      waitTime: waitTime
    };
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
    const now = Date.now();
    this.state.lastApiCall = now;
    this.state.totalCalls++;
    
    logger.info(`Global rate limiter: API call recorded for ${endpoint} at ${new Date(now).toISOString()}`);
    logger.info(`Next API call allowed at: ${new Date(now + this.minTimeBetweenCalls).toISOString()}`);
    
    this.saveState();
  }

  recordBlockedCall(endpoint) {
    this.state.blockedCalls++;
    logger.warn(`Global rate limiter: API call blocked for ${endpoint}`);
    this.saveState();
  }

  getStats() {
    const now = Date.now();
    const timeSinceLastCall = now - this.state.lastApiCall;
    const nextCallTime = Math.max(0, this.minTimeBetweenCalls - timeSinceLastCall);
    
    return {
      totalCalls: this.state.totalCalls,
      blockedCalls: this.state.blockedCalls,
      lastApiCall: this.state.lastApiCall ? new Date(this.state.lastApiCall).toISOString() : 'Never',
      nextCallAllowedIn: Math.ceil(nextCallTime / 1000),
      canCallNow: timeSinceLastCall >= this.minTimeBetweenCalls,
      enforcedLimit: '1 call per 65 seconds',
      description: 'Global rate limiter with 5-second buffer above Slack\'s 60-second limit'
    };
  }

  reset() {
    this.state = {
      lastApiCall: 0,
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