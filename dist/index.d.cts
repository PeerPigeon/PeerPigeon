declare const STORAGE_SERVER_NETWORK = "peerpigeon-storage";
declare const STORAGE_SERVER_ROOM = "servers";
declare const STORAGE_SERVER_ROLE = "storage";
/** Servers per room. */
declare const STORAGE_REPLICAS = 3;
/** One record as a server keeps it. Every field is a hash or ciphertext, except `at` and `once`. */
interface ServerRecord {
    /** sha256 of the room's secret: which room. */
    room: string;
    /** sha256 of the room's secret, space and key: which record. */
    slot: string;
    /** sha256 of the room's secret and space (16 hex): which space, for listing. */
    tag: string;
    /** When it was written (the mutation's timestamp, ms): a newer one replaces it. */
    at: number;
    /** The room-encrypted mutation. */
    blob: unknown;
    /** sha256 of the slot's write token. */
    wh: string;
    /** Write-once (frozen). */
    once?: boolean;
    /** A user record's owner (its signing key): only writes it signs replace it. */
    owner?: string;
    /** The owner's signature of ownerText(this record). */
    osig?: string;
}
/** Largest blob: one message, base64, under a data channel's limit. */
declare const MAX_BLOB_BYTES: number;
/** Where a blob with this SHA-256 is kept (what servers see). */
declare function blobAddress(hash: string): Promise<string>;
/** Seals content for the servers: its address, and the bytes a server keeps. */
declare function sealBlob(bytes: Uint8Array): Promise<{
    hash: string;
    address: string;
    sealed: Uint8Array;
}>;
/** Opens a sealed blob; null unless it is the content with that SHA-256. */
declare function openBlob(hash: string, sealed: Uint8Array): Promise<Uint8Array | null>;
/**
 * A room only one key writes to (a person's own records): 'o' and the hash of that key. A server
 * takes a record for it only when the record carries that key as its owner, signed by it; so
 * nobody else, knowing the key or not, can put anything in it.
 */
declare function ownedRoomOf(owner: string): Promise<string>;
/** A room id: 64 hex (a shared room), or 'o' and 64 hex (an owned room). */
declare function validRoom(v: unknown): v is string;
type LinkListener = (event: {
    type: 'servers';
    room: string;
    servers: string[];
} | {
    type: 'changed';
    rec: Omit<ServerRecord, 'wh'>;
}) => void;
/**
 * A peer's link to the storage servers: a small PeerPigeon node in the
 * servers' scope that dials no one on its own, only the servers closest to the
 * rooms it keeps.
 */
declare class StorageServerLink {
    private readonly node;
    private readonly hashed;
    private readonly pending;
    /** Servers that have sent us bytes (a blob, as bytes): they read them too. */
    private readonly readsBytes;
    private readonly listings;
    private readonly rooms;
    private readonly listeners;
    private timer;
    private closed;
    constructor(node: PeerPigeonNode);
    start(): Promise<void>;
    close(): Promise<void>;
    on(listener: LinkListener): () => void;
    /** Keep this room: link to its closest servers, and hear of changes to it. */
    keep(room: string): void;
    /** The linked servers that keep this room, closest first. */
    serversFor(room: string): string[];
    /** Every server listed in the servers' scope. */
    knownServers(): Promise<string[]>;
    private refreshing;
    private refreshAgain;
    /** Looks again at the servers; one asked for while a look is under way runs after it. */
    private refresh;
    private refreshNow;
    private emit;
    private send;
    private ask;
    private failPending;
    private onMessage;
    /** Writes a record to the room's servers; resolves with how many took it. */
    put(rec: Omit<ServerRecord, 'wh'>, write: string): Promise<number>;
    /** The newest copy of a record the room's servers hold, or null. */
    get(room: string, slot: string): Promise<Omit<ServerRecord, 'wh'> | null>;
    /** The servers closest to a blob's address, linked (waits up to `waitMs` for new links). */
    private serversForBlob;
    /** Whether any server is known in the scope (linked or not). */
    hasServers(): Promise<boolean>;
    /** Keeps content on the servers closest to it; resolves with how many took it. */
    putBlob(bytes: Uint8Array): Promise<number>;
    /** Content by its SHA-256 from the servers, checked; null if none has it. */
    getBlob(hash: string): Promise<Uint8Array | null>;
    /** Every record the room's servers hold (of one space, with `tag`), the newest copy of each. */
    list(room: string, tag?: string): Promise<Omit<ServerRecord, 'wh'>[]>;
}
/** Where a server keeps records: memory by default, a disk or a database in a real server. */
interface ServerRecordStore {
    get(room: string, slot: string): Promise<ServerRecord | null>;
    put(rec: ServerRecord): Promise<void>;
    list(room: string, tag?: string): Promise<ServerRecord[]>;
    rooms(): Promise<string[]>;
    /** Sealed blobs by address (a store without them keeps records only). */
    getBlob?(address: string): Promise<Uint8Array | null>;
    putBlob?(address: string, sealed: Uint8Array): Promise<void>;
    blobs?(): Promise<string[]>;
    blobUsage?(): Promise<{
        count: number;
        bytes: number;
    }>;
}
declare class MemoryServerRecordStore implements ServerRecordStore {
    private readonly byRoom;
    get(room: string, slot: string): Promise<ServerRecord | null>;
    put(rec: ServerRecord): Promise<void>;
    list(room: string, tag?: string): Promise<ServerRecord[]>;
    rooms(): Promise<string[]>;
    private readonly blobMap;
    getBlob(address: string): Promise<Uint8Array<ArrayBufferLike> | null>;
    putBlob(address: string, sealed: Uint8Array): Promise<void>;
    blobs(): Promise<string[]>;
    blobUsage(): Promise<{
        count: number;
        bytes: number;
    }>;
}
interface StorageServerStats {
    rooms: number;
    records: number;
    blobs: number;
    blobBytes: number;
    servers: number;
    clients: number;
}
/**
 * A storage server: keeps the records of the rooms it is among the closest
 * servers for, answers the peers linked to it, tells the peers watching a room
 * what changed in it, and hands each room's records to whichever servers are
 * closest to it as servers come and go.
 */
