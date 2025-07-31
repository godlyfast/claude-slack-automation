#!/bin/bash

# Daemon Wrapper Script
# Provides common daemon functionality for queue operations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Daemon configuration
DAEMON_NAME="${1:-daemon}"
OPERATION="${2:-}"
INTERVAL="${3:-60}"
BATCH_SIZE="${4:-10}"

PID_FILE="$LOG_DIR/${DAEMON_NAME}.pid"
DAEMON_LOG="$LOG_DIR/${DAEMON_NAME}.log"
DAEMON_ERROR_LOG="$LOG_DIR/${DAEMON_NAME}_errors.log"

# Signal handlers
handle_sigterm() {
    log "$DAEMON_LOG" "Received SIGTERM, shutting down gracefully..."
    RUNNING=false
}

handle_sigint() {
    log "$DAEMON_LOG" "Received SIGINT, shutting down gracefully..."
    RUNNING=false
}

# Set up signal handlers
trap handle_sigterm SIGTERM
trap handle_sigint SIGINT

# Check if daemon is already running
check_daemon_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0  # Daemon is running
        else
            rm -f "$PID_FILE"  # Stale PID file
        fi
    fi
    return 1  # Daemon is not running
}

# Start daemon
start_daemon() {
    if check_daemon_running; then
        echo "Daemon $DAEMON_NAME is already running (PID: $(cat "$PID_FILE"))"
        exit 1
    fi
    
    # Store PID
    echo $$ > "$PID_FILE"
    
    log "$DAEMON_LOG" "Starting $DAEMON_NAME daemon (PID: $$)"
    log "$DAEMON_LOG" "Operation: $OPERATION, Interval: ${INTERVAL}s, Batch Size: $BATCH_SIZE"
    
    RUNNING=true
    local error_count=0
    local max_errors=10
    
    while $RUNNING; do
        # Execute the operation
        log "$DAEMON_LOG" "Executing $OPERATION operation..."
        
        if "$SCRIPT_DIR/queue_operations.sh" "$OPERATION" "$BATCH_SIZE" >> "$DAEMON_LOG" 2>> "$DAEMON_ERROR_LOG"; then
            log "$DAEMON_LOG" "Operation completed successfully"
            error_count=0
        else
            error_count=$((error_count + 1))
            log_error "$DAEMON_ERROR_LOG" "Operation failed (error count: $error_count)"
            
            if [ $error_count -ge $max_errors ]; then
                log_error "$DAEMON_ERROR_LOG" "Too many consecutive errors ($error_count), shutting down"
                RUNNING=false
                break
            fi
        fi
        
        # Sleep for the interval (check every second for shutdown signal)
        for ((i=0; i<$INTERVAL && $RUNNING; i++)); do
            sleep 1
        done
    done
    
    # Cleanup
    rm -f "$PID_FILE"
    log "$DAEMON_LOG" "$DAEMON_NAME daemon stopped"
}

# Main execution
if [ -z "$OPERATION" ]; then
    echo "Usage: $0 <daemon_name> <operation> [interval] [batch_size]"
    echo "Operations: fetch, process, send, priority"
    exit 1
fi

start_daemon