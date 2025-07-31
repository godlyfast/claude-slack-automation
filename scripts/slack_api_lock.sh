#!/bin/bash

# Slack API Lock Manager
# Prevents concurrent Slack API requests from fetch and send operations

LOCK_FILE="${TEMP_DIR:-/tmp}/slack_api.lock"
LOCK_TIMEOUT=300  # 5 minutes max lock time

# Acquire lock with timeout
acquire_slack_lock() {
    local start_time=$(date +%s)
    local lock_acquired=false
    
    while [ "$lock_acquired" = false ]; do
        # Try to create lock file atomically
        if (set -C; echo "$$" > "$LOCK_FILE") 2>/dev/null; then
            lock_acquired=true
            return 0
        fi
        
        # Check if lock is stale (older than timeout)
        if [ -f "$LOCK_FILE" ]; then
            local lock_age=$(($(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
            if [ "$lock_age" -gt "$LOCK_TIMEOUT" ]; then
                echo "[WARN] Removing stale lock (age: ${lock_age}s)" >&2
                rm -f "$LOCK_FILE"
                continue
            fi
        fi
        
        # Check if we've been waiting too long
        local wait_time=$(($(date +%s) - start_time))
        if [ "$wait_time" -gt 60 ]; then
            echo "[ERROR] Failed to acquire Slack API lock after 60s" >&2
            return 1
        fi
        
        # Wait a bit before retrying
        sleep 0.5
    done
}

# Release lock
release_slack_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ "$lock_pid" = "$$" ]; then
            rm -f "$LOCK_FILE"
            return 0
        else
            echo "[WARN] Lock owned by different process: $lock_pid (current: $$)" >&2
            return 1
        fi
    fi
    return 0
}

# Ensure lock is released on exit
cleanup_slack_lock() {
    release_slack_lock
}

# Export functions for use in other scripts
export -f acquire_slack_lock
export -f release_slack_lock
export -f cleanup_slack_lock