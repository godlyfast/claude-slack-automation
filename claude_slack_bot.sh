#!/bin/bash

# Claude Slack Bot - Simplified Node.js Service Version
# This version delegates all complex logic to the Node.js service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

# Configuration
SERVICE_URL="${SERVICE_URL:-http://localhost:3030}"
LOG_FILE="$SCRIPT_DIR/${LOG_DIR:-logs}/claude_slack_bot.log"
ERROR_LOG="$SCRIPT_DIR/${LOG_DIR:-logs}/claude_slack_bot_errors.log"

mkdir -p "$SCRIPT_DIR/${LOG_DIR:-logs}"

# Lock file to prevent concurrent execution
LOCK_FILE="$SCRIPT_DIR/${LOG_DIR:-logs}/claude_slack_bot.lock"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    if [ "$DEBUG_MODE" = "true" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >> "$ERROR_LOG"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

# Cleanup function to remove lock file
cleanup() {
    if [ -f "$LOCK_FILE" ]; then
        rm -f "$LOCK_FILE"
        log_message "Lock file removed"
    fi
}

# Set up trap to clean up lock file on exit
trap cleanup EXIT INT TERM

# Check if another instance is running
if [ -f "$LOCK_FILE" ]; then
    # Check if the PID in lock file is still running
    LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
        log_message "Another bot instance is already running (PID: $LOCK_PID). Exiting."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another bot instance is already running (PID: $LOCK_PID). Exiting."
        exit 0
    else
        log_message "Stale lock file found. Removing it."
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock file with current PID
echo $$ > "$LOCK_FILE"

# Start logging
log_message "Starting Simplified Claude Slack Bot... (PID: $$)"

# Check if Node.js service is running
SERVICE_STATUS=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" "$SERVICE_URL/health" 2>/dev/null)
if [ "$SERVICE_STATUS" != "200" ]; then
    log_error "Node.js service is not running at $SERVICE_URL"
    log_message "Starting Node.js service..."
    
    # Start the service
    cd "$SCRIPT_DIR/slack-service"
    npm start > "$SCRIPT_DIR/logs/slack-service.log" 2>&1 &
    SERVICE_PID=$!
    
    # Wait for service to start
    sleep 5
    
    # Check again
    SERVICE_STATUS=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" "$SERVICE_URL/health" 2>/dev/null)
    if [ "$SERVICE_STATUS" != "200" ]; then
        log_error "Failed to start Node.js service"
        exit 1
    fi
    
    log_message "Node.js service started with PID $SERVICE_PID"
fi

# Fetch unresponded messages from Node.js service
log_message "Fetching unresponded messages..."
MESSAGES_JSON=$(curl -s --max-time ${API_TIMEOUT:-10} "$SERVICE_URL${UNRESPONDED_ENDPOINT:-/messages/unresponded}")

if [ $? -ne 0 ]; then
    log_error "Failed to fetch messages from service"
    exit 1
fi

# Extract message count
MESSAGE_COUNT=$(echo "$MESSAGES_JSON" | jq -r '.count // 0')
log_message "Found $MESSAGE_COUNT unresponded messages"

if [ "$MESSAGE_COUNT" -eq 0 ]; then
    log_message "No new messages to respond to"
    exit 0
fi

# Process messages with Claude via the Node.js service
log_message "Processing messages with Claude..."

# Send all messages to the Node.js service for processing
PROCESS_RESULT=$(curl -s --max-time $((${CLAUDE_TIMEOUT:-30} * ${MESSAGE_COUNT} + 30)) \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$MESSAGES_JSON" \
    "$SERVICE_URL/messages/process-with-claude")

if [ $? -ne 0 ]; then
    log_error "Failed to process messages with Claude"
    exit 1
fi

# Check results
PROCESSED_COUNT=$(echo "$PROCESS_RESULT" | jq -r '.processed // 0')
log_message "Processed $PROCESSED_COUNT messages"

# Log any errors
echo "$PROCESS_RESULT" | jq -r '.results[]? | select(.success == false) | "Failed to process message \(.messageId): \(.error)"' | while read -r error_line; do
    if [ -n "$error_line" ]; then
        log_error "$error_line"
    fi
done

log_message "Bot check completed"
log_message "----------------------------------------"

exit 0