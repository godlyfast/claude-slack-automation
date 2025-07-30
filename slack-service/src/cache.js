const logger = require('./logger');

class Cache {
  constructor() {
    this.store = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      rateLimitsSaved: 0
    };
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if expired/missing
   */
  get(key) {
    const item = this.store.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    logger.debug(`Cache hit for key: ${key}`);
    return item.value;
  }

  /**
   * Set a value in cache with TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds
   */
  set(key, value, ttlSeconds) {
    const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null;
    
    this.store.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });
    
    this.stats.sets++;
    logger.debug(`Cache set for key: ${key}, TTL: ${ttlSeconds}s`);
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    const deleted = this.store.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.store.size;
    this.store.clear();
    this.stats.deletes += size;
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
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.store.size,
      estimatedMemoryMB: this._estimateMemoryUsage()
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, item] of this.store.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }

    return cleaned;
  }

  /**
   * Estimate memory usage in MB
   */
  _estimateMemoryUsage() {
    // Rough estimation based on JSON string size
    let totalSize = 0;
    
    for (const [key, item] of this.store.entries()) {
      try {
        totalSize += key.length;
        totalSize += JSON.stringify(item.value).length;
      } catch (e) {
        // Ignore circular references
      }
    }

    return (totalSize / 1024 / 1024).toFixed(2);
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
  cleanupInterval = setInterval(() => {
    cache.cleanup();
  }, 60000);
}

// Clean up on process exit
process.on('SIGTERM', () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
});

module.exports = cache;