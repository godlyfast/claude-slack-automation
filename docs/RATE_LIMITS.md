# ⏱️ Slack Rate Limits Guide

## 🚨 2025 Rate Limit Changes

As of May 29, 2025, Slack enforces strict limits for non-marketplace apps:
- **1 API call per minute** (down from Tier 3)
- **15 messages max per request**
- **Affects**: conversations.history, conversations.replies

## 🌐 Global Rate Limiter Implementation

The bot now includes a **strict global rate limiter** that ensures:
- ⚠️ **Maximum 1 Slack API call per minute across ALL operations**
- 🕒 Automatic queuing and waiting for the next available slot
- 📊 Real-time tracking of API usage and wait times
- 🔒 Thread-safe implementation prevents race conditions

## 📊 Impact Analysis

| Channels | Check Time | Response Delay |
|----------|------------|----------------|
| 1 | 1 minute | 0-1 minute |
| 2 | 2 minutes | 0-2 minutes |
| 5 | 5 minutes | 0-5 minutes |

## 🛠️ Implemented Solutions

### 1. Smart Bot (`claude_slack_bot.sh`)
- Checks ONE channel per minute
- Rotates through channels
- Tracks which channel to check next
- Falls back to Playwright if rate limited

### 2. Rate Limiter (`utils/rate_limiter.sh`)
```bash
# Check if API call allowed
./utils/rate_limiter.sh check

# Wait if rate limited
./utils/rate_limiter.sh wait

# Reset tracker
./utils/rate_limiter.sh reset
```

### 3. Playwright Fallback
When rate limited, use web scraping:
```bash
./utils/playwright_slack_monitor.sh
```
- NO API limits
- Reads messages from web interface
- Requires browser session

## 🎯 Configuration

In `config.env`:
```bash
# Rate Limit Settings
RATE_LIMIT_MODE="strict"          # Enforce 1/min limit
USE_PLAYWRIGHT_FALLBACK=true      # Use web scraping
CHANNEL_PRIORITY_MODE=true        # Smart channel selection
API_CALLS_PER_MINUTE=1           # Slack's limit
MAX_MESSAGES=15                  # Per request limit
```

## 📈 Optimization Strategies

### Channel Rotation
Bot automatically rotates through channels:
```
Minute 1: #ai-sales-assistant
Minute 2: #ceo-staff
Minute 3: #ai-sales-assistant (repeat)
```

### Memory Persistence
- Tracks responded messages
- Avoids duplicate work
- Maintains context between runs

### Hybrid Approach
1. **Normal**: Use API with rate limits
2. **Fallback**: Switch to Playwright
3. **Emergency**: Queue messages for later

## 🎯 Global Rate Limiter Features

### How It Works
1. **Before any API call**: System checks if 60 seconds have passed since last call
2. **If too soon**: Automatically waits until the next slot is available
3. **After API call**: Records timestamp for next rate limit check
4. **Persistent state**: Survives restarts, tracks usage across all processes

### API Endpoints
```bash
# Check current rate limit status
curl http://localhost:3030/rate-limit/status | jq

# Reset rate limiter (emergency use only)
curl -X POST http://localhost:3030/rate-limit/reset
```

### Rate Limit Status Response
```json
{
  "totalCalls": 42,
  "blockedCalls": 5,
  "lastApiCall": "2025-01-15T10:30:00.000Z",
  "nextCallAllowedIn": 45,
  "canCallNow": false
}
```

## 🚀 Future Solutions

### 1. Marketplace Approval
- Submit app for approval
- Get higher rate limits
- Timeline: 2-4 weeks

### 2. Events API
- Real-time message delivery
- No polling needed
- Requires webhook endpoint

### 3. Slack RTM
- WebSocket connection
- Deprecated but functional
- No rate limits

## 📊 Monitoring

Check rate limit status:
```bash
# View logs
tail -f logs/rate_limit.log

# Check last API call
cat .rate_limit_tracker

# Monitor bot activity
tail -f logs/claude_slack_bot.log
```

## 🔧 Troubleshooting

### "Rate limited" errors
- Normal behavior - wait 60 seconds
- Check `rate_limiter.sh` status
- Verify Playwright fallback is enabled

### Bot missing messages
- Due to rotation, may take 2-3 minutes
- Active channels checked more frequently
- Consider Playwright mode for real-time

### Need faster responses
- Use Playwright mode exclusively
- Apply for Marketplace approval
- Implement Events API

## 💡 Best Practices

1. **Set expectations**: Tell users about 1-3 minute delays
2. **Use triggers wisely**: Only essential keywords
3. **Monitor actively**: Check logs regularly
4. **Plan ahead**: Apply for Marketplace early