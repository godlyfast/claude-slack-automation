const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class ChannelRotator {
  constructor(stateFile = path.join(__dirname, '../data/channel-state.json')) {
    this.stateFile = stateFile;
    this.state = {
      lastChannelIndex: -1,
      lastRunTime: 0,
      channelHistory: {}
    };
    this.loadState();
  }

  async loadState() {
    try {
      const data = await fs.readFile(this.stateFile, 'utf8');
      this.state = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is corrupted, use defaults
      logger.debug('No channel state file found, using defaults');
    }
  }

  async saveState() {
    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('Failed to save channel state:', error);
    }
  }

  /**
   * Get next channel(s) to check based on rate limits
   * @param {string[]} allChannels - All configured channels
   * @param {number} maxChannels - Maximum channels to return (based on rate limit)
   * @returns {string[]} Channels to check this run
   */
  async getNextChannels(allChannels, maxChannels = 1) {
    const now = Date.now();
    const timeSinceLastRun = now - this.state.lastRunTime;
    
    // If it's been more than 5 minutes, check all channels
    if (timeSinceLastRun > 300000) {
      this.state.lastRunTime = now;
      await this.saveState();
      return allChannels.slice(0, maxChannels);
    }

    // Rotate through channels
    const startIndex = (this.state.lastChannelIndex + 1) % allChannels.length;
    const channels = [];
    
    for (let i = 0; i < Math.min(maxChannels, allChannels.length); i++) {
      const index = (startIndex + i) % allChannels.length;
      channels.push(allChannels[index]);
    }

    this.state.lastChannelIndex = (startIndex + maxChannels - 1) % allChannels.length;
    this.state.lastRunTime = now;
    
    // Track when each channel was last checked
    channels.forEach(channel => {
      this.state.channelHistory[channel] = now;
    });

    await this.saveState();
    
    logger.info(`Channel rotation: checking ${channels.join(', ')} this run`);
    return channels;
  }

  /**
   * Get channels that haven't been checked recently
   * @param {string[]} allChannels - All configured channels
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {string[]} Channels that need checking
   */
  getStaleChannels(allChannels, maxAge = 300000) {
    const now = Date.now();
    return allChannels.filter(channel => {
      const lastChecked = this.state.channelHistory[channel] || 0;
      return (now - lastChecked) > maxAge;
    });
  }

  /**
   * Reset rotation state
   */
  async reset() {
    this.state = {
      lastChannelIndex: -1,
      lastRunTime: 0,
      channelHistory: {}
    };
    await this.saveState();
  }
}

// Singleton instance
const channelRotator = new ChannelRotator();

module.exports = channelRotator;