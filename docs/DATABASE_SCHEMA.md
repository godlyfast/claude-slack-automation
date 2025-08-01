# Database Schema Documentation

## Overview

The Claude Slack Bot uses SQLite to manage message queues, track responses, and prevent duplicate processing. The database file is located at `slack-service/data/slack-bot.db`.

## Tables

### 1. message_queue
Stores messages fetched from Slack that need to be processed by Claude.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| message_id | TEXT UNIQUE NOT NULL | Slack message timestamp ID |
| channel_id | TEXT NOT NULL | Slack channel ID |
| channel_name | TEXT | Human-readable channel name |
| thread_ts | TEXT | Thread timestamp (if in thread) |
| user_id | TEXT | Slack user ID who sent message |
| text | TEXT | Message content |
| has_attachments | BOOLEAN DEFAULT 0 | Whether message has files |
| file_paths | TEXT | JSON array of downloaded file paths |
| fetched_at | DATETIME DEFAULT CURRENT_TIMESTAMP | When message was fetched |
| status | TEXT DEFAULT 'pending' | pending, processing, processed, error |
| processed_at | DATETIME | When processing completed |
| error_message | TEXT | Error details if processing failed |

**Indexes:**
- `idx_queue_status` on `status` column for fast filtering

### 2. response_queue
Stores Claude's responses waiting to be sent to Slack.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| message_id | TEXT NOT NULL | Original message ID |
| channel_id | TEXT NOT NULL | Target Slack channel |
| thread_ts | TEXT | Thread to reply in |
| response_text | TEXT NOT NULL | Claude's response |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | When response was created |
| status | TEXT DEFAULT 'pending' | pending, sending, sent, error |
| sent_at | DATETIME | When successfully sent |
| error_message | TEXT | Error details if sending failed |
| retry_count | INTEGER DEFAULT 0 | Number of send attempts |

**Indexes:**
- `idx_response_status` on `status` column for fast filtering

### 3. responded_messages
Tracks all messages the bot has responded to, preventing duplicate responses.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| message_id | TEXT UNIQUE NOT NULL | Slack message timestamp ID |
| channel_id | TEXT NOT NULL | Slack channel ID |
| thread_ts | TEXT | Thread timestamp (if in thread) |
| response_text | TEXT | The response sent |
| responded_at | DATETIME DEFAULT CURRENT_TIMESTAMP | When response was sent |

**Indexes:**
- `idx_message_id` on `message_id` column for fast duplicate checking

### 4. bot_threads
Tracks threads where the bot has participated for monitoring replies.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| channel_id | TEXT NOT NULL | Slack channel ID |
| thread_ts | TEXT NOT NULL | Thread root timestamp |
| last_checked | DATETIME DEFAULT CURRENT_TIMESTAMP | Last time thread was checked |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | When bot first joined thread |

**Indexes:**
- `idx_thread` on `(channel_id, thread_ts)` for fast thread lookups
- **Unique constraint** on `(channel_id, thread_ts)`

### 5. bot_responses
Stores the bot's own messages to prevent self-responses.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-incrementing ID |
| channel_id | TEXT NOT NULL | Slack channel ID |
| thread_ts | TEXT | Thread timestamp (if in thread) |
| response_text | TEXT NOT NULL | Bot's message text |
| posted_at | DATETIME DEFAULT CURRENT_TIMESTAMP | When message was posted |

**Indexes:**
- `idx_bot_responses_time` on `posted_at DESC` for recent message lookups

## Queue Flow

```
Slack API → message_queue → Claude Processing → response_queue → Slack API
```

1. **Fetch Phase**: Messages from Slack are stored in `message_queue` with status='pending'
2. **Process Phase**: Claude processes messages, updates status='processed', creates entries in `response_queue`
3. **Send Phase**: Responses are sent to Slack, status updated to 'sent'

## Status Values

### message_queue statuses:
- `pending` - Awaiting processing
- `processing` - Currently being processed by Claude
- `processed` - Successfully processed
- `error` - Processing failed

### response_queue statuses:
- `pending` - Awaiting send
- `sending` - Currently being sent
- `sent` - Successfully sent
- `error` - Send failed (will retry)

## Common Queries

### Get pending messages to process:
```sql
SELECT * FROM message_queue 
WHERE status = 'pending' 
ORDER BY fetched_at ASC 
LIMIT 10;
```

### Get pending responses to send:
```sql
SELECT * FROM response_queue 
WHERE status = 'pending' 
ORDER BY created_at ASC 
LIMIT 20;
```

### Check if message was already responded to:
```sql
SELECT 1 FROM responded_messages 
WHERE message_id = ?;
```

### Get bot's active threads:
```sql
SELECT * FROM bot_threads 
WHERE last_checked < datetime('now', '-5 minutes')
ORDER BY last_checked ASC;
```

### Count queue sizes:
```sql
SELECT 
  (SELECT COUNT(*) FROM message_queue WHERE status = 'pending') as pending_messages,
  (SELECT COUNT(*) FROM response_queue WHERE status = 'pending') as pending_responses;
```

## Maintenance

### Clean old processed messages (30 days):
```sql
DELETE FROM message_queue 
WHERE status = 'processed' 
AND processed_at < datetime('now', '-30 days');
```

### Clean old sent responses (30 days):
```sql
DELETE FROM response_queue 
WHERE status = 'sent' 
AND sent_at < datetime('now', '-30 days');
```

### Reset stuck processing messages (over 10 minutes):
```sql
UPDATE message_queue 
SET status = 'pending' 
WHERE status = 'processing' 
AND processed_at < datetime('now', '-10 minutes');
```

## Database Location

- **Path**: `slack-service/data/slack-bot.db`
- **Type**: SQLite3
- **Size**: Grows with usage, typically < 100MB
- **Backup**: Recommended weekly backups of the data directory