#!/bin/bash

# macOS Setup Script for Claude Slack Bot (using launchd)

echo "Claude Slack Bot - macOS Setup"
echo "=============================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_FILE="$SCRIPT_DIR/../com.claude.slackbot.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/com.claude.slackbot.plist"

# Function to install launchd service
install_launchd() {
    echo "Installing launchd service..."
    
    # Create LaunchAgents directory if it doesn't exist
    mkdir -p "$LAUNCH_AGENTS_DIR"
    
    # Copy plist file
    cp "$PLIST_FILE" "$INSTALLED_PLIST"
    
    # Load the service
    launchctl load "$INSTALLED_PLIST" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ LaunchAgent installed successfully"
        echo "  The bot will check Slack every 60 seconds"
    else
        # Try bootstrap method for newer macOS versions
        launchctl bootstrap gui/$UID "$INSTALLED_PLIST"
        if [ $? -eq 0 ]; then
            echo "✓ LaunchAgent installed successfully (using bootstrap)"
        else
            echo "✗ Failed to install LaunchAgent"
            return 1
        fi
    fi
}

# Function to uninstall launchd service
uninstall_launchd() {
    echo "Uninstalling launchd service..."
    
    if [ -f "$INSTALLED_PLIST" ]; then
        # Unload the service
        launchctl unload "$INSTALLED_PLIST" 2>/dev/null || \
        launchctl bootout gui/$UID "$INSTALLED_PLIST" 2>/dev/null
        
        # Remove the plist file
        rm -f "$INSTALLED_PLIST"
        
        echo "✓ LaunchAgent uninstalled"
    else
        echo "No LaunchAgent found to uninstall"
    fi
}

# Function to check status
check_status() {
    echo ""
    echo "Current Status:"
    echo "--------------"
    
    # Check if launchd service is loaded
    if launchctl list | grep -q "com.claude.slackbot"; then
        echo "✓ LaunchAgent is active"
        launchctl list | grep "com.claude.slackbot"
    else
        echo "✗ LaunchAgent is not loaded"
    fi
    
    # Check if plist exists
    if [ -f "$INSTALLED_PLIST" ]; then
        echo "✓ Plist file installed at: $INSTALLED_PLIST"
    else
        echo "✗ Plist file not found"
    fi
    
    # Check if Claude is in PATH
    if command -v claude &> /dev/null; then
        echo "✓ Claude Code is available"
        echo "  Path: $(which claude)"
    else
        echo "✗ Claude Code not found in PATH"
        echo "  You may need to update PATH in the plist file"
    fi
    
    # Check logs
    if [ -f "$SCRIPT_DIR/../logs/claude_slack_bot.log" ]; then
        echo "✓ Recent activity:"
        tail -n 2 "$SCRIPT_DIR/../logs/claude_slack_bot.log" | sed 's/^/  /'
    fi
}

# Main menu
echo ""
echo "Choose an option:"
echo "1) Install LaunchAgent (recommended for macOS)"
echo "2) Uninstall LaunchAgent"
echo "3) Show status"
echo "4) View logs"
echo "5) Run background loop (alternative method)"
echo "6) Exit"
echo ""
read -p "Enter your choice (1-6): " choice

case $choice in
    1)
        install_launchd
        check_status
        ;;
    2)
        uninstall_launchd
        ;;
    3)
        check_status
        ;;
    4)
        echo ""
        echo "Recent logs:"
        echo "-----------"
        tail -n 20 "$SCRIPT_DIR/../logs/claude_slack_bot.log"
        ;;
    5)
        echo ""
        echo "Starting background loop method..."
        echo "This will run in the current terminal. Press Ctrl+C to stop."
        echo ""
        "$SCRIPT_DIR/run_background_loop.sh"
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
