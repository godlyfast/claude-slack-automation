# Claude Slack Bot Automation

This automation uses a Node.js service to monitor Slack channels and threads, while an LLM (Claude, Google Gemini, or OpenAI) generates intelligent responses. The hybrid architecture reduces API usage by 90%+ by handling all Slack operations in Node.js. Supports messages sent via Claude's MCP Slack integration.

📘 **[Інструкція українською мовою](docs/UKRAINIAN_INSTRUCTIONS.md)** | [English Documentation](#)

## 🚀 Architecture Overview

- **Unified Node.js Service**: A single, containerized service that handles all Slack API operations, message filtering, thread monitoring, and response tracking.
- **LLM Service**: Flexible integration with multiple providers (Anthropic Claude, Google Gemini, OpenAI).
- **SQLite Database**: Ensures no duplicate responses and tracks thread conversations.
- **Docker Support**: The entire application is containerized with Docker for easy setup and deployment.
- **Orchestration**: A built-in orchestrator manages the fetch-process-send cycle, replacing the need for external scripts.

## Prerequisites

1. **Docker and Docker Compose**
   - Required to build and run the application container.
   - Visit [https://www.docker.com/get-started](https://www.docker.com/get-started) to install.

2. **LLM Provider**: Choose one of:
   - **Google Gemini**: API key from Google AI Studio
   - **Anthropic Claude**: API key from Anthropic
   - **OpenAI**: API key from OpenAI

3. **Slack User Token**
   - **MUST use user tokens (xoxp)** - bot tokens cannot access private channels.

## 🚀 Quick Start with Docker

1. **Configure the Bot**
   - Create a `config.env` file in the project root (you can copy `config.env.example`).
   - Edit `config.env` to set your `SLACK_BOT_TOKEN`, `LLM_PROVIDER`, and `LLM_API_KEY`.

2. **Build and Run the Container**
   ```bash
   docker-compose up --build
   ```

3. **Check the Service Health**
   ```bash
   curl http://localhost:3030/health
   ```

## 📋 Manual Setup (Without Docker)

### 1. Install Dependencies
```bash
# Navigate to slack-service directory
cd slack-service

# Install dependencies
npm install
```

### 2. Configure the Bot
- Create a `config.env` file in the project root.
- Edit `config.env` to set your `SLACK_BOT_TOKEN`, `LLM_PROVIDER`, and `LLM_API_KEY`.

### 3. Start the Service
```bash
# From the slack-service directory
npm start
```

### 2. Configure the Bot
Edit `config.env` to customize behavior:
```bash
nano config.env
```

Key settings:
- `LLM_PROVIDER`: The LLM provider to use (e.g., `anthropic`, `openai`, `google`).
- `LLM_API_KEY`: Your API key for the chosen LLM provider.
- `LLM_MODEL`: The model to use for generating responses (e.g., `claude-2.1`, `gpt-4`, `gemini-pro`).
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
│   │   ├── orchestrator.js     # Manages the fetch-process-send cycle
│   │   ├── slack-service.js    # Slack API wrapper
│   │   ├── db.js               # SQLite database
│   │   └── llm-processor.js    # LLM interaction logic
│   ├── tests/                  # Unit and integration tests
│   ├── package.json            # Dependencies
│   └── data/                   # SQLite database
├── Dockerfile                  # Defines the application container
├── docker-compose.yml          # Docker Compose configuration
├── config.env                  # Bot configuration
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md        # System architecture
│   ├── IMPROVEMENT_PLAN.md    # Details of the new architecture
│   └── ...
└── logs/                       # Application logs
```

## 💻 Usage

### 🤖 Bot Features
- **Channel Monitoring**: Responds to messages containing keywords "AI" or "ШІ"
- **Thread Support**: Continues conversations in threads with full context
- **File Attachments**: Reads and analyzes text/code files (PDF support limited with Google Gemini)
- **Loop Prevention**: 8-layer system prevents infinite response loops
- **Deduplication**: Never responds to the same message twice
- **Self-Awareness**: Won't respond to its own messages or other bots

### ⚡ Automatic Operation
Once installed, the bot runs automatically:
- **LaunchAgent**: Every 60 seconds (macOS)
- **Daemon**: Continuous background process
- **Cron**: Every minute (Linux/Unix)

### 🧪 Testing

**End-to-End Test Suite:**
```bash
# Run all E2E tests
cd slack-service && npm run test:e2e

# Run specific test scenarios
npm run test:e2e:basic      # Basic messaging tests
npm run test:e2e:files      # File handling tests
npm run test:e2e:advanced   # Advanced features tests

# Run with options
npm run test:e2e -- --verbose     # Detailed output
npm run test:e2e -- --quiet       # Minimal output
npm run test:e2e -- --fail-fast   # Stop on first failure
```

**Unit Tests:**
```bash
# Run unit tests
cd slack-service && npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

**Manual Testing:**
```bash
# Run single bot check
./queue_operations.sh priority

# Test service endpoints
curl ${SERVICE_URL}/health
curl ${SERVICE_URL}/messages/unresponded
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

### LLM Configuration
- **LLM_PROVIDER**: Choose "google", "anthropic", "openai", or "claude-code"
- **GOOGLE_API_KEY**: For Google Gemini (if using Google)
- **ANTHROPIC_API_KEY**: For Claude (if using Anthropic)
- **OPENAI_API_KEY**: For GPT models (if using OpenAI)
- **[PROVIDER]_MODEL**: Model name for your chosen provider
- Note: claude-code provider uses the CLI and requires no API key

### Service Configuration
- **SLACK_BOT_TOKEN**: Your Slack user token (xoxp-...)
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

1. **LLM API Key not working**
   - Ensure the `LLM_API_KEY` in `config.env` is correct.
   - Check that the API key has the necessary permissions.

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

To modify the LLM's behavior:
- Edit the prompt building logic in `slack-service/src/llm-processor.js`
- Look for the `buildPrompt` method
- Adjust the prompting to change response style
- Add specific instructions for your use case

The architecture now uses a cleaner separation:
- **Queue Operations** (`queue_operations.sh`): Unified script for all queue operations
- **LLM Processor** (`slack-service/src/llm-processor.js`): Handles all LLM interaction logic
- **API** (`slack-service/src/api.js`): Provides REST endpoints including `/messages/process-with-llm`

## Support

For issues with:
- Claude Code: Visit https://support.anthropic.com
- This automation: Check the logs first, then review configuration
