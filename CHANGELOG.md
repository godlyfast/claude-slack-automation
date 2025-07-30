# 📋 CHANGELOG

## [2.0.0] - 2025-07-29

### 🚀 Major Architecture Update - Node.js Migration
- **Migrated from Claude-only to Node.js + Claude hybrid architecture**
  - Reduced Claude API usage by 90%+ by moving Slack reading to Node.js
  - Claude now only generates responses, doesn't read/post messages
  - Created dedicated Node.js service for Slack API operations

### ✨ Thread Monitoring Implementation
- **Full thread conversation support**
  - Bot monitors and responds in Slack threads
  - Maintains conversation context across thread messages
  - Responds to keywords "AI" or "ШІ" in both channels and threads
  - No @mention required for thread responses

### 🔐 Advanced Loop Prevention System
- **8-layer loop prevention architecture**:
  1. Pre-processing validation
  2. Thread response limiting (max 10 per thread)
  3. User rate limiting (max 5 per hour)
  4. Conversation circle detection
  5. Response similarity prevention
  6. Post-response content validation
  7. Emergency stop system with auto-recovery
  8. Response tracking and monitoring

### 🛡️ Bot Response Detection
- **Prevents bot from responding to itself**
  - Text similarity detection (70% Jaccard similarity)
  - Bot message filtering with MCP support
  - Response tracking with 10-minute detection window
  - Handles both bot_id and user token scenarios

### 📝 Slack Formatting
- **Native Slack formatting support**
  - Uses *bold* instead of **bold**
  - Uses _italic_ instead of *italic*
  - Proper code blocks and bullet points
  - Emoji and mention formatting

### 🗄️ Database Integration
- **SQLite database for state management**
  - Message deduplication tracking
  - Thread monitoring and participation tracking
  - Bot response history
  - Loop prevention metrics

### 🧪 Comprehensive Testing
- **55 unit tests covering all functionality**
  - Thread monitoring tests
  - Loop prevention validation
  - Message deduplication tests
  - Bot filtering verification

## [1.0.0] - 2025-07-29

### ✅ Fixed
- **Duplicate Responses**: Bot no longer answers same questions multiple times
  - Fixed memory fragmentation (was creating 10+ duplicate entries)
  - Now properly uses `memory_modify` to update existing memory
  - Tracks all responded message IDs correctly

- **Thread Responses**: Bot now properly responds in threads
  - Changed from blocking thread messages to allowing them
  - Responds within existing threads when appropriate
  - Creates new threads for channel messages

- **Configuration Issues**: Fixed multiple config problems
  - Removed hardcoded channel names
  - Now reads from config.env properly
  - Fixed response_mode configuration

- **Rate Limiting**: Implemented smart rate limit handling
  - Respects Slack's 2025 limits (1 request/minute)
  - Rotates through channels intelligently
  - Fallback to Playwright web scraping when rate limited

### 🚀 Added
- **Playwright Integration**: Full web automation support
  - Browse websites and take screenshots
  - Analyze web pages
  - Extract data from sites
  - No API limits when using web interface

- **Ukrainian Documentation**: Complete user guides
  - Main instruction guide
  - Visual examples
  - FAQ section
  - Navigation guide

- **Smart Features**:
  - Channel rotation for rate limits
  - Memory persistence between sessions
  - Automatic permission handling
  - Rate limit tracking and management

### 🔧 Improved
- Consolidated multiple bot versions into single fixed version
- Organized codebase structure
- Enhanced error handling and logging
- Better deduplication logic

### 🗑️ Removed
- Obsolete bot versions (v2, v3, smart)
- Redundant test scripts
- Duplicate documentation files
- Docker integration (all Docker-related files)

## [Rename] - 2025-07-29

### 🔄 Script Rename
- Renamed `claude_slack_bot_fixed.sh` to `claude_slack_bot.sh`
- Updated all references throughout the codebase
- Updated log file names to match
- Simplified naming now that the bot is stable

## [Cleanup] - 2025-07-29

### 🧹 Codebase Reorganization
- Created logical directory structure:
  - `setup/` - Setup and installation scripts
  - `utils/` - Utility scripts (daemon, rate limiter)
  - `docs/` - All documentation
  - `logs/` - Log files

### 🗑️ Files Removed
- **Obsolete Scripts**: run_background_loop.sh, playwright_slack_monitor.sh
- **One-time Utilities**: extract_timestamps.py, extract_all_timestamps.py
- **Test Scripts**: All test files (now bot is stable)
- **Docker Files**: Dockerfile, docker-compose.yml, deploy.sh, publish.sh
- **Temporary Files**: extracted_message_ids.txt, responded_message_ids.txt

### 📚 Documentation Consolidated
- Merged cleanup summaries into CHANGELOG
- Kept essential guides in docs/
- Preserved Ukrainian documentation

### 🔧 LaunchAgent Fix
- Fixed PATH issue preventing Claude from being found
- Added Claude's nvm path to LaunchAgent environment
- Bot now runs reliably every 60 seconds