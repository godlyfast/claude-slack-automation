#!/bin/bash

# Fetch Daemon - Continuously fetches messages from Slack

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"

# Configuration
DAEMON_NAME="fetch_daemon"
OPERATION="fetch"
INTERVAL="${FETCH_INTERVAL:-180}"  # Default: 3 minutes (lower priority)

# Start daemon
exec "$SCRIPT_DIR/scripts/daemon_wrapper.sh" "$DAEMON_NAME" "$OPERATION" "$INTERVAL"