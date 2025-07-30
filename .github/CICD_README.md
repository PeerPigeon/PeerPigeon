# CI/CD Pipeline

## Overview

Comprehensive CI/CD pipeline with security scanning, multi-platform testing, and automated deployment for PeerPigeon.

## Setup

1. **For Contributors**:
   ```bash
   git clone https://github.com/draeder/peerpigeon.git
   cd peerpigeon
   ./.github/scripts/setup-dev.sh
   ```

2. **For Maintainers**:
   - Add `SEMGREP_APP_TOKEN` secret (optional)
   - Run `./.github/scripts/configure-repo.sh`
   - **Publishing**: Manual control via `npm publish` (no automated publishing)

## Pipeline Components

- **Security**: npm audit (high), Semgrep, CodeQL
- **Testing**: Multi-platform (Linux/Windows/macOS), Multi-version testing (Node.js 20, 22)
- **Quality**: Pre-commit hooks, required reviews, browser integration testing
- **Deployment**: Package verification and manual publishing guidance

## Key Features

- High-level security audits appropriate for P2P networking libraries
- Tests both Node.js and browser environments
- Pre-commit hooks prevent vulnerable code from being committed
- Required status checks and code reviews before merging
- Browser compatibility testing with WebRTC

---

For issues, use the provided templates. For security vulnerabilities, use private disclosure.
