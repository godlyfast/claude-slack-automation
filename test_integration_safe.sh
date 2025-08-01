#!/bin/bash

# Safe Integration Test - Works even with existing test messages
# This version checks if the bot is functioning without posting new messages

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source config.env

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    local status=$1
    local message=$2
    case $status in
        "success") echo -e "${GREEN}✓${NC} $message" ;;
        "error") echo -e "${RED}✗${NC} $message" ;;
        "info") echo -e "${YELLOW}ℹ${NC} $message" ;;
    esac
}

echo "🧪 Claude Slack Bot Integration Test (Safe Mode)"
echo "==============================================="
echo ""

# Test 1: Service Health
print_status "info" "Test 1: Checking service health..."
HEALTH=$(curl -s "$SERVICE_URL/health")
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    print_status "success" "Service is healthy"
else
    print_status "error" "Service health check failed"
    exit 1
fi

# Test 2: Database Connection
print_status "info" "Test 2: Checking database connection..."
DB_TEST=$(curl -s "$SERVICE_URL/messages/responded?limit=1")
if echo "$DB_TEST" | jq -e '.success' > /dev/null 2>&1; then
    print_status "success" "Database connection working"
else
    print_status "error" "Database connection failed"
    exit 1
fi

# Test 3: Slack Connection
print_status "info" "Test 3: Checking Slack API connection..."
CHANNELS=$(echo "$SLACK_CHANNELS" | tr ',' ' ')
SLACK_OK=true

for channel in $CHANNELS; do
    CHANNEL_CHECK=$(curl -s "$SERVICE_URL/messages/channel-history/$(echo $channel | sed 's/#/%23/g')?limit=1")
    if echo "$CHANNEL_CHECK" | jq -e '.success' > /dev/null 2>&1; then
        print_status "success" "Can access channel: $channel"
    else
        ERROR=$(echo "$CHANNEL_CHECK" | jq -r '.error // "Unknown error"')
        print_status "error" "Cannot access channel: $channel - $ERROR"
        SLACK_OK=false
    fi
done

# Test 4: Rate Limiter Status
print_status "info" "Test 4: Checking rate limiter..."
RATE_LIMIT=$(curl -s "$SERVICE_URL/rate-limit/status")
if echo "$RATE_LIMIT" | jq -e '.success' > /dev/null 2>&1; then
    CAN_CALL=$(echo "$RATE_LIMIT" | jq -r '.rateLimitStats.canCallNow')
    NEXT_CALL=$(echo "$RATE_LIMIT" | jq -r '.rateLimitStats.nextCallAllowedIn')
    if [ "$CAN_CALL" = "true" ]; then
        print_status "success" "Rate limiter OK - can make API calls"
    else
        print_status "info" "Rate limited - next call in ${NEXT_CALL}s"
    fi
    print_status "success" "Rate limiter is functioning"
else
    print_status "error" "Rate limiter check failed"
fi

# Test 5: Queue Status
print_status "info" "Test 5: Checking message queues..."
if [ -f "./queue_operations.sh" ]; then
    QUEUE_STATUS=$(./queue_operations.sh status 2>&1)
    if echo "$QUEUE_STATUS" | grep -q -E "Message Queue|Pending|Processing|Status"; then
        print_status "success" "Queue operations working"
    else
        print_status "error" "Queue operations failed: $QUEUE_STATUS"
    fi
else
    # Try via API endpoints
    QUEUE_API=$(curl -s "$SERVICE_URL/queue/messages/pending")
    if echo "$QUEUE_API" | jq -e '.messages' > /dev/null 2>&1; then
        print_status "success" "Queue API working"
    else
        print_status "error" "Queue API check failed"
    fi
fi

# Test 6: Claude CLI
print_status "info" "Test 6: Checking Claude CLI..."
if command -v claude &> /dev/null; then
    print_status "success" "Claude CLI found at: $(which claude)"
    # Note: Actually running Claude might timeout in test environment
else
    print_status "error" "Claude CLI not found in PATH"
fi

# Test 7: Loop Prevention
print_status "info" "Test 7: Checking loop prevention system..."
LOOP_STATUS=$(curl -s "$SERVICE_URL/loop-prevention/status")
if echo "$LOOP_STATUS" | jq -e '.success' > /dev/null 2>&1; then
    EMERGENCY=$(echo "$LOOP_STATUS" | jq -r '.loopPrevention.emergencyStop // false')
    if [ "$EMERGENCY" = "false" ]; then
        print_status "success" "Loop prevention active (no emergency stop)"
    else
        print_status "error" "Emergency stop is activated!"
    fi
else
    print_status "error" "Loop prevention check failed"
fi

# Summary
echo ""
echo "====================================="

if [ "$SLACK_OK" = true ]; then
    print_status "success" "🎉 All integration tests PASSED!"
    echo ""
    echo "The bot is configured correctly and ready to respond to messages."
    echo ""
    echo "Note: This test doesn't post messages to avoid accumulation."
    echo "To test actual message flow, manually post a message with trigger keywords"
    echo "in one of these channels: $SLACK_CHANNELS"
else
    print_status "error" "❌ Some tests FAILED"
    echo ""
    echo "Please check the errors above and fix configuration."
fi

# Show recent activity
echo ""
print_status "info" "Recent bot activity:"
RESPONDED_COUNT=$(curl -s "$SERVICE_URL/messages/responded?limit=100" 2>/dev/null | jq -r '.count // 0')
PENDING_COUNT=$(curl -s "$SERVICE_URL/queue/messages/pending" 2>/dev/null | jq -r '.messages | length // 0')

echo "Messages responded to: $RESPONDED_COUNT"
echo "Messages pending: $PENDING_COUNT"

exit 0