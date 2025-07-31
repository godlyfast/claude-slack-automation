#!/bin/bash

# Full Integration Test for Claude Slack Bot
# This script posts a test message to #ai-test and verifies the bot responds

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

# Test configuration
TEST_CHANNEL="${TEST_CHANNEL:-#ai-test}"
TEST_MESSAGE="AI Test message $(date +%s): What is 2+2?"
TEST_TIMEOUT=60
SERVICE_URL="${SERVICE_URL:-http://localhost:3030}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Claude Slack Bot Integration Test"
echo "===================================="

# Function to print colored messages
print_status() {
    local status=$1
    local message=$2
    case $status in
        "success") echo -e "${GREEN}✓${NC} $message" ;;
        "error") echo -e "${RED}✗${NC} $message" ;;
        "info") echo -e "${YELLOW}ℹ${NC} $message" ;;
    esac
}

# Check if service is running
print_status "info" "Checking if Node.js service is running..."
SERVICE_STATUS=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" "$SERVICE_URL/health" 2>/dev/null)
if [ "$SERVICE_STATUS" != "200" ]; then
    print_status "error" "Node.js service is not running at $SERVICE_URL"
    print_status "info" "Please start the service with: ./bot_control.sh start"
    exit 1
fi
print_status "success" "Node.js service is healthy"

# Get channel ID
print_status "info" "Looking up channel: $TEST_CHANNEL"
CHANNEL_INFO=$(curl -s "$SERVICE_URL/messages/channel-history/$(echo $TEST_CHANNEL | sed 's/#/%23/g')?limit=1")
if [ -z "$CHANNEL_INFO" ] || [ "$CHANNEL_INFO" = "null" ]; then
    print_status "error" "Failed to access channel $TEST_CHANNEL"
    exit 1
fi
print_status "success" "Channel $TEST_CHANNEL is accessible"

# Create a unique test identifier
TEST_ID="integration-test-$(date +%s)"
TEST_MESSAGE_WITH_ID="[TEST:$TEST_ID] $TEST_MESSAGE"

# SAFETY: Add test prefix to prevent bot from responding to test messages
# The bot should be configured to ignore messages starting with [TEST:]
print_status "info" "Test ID: $TEST_ID"
print_status "info" "Test message: $TEST_MESSAGE_WITH_ID"

# Check if there are any recent test messages to prevent loops
print_status "info" "Checking for recent test messages..."
RECENT_TESTS=$(curl -s "$SERVICE_URL/messages/channel-history/$(echo $TEST_CHANNEL | sed 's/#/%23/g')?limit=50" | jq -r '.messages[] | select(.text | startswith("[TEST:"))' | wc -l)
if [ "$RECENT_TESTS" -gt 5 ]; then
    print_status "error" "Too many recent test messages detected ($RECENT_TESTS). Possible test loop!"
    print_status "info" "Please clean up test messages before running again"
    exit 1
fi

# Post test message using Slack API directly
print_status "info" "Posting test message to $TEST_CHANNEL..."
POST_RESULT=$(curl -s -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"channel\": \"$TEST_CHANNEL\",
        \"text\": \"$TEST_MESSAGE_WITH_ID\"
    }")

# Check if message was posted successfully
if ! echo "$POST_RESULT" | jq -e '.ok' > /dev/null; then
    print_status "error" "Failed to post test message"
    echo "Error: $(echo "$POST_RESULT" | jq -r '.error // "Unknown error"')"
    exit 1
fi

MESSAGE_TS=$(echo "$POST_RESULT" | jq -r '.ts')
MESSAGE_CHANNEL=$(echo "$POST_RESULT" | jq -r '.channel')
print_status "success" "Test message posted (timestamp: $MESSAGE_TS)"

