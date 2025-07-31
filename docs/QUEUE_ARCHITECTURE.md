# Queue-Based Architecture Documentation

## Overview

The bot now uses a queue-based architecture that separates Slack API operations from Claude processing. This provides resilience against rate limits and allows each component to operate independently.

## Architecture Components

### 1. Message Fetcher
- Fetches unresponded messages from Slack
- Stores them in the `message_queue` table
- Can be rate limited without affecting processing

### 2. Claude Processor
- Reads messages from the database queue (no Slack API calls)
- Processes multiple messages in parallel with Claude
- Stores responses in the `response_queue` table

### 3. Response Sender
- Reads responses from the database queue
- Sends multiple responses to Slack in parallel
- Handles rate limit errors by marking messages for retry

## Database Schema

### message_queue
```sql
CREATE TABLE message_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  thread_ts TEXT,
  user_id TEXT,
  text TEXT,
  has_attachments BOOLEAN DEFAULT 0,
  file_paths TEXT, -- JSON array
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending', -- pending, processing, processed, error
  processed_at DATETIME,
  error_message TEXT
)
```

### response_queue
```sql
CREATE TABLE response_queue (
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
```

## Usage

### Command Line Interface

```bash
# Fetch messages from Slack (when API is available)
./queue_operations.sh fetch

# Process messages with Claude (no Slack API needed)
./queue_operations.sh process [batch_size]

# Send responses to Slack (when API is available)
./queue_operations.sh send [batch_size]

# Check queue status
./queue_operations.sh status

# Run all operations
./queue_operations.sh all [batch_size]
```

### Examples

```bash
# Process 10 messages in parallel
./queue_operations.sh process 10

# Send 20 responses in parallel
./queue_operations.sh send 20
```

## API Endpoints

### POST /queue/messages
Fetches unresponded messages from Slack and queues them.

### GET /queue/messages/pending
Returns pending messages from the queue.

### POST /queue/process
Processes queued messages with Claude in parallel.
- Body: `{"batchSize": 10}` (optional, default: 5)

### POST /queue/send-responses
Sends queued responses to Slack in parallel.
- Body: `{"batchSize": 10}` (optional, default: 5)

## Benefits

1. **Rate Limit Resilience**: Operations continue even when Slack API is rate limited
2. **Parallel Processing**: Multiple messages processed simultaneously
3. **Independent Operations**: Each stage can run on its own schedule
4. **Error Recovery**: Failed operations can be retried without data loss
5. **Scalability**: Batch sizes can be adjusted based on load
6. **Priority System**: Sending responses always takes priority over fetching new messages

## Daemon Architecture

The bot uses daemon processes for continuous operation instead of cron:

### Starting Daemons

```bash
# Start all daemons
./daemon_control.sh start

# Start specific daemon
./daemon_control.sh start send

# Check daemon status
./daemon_control.sh status

# View daemon logs
./daemon_control.sh logs send
./daemon_control.sh logs all
```

### Daemon Configuration

| Daemon | Interval | Priority | Purpose |
|--------|----------|----------|----------|
| send | 30 seconds | HIGH | Sends responses to Slack |
| process | 60 seconds | MEDIUM | Processes messages with Claude |
| fetch | 3 minutes | LOW | Fetches new messages from Slack |
| priority | 45 seconds | ADAPTIVE | Sends first, fetches only if needed |

### Benefits of Daemons

1. **Better Control**: Start/stop/restart individual operations
2. **Graceful Shutdown**: Daemons handle SIGTERM for clean stops
3. **Error Recovery**: Automatic retry with error counting
4. **Continuous Logs**: Dedicated log file per daemon
5. **No Cron Overhead**: More efficient than cron jobs

## Monitoring

Check daemon and queue status:
```bash
# Daemon status
./daemon_control.sh status

# Queue status
./queue_operations.sh status

# Combined status
./bot_control.sh status
```

View logs:
```bash
# Daemon logs
tail -f logs/send_daemon.log      # Send daemon (high priority)
tail -f logs/process_daemon.log   # Process daemon
tail -f logs/fetch_daemon.log     # Fetch daemon

# All daemon logs
./daemon_control.sh logs all

# Service logs
tail -f logs/slack-service.log
```

## Troubleshooting

### Messages not being fetched
- Check Slack API rate limits in logs
- Verify bot has access to channels
- Ensure SLACK_BOT_TOKEN is valid

### Messages not processing
- Check Claude availability
- Verify Claude CLI is installed
- Check for errors in message_queue table

### Responses not sending
- Check Slack API rate limits
- Verify channel permissions
- Check response_queue for error messages