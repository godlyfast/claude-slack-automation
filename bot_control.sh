#!/bin/bash

# Claude Slack Bot Control Script
# Central management for all bot components in the hybrid Node.js + Claude architecture

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load configuration
source "$SCRIPT_DIR/config.env"

# Set defaults for any missing configuration
SERVICE_PORT=${SERVICE_PORT:-3030}
SERVICE_URL=${SERVICE_URL:-"http://localhost:$SERVICE_PORT"}
PID_FILE=${PID_FILE:-utils/.daemon.pid}
LOG_DIR=${LOG_DIR:-logs}

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if Node.js service is running
check_node_service() {
    if lsof -Pi :$SERVICE_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Function to check if LaunchAgent is loaded
check_launchagent() {
    # Check if running on macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if launchctl list | grep -q "com.claude.slackbot"; then
            echo "loaded"
        else
            echo "unloaded"
        fi
    else
        echo "not-macos"
    fi
}

# Function to check if daemon is running
check_daemon() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
        echo "running"
    else
        echo "stopped"
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
    
    # All configuration is now in root config.env
    # No need for slack-service/.env file anymore
    echo "Using unified config.env for all settings"
    
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

# Function to setup everything
setup_all() {
    echo -e "${BLUE}🤖 Claude Slack Bot - Complete Setup${NC}"
    echo "========================================"
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
    
    NODE_VERSION=$(node --version)
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    
    echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"
    echo -e "${GREEN}✓ Claude CLI: $CLAUDE_VERSION${NC}"
    echo
    
    # Setup Node.js service
    echo "Setting up Node.js Slack service..."
    if ! start_node_service; then
        echo -e "${RED}✗ Failed to start Node.js service${NC}"
        exit 1
    fi
    echo
    
    # Test integration
    echo "Testing integration..."
    if ! ./test_integration.sh; then
        echo -e "${YELLOW}⚠ Integration test failed, but continuing setup${NC}"
    fi
    echo
    
    # Setup automation method
    echo "Choose automation method:"
    echo "1. macOS LaunchAgent (recommended for macOS)"
    echo "2. Background daemon"
    echo "3. Cron job (Linux/Unix)"
    echo "4. Manual execution only"
    echo
    
    read -p "Enter your choice (1-4): " choice
    
    case $choice in
        1)
            echo "Setting up LaunchAgent..."
            if ./setup/setup_macos.sh; then
                echo -e "${GREEN}✓ LaunchAgent setup complete${NC}"
            else
                echo -e "${YELLOW}⚠ LaunchAgent setup had issues${NC}"
            fi
            ;;
        2)
            echo "Starting background daemon..."
            if ./utils/daemon.sh start; then
                echo -e "${GREEN}✓ Daemon started${NC}"
            else
                echo -e "${YELLOW}⚠ Daemon startup had issues${NC}"
            fi
            ;;
        3)
            echo "Setting up cron job..."
            if ./setup/setup.sh; then
                echo -e "${GREEN}✓ Cron job setup complete${NC}"
            else
                echo -e "${YELLOW}⚠ Cron setup had issues${NC}"
            fi
            ;;
        4)
            echo "Manual setup complete."
            echo "Run './claude_slack_bot.sh' to execute the bot manually."
            ;;
        *)
            echo -e "${YELLOW}Invalid choice. Skipping automation setup.${NC}"
            ;;
    esac
    
    echo
    echo -e "${GREEN}🎉 Setup complete!${NC}"
    echo
    show_status
    
    echo
    echo -e "${BLUE}📖 Next Steps:${NC}"
    echo "1. Edit config.env to customize ALL bot and service settings"
    echo "2. Check logs with: $0 logs"
    echo "3. Monitor status with: $0 status"
    echo "4. View file attachment docs: docs/FILE_ATTACHMENTS.md"
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
            HEALTH_INFO=$(curl -s http://localhost:3030/health 2>/dev/null || echo "{}")
            echo "Last Check:      $(echo "$HEALTH_INFO" | jq -r '.timestamp // "unknown"' 2>/dev/null || echo "unknown")"
        else
            echo -e "Service Health:  ${RED}● Unhealthy${NC}"
        fi
        
        # Show file attachment support
        if curl -s http://localhost:3030/attachments/supported-types > /dev/null 2>&1; then
            echo -e "File Attachments: ${GREEN}● Supported${NC}"
        else
            echo -e "File Attachments: ${YELLOW}● Unknown${NC}"
        fi
    else
        echo -e "Node.js Service: ${RED}● Stopped${NC}"
        echo -e "Service Health:  ${RED}● N/A${NC}"
        echo -e "File Attachments: ${RED}● N/A${NC}"
    fi
    
    # LaunchAgent status
    LAUNCH_STATUS=$(check_launchagent)
    if [ "$LAUNCH_STATUS" = "loaded" ]; then
        echo -e "LaunchAgent:     ${GREEN}● Loaded${NC}"
        
        # Show last run info
        if launchctl list com.claude.slackbot 2>/dev/null | grep -q "LastExitStatus"; then
            EXIT_STATUS=$(launchctl list com.claude.slackbot 2>/dev/null | grep "LastExitStatus" | awk '{print $3}' | tr -d '";')
            if [ "$EXIT_STATUS" = "0" ]; then
                echo -e "Last Exit:       ${GREEN}● Success (0)${NC}"
            else
                echo -e "Last Exit:       ${RED}● Error ($EXIT_STATUS)${NC}"
            fi
        fi
    elif [ "$LAUNCH_STATUS" = "not-macos" ]; then
        echo -e "LaunchAgent:     ${YELLOW}● Not available (Linux/Unix)${NC}"
    else
        echo -e "LaunchAgent:     ${RED}● Not loaded${NC}"
    fi
    
    # Daemon status
    DAEMON_STATUS=$(check_daemon)
    if [ "$DAEMON_STATUS" = "running" ]; then
        echo -e "Background Daemon: ${GREEN}● Running${NC}"
        if [ -f "$PID_FILE" ]; then
            PID=$(cat $PID_FILE)
            echo "Daemon PID:      $PID"
        fi
    else
        echo -e "Background Daemon: ${RED}● Stopped${NC}"
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
    
    # Recent activity
    echo
    echo -e "${BLUE}Recent Activity:${NC}"
    if [ -f "logs/claude_slack_bot.log" ]; then
        LAST_RUN=$(tail -1 logs/claude_slack_bot.log 2>/dev/null | grep -oE '\[.*\]' | head -1 || echo "Never")
        echo "Last Bot Run:    $LAST_RUN"
        
        # Count recent runs (last hour)
        RECENT_RUNS=$(grep -c "$(date '+%Y-%m-%d %H:')" logs/claude_slack_bot.log 2>/dev/null || echo "0")
        echo "Runs This Hour:  $RECENT_RUNS"
    else
        echo "Last Bot Run:    Never"
    fi
    
    if [ -f "logs/slack-service.log" ]; then
        SERVICE_SIZE=$(wc -l < logs/slack-service.log 2>/dev/null || echo "0")
        echo "Service Log Lines: $SERVICE_SIZE"
    fi
}

