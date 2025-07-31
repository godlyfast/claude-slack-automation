# Claude Slack Bot - Quick Start Guide

## 🚀 Queue-Based Architecture

The bot now uses a completely decoupled architecture with three independent operations:

1. **Fetch** - Gets messages from Slack (waits for API availability)
2. **Process** - Uses Claude to generate responses (no Slack API needed)
3. **Send** - Delivers responses to Slack (waits for API availability)

## 📋 Prerequisites

- Node.js installed
- Claude CLI installed (`claude`)
- SQLite3 installed
- Slack bot token configured in `config.env`

## 🛠️ Initial Setup

```bash
# One-time setup
./bot_control.sh setup

# This will:
# - Install Node.js dependencies
# - Start the service
# - Show cron job configuration
```

## 🎮 Manual Operation

```bash
# Start the service
./bot_control.sh start

# Run one complete cycle
./bot_control.sh queue all

# Or run operations separately:
./bot_control.sh queue fetch    # Get messages from Slack
./bot_control.sh queue process  # Process with Claude
./bot_control.sh queue send     # Send to Slack

# Check status
./bot_control.sh status

# Monitor queues live
./bot_control.sh monitor
```

## ⏰ Automated Operation (Recommended)

Add to crontab (`crontab -e`):

```bash
# Fetch messages every 2 minutes
*/2 * * * * /path/to/queue_fetcher.sh >> /path/to/logs/cron_fetcher.log 2>&1

# Process messages every minute
* * * * * /path/to/queue_processor.sh 10 >> /path/to/logs/cron_processor.log 2>&1

# Send responses every minute
* * * * * /path/to/queue_sender.sh 10 >> /path/to/logs/cron_sender.log 2>&1
```

## 📊 Monitoring

```bash
# Check overall status
./bot_control.sh status

# Watch queues in real-time
./bot_control.sh monitor

# View logs
./bot_control.sh logs
```

## 🔧 Troubleshooting

```bash
# Run diagnostics
./bot_control.sh diagnostics

# Restart service
./bot_control.sh restart

# Check specific logs
tail -f logs/queue_fetcher.log
tail -f logs/queue_processor.log
tail -f logs/queue_sender.log
tail -f slack-service/logs/combined.log
```

## 💡 Key Features

- **Rate Limit Resilient**: Operations wait for API availability
- **Parallel Processing**: Process multiple messages at once
- **Data Retention**: All messages preserved for context
- **Independent Operations**: Each stage runs separately
- **No Timeouts**: Operations wait as long as needed

## 🎯 Common Tasks

### Process More Messages at Once
```bash
./bot_control.sh queue process 20  # Process 20 messages
./bot_control.sh queue send 30     # Send 30 responses
```

### Check What's Pending
```bash
./bot_control.sh queue status
```

### Clean Up Logs
```bash
./utils/cleanup.sh
```

## 📚 More Information

- Architecture details: `docs/QUEUE_ARCHITECTURE.md`
- Data retention: `docs/DATA_RETENTION.md`
- Configuration: `docs/ENVIRONMENT_CONFIGURATION.md`
- File attachments: `docs/FILE_ATTACHMENTS.md`