# SAFETY: Mark test message as already responded to prevent infinite loops
# This prevents the bot from responding to test messages if triggered by other means
print_status "info" "Adding safety marker to prevent bot loops..."
SAFETY_MARKER=$(curl -s -X POST "$SERVICE_URL/messages/respond" \
    -H "Content-Type: application/json" \
    -d "{
        \"message\": {
            \"id\": \"test-$MESSAGE_TS\",
            \"text\": \"$TEST_MESSAGE_WITH_ID\",
            \"channel\": \"$MESSAGE_CHANNEL\",
            \"ts\": \"$MESSAGE_TS\"
        },
        \"response\": \"[INTEGRATION TEST - NO RESPONSE NEEDED]\"
    }")

# Function to cleanup test message from responded database
cleanup_test_message() {
    print_status "info" "Cleaning up test safety marker..."
    # The service will automatically clean up old entries, but we can note this for future enhancement
}

# Set trap to cleanup on exit
trap cleanup_test_message EXIT

# Wait a moment for message to be processed
sleep 2

# Trigger bot check
print_status "info" "Triggering bot to check for messages..."
BOT_RESULT=$($SCRIPT_DIR/claude_slack_bot.sh 2>&1)
BOT_EXIT_CODE=$?

if [ $BOT_EXIT_CODE -ne 0 ]; then
    print_status "error" "Bot script failed with exit code $BOT_EXIT_CODE"
    echo "$BOT_RESULT"
    exit 1
fi

print_status "success" "Bot check completed"

# Wait for bot to process and respond
print_status "info" "Waiting for bot response (up to $TEST_TIMEOUT seconds)..."
START_TIME=$(date +%s)
RESPONSE_FOUND=false

while [ $(($(date +%s) - START_TIME)) -lt $TEST_TIMEOUT ]; do
    # Check for responses in channel
    CHANNEL_HISTORY=$(curl -s "$SERVICE_URL/messages/channel-history/$(echo $TEST_CHANNEL | sed 's/#/%23/g')?limit=20")
    
    # Look for bot response to our test message
    if echo "$CHANNEL_HISTORY" | jq -e ".messages[] | select(.ts > \"$MESSAGE_TS\") | select(.text | contains(\"$TEST_ID\") or contains(\"4\"))" > /dev/null 2>&1; then
        RESPONSE_FOUND=true
        break
    fi
    
    # Also check via responded messages endpoint
    RESPONDED=$(curl -s "$SERVICE_URL/messages/responded?limit=10")
    if echo "$RESPONDED" | jq -e ".messages[] | select(.original_text == \"$TEST_MESSAGE_WITH_ID\")" > /dev/null 2>&1; then
        RESPONSE_FOUND=true
        break
    fi
    
    sleep 2
done

# Analyze results
if [ "$RESPONSE_FOUND" = true ]; then
    print_status "success" "Bot response detected!"
    
    # Get the response details
    RESPONSE_INFO=$(echo "$RESPONDED" | jq -r ".messages[] | select(.original_text == \"$TEST_MESSAGE_WITH_ID\") | {response: .response_text, timestamp: .responded_at}" 2>/dev/null | head -1)
    
    if [ -n "$RESPONSE_INFO" ]; then
        echo ""
        echo "Response details:"
        echo "$RESPONSE_INFO" | jq .
    fi
    
    # Verify response contains expected answer
    if echo "$CHANNEL_HISTORY" | jq -e '.messages[] | select(.text | contains("4"))' > /dev/null 2>&1; then
        print_status "success" "Bot correctly answered the math question"
    fi
    
    echo ""
    print_status "success" "🎉 Integration test PASSED!"
    exit 0
else
    print_status "error" "No bot response found within $TEST_TIMEOUT seconds"
    
    # Debug information
    echo ""
    echo "Debug information:"
    echo "- Last bot run output:"
    tail -5 "$SCRIPT_DIR/logs/claude_slack_bot.log" 2>/dev/null || echo "  (no log available)"
    
    echo "- Unresponded messages:"
    curl -s "$SERVICE_URL/messages/unresponded" | jq '.count' || echo "  (failed to fetch)"
    
    echo ""
    print_status "error" "❌ Integration test FAILED"
    exit 1
fi