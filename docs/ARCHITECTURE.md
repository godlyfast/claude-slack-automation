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