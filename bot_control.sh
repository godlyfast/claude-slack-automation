#!/bin/bash

# Claude Slack Bot Control Script
# Central management for queue-based architecture

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load configuration
source "$SCRIPT_DIR/config.env"

# Set defaults for any missing configuration
SERVICE_PORT=${SERVICE_PORT:-3030}
SERVICE_URL=${SERVICE_URL:-"http://localhost:$SERVICE_PORT"}
LOG_DIR=${LOG_DIR:-logs}

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Function to check if Node.js service is running
check_node_service() {
    if lsof -Pi :$SERVICE_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Function to check queue status
check_queue_status() {
    if [ "$(check_node_service)" = "running" ]; then
        # Get queue counts from database
        MESSAGE_COUNT=$(sqlite3 slack-service/data/slack-bot.db "SELECT COUNT(*) FROM message_queue WHERE status='pending';" 2>/dev/null || echo "0")
        RESPONSE_COUNT=$(sqlite3 slack-service/data/slack-bot.db "SELECT COUNT(*) FROM response_queue WHERE status='pending';" 2>/dev/null || echo "0")
        echo "$MESSAGE_COUNT:$RESPONSE_COUNT"
    else
        echo "0:0"
    fi
}

# Function to start Node.js service
start_node_service() {
    echo "Starting Node.js Slack service..."
    cd slack-service
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing Node.js dependencies..."
        npm install
    fi
    
    # Start the service in background
    echo "Starting Node.js service on port $SERVICE_PORT..."
    npm start > ../logs/slack-service.log 2>&1 &
    SERVICE_PID=$!
    
    # Store PID for later management
    echo $SERVICE_PID > .service.pid
    
    cd ..
    
    # Wait a moment and check if it started
    sleep 3
    if [ "$(check_node_service)" = "running" ]; then
        echo -e "${GREEN}✓ Node.js service started (PID: $SERVICE_PID)${NC}"
        
        # Test the service
        if curl -s $SERVICE_URL/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Service health check passed${NC}"
        else
            echo -e "${YELLOW}⚠ Service started but health check failed${NC}"
        fi
    else
        echo -e "${RED}✗ Failed to start Node.js service${NC}"
        echo "Check logs/slack-service.log for details"
        return 1
    fi
}

# Function to stop Node.js service
stop_node_service() {
    echo "Stopping Node.js service..."
    
    # Try to stop gracefully using PID file
    if [ -f "slack-service/.service.pid" ]; then
        PID=$(cat slack-service/.service.pid)
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping service gracefully (PID: $PID)..."
            kill "$PID" 2>/dev/null || true
            sleep 2
        fi
        rm -f slack-service/.service.pid
    fi
    
    # Force kill if still running
    if lsof -Pi :$SERVICE_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Force stopping service on port $SERVICE_PORT..."
        lsof -ti:$SERVICE_PORT | xargs kill -9 2>/dev/null || true
    fi
    
    # Kill by process name pattern
    pkill -f "node.*slack-service.*index.js" 2>/dev/null || true
    pkill -f "node.*src/index.js" 2>/dev/null || true
    
    sleep 1
    
    if [ "$(check_node_service)" = "stopped" ]; then
        echo -e "${GREEN}✓ Node.js service stopped${NC}"
    else
        echo -e "${RED}✗ Failed to stop Node.js service${NC}"
        echo "Manual intervention may be required"
    fi
}

# Function to run queue operations
run_queue_operation() {
    local OPERATION=$1
    local BATCH_SIZE=${2:-5}
    
    case $OPERATION in
        fetch)
            echo -e "${CYAN}Fetching messages from Slack...${NC}"
            ./queue_operations.sh fetch
            ;;
        process)
            echo -e "${CYAN}Processing messages with Claude (batch: $BATCH_SIZE)...${NC}"
            ./queue_operations.sh process $BATCH_SIZE
            ;;
        send)
            echo -e "${CYAN}Sending responses to Slack (batch: $BATCH_SIZE)...${NC}"
            echo -e "${YELLOW}NOTE: Sending has priority over fetching new messages${NC}"
            ./queue_operations.sh send $BATCH_SIZE
            ;;
        all)
            echo -e "${CYAN}Running complete queue cycle (send first, then fetch)...${NC}"
            ./queue_operations.sh all $BATCH_SIZE
            ;;
        priority)
            echo -e "${CYAN}Running in priority mode (send first, fetch only if nothing to send)...${NC}"
            ./queue_operations.sh priority $BATCH_SIZE
            ;;
        *)
            echo -e "${RED}Unknown operation: $OPERATION${NC}"
            return 1
            ;;
    esac
}

