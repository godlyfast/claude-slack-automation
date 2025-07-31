#!/bin/bash

# Common Functions Library for Claude Slack Bot
# This file consolidates shared functions across all scripts

# Get script directory and load configuration
COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
source "$COMMON_SCRIPT_DIR/config.env"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log() {
    local log_file="${1:-$LOG_DIR/general.log}"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$log_file"
}

log_error() {
    local error_log="${1:-$LOG_DIR/errors.log}"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$error_log" >&2
}

log_debug() {
    if [ "$DEBUG_MODE" = "true" ]; then
        local debug_log="${1:-$LOG_DIR/debug.log}"
        shift
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: $*" >> "$debug_log"
    fi
}

# Service health check function
check_service_health() {
    local max_time="${1:-5}"
    curl -s --max-time "$max_time" "${SERVICE_URL}${HEALTH_ENDPOINT}" >/dev/null 2>&1
    return $?
}

# Get service health status
get_service_status() {
    if check_service_health; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Wait for service to be ready
wait_for_service() {
    local timeout="${1:-30}"
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        if check_service_health 2; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    
    return 1
}

# Check if Node.js service is running on port
is_service_running() {
    lsof -Pi :${SERVICE_PORT} -sTCP:LISTEN -t >/dev/null 2>&1
}

# Format file size for display
format_size() {
    local size=$1
    if [ $size -ge 1048576 ]; then
        echo "$((size / 1048576))MB"
    elif [ $size -ge 1024 ]; then
        echo "$((size / 1024))KB"
    else
        echo "${size}B"
    fi
}

# Get database count for a table
get_db_count() {
    local table="$1"
    local condition="${2:-1=1}"
    sqlite3 "$DATABASE_FILE" "SELECT COUNT(*) FROM $table WHERE $condition;" 2>/dev/null || echo "0"
}

# Execute database query safely
db_query() {
    local query="$1"
    sqlite3 "$DATABASE_FILE" "$query" 2>/dev/null
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Create lock file
create_lock() {
    local lock_file="${1:-$LOG_DIR/operation.lock}"
    if [ -f "$lock_file" ]; then
        local pid=$(cat "$lock_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 1  # Lock exists and process is running
        else
            rm -f "$lock_file"  # Stale lock
        fi
    fi
    echo $$ > "$lock_file"
    return 0
}

# Remove lock file
remove_lock() {
    local lock_file="${1:-$LOG_DIR/operation.lock}"
    rm -f "$lock_file"
}

# Ensure required directories exist
ensure_directories() {
    mkdir -p "$LOG_DIR" "$DATA_DIR" "$TEMP_DIR" 2>/dev/null
}

# Export functions for use in other scripts
export -f log log_error log_debug
export -f check_service_health get_service_status wait_for_service
export -f is_service_running format_size
export -f get_db_count db_query
export -f command_exists create_lock remove_lock
export -f ensure_directories