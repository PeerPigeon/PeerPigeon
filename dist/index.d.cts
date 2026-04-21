type GossipProtocolOptions = {
    /** Maximum number of re-propagation hops for a message. */
    maxHops?: number;
    /** Maximum hops for a direct/routed message before it is dropped. Default 20. */
    maxDirectHops?: number;
    /** Relative weight of coordinate-space distance in CECR hybrid routing (0..1). */
    cecrCoordinateWeight?: number;
    /** Maximum age of extrema snapshot before coordinate weight is reduced. */
    cecrExtremaMaxAgeMs?: number;
    /** If coordinate drift exceeds this, coordinate routing is strongly de-weighted. */
    cecrMaxAcceptedDrift?: number;
    /** Require canonical global-set/extrema agreement across connected peers before coordinate routing. */
    cecrRequireConsensus?: boolean;
};
type GossipMessage = {
    id: string;
    timestamp: number;
    hops: number;
    maxHops: number;
    sender: string | null;
    data: unknown;
    metadata: Record<string, unknown>;
    type: 'gossip';
};
type DirectMessage = {
    id: string;
    type: 'direct';
    from: string;
    to: string;
    data: unknown;
    hops: number;
    maxHops: number;
    timestamp: number;
};
type GossipStats = {
    totalMessagesTracked: number;
    recentMessages: Array<{
        id: string;
        timestamp: number;
        sender: string | null;
        hops: number;
        age: number;
    }>;
    connectedPeers: number;
    discoveredPeers: number;
};
interface MeshLike {
    on(event: 'peer:data', handler: (data: {
        peerId: string;
        data: any;
    }) => void): void;
    on(event: 'peer:connected' | 'peer:disconnected', handler: (peerId: string) => void): void;
    getClientId(): string | null;
    getConnectedPeers(): string[];
    getDiscoveredPeers(): string[];
    getGlobalPeers(): string[];
    send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void;
}
type GossipEvents = {
    messageReceived: (data: {
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
    }) => void;
    peerConnected: (data: {
        peerId: string;
    }) => void;
    peerDisconnected: (data: {
        peerId: string;
    }) => void;
    directMessageReceived: (data: {
        message: DirectMessage;
    }) => void;
};
/**
 * GossipProtocol
 *
 * A small, application-level gossip/epidemic message propagation helper.
 *
 * - De-duplicates messages by `id`
 * - Re-broadcasts unseen messages to connected peers until `maxHops`
 */
declare class GossipProtocol {
    private mesh;
    private messageLog;
    private readonly maxTrackedMessages;
    private readonly maxTrackedDirectIds;
    private readonly trackingRetentionMs;
    private maxHops;
    private maxDirectHops;
    private cecrCoordinateWeight;
    private cecrExtremaMaxAgeMs;
    private cecrMaxAcceptedDrift;
    private cecrRequireConsensus;
    private cecrCurrentExtrema;
    private cecrPreviousExtrema;
    private cecrRemoteStates;
    private cecrSyncTimer;
    private trackingCleanupTimer;
    private seenDirectIds;
    private callbacks;
    private peers;
    constructor(mesh: MeshLike, options?: GossipProtocolOptions);
    private setupMeshListeners;
    private startCecrSyncLoop;
    private startTrackingCleanupLoop;
    /**
     * Broadcast an application payload using gossip-style re-propagation.
     */
    broadcast(data: unknown, metadata?: Record<string, unknown>): string;
    /**
     * Propagate a message to all currently-connected peers.
     */
    propagate(message: GossipMessage, exceptPeerId?: string): void;
    /**
     * Handle an incoming message from the mesh.
     */
    handleIncomingMessage(message: GossipMessage, fromPeerId: string): void;
    /**
     * XOR distance between two hex-encoded peer IDs.
     * Returns a BigInt (lower = closer).
     */
    private xorDistance;
    /**
     * Pick the connected peer closest (by XOR distance) to target.
     * Falls back to any connected peer if IDs can't be compared.
     */
    private closestPeerTo;
    private peerIdToNumeric;
    private canonicalPeerSet;
    private canonicalSetHash;
    private updateCecrExtremaSnapshot;
    private coordinateFor;
    private effectiveCecrCoordinateWeight;
    private hasCecrConsensus;
    private publishCecrState;
    private handleIncomingCecrState;
    private normalizedBigIntRatio;
    private closestPeerHybrid;
    /**
     * Send a direct message to a specific peer, routed through the mesh via XOR distance.
     * Delivers even if there is no direct connection to the target.
     */
    sendDirect(targetPeerId: string, data: unknown): string | null;
    private routeDirect;
    private handleIncomingDirect;
    getStats(): GossipStats;
    cleanup(maxAgeMs?: number): void;
    private markDirectSeen;
    private pruneTracking;
    on<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void;
    off<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void;
    destroy(): void;
    private emit;
    private tryParseGossipMessage;
    private generateMessageId;
}