# Function to setup everything
setup_all() {
    echo -e "${BLUE}🤖 Claude Slack Bot - Queue-Based Setup${NC}"
    echo "==========================================="
    echo
    
    # Check prerequisites
    echo "Checking prerequisites..."
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js is not installed. Please install Node.js first.${NC}"
        echo "Visit: https://nodejs.org/"
        exit 1
    fi
    
    if ! command -v claude &> /dev/null; then
        echo -e "${RED}✗ Claude CLI is not installed. Please install Claude CLI first.${NC}"
        echo "Visit: https://claude.ai/code"
        exit 1
    fi
    
    if ! command -v sqlite3 &> /dev/null; then
        echo -e "${RED}✗ SQLite3 is not installed. Please install SQLite3 first.${NC}"
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    
    echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"
    echo -e "${GREEN}✓ Claude CLI: $CLAUDE_VERSION${NC}"
    echo -e "${GREEN}✓ SQLite3: installed${NC}"
    echo
    
    # Setup Node.js service
    echo "Setting up Node.js Slack service..."
    if ! start_node_service; then
        echo -e "${RED}✗ Failed to start Node.js service${NC}"
        exit 1
    fi
    echo
    
    # Test queue operations
    echo "Testing queue operations..."
    echo -e "${CYAN}Queue Status:${NC}"
    ./queue_operations.sh status
    echo
    
    # Setup automation
    echo -e "${BLUE}Setting up daemon automation...${NC}"
    echo "The new architecture uses daemon processes for continuous operation."
    echo "Daemons provide better control and reliability than cron jobs."
    echo
    echo "To start daemons: ./daemon_control.sh start"
    echo "To check status: ./daemon_control.sh status"
    echo
    
    echo -e "${GREEN}🎉 Setup complete!${NC}"
    echo
    show_status
    
    echo
    echo -e "${BLUE}📖 Next Steps:${NC}"
    echo "1. Start daemons: ./daemon_control.sh start"
    echo "   (Starts adaptive daemon that intelligently sends or fetches)"
    echo "2. Monitor queues with: $0 monitor"
    echo "3. Check daemon status: ./daemon_control.sh status"
    echo "4. View daemon logs: ./daemon_control.sh logs adaptive"
    echo "5. Run operations manually if needed:"
    echo "   - $0 queue fetch    # Fetch from Slack"
    echo "   - $0 queue process  # Process with Claude"
    echo "   - $0 queue send     # Send to Slack"
}

