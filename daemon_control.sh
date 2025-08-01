#!/bin/bash

# Daemon Control Script - Manages all queue daemons

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Ensure directories exist
ensure_directories

# Daemon configurations
get_daemon_script() {
    case "$1" in
        process) echo "daemons/process_daemon.sh" ;;
        *) echo "" ;;
    esac
}

# List of all daemons
ALL_DAEMONS="process"  # Process daemon handles message processing

# Check if daemon is running
is_daemon_running() {
    local daemon_name="${1}_daemon"
    local pid_file="$LOG_DIR/${daemon_name}.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "running"
            return 0
        fi
    fi
    echo "stopped"
    return 1
}

# Get daemon PID
get_daemon_pid() {
    local daemon_name="${1}_daemon"
    local pid_file="$LOG_DIR/${daemon_name}.pid"
    
    if [ -f "$pid_file" ]; then
        cat "$pid_file"
    else
        echo "N/A"
    fi
}

# Start daemon
start_daemon() {
    local daemon=$1
    local daemon_script=$(get_daemon_script "$daemon")
    
    if [ -z "$daemon_script" ]; then
        echo -e "${RED}Unknown daemon: $daemon${NC}"
        return 1
    fi
    
    if [ "$(is_daemon_running "$daemon")" = "running" ]; then
        echo -e "${YELLOW}$daemon daemon is already running (PID: $(get_daemon_pid "$daemon"))${NC}"
        return 0
    fi
    
    echo -e "${CYAN}Starting $daemon daemon...${NC}"
    
    # Start daemon in background with proper detachment
    cd "$SCRIPT_DIR"
    nohup bash "$daemon_script" > "$LOG_DIR/${daemon}_daemon_nohup.log" 2>&1 &
    local daemon_pid=$!
    
    # Give it time to start and write PID file
    sleep 3
    
    if [ "$(is_daemon_running "$daemon")" = "running" ]; then
        echo -e "${GREEN}✓ $daemon daemon started (PID: $(get_daemon_pid "$daemon"))${NC}"
    else
        echo -e "${RED}✗ Failed to start $daemon daemon${NC}"
        return 1
    fi
}

# Stop daemon
stop_daemon() {
    local daemon=$1
    local daemon_name="${daemon}_daemon"
    local pid_file="$LOG_DIR/${daemon_name}.pid"
    
    if [ "$(is_daemon_running "$daemon")" = "stopped" ]; then
        echo -e "${YELLOW}$daemon daemon is not running${NC}"
        return 0
    fi
    
    local pid=$(get_daemon_pid "$daemon")
    echo -e "${CYAN}Stopping $daemon daemon (PID: $pid)...${NC}"
    
    # Send SIGTERM for graceful shutdown
    kill -TERM "$pid" 2>/dev/null
    
    # Wait for daemon to stop (max 10 seconds)
    local count=0
    while [ $count -lt 10 ] && [ "$(is_daemon_running "$daemon")" = "running" ]; do
        sleep 1
        count=$((count + 1))
    done
    
    # Force kill if still running
    if [ "$(is_daemon_running "$daemon")" = "running" ]; then
        echo -e "${YELLOW}Force stopping $daemon daemon...${NC}"
        kill -9 "$pid" 2>/dev/null
        rm -f "$pid_file"
    fi
    
    echo -e "${GREEN}✓ $daemon daemon stopped${NC}"
}

# Start all daemons
start_all() {
    echo -e "${BLUE}Starting process daemon...${NC}"
    echo
    
    start_daemon "process"
    
    echo
    echo -e "${GREEN}Process daemon started${NC}"
}

# Stop all daemons
stop_all() {
    echo -e "${BLUE}Stopping process daemon...${NC}"
    echo
    
    stop_daemon "process"
    
    echo
    echo -e "${GREEN}Process daemon stopped${NC}"
}

# Show daemon status
show_status() {
    echo -e "${BLUE}Daemon Status${NC}"
    echo "================="
    echo
    
    printf "%-12s %-10s %-8s %s\n" "Daemon" "Status" "PID" "Log File"
    printf "%-12s %-10s %-8s %s\n" "------" "------" "---" "--------"
    
    local daemon="process"
    local status=$(is_daemon_running "$daemon")
    local pid=$(get_daemon_pid "$daemon")
    local log_file="${daemon}_daemon.log"
    
    if [ "$status" = "running" ]; then
        printf "%-12s ${GREEN}%-10s${NC} %-8s %s\n" "$daemon" "running" "$pid" "$log_file"
    else
        printf "%-12s ${RED}%-10s${NC} %-8s %s\n" "$daemon" "stopped" "N/A" "$log_file"
    fi
    
    echo
    echo -e "${BLUE}Queue Status:${NC}"
    "$SCRIPT_DIR/queue_operations.sh" status
}

# Show daemon logs
show_logs() {
    local daemon=$1
    
    if [ -z "$daemon" ]; then
        echo "Available daemon: process"
        echo "Usage: $0 logs process"
        return 1
    fi
    
    if [ "$daemon" = "all" ] || [ "$daemon" = "process" ]; then
        local log_file="$LOG_DIR/process_daemon.log"
        if [ -f "$log_file" ]; then
            echo -e "${CYAN}Tailing process daemon log...${NC}"
            tail -f "$log_file"
        else
            echo -e "${RED}Log file not found: $log_file${NC}"
        fi
    else
        echo -e "${RED}Unknown daemon: $daemon${NC}"
        echo "Available daemon: process"
    fi
}

# Show usage
show_usage() {
    echo -e "${BLUE}Claude Slack Bot - Daemon Control${NC}"
    echo "=================================="
    echo
    echo "Usage: $0 <command> [options]"
    echo
    echo "Commands:"
    echo "  start            - Start the process daemon"
    echo "  stop             - Stop the process daemon"
    echo "  restart          - Restart the process daemon"
    echo "  status           - Show daemon and queue status"
    echo "  logs             - Tail process daemon log"
    echo
    echo "Process Daemon:"
    echo "  The process daemon handles all queue operations through queue_operations.sh"
    echo "  It runs the priority operation every ${PROCESS_INTERVAL:-60} seconds"
    echo "  Priority mode: sends responses first, then fetches new messages if needed"
    echo
    echo "Examples:"
    echo "  $0 start         # Start the process daemon"
    echo "  $0 stop          # Stop the process daemon"
    echo "  $0 restart       # Restart the process daemon"
    echo "  $0 status        # Show status"
    echo "  $0 logs          # Tail process daemon log"
}

# Main command handling
case "${1:-}" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        stop_all
        sleep 2
        start_all
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "process"
        ;;
    *)
        show_usage
        ;;
esac