// Type definitions for PeerPigeon
export interface PeerPigeonOptions {
    enableWebDHT?: boolean;
    peerId?: string;
    maxPeers?: number;
    minPeers?: number;
    autoConnect?: boolean;
    autoDiscovery?: boolean;
    evictionStrategy?: boolean;
    xorRouting?: boolean;
    connectionType?: 'websocket';
    localStream?: MediaStream;
    enableVideo?: boolean;
    enableAudio?: boolean;
}

export interface PeerStatus {
    peerId: string;
    connected: boolean;
    connectedCount: number;
    discoveredCount: number;
    maxPeers: number;
    minPeers: number;
    autoConnect: boolean;
    autoDiscovery: boolean;
    evictionStrategy: boolean;
    xorRouting: boolean;
    connectionType: string;
    signalingUrl?: string;
    uptime: number;
}

export interface MessageData {
    from: string;
    content: any;
    direct: boolean;
    hops?: number;
    timestamp: number;
}

export interface BinaryMessageEvent {
    from: string;
    data: Uint8Array;
    size: number;
    timestamp: number;
}

export interface StreamMetadata {
    streamId: string;
    type: string;
    filename?: string;
    mimeType?: string;
    totalSize?: number;
    chunkSize?: number;
    timestamp: number;
}

export interface StreamReceivedEvent {
    peerId: string;
    streamId: string;
    stream: ReadableStream;
    metadata: StreamMetadata;
}

export interface StreamCompletedEvent {
    peerId: string;
    streamId: string;
    totalChunks: number;
}

export interface StreamAbortedEvent {
    peerId: string;
    streamId: string;
    reason: string;
}

export interface PeerConnectionEvent {
    peerId: string;
}

export interface PeerDisconnectionEvent {
    peerId: string;
    reason: string;
}

export interface RemoteStreamEvent {
    peerId: string;
    stream: MediaStream;
}

export interface DHTValueChangedEvent {
    key: string;
    newValue: any;
    oldValue?: any;
}

export interface StatusChangedEvent {
    type: string;
    message: string;
}

export interface StreamingStatus {
    sendingStream: boolean;
    receivingStreams: boolean;
    streamType: 'broadcast' | 'selective' | 'none';
}

export interface SelectiveStreamStartedEvent {
    targetPeerIds: string[];
    stream: MediaStream;
    streamType: '1:1' | '1:many';
}

export interface SelectiveStreamStoppedEvent {
    returnToBroadcast: boolean;
}

export interface StreamingBlockedEvent {
    blockedPeerIds: string[];
}

export interface StreamingAllowedEvent {
    allowedPeerIds: string[];
}

export declare class PeerPigeonMesh {
    constructor(options?: PeerPigeonOptions);
    
    // Core methods
    init(): Promise<void>;
    connect(signalingUrl: string): Promise<void>;
    disconnect(): void;
    
    // Configuration
    setMaxPeers(count: number): void;
    setMinPeers(count: number): void;
    setAutoConnect(enabled: boolean): void;
    setAutoDiscovery(enabled: boolean): void;
    setEvictionStrategy(enabled: boolean): void;
    setXorRouting(enabled: boolean): void;
    setConnectionType(type: 'websocket'): void;
    
    // Network information
    getStatus(): PeerStatus;
    getConnectedPeerCount(): number;
    getPeers(): string[];
    getDiscoveredPeers(): string[];
    canAcceptMorePeers(): boolean;
    hasPeer(peerId: string): boolean;
    
    // Messaging
    sendMessage(content: any): string;
    sendDirectMessage(peerId: string, content: any): string;
    
    // Binary messaging
    sendBinaryData(targetPeerId: string, binaryData: Uint8Array | ArrayBuffer): Promise<boolean>;
    broadcastBinaryData(binaryData: Uint8Array | ArrayBuffer): Promise<number>;
    
    // Streaming
    createStreamToPeer(targetPeerId: string, options?: Partial<StreamMetadata>): WritableStream;
    sendStream(targetPeerId: string, readableStream: ReadableStream, options?: Partial<StreamMetadata>): Promise<void>;
    sendFile(targetPeerId: string, file: File): Promise<void>;
    sendBlob(targetPeerId: string, blob: Blob, options?: Partial<StreamMetadata>): Promise<void>;
    
    // Media
    startMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    stopMedia(): void;
    toggleVideo(): void;
    toggleAudio(): void;
    enumerateMediaDevices(): Promise<{
        cameras: MediaDeviceInfo[];
        microphones: MediaDeviceInfo[];
    }>;
    
    // === SELECTIVE STREAMING METHODS ===
    startSelectiveStream(peerIds: string | string[], options?: MediaStreamConstraints): Promise<MediaStream>;
    stopSelectiveStream(returnToBroadcast?: boolean): Promise<void>;
    enableStreamingForAllPeers(): Promise<void>;
    blockStreamingToPeers(peerIds: string | string[]): Promise<void>;
    allowStreamingToPeers(peerIds: string | string[]): Promise<void>;
    getStreamingStatus(): Map<string, StreamingStatus>;
    isStreamingToAll(): boolean;
    getStreamingPeers(): string[];
    getBlockedStreamingPeers(): string[];
    
