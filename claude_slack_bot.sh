#!/bin/bash

# Claude Slack Bot - Simplified Node.js Service Version
# This version delegates all complex logic to the Node.js service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load common functions
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Ensure directories exist
ensure_directories

# Lock file to prevent concurrent execution
LOCK_FILE="$LOG_DIR/claude_slack_bot.lock"
BOT_LOG="$LOG_DIR/claude_slack_bot.log"
BOT_ERROR_LOG="$LOG_DIR/claude_slack_bot_errors.log"

# Cleanup function to remove lock file
cleanup() {
    remove_lock "$LOCK_FILE"
    log "$BOT_LOG" "Lock file removed"
}

# Set up trap to clean up lock file on exit
trap cleanup EXIT INT TERM

# Main execution
main() {

    log "$BOT_LOG" "Claude Slack Bot started"
    
    # Check if another instance is running
    if ! create_lock "$LOCK_FILE"; then
        LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
        log "$BOT_LOG" "Another bot instance is already running (PID: $LOCK_PID). Exiting."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another bot instance is already running (PID: $LOCK_PID). Exiting."
        exit 0
    fi
    
    # Check if service is running
    if [ "$(get_service_status)" != "running" ]; then
        log_error "$BOT_ERROR_LOG" "Node.js service is not running at ${SERVICE_URL}"
        exit 1
    fi
    
    # PRIORITY: Check if there are pending responses to send first
    PENDING_RESPONSES=$(get_db_count "response_queue" "status='pending'" 2>/dev/null || echo "0")
    if [ "$PENDING_RESPONSES" -gt 0 ]; then
        log "$BOT_LOG" "PRIORITY: Found $PENDING_RESPONSES pending responses. Sending them first..."
        ./queue_operations.sh send 20
        log "$BOT_LOG" "Finished sending pending responses"
    fi

    # Get unresponded messages from service
    log "$BOT_LOG" "Fetching unresponded messages from service..."
    
    RESPONSE=$(curl -s --max-time ${API_TIMEOUT:-90} "${SERVICE_URL}${UNRESPONDED_ENDPOINT}")
    CURL_EXIT=$?
    
    if [ $CURL_EXIT -eq 28 ]; then
        log_error "$BOT_ERROR_LOG" "Request to service timed out after ${API_TIMEOUT:-90} seconds"
        exit 1
    elif [ $CURL_EXIT -ne 0 ]; then
        log_error "$BOT_ERROR_LOG" "Failed to connect to service (curl exit code: $CURL_EXIT)"
        exit 1
    fi
    
    # Check for error in response
    if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
        ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
        log_error "$BOT_ERROR_LOG" "Service returned error: $ERROR_MSG"
        
        # Check if it's a rate limit error
        if echo "$ERROR_MSG" | grep -q "rate limit\|too many requests"; then
            RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.retryAfter // 60')
            log "$BOT_LOG" "Rate limited. Retry after ${RETRY_AFTER} seconds"
        fi
        exit 1
    fi
    
    # Extract messages from response
    MESSAGE_COUNT=$(echo "$RESPONSE" | jq -r '.count // 0')
    log "$BOT_LOG" "Found $MESSAGE_COUNT unresponded messages"
    
    if [ "$MESSAGE_COUNT" -eq 0 ]; then
        log "$BOT_LOG" "No messages to process"
        exit 0
    fi
    
    # Process each message
    echo "$RESPONSE" | jq -c '.messages[]' | while read -r message; do
        MESSAGE_ID=$(echo "$message" | jq -r '.id')
        CHANNEL=$(echo "$message" | jq -r '.channel')
        USER=$(echo "$message" | jq -r '.user')
        TEXT=$(echo "$message" | jq -r '.text')
        THREAD_TS=$(echo "$message" | jq -r '.thread_ts // empty')
        
        log "$BOT_LOG" "Processing message $MESSAGE_ID from user $USER in channel $CHANNEL"
        log_debug "$LOG_DIR/debug.log" "Message text: $TEXT"
        
        # Send to service for processing
        REQUEST_BODY=$(jq -n \
            --arg messageId "$MESSAGE_ID" \
            --arg channel "$CHANNEL" \
            --arg threadTs "$THREAD_TS" \
            '{messageId: $messageId, channel: $channel, threadTs: $threadTs}')
        
        PROCESS_RESPONSE=$(curl -s --max-time ${CLAUDE_TIMEOUT:-120} \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$REQUEST_BODY" \
            "${SERVICE_URL}${RESPOND_ENDPOINT}")
        
        if [ $? -eq 0 ]; then
            if echo "$PROCESS_RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
                log "$BOT_LOG" "Successfully processed message $MESSAGE_ID"
            else
                ERROR=$(echo "$PROCESS_RESPONSE" | jq -r '.error // "Unknown error"')
                log_error "$BOT_ERROR_LOG" "Failed to process message $MESSAGE_ID: $ERROR"
            fi
        else
            log_error "$BOT_ERROR_LOG" "Failed to send message $MESSAGE_ID to service"
        fi
    done
    
    log "$BOT_LOG" "Bot execution completed"
}

# Run main function
main "$@"