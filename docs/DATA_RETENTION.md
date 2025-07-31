# Data Retention Policy

## Important: All Messages Are Preserved

This bot **NEVER deletes any messages** from the database. All data is preserved for:

1. **Historical Context** - Past conversations can be used as context for better responses
2. **Audit Trail** - Complete record of all bot interactions
3. **Learning** - Analyze patterns and improve responses over time
4. **Debugging** - Investigate issues with full message history

## Database Tables and Their Purpose

### `responded_messages`
- Tracks which messages the bot has already responded to
- Prevents duplicate responses
- **Data is NEVER deleted**

### `message_queue`
- Stores messages fetched from Slack for processing
- Status changes from `pending` → `processing` → `processed`
- **Messages remain in queue forever** with their final status

### `response_queue`
- Stores Claude's responses waiting to be sent to Slack
- Status changes from `pending` → `sending` → `sent`
- **All responses are preserved** with delivery status

### `bot_threads`
- Tracks threads where bot has participated
- Used for following ongoing conversations
- **Thread history is maintained permanently**

### `bot_responses`
- Records bot's own messages to prevent self-replies
- Used for loop prevention
- **All bot responses are kept**

## Benefits of Full Data Retention

1. **Context-Aware Responses**: Bot can reference previous conversations
2. **Consistent Behavior**: Bot knows what it has already answered
3. **Analytics Ready**: Full data available for analysis
4. **Compliance**: Complete audit trail for compliance requirements
5. **Debugging**: Can trace any issue back through full history

## Database Growth Management

While messages are never deleted, the database uses efficient SQLite storage:
- Text compression
- Indexed lookups for performance
- Typical message is only ~1KB
- 100,000 messages ≈ 100MB

## Backup Recommendations

Since all data is preserved:
1. Regular backups are important
2. Database location: `slack-service/data/slack-bot.db`
3. Simple backup: `cp slack-service/data/slack-bot.db backups/slack-bot-$(date +%Y%m%d).db`

## Using Historical Data

The preserved messages can be used for:
- Training better prompts
- Understanding user patterns
- Measuring bot effectiveness
- Compliance reporting
- Context for future conversations

## Privacy Considerations

Since all data is retained:
- Ensure database file has appropriate permissions
- Consider encryption for sensitive environments
- Follow your organization's data retention policies
- The bot respects Slack's data and complies with workspace policies