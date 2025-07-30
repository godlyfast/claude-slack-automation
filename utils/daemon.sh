#!/bin/bash

# Daemon manager for Claude Slack Bot
# Runs in background without terminal window

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/../claude_slack_bot.sh"
PID_FILE="$SCRIPT_DIR/.daemon.pid"
LOG_FILE="$SCRIPT_DIR/logs/daemon.log"

# Ensure logs directory exists
mkdir -p "$SCRIPT_DIR/logs"

# Function to start daemon
start_daemon() {
    # Check if already running
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "Claude Slack Bot daemon is already running (PID: $PID)"
            return 1
        else
            rm -f "$PID_FILE"
        fi
    fi
    
    echo "Starting Claude Slack Bot daemon..."
    
    # Start the daemon
    nohup bash -c '
        while true; do
            "'$MAIN_SCRIPT'" >> "'$LOG_FILE'" 2>&1
            sleep 60
        done
    ' > /dev/null 2>&1 &
    
    # Save PID
    echo $! > "$PID_FILE"
    
    echo "✓ Daemon started (PID: $!)"
    echo "  Checking Slack every 60 seconds"
    echo "  Logs: $LOG_FILE"
}

# Function to stop daemon
stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "Stopping Claude Slack Bot daemon (PID: $PID)..."
            kill "$PID"
            rm -f "$PID_FILE"
            echo "✓ Daemon stopped"
        else
            echo "Daemon is not running (stale PID file removed)"
            rm -f "$PID_FILE"
        fi
    else
        echo "No daemon is running"
    fi
}

# Function to check status
status_daemon() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "✓ Claude Slack Bot daemon is running (PID: $PID)"
            echo ""
            echo "Recent activity:"
            tail -n 5 "$SCRIPT_DIR/../logs/claude_slack_bot.log" | sed 's/^/  /'
        else
            echo "✗ Daemon is not running (stale PID file found)"
            rm -f "$PID_FILE"
        fi
    else
        echo "✗ Daemon is not running"
    fi
}

# Function to show logs
show_logs() {
    echo "Recent daemon logs:"
    echo "==================="
    tail -n 20 "$LOG_FILE"
    echo ""
    echo "Recent bot logs:"
    echo "================"
    tail -n 20 "$SCRIPT_DIR/../logs/claude_slack_bot.log"
}

# Main menu
case "${1:-menu}" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 2
        start_daemon
        ;;
    status)
        status_daemon
        ;;
    logs)
        show_logs
        ;;
    menu|*)
        echo "Claude Slack Bot Daemon Manager"
        echo "==============================="
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the daemon in background"
        echo "  stop     - Stop the daemon"
        echo "  restart  - Restart the daemon"
        echo "  status   - Show daemon status"
        echo "  logs     - Show recent logs"
        echo ""
        echo "Interactive menu:"
        echo "1) Start daemon"
        echo "2) Stop daemon"
        echo "3) Restart daemon"
        echo "4) Show status"
        echo "5) Show logs"
        echo "6) Exit"
        echo ""
        read -p "Choose an option (1-6): " choice
        
        case $choice in
            1) start_daemon ;;
            2) stop_daemon ;;
            3) stop_daemon; sleep 2; start_daemon ;;
            4) status_daemon ;;
            5) show_logs ;;
            6) exit 0 ;;
            *) echo "Invalid choice" ;;
        esac
        ;;
esac
