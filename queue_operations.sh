#!/bin/bash

# Unified Queue Operations Script
# Combines fetch, process, and send operations with common functions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load common functions
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Load Slack API lock functions
source "$SCRIPT_DIR/scripts/slack_api_lock.sh"

# Operation-specific log files
FETCH_LOG="$LOG_DIR/queue_fetcher.log"
PROCESS_LOG="$LOG_DIR/queue_processor.log"
SEND_LOG="$LOG_DIR/queue_sender.log"

# Fetch messages from Slack
fetch_messages() {
    log "$FETCH_LOG" "Queue Fetcher started"
    
    if ! check_service_health; then
        log_error "$FETCH_LOG" "Node.js service is not responding at ${SERVICE_URL}"
        return 1
    fi
    
    # Set up cleanup trap
    trap cleanup_slack_lock EXIT
    
    local max_retries="${MAX_RETRIES:-3}"  # Reduced from 1000 to prevent infinite loops
    local retry_count=0
    local success=false
    local start_time=$(date +%s)
    local timeout_seconds="${FETCH_TIMEOUT:-300}"  # 5 minute timeout
    
    while [ $retry_count -lt $max_retries ] && [ "$success" = "false" ]; do
        retry_count=$((retry_count + 1))
        
        # Check timeout
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        if [ $elapsed -gt $timeout_seconds ]; then
            log_error "$FETCH_LOG" "Fetch operation timed out after ${elapsed} seconds"
            return 1
        fi
        
        log "$FETCH_LOG" "Attempt $retry_count/$max_retries: Fetching messages from Slack..."
        
        # Acquire lock before making Slack API request
        if ! acquire_slack_lock; then
            log_error "$FETCH_LOG" "Failed to acquire Slack API lock"
            return 1
        fi
        
        # Execute API call with timeout
        (
            RESULT=$(timeout ${API_TIMEOUT} curl -s -m ${API_TIMEOUT} -X POST "${SERVICE_URL}/queue/messages" 2>&1)
            EXIT_CODE=$?
            echo "$RESULT" > "${TEMP_DIR}/fetch_result.tmp"
            echo "$EXIT_CODE" > "${TEMP_DIR}/fetch_exit.tmp"
        )
        
        # Always release lock after API call
        release_slack_lock
        
        # Read results
        RESULT=$(cat "${TEMP_DIR}/fetch_result.tmp" 2>/dev/null || echo "{}")
        EXIT_CODE=$(cat "${TEMP_DIR}/fetch_exit.tmp" 2>/dev/null || echo "1")
        rm -f "${TEMP_DIR}/fetch_result.tmp" "${TEMP_DIR}/fetch_exit.tmp"
        
        if [ $EXIT_CODE -eq 0 ] && echo "$RESULT" | jq -e '.success' >/dev/null 2>&1; then
            FETCHED=$(echo "$RESULT" | jq -r '.fetched // 0')
            QUEUED=$(echo "$RESULT" | jq -r '.queued // 0')
            log "$FETCH_LOG" "SUCCESS: Fetched $FETCHED messages, queued $QUEUED new messages"
            success=true
        else
            ERROR_MSG=$(echo "$RESULT" | jq -r '.error // "Unknown error"' 2>/dev/null || echo "$RESULT")
            
            if echo "$ERROR_MSG" | grep -q "rate limit"; then
                # Extract retry-after value if available (usually 60 seconds for Slack)
                RETRY_AFTER=$(echo "$ERROR_MSG" | grep -oE "retry-after: [0-9]+" | grep -oE "[0-9]+" || echo "${QUEUE_RETRY_DELAY}")
                log "$FETCH_LOG" "Rate limited by Slack API. Waiting ${RETRY_AFTER} seconds as per retry-after header..."
                
                # Check if waiting would exceed timeout
                local current_time=$(date +%s)
                local elapsed=$((current_time - start_time))
                local remaining=$((timeout_seconds - elapsed))
                if [ $RETRY_AFTER -gt $remaining ]; then
                    log_error "$FETCH_LOG" "Rate limit wait time ($RETRY_AFTER seconds) exceeds remaining timeout. Exiting."
                    return 1
                fi
                
                # Add 5 seconds buffer to avoid hitting limit immediately again
                sleep $((RETRY_AFTER + 5))
            else
                log_error "$FETCH_LOG" "$ERROR_MSG"
                
                # Exit on connection errors to avoid infinite loops
                if echo "$ERROR_MSG" | grep -qE "(Connection refused|Failed to connect|timeout|Could not resolve)"; then
                    log_error "$FETCH_LOG" "Service connection error. Exiting."
                    return 1
                fi
                
                log "$FETCH_LOG" "Waiting 10 seconds before retry..."
                sleep 10
            fi
        fi
    done
    
    if [ "$success" = "true" ]; then
        log "$FETCH_LOG" "Queue Fetcher completed successfully"
        return 0
    else
        log_error "$FETCH_LOG" "Queue Fetcher failed after $max_retries attempts"
        return 1
    fi
}

