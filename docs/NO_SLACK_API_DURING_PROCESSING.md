# 🚨 CRITICAL: NO SLACK API CALLS DURING PROCESSING

## The Three Phases of Message Handling

### 1. FETCH Phase (Slack API ALLOWED)
- **Purpose**: Get new messages from Slack
- **Slack API Calls**: ✅ ALLOWED
  - `conversations.history` - Get channel messages
  - `conversations.list` - Find channel IDs
  - File downloads - Download attachments via HTTP with Slack token
- **Output**: Messages stored in `message_queue` table with file paths

### 2. PROCESS Phase (Slack API FORBIDDEN)
- **Purpose**: Process messages with Claude
- **Slack API Calls**: ❌ ABSOLUTELY FORBIDDEN
- **Data Sources**: 
  - ✅ Database ONLY (`message_queue` table)
  - ✅ Channel history from DB (`getChannelHistoryFromDB`)
  - ✅ File paths from DB (already downloaded)
- **Output**: Responses stored in `response_queue` table

### 3. SEND Phase (Slack API ALLOWED)
- **Purpose**: Send responses back to Slack
- **Slack API Calls**: ✅ ALLOWED
  - `chat.postMessage` - Send responses
- **Input**: Responses from `response_queue` table

## Complete Flow Analysis

### `/messages/process-with-claude` endpoint MUST:
1. ✅ Read messages from database (`getPendingMessages`)
2. ✅ Get channel history from database (`getChannelHistoryFromDB`)
3. ✅ Use file paths already in database
4. ✅ Process with Claude
5. ✅ Queue response in database
6. ❌ NEVER call Slack API
7. ❌ NEVER download files
8. ❌ NEVER fetch new data from Slack

## Enforcement Checklist

### Current Status:
- [x] Channel history uses DB (`getChannelHistoryFromDB`)
- [x] Messages come from DB
- [x] File paths stored in DB during fetch
- [x] Response queued in DB
- [x] No thread fetching
- [x] Add runtime enforcement checks (`_enforceNoSlackAPI`)
- [x] Add process mode flag (`setProcessingMode`)
- [x] Integrate enforcement in API endpoints

## Why This Matters

1. **Performance**: Prevents rate limiting during processing
2. **Reliability**: Processing can retry without API calls
3. **Efficiency**: 90%+ reduction in API usage
4. **Architecture**: Maintains clean separation of concerns

## Enforcement Implementation

### How It Works:
1. **Processing Mode Flag**: `slack-service.js` has a `_processingMode` flag
2. **Enforcement Method**: `_enforceNoSlackAPI()` throws an error if called during processing
3. **API Integration**: Endpoints enable/disable processing mode with try-finally blocks
4. **Protected Methods**: All Slack API methods check enforcement before executing

### Protected Operations:
- `getChannelHistory()` - Fetching channel messages
- `_fetchChannelMessages()` - Internal message fetching
- `_getChannelInfo()` - Looking up channel information
- `postResponse()` - Sending messages to Slack
- `warmCache()` - Pre-loading channel data

## Testing for Violations

To verify no Slack API calls during processing:
1. Run `./test_enforcement.js` to verify enforcement mechanism
2. Monitor network traffic during `queue_operations.sh process`
3. Check logs for any Slack API endpoints
4. Verify processing works with network disconnected (except Claude)

## Red Flags to Watch For

If you see ANY of these during processing, it's a violation:
- URLs containing `slack.com/api/`
- Methods like `client.conversations.*`
- File download attempts
- Token usage for Slack
- Rate limit errors during processing