const cache = require('../src/cache');

describe('Cache', () => {
  beforeEach(() => {
    // Clear the cache before each test
    cache.clear();
    cache.resetStats();
  });

  afterEach(() => {
    // Clear the cache after each test
    cache.clear();
  });

  describe('get/set operations', () => {
    it('should store and retrieve values', () => {
      cache.set('test-key', { data: 'test-value' }, 60);
      const value = cache.get('test-key');
      expect(value).toEqual({ data: 'test-value' });
    });

    it('should return null for non-existent keys', () => {
      const value = cache.get('non-existent');
      expect(value).toBeNull();
    });

    it('should handle TTL expiration', async () => {
      cache.set('expires-fast', 'value', 0.1); // 100ms TTL
      
      // Should exist immediately
      expect(cache.get('expires-fast')).toBe('value');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be expired
      expect(cache.get('expires-fast')).toBeNull();
    });

    it('should handle items without TTL', () => {
      cache.set('no-ttl', 'permanent');
      expect(cache.get('no-ttl')).toBe('permanent');
    });
  });

  describe('delete operations', () => {
    it('should delete existing items', () => {
      cache.set('to-delete', 'value', 60);
      expect(cache.delete('to-delete')).toBe(true);
      expect(cache.get('to-delete')).toBeNull();
    });

    it('should return false when deleting non-existent items', () => {
      expect(cache.delete('non-existent')).toBe(false);
    });
  });

  describe('clear operations', () => {
    it('should clear all items', () => {
      cache.set('item1', 'value1', 60);
      cache.set('item2', 'value2', 60);
      cache.set('item3', 'value3', 60);
      
      cache.clear();
      
      expect(cache.get('item1')).toBeNull();
      expect(cache.get('item2')).toBeNull();
      expect(cache.get('item3')).toBeNull();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key', 'value', 60);
      
      // Hit
      cache.get('key');
      // Miss
      cache.get('non-existent');
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.sets).toBe(1);
    });

    it('should calculate hit rate', () => {
      cache.set('key', 'value', 60);
      
      // 3 hits
      cache.get('key');
      cache.get('key');
      cache.get('key');
      
      // 1 miss
      cache.get('miss');
      
      const stats = cache.getStats();
      expect(stats.hitRate).toBe('75.00%');
    });

    it('should track rate limits saved', () => {
      cache.incrementRateLimitSaves();
      cache.incrementRateLimitSaves();
      
      const stats = cache.getStats();
      expect(stats.rateLimitsSaved).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      cache.set('expires-1', 'value1', 0.1);
      cache.set('expires-2', 'value2', 0.1);
      cache.set('permanent', 'value3', 60);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const cleaned = cache.cleanup();
      expect(cleaned).toBe(2);
      expect(cache.get('permanent')).toBe('value3');
      expect(cache.get('expires-1')).toBeNull();
      expect(cache.get('expires-2')).toBeNull();
    });
  });
});