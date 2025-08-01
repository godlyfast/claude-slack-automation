# 🎛️ Bot Control Script Guide

The `bot_control.sh` script is the central command center for managing the Claude Slack Bot's hybrid Node.js + Claude architecture. It provides a unified interface for setup, management, monitoring, and troubleshooting.

## 🚀 Quick Start

```bash
# First time setup - does everything for you
./bot_control.sh setup

# Check if everything is running
./bot_control.sh status

# View logs in real-time
./bot_control.sh logs
```

## 📋 Complete Command Reference

### 🔧 Main Commands

#### `./bot_control.sh setup`
**Complete initial setup wizard**
- Checks prerequisites (Node.js, Claude CLI)
- Installs Node.js dependencies
- Creates service configuration files
- Starts the Node.js service
- Tests integration
- Sets up automation (LaunchAgent/daemon/cron)

**Output:**
```
🤖 Claude Slack Bot - Complete Setup
========================================

Checking prerequisites...
✓ Node.js: v18.17.0
✓ Claude CLI: v1.2.3

Setting up Node.js Slack service...
✓ Node.js service started (PID: 12345)
✓ Service health check passed

Choose automation method:
1. macOS LaunchAgent (recommended for macOS)
2. Background daemon
3. Cron job (Linux/Unix)
4. Manual execution only
```

#### `./bot_control.sh start`
**Start all services**
- Starts Node.js service if not running
- Loads LaunchAgent or starts daemon
- Shows final status

#### `./bot_control.sh stop`
**Stop all services**
- Unloads LaunchAgent/stops daemon
- Stops Node.js service gracefully
- Cleans up any remaining processes

#### `./bot_control.sh restart`
**Restart all services**
- Equivalent to `stop` then `start`
- Useful for applying configuration changes

#### `./bot_control.sh status`
**Show detailed status**

**Example output:**
```
Claude Slack Bot Status
========================
Node.js Service: ● Running (port 3030)
Service Health:  ● Healthy
File Attachments: ● Supported
LaunchAgent:     ● Loaded
Last Exit:       ● Success (0)
Background Daemon: ● Stopped

Configuration:
Channels:        #ai-test
Trigger Words:   AI,ШІ
Response Mode:   all

Recent Activity:
Last Bot Run:    [2025-07-29 15:30:45]
Runs This Hour:  12
```

### 🔧 Service Management

#### `./bot_control.sh service start`
**Start only the Node.js service**
- Installs dependencies if needed
- Creates .env file if missing
- Starts service on port 3030
- Runs health checks

#### `./bot_control.sh service stop`
**Stop only the Node.js service**
- Graceful shutdown using PID
- Force kill if needed
- Cleans up process files

#### `./bot_control.sh service restart`
**Restart only the Node.js service**
- Useful for service-only changes
- Preserves automation settings

### 📊 Monitoring & Logs

#### `./bot_control.sh logs`
**Interactive log viewer**

**Menu options:**
1. **Bot execution log** - Main bot activity
2. **Node.js service log** - Service startup/errors
3. **Service detailed logs** - Verbose service operations
4. **Error log** - Bot execution errors
5. **Daemon log** - Background daemon activity
6. **LaunchAgent logs** - Opens Console.app
7. **All logs** - Tail multiple logs simultaneously

#### `./bot_control.sh diagnostics`
**Comprehensive system diagnostics**

**Checks:**
- System information (OS, Node.js, Claude versions)
- Service status and health
- File system (config files, dependencies)
- Network connectivity (Slack API, local service)
- Recent errors

**Example output:**
```
🔍 Claude Slack Bot Diagnostics
==================================

System Information:
OS: Darwin 24.5.0
Node.js: v18.17.0
npm: 9.6.7
Claude: v1.2.3

File System:
Config file: ✓ exists
Node modules: ✓ installed
Service .env: ✓ exists

Network Connectivity:
Slack API: ✓ reachable
Local service: ✓ responding
```

## 🏗️ Architecture Overview

The bot_control.sh script manages a **hybrid architecture**:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   LaunchAgent   │───▶│  claude_slack_   │───▶│   Claude CLI    │
│   (scheduler)   │    │     bot.sh       │    │  (responses)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Node.js API    │
                       │   (port 3030)    │
                       │ • Slack reading  │
                       │ • File handling  │
                       │ • Deduplication  │
                       │ • Loop prevention│
                       └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Slack API      │
                       │ • conversations  │
                       │ • files          │
                       │ • chat.post      │
                       └──────────────────┘