# Function to show comprehensive status
show_status() {
    echo
    echo -e "${BLUE}Claude Slack Bot Status${NC}"
    echo "========================"
    
    # Node.js service status
    NODE_STATUS=$(check_node_service)
    if [ "$NODE_STATUS" = "running" ]; then
        echo -e "Node.js Service: ${GREEN}● Running${NC} (port $SERVICE_PORT)"
        
        # Check service health
        if curl -s $SERVICE_URL/health > /dev/null 2>&1; then
            echo -e "Service Health:  ${GREEN}● Healthy${NC}"
            
            # Get service info
            HEALTH_INFO=$(curl -s $SERVICE_URL/health 2>/dev/null || echo "{}")
            echo "Last Check:      $(echo "$HEALTH_INFO" | jq -r '.timestamp // "unknown"' 2>/dev/null || echo "unknown")"
        else
            echo -e "Service Health:  ${RED}● Unhealthy${NC}"
        fi
    else
        echo -e "Node.js Service: ${RED}● Stopped${NC}"
        echo -e "Service Health:  ${RED}● N/A${NC}"
    fi
    
    # Daemon status
    echo
    echo -e "${BLUE}Daemon Status:${NC}"
    if [ -f "./daemon_control.sh" ]; then
        # Get daemon status in a compact format
        # Check adaptive daemon status (strip ANSI codes)
        DAEMON_LINE=$(./daemon_control.sh status 2>/dev/null | grep "^adaptive" | head -1 | sed 's/\x1b\[[0-9;]*m//g')
        if echo "$DAEMON_LINE" | grep -q "running"; then
            ADAPTIVE_PID=$(echo "$DAEMON_LINE" | awk '{print $3}')
            echo -e "Adaptive Daemon: ${GREEN}● Running${NC} (PID: $ADAPTIVE_PID)"
            echo -e "                 Sends every minute, fetches when idle"
        else
            echo -e "Adaptive Daemon: ${RED}● Stopped${NC}"
            echo -e "                 ${YELLOW}Run '$0 daemon start adaptive' to enable${NC}"
        fi
    else
        echo -e "Daemon Control:  ${YELLOW}Not available${NC}"
    fi
    
    # Queue status
    echo
    echo -e "${BLUE}Queue Status:${NC}"
    QUEUE_STATUS=$(check_queue_status)
    MESSAGE_COUNT=$(echo $QUEUE_STATUS | cut -d: -f1)
    RESPONSE_COUNT=$(echo $QUEUE_STATUS | cut -d: -f2)
    
    if [ "$MESSAGE_COUNT" -gt 0 ]; then
        echo -e "Pending Messages:  ${YELLOW}$MESSAGE_COUNT${NC}"
    else
        echo -e "Pending Messages:  ${GREEN}0${NC}"
    fi
    
    if [ "$RESPONSE_COUNT" -gt 0 ]; then
        echo -e "Pending Responses: ${YELLOW}$RESPONSE_COUNT${NC}"
    else
        echo -e "Pending Responses: ${GREEN}0${NC}"
    fi
    
    # Database info
    if [ -f "slack-service/data/slack-bot.db" ]; then
        DB_SIZE=$(du -h slack-service/data/slack-bot.db | cut -f1)
        TOTAL_MESSAGES=$(sqlite3 slack-service/data/slack-bot.db "SELECT COUNT(*) FROM message_queue;" 2>/dev/null || echo "0")
        TOTAL_RESPONSES=$(sqlite3 slack-service/data/slack-bot.db "SELECT COUNT(*) FROM responded_messages;" 2>/dev/null || echo "0")
        echo
        echo -e "${BLUE}Database:${NC}"
        echo "Size:              $DB_SIZE"
        echo "Total Messages:    $TOTAL_MESSAGES"
        echo "Total Responses:   $TOTAL_RESPONSES"
    fi
    
    # Configuration summary
    echo
    echo -e "${BLUE}Configuration:${NC}"
    if [ -f "config.env" ]; then
        CHANNELS=$(grep "^SLACK_CHANNELS" config.env | head -1 | cut -d'=' -f2 | tr -d '"')
        KEYWORDS=$(grep "^TRIGGER_KEYWORDS" config.env | head -1 | cut -d'=' -f2 | tr -d '"')
        MODE=$(grep "^RESPONSE_MODE" config.env | head -1 | cut -d'=' -f2 | tr -d '"')
        echo "Channels:        ${CHANNELS:-"Not configured"}"
        echo "Trigger Words:   ${KEYWORDS:-"Not configured"}"
        echo "Response Mode:   ${MODE:-"Not configured"}"
    else
        echo -e "${YELLOW}No config.env found${NC}"
    fi
    
    # Currently running processes
    echo
    echo -e "${BLUE}Currently Running:${NC}"
    
    # Check for running claude process
    CLAUDE_PIDS=$(pgrep -f "claude --continue" 2>/dev/null || true)
    if [ -n "$CLAUDE_PIDS" ]; then
        for PID in $CLAUDE_PIDS; do
            # Get process start time and calculate runtime
            if [ "$(uname)" = "Darwin" ]; then
                # macOS
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Claude Process:  ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            else
                # Linux
                RUNTIME=$(ps -o etimes= -p "$PID" 2>/dev/null || echo "0")
                if [ -n "$RUNTIME" ] && [ "$RUNTIME" != "0" ]; then
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Claude Process:  ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            fi
        done
    else
        echo -e "Claude Process:  ${GRAY}○ Not running${NC}"
    fi
    
    # Check for running fetch operation
    FETCH_PIDS=$(pgrep -f "queue_operations.sh fetch" 2>/dev/null || true)
    if [ -n "$FETCH_PIDS" ]; then
        for PID in $FETCH_PIDS; do
            if [ "$(uname)" = "Darwin" ]; then
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Fetch Operation: ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            else
                RUNTIME=$(ps -o etimes= -p "$PID" 2>/dev/null || echo "0")
                if [ -n "$RUNTIME" ] && [ "$RUNTIME" != "0" ]; then
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Fetch Operation: ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            fi
        done
    else
        echo -e "Fetch Operation: ${GRAY}○ Not running${NC}"
    fi
    
    # Check for running send operation
    SEND_PIDS=$(pgrep -f "queue_operations.sh send" 2>/dev/null || true)
    if [ -n "$SEND_PIDS" ]; then
        for PID in $SEND_PIDS; do
            if [ "$(uname)" = "Darwin" ]; then
                START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "")
                if [ -n "$START_TIME" ]; then
                    START_EPOCH=$(date -j -f "%a %b %d %T %Y" "$START_TIME" "+%s" 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date "+%s")
                    RUNTIME=$((NOW_EPOCH - START_EPOCH))
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Send Operation:  ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            else
                RUNTIME=$(ps -o etimes= -p "$PID" 2>/dev/null || echo "0")
                if [ -n "$RUNTIME" ] && [ "$RUNTIME" != "0" ]; then
                    RUNTIME_MIN=$((RUNTIME / 60))
                    RUNTIME_SEC=$((RUNTIME % 60))
                    echo -e "Send Operation:  ${GREEN}● Running${NC} (PID: $PID, runtime: ${RUNTIME_MIN}m ${RUNTIME_SEC}s)"
                fi
            fi
        done
    else
        echo -e "Send Operation:  ${GRAY}○ Not running${NC}"
    fi
    
    # Check for bot lock
    if [ -f "$LOG_DIR/claude_slack_bot.lock" ]; then
        LOCK_PID=$(cat "$LOG_DIR/claude_slack_bot.lock" 2>/dev/null || echo "unknown")
        echo -e "Bot Lock:        ${YELLOW}● Active${NC} (PID: $LOCK_PID)"
    fi

    # Recent activity
    echo
    echo -e "${BLUE}Recent Activity:${NC}"
    if [ -f "logs/queue_fetcher.log" ]; then
        LAST_FETCH=$(tail -1 logs/queue_fetcher.log 2>/dev/null | grep -oE '\[.*\]' | head -1 || echo "Never")
        echo "Last Fetch:      $LAST_FETCH"
    fi
    if [ -f "logs/queue_processor.log" ]; then
        LAST_PROCESS=$(tail -1 logs/queue_processor.log 2>/dev/null | grep -oE '\[.*\]' | head -1 || echo "Never")
        echo "Last Process:    $LAST_PROCESS"
    fi
    if [ -f "logs/queue_sender.log" ]; then
        LAST_SEND=$(tail -1 logs/queue_sender.log 2>/dev/null | grep -oE '\[.*\]' | head -1 || echo "Never")
        echo "Last Send:       $LAST_SEND"
    fi
}

