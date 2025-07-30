#!/bin/bash

# Browser Integration Test Runner
# Helps run the test with different configurations to avoid port conflicts

set -e

# Default values
SIGNALING_PORT=3000
HTTP_PORT=8080
HEADLESS=true
VERBOSE=false
QUIET=false

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -s, --signaling-port PORT    Signaling server port (default: 3000)"
    echo "  -h, --http-port PORT         HTTP server port (default: 8080)"
    echo "  --headless BOOL              Run in headless mode (default: true)"
    echo "  --verbose                    Enable verbose logging"
    echo "  --quiet                      Enable quiet mode (results only)"
    echo "  --help                       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Use defaults"
    echo "  $0 -s 3001 -h 8081                  # Use alternative ports"
    echo "  $0 --verbose                         # Enable verbose logging"
    echo "  $0 --quiet                           # Quiet mode for CI"
    echo "  $0 --headless false                  # Show browser windows"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--signaling-port)
            SIGNALING_PORT="$2"
            shift 2
            ;;
        -h|--http-port)
            HTTP_PORT="$2"
            shift 2
            ;;
        --headless)
            HEADLESS="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Check if ports are in use
echo "🔍 Checking port availability..."

# Check signaling port
if lsof -i :$SIGNALING_PORT > /dev/null 2>&1; then
    echo "⚠️  Port $SIGNALING_PORT is already in use (will use existing server)"
    EXISTING_SIGNALING=true
else
    echo "✅ Port $SIGNALING_PORT is available"
    EXISTING_SIGNALING=false
fi

# Check HTTP port
if lsof -i :$HTTP_PORT > /dev/null 2>&1; then
    echo "❌ Port $HTTP_PORT is already in use. Please choose a different port."
    echo "   Try: $0 --http-port 8081"
    exit 1
else
    echo "✅ Port $HTTP_PORT is available"
fi

# Set environment variables
export SIGNALING_PORT=$SIGNALING_PORT
export HTTP_PORT=$HTTP_PORT
export HEADLESS=$HEADLESS

if [ "$VERBOSE" = true ]; then
    export VERBOSE=true
fi

if [ "$QUIET" = true ]; then
    export QUIET=true
fi

echo ""
echo "🚀 Starting browser integration test..."
echo "   Signaling port: $SIGNALING_PORT $([ "$EXISTING_SIGNALING" = true ] && echo "(existing server)" || echo "(new server)")"
echo "   HTTP port: $HTTP_PORT"
echo "   Headless: $HEADLESS"
echo "   Verbose: $VERBOSE"
echo "   Quiet: $QUIET"
echo ""

# Run the test
node test/browser-integration-test.js
