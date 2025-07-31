#!/bin/bash

# Process Daemon - Continuously processes messages with Claude

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"

# Configuration
DAEMON_NAME="process_daemon"
OPERATION="process"
INTERVAL="${PROCESS_INTERVAL:-60}"  # Default: 1 minute
BATCH_SIZE="${PROCESS_BATCH_SIZE:-10}"

# Start daemon
exec "$SCRIPT_DIR/scripts/daemon_wrapper.sh" "$DAEMON_NAME" "$OPERATION" "$INTERVAL" "$BATCH_SIZE"