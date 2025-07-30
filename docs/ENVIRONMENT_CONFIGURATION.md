# Environment Configuration Guide

This guide documents all configurable environment variables for the Claude Slack Bot system.

## Configuration File

All configuration is stored in `config.env` in the project root. This file is sourced by all scripts.

## Environment Variables

### Slack Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-) for API access | - | Yes |
| `SLACK_CHANNELS` | Comma-separated list of channels to monitor | - | Yes |
| `TRIGGER_KEYWORDS` | Comma-separated keywords that trigger responses | - | Yes |
| `RESPONSE_MODE` | Response mode: "all" or "mentions" | all | No |

### Service Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SERVICE_PORT` | Port for Node.js service | 3030 | No |
| `SERVICE_HOST` | Host for Node.js service | localhost | No |
| `SERVICE_URL` | Full URL for service | http://localhost:3030 | No |
| `SERVICE_NAME` | Name for service identification | claude-slack-service | No |
| `LAUNCHAGENT_ID` | macOS LaunchAgent identifier | com.claude.slackbot | No |

### File Paths

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `LOG_DIR` | Directory for log files | logs | No |
| `DATA_DIR` | Directory for data files | slack-service/data | No |
| `TEMP_DIR` | Directory for temporary files | /tmp | No |
| `PID_FILE` | Path to daemon PID file | utils/.daemon.pid | No |
| `DATABASE_FILE` | SQLite database path | slack-service/data/slack-bot.db | No |
| `CHANNEL_STATE_FILE` | Channel state JSON file | slack-service/data/channel-state.json | No |

### API Endpoints

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `HEALTH_ENDPOINT` | Health check endpoint | /health | No |
| `UNRESPONDED_ENDPOINT` | Unresponded messages endpoint | /messages/unresponded | No |
| `RESPOND_ENDPOINT` | Response posting endpoint | /messages/respond | No |
| `CHANNEL_HISTORY_ENDPOINT` | Channel history endpoint | /messages/channel-history | No |

### Timing Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BOT_CHECK_INTERVAL` | How often to check Slack (seconds) | 60 | No |
| `API_TIMEOUT` | API request timeout (seconds) | 3 | No |
| `CLAUDE_TIMEOUT` | Claude CLI timeout (seconds) | 30 | No |
| `CACHE_TTL` | Message cache TTL (seconds) | 90 | No |
| `CACHE_MONITOR_INTERVAL` | Cache cleanup interval (seconds) | 300 | No |
| `CHECK_WINDOW` | Time window for checking messages (minutes) | 60 | No |
| `MAX_MESSAGES` | Maximum messages to check per run | 15 | No |

### Loop Prevention

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MAX_RESPONSES_PER_THREAD` | Max bot responses in a single thread | 10 | No |
| `MAX_RESPONSES_PER_USER_PER_HOUR` | Max responses per user per hour | 20 | No |
| `MAX_SIMILAR_RESPONSES` | Max similar responses before blocking | 3 | No |
| `CONVERSATION_CIRCLE_DETECTION` | Enable circle detection | true | No |
| `TRIGGER_WORD_INJECTION_PREVENTION` | Prevent trigger word injection | true | No |
| `EMERGENCY_STOP_THRESHOLD` | Max responses in 10 minutes | 20 | No |
| `LOOP_PREVENTION_MONITORING_INTERVAL` | Loop prevention check interval (minutes) | 5 | No |

### Rate Limiting

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `RATE_LIMIT_MODE` | Rate limit mode: strict/balanced/bypass | strict | No |
| `USE_PLAYWRIGHT_FALLBACK` | Use web scraping when rate limited | true | No |
| `CHANNEL_PRIORITY_MODE` | Prioritize active channels | true | No |
| `API_CALLS_PER_MINUTE` | Slack API calls per minute | 0.5 | No |

### Other Settings

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DEBUG_MODE` | Enable debug logging | true | No |
| `RESPONSE_STYLE` | Claude response style | helpful,conversational,concise | No |
| `SLACK_WORKSPACE` | Slack workspace (if multiple) | - | No |
| `RESPOND_IN_THREADS` | Respond in threads vs main channel | true | No |

## Example config.env

```bash
# Slack Configuration
SLACK_BOT_TOKEN="xoxb-your-bot-token"
SLACK_CHANNELS="#general,#support,#ai-help"
TRIGGER_KEYWORDS="AI,help,question"
RESPONSE_MODE="all"

# Service Configuration
SERVICE_PORT=3030
SERVICE_HOST=localhost
SERVICE_URL="http://localhost:3030"

# File Paths - these are relative to project root
LOG_DIR="logs"
DATA_DIR="slack-service/data"

# Timing Configuration
BOT_CHECK_INTERVAL=60      # Check every minute
CLAUDE_TIMEOUT=30          # 30 second timeout for Claude
CACHE_TTL=90              # Cache messages for 90 seconds

# Loop Prevention
MAX_RESPONSES_PER_THREAD=10
EMERGENCY_STOP_THRESHOLD=20

# Debug
DEBUG_MODE=true
```

## Usage in Scripts

All scripts automatically load `config.env` and use these variables with sensible defaults:

```bash
# In shell scripts
SERVICE_URL="${SERVICE_URL:-http://localhost:3030}"
LOG_FILE="$SCRIPT_DIR/${LOG_DIR:-logs}/claude_slack_bot.log"

# In Node.js
const port = process.env.SERVICE_PORT || 3030;
const cacheTime = process.env.CACHE_TTL || 90;
```

## Best Practices

1. **Keep sensitive data secure**: Never commit tokens to version control
2. **Use defaults**: Scripts should work with minimal configuration
3. **Document changes**: Update this guide when adding new variables
4. **Test configuration**: Verify changes work across all components
5. **Use relative paths**: Make the system portable across environments

## CRITICAL RULE: Never Hardcode Configuration

**NEVER hardcode data that should be configurable**. This includes:

### Data That Must NEVER Be Hardcoded:

- **Credentials & Tokens**: API keys, passwords, tokens (Slack, Claude, etc.)
- **Port Numbers**: Service ports (3030, 3000, 8080, etc.)
- **URLs & Hosts**: localhost, http://localhost:*, API endpoints
- **File Paths**: Database paths, log directories, temp directories
- **Service Names**: LaunchAgent IDs, systemd service names
- **Timeouts**: API timeouts, cache TTLs, retry intervals
- **Limits**: Rate limits, max messages, response thresholds
- **User-specific paths**: /home/username/*, /Users/username/*

### Always Use Environment Variables:

```bash
# ❌ WRONG - Hardcoded
SERVICE_URL="http://localhost:3030"
DB_PATH="slack-service/data/slack-bot.db"
TIMEOUT=30

# ✅ CORRECT - Environment variables with defaults
SERVICE_URL="${SERVICE_URL:-http://localhost:3030}"
DB_PATH="${DATABASE_FILE:-slack-service/data/slack-bot.db}"
TIMEOUT=${CLAUDE_TIMEOUT:-30}
```

### Before Committing Code:

1. Search for hardcoded values: ports, URLs, paths, timeouts
2. Move all configuration to `config.env`
3. Update code to use environment variables
4. Document new variables in this guide
5. Test with different configurations

This ensures the system is portable, secure, and maintainable across different environments.

## Troubleshooting

If configuration isn't working:

1. Check that `config.env` exists and is readable
2. Verify no syntax errors in the file
3. Ensure variables are exported if needed
4. Check script logs for configuration loading errors
5. Use `./bot_control.sh status` to verify loaded configuration