# Process messages with Claude
process_messages() {
    local batch_size="${1:-${QUEUE_BATCH_SIZE}}"
    log "$PROCESS_LOG" "Queue Processor started (batch size: $batch_size)"
    
    if ! check_service_health; then
        log_error "$PROCESS_LOG" "Node.js service is not responding at ${SERVICE_URL}"
        return 1
    fi
    
    log "$PROCESS_LOG" "Processing pending messages from database..."
    
    # First, fetch pending messages from the queue
    PENDING_MESSAGES=$(curl -s "${SERVICE_URL}/queue/messages/pending?limit=${batch_size}" 2>&1)
    
    if [ $? -ne 0 ] || ! echo "$PENDING_MESSAGES" | jq -e '.success' >/dev/null 2>&1; then
        log_error "$PROCESS_LOG" "Failed to fetch pending messages"
        return 1
    fi
    
    # Extract just the messages array
    MESSAGES_ARRAY=$(echo "$PENDING_MESSAGES" | jq '.messages')
    MESSAGE_COUNT=$(echo "$MESSAGES_ARRAY" | jq 'length')
    
    if [ "$MESSAGE_COUNT" -eq 0 ]; then
        log "$PROCESS_LOG" "No pending messages to process"
        return 0
    fi
    
    log "$PROCESS_LOG" "Found $MESSAGE_COUNT pending messages to process"
    
    # 🚨 CRITICAL: MUST use process-with-claude endpoint for channel history
    # NEVER use /queue/process - it lacks context and violates architecture
    RESULT=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"messages\": $MESSAGES_ARRAY}" \
        "${SERVICE_URL}/messages/process-with-claude" 2>&1)
    
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ] && echo "$RESULT" | jq -e '.success' >/dev/null 2>&1; then
        PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0')
        RESULTS=$(echo "$RESULT" | jq -r '.results // []')
        
        # Count successes and failures
        SUCCEEDED=$(echo "$RESULTS" | jq '[.[] | select(.success == true)] | length' 2>/dev/null || echo "0")
        FAILED=$(echo "$RESULTS" | jq '[.[] | select(.success == false)] | length' 2>/dev/null || echo "0")
        
        log "$PROCESS_LOG" "Processed $PROCESSED messages: $SUCCEEDED succeeded, $FAILED failed"
        
        # Log any errors
        if [ "$FAILED" -gt 0 ]; then
            echo "$RESULTS" | jq -r '.[] | select(.success == false) | "  Error for message \(.messageId): \(.error)"' 2>/dev/null | while read -r line; do
                [ -n "$line" ] && log_error "$PROCESS_LOG" "$line"
            done
        fi
        
        log "$PROCESS_LOG" "Queue Processor completed successfully"
        return 0
    else
        ERROR_MSG=$(echo "$RESULT" | jq -r '.error // "Unknown error"' 2>/dev/null || echo "$RESULT")
        log_error "$PROCESS_LOG" "$ERROR_MSG"
        log_error "$PROCESS_LOG" "Queue Processor failed"
        return 1
    fi
}

