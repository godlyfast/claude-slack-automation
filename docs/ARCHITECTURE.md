# System Architecture

## 🚨 CRITICAL: Claude Isolation Principle

**NEVER CHANGE THIS ARCHITECTURE**: Claude must ALWAYS be completely isolated from the Slack API.

### The Three-Layer Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Slack API     │────▶│    Database     │────▶│     Claude      │
│                 │     │  (SQLite Queue) │     │   (Read Only)   │
│                 │◀────│                 │◀────│  (Write Only)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     Layer 1                  Layer 2                 Layer 3
```

### Strict Separation Rules

1. **Claude MUST**:
   - ✅ Read messages from the database message_queue
   - ✅ Write responses to the database response_queue
   - ✅ Process with channel history fetched by Node.js service
   - ❌ NEVER make direct Slack API calls
   - ❌ NEVER have access to Slack tokens or credentials
   - ❌ NEVER use Slack MCP tools

2. **Node.js Service MUST**:
   - ✅ Handle ALL Slack API interactions
   - ✅ Fetch messages from Slack → Store in message_queue
   - ✅ Read responses from response_queue → Send to Slack
   - ✅ Pre-fetch channel history for Claude's context

3. **Database Queues**:
   - `message_queue`: Slack messages waiting for Claude processing
   - `response_queue`: Claude responses waiting to be sent to Slack
   - See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for complete database structure

### The Flow

```
1. FETCH:   Slack API ──────▶ message_queue (DB)
2. PROCESS: message_queue ──▶ Claude ──▶ response_queue (DB)
3. SEND:    response_queue ──▶ Slack API
```

### Key Endpoints

- `/messages/process-with-claude`: Processes messages WITH channel history
- `/queue/send-responses`: Sends responses from queue to Slack
- ❌ DO NOT USE `/queue/process` - it lacks channel history

### Why This Architecture?

1. **Security**: Claude never has access to Slack credentials
2. **Reliability**: Failed operations can be retried from queues
3. **Efficiency**: Reduces Claude API usage by 90%+
4. **Scalability**: Each layer can scale independently
5. **Testability**: Each component can be tested in isolation

### Critical Rules for Channel History

**NEVER fetch channel history from Slack API when processing messages!**

Channel history for Claude MUST come from the database:
- ✅ Use `db.getChannelHistoryFromDB()` 
- ❌ NEVER use `slackService.getChannelHistory()` for Claude
- ❌ NEVER make Slack API calls during message processing

This is critical because:
1. Reduces Slack API calls by 90%+
2. Prevents rate limiting during processing
3. Uses already-fetched messages from the database
4. Maintains the core efficiency principle of the architecture

### Implementation Details

#### claude-service.js
```javascript
// Claude is spawned with NO arguments - no Slack tools available
const claude = spawn('claude', [], {
  timeout: timeoutMs,
  killSignal: 'SIGTERM'
});
```

#### api.js - Process Endpoint
```javascript
// Correct: Fetches channel history, processes, queues response
app.post('/messages/process-with-claude', async (req, res) => {
  // 1. Get messages from DB
  // 2. Fetch channel history from Slack
  // 3. Process with Claude
  // 4. Queue response in DB (NOT send to Slack)
});
```

#### queue_operations.sh
```bash
# MUST use the endpoint with channel history
"${SERVICE_URL}/messages/process-with-claude"
# NOT "${SERVICE_URL}/queue/process" ❌
```

## 🛑 WARNING: Breaking Changes

ANY change that allows Claude direct Slack API access will:
- Break the security model
- Increase API costs dramatically
- Create potential for infinite loops
- Violate the architectural principles

**If you need to modify this flow, STOP and reconsider.**

## Testing the Separation

To verify Claude's isolation:
1. Check Claude spawn command has no arguments
2. Verify no Slack tokens in Claude's environment
3. Ensure all Slack operations go through Node.js service
4. Monitor that Claude only reads/writes to database queues

## Queue-Based Architecture Details

The bot uses a queue-based architecture that separates Slack API operations from Claude processing, providing resilience against rate limits and allowing each component to operate independently.

### Queue Components

#### 1. Message Fetcher
- Fetches unresponded messages from Slack
- Stores them in the `message_queue` table  
- Can be rate limited without affecting processing

#### 2. Claude Processor
- Reads messages from the database queue (no Slack API calls)
- Processes messages with Claude using pre-fetched context
- Stores responses in the `response_queue` table

#### 3. Response Sender
- Reads responses from the database queue
- Sends responses to Slack as thread replies
- Handles rate limit errors by marking messages for retry

### Queue Operations

```bash
# Fetch messages from Slack (when API is available)
./queue_operations.sh fetch

# Process messages with Claude (no Slack API needed)
./queue_operations.sh process [batch_size]

# Send responses to Slack (when API is available)
./queue_operations.sh send [batch_size]

# Priority mode: Send first, then fetch if no pending responses
./queue_operations.sh priority

# Check queue status
./queue_operations.sh status
```

### Benefits of Queue Architecture

1. **Rate Limit Resilience**: Operations continue even when Slack API is rate limited
2. **Parallel Processing**: Multiple messages processed simultaneously
3. **Independent Operations**: Each stage can run on its own schedule
4. **Error Recovery**: Failed operations can be retried without data loss
5. **Scalability**: Batch sizes can be adjusted based on load
6. **Priority System**: Sending responses always takes priority over fetching

### Daemon Architecture

The bot uses a daemon process for continuous operation:

```bash
# Start daemon
./daemon_control.sh start

# Check status
./daemon_control.sh status

# View logs
./daemon_control.sh logs

# Stop daemon
./daemon_control.sh stop
```

The process daemon runs every 60 seconds and handles fetch, process, and send operations through queue_operations.sh.

### Queue Monitoring

Check queue and system status:
```bash
# Queue status
./queue_operations.sh status

# API endpoints for monitoring
curl ${SERVICE_URL}/queue/messages/pending
curl ${SERVICE_URL}/queue/responses/pending
```

## Data Retention and Database Design

### Important: All Messages Are Preserved

This bot **NEVER deletes any messages** from the database. All data is preserved for:

1. **Historical Context** - Past conversations can be used as context for better responses
2. **Audit Trail** - Complete record of all bot interactions
3. **Debugging** - Investigate issues with full message history
4. **Analytics** - Analyze patterns and improve responses over time

### Database Tables

- **`responded_messages`**: Tracks which messages the bot has already responded to
- **`message_queue`**: Stores messages fetched from Slack for processing  
- **`response_queue`**: Stores Claude's responses waiting to be sent
- **`bot_threads`**: Tracks threads where bot has participated
- **`bot_responses`**: Records bot's own messages for loop prevention

All tables preserve data permanently with status tracking. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for complete schema details.

### Database Growth Management

While messages are never deleted, SQLite provides efficient storage:
- Text compression and indexed lookups
- Typical message is only ~1KB  
- 100,000 messages ≈ 100MB

### Backup Recommendations

```bash
# Simple backup
cp slack-service/data/slack-bot.db backups/slack-bot-$(date +%Y%m%d).db
```