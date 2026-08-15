import { createSignalingClient } from 'freertc/client';

type Handler = (...args: any[]) => void;

const RTC_REANNOUNCE_GRACE_MS = 12_000;
const RTC_REDIAL_GRACE_MS = 20_000;
const RECOVERY_PROBE_TIMEOUT_MS = 5_000;
const RECOVERY_PROBE_THROTTLE_MS = 1_500;
const SIGNALING_HEALTH_INTERVAL_MS = 15_000;
const SIGNALING_RECONNECT_FALLBACK_MS = 1_000;
const DISCOVERY_ABSENCE_GRACE_MS = 30_000;

function generateMessageId(bytesLength = 8): string {
  const bytes = new Uint8Array(bytesLength);
  const webCrypto = globalThis.window?.crypto ?? globalThis.crypto;
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

class Emitter {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  emit(event: string, ...args: any[]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch {
        // Do not let one consumer interrupt signaling lifecycle delivery.
      }
    }
  }
}

/**
 * Compatibility adapter around the FreeRTC GitHub client's public API.
 * PartialMesh keeps its existing event surface while signaling, federation,
 * negotiation, keepalive, and reconnect behavior come from freertc/client.
 */
export class FreeRTCClientAdapter {
  private readonly signalUrls: readonly string[];
  private readonly networkId: string;
  private readonly roomId: string;
  private readonly requestedPeerId: string;
  private readonly previousPeerId: string | null;
  private readonly retiredPeerIds: string[];
  private readonly defaultIceServers: RTCIceServer[] | null;
  private readonly emitter = new Emitter();
  private readonly knownPeers = new Set<string>();
  private readonly knownPeerLastSeenAtMs = new Map<string, number>();
  private readonly selfAliases = new Set<string>();
  private readonly connectedPeers = new Set<string>();
  private readonly pendingTransportRestorePeerIds = new Set<string>();
  private readonly openChannelTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly disconnectGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly peerRecoveryReannounced = new Set<string>();
  private client: any = null;
  private joinedOnce = false;
  private intentionallyDisconnected = false;
  private signalingConnected = false;
  private recoveryProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private signalingHealthTimer: ReturnType<typeof setInterval> | null = null;
  private signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRecoveryProbeAtMs = 0;
  private lastBootstrapAtMs = 0;
  private recyclingSignalingTransport = false;
  private waitingForTransportClose = false;
  private clientGeneration = 0;
  private lifecycleListenersAttached = false;

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) return;
    this.recoverAfterInactivity('visible');
  };

  private readonly handleWindowFocus = (): void => {
    this.recoverAfterInactivity('focus');
  };

  private readonly handleWindowOnline = (): void => {
    this.recoverAfterInactivity('online');
  };

  private readonly handlePageShow = (): void => {
    this.recoverAfterInactivity('pageshow');
  };

  constructor(signalUrls: string | readonly string[], options?: {
    networkId?: string;
    roomId?: string;
    peerId?: string;
    previousPeerId?: string | null;
    retiredPeerIds?: string[];
    iceServers?: RTCIceServer[] | null;
    trickleIce?: boolean;
  }) {
    const normalizedSignalUrls = Array.from(new Set(
      (Array.isArray(signalUrls) ? signalUrls : [signalUrls])
        .map((url) => String(url || '').trim())
        .filter(Boolean)
    ));
    if (normalizedSignalUrls.length === 0) {
      throw new Error('At least one FreeRTC signaling relay is required');
    }
    this.signalUrls = normalizedSignalUrls;
    this.networkId = options?.networkId ?? 'default-session';
    this.roomId = options?.roomId ?? this.networkId;
    this.requestedPeerId = options?.peerId ?? generateMessageId(32);
    this.previousPeerId = this.normalizePeerId(options?.previousPeerId) || null;
    this.retiredPeerIds = Array.from(new Set(
      (options?.retiredPeerIds ?? [])
        .map((peerId) => this.normalizePeerId(peerId))
        .filter((peerId) => peerId && peerId !== this.requestedPeerId)
    ));
    this.defaultIceServers = options?.iceServers ?? null;
    this.addSelfAlias(this.requestedPeerId);
    this.addSelfAlias(this.previousPeerId);
    for (const peerId of this.retiredPeerIds) this.addSelfAlias(peerId);
  }

  on(event: string, handler: Handler): void {
    this.emitter.on(event, handler);
  }

  private get activeSignalUrl(): string {
    return this.signalUrls[0];
  }

  connect(): void {
    this.intentionallyDisconnected = false;
    this.attachLifecycleListeners();
    if (this.client) {
      this.client.connect?.();
      return;
    }

    const generation = ++this.clientGeneration;
    const signalUrl = this.activeSignalUrl;
    let nextClient: any = null;
    const isCurrentClient = (): boolean => (
      this.clientGeneration === generation && !this.intentionallyDisconnected
    );
    nextClient = createSignalingClient({
      peerId: this.requestedPeerId,
      networkId: this.networkId,
      roomId: this.roomId,
      signalUrl,
      iceServers: this.defaultIceServers ?? undefined,
      autoConnect: false,
      onLog: (message: string) => {
        if (!isCurrentClient()) return;
        this.emitter.emit('signaling:log', { message: String(message ?? '') });
      },
      onRegistered: () => {
        if (!isCurrentClient()) return;
        this.signalingConnected = true;
        this.emitter.emit('connected', {
          clientId: this.requestedPeerId,
          requestedClientId: this.requestedPeerId,
          previousClientId: this.previousPeerId,
          signalUrl,
        });
        this.startSignalingHealthLoop();
        this.startRecoveryProbe('registration', false);
        nextClient?.requestBootstrap?.(Array.from(this.selfAliases));
      },
      onBootstrap: (candidates: any[]) => {
        if (!isCurrentClient()) return;
        this.lastBootstrapAtMs = Date.now();
        this.clearRecoveryProbeTimer();
        this.handleBootstrapCandidates(candidates);
        this.flushPendingTransportRestoreFailures();
      },
      onConnectionStateChange: (data: { peerId?: string; state?: string }) => {
        if (!isCurrentClient()) return;
        this.handleConnectionState(data);
      },
      onDataMessage: (data: { peerId: string; data: any }) => {
        if (!isCurrentClient()) return;
        const peerId = this.normalizePeerId(data?.peerId);
        if (!peerId || this.isSelfAlias(peerId)) return;
        this.emitter.emit('rtc:data', { peerId, data: data.data });
      },
      onNegotiationFailure: (data: { peerId?: string; reason?: string }) => {
        if (!isCurrentClient()) return;
        this.emitter.emit('signaling:log', {
          message: `[webrtc] ${this.normalizePeerId(data?.peerId)} negotiation failed: ${String(data?.reason ?? 'unknown')}`
        });
      },
      onStatusChange: (status: string) => {
        if (!isCurrentClient()) return;
        const normalizedStatus = String(status).toLowerCase();
        this.emitter.emit('signaling:log', {
          message: `[signal] FreeRTC ${normalizedStatus} on ${signalUrl}`,
        });
        if (normalizedStatus === 'connected' || normalizedStatus === 'connecting' || normalizedStatus === 'error') return;
        if (!normalizedStatus.startsWith('disconnected')) return;
        const wasConnected = this.signalingConnected;
        this.signalingConnected = false;
        if (this.recyclingSignalingTransport) {
          if (wasConnected) this.emitter.emit('disconnected');
          this.resumeSameClientTransport();
          return;
        }
        if (wasConnected && !this.intentionallyDisconnected) {
          this.emitter.emit('disconnected');
        }
      }
    });

    this.client = nextClient;
    this.emitter.emit('signaling:log', { message: `[signal] trying relay ${signalUrl}` });
    nextClient.connect();
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    this.signalingConnected = false;
    this.detachLifecycleListeners();
    this.clearRecoveryProbeTimer();
    this.stopSignalingHealthLoop();
    this.clearSignalingReconnectTimer();
    this.clientGeneration += 1;
    this.clearOpenChannelTimers();
    this.clearDisconnectGraceTimers();
    try { this.client?.disconnect?.(); } catch { /* best effort */ }
    this.client = null;
    this.connectedPeers.clear();
    this.pendingTransportRestorePeerIds.clear();
    this.knownPeers.clear();
    this.knownPeerLastSeenAtMs.clear();
    this.joinedOnce = false;
  }

  isConnected(): boolean {
    return Boolean(this.client?.isRegistered);
  }

  joinSession(sessionId: string): void {
    if (sessionId && sessionId !== this.roomId) {
      this.emitter.emit('error', new Error('FreeRTC adapter does not support changing room after initialization'));
      return;
    }
    this.client?.requestBootstrap?.(Array.from(this.selfAliases));
  }

  async initiateConnection(peerId: string, iceServers?: RTCIceServer[] | null): Promise<void> {
    const id = this.normalizePeerId(peerId);
    if (!id || this.isSelfAlias(id)) {
      throw new Error('Cannot connect to a current or retired local peer ID');
    }
    if (!this.client?.isRegistered) {
      throw new Error('Not connected');
    }
    await this.client.initiateConnection(id, iceServers ?? this.defaultIceServers ?? undefined);
  }

  nudgeSignaling(): void {
    this.client?.advertise?.({});
    this.client?.requestBootstrap?.(Array.from(this.selfAliases));
  }

  /**
   * Revalidate signaling and RTC transports after a tab resumes, regains focus,
   * or the browser reports that the network is online again.
   */
  recoverAfterInactivity(reason = 'resume'): boolean {
    if (this.intentionallyDisconnected) return false;

    const now = Date.now();
    if (now - this.lastRecoveryProbeAtMs < RECOVERY_PROBE_THROTTLE_MS) return false;
    this.lastRecoveryProbeAtMs = now;
    // Notify PartialMesh so it can reset stale-age baselines. FreeRTC retains
    // ownership of restoration; this event must not trigger immediate redials.
    this.emitter.emit('lifecycle:resume', { reason });

    for (const peerId of Array.from(this.connectedPeers)) {
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      const connectionState = String(entry?.connection?.connectionState ?? entry?.state ?? '').toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? '').toLowerCase();

      if (!entry || channelState !== 'open' || connectionState === 'failed' || connectionState === 'closed' || connectionState === 'dead') {
        this.scheduleDisconnectedPeerRecovery(peerId);
        continue;
      }

      if (connectionState === 'disconnected' || connectionState === 'recovering') {
        this.scheduleDisconnectedPeerRecovery(peerId);
      }
    }

    if (!this.client?.isRegistered) {
      this.emitter.emit('signaling:log', { message: `[signal] ${reason} recovery: reconnecting signaling` });
      this.client?.connect?.();
      return true;
    }

    this.emitter.emit('signaling:log', { message: `[signal] ${reason} recovery: refreshing discovery` });
    this.startRecoveryProbe(reason, true);
    this.nudgeSignaling();
    return true;
  }

  closeConnection(peerId: string): void {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.clearDisconnectGraceTimer(id);
    this.clearOpenChannelTimer(id);
    const entry = this.client?.mesh?.connections?.get?.(id);
    this.client?.mesh?.connections?.delete?.(id);
    const wasConnected = this.connectedPeers.delete(id);
    try { entry?.channel?.close?.(); } catch { /* best effort */ }
    try { entry?.connection?.close?.(); } catch { /* best effort */ }
    if (wasConnected) {
      this.emitter.emit('rtc:disconnected', { peerId: id });
    }
  }

  send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void {
    this.client?.sendData(data, peerId);
  }

  broadcast(data: string | ArrayBuffer | ArrayBufferView): void {
    for (const peerId of this.connectedPeers) {
      try { this.client?.sendData(data, peerId); } catch { /* isolate peer send failures */ }
    }
  }

  private normalizePeerId(peerId: string | null | undefined): string {
    return String(peerId ?? '').trim();
  }

  private addSelfAlias(peerId: string | null | undefined): void {
    const id = this.normalizePeerId(peerId);
    if (id) this.selfAliases.add(id);
  }

  private isSelfAlias(peerId: string | null | undefined): boolean {
    const id = this.normalizePeerId(peerId);
    return Boolean(id && this.selfAliases.has(id));
  }

  private handleBootstrapCandidates(candidates: any[]): void {
    const now = Date.now();
    const snapshotPeers = new Set<string>(
      (Array.isArray(candidates) ? candidates : [])
        .map((candidate) => this.normalizePeerId(candidate?.peerId))
        .filter((peerId) => peerId && !this.isSelfAlias(peerId))
    );
    for (const peerId of snapshotPeers) this.knownPeerLastSeenAtMs.set(peerId, now);

    // A freshly re-announced peer can briefly receive an empty relay-local
    // snapshot before federation converges. Preserve recently seen peers for
    // one announcement lease instead of collapsing discovery to zero.
    const nextPeers = new Set(snapshotPeers);
    for (const peerId of this.knownPeers) {
      if (snapshotPeers.has(peerId)) continue;
      const lastSeenAt = this.knownPeerLastSeenAtMs.get(peerId) ?? now;
      if (now - lastSeenAt < DISCOVERY_ABSENCE_GRACE_MS) {
        nextPeers.add(peerId);
      } else {
        this.knownPeerLastSeenAtMs.delete(peerId);
        this.emitter.emit('peer-left', { peerId });
      }
    }
    const peerList = Array.from(nextPeers);

    if (!this.joinedOnce) {
      this.joinedOnce = true;
      this.emitter.emit('joined', { sessionId: this.roomId, clients: peerList });
    }
    for (const peerId of peerList) {
      if (!this.knownPeers.has(peerId)) this.emitter.emit('peer-joined', { peerId });
    }
    this.knownPeers.clear();
    for (const peerId of nextPeers) this.knownPeers.add(peerId);
    this.emitter.emit('peers-updated', { peers: peerList });
  }

  private handleConnectionState(data: { peerId?: string; state?: string }): void {
    if (this.recyclingSignalingTransport) return;
    const peerId = this.normalizePeerId(data?.peerId);
    const state = String(data?.state ?? '').toLowerCase();
    if (!peerId || this.isSelfAlias(peerId)) {
      if (peerId) this.closeConnection(peerId);
      return;
    }

    if (state === 'connected') {
      this.clearDisconnectGraceTimer(peerId);
      this.waitForOpenDataChannel(peerId);
      return;
    }
    if (state === 'disconnected' || state === 'recovering') {
      this.scheduleDisconnectedPeerRecovery(peerId);
      return;
    }
    if (state === 'failed' || state === 'closed') {
      // A failed/closed event can be part of FreeRTC's resume restoration.
      // Defer the PeerPigeon disconnect until the restore grace expires.
      this.scheduleDisconnectedPeerRecovery(peerId);
    }
  }

  private scheduleDisconnectedPeerRecovery(peerId: string): void {
    if (this.disconnectGraceTimers.has(peerId)) return;
    const delayMs = this.peerRecoveryReannounced.has(peerId)
      ? RTC_REDIAL_GRACE_MS
      : RTC_REANNOUNCE_GRACE_MS;
    const timer = setTimeout(() => {
      this.disconnectGraceTimers.delete(peerId);
      if (this.intentionallyDisconnected) return;
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      const state = String(entry?.connection?.connectionState ?? entry?.state ?? '').toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? '').toLowerCase();
      if (state === 'connected' && channelState === 'open') {
        this.peerRecoveryReannounced.delete(peerId);
        return;
      }

      if (!this.peerRecoveryReannounced.has(peerId)) {
        this.peerRecoveryReannounced.add(peerId);
        this.emitter.emit('signaling:log', {
          message: `[webrtc] connection to ${peerId} is still stale; re-announcing before redial`,
        });
        this.nudgeSignaling();
        this.scheduleDisconnectedPeerRecovery(peerId);
        return;
      }

      this.emitter.emit('signaling:log', {
        message: `[webrtc] connection to ${peerId} did not recover after re-announcement; redialing`
      });
      this.peerRecoveryReannounced.delete(peerId);
      this.closeConnection(peerId);
      this.client?.requestBootstrap?.(Array.from(this.selfAliases));
    }, delayMs);
    this.disconnectGraceTimers.set(peerId, timer);
  }

  private waitForOpenDataChannel(peerId: string): void {
    if (this.connectedPeers.has(peerId) || this.openChannelTimers.has(peerId)) return;
    const startedAt = Date.now();
    const check = () => {
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      if (entry?.channel?.readyState === 'open') {
        this.clearOpenChannelTimer(peerId);
        if (!this.connectedPeers.has(peerId)) {
          this.connectedPeers.add(peerId);
          this.emitter.emit('rtc:connected', { peerId });
        }
        return;
      }
      const restorationFailed = !entry
        || entry?.connection?.connectionState === 'failed'
        || entry?.connection?.connectionState === 'closed';
      if (restorationFailed) {
        this.clearOpenChannelTimer(peerId);
        this.scheduleDisconnectedPeerRecovery(peerId);
        return;
      }
      if (Date.now() - startedAt > 15_000) {
        this.clearOpenChannelTimer(peerId);
        this.closeConnection(peerId);
      }
    };
    const timer = setInterval(check, 50);
    this.openChannelTimers.set(peerId, timer);
    check();
  }

  private clearOpenChannelTimer(peerId: string): void {
    const timer = this.openChannelTimers.get(peerId);
    if (timer) clearInterval(timer);
    this.openChannelTimers.delete(peerId);
  }

  private clearOpenChannelTimers(): void {
    for (const timer of this.openChannelTimers.values()) clearInterval(timer);
    this.openChannelTimers.clear();
  }

  private clearDisconnectGraceTimer(peerId: string): void {
    const timer = this.disconnectGraceTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.disconnectGraceTimers.delete(peerId);
    this.peerRecoveryReannounced.delete(peerId);
  }

  private clearDisconnectGraceTimers(): void {
    for (const timer of this.disconnectGraceTimers.values()) clearTimeout(timer);
    this.disconnectGraceTimers.clear();
    this.peerRecoveryReannounced.clear();
  }

  private clearRecoveryProbeTimer(): void {
    if (this.recoveryProbeTimer) clearTimeout(this.recoveryProbeTimer);
    this.recoveryProbeTimer = null;
  }

  private startRecoveryProbe(reason: string, recycleOnTimeout: boolean): void {
    this.clearRecoveryProbeTimer();
    this.recoveryProbeTimer = setTimeout(() => {
      this.recoveryProbeTimer = null;
      if (this.intentionallyDisconnected) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (recycleOnTimeout) {
        this.recycleStaleSignalingTransport(reason);
        return;
      }
      this.emitter.emit('signaling:log', {
        message: `[signal] ${reason}: discovery stale; re-announcing without replacing FreeRTC`,
      });
      this.nudgeSignaling();
    }, RECOVERY_PROBE_TIMEOUT_MS);
  }

  private startSignalingHealthLoop(): void {
    if (this.signalingHealthTimer) return;
    this.signalingHealthTimer = setInterval(() => {
      if (this.intentionallyDisconnected || this.recyclingSignalingTransport || this.recoveryProbeTimer) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!this.client?.isRegistered) {
        this.client?.connect?.();
        return;
      }
      if (Date.now() - this.lastBootstrapAtMs < SIGNALING_HEALTH_INTERVAL_MS) return;
      this.emitter.emit('signaling:log', {
        message: '[signal] health check: awaiting relay acknowledgement',
      });
      this.startRecoveryProbe('health check', true);
      this.client?.requestBootstrap?.(Array.from(this.selfAliases));
    }, SIGNALING_HEALTH_INTERVAL_MS);
  }

  private stopSignalingHealthLoop(): void {
    if (this.signalingHealthTimer) clearInterval(this.signalingHealthTimer);
    this.signalingHealthTimer = null;
  }

  private clearSignalingReconnectTimer(): void {
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
  }

  private recycleStaleSignalingTransport(reason: string): void {
    if (this.intentionallyDisconnected || this.recyclingSignalingTransport || !this.client) return;
    this.recyclingSignalingTransport = true;
    this.waitingForTransportClose = true;
    this.signalingConnected = false;
    this.clearRecoveryProbeTimer();
    this.clearOpenChannelTimers();
    this.clearDisconnectGraceTimers();
    for (const peerId of this.connectedPeers) this.pendingTransportRestorePeerIds.add(peerId);
    this.emitter.emit('signaling:log', {
      message: `[signal] ${reason}: relay did not acknowledge; recycling stale transport in the same FreeRTC client`,
    });
    try {
      this.client.disconnect?.();
    } catch {
      this.resumeSameClientTransport();
      return;
    }
    // Some browsers do not dispatch the close event for a zombie socket.
    this.clearSignalingReconnectTimer();
    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null;
      this.resumeSameClientTransport();
    }, SIGNALING_RECONNECT_FALLBACK_MS);
  }

  private resumeSameClientTransport(): void {
    if (!this.recyclingSignalingTransport || !this.waitingForTransportClose || this.intentionallyDisconnected) return;
    this.waitingForTransportClose = false;
    this.clearSignalingReconnectTimer();
    this.emitter.emit('signaling:log', {
      message: '[signal] reconnecting stale transport with existing FreeRTC client',
    });
    try {
      this.client?.connect?.();
    } catch (error) {
      this.recyclingSignalingTransport = false;
      this.emitter.emit('error', error);
    }
  }

  private flushPendingTransportRestoreFailures(): void {
    if (!this.recyclingSignalingTransport) return;
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.clearSignalingReconnectTimer();
    for (const peerId of Array.from(this.pendingTransportRestorePeerIds)) {
      this.pendingTransportRestorePeerIds.delete(peerId);
      if (!this.connectedPeers.delete(peerId)) continue;
      this.emitter.emit('rtc:disconnected', { peerId, reason: 'signaling-transport-restore-failed' });
    }
  }

  private attachLifecycleListeners(): void {
    if (this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      document.addEventListener('resume', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.handleWindowFocus);
      window.addEventListener('online', this.handleWindowOnline);
      window.addEventListener('pageshow', this.handlePageShow);
    }
  }

  private detachLifecycleListeners(): void {
    if (!this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.removeEventListener('resume', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleWindowFocus);
      window.removeEventListener('online', this.handleWindowOnline);
      window.removeEventListener('pageshow', this.handlePageShow);
    }
  }

}

export default FreeRTCClientAdapter;
