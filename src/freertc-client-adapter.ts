import { createSignalingClient, withdrawSignalingIdentity } from 'freertc/client';

type Handler = (...args: any[]) => void;

const RECOVERY_PROBE_TIMEOUT_MS = 5_000;
const SIGNALING_HEALTH_INTERVAL_MS = 15_000;
const DISCOVERY_ABSENCE_GRACE_MS = 30_000;
const DISCOVERY_ACTIVE_MAX_AGE_MS = 18_000;

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
  private readonly previousPeerSignalUrls: readonly string[];
  private readonly defaultIceServers: RTCIceServer[] | null;
  private readonly trickleIce: boolean;
  private readonly emitter = new Emitter();
  private readonly knownPeers = new Set<string>();
  private readonly knownPeerLastSeenAtMs = new Map<string, number>();
  private readonly knownPeerAdvertisedAtMs = new Map<string, number>();
  private readonly failedPeerAdvertisementAtMs = new Map<string, number>();
  private readonly selfAliases = new Set<string>();
  private readonly connectedPeers = new Set<string>();
  private readonly pendingTransportRestorePeerIds = new Set<string>();
  private readonly recoveringPeerIds = new Set<string>();
  private readonly observedDataChannels = new WeakSet<object>();
  private client: any = null;
  private joinedOnce = false;
  private intentionallyDisconnected = false;
  private signalingConnected = false;
  private recoveryProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private signalingHealthTimer: ReturnType<typeof setInterval> | null = null;
  private lastBootstrapAtMs = 0;
  private recyclingSignalingTransport = false;
  private waitingForTransportClose = false;
  private clientGeneration = 0;
  private lifecycleListenersAttached = false;
  private previousIdentityWithdrawalStarted = false;
  private previousIdentityWithdrawalHandles: Array<{ close(): void }> = [];

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
    previousPeerSignalUrls?: string[];
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
    this.previousPeerSignalUrls = Array.from(new Set(
      (options?.previousPeerSignalUrls?.length ? options.previousPeerSignalUrls : normalizedSignalUrls)
        .map((url) => String(url || '').trim())
        .filter(Boolean)
    ));
    this.retiredPeerIds = Array.from(new Set(
      (options?.retiredPeerIds ?? [])
        .map((peerId) => this.normalizePeerId(peerId))
        .filter((peerId) => peerId && peerId !== this.requestedPeerId)
    ));
    this.defaultIceServers = options?.iceServers ?? null;
    this.trickleIce = options?.trickleIce ?? true;
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

  private emitConnectedIfNeeded(signalUrl = this.activeSignalUrl): void {
    const wasConnected = this.signalingConnected;
    this.signalingConnected = true;
    if (!wasConnected) {
      this.emitter.emit('connected', {
        clientId: this.requestedPeerId,
        requestedClientId: this.requestedPeerId,
        previousClientId: this.previousPeerId,
        signalUrl,
      });
    }
    this.startSignalingHealthLoop();
  }

  private ensureRegistrationRecoveryProbe(reason: string): void {
    if (this.recoveryProbeTimer || this.intentionallyDisconnected) return;
    this.emitter.emit('signaling:log', {
      message: `[signal] ${reason}: waiting for registration acknowledgement`,
    });
    this.startRecoveryProbe(`${reason} registration`, true);
  }

  private withdrawPreviousIdentity(): void {
    if (this.previousIdentityWithdrawalStarted || !this.previousPeerId) return;
    this.previousIdentityWithdrawalStarted = true;
    for (const signalUrl of this.previousPeerSignalUrls) {
      try {
        this.previousIdentityWithdrawalHandles.push(withdrawSignalingIdentity({
          peerId: this.previousPeerId,
          networkId: this.networkId,
          roomId: this.roomId,
          signalUrl,
          reason: 'peer_reload',
        }));
        this.emitter.emit('signaling:log', {
          message: `[signal] withdrawing previous reload identity ${this.previousPeerId.slice(0, 8)} from ${signalUrl}`,
        });
      } catch {
        // The relay lease remains the final fallback if cleanup cannot connect.
      }
    }
  }

  connect(): void {
    this.intentionallyDisconnected = false;
    this.attachLifecycleListeners();
    this.startSignalingHealthLoop();
    this.withdrawPreviousIdentity();
    if (this.client) {
      if (this.client.isRegistered) {
        this.emitConnectedIfNeeded();
        this.nudgeSignaling();
        return;
      }
      this.ensureRegistrationRecoveryProbe('connect');
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
      trickleIce: this.trickleIce,
      autoConnect: false,
      onLog: (message: string) => {
        if (!isCurrentClient()) return;
        this.emitter.emit('signaling:log', { message: String(message ?? '') });
      },
      onRegistered: () => {
        if (!isCurrentClient()) return;
        this.emitConnectedIfNeeded(signalUrl);
        // The relay can accept offers as soon as registration is acknowledged;
        // do not wait for a later discovery snapshot to release replacement dials.
        this.flushPendingTransportRestoreFailures();
        this.startRecoveryProbe('registration', false);
        nextClient?.requestBootstrap?.(Array.from(this.selfAliases));
      },
      onBootstrap: (candidates: any[]) => {
        if (!isCurrentClient()) return;
        this.lastBootstrapAtMs = Date.now();
        this.clearRecoveryProbeTimer();
        this.handleBootstrapCandidates(candidates);
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
        this.handleNegotiationFailure(data);
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
    this.ensureRegistrationRecoveryProbe('initial connect');
    nextClient.connect();
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    this.signalingConnected = false;
    this.detachLifecycleListeners();
    this.clearRecoveryProbeTimer();
    this.stopSignalingHealthLoop();
    this.clientGeneration += 1;
    this.clearDisconnectGraceTimers();
    for (const handle of this.previousIdentityWithdrawalHandles) {
      try { handle.close(); } catch { /* best effort */ }
    }
    this.previousIdentityWithdrawalHandles = [];
    try { this.client?.disconnect?.(); } catch { /* best effort */ }
    this.client = null;
    this.connectedPeers.clear();
    this.pendingTransportRestorePeerIds.clear();
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.knownPeers.clear();
    this.knownPeerLastSeenAtMs.clear();
    this.knownPeerAdvertisedAtMs.clear();
    this.failedPeerAdvertisementAtMs.clear();
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

    // A suspended browser can wake after every prior deadline has expired.
    // Clear all recovery guards and retry delays before inspecting transports.
    this.clearRecoveryProbeTimer();
    this.recoveringPeerIds.clear();
    this.pendingTransportRestorePeerIds.clear();
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.lastBootstrapAtMs = 0;
    this.client?.resetRecoveryBackoffs?.();
    // Notify PartialMesh so it can reset stale-age baselines. FreeRTC retains
    // ownership of restoration; this event must not trigger immediate redials.
    this.emitter.emit('lifecycle:resume', { reason });

    for (const peerId of Array.from(this.connectedPeers)) {
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      const connectionState = String(entry?.connection?.connectionState ?? entry?.state ?? '').toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? '').toLowerCase();

      if (!entry || channelState !== 'open' || connectionState === 'failed' || connectionState === 'closed' || connectionState === 'dead') {
        this.releaseStalePeerImmediately(peerId);
        continue;
      }

      if (connectionState === 'disconnected' || connectionState === 'recovering') {
        this.releaseStalePeerImmediately(peerId);
      }
    }

    if (!this.client?.isRegistered) {
      this.emitter.emit('signaling:log', { message: `[signal] ${reason} recovery: reconnecting signaling` });
      this.ensureRegistrationRecoveryProbe(reason);
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
    const entry = this.client?.mesh?.connections?.get?.(id);
    this.client?.mesh?.connections?.delete?.(id);
    const wasConnected = this.connectedPeers.delete(id);
    try { entry?.channel?.close?.(); } catch { /* best effort */ }
    try { entry?.connection?.close?.(); } catch { /* best effort */ }
    if (entry || wasConnected) {
      this.emitter.emit('rtc:disconnected', { peerId: id });
    }
  }

  send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void {
    try {
      this.client?.sendData(data, peerId);
    } catch (error) {
      this.releaseStalePeerImmediately(this.normalizePeerId(peerId));
      throw error;
    }
  }

  broadcast(data: string | ArrayBuffer | ArrayBufferView): void {
    for (const peerId of Array.from(this.connectedPeers)) {
      try {
        this.client?.sendData(data, peerId);
      } catch {
        // A synchronous send failure is already proof that this edge is not
        // usable. Release it now so the mesh can replace it immediately.
        this.releaseStalePeerImmediately(peerId);
      }
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
    const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        peerId: this.normalizePeerId(candidate?.peerId),
        advertisedAt: Number(candidate?.advertisedAt),
      }))
      .filter(({ peerId }) => peerId && !this.isSelfAlias(peerId));
    const snapshotPeers = new Set<string>(normalizedCandidates.map(({ peerId }) => peerId));
    const activeSnapshotPeers = new Set<string>();
    for (const { peerId, advertisedAt } of normalizedCandidates) {
      this.knownPeerLastSeenAtMs.set(peerId, now);
      if (Number.isFinite(advertisedAt)) {
        const previous = this.knownPeerAdvertisedAtMs.get(peerId) ?? Number.NEGATIVE_INFINITY;
        this.knownPeerAdvertisedAtMs.set(peerId, Math.max(previous, advertisedAt));
      }

      const failedAdvertisementAt = this.failedPeerAdvertisementAtMs.get(peerId);
      const hasNewAdvertisement = failedAdvertisementAt == null
        || (Number.isFinite(advertisedAt) && advertisedAt > failedAdvertisementAt);
      const isFresh = !Number.isFinite(advertisedAt)
        || now - advertisedAt <= DISCOVERY_ACTIVE_MAX_AGE_MS;
      if (hasNewAdvertisement && isFresh) {
        activeSnapshotPeers.add(peerId);
        if (failedAdvertisementAt != null) this.failedPeerAdvertisementAtMs.delete(peerId);
      }
    }

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
        this.knownPeerAdvertisedAtMs.delete(peerId);
        this.failedPeerAdvertisementAtMs.delete(peerId);
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
    // Keep the grace-preserved membership list for continuity, but also expose
    // the relay's current snapshot. PartialMesh uses the latter for dial
    // selection so a suspended peer cannot occupy every recovery slot while
    // currently announced alternatives are available.
    this.emitter.emit('peers-updated', {
      peers: peerList,
      activePeers: Array.from(activeSnapshotPeers),
    });
  }

  private handleConnectionState(data: { peerId?: string; state?: string }): void {
    if (this.recyclingSignalingTransport || this.pendingTransportRestorePeerIds.size > 0) return;
    const peerId = this.normalizePeerId(data?.peerId);
    const state = String(data?.state ?? '').toLowerCase();
    if (!peerId || this.isSelfAlias(peerId)) {
      if (peerId) this.closeConnection(peerId);
      return;
    }

    if (state === 'connecting') {
      // A fresh FreeRTC generation now owns this peer ID. Allow its own
      // failure/close events to trigger another immediate replacement.
      this.recoveringPeerIds.delete(peerId);
      // FreeRTC creates responder transports before a data channel exists.
      // Surface that pending transport so PartialMesh counts it as owned
      // instead of misclassifying every inbound negotiation as an orphan.
      this.emitter.emit('rtc:connecting', { peerId });
      return;
    }
    if (state === 'connected') {
      this.recoveringPeerIds.delete(peerId);
      this.failedPeerAdvertisementAtMs.delete(peerId);
      this.waitForOpenDataChannel(peerId);
      return;
    }
    if (state === 'disconnected' || state === 'recovering') {
      this.markPeerTransportStale(peerId);
      return;
    }
    if (state === 'failed' || state === 'closed') {
      this.markPeerTransportStale(peerId);
    }
  }

  private handleNegotiationFailure(data: { peerId?: string; reason?: string }): void {
    const peerId = this.normalizePeerId(data?.peerId);
    const reason = String(data?.reason ?? 'unknown');
    this.emitter.emit('signaling:log', {
      message: `[webrtc] ${peerId} negotiation failed: ${reason}`,
    });
    if (!peerId || this.isSelfAlias(peerId)) return;

    // Replaying the same discovery row is not evidence that a target recovered.
    // Require a newer relay heartbeat before this failed peer becomes active
    // again, otherwise every discovery refresh recreates the exhausted offer.
    this.failedPeerAdvertisementAtMs.set(
      peerId,
      this.knownPeerAdvertisedAtMs.get(peerId) ?? Date.now(),
    );

    // Surface terminal ownership failure separately from an ordinary close so
    // the mesh can quarantine this exact candidate while rotating to another.
    this.emitter.emit('rtc:negotiation-failed', { peerId, reason });

    // FreeRTC emits this only after it has exhausted ownership of the current
    // negotiation. Release that dead generation immediately so PartialMesh can
    // remove its pending dial and use a fresh discovery candidate instead of
    // waiting for a browser-specific connection-state event or the 45s guard.
    this.releaseStalePeerImmediately(peerId, true);
  }

  private markPeerTransportStale(peerId: string): void {
    this.releaseStalePeerImmediately(peerId);
  }

  private observeDataChannel(peerId: string, channel: any): void {
    if (!channel || (typeof channel !== 'object' && typeof channel !== 'function')) return;
    if (this.observedDataChannels.has(channel)) return;
    this.observedDataChannels.add(channel);
    channel.addEventListener?.('open', () => {
      const current = this.client?.mesh?.connections?.get?.(peerId);
      if (current?.channel !== channel || channel.readyState !== 'open') return;
      this.activateOpenDataChannel(peerId, channel);
    }, { once: true });
    channel.addEventListener?.('close', () => {
      const current = this.client?.mesh?.connections?.get?.(peerId);
      if (this.intentionallyDisconnected || current?.channel !== channel) return;
      this.markPeerTransportStale(peerId);
    }, { once: true });
  }

  private activateOpenDataChannel(peerId: string, channel: any): void {
    const current = this.client?.mesh?.connections?.get?.(peerId);
    if (current?.channel !== channel || channel?.readyState !== 'open') return;
    this.observeDataChannel(peerId, channel);
    if (this.connectedPeers.has(peerId)) return;
    this.connectedPeers.add(peerId);
    this.emitter.emit('rtc:connected', { peerId });
  }

  private releaseStalePeerImmediately(peerId: string, forceNotify = false): void {
    if (this.intentionallyDisconnected) return;
    if (this.recoveringPeerIds.has(peerId) && !forceNotify) return;
    const entry = this.client?.mesh?.connections?.get?.(peerId);
    const wasConnected = this.connectedPeers.has(peerId);
    if (!entry && !wasConnected && !forceNotify) return;

    this.recoveringPeerIds.add(peerId);
    this.client?.mesh?.connections?.delete?.(peerId);
    this.connectedPeers.delete(peerId);
    try { entry?.channel?.close?.(); } catch { /* best effort */ }
    try { entry?.connection?.close?.(); } catch { /* best effort */ }

    this.emitter.emit('signaling:log', {
      message: `[webrtc] stale transport to ${peerId} released immediately; redialing`,
    });
    this.nudgeSignaling();
    this.emitter.emit('rtc:disconnected', { peerId });
    this.client?.requestBootstrap?.(Array.from(this.selfAliases));
  }

  private waitForOpenDataChannel(peerId: string): void {
    if (this.connectedPeers.has(peerId)) return;
    const entry = this.client?.mesh?.connections?.get?.(peerId);
    const failed = !entry
      || entry?.connection?.connectionState === 'failed'
      || entry?.connection?.connectionState === 'closed';
    if (failed) {
      this.releaseStalePeerImmediately(peerId);
      return;
    }
    if (!entry.channel) return;
    this.observeDataChannel(peerId, entry.channel);
    this.activateOpenDataChannel(peerId, entry.channel);
  }

  private clearDisconnectGraceTimer(peerId: string): void {
    this.recoveringPeerIds.delete(peerId);
  }

  private clearDisconnectGraceTimers(): void {
    this.recoveringPeerIds.clear();
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
        this.ensureRegistrationRecoveryProbe('health check');
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

  private recycleStaleSignalingTransport(reason: string): void {
    if (this.intentionallyDisconnected || this.recyclingSignalingTransport || !this.client) return;
    this.recyclingSignalingTransport = true;
    this.signalingConnected = false;
    this.clearRecoveryProbeTimer();
    this.clearDisconnectGraceTimers();

    if (typeof this.client.reconnectSignaling === 'function') {
      this.waitingForTransportClose = false;
      this.emitter.emit('signaling:log', {
        message: `[signal] ${reason}: relay did not acknowledge; reconnecting signaling without closing peer channels`,
      });
      try {
        this.ensureRegistrationRecoveryProbe('transport reconnect');
        this.client.reconnectSignaling(reason);
        this.recyclingSignalingTransport = false;
      } catch (error) {
        this.recyclingSignalingTransport = false;
        this.clearRecoveryProbeTimer();
        this.emitter.emit('error', error);
      }
      return;
    }

    // Compatibility fallback for an older FreeRTC client. Only a fully
    // isolated peer may use the legacy full disconnect, because it tears down
    // every WebRTC edge as well as signaling.
    if (this.connectedPeers.size > 0) {
      this.recyclingSignalingTransport = false;
      this.emitter.emit('signaling:log', {
        message: `[signal] ${reason}: relay acknowledgement missing; preserving healthy peer channels and refreshing discovery`,
      });
      this.nudgeSignaling();
      return;
    }

    this.waitingForTransportClose = true;
    this.emitter.emit('signaling:log', {
      message: `[signal] ${reason}: relay did not acknowledge; recycling stale transport in the same FreeRTC client`,
    });
    try {
      this.client.disconnect?.();
    } catch {
      this.resumeSameClientTransport();
      return;
    }
    // disconnect() has already completed local teardown; do not wait for a
    // close event from a potentially zombie socket before reopening.
    this.resumeSameClientTransport();
  }

  private resumeSameClientTransport(): void {
    if (!this.recyclingSignalingTransport || !this.waitingForTransportClose || this.intentionallyDisconnected) return;
    this.waitingForTransportClose = false;
    this.recyclingSignalingTransport = false;
    this.emitter.emit('signaling:log', {
      message: '[signal] reconnecting stale transport with existing FreeRTC client',
    });
    try {
      this.ensureRegistrationRecoveryProbe('transport reconnect');
      this.client?.connect?.();
    } catch (error) {
      this.clearRecoveryProbeTimer();
      this.emitter.emit('error', error);
    }
  }

  private flushPendingTransportRestoreFailures(): void {
    if (!this.recyclingSignalingTransport && this.pendingTransportRestorePeerIds.size === 0) return;
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
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
