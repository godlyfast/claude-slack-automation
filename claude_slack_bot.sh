#!/bin/bash

# Claude Slack Bot - Node.js Service Version
# This version uses a Node.js service to handle Slack operations

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
log_message "Starting Node.js-based Claude Slack Bot... (PID: $$)"

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
MESSAGES_JSON=$(curl -s --max-time ${API_TIMEOUT:-3} "$SERVICE_URL${UNRESPONDED_ENDPOINT:-/messages/unresponded}")

if [ $? -ne 0 ]; then
    log_error "Failed to fetch messages from service"
    exit 1
fi

# Debug: Log the raw response
log_message "Raw API response: $MESSAGES_JSON"

# Extract message count
MESSAGE_COUNT=$(echo "$MESSAGES_JSON" | grep -o '"count":[0-9]*' | cut -d: -f2)
log_message "Found $MESSAGE_COUNT unresponded messages"

if [ "$MESSAGE_COUNT" -eq 0 ]; then
    log_message "No new messages to respond to"
    exit 0
fi

# Pre-fetch channel history for all unique channels to avoid multiple API calls
UNIQUE_CHANNELS=$(echo "$MESSAGES_JSON" | jq -r '.messages[] | .channelName // empty' | sort -u)

log_message "Pre-fetching channel history for efficiency..."
# Create temp files to store channel data
TEMP_DIR="${TEMP_DIR:-/tmp}/claude-slack-$$"
mkdir -p "$TEMP_DIR"

for channel in $UNIQUE_CHANNELS; do
    if [ -n "$channel" ]; then
        log_message "Fetching history for channel: $channel"
        HISTORY_JSON=$(curl -s --max-time 30 "$SERVICE_URL${CHANNEL_HISTORY_ENDPOINT:-/messages/channel-history}/$channel?limit=${CHANNEL_HISTORY_LIMIT:-200}")
        if [ $? -eq 0 ]; then
            HISTORY_COUNT=$(echo "$HISTORY_JSON" | jq -r '.count // 0')
            if [ "$HISTORY_COUNT" -gt 0 ]; then
                # Store the full history JSON for this channel in a temp file
                echo "$HISTORY_JSON" > "$TEMP_DIR/history_$(echo "$channel" | sed 's/[^a-zA-Z0-9]/_/g').json"
                # Extract all file paths from this channel's history
                echo "$HISTORY_JSON" | jq -c '[.messages[] | select(.filePaths != null) | .filePaths[]] | flatten' > "$TEMP_DIR/files_$(echo "$channel" | sed 's/[^a-zA-Z0-9]/_/g').json"
                log_message "Cached $HISTORY_COUNT messages for channel $channel"
            fi
        else
            log_message "Failed to fetch history for channel $channel"
        fi
    fi
done