declare class StorageServer {
    private readonly node;
    private readonly store;
    private readonly hashed;
    private readonly watchers;
    /** For each room: the servers last given its records. */
    private readonly placed;
    /** For each blob: the servers last given it. */
    private readonly placedBlobs;
    private selfHash;
    private timer;
    private onChange;
    constructor(node: PeerPigeonNode, store?: ServerRecordStore);
    /** Called with each record this server takes (a write, or one handed to it). */
    onRecord(listener: (rec: ServerRecord) => void): void;
    start(): Promise<void>;
    close(): Promise<void>;
    stats(): Promise<StorageServerStats>;
    private self;
    /** Every server known in the scope, this one included. */
    private servers;
    private send;
    /** Takes a record if it is new or newer, and its write token (or hash) is the slot's. */
    private take;
    private onMessage;
    private rebalancing;
    private rebalanceAgain;
    rebalance(): Promise<void>;
    /**
     * Hands each room's records to the servers now closest to it that were not
     * given them yet: a server that joins gets the rooms it is now closest for,
     * and when one leaves, the next closest gets its rooms.
     */
    private rebalanceNow;
}

/**
 * A path for signaling frames that does not go through the relay: the
 * mesh itself. `canRoute` says whether a frame for that peer has somewhere
 * to go; `send` hands the complete PSP envelope to the mesh and reports
 * whether it was taken. Any frame the mesh declines falls back to the relay.
 */
interface MeshSignaling {
    canRoute(peerId: string): boolean;
    send(envelope: Record<string, unknown>): boolean;
}

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
    /**
     * Learn routes from broadcasts (CECR v1.2, Section 8.5): a broadcast that
     * arrives proves the link it came over leads back to its sender, and a
     * small route ack sent back up the broadcast's path proves the forward
     * links. Direct messages try a fresh learned route before the greedy
     * order. Default true.
     */
    learnRoutes?: boolean;
    /** How long a learned route stays usable. Default 30 seconds. */
    learnedRouteMaxAgeMs?: number;
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
    /** When each peer on the path sent it on (ms since epoch, its own clock), bounded like path. */
    sentAt?: number[];
    /**
     * How long the message has been on its way, in ms, from local measurements
     * only: at each hop the time it waited in that peer plus half the round
     * trip of the link it then crossed. Unlike receivedAt - timestamp it does
     * not depend on the sender's and receiver's clocks agreeing.
     */
    transitMs?: number;
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
    /** Smoothed round trip of the link to a neighbour, ms; null when not measured yet. */
    getLinkRttMs?(peerId: string): number | null;
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
    private readonly maxRetainedBytes;
    private readonly maxRetainedMessageBytes;
    private retainedBytes;
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
    private learnRoutes;
    private learnedRouteMaxAgeMs;
    private learnedRoutes;
    private routeAckParents;
    private pendingRouteAcks;
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
    private dropRetained;
    /** Bytes of message copies currently held for repair. */
    getRetainedBytes(): number;
    private extendRoutePath;
    private compactRoutePeerId;
    private static readonly INITIAL_SPREAD_REPAIR_MIN_INTERVAL_MS;
    private static readonly MAX_REPLAYS_PER_PEER;
    private static readonly ANTI_ENTROPY_RESEND_MS;
    private readonly lastSummaryByPeer;
    private initialSpreadRepairAtMs;
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
    /**
     * Whether a direct frame for this peer has somewhere to go right now: the
     * peer is a connected neighbour, or it is in the live membership and at
     * least one neighbour makes XOR progress toward it. Signaling asks this
     * before choosing the mesh over a relay for a negotiation frame.
     */
    canRouteDirect(targetPeerId: string): boolean;
    /**
     * `connectedOnly` addresses a peer this node is connected to right now, whatever the converged
     * membership view says. The key exchange that runs the moment two peers connect needs it: the
     * view takes a few membership rounds to include a new neighbour, and refusing the frame
     * meant encrypted direct messages waited for the next ten-second announce.
     */
    sendDirect(targetPeerId: string, data: unknown, options?: {
        connectedOnly?: boolean;
    }): string | null;
    private routeDirect;
    private learnRoute;
    private learnCompactRoute;
    private learnedRouteFor;
    private forgetRoutesVia;
    /** Learned routes, for diagnostics: compact target id -> { via, hops, ageMs }. */
    getLearnedRoutes(): Array<{
        target: string;
        via: string;
        hops: number;
        ageMs: number;
    }>;
    private queueRouteAck;
    private flushRouteAck;
    private handleIncomingRouteAck;
    /**
     * CECR v1.3: how many paths a direct message for a non-neighbour takes.
     *   estimatedHops = ceil(log2(estimated network size)) - leading ID bits shared with the target
     *   paths         = 1 + ceil(log2(1 + estimatedHops)), at least 2, at most `available`
     * A target sharing a longer prefix sits in a smaller part of the ID space,
     * so it is fewer hops away and needs fewer paths.
     */
    directPathCount(targetPeerId: string, available: number): number;
    /** Neighbours ordered by raw XOR distance to the target (unknown IDs last). */
    private neighboursNearest;
    private handleIncomingDirect;
    getCecrConfig(): Readonly<CecrConfigSnapshot>;
    getCecrState(): CecrStateSnapshot;
    getStats(): GossipStats;
    cleanup(maxAgeMs?: number): void;
    private pruneRouteLearning;
    private markDirectSeen;
    private pruneTracking;
    on<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void;
    off<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void;
    destroy(): void;
    private emit;
    private tryParseGossipMessage;
    private generateMessageId;
}