type StorageSpace = 'public' | 'user' | 'frozen' | 'private' | 'epublic';
type StorageVersion = string | number;
type StorageChangeOrigin = 'local' | 'remote';
interface StorageRecord<T = unknown> {
    space: StorageSpace;
    key: string;
    value: T;
    ownerId: string | null;
    createdAt: number;
    updatedAt: number;
    version: StorageVersion;
}
interface StoragePutOptions {
    /**
     * Override owner for first write in user-space records.
     */
    ownerId?: string;
}
interface StorageSyncOptions {
    /**
     * Shared room scope used to derive sync encryption keys.
     */
    sessionId?: string;
    /**
     * Optional secret mixed into key derivation for stronger room privacy.
     */
    syncSecret?: string;
}
interface StorageRetrieveOptions {
    timeoutMs?: number;
}
interface StorageSyncFilterContext {
    kind: 'mutation' | 'retrieve-request' | 'retrieve-response';
    actorId: string;
}
interface StorageOptions extends StorageSyncOptions {
    /**
     * Local user identity used by ACL checks.
     */
    userId: string;
    /**
     * Optional mesh gossip helper.
     */
    gossip?: GossipLike;
    /**
     * Optional IndexedDB name (default: peerpigeon-storage-v1).
     */
    dbName?: string;
    /**
     * Optional local gate for remote sync payloads.
     * Returning false drops remote storage updates for the given key.
     */
    syncFilter?: (space: StorageSpace, key: string, context: StorageSyncFilterContext) => boolean;
}
type StorageEvents = {
    change: (event: {
        origin: StorageChangeOrigin;
        op: 'upsert' | 'delete';
        record: StorageRecord | null;
        space: StorageSpace;
        key: string;
        actorId: string;
    }) => void;
};
type StorageUnsubscribe = () => void;
interface GossipLike {
    broadcast(data: unknown, metadata?: Record<string, unknown>): string;
    on(event: 'messageReceived', callback: (data: {
        message: {
            data: unknown;
        };
        local: boolean;
        fromPeer?: string;
    }) => void): void;
    off(event: 'messageReceived', callback: (data: {
        message: {
            data: unknown;
        };
        local: boolean;
        fromPeer?: string;
    }) => void): void;
}
/**
 * PeerPigeonStorage
 *
 * - Persists records in IndexedDB (fallback: in-memory)
 * - Syncs non-private spaces over encrypted gossip envelopes
 * - Enforces five built-in ACL spaces: public, user, frozen, private, epublic
 * - epublic is internal-only and can only be mutated through putSystem/deleteSystem
 */
