#!/bin/bash

# Monitor queue status continuously

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && cd .. && pwd )"
source "$SCRIPT_DIR/config.env"

echo "Queue Monitor - Press Ctrl+C to stop"
echo "=================================="

while true; do
    clear
    echo "Queue Status at $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=================================="
    
    # Check service health
    if curl -s --max-time 2 "${SERVICE_URL}/health" >/dev/null 2>&1; then
        echo "Service: ✅ Online"
    else
        echo "Service: ❌ Offline"
    fi
    
    # Get queue counts
    MESSAGE_COUNT=$(sqlite3 "$SCRIPT_DIR/slack-service/data/slack-bot.db" "SELECT COUNT(*) FROM message_queue WHERE status='pending';" 2>/dev/null || echo "0")
    RESPONSE_COUNT=$(sqlite3 "$SCRIPT_DIR/slack-service/data/slack-bot.db" "SELECT COUNT(*) FROM response_queue WHERE status='pending';" 2>/dev/null || echo "0")
    PROCESSING_COUNT=$(sqlite3 "$SCRIPT_DIR/slack-service/data/slack-bot.db" "SELECT COUNT(*) FROM message_queue WHERE status='processing';" 2>/dev/null || echo "0")
    
    echo ""
    echo "Pending Messages: $MESSAGE_COUNT"
    echo "Processing: $PROCESSING_COUNT"
    echo "Pending Responses: $RESPONSE_COUNT"
    
    # Show last few messages
    echo ""
    echo "Recent Messages:"
    sqlite3 -column -header "$SCRIPT_DIR/slack-service/data/slack-bot.db" \
        "SELECT substr(message_id, 1, 20) as message_id, 
                substr(text, 1, 50) as text, 
                status 
         FROM message_queue 
         ORDER BY fetched_at DESC 
         LIMIT 5;" 2>/dev/null || echo "No messages"
    
    # Check for rate limits
    echo ""
    echo "Recent Errors:"
    tail -n 100 "$SCRIPT_DIR/slack-service/logs/combined.log" 2>/dev/null | \
        grep -E "rate limit|error" | \
        tail -3 | \
        sed 's/.*"message":"//' | \
        sed 's/","service".*//' || echo "No recent errors"
    
    sleep 5
done