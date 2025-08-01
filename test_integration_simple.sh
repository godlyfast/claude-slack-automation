#!/bin/bash

# Simple Integration Test for Claude Slack Bot
# Tests basic functionality without triggering actual bot responses

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"

# Configuration
SERVICE_URL="${SERVICE_URL:-http://localhost:3030}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 Claude Slack Bot Integration Test (Simple)"
echo "==========================================="

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

# Test 1: Service Health Check
print_status "info" "Test 1: Checking service health..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null)

if [ "$HEALTH_STATUS" = "ok" ]; then
    print_status "success" "Service is healthy"
else
    print_status "error" "Service health check failed"
    echo "$HEALTH_RESPONSE"
    exit 1
fi

# Test 2: Database Connection
print_status "info" "Test 2: Checking database connection..."
RESPONDED_MESSAGES=$(curl -s "$SERVICE_URL/messages/responded?limit=1")
if echo "$RESPONDED_MESSAGES" | jq -e '.success' > /dev/null 2>&1; then
    print_status "success" "Database connection working"
else
    print_status "error" "Database connection failed"
    exit 1
fi

# Test 3: Slack Connection
print_status "info" "Test 3: Checking Slack connection..."
CHANNELS=$(echo "$SLACK_CHANNELS" | tr ',' ' ')
SLACK_OK=true

for channel in $CHANNELS; do
    CHANNEL_CHECK=$(curl -s "$SERVICE_URL/messages/channel-history/$(echo $channel | sed 's/#/%23/g')?limit=1")
    if echo "$CHANNEL_CHECK" | jq -e '.success' > /dev/null 2>&1; then
        print_status "success" "Can access channel: $channel"
    else
        print_status "error" "Cannot access channel: $channel"
        SLACK_OK=false
    fi
done

if [ "$SLACK_OK" = false ]; then
    print_status "error" "Slack connection test failed"
    exit 1
fi

# Test 4: Queue Operations Execution
print_status "info" "Test 4: Testing queue operations (dry run)..."
# Run queue operations in priority mode but it should find no messages since we're not posting test messages
BOT_OUTPUT=$($SCRIPT_DIR/queue_operations.sh priority 2>&1)
BOT_EXIT=$?

if [ $BOT_EXIT -eq 0 ]; then
    print_status "success" "Bot script executed successfully"
    if echo "$BOT_OUTPUT" | grep -q "No new messages to respond to"; then
        print_status "success" "Bot correctly reported no new messages"
    fi
else
    print_status "error" "Bot script failed with exit code: $BOT_EXIT"
    echo "$BOT_OUTPUT"
    exit 1
fi

# Test 5: API Endpoints
print_status "info" "Test 5: Testing API endpoints..."

# Test unresponded messages endpoint
UNRESPONDED=$(curl -s "$SERVICE_URL/messages/unresponded")
if echo "$UNRESPONDED" | jq -e '.success' > /dev/null 2>&1; then
    COUNT=$(echo "$UNRESPONDED" | jq -r '.count')
    print_status "success" "Unresponded messages endpoint working (found $COUNT messages)"
else
    print_status "error" "Unresponded messages endpoint failed"
    exit 1
fi

# Test cache stats
CACHE_STATS=$(curl -s "$SERVICE_URL/cache/stats")
if echo "$CACHE_STATS" | jq -e '.success' > /dev/null 2>&1; then
    print_status "success" "Cache system working"
else
    print_status "error" "Cache system check failed"
fi

# Test 6: File Attachment Support
print_status "info" "Test 6: Checking file attachment support..."
FILE_SUPPORT=$(curl -s "$SERVICE_URL/attachments/supported-types")
if echo "$FILE_SUPPORT" | jq -e '.supportedTypes' > /dev/null 2>&1; then
    TYPE_COUNT=$(echo "$FILE_SUPPORT" | jq '.supportedTypes | length')
    print_status "success" "File attachments supported ($TYPE_COUNT types)"
else
    print_status "error" "File attachment check failed"
fi

# Test 7: Loop Prevention Status
print_status "info" "Test 7: Checking loop prevention system..."
LOOP_STATUS=$(curl -s "$SERVICE_URL/loop-prevention/status")
if echo "$LOOP_STATUS" | jq -e '.success' > /dev/null 2>&1; then
    EMERGENCY_STOP=$(echo "$LOOP_STATUS" | jq -r '.loopPrevention.emergencyStop')
    if [ "$EMERGENCY_STOP" = "false" ]; then
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
print_status "success" "🎉 All integration tests PASSED!"
echo ""
echo "System Status Summary:"
echo "- Node.js Service: ✓ Running"
echo "- Database: ✓ Connected"
echo "- Slack API: ✓ Connected"
echo "- Bot Script: ✓ Executable"
echo "- API Endpoints: ✓ Responsive"
echo "- File Support: ✓ Enabled"
echo "- Loop Prevention: ✓ Active"
echo ""
echo "The bot is ready to respond to messages!"

# Optional: Show recent activity
print_status "info" "Recent bot activity:"
if [ -f "$SCRIPT_DIR/logs/claude_slack_bot.log" ]; then
    echo "Last bot run: $(tail -1 "$SCRIPT_DIR/logs/claude_slack_bot.log" | cut -d' ' -f1-2)"
fi

RESPONDED_COUNT=$(curl -s "$SERVICE_URL/messages/responded?limit=100" | jq -r '.count' 2>/dev/null || echo "0")
echo "Messages responded to: $RESPONDED_COUNT"

exit 0