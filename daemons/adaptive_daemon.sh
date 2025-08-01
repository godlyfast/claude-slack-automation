#!/bin/bash

# Adaptive Daemon - Intelligently switches between send and fetch operations
# Sends pending messages every minute, fetches new messages when queue is empty

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Configuration
DAEMON_NAME="adaptive_daemon"
PID_FILE="$LOG_DIR/${DAEMON_NAME}.pid"
DAEMON_LOG="$LOG_DIR/${DAEMON_NAME}.log"
DAEMON_ERROR_LOG="$LOG_DIR/${DAEMON_NAME}_errors.log"

# Intervals
SEND_CHECK_INTERVAL=60      # Check for pending messages every minute
FETCH_COOLDOWN=60           # Wait 1 minute between fetches (Slack 2025 rate limit)
SEND_BATCH_SIZE="${SEND_BATCH_SIZE:-20}"
FETCH_BATCH_SIZE="${FETCH_BATCH_SIZE:-50}"

# Track last fetch time
LAST_FETCH_TIME=0

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
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Adaptive daemon is already running (PID: $OLD_PID)"
        exit 1
    else
        rm -f "$PID_FILE"
    fi
fi

# Start daemon
echo $$ > "$PID_FILE"
log "$DAEMON_LOG" "Starting adaptive daemon (PID: $$)"
log "$DAEMON_LOG" "Strategy: Send pending messages every minute, fetch when queue is empty"

RUNNING=true
ERROR_COUNT=0
MAX_ERRORS=10

while $RUNNING; do
    # Check for pending responses
    PENDING_RESPONSES=$(get_db_count "response_queue" "status='pending'" 2>/dev/null || echo "0")
    
    if [ "$PENDING_RESPONSES" -gt 0 ]; then
        # We have pending messages to send
        log "$DAEMON_LOG" "Found $PENDING_RESPONSES pending responses. Sending..."
        
        if "$SCRIPT_DIR/queue_operations.sh" send "$SEND_BATCH_SIZE" >> "$DAEMON_LOG" 2>> "$DAEMON_ERROR_LOG"; then
            log "$DAEMON_LOG" "Send operation completed successfully"
            ERROR_COUNT=0
        else
            ERROR_COUNT=$((ERROR_COUNT + 1))
            log_error "$DAEMON_ERROR_LOG" "Send operation failed (error count: $ERROR_COUNT)"
        fi
    else
        # No pending messages, check if we should fetch
        CURRENT_TIME=$(date +%s)
        TIME_SINCE_FETCH=$((CURRENT_TIME - LAST_FETCH_TIME))
        
        if [ $TIME_SINCE_FETCH -ge $FETCH_COOLDOWN ]; then
            log "$DAEMON_LOG" "No pending responses. Fetching new messages..."
            
            if "$SCRIPT_DIR/queue_operations.sh" fetch >> "$DAEMON_LOG" 2>> "$DAEMON_ERROR_LOG"; then
                log "$DAEMON_LOG" "Fetch operation completed successfully"
                LAST_FETCH_TIME=$CURRENT_TIME
                ERROR_COUNT=0
                
                # After fetching, check if we got new messages to process
                PENDING_MESSAGES=$(get_db_count "message_queue" "status='pending'" 2>/dev/null || echo "0")
                if [ "$PENDING_MESSAGES" -gt 0 ]; then
                    log "$DAEMON_LOG" "Found $PENDING_MESSAGES new messages. Processing..."
                    "$SCRIPT_DIR/queue_operations.sh" process 10 >> "$DAEMON_LOG" 2>> "$DAEMON_ERROR_LOG"
                fi
            else
                ERROR_COUNT=$((ERROR_COUNT + 1))
                log_error "$DAEMON_ERROR_LOG" "Fetch operation failed (error count: $ERROR_COUNT)"
            fi
        else
            WAIT_TIME=$((FETCH_COOLDOWN - TIME_SINCE_FETCH))
            log "$DAEMON_LOG" "No pending responses. Next fetch in $WAIT_TIME seconds"
        fi
    fi
    
    # Check error count
    if [ $ERROR_COUNT -ge $MAX_ERRORS ]; then
        log_error "$DAEMON_ERROR_LOG" "Too many consecutive errors ($ERROR_COUNT), shutting down"
        RUNNING=false
        break
    fi
    
    # Run monitor to check for stuck operations (every 5 minutes)
    if [ $((LOOP_COUNT % 5)) -eq 0 ]; then
        "$SCRIPT_DIR/scripts/monitor_operations.sh" >> "$DAEMON_LOG" 2>&1
    fi
    
    # Sleep for one minute (check every second for shutdown signal)
    for ((i=0; i<$SEND_CHECK_INTERVAL && $RUNNING; i++)); do
        sleep 1
    done
done

# Cleanup
rm -f "$PID_FILE"
log "$DAEMON_LOG" "Adaptive daemon stopped"