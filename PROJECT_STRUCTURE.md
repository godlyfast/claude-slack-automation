# 📁 Project Structure & Maintenance Guide

## Directory Structure

```
claude-slack-automation/
├── 🤖 Core Files (Root)
│   ├── bot_control.sh               # Central management script - RECOMMENDED
│   ├── claude_slack_bot.sh         # Simplified bot script (~130 lines) - DO NOT DUPLICATE
│   ├── config.env                   # Configuration - SINGLE SOURCE OF TRUTH
│   ├── com.claude.slackbot.plist    # macOS LaunchAgent config
│   └── test_integration.sh          # Basic integration test
│
├── 📦 setup/                        # Installation & Setup Only
│   ├── setup.sh                     # Unix/Linux cron setup
│   ├── setup_macos.sh               # macOS LaunchAgent setup
│   └── quickstart.sh                # Interactive setup wizard
│
├── 🔧 utils/                        # Runtime Utilities Only
│   ├── daemon.sh                    # Background process manager
│   └── cleanup.sh                   # Codebase cleanup utility
│
├── 📦 slack-service/                # Node.js Slack Service
│   ├── src/                         # Source code
│   │   ├── index.js                 # Main server
│   │   ├── slack-service.js         # Slack API wrapper
│   │   ├── claude-service.js        # Claude interaction handler (NEW)
│   │   ├── api.js                   # REST API endpoints
│   │   ├── db.js                    # SQLite database
│   │   ├── loop-prevention.js       # Anti-loop system
│   │   ├── file-handler.js          # File attachment handler
│   │   ├── cache.js                 # Caching system
│   │   ├── rate-limiter.js          # Rate limiting
│   │   ├── logger.js                # Logging utility
│   │   └── utils.js                 # Shared utilities
│   ├── tests/                       # Unit tests
│   │   ├── slack-service.test.js
│   │   ├── claude-service.test.js   # Tests for Claude service (NEW)
│   │   ├── api.test.js
│   │   ├── db.test.js
│   │   ├── file-handler.test.js
│   │   └── cache.test.js
│   ├── data/                        # Database files
│   ├── logs/                        # Service logs
│   └── package.json                 # Dependencies
│
├── 📜 scripts/                      # Shared Helper Scripts
│   └── load_env.sh                  # Environment variable loader
│
├── 📚 docs/                         # All Documentation
│   ├── README_macOS.md              # Platform-specific guides
│   ├── PLAYWRIGHT.md                # Feature documentation
│   ├── RATE_LIMITS.md               # Technical documentation
│   └── ukrainian/                   # Localized documentation
│       ├── ІНСТРУКЦІЯ_SLACK_БОТ.md
│       ├── ВІЗУАЛЬНА_ІНСТРУКЦІЯ.md
│       ├── FAQ_УКРАЇНСЬКОЮ.md
│       └── ЗМІСТ_ДОКУМЕНТАЦІЇ.md
│
├── 📊 logs/                         # Generated Log Files (gitignored)
│   ├── claude_slack_bot.log
│   ├── claude_slack_bot_errors.log
│   └── launchd.*.log
│
├── 📋 Root Documentation
│   ├── README.md                    # Main project documentation
│   ├── CLAUDE.md                    # Instructions for Claude Code
│   ├── CHANGELOG.md                 # Version history
│   └── PROJECT_STRUCTURE.md         # This file
│
└── 🚫 Hidden Files
    ├── .last_check_timestamp        # Bot state tracking
    └── .gitignore                   # Git ignore rules

```

## 🧹 Cleaning & Maintenance

**Cleanup Script**: `utils/cleanup.sh`
- Removes temporary files
- Clears cache files  
- Optionally clears log files
- Shows space saved

**Run cleanup:**
```bash
./utils/cleanup.sh
```

## 🚨 STRICT RULES - NO EXCEPTIONS