# Send responses to Slack
send_responses() {
    local batch_size="${1:-${QUEUE_BATCH_SIZE}}"
    log "$SEND_LOG" "Queue Sender started (batch size: $batch_size)"
    
    if ! check_service_health; then
        log_error "$SEND_LOG" "Node.js service is not responding at ${SERVICE_URL}"
        return 1
    fi
    
    # Set up cleanup trap
    trap cleanup_slack_lock EXIT
    
    local max_retries="${MAX_RETRIES:-3}"  # Reduced from 1000 to prevent infinite loops
    local retry_count=0
    local all_sent=false
    local start_time=$(date +%s)
    local timeout_seconds="${SEND_TIMEOUT:-300}"  # 5 minute timeout
    
    while [ $retry_count -lt $max_retries ] && [ "$all_sent" = "false" ]; do
        retry_count=$((retry_count + 1))
        
        # Check timeout
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        if [ $elapsed -gt $timeout_seconds ]; then
            log_error "$SEND_LOG" "Send operation timed out after ${elapsed} seconds"
            return 1
        fi
        
        # Check pending count
        PENDING_COUNT=$(get_db_count "response_queue" "status='pending'")
        
        if [ "$PENDING_COUNT" -eq "0" ]; then
            log "$SEND_LOG" "No pending responses to send"
            all_sent=true
            break
        fi
        
        log "$SEND_LOG" "Attempt $retry_count: Sending $PENDING_COUNT pending responses to Slack..."
        
        # Acquire lock before making Slack API request
        if ! acquire_slack_lock; then
            log_error "$SEND_LOG" "Failed to acquire Slack API lock"
            return 1
        fi
        
        # Execute API call in a subshell to ensure lock release
        (
            RESULT=$(curl -s -X POST \
                -H "Content-Type: application/json" \
                -d "{\"batchSize\": ${batch_size}}" \
                "${SERVICE_URL}/queue/send-responses" 2>&1)
            EXIT_CODE=$?
            echo "$RESULT" > "${TEMP_DIR}/send_result.tmp"
            echo "$EXIT_CODE" > "${TEMP_DIR}/send_exit.tmp"
        )
        
        # Always release lock after API call
        release_slack_lock
        
        # Read results
        RESULT=$(cat "${TEMP_DIR}/send_result.tmp" 2>/dev/null || echo "{}")
        EXIT_CODE=$(cat "${TEMP_DIR}/send_exit.tmp" 2>/dev/null || echo "1")
        rm -f "${TEMP_DIR}/send_result.tmp" "${TEMP_DIR}/send_exit.tmp"
        
        if [ $EXIT_CODE -eq 0 ] && echo "$RESULT" | jq -e '.success' >/dev/null 2>&1; then
            SENT=$(echo "$RESULT" | jq -r '.sent // 0')
            FAILED=$(echo "$RESULT" | jq -r '.failed // 0')
            MESSAGE=$(echo "$RESULT" | jq -r '.message // ""')
            
            if [ -n "$MESSAGE" ]; then
                log "$SEND_LOG" "$MESSAGE"
            elif [ $SENT -gt 0 ]; then
                log "$SEND_LOG" "Sent $SENT responses successfully, $FAILED failed"
            fi
            
            if [ $FAILED -eq 0 ] || [ $SENT -eq 0 ]; then
                REMAINING=$(get_db_count "response_queue" "status='pending'")
                if [ "$REMAINING" -eq "0" ]; then
                    all_sent=true
                else
                    log "$SEND_LOG" "$REMAINING responses remaining, continuing..."
                    sleep 2
                fi
            else
                log "$SEND_LOG" "Some responses failed, waiting ${QUEUE_RETRY_DELAY} seconds for rate limit..."
                sleep ${QUEUE_RETRY_DELAY}
            fi
        else
            ERROR_MSG=$(echo "$RESULT" | jq -r '.error // "Unknown error"' 2>/dev/null || echo "$RESULT")
            log_error "$SEND_LOG" "$ERROR_MSG"
            log "$SEND_LOG" "Waiting 30 seconds before retry..."
            sleep 30
        fi
    done
    
    if [ "$all_sent" = "true" ]; then
        log "$SEND_LOG" "Queue Sender completed successfully"
        return 0
    else
        log_error "$SEND_LOG" "Queue Sender stopped after $max_retries attempts"
        return 1
    fi
}

# Show queue status
show_status() {
    echo "Queue Status at $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=================================="
    
    if check_service_health; then
        echo "Service: ✅ Online"
    else
        echo "Service: ❌ Offline"
    fi
    
    echo ""
    echo "Pending Messages: $(get_db_count 'message_queue' "status='pending'")"
    echo "Processing: $(get_db_count 'message_queue' "status='processing'")"
    echo "Pending Responses: $(get_db_count 'response_queue' "status='pending'")"
    
    # Get status from API
    STATUS=$(curl -s "${SERVICE_URL}/queue/messages/pending?limit=1" 2>/dev/null)
    if [ $? -eq 0 ]; then
        API_COUNT=$(echo "$STATUS" | jq -r '.count // 0' 2>/dev/null || echo "0")
        echo "API Queue Count: $API_COUNT"
    fi
}

# Main function
main() {
    local operation="${1:-status}"
    shift
    
    case "$operation" in
        fetch)
            fetch_messages
            ;;
        process)
            process_messages "$@"
            ;;
        send)
            send_responses "$@"
            ;;
        all)
            # Priority: Always send pending responses first
            PENDING_RESPONSES=$(get_db_count "response_queue" "status='pending'")
            if [ "$PENDING_RESPONSES" -gt 0 ]; then
                echo "Found $PENDING_RESPONSES pending responses. Sending first (priority)..."
                send_responses "$@"
                sleep 2
            fi
            
            # Then fetch new messages
            fetch_messages && sleep 2 && process_messages "$@" && sleep 2 && send_responses "$@"
            ;;
        priority)
            # Priority mode: Send first, then fetch/process if no pending
            PENDING_RESPONSES=$(get_db_count "response_queue" "status='pending'")
            if [ "$PENDING_RESPONSES" -gt 0 ]; then
                echo "Priority: Sending $PENDING_RESPONSES pending responses..."
                send_responses "$@"
            else
                echo "No pending responses. Checking for new messages..."
                fetch_messages && sleep 2
                PENDING_MESSAGES=$(get_db_count "message_queue" "status='pending'")
                if [ "$PENDING_MESSAGES" -gt 0 ]; then
                    process_messages "$@" && sleep 2 && send_responses "$@"
                fi
            fi
            ;;
        status)
            show_status
            ;;
        *)
            echo "Usage: $0 {fetch|process|send|all|priority|status} [batch_size]"
            echo ""
            echo "Operations:"
            echo "  fetch    - Fetch messages from Slack"
            echo "  process  - Process messages with Claude"
            echo "  send     - Send responses to Slack"
            echo "  all      - Run all operations in sequence (send first)"
            echo "  priority - Send pending responses first, then fetch/process only if none"
            echo "  status   - Show queue status"
            echo ""
            echo "Examples:"
            echo "  $0 fetch"
            echo "  $0 process 10"
            echo "  $0 send 20"
            echo "  $0 all 15"
            echo "  $0 priority 10"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"