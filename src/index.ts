import FreeRTCClientAdapter from './freertc-client-adapter.js';
import { GossipProtocol } from './gossip.js';
import type {
  CecrConfigSnapshot,
  CecrStateSnapshot,
  DirectMessage,
  GossipBroadcastOptions,
  GossipDeliveryStatus,
  GossipMessage,
  GossipProtocolOptions,
} from './gossip.js';
import { PeerPigeonStorage } from './storage.js';
import type { StorageOptions } from './storage.js';
import { PeerPigeonCryptoProtocol } from './crypto.js';
import type {
  PeerPigeonCryptoOptions,
  PeerPigeonKeyPair,
  PeerPublicKey,
} from './crypto.js';

export interface PartialMeshConfig {
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

  // Intentionally minimal config surface.
  
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

  /** Lifetime of an alive CECR membership record. Default 30 seconds. */
  membershipLeaseMs?: number;

  /** Interval for renewing and disseminating membership records. Default 5 seconds. */
  membershipGossipIntervalMs?: number;

  /** Retention period for explicit-left tombstones. Default 2 minutes. */
  membershipTombstoneRetentionMs?: number;

  /** Maximum accepted clock skew for CECR membership timestamps. Default 5 seconds. */
  membershipClockSkewMs?: number;
}

export interface PeerConnection {
  id: string;
  connected: boolean;
  initiator: boolean;
}

export type PeerCapacityAdvertisement = {
  maxPeers: number;
  connectedPeers: number;
  updatedAt: number;
};

export type PeerCapacitySnapshot = PeerCapacityAdvertisement & {
  peerId: string;
  availableSlots: number;
  fresh: boolean;
  local: boolean;
};

type PeerTopologyAdvertisement = {
  connectedPeerIds: string[];
  updatedAt: number;
};

export type CecrMembershipRecordSnapshot = {
  peerId: string;
  incarnation: number;
  sequence: number;
  state: 'alive' | 'left';
  issuedAt: number;
  validUntil: number | null;
};

type CecrMembershipRecord = CecrMembershipRecordSnapshot;
type CecrWireMembershipRecord = [number, number, 'alive' | 'left', number, number | null];

