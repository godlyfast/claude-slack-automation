# Claude Slack Bot Automation

This automation uses a Node.js service to monitor Slack channels and threads, while Claude Code generates intelligent responses. The hybrid architecture reduces Claude API usage by 90%+ by handling all Slack operations in Node.js.

📘 **[Інструкція українською мовою](docs/UKRAINIAN_INSTRUCTIONS.md)** | [English Documentation](#)

## 🚀 Architecture Overview

- **Node.js Service**: Handles all Slack API operations, message filtering, thread monitoring, and response tracking
- **Claude Service**: Integrated Node.js module that manages Claude interactions, instruction building, and timeout handling
- **Claude Code**: Only generates responses to messages (90%+ reduction in API usage)  
- **SQLite Database**: Ensures no duplicate responses and tracks thread conversations
- **Thread Support**: Full conversation context across channel messages and thread replies
- **Loop Prevention**: 8-layer anti-loop system prevents infinite responses
- **REST API**: Clean interface between components with new `/messages/process-with-claude` endpoint
- **Daemon Architecture**: Uses daemon processes instead of cron for continuous operation
- **Priority System**: Send operations run every 30 seconds for quick response delivery

## Prerequisites

1. **Node.js** (v14 or higher) and npm
   - Required for the Slack service
   - Check with: `node --version` and `npm --version`

2. **Claude Code** must be installed on your system
   - Visit https://anthropic.com for installation instructions
   - Ensure `claude` command is available in your PATH

3. **Slack User Token** (automatically extracted from Claude MCP config)
   - The setup will use your existing Claude Slack configuration
   - **MUST use user tokens (xoxp)** - bot tokens cannot access private channels
   - User tokens provide full access to channels you're a member of

4. **Optional: Web Automation** (CLI version only)
   - Playwright MCP is configured for web browsing tasks
   - Bot can navigate websites, take screenshots, extract data
   - Example: "ШІ, check the weather on weather.com"

## 🚀 Quick Start

### 🎛️ Recommended: Use Bot Control Script
```bash
# Complete setup (does everything for you)
./bot_control.sh setup

# Start daemon processes
./daemon_control.sh start

# Check status
./bot_control.sh status
./daemon_control.sh status

# View logs
./bot_control.sh logs
./daemon_control.sh logs all

# Start/stop services
./bot_control.sh start
./bot_control.sh stop
```

### 🔧 Manual Setup Options

**macOS LaunchAgent:**
```bash
./setup/setup_macos.sh
launchctl list | grep claude
```

**Background Daemon:**
```bash
./daemon_control.sh start
./daemon_control.sh status
```

**Interactive Wizard:**
```bash
./setup/quickstart.sh
```

## 📋 Setup Process

### 1. Start Node.js Service
```bash
# Navigate to slack-service directory
cd slack-service

# Install dependencies and start service
npm install
npm start &

# Verify service is running
curl ${SERVICE_URL}/health
```

### 2. Configure the Bot
Edit `config.env` to customize behavior:
```bash
nano config.env
```

Key settings:
- `SLACK_CHANNELS`: Channels to monitor (e.g., "#ai-test,#general")
- `TRIGGER_KEYWORDS`: Keywords that trigger responses (e.g., "AI,ШІ")
- `RESPONSE_MODE`: "mentions" or "all"
- `CHECK_WINDOW`: How far back to check for messages (minutes)
- `MAX_MESSAGES`: Maximum messages to process per check

### 3. Test Integration
```bash
# Test Claude + Node.js integration
./test_integration_simple.sh

# Manual test run
./claude_slack_bot.sh
```

## Project Structure

> 📋 **See PROJECT_STRUCTURE.md for maintenance rules and guidelines**

```
claude-slack-automation/
├── slack-service/               # Node.js Slack Service
│   ├── src/                     # Source code  
│   │   ├── index.js            # Main server entry point
│   │   ├── slack-service.js    # Slack API wrapper + thread monitoring
│   │   ├── db.js               # SQLite database (deduplication + threads)
│   │   └── loop-prevention.js  # 8-layer anti-loop system
│   ├── tests/                  # 70+ comprehensive unit tests
│   ├── logs/                   # Service-specific logs
│   ├── package.json            # Dependencies (@slack/web-api, sqlite3)
│   └── data/                   # SQLite databases and state files
├── queue_operations.sh         # Unified queue operations (fetch/process/send)
├── config.env                  # Bot configuration
├── com.claude.slackbot.plist   # macOS LaunchAgent config
├── test_integration_simple.sh  # Basic integration test
├── test_full_integration.sh    # Full integration test with message posting
├── setup/                      # Installation scripts
│   ├── setup_macos.sh          # macOS LaunchAgent setup  
│   └── quickstart.sh           # Interactive setup wizard
├── daemons/                    # Daemon processes
│   └── process_daemon.sh      # Message processing daemon
├── scripts/                    # Helper scripts
│   ├── common_functions.sh    # Shared utilities
│   ├── daemon_wrapper.sh      # Daemon management wrapper
│   └── slack_api_lock.sh      # API rate limiting lock
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md        # System architecture and isolation
│   ├── DATABASE_SCHEMA.md     # Complete database structure
│   ├── BOT_CONTROL.md         # Control script guide
│   ├── INSTALLATION_macOS.md   # macOS installation guide
│   ├── FILE_ATTACHMENTS.md    # File processing guide
│   ├── PLAYWRIGHT.md          # Web automation features
│   ├── PERFORMANCE.md         # Rate limits and caching
│   └── ukrainian/             # Ukrainian language guides
└── logs/                       # Bot execution logs
    ├── queue_operations.log
    └── queue_operations_errors.log
```

## 💻 Usage

### 🤖 Bot Features
- **Channel Monitoring**: Responds to messages containing keywords "AI" or "ШІ"
- **Thread Support**: Continues conversations in threads with full context
- **File Attachments**: Reads and analyzes code files, text files, images, and more
- **Loop Prevention**: 8-layer system prevents infinite response loops
- **Deduplication**: Never responds to the same message twice
- **Self-Awareness**: Won't respond to its own messages or other bots

### ⚡ Automatic Operation
Once installed, the bot runs automatically:
- **LaunchAgent**: Every 60 seconds (macOS)
- **Daemon**: Continuous background process
- **Cron**: Every minute (Linux/Unix)

### 🧪 Manual Testing
```bash
# Start Node.js service (if not running)
cd slack-service && npm start &

# Run single bot check
./queue_operations.sh priority

# Test service endpoints
curl ${SERVICE_URL}/health
curl ${SERVICE_URL}/messages/unresponded

# Run integration test
./test_integration_simple.sh
```

### 📊 Monitoring & Logs
```bash
# View bot execution logs
tail -f logs/queue_operations.log

# Check for errors
tail -f logs/queue_operations_errors.log

# View Node.js service logs  
tail -f slack-service/logs/combined.log

# Check service health
curl ${SERVICE_URL}/health

# View database stats
curl ${SERVICE_URL}/stats
```

### 🎛️ Control Commands

**Using Bot Control Script (Recommended):**
```bash
./bot_control.sh setup       # Complete setup wizard
./bot_control.sh start       # Start all services
./bot_control.sh stop        # Stop all services  
./bot_control.sh restart     # Restart all services
./bot_control.sh status      # Show detailed status
./bot_control.sh logs        # Interactive log viewer
./bot_control.sh diagnostics # Run system diagnostics

# Service-only commands
./bot_control.sh service start|stop|restart
```

**Manual Controls:**
```bash
# LaunchAgent controls (macOS)
launchctl unload ~/Library/LaunchAgents/com.claude.slackbot.plist
launchctl load ~/Library/LaunchAgents/com.claude.slackbot.plist

# Daemon controls
./daemon_control.sh start|stop|restart|status|logs

# Emergency cleanup
pkill -f queue_operations.sh
```

## ⚙️ Configuration Options

Edit `config.env` to customize bot behavior:

### Core Settings
- **SLACK_CHANNELS**: Channels to monitor (e.g., "#ai-test,#general")  
- **TRIGGER_KEYWORDS**: Keywords that trigger responses (e.g., "AI,ШІ")
- **RESPONSE_MODE**: 
  - `"mentions"`: Only respond to messages with trigger keywords
  - `"all"`: Respond to all questions/requests
- **CHECK_WINDOW**: Time window in minutes for checking messages (default: 5)
- **MAX_MESSAGES**: Maximum messages to process per check (default: 20)

### Thread Settings  
- **THREAD_MONITORING**: Enable thread monitoring (default: true)
- **THREAD_CONTEXT_LENGTH**: Number of messages to include as context (default: 10)

### Safety Settings
- **LOOP_PREVENTION**: Enable anti-loop system (default: true)
- **MAX_THREAD_RESPONSES**: Max responses per thread (default: 10)
- **USER_RATE_LIMIT**: Max responses per user per hour (default: 5)

### Service Configuration (slack-service/.env)
- **SLACK_BOT_TOKEN**: Your Slack bot token
- **PORT**: API server port (default: 3030)
- **LOG_LEVEL**: Logging verbosity (info, debug, error)

## Troubleshooting

### Node.js Service Issues

1. **Service won't start**
   - Check if port 3030 is already in use: `lsof -i :3030`
   - Verify SLACK_BOT_TOKEN in `slack-service/.env`
   - Check Node.js version: `node --version` (v14+ required)
   - Review logs: `tail -f slack-service/logs/error.log`

2. **No messages found**
   - Verify bot has access to channels in Slack workspace
   - Check token permissions (channels:history, channels:read, chat:write)
   - Ensure channels are public or bot is invited to private channels
   - Test with: `curl ${SERVICE_URL}/messages/unresponded`

3. **Database errors**
   - Check write permissions: `ls -la slack-service/data/`
   - Delete corrupted database: `rm slack-service/data/slack-bot.db`
   - Service will recreate database on restart

### Bot Script Issues

1. **Claude Code not found**
   - Ensure Claude Code is installed
   - Check that `claude` command works in terminal
   - May need to add to PATH in the script

2. **No responses in Slack**
   - Verify Node.js service is running: `curl ${SERVICE_URL}/health`
   - Check bot logs: `tail -f logs/queue_operations.log`
   - Ensure correct channel names in config.env (include #)
   - Verify trigger keywords match message content

3. **Cron job not running**
   - Run `crontab -l` to verify the job exists
   - Check cron.log for execution errors
   - On macOS, ensure Terminal has Full Disk Access permissions

4. **Permission errors**
   - Ensure scripts are executable: `chmod +x *.sh`
   - Check file ownership

## Testing

### Unit Tests
Run unit tests for the Node.js service:
```bash
cd slack-service
npm test
```

### Integration Tests
Two integration tests are available:

1. **Simple Test** (recommended) - Tests all components without posting to Slack:
```bash
./test_integration_simple.sh
```

2. **Full Test** - Posts a test message to #ai-test and verifies bot response:
```bash
./test_full_integration.sh
```

⚠️ **Warning**: The full test posts real messages to Slack. It includes safety features to prevent loops.

## Security Notes

- The bot will only respond in the configured channel
- Responses are based on Claude's safety guidelines
- All activity is logged for audit purposes
- Consider using a dedicated bot account for production use

## Customization

To modify Claude's behavior:
- Edit the instruction building logic in `slack-service/src/claude-service.js`
- Look for the `buildClaudeInstruction` method
- Adjust the prompting to change response style
- Add specific instructions for your use case

The architecture now uses a cleaner separation:
- **Queue Operations** (`queue_operations.sh`): Unified script for all queue operations
- **Claude Service** (`slack-service/src/claude-service.js`): Handles all Claude interaction logic
- **API** (`slack-service/src/api.js`): Provides REST endpoints including `/messages/process-with-claude`

## Support

For issues with:
- Claude Code: Visit https://support.anthropic.com
- This automation: Check the logs first, then review configuration
