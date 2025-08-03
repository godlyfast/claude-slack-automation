# 🔧 Troubleshooting Guide

## Common Issues and Solutions

### 🤖 LLM Integration Issues

#### LLM not responding / "Error generating response"
- Check LLM provider configuration in `config.env`.
- Verify API key is set for your provider:
  - Google: `GOOGLE_API_KEY`
  - Anthropic: `ANTHROPIC_API_KEY`
  - OpenAI: `OPENAI_API_KEY`
- Check logs for specific errors: `docker-compose logs --tail=100 app | grep -i error`
- For Google: Ensure `@google/generative-ai` npm package is installed.

#### LLM timeout errors
- This can be normal for complex queries. The bot should post a helpful message.
- Increase the timeout in `config.env`: `LLM_TIMEOUT=90` (in seconds).
- Check network connectivity from the container to the LLM provider.

### 🔴 Service Not Starting

#### Node.js service won't start
- Check if the port is in use: `lsof -i :3030`.
- Verify `SLACK_BOT_TOKEN` in `config.env`.
- Check logs for startup errors: `docker-compose logs --tail=100 app`.
- Try a different port by changing `ports` in `docker-compose.yml` and updating `SERVICE_PORT` in `config.env`.

#### Permission errors
- Check database write permissions if running locally without Docker. The `data` directory inside `slack-service` should be writable.

### 📡 Slack Connection Issues

#### No messages found
- Verify the bot has been invited to the channels it should be in.
- Ensure the `SLACK_BOT_TOKEN` is a user token (`xoxp-`), not a bot token (`xoxb-`), if you need it to read messages in channels it's not explicitly mentioned in.
- Verify the channel names in `config.env` are correct.

#### Rate limit errors
- The application has a built-in global rate limiter.
- Check the rate limiter status: `curl http://localhost:3030/rate-limit/status`.
- See `docs/PERFORMANCE.md` for more details on rate limiting.

### 🤖 Bot Not Responding

#### Bot sees messages but doesn't respond
- Check the trigger keywords in `config.env` match the message content.
- Verify the `RESPONSE_MODE` setting (`all` or `mentions`).
- Review logs for processing errors: `docker-compose logs --tail=100 app`.

#### Duplicate responses
- This could indicate a database issue. Check the integrity: `docker-compose exec app sqlite3 /usr/src/app/data/slack-bot.db "PRAGMA integrity_check;"`.
- As a last resort, clear the `responded_messages` table.

#### Bot stuck in a loop
- The new orchestrator design significantly reduces the risk of loops.
- If you suspect an issue, stop the service: `docker-compose down`.
- Check the `loop-prevention.js` logic if you suspect a bug.

### 🗄️ Database Issues

#### Database locked errors
- This is less likely with the unified service but can happen if multiple processes access the database.
- Stop the service: `docker-compose down`.
- Check database integrity as shown above.

#### "invalid_thread_ts" errors
- This was an issue in older versions. The current `api.js` should be using `message.message_id` for `thread_ts`.
- If this error reappears, check the `response_queue` in the database.

### 🐛 Debugging Steps

1.  **Check service health**
    ```bash
    curl http://localhost:3030/health
    ```

2.  **View recent logs**
    ```bash
    # View logs for the running service
    docker-compose logs --tail=100 app

    # Follow logs in real-time
    docker-compose logs -f app
    ```

3.  **Test individual components via API**
    ```bash
    # Test Slack connection and fetch unresponded messages
    curl http://localhost:3030/messages/unresponded

    # Test database by fetching responded messages
    curl http://localhost:3030/messages/responded?limit=1
    ```

4.  **Run integration tests**
    ```bash
    npm run test:e2e
    ```

### 🚨 Emergency Recovery

#### Complete reset (last resort)
```bash
# Stop everything
docker-compose down

# Backup data
mv slack-service/data slack-service/data.backup

# Restart the service (a new database will be created)
docker-compose up -d
```

#### Restore from backup
```bash
# Stop the service
docker-compose down

# Restore the backup
rm -rf slack-service/data
mv slack-service/data.backup slack-service/data

# Restart
docker-compose up -d
```

## Getting Help

1.  **Check logs first** - Most issues are explained in the service logs.
2.  **Run integration tests** - These can identify configuration problems.
3.  **Review configuration** - Ensure `config.env` is correct.
4.  **Check documentation** - See `README.md` for setup instructions.

## Monitoring Health

Regular health checks:
```bash
# Quick health check
docker-compose ps

# Detailed monitoring of the API
watch -n 60 'curl -s http://localhost:3030/health | jq'

# Monitor the orchestrator status via API
watch -n 30 'curl -s http://localhost:3030/orchestrator/status | jq'