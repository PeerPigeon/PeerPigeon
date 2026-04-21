import FreeRTCClientAdapter from './freertc-client-adapter.js';

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
   * Whether SDP should be sent before ICE gathering completes.
   * Disable to emit full offer/answer payloads after ICE gathering finishes.
   */
  trickleIce?: boolean;
}

export interface PeerConnection {
  id: string;
  connected: boolean;
  initiator: boolean;
}

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
  private eventHandlers: Map<keyof PartialMeshEvents, Set<Function>> = new Map();
  private connecting: Set<string> = new Set();
  private connectionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private connectionStartedAtMs: Map<string, number> = new Map();
  private peerConnectedAtMs: Map<string, number> = new Map();
  private discoveredAtMs: Map<string, number> = new Map();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
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

  constructor(config: PartialMeshConfig = {}) {
    this.config = {
      minPeers: config.minPeers ?? 2,
      maxPeers: config.maxPeers ?? 10,
      tolerantPeers: config.tolerantPeers ?? Math.max(1, Math.min(2, Math.floor((config.maxPeers ?? 10) * 0.25))),
      signalingServer: config.signalingServer ?? 'wss://peer.ooo/ws',
      sessionId: config.sessionId ?? 'default-session',
      autoDiscover: config.autoDiscover ?? true,
      autoConnect: config.autoConnect ?? true,
      // Prefer FreeRTC's richer built-in ICE profile by default.
      iceServers: config.iceServers ?? null,
      // FreeRTC retries relayed offers for up to ~30s; keep this above that window
      // so we do not abort otherwise-recoverable negotiations.
      connectionTimeoutMs: config.connectionTimeoutMs ?? 45_000,
      maintenanceIntervalMs: config.maintenanceIntervalMs ?? 2_000,
      underConnectedResetMs: config.underConnectedResetMs ?? 0,
      nonInitiatorFallbackDialMs: config.nonInitiatorFallbackDialMs ?? 8_000,
      trickleIce: config.trickleIce ?? true
    };

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
      'mesh:membership'
    ];
    events.forEach(event => this.eventHandlers.set(event, new Set()));
  }

  private normalizePeerId(peerId: string | null | undefined): string {
    return (peerId ?? '').trim();
  }

  private addSelfAlias(peerId: string | null | undefined): void {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.selfAliases.add(id);
    this.discoveredPeers.delete(id);
    this.globalPeers.delete(id);
  }

  private isSelfAlias(peerId: string | null | undefined): boolean {
    const id = this.normalizePeerId(peerId);
    if (!id) return false;
    return this.selfAliases.has(id);
  }

  private addDiscoveredPeer(peerId: string): void {
    const id = this.normalizePeerId(peerId);
    if (!id || this.isSelfAlias(id)) return;
    if (this.discoveredPeers.has(id)) return;
    this.discoveredPeers.add(id);
    this.discoveredAtMs.set(id, Date.now());
    this.emit('peer:discovered', id);
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

  private getMaxPeersWithTolerance(): number {
    const tolerance = Math.max(0, Math.floor(this.config.tolerantPeers));
    return this.config.maxPeers + tolerance;
  }

  private trimExcessPeers(): void {
    const connectedPeers = this.getConnectedPeers();
    const overflow = connectedPeers.length - this.getMaxPeersWithTolerance();
    if (overflow <= 0) return;

    // Pause proactive expansion briefly so we do not oscillate around maxPeers.
    this.rebalanceCooldownUntilMs = Math.max(this.rebalanceCooldownUntilMs, Date.now() + 2_000);

    // Drop newest connections first to keep longer-lived links stable.
    const dropOrder = connectedPeers
      .map((peerId) => ({
        peerId,
        connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0
      }))
      .sort((a, b) => {
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

  private maybeRebalanceForCloserPeer(candidates: string[]): boolean {
    const selfId = this.normalizePeerId(this.clientId);
    if (!selfId) return false;

    const now = Date.now();
    if (now < this.rebalanceCooldownUntilMs) {
      return false;
    }

    const connectedPeers = this.getConnectedPeers();
    if (connectedPeers.length < this.config.maxPeers || connectedPeers.length === 0 || candidates.length === 0) {
      return false;
    }

    if (this.pendingRebalanceDropByTarget.size > 0) {
      return false;
    }

    // Only rebalance from healthy surplus; avoid destabilizing minimally connected nodes.
    if (connectedPeers.length <= this.config.minPeers) {
      return false;
    }

    const connectedByDistance = connectedPeers
      .map((peerId) => ({
        peerId,
        distance: this.peerDistance(selfId, peerId),
        connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0
      }))
      .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId)));

    const candidateByDistance = candidates
      .map((peerId) => ({
        peerId,
        distance: this.peerDistance(selfId, peerId),
        discoveredAt: this.discoveredAtMs.get(peerId) ?? 0,
        lastAttemptAt: this.rebalanceAttemptAtMs.get(peerId) ?? 0
      }))
      .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId)));

    const farthestConnected = connectedByDistance[connectedByDistance.length - 1];
    const closestCandidate = candidateByDistance.find((candidate) => {
      const discoveredAgeMs = now - candidate.discoveredAt;
      const sinceAttemptMs = now - candidate.lastAttemptAt;
      return discoveredAgeMs >= 2_000 && sinceAttemptMs >= 20_000;
    });

    // Rebalance only when the newcomer is genuinely closer than our weakest edge.
    if (!closestCandidate || !farthestConnected) {
      return false;
    }

    // Keep existing edges sticky for a short period to prevent oscillation.
    const connectedAgeMs = now - (farthestConnected.connectedAt || 0);
    if (connectedAgeMs < 12_000) {
      return false;
    }

    // Require a meaningful improvement margin (candidate at least 25% closer)
    // before replacing an existing edge.
    if (closestCandidate.distance * 4n >= farthestConnected.distance * 3n) {
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

    this.rebalanceCooldownUntilMs = now + 12_000;
    this.rebalanceAttemptAtMs.set(closestCandidate.peerId, now);
    this.rebalanceAttemptAtMs.set(farthestConnected.peerId, now);
    this.pendingRebalanceDropByTarget.set(closestCandidate.peerId, farthestConnected.peerId);
    this.emit('signaling:log', {
      message: `[rebalance] dial closer ${closestCandidate.peerId.slice(0, 8)} then drop ${farthestConnected.peerId.slice(0, 8)}`
    });

    this.connectToPeerInternal(closestCandidate.peerId, true);
    return true;
  }

  /**
   * Initialize and connect to the signaling server
   */
  async init(): Promise<void> {
    // Let FreeRTC client manage query params such as networkId.
    const url = new URL(this.config.signalingServer);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    const signalingUrl = url.toString();

    const requestedPeerId = Array.from(
      (globalThis.window?.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, '0')
    ).join('');
    this.addSelfAlias(requestedPeerId);

    this.signalingClient = new FreeRTCClientAdapter(signalingUrl, {
      networkId: this.config.sessionId,
      peerId: requestedPeerId,
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

    this.signalingClient.on('rtc:connected', (data: { peerId: string }) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId || this.isSelfAlias(peerId)) return;
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

      // Announce our current global peer knowledge to the new peer
      this.sendMembership(peerId);
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
          this.emit('peer:disconnected', peerId);
        }
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });

    this.signalingClient.on('rtc:data', (data: { peerId: string; data: any }) => {
      const msg = this.tryParseMembership(data.data);
      if (msg) {
        this.mergeMembership(msg.peers, data.peerId);
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
        this.maybeRecoverStalledNegotiations();
        this.maintainPeerConnections();
        this.maybeHardResetUnderConnected();
      } catch {
        // ignore
      }
    }, this.config.maintenanceIntervalMs);
  }

  private maybeRefreshDiscovery(): void {
    if (!this.config.autoDiscover) return;

    const connected = this.getConnectedPeers().length;
    const now = Date.now();
    const underConnected = connected < this.config.minPeers;
    const hasFewCandidates = this.discoveredPeers.size < this.config.minPeers;

    if (!underConnected && !hasFewCandidates) return;
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

  private maybeRecoverStalledNegotiations(): void {
    const now = Date.now();
    const connectedCount = this.getConnectedPeerCount();
    const isolated = connectedCount === 0 && this.discoveredPeers.size > 0;
    const baseStallMs = Math.max(10_000, Math.min(this.config.connectionTimeoutMs, 15_000));
    const stallMs = isolated ? Math.max(3_500, Math.min(this.config.connectionTimeoutMs, 6_000)) : baseStallMs;

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
    const hasEnoughCandidates = this.discoveredPeers.size >= this.config.minPeers;
    const hasAnyCandidate = this.discoveredPeers.size > 0;
    const underConnected = connected < this.config.minPeers && hasEnoughCandidates;
    const isolated = connected === 0 && hasAnyCandidate;
    const isolatedThresholdMs = Math.max(3_500, Math.min(thresholdMs, 8_000));
    const hasStalePending = pending > 0 && oldestPendingAge >= isolatedThresholdMs;
    const hasRepeatedFailures = Array.from(this.discoveredPeers)
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

    for (const peerId of this.peers.keys()) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
        // ignore
      }
    }

    this.peers.clear();
    this.connecting.clear();

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
  private maintainPeerConnections(): void {
    const now = Date.now();
    const connectedCount = this.getConnectedPeerCount();
    const pendingCount = this.getPendingPeerCount();
    const emergencyIsolated = connectedCount === 0 && this.discoveredPeers.size > 0;
    const totalInProgress = connectedCount + pendingCount;
    const allCandidates = Array.from(this.discoveredPeers).filter(
      peerId => !this.isSelfAlias(peerId) && !this.peers.has(peerId) && !this.connecting.has(peerId)
    );
    const available = emergencyIsolated
      ? allCandidates
      : allCandidates.filter(peerId => !this.isPeerBackedOff(peerId));

    const pickCandidates = (count: number): string[] => {
      if ((available.length === 0 && allCandidates.length === 0) || count <= 0) return [];

      // Avoid all peers picking the same "first" discovered peer by rotating the list.
      // This reduces thundering-herd behavior and improves overall convergence.
      const selfId = this.normalizePeerId(this.clientId);
      const source = available.length > 0 ? available : allCandidates;
      const sorted = source.slice().sort((a, b) => {
        const failA = this.dialFailureCount.get(a) ?? 0;
        const failB = this.dialFailureCount.get(b) ?? 0;
        if (failA !== failB) return failA - failB;
        return a.localeCompare(b);
      });
      let offset = 0;
      if (selfId) {
        let hash = 0;
        for (let i = 0; i < selfId.length; i++) {
          hash = (hash * 31 + selfId.charCodeAt(i)) >>> 0;
        }
        offset = sorted.length ? hash % sorted.length : 0;
      }

      const selected: string[] = [];
      for (let i = 0; i < Math.min(count, sorted.length); i++) {
        selected.push(sorted[(offset + i) % sorted.length]);
      }
      return selected;
    };

    if (totalInProgress < this.config.minPeers) {
      // Need more connections
      const needed = this.config.minPeers - totalInProgress;
      const emergencyBurst = emergencyIsolated ? Math.min(3, Math.max(2, available.length)) : 0;
      const dialCount = emergencyIsolated ? Math.max(needed, emergencyBurst) : needed;
      for (const peerId of pickCandidates(dialCount)) {
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
    } else if (connectedCount > this.getMaxPeersWithTolerance()) {
      this.trimExcessPeers();
    } else if (connectedCount >= this.config.maxPeers && pendingCount === 0 && available.length > 0) {
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
    const emergencyIsolated = this.getConnectedPeerCount() === 0 && this.discoveredPeers.size > 0;

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
        normalizedPeerId === selfId) {
      return;
    }

    if (this.isPeerBackedOff(normalizedPeerId) && !emergencyIsolated) {
      return;
    }

    if (emergencyIsolated) {
      this.clearDialBackoff(normalizedPeerId);
    }

    const connectedCount = this.getConnectedPeerCount();
    const maxAllowed = allowTemporaryOverflow ? this.config.maxPeers + 1 : this.getMaxPeersWithTolerance();
    if (connectedCount >= maxAllowed) {
      console.warn('Max peers reached, cannot connect to more peers');
      return;
    }

    // Discovery can be asymmetric (one side sees the other first).
    // Always dialing here prevents deadlock where neither side initiates.
    // Use deterministic role selection to prevent SDP glare.
    // When both peers discover each other simultaneously, only the one with the
    // lexicographically smaller ID sends an offer; the other waits for the inbound offer.
    const initiator = selfId < normalizedPeerId;

    if (!initiator) {
      // Let FreeRTC accept the inbound offer on the non-initiator side.
      // If this node is lexicographically greater than all discovered peers,
      // no one may proactively dial it in time; allow one deterministic fallback dial.
      this.signalingClient?.nudgeSignaling?.();

      const fallbackMs = this.config.nonInitiatorFallbackDialMs;
      if (!fallbackMs || fallbackMs <= 0) {
        return;
      }

      const candidatePeers = Array.from(this.discoveredPeers)
        .map((id) => this.normalizePeerId(id))
        .filter((id) => id && !this.isSelfAlias(id) && id !== selfId && !this.peers.has(id) && !this.connecting.has(id) && !this.isPeerBackedOff(id));

      const hasNaturalInitiatorTarget = candidatePeers.some((id) => selfId < id);
      if (hasNaturalInitiatorTarget) {
        return;
      }

      const fallbackTargets = candidatePeers
        .filter((id) => selfId > id)
        .sort((a, b) => a.localeCompare(b));

      if (fallbackTargets.length === 0) {
        return;
      }

      // Deterministically rotate fallback target per local peer so not all nodes
      // stampede the same candidate when recovering from saturation.
      let hash = 0;
      for (let i = 0; i < selfId.length; i++) {
        hash = (hash * 31 + selfId.charCodeAt(i)) >>> 0;
      }
      const selectedFallbackTarget = fallbackTargets[hash % fallbackTargets.length];
      if (selectedFallbackTarget !== normalizedPeerId) {
        return;
      }

      if (!this.nonInitiatorFallbackTimers.has(normalizedPeerId)) {
        const fallbackTimer = setTimeout(() => {
          this.nonInitiatorFallbackTimers.delete(normalizedPeerId);

          if (this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId)) {
            return;
          }

          if (this.getConnectedPeerCount() >= this.config.maxPeers) {
            return;
          }

          const refreshedCandidates = Array.from(this.discoveredPeers)
            .map((id) => this.normalizePeerId(id))
            .filter((id) => id && !this.isSelfAlias(id) && id !== selfId && !this.peers.has(id) && !this.connecting.has(id) && !this.isPeerBackedOff(id));
          if (refreshedCandidates.some((id) => selfId < id)) {
            return;
          }

          const refreshedFallbackTargets = refreshedCandidates
            .filter((id) => selfId > id)
            .sort((a, b) => a.localeCompare(b));
          if (refreshedFallbackTargets.length === 0) {
            return;
          }

          let refreshedHash = 0;
          for (let i = 0; i < selfId.length; i++) {
            refreshedHash = (refreshedHash * 31 + selfId.charCodeAt(i)) >>> 0;
          }
          const refreshedSelected = refreshedFallbackTargets[refreshedHash % refreshedFallbackTargets.length];
          if (refreshedSelected !== normalizedPeerId) {
            return;
          }

          const rtcEntry = (this.signalingClient as any)?.client?.mesh?.connections?.get?.(normalizedPeerId);
          if (rtcEntry?.state === 'connecting' || rtcEntry?.state === 'connected') {
            return;
          }
          if (rtcEntry?.channel?.readyState === 'open') {
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
    this.createPeerConnection(normalizedPeerId, initiator);
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
        this.emit('peer:disconnected', peerId);
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
    return Array.from(this.discoveredPeers);
  }

  /**
   * Get the converged global peer set (all peers known via membership gossip).
   */
  public getGlobalPeers(): string[] {
    return Array.from(this.globalPeers);
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

    private sendMembership(toPeerId: string): void {
      const self = this.normalizePeerId(this.clientId);
      const all = new Set<string>(this.globalPeers);
      if (self) all.add(self);
      for (const p of this.discoveredPeers) all.add(p);
      const payload = JSON.stringify({ __membership: true, peers: Array.from(all) });
      try {
        this.signalingClient?.send(toPeerId, payload);
      } catch {
        // best-effort
      }
    }

    private tryParseMembership(raw: any): { peers: string[] } | null {
      try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (obj?.__membership === true && Array.isArray(obj.peers)) {
          return { peers: obj.peers };
        }
      } catch {
        // not a membership message
      }
      return null;
    }

    private mergeMembership(incoming: string[], fromPeerId: string): void {
      let changed = false;
      for (const raw of incoming) {
        const id = this.normalizePeerId(raw);
        if (!id || this.isSelfAlias(id)) continue;
        if (!this.globalPeers.has(id)) {
          this.globalPeers.add(id);
          changed = true;
          this.addDiscoveredPeer(id);
        }
      }
      if (changed) {
        this.emit('mesh:membership', Array.from(this.globalPeers));
        for (const peerId of this.getConnectedPeers()) {
          if (peerId !== fromPeerId) {
            this.sendMembership(peerId);
          }
        }
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    }

    private removeFromGlobalMembership(peerId: string): void {
      const removed = this.globalPeers.delete(peerId);
      if (!removed) return;
      this.emit('mesh:membership', Array.from(this.globalPeers));
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
    this.peerConnectedAtMs.clear();
    this.rebalanceAttemptAtMs.clear();
    this.pendingRebalanceDropByTarget.clear();
    this.globalPeers.clear();
    this.selfAliases.clear();
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

export default PartialMesh;

export { GossipProtocol } from './gossip.js';
export type { GossipMessage, GossipProtocolOptions, GossipStats } from './gossip.js';
export { PeerPigeonStorage } from './storage.js';
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
