# 🎭 Playwright Integration Guide

## Overview
Playwright MCP (Model Context Protocol) enables the bot to automate web browsers for tasks like web scraping, taking screenshots, and filling forms.

## Available Tools
1. **mcp__playwright__init-browser** - Navigate to URLs
2. **mcp__playwright__get-screenshot** - Capture screenshots  
3. **mcp__playwright__execute-code** - Run JavaScript
4. **mcp__playwright__get-context** - Extract page content
5. **mcp__playwright__get-full-dom** - Get DOM (deprecated)

## Installation
```bash
# Install Playwright MCP globally
npm install -g @playwright/mcp

# Add to Claude MCP configuration
claude mcp add playwright playwright-mcp

# Verify connection
claude mcp list
```

## Configuration

### Permission Modes

1. **Interactive Mode**: Prompts for each permission
2. **Bypass Mode**: For automated scripts
   ```bash
   claude --print --dangerously-skip-permissions
   ```
3. **Allowed Tools**: Grant specific permissions
   ```bash
   claude --print --allowedTools "mcp__playwright__*"
   ```

## Usage Examples

### Basic Navigation
```
AI, navigate to example.com and tell me what you see
```

### Screenshot Capture
```
ШІ, take a screenshot of our product page
```

### Data Extraction
```
AI, extract all job listings from this careers page
```

### Form Automation
```
ШІ, fill out the contact form with test data
```

## Integration with Slack Bot

The bot automatically has Playwright permissions when using:
```bash
./claude_slack_bot.sh
```

When rate limited, the bot can fall back to web scraping:
```bash
./utils/playwright_slack_monitor.sh
```

## Troubleshooting

### Tools Not Available
- Ensure Playwright MCP is installed: `npm list -g @playwright/mcp`
- Check MCP connection: `claude mcp list`
- Restart Claude session after installation

### Permission Denied
- Bot uses `--dangerously-skip-permissions` flag
- For manual testing, grant permissions when prompted

### Browser Not Visible
- Browser window stays visible during automation
- You can interact while Claude automates

## Security Notes
- Only works with public websites
- Cannot access password-protected sites
- Browser sessions are temporary
- No credentials are stored