type RelayKind = 'cloud' | 'local';
interface RelayInfo {
    url: string;
    nodeId: string;
    kind: RelayKind;
    connections?: number;
    capacity?: number;
    /** True when the relay can only be reached through a tunnel home (no punch). */
    tunnelOnly?: boolean;
}
interface RelayMeasurement {
    /** Exponential moving average of connect-to-registered time, ms. */
    joinMs: number | null;
    attempts: number;
    failures: number;
    /** When this was last measured (ms since epoch). */
    at: number;
}
declare const RELAY_CANDIDATES = 5;
declare const RELAY_VIRTUAL_IDS = 4;
declare const RELAY_SWITCH_MARGIN = 0.3;
/** The key FreeRTC relays publish a room under. */
declare function roomRoutingKey(network: string, room: string): Promise<Uint8Array>;
declare function isHealthy(relay: RelayInfo, m: RelayMeasurement | null | undefined): boolean;
declare function relayScore(relay: RelayInfo, m: RelayMeasurement | null | undefined): number;
interface ChooseRelaysOptions {
    peerId: string;
    network: string;
    room: string;
    relays: readonly RelayInfo[];
    measurements?: (nodeId: string) => RelayMeasurement | null | undefined;
    /** The relay URL this peer used last, if any. */
    previousUrl?: string | null;
    candidates?: number;
    virtualIds?: number;
}
/** Relay URLs in the order to try them. */
declare function chooseRelays(options: ChooseRelaysOptions): Promise<string[]>;
interface SharedRelayScore {
    nodeId: string;
    joinMs: number | null;
    attempts: number;
    failures: number;
    at: number;
}
interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
declare const RELAY_SCORE_STORAGE_KEY = "peerpigeon:relay-scores:v1";
/**
 * Relay measurements: this peer's own joins, and what other peers share.
 * Kept in localStorage when there is one, so a returning peer goes straight
 * to the relay that worked last time.
 */
