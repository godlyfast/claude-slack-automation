#!/bin/bash

# Quick Start script for Claude Slack Bot on macOS

clear
echo "🤖 Claude Slack Bot - Quick Start"
echo "================================="
echo ""
echo "Welcome! Let's get your Claude Slack bot running."
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if command -v claude &> /dev/null; then
    echo "✅ Claude Code is installed"
else
    echo "❌ Claude Code not found"
    echo "   Please install from: https://anthropic.com"
    exit 1
fi

echo ""
echo "Choose how you want to run the bot:"
echo ""
echo "1) 🚀 Always On (LaunchAgent)"
echo "   Starts with your Mac, runs in background"
echo ""
echo "2) 👻 Background Mode (Daemon)"
echo "   Runs hidden, start/stop as needed"
echo ""
echo "3) 👀 Terminal Mode (Visual)"
echo "   See live updates in Terminal window"
echo ""
echo "4) 🎯 One-Time Test"
echo "   Run once to test configuration"
echo ""
echo "5) ⚙️  Configure Settings"
echo "   Edit channel and response settings"
echo ""

read -p "Your choice (1-5): " choice

case $choice in
    1)
        echo ""
        echo "Setting up LaunchAgent..."
        ./setup_macos.sh
        ;;
    2)
        echo ""
        echo "Starting background daemon..."
        ./daemon_control.sh start
        echo ""
        echo "Commands:"
        echo "  Stop:    ./daemon_control.sh stop"
        echo "  Status:  ./daemon_control.sh status"
        echo "  Logs:    ./daemon_control.sh logs"
        ;;
    3)
        echo ""
        echo "Starting Terminal mode..."
        echo "Press Ctrl+C to stop"
        echo ""
        sleep 2
        echo "Error: Background loop script not found. Use daemon method instead."
        echo "Run: ./daemon_control.sh start"
        ;;
    4)
        echo ""
        echo "Running one-time test..."
        ./claude_slack_bot.sh
        echo ""
        echo "Check logs/claude_slack_bot.log for details"
        ;;
    5)
        echo ""
        echo "Opening configuration..."
        ${EDITOR:-nano} config.env
        echo ""
        echo "Configuration updated. Run this script again to start the bot."
        ;;
    *)
        echo "Invalid choice"
        ;;
esac
