# Claude Slack Bot Automation (macOS)

This automation runs Claude Code every minute to check and respond to Slack messages, with multiple macOS-friendly options.

## Prerequisites

1. **Claude Code** must be installed
   - Visit https://anthropic.com for installation
   - Ensure `claude` command works in Terminal

2. **Slack Access** configured in Claude
   - Claude must have access to your Slack workspace

## Installation Options for macOS

### Option 1: LaunchAgent (Recommended - System Service)

The most Mac-native approach using launchd:

```bash
# Install as system service
./setup_macos.sh
# Choose option 1

# Check status
./setup_macos.sh
# Choose option 3

# View logs
tail -f logs/claude_slack_bot.log
```

**Pros:** Runs on startup, survives reboots, truly automated
**Cons:** Requires LaunchAgent configuration

### Option 2: Background Daemon (No Terminal Window)

Runs invisibly in the background:

```bash
# Start the daemon
./daemon.sh start

# Check status
./daemon.sh status

# Stop the daemon
./daemon.sh stop

# View logs
./daemon.sh logs
```

**Pros:** No terminal window, easy to manage
**Cons:** Needs manual restart after reboot

### Option 3: Terminal Loop (Visual Feedback)

Runs in a Terminal window with live status:

```bash
# Start in current terminal
./run_background_loop.sh

# Or create a clickable app
./create_app.sh
# Then double-click "Claude Slack Bot.app"
```

**Pros:** Visual feedback, easy to monitor
**Cons:** Requires open Terminal window

### Option 4: Manual Scheduling

For testing or occasional use:

```bash
# Single run
./queue_operations.sh priority

# Run every minute for an hour
for i in {1..60}; do
    ./queue_operations.sh priority
    sleep 60
done
```

## Configuration

Edit `config.env` to customize:

```bash
# Core settings
SLACK_CHANNEL="#general"        # Channel to monitor
RESPONSE_MODE="mentions"         # "mentions" or "all"
TRIGGER_KEYWORDS="@claude,@bot"  # Comma-separated triggers

# Behavior settings
MAX_MESSAGES=20                  # Messages per check
CHECK_WINDOW=5                   # Minutes to look back
DEBUG_MODE=false                 # Verbose logging
```

## Quick Start Guide

1. **Test the integration:**
   ```bash
   ./test_integration.sh
   ```

2. **Configure your channel:**
   ```bash
   nano config.env
   # Set SLACK_CHANNEL to your target channel
   ```

3. **Choose your preferred method:**
   - **Always running:** Use LaunchAgent (`./setup_macos.sh`)
   - **On-demand background:** Use daemon (`./daemon.sh start`)
   - **Visual monitoring:** Use Terminal loop (`./run_background_loop.sh`)

4. **Monitor the bot:**
   ```bash
   # Live logs
   tail -f logs/claude_slack_bot.log
   
   # Check errors
   tail -f logs/claude_slack_bot_errors.log
   ```

## File Structure

```
claude-slack-automation/
├── queue_operations.sh        # Main queue operations script
├── config.env                 # Configuration
├── setup_macos.sh            # LaunchAgent setup
├── daemon.sh                 # Background daemon manager
├── run_background_loop.sh    # Terminal loop runner
├── create_app.sh             # Creates clickable app
├── test_integration.sh       # Test Claude+Slack
├── com.claude.slackbot.plist # LaunchAgent config
└── logs/                     # All logs
    ├── claude_slack_bot.log
    ├── claude_slack_bot_errors.log
    └── daemon.log
```

## Troubleshooting

### Claude Command Not Found
```bash
# Find where Claude is installed
which claude

# If not in PATH, update the plist file:
nano com.claude.slackbot.plist
# Add the full path to the PATH environment variable
```

### LaunchAgent Not Working
```bash
# Check if it's loaded
launchctl list | grep claude

# Check Console.app for errors
# Look under "system.log" or search for "claude"

# Manually reload
launchctl unload ~/Library/LaunchAgents/com.claude.slackbot.plist
launchctl load ~/Library/LaunchAgents/com.claude.slackbot.plist
```

### Permissions Issues
```bash
# Ensure scripts are executable
chmod +x *.sh

# For LaunchAgent, check Terminal has Full Disk Access:
# System Preferences > Security & Privacy > Privacy > Full Disk Access
```

### Bot Not Responding
1. Check logs for errors
2. Verify Slack channel name in config.env
3. Test manually: `./queue_operations.sh priority`
4. Ensure Claude has Slack permissions

## Managing the Bot

### Start/Stop Commands

**LaunchAgent:**
```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.claude.slackbot.plist

# Start
launchctl load ~/Library/LaunchAgents/com.claude.slackbot.plist
```

**Daemon:**
```bash
./daemon.sh start|stop|restart|status
```

**Terminal Loop:**
```bash
# Start: ./run_background_loop.sh
# Stop: Press Ctrl+C
```

## Advanced Usage

### Custom Check Intervals

Edit the interval in your chosen method:
- **LaunchAgent:** Edit `StartInterval` in plist (seconds)
- **Daemon/Loop:** Edit `sleep 60` in the scripts

### Multiple Channels

Create multiple configs:
```bash
cp config.env config-sales.env
cp config.env config-support.env
# Edit each config for different channels
# Run separate instances with different configs
```

### Logging Rotation

Add to your daemon or LaunchAgent:
```bash
# Rotate logs daily
find logs/ -name "*.log" -mtime +7 -delete
```

## Security Notes

- Bot only responds in configured channels
- All activity is logged
- Consider using a dedicated Slack bot user
- Review Claude's safety guidelines

## Support

- **Claude Code issues:** https://support.anthropic.com
- **Script issues:** Check logs first
- **Slack issues:** Verify permissions and channel access
