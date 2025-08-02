# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Slack Bot automation system with a Node.js service that monitors Slack messages and uses Claude Code only to generate responses. This architecture reduces Claude API usage by 90%+ since Claude no longer reads Slack messages directly.

## Architecture

**🚨 CRITICAL: NEVER CHANGE THE CLAUDE ISOLATION ARCHITECTURE**

The system uses a strict three-layer architecture where Claude is COMPLETELY ISOLATED from the Slack API. This is a fundamental design principle that MUST NOT be violated.

### Core Principle: Claude Database Isolation

```
Slack API ──▶ Database ──▶ Claude ──▶ Database ──▶ Slack API
```

**Claude can ONLY**:
- Read from database (message_queue)
- Write to database (response_queue)
- Process messages with pre-fetched context

**Claude MUST NEVER**:
- Make direct Slack API calls
- Have access to Slack tokens
- Use Slack MCP tools
- Send messages directly to Slack

**CRITICAL: Channel History**:
- Channel history for Claude MUST come from the database (message_queue table)
- NEVER fetch channel history from Slack API during processing
- This prevents rate limiting and maintains efficiency

See `docs/ARCHITECTURE.md` for complete architectural documentation and `docs/DATABASE_SCHEMA.md` for database structure.

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

3. **Queue Operations** (`queue_operations.sh`):
   - Unified script for fetch, process, and send operations
   - Used by all daemons and manual operations
   - Supports priority mode (send first, then fetch)

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
./queue_operations.sh priority

# Queue operations with priority
./queue_operations.sh priority  # Send first, fetch only if nothing to send
./queue_operations.sh send      # Send pending responses (high priority)
./queue_operations.sh fetch     # Fetch new messages (lower priority)

# Check service health
curl ${SERVICE_URL}/health

# View unresponded messages
curl ${SERVICE_URL}/messages/unresponded | jq
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

1. **Node.js Service**: Handles all Slack API operations to minimize LLM usage
2. **SQLite Database**: Tracks responded messages reliably
3. **REST API**: Clean interface between shell script and Node.js service
   - Endpoint: `POST /messages/process-with-llm` - Processes multiple messages in one request
   - Handles channel history pre-fetching, file filtering, and LLM execution
4. **LLM Processor Module**: Centralized module for LLM interactions (supports multiple providers)
   - Supports Claude (Anthropic), Google Gemini, OpenAI, and Claude Code CLI
   - Configurable via `LLM_PROVIDER` and related environment variables
   - `processMessage()`: Main entry point for message processing
   - `prefetchChannelHistories()`: Optimizes API calls by batching history fetches
   - Claude Code CLI provider (`claude-code`) maintains backward compatibility
5. **LLM Focus**: The LLM only generates response text - no Slack tool usage
6. **Private Channels**: Supports both public and private channels
7. **MCP Messages**: Specially handles messages sent via Claude's MCP Slack integration
   - MCP messages appear as bot messages (bot_id: B097ML1T6DQ, app_id: A097GBJDNAF)
   - These are processed despite being bot messages to support Claude Code integration
8. **Error Handling**: Comprehensive logging in both Node.js and shell script
9. **Unit Tests**: Comprehensive test coverage with 70+ tests across all modules
10. **Daemon Architecture**: Uses daemon process for continuous message processing
    - Process daemon runs every 60 seconds
    - Handles fetch, process, and send operations through queue_operations.sh
11. **Priority System**: Send operations always take priority over fetching
12. **Lock Mechanism**: Prevents multiple bot instances from running simultaneously
13. **Timeout Handling**: Posts helpful message when LLM times out with instructions
14. **Thread Replies**: Bot ALWAYS sends responses as thread replies (using thread_ts) - NEVER as regular channel messages
15. **API Lock Mechanism**: Fetch and send operations use a global lock to prevent concurrent Slack API requests
16. **Enforcement System**: Runtime checks prevent ANY Slack API calls during message processing:
    - `_enforceNoSlackAPI()` method blocks all API calls when in processing mode
    - `/messages/process-with-llm` and `/queue/process` enable processing mode
    - Channel history MUST come from database during processing, NEVER from Slack API
    - Test with `./test_enforcement.js` to verify enforcement is working
17. **User Info Caching**: User information is cached for 1 hour to reduce API calls

## Troubleshooting

Common issues:
- **Node.js service not starting**: Check SLACK_BOT_TOKEN in config.env file
- **No messages found**: Verify bot has access to channels and correct scopes
- **Private channel not visible**: Ensure user is member of the private channel
- **Messages appear as bot messages**: Normal for MCP - service handles this correctly
- **MCP messages not being processed**: 
  - Ensure bot_id B097ML1T6DQ is allowed in slack-service.js
  - Check that user info can be fetched for the MCP user
- **Database errors**: 
  - Check write permissions in slack-service/data/ directory
  - Verify user_id is properly extracted from user objects
- **"Error generating response" messages**:
  - Check LLM service configuration (provider, API key, model)
  - Review logs for specific LLM errors
  - Ensure Google Generative AI SDK is properly installed if using Google
- **"invalid_thread_ts" errors**:
  - Verify message_id (not database ID) is used for thread_ts
  - Check that response queue uses correct message timestamps
- **Port already in use**: Change SERVICE_PORT in config.env or stop existing service (port 3030)
- **LLM timeouts**: 
  - Increase CLAUDE_TIMEOUT in config.env
  - Check network connectivity to LLM provider
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
- Test scripts (except test integration scripts) - Use Claude Code directly
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