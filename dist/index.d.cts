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
    /** Default deadline for opt-in tracked gossip delivery. Default 30 seconds. */
    deliveryTimeoutMs?: number;
    /** Delay before a tracked message is eligible for targeted repair. Default 4 seconds. */
    deliveryRepairDelayMs?: number;
    /** Minimum delay between repair attempts for the same target. Default 5 seconds. */
    deliveryRepairIntervalMs?: number;
};
type GossipBroadcastOptions = {
    /** Track delivery to the canonical known-peer snapshot captured at send time. */
    trackDelivery?: boolean;
    /** Override the protocol's tracked-delivery deadline for this message. */
    deliveryTimeoutMs?: number;
};
type GossipDeliveryStatus = {
    messageId: string;
    sender: string;
    membershipHash: string;
    audiencePeerIds: string[];
    deliveredPeerIds: string[];
    pendingPeerIds: string[];
    audienceCount: number;
    deliveredCount: number;
    complete: boolean;
    timedOut: boolean;
    createdAt: number;
    updatedAt: number;
    deadlineAt: number;
};
type GossipDeliveryEnvelope = {
    setHash: string;
    size: number;
    bits: string;
    deadlineAt: number;
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
    delivery?: GossipDeliveryEnvelope;
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
    deliveryProgress: (status: GossipDeliveryStatus) => void;
    deliveryComplete: (status: GossipDeliveryStatus) => void;
    deliveryTimeout: (status: GossipDeliveryStatus) => void;
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
    private deliveryTimeoutMs;
    private deliveryRepairDelayMs;
    private deliveryRepairIntervalMs;
    private cecrCurrentExtrema;
    private cecrPreviousExtrema;
    private cecrRemoteStates;
    private cecrSyncTimer;
    private trackingCleanupTimer;
    private seenDirectIds;
    private deliveryStates;
    private dirtyDeliveryReceiptIds;
    private callbacks;
    private peers;
    constructor(mesh: MeshLike, options?: GossipProtocolOptions);
    private setupMeshListeners;
    private startCecrSyncLoop;
    private startTrackingCleanupLoop;
    /**
     * Broadcast an application payload using gossip-style re-propagation.
     */
    broadcast(data: unknown, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): string;
    /**
     * Broadcast with delivery tracking enabled for the known-peer snapshot.
     */
    broadcastReliable(data: unknown, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): string;
    /**
     * Return the sender-visible delivery state for a tracked gossip message.
     */
    getDeliveryStatus(messageId: string): GossipDeliveryStatus | null;
    /**
     * Propagate a message to all currently-connected peers.
     */
    propagate(message: GossipMessage, exceptPeerId?: string): void;
    /**
     * Handle an incoming message from the mesh.
     */
    handleIncomingMessage(message: GossipMessage, fromPeerId: string): void;
    private createDeliveryBits;
    private setDeliveryBit;
    private hasDeliveryBit;
    private deliveryBitsToHex;
    private deliveryBitsFromHex;
    private mergeDeliveryBits;
    private deliveryEnvelopeForState;
    private deliveryReceiptForState;
    private validateDeliveryEnvelope;
    private reconstructDeliveryPeers;
    private registerTrackedDelivery;
    private mergeDeliveryReceipt;
    private deliveryStatusForState;
    private emitDeliveryStatus;
    private selectRepairOwner;
    private maintainTrackedDeliveries;
    private reliableRepairMessage;
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
    /** Mesh peer ID that most recently changed this record. */
    modifiedBy: string | null;
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
    /** Local mesh peer ID recorded as modification provenance. */
    peerId?: string;
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
 * - Syncs subscribed non-private keys over encrypted gossip envelopes
 * - Enforces five built-in ACL spaces: public, user, frozen, private, epublic
 * - epublic is internal-only and can only be mutated through putSystem/deleteSystem
 */
declare class PeerPigeonStorage {
    private readonly userId;
    private peerId;
    private readonly gossip;
    private readonly sessionId;
    private readonly syncSecret;
    private readonly dbName;
    private readonly syncFilter;
    private readonly storeName;
    private driver;
    private readonly listeners;
    private readonly subscribedKeys;
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
    /** Subscribe to remote updates for one exact storage-space/key pair. */
    subscribeKey(space: StorageSpace, key: string): StorageUnsubscribe;
    /** Stop accepting remote updates for one exact storage-space/key pair. */
    unsubscribeKey(space: StorageSpace, key: string): void;
    /** Return whether this instance accepts remote updates for a key. */
    isSubscribed(space: StorageSpace, key: string): boolean;
    /** Update the mesh peer ID recorded on subsequent local mutations. */
    setPeerId(peerId: string): void;
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

declare const ENCRYPTED_BROADCAST_TYPE = "pp-encrypted-broadcast-v1";
declare const ENCRYPTED_DIRECT_TYPE = "pp-encrypted-direct-v1";
type PeerPigeonKeyPair = {
    pub: string;
    priv: string;
    epub: string;
    epriv: string;
};
type PeerPublicKey = {
    peerId: string;
    pub: string;
    epub: string;
    updatedAt: number;
    local: boolean;
};
type RoomCipher = {
    alg: 'A256GCM';
    iv: string;
    ct: string;
};
type EncryptedBroadcastPayload = {
    __ppType: typeof ENCRYPTED_BROADCAST_TYPE;
    from: string;
    roomCipher: RoomCipher;
    timestamp: number;
};
type EncryptedDirectPayload = {
    __ppType: typeof ENCRYPTED_DIRECT_TYPE;
    from: string;
    to: string;
    cipher: unknown;
    timestamp: number;
};
type PeerPigeonCryptoOptions = {
    /** Room scope mixed into the AES-GCM room key. */
    roomId: string;
    /** Optional shared secret mixed into the room key. */
    roomSecret?: string;
    /** Supply an identity instead of generating/loading a tab-scoped identity. */
    keyPair?: PeerPigeonKeyPair;
    /** Persist generated keys in sessionStorage when available. Default true. */
    persistKeyPair?: boolean;
    /** sessionStorage key prefix. */
    storageKey?: string;
    /** Key advertisement interval. Default 10 seconds; 0 disables it. */
    announceIntervalMs?: number;
    /** Default wait for direct-message key discovery. Default 8 seconds. */
    keyDiscoveryTimeoutMs?: number;
};
type PeerPigeonCryptoEvents = {
    keyDiscovered: (key: PeerPublicKey) => void;
    encryptedBroadcastReceived: (data: {
        plaintext: string;
        payload: EncryptedBroadcastPayload;
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
    }) => void;
    encryptedDirectReceived: (data: {
        plaintext: string;
        payload: EncryptedDirectPayload;
        message: DirectMessage;
    }) => void;
    error: (error: Error) => void;
};
interface CryptoMeshLike {
    on(event: 'peer:connected', handler: (peerId: string) => void): void;
    on(event: 'signaling:connected', handler: (data: {
        clientId: string;
    }) => void): void;
    off(event: 'peer:connected', handler: (peerId: string) => void): void;
    off(event: 'signaling:connected', handler: (data: {
        clientId: string;
    }) => void): void;
    getClientId(): string | null;
    getConnectedPeers(): string[];
}
interface CryptoGossipLike {
    broadcast(data: unknown, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): string;
    broadcastReliable(data: unknown, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): string;
    sendDirect(targetPeerId: string, data: unknown): string | null;
    on(event: 'messageReceived', callback: (data: {
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
    }) => void): void;
    on(event: 'directMessageReceived', callback: (data: {
        message: DirectMessage;
    }) => void): void;
    off(event: 'messageReceived', callback: (data: {
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
    }) => void): void;
    off(event: 'directMessageReceived', callback: (data: {
        message: DirectMessage;
    }) => void): void;
}
declare class PeerPigeonCryptoProtocol {
    private readonly mesh;
    private readonly gossip;
    private readonly options;
    private keyPair;
    private readonly publicKeys;
    private readonly callbacks;
    private announceTimer;
    private initialized;
    private readonly onGossipMessageBound;
    private readonly onDirectMessageBound;
    private readonly onPeerConnectedBound;
    private readonly onSignalingConnectedBound;
    constructor(mesh: CryptoMeshLike, gossip: CryptoGossipLike, options: PeerPigeonCryptoOptions);
    init(): Promise<void>;
    getKeyPair(): Readonly<PeerPigeonKeyPair>;
    getPublicKey(peerId: string): PeerPublicKey | null;
    getKnownPeerKeys(): PeerPublicKey[];
    announcePublicKey(): void;
    requestPeerKey(peerId: string): void;
    waitForPeerKey(peerId: string, timeoutMs?: number): Promise<PeerPublicKey>;
    encryptRoom(plaintext: string): Promise<RoomCipher>;
    decryptRoom(cipher: RoomCipher): Promise<string>;
    createEncryptedBroadcast(plaintext: string): Promise<EncryptedBroadcastPayload>;
    createEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<EncryptedDirectPayload>;
    broadcastEncrypted(plaintext: string, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): Promise<string>;
    sendEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<string>;
    decryptEncryptedBroadcast(payload: EncryptedBroadcastPayload): Promise<string>;
    decryptEncryptedDirect(payload: EncryptedDirectPayload): Promise<string>;
    on<K extends keyof PeerPigeonCryptoEvents>(event: K, callback: PeerPigeonCryptoEvents[K]): void;
    off<K extends keyof PeerPigeonCryptoEvents>(event: K, callback: PeerPigeonCryptoEvents[K]): void;
    destroy(): void;
    static isProtocolPayload(value: unknown): boolean;
    private validateKeyPair;
    private loadStoredKeyPair;
    private persistKeyPair;
    private registerLocalKey;
    private localPublicInfoPayload;
    private sendPublicInfoDirect;
    private upsertPublicKey;
    private isPublicInfo;
    private isPublicRequest;
    private isEncryptedBroadcast;
    private isEncryptedDirect;
    private handleGossipMessage;
    private handleDirectMessage;
    private deriveRoomKey;
    private cryptoApi;
    private toBase64Url;
    private fromBase64Url;
    private emitError;
    private emit;
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
     * FreeRTC network/application namespace. Peers must match both networkId and
     * sessionId (room) even when they use different federated relay domains.
     */
    networkId?: string;
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
     * Age after which a relayed capacity advertisement stops influencing dial
     * priority. The last advertised value remains available in API snapshots.
     */
    peerStateMaxAgeMs?: number;
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
type PeerCapacityAdvertisement = {
    maxPeers: number;
    connectedPeers: number;
    updatedAt: number;
};
type PeerCapacitySnapshot = PeerCapacityAdvertisement & {
    peerId: string;
    availableSlots: number;
    fresh: boolean;
    local: boolean;
};
type PeerGraphNode = {
    peerId: string;
    local: boolean;
    directlyConnected: boolean;
    discovered: boolean;
    capacity: PeerCapacitySnapshot | null;
};
type PeerGraphEdge = {
    source: string;
    target: string;
    direct: boolean;
    observedBy: string[];
    updatedAt: number;
};
type PeerGraphSnapshot = {
    localPeerId: string | null;
    nodes: PeerGraphNode[];
    edges: PeerGraphEdge[];
    /** True once every known peer has supplied at least one adjacency snapshot. */
    complete: boolean;
    missingTopologyPeerIds: string[];
    generatedAt: number;
};
type PartialMeshRuntimeConfig = Pick<Required<PartialMeshConfig>, 'minPeers' | 'maxPeers' | 'tolerantPeers' | 'autoDiscover' | 'autoConnect' | 'connectionTimeoutMs' | 'maintenanceIntervalMs' | 'underConnectedResetMs' | 'nonInitiatorFallbackDialMs' | 'peerStateMaxAgeMs'>;
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
    'mesh:capacity': (capacities: PeerCapacitySnapshot[]) => void;
    'mesh:graph': (snapshot: PeerGraphSnapshot) => void;
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
    private retiredPeerIds;
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
    /** Relayed per-peer capacity used to give scarce, underfilled peers priority. */
    private peerCapacityById;
    /** Relayed adjacency snapshots used to reconstruct the known network graph. */
    private peerTopologyById;
    private localCapacityUpdatedAtMs;
    private localTopologyUpdatedAtMs;
    constructor(config?: PartialMeshConfig);
    private validatePeerLimits;
    private normalizePeerId;
    private normalizeSignalingUrl;
    private addSelfAlias;
    private isSelfAlias;
    private addDiscoveredPeer;
    private rotateBrowserPeerId;
    private retirePeerId;
    private reconcileSignalingPeers;
    private getConnectedPeerCount;
    private getPendingPeerCount;
    private noteLocalCapacityChanged;
    private freshPeerCapacity;
    /**
     * Known underfilled peers sort first, with lower-capacity peers ahead of
     * high-capacity peers. Unknown peers remain eligible; known-full peers sort last.
     */
    private compareCapacityPriority;
    private compareDialCandidates;
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
    /**
     * Revalidate transports after browser suspension, network changes, or focus
     * restoration. Browsers do not always deliver every lifecycle event, so the
     * maintenance loop also calls the same stale-channel check.
     */
    recoverAfterInactivity(reason?: string): void;
    private recoverStaleConnectedPeers;
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
    /** Return the effective configuration, including constructor defaults. */
    getConfig(): Readonly<Required<PartialMeshConfig>>;
    /**
     * Update connection-policy knobs without rebuilding the node. Signaling,
     * network/session identity, ICE, and trickle settings remain constructor-time
     * values because changing them requires reconnecting the transport.
     */
    updateConfig(patch: Partial<PartialMeshRuntimeConfig>): Readonly<Required<PartialMeshConfig>>;
    /** Return capacity and available connection slots for one known peer. */
    getPeerCapacity(peerId: string): PeerCapacitySnapshot | null;
    /** Return advertised capacity for every known peer, including this node. */
    getPeerCapacities(): PeerCapacitySnapshot[];
    /** Reconstruct the complete currently-known node and undirected edge snapshot. */
    getGraphSnapshot(): PeerGraphSnapshot;
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
    private broadcastMembership;
    private tryParseMembership;
    private mergeMembership;
    private removeFromGlobalMembership;
    /**
     * Disconnect from all peers and close signaling connection
     */
    destroy(): void;
}
type PeerPigeonNodeStorageOptions = Omit<StorageOptions, 'gossip' | 'peerId' | 'userId'> & {
    userId?: string;
};
type PeerPigeonNodeOptions = PartialMeshConfig & {
    gossip?: GossipProtocolOptions;
    /** Enabled by default. Pass false to construct a node without crypto. */
    crypto?: false | (Omit<PeerPigeonCryptoOptions, 'roomId'> & {
        roomId?: string;
    });
    /** Disabled by default. Pass options to attach encrypted synchronized storage. */
    storage?: false | PeerPigeonNodeStorageOptions;
};
type PeerPigeonNodeMessage = {
    kind: 'broadcast' | 'direct';
    data: unknown;
    encrypted: boolean;
    local: boolean;
    fromPeerId: string | null;
    messageId: string;
    hops: number;
    message: GossipMessage | DirectMessage;
};
type PeerPigeonNodeEvents = {
    ready: () => void;
    peerConnected: (peerId: string) => void;
    peerDisconnected: (peerId: string) => void;
    graphChanged: (snapshot: PeerGraphSnapshot) => void;
    capacityChanged: (capacities: PeerCapacitySnapshot[]) => void;
    keyDiscovered: (key: PeerPublicKey) => void;
    message: (message: PeerPigeonNodeMessage) => void;
    deliveryProgress: (status: GossipDeliveryStatus) => void;
    deliveryComplete: (status: GossipDeliveryStatus) => void;
    deliveryTimeout: (status: GossipDeliveryStatus) => void;
    error: (error: Error) => void;
};
/**
 * Unified high-level node API. Advanced callers can still access `mesh`,
 * `gossip`, `crypto`, and `storage`, while normal applications need only this
 * facade for topology, messaging, encryption, keys, capacity, and config.
 */
declare class PeerPigeonNode {
    readonly mesh: PartialMesh;
    readonly gossip: GossipProtocol;
    readonly crypto: PeerPigeonCryptoProtocol | null;
    storage: PeerPigeonStorage | null;
    private readonly storageOptions;
    private readonly callbacks;
    private started;
    constructor(options?: PeerPigeonNodeOptions);
    init(): Promise<void>;
    start(): Promise<void>;
    getConfig(): Readonly<Required<PartialMeshConfig>>;
    updateConfig(patch: Partial<PartialMeshRuntimeConfig>): Readonly<Required<PartialMeshConfig>>;
    getGraphSnapshot(): PeerGraphSnapshot;
    getPeerCapacity(peerId: string): PeerCapacitySnapshot | null;
    getPeerCapacities(): PeerCapacitySnapshot[];
    getClientId(): string | null;
    getConnectedPeers(): string[];
    getDiscoveredPeers(): string[];
    getGlobalPeers(): string[];
    broadcast(data: unknown, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): string;
    broadcastReliable(data: unknown, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): string;
    sendDirect(peerId: string, data: unknown): string | null;
    getDeliveryStatus(messageId: string): GossipDeliveryStatus | null;
    broadcastEncrypted(plaintext: string, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): Promise<string>;
    broadcastEncryptedReliable(plaintext: string, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): Promise<string>;
    sendEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<string>;
    getKeyPair(): Readonly<PeerPigeonKeyPair>;
    getPublicKey(peerId: string): PeerPublicKey | null;
    getKnownPeerKeys(): PeerPublicKey[];
    requestPeerKey(peerId: string): void;
    waitForPeerKey(peerId: string, timeoutMs?: number): Promise<PeerPublicKey>;
    recoverAfterInactivity(reason?: string): void;
    on<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void;
    off<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void;
    destroy(): Promise<void>;
    private bindComponentEvents;
    private isReservedPayload;
    private emitError;
    private emit;
}

export { type EncryptedBroadcastPayload, type EncryptedDirectPayload, type GossipBroadcastOptions, type GossipDeliveryStatus, type GossipMessage, GossipProtocol, type GossipProtocolOptions, type GossipStats, PartialMesh, type PartialMeshConfig, type PartialMeshEvents, type PartialMeshRuntimeConfig, type PeerCapacityAdvertisement, type PeerCapacitySnapshot, type PeerConnection, type PeerGraphEdge, type PeerGraphNode, type PeerGraphSnapshot, type PeerPigeonCryptoEvents, type PeerPigeonCryptoOptions, PeerPigeonCryptoProtocol, type PeerPigeonKeyPair, PeerPigeonNode, type PeerPigeonNodeEvents, type PeerPigeonNodeMessage, type PeerPigeonNodeOptions, type PeerPigeonNodeStorageOptions, PeerPigeonStorage, type PeerPublicKey, type RoomCipher, type StorageChangeOrigin, type StorageEvents, type StorageOptions, type StoragePutOptions, type StorageRecord, type StorageRetrieveOptions, type StorageSpace, type StorageSyncFilterContext, type StorageSyncOptions, type StorageUnsubscribe, PartialMesh as default };
