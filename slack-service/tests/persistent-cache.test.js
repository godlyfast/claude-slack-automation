const { Cache } = require('../src/cache');
const Database = require('../src/db');

jest.mock('../src/db');

describe('Persistent Cache', () => {
  let cache;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      getCache: jest.fn(),
      setCache: jest.fn(),
      deleteCache: jest.fn(),
      clearCache: jest.fn(),
    };
    Database.mockImplementation(() => mockDb);
    cache = new Cache();
  });

  it('should get data from the database', async () => {
    mockDb.getCache.mockResolvedValue({ value: JSON.stringify({ data: 'test' }) });
    const value = await cache.get('test-key');
    expect(value).toEqual({ data: 'test' });
    expect(mockDb.getCache).toHaveBeenCalledWith('test-key');
  });

  it('should set data in the database', async () => {
    await cache.set('test-key', { data: 'test' }, 60);
    expect(mockDb.setCache).toHaveBeenCalledWith('test-key', JSON.stringify({ data: 'test' }), 60);
  });

  it('should return null for non-existent keys', async () => {
    mockDb.getCache.mockResolvedValue(null);
    const value = await cache.get('non-existent');
    expect(value).toBeNull();
  });

  it('should handle TTL expiration', async () => {
    const expiredItem = {
      value: JSON.stringify('value'),
      expires_at: new Date(Date.now() - 1000).toISOString()
    };
    mockDb.getCache.mockResolvedValue(expiredItem);
    const value = await cache.get('expires-fast');
    expect(value).toBeNull();
    expect(mockDb.deleteCache).toHaveBeenCalledWith('expires-fast');
  });

  it('should delete existing items', async () => {
    mockDb.deleteCache.mockResolvedValue(true);
    const result = await cache.delete('to-delete');
    expect(result).toBe(true);
    expect(mockDb.deleteCache).toHaveBeenCalledWith('to-delete');
  });

  it('should clear all items', async () => {
    await cache.clear();
    expect(mockDb.clearCache).toHaveBeenCalled();
  });
});