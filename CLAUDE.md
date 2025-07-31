# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Slack Bot automation system with a Node.js service that monitors Slack messages and uses Claude Code only to generate responses. This architecture reduces Claude API usage by 90%+ since Claude no longer reads Slack messages directly.

## Architecture

The system uses a Node.js service architecture to minimize Claude API usage:

### Components

1. **Node.js Slack Service** (`slack-service/`):
   - Handles all Slack API operations
   - Tracks responded messages in SQLite database
   - Filters messages based on keywords and mentions
   - Provides REST API for the shell script
   - Runs on port 3030 by default (configurable via SERVICE_PORT)

2. **Claude Service** (`slack-service/src/claude-service.js`):
   - NEW: Handles all Claude interaction logic
   - Builds instruction prompts with context
   - Manages Claude CLI execution with timeout
   - Pre-fetches channel histories for efficiency
   - Filters file paths by channel for security

3. **Shell Script** (`claude_slack_bot.sh`):
   - Simplified to ~130 lines (from ~400)
   - Only handles: lock files, service health checks, API calls
   - Delegates all complex logic to Node.js service

4. **Configuration** (`config.env`):
   - Shared configuration for channels, keywords, and behavior
   - Used by both shell script and Node.js service

### Benefits
- **Reduced Claude Usage**: Claude only generates responses, not reading Slack
- **Better Tracking**: SQLite database ensures no duplicate responses
- **Testable**: Comprehensive unit tests for Node.js components
- **Scalable**: Can handle multiple channels and high message volumes
- **Priority System**: Sending responses always takes priority over fetching new messages

## Common Commands

### Central Management (Recommended)
```bash
# One command for everything
./bot_control.sh setup    # First-time setup
./bot_control.sh status   # Check status
./bot_control.sh start    # Start all services
./bot_control.sh stop     # Stop all services
./bot_control.sh restart  # Restart all services
./bot_control.sh logs     # View logs
```

### Manual Testing
```bash
# Run bot once manually (sends pending responses first)
./claude_slack_bot.sh

# Queue operations with priority
./queue_operations.sh priority  # Send first, fetch only if nothing to send
./queue_operations.sh send      # Send pending responses (high priority)
./queue_operations.sh fetch     # Fetch new messages (lower priority)

# Check service health
curl http://localhost:3030/health

# View unresponded messages
curl http://localhost:3030/messages/unresponded | jq
```

### Logs
```bash
# Bot execution log
tail -f logs/claude_slack_bot.log

# Node.js service log  
tail -f logs/slack-service.log

# Service debug log
tail -f slack-service/logs/combined.log

# Error log
tail -f logs/claude_slack_bot_errors.log
```

## Configuration

ALL configuration is centralized in `config.env`. The entire application uses this single configuration file - there are NO other .env files.

Edit `config.env` to customize:
- `SLACK_CHANNELS`: Target channels (e.g., "#general,#support")
- `TRIGGER_KEYWORDS`: Comma-separated keywords
- `RESPONSE_MODE`: "mentions" or "all"
- `CHECK_WINDOW`: Minutes to look back (default: 5)
- `MAX_MESSAGES`: Messages per check (default: 15)

See docs/ENVIRONMENT_CONFIGURATION.md for complete list of all configuration options.

## Key Implementation Details

1. **Node.js Service**: Handles all Slack API operations to minimize Claude usage
2. **SQLite Database**: Tracks responded messages reliably
3. **REST API**: Clean interface between shell script and Node.js service
   - NEW endpoint: `POST /messages/process-with-claude` - Processes multiple messages in one request
   - Handles channel history pre-fetching, file filtering, and Claude execution
4. **Claude Service Module**: New centralized module for Claude interactions
   - `buildClaudeInstruction()`: Constructs prompts with channel/thread context
   - `executeClaude()`: Manages CLI execution with proper timeout handling
   - `prefetchChannelHistories()`: Optimizes API calls by batching history fetches
5. **Claude Focus**: Claude only generates response text - no Slack tool usage
6. **Private Channels**: Supports both public and private channels
7. **MCP Messages**: Handles messages sent via Claude's MCP Slack integration
8. **Error Handling**: Comprehensive logging in both Node.js and shell script
9. **Unit Tests**: Full test coverage including new claude-service.js (22 tests)
10. **Daemon Architecture**: Uses daemon processes instead of cron for better reliability
    - Send daemon runs every 30 seconds (high priority)
    - Process daemon runs every 60 seconds
    - Fetch daemon runs every 3 minutes (lower priority)
11. **Priority System**: Send operations always take priority over fetching
12. **Lock Mechanism**: Prevents multiple bot instances from running simultaneously
13. **Timeout Handling**: Posts helpful message when Claude times out with instructions

## Troubleshooting

Common issues:
- **Node.js service not starting**: Check SLACK_BOT_TOKEN in config.env file
- **No messages found**: Verify bot has access to channels and correct scopes
- **Private channel not visible**: Ensure user is member of the private channel
- **Messages appear as bot messages**: Normal for MCP - service handles this correctly
- **Database errors**: Check write permissions in slack-service/data/ directory
- **Port already in use**: Change PORT in .env or stop existing service (port 3030)
- **Claude command not found**: Ensure Claude Code is installed and in PATH
- **Rate limits**: Service includes caching and rate limiting protection
- **LaunchAgent not running**: Check Console.app for errors, ensure Terminal has Full Disk Access
- **Permissions**: All scripts need execute permission (`chmod +x *.sh`)

### Required Slack Token Type
- **MUST use Slack user token (xoxp)** - Bot tokens cannot access private channels
- User tokens automatically have access to all channels you're a member of
- No additional scopes needed - user tokens inherit your Slack permissions

## 🚨 IMPORTANT: Codebase Maintenance Rules

**NEVER create these files:**
- Version numbered scripts (v2, v3, etc.) - Update the existing bot instead
- Test scripts (except test_integration.sh) - Use Claude Code directly
- Temporary Python scripts - Run one-time tasks in Claude Code
- Docker-related files - This project is Docker-free
- Duplicate documentation - Update existing files
- Additional .env files - ALL configuration MUST be in config.env

**NEVER hardcode configuration values:**
- ❌ Port numbers (3030, 3000, etc.) - Use `${SERVICE_PORT}` from config.env
- ❌ URLs (http://localhost:3030) - Use `${SERVICE_URL}` from config.env
- ❌ File paths (/tmp, logs/, etc.) - Use `${TEMP_DIR}`, `${LOG_DIR}` from config.env
- ❌ Timeouts (30s, 3s, etc.) - Use `${CLAUDE_TIMEOUT}`, `${API_TIMEOUT}` from config.env
- ❌ Service names - Use variables from config.env
- ❌ Any credentials or tokens - MUST be in config.env

**Configuration enforcement:**
- ALL configuration goes in the root `config.env` file
- There is only ONE environment file for the entire application
- Node.js service loads config.env from project root (NOT a local .env)
- Shell scripts source config.env directly
- If a value might need to change, it MUST be in config.env

**ALWAYS follow the structure:**
- See PROJECT_STRUCTURE.md for detailed rules
- New features go in existing files when possible
- Utilities go in utils/ only if used by main bot
- Documentation goes in docs/ directory

**Before making changes:**
1. Check if you can update an existing file instead
2. Ensure it follows the directory structure
3. Update documentation if adding features
4. Never commit temporary or one-time scripts
5. Check if any hardcoded values should be moved to config.env