# Function to start all services
start_all() {
    echo -e "${BLUE}Starting all Claude Slack Bot services...${NC}"
    echo
    
    # Start Node.js service first
    if [ "$(check_node_service)" = "stopped" ]; then
        if start_node_service; then
            echo
        else
            echo -e "${RED}✗ Failed to start Node.js service${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Node.js service already running${NC}"
        echo
    fi
    
    # Start automation
    LAUNCH_STATUS=$(check_launchagent)
    if [ "$LAUNCH_STATUS" = "loaded" ]; then
        echo -e "${YELLOW}LaunchAgent already loaded${NC}"
    elif [ "$LAUNCH_STATUS" = "not-macos" ]; then
        # On non-macOS systems, use daemon
        if [ "$(check_daemon)" = "stopped" ] && [ -f "utils/daemon.sh" ]; then
            echo "Starting background daemon (Linux/Unix mode)..."
            ./utils/daemon.sh start
        else
            echo -e "${YELLOW}Background daemon already running${NC}"
        fi
    elif [ -f "$HOME/Library/LaunchAgents/com.claude.slackbot.plist" ]; then
        echo "Loading LaunchAgent..."
        launchctl load "$HOME/Library/LaunchAgents/com.claude.slackbot.plist" 2>/dev/null || true
        if [ "$(check_launchagent)" = "loaded" ]; then
            echo -e "${GREEN}✓ LaunchAgent loaded${NC}"
        fi
    elif [ "$(check_daemon)" = "stopped" ] && [ -f "utils/daemon.sh" ]; then
        echo "Starting daemon..."
        ./utils/daemon.sh start
    fi
    
    echo
    show_status
}

# Function to stop all services
stop_all() {
    echo -e "${BLUE}Stopping all Claude Slack Bot services...${NC}"
    echo
    
    # Stop automation first
    LAUNCH_STATUS=$(check_launchagent)
    if [ "$LAUNCH_STATUS" = "loaded" ]; then
        echo "Unloading LaunchAgent..."
        launchctl unload "$HOME/Library/LaunchAgents/com.claude.slackbot.plist" 2>/dev/null || true
        if [ "$(check_launchagent)" = "unloaded" ]; then
            echo -e "${GREEN}✓ LaunchAgent unloaded${NC}"
        fi
    elif [ "$LAUNCH_STATUS" = "not-macos" ]; then
        # On non-macOS systems, just handle daemon
        echo "Running on Linux/Unix - LaunchAgent not applicable"
    fi
    
    if [ "$(check_daemon)" = "running" ]; then
        echo "Stopping daemon..."
        ./utils/daemon.sh stop
    fi
    
    # Stop Node.js service
    stop_node_service
    
    # Kill any remaining bot processes
    echo "Cleaning up remaining processes..."
    pkill -f "claude_slack_bot.sh" 2>/dev/null || true
    
    echo
    echo -e "${GREEN}✓ All services stopped${NC}"
}

