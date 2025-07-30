#!/bin/bash

# Setup script for Claude Slack Bot automation

echo "Claude Slack Bot Automation Setup"
echo "================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/../claude_slack_bot.sh"

# Check if main script exists
if [ ! -f "$MAIN_SCRIPT" ]; then
    echo "Error: Main script not found at $MAIN_SCRIPT"
    exit 1
fi

# Function to add cron job
add_cron_job() {
    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -q "$MAIN_SCRIPT"; then
        echo "Cron job already exists. Skipping..."
        return 0
    fi
    
    # Add new cron job (runs every minute)
    (crontab -l 2>/dev/null; echo "* * * * * $MAIN_SCRIPT >> $SCRIPT_DIR/../logs/cron.log 2>&1") | crontab -
    
    if [ $? -eq 0 ]; then
        echo "✓ Cron job added successfully"
        echo "  The bot will check Slack every minute"
    else
        echo "✗ Failed to add cron job"
        return 1
    fi
}

# Function to remove cron job
remove_cron_job() {
    crontab -l 2>/dev/null | grep -v "$MAIN_SCRIPT" | crontab -
    echo "✓ Cron job removed"
}

# Function to show status
show_status() {
    echo ""
    echo "Current Status:"
    echo "--------------"
    
    # Check if cron job exists
    if crontab -l 2>/dev/null | grep -q "$MAIN_SCRIPT"; then
        echo "✓ Cron job is active"
        echo "  Schedule: Every minute"
        crontab -l | grep "$MAIN_SCRIPT"
    else
        echo "✗ No cron job found"
    fi
    
    # Check if Claude is installed
    if command -v claude &> /dev/null; then
        echo "✓ Claude Code is installed"
    else
        echo "✗ Claude Code not found"
    fi
    
    # Check last run
    if [ -f "$SCRIPT_DIR/../.last_check_timestamp" ]; then
        echo "✓ Last check: $(cat $SCRIPT_DIR/../.last_check_timestamp)"
    else
        echo "- No previous runs detected"
    fi
    
    # Check log files
    if [ -d "$SCRIPT_DIR/../logs" ]; then
        echo "✓ Log directory exists"
        if [ -f "$SCRIPT_DIR/../logs/claude_slack_bot.log" ]; then
            echo "  Recent logs: $(tail -n 1 $SCRIPT_DIR/../logs/claude_slack_bot.log)"
        fi
    fi
}

# Main menu
echo ""
echo "Choose an option:"
echo "1) Install cron job (run every minute)"
echo "2) Remove cron job"
echo "3) Show status"
echo "4) Test run (manual execution)"
echo "5) View configuration"
echo "6) Exit"
echo ""
read -p "Enter your choice (1-6): " choice

case $choice in
    1)
        add_cron_job
        show_status
        ;;
    2)
        remove_cron_job
        show_status
        ;;
    3)
        show_status
        ;;
    4)
        echo "Running manual test..."
        $MAIN_SCRIPT
        ;;
    5)
        echo ""
        echo "Current Configuration:"
        echo "--------------------"
        cat "$SCRIPT_DIR/../config.env"
        ;;
    6)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "Setup complete!"