declare class PeerPigeonStorage {
    private readonly userId;
    private readonly gossip;
    private readonly sessionId;
    private readonly syncSecret;
    private readonly dbName;
    private readonly syncFilter;
    private readonly storeName;
    private driver;
    private readonly listeners;
    private readonly pendingRetrieveRequests;
    private closed;
    private readonly onGossipMessageBound;
    private readonly instanceId;
    private crossTabChannel;
    private readonly crossTabSeenNoticeIds;
    private readonly crossTabStorageEventBound;
    private readonly crossTabChannelMessageBound;
    constructor(options: StorageOptions);
    init(): Promise<void>;
    on(event: 'change', listener: StorageEvents['change']): void;
    subscribe(listener: StorageEvents['change']): StorageUnsubscribe;
    off(event: 'change', listener: StorageEvents['change']): void;
    put<T = unknown>(space: StorageSpace, key: string, value: T, options?: StoragePutOptions): Promise<StorageRecord<T>>;
    putSystem<T = unknown>(space: StorageSpace, key: string, value: T, options?: StoragePutOptions): Promise<StorageRecord<T>>;
    get<T = unknown>(space: StorageSpace, key: string): Promise<StorageRecord<T> | null>;
    retrieve<T = unknown>(space: StorageSpace, key: string, options?: StorageRetrieveOptions): Promise<StorageRecord<T> | null>;
    delete(space: StorageSpace, key: string): Promise<boolean>;
    deleteSystem(space: StorageSpace, key: string): Promise<boolean>;
    list(space: StorageSpace): Promise<StorageRecord[]>;
    close(): Promise<void>;
    private applyLocalUpsert;
    private applyLocalDelete;
    private handleGossipMessage;
    private applyRemoteMutation;
    private setupCrossTabSync;
    private teardownCrossTabSync;
    private crossTabChannelName;
    private crossTabStorageKey;
    private publishCrossTabNotice;
    private handleCrossTabChannelMessage;
    private handleCrossTabStorageEvent;
    private consumeCrossTabNotice;
    private applyCrossTabNotice;
    private trimSeenNoticeIds;
    private broadcastMutation;
    private broadcastSyncPayload;
    private handleRetrieveRequest;
    private handleRetrieveResponse;
    private shouldAcceptRemoteSync;
    private createDriver;
    private emitChange;
    private requireDriver;
    private normalizeKey;
    private makePk;
    private makeMutationId;
    private parseStorageVersion;
    private versionSourceToken;
    private normalizeStorageVersion;
    private compareStorageVersions;
    private nextStorageVersion;
    private resolveOwnerId;
    private assertCanWrite;
    private canWrite;
    private isPeerIdFormat;
    private assertCanDelete;
    private canDelete;
    private encodeValueForStore;
    private decodeValueForRead;
    private isSyncEnvelope;
    private isStorageMutation;
    private isStorageRetrieveRequest;
    private isStorageRetrieveResponse;
    private isCrossTabNotice;
    private isCipherPayload;
    private encryptSyncPayload;
    private decryptSyncEnvelope;
    private encryptPrivateValue;
    private decryptPrivateValue;
    private deriveAesKey;
    private encryptJson;
    private decryptJson;
    private toBase64Url;
    private fromBase64Url;
}

interface PartialMeshConfig {
    /**
     * Minimum number of peers to maintain connections with
     */
    minPeers?: number;
    /**
     * Maximum number of peers to maintain connections with
     */
    maxPeers?: number;
    /**
     * Additional temporary peers allowed above maxPeers before trimming.
     */
    tolerantPeers?: number;
    /**
      * FreeRTC signaling server URL
     */
    signalingServer?: string;
    /**
     * Session/room ID for peer discovery
     */
    sessionId?: string;
    /**
     * Automatically discover peers through the signaling server
     */
    autoDiscover?: boolean;
    /**
     * Automatically connect to discovered peers
     */
    autoConnect?: boolean;
    /**
     * ICE servers configuration for STUN/TURN.
     * Set to null to use FreeRTC defaults.
     */
    iceServers?: RTCIceServer[] | null;
    /**
     * How long to wait for a peer connection to reach 'connect' before retrying.
     * Helps avoid peers getting stuck in 'connecting' indefinitely.
     */
    connectionTimeoutMs?: number;
    /**
     * Periodic maintenance interval for autoConnect.
      * When set, the mesh will periodically attempt to converge to the desired connection count.
     */
    maintenanceIntervalMs?: number;
    /**
     * If set (>0), perform a hard reset of all peer connections when the mesh remains
     * under-connected (connectedPeers < minPeers) for this long while there are enough
     * discovered peers available to connect to.
     *
     * This helps recover from rare stuck negotiation/ICE states in some browsers.
     */
    underConnectedResetMs?: number;
    /**
     * Optional fallback for environments where asymmetric discovery can stall.
     * When set (>0), non-initiators may place a delayed assist dial if no inbound
     * negotiation appears within this window.
     */
    nonInitiatorFallbackDialMs?: number;
    /**
     * Whether SDP should be sent before ICE gathering completes.
     * Disable to emit full offer/answer payloads after ICE gathering finishes.
     */
    trickleIce?: boolean;
}
interface PeerConnection {
    id: string;
    connected: boolean;
    initiator: boolean;
}
type PartialMeshEvents = {
    'signaling:connected': (data: {
        clientId: string;
        rawClientId?: string;
    }) => void;
    'signaling:disconnected': () => void;
    'signaling:error': (error: any) => void;
    'signaling:log': (data: {
        message: string;
    }) => void;
    'peer:connected': (peerId: string) => void;
    'peer:disconnected': (peerId: string) => void;
    'peer:data': (data: {
        peerId: string;
        data: any;
    }) => void;
    'peer:error': (data: {
        peerId: string;
        error: any;
    }) => void;
    'peer:discovered': (peerId: string) => void;
    'mesh:ready': () => void;
    'mesh:membership': (peers: string[]) => void;
};
/**
 * PartialMesh - WebRTC peer-to-peer partial mesh networking library
 *
 * Uses FreeRTC for signaling and maintains a configurable number of peer connections.
 */
