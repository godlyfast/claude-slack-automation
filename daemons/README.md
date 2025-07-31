# Queue Daemons

This directory contains daemon scripts for continuous queue operations.

## Overview

The bot uses daemon processes instead of cron for better control and reliability. Each daemon runs continuously, executing its operation at configured intervals.

## Daemons

### adaptive_daemon.sh (RECOMMENDED)
- **Priority**: INTELLIGENT
- **Send Check**: Every 60 seconds
- **Fetch Cooldown**: 3 minutes between fetches
- **Purpose**: Smart daemon that:
  - Checks for pending responses every minute
  - If pending: Sends up to 20 messages
  - If empty: Fetches new messages (max once per 3 minutes)
  - Automatically processes new messages after fetch
- **Benefits**: No wasted operations, optimal resource usage

### process_daemon.sh
- **Priority**: MEDIUM
- **Default Interval**: 60 seconds
- **Purpose**: Processes queued messages with Claude
- **Batch Size**: 10 messages

### Legacy Daemons (use adaptive instead):

#### send_daemon.sh
- **Default Interval**: 30 seconds
- **Purpose**: Only sends responses

#### fetch_daemon.sh
- **Default Interval**: 180 seconds
- **Purpose**: Only fetches messages

#### priority_daemon.sh
- **Default Interval**: 45 seconds
- **Purpose**: Basic priority mode

## Configuration

Daemon intervals and batch sizes can be configured in `config.env`:

```bash
# Daemon Configuration
FETCH_INTERVAL=180      # Fetch daemon interval (seconds)
PROCESS_INTERVAL=60     # Process daemon interval (seconds)
SEND_INTERVAL=30        # Send daemon interval (seconds)
PRIORITY_INTERVAL=45    # Priority daemon interval (seconds)
```

## Management

Use `daemon_control.sh` to manage daemons:

```bash
# Start recommended setup (adaptive + process daemons)
../daemon_control.sh start

# Start specific daemon
../daemon_control.sh start adaptive

# Stop all daemons
../daemon_control.sh stop

# Check status
../daemon_control.sh status

# View logs
../daemon_control.sh logs adaptive
../daemon_control.sh logs all
```

## Logs

Each daemon writes to its own log file:
- `logs/send_daemon.log`
- `logs/process_daemon.log`
- `logs/fetch_daemon.log`
- `logs/priority_daemon.log`

Error logs are written to:
- `logs/<daemon_name>_errors.log`

## Signal Handling

Daemons handle the following signals:
- **SIGTERM**: Graceful shutdown
- **SIGINT**: Graceful shutdown (Ctrl+C)

## Error Recovery

- Daemons track consecutive errors
- After 10 consecutive errors, the daemon shuts down
- Successful operations reset the error counter