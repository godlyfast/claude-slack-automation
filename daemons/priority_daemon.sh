#!/bin/bash

# Priority Daemon - Runs in priority mode (send first, fetch only if needed)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"

# Configuration
DAEMON_NAME="priority_daemon"
OPERATION="priority"
INTERVAL="${PRIORITY_INTERVAL:-45}"  # Default: 45 seconds
BATCH_SIZE="${PRIORITY_BATCH_SIZE:-15}"

# Start daemon
exec "$SCRIPT_DIR/scripts/daemon_wrapper.sh" "$DAEMON_NAME" "$OPERATION" "$INTERVAL" "$BATCH_SIZE"