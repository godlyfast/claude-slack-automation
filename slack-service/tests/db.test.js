const Database = require('../src/db');
const fs = require('fs');
const path = require('path');

describe('Database', () => {
  let db;
  const testDbPath = path.join(__dirname, 'test.db');

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new Database(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('hasResponded', () => {
    it('should return false for non-existent message', async () => {
      const result = await db.hasResponded('test-message-1');
      expect(result).toBe(false);
    });

    it('should return true for existing message', async () => {
      await db.markAsResponded('test-message-1', '#general', '1234567890.123456', 'Test response');
      const result = await db.hasResponded('test-message-1');
      expect(result).toBe(true);
    });
  });

  describe('markAsResponded', () => {
    it('should mark a message as responded', async () => {
      await db.markAsResponded('test-message-2', '#general', '1234567890.123456', 'Test response');
      const hasResponded = await db.hasResponded('test-message-2');
      expect(hasResponded).toBe(true);
    });

    it('should throw error for duplicate message ID', async () => {
      await db.markAsResponded('test-message-3', '#general', '1234567890.123456', 'Test response');
      
      await expect(
        db.markAsResponded('test-message-3', '#general', '1234567890.123456', 'Another response')
      ).rejects.toThrow();
    });
  });

  describe('getRespondedMessages', () => {
    it('should return empty array when no messages', async () => {
      const messages = await db.getRespondedMessages();
      expect(messages).toEqual([]);
    });

    it('should return messages in descending order by date', async () => {
      // Insert messages with explicit timestamps to ensure order
      const db2 = db.db; // Access the raw SQLite database
      
      await new Promise((resolve, reject) => {
        db2.run(
          `INSERT INTO responded_messages (message_id, channel_id, thread_ts, response_text, responded_at) 
           VALUES (?, ?, ?, ?, datetime('now', '-2 seconds'))`,
          ['msg-1', '#general', '1234567890.1', 'Response 1'],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      await new Promise((resolve, reject) => {
        db2.run(
          `INSERT INTO responded_messages (message_id, channel_id, thread_ts, response_text, responded_at) 
           VALUES (?, ?, ?, ?, datetime('now', '-1 seconds'))`,
          ['msg-2', '#general', '1234567890.2', 'Response 2'],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      await new Promise((resolve, reject) => {
        db2.run(
          `INSERT INTO responded_messages (message_id, channel_id, thread_ts, response_text, responded_at) 
           VALUES (?, ?, ?, ?, datetime('now'))`,
          ['msg-3', '#general', '1234567890.3', 'Response 3'],
          (err) => err ? reject(err) : resolve()
        );
      });

      const messages = await db.getRespondedMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].message_id).toBe('msg-3');
      expect(messages[1].message_id).toBe('msg-2');
      expect(messages[2].message_id).toBe('msg-1');
    });

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await db.markAsResponded(`msg-${i}`, '#general', `1234567890.${i}`, `Response ${i}`);
      }

      const messages = await db.getRespondedMessages(3);
      expect(messages).toHaveLength(3);
    });
  });
});