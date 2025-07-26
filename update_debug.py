#!/usr/bin/env python3

import os
import re
import glob

# Configuration for each source file
files_config = {
    'src/CleanupManager.js': 'CleanupManager',
    'src/CryptoManager.js': 'CryptoManager',
    'src/DistributedStorageManager.js': 'DistributedStorageManager',
    'src/EnvironmentDetector.js': 'EnvironmentDetector',
    'src/EventEmitter.js': 'EventEmitter',
    'src/EvictionManager.js': 'EvictionManager',
    'src/MediaManager.js': 'MediaManager',
    'src/MeshOptimizer.js': 'MeshOptimizer',
    'src/PeerDiscovery.js': 'PeerDiscovery',
    'src/PeerPigeonMesh.js': 'PeerPigeonMesh',
    'src/SignalingClient.js': 'SignalingClient',
    'src/SignalingHandler.js': 'SignalingHandler',
    'src/StorageManager.js': 'StorageManager',
    'src/TimerUtils.js': 'TimerUtils',
    'src/WebDHT.js': 'WebDHT'
}

def update_file(filepath, class_name):
    """Update a single file to use debug logger"""
    
    if not os.path.exists(filepath):
        print(f"File {filepath} not found, skipping...")
        return
        
    print(f"Updating {filepath}...")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Check if already has DebugLogger import
    if 'import DebugLogger' not in content:
        # Add import after the last import statement
        import_pattern = r'(import[^;]+;)'
        imports = re.findall(import_pattern, content)
        if imports:
            last_import = imports[-1]
            replacement = last_import + "\nimport DebugLogger from './DebugLogger.js';"
            content = content.replace(last_import, replacement, 1)
        else:
            # No imports found, add at the top
            content = "import DebugLogger from './DebugLogger.js';\n" + content
    
    # Add debug instance in constructor if not already present
    if 'this.debug = DebugLogger.create' not in content:
        # Find constructor and add debug creation after super()
        constructor_pattern = r'(constructor\([^)]*\)\s*{[^}]*super\(\);)'
        match = re.search(constructor_pattern, content, re.DOTALL)
        if match:
            old_constructor = match.group(1)
            new_constructor = old_constructor + f"\n    this.debug = DebugLogger.create('{class_name}');"
            content = content.replace(old_constructor, new_constructor, 1)
    
    # Replace console statements with debug statements
    replacements = [
        (r'console\.log\(', 'this.debug.log('),
        (r'console\.warn\(', 'this.debug.warn('),
        (r'console\.error\(', 'this.debug.error('),
        (r'console\.info\(', 'this.debug.info('),
        (r'console\.debug\(', 'this.debug.debug(')
    ]
    
    for pattern, replacement in replacements:
        content = re.sub(pattern, replacement, content)
    
    # Write the updated content back
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"  ✓ Updated {filepath}")

def main():
    print("Updating PeerPigeon files to use DebugLogger...")
    print("=" * 50)
    
    # Update each configured file
    for filepath, class_name in files_config.items():
        update_file(filepath, class_name)
    
    print("\nDebug logger integration complete!")
    print("\nUsage examples:")
    print("  // Enable all debugging")
    print("  DebugLogger.enableAll();")
    print("")
    print("  // Enable specific modules")
    print("  DebugLogger.enable('GossipManager');")
    print("  DebugLogger.enable('PeerConnection');")
    print("")
    print("  // Enable multiple modules")
    print("  DebugLogger.enableModules(['GossipManager', 'ConnectionManager', 'PeerConnection']);")
    print("")
    print("  // Disable all (default state)")
    print("  DebugLogger.disableAll();")

if __name__ == "__main__":
    main()
