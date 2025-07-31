# Refactoring Plan - Claude Slack Bot

## Overview
This document outlines the refactoring plan to optimize the codebase from first principles.

## Phase 1: Remove Unused Files and Code

### Files to Remove:
1. `/slack-service/src/slack-service-original.js` - Unused, 732 lines
2. `/slack-service/src/rate-limiter.js` - Only used by removed file
3. `/claude_slack_bot_v2.sh` - Violates project rules (no version numbers)
4. `/utils/queue_fetcher.sh` - Redundant wrapper
5. `/utils/queue_processor.sh` - Redundant wrapper  
6. `/utils/queue_sender.sh` - Redundant wrapper

### Logs to Clean:
- `claude_slack_bot_v2.log`
- `claude_slack_bot_v2_errors.log`

## Phase 2: Configuration Improvements

### Add to config.env:
```bash
# Service Configuration
SERVICE_HOST=localhost
SERVICE_PROTOCOL=http
MAX_RETRY_TIME=300000
DEFAULT_TIMEOUT=3000

# Queue Configuration
QUEUE_BATCH_SIZE=5
QUEUE_RETRY_DELAY=60
```

### Replace Hardcoded Values:
- All `3030` port references → `${SERVICE_PORT}`
- All `http://localhost:3030` → `${SERVICE_URL}`
- All timeout values → configuration variables

## Phase 3: Code Consolidation

### Create Shared Utilities:
1. `/scripts/common_functions.sh` - Shared logging and health checks
2. Consolidate duplicate functions across shell scripts

### Simplify Architecture:
- Focus on queue-based architecture as primary
- Remove references to v2 or alternate architectures
- Consolidate queue operations into main scripts

## Phase 4: Project Structure Improvements

### New Structure:
```
/
├── bin/               # Main executable scripts
├── config/            # Configuration files
├── docs/              # Documentation
├── lib/               # Shared libraries
├── logs/              # Log files
├── scripts/           # Utility scripts
├── slack-service/     # Node.js service
└── tests/             # Test files
```

## Phase 5: Testing and Validation

### Ensure:
1. All existing tests pass
2. No breaking changes
3. All features preserved
4. Performance improvements measured

## Implementation Order:
1. Remove unused files (safe, no dependencies)
2. Add configuration variables
3. Replace hardcoded values
4. Consolidate duplicate code
5. Reorganize structure
6. Run comprehensive tests