# Function to monitor queues
monitor_queues() {
    if [ -f "utils/monitor_queue.sh" ]; then
        ./utils/monitor_queue.sh
    else
        echo -e "${RED}Monitor script not found${NC}"
    fi
}

# Function to view logs with selection menu
view_logs() {
    echo "Select log to view:"
    echo "1. Queue Fetcher log"
    echo "2. Queue Processor log"
    echo "3. Queue Sender log"
    echo "4. Node.js service log"
    echo "5. Service detailed logs"
    echo "6. Error logs"
    echo "7. All queue logs (tail -f)"
    echo
    
    read -p "Enter your choice (1-7): " choice
    
    case $choice in
        1)
            tail -f logs/queue_fetcher.log 2>/dev/null || echo "No fetcher log found"
            ;;
        2)
            tail -f logs/queue_processor.log 2>/dev/null || echo "No processor log found"
            ;;
        3)
            tail -f logs/queue_sender.log 2>/dev/null || echo "No sender log found"
            ;;
        4)
            tail -f logs/slack-service.log 2>/dev/null || echo "No service log found"
            ;;
        5)
            tail -f slack-service/logs/combined.log 2>/dev/null || echo "No detailed log found"
            ;;
        6)
            tail -f logs/*_errors.log slack-service/logs/error.log 2>/dev/null || echo "No error logs found"
            ;;
        7)
            echo "Tailing all queue logs..."
            tail -f logs/queue_*.log logs/claude_slack_bot*.log 2>/dev/null || echo "No queue logs found"
            ;;
        *)
            echo "Invalid choice"
            ;;
    esac
}

# Function to run diagnostics
run_diagnostics() {
    echo -e "${BLUE}🔍 Claude Slack Bot Diagnostics${NC}"
    echo "=================================="
    echo
    
    echo "System Information:"
    echo "OS: $(uname -s) $(uname -r)"
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
    echo "Claude: $(claude --version 2>/dev/null || echo 'not found')"
    echo "SQLite3: $(sqlite3 --version 2>/dev/null || echo 'not found')"
    echo
    
    echo "Service Status:"
    show_status
    echo
    
    echo "File System:"
    echo "Project directory: $SCRIPT_DIR"
    echo "Config file: $([ -f "config.env" ] && echo "✓ exists" || echo "✗ missing")"
    echo "Database: $([ -f "slack-service/data/slack-bot.db" ] && echo "✓ exists" || echo "✗ missing")"
    echo "Node modules: $([ -d "slack-service/node_modules" ] && echo "✓ installed" || echo "✗ missing")"
    echo
    
    echo "Queue Scripts:"
    echo "Queue Operations: $([ -x "queue_operations.sh" ] && echo "✓ executable" || echo "✗ not executable")"
    echo
    
    echo "Network Connectivity:"
    if curl -s --max-time 5 https://api.slack.com > /dev/null 2>&1; then
        echo "Slack API: ✓ reachable"
    else
        echo "Slack API: ✗ unreachable"
    fi
    
    if curl -s --max-time 5 $SERVICE_URL/health > /dev/null 2>&1; then
        echo "Local service: ✓ responding"
    else
        echo "Local service: ✗ not responding"
    fi
    echo
    
    echo "Recent Errors:"
    if [ -f "slack-service/logs/error.log" ]; then
        echo "Last 3 service errors:"
        tail -3 slack-service/logs/error.log 2>/dev/null || echo "No recent errors"
    else
        echo "No error log found"
    fi
}

# Main menu
case "${1:-}" in
    setup)
        setup_all
        ;;
    start)
        start_node_service
        ;;
    stop)
        stop_node_service
        ;;
    restart)
        stop_node_service
        sleep 2
        start_node_service
        ;;
    status)
        show_status
        ;;
    monitor)
        monitor_queues
        ;;
    logs)
        view_logs
        ;;
    diagnostics|diag)
        run_diagnostics
        ;;
    daemon|daemons)
        # Delegate to daemon control script
        shift
        ./daemon_control.sh "$@"
        ;;
    queue)
        case "${2:-}" in
            fetch)
                run_queue_operation fetch
                ;;
            process)
                run_queue_operation process "${3:-5}"
                ;;
            send)
                run_queue_operation send "${3:-5}"
                ;;
            all)
                run_queue_operation all "${3:-5}"
                ;;
            priority)
                run_queue_operation priority "${3:-5}"
                ;;
            status)
                ./queue_operations.sh status
                ;;
            *)
                echo "Usage: $0 queue {fetch|process|send|all|priority|status} [batch_size]"
                echo
                echo "Examples:"
                echo "  $0 queue fetch        # Fetch messages from Slack"
                echo "  $0 queue process 10   # Process 10 messages"
                echo "  $0 queue send 20      # Send 20 responses (PRIORITY)"
                echo "  $0 queue all 15       # Run all operations with batch 15"
                echo "  $0 queue priority 10  # Priority mode: send first"
                ;;
        esac
        ;;
    *)
        echo -e "${BLUE}Claude Slack Bot Control - Queue Architecture${NC}"
        echo "=============================================="
        echo
        echo -e "${GREEN}Main Commands:${NC}"
        echo "  setup       - Complete initial setup"
        echo "  start       - Start Node.js service"
        echo "  stop        - Stop Node.js service"
        echo "  restart     - Restart Node.js service"
        echo "  status      - Show detailed status"
        echo "  monitor     - Live queue monitoring"
        echo
        echo -e "${GREEN}Daemon Commands:${NC}"
        echo "  daemon start       - Start all daemons"
        echo "  daemon stop        - Stop all daemons"
        echo "  daemon status      - Show daemon status"
        echo "  daemon logs <name> - View daemon logs"
        echo
        echo -e "${GREEN}Queue Operations:${NC}"
        echo "  queue fetch         - Fetch messages from Slack"
        echo "  queue process [n]   - Process n messages with Claude"
        echo "  queue send [n]      - Send n responses to Slack (PRIORITY)"
        echo "  queue all [n]       - Run complete cycle (send first)"
        echo "  queue priority [n]  - Priority mode: send first, fetch only if needed"
        echo "  queue status        - Show queue counts"
        echo
        echo -e "${GREEN}Maintenance:${NC}"
        echo "  logs        - View logs (interactive)"
        echo "  diagnostics - Run system diagnostics"
        echo
        echo -e "${GREEN}Architecture:${NC}"
        echo "  • Daemon-based: Continuous operation without cron"
        echo "  • Adaptive daemon: Sends every minute if pending, else fetches"
        echo "  • Smart scheduling: No wasted fetch operations"
        echo "  • Processor: Reads from DB, uses Claude"
        echo "  • Completely decoupled operations"
        echo "  • All messages preserved for context"
        echo
        echo -e "${GREEN}Quick Start:${NC}"
        echo "  $0 setup          # First time setup"
        echo "  $0 daemon start   # Start all daemons"
        echo "  $0 status         # Check system status"
        echo "  $0 daemon status  # Check daemon status"
        echo "  $0 monitor        # Watch queue activity"
        echo
        ;;
esac