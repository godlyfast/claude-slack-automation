#!/bin/bash

# Claude Slack Bot Deployment Script for Ubuntu Server
# Target: 192.168.55.185 (Ubuntu)
# User: tim

set -e  # Exit on error

# Configuration
REMOTE_USER="tim"
REMOTE_HOST="192.168.55.185"
REMOTE_PASSWORD="123456"
REMOTE_DIR="/home/tim/claude-slack-automation"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Claude Slack Bot Deployment Script${NC}"
echo "======================================="

# Check if sshpass is installed for automated password entry
if ! command -v sshpass &> /dev/null; then
    echo -e "${BLUE}Installing sshpass for automated deployment...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install hudochenkov/sshpass/sshpass || true
    else
        sudo apt-get install -y sshpass || true
    fi
fi

# Function to execute remote commands
remote_exec() {
    sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "$@"
}

# Function to copy files
remote_copy() {
    sshpass -p "$REMOTE_PASSWORD" scp -o StrictHostKeyChecking=no -r "$1" "$REMOTE_USER@$REMOTE_HOST:$2"
}

# Step 1: Check remote server connectivity
echo -e "\n${BLUE}1. Checking server connectivity...${NC}"
if remote_exec "echo 'Connected successfully'"; then
    echo -e "${GREEN}✓ Server connection successful${NC}"
else
    echo -e "${RED}✗ Failed to connect to server${NC}"
    exit 1
fi

# Step 2: Install dependencies on remote server
echo -e "\n${BLUE}2. Installing dependencies on remote server...${NC}"
remote_exec "bash -s" << 'EOF'
    # Update package list
    sudo apt-get update

    # Install Node.js 18.x (required for the app)
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs

    # Install other dependencies
    sudo apt-get install -y git curl wget build-essential sqlite3

    # Install PM2 globally for process management
    sudo npm install -g pm2

    # Install Claude CLI (if not already installed)
    if ! command -v claude &> /dev/null; then
        echo "Installing Claude CLI..."
        # Note: Claude CLI installation may require manual steps
        # Visit: https://claude.ai/cli for installation instructions
        echo "WARNING: Claude CLI needs to be installed manually on the server"
    fi

    # Create application directory
    mkdir -p /home/tim/claude-slack-automation
    mkdir -p /home/tim/claude-slack-automation/logs
    mkdir -p /home/tim/claude-slack-automation/slack-service/data
    mkdir -p /home/tim/claude-slack-automation/slack-service/temp
    mkdir -p /home/tim/claude-slack-automation/utils/logs
EOF

# Step 3: Prepare files for deployment
echo -e "\n${BLUE}3. Preparing files for deployment...${NC}"
cd "$LOCAL_DIR"

