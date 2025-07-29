#!/bin/bash

# Setup script for PeerPigeon development environment
# This script configures git hooks and development tools

set -e

echo "🔧 Setting up PeerPigeon development environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    print_error "This script must be run from the root of the git repository"
    exit 1
fi

# Install git hooks
echo "🪝 Setting up git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Set up pre-commit hook
if [ -f ".github/scripts/pre-commit.sh" ]; then
    cp .github/scripts/pre-commit.sh .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    print_status "Pre-commit hook installed"
else
    print_error "Pre-commit script not found at .github/scripts/pre-commit.sh"
    exit 1
fi

# Set up commit-msg hook for conventional commits
cat > .git/hooks/commit-msg << 'EOF'
#!/bin/bash

# Commit message hook to enforce conventional commit format
# Format: type(scope): description

commit_regex='^(feat|fix|docs|style|refactor|test|chore|security|perf|ci|build)(\(.+\))?: .{1,50}'

if ! grep -qE "$commit_regex" "$1"; then
    echo "❌ Invalid commit message format!"
    echo ""
    echo "Commit message should follow conventional commits format:"
    echo "  type(scope): description"
    echo ""
    echo "Types:"
    echo "  feat:     New feature"
    echo "  fix:      Bug fix"  
    echo "  docs:     Documentation changes"
    echo "  style:    Code style changes (formatting, etc.)"
    echo "  refactor: Code refactoring"
    echo "  test:     Adding or fixing tests"
    echo "  chore:    Maintenance tasks"
    echo "  security: Security improvements"
    echo "  perf:     Performance improvements"
    echo "  ci:       CI/CD changes"
    echo "  build:    Build system changes"
    echo ""
    echo "Examples:"
    echo "  feat(crypto): add new encryption algorithm"
    echo "  fix(keys): resolve key generation issue"
    echo "  docs: update README with new examples"
    echo ""
    exit 1
fi
EOF

chmod +x .git/hooks/commit-msg
print_status "Commit message hook installed"

# Configure git settings for the project
echo "⚙️ Configuring git settings..."

# Set up git attributes for better diffs
cat > .gitattributes << 'EOF'
# Auto detect text files and perform LF normalization
* text=auto

# JavaScript files
*.js text eol=lf
*.mjs text eol=lf
*.cjs text eol=lf

# JSON files
*.json text eol=lf

# Configuration files
*.yml text eol=lf
*.yaml text eol=lf
*.md text eol=lf

# Binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.mov binary
*.mp4 binary
*.mp3 binary
*.flv binary
*.fla binary
*.swf binary
*.gz binary
*.zip binary
*.7z binary
*.ttf binary
*.eot binary
*.woff binary
*.woff2 binary

# Archive files
*.tar binary
*.gz binary
*.bz2 binary
*.xz binary
*.zip binary

# Compiled files
*.o binary
*.so binary
*.dylib binary
*.dll binary
*.exe binary
EOF

print_status "Git attributes configured"

# Set up .gitignore if it doesn't exist or update it
if [ ! -f ".gitignore" ]; then
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
*.tgz

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db

# Coverage reports
coverage/
.nyc_output/

# Temporary files
*.tmp
*.temp
.cache/

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Test files
test-results/
test-output/

# Playwright
/test-results/
/playwright-report/
/playwright/.cache/
EOF
    print_status "Created .gitignore file"
else
    print_info ".gitignore already exists"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    print_info "Installing dependencies..."
    npm ci
    print_status "Dependencies installed"
fi

# Build the project to verify everything works
print_info "Building project to verify setup..."
if npm run build; then
    print_status "Build successful"
else
    print_error "Build failed - please check your setup"
    exit 1
fi

# Run tests to verify everything works
print_info "Running tests to verify setup..."
if npm test; then
    print_status "Tests passed"
else
    print_error "Tests failed - please check your setup"
    exit 1
fi

echo ""
print_status "Development environment setup complete!"
echo ""
print_info "Next steps:"
echo "  1. Make your changes"
echo "  2. The pre-commit hook will automatically run security checks and tests"
echo "  3. Use conventional commit messages (feat:, fix:, docs:, etc.)"
echo "  4. Push your changes and create a pull request"
echo ""
print_info "Available commands:"
echo "  npm run dev      - Start development server"
echo "  npm run build    - Build the project"
echo "  npm test         - Run tests"
echo "  npm run example  - Run example code"
echo ""
print_info "For CI/CD pipeline:"
echo "  - Security scanning runs automatically on push/PR"
echo "  - Tests run on multiple Node.js versions and platforms"
echo "  - Code quality checks enforce best practices"
echo "  - Dependabot keeps dependencies updated"
