#!/bin/bash

# Script to clean up old test messages from the channel

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load configuration
source config.env

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    local status=$1
    local message=$2
    case $status in
        "success") echo -e "${GREEN}✓${NC} $message" ;;
        "error") echo -e "${RED}✗${NC} $message" ;;
        "info") echo -e "${YELLOW}ℹ${NC} $message" ;;
    esac
}

print_status "info" "Checking for test messages in #ai-test channel..."

# Get count of test messages
TEST_MESSAGE_COUNT=$(curl -s "$SERVICE_URL/messages/channel-history/%23ai-test?limit=100" | jq -r '.messages[] | select(.text | startswith("[TEST:"))' | wc -l)

print_status "info" "Found $TEST_MESSAGE_COUNT test messages"

if [ "$TEST_MESSAGE_COUNT" -eq 0 ]; then
    print_status "success" "No test messages to clean up"
    exit 0
fi

print_status "info" "Note: Test messages can only be deleted via Slack UI or admin API"
print_status "info" "The integration test will work once test messages are older than the CHECK_WINDOW"
print_status "info" ""
print_status "info" "Current CHECK_WINDOW: ${CHECK_WINDOW} minutes"
print_status "info" ""
print_status "info" "To run the test successfully:"
print_status "info" "1. Wait for test messages to be older than ${CHECK_WINDOW} minutes"
print_status "info" "2. Or manually delete test messages from #ai-test channel"
print_status "info" "3. Or temporarily increase CHECK_WINDOW in config.env"

# Show recent test messages
print_status "info" ""
print_status "info" "Recent test messages:"
curl -s "$SERVICE_URL/messages/channel-history/%23ai-test?limit=10" | jq -r '.messages[] | select(.text | startswith("[TEST:")) | "\(.ts) - \(.text)"' | head -5