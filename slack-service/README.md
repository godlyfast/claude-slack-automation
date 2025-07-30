# Claude Slack Service

Node.js service that handles Slack message reading and response tracking for the Claude Slack Bot.

## Architecture

This service offloads Slack API operations from Claude, reducing Claude API usage by:
- Fetching messages from Slack channels
- Tracking which messages have been responded to
- Filtering messages based on keywords and mentions
- Posting responses back to Slack
- **Caching API responses to handle rate limits**
- **Automatic retry with exponential backoff**

Claude only handles generating responses to messages.

### Caching & Rate Limiting

The service implements intelligent caching to bypass Slack API rate limits:
- **Channel List**: Cached for 5 minutes (configurable)
- **Message History**: Cached for 30 seconds (configurable)
- **Automatic Retry**: Handles rate limits with exponential backoff
- **Cache Warming**: Pre-fetches data on startup
- **Rate Limit Tracking**: Prevents hitting limits proactively

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env and add your SLACK_BOT_TOKEN
```

3. Get a Slack Token:
   
   **Option A: Bot Token (Recommended)**
   - Go to https://api.slack.com/apps
   - Create a new app or select existing
   - Go to OAuth & Permissions
   - Add bot token scopes: `channels:history`, `channels:read`, `chat:write`
   - Install to workspace and copy the Bot User OAuth Token (xoxb-)
   
   **Option B: User Token (From Claude MCP)**
   - The service can also use user tokens (xoxp-) from Claude's MCP config
   - User tokens have broader permissions but may have different rate limits
   - The service automatically detects and handles both token types

## Running the Service

```bash
# Development
npm run dev

# Production
npm start
```

The service runs on port 3030 by default (configurable via PORT env var).

## API Endpoints

### GET /health
Health check endpoint

### GET /messages/unresponded
Get all unresponded messages that match configured keywords

Response:
```json
{
  "success": true,
  "count": 2,
  "messages": [
    {
      "id": "channel-timestamp",
      "channel": "#general",
      "ts": "1234567890.123456",
      "thread_ts": "1234567890.123456",
      "text": "Message text",
      "user": "U123456",
      "mentions": ["U789012"]
    }
  ]
}
```

### POST /messages/respond
Post a response to a message

Request:
```json
{
  "message": {
    "id": "channel-timestamp",
    "channel": "#general",
    "thread_ts": "1234567890.123456"
  },
  "response": "Response text"
}
```

### GET /messages/responded?limit=100
Get history of responded messages

### GET /cache/stats
Get cache statistics including hit rate and memory usage

Response:
```json
{
  "success": true,
  "stats": {
    "hits": 150,
    "misses": 20,
    "sets": 50,
    "deletes": 5,
    "rateLimitsSaved": 130,
    "hitRate": "88.24%",
    "size": 12,
    "estimatedMemoryMB": "0.45"
  }
}
```

### POST /cache/clear
Clear all cached data

### POST /cache/warm
Pre-fetch channel list and recent messages to warm up the cache

## Configuration

### Environment Variables

```bash
# Cache Configuration
CHANNEL_CACHE_TTL=300    # Channel list cache TTL in seconds (default: 300)
MESSAGE_CACHE_TTL=30     # Message cache TTL in seconds (default: 30)
CACHE_ENABLED=true       # Enable/disable caching (default: true)
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Database

Uses SQLite to track responded messages. Database file is created at `data/slack-bot.db`.

## Integration with Shell Script

The modified `claude_slack_bot.sh` script:
1. Checks if this service is running
2. Starts it if needed
3. Fetches unresponded messages via API
4. Passes each message to Claude for response generation
5. Posts responses back through the service API