    // WebDHT
    dhtPut(key: string, value: any): Promise<void>;
    dhtGet(key: string): Promise<any>;
    dhtSubscribe(key: string): Promise<void>;
    dhtUnsubscribe(key: string): Promise<void>;
    dhtUpdate(key: string, value: any): Promise<void>;
    
    // Events
    addEventListener(event: 'connected', listener: () => void): void;
    addEventListener(event: 'disconnected', listener: () => void): void;
    addEventListener(event: 'peerConnected', listener: (data: PeerConnectionEvent) => void): void;
    addEventListener(event: 'peerDisconnected', listener: (data: PeerDisconnectionEvent) => void): void;
    addEventListener(event: 'peerDiscovered', listener: (data: PeerConnectionEvent) => void): void;
    addEventListener(event: 'peerEvicted', listener: (data: PeerDisconnectionEvent) => void): void;
    addEventListener(event: 'messageReceived', listener: (data: MessageData) => void): void;
    addEventListener(event: 'binaryMessageReceived', listener: (data: BinaryMessageEvent) => void): void;
    addEventListener(event: 'streamReceived', listener: (data: StreamReceivedEvent) => void): void;
    addEventListener(event: 'streamCompleted', listener: (data: StreamCompletedEvent) => void): void;
    addEventListener(event: 'streamAborted', listener: (data: StreamAbortedEvent) => void): void;
    addEventListener(event: 'remoteStream', listener: (data: RemoteStreamEvent) => void): void;
    addEventListener(event: 'dhtValueChanged', listener: (data: DHTValueChangedEvent) => void): void;
    addEventListener(event: 'statusChanged', listener: (data: StatusChangedEvent) => void): void;
    addEventListener(event: 'peersUpdated', listener: () => void): void;
    
    // === NEW SELECTIVE STREAMING EVENTS ===
    addEventListener(event: 'selectiveStreamStarted', listener: (data: SelectiveStreamStartedEvent) => void): void;
    addEventListener(event: 'selectiveStreamStopped', listener: (data: SelectiveStreamStoppedEvent) => void): void;
    addEventListener(event: 'broadcastStreamEnabled', listener: () => void): void;
    addEventListener(event: 'streamingBlockedToPeers', listener: (data: StreamingBlockedEvent) => void): void;
    addEventListener(event: 'streamingAllowedToPeers', listener: (data: StreamingAllowedEvent) => void): void;
    
    removeEventListener(event: string, listener: Function): void;
    
    // Standard Node.js EventEmitter compatible methods
    on(event: 'connected', listener: () => void): this;
    on(event: 'disconnected', listener: () => void): this;
    on(event: 'peerConnected', listener: (data: PeerConnectionEvent) => void): this;
    on(event: 'peerDisconnected', listener: (data: PeerDisconnectionEvent) => void): this;
    on(event: 'peerDiscovered', listener: (data: PeerConnectionEvent) => void): this;
    on(event: 'peerEvicted', listener: (data: PeerDisconnectionEvent) => void): this;
    on(event: 'messageReceived', listener: (data: MessageData) => void): this;
    on(event: 'binaryMessageReceived', listener: (data: BinaryMessageEvent) => void): this;
    on(event: 'streamReceived', listener: (data: StreamReceivedEvent) => void): this;
    on(event: 'streamCompleted', listener: (data: StreamCompletedEvent) => void): this;
    on(event: 'streamAborted', listener: (data: StreamAbortedEvent) => void): this;
    on(event: 'remoteStream', listener: (data: RemoteStreamEvent) => void): this;
    on(event: 'dhtValueChanged', listener: (data: DHTValueChangedEvent) => void): this;
    on(event: 'statusChanged', listener: (data: StatusChangedEvent) => void): this;
    on(event: 'peersUpdated', listener: () => void): this;
    on(event: 'selectiveStreamStarted', listener: (data: SelectiveStreamStartedEvent) => void): this;
    on(event: 'selectiveStreamStopped', listener: (data: SelectiveStreamStoppedEvent) => void): this;
    on(event: 'broadcastStreamEnabled', listener: () => void): this;
    on(event: 'streamingBlockedToPeers', listener: (data: StreamingBlockedEvent) => void): this;
    on(event: 'streamingAllowedToPeers', listener: (data: StreamingAllowedEvent) => void): this;
    on(event: string, listener: Function): this;
    
    off(event: string, listener: Function): this;
    