# Create deployment archive (excluding unnecessary files)
tar -czf deploy.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=.env.local \
    --exclude=logs \
    --exclude=*.log \
    --exclude=slack-service/data/*.db \
    --exclude=slack-service/temp/* \
    --exclude=deploy.tar.gz \
    .

# Step 4: Copy files to remote server
echo -e "\n${BLUE}4. Copying files to remote server...${NC}"
remote_copy deploy.tar.gz "/tmp/"

# Step 5: Extract and setup on remote server
echo -e "\n${BLUE}5. Setting up application on remote server...${NC}"
remote_exec "bash -s" << 'EOF'
    cd /home/tim/claude-slack-automation
    
    # Extract files
    tar -xzf /tmp/deploy.tar.gz
    rm /tmp/deploy.tar.gz
    
    # Install Node.js dependencies
    cd slack-service
    npm install --production
    
    # Set up environment file
    if [ ! -f .env ]; then
        echo "Creating .env file..."
        cat > .env << 'ENVEOF'
# Slack Bot Token
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN}"

# Service Configuration
PORT=3030
NODE_ENV=production
ENVEOF
    fi
    
    # Set correct permissions
    chmod +x ../claude_slack_bot.sh
    chmod +x ../bot_control.sh
    chmod +x ../utils/daemon.sh
    
    # Initialize database
    cd /home/tim/claude-slack-automation/slack-service
    node -e "require('./src/db.js')" || true
EOF

# Step 6: Copy configuration file
echo -e "\n${BLUE}6. Copying configuration...${NC}"
remote_copy "$LOCAL_DIR/config.env" "$REMOTE_DIR/"

# Step 7: Set up systemd service
echo -e "\n${BLUE}7. Setting up systemd service...${NC}"
remote_exec "sudo bash -s" << 'EOF'
    # Create systemd service for Node.js slack service
    cat > /etc/systemd/system/claude-slack-service.service << 'SERVICEEOF'
[Unit]
Description=Claude Slack Bot Node.js Service
After=network.target

[Service]
Type=simple
User=tim
WorkingDirectory=/home/tim/claude-slack-automation/slack-service
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
StandardOutput=append:/home/tim/claude-slack-automation/logs/slack-service.log
StandardError=append:/home/tim/claude-slack-automation/logs/slack-service-error.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICEEOF

    # Create systemd service for the bot daemon
    cat > /etc/systemd/system/claude-slack-bot.service << 'SERVICEEOF'
[Unit]
Description=Claude Slack Bot Daemon
After=network.target claude-slack-service.service
Requires=claude-slack-service.service

[Service]
Type=forking
User=tim
WorkingDirectory=/home/tim/claude-slack-automation
ExecStart=/home/tim/claude-slack-automation/utils/daemon.sh start
ExecStop=/home/tim/claude-slack-automation/utils/daemon.sh stop
PIDFile=/home/tim/claude-slack-automation/utils/.daemon.pid
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
SERVICEEOF

    # Reload systemd
    systemctl daemon-reload
    
    # Enable services
    systemctl enable claude-slack-service.service
    systemctl enable claude-slack-bot.service
EOF

# Step 8: Create update script on remote server
echo -e "\n${BLUE}8. Creating update script...${NC}"
remote_exec "cat > $REMOTE_DIR/update.sh" << 'EOF'
#!/bin/bash
# Quick update script for Claude Slack Bot

echo "Updating Claude Slack Bot..."

# Stop services
sudo systemctl stop claude-slack-bot
sudo systemctl stop claude-slack-service

# Pull latest changes (if using git)
# git pull origin main

# Install/update dependencies
cd /home/tim/claude-slack-automation/slack-service
npm install --production

# Start services
sudo systemctl start claude-slack-service
sleep 5
sudo systemctl start claude-slack-bot

# Check status
sudo systemctl status claude-slack-service --no-pager
sudo systemctl status claude-slack-bot --no-pager

echo "Update complete!"
EOF

remote_exec "chmod +x $REMOTE_DIR/update.sh"

# Step 9: Create monitoring script
echo -e "\n${BLUE}9. Creating monitoring script...${NC}"
remote_exec "cat > $REMOTE_DIR/monitor.sh" << 'EOF'
#!/bin/bash
# Monitor Claude Slack Bot status

echo "Claude Slack Bot Status"
echo "======================"

# Check services
echo -e "\nServices:"
sudo systemctl status claude-slack-service --no-pager | grep "Active:"
sudo systemctl status claude-slack-bot --no-pager | grep "Active:"

# Check Node.js service health
echo -e "\nNode.js Service Health:"
curl -s http://localhost:3030/health || echo "Service not responding"

# Check recent logs
echo -e "\n\nRecent Activity:"
tail -5 /home/tim/claude-slack-automation/logs/claude_slack_bot.log 2>/dev/null || echo "No bot logs"

# Check for errors
echo -e "\n\nRecent Errors:"
tail -5 /home/tim/claude-slack-automation/logs/claude_slack_bot_errors.log 2>/dev/null || echo "No errors"

# Disk usage
echo -e "\n\nDisk Usage:"
du -sh /home/tim/claude-slack-automation/
EOF

remote_exec "chmod +x $REMOTE_DIR/monitor.sh"

# Step 10: Start services
echo -e "\n${BLUE}10. Starting services...${NC}"
remote_exec "bash -s" << 'EOF'
    # Start services
    sudo systemctl start claude-slack-service
    sleep 5
    sudo systemctl start claude-slack-bot
    
    # Check status
    echo -e "\nService Status:"
    sudo systemctl status claude-slack-service --no-pager | grep "Active:"
    sudo systemctl status claude-slack-bot --no-pager | grep "Active:"
EOF

# Step 11: Setup firewall (optional)
echo -e "\n${BLUE}11. Configuring firewall...${NC}"
remote_exec "sudo bash -s" << 'EOF'
    # Allow SSH
    sudo ufw allow ssh
    
    # Allow internal access to Node.js service (not external)
    # Port 3030 should only be accessible locally
    
    # Enable firewall if not already enabled
    # sudo ufw --force enable
    
    echo "Firewall configuration complete"
EOF

# Step 12: Setup log rotation
echo -e "\n${BLUE}12. Setting up log rotation...${NC}"
remote_exec "sudo bash -s" << 'EOF'
    cat > /etc/logrotate.d/claude-slack-bot << 'LOGEOF'
/home/tim/claude-slack-automation/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 tim tim
    sharedscripts
    postrotate
        systemctl reload claude-slack-service > /dev/null 2>&1 || true
    endscript
}

/home/tim/claude-slack-automation/slack-service/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 tim tim
}
LOGEOF
EOF

# Cleanup local files
rm -f deploy.tar.gz

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nServer: ${BLUE}$REMOTE_HOST${NC}"
echo -e "Application: ${BLUE}$REMOTE_DIR${NC}"
echo -e "\n${BLUE}Useful commands on the server:${NC}"
echo "  Monitor status:  ./monitor.sh"
echo "  Update bot:      ./update.sh"
echo "  View logs:       tail -f logs/claude_slack_bot.log"
echo "  Check service:   sudo systemctl status claude-slack-service"
echo "  Restart bot:     sudo systemctl restart claude-slack-bot"
echo -e "\n${RED}IMPORTANT:${NC}"
echo "1. Make sure Claude CLI is installed on the server"
echo "2. Update the Slack token in config.env if needed"
echo "3. The bot will check Slack every 60 seconds"
echo -e "\n${GREEN}Deployment complete!${NC}"