```

## 🔧 Configuration Management

### Service Configuration
**Location:** `slack-service/.env`
```bash
SLACK_BOT_TOKEN=xoxp-your-token
PORT=3030
LOG_LEVEL=info
NODE_ENV=production
CACHE_ENABLED=true
```

### Bot Configuration
**Location:** `config.env`
```bash
SLACK_CHANNELS="#ai-test"
TRIGGER_KEYWORDS="AI,ШІ"
RESPONSE_MODE="all"
MAX_MESSAGES=15
CHECK_WINDOW=5
```

### Automation Configuration
**macOS LaunchAgent:** `~/Library/LaunchAgents/com.claude.slackbot.plist`
**Daemon PID:** `utils/.daemon.pid`
**Service PID:** `slack-service/.service.pid`

## 🚨 Troubleshooting

### Common Issues

#### Node.js Service Won't Start
**Symptoms:**
```
✗ Failed to start Node.js service
Check logs/slack-service.log for details
```

**Solutions:**
1. Check if port 3030 is in use: `lsof -i :3030`
2. Verify Slack token in `slack-service/.env`
3. Check Node.js version: `node --version` (requires v14+)
4. Install dependencies: `cd slack-service && npm install`

#### Service Started But Health Check Failed
**Symptoms:**
```
✓ Node.js service started (PID: 12345)
⚠ Service started but health check failed
```

**Solutions:**
1. Wait a few seconds for service to fully initialize
2. Check service logs: `./bot_control.sh logs` → option 2
3. Test manually: `curl http://localhost:3030/health`
4. Verify .env file has correct SLACK_BOT_TOKEN

#### LaunchAgent Not Loading
**Symptoms:**
```
LaunchAgent: ● Not loaded
```

**Solutions:**
1. Check if file exists: `ls ~/Library/LaunchAgents/com.claude.slackbot.plist`
2. Verify Terminal has Full Disk Access (macOS System Preferences)
3. Try manual load: `launchctl load ~/Library/LaunchAgents/com.claude.slackbot.plist`
4. Check Console.app for errors

#### Bot Not Responding to Messages
**Symptoms:**
- Status shows all services running
- No activity in logs

**Solutions:**
1. Verify channel configuration in `config.env`
2. Check trigger keywords match your messages
3. Ensure bot token has proper Slack permissions
4. Test service endpoints:
   ```bash
   curl http://localhost:3030/messages/unresponded
   curl http://localhost:3030/attachments/supported-types
   ```

### Emergency Recovery

#### Complete Reset
```bash
# Stop everything
./bot_control.sh stop

# Clean up
pkill -f claude_slack_bot
pkill -f node.*slack-service

# Remove PID files
rm -f slack-service/.service.pid utils/.daemon.pid

# Restart fresh
./bot_control.sh start
```

#### Service-Only Reset
```bash
# Stop just the Node.js service
./bot_control.sh service stop

# Clear Node.js cache
cd slack-service
rm -rf node_modules package-lock.json
npm install

# Restart service
./bot_control.sh service start
```

## 🔐 Security Considerations

### Token Management
- Service automatically extracts token from Claude MCP config
- Tokens are stored in local `.env` files only
- No tokens are logged or exposed in status output

### File Processing
- File downloads use secure Slack API authentication
- 10MB file size limit prevents abuse
- Temporary files are cleaned up automatically
- Only processes files from messages bot would respond to

### Network Security
- Service only listens on localhost (127.0.0.1)
- No external network access beyond Slack API
- Health checks verify service integrity

## 📈 Performance Monitoring

### Key Metrics
- **Response time**: Check with `curl -w "%{time_total}" http://localhost:3030/health`
- **Memory usage**: Monitor Node.js process with `ps aux | grep node`
- **Bot frequency**: Check "Runs This Hour" in status
- **Error rate**: Monitor error logs for patterns

### Log Rotation
```bash
# Manual log cleanup
find logs/ -name "*.log" -size +10M -exec truncate -s 0 {} \;

# Or use the cleanup utility
# Manual cleanup: rm -rf logs/*.log slack-service/temp/*
```

## 🚀 Advanced Usage

### Custom Service Port
```bash
# Change port in slack-service/.env
echo "PORT=3031" >> slack-service/.env

# Restart service
./bot_control.sh service restart
```

### Development Mode
```bash
# Set development mode
cd slack-service
echo "NODE_ENV=development" >> .env
echo "LOG_LEVEL=debug" >> .env

# Restart with verbose logging
./bot_control.sh service restart
```

### Multiple Channels
```bash
# Edit config.env
SLACK_CHANNELS="#ai-test,#general,#random"

# No restart needed - bot picks up changes automatically
```

The bot_control.sh script provides complete lifecycle management for the Claude Slack Bot, making it easy to deploy, monitor, and maintain the hybrid architecture!