### 1. ❌ NEVER Create These Files
- **No duplicate bot versions** (v2, v3, smart, etc.)
- **No test scripts** outside of test_integration.sh
- **No temporary Python scripts** for one-time tasks
- **No Docker files** - project is Docker-free
- **No duplicate documentation** - update existing files

### 2. 📁 Directory Rules

**Root Directory:**
- Limited shell scripts: bot_control.sh (management), claude_slack_bot.sh (core), test_integration.sh
- No experimental or temporary scripts
- No data files (txt, json, csv)

**setup/ Directory:**
- Installation scripts ONLY
- No runtime scripts
- No test scripts

**utils/ Directory:**
- Runtime utilities ONLY
- Must be referenced by main bot
- No one-time scripts

**docs/ Directory:**
- Markdown files ONLY
- Subfolders for languages
- No code or scripts

**logs/ Directory:**
- Auto-generated files only
- Should be in .gitignore
- Clean periodically

### 3. 📝 File Naming Convention
```
✅ GOOD:
- claude_slack_bot.sh          # Clear, descriptive name
- setup_macos.sh                # Clear purpose and platform
- CHANGELOG.md                  # Standard naming

❌ BAD:
- claude_slack_bot_v2.sh        # Version numbers = clutter
- test_something.sh             # Vague test files
- fix_issue_temp.sh            # Temporary fixes
- old_backup.sh                # Backups don't belong here
```

### 4. 🔄 When Adding New Features

**Before creating ANY new file, ask:**
1. Can this be added to an existing file?
2. Is this a permanent feature or temporary fix?
3. Does it belong in root or a subdirectory?
4. Will this be used regularly or just once?

**If temporary:** Don't commit it
**If one-time:** Use Claude Code directly, don't save scripts
**If permanent:** Follow the structure rules

### 5. 📋 Documentation Updates

**When to update:**
- CHANGELOG.md - For any user-visible changes
- README.md - For new features or setup changes
- CLAUDE.md - For new commands or bot behaviors
- This file - For structure changes

**Never create:**
- SUMMARY.md files
- NOTES.md files  
- TODO.md files
- Personal documentation

## 🧹 Maintenance Checklist

### Weekly
- [ ] Check logs/ directory size
- [ ] Remove any .txt data files
- [ ] Verify no duplicate scripts exist

### Monthly  
- [ ] Review all shell scripts for usage
- [ ] Update documentation if needed
- [ ] Clean old log files

### Before Major Changes
- [ ] Review this structure guide
- [ ] Plan where new files will go
- [ ] Consider updating existing files first

## 🛡️ Enforcement

### Git Hooks (Recommended)
Add to `.git/hooks/pre-commit`:
```bash
#!/bin/bash
# Prevent committing forbidden files

# Check for version numbered scripts
if git diff --cached --name-only | grep -E 'v[0-9]+\.sh$'; then
    echo "❌ ERROR: Version numbered scripts not allowed"
    exit 1
fi

# Check for test_ scripts in root
if git diff --cached --name-only | grep -E '^test_.*\.sh$' | grep -v "test_integration.sh"; then
    echo "❌ ERROR: Test scripts belong in tests/ directory"
    exit 1
fi

# Check for Docker files
if git diff --cached --name-only | grep -iE 'docker|dockerfile'; then
    echo "❌ ERROR: Docker files not allowed"
    exit 1
fi
```

### Code Review Checklist
- [ ] No duplicate functionality
- [ ] Follows directory structure
- [ ] Updates existing files when possible
- [ ] Documentation updated
- [ ] No temporary files

## 📌 Quick Reference

**Need to manage the bot?**
→ Use bot_control.sh for all operations

**Need to add a feature?**
→ Update claude_slack_bot.sh

**Need a new utility?**
→ Add to utils/ only if used by main bot

**Need to document something?**
→ Update existing .md files in docs/

**Need to test something?**
→ Use test_integration.sh or Claude Code directly

**Need a one-time script?**
→ Don't save it, run in Claude Code

---

⚠️ **Remember:** A clean codebase is a maintainable codebase. When in doubt, don't add the file.