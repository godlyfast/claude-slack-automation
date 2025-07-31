#!/bin/bash

# Daemon Control Script - Manages all queue daemons

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/scripts/common_functions.sh"

# Ensure directories exist
ensure_directories

# Daemon configurations
get_daemon_script() {
    case "$1" in
        fetch) echo "daemons/fetch_daemon.sh" ;;
        process) echo "daemons/process_daemon.sh" ;;
        send) echo "daemons/send_daemon.sh" ;;
        priority) echo "daemons/priority_daemon.sh" ;;
        adaptive) echo "daemons/adaptive_daemon.sh" ;;
        *) echo "" ;;
    esac
}

# List of all daemons
ALL_DAEMONS="adaptive process"  # Adaptive replaces both send and fetch

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
    echo -e "${BLUE}Starting all daemons...${NC}"
    echo
    
    # Start in priority order
    start_daemon "send"    # Highest priority
    start_daemon "process" # Medium priority
    start_daemon "fetch"   # Lowest priority
    
    echo
    echo -e "${GREEN}All daemons started${NC}"
}

# Stop all daemons
stop_all() {
    echo -e "${BLUE}Stopping all daemons...${NC}"
    echo
    
    for daemon in $ALL_DAEMONS priority; do
        stop_daemon "$daemon"
    done
    
    echo
    echo -e "${GREEN}All daemons stopped${NC}"
}

# Show daemon status
show_status() {
    echo -e "${BLUE}Daemon Status${NC}"
    echo "================="
    echo
    
    printf "%-12s %-10s %-8s %s\n" "Daemon" "Status" "PID" "Log File"
    printf "%-12s %-10s %-8s %s\n" "------" "------" "---" "--------"
    
    for daemon in "adaptive" "process" "send" "fetch" "priority"; do
        local status=$(is_daemon_running "$daemon")
        local pid=$(get_daemon_pid "$daemon")
        local log_file="${daemon}_daemon.log"
        
        if [ "$status" = "running" ]; then
            printf "%-12s ${GREEN}%-10s${NC} %-8s %s\n" "$daemon" "running" "$pid" "$log_file"
        else
            printf "%-12s ${RED}%-10s${NC} %-8s %s\n" "$daemon" "stopped" "N/A" "$log_file"
        fi
    done
    
    echo
    echo -e "${BLUE}Queue Status:${NC}"
    "$SCRIPT_DIR/queue_operations.sh" status
}

# Show daemon logs
show_logs() {
    local daemon=$1
    
    if [ -z "$daemon" ]; then
        echo "Available daemons: fetch, process, send, priority, all"
        echo "Usage: $0 logs <daemon>"
        return 1
    fi
    
    if [ "$daemon" = "all" ]; then
        echo -e "${CYAN}Tailing all daemon logs...${NC}"
        tail -f "$LOG_DIR"/*_daemon.log 2>/dev/null
    else
        local log_file="$LOG_DIR/${daemon}_daemon.log"
        if [ -f "$log_file" ]; then
            echo -e "${CYAN}Tailing $daemon daemon log...${NC}"
            tail -f "$log_file"
        else
            echo -e "${RED}Log file not found: $log_file${NC}"
        fi
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
    echo "  start [daemon]   - Start specific daemon or all daemons"
    echo "  stop [daemon]    - Stop specific daemon or all daemons"
    echo "  restart [daemon] - Restart specific daemon or all daemons"
    echo "  status           - Show daemon and queue status"
    echo "  logs <daemon>    - Tail daemon logs (use 'all' for all logs)"
    echo
    echo "Daemons:"
    echo "  adaptive - Smart daemon: sends every minute if pending, else fetches (RECOMMENDED)"
    echo "  process  - Processes messages with Claude (runs every 1 min)"
    echo "  send     - Sends responses to Slack (runs every 30 sec)"
    echo "  fetch    - Fetches messages from Slack (runs every 3 min)"
    echo "  priority - Priority mode: send first, fetch if needed (runs every 45 sec)"
    echo
    echo "Examples:"
    echo "  $0 start              # Start all daemons"
    echo "  $0 start send         # Start only send daemon"
    echo "  $0 stop              # Stop all daemons"
    echo "  $0 restart process   # Restart process daemon"
    echo "  $0 status            # Show status"
    echo "  $0 logs send         # Tail send daemon log"
    echo "  $0 logs all          # Tail all daemon logs"
}

# Main command handling
case "${1:-}" in
    start)
        if [ -z "$2" ]; then
            start_all
        else
            start_daemon "$2"
        fi
        ;;
    stop)
        if [ -z "$2" ]; then
            stop_all
        else
            stop_daemon "$2"
        fi
        ;;
    restart)
        if [ -z "$2" ]; then
            stop_all
            sleep 2
            start_all
        else
            stop_daemon "$2"
            sleep 2
            start_daemon "$2"
        fi
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    *)
        show_usage
        ;;
esac