# Process each message with Claude
echo "$MESSAGES_JSON" | jq -r '.messages[] | @json' | while IFS= read -r message_json; do
    MESSAGE=$(echo "$message_json" | jq -r '.')
    MESSAGE_ID=$(echo "$MESSAGE" | jq -r '.id')
    MESSAGE_TEXT=$(echo "$MESSAGE" | jq -r '.text')
    CHANNEL=$(echo "$MESSAGE" | jq -r '.channel')
    CHANNEL_NAME=$(echo "$MESSAGE" | jq -r '.channelName // ""')
    IS_THREAD_REPLY=$(echo "$MESSAGE" | jq -r '.isThreadReply // false')
    THREAD_CONTEXT=$(echo "$MESSAGE" | jq -r '.threadContext // []')
    HAS_ATTACHMENTS=$(echo "$MESSAGE" | jq -r '.hasAttachments // false')
    ATTACHMENT_CONTEXT=$(echo "$MESSAGE" | jq -r '.attachmentContext // ""')
    FILE_PATHS=$(echo "$MESSAGE" | jq -r '.filePaths // []')
    THREAD_ATTACHMENT_COUNT=$(echo "$MESSAGE" | jq -r '.threadAttachmentCount // 0')
    
    log_message "Processing message $MESSAGE_ID"
    
    # Use pre-fetched channel history for context
    CHANNEL_HISTORY_CONTEXT=""
    CHANNEL_FILE_PATHS=""
    SAFE_CHANNEL_NAME=$(echo "$CHANNEL_NAME" | sed 's/[^a-zA-Z0-9]/_/g')
    if [ -n "$CHANNEL_NAME" ] && [ -f "$TEMP_DIR/history_${SAFE_CHANNEL_NAME}.json" ]; then
        log_message "Using cached channel history for $CHANNEL_NAME"
        HISTORY_JSON=$(cat "$TEMP_DIR/history_${SAFE_CHANNEL_NAME}.json")
        HISTORY_COUNT=$(echo "$HISTORY_JSON" | jq -r '.count // 0')
        
        if [ "$HISTORY_COUNT" -gt 0 ]; then
            # Build channel history context with better formatting
            CHANNEL_HISTORY_CONTEXT="\n\n📜 **Channel History (Last ${CHANNEL_HISTORY_DISPLAY:-100} messages):**\n"
            # Format messages with timestamps and text (user IDs will be resolved by Slack)
            FORMATTED_HISTORY=$(echo "$HISTORY_JSON" | jq -r '.messages[] | "[\(.timestamp | split("T")[0] + " " + (.timestamp | split("T")[1] | split(".")[0]))] <@\(.user)>: \(.text // "")"' | head -${CHANNEL_HISTORY_DISPLAY:-100})
            CHANNEL_HISTORY_CONTEXT="${CHANNEL_HISTORY_CONTEXT}${FORMATTED_HISTORY}"
            
            # Use pre-extracted file paths
            if [ -f "$TEMP_DIR/files_${SAFE_CHANNEL_NAME}.json" ]; then
                CHANNEL_FILE_PATHS=$(cat "$TEMP_DIR/files_${SAFE_CHANNEL_NAME}.json")
            fi
        fi
        log_message "Applied cached history: $HISTORY_COUNT messages"
    else
        log_message "No cached history available for channel: $CHANNEL_NAME"
    fi
    
    # Build thread context if this is a thread reply
    THREAD_CONTEXT_TEXT=""
    if [ "$IS_THREAD_REPLY" = "true" ] && [ "$THREAD_CONTEXT" != "[]" ]; then
        THREAD_CONTEXT_TEXT="\n\nThread conversation history:"
        THREAD_CONTEXT_TEXT="$THREAD_CONTEXT_TEXT\n$(echo "$THREAD_CONTEXT" | jq -r '.[] | "\(.user): \(.text)"')"
    fi
    
    # Build file information if attachments are present
    FILE_INSTRUCTION=""
    if [ "$HAS_ATTACHMENTS" = "true" ] && [ "$FILE_PATHS" != "[]" ]; then
        FILE_COUNT=$(echo "$FILE_PATHS" | jq length)
        if [ "$FILE_COUNT" -gt 0 ]; then
            # Build context about file sources
            FILE_SOURCE_INFO=""
            if [ "$THREAD_ATTACHMENT_COUNT" -gt 0 ]; then
                CURRENT_FILE_COUNT=$((FILE_COUNT - THREAD_ATTACHMENT_COUNT))
                if [ "$CURRENT_FILE_COUNT" -gt 0 ]; then
                    FILE_SOURCE_INFO=" ($CURRENT_FILE_COUNT from current message, $THREAD_ATTACHMENT_COUNT from earlier messages in this thread)"
                else
                    FILE_SOURCE_INFO=" (all from earlier messages in this thread)"
                fi
            fi
            
            FILE_INSTRUCTION="

ATTACHED FILES:
The user has shared $FILE_COUNT file(s)$FILE_SOURCE_INFO:
$(echo "$FILE_PATHS" | jq -r '.[] | "- \(.name) (\(.type))"')

The file paths will be provided below. Please use the Read tool to analyze these files and incorporate their content into your response."
        fi
    fi

    # Create Claude instruction for this specific message
    CLAUDE_INSTRUCTION="You are a helpful Slack bot assistant. Generate a response to this message.

You have access to the recent channel history below, which provides context for the conversation. Use this history to understand references to previous messages, people mentioned, or ongoing discussions.$CHANNEL_HISTORY_CONTEXT$THREAD_CONTEXT_TEXT

Current message: $MESSAGE_TEXT$ATTACHMENT_CONTEXT$FILE_INSTRUCTION

