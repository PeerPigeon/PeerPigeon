export type GossipProtocolOptions = {
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

export type GossipMessage = {
  id: string;
  timestamp: number;
  hops: number;
  maxHops: number;
  sender: string | null;
  data: unknown;
  metadata: Record<string, unknown>;
  type: 'gossip';
};

export type DirectMessage = {
  id: string;
  type: 'direct';
  from: string;
  to: string;
  data: unknown;
  hops: number;
  maxHops: number;
  timestamp: number;
};

type CecrStateMessage = {
  id: string;
  type: 'cecr-state';
  from: string;
  timestamp: number;
  setHash: string;
  minHex: string;
  maxHex: string;
  size: number;
};

export type GossipStats = {
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
  on(event: 'peer:data', handler: (data: { peerId: string; data: any }) => void): void;
  on(event: 'peer:connected' | 'peer:disconnected', handler: (peerId: string) => void): void;
  getClientId(): string | null;
  getConnectedPeers(): string[];
  getDiscoveredPeers(): string[];
  getGlobalPeers(): string[];
  send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void;
}

type GossipEvents = {
  messageReceived: (data: { message: GossipMessage; local: boolean; fromPeer?: string }) => void;
  peerConnected: (data: { peerId: string }) => void;
  peerDisconnected: (data: { peerId: string }) => void;
  directMessageReceived: (data: { message: DirectMessage }) => void;
};

type CecrExtrema = {
  min: bigint;
  max: bigint;
  updatedAtMs: number;
  size: number;
  setHash: string;
};

type CecrRemoteState = {
  setHash: string;
  min: bigint;
  max: bigint;
  size: number;
  updatedAtMs: number;
};

/**
 * GossipProtocol
 *
 * A small, application-level gossip/epidemic message propagation helper.
 *
 * - De-duplicates messages by `id`
 * - Re-broadcasts unseen messages to connected peers until `maxHops`
 */
export class GossipProtocol {
  private mesh: MeshLike;
  private messageLog: Map<string, { timestamp: number; sender: string | null; hops: number }> = new Map();
  private readonly maxTrackedMessages = 12_000;
  private readonly maxTrackedDirectIds = 12_000;
  private readonly trackingRetentionMs = 10 * 60_000;
  private maxHops: number;
  private maxDirectHops: number;
  private cecrCoordinateWeight: number;
  private cecrExtremaMaxAgeMs: number;
  private cecrMaxAcceptedDrift: number;
  private cecrRequireConsensus: boolean;
  private cecrCurrentExtrema: CecrExtrema | null = null;
  private cecrPreviousExtrema: CecrExtrema | null = null;
  private cecrRemoteStates: Map<string, CecrRemoteState> = new Map();
  private cecrSyncTimer: ReturnType<typeof setInterval> | null = null;
  private trackingCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private seenDirectIds: Map<string, number> = new Map();
  private callbacks: Partial<Record<keyof GossipEvents, Set<Function>>> = {};
  private peers: Map<string, { connected: boolean; timestamp: number }> = new Map();

  constructor(mesh: MeshLike, options: GossipProtocolOptions = {}) {
    this.mesh = mesh;
    this.maxHops = options.maxHops ?? 5;
    this.maxDirectHops = options.maxDirectHops ?? 20;
    this.cecrCoordinateWeight = Math.max(0, Math.min(1, options.cecrCoordinateWeight ?? 0.35));
    this.cecrExtremaMaxAgeMs = Math.max(1_000, options.cecrExtremaMaxAgeMs ?? 20_000);
    this.cecrMaxAcceptedDrift = Math.max(0.01, Math.min(1, options.cecrMaxAcceptedDrift ?? 0.18));
    this.cecrRequireConsensus = options.cecrRequireConsensus ?? true;
    this.setupMeshListeners();
    this.startCecrSyncLoop();
    this.startTrackingCleanupLoop();
  }

  private setupMeshListeners(): void {
    this.mesh.on('peer:data', ({ peerId, data }) => {
      const parsed = this.tryParseGossipMessage(data);
      if (!parsed) return;
      if (parsed.type === 'direct') {
        this.handleIncomingDirect(parsed as unknown as DirectMessage, peerId);
      } else if (parsed.type === 'cecr-state') {
        this.handleIncomingCecrState(parsed as unknown as CecrStateMessage, peerId);
      } else {
        this.handleIncomingMessage(parsed, peerId);
      }
    });

    this.mesh.on('peer:connected', (peerId) => {
      this.peers.set(peerId, { connected: true, timestamp: Date.now() });
      this.publishCecrState();
      this.emit('peerConnected', { peerId });
    });

    this.mesh.on('peer:disconnected', (peerId) => {
      this.peers.delete(peerId);
      this.cecrRemoteStates.delete(peerId);
      this.publishCecrState();
      this.emit('peerDisconnected', { peerId });
    });
  }

  private startCecrSyncLoop(): void {
    if (this.cecrSyncTimer) return;
    this.cecrSyncTimer = setInterval(() => {
      this.publishCecrState();
    }, 2_000);
  }

  private startTrackingCleanupLoop(): void {
    if (this.trackingCleanupTimer) return;
    this.trackingCleanupTimer = setInterval(() => {
      this.pruneTracking();
    }, 30_000);
  }

  /**
   * Broadcast an application payload using gossip-style re-propagation.
   */
  broadcast(data: unknown, metadata: Record<string, unknown> = {}): string {
    const sender = this.mesh.getClientId();
    const connected = this.mesh.getConnectedPeers();
    const global = this.mesh.getGlobalPeers?.() ?? connected;
    const networkSize = Math.max(connected.length, global.length, 1);

    const message: GossipMessage = {
      id: this.generateMessageId(sender),
      timestamp: Date.now(),
      hops: 0,
      // Ensure messages can cross long sparse paths (e.g. saturation/rebalance chains).
      maxHops: Math.max(this.maxHops, networkSize * 2),
      sender,
      data,
      metadata,
      type: 'gossip'
    };

    this.messageLog.set(message.id, {
      timestamp: message.timestamp,
      sender: message.sender,
      hops: 0
    });
    if (this.messageLog.size > this.maxTrackedMessages) {
      this.pruneTracking(message.timestamp);
    }

    this.propagate(message);
    this.emit('messageReceived', { message, local: true });

    return message.id;
  }

  /**
   * Propagate a message to all currently-connected peers.
   */
  propagate(message: GossipMessage, exceptPeerId?: string): void {
    const connectedPeers = this.mesh.getConnectedPeers();

    for (const peerId of connectedPeers) {
      if (peerId === message.sender) continue;
      if (exceptPeerId && peerId === exceptPeerId) continue;

      const forwarded: GossipMessage = {
        ...message,
        hops: message.hops + 1
      };

      try {
        this.mesh.send(peerId, JSON.stringify(forwarded));
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Handle an incoming message from the mesh.
   */
  handleIncomingMessage(message: GossipMessage, fromPeerId: string): void {
    const alreadySeen = this.messageLog.has(message.id);
    if (alreadySeen) return;

    this.messageLog.set(message.id, {
      timestamp: Date.now(),
      sender: message.sender,
      hops: message.hops
    });
    if (this.messageLog.size > this.maxTrackedMessages) {
      this.pruneTracking();
    }

    this.emit('messageReceived', { message, local: false, fromPeer: fromPeerId });

    if (message.hops < message.maxHops) {
      this.propagate(message, fromPeerId);
    }
  }

  // ─── Direct / XOR-routed messaging ───────────────────────────────────────

  /**
   * XOR distance between two hex-encoded peer IDs.
   * Returns a BigInt (lower = closer).
   */
  private xorDistance(a: string, b: string): bigint {
    const left = this.peerIdToNumeric(a);
    const right = this.peerIdToNumeric(b);
    if (left == null || right == null) {
      throw new Error('Peer IDs are not comparable in XOR space');
    }
    return left ^ right;
  }

  /**
   * Pick the connected peer closest (by XOR distance) to target.
   * Falls back to any connected peer if IDs can't be compared.
   */
  private closestPeerTo(target: string, exclude?: string): string | null {
    const connected = this.mesh.getConnectedPeers().filter(p => p !== exclude);
    if (connected.length === 0) return null;
    let best: string | null = null;
    let bestDist: bigint | null = null;
    for (const p of connected) {
      try {
        const d = this.xorDistance(p, target);
        if (bestDist == null || d < bestDist) {
          bestDist = d;
          best = p;
        }
      } catch {
        if (!best) best = p;
      }
    }
    return best;
  }

  private peerIdToNumeric(peerId: string): bigint | null {
    try {
      const hex = peerId.replace(/-/g, '').toLowerCase();
      if (!hex || !/^[0-9a-f]+$/.test(hex)) return null;
      return BigInt('0x' + hex);
    } catch {
      return null;
    }
  }

  private canonicalPeerSet(): string[] {
    const universe = new Set<string>();
    const self = this.mesh.getClientId();
    if (self) universe.add(self);
    for (const peerId of this.mesh.getGlobalPeers?.() ?? []) universe.add(peerId);
    return Array.from(universe).sort();
  }

  private canonicalSetHash(peerIds: string[]): string {
    const input = peerIds.join('\n');
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mod = 0xFFFFFFFFFFFFFFFFn;
    for (let i = 0; i < input.length; i++) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = (hash * prime) & mod;
    }
    return hash.toString(16).padStart(16, '0');
  }

  private updateCecrExtremaSnapshot(): CecrExtrema | null {
    const canonicalPeers = this.canonicalPeerSet();
    const setHash = this.canonicalSetHash(canonicalPeers);

    let min: bigint | null = null;
    let max: bigint | null = null;
    let count = 0;
    for (const peerId of canonicalPeers) {
      const value = this.peerIdToNumeric(peerId);
      if (value == null) return null;
      if (min == null || value < min) min = value;
      if (max == null || value > max) max = value;
      count++;
    }

    if (min == null || max == null || count < 2 || min === max) {
      return null;
    }

    const next: CecrExtrema = {
      min,
      max,
      updatedAtMs: Date.now(),
      size: count,
      setHash,
    };

    if (
      !this.cecrCurrentExtrema ||
      this.cecrCurrentExtrema.min !== next.min ||
      this.cecrCurrentExtrema.max !== next.max ||
      this.cecrCurrentExtrema.size !== next.size ||
      this.cecrCurrentExtrema.setHash !== next.setHash
    ) {
      this.cecrPreviousExtrema = this.cecrCurrentExtrema;
      this.cecrCurrentExtrema = next;
    } else {
      this.cecrCurrentExtrema.updatedAtMs = next.updatedAtMs;
    }

    return this.cecrCurrentExtrema;
  }

  private coordinateFor(peerId: string, extrema: CecrExtrema): number | null {
    const value = this.peerIdToNumeric(peerId);
    if (value == null) return null;
    const span = extrema.max - extrema.min;
    if (span <= 0n) return null;
    return Number(value - extrema.min) / Number(span);
  }

  private effectiveCecrCoordinateWeight(targetPeerId: string): number {
    let weight = this.cecrCoordinateWeight;
    const current = this.cecrCurrentExtrema ?? this.updateCecrExtremaSnapshot();
    if (!current) return 0;
    if (!this.hasCecrConsensus(current)) return 0;

    const ageMs = Date.now() - current.updatedAtMs;
    if (ageMs > this.cecrExtremaMaxAgeMs) {
      // Bound routing drift under stale extrema by relying more on XOR routing.
      weight *= 0.2;
    }

    if (this.cecrPreviousExtrema) {
      const prevCoord = this.coordinateFor(targetPeerId, this.cecrPreviousExtrema);
      const nextCoord = this.coordinateFor(targetPeerId, current);
      if (prevCoord != null && nextCoord != null) {
        const drift = Math.abs(prevCoord - nextCoord);
        if (drift > this.cecrMaxAcceptedDrift) {
          weight *= 0.15;
        }
      }
    }

    return Math.max(0, Math.min(1, weight));
  }

  private hasCecrConsensus(local: CecrExtrema): boolean {
    if (!this.cecrRequireConsensus) return true;
    const now = Date.now();
    if (now - local.updatedAtMs > this.cecrExtremaMaxAgeMs) return false;

    const connectedPeers = this.mesh.getConnectedPeers();
    for (const peerId of connectedPeers) {
      const remote = this.cecrRemoteStates.get(peerId);
      if (!remote) return false;
      if (now - remote.updatedAtMs > this.cecrExtremaMaxAgeMs) return false;
      if (remote.setHash !== local.setHash) return false;
      if (remote.size !== local.size) return false;
      if (remote.min !== local.min || remote.max !== local.max) return false;
    }
    return true;
  }

  private publishCecrState(): void {
    const self = this.mesh.getClientId();
    if (!self) return;
    const extrema = this.updateCecrExtremaSnapshot();
    if (!extrema) return;

    const message: CecrStateMessage = {
      id: this.generateMessageId(self),
      type: 'cecr-state',
      from: self,
      timestamp: Date.now(),
      setHash: extrema.setHash,
      minHex: extrema.min.toString(16),
      maxHex: extrema.max.toString(16),
      size: extrema.size,
    };

    for (const peerId of this.mesh.getConnectedPeers()) {
      try {
        this.mesh.send(peerId, JSON.stringify(message));
      } catch {
        // best-effort
      }
    }
  }

  private handleIncomingCecrState(message: CecrStateMessage, fromPeerId: string): void {
    if (message.from !== fromPeerId) return;
    if (!message.setHash || typeof message.setHash !== 'string') return;
    if (!Number.isFinite(message.size) || message.size < 1) return;

    try {
      const min = BigInt('0x' + message.minHex);
      const max = BigInt('0x' + message.maxHex);
      if (min > max) return;
      this.cecrRemoteStates.set(fromPeerId, {
        setHash: message.setHash,
        min,
        max,
        size: Math.floor(message.size),
        updatedAtMs: Date.now(),
      });
    } catch {
      // ignore malformed state
    }
  }

  private normalizedBigIntRatio(numerator: bigint, denominator: bigint): number {
    if (denominator <= 0n) return 1;
    if (numerator <= 0n) return 0;
    const scale = 1_000_000n;
    const scaled = (numerator * scale) / denominator;
    return Number(scaled) / Number(scale);
  }

  private closestPeerHybrid(target: string, exclude?: string): string | null {
    const connected = this.mesh.getConnectedPeers().filter(p => p !== exclude);
    if (connected.length === 0) return null;

    const coordWeight = this.effectiveCecrCoordinateWeight(target);
    if (coordWeight <= 0.001) {
      return this.closestPeerTo(target, exclude);
    }

    const extrema = this.cecrCurrentExtrema ?? this.updateCecrExtremaSnapshot();
    const targetCoord = extrema ? this.coordinateFor(target, extrema) : null;
    if (!extrema || targetCoord == null) {
      return this.closestPeerTo(target, exclude);
    }

    let maxXor = 1n;
    const xorDistances = new Map<string, bigint>();
    for (const peerId of connected) {
      try {
        const d = this.xorDistance(peerId, target);
        xorDistances.set(peerId, d);
        if (d > maxXor) maxXor = d;
      } catch {
        xorDistances.set(peerId, maxXor);
      }
    }

    let bestPeer: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const peerId of connected) {
      const dXor = xorDistances.get(peerId) ?? maxXor;
      const xorScore = this.normalizedBigIntRatio(dXor, maxXor || 1n);

      const peerCoord = this.coordinateFor(peerId, extrema);
      const ratioScore = peerCoord == null ? 1 : Math.abs(peerCoord - targetCoord);

      const score = (1 - coordWeight) * xorScore + coordWeight * ratioScore;
      if (score < bestScore) {
        bestScore = score;
        bestPeer = peerId;
      }
    }

    return bestPeer ?? this.closestPeerTo(target, exclude);
  }

  /**
   * Send a direct message to a specific peer, routed through the mesh via XOR distance.
   * Delivers even if there is no direct connection to the target.
   */
  sendDirect(targetPeerId: string, data: unknown): string | null {
    const from = this.mesh.getClientId();
    if (!from) return null;

    const message: DirectMessage = {
      id: this.generateMessageId(from),
      type: 'direct',
      from,
      to: targetPeerId,
      data,
      hops: 0,
      maxHops: this.maxDirectHops,
      timestamp: Date.now(),
    };

    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, null);
    return message.id;
  }

  private routeDirect(message: DirectMessage, fromPeerId: string | null): void {
    const self = this.mesh.getClientId();

    // We are the destination
    if (message.to === self) {
      this.emit('directMessageReceived', { message });
      return;
    }

    // Is target directly connected? Short-circuit.
    const connected = this.mesh.getConnectedPeers();
    if (connected.includes(message.to)) {
      try {
        this.mesh.send(message.to, JSON.stringify({ ...message, hops: message.hops + 1 }));
      } catch { /* best-effort */ }
      return;
    }

    if (message.hops >= message.maxHops) return;

    // Hybrid CECR routing: coordinate proximity (local) + XOR (global backbone).
    const next = this.closestPeerHybrid(message.to, fromPeerId ?? undefined);
    if (!next) return;

    try {
      this.mesh.send(next, JSON.stringify({ ...message, hops: message.hops + 1 }));
    } catch { /* best-effort */ }
  }

  private handleIncomingDirect(message: DirectMessage, fromPeerId: string): void {
    if (this.seenDirectIds.has(message.id)) return;
    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, fromPeerId);
  }

  getStats(): GossipStats {
    const now = Date.now();
    const messages = Array.from(this.messageLog.entries()).map(([id, info]) => ({
      id,
      timestamp: info.timestamp,
      sender: info.sender,
      hops: info.hops,
      age: now - info.timestamp
    }));

    return {
      totalMessagesTracked: this.messageLog.size,
      recentMessages: messages.filter((m) => m.age < 60_000),
      connectedPeers: this.mesh.getConnectedPeers().length,
      discoveredPeers: this.mesh.getDiscoveredPeers().length
    };
  }

  cleanup(maxAgeMs: number = 10 * 60_000): void {
    const now = Date.now();
    for (const [id, info] of this.messageLog.entries()) {
      if (now - info.timestamp > maxAgeMs) {
        this.messageLog.delete(id);
      }
    }
    for (const [id, timestamp] of this.seenDirectIds.entries()) {
      if (now - timestamp > maxAgeMs) {
        this.seenDirectIds.delete(id);
      }
    }
  }

  private markDirectSeen(id: string, timestamp: number): void {
    this.seenDirectIds.set(id, timestamp || Date.now());
    if (this.seenDirectIds.size > this.maxTrackedDirectIds) {
      this.pruneTracking();
    }
  }

  private pruneTracking(now: number = Date.now()): void {
    const minTimestamp = now - this.trackingRetentionMs;

    for (const [id, info] of this.messageLog.entries()) {
      if (info.timestamp >= minTimestamp) {
        break;
      }
      this.messageLog.delete(id);
    }
    while (this.messageLog.size > this.maxTrackedMessages) {
      const oldest = this.messageLog.keys().next().value;
      if (!oldest) break;
      this.messageLog.delete(oldest);
    }

    for (const [id, timestamp] of this.seenDirectIds.entries()) {
      if (timestamp >= minTimestamp) {
        break;
      }
      this.seenDirectIds.delete(id);
    }
    while (this.seenDirectIds.size > this.maxTrackedDirectIds) {
      const oldest = this.seenDirectIds.keys().next().value;
      if (!oldest) break;
      this.seenDirectIds.delete(oldest);
    }
  }

  on<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void {
    const existing = this.callbacks[event];
    if (existing) {
      existing.add(callback);
      return;
    }
    this.callbacks[event] = new Set([callback]);
  }

  off<K extends keyof GossipEvents>(event: K, callback: GossipEvents[K]): void {
    const existing = this.callbacks[event];
    if (!existing) return;
    existing.delete(callback);
  }

  destroy(): void {
    this.messageLog.clear();
    this.peers.clear();
    this.seenDirectIds.clear();
    this.cecrRemoteStates.clear();
    if (this.cecrSyncTimer) {
      clearInterval(this.cecrSyncTimer);
      this.cecrSyncTimer = null;
    }
    if (this.trackingCleanupTimer) {
      clearInterval(this.trackingCleanupTimer);
      this.trackingCleanupTimer = null;
    }
    this.callbacks = {};
  }

  private emit<K extends keyof GossipEvents>(event: K, data: Parameters<GossipEvents[K]>[0]): void {
    const cbs = this.callbacks[event];
    if (!cbs) return;
    for (const cb of cbs) {
      try {
        (cb as any)(data);
      } catch {
        // ignore
      }
    }
  }

  private tryParseGossipMessage(raw: any): GossipMessage | DirectMessage | CecrStateMessage | null {
    const toEnvelope = (value: any): any | null => {
      if (!value) return null;
      if (typeof value === 'object' && typeof value.id === 'string' && typeof value.type === 'string') {
        return value;
      }

      let text: string;
      if (typeof value === 'string') {
        text = value;
      } else if (value instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array(value));
      } else if (ArrayBuffer.isView(value)) {
        text = new TextDecoder().decode(value as Uint8Array);
      } else if (typeof value?.toString === 'function') {
        text = value.toString();
      } else {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const parsed = toEnvelope(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;

    if (parsed.type === 'gossip') {
      return parsed as GossipMessage;
    }

    if (parsed.type === 'direct' && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      return parsed as DirectMessage;
    }

    if (
      parsed.type === 'cecr-state' &&
      typeof parsed.from === 'string' &&
      typeof parsed.setHash === 'string' &&
      typeof parsed.minHex === 'string' &&
      typeof parsed.maxHex === 'string' &&
      typeof parsed.size === 'number'
    ) {
      return parsed as CecrStateMessage;
    }

    return null;
  }

  private generateMessageId(sender: string | null): string {
    const safeSender = (sender ?? 'unknown').toString();
    return `${safeSender}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
