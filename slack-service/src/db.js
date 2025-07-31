const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor(dbPath = path.join(__dirname, '../data/slack-bot.db')) {
    this.db = new sqlite3.Database(dbPath);
    this.initialize();
  }

  initialize() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS responded_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT UNIQUE NOT NULL,
          channel_id TEXT NOT NULL,
          thread_ts TEXT,
          response_text TEXT,
          responded_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_message_id ON responded_messages(message_id)
      `);

      // Track threads the bot has participated in
      this.db.run(`
        CREATE TABLE IF NOT EXISTS bot_threads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL,
          thread_ts TEXT NOT NULL,
          last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(channel_id, thread_ts)
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_thread ON bot_threads(channel_id, thread_ts)
      `);

      // Track bot's own responses to prevent responding to them
      this.db.run(`
        CREATE TABLE IF NOT EXISTS bot_responses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL,
          thread_ts TEXT,
          response_text TEXT NOT NULL,
          posted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_bot_responses_time ON bot_responses(posted_at DESC)
      `);

      // Queue for messages to be processed by Claude
      this.db.run(`
        CREATE TABLE IF NOT EXISTS message_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT UNIQUE NOT NULL,
          channel_id TEXT NOT NULL,
          channel_name TEXT,
          thread_ts TEXT,
          user_id TEXT,
          text TEXT,
          has_attachments BOOLEAN DEFAULT 0,
          file_paths TEXT, -- JSON array of file paths
          fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'pending', -- pending, processing, processed, error
          processed_at DATETIME,
          error_message TEXT
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_queue_status ON message_queue(status)
      `);

      // Queue for responses to be sent to Slack
      this.db.run(`
        CREATE TABLE IF NOT EXISTS response_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          thread_ts TEXT,
          response_text TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'pending', -- pending, sending, sent, error
          sent_at DATETIME,
          error_message TEXT,
          retry_count INTEGER DEFAULT 0
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_response_status ON response_queue(status)
      `);
    });
  }

  async hasResponded(messageId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT 1 FROM responded_messages WHERE message_id = ?',
        [messageId],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });
  }

  async markAsResponded(messageId, channelId, threadTs, responseText) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO responded_messages (message_id, channel_id, thread_ts, response_text) 
         VALUES (?, ?, ?, ?)`,
        [messageId, channelId, threadTs, responseText],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getRespondedMessages(limit = 100) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM responded_messages ORDER BY responded_at DESC LIMIT ?',
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async trackThread(channelId, threadTs) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO bot_threads (channel_id, thread_ts, last_checked) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [channelId, threadTs],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getActiveThreads(sinceMinutes = 60) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT DISTINCT channel_id, thread_ts 
         FROM bot_threads 
         WHERE datetime(last_checked) > datetime('now', '-' || ? || ' minutes')
         ORDER BY last_checked DESC`,
        [sinceMinutes],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async updateThreadLastChecked(channelId, threadTs) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE bot_threads SET last_checked = CURRENT_TIMESTAMP 
         WHERE channel_id = ? AND thread_ts = ?`,
        [channelId, threadTs],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async recordBotResponse(channelId, threadTs, responseText) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO bot_responses (channel_id, thread_ts, response_text) 
         VALUES (?, ?, ?)`,
        [channelId, threadTs, responseText],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async isBotResponse(messageText, channelId, threadTs = null, withinMinutes = 10) {
    return new Promise((resolve, reject) => {
      if (!messageText || messageText.trim().length === 0) {
        resolve(false);
        return;
      }

      // Normalize the message text for comparison
      const normalizedText = messageText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Get all recent bot responses in the same channel/thread
      this.db.all(
        `SELECT response_text FROM bot_responses 
         WHERE channel_id = ? 
         AND (thread_ts = ? OR (thread_ts IS NULL AND ? IS NULL))
         AND datetime(posted_at) > datetime('now', '-' || ? || ' minutes')
         ORDER BY posted_at DESC`,
        [channelId, threadTs, threadTs, withinMinutes],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          // Check for similarity with any recorded bot response
          for (const row of rows) {
            const botResponseNormalized = row.response_text
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            // Check for high similarity (>70% overlap)
            if (this._calculateTextSimilarity(normalizedText, botResponseNormalized) > 0.7) {
              resolve(true);
              return;
            }

            // Also check if the message text is contained within the bot response
            if (botResponseNormalized.includes(normalizedText) && normalizedText.length > 20) {
              resolve(true);
              return;
            }
          }

          resolve(false);
        }
      );
    });
  }

  _calculateTextSimilarity(text1, text2) {
    const words1 = text1.split(' ').filter(w => w.length > 2);
    const words2 = text2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 && words2.length === 0) return 1;
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  async getBotResponseCount(channelId, threadTs = null, withinMinutes = 60) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM bot_responses 
         WHERE channel_id = ? 
         AND (thread_ts = ? OR (thread_ts IS NULL AND ? IS NULL))
         AND datetime(posted_at) > datetime('now', '-' || ? || ' minutes')`,
        [channelId, threadTs, threadTs, withinMinutes],
        (err, row) => {
          if (err) reject(err);
          else resolve({ count: row.count || 0 });
        }
      );
    });
  }

  async getRecentBotResponses(channelId, threadTs = null, limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT response_text, posted_at FROM bot_responses 
         WHERE channel_id = ? 
         AND (thread_ts = ? OR (thread_ts IS NULL AND ? IS NULL))
         ORDER BY posted_at DESC 
         LIMIT ?`,
        [channelId, threadTs, threadTs, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Message Queue Methods
  async queueMessage(message) {
    return new Promise((resolve, reject) => {
      const filePaths = message.filePaths ? JSON.stringify(message.filePaths) : null;
      this.db.run(
        `INSERT OR IGNORE INTO message_queue 
         (message_id, channel_id, channel_name, thread_ts, user_id, text, has_attachments, file_paths) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id || message.ts,
          message.channel,
          message.channelName,
          message.thread_ts,
          message.user,
          message.text,
          message.hasAttachments ? 1 : 0,
          filePaths
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        }
      );
    });
  }

  async getPendingMessages(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM message_queue 
         WHERE status = 'pending' 
         ORDER BY fetched_at ASC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(row => ({
            ...row,
            filePaths: row.file_paths ? JSON.parse(row.file_paths) : []
          })));
        }
      );
    });
  }

  async updateMessageStatus(messageId, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE message_queue 
         SET status = ?, processed_at = CURRENT_TIMESTAMP, error_message = ?
         WHERE message_id = ?`,
        [status, errorMessage, messageId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  // Response Queue Methods
  async queueResponse(messageId, channelId, threadTs, responseText) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO response_queue 
         (message_id, channel_id, thread_ts, response_text) 
         VALUES (?, ?, ?, ?)`,
        [messageId, channelId, threadTs, responseText],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  }

  async getPendingResponses(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM response_queue 
         WHERE status = 'pending' AND retry_count < 3
         ORDER BY created_at ASC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async updateResponseStatus(id, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE response_queue 
         SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END, 
             error_message = ?, retry_count = retry_count + CASE WHEN ? = 'error' THEN 1 ELSE 0 END
         WHERE id = ?`,
        [status, status, errorMessage, status, id],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;