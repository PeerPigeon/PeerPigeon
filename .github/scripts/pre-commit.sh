#!/bin/bash

# Pre-commit hook for PeerPigeon project
# This script runs before each commit to ensure code quality and security

set -e

echo "🔍 Running pre-commit checks..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed or not in PATH"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found, installing dependencies..."
    npm ci
fi

# Run security audit
echo "🔐 Running security audit..."
if npm audit --audit-level=high; then
    print_status "Security audit passed"
else
    print_error "Security audit failed - please fix vulnerabilities before committing"
    exit 1
fi

# Run linting
echo "🧹 Running linting..."
if npm run lint; then
    print_status "Linting passed"
else
    print_error "Linting failed"
    exit 1
fi

# Run tests
echo "🧪 Running tests..."
if npm test; then
    print_status "All tests passed"
else
    print_error "Tests failed"
    exit 1
fi

# Check for sensitive information in staged files
echo "🔍 Checking for sensitive information..."
staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|json|md|yml|yaml)$' || true)

if [ -n "$staged_files" ]; then
    # Check for common patterns that might indicate secrets
    sensitive_patterns=(
        "password\s*=\s*['\"][^'\"]{3,}['\"]"
        "secret\s*=\s*['\"][^'\"]{3,}['\"]"
        "api_key\s*=\s*['\"][^'\"]{10,}['\"]"
        "private_key\s*=\s*['\"]-----BEGIN"
        "token\s*=\s*['\"][^'\"]{10,}['\"]"
        "['\"][A-Za-z0-9/+]{40,}['\"]"  # Base64 strings
    )
    
    found_sensitive=false
    for pattern in "${sensitive_patterns[@]}"; do
        if echo "$staged_files" | xargs grep -l -i -E "$pattern" 2>/dev/null; then
            found_sensitive=true
            break
        fi
    done
    
    if [ "$found_sensitive" = true ]; then
        print_warning "Potential sensitive information found in staged files"
        print_warning "Please review your changes to ensure no secrets are being committed"
        echo "If this is a false positive, you can skip this check with: git commit --no-verify"
        # Don't exit here, just warn
    else
        print_status "No sensitive information detected"
    fi
fi

# Check file sizes
echo "📏 Checking file sizes..."
large_files=$(git diff --cached --name-only | xargs ls -la 2>/dev/null | awk '$5 > 1000000 {print $9, $5}' || true)
if [ -n "$large_files" ]; then
    print_warning "Large files detected:"
    echo "$large_files"
    print_warning "Consider using Git LFS for large files"
fi

# Lint commit message format (basic check)
if [ -f ".git/COMMIT_EDITMSG" ]; then
    commit_msg=$(head -n1 .git/COMMIT_EDITMSG)
    if [[ ${#commit_msg} -gt 72 ]]; then
        print_warning "Commit message first line is longer than 72 characters"
    fi
fi

print_status "Pre-commit checks completed successfully!"
echo "🚀 Ready to commit!"