    once(event: 'connected', listener: () => void): this;
    once(event: 'disconnected', listener: () => void): this;
    once(event: 'peerConnected', listener: (data: PeerConnectionEvent) => void): this;
    once(event: 'peerDisconnected', listener: (data: PeerDisconnectionEvent) => void): this;
    once(event: 'peerDiscovered', listener: (data: PeerConnectionEvent) => void): this;
    once(event: 'peerEvicted', listener: (data: PeerDisconnectionEvent) => void): this;
    once(event: 'messageReceived', listener: (data: MessageData) => void): this;
    once(event: 'remoteStream', listener: (data: RemoteStreamEvent) => void): this;
    once(event: 'dhtValueChanged', listener: (data: DHTValueChangedEvent) => void): this;
    once(event: 'statusChanged', listener: (data: StatusChangedEvent) => void): this;
    once(event: 'peersUpdated', listener: () => void): this;
    once(event: 'selectiveStreamStarted', listener: (data: SelectiveStreamStartedEvent) => void): this;
    once(event: 'selectiveStreamStopped', listener: (data: SelectiveStreamStoppedEvent) => void): this;
    once(event: 'broadcastStreamEnabled', listener: () => void): this;
    once(event: 'streamingBlockedToPeers', listener: (data: StreamingBlockedEvent) => void): this;
    once(event: 'streamingAllowedToPeers', listener: (data: StreamingAllowedEvent) => void): this;
    once(event: string, listener: Function): this;
    
    removeAllListeners(event?: string): this;
    listeners(event: string): Function[];
    listenerCount(event: string): number;
    eventNames(): string[];
    
    emit(event: string, data?: any): void;
}

export interface PeerConnectionOptions {
    localStream?: MediaStream;
    enableVideo?: boolean;
    enableAudio?: boolean;
}

export declare class PeerConnection {
    constructor(peerId: string, isInitiator?: boolean, options?: PeerConnectionOptions);
    
    createConnection(): Promise<void>;
    createOffer(): Promise<RTCSessionDescription>;
    handleOffer(offer: RTCSessionDescription): Promise<RTCSessionDescription>;
    handleAnswer(answer: RTCSessionDescription): Promise<void>;
    handleIceCandidate(candidate: RTCIceCandidate): Promise<void>;
    sendMessage(message: any): boolean;
    setLocalStream(stream: MediaStream | null): Promise<void>;
    getRemoteStream(): MediaStream | null;
    getLocalStream(): MediaStream | null;
    getMediaCapabilities(): {
        hasLocalVideo: boolean;
        hasLocalAudio: boolean;
        hasRemoteVideo: boolean;
        hasRemoteAudio: boolean;
    };
    getStatus(): string;
    getDetailedStatus(): {
        connectionState: string;
        iceConnectionState: string;
        dataChannelState: string;
        dataChannelReady: boolean;
        isClosing: boolean;
        overallStatus: string;
    };
    close(): void;
    
    // Events
    on(event: 'connected', listener: (data: PeerConnectionEvent) => void): void;
    on(event: 'disconnected', listener: (data: PeerDisconnectionEvent) => void): void;
    on(event: 'message', listener: (data: { peerId: string; message: any }) => void): void;
    on(event: 'remoteStream', listener: (data: RemoteStreamEvent) => void): void;
    on(event: 'iceCandidate', listener: (data: { peerId: string; candidate: RTCIceCandidate }) => void): void;
}

export interface SignalingOptions {
    connectionType?: 'websocket';
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    keepAliveInterval?: number;
}

export declare class SignalingClient {
    constructor(options?: SignalingOptions);
    
    connect(url: string, peerId: string): Promise<void>;
    disconnect(): void;
    sendMessage(message: any): boolean;
    isConnected(): boolean;
    
    // Events
    on(event: 'connected', listener: () => void): void;
    on(event: 'disconnected', listener: () => void): void;
    on(event: 'message', listener: (message: any) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}

export interface DHTOptions {
    replicationFactor?: number;
    storageQuota?: number;
    maintenanceInterval?: number;
    requestTimeout?: number;
}

export declare class WebDHT {
    constructor(peerId: string, options?: DHTOptions);
    
    put(key: string, value: any): Promise<void>;
    get(key: string): Promise<any>;
    subscribe(key: string): Promise<void>;
    unsubscribe(key: string): Promise<void>;
    update(key: string, value: any): Promise<void>;
    
    // Events
    on(event: 'valueChanged', listener: (data: DHTValueChangedEvent) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}

export interface ServerOptions {
    port?: number;
    host?: string;
    maxConnections?: number;
    cleanupInterval?: number;
    peerTimeout?: number;
    corsOrigin?: string;
    maxMessageSize?: number;
}

export interface ServerStats {
    isRunning: boolean;
    connections: number;
    peers: number;
    maxConnections: number;
    uptime: number;
    host: string;
    port: number;
}

export interface PeerInfo {
    peerId: string;
    connectedAt: number;
    lastActivity: number;
    remoteAddress: string;
    announced?: boolean;
    announcedAt?: number;
}

export declare class PeerPigeonServer {
    constructor(options?: ServerOptions);
    
    start(): Promise<void>;
    stop(): Promise<void>;
    getStats(): ServerStats;
    getPeers(): PeerInfo[];
    
    // Events
    on(event: 'started', listener: (data: { host: string; port: number }) => void): void;
    on(event: 'stopped', listener: () => void): void;
    on(event: 'peerConnected', listener: (data: { peerId: string; totalConnections: number }) => void): void;
    on(event: 'peerDisconnected', listener: (data: { peerId: string; code: number; reason: string; totalConnections: number }) => void): void;
    on(event: 'peerAnnounced', listener: (data: { peerId: string }) => void): void;
    on(event: 'peerGoodbye', listener: (data: { peerId: string }) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}
