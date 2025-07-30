#!/bin/bash

# Claude Slack Bot - Cleanup Script
# Removes temporary files, clears logs, and cleans cache

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🧹 Claude Slack Bot Cleanup"
echo "==========================="
echo ""

# Function to format file size
format_size() {
    local size=$1
    if [ $size -ge 1048576 ]; then
        echo "$(($size / 1048576))MB"
    elif [ $size -ge 1024 ]; then
        echo "$(($size / 1024))KB"
    else
        echo "${size}B"
    fi
}

# Calculate space before cleanup
BEFORE_SIZE=$(du -sk "$PROJECT_ROOT" 2>/dev/null | cut -f1)

echo "📊 Cleaning temporary files..."
# Remove Claude temporary output files
find "$PROJECT_ROOT" -name ".claude_output_*.tmp" -type f -delete 2>/dev/null
# Remove cache files
rm -f "$PROJECT_ROOT"/.channels_cache.json "$PROJECT_ROOT"/.users_cache.json 2>/dev/null
# Remove Docker remnants
rm -f "$PROJECT_ROOT"/.dockerignore 2>/dev/null
# Remove state tracking files (except timestamp)
rm -f "$PROJECT_ROOT"/.channel_state "$PROJECT_ROOT"/.rate_limit_tracker 2>/dev/null
# Remove macOS metadata
find "$PROJECT_ROOT" -name ".DS_Store" -type f -delete 2>/dev/null
# Remove backup files
find "$PROJECT_ROOT" -name "*~" -o -name "*.bak" -o -name "*.swp" -o -name "*.swo" | xargs rm -f 2>/dev/null
# Remove Python cache
find "$PROJECT_ROOT" -name "*.pyc" -o -name "__pycache__" -o -name "*.pyo" | xargs rm -rf 2>/dev/null

echo "📝 Cleaning log files..."
cd "$PROJECT_ROOT/logs"
# Remove obsolete logs
rm -f claude_slack_bot_smart.log claude_slack_bot.log playwright_test.log rate_limit.log 2>/dev/null
rm -f daemon.log cron.log 2>/dev/null

# Show current log sizes
echo ""
echo "Current log files:"
for log in *.log; do
    if [ -f "$log" ]; then
        size=$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null || echo "0")
        echo "  $log: $(format_size $size)"
    fi
done

echo ""
read -p "Clear active log files? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    for log in claude_slack_bot.log claude_slack_bot_errors.log launchd.stdout.log launchd.stderr.log; do
        if [ -f "$log" ]; then
            echo "" > "$log"
            echo "  ✓ Cleared $log"
        fi
    done
fi

# Clean PID files
echo ""
echo "🔧 Cleaning PID files..."
rm -f "$PROJECT_ROOT/utils/.daemon.pid" 2>/dev/null
rm -f "$PROJECT_ROOT"/*.pid 2>/dev/null

# Calculate space after cleanup
cd "$PROJECT_ROOT"
AFTER_SIZE=$(du -sk . 2>/dev/null | cut -f1)
SAVED=$((BEFORE_SIZE - AFTER_SIZE))

echo ""
echo "✅ Cleanup complete!"
echo "   Space saved: $(format_size $((SAVED * 1024)))"
echo ""

# Optional: Show what's left
echo "📁 Remaining hidden files:"
find . -name ".*" -type f | grep -v "^\.\/\.git" | grep -v "\.last_check_timestamp" | head -10

echo ""
echo "💡 Note: .last_check_timestamp is kept (tracks bot state)"