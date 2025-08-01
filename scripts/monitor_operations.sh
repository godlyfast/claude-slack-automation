#!/bin/bash

# Monitor Queue Operations for Stuck Processes
# This script checks for operations running longer than expected and kills them

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common_functions.sh"

# Maximum allowed runtime for operations (in seconds)
FETCH_MAX_RUNTIME="${FETCH_TIMEOUT:-300}"      # 5 minutes
PROCESS_MAX_RUNTIME="${CLAUDE_TIMEOUT:-900}"   # 15 minutes  
SEND_MAX_RUNTIME="${SEND_TIMEOUT:-300}"        # 5 minutes

check_stuck_operations() {
    local found_stuck=false
    
    # Check for stuck fetch operations
    FETCH_PIDS=$(pgrep -f "queue_operations.sh fetch" 2>/dev/null || true)
    if [ -n "$FETCH_PIDS" ]; then
        for PID in $FETCH_PIDS; do
            if [ "$(uname)" = "Darwin" ]; then
                # macOS
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    
                    if [ $RUNTIME -gt $FETCH_MAX_RUNTIME ]; then
                        log_error "$LOG_DIR/monitor.log" "Fetch operation (PID: $PID) running for ${RUNTIME}s (max: ${FETCH_MAX_RUNTIME}s) - KILLING"
                        kill -9 "$PID" 2>/dev/null || true
                        found_stuck=true
                    fi
                fi
            else
                # Linux
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -d "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    
                    if [ $RUNTIME -gt $FETCH_MAX_RUNTIME ]; then
                        log_error "$LOG_DIR/monitor.log" "Fetch operation (PID: $PID) running for ${RUNTIME}s (max: ${FETCH_MAX_RUNTIME}s) - KILLING"
                        kill -9 "$PID" 2>/dev/null || true
                        found_stuck=true
                    fi
                fi
            fi
        done
    fi
    
    # Check for stuck Claude processes
    CLAUDE_PIDS=$(pgrep -f "claude --continue" 2>/dev/null || true)
    if [ -n "$CLAUDE_PIDS" ]; then
        for PID in $CLAUDE_PIDS; do
            if [ "$(uname)" = "Darwin" ]; then
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    
                    if [ $RUNTIME -gt $PROCESS_MAX_RUNTIME ]; then
                        log_error "$LOG_DIR/monitor.log" "Claude process (PID: $PID) running for ${RUNTIME}s (max: ${PROCESS_MAX_RUNTIME}s) - KILLING"
                        kill -9 "$PID" 2>/dev/null || true
                        found_stuck=true
                    fi
                fi
            fi
        done
    fi
    
    # Check for stuck send operations
    SEND_PIDS=$(pgrep -f "queue_operations.sh send" 2>/dev/null || true)
    if [ -n "$SEND_PIDS" ]; then
        for PID in $SEND_PIDS; do
            if [ "$(uname)" = "Darwin" ]; then
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    
                    if [ $RUNTIME -gt $SEND_MAX_RUNTIME ]; then
                        log_error "$LOG_DIR/monitor.log" "Send operation (PID: $PID) running for ${RUNTIME}s (max: ${SEND_MAX_RUNTIME}s) - KILLING"
                        kill -9 "$PID" 2>/dev/null || true
                        found_stuck=true
                    fi
                fi
            fi
        done
    fi
    
    # Clean up any orphaned lock files if no operations are running
    if [ -z "$FETCH_PIDS" ] && [ -z "$SEND_PIDS" ]; then
        if [ -f "/tmp/slack_api.lock" ]; then
            log "$LOG_DIR/monitor.log" "Removing orphaned Slack API lock file"
            rm -f "/tmp/slack_api.lock"
        fi
    fi
    
    return $([ "$found_stuck" = "true" ] && echo 1 || echo 0)
}

# Main monitoring loop
main() {
    log "$LOG_DIR/monitor.log" "Operation monitor started"
    
    # Run check
    if check_stuck_operations; then
        log "$LOG_DIR/monitor.log" "Killed stuck operations"
    fi
    
    # Check if service is healthy
    if ! check_service_health; then
        log_error "$LOG_DIR/monitor.log" "Node.js service is not healthy"
    fi
}

# Run main function
main "$@"