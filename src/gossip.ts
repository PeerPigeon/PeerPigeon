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
  /** Default deadline for opt-in tracked gossip delivery. Default 30 seconds. */
  deliveryTimeoutMs?: number;
  /** Delay before a tracked message is eligible for targeted repair. Default 4 seconds. */
  deliveryRepairDelayMs?: number;
  /** Minimum delay between repair attempts for the same target. Default 5 seconds. */
  deliveryRepairIntervalMs?: number;
};

export type GossipBroadcastOptions = {
  /** Track delivery to the canonical known-peer snapshot captured at send time. */
  trackDelivery?: boolean;
  /** Override the protocol's tracked-delivery deadline for this message. */
  deliveryTimeoutMs?: number;
};

export type GossipDeliveryStatus = {
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

type GossipDeliveryReceipt = GossipDeliveryEnvelope & {
  messageId: string;
  sender: string;
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
  delivery?: GossipDeliveryEnvelope;
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
  receipts?: GossipDeliveryReceipt[];
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
  deliveryProgress: (status: GossipDeliveryStatus) => void;
  deliveryComplete: (status: GossipDeliveryStatus) => void;
  deliveryTimeout: (status: GossipDeliveryStatus) => void;
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

type GossipDeliveryState = {
  messageId: string;
  sender: string;
  setHash: string;
  size: number;
  bits: Uint8Array;
  peerIds: string[] | null;
  message: GossipMessage | null;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
  completedAt: number | null;
  timedOut: boolean;
  lastStatusSignature: string;
  repairAttemptsByPeer: Map<string, { attempts: number; lastAttemptAt: number }>;
};

const RELIABLE_REPAIR_TYPE = 'pp-gossip-repair-v1';
const MAX_RECEIPT_DELTAS_PER_SYNC = 32;
const MAX_DELIVERY_PEERS = 4096;
const MAX_REPAIR_ATTEMPTS_PER_TARGET = 3;

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
  private deliveryTimeoutMs: number;
  private deliveryRepairDelayMs: number;
  private deliveryRepairIntervalMs: number;
  private cecrCurrentExtrema: CecrExtrema | null = null;
  private cecrPreviousExtrema: CecrExtrema | null = null;
  private cecrRemoteStates: Map<string, CecrRemoteState> = new Map();
  private cecrSyncTimer: ReturnType<typeof setInterval> | null = null;
  private trackingCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private seenDirectIds: Map<string, number> = new Map();
  private deliveryStates: Map<string, GossipDeliveryState> = new Map();
  private dirtyDeliveryReceiptIds: Set<string> = new Set();
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
    this.deliveryTimeoutMs = Math.max(2_000, options.deliveryTimeoutMs ?? 30_000);
    this.deliveryRepairDelayMs = Math.max(1_000, options.deliveryRepairDelayMs ?? 4_000);
    this.deliveryRepairIntervalMs = Math.max(1_000, options.deliveryRepairIntervalMs ?? 5_000);
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
      for (const messageId of this.deliveryStates.keys()) {
        this.dirtyDeliveryReceiptIds.add(messageId);
      }
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
      this.maintainTrackedDeliveries();
      this.publishCecrState();
    }, 2_000);
  }

  private startTrackingCleanupLoop(): void {
    if (this.trackingCleanupTimer) return;
    this.trackingCleanupTimer = setInterval(() => {
      this.maintainTrackedDeliveries();
      this.pruneTracking();
    }, 30_000);
  }

  /**
   * Broadcast an application payload using gossip-style re-propagation.
   */
  broadcast(
    data: unknown,
    metadata: Record<string, unknown> = {},
    options: GossipBroadcastOptions = {}
  ): string {
    const sender = this.mesh.getClientId();
    const connected = this.mesh.getConnectedPeers();
    const global = this.mesh.getGlobalPeers?.() ?? connected;
    const networkSize = Math.max(connected.length, global.length, 1);

    const messageId = this.generateMessageId(sender);
    let delivery: GossipDeliveryEnvelope | undefined;
    let deliveryPeers: string[] | null = null;
    if (options.trackDelivery && sender) {
      deliveryPeers = this.canonicalPeerSet();
      const senderIndex = deliveryPeers.indexOf(sender);
      const bits = this.createDeliveryBits(deliveryPeers.length);
      if (senderIndex >= 0) this.setDeliveryBit(bits, senderIndex);
      delivery = {
        setHash: this.canonicalSetHash(deliveryPeers),
        size: deliveryPeers.length,
        bits: this.deliveryBitsToHex(bits),
        deadlineAt: Date.now() + Math.max(2_000, options.deliveryTimeoutMs ?? this.deliveryTimeoutMs),
      };
    }

    const message: GossipMessage = {
      id: messageId,
      timestamp: Date.now(),
      hops: 0,
      // Ensure messages can cross long sparse paths (e.g. saturation/rebalance chains).
      maxHops: Math.max(this.maxHops, networkSize * 2),
      sender,
      data,
      metadata,
      type: 'gossip',
      ...(delivery ? { delivery } : {})
    };

    this.messageLog.set(message.id, {
      timestamp: message.timestamp,
      sender: message.sender,
      hops: 0
    });
    if (this.messageLog.size > this.maxTrackedMessages) {
      this.pruneTracking(message.timestamp);
    }

    if (delivery && deliveryPeers) {
      this.registerTrackedDelivery(message, deliveryPeers, true);
    }

    this.propagate(message);
    this.emit('messageReceived', { message, local: true });

    return message.id;
  }

  /**
   * Broadcast with delivery tracking enabled for the known-peer snapshot.
   */
  broadcastReliable(
    data: unknown,
    metadata: Record<string, unknown> = {},
    options: Omit<GossipBroadcastOptions, 'trackDelivery'> = {}
  ): string {
    return this.broadcast(data, metadata, { ...options, trackDelivery: true });
  }

  /**
   * Return the sender-visible delivery state for a tracked gossip message.
   */
  getDeliveryStatus(messageId: string): GossipDeliveryStatus | null {
    const state = this.deliveryStates.get(messageId);
    if (!state) return null;
    return this.deliveryStatusForState(state);
  }

  /**
   * Propagate a message to all currently-connected peers.
   */
  propagate(message: GossipMessage, exceptPeerId?: string): void {
    const connectedPeers = this.mesh.getConnectedPeers();
    const deliveryState = this.deliveryStates.get(message.id);

    for (const peerId of connectedPeers) {
      if (peerId === message.sender) continue;
      if (exceptPeerId && peerId === exceptPeerId) continue;

      const forwarded: GossipMessage = {
        ...message,
        hops: message.hops + 1,
        ...(deliveryState ? { delivery: this.deliveryEnvelopeForState(deliveryState) } : {})
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

    if (message.delivery) {
      // A duplicate still proves that this peer holds the message. Re-asserting
      // the local bit also repairs receipt loss without re-emitting the payload.
      this.registerTrackedDelivery(message, null, true);
    }

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

  // ─── Tracked delivery receipts ──────────────────────────────────────────

  private createDeliveryBits(size: number): Uint8Array {
    return new Uint8Array(Math.ceil(Math.max(0, size) / 8));
  }

  private setDeliveryBit(bits: Uint8Array, index: number): boolean {
    if (index < 0 || index >= bits.length * 8) return false;
    const byteIndex = Math.floor(index / 8);
    const mask = 1 << (index % 8);
    const before = bits[byteIndex];
    bits[byteIndex] |= mask;
    return bits[byteIndex] !== before;
  }

  private hasDeliveryBit(bits: Uint8Array, index: number): boolean {
    if (index < 0 || index >= bits.length * 8) return false;
    return (bits[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
  }

  private deliveryBitsToHex(bits: Uint8Array): string {
    return Array.from(bits, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  private deliveryBitsFromHex(hex: string, size: number): Uint8Array | null {
    const normalized = String(hex || '').trim().toLowerCase();
    const byteLength = Math.ceil(size / 8);
    if (!/^[0-9a-f]*$/.test(normalized) || normalized.length !== byteLength * 2) return null;
    const bits = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) {
      bits[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
    }
    return bits;
  }

  private mergeDeliveryBits(target: Uint8Array, incoming: Uint8Array): boolean {
    if (target.length !== incoming.length) return false;
    let changed = false;
    for (let index = 0; index < target.length; index += 1) {
      const merged = target[index] | incoming[index];
      if (merged !== target[index]) {
        target[index] = merged;
        changed = true;
      }
    }
    return changed;
  }

  private deliveryEnvelopeForState(state: GossipDeliveryState): GossipDeliveryEnvelope {
    return {
      setHash: state.setHash,
      size: state.size,
      bits: this.deliveryBitsToHex(state.bits),
      deadlineAt: state.deadlineAt,
    };
  }

  private deliveryReceiptForState(state: GossipDeliveryState): GossipDeliveryReceipt {
    return {
      messageId: state.messageId,
      sender: state.sender,
      ...this.deliveryEnvelopeForState(state),
    };
  }

  private validateDeliveryEnvelope(envelope: GossipDeliveryEnvelope): Uint8Array | null {
    if (!envelope || typeof envelope !== 'object') return null;
    if (typeof envelope.setHash !== 'string' || !/^[0-9a-f]{16}$/i.test(envelope.setHash)) return null;
    if (!Number.isInteger(envelope.size) || envelope.size < 1 || envelope.size > MAX_DELIVERY_PEERS) return null;
    if (!Number.isFinite(envelope.deadlineAt) || envelope.deadlineAt <= 0) return null;
    return this.deliveryBitsFromHex(envelope.bits, envelope.size);
  }

  private reconstructDeliveryPeers(state: GossipDeliveryState): string[] | null {
    const peers = this.canonicalPeerSet();
    if (peers.length !== state.size || this.canonicalSetHash(peers) !== state.setHash) return null;
    state.peerIds = peers;
    return peers;
  }

  private registerTrackedDelivery(
    message: GossipMessage,
    knownPeerIds: string[] | null,
    receivedLocally: boolean
  ): GossipDeliveryState | null {
    if (!message.delivery || !message.sender) return null;
    const incomingBits = this.validateDeliveryEnvelope(message.delivery);
    if (!incomingBits) return null;

    let state = this.deliveryStates.get(message.id);
    let changed = false;
    if (!state) {
      state = {
        messageId: message.id,
        sender: message.sender,
        setHash: message.delivery.setHash,
        size: message.delivery.size,
        bits: incomingBits,
        peerIds: knownPeerIds ? knownPeerIds.slice() : null,
        message: message,
        createdAt: message.timestamp,
        updatedAt: Date.now(),
        deadlineAt: message.delivery.deadlineAt,
        completedAt: null,
        timedOut: false,
        lastStatusSignature: '',
        repairAttemptsByPeer: new Map(),
      };
      this.deliveryStates.set(message.id, state);
      changed = true;
    } else {
      if (
        state.sender !== message.sender ||
        state.setHash !== message.delivery.setHash ||
        state.size !== message.delivery.size ||
        state.deadlineAt !== message.delivery.deadlineAt
      ) {
        return null;
      }
      changed = this.mergeDeliveryBits(state.bits, incomingBits);
      state.message = state.message ?? message;
      if (knownPeerIds) state.peerIds = knownPeerIds.slice();
    }

    const peers = state.peerIds ?? this.reconstructDeliveryPeers(state);
    if (receivedLocally && peers) {
      const self = this.mesh.getClientId();
      const selfIndex = self ? peers.indexOf(self) : -1;
      if (selfIndex >= 0 && this.setDeliveryBit(state.bits, selfIndex)) changed = true;
    }

    if (changed) {
      state.updatedAt = Date.now();
      this.dirtyDeliveryReceiptIds.add(state.messageId);
      this.emitDeliveryStatus(state);
    }
    return state;
  }

  private mergeDeliveryReceipt(receipt: GossipDeliveryReceipt): void {
    if (!receipt || typeof receipt.messageId !== 'string' || typeof receipt.sender !== 'string') return;
    const incomingBits = this.validateDeliveryEnvelope(receipt);
    if (!incomingBits) return;

    let state = this.deliveryStates.get(receipt.messageId);
    let changed = false;
    if (!state) {
      state = {
        messageId: receipt.messageId,
        sender: receipt.sender,
        setHash: receipt.setHash,
        size: receipt.size,
        bits: incomingBits,
        peerIds: null,
        message: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deadlineAt: receipt.deadlineAt,
        completedAt: null,
        timedOut: false,
        lastStatusSignature: '',
        repairAttemptsByPeer: new Map(),
      };
      this.deliveryStates.set(receipt.messageId, state);
      changed = true;
    } else {
      if (
        state.sender !== receipt.sender ||
        state.setHash !== receipt.setHash ||
        state.size !== receipt.size ||
        state.deadlineAt !== receipt.deadlineAt
      ) return;
      changed = this.mergeDeliveryBits(state.bits, incomingBits);
    }

    if (!state.peerIds) this.reconstructDeliveryPeers(state);
    if (changed) {
      state.updatedAt = Date.now();
      this.dirtyDeliveryReceiptIds.add(state.messageId);
      this.emitDeliveryStatus(state);
    }
  }

  private deliveryStatusForState(state: GossipDeliveryState): GossipDeliveryStatus {
    const peers = state.peerIds ?? this.reconstructDeliveryPeers(state) ?? [];
    const audiencePeerIds = peers.filter((peerId) => peerId !== state.sender);
    const deliveredPeerIds = audiencePeerIds.filter((peerId) => {
      const index = peers.indexOf(peerId);
      return index >= 0 && this.hasDeliveryBit(state.bits, index);
    });
    const deliveredSet = new Set(deliveredPeerIds);
    const pendingPeerIds = audiencePeerIds.filter((peerId) => !deliveredSet.has(peerId));
    return {
      messageId: state.messageId,
      sender: state.sender,
      membershipHash: state.setHash,
      audiencePeerIds,
      deliveredPeerIds,
      pendingPeerIds,
      audienceCount: audiencePeerIds.length,
      deliveredCount: deliveredPeerIds.length,
      complete: peers.length === state.size && pendingPeerIds.length === 0,
      timedOut: state.timedOut,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      deadlineAt: state.deadlineAt,
    };
  }

  private emitDeliveryStatus(state: GossipDeliveryState): void {
    if (state.sender !== this.mesh.getClientId()) return;
    const status = this.deliveryStatusForState(state);
    const signature = `${status.deliveredPeerIds.join('|')}::${status.pendingPeerIds.join('|')}::${status.timedOut}`;
    if (signature !== state.lastStatusSignature) {
      state.lastStatusSignature = signature;
      this.emit('deliveryProgress', status);
    }
    if (status.complete && state.completedAt == null) {
      state.completedAt = Date.now();
      this.emit('deliveryComplete', status);
    }
  }

  private selectRepairOwner(state: GossipDeliveryState, targetPeerId: string): string | null {
    const peers = state.peerIds ?? this.reconstructDeliveryPeers(state);
    if (!peers) return null;
    const delivered = peers.filter((_, index) => this.hasDeliveryBit(state.bits, index));
    let owner: string | null = null;
    let ownerScore: string | null = null;
    for (const candidate of delivered) {
      const score = this.canonicalSetHash([state.messageId, targetPeerId, candidate]);
      if (ownerScore == null || score < ownerScore) {
        owner = candidate;
        ownerScore = score;
      }
    }
    return owner;
  }

  private maintainTrackedDeliveries(now: number = Date.now()): void {
    const self = this.mesh.getClientId();
    if (!self) return;

    for (const state of this.deliveryStates.values()) {
      const peers = state.peerIds ?? this.reconstructDeliveryPeers(state);
      if (state.message && peers) {
        const selfIndex = peers.indexOf(self);
        if (selfIndex >= 0 && this.setDeliveryBit(state.bits, selfIndex)) {
          state.updatedAt = now;
          this.dirtyDeliveryReceiptIds.add(state.messageId);
          this.emitDeliveryStatus(state);
        }
      }

      const status = this.deliveryStatusForState(state);
      if (status.complete) continue;
      if (now >= state.deadlineAt) {
        if (!state.timedOut) {
          state.timedOut = true;
          state.updatedAt = now;
          this.emitDeliveryStatus(state);
          if (state.sender === self) this.emit('deliveryTimeout', this.deliveryStatusForState(state));
        }
        continue;
      }
      if (!state.message || !peers || now - state.createdAt < this.deliveryRepairDelayMs) continue;

      for (const targetPeerId of status.pendingPeerIds) {
        if (this.selectRepairOwner(state, targetPeerId) !== self) continue;
        const attempt = state.repairAttemptsByPeer.get(targetPeerId) ?? { attempts: 0, lastAttemptAt: 0 };
        if (attempt.attempts >= MAX_REPAIR_ATTEMPTS_PER_TARGET) continue;
        if (now - attempt.lastAttemptAt < this.deliveryRepairIntervalMs) continue;

        const repairMessage: GossipMessage = {
          ...state.message,
          delivery: this.deliveryEnvelopeForState(state),
        };
        const repairId = this.sendDirect(targetPeerId, {
          __peerPigeonType: RELIABLE_REPAIR_TYPE,
          message: repairMessage,
        });
        if (repairId) {
          state.repairAttemptsByPeer.set(targetPeerId, {
            attempts: attempt.attempts + 1,
            lastAttemptAt: now,
          });
        }
      }
    }
  }

  private reliableRepairMessage(data: unknown): GossipMessage | null {
    let candidate = data;
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    if (!candidate || typeof candidate !== 'object') return null;
    const value = candidate as Record<string, unknown>;
    if (value.__peerPigeonType !== RELIABLE_REPAIR_TYPE || !value.message || typeof value.message !== 'object') {
      return null;
    }
    const message = value.message as GossipMessage;
    if (message.type !== 'gossip' || typeof message.id !== 'string' || !message.delivery) return null;
    return message;
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

    const receiptIds = Array.from(this.dirtyDeliveryReceiptIds).slice(0, MAX_RECEIPT_DELTAS_PER_SYNC);
    // Normal delivery receipts ride the existing CECR frame. If coordinate
    // routing is unavailable (for example, non-hex peer IDs), send a control
    // frame only when a receipt is actually pending.
    if (!extrema && receiptIds.length === 0) return;
    const canonicalPeers = extrema ? null : this.canonicalPeerSet();

    const message: CecrStateMessage = {
      id: this.generateMessageId(self),
      type: 'cecr-state',
      from: self,
      timestamp: Date.now(),
      setHash: extrema?.setHash ?? this.canonicalSetHash(canonicalPeers ?? []),
      minHex: extrema?.min.toString(16) ?? '0',
      maxHex: extrema?.max.toString(16) ?? '0',
      size: extrema?.size ?? canonicalPeers?.length ?? 0,
    };

    if (receiptIds.length) {
      message.receipts = receiptIds
        .map((messageId) => this.deliveryStates.get(messageId))
        .filter((state): state is GossipDeliveryState => !!state)
        .map((state) => this.deliveryReceiptForState(state));
    }

    let sent = false;
    for (const peerId of this.mesh.getConnectedPeers()) {
      try {
        this.mesh.send(peerId, JSON.stringify(message));
        sent = true;
      } catch {
        // best-effort
      }
    }
    if (sent) {
      for (const messageId of receiptIds) this.dirtyDeliveryReceiptIds.delete(messageId);
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
      if (Array.isArray(message.receipts)) {
        for (const receipt of message.receipts.slice(0, MAX_RECEIPT_DELTAS_PER_SYNC)) {
          this.mergeDeliveryReceipt(receipt);
        }
      }
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
      const repairedMessage = this.reliableRepairMessage(message.data);
      if (repairedMessage) {
        this.handleIncomingMessage(repairedMessage, fromPeerId ?? message.from);
        return;
      }
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

    for (const [id, state] of this.deliveryStates.entries()) {
      const terminalAt = state.completedAt ?? (state.timedOut ? state.deadlineAt : null);
      const expired = terminalAt != null
        ? now - terminalAt > this.trackingRetentionMs
        : now - state.createdAt > this.trackingRetentionMs;
      if (!expired) continue;
      this.deliveryStates.delete(id);
      this.dirtyDeliveryReceiptIds.delete(id);
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
    this.deliveryStates.clear();
    this.dirtyDeliveryReceiptIds.clear();
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
