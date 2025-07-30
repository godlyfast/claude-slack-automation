#!/bin/bash

# Install Git Hooks to Enforce Project Structure

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GIT_HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "📐 Installing Git Hooks for Project Structure Enforcement"
echo "========================================================"

# Check if .git directory exists
if [ ! -d "$PROJECT_ROOT/.git" ]; then
    echo "❌ Error: Not a git repository"
    echo "Please run this from the project root"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$GIT_HOOKS_DIR"

# Create pre-commit hook
cat > "$GIT_HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Claude Slack Bot - Pre-commit Hook
# Enforces project structure rules

echo "🔍 Checking project structure compliance..."

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only)

# Check for version numbered scripts
if echo "$STAGED_FILES" | grep -E '_v[0-9]+\.sh$|_v[0-9]+_.*\.sh$'; then
    echo "❌ ERROR: Version numbered scripts not allowed!"
    echo "   Found: $(echo "$STAGED_FILES" | grep -E '_v[0-9]+\.sh$|_v[0-9]+_.*\.sh$')"
    echo "   Please update the existing script instead of creating versions"
    exit 1
fi

# Check for test scripts in root (except test_integration.sh)
if echo "$STAGED_FILES" | grep -E '^test_.*\.sh$' | grep -v "^test_integration.sh$"; then
    echo "❌ ERROR: Test scripts in root directory not allowed!"
    echo "   Found: $(echo "$STAGED_FILES" | grep -E '^test_.*\.sh$' | grep -v "^test_integration.sh$")"
    echo "   Use Claude Code directly for testing"
    exit 1
fi

# Check for Python scripts in root (one-time scripts)
if echo "$STAGED_FILES" | grep -E '^[^/]+\.py$' | grep -vE '^setup\.py$|^requirements\.txt$'; then
    echo "⚠️  WARNING: Python scripts in root directory"
    echo "   Found: $(echo "$STAGED_FILES" | grep -E '^[^/]+\.py$')"
    echo "   Consider if this is a one-time script that should be run in Claude Code instead"
fi

# Check for Docker files
if echo "$STAGED_FILES" | grep -iE 'docker|dockerfile|docker-compose'; then
    echo "❌ ERROR: Docker files not allowed!"
    echo "   This project is Docker-free"
    exit 1
fi

# Check for duplicate documentation
if echo "$STAGED_FILES" | grep -iE 'SUMMARY\.md$|NOTES\.md$|TODO\.md$|_OLD\.md$|_BACKUP\.md$'; then
    echo "❌ ERROR: Duplicate/temporary documentation not allowed!"
    echo "   Found: $(echo "$STAGED_FILES" | grep -iE 'SUMMARY\.md$|NOTES\.md$|TODO\.md$|_OLD\.md$|_BACKUP\.md$')"
    echo "   Update existing documentation instead"
    exit 1
fi

# Check for data files in root
if echo "$STAGED_FILES" | grep -E '^\w+\.(txt|json|csv|tsv|data)$'; then
    echo "⚠️  WARNING: Data files in root directory"
    echo "   Found: $(echo "$STAGED_FILES" | grep -E '^\w+\.(txt|json|csv|tsv|data)$')"
    echo "   Consider if these belong in the project"
fi

# Check directory structure compliance
for file in $STAGED_FILES; do
    # Check setup/ directory
    if [[ $file == setup/* ]] && [[ $file == *.sh ]]; then
        if ! grep -qE 'setup|install|configure' <<< "$file"; then
            echo "⚠️  WARNING: $file may not belong in setup/"
            echo "   setup/ is for installation scripts only"
        fi
    fi
    
    # Check utils/ directory  
    if [[ $file == utils/* ]] && [[ $file == *.sh ]]; then
        # Check if the utility is referenced by main bot
        UTIL_NAME=$(basename "$file")
        if ! grep -q "$UTIL_NAME" claude_slack_bot.sh 2>/dev/null; then
            echo "⚠️  WARNING: $file is not referenced by main bot"
            echo "   utils/ is for runtime utilities used by the bot"
        fi
    fi
    
    # Check for scripts in docs/
    if [[ $file == docs/* ]] && [[ $file == *.sh || $file == *.py ]]; then
        echo "❌ ERROR: Scripts not allowed in docs/ directory!"
        echo "   Found: $file"
        echo "   docs/ is for documentation only"
        exit 1
    fi
done

echo "✅ Project structure check passed!"
EOF

# Make hook executable
chmod +x "$GIT_HOOKS_DIR/pre-commit"

echo ""
echo "✅ Git hooks installed successfully!"
echo ""
echo "The pre-commit hook will now check for:"
echo "  • No version numbered scripts (v2, v3, etc.)"
echo "  • No test scripts except test_integration.sh"
echo "  • No Docker files"
echo "  • No duplicate documentation"
echo "  • Proper directory structure"
echo ""
echo "To bypass the hook in emergencies, use: git commit --no-verify"
echo "(But please don't! Keep the codebase clean! 🧹)"