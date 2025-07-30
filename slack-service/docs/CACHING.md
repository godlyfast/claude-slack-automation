# Caching & Rate Limiting Implementation

This document describes the caching and rate limiting implementation in the Claude Slack Service.

## Overview

The service implements intelligent caching to handle Slack API rate limits gracefully, reducing API calls by up to 90% during normal operation.

## Features

### 1. In-Memory Cache
- **TTL Support**: Each cached item has a configurable time-to-live
- **Automatic Cleanup**: Expired entries are cleaned up periodically
- **Statistics Tracking**: Hit rate, memory usage, and rate limits saved

### 2. Rate Limiter
- **Automatic Retry**: Handles rate limits with exponential backoff
- **Request Tracking**: Monitors request counts per endpoint
- **Retry-After Handling**: Respects Slack's retry-after headers

### 3. Cached Endpoints
- **Channel List** (`conversations.list`): Cached for 5 minutes
- **Message History** (`conversations.history`): Cached for 30 seconds
- **Smart Invalidation**: Cache keys include timestamps for proper invalidation

## Configuration

Environment variables in `.env`:

```bash
# Channel list cache TTL in seconds (default: 300)
CHANNEL_CACHE_TTL=300

# Message cache TTL in seconds (default: 30)
MESSAGE_CACHE_TTL=30

# Enable/disable caching (default: true)
CACHE_ENABLED=true
```

## API Endpoints

### GET /cache/stats
Returns cache statistics:
```json
{
  "hits": 150,
  "misses": 20,
  "hitRate": "88.24%",
  "rateLimitsSaved": 130,
  "size": 12,
  "estimatedMemoryMB": "0.45"
}
```

### POST /cache/clear
Clears all cached data

### POST /cache/warm
Pre-fetches channel list and recent messages

## How It Works

1. **Request Flow**:
   ```
   Request → Check Cache → Hit? → Return Cached Data
                    ↓
                   Miss → Check Rate Limit → Make API Call → Cache Response
   ```

2. **Rate Limit Handling**:
   - When rate limited, the service waits the specified time
   - Uses exponential backoff for other errors
   - Maximum 3 retries per request

3. **Cache Keys**:
   - Channel List: `channels:list`
   - Messages: `messages:{channelId}:{sinceTimestamp}`

## Benefits

1. **Reduced API Calls**: ~90% reduction during normal operation
2. **Faster Response Times**: Cached responses return instantly
3. **Rate Limit Protection**: Automatic handling prevents service disruption
4. **Cost Savings**: Fewer API calls = lower usage costs

## Monitoring

The service logs cache performance:
```
info: Using cached channel list
info: Cache hit for key: channels:list
info: Rate limited on conversations.history, waiting 60s
```

Check cache performance:
```bash
curl http://localhost:3030/cache/stats
```

## Best Practices

1. **Cache Warming**: The service warms the cache on startup
2. **TTL Tuning**: Adjust TTLs based on your usage patterns
3. **Monitoring**: Check cache stats regularly to ensure good hit rates
4. **Memory Usage**: Monitor memory usage for high-traffic environments

## Troubleshooting

### Low Hit Rate
- Increase cache TTLs if data doesn't change frequently
- Check if cache is enabled in configuration

### High Memory Usage
- Reduce cache TTLs
- Clear cache periodically with `/cache/clear`

### Rate Limits Still Occurring
- Check if cache is working (`/cache/stats`)
- Ensure message cache TTL isn't too low
- Consider increasing channel cache TTL