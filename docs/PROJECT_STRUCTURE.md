# 📁 Project Structure & Maintenance Guide

## Directory Structure

```
claude-slack-automation/
├── 🤖 Core Files (Root)
│   ├── docker-compose.yml           # Docker deployment configuration
│   ├── Dockerfile                   # Docker build definition
│   ├── config.env.example           # Example environment configuration
│   └── README.md                    # Main project documentation
│
├── 📦 slack-service/                # Node.js Slack Service
│   ├── src/                         # Source code
│   │   ├── index.js                 # Main server entry point
│   │   ├── orchestrator.js          # Core service orchestrator
│   │   ├── slack-service.js         # Slack API interaction logic
│   │   ├── llm-processor.js         # LLM interaction handler
│   │   ├── api.js                   # REST API endpoints
│   │   ├── db.js                    # Database interaction logic
│   │   ├── file-handler.js          # File attachment handler
│   │   ├── cache.js                 # Caching system
│   │   ├── global-rate-limiter.js   # Global rate limiter for Slack API
│   │   ├── logger.js                # Logging utility
│   │   └── utils.js                 # Shared utilities
│   │
│   ├── llm-service/               # LLM service implementations
│   │   ├── base.js                  # Base LLM service class
│   │   ├── anthropic.js             # Anthropic API implementation
│   │   ├── openai.js                # OpenAI API implementation
│   │   ├── google.js                # Google AI API implementation
│   │   └── factory.js               # LLM service factory
│   │
│   ├── tests/                       # Test suites
│   │   ├── integration/             # E2E test framework
│   │   │   ├── TestFramework.js     # Core testing utilities
│   │   │   ├── scenarios/           # Test scenarios
│   │   │   │   ├── BasicMessaging.js
│   │   │   │   ├── FileHandling.js
│   │   │   │   └── AdvancedFeatures.js
│   │   │   ├── fixtures/            # Test files (gitignored)
│   │   │   ├── run-e2e-tests.js     # Main test runner
│   │   │   └── README.md            # Test documentation
│   │   ├── *.test.js                # Unit tests for individual modules
│   │
│   ├── data/                        # Database files (gitignored)
│   ├── logs/                        # Service logs (gitignored)
│   └── package.json                 # Dependencies
│
├── 📚 docs/                         # All Documentation
│   ├── ARCHITECTURE.md              # System architecture overview
│   ├── DEPLOYMENT.md                # Deployment instructions
│   ├── TROUBLESHOOTING.md           # Troubleshooting guide
│   └── ...                          # Other documentation files
│
└── 🚫 Hidden Files
    └── .gitignore                   # Git ignore rules
```

## 🧹 Cleaning & Maintenance

**Manual Cleanup**:
- Clear old logs from `slack-service/logs/`
- Database files are preserved by design but can be backed up and cleared if needed.

**Automated cleanup:**
- Log rotation can be configured in a production environment using tools like `logrotate`.

## 🚨 STRICT RULES - NO EXCEPTIONS

### 1. ❌ NEVER Create These Files
- **No temporary or one-off scripts**: Use the existing service structure to add functionality.
- **No duplicate documentation**: Update existing files instead of creating new ones.

### 2. 📁 Directory Rules

**Root Directory:**
- Only project-level configuration and documentation.
- No source code or scripts.

**slack-service/src:**
- All source code for the Node.js service.
- Follow the existing modular structure.

**docs/ Directory:**
- Markdown files ONLY.
- Subfolders for languages or major sections.

### 3. 🔄 When Adding New Features

**Before creating ANY new file, ask:**
1. Can this be added to an existing file?
2. Is this a permanent feature or a temporary fix?
3. Does it belong in the existing architecture?

**If temporary:** Don't commit it.
**If permanent:** Follow the structure rules and integrate with the orchestrator.

### 4. 📋 Documentation Updates

**When to update:**
- **CHANGELOG.md**: For any user-visible changes.
- **README.md**: For new features or setup changes.
- **ARCHITECTURE.md**: For changes to the system design.
- **This file**: For structure changes.

## 📌 Quick Reference

**Need to manage the bot?**
→ Use `docker-compose` for all operations (`up`, `down`, `logs`, `build`).

**Need to add a feature?**
→ Update the relevant service file in `slack-service/src/` and integrate it with the `orchestrator.js`.

**Need to document something?**
→ Update existing `.md` files in `docs/`.

**Need to test something?**
→ Add a new test case to the `slack-service/tests/` directory.

---

⚠️ **Remember:** A clean codebase is a maintainable codebase. When in doubt, follow the existing patterns.