# Function to restart all services
restart_all() {
    echo -e "${BLUE}Restarting Claude Slack Bot...${NC}"
    stop_all
    echo
    sleep 2
    start_all
}

# Function to view logs with selection menu
view_logs() {
    echo "Select log to view:"
    echo "1. Bot execution log (claude_slack_bot.log)"
    echo "2. Node.js service log (slack-service.log)"
    echo "3. Service detailed logs (slack-service/logs/combined.log)"
    echo "4. Error log (claude_slack_bot_errors.log)"
    echo "5. Daemon log (utils/logs/daemon.log)"
    echo "6. LaunchAgent logs (Console.app)"
    echo "7. All logs (tail -f)"
    echo
    
    read -p "Enter your choice (1-7): " choice
    
    case $choice in
        1)
            if [ -f "logs/claude_slack_bot.log" ]; then
                tail -f logs/claude_slack_bot.log
            else
                echo "No bot execution log found"
            fi
            ;;
        2)
            if [ -f "logs/slack-service.log" ]; then
                tail -f logs/slack-service.log
            else
                echo "No service log found"
            fi
            ;;
        3)
            if [ -f "slack-service/logs/combined.log" ]; then
                tail -f slack-service/logs/combined.log
            else
                echo "No detailed service log found"
            fi
            ;;
        4)
            if [ -f "logs/claude_slack_bot_errors.log" ]; then
                tail -f logs/claude_slack_bot_errors.log
            else
                echo "No error log found"
            fi
            ;;
        5)
            if [ -f "utils/logs/daemon.log" ]; then
                tail -f utils/logs/daemon.log
            else
                echo "No daemon log found"
            fi
            ;;
        6)
            echo "Opening Console.app to view LaunchAgent logs..."
            echo "Search for: com.claude.slackbot"
            open -a Console
            ;;
        7)
            echo "Tailing all available logs..."
            tail -f logs/*.log slack-service/logs/*.log utils/logs/*.log 2>/dev/null || echo "Some logs may not exist yet"
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
    echo
    
    echo "Service Status:"
    show_status
    echo
    
    echo "File System:"
    echo "Project directory: $SCRIPT_DIR"
    echo "Config file: $([ -f "config.env" ] && echo "✓ exists" || echo "✗ missing")"
    echo "Node modules: $([ -d "slack-service/node_modules" ] && echo "✓ installed" || echo "✗ missing")"
    echo "Config source: Using unified config.env"
    echo
    
    echo "Network Connectivity:"
    if curl -s --max-time 5 https://api.slack.com > /dev/null 2>&1; then
        echo "Slack API: ✓ reachable"
    else
        echo "Slack API: ✗ unreachable"
    fi
    
    if curl -s --max-time 5 http://localhost:3030/health > /dev/null 2>&1; then
        echo "Local service: ✓ responding"
    else
        echo "Local service: ✗ not responding"
    fi
    echo
    
    echo "Recent Errors:"
    if [ -f "logs/claude_slack_bot_errors.log" ]; then
        echo "Last 3 error entries:"
        tail -3 logs/claude_slack_bot_errors.log 2>/dev/null || echo "No recent errors"
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
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    status)
        show_status
        ;;
    logs)
        view_logs
        ;;
    diagnostics|diag)
        run_diagnostics
        ;;
    service)
        case "${2:-}" in
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
            *)
                echo "Usage: $0 service {start|stop|restart}"
                ;;
        esac
        ;;
    *)
        echo -e "${BLUE}Claude Slack Bot Control${NC}"
        echo "========================"
        echo
        echo -e "${GREEN}Main Commands:${NC}"
        echo "  setup       - Complete initial setup (install dependencies, configure, start services)"
        echo "  start       - Start all services (Node.js + automation)"
        echo "  stop        - Stop all services"
        echo "  restart     - Restart all services"
        echo "  status      - Show detailed status of all components"
        echo
        echo -e "${GREEN}Service Management:${NC}"
        echo "  service start   - Start only the Node.js service"
        echo "  service stop    - Stop only the Node.js service"  
        echo "  service restart - Restart only the Node.js service"
        echo
        echo -e "${GREEN}Maintenance:${NC}"
        echo "  logs        - View logs (interactive menu)"
        echo "  diagnostics - Run system diagnostics"
        echo
        echo -e "${GREEN}Architecture:${NC}"
        echo "  • Node.js service handles Slack API operations (port 3030)"
        echo "  • Claude CLI generates responses to messages"
        echo "  • Bot script orchestrates the hybrid workflow"
        echo "  • Supports file attachments, thread conversations, and loop prevention"
        echo
        echo -e "${GREEN}Quick Start:${NC}"
        echo "  $0 setup     # First time setup"
        echo "  $0 status    # Check if everything is running"
        echo "  $0 logs      # Monitor activity"
        echo
        ;;
esac