export type PeerGraphNode = {
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

export type PeerGraphEdge = {
  source: string;
  target: string;
  direct: boolean;
  observedBy: string[];
  updatedAt: number;
};

export type PeerGraphSnapshot = {
  localPeerId: string | null;
  nodes: PeerGraphNode[];
  edges: PeerGraphEdge[];
  /** True once every known peer has supplied at least one adjacency snapshot. */
  complete: boolean;
  missingTopologyPeerIds: string[];
  generatedAt: number;
};

export type PartialMeshRuntimeConfig = Pick<Required<PartialMeshConfig>,
  | 'minPeers'
  | 'maxPeers'
  | 'tolerantPeers'
  | 'autoDiscover'
  | 'autoConnect'
  | 'connectionTimeoutMs'
  | 'maintenanceIntervalMs'
  | 'underConnectedResetMs'
  | 'nonInitiatorFallbackDialMs'
  | 'peerStateMaxAgeMs'
>;

export type PartialMeshEvents = {
  'signaling:connected': (data: { clientId: string; rawClientId?: string }) => void;
  'signaling:disconnected': () => void;
  'signaling:error': (error: any) => void;
  'signaling:log': (data: { message: string }) => void;
  'peer:connected': (peerId: string) => void;
  'peer:disconnected': (peerId: string) => void;
  'peer:data': (data: { peerId: string; data: any }) => void;
  'peer:error': (data: { peerId: string; error: any }) => void;
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
export class PartialMesh {
  private config: Required<PartialMeshConfig>;
  private peers: Map<string, PeerConnection> = new Map();
  private signalingClient: any = null;
  private discoveredPeers: Set<string> = new Set();
  private clientId: string | null = null;
  private selfAliases: Set<string> = new Set();
  private retiredPeerIds: Set<string> = new Set();
  private eventHandlers: Map<keyof PartialMeshEvents, Set<Function>> = new Map();
  private connecting: Set<string> = new Set();
  private connectionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private connectionStartedAtMs: Map<string, number> = new Map();
  /** First local observation of FreeRTC negotiations not tracked by PartialMesh. */
  private orphanRtcFirstSeenAtMs: Map<string, number> = new Map();
  private peerConnectedAtMs: Map<string, number> = new Map();
  private discoveredAtMs: Map<string, number> = new Map();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private membershipTimer: ReturnType<typeof setInterval> | null = null;
  private underConnectedSinceMs: number | null = null;
  private lastHardResetAtMs: number = 0;
  private lastDiscoveryRefreshAtMs: number = 0;
  private lastSignalingReconnectAtMs: number = 0;
  private dialFailureCount: Map<string, number> = new Map();
  private dialBackoffUntilMs: Map<string, number> = new Map();
  private nonInitiatorFallbackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private rebalanceCooldownUntilMs: number = 0;
  private rebalanceAttemptAtMs: Map<string, number> = new Map();
  private pendingRebalanceDropByTarget: Map<string, string> = new Map();
  /** Converged global peer membership — populated via in-band membership gossip. */
  private globalPeers: Set<string> = new Set();
  /** Versioned, expiring CECR membership records keyed by subject peer. */
  private membershipRecordsById: Map<string, CecrMembershipRecord> = new Map();
  private membershipEquivocationAtById: Map<string, number> = new Map();
  private membershipIncarnation: number = Date.now();
  private membershipSequence = 0;
  /** Relayed per-peer capacity used to give scarce, underfilled peers priority. */
  private peerCapacityById: Map<string, PeerCapacityAdvertisement> = new Map();
  /** Relayed adjacency snapshots used to reconstruct the known network graph. */
  private peerTopologyById: Map<string, PeerTopologyAdvertisement> = new Map();
  private localCapacityUpdatedAtMs: number = Date.now();
  private localTopologyUpdatedAtMs: number = Date.now();

  constructor(config: PartialMeshConfig = {}) {
    this.config = {
      minPeers: config.minPeers ?? 2,
      maxPeers: config.maxPeers ?? 10,
      tolerantPeers: config.tolerantPeers ?? Math.max(1, Math.min(2, Math.floor((config.maxPeers ?? 10) * 0.25))),
      signalingServer: config.signalingServer ?? 'wss://peer.ooo/ws',
      networkId: config.networkId ?? config.sessionId ?? 'peerpigeon',
      sessionId: config.sessionId ?? 'default-session',
      autoDiscover: config.autoDiscover ?? true,
      autoConnect: config.autoConnect ?? true,
      // Prefer FreeRTC's richer built-in ICE profile by default.
      iceServers: config.iceServers ?? null,
      // FreeRTC retries relayed offers for up to ~30s; keep this above that window
      // so we do not abort otherwise-recoverable negotiations.
      connectionTimeoutMs: config.connectionTimeoutMs ?? 45_000,
      maintenanceIntervalMs: config.maintenanceIntervalMs ?? 1_000,
      underConnectedResetMs: config.underConnectedResetMs ?? 0,
      nonInitiatorFallbackDialMs: config.nonInitiatorFallbackDialMs ?? 2_500,
      peerStateMaxAgeMs: config.peerStateMaxAgeMs ?? 60_000,
      trickleIce: config.trickleIce ?? true,
      membershipLeaseMs: config.membershipLeaseMs ?? 30_000,
      membershipGossipIntervalMs: config.membershipGossipIntervalMs ?? 5_000,
      membershipTombstoneRetentionMs: config.membershipTombstoneRetentionMs ?? 120_000,
      membershipClockSkewMs: config.membershipClockSkewMs ?? 5_000,
    };

    this.validatePeerLimits(this.config.minPeers, this.config.maxPeers, this.config.tolerantPeers);
    if (!Number.isSafeInteger(this.config.membershipLeaseMs) || this.config.membershipLeaseMs < 3_000) {
      throw new RangeError('membershipLeaseMs must be a safe integer of at least 3000');
    }
    if (
      !Number.isSafeInteger(this.config.membershipGossipIntervalMs) ||
      this.config.membershipGossipIntervalMs < 500 ||
      this.config.membershipGossipIntervalMs > Math.floor(this.config.membershipLeaseMs / 3)
    ) {
      throw new RangeError('membershipGossipIntervalMs must be at least 500 and no more than one third of membershipLeaseMs');
    }
    if (!Number.isSafeInteger(this.config.membershipClockSkewMs) || this.config.membershipClockSkewMs < 0) {
      throw new RangeError('membershipClockSkewMs must be a non-negative safe integer');
    }
    if (
      !Number.isSafeInteger(this.config.membershipTombstoneRetentionMs) ||
      this.config.membershipTombstoneRetentionMs <
        this.config.membershipLeaseMs + (2 * this.config.membershipClockSkewMs) + this.config.membershipGossipIntervalMs
    ) {
      throw new RangeError('membershipTombstoneRetentionMs must be at least lease + 2*clockSkew + gossipInterval');
    }

    // Initialize event handler maps
    const events: (keyof PartialMeshEvents)[] = [
      'signaling:connected',
      'signaling:disconnected',
      'signaling:error',
      'signaling:log',
      'peer:connected',
      'peer:disconnected',
      'peer:data',
      'peer:error',
      'peer:discovered',
      'mesh:ready',
      'mesh:membership',
      'mesh:capacity',
      'mesh:graph'
    ];
    events.forEach(event => this.eventHandlers.set(event, new Set()));
  }

  private validatePeerLimits(minPeers: number, maxPeers: number, tolerantPeers: number): void {
    if (!Number.isSafeInteger(minPeers) || minPeers < 0) {
      throw new RangeError('minPeers must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(maxPeers) || maxPeers < 1) {
      throw new RangeError('maxPeers must be a positive safe integer');
    }
    if (minPeers > maxPeers) {
      throw new RangeError('minPeers cannot exceed maxPeers');
    }
    if (!Number.isSafeInteger(tolerantPeers) || tolerantPeers < 0) {
      throw new RangeError('tolerantPeers must be a non-negative safe integer');
    }
  }

  private normalizePeerId(peerId: string | null | undefined): string {
    return (peerId ?? '').trim();
  }

  private normalizeSignalingUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const isLocalDevelopmentHost = hostname === 'localhost'
      || hostname === '::1'
      || hostname.endsWith('.local')
      || /^127\./.test(hostname)
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^169\.254\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = isLocalDevelopmentHost ? 'ws:' : 'wss:';
    if (url.protocol === 'ws:' && !isLocalDevelopmentHost) url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error(`Unsupported signaling protocol: ${url.protocol}`);
    }
    return url.toString();
  }

  private addSelfAlias(peerId: string | null | undefined): void {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.selfAliases.add(id);
    this.discoveredPeers.delete(id);
    this.globalPeers.delete(id);
    this.membershipRecordsById.delete(id);
    this.membershipEquivocationAtById.delete(id);
  }

  private isSelfAlias(peerId: string | null | undefined): boolean {
    const id = this.normalizePeerId(peerId);
    if (!id) return false;
    return this.selfAliases.has(id);
  }

  private addDiscoveredPeer(peerId: string): void {
    const id = this.normalizePeerId(peerId);
    if (!id || this.isSelfAlias(id) || this.retiredPeerIds.has(id)) return;
    if (this.discoveredPeers.has(id)) return;
    this.discoveredPeers.add(id);
    this.discoveredAtMs.set(id, Date.now());
    this.emit('peer:discovered', id);
    this.emit('mesh:graph', this.getGraphSnapshot());
  }

  private rotateBrowserPeerId(signalingUrl: string): { requestedPeerId: string; previousPeerId: string | null; retiredPeerIds: string[] } {
    const requestedPeerId = Array.from(
      (globalThis.window?.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, '0')
    ).join('');
    let previousPeerId: string | null = null;
    let retiredPeerIds: string[] = [];

    try {
      const storage = globalThis.window?.sessionStorage;
      if (storage) {
        const relayScope = new URL(signalingUrl).origin;
        const key = `peerpigeon:previous-peer-id:${relayScope}:${this.config.networkId}:${this.config.sessionId}`;
        const retiredKey = `${key}:retired`;
        previousPeerId = this.normalizePeerId(storage.getItem(key)) || null;
        try {
          const storedRetired = JSON.parse(storage.getItem(retiredKey) || '[]');
          if (Array.isArray(storedRetired)) {
            retiredPeerIds = storedRetired.map((peerId) => this.normalizePeerId(peerId)).filter(Boolean);
          }
        } catch {
          retiredPeerIds = [];
        }
        if (previousPeerId) retiredPeerIds.push(previousPeerId);
        retiredPeerIds = Array.from(new Set(retiredPeerIds)).filter((peerId) => peerId !== requestedPeerId).slice(-64);
        storage.setItem(key, requestedPeerId);
        storage.setItem(retiredKey, JSON.stringify(retiredPeerIds));
      }
    } catch {
      // sessionStorage can be unavailable in privacy-restricted contexts.
    }

    return { requestedPeerId, previousPeerId, retiredPeerIds };
  }

  private retirePeerId(peerId: string): boolean {
    const id = this.normalizePeerId(peerId);
    if (!id || id === this.clientId || this.retiredPeerIds.has(id)) return false;
    this.retiredPeerIds.add(id);
    this.selfAliases.add(id);
    const removedDiscovered = this.discoveredPeers.delete(id);
    const removedGlobal = this.globalPeers.delete(id);
    const removedMembership = this.membershipRecordsById.delete(id);
    this.membershipEquivocationAtById.delete(id);
    const removedCapacity = this.peerCapacityById.delete(id);
    const removedTopology = this.peerTopologyById.delete(id);
    const changed = removedDiscovered || removedGlobal || removedMembership || removedCapacity || removedTopology;
    this.discoveredAtMs.delete(id);
    this.dialFailureCount.delete(id);
    this.dialBackoffUntilMs.delete(id);
    if (this.peers.has(id) || this.connecting.has(id)) {
      this.removePeer(id, true);
    } else {
      try { this.signalingClient?.closeConnection?.(id); } catch { /* ignore */ }
    }
    return changed;
  }

  private reconcileSignalingPeers(rawPeerIds: string[]): void {
    const nextPeers = new Set(
      rawPeerIds
        .map((peerId) => this.normalizePeerId(peerId))
        .filter((peerId) => peerId && !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId))
    );

    for (const peerId of Array.from(this.discoveredPeers)) {
      if (!nextPeers.has(peerId)) {
        this.discoveredPeers.delete(peerId);
        this.discoveredAtMs.delete(peerId);
      }
    }
    for (const peerId of nextPeers) this.addDiscoveredPeer(peerId);
  }

  private getConnectedPeerCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.connected) count++;
    }
    return count;
  }

  private getPendingPeerCount(): number {
    const pending = new Set<string>(this.connecting);
    for (const peer of this.peers.values()) {
      if (!peer.connected) {
        pending.add(peer.id);
      }
    }
    return pending.size;
  }

  private noteLocalCapacityChanged(): void {
    const updatedAt = Date.now();
    this.localCapacityUpdatedAtMs = Math.max(updatedAt, this.localCapacityUpdatedAtMs + 1);
    this.localTopologyUpdatedAtMs = Math.max(updatedAt, this.localTopologyUpdatedAtMs + 1);
    this.emit('mesh:capacity', this.getPeerCapacities());
    this.emit('mesh:graph', this.getGraphSnapshot());
  }

  private freshPeerCapacity(peerId: string): PeerCapacityAdvertisement | null {
    const state = this.peerCapacityById.get(peerId);
    if (!state || Date.now() - state.updatedAt > this.config.peerStateMaxAgeMs) return null;
    return state;
  }

  /**
   * Known underfilled peers sort first, with lower-capacity peers ahead of
   * high-capacity peers. Unknown peers remain eligible; known-full peers sort last.
   */
  private compareCapacityPriority(a: string, b: string): number {
    const capacityA = this.freshPeerCapacity(a);
    const capacityB = this.freshPeerCapacity(b);
    const bucket = (capacity: PeerCapacityAdvertisement | null): number => {
      if (!capacity) return 1;
      return capacity.connectedPeers < capacity.maxPeers ? 0 : 2;
    };
    const bucketA = bucket(capacityA);
    const bucketB = bucket(capacityB);
    if (bucketA !== bucketB) return bucketA - bucketB;
    if (bucketA === 0 && capacityA && capacityB) {
      if (capacityA.maxPeers !== capacityB.maxPeers) return capacityA.maxPeers - capacityB.maxPeers;
      const remainingA = capacityA.maxPeers - capacityA.connectedPeers;
      const remainingB = capacityB.maxPeers - capacityB.connectedPeers;
      if (remainingA !== remainingB) return remainingA - remainingB;
    }
    return 0;
  }

  private compareDialCandidates(a: string, b: string): number {
    const cecrOrder = this.cecrOverlayDialPriority(a) - this.cecrOverlayDialPriority(b);
    if (cecrOrder !== 0) return cecrOrder;
    const capacityOrder = this.compareCapacityPriority(a, b);
    if (capacityOrder !== 0) return capacityOrder;
    const failA = this.dialFailureCount.get(a) ?? 0;
    const failB = this.dialFailureCount.get(b) ?? 0;
    if (failA !== failB) return failA - failB;
    const discoveredA = this.discoveredAtMs.get(a) ?? 0;
    const discoveredB = this.discoveredAtMs.get(b) ?? 0;
    if (discoveredA !== discoveredB) return discoveredA - discoveredB;
    const self = this.normalizePeerId(this.clientId);
    const scoreA = this.fastIdHash(`${self}:${a}`);
    const scoreB = this.fastIdHash(`${self}:${b}`);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.localeCompare(b);
  }

  private trimExcessPeers(): void {
    const connectedPeers = this.getConnectedPeers();
    // maxPeers is the steady-state target. tolerantPeers must never increase
    // the displayed/retained degree; it is only transient admission headroom.
    const overflow = connectedPeers.length - this.config.maxPeers;
    if (overflow <= 0) return;

    // Pause proactive expansion briefly so we do not oscillate around maxPeers.
    this.rebalanceCooldownUntilMs = Math.max(this.rebalanceCooldownUntilMs, Date.now() + 2_000);

    // Drop newest connections first to keep longer-lived links stable.
    const protectedPeerIds = this.cecrProtectedConnectedPeerIds();
    const dropOrder = connectedPeers
      .map((peerId) => ({
        peerId,
        connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0,
        cecrProtected: protectedPeerIds.has(peerId),
      }))
      .sort((a, b) => {
        if (a.cecrProtected !== b.cecrProtected) return a.cecrProtected ? 1 : -1;
        if (a.connectedAt !== b.connectedAt) return b.connectedAt - a.connectedAt;
        return a.peerId.localeCompare(b.peerId);
      });

    for (let i = 0; i < overflow; i++) {
      const target = dropOrder[i];
      if (!target) break;
      this.noteIntentionalShed(target.peerId);
      this.disconnectFromPeer(target.peerId);
    }
  }

  private getOldestPendingAgeMs(): number {
    const now = Date.now();
    let oldest = 0;

    for (const peerId of this.connecting) {
      const startedAt = this.connectionStartedAtMs.get(peerId) ?? now;
      const age = Math.max(0, now - startedAt);
      if (age > oldest) oldest = age;
    }

    for (const peer of this.peers.values()) {
      if (peer.connected) continue;
      const startedAt = this.connectionStartedAtMs.get(peer.id) ?? now;
      const age = Math.max(0, now - startedAt);
      if (age > oldest) oldest = age;
    }

    return oldest;
  }

  private isHexId(value: string): boolean {
    return /^[0-9a-f]+$/i.test(value);
  }

  private fastIdHash(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private peerDistance(a: string, b: string): bigint {
    const left = this.normalizePeerId(a).toLowerCase();
    const right = this.normalizePeerId(b).toLowerCase();
    if (left && right && this.isHexId(left) && this.isHexId(right)) {
      try {
        return BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
      } catch {
        // Fall through to hash-based distance.
      }
    }

    const leftHash = this.fastIdHash(left);
    const rightHash = this.fastIdHash(right);
    return BigInt((leftHash ^ rightHash) >>> 0);
  }

  private cecrNumericPeerId(peerId: string): bigint | null {
    const hex = this.normalizePeerId(peerId).replace(/-/g, '').toLowerCase();
    if (hex.length !== 64 || !this.isHexId(hex)) return null;
    try { return BigInt(`0x${hex}`); } catch { return null; }
  }

  private cecrBucketRank(distance: bigint): number {
    return distance === 0n ? -1 : distance.toString(2).length - 1;
  }

  private cecrCoordinateNeighbors(): Set<string> {
    const selfId = this.normalizePeerId(this.clientId);
    const liveIds = Array.from(new Set([selfId, ...this.globalPeers])).filter(Boolean);
    const numeric = liveIds
      .map((peerId) => ({ peerId, value: this.cecrNumericPeerId(peerId) }))
      .filter((peer): peer is { peerId: string; value: bigint } => peer.value != null)
      .sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : left.peerId.localeCompare(right.peerId));
    const selfIndex = numeric.findIndex((peer) => peer.peerId === selfId);
    const required = new Set<string>();
    if (selfIndex > 0) required.add(numeric[selfIndex - 1].peerId);
    if (selfIndex >= 0 && selfIndex + 1 < numeric.length) required.add(numeric[selfIndex + 1].peerId);
    return required;
  }

  private cecrOverlayDialPriority(peerId: string): number {
    const selfId = this.normalizePeerId(this.clientId);
    const self = this.cecrNumericPeerId(selfId);
    const candidate = this.cecrNumericPeerId(peerId);
    if (self == null || candidate == null || !this.globalPeers.has(peerId)) return 1;
    if (this.cecrCoordinateNeighbors().has(peerId)) return 0;
    const candidateRank = this.cecrBucketRank(self ^ candidate);
    const bucketCovered = this.getConnectedPeers().some((connectedPeerId) => {
      const connected = this.cecrNumericPeerId(connectedPeerId);
      return connected != null && this.cecrBucketRank(self ^ connected) === candidateRank;
    });
    return bucketCovered ? 1 : 0;
  }

  private cecrProtectedConnectedPeerIds(): Set<string> {
    const protectedIds = this.cecrCoordinateNeighbors();
    const self = this.cecrNumericPeerId(this.clientId ?? '');
    if (self == null) return protectedIds;
    const representativeByBucket = new Map<number, string>();
    for (const peerId of this.getConnectedPeers().slice().sort()) {
      const peer = this.cecrNumericPeerId(peerId);
      if (peer == null) continue;
      const rank = this.cecrBucketRank(self ^ peer);
      if (!representativeByBucket.has(rank)) representativeByBucket.set(rank, peerId);
    }
    for (const peerId of representativeByBucket.values()) protectedIds.add(peerId);
    return protectedIds;
  }

  private maybeRebalanceForCloserPeer(candidates: string[]): boolean {
    const selfId = this.normalizePeerId(this.clientId);
    if (!selfId || this.config.tolerantPeers <= 0) return false;

    const now = Date.now();
    if (now < this.rebalanceCooldownUntilMs) {
      return false;
    }

    const connectedPeers = this.getConnectedPeers();
    if (connectedPeers.length < this.config.maxPeers || connectedPeers.length === 0 || candidates.length === 0) {
      return false;
    }

    // Only rebalance from healthy surplus; avoid destabilizing minimally connected nodes.
    if (connectedPeers.length <= this.config.minPeers) {
      return false;
    }

    const reservedDropPeerIds = new Set(this.pendingRebalanceDropByTarget.values());
    const cecrProtectedPeerIds = this.cecrProtectedConnectedPeerIds();
    const connectedByDistance = connectedPeers
      .filter((peerId) => !reservedDropPeerIds.has(peerId))
      .map((peerId) => ({
        peerId,
        distance: this.peerDistance(selfId, peerId),
        connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0,
        cecrProtected: cecrProtectedPeerIds.has(peerId),
      }))
      .sort((a, b) => {
        if (a.cecrProtected !== b.cecrProtected) return a.cecrProtected ? -1 : 1;
        return a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId);
      });

    const candidateByDistance = candidates
      .map((peerId) => ({
        peerId,
        distance: this.peerDistance(selfId, peerId),
        discoveredAt: this.discoveredAtMs.get(peerId) ?? 0,
        lastAttemptAt: this.rebalanceAttemptAtMs.get(peerId) ?? 0
      }))
      .sort((a, b) => {
        const cecrOrder = this.cecrOverlayDialPriority(a.peerId) - this.cecrOverlayDialPriority(b.peerId);
        if (cecrOrder !== 0) return cecrOrder;
        const capacityOrder = this.compareCapacityPriority(a.peerId, b.peerId);
        if (capacityOrder !== 0) return capacityOrder;
        return a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId);
      });

    const farthestConnected = connectedByDistance[connectedByDistance.length - 1];
    const closestCandidate = candidateByDistance.find((candidate) => {
      const discoveredAgeMs = now - candidate.discoveredAt;
      const sinceAttemptMs = now - candidate.lastAttemptAt;
      return discoveredAgeMs >= 1_000 && sinceAttemptMs >= 5_000;
    });

    // Rebalance only when the newcomer is genuinely closer than our weakest edge.
    if (!closestCandidate || !farthestConnected) {
      return false;
    }

    // Keep existing edges sticky for a short period to prevent oscillation.
    const connectedAgeMs = now - (farthestConnected.connectedAt || 0);
    if (connectedAgeMs < 4_000) {
      return false;
    }

    // Prefer genuinely closer candidates, but do not exclude late joiners forever
    // when random peer IDs produce a stable yet closed cluster.
    const candidateDiscoveredAgeMs = now - closestCandidate.discoveredAt;
    const repairsCecrOverlay = this.cecrOverlayDialPriority(closestCandidate.peerId) === 0;
    const materiallyCloser = repairsCecrOverlay || closestCandidate.distance * 4n < farthestConnected.distance * 3n;
    const staleExcludedCandidate = candidateDiscoveredAgeMs >= 3_000;
    if (!materiallyCloser && !staleExcludedCandidate) {
      return false;
    }

    // Critical safety check: never rebalance if it would leave a peer isolated.
    // The peer we're dropping should either have other connections we're aware of,
    // or be part of a mesh large enough that they can't become isolated.
    // Conservative: only rebalance when at least 2+ peers beyond what we're touching
    // are in the discovered set, ensuring the dropped peer has alternatives.
    const otherDiscoveredPeers = Array.from(this.discoveredPeers)
      .filter((p) => {
        const id = this.normalizePeerId(p);
        return id && id !== selfId && id !== farthestConnected.peerId && id !== closestCandidate.peerId;
      }).length;

    if (otherDiscoveredPeers < 1) {
      return false;
    }

    this.rebalanceCooldownUntilMs = now + 4_000;
    this.rebalanceAttemptAtMs.set(closestCandidate.peerId, now);
    this.rebalanceAttemptAtMs.set(farthestConnected.peerId, now);
    this.pendingRebalanceDropByTarget.set(closestCandidate.peerId, farthestConnected.peerId);
    this.emit('signaling:log', {
      message: `[rebalance] dial priority ${closestCandidate.peerId.slice(0, 8)} then drop ${farthestConnected.peerId.slice(0, 8)}`
    });

    this.connectToPeerInternal(closestCandidate.peerId, true);
    if (!this.peers.has(closestCandidate.peerId) && !this.connecting.has(closestCandidate.peerId)) {
      this.pendingRebalanceDropByTarget.delete(closestCandidate.peerId);
      return false;
    }
    return true;
  }

  /**
   * Initialize and connect to the signaling server
   */
  async init(): Promise<void> {
    // Let FreeRTC client manage query params such as networkId.
    const signalingUrl = this.normalizeSignalingUrl(this.config.signalingServer);

    const { requestedPeerId, previousPeerId, retiredPeerIds } = this.rotateBrowserPeerId(signalingUrl);
    this.addSelfAlias(requestedPeerId);
    for (const peerId of retiredPeerIds) {
      this.retiredPeerIds.add(peerId);
      this.addSelfAlias(peerId);
    }

    this.signalingClient = new FreeRTCClientAdapter(signalingUrl, {
      networkId: this.config.networkId,
      roomId: this.config.sessionId,
      peerId: requestedPeerId,
      previousPeerId,
      retiredPeerIds,
      iceServers: this.config.iceServers,
      trickleIce: this.config.trickleIce
    });

    // Set up signaling event handlers
    this.signalingClient.on('connected', (data: { clientId: string; requestedClientId?: string; previousClientId?: string }) => {
      const rawClientId = data?.clientId;
      const nextClientId = this.normalizePeerId(rawClientId);
      this.clientId = nextClientId;
      this.lastSignalingReconnectAtMs = Date.now();
      this.addSelfAlias(nextClientId);
      this.addSelfAlias(data?.requestedClientId);
      this.addSelfAlias(data?.previousClientId);
      this.renewLocalMembership(true);
      this.startMembershipLoop();
      this.emit('signaling:connected', { clientId: this.clientId, rawClientId });
      
      if (this.config.autoDiscover) {
        this.signalingClient.joinSession(this.config.sessionId);
      }

      if (this.config.autoConnect) {
        this.startMaintenanceLoop();
      }
    });

    this.signalingClient.on('disconnected', () => {
      this.emit('signaling:disconnected');
    });

    this.signalingClient.on('lifecycle:resume', (data: { reason?: string }) => {
      this.recoverMeshAfterInactivity(String(data?.reason || 'resume'));
    });

    this.signalingClient.on('joined', (data: { sessionId: string; clients: string[] }) => {
      // Add existing peers to discovered list
      data.clients.forEach((rawPeerId: string) => {
        const peerId = this.normalizePeerId(rawPeerId);
        this.addDiscoveredPeer(peerId);
      });

      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    });

    this.signalingClient.on('peer-joined', (data: { peerId: string }) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (peerId) {
        this.addDiscoveredPeer(peerId);
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });

    this.signalingClient.on('peer-left', (data: { peerId: string }) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId) return;
      this.removeFromGlobalMembership(peerId);
      this.discoveredPeers.delete(peerId);
      this.dialFailureCount.delete(peerId);
      this.dialBackoffUntilMs.delete(peerId);
      this.removePeer(peerId, true);
    });

    this.signalingClient.on('peers-updated', (data: { peers: string[] }) => {
      this.reconcileSignalingPeers(Array.isArray(data?.peers) ? data.peers : []);
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    });

    this.signalingClient.on('rtc:connected', (data: { peerId: string }) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) {
        try { this.signalingClient?.closeConnection?.(peerId); } catch { /* ignore */ }
        return;
      }
      this.orphanRtcFirstSeenAtMs.delete(peerId);
      let peerConnection = this.peers.get(peerId);
      if (!peerConnection) {
        // Inbound connection — FreeRTC accepted and fully established without us initiating.
        peerConnection = { id: peerId, connected: false, initiator: false };
        this.peers.set(peerId, peerConnection);
      }
      if (peerConnection.connected) return; // guard against duplicate events
      const t = this.connectionTimers.get(peerId);
      if (t) {
        clearTimeout(t);
        this.connectionTimers.delete(peerId);
      }
      this.connectionStartedAtMs.delete(peerId);
      peerConnection.connected = true;
      this.peerConnectedAtMs.set(peerId, Date.now());
      this.connecting.delete(peerId);
      this.noteDialSuccess(peerId);
      this.noteLocalCapacityChanged();
      const fallbackTimer = this.nonInitiatorFallbackTimers.get(peerId);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        this.nonInitiatorFallbackTimers.delete(peerId);
      }
      this.emit('peer:connected', peerId);

      const rebalanceDropPeerId = this.pendingRebalanceDropByTarget.get(peerId);
      if (rebalanceDropPeerId) {
        this.pendingRebalanceDropByTarget.delete(peerId);
        if (rebalanceDropPeerId !== peerId && this.peers.get(rebalanceDropPeerId)?.connected) {
          if (this.getConnectedPeerCount() > this.config.maxPeers) {
            this.disconnectFromPeer(rebalanceDropPeerId);
          }
        }
      }

      // Inbound accepts can temporarily exceed maxPeers; trim immediately.
      this.trimExcessPeers();

      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }

      if (this.getConnectedPeers().length >= this.config.minPeers) {
        this.emit('mesh:ready');
      }

      // Announce the new local degree to every neighbor so scarce-slot
      // prioritization converges across the network.
      this.broadcastMembership();
    });

    this.signalingClient.on('rtc:disconnected', (data: { peerId: string }) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId || this.isSelfAlias(peerId)) return;

      if (this.pendingRebalanceDropByTarget.has(peerId)) {
        this.pendingRebalanceDropByTarget.delete(peerId);
      }
      for (const [targetPeerId, dropPeerId] of Array.from(this.pendingRebalanceDropByTarget.entries())) {
        if (dropPeerId === peerId) {
          this.pendingRebalanceDropByTarget.delete(targetPeerId);
        }
      }

      // FreeRTC already closed the connection; clean up tracking state only.
      const peerConnection = this.peers.get(peerId);
      if (peerConnection) {
        const t = this.connectionTimers.get(peerId);
        if (t) {
          clearTimeout(t);
          this.connectionTimers.delete(peerId);
        }
        this.connectionStartedAtMs.delete(peerId);
        const wasConnected = peerConnection.connected;
        this.peers.delete(peerId);
        this.peerConnectedAtMs.delete(peerId);
        this.connecting.delete(peerId);
        if (wasConnected) {
          this.noteLocalCapacityChanged();
          this.emit('peer:disconnected', peerId);
          this.broadcastMembership();
        }
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });

    this.signalingClient.on('rtc:data', (data: { peerId: string; data: any }) => {
      const msg = this.tryParseMembership(data.data);
      if (msg) {
        this.mergeMembership(msg.peers, msg.retiredPeers, msg.capacities, msg.topology, data.peerId, msg.records);
      } else {
        this.emit('peer:data', data);
      }
    });

    this.signalingClient.on('error', (error: any) => {
      this.emit('signaling:error', error);
    });

    this.signalingClient.on('signaling:log', (data: { message: string }) => {
      this.emit('signaling:log', data);
    });

    // Connect to the signaling server
    this.signalingClient.connect();
  }

  private startMaintenanceLoop(): void {
    if (this.maintenanceTimer) return;
    if (!this.config.maintenanceIntervalMs || this.config.maintenanceIntervalMs <= 0) return;

    this.maintenanceTimer = setInterval(() => {
      try {
        this.maybeRefreshDiscovery();
        this.recoverStaleConnectedPeers('maintenance');
        this.maybeRecoverStalledNegotiations();
        this.maintainPeerConnections();
        this.maybeHardResetUnderConnected();
      } catch {
        // ignore
      }
    }, this.config.maintenanceIntervalMs);
  }

  private startMembershipLoop(): void {
    if (this.membershipTimer) return;
    this.membershipTimer = setInterval(() => {
      try {
        this.renewLocalMembership(true);
        this.pruneMembershipRecords();
        this.broadcastMembership();
      } catch {
        // best-effort membership maintenance
      }
    }, this.config.membershipGossipIntervalMs);
  }

  private maybeRefreshDiscovery(): void {
    if (!this.config.autoDiscover) return;

    const connected = this.getConnectedPeers().length;
    const now = Date.now();
    const underConnected = connected < this.config.minPeers;
    const hasFewCandidates = this.discoveredPeers.size < this.config.minPeers;
    const saturatedWithoutSpareCandidates = connected >= this.config.maxPeers && this.discoveredPeers.size <= connected;

    if (!underConnected && !hasFewCandidates && !saturatedWithoutSpareCandidates) return;
    if (now - this.lastDiscoveryRefreshAtMs < 2_000) return;

    this.lastDiscoveryRefreshAtMs = now;
    try {
      this.signalingClient?.joinSession(this.config.sessionId);
    } catch {
      // ignore
    }

    // Do not force signaling reconnects here.
    // Reconnect churn can reset discovery repeatedly and prevent peer convergence.
  }

  /**
   * Revalidate transports after browser suspension, network changes, or focus
   * restoration. Browsers do not always deliver every lifecycle event, so the
   * maintenance loop also calls the same stale-channel check.
   */
  public recoverAfterInactivity(reason: string = 'resume'): void {
    let adapterTriggeredMeshRecovery = false;
    try {
      adapterTriggeredMeshRecovery = this.signalingClient?.recoverAfterInactivity?.(reason) === true;
    } catch {
      // Continue with local transport validation even if signaling recovery fails.
    }

    if (!adapterTriggeredMeshRecovery) {
      this.recoverMeshAfterInactivity(reason);
    }
  }

  private recoverMeshAfterInactivity(reason: string): void {
    this.recoverStaleConnectedPeers(reason);
    this.recoverOrphanedRtcNegotiations();
    this.lastDiscoveryRefreshAtMs = 0;
    this.underConnectedSinceMs = null;

    try {
      this.maybeRefreshDiscovery();
      if (!this.config.autoConnect) return;

      const isolated = this.getConnectedPeerCount() === 0;
      const candidates = this.dialCandidatePeerIds(true);
      if (isolated && candidates.length > 0) {
        // Resume is authoritative evidence that timer/ICE state may have been
        // frozen. Do not let old attempts or exponential backoff strand the
        // peer: close every non-live transport and redial immediately.
        this.dialBackoffUntilMs.clear();
        this.hardReset(`${reason}-isolated`);
        return;
      }

      this.maintainPeerConnections();
    } catch {
      // The regular maintenance loop will retry.
    }
  }

  private recoverStaleConnectedPeers(reason: string): void {
    for (const peer of Array.from(this.peers.values())) {
      if (!peer.connected) continue;

      const rtcEntry = (this.signalingClient as any)?.client?.mesh?.connections?.get?.(peer.id);
      const connectionState = String(rtcEntry?.connection?.connectionState ?? rtcEntry?.state ?? '').toLowerCase();
      const channelState = String(rtcEntry?.channel?.readyState ?? '').toLowerCase();
      const transportIsDead = connectionState === 'failed'
        || connectionState === 'closed'
        || connectionState === 'dead';
      const channelIsGone = !rtcEntry || !rtcEntry.channel || channelState === 'closing' || channelState === 'closed';

      if (!transportIsDead && !channelIsGone) continue;

      this.emit('signaling:log', {
        message: `[webrtc] ${reason} recovery: removing stale connection to ${peer.id}`
      });
      this.removePeer(peer.id, false);
    }
  }

  /**
   * FreeRTC can retain a half-open connection that never became a PartialMesh
   * peer. Without local peer/pending state, the normal negotiation watchdog
   * cannot see it, while connectToPeerInternal treats it as active forever.
   */
  private recoverOrphanedRtcNegotiations(now: number = Date.now()): void {
    const connections = (this.signalingClient as any)?.client?.mesh?.connections;
    if (!connections || typeof connections.entries !== 'function') return;

    const isolated = this.getConnectedPeerCount() === 0;
    const staleAfterMs = isolated
      ? Math.max(3_500, Math.min(this.config.connectionTimeoutMs, 8_000))
      : Math.max(8_000, Math.min(this.config.connectionTimeoutMs, 15_000));

    for (const [rawPeerId, entry] of Array.from(connections.entries()) as Array<[string, any]>) {
      const peerId = this.normalizePeerId(rawPeerId);
      if (!peerId) continue;
      if (this.peers.has(peerId) || this.connecting.has(peerId)) {
        this.orphanRtcFirstSeenAtMs.delete(peerId);
        continue;
      }

      const connectionState = String(entry?.connection?.connectionState ?? entry?.state ?? '').toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? '').toLowerCase();
      // A connected RTCPeerConnection without an open data channel is not a
      // usable mesh edge and must remain subject to the orphan timeout.
      if (channelState === 'open') {
        this.orphanRtcFirstSeenAtMs.delete(peerId);
        continue;
      }

      const lastSeen = Number(entry?.lastSeen);
      const initialObservation = Number.isFinite(lastSeen) && lastSeen > 0
        ? Math.min(now, lastSeen)
        : now;
      const firstSeenAt = this.orphanRtcFirstSeenAtMs.get(peerId) ?? initialObservation;
      this.orphanRtcFirstSeenAtMs.set(peerId, firstSeenAt);
      // FreeRTC refreshes lastSeen for every repeated offer/ICE packet. That is
      // signaling activity, not proof that the data channel is progressing.
      // Age the orphan from our first observation so relayed retries cannot
      // keep a permanently non-open negotiation alive forever.
      const orphanAgeMs = Math.max(0, now - firstSeenAt);
      const definitelyDead = connectionState === 'failed'
        || connectionState === 'closed'
        || connectionState === 'dead';
      if (!definitelyDead && orphanAgeMs < staleAfterMs) continue;

      this.orphanRtcFirstSeenAtMs.delete(peerId);
      this.noteDialFailure(peerId);
      this.emit('peer:error', {
        peerId,
        error: new Error(`Untracked negotiation stalled (${connectionState || 'unknown'}/${channelState || 'closed'})`),
      });
      this.emit('signaling:log', {
        message: `[webrtc] purging stale untracked negotiation to ${peerId}; retrying`,
      });
      try {
        this.signalingClient?.closeConnection?.(peerId);
      } catch {
        try { connections.delete?.(peerId); } catch { /* best-effort */ }
      }
    }

    for (const peerId of Array.from(this.orphanRtcFirstSeenAtMs.keys())) {
      if (!connections.has?.(peerId)) this.orphanRtcFirstSeenAtMs.delete(peerId);
    }
  }

  private maybeRecoverStalledNegotiations(): void {
    const now = Date.now();
    const connectedCount = this.getConnectedPeerCount();
    const isolated = connectedCount === 0 && this.dialCandidatePeerIds(true).length > 0;
    const baseStallMs = Math.max(10_000, Math.min(this.config.connectionTimeoutMs, 15_000));
    const stallMs = isolated ? Math.max(8_000, Math.min(this.config.connectionTimeoutMs, 12_000)) : baseStallMs;

    for (const peer of this.peers.values()) {
      if (peer.connected) continue;

      const startedAt = this.connectionStartedAtMs.get(peer.id) ?? now;
      const ageMs = Math.max(0, now - startedAt);
      if (ageMs < stallMs) continue;

      const rtcEntry = (this.signalingClient as any)?.client?.mesh?.connections?.get?.(peer.id);
      const pc = rtcEntry?.connection;
      const signalingState = pc?.signalingState ?? 'unknown';
      const connectionState = pc?.connectionState ?? rtcEntry?.state ?? 'unknown';
      const dataState = rtcEntry?.channel?.readyState ?? 'closed';

      const stalledOffer = signalingState === 'have-local-offer' && dataState !== 'open';
      const deadTransport = connectionState === 'failed' || connectionState === 'closed' || rtcEntry?.state === 'dead';
      const noRtcProgress = !rtcEntry && this.connecting.has(peer.id);
      const answeredButNoChannel = signalingState === 'stable' && dataState !== 'open' && connectionState !== 'connected';
      const repeatedlyFailing = (this.dialFailureCount.get(peer.id) ?? 0) >= 2;

      if (!stalledOffer && !deadTransport && !noRtcProgress && !answeredButNoChannel) {
        continue;
      }

      this.noteDialFailure(peer.id);
      this.emit('peer:error', {
        peerId: peer.id,
        error: new Error(`Negotiation stalled (${signalingState}/${connectionState}/${dataState})`)
      });
      this.removePeer(peer.id);

      if (isolated) {
        // Isolation recovery prefers immediate retries over passive backoff timers.
        this.clearDialBackoff(peer.id);

        if (this.discoveredPeers.has(peer.id)) {
          this.connectToPeerInternal(peer.id, true);
        }

        if (answeredButNoChannel || repeatedlyFailing) {
          this.maybeHardResetUnderConnected();
        }
      }
      return;
    }
  }

  private maybeHardResetUnderConnected(): void {
    const signalingConnected = this.signalingClient?.isConnected?.() ?? true;
    if (!signalingConnected) {
      this.underConnectedSinceMs = null;
      return;
    }

    const thresholdMs = this.config.underConnectedResetMs;
    if (!thresholdMs || thresholdMs <= 0) return;

    const connected = this.getConnectedPeers().length;
    const pending = this.getPendingPeerCount();
    const oldestPendingAge = this.getOldestPendingAgeMs();
    const candidatePeerIds = this.dialCandidatePeerIds(connected === 0);
    const hasEnoughCandidates = candidatePeerIds.length >= this.config.minPeers;
    const hasAnyCandidate = candidatePeerIds.length > 0;
    const underConnected = connected < this.config.minPeers && hasEnoughCandidates;
    const isolated = connected === 0 && hasAnyCandidate;
    const isolatedThresholdMs = Math.max(3_500, Math.min(thresholdMs, 8_000));
    const hasStalePending = pending > 0 && oldestPendingAge >= isolatedThresholdMs;
    const hasRepeatedFailures = candidatePeerIds
      .some((peerId) => (this.dialFailureCount.get(peerId) ?? 0) >= 3);

    const now = Date.now();

    if (!underConnected && !isolated) {
      this.underConnectedSinceMs = null;
      return;
    }

    if (isolated && (hasStalePending || hasRepeatedFailures)) {
      if (now - this.lastHardResetAtMs < isolatedThresholdMs) {
        return;
      }
      this.hardReset('isolated-stalled');
      return;
    }

    // Do not hard-reset while fresh negotiations are in progress.
    // But if pending attempts are stale beyond threshold, allow reset to break
    // out of stuck have-local-offer loops.
    if (pending > 0) {
      if (oldestPendingAge < thresholdMs) {
        this.underConnectedSinceMs = null;
        return;
      }
    }

    if (this.underConnectedSinceMs == null) {
      this.underConnectedSinceMs = now;
      return;
    }

    // Avoid repeated rapid resets if the environment is genuinely unable to connect.
    if (now - this.underConnectedSinceMs < thresholdMs) return;
    if (now - this.lastHardResetAtMs < thresholdMs) return;

    this.hardReset('under-connected');
  }

  private isPeerBackedOff(peerId: string): boolean {
    const until = this.dialBackoffUntilMs.get(peerId) ?? 0;
    return until > Date.now();
  }

  private noteDialFailure(peerId: string): void {
    const failures = (this.dialFailureCount.get(peerId) ?? 0) + 1;
    this.dialFailureCount.set(peerId, failures);
    const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, Math.min(failures, 5)));
    this.dialBackoffUntilMs.set(peerId, Date.now() + backoffMs);
  }

  private noteDialSuccess(peerId: string): void {
    this.dialFailureCount.delete(peerId);
    this.dialBackoffUntilMs.delete(peerId);
  }

  private noteIntentionalShed(peerId: string): void {
    // Avoid immediate reconnect loops for peers intentionally dropped due to saturation.
    this.dialBackoffUntilMs.set(peerId, Date.now() + 5_000);
  }

  private clearDialBackoff(peerId: string): void {
    this.dialBackoffUntilMs.delete(peerId);
  }

  /**
   * Hard reset peer connections (keeps signaling + discovered peers).
   * Useful for recovering from rare stuck negotiation/ICE states.
   */
  public hardReset(reason: string = 'manual'): void {
    this.lastHardResetAtMs = Date.now();
    this.underConnectedSinceMs = null;

    for (const t of this.connectionTimers.values()) {
      clearTimeout(t);
    }
    this.connectionTimers.clear();
    this.connectionStartedAtMs.clear();
    this.peerConnectedAtMs.clear();
    this.pendingRebalanceDropByTarget.clear();

    const rtcConnections = (this.signalingClient as any)?.client?.mesh?.connections;
    const resetPeerIds = new Set<string>(this.peers.keys());
    if (rtcConnections && typeof rtcConnections.keys === 'function') {
      for (const rawPeerId of Array.from(rtcConnections.keys()) as string[]) {
        const peerId = this.normalizePeerId(rawPeerId);
        if (peerId) resetPeerIds.add(peerId);
      }
    }
    for (const peerId of resetPeerIds) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
        // ignore
      }
    }

    const hadConnectedPeers = this.getConnectedPeerCount() > 0;
    this.peers.clear();
    this.connecting.clear();
    this.orphanRtcFirstSeenAtMs.clear();
    if (hadConnectedPeers) {
      this.noteLocalCapacityChanged();
      this.broadcastMembership();
    }

    // Re-announce/join to refresh discovery state in the signaling layer.
    try {
      if (this.signalingClient && this.config.sessionId) {
        this.signalingClient.joinSession(this.config.sessionId);
      }
    } catch {
      // ignore
    }

    if (this.config.autoConnect) {
      try {
        this.maintainPeerConnections();
      } catch {
        // ignore
      }
    }

    // Best-effort debug signal.
    try {
      // eslint-disable-next-line no-console
      console.warn(`[PartialMesh] hardReset(${reason}) clientId=${this.clientId ?? ''} discovered=${this.discoveredPeers.size}`);
    } catch {
      // ignore
    }
  }

  /**
   * Create a new peer connection
   */
  private createPeerConnection(peerId: string, initiator: boolean): PeerConnection {
    const peerConnection: PeerConnection = {
      id: peerId,
      connected: false,
      initiator
    };

    // If a connection stalls, tear it down and retry.
    const existingTimer = this.connectionTimers.get(peerId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      const current = this.peers.get(peerId);
      if (!current || current.connected) return;

      this.connecting.delete(peerId);
      this.connectionStartedAtMs.delete(peerId);
      this.noteDialFailure(peerId);
      this.emit('peer:error', { peerId, error: new Error('Connection timeout') });
      this.removePeer(peerId);
    }, this.config.connectionTimeoutMs);

    this.connectionTimers.set(peerId, timer);
    this.connectionStartedAtMs.set(peerId, Date.now());
    this.peers.set(peerId, peerConnection);

    if (initiator) {
      // Nudge signaling freshness right before dialing so relayed offer delivery
      // is less likely to stall when peers discover each other asymmetrically.
      this.signalingClient?.nudgeSignaling?.();
      // FreeRTC handles the full offer/answer/ICE exchange internally.
      this.signalingClient.initiateConnection(peerId, this.config.iceServers, this.config.trickleIce).catch((err: any) => {
        this.connecting.delete(peerId);
        this.noteDialFailure(peerId);
        const t = this.connectionTimers.get(peerId);
        if (t) {
          clearTimeout(t);
          this.connectionTimers.delete(peerId);
        }
        this.connectionStartedAtMs.delete(peerId);
        this.emit('peer:error', { peerId, error: err });
        this.removePeer(peerId);
      });
    }
    // Non-initiator: FreeRTC handles the incoming offer entirely on its own.
    // We'll receive an rtc:connected event when the data channel opens.

    return peerConnection;
  }

  /**
   * Maintain the target number of peer connections
   */
  private dialCandidatePeerIds(includeLiveMembership: boolean): string[] {
    const candidates = new Set<string>(this.discoveredPeers);
    if (includeLiveMembership) {
      for (const peerId of this.getGlobalPeers()) candidates.add(peerId);
    }
    return Array.from(candidates).filter(
      (peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId),
    );
  }

  private maintainPeerConnections(): void {
    const now = Date.now();
    this.recoverOrphanedRtcNegotiations(now);
    const connectedCount = this.getConnectedPeerCount();
    const pendingCount = this.getPendingPeerCount();
    const candidatePeerIds = this.dialCandidatePeerIds(connectedCount === 0);
    const emergencyIsolated = connectedCount === 0 && candidatePeerIds.length > 0;
    const totalInProgress = connectedCount + pendingCount;
    const allCandidates = candidatePeerIds.filter(
      peerId => !this.isSelfAlias(peerId) && !this.peers.has(peerId) && !this.connecting.has(peerId)
    );
    const available = emergencyIsolated
      ? allCandidates
      : allCandidates.filter(peerId => !this.isPeerBackedOff(peerId));

    const pickCandidates = (count: number): string[] => {
      if ((available.length === 0 && allCandidates.length === 0) || count <= 0) return [];

      // Capacity comes first; the per-peer hash tie-breaker still spreads equal
      // candidates deterministically instead of creating a shared first target.
      const source = available.length > 0 ? available : allCandidates;
      const sorted = source.slice().sort((a, b) => this.compareDialCandidates(a, b));
      return sorted.slice(0, Math.min(count, sorted.length));
    };

    if (totalInProgress < this.config.minPeers) {
      // Need more connections.
      const needed = this.config.minPeers - totalInProgress;
      const emergencyBurst = emergencyIsolated ? Math.min(3, Math.max(2, available.length)) : 0;
      const dialCount = emergencyIsolated ? Math.max(needed, emergencyBurst) : needed;
      // When under minPeers, try all available candidates (up to a small cap) so
      // deterministic role selection doesn't leave the node with only non-initiator
      // candidates selected. connectToPeer skips non-initiator candidates immediately
      // (scheduling a fallback timer instead), so iterating all candidates is cheap
      // and ensures at least one actual outgoing dial fires.
      const tryCount = available.length <= this.config.maxPeers * 2
        ? available.length
        : Math.max(dialCount, this.config.minPeers + 1);
      for (const peerId of pickCandidates(tryCount)) {
        this.connectToPeer(peerId);
      }
    } else if (totalInProgress < this.config.maxPeers && available.length > 0) {
      if (now < this.rebalanceCooldownUntilMs) {
        return;
      }
      // Once the mesh is minimally healthy, keep adding a small number of bridge links.
      // This helps later-joining peers connect across sub-clusters instead of staying siloed.
      for (const peerId of pickCandidates(1)) {
        this.connectToPeer(peerId);
      }
    } else if (connectedCount > this.config.maxPeers) {
      this.trimExcessPeers();
    } else if (
      connectedCount >= this.config.maxPeers
      && pendingCount < this.config.tolerantPeers
      && available.length > 0
    ) {
      // Each tolerance slot can hold one bounded dial-before-drop attempt. This
      // makes the configured value a real concurrency budget without ever
      // raising the steady-state retained degree above maxPeers.
      if (this.maybeRebalanceForCloserPeer(available)) {
        return;
      }
    }
  }

  /**
   * Connect to a specific peer
   */
  public connectToPeer(peerId: string): void {
    this.connectToPeerInternal(peerId, false);
  }

  private connectToPeerInternal(peerId: string, allowTemporaryOverflow: boolean): void {
    const selfId = this.normalizePeerId(this.clientId);
    const normalizedPeerId = this.normalizePeerId(peerId);
    const signalingConnected = this.signalingClient?.isConnected?.() ?? true;
    const emergencyIsolated = this.getConnectedPeerCount() === 0
      && this.dialCandidatePeerIds(true).length > 0;

    if (!signalingConnected) {
      try {
        this.signalingClient?.connect?.();
      } catch {
        // ignore
      }
      return;
    }

    if (!selfId) {
      // Wait until signaling has provided a stable local ID; dialing before this
      // can make both sides choose initiator and deadlock in offer glare.
      return;
    }
    if (!normalizedPeerId ||
        this.peers.has(normalizedPeerId) || 
        this.connecting.has(normalizedPeerId) || 
        this.isSelfAlias(normalizedPeerId) ||
        this.retiredPeerIds.has(normalizedPeerId) ||
        normalizedPeerId === selfId) {
      return;
    }

    const existingRtcEntry = (this.signalingClient as any)?.client?.mesh?.connections?.get?.(normalizedPeerId);
    if (existingRtcEntry) {
      // Treat any entry as live unless explicitly failed/closed.
      // state='new' is set by the debug handler right after an inbound offer is answered
      // (RTCPeerConnection.connectionState='new' during early ICE). If we don't guard this
      // window, the mesh layer fires a second outgoing dial that destroys the responder.
      const existingState = String(existingRtcEntry.state ?? existingRtcEntry.connection?.connectionState ?? '').toLowerCase();
      const isDefinitelyDead = existingState === 'failed' || existingState === 'closed';
      if (!isDefinitelyDead) {
        return;
      }
      try {
        this.signalingClient?.closeConnection?.(normalizedPeerId);
      } catch {
        // ignore
      }
    }

    if (this.isPeerBackedOff(normalizedPeerId) && !emergencyIsolated) {
      return;
    }

    if (emergencyIsolated) {
      this.clearDialBackoff(normalizedPeerId);
    }

    const totalInProgress = this.getConnectedPeerCount() + this.getPendingPeerCount();
    // maxPeers is always the retained degree. tolerantPeers is only the bounded
    // dial-before-drop budget used by explicit rebalancing attempts.
    const maxAllowed = this.config.maxPeers + (allowTemporaryOverflow ? this.config.tolerantPeers : 0);
    if (totalInProgress >= maxAllowed) {
      return;
    }

    // Discovery can be asymmetric (one side sees the other first).
    // Use deterministic role selection to reduce glare, but keep a delayed
    // assist dial so asymmetric discovery does not deadlock the edge forever.
    const initiator = selfId < normalizedPeerId;

    if (!initiator) {
      this.signalingClient?.nudgeSignaling?.();

      const fallbackMs = this.config.nonInitiatorFallbackDialMs;
      if (!fallbackMs || fallbackMs <= 0) {
        return;
      }

      const candidatePeers = this.dialCandidatePeerIds(emergencyIsolated)
        .map((id) => this.normalizePeerId(id))
        .filter((id) => {
          if (!id || id === selfId || this.isSelfAlias(id)) return false;
          if (this.peers.has(id) || this.connecting.has(id)) return false;
          if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
          return true;
        });

      // If we already have at least one natural initiator candidate, skip fallback.
      // This prevents the largest-ID peer from scheduling extra assist dials.
      if (candidatePeers.some((id) => selfId < id)) {
        return;
      }

      const fallbackTargets = candidatePeers
        .filter((id) => selfId > id)
        .sort((a, b) => this.compareDialCandidates(a, b));
      if (fallbackTargets.length === 0) {
        return;
      }

      const selectedFallbackTarget = fallbackTargets
        .slice()
        .sort((a, b) => this.compareDialCandidates(a, b))[0];
      if (selectedFallbackTarget !== normalizedPeerId) {
        return;
      }

      if (!this.nonInitiatorFallbackTimers.has(normalizedPeerId)) {
        const fallbackTimer = setTimeout(() => {
          this.nonInitiatorFallbackTimers.delete(normalizedPeerId);

          if (this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId)) {
            return;
          }

          const refreshedCandidates = this.dialCandidatePeerIds(emergencyIsolated)
            .map((id) => this.normalizePeerId(id))
            .filter((id) => {
              if (!id || id === selfId || this.isSelfAlias(id)) return false;
              if (this.peers.has(id) || this.connecting.has(id)) return false;
              if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
              return true;
            });

          if (refreshedCandidates.some((id) => selfId < id)) {
            return;
          }

          const refreshedTargets = refreshedCandidates
            .filter((id) => selfId > id)
            .sort((a, b) => this.compareDialCandidates(a, b));
          if (refreshedTargets.length === 0) {
            return;
          }

          const refreshedSelectedTarget = refreshedTargets
            .slice()
            .sort((a, b) => this.compareDialCandidates(a, b))[0];
          if (refreshedSelectedTarget !== normalizedPeerId) {
            return;
          }

          const fallbackRtcEntry = (this.signalingClient as any)?.client?.mesh?.connections?.get?.(normalizedPeerId);
          if (fallbackRtcEntry) {
            const fallbackRtcState = String(fallbackRtcEntry.state ?? fallbackRtcEntry.connection?.connectionState ?? '').toLowerCase();
            const isFallbackDead = fallbackRtcState === 'failed' || fallbackRtcState === 'closed';
            if (!isFallbackDead) {
              return;
            }
            try {
              this.signalingClient?.closeConnection?.(normalizedPeerId);
            } catch {
              // ignore
            }
          }

          const currentInProgress = this.getConnectedPeerCount() + this.getPendingPeerCount();
          const fallbackMaxAllowed = allowTemporaryOverflow
            ? this.config.maxPeers + this.config.tolerantPeers
            : this.config.maxPeers;
          if (currentInProgress >= fallbackMaxAllowed) {
            return;
          }

          this.connecting.add(normalizedPeerId);
          this.createPeerConnection(normalizedPeerId, true);
        }, fallbackMs);

        this.nonInitiatorFallbackTimers.set(normalizedPeerId, fallbackTimer);
      }
      return;
    }

    this.connecting.add(normalizedPeerId);
    this.createPeerConnection(normalizedPeerId, true);
  }

  /**
   * Disconnect from a specific peer
   */
  public disconnectFromPeer(peerId: string): void {
    const normalizedPeerId = this.normalizePeerId(peerId);
    if (!normalizedPeerId) return;
    // Use the same teardown path as close/error to ensure timers and reconnection logic stay consistent.
    this.removePeer(normalizedPeerId, false);
  }

  /**
   * Remove a peer connection
   */
  private removePeer(peerId: string, forgetDiscovered: boolean = false): void {
    if (this.pendingRebalanceDropByTarget.has(peerId)) {
      this.pendingRebalanceDropByTarget.delete(peerId);
    }
    for (const [targetPeerId, dropPeerId] of Array.from(this.pendingRebalanceDropByTarget.entries())) {
      if (dropPeerId === peerId) {
        this.pendingRebalanceDropByTarget.delete(targetPeerId);
      }
    }

    const fallbackTimer = this.nonInitiatorFallbackTimers.get(peerId);
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      this.nonInitiatorFallbackTimers.delete(peerId);
    }

    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      const wasConnected = peerConnection.connected;
      const t = this.connectionTimers.get(peerId);
      if (t) {
        clearTimeout(t);
        this.connectionTimers.delete(peerId);
      }
      this.connectionStartedAtMs.delete(peerId);
      this.orphanRtcFirstSeenAtMs.delete(peerId);
      this.peers.delete(peerId);
      this.peerConnectedAtMs.delete(peerId);
      this.connecting.delete(peerId);
      // Close the underlying FreeRTC connection (no-op if already closed).
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
        // ignore
      }
      // Do NOT forget discovered peers on disconnect/close/error.
      // A peer can still be present in the signaling session and should remain eligible for reconnection.
      if (forgetDiscovered) {
        this.discoveredPeers.delete(peerId);
      }
      if (wasConnected) {
        this.noteLocalCapacityChanged();
        this.emit('peer:disconnected', peerId);
        this.broadcastMembership();
      }

      // Try to maintain minimum peer count
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    }
  }

  /**
   * Send data to a specific peer
   */
  public send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void {
    const peerConnection = this.peers.get(peerId);
    if (peerConnection && peerConnection.connected) {
      this.signalingClient.send(peerId, data);
    } else {
      throw new Error(`Peer ${peerId} is not connected`);
    }
  }

  /**
   * Broadcast data to all connected peers
   */
  public broadcast(data: string | ArrayBuffer | ArrayBufferView): void {
    this.signalingClient?.broadcast(data);
  }

  /**
   * Get list of connected peer IDs
   */
  public getConnectedPeers(): string[] {
    return Array.from(this.peers.values())
      .filter(pc => pc.connected)
      .map(pc => pc.id);
  }

  /**
   * Get list of discovered peer IDs
   */
  public getDiscoveredPeers(): string[] {
    return Array.from(this.discoveredPeers).filter((peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId));
  }

  /**
   * Get the converged global peer set (all peers known via membership gossip).
   */
  public getGlobalPeers(): string[] {
    this.pruneMembershipRecords(Date.now(), false);
    return Array.from(this.globalPeers).filter((peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId));
  }

  public getCecrMembershipRecords(): CecrMembershipRecordSnapshot[] {
    this.pruneMembershipRecords();
    return Array.from(this.membershipRecordsById.values())
      .map((record) => ({ ...record }))
      .sort((left, right) => left.peerId.localeCompare(right.peerId));
  }

  public getCecrMembershipEquivocations(): string[] {
    this.pruneMembershipRecords();
    return Array.from(this.membershipEquivocationAtById.keys()).sort();
  }

  public getCecrMembershipConfig(): Readonly<{
    leaseMs: number;
    gossipIntervalMs: number;
    tombstoneRetentionMs: number;
    clockSkewMs: number;
  }> {
    return Object.freeze({
      leaseMs: this.config.membershipLeaseMs,
      gossipIntervalMs: this.config.membershipGossipIntervalMs,
      tombstoneRetentionMs: this.config.membershipTombstoneRetentionMs,
      clockSkewMs: this.config.membershipClockSkewMs,
    });
  }

  /** Return the effective configuration, including constructor defaults. */
  public getConfig(): Readonly<Required<PartialMeshConfig>> {
    return {
      ...this.config,
      iceServers: this.config.iceServers ? this.config.iceServers.map((server) => ({ ...server })) : null,
    };
  }

  /**
   * Update connection-policy knobs without rebuilding the node. Signaling,
   * network/session identity, ICE, and trickle settings remain constructor-time
   * values because changing them requires reconnecting the transport.
   */
  public updateConfig(patch: Partial<PartialMeshRuntimeConfig>): Readonly<Required<PartialMeshConfig>> {
    const next = { ...this.config };
    for (const key of Object.keys(patch) as Array<keyof PartialMeshRuntimeConfig>) {
      const value = patch[key];
      if (value !== undefined) (next as any)[key] = value;
    }
    this.validatePeerLimits(next.minPeers, next.maxPeers, next.tolerantPeers);
    for (const [name, value] of [
      ['connectionTimeoutMs', next.connectionTimeoutMs],
      ['maintenanceIntervalMs', next.maintenanceIntervalMs],
      ['underConnectedResetMs', next.underConnectedResetMs],
      ['nonInitiatorFallbackDialMs', next.nonInitiatorFallbackDialMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
      }
    }
    if (!Number.isSafeInteger(next.peerStateMaxAgeMs) || next.peerStateMaxAgeMs < 1_000) {
      throw new RangeError('peerStateMaxAgeMs must be a safe integer of at least 1000');
    }

    const maintenanceChanged = next.maintenanceIntervalMs !== this.config.maintenanceIntervalMs
      || next.autoConnect !== this.config.autoConnect;
    const capacityChanged = next.maxPeers !== this.config.maxPeers;
    this.config = next;

    if (maintenanceChanged && this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    if (this.config.autoConnect) this.startMaintenanceLoop();
    this.trimExcessPeers();
    if (capacityChanged) {
      this.noteLocalCapacityChanged();
      this.broadcastMembership();
    }
    if (this.config.autoConnect) this.maintainPeerConnections();
    return this.getConfig();
  }

  /** Return capacity and available connection slots for one known peer. */
  public getPeerCapacity(peerId: string): PeerCapacitySnapshot | null {
    const id = this.normalizePeerId(peerId);
    if (!id) return null;
    const local = !!this.clientId && id === this.clientId;
    const state = local
      ? { maxPeers: this.config.maxPeers, connectedPeers: this.getConnectedPeerCount(), updatedAt: this.localCapacityUpdatedAtMs }
      : this.peerCapacityById.get(id);
    if (!state) return null;
    return {
      peerId: id,
      ...state,
      availableSlots: Math.max(0, state.maxPeers - state.connectedPeers),
      fresh: local || Date.now() - state.updatedAt <= this.config.peerStateMaxAgeMs,
      local,
    };
  }

  /** Return advertised capacity for every known peer, including this node. */
  public getPeerCapacities(): PeerCapacitySnapshot[] {
    const ids = new Set(this.peerCapacityById.keys());
    if (this.clientId) ids.add(this.clientId);
    return Array.from(ids)
      .map((peerId) => this.getPeerCapacity(peerId))
      .filter((value): value is PeerCapacitySnapshot => value != null)
      .sort((a, b) => a.peerId.localeCompare(b.peerId));
  }

  /** Return the exact XOR-space distance used by partial-mesh rebalancing. */
  public getXorDistance(peerId: string, fromPeerId: string | null = this.clientId): string | null {
    const from = this.normalizePeerId(fromPeerId);
    const target = this.normalizePeerId(peerId);
    if (!from || !target) return null;
    return `0x${this.peerDistance(from, target).toString(16)}`;
  }

  /** Return the shortest currently-known topology path from this peer. */
  public getHopDistance(peerId: string): number | null {
    const target = this.normalizePeerId(peerId);
    if (!target) return null;
    return this.getGraphSnapshot().nodes.find((node) => node.peerId === target)?.hopDistance ?? null;
  }

  /** Reconstruct the complete currently-known node and undirected edge snapshot. */
  public getGraphSnapshot(): PeerGraphSnapshot {
    const now = Date.now();
    this.pruneMembershipRecords(now, false);
    const self = this.normalizePeerId(this.clientId) || null;
    const connected = new Set(this.getConnectedPeers());
    const knownIds = new Set<string>();
    if (self) knownIds.add(self);
    for (const peerId of this.globalPeers) knownIds.add(peerId);
    for (const peerId of this.discoveredPeers) knownIds.add(peerId);
    for (const peerId of connected) knownIds.add(peerId);
    for (const peerId of Array.from(knownIds)) {
      if (!peerId || this.isSelfAlias(peerId) && peerId !== self || this.retiredPeerIds.has(peerId)) knownIds.delete(peerId);
    }

    // Capacity and topology are attributes of authoritative peers, never
    // membership evidence. Otherwise a stale relayed edge can resurrect a
    // departed identity indefinitely after its membership lease expires.
    const freshTopologyEntries = Array.from(this.peerTopologyById.entries()).filter(([peerId, state]) => (
      knownIds.has(peerId)
      && state.updatedAt <= now + this.config.membershipClockSkewMs
      && now - state.updatedAt <= this.config.peerStateMaxAgeMs
    ));
    const edgeMap = new Map<string, PeerGraphEdge>();
    const addEdge = (observer: string, left: string, right: string, updatedAt: number): void => {
      if (!knownIds.has(left) || !knownIds.has(right) || left === right) return;
      const [source, target] = left < right ? [left, right] : [right, left];
      const key = `${source}\u0000${target}`;
      const existing = edgeMap.get(key);
      const direct = !!self && (source === self && connected.has(target) || target === self && connected.has(source));
      if (existing) {
        if (!existing.observedBy.includes(observer)) existing.observedBy.push(observer);
        existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
        existing.direct = existing.direct || direct;
      } else {
        edgeMap.set(key, { source, target, direct, observedBy: [observer], updatedAt });
      }
    };

    if (self) {
      for (const peerId of connected) addEdge(self, self, peerId, this.localTopologyUpdatedAtMs);
    }
    for (const [peerId, state] of freshTopologyEntries) {
      for (const connectedPeerId of state.connectedPeerIds) {
        addEdge(peerId, peerId, connectedPeerId, state.updatedAt);
      }
    }

    const distanceByPeerId = new Map<string, bigint>();
    if (self) {
      for (const peerId of knownIds) {
        if (peerId !== self) distanceByPeerId.set(peerId, this.peerDistance(self, peerId));
      }
    }
    const rankedDistances = Array.from(distanceByPeerId.entries())
      .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0]));
    const rankByPeerId = new Map(rankedDistances.map(([peerId], rank) => [peerId, rank]));
    const minimumDistance = rankedDistances[0]?.[1] ?? 0n;
    const maximumDistance = rankedDistances[rankedDistances.length - 1]?.[1] ?? minimumDistance;
    const distanceSpan = maximumDistance - minimumDistance;
    const relativeDistance = (peerId: string): number | null => {
      if (peerId === self) return 0;
      const distance = distanceByPeerId.get(peerId);
      if (distance == null) return null;
      if (distanceSpan <= 0n) return 0;
      const precision = 1_000_000n;
      return Number(((distance - minimumDistance) * precision) / distanceSpan) / Number(precision);
    };

    const edges = Array.from(edgeMap.values())
      .map((edge) => ({ ...edge, observedBy: edge.observedBy.sort() }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    const hopDistanceByPeerId = new Map<string, number>();
    if (self) {
      const adjacentByPeerId = new Map<string, string[]>();
      for (const peerId of knownIds) adjacentByPeerId.set(peerId, []);
      for (const edge of edges) {
        adjacentByPeerId.get(edge.source)?.push(edge.target);
        adjacentByPeerId.get(edge.target)?.push(edge.source);
      }
      hopDistanceByPeerId.set(self, 0);
      const queue = [self];
      for (let index = 0; index < queue.length; index += 1) {
        const peerId = queue[index];
        const nextDistance = (hopDistanceByPeerId.get(peerId) ?? 0) + 1;
        for (const adjacentPeerId of adjacentByPeerId.get(peerId) ?? []) {
          if (hopDistanceByPeerId.has(adjacentPeerId)) continue;
          hopDistanceByPeerId.set(adjacentPeerId, nextDistance);
          queue.push(adjacentPeerId);
        }
      }
    }

    const freshTopologyPeerIds = new Set(freshTopologyEntries.map(([peerId]) => peerId));
    const missingTopologyPeerIds = Array.from(knownIds)
      .filter((peerId) => peerId !== self && !freshTopologyPeerIds.has(peerId))
      .sort();
    const nodes = Array.from(knownIds).sort().map((peerId): PeerGraphNode => ({
      peerId,
      local: peerId === self,
      directlyConnected: connected.has(peerId),
      discovered: this.discoveredPeers.has(peerId),
      capacity: this.getPeerCapacity(peerId),
      hopDistance: hopDistanceByPeerId.get(peerId) ?? null,
      xorDistance: peerId === self
        ? '0x0'
        : (distanceByPeerId.has(peerId) ? `0x${distanceByPeerId.get(peerId)!.toString(16)}` : null),
      xorDistanceRank: peerId === self ? null : (rankByPeerId.get(peerId) ?? null),
      xorDistanceRatio: relativeDistance(peerId),
    }));
    return {
      localPeerId: self,
      nodes,
      edges,
      complete: missingTopologyPeerIds.length === 0,
      missingTopologyPeerIds,
      generatedAt: now,
    };
  }

  /**
   * Get current peer count
   */
  public getPeerCount(): number {
    return this.peers.size;
  }

  /**
   * Get this client's ID
   */
  public getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Register an event handler
   */
  public on<K extends keyof PartialMeshEvents>(event: K, handler: PartialMeshEvents[K]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  /**
   * Unregister an event handler
   */
  public off<K extends keyof PartialMeshEvents>(event: K, handler: PartialMeshEvents[K]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof PartialMeshEvents>(event: K, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          (handler as any)(...args);
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err);
        }
      });
    }

  }
    // ─── Membership gossip ────────────────────────────────────────────────────

    private renewLocalMembership(force: boolean = false): boolean {
      const self = this.normalizePeerId(this.clientId);
      if (!self) return false;
      const now = Date.now();
      const existing = this.membershipRecordsById.get(self);
      if (
        !force && existing?.state === 'alive' && existing.validUntil != null &&
        existing.validUntil - now > this.config.membershipGossipIntervalMs * 2
      ) return false;
      this.membershipSequence += 1;
      this.membershipRecordsById.set(self, {
        peerId: self,
        incarnation: this.membershipIncarnation,
        sequence: this.membershipSequence,
        state: 'alive',
        issuedAt: now,
        validUntil: now + this.config.membershipLeaseMs,
      });
      return true;
    }

    private isMembershipRecordNewer(incoming: CecrMembershipRecord, existing?: CecrMembershipRecord): boolean {
      if (!existing) return true;
      if (incoming.incarnation !== existing.incarnation) return incoming.incarnation > existing.incarnation;
      return incoming.sequence > existing.sequence;
    }

    private mergeMembershipRecord(record: CecrMembershipRecord, now: number = Date.now()): boolean {
      const peerId = this.normalizePeerId(record.peerId);
      if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) return false;
      const canonicalId = peerId.replace(/-/g, '').toLowerCase();
      if (canonicalId.length !== 64 || !this.isHexId(canonicalId)) return false;
      if (!Number.isSafeInteger(record.incarnation) || record.incarnation < 0) return false;
      if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) return false;
      if (!Number.isSafeInteger(record.issuedAt) || record.issuedAt <= 0) return false;
      if (record.issuedAt > now + this.config.membershipClockSkewMs) return false;
      if (record.state !== 'alive' && record.state !== 'left') return false;
      if (record.state === 'alive') {
        if (!Number.isSafeInteger(record.validUntil)) return false;
        if ((record.validUntil ?? 0) <= record.issuedAt) return false;
        if ((record.validUntil ?? 0) - record.issuedAt > this.config.membershipLeaseMs) return false;
        if ((record.validUntil ?? 0) + this.config.membershipTombstoneRetentionMs <= now) return false;
      } else if (record.validUntil !== null) {
        return false;
      }
      const normalized = { ...record, peerId };
      const existing = this.membershipRecordsById.get(peerId);
      if (
        existing && existing.incarnation === normalized.incarnation &&
        existing.sequence === normalized.sequence
      ) {
        const identical = existing.state === normalized.state &&
          existing.issuedAt === normalized.issuedAt && existing.validUntil === normalized.validUntil;
        if (!identical) {
          this.membershipEquivocationAtById.set(peerId, now);
          return true;
        }
        return false;
      }
      if (!this.isMembershipRecordNewer(normalized, existing)) return false;
      this.membershipRecordsById.set(peerId, normalized);
      return true;
    }

    private rebuildGlobalMembership(emitChanges: boolean = true): boolean {
      const now = Date.now();
      const next = new Set<string>();
      for (const record of this.membershipRecordsById.values()) {
        if (
          record.state === 'alive' && record.validUntil != null && record.validUntil > now &&
          !this.isSelfAlias(record.peerId) && !this.retiredPeerIds.has(record.peerId) &&
          !this.membershipEquivocationAtById.has(record.peerId)
        ) next.add(record.peerId);
      }
      const changed = next.size !== this.globalPeers.size || Array.from(next).some((peerId) => !this.globalPeers.has(peerId));
      if (!changed) return false;
      for (const peerId of this.globalPeers) {
        if (next.has(peerId)) continue;
        this.peerCapacityById.delete(peerId);
        this.peerTopologyById.delete(peerId);
      }
      this.globalPeers = next;
      if (emitChanges) {
        this.emit('mesh:membership', Array.from(this.globalPeers));
        this.emit('mesh:capacity', this.getPeerCapacities());
        this.emit('mesh:graph', this.getGraphSnapshot());
      }
      return true;
    }

    private pruneMembershipRecords(now: number = Date.now(), emitChanges: boolean = true): boolean {
      let pruned = false;
      for (const [peerId, record] of this.membershipRecordsById.entries()) {
        const expiredAlive = record.state === 'alive' && (
          record.validUntil == null ||
          record.validUntil + this.config.membershipTombstoneRetentionMs <= now
        );
        const expiredTombstone = record.state === 'left' && now - record.issuedAt > this.config.membershipTombstoneRetentionMs;
        if (!expiredAlive && !expiredTombstone) continue;
        this.membershipRecordsById.delete(peerId);
        pruned = true;
      }
      for (const [peerId, quarantinedAt] of this.membershipEquivocationAtById.entries()) {
        if (now - quarantinedAt <= this.config.membershipTombstoneRetentionMs) continue;
        this.membershipEquivocationAtById.delete(peerId);
        pruned = true;
      }
      return this.rebuildGlobalMembership(emitChanges) || pruned;
    }

    private membershipRecordsForWire(): Record<string, CecrWireMembershipRecord> {
      const records: Record<string, CecrWireMembershipRecord> = {};
      const now = Date.now();
      for (const record of this.membershipRecordsById.values()) {
        if (record.state === 'alive' && (record.validUntil == null || record.validUntil <= now)) continue;
        if (record.state === 'left' && now - record.issuedAt > this.config.membershipTombstoneRetentionMs) continue;
        records[record.peerId] = [
          record.incarnation,
          record.sequence,
          record.state,
          record.issuedAt,
          record.validUntil,
        ];
      }
      return records;
    }

    private sendMembership(toPeerId: string): void {
      const self = this.normalizePeerId(this.clientId);
      this.renewLocalMembership(false);
      this.pruneMembershipRecords();
      const all = new Set<string>(this.globalPeers);
      if (self) all.add(self);
      for (const retiredPeerId of this.retiredPeerIds) all.delete(retiredPeerId);
      const capacities: Record<string, [number, number, number]> = {};
      const topology: Record<string, [string[], number]> = {};
      for (const [peerId, state] of this.peerCapacityById.entries()) {
        if (!all.has(peerId)) continue;
        capacities[peerId] = [state.maxPeers, state.connectedPeers, state.updatedAt];
      }
      for (const [peerId, state] of this.peerTopologyById.entries()) {
        if (!all.has(peerId)) continue;
        topology[peerId] = [state.connectedPeerIds, state.updatedAt];
      }
      if (self) {
        capacities[self] = [this.config.maxPeers, this.getConnectedPeerCount(), this.localCapacityUpdatedAtMs];
        topology[self] = [this.getConnectedPeers().slice().sort(), this.localTopologyUpdatedAtMs];
      }
      const payload = JSON.stringify({
        __membership: true,
        peers: Array.from(all),
        retiredPeers: Array.from(this.retiredPeerIds),
        records: this.membershipRecordsForWire(),
        capacities,
        topology,
      });
      try {
        this.signalingClient?.send(toPeerId, payload);
      } catch {
        // best-effort
      }
    }

    private broadcastMembership(exceptPeerId?: string): void {
      for (const peerId of this.getConnectedPeers()) {
        if (peerId !== exceptPeerId) this.sendMembership(peerId);
      }
    }

    private tryParseMembership(raw: any): {
      peers: string[];
      retiredPeers: string[];
      capacities: Record<string, unknown>;
      topology: Record<string, unknown>;
      records: Record<string, unknown>;
    } | null {
      try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (obj?.__membership === true && Array.isArray(obj.peers)) {
          return {
            peers: obj.peers,
            retiredPeers: Array.isArray(obj.retiredPeers) ? obj.retiredPeers : [],
            capacities: obj.capacities && typeof obj.capacities === 'object' && !Array.isArray(obj.capacities)
              ? obj.capacities
              : {},
            topology: obj.topology && typeof obj.topology === 'object' && !Array.isArray(obj.topology)
              ? obj.topology
              : {},
            records: obj.records && typeof obj.records === 'object' && !Array.isArray(obj.records)
              ? obj.records
              : {},
          };
        }
      } catch {
        // not a membership message
      }
      return null;
    }

    private mergeMembership(
      incoming: string[],
      retired: string[],
      capacities: Record<string, unknown>,
      topologyInput: Record<string, unknown> | string = {},
      fromPeerId: string = '',
      records: Record<string, unknown> = {}
    ): void {
      const topology = typeof topologyInput === 'string' ? {} : topologyInput;
      if (typeof topologyInput === 'string') fromPeerId = topologyInput;
      let membershipChanged = false;
      let capacityChanged = false;
      let topologyChanged = false;
      const now = Date.now();
      for (const [rawPeerId, rawRecord] of Object.entries(records || {})) {
        const peerId = this.normalizePeerId(rawPeerId);
        if (!peerId || !Array.isArray(rawRecord) || rawRecord.length < 5) continue;
        const record: CecrMembershipRecord = {
          peerId,
          incarnation: Math.floor(Number(rawRecord[0])),
          sequence: Math.floor(Number(rawRecord[1])),
          state: rawRecord[2] === 'left' ? 'left' : 'alive',
          issuedAt: Math.floor(Number(rawRecord[3])),
          validUntil: rawRecord[4] === null ? null : Math.floor(Number(rawRecord[4])),
        };
        if (this.mergeMembershipRecord(record, now)) membershipChanged = true;
      }
      // A transport-authenticated peer may retire itself. Third-party legacy
      // retirement claims are ignored; CECR v1 left records carry versions.
      const normalizedFromPeerId = this.normalizePeerId(fromPeerId);
      if (retired.some((raw) => this.normalizePeerId(raw) === normalizedFromPeerId) && normalizedFromPeerId) {
        const existing = this.membershipRecordsById.get(normalizedFromPeerId);
        const left: CecrMembershipRecord = {
          peerId: normalizedFromPeerId,
          incarnation: existing?.incarnation ?? 0,
          sequence: (existing?.sequence ?? 0) + 1,
          state: 'left',
          issuedAt: now,
          validUntil: null,
        };
        if (this.mergeMembershipRecord(left, now)) membershipChanged = true;
      }
      for (const raw of incoming) {
        const id = this.normalizePeerId(raw);
        if (!id || this.isSelfAlias(id) || this.retiredPeerIds.has(id)) continue;
        const existing = this.membershipRecordsById.get(id);
        if (existing && (existing.incarnation > 0 || existing.state === 'left')) continue;
        // Compatibility lease for pre-v1 peers. It expires unless an old peer
        // continues to advertise it; versioned records always supersede it.
        if (this.mergeMembershipRecord({
          peerId: id,
          incarnation: 0,
          sequence: now,
          state: 'alive',
          issuedAt: now,
          validUntil: now + this.config.membershipLeaseMs,
        }, now)) membershipChanged = true;
      }
      if (this.rebuildGlobalMembership(false)) membershipChanged = true;
      for (const [rawPeerId, rawState] of Object.entries(capacities || {})) {
        const peerId = this.normalizePeerId(rawPeerId);
        if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) continue;
        if (!Array.isArray(rawState) || rawState.length < 3) continue;
        const maxPeers = Math.floor(Number(rawState[0]));
        const connectedPeers = Math.floor(Number(rawState[1]));
        const updatedAt = Math.floor(Number(rawState[2]));
        if (
          !Number.isSafeInteger(maxPeers) || maxPeers < 1 ||
          !Number.isSafeInteger(connectedPeers) || connectedPeers < 0 ||
          !Number.isSafeInteger(updatedAt) || updatedAt <= 0
        ) continue;
        const existing = this.peerCapacityById.get(peerId);
        if (existing && existing.updatedAt >= updatedAt) continue;
        this.peerCapacityById.set(peerId, { maxPeers, connectedPeers, updatedAt });
        capacityChanged = true;
      }
      for (const [rawPeerId, rawState] of Object.entries(topology || {})) {
        const peerId = this.normalizePeerId(rawPeerId);
        if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) continue;
        if (!Array.isArray(rawState) || rawState.length < 2 || !Array.isArray(rawState[0])) continue;
        const updatedAt = Math.floor(Number(rawState[1]));
        if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) continue;
        const connectedPeerIds = Array.from(new Set(
          rawState[0]
            .map((value: unknown) => this.normalizePeerId(typeof value === 'string' ? value : ''))
            .filter((id: string) => id && id !== peerId && !this.retiredPeerIds.has(id))
        )).sort();
        const existing = this.peerTopologyById.get(peerId);
        if (existing && existing.updatedAt >= updatedAt) continue;
        this.peerTopologyById.set(peerId, { connectedPeerIds, updatedAt });
        topologyChanged = true;
      }
      if (membershipChanged || capacityChanged || topologyChanged) {
        this.emit('mesh:membership', Array.from(this.globalPeers));
        if (capacityChanged) this.emit('mesh:capacity', this.getPeerCapacities());
        if (membershipChanged || topologyChanged) this.emit('mesh:graph', this.getGraphSnapshot());
        this.broadcastMembership(fromPeerId);
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    }

    private removeFromGlobalMembership(peerId: string): void {
      const now = Date.now();
      const existing = this.membershipRecordsById.get(peerId);
      if (existing) {
        this.membershipRecordsById.set(peerId, {
          peerId,
          incarnation: existing.incarnation,
          sequence: existing.sequence + 1,
          state: 'left',
          issuedAt: now,
          validUntil: null,
        });
      }
      const removed = this.rebuildGlobalMembership(false) || this.globalPeers.delete(peerId);
      const removedCapacity = this.peerCapacityById.delete(peerId);
      const removedTopology = this.peerTopologyById.delete(peerId);
      if (!removed && !removedCapacity && !removedTopology) return;
      this.emit('mesh:membership', Array.from(this.globalPeers));
      if (removedCapacity) this.emit('mesh:capacity', this.getPeerCapacities());
      this.emit('mesh:graph', this.getGraphSnapshot());
      for (const connectedPeerId of this.getConnectedPeers()) {
        if (connectedPeerId !== peerId) {
          this.sendMembership(connectedPeerId);
        }
      }
    }

  /**
   * Disconnect from all peers and close signaling connection
   */
  public destroy(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    if (this.membershipTimer) {
      clearInterval(this.membershipTimer);
      this.membershipTimer = null;
    }

    for (const t of this.connectionTimers.values()) {
      clearTimeout(t);
    }
    this.connectionTimers.clear();
    for (const t of this.nonInitiatorFallbackTimers.values()) {
      clearTimeout(t);
    }
    this.nonInitiatorFallbackTimers.clear();

    // Close all peer connections
    for (const peerId of this.peers.keys()) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
        // ignore
      }
    }
    this.peers.clear();
    this.connecting.clear();
    this.discoveredPeers.clear();
    this.discoveredAtMs.clear();
    this.connectionStartedAtMs.clear();
    this.orphanRtcFirstSeenAtMs.clear();
    this.peerConnectedAtMs.clear();
    this.rebalanceAttemptAtMs.clear();
    this.pendingRebalanceDropByTarget.clear();
    this.globalPeers.clear();
    this.membershipRecordsById.clear();
    this.membershipEquivocationAtById.clear();
    this.peerCapacityById.clear();
    this.peerTopologyById.clear();
    this.selfAliases.clear();
    this.retiredPeerIds.clear();
    this.clientId = null;
    this.underConnectedSinceMs = null;
    this.lastHardResetAtMs = 0;
    this.lastDiscoveryRefreshAtMs = 0;
    this.lastSignalingReconnectAtMs = 0;
    this.rebalanceCooldownUntilMs = 0;
    this.dialFailureCount.clear();
    this.dialBackoffUntilMs.clear();

    // Disconnect from signaling server
    if (this.signalingClient) {
      this.signalingClient.disconnect();
      this.signalingClient = null;
    }

    for (const handlers of this.eventHandlers.values()) {
      handlers.clear();
    }
  }
}

