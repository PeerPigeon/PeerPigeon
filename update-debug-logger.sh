#!/bin/bash

# Script to update all PeerPigeon source files to use the debug logger system
# This replaces console.* statements with this.debug.* statements

# List of all source files to update
FILES=(
  "src/CleanupManager.js"
  "src/CryptoManager.js"
  "src/DistributedStorageManager.js"
  "src/EnvironmentDetector.js"
  "src/EventEmitter.js"
  "src/EvictionManager.js"
  "src/MediaManager.js"
  "src/MeshOptimizer.js"
  "src/PeerConnection.js"
  "src/PeerDiscovery.js"
  "src/PeerPigeonMesh.js"
  "src/SignalingClient.js"
  "src/SignalingHandler.js"
  "src/StorageManager.js"
  "src/TimerUtils.js"
  "src/WebDHT.js"
)

# Function to add debug logger import and create debug instance
add_debug_logger() {
  local file="$1"
  local class_name="$2"
  
  echo "Updating $file with debug logger..."
  
  # Check if DebugLogger import already exists
  if ! grep -q "import DebugLogger" "$file"; then
    # Find the last import statement and add our import after it
    if grep -q "^import " "$file"; then
      # Add import after last import
      sed -i '' '/^import /,$!b;/^import /h;/^$/!d;x;/^import /{a\
import DebugLogger from '\''./DebugLogger.js'\'';
p;}' "$file"
    else
      # No imports found, add at the top
      sed -i '' '1i\
import DebugLogger from '\''./DebugLogger.js'\'';
' "$file"
    fi
  fi
  
  # Add debug instance creation in constructor
  if ! grep -q "this\.debug = DebugLogger\.create" "$file"; then
    # Find constructor and add debug logger creation
    sed -i '' "/constructor(/,/^[[:space:]]*super();/{
      /^[[:space:]]*super();/a\\
    this.debug = DebugLogger.create('$class_name');
    }" "$file"
  fi
  
  # Replace console statements with debug statements
  sed -i '' '
    s/console\.log(/this.debug.log(/g
    s/console\.warn(/this.debug.warn(/g
    s/console\.error(/this.debug.error(/g
    s/console\.info(/this.debug.info(/g
    s/console\.debug(/this.debug.debug(/g
  ' "$file"
}

# Update each file
add_debug_logger "src/CleanupManager.js" "CleanupManager"
add_debug_logger "src/CryptoManager.js" "CryptoManager" 
add_debug_logger "src/DistributedStorageManager.js" "DistributedStorageManager"
add_debug_logger "src/EnvironmentDetector.js" "EnvironmentDetector"
add_debug_logger "src/EventEmitter.js" "EventEmitter"
add_debug_logger "src/EvictionManager.js" "EvictionManager"
add_debug_logger "src/MediaManager.js" "MediaManager"
add_debug_logger "src/MeshOptimizer.js" "MeshOptimizer"
add_debug_logger "src/PeerConnection.js" "PeerConnection"
add_debug_logger "src/PeerDiscovery.js" "PeerDiscovery"
add_debug_logger "src/PeerPigeonMesh.js" "PeerPigeonMesh"
add_debug_logger "src/SignalingClient.js" "SignalingClient"
add_debug_logger "src/SignalingHandler.js" "SignalingHandler"
add_debug_logger "src/StorageManager.js" "StorageManager"
add_debug_logger "src/TimerUtils.js" "TimerUtils"
add_debug_logger "src/WebDHT.js" "WebDHT"

echo "Debug logger integration complete!"
echo ""
echo "Usage examples:"
echo "  // Enable all debugging"
echo "  DebugLogger.enableAll();"
echo ""
echo "  // Enable specific modules"
echo "  DebugLogger.enable('GossipManager');"
echo "  DebugLogger.enable('PeerConnection');"
echo ""
echo "  // Enable multiple modules"
echo "  DebugLogger.enableModules(['GossipManager', 'ConnectionManager', 'PeerConnection']);"
echo ""
echo "  // Disable all (default state)"
echo "  DebugLogger.disableAll();"
