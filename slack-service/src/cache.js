const logger = require('./logger');
const Database = require('./db');

class Cache {
  constructor() {
    this.db = new Database();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      rateLimitsSaved: 0
    };
  }

  async get(key) {
    const item = await this.db.getCache(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (item.expires_at && new Date() > new Date(item.expires_at)) {
      await this.db.deleteCache(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    logger.debug(`Cache hit for key: ${key}`);
    return JSON.parse(item.value);
  }

  async set(key, value, ttlSeconds) {
    await this.db.setCache(key, JSON.stringify(value), ttlSeconds);
    this.stats.sets++;
    logger.debug(`Cache set for key: ${key}, TTL: ${ttlSeconds}s`);
  }

  async delete(key) {
    const deleted = await this.db.deleteCache(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  async clear() {
    await this.db.clearCache();
    logger.info('Cache cleared');
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      rateLimitsSaved: 0
    };
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    const dbStats = await this.db.getCacheStats();
    const estimatedMemoryMB = (dbStats.estimatedMemoryBytes / 1024 / 1024).toFixed(2);

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: dbStats.size,
      estimatedMemoryMB: estimatedMemoryMB
    };
  }

  /**
   * Clean up expired entries
   */
  async cleanup() {
    try {
      const cleaned = await this.db.cleanupCache();
      if (cleaned > 0) {
        logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
      }
      return cleaned;
    } catch (error) {
      logger.error('Error during cache cleanup:', error);
      return 0;
    }
  }

  /**
   * Increment rate limit saves counter
   */
  incrementRateLimitSaves() {
    this.stats.rateLimitsSaved++;
  }
}

// Singleton instance
const cache = new Cache();

// Cleanup expired entries every minute
let cleanupInterval = null;

if (process.env.NODE_ENV !== 'test') {
  cleanupInterval = setInterval(async () => {
    await cache.cleanup();
  }, 60000);
}

// Clean up on process exit
process.on('SIGTERM', () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
});

module.exports = cache;
module.exports.Cache = Cache;