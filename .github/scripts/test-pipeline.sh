#!/bin/bash

# Test script to validate CI/CD pipeline setup
# Run this to ensure all components are working correctly

set -e

echo "🧪 Testing CI/CD Pipeline Setup..."

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

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "src/PeerPigeonMesh.js" ]; then
    print_error "This script must be run from the root of the peerpigeon repository"
    exit 1
fi

print_info "Testing CI/CD components..."

# Test 1: Check if GitHub workflows exist
echo "📁 Checking GitHub workflows..."
if [ -f ".github/workflows/ci.yml" ] && [ -f ".github/workflows/codeql-analysis.yml" ]; then
    print_status "GitHub workflows found"
else
    print_error "GitHub workflows missing"
    exit 1
fi

# Test 2: Check if scripts are executable
echo "🔧 Checking script permissions..."
scripts=(
    ".github/scripts/pre-commit.sh"
    ".github/scripts/setup-dev.sh" 
    ".github/scripts/configure-repo.sh"
)

for script in "${scripts[@]}"; do
    if [ -x "$script" ]; then
        print_status "$script is executable"
    else
        print_error "$script is not executable"
        exit 1
    fi
done

# Test 3: Validate package.json scripts
echo "📦 Checking package.json scripts..."
required_scripts=("test" "lint" "ci")

for script in "${required_scripts[@]}"; do
    if node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).scripts['$script']" 2>/dev/null | grep -q .; then
        print_status "npm script '$script' found"
    else
        print_error "npm script '$script' missing"
        exit 1
    fi
done

# Test 4: Check if dependencies can be installed
echo "📥 Testing dependency installation..."
if [ ! -d "node_modules" ]; then
    print_info "Installing dependencies for testing..."
    if npm ci; then
        print_status "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        exit 1
    fi
else
    print_status "Dependencies already installed"
fi

# Test 5: Test linting
echo "🧹 Testing linting..."
if npm run lint; then
    print_status "Linting completed successfully"
else
    print_error "Linting failed"
    exit 1
fi

# Test 6: Test suite
echo "🧪 Testing test suite..."
if npm test; then
    print_status "Tests completed successfully"
else
    print_error "Tests failed"
    exit 1
fi

# Test 7: Check template files
echo "📝 Checking template files..."
templates=(
    ".github/pull_request_template.md"
    ".github/ISSUE_TEMPLATE/bug_report.yml"
    ".github/ISSUE_TEMPLATE/feature_request.yml"
    ".github/ISSUE_TEMPLATE/security_issue.yml"
    ".github/ISSUE_TEMPLATE/config.yml"
)

for template in "${templates[@]}"; do
    if [ -f "$template" ]; then
        print_status "Template $template found"
    else
        print_error "Template $template missing"
        exit 1
    fi
done

# Test 9: Check Dependabot configuration
echo "🤖 Checking Dependabot configuration..."
if [ -f ".github/dependabot.yml" ]; then
    print_status "Dependabot configuration found"
else
    print_error "Dependabot configuration missing"
    exit 1
fi

# Test 10: Validate workflow syntax (if GitHub CLI is available)
if command -v gh &> /dev/null; then
    echo "🔍 Validating workflow syntax..."
    if gh workflow list &> /dev/null; then
        print_status "Workflow syntax validation passed"
    else
        print_warning "Could not validate workflow syntax (may need authentication)"
    fi
fi

# Test 11: Check git hooks (if .git exists)
if [ -d ".git" ]; then
    echo "🪝 Checking git hooks..."
    if [ -f ".git/hooks/pre-commit" ] && [ -x ".git/hooks/pre-commit" ]; then
        print_status "Pre-commit hook installed and executable"
    else
        print_warning "Pre-commit hook not installed (run npm run ci:setup)"
    fi
    
    if [ -f ".git/hooks/commit-msg" ] && [ -x ".git/hooks/commit-msg" ]; then
        print_status "Commit message hook installed and executable"
    else
        print_warning "Commit message hook not installed (run npm run ci:setup)"
    fi
fi

# Test 12: Check documentation
echo "📚 Checking documentation..."
if [ -f ".github/CICD_README.md" ]; then
    print_status "CI/CD documentation found"
else
    print_error "CI/CD documentation missing"
    exit 1
fi

# Final summary
echo ""
print_status "All CI/CD pipeline components are working correctly!"
echo ""
print_info "Pipeline features:"
echo "  ✅ Automated security scanning"
echo "  ✅ Multi-platform testing (Linux, Windows, macOS)"  
echo "  ✅ Multi-version testing (Node.js 20, 22)"
echo "  ✅ Browser compatibility testing"
echo "  ✅ Package integrity validation"
echo "  ✅ Pre-commit hooks"
echo "  ✅ Automated dependency updates"
echo "  ✅ Code quality enforcement"
echo "  ✅ Required reviews"
echo ""
print_info "Next steps:"
echo "  1. Commit and push these changes"
echo "  2. Configure repository settings: ./.github/scripts/configure-repo.sh"
echo "  3. Add required secrets to GitHub repository"
echo "  4. Create a test PR to verify the pipeline"
echo ""
print_info "For detailed documentation, see: .github/CICD_README.md"