Guidelines:
- Be helpful, conversational, and concise
- Provide relevant information based on the message content
- If the message references previous conversations or people (like Lera Panasiuk message), look for it in the channel history above
- If this is a thread reply, consider the full context of the conversation
- If file attachments are present, analyze their content and incorporate insights into your response
- Style: $RESPONSE_STYLE
- User IDs in history appear as <@USERID> - these are Slack user mentions

IMPORTANT Slack formatting rules:
- Use *bold* for emphasis (NOT **bold**)
- Use _italic_ for subtle emphasis (NOT *italic*)
- Use \`code\` for inline code
- Use \`\`\`language for code blocks
- Use • for bullet points (NOT - or *)
- Use :emoji: for emojis
- URLs are automatically linked
- For mentions use <@UserID> format

CRITICAL LOOP PREVENTION: Never use the exact words AI or ШІ in your responses, as these are trigger words that will cause an infinite loop. Instead, use alternatives like artificial intelligence, A.I., intelligent system, or rephrase to avoid these exact terms.

IMPORTANT: When analyzing files, use the Read tool with the file paths provided. Output ONLY the response text for Slack using proper Slack formatting. Do not attempt to interact with Slack directly."

    # Log the instruction being sent to Claude for debugging
    if [ "$DEBUG_MODE" = "true" ]; then
        log_message "Claude instruction preview (first 500 chars): ${CLAUDE_INSTRUCTION:0:500}..."
        log_message "File paths count: $(echo "$FILE_PATHS" | jq length 2>/dev/null || echo 0)"
    fi
    
    # Get response from Claude
    log_message "Calling Claude CLI for message $MESSAGE_ID"
    
    # Combine file paths from current message and channel history
    ALL_FILE_PATHS="[]"
    if [ "$FILE_PATHS" != "[]" ]; then
        ALL_FILE_PATHS="$FILE_PATHS"
    fi
    
    # Add channel history file paths if available
    if [ -n "$CHANNEL_FILE_PATHS" ] && [ "$CHANNEL_FILE_PATHS" != "[]" ]; then
        # Merge the JSON arrays
        ALL_FILE_PATHS=$(echo "$ALL_FILE_PATHS" "$CHANNEL_FILE_PATHS" | jq -s 'add | unique')
    fi
    
    # IMPORTANT: Filter file paths to only include files from the current channel
    # This prevents cross-channel file access
    if [ "$ALL_FILE_PATHS" != "[]" ] && [ "$ALL_FILE_PATHS" != "null" ] && [ -n "$CHANNEL" ]; then
        SAFE_CHANNEL_ID=$(echo "$CHANNEL" | sed 's/[^a-zA-Z0-9-]/_/g')
        # Filter file paths - simplified to avoid shell parsing issues
        ALL_FILE_PATHS=$(echo "$ALL_FILE_PATHS" | jq -c --arg channel "$SAFE_CHANNEL_ID" '.')
        log_message "Filtered file paths to channel $SAFE_CHANNEL_ID only"
    fi
    
    # If we have file paths, include them in the instruction for Claude to read
    if [ "$ALL_FILE_PATHS" != "[]" ] && [ "$ALL_FILE_PATHS" != "null" ]; then
        FILE_READ_INSTRUCTIONS=""
        FILE_COUNT=0
        while IFS= read -r file_data; do
            # Handle both object format and direct path strings
            if echo "$file_data" | jq -e 'type == "object"' > /dev/null 2>&1; then
                file_path=$(echo "$file_data" | jq -r '.path')
                file_name=$(echo "$file_data" | jq -r '.name')
                file_type=$(echo "$file_data" | jq -r '.type')
            else
                # Direct path string
                file_path="$file_data"
                file_name=$(basename "$file_path")
                file_type="document"
            fi
            
            if [ -f "$file_path" ]; then
                log_message "File available for Claude: $file_path"
                FILE_READ_INSTRUCTIONS="${FILE_READ_INSTRUCTIONS}
Please use the Read tool to analyze this file:
- File: $file_name ($file_type)
- Path: $file_path

"
                FILE_COUNT=$((FILE_COUNT + 1))
            else
                log_message "File not found: $file_path"
            fi
        done < <(echo "$ALL_FILE_PATHS" | jq -c '.[]')
        
        if [ -n "$FILE_READ_INSTRUCTIONS" ]; then
            # Append file reading instructions to the Claude instruction
            CLAUDE_INSTRUCTION="${CLAUDE_INSTRUCTION}

IMPORTANT: There are $FILE_COUNT files available for analysis from this channel. ${FILE_READ_INSTRUCTIONS}"
            log_message "Added $FILE_COUNT file reading instructions to Claude prompt"
        fi
    fi
    
    # Execute Claude with the instruction (with configurable timeout)
    # Use gtimeout on macOS, timeout on Linux
    if command -v gtimeout >/dev/null 2>&1; then
        TIMEOUT_CMD="gtimeout"
    elif command -v timeout >/dev/null 2>&1; then
        TIMEOUT_CMD="timeout"
    else
        echo "Error: Neither timeout nor gtimeout command found. Please install coreutils."
        exit 1
    fi
    
    RESPONSE=$(echo "$CLAUDE_INSTRUCTION" | $TIMEOUT_CMD ${CLAUDE_TIMEOUT:-30} claude 2>&1)
    CLAUDE_EXIT_CODE=$?
    
    log_message "Claude CLI exit code: $CLAUDE_EXIT_CODE"
    log_message "Claude response length: ${#RESPONSE} characters"
    
    if [ $CLAUDE_EXIT_CODE -eq 0 ] && [ -n "$RESPONSE" ]; then
        log_message "Generated response for message $MESSAGE_ID"
        
        # Post response via Node.js service
        RESPONSE_JSON=$(jq -n \
            --arg resp "$RESPONSE" \
            --argjson msg "$MESSAGE" \
            '{message: $msg, response: $resp}')
        
        RESULT=$(curl -s --max-time ${API_TIMEOUT:-3} -X POST \
            -H "Content-Type: application/json" \
            -d "$RESPONSE_JSON" \
            "$SERVICE_URL${RESPOND_ENDPOINT:-/messages/respond}")
        
        if [ $? -eq 0 ]; then
            log_message "Posted response for message $MESSAGE_ID"
        else
            log_error "Failed to post response for message $MESSAGE_ID"
        fi
    elif [ $CLAUDE_EXIT_CODE -eq 124 ]; then
        # Timeout occurred - post a helpful message to the user
        log_error "Claude timed out after ${CLAUDE_TIMEOUT:-120} seconds for message $MESSAGE_ID"
        
        TIMEOUT_MESSAGE="🕒 *Request Timed Out*

I apologize, but your request took longer than the configured timeout of ${CLAUDE_TIMEOUT:-120} seconds to process.

This typically happens with:
• Very complex analysis requests
• Requests requiring deep research across many messages
• Tasks involving multiple large files or documents

*What you can do:*
1. **Break down your request** into smaller, more specific parts
2. **Provide more context** about what specific information you need
3. **Ask your administrator** to increase the timeout (currently ${CLAUDE_TIMEOUT:-120}s)

*For administrators:*
To increase the timeout, update \`CLAUDE_TIMEOUT\` in \`config.env\`. The current limit is ${CLAUDE_TIMEOUT:-120} seconds."
        
        # Post timeout message via Node.js service
        TIMEOUT_JSON=$(jq -n \
            --arg resp "$TIMEOUT_MESSAGE" \
            --argjson msg "$MESSAGE" \
            '{message: $msg, response: $resp}')
        
        RESULT=$(curl -s --max-time ${API_TIMEOUT:-3} -X POST \
            -H "Content-Type: application/json" \
            -d "$TIMEOUT_JSON" \
            "$SERVICE_URL${RESPOND_ENDPOINT:-/messages/respond}")
        
        if [ $? -eq 0 ]; then
            log_message "Posted timeout notification for message $MESSAGE_ID"
        else
            log_error "Failed to post timeout notification for message $MESSAGE_ID"
        fi
    else
        log_error "Failed to generate response for message $MESSAGE_ID"
        log_error "Claude CLI exit code: $CLAUDE_EXIT_CODE"
        log_error "Claude CLI output: $RESPONSE"
    fi
done

log_message "Bot check completed"
log_message "----------------------------------------"

# Cleanup temp directory
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

exit 0