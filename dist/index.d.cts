type GossipProtocolOptions = {
    /** Maximum number of re-propagation hops for a message. */
    maxHops?: number;
    /** Maximum hops for a direct/routed message before it is dropped. Default 256. */
    maxDirectHops?: number;
    /** Relative weight of coordinate-space distance in CECR hybrid routing (0..1). */
    cecrCoordinateWeight?: number;
    /** Maximum age of extrema snapshot before coordinate weight is reduced. */
    cecrExtremaMaxAgeMs?: number;
    /** @deprecated CECR v1 uses readiness gating instead of a claimed drift threshold. */
    cecrMaxAcceptedDrift?: number;
    /** Require canonical global-set/extrema agreement across connected peers before coordinate routing. */
    cecrRequireConsensus?: boolean;
    /** Consecutive state rounds required before coordinate routing. Default 3. */
    cecrConvergenceRounds?: number;
    /** Default deadline for opt-in tracked gossip delivery. Default 30 seconds. */
    deliveryTimeoutMs?: number;
    /** @deprecated Initial targeted repair is immediate; retained for API compatibility. */
    deliveryRepairDelayMs?: number;
    /** Minimum delay between repeated repair attempts for the same target. Default 5 seconds. */
    deliveryRepairIntervalMs?: number;
    /** Maximum recent broadcast IDs advertised per epidemic anti-entropy summary. Default 256. */
    antiEntropySummarySize?: number;
    /** Maximum missing broadcasts requested or served per anti-entropy exchange. Default 64. */
    antiEntropyRequestSize?: number;
};
type CecrConfigSnapshot = {
    protocol: 'cecr/1';
    configId: string;
    idWidthBits: 256;
    hashProfile: 'fnv1a64-compat';
    signatureProfile: 'unsigned-partial';
    coordinateWeightNumerator: number;
    coordinateWeightDenominator: number;
    extremaMaxAgeMs: number;
    requireConsensus: boolean;
    maxDirectHops: number;
    membershipLeaseMs: number;
    membershipGossipIntervalMs: number;
    membershipTombstoneRetentionMs: number;
    membershipClockSkewMs: number;
    convergenceRounds: number;
    xorBucketRedundancy: 1;
};
type CecrOverlaySnapshot = {
    xorBucketCoverage: boolean;
    coordinateAdjacency: boolean;
    missingXorBuckets: number[];
    missingCoordinatePeerIds: string[];
    degraded: boolean;
};
type CecrStateSnapshot = {
    protocol: 'cecr/1';
    conformance: 'partial';
    configId: string;
    peerId: string | null;
    livePeerIds: string[];
    viewId: string;
    viewStableForMs: number;
    requiredStableForMs: number;
    size: number;
    /** Largest fresh CECR/aggregate observation of total live network size. */
    networkSizeEstimate: number;
    minHex: string | null;
    maxHex: string | null;
    coordinateReady: boolean;
    connectedDegree: number;
    fanout: number;
    membershipRecords: Array<{
        peerId: string;
        incarnation: number;
        sequence: number;
        state: 'alive' | 'left';
        issuedAt: number;
        validUntil: number | null;
    }>;
    membershipEquivocations: string[];
    overlay: CecrOverlaySnapshot;
    limitations: string[];
};
type GossipBroadcastOptions = {
    /** Track delivery to the canonical known-peer snapshot captured at send time. */
    trackDelivery?: boolean;
    /**
     * Confirm reach with a reverse convergecast. Each peer reports one aggregate
     * subtree count to its first-arrival parent; no peer list or per-peer bitset
     * is attached to the message or collected by the sender.
     */
    aggregateDelivery?: boolean;
    /** Override the deadline for this message's initial dissemination and delivery inference. */
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
type GossipAggregateDeliveryStatus = {
    messageId: string;
    sender: string;
    /** Confirmed remote holders, excluding the sender. */
    confirmedPeerCount: number;
    /** Larger of current CECR membership and confirmed holders. */
    inferredAudienceCount: number;
    /** Deepest first-arrival hop represented by the aggregate. */
    maxConfirmedHops: number;
    /** True when the current dissemination tree has returned every branch. */
    settled: boolean;
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
type GossipAggregateEnvelope = {
    protocol: 'gossip-echo/1';
    deadlineAt: number;
};
type GossipSpreadEnvelope = {
    protocol: 'gossip-spread/1';
    /** Initial CECR membership view. Payload repair is invalid after this view changes. */
    setHash: string;
    size: number;
    /** Hard cutoff after which this payload must never be replayed. */
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
    /** Bounded first-arrival route trace for diagnostics. */
    path?: string[];
    spread?: GossipSpreadEnvelope;
    delivery?: GossipDeliveryEnvelope;
    aggregate?: GossipAggregateEnvelope;
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
    /** Bounded routed path, including source and current destination. */
    path?: string[];
    originConfigId?: string;
    originViewId?: string;
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
    getCecrMembershipConfig?(): {
        leaseMs: number;
        gossipIntervalMs: number;
        tombstoneRetentionMs: number;
        clockSkewMs: number;
    };
    getCecrMembershipRecords?(): Array<{
        peerId: string;
        incarnation: number;
        sequence: number;
        state: 'alive' | 'left';
        issuedAt: number;
        validUntil: number | null;
    }>;
    getCecrMembershipEquivocations?(): string[];
    send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void;
}
type GossipEvents = {
    messageReceived: (data: {
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
        receivedAt: number;
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
    aggregateProgress: (status: GossipAggregateDeliveryStatus) => void;
    aggregateSettled: (status: GossipAggregateDeliveryStatus) => void;
    cecrStateChanged: (state: CecrStateSnapshot) => void;
};
/**
 * GossipProtocol
 *
 * A small, application-level gossip/epidemic message propagation helper.
 *
 * - De-duplicates messages by `id`
 * - Re-broadcasts unseen messages to connected peers until `maxHops`
 * - Repairs missed broadcasts only during their bounded initial CECR spread
 */
declare class GossipProtocol {
    private mesh;
    private messageLog;
    private readonly maxTrackedMessages;
    private readonly maxTrackedDirectIds;
    private readonly trackingRetentionMs;
    private antiEntropySummarySize;
    private antiEntropyRequestSize;
    private maxHops;
    private maxDirectHops;
    private cecrCoordinateWeight;
    private cecrExtremaMaxAgeMs;
    private cecrRequireConsensus;
    private cecrConvergenceRounds;
    private cecrViewChangedAtMs;
    private deliveryTimeoutMs;
    private deliveryRepairIntervalMs;
    private cecrCurrentExtrema;
    private cecrRemoteStates;
    private cecrSyncTimer;
    private trackingCleanupTimer;
    private seenDirectIds;
    private deliveryStates;
    private aggregateStates;
    private retainedMessages;
    private dirtyDeliveryReceiptIds;
    private gossipFanoutCursor;
    private cecrFanoutCursor;
    private antiEntropyFanoutCursor;
    private initialSpreadRepairQueued;
    private destroyed;
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
     * Propagate to the CECR v1 fan-out budget. Selection rotates over the
     * sorted neighbor set so every eligible connection is chosen fairly.
     */
    propagate(message: GossipMessage, exceptPeerId?: string): string[];
    /**
     * Handle an incoming message from the mesh.
     */
    handleIncomingMessage(message: GossipMessage, fromPeerId: string): void;
    private retainGossipMessage;
    private extendRoutePath;
    private compactRoutePeerId;
    private scheduleInitialSpreadRepair;
    private validSpreadEnvelope;
    private initialSpreadDeadlineAt;
    private canContinueInitialSpread;
    private initialSpreadComplete;
    private recentRetainedMessageIds;
    private publishGossipAntiEntropy;
    private handleGossipAntiEntropy;
    private registerAggregateDelivery;
    private refreshAggregateState;
    private aggregateStatusForState;
    /** Return the sender's constant-size reverse aggregate for a broadcast. */
    getAggregateDeliveryStatus(messageId: string): GossipAggregateDeliveryStatus | null;
    private emitAggregateStatus;
    private sendAggregateResponse;
    private publishAggregateState;
    private handleIncomingAggregate;
    private maintainAggregateDeliveries;
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
    private peerIdToNumeric;
    private canonicalPeerSet;
    private canonicalSetHash;
    private cecrConfigId;
    private cecrFanout;
    private selectFanoutPeers;
    private updateCecrExtremaSnapshot;
    private effectiveCecrCoordinateWeight;
    private hasCecrConsensus;
    private cecrNetworkSizeEstimate;
    private publishCecrState;
    private publishCecrDeliveryState;
    private handleIncomingCecrState;
    private handleIncomingCecrDeliveryState;
    private bucketRank;
    private hybridScore;
    private orderedRouteCandidates;
    private getCecrOverlaySnapshot;
    /**
     * Send a direct message to a specific peer, routed through the mesh via XOR distance.
     * Delivers even if there is no direct connection to the target.
     */
    sendDirect(targetPeerId: string, data: unknown): string | null;
    private routeDirect;
    private handleIncomingDirect;
    getCecrConfig(): Readonly<CecrConfigSnapshot>;
    getCecrState(): CecrStateSnapshot;
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
        receivedAt: number;
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
        receivedAt?: number;
    }) => void): void;
    on(event: 'directMessageReceived', callback: (data: {
        message: DirectMessage;
    }) => void): void;
    off(event: 'messageReceived', callback: (data: {
        message: GossipMessage;
        local: boolean;
        fromPeer?: string;
        receivedAt?: number;
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

/** Deterministic SHA-1 hex for compact, non-routing public display IDs. */
declare function sha1Hex(value: unknown): string;

declare const DEFAULT_SIGNALING_SERVERS: readonly string[];
declare const DEFAULT_CLOSE_SIGNALING_RELAY_COUNT = 4;
/** Order relays by SHA-256(hostname) XOR distance to the peer ID. */
declare function rankSignalingServersByDistance(peerId: string, relayUrls: readonly string[]): Promise<string[]>;
/** Choose exactly one relay by SHA-256(hostname) XOR distance to the peer ID. */
declare function selectClosestSignalingServer(peerId: string, relayUrls: readonly string[]): Promise<string>;
/**
 * Read the public relay registry from one bootstrap, then select one relay.
 * The bootstrap request is HTTP-only; only the selected relay gets a WebSocket.
 */
declare function discoverClosestSignalingServers(options: {
    bootstrapServer: string;
    peerId: string;
    fallbackServers?: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    limit?: number;
}): Promise<string[]>;
declare function discoverClosestSignalingServer(options: {
    bootstrapServer: string;
    peerId: string;
    fallbackServers?: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<string>;
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
    /** Known relays used if the bootstrap registry is empty or unavailable. */
    signalingServers?: readonly string[];
    /** Resolve one relay closest to the peer ID before opening signaling. */
    automaticSignalingServer?: boolean;
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
     * If set (>0), refresh discovery when the mesh remains under-connected for
     * this long. Existing FreeRTC negotiations are preserved.
     */
    underConnectedResetMs?: number;
    /** @deprecated Offers are immediate from either side; retained for API compatibility. */
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
    /** Lifetime of an alive CECR membership record. Default 30 seconds. */
    membershipLeaseMs?: number;
    /** Interval for renewing and disseminating membership records. Default 5 seconds. */
    membershipGossipIntervalMs?: number;
    /** Retention period for explicit-left tombstones. Default 2 minutes. */
    membershipTombstoneRetentionMs?: number;
    /** Maximum accepted clock skew for CECR membership timestamps. Default 5 seconds. */
    membershipClockSkewMs?: number;
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
type CecrMembershipRecordSnapshot = {
    peerId: string;
    incarnation: number;
    sequence: number;
    state: 'alive' | 'left';
    issuedAt: number;
    validUntil: number | null;
};
type PeerGraphNode = {
    peerId: string;
    local: boolean;
    directlyConnected: boolean;
    discovered: boolean;
    capacity: PeerCapacitySnapshot | null;
    /** Shortest known topology path from the local peer: local=0, direct=1. */
    hopDistance: number | null;
    /** XOR-space distance from the local peer, encoded as an exact hex string. */
    xorDistance: string | null;
    /** Zero-based nearest-first rank, excluding the local peer. */
    xorDistanceRank: number | null;
    /** Relative distance in the known set: nearest=0, farthest=1. */
    xorDistanceRatio: number | null;
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
    'identity:ready': (data: {
        clientId: string;
    }) => void;
    'signaling:connected': (data: {
        clientId: string;
        rawClientId?: string;
        signalingServer?: string;
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
    /** First local observation of FreeRTC negotiations not tracked by PartialMesh. */
    private orphanRtcFirstSeenAtMs;
    private peerConnectedAtMs;
    private discoveredAtMs;
    /** Peers present in the relay's latest un-graced discovery snapshot. */
    private activeSignalingPeers;
    private maintenanceTimer;
    private membershipTimer;
    private underConnectedSinceMs;
    private lastHardResetAtMs;
    private lastUnderConnectedRecoveryAtMs;
    private lastDiscoveryRefreshAtMs;
    private lastSignalingReconnectAtMs;
    private dialFailureCount;
    private dialBackoffUntilMs;
    private rebalanceCooldownUntilMs;
    private rebalanceAttemptAtMs;
    private pendingRebalanceDropByTarget;
    /** Converged global peer membership — populated via in-band membership gossip. */
    private globalPeers;
    /** Versioned, expiring CECR membership records keyed by subject peer. */
    private membershipRecordsById;
    private membershipEquivocationAtById;
    private membershipIncarnation;
    private membershipSequence;
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
    private loadOrCreateBrowserPeerId;
    private rememberBrowserPeerSignalUrls;
    private retirePeerId;
    private reconcileSignalingPeers;
    private handleSignalingPeerLeft;
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
    /** Direct neighbors whose local edge is the only known path to part of the mesh. */
    private localBridgeConnectedPeerIds;
    private trimExcessPeers;
    private getOldestPendingAgeMs;
    private isHexId;
    private fastIdHash;
    private peerDistance;
    private cecrNumericPeerId;
    private cecrBucketRank;
    private cecrCoordinateNeighbors;
    private cecrOverlayDialPriority;
    private cecrProtectedConnectedPeerIds;
    private maybeRebalanceForCloserPeer;
    /**
     * Initialize and connect to the signaling server
     */
    init(): Promise<void>;
    private startMaintenanceLoop;
    private startMembershipLoop;
    private maybeRefreshDiscovery;
    /**
     * Revalidate transports after browser suspension, network changes, or focus
     * restoration. Browsers do not always deliver every lifecycle event, so the
     * maintenance loop also calls the same stale-channel check.
     */
    recoverAfterInactivity(reason?: string): void;
    private recoverMeshAfterInactivity;
    private recoverStaleConnectedPeers;
    /**
     * FreeRTC can retain a half-open connection that never became a PartialMesh
     * peer. Without local peer/pending state, the normal negotiation watchdog
     * cannot see it, while connectToPeerInternal treats it as active forever.
     */
    private recoverOrphanedRtcNegotiations;
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
    private scheduleConnectionTimeout;
    /**
     * Maintain the target number of peer connections
     */
    private dialCandidatePeerIds;
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
    /** Return peers in the relay's latest non-graced discovery snapshot. */
    getActiveSignalingPeers(): string[];
    /**
     * Get the converged global peer set (all peers known via membership gossip).
     */
    getGlobalPeers(): string[];
    getCecrMembershipRecords(): CecrMembershipRecordSnapshot[];
    getCecrMembershipEquivocations(): string[];
    getCecrMembershipConfig(): Readonly<{
        leaseMs: number;
        gossipIntervalMs: number;
        tombstoneRetentionMs: number;
        clockSkewMs: number;
    }>;
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
    /** Return the exact XOR-space distance used by partial-mesh rebalancing. */
    getXorDistance(peerId: string, fromPeerId?: string | null): string | null;
    /** Return the shortest currently-known topology path from this peer. */
    getHopDistance(peerId: string): number | null;
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
    private renewLocalMembership;
    private isMembershipRecordNewer;
    private mergeMembershipRecord;
    private rebuildGlobalMembership;
    private pruneMembershipRecords;
    private membershipRecordsForWire;
    private sendMembership;
    private broadcastMembership;
    private tryParseMembership;
    private mergeMembership;
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
    aggregateProgress: (status: GossipAggregateDeliveryStatus) => void;
    aggregateSettled: (status: GossipAggregateDeliveryStatus) => void;
    cecrStateChanged: (state: CecrStateSnapshot) => void;
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
    getXorDistance(peerId: string, fromPeerId?: string): string | null;
    getHopDistance(peerId: string): number | null;
    getCecrConfig(): Readonly<CecrConfigSnapshot>;
    getCecrState(): CecrStateSnapshot;
    getClientId(): string | null;
    getConnectedPeers(): string[];
    getDiscoveredPeers(): string[];
    getActiveSignalingPeers(): string[];
    getGlobalPeers(): string[];
    broadcast(data: unknown, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): string;
    broadcastReliable(data: unknown, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): string;
    sendDirect(peerId: string, data: unknown): string | null;
    getDeliveryStatus(messageId: string): GossipDeliveryStatus | null;
    getAggregateDeliveryStatus(messageId: string): GossipAggregateDeliveryStatus | null;
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

export { type CecrConfigSnapshot, type CecrMembershipRecordSnapshot, type CecrOverlaySnapshot, type CecrStateSnapshot, DEFAULT_CLOSE_SIGNALING_RELAY_COUNT, DEFAULT_SIGNALING_SERVERS, type EncryptedBroadcastPayload, type EncryptedDirectPayload, type GossipAggregateDeliveryStatus, type GossipBroadcastOptions, type GossipDeliveryStatus, type GossipMessage, GossipProtocol, type GossipProtocolOptions, type GossipStats, PartialMesh, type PartialMeshConfig, type PartialMeshEvents, type PartialMeshRuntimeConfig, type PeerCapacityAdvertisement, type PeerCapacitySnapshot, type PeerConnection, type PeerGraphEdge, type PeerGraphNode, type PeerGraphSnapshot, type PeerPigeonCryptoEvents, type PeerPigeonCryptoOptions, PeerPigeonCryptoProtocol, type PeerPigeonKeyPair, PeerPigeonNode, type PeerPigeonNodeEvents, type PeerPigeonNodeMessage, type PeerPigeonNodeOptions, type PeerPigeonNodeStorageOptions, PeerPigeonStorage, type PeerPublicKey, type RoomCipher, type StorageChangeOrigin, type StorageEvents, type StorageOptions, type StoragePutOptions, type StorageRecord, type StorageRetrieveOptions, type StorageSpace, type StorageSyncFilterContext, type StorageSyncOptions, type StorageUnsubscribe, PartialMesh as default, discoverClosestSignalingServer, discoverClosestSignalingServers, rankSignalingServersByDistance, selectClosestSignalingServer, sha1Hex };
