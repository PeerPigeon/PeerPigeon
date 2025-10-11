# Custom Hub Network Namespace Feature - Implementation Summary

## Overview

Added support for custom hub network namespaces with a default fallback to `pigeonhub-mesh`. This allows deployments to isolate different hub networks while maintaining backward compatibility.

## Changes Made

### 1. Core Server Configuration (`server/index.js`)

**Modified:** Constructor to accept `hubMeshNamespace` option
- Added `options.hubMeshNamespace` parameter with default value `'pigeonhub-mesh'`
- Changed from hardcoded string to configurable option
- Maintains backward compatibility (defaults to existing behavior)

```javascript
// Before:
this.hubMeshNamespace = 'pigeonhub-mesh';

// After:
this.hubMeshNamespace = options.hubMeshNamespace || 'pigeonhub-mesh';
```

### 2. Server Startup Scripts

#### `server/start.js`
- Added `HUB_MESH_NAMESPACE` environment variable support
- Passes namespace to PeerPigeonServer constructor
- Updated documentation comment

#### `scripts/start-hub.js`
- Added `HUB_MESH_NAMESPACE` environment variable support
- Displays custom namespace message when non-default value is used
- Updated usage documentation in header comment

#### `scripts/start-hub-network.js`
- Added `HUB_MESH_NAMESPACE` environment variable support
- Passes namespace to all hubs (bootstrap and secondary)
- Displays namespace in configuration output

### 3. Documentation Updates

#### New Documentation
- **`docs/CUSTOM_HUB_NAMESPACES.md`** - Complete guide for custom namespaces
  - Overview and use cases
  - Configuration methods (env vars and programmatic)
  - Important considerations
  - Best practices
  - Troubleshooting guide

#### Updated Documentation
- **`docs/HUB_SYSTEM.md`**
  - Updated Hub Namespace section
  - Added configuration examples showing custom namespaces
  - Documented the hubMeshNamespace option

- **`docs/HUB_SCRIPTS.md`**
  - Added HUB_MESH_NAMESPACE to environment variables section
  - Added example usage
  - Updated both start-hub.js and start-hub-network.js documentation

- **`docs/HUB_QUICK_REF.md`**
  - Updated default configuration section
  - Added note about configurability

- **`docs/API_DOCUMENTATION.md`**
  - Added `hubMeshNamespace` parameter to PeerPigeonServer constructor docs
  - Added explanation note about namespace consistency

- **`docs/README.md`**
  - Added link to Custom Hub Namespaces guide

- **`examples/hub-example.js`**
  - Updated comments to mention configurability
  - Added note about custom namespaces

### 4. Testing

Created `test/test-custom-namespace.js` to verify:
- Default namespace behavior (backward compatibility)
- Custom namespace via constructor option
- Environment variable support
- Regular server namespace configuration

All tests pass successfully.

## Backward Compatibility

✅ **Fully backward compatible** - All existing code continues to work without changes:
- Default namespace is still `'pigeonhub-mesh'`
- No breaking changes to API
- Existing hubs will continue to work without modification

## Usage Examples

### Environment Variable (Recommended)

```bash
# Start a single hub with custom namespace
HUB_MESH_NAMESPACE=production-mesh npm run hub

# Start a hub network with custom namespace
HUB_MESH_NAMESPACE=staging-mesh node scripts/start-hub-network.js

# Multiple environments
HUB_MESH_NAMESPACE=dev-mesh PORT=3000 npm run hub &
HUB_MESH_NAMESPACE=prod-mesh PORT=4000 npm run hub &
```

### Programmatic Configuration

```javascript
import { PeerPigeonServer } from './server/index.js';

const hub = new PeerPigeonServer({
    port: 3000,
    isHub: true,
    hubMeshNamespace: 'my-custom-mesh'
});

await hub.start();
```

## Key Features

1. **Default Fallback** - Uses `pigeonhub-mesh` if not specified
2. **Environment Variable Support** - Easy deployment configuration
3. **Programmatic API** - Full control via constructor options
4. **Consistent Configuration** - All hubs must use same namespace
5. **Complete Documentation** - Comprehensive guides and examples

## Important Notes

⚠️ **All hubs in the same network must use the same namespace** to discover and connect to each other.

✅ **Use consistent naming** - Keep namespace consistent across all hubs in a deployment.

✅ **Document your namespaces** - Maintain a record of which namespaces are used where.

## Files Modified

1. `server/index.js` - Core server configuration
2. `server/start.js` - Standalone server startup
3. `scripts/start-hub.js` - Single hub startup script
4. `scripts/start-hub-network.js` - Hub network startup script
5. `docs/HUB_SYSTEM.md` - Hub system documentation
6. `docs/HUB_SCRIPTS.md` - Hub scripts documentation
7. `docs/HUB_QUICK_REF.md` - Quick reference guide
8. `docs/API_DOCUMENTATION.md` - API reference
9. `docs/README.md` - Documentation index
10. `examples/hub-example.js` - Hub example code

## Files Created

1. `docs/CUSTOM_HUB_NAMESPACES.md` - Comprehensive namespace guide
2. `test/test-custom-namespace.js` - Feature verification tests

## Testing

Run the test to verify the implementation:

```bash
node test/test-custom-namespace.js
```

All tests pass, confirming:
- ✅ Default namespace works
- ✅ Custom namespaces via constructor work
- ✅ Environment variable support works
- ✅ Regular servers support custom namespaces

## Migration Path

For existing deployments:
1. **No action required** - Default behavior unchanged
2. To use custom namespaces:
   - Set `HUB_MESH_NAMESPACE` environment variable
   - Or pass `hubMeshNamespace` in constructor options
   - Ensure all hubs use the same namespace

## Future Enhancements

Possible future improvements:
- Hub discovery across multiple namespaces
- Namespace-based access controls
- Dynamic namespace switching
- Namespace registry and management API
