#!/bin/bash

# GitHub Repository Configuration Script
# This script uses GitHub CLI to configure repository settings

set -e

echo "🔧 Configuring GitHub repository settings..."

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

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed"
    print_info "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    print_error "Not authenticated with GitHub CLI"
    print_info "Run: gh auth login"
    exit 1
fi

REPO="draeder/peerpigeon"

print_info "Configuring repository: $REPO"

# Configure general repository settings
echo "⚙️ Setting up general repository settings..."

gh api repos/$REPO --method PATCH --field delete_branch_on_merge=true \
    --field allow_merge_commit=true \
    --field allow_squash_merge=true \
    --field allow_rebase_merge=false \
    --field has_discussions=true \
    --field has_issues=true \
    --field has_projects=true \
    --field has_wiki=false

print_status "General settings configured"

# Set up branch protection for main branch
echo "🛡️ Setting up branch protection for main branch..."

# Create branch protection rule
protection_config='{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "security-scan",
      "test-matrix", 
      "browser-test",
      "package-integrity",
      "code-quality"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}'

if gh api repos/$REPO/branches/main/protection --method PUT --input - <<< "$protection_config"; then
    print_status "Branch protection configured for main branch"
else
    print_warning "Failed to configure branch protection (may need admin permissions)"
fi

# Enable security features
echo "🔒 Enabling security features..."

# Enable vulnerability alerts
if gh api repos/$REPO/vulnerability-alerts --method PUT; then
    print_status "Vulnerability alerts enabled"
else
    print_warning "Could not enable vulnerability alerts"
fi

# Enable automated security fixes
if gh api repos/$REPO/automated-security-fixes --method PUT; then
    print_status "Automated security fixes enabled"
else
    print_warning "Could not enable automated security fixes"
fi

# Set repository topics
echo "🏷️ Setting repository topics..."
topics='["cryptography","javascript","nodejs","browser","webcrypto","encryption","digital-signatures","security","p256","ecdsa","ecdh","aes-gcm"]'

if gh api repos/$REPO/topics --method PUT --field names="$topics"; then
    print_status "Repository topics set"
else
    print_warning "Could not set repository topics"
fi

# Create CODEOWNERS file if it doesn't exist
if [ ! -f ".github/CODEOWNERS" ]; then
    echo "👥 Creating CODEOWNERS file..."
    cat > .github/CODEOWNERS << 'EOF'
# Code Owners for Unsea Repository
# These owners will be requested for review when someone opens a pull request.

# Global ownership - all files
* @draeder

# Security-sensitive files require additional review
SECURITY.md @draeder
.github/workflows/ @draeder
.github/scripts/ @draeder

# Core cryptographic functionality
src/ @draeder

# Build and configuration files
vite.config.js @draeder
package.json @draeder
package-lock.json @draeder

# Documentation
README.md @draeder
docs/ @draeder
EOF
    print_status "CODEOWNERS file created"
else
    print_info "CODEOWNERS file already exists"
fi

# Display required secrets
echo ""
print_info "Optional repository secrets:"
echo "  🔍 SEMGREP_APP_TOKEN - For enhanced security scanning (optional)"
echo ""
print_info "Add these secrets in: Settings > Secrets and variables > Actions"
print_info "Note: NPM publishing is manual - no NPM_TOKEN needed"

# Display manual configuration steps
echo ""
print_warning "Manual configuration required:"
echo "  1. Enable Dependabot alerts: Settings > Security & analysis"
echo "  2. Enable Code scanning: Settings > Security & analysis > Code scanning"
echo "  3. Enable Secret scanning: Settings > Security & analysis > Secret scanning"
echo "  4. Add required secrets: Settings > Secrets and variables > Actions"
echo ""
print_info "Repository configuration complete!"
print_info "Next steps:"
echo "  1. Run: npm run ci:setup"
echo "  2. Make your first commit to test the pipeline"
echo "  3. Create a test PR to verify all checks work"
