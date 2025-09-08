# Network Namespaces in PeerPigeon

PeerPigeon now supports **named network segregation** with automatic global mesh fallback, allowing you to create isolated peer-to-peer networks for different purposes while maintaining connectivity when needed.

## Features

### Named Networks
- Create isolated mesh networks with custom names (e.g., "gaming", "work", "family")
- Peers in different networks cannot discover or connect to each other directly
- Messages, DHT data, and storage are fully isolated by network namespace
- Backward compatible with existing deployments using the "global" network

### Global Fallback
- When a named network has insufficient peers, automatically fall back to the global network
- Seamlessly return to the original network when peers become available
- Configurable fallback behavior (can be disabled if strict isolation is required)

### Data Isolation
- **Gossip Messages**: Network-scoped message propagation
- **WebDHT**: Namespaced key-value storage with network prefixes
- **Peer Discovery**: Network-filtered peer announcements
- **Signaling**: Network-tagged signaling messages

## Usage

### Basic Setup

```javascript
// Create a mesh in a specific network
const mesh = new PeerPigeon.PeerPigeonMesh({
  networkName: 'gaming',           // Join the "gaming" network
  allowGlobalFallback: true,       // Allow fallback to global network
  maxPeers: 3,
  minPeers: 2
});

await mesh.init();
await mesh.connect('ws://localhost:3000');
```

### Network Management

```javascript
// Change network (only when disconnected)
mesh.setNetworkName('work');

// Check current network status
const status = mesh.getStatus();
console.log('Current network:', status.networkName);
console.log('Original network:', status.originalNetworkName);
console.log('In fallback mode:', status.isInFallbackMode);

// Configure fallback behavior
mesh.setAllowGlobalFallback(false); // Disable fallback for strict isolation
```

### Event Handling

```javascript
// Listen for network status changes
mesh.addEventListener('statusChanged', (event) => {
  if (event.type === 'network') {
    console.log('Network status:', event.message);
    console.log('Current network:', event.networkName);
    console.log('Fallback mode:', event.fallbackMode);
  }
});
```

## Browser UI Support

The browser-2 example now includes a Network tab with:

- **Current Network Display**: Shows active network and fallback status
- **Network Switching**: Easy switching between named networks
- **Quick Networks**: Predefined network buttons (global, gaming, work, family, test)
- **Fallback Controls**: Toggle global fallback on/off
- **Network Health**: Real-time peer count and connection status

## API Reference

### Constructor Options

```javascript
const mesh = new PeerPigeon.PeerPigeonMesh({
  networkName: 'global',          // Network name (default: 'global')
  allowGlobalFallback: true,      // Allow global fallback (default: true)
  // ... other existing options
});
```

### Methods

- `setNetworkName(name)` - Change network (only when disconnected)
- `getNetworkName()` - Get current network name
- `getOriginalNetworkName()` - Get original network name (before fallback)
- `isUsingGlobalFallback()` - Check if currently in fallback mode
- `setAllowGlobalFallback(allow)` - Enable/disable global fallback

### Status Properties

The `getStatus()` method now includes:

```javascript
{
  networkName: 'gaming',           // Current network
  originalNetworkName: 'gaming',   // Original network
  isInFallbackMode: false,         // Whether in fallback mode
  allowGlobalFallback: true,       // Fallback setting
  // ... other existing status properties
}
```

## Use Cases

### Gaming Communities
```javascript
// Create isolated gaming networks
const gamingMesh = new PeerPigeon.PeerPigeonMesh({
  networkName: 'minecraft-server-1',
  allowGlobalFallback: false  // Strict isolation
});
```

### Work Teams
```javascript
// Create private work networks with fallback
const workMesh = new PeerPigeon.PeerPigeonMesh({
  networkName: 'team-alpha',
  allowGlobalFallback: true  // Fall back to global if team is offline
});
```

### Family Networks
```javascript
// Create family networks for private sharing
const familyMesh = new PeerPigeon.PeerPigeonMesh({
  networkName: 'smith-family',
  allowGlobalFallback: false  // Keep family data private
});
```

## Migration Guide

### Existing Applications
Existing PeerPigeon applications continue to work without changes. They automatically use the "global" network namespace.

### Adding Network Support
1. Add `networkName` to constructor options
2. Optionally configure `allowGlobalFallback`
3. Handle network status events
4. Update UI to show current network (optional)

## Implementation Details

### Signaling Protocol
All signaling messages now include a `networkName` field:

```javascript
{
  type: 'offer',
  data: { /* offer data */ },
  networkName: 'gaming',
  // ... other fields
}
```

### DHT Storage
Keys are automatically prefixed with the network name:
- User key: `"mykey"`
- Stored as: `"gaming:mykey"`

### Gossip Messages
Messages include network namespace and are filtered on receipt:

```javascript
{
  id: 'msg-123',
  type: 'gossip',
  content: 'Hello network!',
  networkName: 'gaming',
  // ... other fields
}
```

### Fallback Logic
1. Monitor network health (peer count, discovery)
2. If original network becomes empty, activate global fallback
3. Periodically check if original network has peers
4. Automatically return to original network when viable

## Best Practices

1. **Choose meaningful network names** - Use descriptive names like "project-alpha" or "family-chat"
2. **Consider fallback carefully** - Enable for public/social networks, disable for private/sensitive networks
3. **Monitor network status** - Listen for status events to inform users about network changes
4. **Test isolation** - Verify that different networks cannot access each other's data
5. **Plan for empty networks** - Consider what happens when you're the first/only peer in a network

## Limitations

1. **Disconnect required for network change** - Must disconnect before switching networks
2. **No cross-network communication** - Networks are fully isolated (by design)
3. **Signaling server support** - Requires updated signaling server for optimal peer counting
4. **Fallback detection** - Current implementation uses simple heuristics for network health

## Future Enhancements

- **Signaling server integration** - Better peer counting and network health detection
- **Network bridging** - Optional cross-network message relay for authorized peers
- **Network discovery** - Discover available networks through the signaling server
- **Persistent preferences** - Remember preferred networks across sessions
