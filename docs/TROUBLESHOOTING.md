# 🔧 Troubleshooting Guide

## Common Issues and Solutions

### 🤖 LLM Integration Issues

#### LLM not responding / "Error generating response"
- Check LLM provider configuration in config.env
- Verify API key is set for your provider:
  - Google: `GOOGLE_API_KEY`
  - Anthropic: `ANTHROPIC_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
- Check logs for specific errors: `tail -f logs/slack-service.log | grep -i error`
- For Google: Ensure `@google/generative-ai` npm package is installed

#### Claude command not found (if using claude-code provider)
- Set `LLM_PROVIDER="claude-code"` in config.env
- Ensure Claude Code is installed: `which claude`
- Check that Claude Code is in your PATH
- Try running with full path: `/usr/local/bin/claude`
- Test CLI directly: `echo "Hello" | claude`

#### LLM timeout errors
- Normal for complex queries - bot posts helpful message
- Increase timeout in config.env: `CLAUDE_TIMEOUT=900`
- Check network connectivity to LLM provider

### 🔴 Service Not Starting

#### Node.js service won't start
- Check if port is in use: `lsof -i :${SERVICE_PORT}`
- Verify SLACK_BOT_TOKEN in config.env
- Check logs: `tail -f slack-service/logs/error.log`
- Try different port: `SERVICE_PORT=3031` in config.env

#### Permission errors
- Ensure execute permissions: `chmod +x *.sh`
- Check database write permissions: `chmod 755 slack-service/data/`
- macOS: Ensure Terminal has Full Disk Access

### 📡 Slack Connection Issues

#### No messages found
- Verify bot has access to channels
- Ensure user is member of private channels
- Check SLACK_BOT_TOKEN is a user token (xoxp-), not bot token (xoxb-)
- Verify channel names include # in config.env

#### Messages appear as bot messages
- Normal for MCP integration - service handles this correctly
- Bot filters its own messages automatically

#### MCP messages not being processed
- Verify MCP bot_id (B097ML1T6DQ) is allowed in slack-service.js
- Check that user info can be fetched for the MCP user
- Look for "Processing MCP message" in logs
- Ensure trigger keywords are present in the MCP message

#### Rate limit errors
- Normal behavior - wait 60 seconds between API calls
- Check rate limiter status: `curl ${SERVICE_URL}/rate-limit/status`
- See [PERFORMANCE.md](./PERFORMANCE.md) for rate limit strategies

### 🤖 Bot Not Responding

#### Bot sees messages but doesn't respond
- Check trigger keywords in config.env match message content
- Verify RESPONSE_MODE setting ("all" or "mentions")
- Check Claude is working: `echo "test" | claude`
- Review logs for errors: `tail -f logs/claude_slack_bot_errors.log`

#### Duplicate responses
- Database might be corrupted - check: `sqlite3 slack-service/data/slack-bot.db "PRAGMA integrity_check;"`
- Clear responded messages table if needed (last resort)

#### Bot stuck in loop
- Emergency stop: `pkill -f queue_operations.sh`
- Check loop prevention: `curl ${SERVICE_URL}/loop-prevention/status`
- Reset if needed: `curl -X POST ${SERVICE_URL}/loop-prevention/reset`

### 🗄️ Database Issues

#### Database locked errors
```bash
# Check for stuck processes
ps aux | grep sqlite

# Kill stuck processes
pkill -f sqlite3

# Check database integrity
sqlite3 slack-service/data/slack-bot.db "PRAGMA integrity_check;"
```

#### "invalid_thread_ts" errors
- Check response queue is using message_id not database row ID
- Verify in api.js: `message.message_id` not `message.id` for thread_ts
- Clear error responses: `sqlite3 slack-service/data/slack-bot.db "DELETE FROM response_queue WHERE error_message LIKE '%invalid_thread_ts%';"`

#### User ID stored as "[object Object]"
- Verify db.js extracts user.id from user object
- Check message queue entries: `sqlite3 slack-service/data/slack-bot.db "SELECT * FROM message_queue ORDER BY fetched_at DESC LIMIT 5;"`
- Fix: Update db.js to use `message.user.id || message.user`

#### Database growing too large
- Normal - bot preserves all messages
- Backup and start fresh if needed
- See [ARCHITECTURE.md](./ARCHITECTURE.md#data-retention) for retention policy

### 🎯 Daemon/LaunchAgent Issues

#### LaunchAgent not running (macOS)
```bash
# Check if loaded
launchctl list | grep claude

# Check logs
tail -f ~/Library/Logs/com.claude.slackbot.*.log

# Reload
launchctl unload ~/Library/LaunchAgents/com.claude.slackbot.plist
launchctl load ~/Library/LaunchAgents/com.claude.slackbot.plist
```

#### Daemon not starting
```bash
# Check if already running
./daemon_control.sh status

# Check for stale PID files
rm -f logs/*_daemon.pid

# Start with verbose logging
DEBUG=true ./daemon_control.sh start
```

### 🐛 Debugging Steps

1. **Check service health**
   ```bash
   curl ${SERVICE_URL}/health
   ```

2. **View recent logs**
   ```bash
   # Main bot log
   tail -f logs/claude_slack_bot.log
   
   # Error log
   tail -f logs/claude_slack_bot_errors.log
   
   # Service log
   tail -f slack-service/logs/combined.log
   ```

3. **Test individual components**
   ```bash
   # Test Slack connection
   curl ${SERVICE_URL}/messages/unresponded
   
   # Test database
   curl ${SERVICE_URL}/messages/responded?limit=1
   
   # Test Claude
   echo "Say hello" | claude
   ```

4. **Run integration test**
   ```bash
   ./test_integration_simple.sh
   ```

### 🚨 Emergency Recovery

#### Complete reset (last resort)
```bash
# Stop everything
./bot_control.sh stop
pkill -f queue_operations.sh
pkill -f node

# Backup data
cp -r slack-service/data slack-service/data.backup

# Clear queues
sqlite3 slack-service/data/slack-bot.db "DELETE FROM message_queue; DELETE FROM response_queue;"

# Restart
./bot_control.sh start
```

#### Restore from backup
```bash
# Stop services
./bot_control.sh stop

# Restore backup
cp slack-service/data.backup/slack-bot.db slack-service/data/

# Restart
./bot_control.sh start
```

### 🧪 Integration Test Issues

#### Full integration test fails with "Too many recent test messages"
- The test detects previous test messages in the channel
- Test messages have [TEST:] prefix to prevent bot responses
- Solution options:
  1. Wait 60+ minutes for messages to fall outside CHECK_WINDOW
  2. Manually delete test messages from Slack channel
  3. Use `./test_integration_safe.sh` instead (doesn't post messages)
  4. Run `./test_integration_cleanup.sh` to check test message status

#### Test shows "Claude CLI not responding"
- Normal in test environment - Claude might timeout
- Verify manually: `echo "hello" | claude`
- The bot will still work even if test shows timeout

## Getting Help

1. **Check logs first** - Most issues are explained in error logs
2. **Run integration test** - Identifies configuration problems  
3. **Review configuration** - Ensure config.env is correct
4. **Check documentation** - See [README.md](../README.md) for setup

## Monitoring Health

Regular health checks:
```bash
# Quick health check
./bot_control.sh status

# Detailed monitoring
watch -n 60 'curl -s ${SERVICE_URL}/health | jq'

# Queue monitoring
watch -n 30 './queue_operations.sh status'
```