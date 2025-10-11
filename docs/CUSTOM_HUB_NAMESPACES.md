# Custom Hub Network Namespaces

## Overview

PeerPigeon hubs communicate with each other on a dedicated network namespace to form their own mesh network. By default, this namespace is `pigeonhub-mesh`, but you can configure a custom namespace for your deployment.

## Why Use Custom Namespaces?

Custom hub namespaces allow you to:

1. **Isolate Different Deployments** - Run multiple independent hub networks on the same signaling server
2. **Environment Separation** - Use different namespaces for development, staging, and production environments
3. **Multi-Tenant Systems** - Create separate hub networks for different organizations or customers
4. **Testing and Development** - Test new hub configurations without affecting production hubs

## Configuration

### Environment Variable

The simplest way to set a custom namespace is via the `HUB_MESH_NAMESPACE` environment variable:

```bash
# Start a hub with custom namespace
HUB_MESH_NAMESPACE=my-custom-mesh npm run hub

# Start a hub network with custom namespace
HUB_MESH_NAMESPACE=production-mesh node scripts/start-hub-network.js

# Start signaling server with custom namespace
HUB_MESH_NAMESPACE=dev-mesh npm run server
```

### Programmatic Configuration

You can also set the namespace programmatically when creating a server:

```javascript
import { PeerPigeonServer } from './server/index.js';

const hubServer = new PeerPigeonServer({
    port: 3000,
    host: 'localhost',
    isHub: true,
    hubMeshNamespace: 'production-hub-mesh'
});

await hubServer.start();
```

## Important Considerations

### All Hubs Must Use the Same Namespace

**Critical:** All hubs in the same deployment must use the **exact same namespace** to discover and connect to each other. If hubs use different namespaces, they won't be able to form a mesh network.

```bash
# ✅ CORRECT - All hubs use the same namespace
HUB_MESH_NAMESPACE=production-mesh PORT=3000 npm run hub &
HUB_MESH_NAMESPACE=production-mesh PORT=3001 npm run hub &
HUB_MESH_NAMESPACE=production-mesh PORT=3002 npm run hub &

# ❌ WRONG - Hubs use different namespaces (won't connect)
HUB_MESH_NAMESPACE=production-mesh PORT=3000 npm run hub &
HUB_MESH_NAMESPACE=staging-mesh PORT=3001 npm run hub &
```

### Namespace Naming Guidelines

- Use lowercase letters, numbers, and hyphens
- Be descriptive and meaningful (e.g., `production-hub-mesh`, `dev-testing-mesh`)
- Avoid special characters that might cause issues in URLs or filenames
- Keep it consistent across your deployment

### Default Namespace

If you don't specify a custom namespace, hubs will use the default `pigeonhub-mesh` namespace. This is fine for most deployments and ensures backward compatibility.

## Use Cases

### 1. Multi-Environment Deployment

```bash
# Development environment
HUB_MESH_NAMESPACE=dev-mesh npm run hub

# Staging environment
HUB_MESH_NAMESPACE=staging-mesh npm run hub

# Production environment
HUB_MESH_NAMESPACE=production-mesh npm run hub
```

### 2. Multi-Tenant System

```bash
# Organization A's hub network
HUB_MESH_NAMESPACE=org-a-mesh npm run hub

# Organization B's hub network
HUB_MESH_NAMESPACE=org-b-mesh npm run hub
```

### 3. Feature Testing

```bash
# Production hubs
HUB_MESH_NAMESPACE=production-mesh npm run hub

# Experimental feature hubs (isolated from production)
HUB_MESH_NAMESPACE=experimental-features-mesh npm run hub
```

## Verification

You can verify that hubs are using the correct namespace by checking the server logs:

```bash
# When starting a hub with custom namespace, you'll see:
🚀 Starting PeerPigeon Hub...
🌐 Using custom hub mesh namespace: production-mesh

✅ Hub running on ws://localhost:3000
```

You can also check the server's configuration programmatically:

```javascript
console.log('Hub mesh namespace:', hubServer.hubMeshNamespace);
```

## Client Announcements

When clients want to connect as hubs, they should announce on the same namespace:

```javascript
// Client announces as a hub
const announceMessage = {
    type: 'announce',
    networkName: 'production-mesh', // Use the same namespace as your hub deployment
    data: {
        isHub: true,
        capabilities: ['signaling', 'relay']
    }
};

ws.send(JSON.stringify(announceMessage));
```

## Troubleshooting

### Hubs Not Discovering Each Other

**Problem:** Hubs are running but not forming connections.

**Solution:** Verify all hubs are using the same `hubMeshNamespace`:
- Check environment variables
- Review server logs for namespace information
- Ensure bootstrap hub URIs are correct

### Mixed Namespace Configuration

**Problem:** Some hubs use default namespace, others use custom namespace.

**Solution:** Standardize the namespace across all hubs in your deployment. Either:
- Use default `pigeonhub-mesh` for all hubs (remove custom config)
- Set the same custom namespace for all hubs

## Best Practices

1. **Document Your Namespace** - Keep a record of which namespaces are used in which environments
2. **Use Environment Variables** - Makes it easier to deploy the same code to different environments
3. **Consistent Naming** - Use a naming convention across all your namespaces
4. **Test Isolation** - Verify that hubs in different namespaces don't interfere with each other
5. **Monitor Hub Connections** - Use the `/hubs` endpoint to verify hubs are discovering each other

## Related Documentation

- [Hub System Overview](./HUB_SYSTEM.md)
- [Hub Scripts](./HUB_SCRIPTS.md)
- [Hub Quick Reference](./HUB_QUICK_REF.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Network Namespaces (for peers)](./NETWORK_NAMESPACES.md)