declare class RelayScoreBook {
    private entries;
    private storage;
    private now;
    constructor(options?: {
        storage?: StorageLike | null;
        now?: () => number;
    });
    static defaultStorage(): StorageLike | null;
    private entry;
    /** Record one of this peer's own joins through a relay. */
    recordJoin(nodeId: string, result: {
        ok: boolean;
        joinMs?: number | null;
    }): void;
    /** Merge scores another peer shared. Only its own measurements, one set per source. */
    mergeShared(sourcePeerId: string, scores: readonly SharedRelayScore[]): void;
    /** The combined measurement for a relay, own counted OWN_WEIGHT times. */
    measurement(nodeId: string): RelayMeasurement | null;
    /** This peer's own measurements, to share with others. */
    ownScores(limit?: number): SharedRelayScore[];
    private load;
    private save;
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
    /**
     * The key that signed this record (checked before it was taken), with signed storage.
     * For a frozen record it is who wrote it: an account's key, when it was written after signAs.
     */
    signer?: string | null;
    createdAt: number;
    updatedAt: number;
    version: StorageVersion;
}
interface StoragePutOptions {
    /**
     * Override owner for first write in user-space records.
     */
    ownerId?: string;
    /**
     * Store the record and serve it on request, but announce nothing: no
     * mutation is gossiped to the room. For content-addressed records that
     * nobody subscribes to in advance — a watcher re-seeding every chunk of
     * every snapshot at start gossiped each one to every peer in the room,
     * hundreds of megabytes that no peer had asked for.
     */
    silent?: boolean;
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
    /**
     * Key prefixes this node replicates in full (public and user spaces): it
     * keeps every change to a key under them without subscribing to the key,
     * and a neighbour that links up sends it every such record it holds (not
     * only the keys this node already knew of), so a newcomer has the whole
     * namespace at once.
     */
    replicate?: string[];
    /**
     * With storage servers: once the room's servers hold a record, drop the
     * local copy unless this node uses it (subscribed, replicated, private),
     * and read it from the servers when asked. Default: true.
     */
    moveToServers?: boolean;
    /**
     * With storage servers: how long a read of a record not kept here waits for
     * the room's servers to be linked, right after joining (ms). Default 8000.
     * Once they are linked, or the wait has run out once, reads do not wait.
     */
    serverWaitMs?: number;
    /**
     * A room of one key's own (a person's records): on the storage servers it takes only records
     * that key signs, so nobody else can put anything in it. Writes here must be signed by it
     * (signingKeys, or signAs). Give the room a sessionId of its own too.
     */
    owner?: string;
    /**
     * Signs every change this node makes, and accepts only signed changes from
     * others: a record's signer is who made it, and a user record's owner is
     * its signer's key (its ownerId). PeerPigeonNode passes its key pair.
     */
    signingKeys?: {
        pub: string;
        priv: string;
    } | null;
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
type GossipMessageListener = (data: {
    message: {
        data: unknown;
    };
    local: boolean;
    fromPeer?: string;
}) => void;
type GossipDirectListener = (data: {
    message: {
        data: unknown;
        from?: string;
    };
}) => void;
type GossipPeerListener = (data: {
    peerId: string;
}) => void;
interface GossipLike {
    broadcast(data: unknown, metadata?: Record<string, unknown>): string;
    sendDirect?(targetPeerId: string, data: unknown): string | null;
    on(event: 'messageReceived', callback: GossipMessageListener): void;
    on(event: 'directMessageReceived', callback: GossipDirectListener): void;
    on(event: 'peerConnected', callback: GossipPeerListener): void;
    off(event: 'messageReceived', callback: GossipMessageListener): void;
    off(event: 'directMessageReceived', callback: GossipDirectListener): void;
    off(event: 'peerConnected', callback: GossipPeerListener): void;
}
declare class PeerPigeonStorage {
    private readonly userId;
    private peerId;
    private readonly gossip;
    private readonly sessionId;
    private readonly syncSecret;
    private readonly dbName;
    private readonly syncFilter;
    private readonly replicate;
    private readonly storeName;
    private driver;
    private readonly listeners;
    private readonly subscribedKeys;
    private readonly subscribedEntries;
    private readonly onDirectMessageBound;
    private readonly onPeerConnectedBound;
    private readonly retrieveAnsweredAt;
    private readonly retrieveAnswerTimes;
    private readonly pendingRetrieveRequests;
    private closed;
    private readonly moveToServers;
    private signingKeys;
    private readonly ownSigningKeys;
    private servers;
    private serverIds;
    private serversReady;
    private readonly serverWaitMs;
    private readonly owner;
    private serversWait;
    private serversWaitDone;
    private migrating;
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
    /** How long to wait for a Get's answer: twice the slowest recent answer, within bounds. */
    private expectedAnswerMs;
    private noteAnswerTime;
    delete(space: StorageSpace, key: string): Promise<boolean>;
    deleteSystem(space: StorageSpace, key: string): Promise<boolean>;
    list(space: StorageSpace): Promise<StorageRecord[]>;
    close(): Promise<void>;
    /** Who this node acts as in a space: its signing key when it signs (a user record's owner), else its user id. */
    private actorFor;
    /** The id records this node owns carry: its signing key when it signs, else its user id. */
    ownerIdentity(): string;
    /** What a signature covers: everything a record says, but where it is kept. */
    private signedText;
    /** The key that signed a change, if its signature holds (and an upsert's time is its record's); else null. */
    private verifiedSigner;
    /**
     * Uses storage servers (a link from storage-servers.ts) for this room: its
     * records go to the room's closest servers, the ones already here are moved
     * to them once they are there, and changes others make arrive from them.
     */
    attachServers(link: StorageServerLink): Promise<void>;
    /**
     * Sign this peer's changes as an account from now on: its keys (after the
     * person signs in), so what they write is theirs on every device they sign
     * in from. null goes back to the keys this storage started with (signing out).
     */
    signAs(keys: {
        pub: string;
        priv: string;
    } | null): void;
    /** Who signs this peer's changes now (an account's key after signAs), or null when unsigned. */
    signer(): string | null;
    /**
     * Storage servers are on their way (the node is linking to them): until they
     * are linked, or serverWaitMs has passed, a read of a record not kept here
     * waits for them rather than finding nothing. A peer that comes back to a
     * room where no other peer is online reads what it left on the servers.
     */
    expectServers(): void;
    /** Whether the room's servers are linked, after waiting for them right after joining. */
    private serversLinked;
    /**
     * Whether the room's servers are linked, as the link has it now. Asked each time rather than
     * kept from the link's events, so a storage never goes on believing there are none.
     */
    private serversUp;
    /** Whether the room's servers are linked now, and how many. */
    serverCount(): number;
    private slotOf;
    /** Sends one change to the room's servers; resolves with how many took it. */
    private pushToServers;
    /** A record from a server: decrypted, checked like any change from the mesh, and kept here. */
    private applyServerRecord;
    private readFromServers;
    /** The records of a space the room's servers keep, decrypted (not kept here). */
    private listFromServers;
    /**
     * The room's servers came up: everything kept here (but private) goes to
     * them, and, once they hold it, what this node does not use is dropped here.
     */
    private migrateToServers;
    /** Whether this node keeps a record here even when servers hold it: one it subscribes to or replicates. */
    private usesLocally;
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
    private syncEnvelope;
    private broadcastSyncPayload;
    private handleRetrieveRequest;
    private handleRetrieveResponse;
    /** The configured filter's verdict, or null when there is no filter. */
    private syncFilterAccepts;
    /**
     * Whether an arriving mutation, response or request concerns this node.
     *
     * A syncFilter names the namespace this node replicates, and it used to be
     * consulted only AFTER a check that the exact key was already subscribed —
     * so it could never bring anything in, only keep things out. A node that
     * had subscribed to nothing dropped every mutation for its own namespace:
     * it heard the room say a record had changed and threw the words away.
     *
     * That made a subscription the only way to learn anything, and a peer with
     * none was unreachable by the room. It sent an empty digest, so nothing was
     * pushed to it, and every mutation it heard was discarded — silence that
     * looked exactly like an empty room. A watcher publishing every ten seconds
     * was invisible to a peer sitting next to it.
     *
     * So a node that declares a namespace replicates it. A node that declares
     * none keeps the old rule and takes only what it subscribed to, which is
     * what stops a filterless node from accepting the whole room.
     */
    private shouldAcceptRemoteSync;
    private createDriver;
    private emitChange;
    private requireDriver;
    private normalizeKey;
    private makePk;
    /**
     * Whether a request or digest is this node's own. By mesh peer id when both
     * sides have one: two tabs (or devices) of the same person share an identity,
     * and each must still answer the other.
     */
    private fromSelf;
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
    private isStorageDigest;
    /**
     * Tell a neighbour that just linked up which mutable records this node
     * subscribes to and which version of each it holds. Frozen records are
     * content-addressed and fetched on demand, so they stay out of it.
     */
    private sendDigest;
    /**
     * Answer a neighbour's digest: push every record this node holds newer
     * than the version listed, and ask directly for every subscribed record
     * the neighbour holds newer than ours.
     */
    private handleDigest;
    /** Whether this node replicates a key in full (a `replicate` prefix). */
    private replicates;
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
    qpub?: string;
    qpriv?: string;
    kpub?: string;
    kpriv?: string;
};
type PeerPublicKey = {
    peerId: string;
    pub: string;
    epub: string;
    /** ML-KEM-768 public key, when the peer has one. */
    kpub?: string;
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
    /** Supply an identity (from exportIdentity() on another device) instead of the one kept here. */
    keyPair?: PeerPigeonKeyPair;
    /**
     * Where the identity is kept, so a peer is the same person when it comes back:
     * 'local' (or true, the default) keeps it in localStorage, for every tab and
     * visit of this browser; 'session' keeps it for this tab only; false keeps none.
     * The records a peer owns (its user space, its private space) stay its own
     * only while it keeps this identity.
     */
    persistKeyPair?: boolean | 'local' | 'session';
    /** Storage key prefix for the kept identity. */
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
    sendDirect(targetPeerId: string, data: unknown, options?: {
        connectedOnly?: boolean;
    }): string | null;
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
    /** Broadcasts seen for other rooms, counted rather than reported as errors. */
    private foreignBroadcasts;
    private readonly onGossipMessageBound;
    private readonly onDirectMessageBound;
    private readonly keyExchangeTimers;
    private readonly onPeerConnectedBound;
    private readonly onSignalingConnectedBound;
    constructor(mesh: CryptoMeshLike, gossip: CryptoGossipLike, options: PeerPigeonCryptoOptions);
    init(): Promise<void>;
    getKeyPair(): Readonly<PeerPigeonKeyPair>;
    getPublicKey(peerId: string): PeerPublicKey | null;
    /** How many broadcasts this node has seen for rooms it is not in. */
    getForeignBroadcastCount(): number;
    getKnownPeerKeys(): PeerPublicKey[];
    announcePublicKey(): void;
    private readonly keyRequestedAt;
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
    private keyStores;
    private loadStoredKeyPair;
    private persistKeyPair;
    private registerLocalKey;
    private localPublicInfoPayload;
    /** True when the neighbour took the frame. A neighbour is addressed whatever the membership view says. */
    private sendPublicInfoDirect;
    /**
     * Swap keys with a peer that has just connected, and keep trying while it is still connected and
     * either the frame was refused or its key has not arrived. The periodic announce stays as the backstop.
     */
    private exchangeKeysWithNeighbour;
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

/** Payload type of a signaling envelope carried inside a gossip direct frame. */
declare const MESH_SIGNAL_PAYLOAD_TYPE = "pp-signal-v1";
declare function isMeshSignalPayload(value: unknown): value is {
    __ppType: typeof MESH_SIGNAL_PAYLOAD_TYPE;
    envelope: Record<string, unknown>;
};

declare const DEFAULT_SIGNALING_SERVERS: readonly string[];
declare const DEFAULT_CLOSE_SIGNALING_RELAY_COUNT = 4;
declare const NEGOTIATION_DEAD_TRANSPORT_DEADLINE_MS = 4000;
declare const NEGOTIATION_ACTIVE_ICE_DEADLINE_MS = 6000;
declare const NEGOTIATION_OFFER_DEADLINE_MS = 20000;
/**
 * Whether this runtime can open a direct (WebRTC Direct) relay connection.
 * Opened in Chromium, Node and Safari (27, 2026-10-31: the channel opens in
 * about 0.6 s); Firefox is untested, so it keeps using the other relays.
 */
declare function directRelaySupported(): boolean;
/** A relay to rank: its URL, and its FreeRTC node ID when known. */
type SignalingRelayCandidate = string | {
    url: string;
    nodeId?: string | null;
    node_id?: string | null;
};
/** Order relays by node-ID XOR distance to the peer ID (SHA-256(hostname) when a relay's node ID is unknown). */
declare function rankSignalingServersByDistance(peerId: string, relays: readonly SignalingRelayCandidate[]): Promise<string[]>;
/** Choose exactly one relay by node-ID XOR distance to the peer ID. */
declare function selectClosestSignalingServer(peerId: string, relayUrls: readonly SignalingRelayCandidate[]): Promise<string>;
/**
 * A relay as a person reads it: the name a direct relay goes by when it has
 * one (ef0d4c0a988ec0d2.decentralize.ooo), else the host of its URL, with its
 * port when it is not the usual one.
 */
declare function relayDisplayName(url: string): string;
/**
 * Every relay a bootstrap's registry (/api/v1/relays) lists, plus the
 * bootstrap and fallbacks, with what each says about itself: node ID, kind
 * (a relay behind NAT is local), and whether it can only be reached through
 * its tunnel. The registry request is HTTP-only.
 */
declare function discoverSignalingRelays(options: {
    bootstrapServer: string;
    fallbackServers?: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** DNS relay directory to read direct relays from (default _relays.peer.ooo); false for none. */
    directory?: string | false;
}): Promise<RelayInfo[]>;
/**
 * Whether this page may open the relay's URL at all. An https page cannot
 * open a plain ws:// connection except to this machine (browsers block it
 * as mixed content), so a relay at ws://<public ip> is never tried there; a
 * browser reaches such a relay through its direct (WebRTC) address instead.
 */
declare function reachableFromThisPage(url: string): boolean;
/**
 * Read the public relay registry from one bootstrap, then order the relays.
 * Given a network and room, relays are chosen for the room (chooseRelays:
 * the room's relays, healthy local ones first, then by measured score);
 * otherwise they are ranked by node-ID distance to the peer ID.
 */
declare function discoverClosestSignalingServers(options: {
    bootstrapServer: string;
    peerId: string;
    fallbackServers?: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    limit?: number;
    network?: string;
    room?: string;
    measurements?: (nodeId: string) => RelayMeasurement | null | undefined;
    previousUrl?: string | null;
    onRelays?: (relays: RelayInfo[]) => void;
    directory?: string | false;
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
     * What this peer is, said in its announce (capabilities.role) and listed by
     * relays with it: a short lowercase word, such as 'storage'. Default: none.
     */
    role?: string | null;
    /**
     * Which roles this peer dials on its own: null (default) dials any peer;
     * ['storage'] only peers listed with that role; [] none at all (it still
     * answers dials, and connectToPeer still dials anyone).
     */
    dialRoles?: readonly string[] | null;
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
     * DNS relay directory to look direct relays up in (one DNS-over-HTTPS
     * lookup), with automaticSignalingServer. Default _relays.peer.ooo; false to
     * use only the bootstrap's registry.
     */
    relayDirectory?: string | false;
    /** Write PeerPigeon's own console messages (hard resets, errors thrown by event handlers). Off by default. */
    debug?: boolean;
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
    'peer:bytes': (data: {
        peerId: string;
        meta: Record<string, unknown>;
        bytes: Uint8Array;
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
declare class PartialMesh {
    private config;
    private readonly role;
    private readonly dialRoles;
    private peers;
    private signalingClient;
    private discoveredPeers;
    private clientId;
    private selfAliases;
    private retiredPeerIds;
    private relayScores;
    private relayNodeIds;
    private relayAttemptStartedAt;
    private eventHandlers;
    private connecting;
    private connectionStartedAtMs;
    private negotiationPhaseByPeerId;
    /** First local observation of FreeRTC negotiations not tracked by PartialMesh. */
    private orphanRtcFirstSeenAtMs;
    private peerConnectedAtMs;
    private linkLog;
    private discoveredAtMs;
    /** Peers present in the relay's latest un-graced discovery snapshot. */
    private activeSignalingPeers;
    private meshSignaling;
    /** Whether the relay has supplied an authoritative active snapshot yet. */
    private hasActiveSignalingSnapshot;
    private maintenanceTimer;
    private membershipTimer;
    private underConnectedSinceMs;
    private lastHardResetAtMs;
    private lastUnderConnectedRecoveryAtMs;
    private lastDiscoveryRefreshAtMs;
    private discoveryRefreshWaitMs;
    private lastSignalingReconnectAtMs;
    private dialFailureCount;
    private lastDialFailureAtMs;
    private dialBackoffUntilMs;
    private rebalanceCooldownUntilMs;
    private rebalanceCooldownMs;
    private rebalanceAttemptAtMs;
    private bridgeGraceUntilMs;
    private lastBridgeDialAtMs;
    private bridgeTrimTimer;
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
    private fillBackoffMs;
    private localRelayTimer;
    private localRelayCheckRunning;
    private fillBackoffUntilMs;
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
    /** Real news arrived, so ask again at full speed. */
    private noteDiscoveryNews;
    /**
     * A peer that said it was leaving (its own 'left' membership record, which
     * only a newer 'alive' record from it overrides). Relay lists and gossip
     * can still name it for a while; it is not rediscovered or dialled.
     */
    private hasLeft;
    /** Drop every trace of a peer that left, so nothing dials it again. */
    private forgetDepartedPeer;
    private addDiscoveredPeer;
    private loadOrCreateBrowserPeerId;
    private rememberBrowserPeerSignalUrls;
    private retirePeerId;
    /**
     * Give the mesh a way to carry signaling frames itself. Once set, a peer
     * the mesh can route to is dialed through connected neighbours, a relay
     * snapshot that omits it cannot cancel that dial, and it counts as a dial
     * candidate whether or not this relay ever lists it.
     */
    setMeshSignaling(provider: MeshSignaling | null): void;
    private meshCanSignal;
    /**
     * A signaling envelope that arrived inside a gossip direct frame. The
     * frame's origin must be the envelope's sender: a neighbour can carry a
     * peer's offer, never author one on its behalf.
     */
    receiveMeshSignal(fromPeerId: string, envelope: Record<string, unknown>): boolean;
    private reconcileSignalingPeers;
    private handleSignalingPeerLeft;
    private trackRtcNegotiation;
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
    /**
     * A peer prefers a local relay (one in the DNS relay directory, reached
     * directly). While it signals through any other relay it looks the
     * directory up again every LOCAL_RELAY_CHECK_MS (a DNS-over-HTTPS lookup,
     * no relay request), and when a listed relay answers a test connection it
     * moves its signaling there; open peer channels stay up. So a peer that
     * fell back to a cloud relay while the local one was down goes back to it
     * once it is up.
     */
    private startLocalRelayReturn;
    private returnToLocalRelay;
    private trimExcessPeers;
    private getOldestPendingAgeMs;
    private isHexId;
    private fastIdHash;
    private peerDistance;
    private cecrNumericPeerId;
    private cecrBucketRank;
    private cecrCoordinateNeighbors;
    /**
     * 0: a coordinate neighbour (the next peer either side in ID order). Those
     *    links alone join every peer into one line, so they come before
     *    anything else: with maxPeers 2 they are the whole topology.
     * 1: a peer in a distance bucket none of our links covers yet.
     * 2: anyone else.
     */
    /** True while one of this peer's coordinate neighbours is not connected. */
    private missingCoordinateNeighbour;
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
    private forgetStaleDialFailures;
    private noteLink;
    /** The last links that opened or closed, newest last: when, which peer, and why it closed. */
    getLinkLog(): Array<{
        at: number;
        peer: string;
        event: 'up' | 'down';
        by: 'local' | 'remote';
        reason: string;
        links: number;
    }>;
    private noteTransportDisconnect;
    private noteStablePeerConnections;
    private noteIntentionalShed;
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
    private dialCandidatePeerIds;
    /** The role a relay listed this peer with (its announce's capabilities.role), or null. */
    getPeerRole(peerId: string): string | null;
    /** Whether this peer dials that one on its own (dialRoles). */
    private dialsRole;
    private maintainPeerConnections;
    /**
     * Connect to a specific peer
     */
    connectToPeer(peerId: string): void;
    private connectToPeerInternal;
    /**
     * Disconnect from a specific peer
     */
    disconnectFromPeer(peerId: string, reason?: string): void;
    /**
     * Remove a peer connection
     */
    private removePeer;
    /**
     * Send data to a specific peer
     */
    send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void;
    /**
     * A message with bytes to a linked neighbour, as one binary frame (no base64, no JSON escaping):
     * false when the peer is not linked or the frame is refused. The receiver must read them (it said so).
     */
    sendBytes(peerId: string, meta: Record<string, unknown>, bytes: Uint8Array): boolean;
    /**
     * Broadcast data to all connected peers
     */
    broadcast(data: string | ArrayBuffer | ArrayBufferView): void;
    /**
     * Get list of connected peer IDs
     */
    /**
     * Ask the relay this peer is on to do something itself, such as a PigeonIdP
     * account lookup ({ action: 'idp-get', namespace, alias }). Resolves with the
     * relay's answer ({ ok: false, error: 'unsupported' } from a relay that does
     * not serve it); rejects when not on a relay or when no answer comes.
     */
    relayRequest(body: Record<string, unknown>, options?: {
        timeoutMs?: number;
    }): Promise<any>;
    /** Smoothed round trip of the link to a neighbour, ms, measured by its keepalive; null when unknown. */
    getLinkRttMs(peerId: string): number | null;
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
    /** This peer's relay measurements (own and shared), used to choose relays. */
    getRelayScores(): RelayScoreBook;
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
    private membershipBroadcastAtMs;
    private membershipBroadcastTimer;
    private renewalForwardIds;
    private renewalForwardTimer;
    private forwardMembershipRecords;
    private broadcastMembership;
    private tryParseMembership;
    private mergeMembership;
    /**
     * Tell our neighbours we are leaving: a CECR 'left' record for ourselves,
     * which each of them merges and forwards. Without it the network keeps us
     * as a member until our lease runs out (up to membershipLeaseMs): peers
     * keep us as a ring neighbour, keep dialling us, and keep counting the
     * links our last report listed. A peer that dies without saying goodbye
     * still ages out by its lease. Returns whether anyone was told.
     */
    announceLeave(): boolean;
    /**
     * Disconnect from all peers and close signaling connection. Neighbours are
     * told we are leaving first (see announceLeave), and the links close
     * LEAVE_FLUSH_MS later so that frame is not dropped with them. Returns how
     * long the links stay open (0 when nobody was told); a caller about to end
     * the process should wait that long.
     */
    destroy(): number;
}
type PeerPigeonNodeStorageOptions = Omit<StorageOptions, 'gossip' | 'peerId' | 'userId'> & {
    userId?: string;
    /**
     * Use storage servers when there are any (default: true): the room's
     * records go to its closest servers, are read from them, and move to them
     * from here (see storage-servers.ts). false keeps storage on the mesh alone.
     */
    servers?: boolean;
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
declare class PeerPigeonNode {
    readonly mesh: PartialMesh;
    readonly gossip: GossipProtocol;
    readonly crypto: PeerPigeonCryptoProtocol | null;
    storage: PeerPigeonStorage | null;
    private readonly storageOptions;
    private readonly signalingOptions;
    private serverLink;
    private linking;
    private storageUserId;
    private readonly openedStorages;
    private readonly callbacks;
    private started;
    private relayScoreTimer;
    constructor(options?: PeerPigeonNodeOptions);
    init(): Promise<void>;
    start(): Promise<void>;
    private useServers;
    /** The relay this node is signalling through now ('' until it has one). */
    currentRelay(): string;
    /** The relay this node uses, as a person reads it (a direct relay by its name). */
    currentRelayName(): string;
    /**
     * A storage room of its own (one person's records, say: name it after their key), kept on the
     * same storage servers as this node's room. Listing it reads only what is in it, however much
     * the node's room holds. Only the servers keep it: the mesh does not sync it.
     * signingKeys: whose changes these are (an account's, after sign-in); by default this node's.
     * owner: a key, for a room only that key writes to (the storage servers take nothing else in it);
     * writes here must then be signed by it.
     * Close it with storage.close() when done (the node closes those still open when it stops).
     */
    openStorage(sessionId: string, options?: {
        signingKeys?: {
            pub: string;
            priv: string;
        } | null;
        owner?: string;
    }): Promise<PeerPigeonStorage>;
    private linkServers;
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
    /**
     * A direct message with bytes to a linked neighbour, in one binary frame: it arrives as a 'message'
     * (kind 'direct') whose data is `meta` with `bytes` added. Only to a peer that reads them (one that
     * asked for bytes); false when it can't go (not linked: send without bytes instead).
     */
    sendBytes(peerId: string, meta: Record<string, unknown>, bytes: Uint8Array): boolean;
    getLinkLog(): {
        at: number;
        peer: string;
        event: "up" | "down";
        by: "local" | "remote";
        reason: string;
        links: number;
    }[];
    getDiscoveredPeers(): string[];
    /** The role a relay listed this peer with, or null. */
    getPeerRole(peerId: string): string | null;
    /** Dial this peer now, whatever its role. */
    connectToPeer(peerId: string): void;
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
    /**
     * This peer's identity, secret keys included: what makes it the owner of its
     * records. Kept in this browser between visits; give it as crypto.keyPair on
     * another device (or after clearing the browser) to be the same person there.
     */
    getKeyPair(): Readonly<PeerPigeonKeyPair>;
    getPublicKey(peerId: string): PeerPublicKey | null;
    getKnownPeerKeys(): PeerPublicKey[];
    requestPeerKey(peerId: string): void;
    waitForPeerKey(peerId: string, timeoutMs?: number): Promise<PeerPublicKey>;
    recoverAfterInactivity(reason?: string): void;
    on<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void;
    off<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void;
    /** This node's link to the storage servers (null with storage off, or storage.servers false). */
    get storageServers(): StorageServerLink | null;
    /**
     * A node in the storage servers' scope, on the same relays as this one: for
     * a server (role 'storage', dialing other servers) or a peer's link to them.
     */
    static serverScopeNode(signaling: Pick<PartialMeshConfig, 'signalingServer' | 'signalingServers' | 'automaticSignalingServer' | 'relayDirectory' | 'iceServers'>, options?: Pick<PartialMeshConfig, 'role' | 'dialRoles' | 'maxPeers' | 'minPeers'>): PeerPigeonNode;
    /** A storage server on the same relays as this node's settings (see storage-servers.ts). */
    static storageServer(signaling?: Pick<PartialMeshConfig, 'signalingServer' | 'signalingServers' | 'automaticSignalingServer' | 'relayDirectory' | 'iceServers'>, store?: ServerRecordStore): StorageServer;
    destroy(): Promise<void>;
    private bindComponentEvents;
    private isReservedPayload;
    private emitError;
    private emit;
}

export { type CecrConfigSnapshot, type CecrMembershipRecordSnapshot, type CecrOverlaySnapshot, type CecrStateSnapshot, DEFAULT_CLOSE_SIGNALING_RELAY_COUNT, DEFAULT_SIGNALING_SERVERS, type EncryptedBroadcastPayload, type EncryptedDirectPayload, type GossipAggregateDeliveryStatus, type GossipBroadcastOptions, type GossipDeliveryStatus, type GossipMessage, GossipProtocol, type GossipProtocolOptions, type GossipStats, MAX_BLOB_BYTES, MESH_SIGNAL_PAYLOAD_TYPE, MemoryServerRecordStore, NEGOTIATION_ACTIVE_ICE_DEADLINE_MS, NEGOTIATION_DEAD_TRANSPORT_DEADLINE_MS, NEGOTIATION_OFFER_DEADLINE_MS, PartialMesh, type PartialMeshConfig, type PartialMeshEvents, type PartialMeshRuntimeConfig, type PeerCapacityAdvertisement, type PeerCapacitySnapshot, type PeerConnection, type PeerGraphEdge, type PeerGraphNode, type PeerGraphSnapshot, type PeerPigeonCryptoEvents, type PeerPigeonCryptoOptions, PeerPigeonCryptoProtocol, type PeerPigeonKeyPair, PeerPigeonNode, type PeerPigeonNodeEvents, type PeerPigeonNodeMessage, type PeerPigeonNodeOptions, type PeerPigeonNodeStorageOptions, PeerPigeonStorage, type PeerPublicKey, RELAY_CANDIDATES, RELAY_SCORE_STORAGE_KEY, RELAY_SWITCH_MARGIN, RELAY_VIRTUAL_IDS, type RelayInfo, type RelayKind, type RelayMeasurement, RelayScoreBook, type RoomCipher, STORAGE_REPLICAS, STORAGE_SERVER_NETWORK, STORAGE_SERVER_ROLE, STORAGE_SERVER_ROOM, type ServerRecord, type ServerRecordStore, type SharedRelayScore, type SignalingRelayCandidate, type StorageChangeOrigin, type StorageEvents, type StorageOptions, type StoragePutOptions, type StorageRecord, type StorageRetrieveOptions, StorageServer, StorageServerLink, type StorageServerStats, type StorageSpace, type StorageSyncFilterContext, type StorageSyncOptions, type StorageUnsubscribe, blobAddress, chooseRelays, PartialMesh as default, directRelaySupported, discoverClosestSignalingServer, discoverClosestSignalingServers, discoverSignalingRelays, isHealthy, isMeshSignalPayload, openBlob, ownedRoomOf, rankSignalingServersByDistance, reachableFromThisPage, relayDisplayName, relayScore, roomRoutingKey, sealBlob, selectClosestSignalingServer, sha1Hex, validRoom };
