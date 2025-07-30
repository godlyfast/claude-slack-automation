# Claude Slack Bot Deployment Guide

## Quick Deployment

1. **Make the deployment script executable:**
   ```bash
   chmod +x deploy.sh
   ```

2. **Run the deployment:**
   ```bash
   ./deploy.sh
   ```

The script will automatically:
- Install all dependencies on the server
- Copy all necessary files
- Set up systemd services
- Configure log rotation
- Start the bot

## Manual Deployment Steps

If you prefer to deploy manually or the script fails:

### 1. Connect to your server
```bash
ssh tim@192.168.55.185
# Password: 123456
```

### 2. Install dependencies
```bash
# Update system
sudo apt-get update

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install other tools
sudo apt-get install -y git curl wget build-essential sqlite3

# Install PM2 for process management
sudo npm install -g pm2
```

### 3. Install Claude CLI
Visit https://claude.ai/code and follow the installation instructions for Linux.

### 4. Copy files to server
From your local machine:
```bash
# Create a tar archive (excluding node_modules)
tar -czf claude-bot.tar.gz --exclude=node_modules --exclude=.git --exclude=logs .

# Copy to server
scp claude-bot.tar.gz tim@192.168.55.185:/home/tim/

# On the server, extract files
ssh tim@192.168.55.185
mkdir -p /home/tim/claude-slack-automation
cd /home/tim/claude-slack-automation
tar -xzf ../claude-bot.tar.gz
rm ../claude-bot.tar.gz
```

### 5. Install Node.js dependencies
```bash
cd /home/tim/claude-slack-automation/slack-service
npm install --production
```

### 6. Configure the bot
```bash
# Copy your Slack token to the server
# Edit config.env and ensure SLACK_BOT_TOKEN is set correctly
nano /home/tim/claude-slack-automation/config.env
```

### 7. Set up as a system service

Create `/etc/systemd/system/claude-slack-service.service`:
```ini
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
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/claude-slack-bot.service`:
```ini
[Unit]
Description=Claude Slack Bot Daemon
After=network.target claude-slack-service.service

[Service]
Type=forking
User=tim
WorkingDirectory=/home/tim/claude-slack-automation
ExecStart=/home/tim/claude-slack-automation/utils/daemon.sh start
ExecStop=/home/tim/claude-slack-automation/utils/daemon.sh stop
PIDFile=/home/tim/claude-slack-automation/utils/.daemon.pid
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-slack-service
sudo systemctl enable claude-slack-bot
sudo systemctl start claude-slack-service
sudo systemctl start claude-slack-bot
```

## Server Management

### Check status
```bash
sudo systemctl status claude-slack-service
sudo systemctl status claude-slack-bot
```

### View logs
```bash
# Bot execution logs
tail -f /home/tim/claude-slack-automation/logs/claude_slack_bot.log

# Service logs
tail -f /home/tim/claude-slack-automation/logs/slack-service.log

# Error logs
tail -f /home/tim/claude-slack-automation/logs/claude_slack_bot_errors.log
```

### Restart services
```bash
sudo systemctl restart claude-slack-service
sudo systemctl restart claude-slack-bot
```

### Stop services
```bash
sudo systemctl stop claude-slack-bot
sudo systemctl stop claude-slack-service
```

## Monitoring

The deployment creates a monitoring script at `/home/tim/claude-slack-automation/monitor.sh`:
```bash
./monitor.sh
```

This shows:
- Service status
- Recent activity
- Error logs
- Disk usage

## Updating

To update the bot after changes:

1. On your local machine:
   ```bash
   ./deploy.sh
   ```

2. Or manually on the server:
   ```bash
   cd /home/tim/claude-slack-automation
   ./update.sh
   ```

## Troubleshooting

### Bot not responding
1. Check if services are running:
   ```bash
   sudo systemctl status claude-slack-service
   sudo systemctl status claude-slack-bot
   ```

2. Check Node.js service health:
   ```bash
   curl http://localhost:3030/health
   ```

3. Check error logs:
   ```bash
   tail -50 /home/tim/claude-slack-automation/logs/claude_slack_bot_errors.log
   ```

### Claude CLI issues
- Ensure Claude CLI is installed and authenticated
- Test with: `claude --version`
- If not installed, visit: https://claude.ai/code

### Permission issues
```bash
# Fix permissions
sudo chown -R tim:tim /home/tim/claude-slack-automation
chmod +x /home/tim/claude-slack-automation/*.sh
chmod +x /home/tim/claude-slack-automation/utils/*.sh
```

### Database issues
```bash
# Reset database
rm /home/tim/claude-slack-automation/slack-service/data/slack-bot.db
sudo systemctl restart claude-slack-service
```

## Security Notes

1. The Node.js service runs on port 3030 but should only be accessible locally
2. Ensure your Slack token is kept secure
3. Regularly update dependencies: `npm audit fix`
4. Monitor logs for any suspicious activity

## Maintenance

### Log rotation
Logs are automatically rotated daily and kept for 7 days.

### Backup
Important files to backup:
- `config.env` - Configuration
- `slack-service/data/slack-bot.db` - Message history database
- Any custom modifications

### Resource usage
Monitor with:
```bash
# CPU and memory
top -u tim

# Disk usage
df -h
du -sh /home/tim/claude-slack-automation/
```