export type PeerPigeonNodeStorageOptions = Omit<StorageOptions, 'gossip' | 'peerId' | 'userId'> & {
  userId?: string;
};

export type PeerPigeonNodeOptions = PartialMeshConfig & {
  gossip?: GossipProtocolOptions;
  /** Enabled by default. Pass false to construct a node without crypto. */
  crypto?: false | (Omit<PeerPigeonCryptoOptions, 'roomId'> & { roomId?: string });
  /** Disabled by default. Pass options to attach encrypted synchronized storage. */
  storage?: false | PeerPigeonNodeStorageOptions;
};

export type PeerPigeonNodeMessage = {
  kind: 'broadcast' | 'direct';
  data: unknown;
  encrypted: boolean;
  local: boolean;
  fromPeerId: string | null;
  messageId: string;
  hops: number;
  message: GossipMessage | DirectMessage;
};

export type PeerPigeonNodeEvents = {
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
export class PeerPigeonNode {
  public readonly mesh: PartialMesh;
  public readonly gossip: GossipProtocol;
  public readonly crypto: PeerPigeonCryptoProtocol | null;
  public storage: PeerPigeonStorage | null = null;

  private readonly storageOptions: false | PeerPigeonNodeStorageOptions;
  private readonly callbacks: Partial<Record<keyof PeerPigeonNodeEvents, Set<Function>>> = {};
  private started = false;

  constructor(options: PeerPigeonNodeOptions = {}) {
    const { gossip = {}, crypto = {}, storage = false, ...meshOptions } = options;
    this.mesh = new PartialMesh(meshOptions);
    this.gossip = new GossipProtocol(this.mesh, gossip);
    this.storageOptions = storage;

    if (crypto === false) {
      this.crypto = null;
    } else {
      const networkId = String(meshOptions.networkId ?? meshOptions.sessionId ?? 'peerpigeon').trim();
      const sessionId = String(meshOptions.sessionId ?? 'default-session').trim();
      this.crypto = new PeerPigeonCryptoProtocol(this.mesh, this.gossip, {
        ...crypto,
        roomId: String(crypto.roomId ?? `${networkId}:${sessionId}`).trim(),
      });
    }

    this.bindComponentEvents();
  }

  async init(): Promise<void> {
    return await this.start();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      if (this.crypto) await this.crypto.init();
      if (this.storageOptions !== false) {
        const userId = String(
          this.storageOptions.userId
          ?? (this.crypto ? this.crypto.getKeyPair().epub : '')
        ).trim();
        if (!userId) throw new Error('storage.userId is required when crypto is disabled');
        const { userId: _ignoredUserId, ...storageOptions } = this.storageOptions;
        const config = this.mesh.getConfig();
        this.storage = new PeerPigeonStorage({
          ...storageOptions,
          userId,
          peerId: this.mesh.getClientId() ?? '',
          sessionId: storageOptions.sessionId ?? `${config.networkId}:${config.sessionId}`,
          gossip: this.gossip,
        });
        await this.storage.init();
      }
      await this.mesh.init();
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  getConfig(): Readonly<Required<PartialMeshConfig>> {
    return this.mesh.getConfig();
  }

  updateConfig(patch: Partial<PartialMeshRuntimeConfig>): Readonly<Required<PartialMeshConfig>> {
    return this.mesh.updateConfig(patch);
  }

  getGraphSnapshot(): PeerGraphSnapshot {
    return this.mesh.getGraphSnapshot();
  }

  getPeerCapacity(peerId: string): PeerCapacitySnapshot | null {
    return this.mesh.getPeerCapacity(peerId);
  }

  getPeerCapacities(): PeerCapacitySnapshot[] {
    return this.mesh.getPeerCapacities();
  }

  getXorDistance(peerId: string, fromPeerId?: string): string | null {
    return this.mesh.getXorDistance(peerId, fromPeerId ?? this.mesh.getClientId());
  }

  getHopDistance(peerId: string): number | null {
    return this.mesh.getHopDistance(peerId);
  }

  getCecrConfig(): Readonly<CecrConfigSnapshot> {
    return this.gossip.getCecrConfig();
  }

  getCecrState(): CecrStateSnapshot {
    return this.gossip.getCecrState();
  }

  getClientId(): string | null { return this.mesh.getClientId(); }
  getConnectedPeers(): string[] { return this.mesh.getConnectedPeers(); }
  getDiscoveredPeers(): string[] { return this.mesh.getDiscoveredPeers(); }
  getGlobalPeers(): string[] { return this.mesh.getGlobalPeers(); }

  broadcast(data: unknown, metadata: Record<string, unknown> = {}, options: GossipBroadcastOptions = {}): string {
    return this.gossip.broadcast(data, metadata, options);
  }

  broadcastReliable(
    data: unknown,
    metadata: Record<string, unknown> = {},
    options: Omit<GossipBroadcastOptions, 'trackDelivery'> = {}
  ): string {
    return this.gossip.broadcastReliable(data, metadata, options);
  }

  sendDirect(peerId: string, data: unknown): string | null {
    return this.gossip.sendDirect(peerId, data);
  }

  getDeliveryStatus(messageId: string): GossipDeliveryStatus | null {
    return this.gossip.getDeliveryStatus(messageId);
  }

  async broadcastEncrypted(
    plaintext: string,
    metadata: Record<string, unknown> = {},
    options: GossipBroadcastOptions = {}
  ): Promise<string> {
    if (!this.crypto) throw new Error('Crypto is disabled for this node');
    return await this.crypto.broadcastEncrypted(plaintext, metadata, options);
  }

  async broadcastEncryptedReliable(
    plaintext: string,
    metadata: Record<string, unknown> = {},
    options: Omit<GossipBroadcastOptions, 'trackDelivery'> = {}
  ): Promise<string> {
    return await this.broadcastEncrypted(plaintext, metadata, { ...options, trackDelivery: true });
  }

  async sendEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<string> {
    if (!this.crypto) throw new Error('Crypto is disabled for this node');
    return await this.crypto.sendEncryptedDirect(peerId, plaintext, timeoutMs);
  }

  getKeyPair(): Readonly<PeerPigeonKeyPair> {
    if (!this.crypto) throw new Error('Crypto is disabled for this node');
    return this.crypto.getKeyPair();
  }

  getPublicKey(peerId: string): PeerPublicKey | null {
    return this.crypto?.getPublicKey(peerId) ?? null;
  }

  getKnownPeerKeys(): PeerPublicKey[] {
    return this.crypto?.getKnownPeerKeys() ?? [];
  }

  requestPeerKey(peerId: string): void {
    if (!this.crypto) throw new Error('Crypto is disabled for this node');
    this.crypto.requestPeerKey(peerId);
  }

  waitForPeerKey(peerId: string, timeoutMs?: number): Promise<PeerPublicKey> {
    if (!this.crypto) return Promise.reject(new Error('Crypto is disabled for this node'));
    return timeoutMs === undefined
      ? this.crypto.waitForPeerKey(peerId)
      : this.crypto.waitForPeerKey(peerId, timeoutMs);
  }

  recoverAfterInactivity(reason?: string): void {
    this.mesh.recoverAfterInactivity(reason);
  }

  on<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void {
    const callbacks = this.callbacks[event];
    if (callbacks) callbacks.add(callback);
    else this.callbacks[event] = new Set([callback]);
  }

  off<K extends keyof PeerPigeonNodeEvents>(event: K, callback: PeerPigeonNodeEvents[K]): void {
    this.callbacks[event]?.delete(callback);
  }

  async destroy(): Promise<void> {
    if (this.storage) await this.storage.close();
    this.storage = null;
    this.crypto?.destroy();
    this.gossip.destroy();
    this.mesh.destroy();
    this.started = false;
    for (const callbacks of Object.values(this.callbacks)) callbacks?.clear();
  }

  private bindComponentEvents(): void {
    this.mesh.on('mesh:ready', () => this.emit('ready', undefined));
    this.mesh.on('peer:connected', (peerId) => this.emit('peerConnected', peerId));
    this.mesh.on('peer:disconnected', (peerId) => this.emit('peerDisconnected', peerId));
    this.mesh.on('mesh:graph', (snapshot) => this.emit('graphChanged', snapshot));
    this.mesh.on('mesh:capacity', (capacities) => this.emit('capacityChanged', capacities));
    this.mesh.on('signaling:connected', ({ clientId }) => this.storage?.setPeerId(clientId));
    this.mesh.on('signaling:error', (error) => this.emitError(error));
    this.mesh.on('peer:error', ({ error }) => this.emitError(error));

    this.gossip.on('messageReceived', ({ message, local, fromPeer }) => {
      if (this.isReservedPayload(message.data)) return;
      this.emit('message', {
        kind: 'broadcast',
        data: message.data,
        encrypted: false,
        local,
        fromPeerId: fromPeer ?? message.sender,
        messageId: message.id,
        hops: message.hops,
        message,
      });
    });
    this.gossip.on('directMessageReceived', ({ message }) => {
      if (this.isReservedPayload(message.data)) return;
      this.emit('message', {
        kind: 'direct',
        data: message.data,
        encrypted: false,
        local: false,
        fromPeerId: message.from,
        messageId: message.id,
        hops: message.hops,
        message,
      });
    });
    this.gossip.on('deliveryProgress', (status) => this.emit('deliveryProgress', status));
    this.gossip.on('deliveryComplete', (status) => this.emit('deliveryComplete', status));
    this.gossip.on('deliveryTimeout', (status) => this.emit('deliveryTimeout', status));

    this.crypto?.on('keyDiscovered', (key) => this.emit('keyDiscovered', key));
    this.crypto?.on('encryptedBroadcastReceived', ({ plaintext, message, local, fromPeer }) => {
      this.emit('message', {
        kind: 'broadcast',
        data: plaintext,
        encrypted: true,
        local,
        fromPeerId: fromPeer ?? message.sender,
        messageId: message.id,
        hops: message.hops,
        message,
      });
    });
    this.crypto?.on('encryptedDirectReceived', ({ plaintext, message }) => {
      this.emit('message', {
        kind: 'direct',
        data: plaintext,
        encrypted: true,
        local: false,
        fromPeerId: message.from,
        messageId: message.id,
        hops: message.hops,
        message,
      });
    });
    this.crypto?.on('error', (error) => this.emitError(error));
  }

  private isReservedPayload(data: unknown): boolean {
    if (PeerPigeonCryptoProtocol.isProtocolPayload(data)) return true;
    if (!data || typeof data !== 'object') return false;
    const type = (data as { __ppType?: unknown }).__ppType;
    return typeof type === 'string' && type.startsWith('pp-storage-');
  }

  private emitError(error: unknown): void {
    this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }

  private emit<K extends keyof PeerPigeonNodeEvents>(
    event: K,
    data: Parameters<PeerPigeonNodeEvents[K]>[0]
  ): void {
    for (const callback of this.callbacks[event] ?? []) {
      try { (callback as (value: typeof data) => void)(data); } catch { /* isolate application listeners */ }
    }
  }
}

export default PartialMesh;

export { GossipProtocol };
export type {
  CecrConfigSnapshot,
  CecrOverlaySnapshot,
  CecrStateSnapshot,
  GossipBroadcastOptions,
  GossipDeliveryStatus,
  GossipMessage,
  GossipProtocolOptions,
  GossipStats,
} from './gossip.js';
export { PeerPigeonStorage };
export type {
  StorageSpace,
  StorageRecord,
  StoragePutOptions,
  StorageRetrieveOptions,
  StorageOptions,
  StorageSyncOptions,
  StorageSyncFilterContext,
  StorageChangeOrigin,
  StorageUnsubscribe,
  StorageEvents,
} from './storage.js';
export { PeerPigeonCryptoProtocol };
export type {
  EncryptedBroadcastPayload,
  EncryptedDirectPayload,
  PeerPigeonCryptoEvents,
  PeerPigeonCryptoOptions,
  PeerPigeonKeyPair,
  PeerPublicKey,
  RoomCipher,
} from './crypto.js';