declare class PartialMesh {
    private config;
    private peers;
    private signalingClient;
    private discoveredPeers;
    private clientId;
    private selfAliases;
    private eventHandlers;
    private connecting;
    private connectionTimers;
    private connectionStartedAtMs;
    private peerConnectedAtMs;
    private discoveredAtMs;
    private maintenanceTimer;
    private underConnectedSinceMs;
    private lastHardResetAtMs;
    private lastDiscoveryRefreshAtMs;
    private lastSignalingReconnectAtMs;
    private dialFailureCount;
    private dialBackoffUntilMs;
    private nonInitiatorFallbackTimers;
    private rebalanceCooldownUntilMs;
    private rebalanceAttemptAtMs;
    private pendingRebalanceDropByTarget;
    /** Converged global peer membership — populated via in-band membership gossip. */
    private globalPeers;
    constructor(config?: PartialMeshConfig);
    private normalizePeerId;
    private addSelfAlias;
    private isSelfAlias;
    private addDiscoveredPeer;
    private getConnectedPeerCount;
    private getPendingPeerCount;
    private getMaxPeersWithTolerance;
    private trimExcessPeers;
    private getOldestPendingAgeMs;
    private isHexId;
    private fastIdHash;
    private peerDistance;
    private maybeRebalanceForCloserPeer;
    /**
     * Initialize and connect to the signaling server
     */
    init(): Promise<void>;
    private startMaintenanceLoop;
    private maybeRefreshDiscovery;
    private maybeRecoverStalledNegotiations;
    private maybeHardResetUnderConnected;
    private isPeerBackedOff;
    private noteDialFailure;
    private noteDialSuccess;
    private noteIntentionalShed;
    private clearDialBackoff;
    /**
     * Hard reset peer connections (keeps signaling + discovered peers).
     * Useful for recovering from rare stuck negotiation/ICE states.
     */
    hardReset(reason?: string): void;
    /**
     * Create a new peer connection
     */
    private createPeerConnection;
    /**
     * Maintain the target number of peer connections
     */
    private maintainPeerConnections;
    /**
     * Connect to a specific peer
     */
    connectToPeer(peerId: string): void;
    private connectToPeerInternal;
    /**
     * Disconnect from a specific peer
     */
    disconnectFromPeer(peerId: string): void;
    /**
     * Remove a peer connection
     */
    private removePeer;
    /**
     * Send data to a specific peer
     */
    send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void;
    /**
     * Broadcast data to all connected peers
     */
    broadcast(data: string | ArrayBuffer | ArrayBufferView): void;
    /**
     * Get list of connected peer IDs
     */
    getConnectedPeers(): string[];
    /**
     * Get list of discovered peer IDs
     */
    getDiscoveredPeers(): string[];
    /**
     * Get the converged global peer set (all peers known via membership gossip).
     */
    getGlobalPeers(): string[];
    /**
     * Get current peer count
     */
    getPeerCount(): number;
    /**
     * Get this client's ID
     */
    getClientId(): string | null;
    /**
     * Register an event handler
     */
    on<K extends keyof PartialMeshEvents>(event: K, handler: PartialMeshEvents[K]): void;
    /**
     * Unregister an event handler
     */
    off<K extends keyof PartialMeshEvents>(event: K, handler: PartialMeshEvents[K]): void;
    /**
     * Emit an event
     */
    private emit;
    private sendMembership;
    private tryParseMembership;
    private mergeMembership;
    private removeFromGlobalMembership;
    /**
     * Disconnect from all peers and close signaling connection
     */
    destroy(): void;
}

export { type GossipMessage, GossipProtocol, type GossipProtocolOptions, type GossipStats, PartialMesh, type PartialMeshConfig, type PartialMeshEvents, type PeerConnection, PeerPigeonStorage, type StorageChangeOrigin, type StorageEvents, type StorageOptions, type StoragePutOptions, type StorageRecord, type StorageRetrieveOptions, type StorageSpace, type StorageSyncFilterContext, type StorageSyncOptions, type StorageUnsubscribe, PartialMesh as default };
