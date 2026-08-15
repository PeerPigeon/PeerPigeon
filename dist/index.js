// src/freertc-client-adapter.ts
import { createSignalingClient } from "freertc/client";
var RTC_REANNOUNCE_GRACE_MS = 12e3;
var RTC_REDIAL_GRACE_MS = 2e4;
var RECOVERY_PROBE_TIMEOUT_MS = 5e3;
var RECOVERY_PROBE_THROTTLE_MS = 1500;
var SIGNALING_HEALTH_INTERVAL_MS = 15e3;
var SIGNALING_RECONNECT_FALLBACK_MS = 1e3;
var DISCOVERY_ABSENCE_GRACE_MS = 3e4;
function generateMessageId(bytesLength = 8) {
  const bytes = new Uint8Array(bytesLength);
  const webCrypto = globalThis.window?.crypto ?? globalThis.crypto;
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
var Emitter = class {
  constructor() {
    this.handlers = /* @__PURE__ */ new Map();
  }
  on(event, handler) {
    const set = this.handlers.get(event) ?? /* @__PURE__ */ new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  emit(event, ...args) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch {
      }
    }
  }
};
var FreeRTCClientAdapter = class {
  constructor(signalUrls, options) {
    this.emitter = new Emitter();
    this.knownPeers = /* @__PURE__ */ new Set();
    this.knownPeerLastSeenAtMs = /* @__PURE__ */ new Map();
    this.selfAliases = /* @__PURE__ */ new Set();
    this.connectedPeers = /* @__PURE__ */ new Set();
    this.pendingTransportRestorePeerIds = /* @__PURE__ */ new Set();
    this.openChannelTimers = /* @__PURE__ */ new Map();
    this.disconnectGraceTimers = /* @__PURE__ */ new Map();
    this.peerRecoveryReannounced = /* @__PURE__ */ new Set();
    this.client = null;
    this.joinedOnce = false;
    this.intentionallyDisconnected = false;
    this.signalingConnected = false;
    this.recoveryProbeTimer = null;
    this.signalingHealthTimer = null;
    this.signalingReconnectTimer = null;
    this.lastRecoveryProbeAtMs = 0;
    this.lastBootstrapAtMs = 0;
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.clientGeneration = 0;
    this.lifecycleListenersAttached = false;
    this.handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      this.recoverAfterInactivity("visible");
    };
    this.handleWindowFocus = () => {
      this.recoverAfterInactivity("focus");
    };
    this.handleWindowOnline = () => {
      this.recoverAfterInactivity("online");
    };
    this.handlePageShow = () => {
      this.recoverAfterInactivity("pageshow");
    };
    const normalizedSignalUrls = Array.from(new Set(
      (Array.isArray(signalUrls) ? signalUrls : [signalUrls]).map((url) => String(url || "").trim()).filter(Boolean)
    ));
    if (normalizedSignalUrls.length === 0) {
      throw new Error("At least one FreeRTC signaling relay is required");
    }
    this.signalUrls = normalizedSignalUrls;
    this.networkId = options?.networkId ?? "default-session";
    this.roomId = options?.roomId ?? this.networkId;
    this.requestedPeerId = options?.peerId ?? generateMessageId(32);
    this.previousPeerId = this.normalizePeerId(options?.previousPeerId) || null;
    this.retiredPeerIds = Array.from(new Set(
      (options?.retiredPeerIds ?? []).map((peerId) => this.normalizePeerId(peerId)).filter((peerId) => peerId && peerId !== this.requestedPeerId)
    ));
    this.defaultIceServers = options?.iceServers ?? null;
    this.addSelfAlias(this.requestedPeerId);
    this.addSelfAlias(this.previousPeerId);
    for (const peerId of this.retiredPeerIds) this.addSelfAlias(peerId);
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  get activeSignalUrl() {
    return this.signalUrls[0];
  }
  emitConnectedIfNeeded(signalUrl = this.activeSignalUrl) {
    const wasConnected = this.signalingConnected;
    this.signalingConnected = true;
    if (!wasConnected) {
      this.emitter.emit("connected", {
        clientId: this.requestedPeerId,
        requestedClientId: this.requestedPeerId,
        previousClientId: this.previousPeerId,
        signalUrl
      });
    }
    this.startSignalingHealthLoop();
  }
  ensureRegistrationRecoveryProbe(reason) {
    if (this.recoveryProbeTimer || this.intentionallyDisconnected) return;
    this.emitter.emit("signaling:log", {
      message: `[signal] ${reason}: waiting for registration acknowledgement`
    });
    this.startRecoveryProbe(`${reason} registration`, true);
  }
  connect() {
    this.intentionallyDisconnected = false;
    this.attachLifecycleListeners();
    this.startSignalingHealthLoop();
    if (this.client) {
      if (this.client.isRegistered) {
        this.emitConnectedIfNeeded();
        this.nudgeSignaling();
        return;
      }
      this.ensureRegistrationRecoveryProbe("connect");
      this.client.connect?.();
      return;
    }
    const generation = ++this.clientGeneration;
    const signalUrl = this.activeSignalUrl;
    let nextClient = null;
    const isCurrentClient = () => this.clientGeneration === generation && !this.intentionallyDisconnected;
    nextClient = createSignalingClient({
      peerId: this.requestedPeerId,
      networkId: this.networkId,
      roomId: this.roomId,
      signalUrl,
      iceServers: this.defaultIceServers ?? void 0,
      autoConnect: false,
      onLog: (message) => {
        if (!isCurrentClient()) return;
        this.emitter.emit("signaling:log", { message: String(message ?? "") });
      },
      onRegistered: () => {
        if (!isCurrentClient()) return;
        this.emitConnectedIfNeeded(signalUrl);
        this.startRecoveryProbe("registration", false);
        nextClient?.requestBootstrap?.(Array.from(this.selfAliases));
      },
      onBootstrap: (candidates) => {
        if (!isCurrentClient()) return;
        this.lastBootstrapAtMs = Date.now();
        this.clearRecoveryProbeTimer();
        this.handleBootstrapCandidates(candidates);
        this.flushPendingTransportRestoreFailures();
      },
      onConnectionStateChange: (data) => {
        if (!isCurrentClient()) return;
        this.handleConnectionState(data);
      },
      onDataMessage: (data) => {
        if (!isCurrentClient()) return;
        const peerId = this.normalizePeerId(data?.peerId);
        if (!peerId || this.isSelfAlias(peerId)) return;
        this.emitter.emit("rtc:data", { peerId, data: data.data });
      },
      onNegotiationFailure: (data) => {
        if (!isCurrentClient()) return;
        this.emitter.emit("signaling:log", {
          message: `[webrtc] ${this.normalizePeerId(data?.peerId)} negotiation failed: ${String(data?.reason ?? "unknown")}`
        });
      },
      onStatusChange: (status) => {
        if (!isCurrentClient()) return;
        const normalizedStatus = String(status).toLowerCase();
        this.emitter.emit("signaling:log", {
          message: `[signal] FreeRTC ${normalizedStatus} on ${signalUrl}`
        });
        if (normalizedStatus === "connected" || normalizedStatus === "connecting" || normalizedStatus === "error") return;
        if (!normalizedStatus.startsWith("disconnected")) return;
        const wasConnected = this.signalingConnected;
        this.signalingConnected = false;
        if (this.recyclingSignalingTransport) {
          if (wasConnected) this.emitter.emit("disconnected");
          this.resumeSameClientTransport();
          return;
        }
        if (wasConnected && !this.intentionallyDisconnected) {
          this.emitter.emit("disconnected");
        }
      }
    });
    this.client = nextClient;
    this.emitter.emit("signaling:log", { message: `[signal] trying relay ${signalUrl}` });
    this.ensureRegistrationRecoveryProbe("initial connect");
    nextClient.connect();
  }
  disconnect() {
    this.intentionallyDisconnected = true;
    this.signalingConnected = false;
    this.detachLifecycleListeners();
    this.clearRecoveryProbeTimer();
    this.stopSignalingHealthLoop();
    this.clearSignalingReconnectTimer();
    this.clientGeneration += 1;
    this.clearOpenChannelTimers();
    this.clearDisconnectGraceTimers();
    try {
      this.client?.disconnect?.();
    } catch {
    }
    this.client = null;
    this.connectedPeers.clear();
    this.pendingTransportRestorePeerIds.clear();
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.knownPeers.clear();
    this.knownPeerLastSeenAtMs.clear();
    this.joinedOnce = false;
  }
  isConnected() {
    return Boolean(this.client?.isRegistered);
  }
  joinSession(sessionId) {
    if (sessionId && sessionId !== this.roomId) {
      this.emitter.emit("error", new Error("FreeRTC adapter does not support changing room after initialization"));
      return;
    }
    this.client?.requestBootstrap?.(Array.from(this.selfAliases));
  }
  async initiateConnection(peerId, iceServers) {
    const id = this.normalizePeerId(peerId);
    if (!id || this.isSelfAlias(id)) {
      throw new Error("Cannot connect to a current or retired local peer ID");
    }
    if (!this.client?.isRegistered) {
      throw new Error("Not connected");
    }
    await this.client.initiateConnection(id, iceServers ?? this.defaultIceServers ?? void 0);
  }
  nudgeSignaling() {
    this.client?.advertise?.({});
    this.client?.requestBootstrap?.(Array.from(this.selfAliases));
  }
  /**
   * Revalidate signaling and RTC transports after a tab resumes, regains focus,
   * or the browser reports that the network is online again.
   */
  recoverAfterInactivity(reason = "resume") {
    if (this.intentionallyDisconnected) return false;
    const now = Date.now();
    if (now - this.lastRecoveryProbeAtMs < RECOVERY_PROBE_THROTTLE_MS) return false;
    this.lastRecoveryProbeAtMs = now;
    this.emitter.emit("lifecycle:resume", { reason });
    for (const peerId of Array.from(this.connectedPeers)) {
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      const connectionState = String(entry?.connection?.connectionState ?? entry?.state ?? "").toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? "").toLowerCase();
      if (!entry || channelState !== "open" || connectionState === "failed" || connectionState === "closed" || connectionState === "dead") {
        this.scheduleDisconnectedPeerRecovery(peerId);
        continue;
      }
      if (connectionState === "disconnected" || connectionState === "recovering") {
        this.scheduleDisconnectedPeerRecovery(peerId);
      }
    }
    if (!this.client?.isRegistered) {
      this.emitter.emit("signaling:log", { message: `[signal] ${reason} recovery: reconnecting signaling` });
      this.ensureRegistrationRecoveryProbe(reason);
      this.client?.connect?.();
      return true;
    }
    this.emitter.emit("signaling:log", { message: `[signal] ${reason} recovery: refreshing discovery` });
    this.startRecoveryProbe(reason, true);
    this.nudgeSignaling();
    return true;
  }
  closeConnection(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.clearDisconnectGraceTimer(id);
    this.clearOpenChannelTimer(id);
    const entry = this.client?.mesh?.connections?.get?.(id);
    this.client?.mesh?.connections?.delete?.(id);
    const wasConnected = this.connectedPeers.delete(id);
    try {
      entry?.channel?.close?.();
    } catch {
    }
    try {
      entry?.connection?.close?.();
    } catch {
    }
    if (wasConnected) {
      this.emitter.emit("rtc:disconnected", { peerId: id });
    }
  }
  send(peerId, data) {
    this.client?.sendData(data, peerId);
  }
  broadcast(data) {
    for (const peerId of this.connectedPeers) {
      try {
        this.client?.sendData(data, peerId);
      } catch {
      }
    }
  }
  normalizePeerId(peerId) {
    return String(peerId ?? "").trim();
  }
  addSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    if (id) this.selfAliases.add(id);
  }
  isSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    return Boolean(id && this.selfAliases.has(id));
  }
  handleBootstrapCandidates(candidates) {
    const now = Date.now();
    const snapshotPeers = new Set(
      (Array.isArray(candidates) ? candidates : []).map((candidate) => this.normalizePeerId(candidate?.peerId)).filter((peerId) => peerId && !this.isSelfAlias(peerId))
    );
    for (const peerId of snapshotPeers) this.knownPeerLastSeenAtMs.set(peerId, now);
    const nextPeers = new Set(snapshotPeers);
    for (const peerId of this.knownPeers) {
      if (snapshotPeers.has(peerId)) continue;
      const lastSeenAt = this.knownPeerLastSeenAtMs.get(peerId) ?? now;
      if (now - lastSeenAt < DISCOVERY_ABSENCE_GRACE_MS) {
        nextPeers.add(peerId);
      } else {
        this.knownPeerLastSeenAtMs.delete(peerId);
        this.emitter.emit("peer-left", { peerId });
      }
    }
    const peerList = Array.from(nextPeers);
    if (!this.joinedOnce) {
      this.joinedOnce = true;
      this.emitter.emit("joined", { sessionId: this.roomId, clients: peerList });
    }
    for (const peerId of peerList) {
      if (!this.knownPeers.has(peerId)) this.emitter.emit("peer-joined", { peerId });
    }
    this.knownPeers.clear();
    for (const peerId of nextPeers) this.knownPeers.add(peerId);
    this.emitter.emit("peers-updated", { peers: peerList });
  }
  handleConnectionState(data) {
    if (this.recyclingSignalingTransport || this.pendingTransportRestorePeerIds.size > 0) return;
    const peerId = this.normalizePeerId(data?.peerId);
    const state = String(data?.state ?? "").toLowerCase();
    if (!peerId || this.isSelfAlias(peerId)) {
      if (peerId) this.closeConnection(peerId);
      return;
    }
    if (state === "connected") {
      this.clearDisconnectGraceTimer(peerId);
      this.waitForOpenDataChannel(peerId);
      return;
    }
    if (state === "disconnected" || state === "recovering") {
      this.scheduleDisconnectedPeerRecovery(peerId);
      return;
    }
    if (state === "failed" || state === "closed") {
      this.scheduleDisconnectedPeerRecovery(peerId);
    }
  }
  scheduleDisconnectedPeerRecovery(peerId) {
    if (this.disconnectGraceTimers.has(peerId)) return;
    const delayMs = this.peerRecoveryReannounced.has(peerId) ? RTC_REDIAL_GRACE_MS : RTC_REANNOUNCE_GRACE_MS;
    const timer = setTimeout(() => {
      this.disconnectGraceTimers.delete(peerId);
      if (this.intentionallyDisconnected) return;
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      const state = String(entry?.connection?.connectionState ?? entry?.state ?? "").toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? "").toLowerCase();
      if (state === "connected" && channelState === "open") {
        this.peerRecoveryReannounced.delete(peerId);
        return;
      }
      if (!this.peerRecoveryReannounced.has(peerId)) {
        this.peerRecoveryReannounced.add(peerId);
        this.emitter.emit("signaling:log", {
          message: `[webrtc] connection to ${peerId} is still stale; re-announcing before redial`
        });
        this.nudgeSignaling();
        this.scheduleDisconnectedPeerRecovery(peerId);
        return;
      }
      this.emitter.emit("signaling:log", {
        message: `[webrtc] connection to ${peerId} did not recover after re-announcement; redialing`
      });
      this.peerRecoveryReannounced.delete(peerId);
      this.closeConnection(peerId);
      this.client?.requestBootstrap?.(Array.from(this.selfAliases));
    }, delayMs);
    this.disconnectGraceTimers.set(peerId, timer);
  }
  waitForOpenDataChannel(peerId) {
    if (this.connectedPeers.has(peerId) || this.openChannelTimers.has(peerId)) return;
    const startedAt = Date.now();
    const check = () => {
      const entry = this.client?.mesh?.connections?.get?.(peerId);
      if (entry?.channel?.readyState === "open") {
        this.clearOpenChannelTimer(peerId);
        if (!this.connectedPeers.has(peerId)) {
          this.connectedPeers.add(peerId);
          this.emitter.emit("rtc:connected", { peerId });
        }
        return;
      }
      const restorationFailed = !entry || entry?.connection?.connectionState === "failed" || entry?.connection?.connectionState === "closed";
      if (restorationFailed) {
        this.clearOpenChannelTimer(peerId);
        this.scheduleDisconnectedPeerRecovery(peerId);
        return;
      }
      if (Date.now() - startedAt > 15e3) {
        this.clearOpenChannelTimer(peerId);
        this.closeConnection(peerId);
      }
    };
    const timer = setInterval(check, 50);
    this.openChannelTimers.set(peerId, timer);
    check();
  }
  clearOpenChannelTimer(peerId) {
    const timer = this.openChannelTimers.get(peerId);
    if (timer) clearInterval(timer);
    this.openChannelTimers.delete(peerId);
  }
  clearOpenChannelTimers() {
    for (const timer of this.openChannelTimers.values()) clearInterval(timer);
    this.openChannelTimers.clear();
  }
  clearDisconnectGraceTimer(peerId) {
    const timer = this.disconnectGraceTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.disconnectGraceTimers.delete(peerId);
    this.peerRecoveryReannounced.delete(peerId);
  }
  clearDisconnectGraceTimers() {
    for (const timer of this.disconnectGraceTimers.values()) clearTimeout(timer);
    this.disconnectGraceTimers.clear();
    this.peerRecoveryReannounced.clear();
  }
  clearRecoveryProbeTimer() {
    if (this.recoveryProbeTimer) clearTimeout(this.recoveryProbeTimer);
    this.recoveryProbeTimer = null;
  }
  startRecoveryProbe(reason, recycleOnTimeout) {
    this.clearRecoveryProbeTimer();
    this.recoveryProbeTimer = setTimeout(() => {
      this.recoveryProbeTimer = null;
      if (this.intentionallyDisconnected) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (recycleOnTimeout) {
        this.recycleStaleSignalingTransport(reason);
        return;
      }
      this.emitter.emit("signaling:log", {
        message: `[signal] ${reason}: discovery stale; re-announcing without replacing FreeRTC`
      });
      this.nudgeSignaling();
    }, RECOVERY_PROBE_TIMEOUT_MS);
  }
  startSignalingHealthLoop() {
    if (this.signalingHealthTimer) return;
    this.signalingHealthTimer = setInterval(() => {
      if (this.intentionallyDisconnected || this.recyclingSignalingTransport || this.recoveryProbeTimer) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!this.client?.isRegistered) {
        this.ensureRegistrationRecoveryProbe("health check");
        this.client?.connect?.();
        return;
      }
      if (Date.now() - this.lastBootstrapAtMs < SIGNALING_HEALTH_INTERVAL_MS) return;
      this.emitter.emit("signaling:log", {
        message: "[signal] health check: awaiting relay acknowledgement"
      });
      this.startRecoveryProbe("health check", true);
      this.client?.requestBootstrap?.(Array.from(this.selfAliases));
    }, SIGNALING_HEALTH_INTERVAL_MS);
  }
  stopSignalingHealthLoop() {
    if (this.signalingHealthTimer) clearInterval(this.signalingHealthTimer);
    this.signalingHealthTimer = null;
  }
  clearSignalingReconnectTimer() {
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
  }
  recycleStaleSignalingTransport(reason) {
    if (this.intentionallyDisconnected || this.recyclingSignalingTransport || !this.client) return;
    this.recyclingSignalingTransport = true;
    this.waitingForTransportClose = true;
    this.signalingConnected = false;
    this.clearRecoveryProbeTimer();
    this.clearOpenChannelTimers();
    this.clearDisconnectGraceTimers();
    for (const peerId of this.connectedPeers) this.pendingTransportRestorePeerIds.add(peerId);
    this.emitter.emit("signaling:log", {
      message: `[signal] ${reason}: relay did not acknowledge; recycling stale transport in the same FreeRTC client`
    });
    try {
      this.client.disconnect?.();
    } catch {
      this.resumeSameClientTransport();
      return;
    }
    this.clearSignalingReconnectTimer();
    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null;
      this.resumeSameClientTransport();
    }, SIGNALING_RECONNECT_FALLBACK_MS);
  }
  resumeSameClientTransport() {
    if (!this.recyclingSignalingTransport || !this.waitingForTransportClose || this.intentionallyDisconnected) return;
    this.waitingForTransportClose = false;
    this.recyclingSignalingTransport = false;
    this.clearSignalingReconnectTimer();
    this.emitter.emit("signaling:log", {
      message: "[signal] reconnecting stale transport with existing FreeRTC client"
    });
    try {
      this.ensureRegistrationRecoveryProbe("transport reconnect");
      this.client?.connect?.();
    } catch (error) {
      this.clearRecoveryProbeTimer();
      this.emitter.emit("error", error);
    }
  }
  flushPendingTransportRestoreFailures() {
    if (!this.recyclingSignalingTransport && this.pendingTransportRestorePeerIds.size === 0) return;
    this.recyclingSignalingTransport = false;
    this.waitingForTransportClose = false;
    this.clearSignalingReconnectTimer();
    for (const peerId of Array.from(this.pendingTransportRestorePeerIds)) {
      this.pendingTransportRestorePeerIds.delete(peerId);
      if (!this.connectedPeers.delete(peerId)) continue;
      this.emitter.emit("rtc:disconnected", { peerId, reason: "signaling-transport-restore-failed" });
    }
  }
  attachLifecycleListeners() {
    if (this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      document.addEventListener("resume", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.handleWindowFocus);
      window.addEventListener("online", this.handleWindowOnline);
      window.addEventListener("pageshow", this.handlePageShow);
    }
  }
  detachLifecycleListeners() {
    if (!this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = false;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      document.removeEventListener("resume", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.handleWindowFocus);
      window.removeEventListener("online", this.handleWindowOnline);
      window.removeEventListener("pageshow", this.handlePageShow);
    }
  }
};
var freertc_client_adapter_default = FreeRTCClientAdapter;

// src/gossip.ts
var RELIABLE_REPAIR_TYPE = "pp-gossip-repair-v1";
var CECR_ID_WIDTH_BITS = 256;
var CECR_ID_HEX_LENGTH = CECR_ID_WIDTH_BITS / 4;
var CECR_ID_MAX = (1n << BigInt(CECR_ID_WIDTH_BITS)) - 1n;
var CECR_WEIGHT_DENOMINATOR = 1e6;
var MAX_RECEIPT_DELTAS_PER_SYNC = 32;
var MAX_DELIVERY_PEERS = 4096;
var MAX_REPAIR_ATTEMPTS_PER_TARGET = 3;
var DEFAULT_ANTI_ENTROPY_SUMMARY_SIZE = 256;
var DEFAULT_ANTI_ENTROPY_REQUEST_SIZE = 64;
var GossipProtocol = class {
  constructor(mesh, options = {}) {
    this.messageLog = /* @__PURE__ */ new Map();
    this.maxTrackedMessages = 12e3;
    this.maxTrackedDirectIds = 12e3;
    this.trackingRetentionMs = 10 * 6e4;
    this.cecrViewChangedAtMs = Date.now();
    this.cecrCurrentExtrema = null;
    this.cecrRemoteStates = /* @__PURE__ */ new Map();
    this.cecrSyncTimer = null;
    this.trackingCleanupTimer = null;
    this.seenDirectIds = /* @__PURE__ */ new Map();
    this.deliveryStates = /* @__PURE__ */ new Map();
    this.retainedMessages = /* @__PURE__ */ new Map();
    this.dirtyDeliveryReceiptIds = /* @__PURE__ */ new Set();
    this.gossipFanoutCursor = 0;
    this.cecrFanoutCursor = 0;
    this.antiEntropyFanoutCursor = 0;
    this.callbacks = {};
    this.peers = /* @__PURE__ */ new Map();
    this.mesh = mesh;
    this.maxHops = options.maxHops ?? 5;
    this.maxDirectHops = options.maxDirectHops ?? CECR_ID_WIDTH_BITS;
    this.cecrCoordinateWeight = Math.max(0, Math.min(1, options.cecrCoordinateWeight ?? 0.35));
    this.cecrExtremaMaxAgeMs = Math.max(1e3, options.cecrExtremaMaxAgeMs ?? 2e4);
    this.cecrRequireConsensus = options.cecrRequireConsensus ?? true;
    this.cecrConvergenceRounds = Math.max(1, Math.floor(options.cecrConvergenceRounds ?? 3));
    this.deliveryTimeoutMs = Math.max(2e3, options.deliveryTimeoutMs ?? 3e4);
    this.deliveryRepairDelayMs = Math.max(1e3, options.deliveryRepairDelayMs ?? 4e3);
    this.deliveryRepairIntervalMs = Math.max(1e3, options.deliveryRepairIntervalMs ?? 5e3);
    this.antiEntropySummarySize = Math.max(
      1,
      Math.min(this.maxTrackedMessages, Math.floor(options.antiEntropySummarySize ?? DEFAULT_ANTI_ENTROPY_SUMMARY_SIZE))
    );
    this.antiEntropyRequestSize = Math.max(
      1,
      Math.min(this.antiEntropySummarySize, Math.floor(options.antiEntropyRequestSize ?? DEFAULT_ANTI_ENTROPY_REQUEST_SIZE))
    );
    this.setupMeshListeners();
    this.startCecrSyncLoop();
    this.startTrackingCleanupLoop();
  }
  setupMeshListeners() {
    this.mesh.on("peer:data", ({ peerId, data }) => {
      const parsed = this.tryParseGossipMessage(data);
      if (!parsed) return;
      if (parsed.type === "direct") {
        this.handleIncomingDirect(parsed, peerId);
      } else if (parsed.type === "cecr-state") {
        this.handleIncomingCecrState(parsed, peerId);
      } else if (parsed.type === "cecr-dr") {
        this.handleIncomingCecrDeliveryState(parsed, peerId);
      } else if (parsed.type === "gossip-ae") {
        this.handleGossipAntiEntropy(parsed, peerId);
      } else {
        this.handleIncomingMessage(parsed, peerId);
      }
    });
    this.mesh.on("peer:connected", (peerId) => {
      this.peers.set(peerId, { connected: true, timestamp: Date.now() });
      for (const messageId of this.deliveryStates.keys()) {
        this.dirtyDeliveryReceiptIds.add(messageId);
      }
      this.publishCecrState(peerId);
      this.publishGossipAntiEntropy(peerId);
      this.emit("peerConnected", { peerId });
    });
    this.mesh.on("peer:disconnected", (peerId) => {
      this.peers.delete(peerId);
      this.cecrRemoteStates.delete(peerId);
      this.publishCecrState();
      this.emit("peerDisconnected", { peerId });
    });
  }
  startCecrSyncLoop() {
    if (this.cecrSyncTimer) return;
    this.cecrSyncTimer = setInterval(() => {
      this.maintainTrackedDeliveries();
      this.publishCecrState();
      this.publishGossipAntiEntropy();
    }, 2e3);
  }
  startTrackingCleanupLoop() {
    if (this.trackingCleanupTimer) return;
    this.trackingCleanupTimer = setInterval(() => {
      this.maintainTrackedDeliveries();
      this.pruneTracking();
    }, 3e4);
  }
  /**
   * Broadcast an application payload using gossip-style re-propagation.
   */
  broadcast(data, metadata = {}, options = {}) {
    const sender = this.mesh.getClientId();
    const connected = this.mesh.getConnectedPeers();
    const global = this.mesh.getGlobalPeers?.() ?? connected;
    const networkSize = Math.max(connected.length, global.length, 1);
    const messageId = this.generateMessageId(sender);
    let delivery;
    let deliveryPeers = null;
    if (options.trackDelivery && sender) {
      deliveryPeers = this.canonicalPeerSet();
      const senderIndex = deliveryPeers.indexOf(sender);
      const bits = this.createDeliveryBits(deliveryPeers.length);
      if (senderIndex >= 0) this.setDeliveryBit(bits, senderIndex);
      delivery = {
        setHash: this.canonicalSetHash(deliveryPeers),
        size: deliveryPeers.length,
        bits: this.deliveryBitsToHex(bits),
        deadlineAt: Date.now() + Math.max(2e3, options.deliveryTimeoutMs ?? this.deliveryTimeoutMs)
      };
    }
    const message = {
      id: messageId,
      timestamp: Date.now(),
      hops: 0,
      // Ensure messages can cross long sparse paths (e.g. saturation/rebalance chains).
      maxHops: Math.max(this.maxHops, networkSize * 2),
      sender,
      data,
      metadata,
      type: "gossip",
      ...delivery ? { delivery } : {}
    };
    this.messageLog.set(message.id, {
      timestamp: message.timestamp,
      sender: message.sender,
      hops: 0
    });
    this.retainGossipMessage(message);
    if (this.messageLog.size > this.maxTrackedMessages) {
      this.pruneTracking(message.timestamp);
    }
    if (delivery && deliveryPeers) {
      this.registerTrackedDelivery(message, deliveryPeers, true);
    }
    this.propagate(message);
    this.emit("messageReceived", { message, local: true });
    return message.id;
  }
  /**
   * Broadcast with delivery tracking enabled for the known-peer snapshot.
   */
  broadcastReliable(data, metadata = {}, options = {}) {
    return this.broadcast(data, metadata, { ...options, trackDelivery: true });
  }
  /**
   * Return the sender-visible delivery state for a tracked gossip message.
   */
  getDeliveryStatus(messageId) {
    const state = this.deliveryStates.get(messageId);
    if (!state) return null;
    return this.deliveryStatusForState(state);
  }
  /**
   * Propagate to the CECR v1 fan-out budget. Selection rotates over the
   * sorted neighbor set so every eligible connection is chosen fairly.
   */
  propagate(message, exceptPeerId) {
    const excluded = /* @__PURE__ */ new Set();
    if (message.sender) excluded.add(message.sender);
    if (exceptPeerId) excluded.add(exceptPeerId);
    const connectedPeers = this.selectFanoutPeers(excluded, "gossip");
    const deliveryState = this.deliveryStates.get(message.id);
    for (const peerId of connectedPeers) {
      const forwarded = {
        ...message,
        hops: message.hops + 1,
        ...deliveryState ? { delivery: this.deliveryEnvelopeForState(deliveryState) } : {}
      };
      try {
        this.mesh.send(peerId, JSON.stringify(forwarded));
      } catch {
      }
    }
  }
  /**
   * Handle an incoming message from the mesh.
   */
  handleIncomingMessage(message, fromPeerId) {
    const alreadySeen = this.messageLog.has(message.id);
    this.retainGossipMessage(message);
    if (message.delivery) {
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
    this.emit("messageReceived", { message, local: false, fromPeer: fromPeerId });
    if (message.hops < message.maxHops) {
      this.propagate(message, fromPeerId);
    }
  }
  // ─── Epidemic anti-entropy ────────────────────────────────────────
  retainGossipMessage(message, retainedAt = Date.now()) {
    if (this.retainedMessages.has(message.id)) return;
    try {
      const snapshot = JSON.parse(JSON.stringify(message));
      this.retainedMessages.set(message.id, { message: snapshot, retainedAt });
    } catch {
      return;
    }
    while (this.retainedMessages.size > this.maxTrackedMessages) {
      const oldest = this.retainedMessages.keys().next().value;
      if (!oldest) break;
      this.retainedMessages.delete(oldest);
    }
  }
  recentRetainedMessageIds(now = Date.now()) {
    const minRetainedAt = now - this.trackingRetentionMs;
    return Array.from(this.retainedMessages.entries()).filter(([, retained]) => retained.retainedAt >= minRetainedAt).slice(-this.antiEntropySummarySize).map(([messageId]) => messageId);
  }
  publishGossipAntiEntropy(targetPeerId) {
    const self = this.mesh.getClientId();
    if (!self) return;
    const connected = new Set(this.mesh.getConnectedPeers());
    const targets = targetPeerId && connected.has(targetPeerId) ? [targetPeerId] : this.selectFanoutPeers(/* @__PURE__ */ new Set(), "anti-entropy");
    if (targets.length === 0) return;
    const message = {
      id: this.generateMessageId(self),
      type: "gossip-ae",
      protocol: "gossip-ae/1",
      from: self,
      timestamp: Date.now(),
      mode: "summary",
      messageIds: this.recentRetainedMessageIds()
    };
    const encoded = JSON.stringify(message);
    for (const peerId of targets) {
      try {
        this.mesh.send(peerId, encoded);
      } catch {
      }
    }
  }
  handleGossipAntiEntropy(message, fromPeerId) {
    if (message.from !== fromPeerId || message.protocol !== "gossip-ae/1" || message.mode !== "summary" && message.mode !== "request" || !Array.isArray(message.messageIds)) return;
    const limit = message.mode === "summary" ? this.antiEntropySummarySize : this.antiEntropyRequestSize;
    const messageIds = Array.from(new Set(
      message.messageIds.filter((messageId) => typeof messageId === "string" && messageId.length <= 512).slice(0, limit)
    ));
    if (message.mode === "summary") {
      const missing = messageIds.filter((messageId) => !this.retainedMessages.has(messageId)).slice(0, this.antiEntropyRequestSize);
      if (missing.length === 0) return;
      const request = {
        id: this.generateMessageId(this.mesh.getClientId()),
        type: "gossip-ae",
        protocol: "gossip-ae/1",
        from: this.mesh.getClientId() ?? "",
        timestamp: Date.now(),
        mode: "request",
        messageIds: missing
      };
      if (!request.from) return;
      try {
        this.mesh.send(fromPeerId, JSON.stringify(request));
      } catch {
      }
      return;
    }
    for (const messageId of messageIds) {
      const retained = this.retainedMessages.get(messageId);
      if (!retained) continue;
      const deliveryState = this.deliveryStates.get(messageId);
      const repaired = {
        ...retained.message,
        ...deliveryState ? { delivery: this.deliveryEnvelopeForState(deliveryState) } : {}
      };
      try {
        this.mesh.send(fromPeerId, JSON.stringify(repaired));
      } catch {
      }
    }
  }
  // ─── Tracked delivery receipts ──────────────────────────────────────────
  createDeliveryBits(size) {
    return new Uint8Array(Math.ceil(Math.max(0, size) / 8));
  }
  setDeliveryBit(bits, index) {
    if (index < 0 || index >= bits.length * 8) return false;
    const byteIndex = Math.floor(index / 8);
    const mask = 1 << index % 8;
    const before = bits[byteIndex];
    bits[byteIndex] |= mask;
    return bits[byteIndex] !== before;
  }
  hasDeliveryBit(bits, index) {
    if (index < 0 || index >= bits.length * 8) return false;
    return (bits[Math.floor(index / 8)] & 1 << index % 8) !== 0;
  }
  deliveryBitsToHex(bits) {
    return Array.from(bits, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  deliveryBitsFromHex(hex, size) {
    const normalized = String(hex || "").trim().toLowerCase();
    const byteLength = Math.ceil(size / 8);
    if (!/^[0-9a-f]*$/.test(normalized) || normalized.length !== byteLength * 2) return null;
    const bits = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) {
      bits[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
    }
    return bits;
  }
  mergeDeliveryBits(target, incoming) {
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
  deliveryEnvelopeForState(state) {
    return {
      setHash: state.setHash,
      size: state.size,
      bits: this.deliveryBitsToHex(state.bits),
      deadlineAt: state.deadlineAt
    };
  }
  deliveryReceiptForState(state) {
    return {
      messageId: state.messageId,
      sender: state.sender,
      ...this.deliveryEnvelopeForState(state)
    };
  }
  validateDeliveryEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") return null;
    if (typeof envelope.setHash !== "string" || !/^[0-9a-f]{16}$/i.test(envelope.setHash)) return null;
    if (!Number.isInteger(envelope.size) || envelope.size < 1 || envelope.size > MAX_DELIVERY_PEERS) return null;
    if (!Number.isFinite(envelope.deadlineAt) || envelope.deadlineAt <= 0) return null;
    return this.deliveryBitsFromHex(envelope.bits, envelope.size);
  }
  reconstructDeliveryPeers(state) {
    const peers = this.canonicalPeerSet();
    if (peers.length !== state.size || this.canonicalSetHash(peers) !== state.setHash) return null;
    state.peerIds = peers;
    return peers;
  }
  registerTrackedDelivery(message, knownPeerIds, receivedLocally) {
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
        message,
        createdAt: message.timestamp,
        updatedAt: Date.now(),
        deadlineAt: message.delivery.deadlineAt,
        completedAt: null,
        timedOut: false,
        lastStatusSignature: "",
        repairAttemptsByPeer: /* @__PURE__ */ new Map()
      };
      this.deliveryStates.set(message.id, state);
      changed = true;
    } else {
      if (state.sender !== message.sender || state.setHash !== message.delivery.setHash || state.size !== message.delivery.size || state.deadlineAt !== message.delivery.deadlineAt) {
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
  mergeDeliveryReceipt(receipt) {
    if (!receipt || typeof receipt.messageId !== "string" || typeof receipt.sender !== "string") return;
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
        lastStatusSignature: "",
        repairAttemptsByPeer: /* @__PURE__ */ new Map()
      };
      this.deliveryStates.set(receipt.messageId, state);
      changed = true;
    } else {
      if (state.sender !== receipt.sender || state.setHash !== receipt.setHash || state.size !== receipt.size || state.deadlineAt !== receipt.deadlineAt) return;
      changed = this.mergeDeliveryBits(state.bits, incomingBits);
    }
    if (!state.peerIds) this.reconstructDeliveryPeers(state);
    if (changed) {
      state.updatedAt = Date.now();
      this.dirtyDeliveryReceiptIds.add(state.messageId);
      this.emitDeliveryStatus(state);
    }
  }
  deliveryStatusForState(state) {
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
      deadlineAt: state.deadlineAt
    };
  }
  emitDeliveryStatus(state) {
    if (state.sender !== this.mesh.getClientId()) return;
    const status = this.deliveryStatusForState(state);
    const signature = `${status.deliveredPeerIds.join("|")}::${status.pendingPeerIds.join("|")}::${status.timedOut}`;
    if (signature !== state.lastStatusSignature) {
      state.lastStatusSignature = signature;
      this.emit("deliveryProgress", status);
    }
    if (status.complete && state.completedAt == null) {
      state.completedAt = Date.now();
      this.emit("deliveryComplete", status);
    }
  }
  selectRepairOwner(state, targetPeerId) {
    const peers = state.peerIds ?? this.reconstructDeliveryPeers(state);
    if (!peers) return null;
    const delivered = peers.filter((_, index) => this.hasDeliveryBit(state.bits, index));
    let owner = null;
    let ownerScore = null;
    for (const candidate of delivered) {
      const score = this.canonicalSetHash([state.messageId, targetPeerId, candidate]);
      if (ownerScore == null || score < ownerScore) {
        owner = candidate;
        ownerScore = score;
      }
    }
    return owner;
  }
  maintainTrackedDeliveries(now = Date.now()) {
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
          if (state.sender === self) this.emit("deliveryTimeout", this.deliveryStatusForState(state));
        }
        continue;
      }
      if (!state.message || !peers || now - state.createdAt < this.deliveryRepairDelayMs) continue;
      for (const targetPeerId of status.pendingPeerIds) {
        if (this.selectRepairOwner(state, targetPeerId) !== self) continue;
        const attempt = state.repairAttemptsByPeer.get(targetPeerId) ?? { attempts: 0, lastAttemptAt: 0 };
        if (attempt.attempts >= MAX_REPAIR_ATTEMPTS_PER_TARGET) continue;
        if (now - attempt.lastAttemptAt < this.deliveryRepairIntervalMs) continue;
        const repairMessage = {
          ...state.message,
          delivery: this.deliveryEnvelopeForState(state)
        };
        const repairId = this.sendDirect(targetPeerId, {
          __peerPigeonType: RELIABLE_REPAIR_TYPE,
          message: repairMessage
        });
        if (repairId) {
          state.repairAttemptsByPeer.set(targetPeerId, {
            attempts: attempt.attempts + 1,
            lastAttemptAt: now
          });
        }
      }
    }
  }
  reliableRepairMessage(data) {
    let candidate = data;
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    if (!candidate || typeof candidate !== "object") return null;
    const value = candidate;
    if (value.__peerPigeonType !== RELIABLE_REPAIR_TYPE || !value.message || typeof value.message !== "object") {
      return null;
    }
    const message = value.message;
    if (message.type !== "gossip" || typeof message.id !== "string" || !message.delivery) return null;
    return message;
  }
  // ─── Direct / XOR-routed messaging ───────────────────────────────────────
  peerIdToNumeric(peerId) {
    try {
      const hex = peerId.replace(/-/g, "").toLowerCase();
      if (hex.length !== CECR_ID_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
      return BigInt("0x" + hex);
    } catch {
      return null;
    }
  }
  canonicalPeerSet() {
    const universe = /* @__PURE__ */ new Set();
    const self = this.mesh.getClientId();
    if (self) universe.add(self);
    for (const peerId of this.mesh.getGlobalPeers?.() ?? []) universe.add(peerId);
    return Array.from(universe).sort();
  }
  canonicalSetHash(peerIds) {
    const input = peerIds.join("\n");
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mod = 0xFFFFFFFFFFFFFFFFn;
    for (let i = 0; i < input.length; i++) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = hash * prime & mod;
    }
    return hash.toString(16).padStart(16, "0");
  }
  cecrConfigId() {
    const membership = this.mesh.getCecrMembershipConfig?.() ?? {
      leaseMs: 0,
      gossipIntervalMs: 0,
      tombstoneRetentionMs: 0,
      clockSkewMs: 0
    };
    return this.canonicalSetHash([JSON.stringify({
      protocol: "cecr/1",
      idWidthBits: CECR_ID_WIDTH_BITS,
      hashProfile: "fnv1a64-compat",
      signatureProfile: "unsigned-partial",
      coordinateWeightNumerator: Math.round(this.cecrCoordinateWeight * CECR_WEIGHT_DENOMINATOR),
      coordinateWeightDenominator: CECR_WEIGHT_DENOMINATOR,
      maxDirectHops: this.maxDirectHops,
      convergenceRounds: this.cecrConvergenceRounds,
      xorBucketRedundancy: 1,
      membership
    })]);
  }
  cecrFanout(connectedDegree = this.mesh.getConnectedPeers().length) {
    const liveN = Math.max(1, this.canonicalPeerSet().length);
    return Math.min(Math.max(0, connectedDegree), Math.ceil(Math.log2(liveN)));
  }
  selectFanoutPeers(excluded, channel) {
    const connected = Array.from(new Set(this.mesh.getConnectedPeers())).sort();
    const budget = this.cecrFanout(connected.length);
    const eligible = connected.filter((peerId) => !excluded.has(peerId));
    const count = Math.min(budget, eligible.length);
    if (count <= 0) return [];
    const cursor = channel === "gossip" ? this.gossipFanoutCursor : channel === "cecr" ? this.cecrFanoutCursor : this.antiEntropyFanoutCursor;
    const start = cursor % eligible.length;
    const selected = [];
    for (let offset = 0; offset < count; offset += 1) {
      selected.push(eligible[(start + offset) % eligible.length]);
    }
    if (channel === "gossip") {
      this.gossipFanoutCursor = (start + count) % eligible.length;
    } else if (channel === "cecr") {
      this.cecrFanoutCursor = (start + count) % eligible.length;
    } else {
      this.antiEntropyFanoutCursor = (start + count) % eligible.length;
    }
    return selected;
  }
  updateCecrExtremaSnapshot() {
    const canonicalPeers = this.canonicalPeerSet();
    const setHash = this.canonicalSetHash(canonicalPeers);
    let min = null;
    let max = null;
    let count = 0;
    for (const peerId of canonicalPeers) {
      const value = this.peerIdToNumeric(peerId);
      if (value == null) return null;
      if (min == null || value < min) min = value;
      if (max == null || value > max) max = value;
      count++;
    }
    if (min == null || max == null || count < 2 || min === max) {
      if (this.cecrCurrentExtrema) {
        this.cecrCurrentExtrema = null;
        this.cecrViewChangedAtMs = Date.now();
      }
      return null;
    }
    const next = {
      min,
      max,
      updatedAtMs: Date.now(),
      size: count,
      setHash
    };
    if (!this.cecrCurrentExtrema || this.cecrCurrentExtrema.min !== next.min || this.cecrCurrentExtrema.max !== next.max || this.cecrCurrentExtrema.size !== next.size || this.cecrCurrentExtrema.setHash !== next.setHash) {
      this.cecrCurrentExtrema = next;
      this.cecrViewChangedAtMs = next.updatedAtMs;
    } else {
      this.cecrCurrentExtrema.updatedAtMs = next.updatedAtMs;
    }
    return this.cecrCurrentExtrema;
  }
  effectiveCecrCoordinateWeight() {
    const current = this.updateCecrExtremaSnapshot();
    if (!current) return 0;
    if (!this.hasCecrConsensus(current)) return 0;
    if (this.getCecrOverlaySnapshot().degraded) return 0;
    return this.cecrCoordinateWeight;
  }
  hasCecrConsensus(local) {
    if (!this.cecrRequireConsensus) return true;
    const now = Date.now();
    if (now - local.updatedAtMs > this.cecrExtremaMaxAgeMs) return false;
    const gossipIntervalMs = this.mesh.getCecrMembershipConfig?.().gossipIntervalMs ?? 2e3;
    if (now - this.cecrViewChangedAtMs < this.cecrConvergenceRounds * gossipIntervalMs) return false;
    if ((this.mesh.getCecrMembershipEquivocations?.().length ?? 0) > 0) return false;
    const configId = this.cecrConfigId();
    const connectedPeers = this.mesh.getConnectedPeers();
    for (const peerId of connectedPeers) {
      const remote = this.cecrRemoteStates.get(peerId);
      if (!remote) return false;
      if (now - remote.updatedAtMs > this.cecrExtremaMaxAgeMs) return false;
      if (remote.configId !== configId || remote.viewId !== local.setHash) return false;
      if (remote.matchingRounds < this.cecrConvergenceRounds) return false;
      if (remote.setHash !== local.setHash) return false;
      if (remote.size !== local.size) return false;
      if (remote.min !== local.min || remote.max !== local.max) return false;
    }
    return true;
  }
  publishCecrState(targetPeerId) {
    const self = this.mesh.getClientId();
    if (!self) return;
    const connected = new Set(this.mesh.getConnectedPeers());
    const targets = targetPeerId && connected.has(targetPeerId) ? [targetPeerId] : this.selectFanoutPeers(/* @__PURE__ */ new Set(), "cecr");
    const extrema = this.updateCecrExtremaSnapshot();
    const canonicalPeers = this.canonicalPeerSet();
    const numericPeers = canonicalPeers.map((peerId) => this.peerIdToNumeric(peerId)).filter((value) => value != null);
    if (numericPeers.length !== canonicalPeers.length || numericPeers.length === 0) {
      this.publishCecrDeliveryState(targets, self);
      return;
    }
    let min = numericPeers[0];
    let max = numericPeers[0];
    for (const value of numericPeers.slice(1)) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const message = {
      id: this.generateMessageId(self),
      type: "cecr-state",
      protocol: "cecr/1",
      configId: this.cecrConfigId(),
      viewId: extrema?.setHash ?? this.canonicalSetHash(canonicalPeers),
      from: self,
      timestamp: Date.now(),
      setHash: extrema?.setHash ?? this.canonicalSetHash(canonicalPeers),
      minHex: (extrema?.min ?? min).toString(16).padStart(CECR_ID_HEX_LENGTH, "0"),
      maxHex: (extrema?.max ?? max).toString(16).padStart(CECR_ID_HEX_LENGTH, "0"),
      size: extrema?.size ?? canonicalPeers.length
    };
    let sent = false;
    for (const peerId of targets) {
      try {
        this.mesh.send(peerId, JSON.stringify(message));
        sent = true;
      } catch {
      }
    }
    if (sent || targets.length > 0) this.publishCecrDeliveryState(targets, self);
  }
  publishCecrDeliveryState(targets, self) {
    const receiptIds = Array.from(this.dirtyDeliveryReceiptIds).slice(0, MAX_RECEIPT_DELTAS_PER_SYNC);
    if (receiptIds.length === 0 || targets.length === 0) return;
    const message = {
      id: this.generateMessageId(self),
      type: "cecr-dr",
      protocol: "cecr-dr/1",
      from: self,
      timestamp: Date.now(),
      receipts: receiptIds.map((messageId) => this.deliveryStates.get(messageId)).filter((state) => !!state).map((state) => this.deliveryReceiptForState(state))
    };
    let sent = false;
    for (const peerId of targets) {
      try {
        this.mesh.send(peerId, JSON.stringify(message));
        sent = true;
      } catch {
      }
    }
    if (sent) {
      for (const messageId of receiptIds) this.dirtyDeliveryReceiptIds.delete(messageId);
    }
  }
  handleIncomingCecrState(message, fromPeerId) {
    if (message.from !== fromPeerId) return;
    if (!message.setHash || typeof message.setHash !== "string") return;
    if (!Number.isFinite(message.size) || message.size < 1) return;
    try {
      const min = BigInt("0x" + message.minHex);
      const max = BigInt("0x" + message.maxHex);
      if (min > max) return;
      const configId = message.configId ?? "";
      const viewId = message.viewId ?? message.setHash;
      const previous = this.cecrRemoteStates.get(fromPeerId);
      const matchingRounds = previous && previous.configId === configId && previous.viewId === viewId ? previous.matchingRounds + 1 : 1;
      this.cecrRemoteStates.set(fromPeerId, {
        configId,
        viewId,
        setHash: message.setHash,
        min,
        max,
        size: Math.floor(message.size),
        updatedAtMs: Date.now(),
        matchingRounds
      });
    } catch {
    }
  }
  handleIncomingCecrDeliveryState(message, fromPeerId) {
    if (message.from !== fromPeerId || message.protocol !== "cecr-dr/1" || !Array.isArray(message.receipts)) return;
    for (const receipt of message.receipts.slice(0, MAX_RECEIPT_DELTAS_PER_SYNC)) {
      this.mergeDeliveryReceipt(receipt);
    }
  }
  bucketRank(distance) {
    return distance === 0n ? -1 : distance.toString(2).length - 1;
  }
  hybridScore(peerId, target, extrema) {
    const peer = this.peerIdToNumeric(peerId);
    if (peer == null) return null;
    const span = extrema.max - extrema.min;
    if (span <= 0n) return null;
    const weight = BigInt(Math.round(this.cecrCoordinateWeight * CECR_WEIGHT_DENOMINATOR));
    const inverse = BigInt(CECR_WEIGHT_DENOMINATOR) - weight;
    const coordinateDistance = peer >= target ? peer - target : target - peer;
    const xor = peer ^ target;
    return weight * coordinateDistance * CECR_ID_MAX + inverse * xor * span;
  }
  orderedRouteCandidates(targetPeerId, exclude, originConfigId) {
    const selfId = this.mesh.getClientId();
    if (!selfId) return [];
    const self = this.peerIdToNumeric(selfId);
    const target = this.peerIdToNumeric(targetPeerId);
    if (self == null || target == null) return [];
    const candidates = Array.from(new Set(this.mesh.getConnectedPeers())).filter((peerId) => peerId !== exclude).map((peerId) => ({ peerId, numeric: this.peerIdToNumeric(peerId) })).filter((candidate) => candidate.numeric != null);
    const selfXor = self ^ target;
    const selfRank = this.bucketRank(selfXor);
    const progress = candidates.filter(({ numeric }) => this.bucketRank(numeric ^ target) < selfRank);
    const coordinateReady = originConfigId === this.cecrConfigId() && this.effectiveCecrCoordinateWeight() > 0;
    const extrema = coordinateReady ? this.cecrCurrentExtrema ?? this.updateCecrExtremaSnapshot() : null;
    if (progress.length > 0) {
      return progress.sort((left, right) => {
        if (extrema) {
          const leftScore = this.hybridScore(left.peerId, target, extrema);
          const rightScore = this.hybridScore(right.peerId, target, extrema);
          if (leftScore != null && rightScore != null && leftScore !== rightScore) {
            return leftScore < rightScore ? -1 : 1;
          }
        }
        const leftXor = left.numeric ^ target;
        const rightXor = right.numeric ^ target;
        if (leftXor !== rightXor) return leftXor < rightXor ? -1 : 1;
        if (left.numeric !== right.numeric) return left.numeric < right.numeric ? -1 : 1;
        return left.peerId.localeCompare(right.peerId);
      }).map(({ peerId }) => peerId);
    }
    return candidates.filter(({ numeric }) => (numeric ^ target) < selfXor).sort((left, right) => {
      const leftXor = left.numeric ^ target;
      const rightXor = right.numeric ^ target;
      if (leftXor !== rightXor) return leftXor < rightXor ? -1 : 1;
      if (left.numeric !== right.numeric) return left.numeric < right.numeric ? -1 : 1;
      return left.peerId.localeCompare(right.peerId);
    }).map(({ peerId }) => peerId);
  }
  getCecrOverlaySnapshot() {
    const selfId = this.mesh.getClientId();
    const livePeerIds = this.canonicalPeerSet();
    const self = selfId ? this.peerIdToNumeric(selfId) : null;
    const live = livePeerIds.map((peerId) => ({ peerId, numeric: this.peerIdToNumeric(peerId) })).filter((peer) => peer.numeric != null);
    const connected = new Set(this.mesh.getConnectedPeers());
    if (!selfId || self == null || live.length !== livePeerIds.length) {
      return {
        xorBucketCoverage: false,
        coordinateAdjacency: false,
        missingXorBuckets: [],
        missingCoordinatePeerIds: [],
        degraded: true
      };
    }
    const requiredBuckets = /* @__PURE__ */ new Set();
    const connectedBuckets = /* @__PURE__ */ new Set();
    for (const peer of live) {
      if (peer.peerId === selfId) continue;
      requiredBuckets.add(this.bucketRank(self ^ peer.numeric));
      if (connected.has(peer.peerId)) connectedBuckets.add(this.bucketRank(self ^ peer.numeric));
    }
    const missingXorBuckets = Array.from(requiredBuckets).filter((rank) => !connectedBuckets.has(rank)).sort((left, right) => left - right);
    const sorted = live.slice().sort((left, right) => {
      if (left.numeric !== right.numeric) return left.numeric < right.numeric ? -1 : 1;
      return left.peerId.localeCompare(right.peerId);
    });
    const selfIndex = sorted.findIndex((peer) => peer.peerId === selfId);
    const requiredCoordinatePeers = /* @__PURE__ */ new Set();
    if (selfIndex > 0) requiredCoordinatePeers.add(sorted[selfIndex - 1].peerId);
    if (selfIndex >= 0 && selfIndex + 1 < sorted.length) requiredCoordinatePeers.add(sorted[selfIndex + 1].peerId);
    const missingCoordinatePeerIds = Array.from(requiredCoordinatePeers).filter((peerId) => !connected.has(peerId)).sort();
    const xorBucketCoverage = missingXorBuckets.length === 0;
    const coordinateAdjacency = selfIndex >= 0 && missingCoordinatePeerIds.length === 0;
    return {
      xorBucketCoverage,
      coordinateAdjacency,
      missingXorBuckets,
      missingCoordinatePeerIds,
      degraded: !xorBucketCoverage || !coordinateAdjacency
    };
  }
  /**
   * Send a direct message to a specific peer, routed through the mesh via XOR distance.
   * Delivers even if there is no direct connection to the target.
   */
  sendDirect(targetPeerId, data) {
    const from = this.mesh.getClientId();
    if (!from) return null;
    const message = {
      id: this.generateMessageId(from),
      type: "direct",
      from,
      to: targetPeerId,
      data,
      hops: 0,
      maxHops: this.maxDirectHops,
      timestamp: Date.now(),
      originConfigId: this.cecrConfigId(),
      originViewId: this.canonicalSetHash(this.canonicalPeerSet())
    };
    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, null);
    return message.id;
  }
  routeDirect(message, fromPeerId) {
    const self = this.mesh.getClientId();
    if (message.to === self) {
      const repairedMessage = this.reliableRepairMessage(message.data);
      if (repairedMessage) {
        this.handleIncomingMessage(repairedMessage, fromPeerId ?? message.from);
        return;
      }
      this.emit("directMessageReceived", { message });
      return;
    }
    if (!this.canonicalPeerSet().includes(message.to)) return;
    if (message.hops >= message.maxHops) return;
    const connected = this.mesh.getConnectedPeers();
    if (connected.includes(message.to)) {
      try {
        this.mesh.send(message.to, JSON.stringify({ ...message, hops: message.hops + 1 }));
      } catch {
      }
      return;
    }
    for (const next of this.orderedRouteCandidates(
      message.to,
      fromPeerId ?? void 0,
      message.originConfigId
    )) {
      try {
        this.mesh.send(next, JSON.stringify({ ...message, hops: message.hops + 1 }));
        return;
      } catch {
      }
    }
  }
  handleIncomingDirect(message, fromPeerId) {
    if (this.seenDirectIds.has(message.id)) return;
    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, fromPeerId);
  }
  getCecrConfig() {
    const membership = this.mesh.getCecrMembershipConfig?.() ?? {
      leaseMs: 0,
      gossipIntervalMs: 0,
      tombstoneRetentionMs: 0,
      clockSkewMs: 0
    };
    return Object.freeze({
      protocol: "cecr/1",
      configId: this.cecrConfigId(),
      idWidthBits: CECR_ID_WIDTH_BITS,
      hashProfile: "fnv1a64-compat",
      signatureProfile: "unsigned-partial",
      coordinateWeightNumerator: Math.round(this.cecrCoordinateWeight * CECR_WEIGHT_DENOMINATOR),
      coordinateWeightDenominator: CECR_WEIGHT_DENOMINATOR,
      extremaMaxAgeMs: this.cecrExtremaMaxAgeMs,
      requireConsensus: this.cecrRequireConsensus,
      maxDirectHops: this.maxDirectHops,
      membershipLeaseMs: membership.leaseMs,
      membershipGossipIntervalMs: membership.gossipIntervalMs,
      membershipTombstoneRetentionMs: membership.tombstoneRetentionMs,
      membershipClockSkewMs: membership.clockSkewMs,
      convergenceRounds: this.cecrConvergenceRounds,
      xorBucketRedundancy: 1
    });
  }
  getCecrState() {
    const livePeerIds = this.canonicalPeerSet();
    const extrema = this.updateCecrExtremaSnapshot();
    const overlay = this.getCecrOverlaySnapshot();
    const connectedDegree = this.mesh.getConnectedPeers().length;
    const gossipIntervalMs = this.mesh.getCecrMembershipConfig?.().gossipIntervalMs ?? 2e3;
    return {
      protocol: "cecr/1",
      conformance: "partial",
      configId: this.cecrConfigId(),
      peerId: this.mesh.getClientId(),
      livePeerIds,
      viewId: this.canonicalSetHash(livePeerIds),
      viewStableForMs: Math.max(0, Date.now() - this.cecrViewChangedAtMs),
      requiredStableForMs: this.cecrConvergenceRounds * gossipIntervalMs,
      size: livePeerIds.length,
      minHex: extrema?.min.toString(16).padStart(CECR_ID_HEX_LENGTH, "0") ?? null,
      maxHex: extrema?.max.toString(16).padStart(CECR_ID_HEX_LENGTH, "0") ?? null,
      coordinateReady: !!extrema && this.hasCecrConsensus(extrema) && !overlay.degraded,
      connectedDegree,
      fanout: this.cecrFanout(connectedDegree),
      membershipRecords: this.mesh.getCecrMembershipRecords?.() ?? [],
      membershipEquivocations: this.mesh.getCecrMembershipEquivocations?.() ?? [],
      overlay,
      limitations: [
        "membership, state, and routed frames are not cryptographically signed",
        "viewId uses the legacy 64-bit membership digest",
        "incarnation persistence is not available for applications that reuse a peer identity across processes"
      ]
    };
  }
  getStats() {
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
      recentMessages: messages.filter((m) => m.age < 6e4),
      connectedPeers: this.mesh.getConnectedPeers().length,
      discoveredPeers: this.mesh.getDiscoveredPeers().length
    };
  }
  cleanup(maxAgeMs = 10 * 6e4) {
    const now = Date.now();
    for (const [id, info] of this.messageLog.entries()) {
      if (now - info.timestamp > maxAgeMs) {
        this.messageLog.delete(id);
        this.retainedMessages.delete(id);
      }
    }
    for (const [id, timestamp] of this.seenDirectIds.entries()) {
      if (now - timestamp > maxAgeMs) {
        this.seenDirectIds.delete(id);
      }
    }
  }
  markDirectSeen(id, timestamp) {
    this.seenDirectIds.set(id, timestamp || Date.now());
    if (this.seenDirectIds.size > this.maxTrackedDirectIds) {
      this.pruneTracking();
    }
  }
  pruneTracking(now = Date.now()) {
    const minTimestamp = now - this.trackingRetentionMs;
    for (const [id, info] of this.messageLog.entries()) {
      if (info.timestamp >= minTimestamp) {
        break;
      }
      this.messageLog.delete(id);
      this.retainedMessages.delete(id);
    }
    while (this.messageLog.size > this.maxTrackedMessages) {
      const oldest = this.messageLog.keys().next().value;
      if (!oldest) break;
      this.messageLog.delete(oldest);
      this.retainedMessages.delete(oldest);
    }
    for (const [id, retained] of this.retainedMessages.entries()) {
      if (retained.retainedAt >= minTimestamp) break;
      this.retainedMessages.delete(id);
    }
    while (this.retainedMessages.size > this.maxTrackedMessages) {
      const oldest = this.retainedMessages.keys().next().value;
      if (!oldest) break;
      this.retainedMessages.delete(oldest);
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
      const expired = terminalAt != null ? now - terminalAt > this.trackingRetentionMs : now - state.createdAt > this.trackingRetentionMs;
      if (!expired) continue;
      this.deliveryStates.delete(id);
      this.dirtyDeliveryReceiptIds.delete(id);
    }
  }
  on(event, callback) {
    const existing = this.callbacks[event];
    if (existing) {
      existing.add(callback);
      return;
    }
    this.callbacks[event] = /* @__PURE__ */ new Set([callback]);
  }
  off(event, callback) {
    const existing = this.callbacks[event];
    if (!existing) return;
    existing.delete(callback);
  }
  destroy() {
    this.messageLog.clear();
    this.peers.clear();
    this.seenDirectIds.clear();
    this.deliveryStates.clear();
    this.retainedMessages.clear();
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
  emit(event, data) {
    const cbs = this.callbacks[event];
    if (!cbs) return;
    for (const cb of cbs) {
      try {
        cb(data);
      } catch {
      }
    }
  }
  tryParseGossipMessage(raw) {
    const toEnvelope = (value) => {
      if (!value) return null;
      if (typeof value === "object" && typeof value.id === "string" && typeof value.type === "string") {
        return value;
      }
      let text;
      if (typeof value === "string") {
        text = value;
      } else if (value instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array(value));
      } else if (ArrayBuffer.isView(value)) {
        text = new TextDecoder().decode(value);
      } else if (typeof value?.toString === "function") {
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
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null;
    if (parsed.type === "gossip") {
      return parsed;
    }
    if (parsed.type === "direct" && typeof parsed.from === "string" && typeof parsed.to === "string") {
      return parsed;
    }
    if (parsed.type === "cecr-state" && typeof parsed.from === "string" && typeof parsed.setHash === "string" && typeof parsed.minHex === "string" && typeof parsed.maxHex === "string" && typeof parsed.size === "number") {
      return parsed;
    }
    if (parsed.type === "cecr-dr" && parsed.protocol === "cecr-dr/1" && typeof parsed.from === "string" && Array.isArray(parsed.receipts)) {
      return parsed;
    }
    if (parsed.type === "gossip-ae" && parsed.protocol === "gossip-ae/1" && typeof parsed.from === "string" && (parsed.mode === "summary" || parsed.mode === "request") && Array.isArray(parsed.messageIds)) {
      return parsed;
    }
    return null;
  }
  generateMessageId(sender) {
    const safeSender = (sender ?? "unknown").toString();
    try {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      const nonce = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      return `${safeSender}-${nonce}`;
    } catch {
      return `${safeSender}-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
    }
  }
};

// src/storage.ts
var MemoryStorageDriver = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  async get(pk) {
    return this.map.get(pk) ?? null;
  }
  async put(record) {
    this.map.set(record.pk, record);
  }
  async delete(pk) {
    this.map.delete(pk);
  }
  async listBySpace(space) {
    const out = [];
    for (const value of this.map.values()) {
      if (value.space === space) out.push(value);
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }
  close() {
  }
};
var IndexedDbStorageDriver = class _IndexedDbStorageDriver {
  constructor(db, storeName) {
    this.db = db;
    this.storeName = storeName;
  }
  static async create(dbName, storeName) {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const next = req.result;
        if (!next.objectStoreNames.contains(storeName)) {
          const store = next.createObjectStore(storeName, { keyPath: "pk" });
          store.createIndex("space", "space", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    });
    return new _IndexedDbStorageDriver(db, storeName);
  }
  async get(pk) {
    return await this.runRead((store) => store.get(pk)).then((value) => value ?? null);
  }
  async put(record) {
    await this.runWrite((store) => store.put(record));
  }
  async delete(pk) {
    await this.runWrite((store) => store.delete(pk));
  }
  async listBySpace(space) {
    return await this.runRead((store) => {
      const index = store.index("space");
      const request = index.getAll(space);
      return request;
    });
  }
  close() {
    this.db.close();
  }
  runRead(factory) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const req = factory(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
  }
  runWrite(factory) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = factory(store);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  }
};
var PeerPigeonStorage = class {
  constructor(options) {
    this.storeName = "records";
    this.driver = null;
    this.listeners = /* @__PURE__ */ new Set();
    this.subscribedKeys = /* @__PURE__ */ new Set();
    this.pendingRetrieveRequests = /* @__PURE__ */ new Map();
    this.closed = false;
    this.instanceId = `storage-${Math.random().toString(36).slice(2, 11)}`;
    this.crossTabChannel = null;
    this.crossTabSeenNoticeIds = /* @__PURE__ */ new Set();
    const userId = String(options.userId ?? "").trim();
    if (!userId) {
      throw new Error("PeerPigeonStorage requires a non-empty userId");
    }
    this.userId = userId;
    this.peerId = String(options.peerId ?? "").trim();
    this.gossip = options.gossip ?? null;
    this.sessionId = String(options.sessionId ?? "default-session").trim() || "default-session";
    this.syncSecret = String(options.syncSecret ?? "").trim();
    this.dbName = String(options.dbName ?? "peerpigeon-storage-v1").trim() || "peerpigeon-storage-v1";
    this.syncFilter = typeof options.syncFilter === "function" ? options.syncFilter : null;
    this.onGossipMessageBound = (data) => {
      this.handleGossipMessage(data).catch(() => {
      });
    };
    this.crossTabStorageEventBound = (event) => {
      this.handleCrossTabStorageEvent(event);
    };
    this.crossTabChannelMessageBound = (event) => {
      this.handleCrossTabChannelMessage(event);
    };
  }
  async init() {
    if (this.closed) {
      throw new Error("PeerPigeonStorage is closed");
    }
    if (this.driver) return;
    this.driver = await this.createDriver();
    this.setupCrossTabSync();
    if (this.gossip) {
      this.gossip.on("messageReceived", this.onGossipMessageBound);
    }
  }
  on(event, listener) {
    if (event !== "change") return;
    this.listeners.add(listener);
  }
  subscribe(listener) {
    this.on("change", listener);
    return () => {
      this.off("change", listener);
    };
  }
  /** Subscribe to remote updates for one exact storage-space/key pair. */
  subscribeKey(space, key) {
    const normalizedKey = this.normalizeKey(key);
    const subscriptionKey = this.makePk(space, normalizedKey);
    this.subscribedKeys.add(subscriptionKey);
    return () => this.unsubscribeKey(space, normalizedKey);
  }
  /** Stop accepting remote updates for one exact storage-space/key pair. */
  unsubscribeKey(space, key) {
    const normalizedKey = this.normalizeKey(key);
    this.subscribedKeys.delete(this.makePk(space, normalizedKey));
  }
  /** Return whether this instance accepts remote updates for a key. */
  isSubscribed(space, key) {
    const normalizedKey = this.normalizeKey(key);
    return this.subscribedKeys.has(this.makePk(space, normalizedKey));
  }
  /** Update the mesh peer ID recorded on subsequent local mutations. */
  setPeerId(peerId) {
    this.peerId = String(peerId ?? "").trim();
  }
  off(event, listener) {
    if (event !== "change") return;
    this.listeners.delete(listener);
  }
  async put(space, key, value, options = {}) {
    const mutation = await this.applyLocalUpsert(space, key, value, options, false);
    if (space !== "private") {
      await this.broadcastMutation(mutation);
    }
    return await this.get(space, key);
  }
  async putSystem(space, key, value, options = {}) {
    if (space !== "epublic") {
      throw new Error("putSystem is only allowed for epublic space");
    }
    const mutation = await this.applyLocalUpsert(space, key, value, options, true);
    await this.broadcastMutation(mutation);
    return await this.get(space, key);
  }
  async get(space, key) {
    const driver = this.requireDriver();
    const pk = this.makePk(space, key);
    const persisted = await driver.get(pk);
    if (!persisted) return null;
    let value;
    try {
      value = await this.decodeValueForRead(persisted, this.userId);
    } catch {
      if (space === "private") return null;
      throw new Error("Failed to decode storage value");
    }
    return {
      space: persisted.space,
      key: persisted.key,
      value,
      ownerId: persisted.ownerId,
      modifiedBy: persisted.modifiedBy ?? null,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      version: this.normalizeStorageVersion(persisted.version, this.versionSourceToken(persisted.ownerId ?? this.userId))
    };
  }
  async retrieve(space, key, options = {}) {
    const normalizedKey = this.normalizeKey(key);
    this.subscribeKey(space, normalizedKey);
    const existing = await this.get(space, normalizedKey);
    if (space === "private") return existing;
    if (!this.gossip) return existing;
    const reqId = `${this.makeMutationId(this.userId)}-req`;
    const request = {
      __ppType: "pp-storage-req-v1",
      reqId,
      space,
      key: normalizedKey,
      actorId: this.userId,
      timestamp: Date.now()
    };
    const timeoutMs = Math.max(100, Math.floor(Number(options.timeoutMs ?? 2e3)));
    return await new Promise(async (resolve) => {
      const timeout = setTimeout(async () => {
        this.pendingRetrieveRequests.delete(reqId);
        const latest = await this.get(space, normalizedKey);
        resolve(latest);
      }, timeoutMs);
      this.pendingRetrieveRequests.set(reqId, {
        resolve: (value) => resolve(value),
        timeout
      });
      await this.broadcastSyncPayload(request);
    });
  }
  async delete(space, key) {
    const mutation = await this.applyLocalDelete(space, key, false);
    if (!mutation) return false;
    if (space !== "private") {
      await this.broadcastMutation(mutation);
    }
    return true;
  }
  async deleteSystem(space, key) {
    if (space !== "epublic") {
      throw new Error("deleteSystem is only allowed for epublic space");
    }
    const mutation = await this.applyLocalDelete(space, key, true);
    if (!mutation) return false;
    await this.broadcastMutation(mutation);
    return true;
  }
  async list(space) {
    const driver = this.requireDriver();
    const persisted = await driver.listBySpace(space);
    const out = [];
    for (const record of persisted) {
      let value;
      try {
        value = await this.decodeValueForRead(record, this.userId);
      } catch {
        if (record.space === "private") continue;
        throw new Error("Failed to decode storage value");
      }
      out.push({
        space: record.space,
        key: record.key,
        value,
        ownerId: record.ownerId,
        modifiedBy: record.modifiedBy ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        version: this.normalizeStorageVersion(record.version, this.versionSourceToken(record.ownerId ?? this.userId))
      });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.gossip) {
      this.gossip.off("messageReceived", this.onGossipMessageBound);
    }
    this.driver?.close();
    this.driver = null;
    this.teardownCrossTabSync();
    this.listeners.clear();
    this.subscribedKeys.clear();
    for (const pending of this.pendingRetrieveRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRetrieveRequests.clear();
  }
  async applyLocalUpsert(space, key, value, options, allowSystemWrite = false) {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    const now = Date.now();
    this.assertCanWrite(space, existing, actorId, options.ownerId, allowSystemWrite);
    const ownerId = this.resolveOwnerId(space, existing, actorId, options.ownerId);
    const modifiedBy = this.peerId || null;
    const nextVersion = this.nextStorageVersion(existing?.version, modifiedBy || ownerId || actorId);
    const encoded = await this.encodeValueForStore(space, value);
    const persisted = {
      pk,
      space,
      key: normalizedKey,
      ownerId,
      modifiedBy,
      value: encoded.value,
      valueCipher: encoded.valueCipher,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: nextVersion
    };
    await driver.put(persisted);
    const opId = this.makeMutationId(actorId);
    const mutation = {
      __ppType: "pp-storage-op-v1",
      opId,
      op: "upsert",
      space,
      key: normalizedKey,
      actorId,
      timestamp: now,
      record: persisted
    };
    this.emitChange({
      origin: "local",
      op: "upsert",
      record: {
        space,
        key: normalizedKey,
        value,
        ownerId,
        modifiedBy,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        version: persisted.version
      },
      space,
      key: normalizedKey,
      actorId
    });
    this.publishCrossTabNotice({
      __ppType: "pp-storage-cross-tab-v1",
      id: this.makeMutationId(actorId),
      source: this.instanceId,
      op: "upsert",
      space,
      key: normalizedKey,
      actorId,
      timestamp: now
    });
    return mutation;
  }
  async applyLocalDelete(space, key, allowSystemWrite = false) {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    if (!existing) return null;
    this.assertCanDelete(space, existing, actorId, allowSystemWrite);
    await driver.delete(pk);
    const opId = this.makeMutationId(actorId);
    const mutation = {
      __ppType: "pp-storage-op-v1",
      opId,
      op: "delete",
      space,
      key: normalizedKey,
      actorId,
      timestamp: Date.now(),
      record: null
    };
    this.emitChange({
      origin: "local",
      op: "delete",
      record: null,
      space,
      key: normalizedKey,
      actorId
    });
    this.publishCrossTabNotice({
      __ppType: "pp-storage-cross-tab-v1",
      id: this.makeMutationId(actorId),
      source: this.instanceId,
      op: "delete",
      space,
      key: normalizedKey,
      actorId,
      timestamp: Date.now()
    });
    return mutation;
  }
  async handleGossipMessage(data) {
    if (data.local) return;
    const payload = data.message?.data;
    if (!this.isSyncEnvelope(payload)) return;
    const decrypted = await this.decryptSyncEnvelope(payload.cipher);
    if (!decrypted) return;
    if (this.isStorageMutation(decrypted)) {
      if (decrypted.space === "private") return;
      if (!this.shouldAcceptRemoteSync(decrypted.space, decrypted.key, {
        kind: "mutation",
        actorId: decrypted.actorId
      })) {
        return;
      }
      await this.applyRemoteMutation(decrypted);
      return;
    }
    if (this.isStorageRetrieveRequest(decrypted)) {
      if (!this.shouldAcceptRemoteSync(decrypted.space, decrypted.key, {
        kind: "retrieve-request",
        actorId: decrypted.actorId
      })) {
        return;
      }
      await this.handleRetrieveRequest(decrypted);
      return;
    }
    if (this.isStorageRetrieveResponse(decrypted)) {
      await this.handleRetrieveResponse(decrypted);
    }
  }
  async applyRemoteMutation(mutation) {
    const driver = this.requireDriver();
    const pk = this.makePk(mutation.space, mutation.key);
    const existing = await driver.get(pk);
    if (mutation.op === "delete") {
      if (!existing) return false;
      if (mutation.timestamp <= existing.updatedAt) return false;
      if (!this.canDelete(mutation.space, existing, mutation.actorId, mutation.space === "epublic")) return false;
      await driver.delete(pk);
      this.emitChange({
        origin: "remote",
        op: "delete",
        record: null,
        space: mutation.space,
        key: mutation.key,
        actorId: mutation.actorId
      });
      this.publishCrossTabNotice({
        __ppType: "pp-storage-cross-tab-v1",
        id: mutation.opId,
        source: this.instanceId,
        op: "delete",
        space: mutation.space,
        key: mutation.key,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp
      });
      return true;
    }
    if (!mutation.record) return false;
    if (existing) {
      const existingVersion = existing.version;
      const incomingVersion = mutation.record.version;
      const existingUpdatedAt = Number(existing.updatedAt ?? 0);
      const incomingUpdatedAt = Number(mutation.timestamp ?? mutation.record.updatedAt ?? 0);
      const versionCmp = this.compareStorageVersions(incomingVersion, existingVersion);
      if (versionCmp < 0) return false;
      if (versionCmp === 0 && incomingUpdatedAt <= existingUpdatedAt) return false;
    }
    if (!this.canWrite(mutation.space, existing, mutation.actorId, void 0, mutation.space === "epublic")) return false;
    if (mutation.space === "user" && !existing) {
      const incomingOwner = String(mutation.record.ownerId ?? "").trim();
      if (incomingOwner && incomingOwner !== mutation.actorId) {
        return false;
      }
    }
    const incoming = {
      ...mutation.record,
      pk,
      ownerId: mutation.space === "user" ? existing?.ownerId ?? mutation.record.ownerId ?? mutation.actorId : mutation.record.ownerId,
      modifiedBy: mutation.record.modifiedBy ?? null,
      updatedAt: mutation.timestamp,
      createdAt: existing?.createdAt ?? mutation.record.createdAt,
      version: this.normalizeStorageVersion(
        mutation.record.version,
        this.versionSourceToken(mutation.record.ownerId ?? mutation.actorId)
      )
    };
    await driver.put(incoming);
    const value = await this.decodeValueForRead(incoming, this.userId);
    this.emitChange({
      origin: "remote",
      op: "upsert",
      record: {
        space: incoming.space,
        key: incoming.key,
        value,
        ownerId: incoming.ownerId,
        modifiedBy: incoming.modifiedBy,
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
        version: incoming.version
      },
      space: incoming.space,
      key: incoming.key,
      actorId: mutation.actorId
    });
    this.publishCrossTabNotice({
      __ppType: "pp-storage-cross-tab-v1",
      id: mutation.opId,
      source: this.instanceId,
      op: "upsert",
      space: incoming.space,
      key: incoming.key,
      actorId: mutation.actorId,
      timestamp: mutation.timestamp
    });
    return true;
  }
  setupCrossTabSync() {
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.crossTabChannel = new BroadcastChannel(this.crossTabChannelName());
        this.crossTabChannel.addEventListener("message", this.crossTabChannelMessageBound);
      } catch {
        this.crossTabChannel = null;
      }
    }
    window.addEventListener("storage", this.crossTabStorageEventBound);
  }
  teardownCrossTabSync() {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.crossTabStorageEventBound);
    }
    if (this.crossTabChannel) {
      try {
        this.crossTabChannel.removeEventListener("message", this.crossTabChannelMessageBound);
        this.crossTabChannel.close();
      } catch {
      }
      this.crossTabChannel = null;
    }
    this.crossTabSeenNoticeIds.clear();
  }
  crossTabChannelName() {
    return `peerpigeon-storage-ct:${this.dbName}:${this.sessionId}`;
  }
  crossTabStorageKey() {
    return `peerpigeon-storage-ct:${this.dbName}:${this.sessionId}:notice`;
  }
  publishCrossTabNotice(notice) {
    this.crossTabSeenNoticeIds.add(notice.id);
    this.trimSeenNoticeIds();
    if (this.crossTabChannel) {
      try {
        this.crossTabChannel.postMessage(notice);
      } catch {
      }
    }
    if (typeof localStorage !== "undefined") {
      try {
        const key = this.crossTabStorageKey();
        localStorage.setItem(key, JSON.stringify(notice));
        localStorage.removeItem(key);
      } catch {
      }
    }
  }
  handleCrossTabChannelMessage(event) {
    const notice = event?.data;
    if (!this.isCrossTabNotice(notice)) return;
    this.consumeCrossTabNotice(notice);
  }
  handleCrossTabStorageEvent(event) {
    if (!event || event.key !== this.crossTabStorageKey()) return;
    if (!event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      if (!this.isCrossTabNotice(parsed)) return;
      this.consumeCrossTabNotice(parsed);
    } catch {
    }
  }
  consumeCrossTabNotice(notice) {
    if (notice.source === this.instanceId) return;
    if (this.crossTabSeenNoticeIds.has(notice.id)) return;
    this.crossTabSeenNoticeIds.add(notice.id);
    this.trimSeenNoticeIds();
    this.applyCrossTabNotice(notice).catch(() => {
    });
  }
  async applyCrossTabNotice(notice) {
    if (this.closed) return;
    const driver = this.requireDriver();
    const pk = this.makePk(notice.space, notice.key);
    if (notice.op === "delete") {
      this.emitChange({
        origin: "remote",
        op: "delete",
        record: null,
        space: notice.space,
        key: notice.key,
        actorId: notice.actorId
      });
      return;
    }
    const persisted = await driver.get(pk);
    if (!persisted) return;
    const value = await this.decodeValueForRead(persisted, this.userId);
    this.emitChange({
      origin: "remote",
      op: "upsert",
      record: {
        space: persisted.space,
        key: persisted.key,
        value,
        ownerId: persisted.ownerId,
        modifiedBy: persisted.modifiedBy ?? null,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        version: persisted.version
      },
      space: persisted.space,
      key: persisted.key,
      actorId: notice.actorId
    });
  }
  trimSeenNoticeIds() {
    const max = 512;
    if (this.crossTabSeenNoticeIds.size <= max) return;
    const toRemove = this.crossTabSeenNoticeIds.size - max;
    let removed = 0;
    for (const id of this.crossTabSeenNoticeIds) {
      this.crossTabSeenNoticeIds.delete(id);
      removed += 1;
      if (removed >= toRemove) break;
    }
  }
  async broadcastMutation(mutation) {
    await this.broadcastSyncPayload(mutation);
  }
  async broadcastSyncPayload(payload) {
    if (!this.gossip) return;
    const cipher = await this.encryptSyncPayload(payload);
    const envelope = {
      __ppType: "pp-storage-sync-v1",
      from: this.userId,
      timestamp: Date.now(),
      cipher
    };
    this.gossip.broadcast(envelope);
  }
  async handleRetrieveRequest(request) {
    if (request.actorId === this.userId) return;
    if (request.space === "private") return;
    const driver = this.requireDriver();
    const pk = this.makePk(request.space, request.key);
    const existing = await driver.get(pk);
    if (!existing) return;
    const response = {
      __ppType: "pp-storage-res-v1",
      reqId: request.reqId,
      space: request.space,
      key: request.key,
      actorId: this.userId,
      timestamp: Date.now(),
      record: existing
    };
    await this.broadcastSyncPayload(response);
  }
  async handleRetrieveResponse(response) {
    const pending = this.pendingRetrieveRequests.get(response.reqId) ?? null;
    if (pending) {
      this.pendingRetrieveRequests.delete(response.reqId);
      clearTimeout(pending.timeout);
    }
    if (response.record && response.space !== "private") {
      if (!this.shouldAcceptRemoteSync(response.space, response.key, {
        kind: "retrieve-response",
        actorId: response.actorId
      })) {
        if (pending) {
          const latest = await this.get(response.space, response.key);
          pending.resolve(latest);
        }
        return;
      }
      const mutation = {
        __ppType: "pp-storage-op-v1",
        opId: `retrieve-${response.reqId}-${response.actorId}`,
        op: "upsert",
        space: response.space,
        key: response.key,
        actorId: response.actorId,
        timestamp: response.timestamp,
        record: response.record
      };
      await this.applyRemoteMutation(mutation);
    }
    if (pending) {
      const latest = await this.get(response.space, response.key);
      pending.resolve(latest);
    }
  }
  shouldAcceptRemoteSync(space, key, context) {
    if (space === "private") return false;
    if (context.kind !== "retrieve-request" && !this.isSubscribed(space, key)) {
      return false;
    }
    if (!this.syncFilter) return true;
    try {
      return this.syncFilter(space, key, context) !== false;
    } catch {
      return false;
    }
  }
  async createDriver() {
    if (typeof indexedDB === "undefined") {
      return new MemoryStorageDriver();
    }
    try {
      return await IndexedDbStorageDriver.create(this.dbName, this.storeName);
    } catch {
      return new MemoryStorageDriver();
    }
  }
  emitChange(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  requireDriver() {
    if (!this.driver) {
      throw new Error("PeerPigeonStorage.init() must be called before use");
    }
    return this.driver;
  }
  normalizeKey(key) {
    const normalized = String(key ?? "").trim();
    if (!normalized) throw new Error("Storage key must be a non-empty string");
    return normalized;
  }
  makePk(space, key) {
    if (space === "private") {
      return `${space}:${this.userId}:${key}`;
    }
    return `${space}:${key}`;
  }
  makeMutationId(actorId) {
    return `${actorId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
  parseStorageVersion(version) {
    const raw = String(version ?? "").trim();
    if (!raw) {
      return { parts: [0, 0, 0, 0], source: "0" };
    }
    if (/^\d+$/.test(raw)) {
      const major = Math.max(0, Math.floor(Number(raw)));
      return { parts: [major, 0, 0, 0], source: "0" };
    }
    const split = raw.split(".");
    const numeric = split.slice(0, 4);
    while (numeric.length < 4) numeric.push("0");
    const parts = numeric.map((part) => {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.floor(n);
    });
    const source = this.versionSourceToken(split[4] || "0");
    return { parts, source };
  }
  versionSourceToken(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "0";
    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly) {
      const trimmed = digitsOnly.slice(0, 10);
      return String(Number(trimmed));
    }
    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (!cleaned) return "0";
    const hexPrefix = cleaned.replace(/[^0-9a-f]/g, "").slice(0, 8);
    if (hexPrefix.length >= 4) {
      return String(parseInt(hexPrefix, 16));
    }
    let hash = 2166136261;
    for (let i = 0; i < cleaned.length; i += 1) {
      hash ^= cleaned.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }
  normalizeStorageVersion(version, fallbackSource = "0") {
    const parsed = this.parseStorageVersion(version);
    const source = parsed.source === "0" ? this.versionSourceToken(fallbackSource) : parsed.source;
    const [major, minor, patch, build] = parsed.parts;
    return `${major}.${minor}.${patch}.${build}.${source}`;
  }
  compareStorageVersions(a, b) {
    const left = this.parseStorageVersion(a).parts;
    const right = this.parseStorageVersion(b).parts;
    for (let i = 0; i < 4; i += 1) {
      if (left[i] > right[i]) return 1;
      if (left[i] < right[i]) return -1;
    }
    return 0;
  }
  nextStorageVersion(previous, actorId) {
    const parsed = this.parseStorageVersion(previous);
    const nextMajor = parsed.parts[0] + 1;
    return `${nextMajor}.0.0.0.${this.versionSourceToken(actorId)}`;
  }
  resolveOwnerId(space, existing, actorId, ownerOverride) {
    if (space === "user") {
      if (existing?.ownerId) {
        if (this.isPeerIdFormat(existing.ownerId) && !this.isPeerIdFormat(actorId)) {
          return actorId;
        }
        return existing.ownerId;
      }
      const requested = String(ownerOverride ?? "").trim();
      return requested || actorId;
    }
    if (space === "public" || space === "frozen" || space === "epublic") return null;
    return existing?.ownerId ?? null;
  }
  assertCanWrite(space, existing, actorId, ownerOverride, allowSystemWrite = false) {
    if (!this.canWrite(space, existing, actorId, ownerOverride, allowSystemWrite)) {
      throw new Error(`Write denied for ${space} space key`);
    }
  }
  canWrite(space, existing, actorId, ownerOverride, allowSystemWrite = false) {
    if (space === "public") return true;
    if (space === "epublic") return allowSystemWrite === true;
    if (space === "private") return actorId === this.userId;
    if (space === "user") {
      if (!existing) return true;
      if (existing.ownerId === actorId) return true;
      if (ownerOverride && String(ownerOverride).trim()) return true;
      if (this.isPeerIdFormat(existing.ownerId) && !this.isPeerIdFormat(actorId)) {
        return true;
      }
      return false;
    }
    if (space === "frozen") {
      return !existing;
    }
    return false;
  }
  isPeerIdFormat(id) {
    if (!id) return false;
    const str = String(id).trim();
    return /^[0-9a-f]{64}$/i.test(str);
  }
  assertCanDelete(space, existing, actorId, allowSystemWrite = false) {
    if (!this.canDelete(space, existing, actorId, allowSystemWrite)) {
      throw new Error(`Delete denied for ${space} space key`);
    }
  }
  canDelete(space, existing, actorId, allowSystemWrite = false) {
    if (space === "public") return true;
    if (space === "epublic") return allowSystemWrite === true;
    if (space === "private") return actorId === this.userId;
    if (space === "user") return existing.ownerId === actorId;
    if (space === "frozen") return false;
    return false;
  }
  async encodeValueForStore(space, value) {
    if (space !== "private") {
      return { value, valueCipher: null };
    }
    const cipher = await this.encryptPrivateValue(value);
    return { value: null, valueCipher: cipher };
  }
  async decodeValueForRead(record, readerId) {
    if (record.space !== "private") {
      return record.value;
    }
    if (readerId !== this.userId) {
      throw new Error("Read denied for private space key");
    }
    if (!record.valueCipher) {
      throw new Error("Missing cipher for private value");
    }
    return await this.decryptPrivateValue(record.valueCipher);
  }
  isSyncEnvelope(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-sync-v1" && typeof maybe.from === "string" && typeof maybe.timestamp === "number" && this.isCipherPayload(maybe.cipher);
  }
  isStorageMutation(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-op-v1" && typeof maybe.opId === "string" && (maybe.op === "upsert" || maybe.op === "delete") && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private" || maybe.space === "epublic") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number";
  }
  isStorageRetrieveRequest(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-req-v1" && typeof maybe.reqId === "string" && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private" || maybe.space === "epublic") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number";
  }
  isStorageRetrieveResponse(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-res-v1" && typeof maybe.reqId === "string" && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private" || maybe.space === "epublic") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number" && (maybe.record === null || typeof maybe.record === "object");
  }
  isCrossTabNotice(value) {
    const maybe = value;
    return !!(maybe && maybe.__ppType === "pp-storage-cross-tab-v1" && typeof maybe.id === "string" && typeof maybe.source === "string" && (maybe.op === "upsert" || maybe.op === "delete") && typeof maybe.space === "string" && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number");
  }
  isCipherPayload(value) {
    const maybe = value;
    return !!maybe && maybe.alg === "A256GCM" && typeof maybe.iv === "string" && typeof maybe.ct === "string";
  }
  async encryptSyncPayload(payload) {
    const key = await this.deriveAesKey(`peerpigeon:storage-sync:v1:${this.sessionId}:${this.syncSecret}`);
    return await this.encryptJson(payload, key);
  }
  async decryptSyncEnvelope(cipher) {
    try {
      const key = await this.deriveAesKey(`peerpigeon:storage-sync:v1:${this.sessionId}:${this.syncSecret}`);
      return await this.decryptJson(cipher, key);
    } catch {
      return null;
    }
  }
  async encryptPrivateValue(value) {
    const key = await this.deriveAesKey(`peerpigeon:storage-private:v1:${this.userId}:${this.sessionId}:${this.syncSecret}`);
    return await this.encryptJson(value, key);
  }
  async decryptPrivateValue(cipher) {
    const key = await this.deriveAesKey(`peerpigeon:storage-private:v1:${this.userId}:${this.sessionId}:${this.syncSecret}`);
    return await this.decryptJson(cipher, key);
  }
  async deriveAesKey(seed) {
    if (!globalThis.crypto?.subtle) {
      throw new Error("WebCrypto subtle API is required for encrypted storage sync");
    }
    const seedBytes = new TextEncoder().encode(seed);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", seedBytes);
    return await globalThis.crypto.subtle.importKey(
      "raw",
      digest,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async encryptJson(value, key) {
    const ivBuffer = new ArrayBuffer(12);
    const ivView = new Uint8Array(ivBuffer);
    globalThis.crypto.getRandomValues(ivView);
    const plainBytes = new TextEncoder().encode(JSON.stringify(value));
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBuffer },
      key,
      plainBytes
    );
    return {
      alg: "A256GCM",
      iv: this.toBase64Url(ivView),
      ct: this.toBase64Url(new Uint8Array(cipherBuffer))
    };
  }
  async decryptJson(cipher, key) {
    const iv = this.fromBase64Url(cipher.iv);
    const ivCopy = new Uint8Array(new ArrayBuffer(iv.byteLength));
    ivCopy.set(iv);
    const data = this.fromBase64Url(cipher.ct);
    const cipherCopy = new Uint8Array(new ArrayBuffer(data.byteLength));
    cipherCopy.set(data);
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivCopy },
      key,
      cipherCopy
    );
    const text = new TextDecoder().decode(plainBuffer);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("storage decrypt produced non-JSON payload");
    }
  }
  toBase64Url(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  fromBase64Url(text) {
    const raw = String(text ?? "");
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
};

// src/crypto.ts
import { decryptMessageWithMeta, encryptMessageWithMeta, generateRandomPair } from "unsea";
var CRYPTO_PUBLIC_INFO_TYPE = "pp-crypto-public-info-v1";
var CRYPTO_PUBLIC_REQUEST_TYPE = "pp-crypto-public-request-v1";
var ENCRYPTED_BROADCAST_TYPE = "pp-encrypted-broadcast-v1";
var ENCRYPTED_DIRECT_TYPE = "pp-encrypted-direct-v1";
var PeerPigeonCryptoProtocol = class {
  constructor(mesh, gossip, options) {
    this.keyPair = null;
    this.publicKeys = /* @__PURE__ */ new Map();
    this.callbacks = {};
    this.announceTimer = null;
    this.initialized = false;
    this.onGossipMessageBound = (data) => {
      this.handleGossipMessage(data).catch((error) => this.emitError(error));
    };
    this.onDirectMessageBound = (data) => {
      this.handleDirectMessage(data.message).catch((error) => this.emitError(error));
    };
    this.onPeerConnectedBound = (peerId) => {
      this.sendPublicInfoDirect(peerId);
      if (!this.publicKeys.has(peerId)) this.requestPeerKey(peerId);
    };
    this.onSignalingConnectedBound = () => {
      this.registerLocalKey();
      this.announcePublicKey();
    };
    const roomId = String(options.roomId ?? "").trim();
    if (!roomId) throw new Error("PeerPigeonCryptoProtocol requires a non-empty roomId");
    this.mesh = mesh;
    this.gossip = gossip;
    this.options = {
      roomId,
      roomSecret: String(options.roomSecret ?? ""),
      keyPair: options.keyPair,
      persistKeyPair: options.persistKeyPair ?? true,
      storageKey: String(options.storageKey ?? "peerpigeon:crypto-keys:v1"),
      announceIntervalMs: options.announceIntervalMs ?? 1e4,
      keyDiscoveryTimeoutMs: options.keyDiscoveryTimeoutMs ?? 8e3
    };
  }
  async init() {
    if (this.initialized) return;
    this.keyPair = this.options.keyPair ?? this.loadStoredKeyPair() ?? await generateRandomPair();
    this.validateKeyPair(this.keyPair);
    this.persistKeyPair(this.keyPair);
    this.initialized = true;
    this.gossip.on("messageReceived", this.onGossipMessageBound);
    this.gossip.on("directMessageReceived", this.onDirectMessageBound);
    this.mesh.on("peer:connected", this.onPeerConnectedBound);
    this.mesh.on("signaling:connected", this.onSignalingConnectedBound);
    this.registerLocalKey();
    this.announcePublicKey();
    if (this.options.announceIntervalMs > 0) {
      this.announceTimer = setInterval(() => this.announcePublicKey(), this.options.announceIntervalMs);
    }
  }
  getKeyPair() {
    if (!this.keyPair) throw new Error("Crypto protocol has not been initialized");
    return { ...this.keyPair };
  }
  getPublicKey(peerId) {
    const value = this.publicKeys.get(String(peerId ?? "").trim());
    return value ? { ...value } : null;
  }
  getKnownPeerKeys() {
    return Array.from(this.publicKeys.values()).map((value) => ({ ...value })).sort((a, b) => a.peerId.localeCompare(b.peerId));
  }
  announcePublicKey() {
    const payload = this.localPublicInfoPayload();
    if (!payload) return;
    this.gossip.broadcast(payload, { sender: payload.from, timestamp: payload.timestamp, internal: true });
    for (const peerId of this.mesh.getConnectedPeers()) this.sendPublicInfoDirect(peerId, payload);
  }
  requestPeerKey(peerId) {
    const self = String(this.mesh.getClientId() ?? "").trim();
    const target = String(peerId ?? "").trim();
    if (!self || !target || target === self) return;
    const payload = {
      __ppType: CRYPTO_PUBLIC_REQUEST_TYPE,
      from: self,
      to: target,
      timestamp: Date.now()
    };
    this.gossip.sendDirect(target, payload);
    this.gossip.broadcast(payload, { sender: self, timestamp: payload.timestamp, internal: true });
  }
  async waitForPeerKey(peerId, timeoutMs = this.options.keyDiscoveryTimeoutMs) {
    const target = String(peerId ?? "").trim();
    const existing = this.getPublicKey(target);
    if (existing) return existing;
    this.requestPeerKey(target);
    return await new Promise((resolve, reject) => {
      const handler = (key) => {
        if (key.peerId !== target) return;
        clearTimeout(timer);
        this.off("keyDiscovered", handler);
        resolve({ ...key });
      };
      const timer = setTimeout(() => {
        this.off("keyDiscovered", handler);
        reject(new Error(`Timed out discovering encryption key for peer ${target}`));
      }, Math.max(0, timeoutMs));
      this.on("keyDiscovered", handler);
    });
  }
  async encryptRoom(plaintext) {
    const cryptoApi = this.cryptoApi();
    const key = await this.deriveRoomKey();
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const cipher = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(String(plaintext))
    );
    return { alg: "A256GCM", iv: this.toBase64Url(iv), ct: this.toBase64Url(new Uint8Array(cipher)) };
  }
  async decryptRoom(cipher) {
    if (!cipher || cipher.alg !== "A256GCM") throw new Error("Unsupported room cipher");
    const cryptoApi = this.cryptoApi();
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: this.fromBase64Url(cipher.iv) },
      await this.deriveRoomKey(),
      this.fromBase64Url(cipher.ct)
    );
    return new TextDecoder().decode(plaintext);
  }
  async createEncryptedBroadcast(plaintext) {
    return {
      __ppType: ENCRYPTED_BROADCAST_TYPE,
      from: String(this.mesh.getClientId() ?? "").trim(),
      roomCipher: await this.encryptRoom(plaintext),
      timestamp: Date.now()
    };
  }
  async createEncryptedDirect(peerId, plaintext, timeoutMs) {
    if (!this.keyPair) throw new Error("Crypto protocol has not been initialized");
    const target = String(peerId ?? "").trim();
    const recipient = this.getPublicKey(target) ?? await this.waitForPeerKey(target, timeoutMs);
    return {
      __ppType: ENCRYPTED_DIRECT_TYPE,
      from: String(this.mesh.getClientId() ?? "").trim(),
      to: target,
      cipher: await encryptMessageWithMeta(String(plaintext), { epub: recipient.epub }),
      timestamp: Date.now()
    };
  }
  async broadcastEncrypted(plaintext, metadata = {}, options = {}) {
    const payload = await this.createEncryptedBroadcast(plaintext);
    const messageMetadata = { ...metadata, encrypted: true, sender: payload.from, timestamp: payload.timestamp };
    return options.trackDelivery ? this.gossip.broadcastReliable(payload, messageMetadata, options) : this.gossip.broadcast(payload, messageMetadata, options);
  }
  async sendEncryptedDirect(peerId, plaintext, timeoutMs) {
    const payload = await this.createEncryptedDirect(peerId, plaintext, timeoutMs);
    const messageId = this.gossip.sendDirect(payload.to, payload);
    if (!messageId) throw new Error(`No route to peer ${payload.to}`);
    return messageId;
  }
  async decryptEncryptedBroadcast(payload) {
    return await this.decryptRoom(payload.roomCipher);
  }
  async decryptEncryptedDirect(payload) {
    if (!this.keyPair) throw new Error("Crypto protocol has not been initialized");
    return await decryptMessageWithMeta(payload.cipher, this.keyPair.epriv);
  }
  on(event, callback) {
    const callbacks = this.callbacks[event];
    if (callbacks) callbacks.add(callback);
    else this.callbacks[event] = /* @__PURE__ */ new Set([callback]);
  }
  off(event, callback) {
    this.callbacks[event]?.delete(callback);
  }
  destroy() {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    if (this.initialized) {
      this.gossip.off("messageReceived", this.onGossipMessageBound);
      this.gossip.off("directMessageReceived", this.onDirectMessageBound);
      this.mesh.off("peer:connected", this.onPeerConnectedBound);
      this.mesh.off("signaling:connected", this.onSignalingConnectedBound);
    }
    this.initialized = false;
    this.publicKeys.clear();
    for (const callbacks of Object.values(this.callbacks)) callbacks?.clear();
  }
  static isProtocolPayload(value) {
    if (!value || typeof value !== "object") return false;
    const type = value.__ppType;
    return type === CRYPTO_PUBLIC_INFO_TYPE || type === CRYPTO_PUBLIC_REQUEST_TYPE || type === ENCRYPTED_BROADCAST_TYPE || type === ENCRYPTED_DIRECT_TYPE;
  }
  validateKeyPair(value) {
    if (!value || ["pub", "priv", "epub", "epriv"].some((key) => typeof value[key] !== "string")) {
      throw new Error("Invalid PeerPigeon key pair");
    }
  }
  loadStoredKeyPair() {
    if (!this.options.persistKeyPair) return null;
    try {
      const raw = globalThis.sessionStorage?.getItem(`${this.options.storageKey}:${this.options.roomId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      this.validateKeyPair(parsed);
      return parsed;
    } catch {
      return null;
    }
  }
  persistKeyPair(value) {
    if (!this.options.persistKeyPair) return;
    try {
      globalThis.sessionStorage?.setItem(`${this.options.storageKey}:${this.options.roomId}`, JSON.stringify(value));
    } catch {
    }
  }
  registerLocalKey() {
    const payload = this.localPublicInfoPayload();
    if (payload) this.upsertPublicKey(payload.from, payload);
  }
  localPublicInfoPayload() {
    const peerId = String(this.mesh.getClientId() ?? "").trim();
    if (!peerId || !this.keyPair) return null;
    return {
      __ppType: CRYPTO_PUBLIC_INFO_TYPE,
      from: peerId,
      pub: this.keyPair.pub,
      epub: this.keyPair.epub,
      timestamp: Date.now()
    };
  }
  sendPublicInfoDirect(peerId, payload = this.localPublicInfoPayload()) {
    if (!payload || !peerId || peerId === payload.from) return;
    this.gossip.sendDirect(peerId, payload);
  }
  upsertPublicKey(peerId, payload) {
    const id = String(peerId ?? "").trim();
    if (!id || typeof payload.pub !== "string" || typeof payload.epub !== "string") return;
    const existing = this.publicKeys.get(id);
    if (existing && existing.updatedAt > payload.timestamp) return;
    const value = {
      peerId: id,
      pub: payload.pub,
      epub: payload.epub,
      updatedAt: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now(),
      local: id === this.mesh.getClientId()
    };
    this.publicKeys.set(id, value);
    this.emit("keyDiscovered", { ...value });
  }
  isPublicInfo(value) {
    const payload = value;
    return !!payload && payload.__ppType === CRYPTO_PUBLIC_INFO_TYPE && typeof payload.from === "string" && typeof payload.pub === "string" && typeof payload.epub === "string";
  }
  isPublicRequest(value) {
    const payload = value;
    return !!payload && payload.__ppType === CRYPTO_PUBLIC_REQUEST_TYPE && typeof payload.from === "string" && typeof payload.to === "string";
  }
  isEncryptedBroadcast(value) {
    const payload = value;
    return !!payload && payload.__ppType === ENCRYPTED_BROADCAST_TYPE && !!payload.roomCipher;
  }
  isEncryptedDirect(value) {
    const payload = value;
    return !!payload && payload.__ppType === ENCRYPTED_DIRECT_TYPE && typeof payload.from === "string" && typeof payload.to === "string" && payload.cipher != null;
  }
  async handleGossipMessage(data) {
    const payload = data.message.data;
    if (this.isPublicInfo(payload)) {
      if (data.local || !data.message.sender || payload.from === data.message.sender) this.upsertPublicKey(payload.from, payload);
      return;
    }
    if (this.isPublicRequest(payload)) {
      if (payload.to === this.mesh.getClientId()) this.sendPublicInfoDirect(payload.from);
      return;
    }
    if (!this.isEncryptedBroadcast(payload)) return;
    const plaintext = await this.decryptEncryptedBroadcast(payload);
    this.emit("encryptedBroadcastReceived", { plaintext, payload, ...data });
  }
  async handleDirectMessage(message) {
    const payload = message.data;
    if (this.isPublicInfo(payload)) {
      if (payload.from === message.from) this.upsertPublicKey(payload.from, payload);
      return;
    }
    if (this.isPublicRequest(payload)) {
      if (payload.from === message.from && payload.to === this.mesh.getClientId()) this.sendPublicInfoDirect(payload.from);
      return;
    }
    if (!this.isEncryptedDirect(payload) || payload.to !== this.mesh.getClientId() || payload.from !== message.from) return;
    const plaintext = await this.decryptEncryptedDirect(payload);
    this.emit("encryptedDirectReceived", { plaintext, payload, message });
  }
  async deriveRoomKey() {
    const cryptoApi = this.cryptoApi();
    const roomScope = this.options.roomSecret ? `${this.options.roomId}:${this.options.roomSecret}` : this.options.roomId;
    const seed = new TextEncoder().encode(
      `peerpigeon:room-broadcast:v1:${roomScope}`
    );
    const hash = await cryptoApi.subtle.digest("SHA-256", seed);
    return await cryptoApi.subtle.importKey("raw", hash, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  cryptoApi() {
    if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is unavailable");
    return globalThis.crypto;
  }
  toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  fromBase64Url(value) {
    const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  emitError(error) {
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }
  emit(event, data) {
    for (const callback of this.callbacks[event] ?? []) {
      try {
        callback(data);
      } catch {
      }
    }
  }
};

// src/index.ts
var DEFAULT_SIGNALING_SERVERS = Object.freeze([
  "wss://peer.ooo/ws",
  "wss://decentralize.ooo/ws",
  "wss://freertc-worker-dev.draeder.workers.dev/ws",
  "wss://oooooooooooooooooooooooooooo.ooo/ws"
]);
var DEFAULT_CLOSE_SIGNALING_RELAY_COUNT = 4;
var FREERTC_RESTORE_GRACE_MS = 11e3;
function canonicalSignalingUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    if (!url.pathname || url.pathname === "/") url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
function hexIdBytes(peerId) {
  const normalized = String(peerId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("Automatic relay selection requires a 256-bit hexadecimal peer ID");
  }
  return Uint8Array.from(
    { length: 32 },
    (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  );
}
function compareXorDistance(left, right, target) {
  for (let index = 0; index < target.length; index += 1) {
    const leftDistanceByte = left[index] ^ target[index];
    const rightDistanceByte = right[index] ^ target[index];
    if (leftDistanceByte !== rightDistanceByte) return leftDistanceByte - rightDistanceByte;
  }
  return 0;
}
async function rankSignalingServersByDistance(peerId, relayUrls) {
  const candidates = Array.from(new Set(
    relayUrls.map((url) => canonicalSignalingUrl(url)).filter((url) => Boolean(url))
  ));
  if (candidates.length === 0) return [];
  const target = hexIdBytes(peerId);
  const encoder = new TextEncoder();
  const scored = await Promise.all(candidates.map(async (url) => {
    const hostname = new URL(url).hostname.toLowerCase();
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(hostname));
    return { url, nodeId: new Uint8Array(digest) };
  }));
  scored.sort((left, right) => compareXorDistance(left.nodeId, right.nodeId, target) || left.url.localeCompare(right.url));
  return scored.map(({ url }) => url);
}
async function selectClosestSignalingServer(peerId, relayUrls) {
  const ranked = await rankSignalingServersByDistance(peerId, relayUrls);
  if (ranked.length === 0) throw new Error("No valid FreeRTC relays are available");
  return ranked[0];
}
async function discoverClosestSignalingServers(options) {
  const bootstrap = canonicalSignalingUrl(options.bootstrapServer);
  if (!bootstrap) throw new Error(`Invalid FreeRTC bootstrap URL: ${options.bootstrapServer}`);
  const candidates = /* @__PURE__ */ new Set([bootstrap]);
  for (const fallback of options.fallbackServers ?? []) {
    const normalized = canonicalSignalingUrl(fallback);
    if (normalized) candidates.add(normalized);
  }
  const registryUrl = new URL(bootstrap);
  registryUrl.protocol = registryUrl.protocol === "wss:" ? "https:" : "http:";
  registryUrl.pathname = "/api/v1/relays";
  registryUrl.search = "";
  registryUrl.hash = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, options.timeoutMs ?? 4e3));
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(registryUrl.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (response.ok) {
      const body = await response.json();
      for (const record of Array.isArray(body?.relays) ? body.relays : []) {
        const normalized = canonicalSignalingUrl(typeof record === "string" ? record : String(record?.url || ""));
        if (normalized) candidates.add(normalized);
      }
    }
  } catch {
  } finally {
    clearTimeout(timer);
  }
  const ranked = await rankSignalingServersByDistance(options.peerId, Array.from(candidates));
  const limit = Math.max(1, Math.trunc(options.limit ?? DEFAULT_CLOSE_SIGNALING_RELAY_COUNT));
  return ranked.slice(0, limit);
}
async function discoverClosestSignalingServer(options) {
  const ranked = await discoverClosestSignalingServers({ ...options, limit: 1 });
  if (ranked.length === 0) throw new Error("No valid FreeRTC relays are available");
  return ranked[0];
}
var PartialMesh = class {
  constructor(config = {}) {
    this.peers = /* @__PURE__ */ new Map();
    this.signalingClient = null;
    this.discoveredPeers = /* @__PURE__ */ new Set();
    this.clientId = null;
    this.selfAliases = /* @__PURE__ */ new Set();
    this.retiredPeerIds = /* @__PURE__ */ new Set();
    this.eventHandlers = /* @__PURE__ */ new Map();
    this.connecting = /* @__PURE__ */ new Set();
    this.connectionTimers = /* @__PURE__ */ new Map();
    this.connectionStartedAtMs = /* @__PURE__ */ new Map();
    /** First local observation of FreeRTC negotiations not tracked by PartialMesh. */
    this.orphanRtcFirstSeenAtMs = /* @__PURE__ */ new Map();
    this.peerConnectedAtMs = /* @__PURE__ */ new Map();
    this.discoveredAtMs = /* @__PURE__ */ new Map();
    this.maintenanceTimer = null;
    this.membershipTimer = null;
    this.underConnectedSinceMs = null;
    this.lastHardResetAtMs = 0;
    this.lastUnderConnectedRecoveryAtMs = 0;
    this.lastDiscoveryRefreshAtMs = 0;
    this.lastSignalingReconnectAtMs = 0;
    this.restoreGraceUntilMs = 0;
    this.dialFailureCount = /* @__PURE__ */ new Map();
    this.dialBackoffUntilMs = /* @__PURE__ */ new Map();
    this.nonInitiatorFallbackTimers = /* @__PURE__ */ new Map();
    this.rebalanceCooldownUntilMs = 0;
    this.rebalanceAttemptAtMs = /* @__PURE__ */ new Map();
    this.pendingRebalanceDropByTarget = /* @__PURE__ */ new Map();
    /** Converged global peer membership — populated via in-band membership gossip. */
    this.globalPeers = /* @__PURE__ */ new Set();
    /** Versioned, expiring CECR membership records keyed by subject peer. */
    this.membershipRecordsById = /* @__PURE__ */ new Map();
    this.membershipEquivocationAtById = /* @__PURE__ */ new Map();
    this.membershipIncarnation = Date.now();
    this.membershipSequence = 0;
    /** Relayed per-peer capacity used to give scarce, underfilled peers priority. */
    this.peerCapacityById = /* @__PURE__ */ new Map();
    /** Relayed adjacency snapshots used to reconstruct the known network graph. */
    this.peerTopologyById = /* @__PURE__ */ new Map();
    this.localCapacityUpdatedAtMs = Date.now();
    this.localTopologyUpdatedAtMs = Date.now();
    const automaticSignalingServer = config.automaticSignalingServer ?? !config.signalingServer;
    const bootstrapServer = String(config.signalingServer || DEFAULT_SIGNALING_SERVERS[0]).trim();
    const configuredSignalingServers = Array.from(new Set((config.signalingServers != null ? [bootstrapServer, ...config.signalingServers] : automaticSignalingServer ? DEFAULT_SIGNALING_SERVERS : [bootstrapServer]).map((url) => String(url || "").trim()).filter(Boolean)));
    const signalingServers = configuredSignalingServers.length > 0 ? configuredSignalingServers : [...DEFAULT_SIGNALING_SERVERS];
    this.config = {
      minPeers: config.minPeers ?? 2,
      maxPeers: config.maxPeers ?? 10,
      tolerantPeers: config.tolerantPeers ?? Math.max(1, Math.min(2, Math.floor((config.maxPeers ?? 10) * 0.25))),
      signalingServer: bootstrapServer,
      signalingServers,
      automaticSignalingServer,
      networkId: config.networkId ?? config.sessionId ?? "peerpigeon",
      sessionId: config.sessionId ?? "default-session",
      autoDiscover: config.autoDiscover ?? true,
      autoConnect: config.autoConnect ?? true,
      // Prefer FreeRTC's richer built-in ICE profile by default.
      iceServers: config.iceServers ?? null,
      // FreeRTC retries relayed offers for up to ~30s; keep this above that window
      // so we do not abort otherwise-recoverable negotiations.
      connectionTimeoutMs: config.connectionTimeoutMs ?? 45e3,
      maintenanceIntervalMs: config.maintenanceIntervalMs ?? 1e3,
      underConnectedResetMs: config.underConnectedResetMs ?? 0,
      nonInitiatorFallbackDialMs: config.nonInitiatorFallbackDialMs ?? 2500,
      peerStateMaxAgeMs: config.peerStateMaxAgeMs ?? 6e4,
      trickleIce: config.trickleIce ?? true,
      membershipLeaseMs: config.membershipLeaseMs ?? 3e4,
      membershipGossipIntervalMs: config.membershipGossipIntervalMs ?? 5e3,
      membershipTombstoneRetentionMs: config.membershipTombstoneRetentionMs ?? 12e4,
      membershipClockSkewMs: config.membershipClockSkewMs ?? 5e3
    };
    this.validatePeerLimits(this.config.minPeers, this.config.maxPeers, this.config.tolerantPeers);
    if (!Number.isSafeInteger(this.config.membershipLeaseMs) || this.config.membershipLeaseMs < 3e3) {
      throw new RangeError("membershipLeaseMs must be a safe integer of at least 3000");
    }
    if (!Number.isSafeInteger(this.config.membershipGossipIntervalMs) || this.config.membershipGossipIntervalMs < 500 || this.config.membershipGossipIntervalMs > Math.floor(this.config.membershipLeaseMs / 3)) {
      throw new RangeError("membershipGossipIntervalMs must be at least 500 and no more than one third of membershipLeaseMs");
    }
    if (!Number.isSafeInteger(this.config.membershipClockSkewMs) || this.config.membershipClockSkewMs < 0) {
      throw new RangeError("membershipClockSkewMs must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(this.config.membershipTombstoneRetentionMs) || this.config.membershipTombstoneRetentionMs < this.config.membershipLeaseMs + 2 * this.config.membershipClockSkewMs + this.config.membershipGossipIntervalMs) {
      throw new RangeError("membershipTombstoneRetentionMs must be at least lease + 2*clockSkew + gossipInterval");
    }
    const events = [
      "identity:ready",
      "signaling:connected",
      "signaling:disconnected",
      "signaling:error",
      "signaling:log",
      "peer:connected",
      "peer:disconnected",
      "peer:data",
      "peer:error",
      "peer:discovered",
      "mesh:ready",
      "mesh:membership",
      "mesh:capacity",
      "mesh:graph"
    ];
    events.forEach((event) => this.eventHandlers.set(event, /* @__PURE__ */ new Set()));
  }
  validatePeerLimits(minPeers, maxPeers, tolerantPeers) {
    if (!Number.isSafeInteger(minPeers) || minPeers < 0) {
      throw new RangeError("minPeers must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(maxPeers) || maxPeers < 1) {
      throw new RangeError("maxPeers must be a positive safe integer");
    }
    if (minPeers > maxPeers) {
      throw new RangeError("minPeers cannot exceed maxPeers");
    }
    if (!Number.isSafeInteger(tolerantPeers) || tolerantPeers < 0) {
      throw new RangeError("tolerantPeers must be a non-negative safe integer");
    }
  }
  normalizePeerId(peerId) {
    return (peerId ?? "").trim();
  }
  normalizeSignalingUrl(rawUrl) {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const isLocalDevelopmentHost = hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local") || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = isLocalDevelopmentHost ? "ws:" : "wss:";
    if (url.protocol === "ws:" && !isLocalDevelopmentHost) url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error(`Unsupported signaling protocol: ${url.protocol}`);
    }
    return url.toString();
  }
  addSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.selfAliases.add(id);
    this.discoveredPeers.delete(id);
    this.globalPeers.delete(id);
    this.membershipRecordsById.delete(id);
    this.membershipEquivocationAtById.delete(id);
  }
  isSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return false;
    return this.selfAliases.has(id);
  }
  addDiscoveredPeer(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id || this.isSelfAlias(id) || this.retiredPeerIds.has(id)) return;
    if (this.discoveredPeers.has(id)) return;
    this.discoveredPeers.add(id);
    this.discoveredAtMs.set(id, Date.now());
    this.emit("peer:discovered", id);
    this.emit("mesh:graph", this.getGraphSnapshot());
  }
  rotateBrowserPeerId(signalingUrls) {
    const requestedPeerId = Array.from(
      (globalThis.window?.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, "0")
    ).join("");
    let previousPeerId = null;
    let retiredPeerIds = [];
    try {
      const storage = globalThis.window?.sessionStorage;
      if (storage) {
        const key = `peerpigeon:previous-peer-id:federated:${this.config.networkId}:${this.config.sessionId}`;
        const retiredKey = `${key}:retired`;
        previousPeerId = this.normalizePeerId(storage.getItem(key)) || null;
        try {
          const storedRetired = JSON.parse(storage.getItem(retiredKey) || "[]");
          if (Array.isArray(storedRetired)) {
            retiredPeerIds = storedRetired.map((peerId) => this.normalizePeerId(peerId)).filter(Boolean);
          }
        } catch {
          retiredPeerIds = [];
        }
        for (const signalingUrl of signalingUrls) {
          const relayScope = new URL(signalingUrl).origin;
          const legacyKey = `peerpigeon:previous-peer-id:${relayScope}:${this.config.networkId}:${this.config.sessionId}`;
          const legacyPeerId = this.normalizePeerId(storage.getItem(legacyKey));
          if (legacyPeerId) retiredPeerIds.push(legacyPeerId);
          try {
            const legacyRetired = JSON.parse(storage.getItem(`${legacyKey}:retired`) || "[]");
            if (Array.isArray(legacyRetired)) retiredPeerIds.push(...legacyRetired);
          } catch {
          }
        }
        if (previousPeerId) retiredPeerIds.push(previousPeerId);
        retiredPeerIds = Array.from(new Set(retiredPeerIds)).filter((peerId) => peerId !== requestedPeerId).slice(-64);
        storage.setItem(key, requestedPeerId);
        storage.setItem(retiredKey, JSON.stringify(retiredPeerIds));
      }
    } catch {
    }
    return { requestedPeerId, previousPeerId, retiredPeerIds };
  }
  retirePeerId(peerId) {
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
      try {
        this.signalingClient?.closeConnection?.(id);
      } catch {
      }
    }
    return changed;
  }
  reconcileSignalingPeers(rawPeerIds) {
    const nextPeers = new Set(
      rawPeerIds.map((peerId) => this.normalizePeerId(peerId)).filter((peerId) => peerId && !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId))
    );
    for (const peerId of Array.from(this.discoveredPeers)) {
      if (!nextPeers.has(peerId)) {
        this.discoveredPeers.delete(peerId);
        this.discoveredAtMs.delete(peerId);
      }
    }
    for (const peerId of nextPeers) this.addDiscoveredPeer(peerId);
  }
  getConnectedPeerCount() {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.connected) count++;
    }
    return count;
  }
  getPendingPeerCount() {
    const pending = new Set(this.connecting);
    for (const peer of this.peers.values()) {
      if (!peer.connected) {
        pending.add(peer.id);
      }
    }
    return pending.size;
  }
  noteLocalCapacityChanged() {
    const updatedAt = Date.now();
    this.localCapacityUpdatedAtMs = Math.max(updatedAt, this.localCapacityUpdatedAtMs + 1);
    this.localTopologyUpdatedAtMs = Math.max(updatedAt, this.localTopologyUpdatedAtMs + 1);
    this.emit("mesh:capacity", this.getPeerCapacities());
    this.emit("mesh:graph", this.getGraphSnapshot());
  }
  freshPeerCapacity(peerId) {
    const state = this.peerCapacityById.get(peerId);
    if (!state || Date.now() - state.updatedAt > this.config.peerStateMaxAgeMs) return null;
    return state;
  }
  /**
   * Known underfilled peers sort first, with lower-capacity peers ahead of
   * high-capacity peers. Unknown peers remain eligible; known-full peers sort last.
   */
  compareCapacityPriority(a, b) {
    const capacityA = this.freshPeerCapacity(a);
    const capacityB = this.freshPeerCapacity(b);
    const bucket = (capacity) => {
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
  compareDialCandidates(a, b) {
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
  trimExcessPeers() {
    const connectedPeers = this.getConnectedPeers();
    const overflow = connectedPeers.length - this.config.maxPeers;
    if (overflow <= 0) return;
    this.rebalanceCooldownUntilMs = Math.max(this.rebalanceCooldownUntilMs, Date.now() + 2e3);
    const protectedPeerIds = this.cecrProtectedConnectedPeerIds();
    const dropOrder = connectedPeers.map((peerId) => ({
      peerId,
      connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0,
      cecrProtected: protectedPeerIds.has(peerId)
    })).sort((a, b) => {
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
  getOldestPendingAgeMs() {
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
  isHexId(value) {
    return /^[0-9a-f]+$/i.test(value);
  }
  fastIdHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  peerDistance(a, b) {
    const left = this.normalizePeerId(a).toLowerCase();
    const right = this.normalizePeerId(b).toLowerCase();
    if (left && right && this.isHexId(left) && this.isHexId(right)) {
      try {
        return BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
      } catch {
      }
    }
    const leftHash = this.fastIdHash(left);
    const rightHash = this.fastIdHash(right);
    return BigInt((leftHash ^ rightHash) >>> 0);
  }
  cecrNumericPeerId(peerId) {
    const hex = this.normalizePeerId(peerId).replace(/-/g, "").toLowerCase();
    if (hex.length !== 64 || !this.isHexId(hex)) return null;
    try {
      return BigInt(`0x${hex}`);
    } catch {
      return null;
    }
  }
  cecrBucketRank(distance) {
    return distance === 0n ? -1 : distance.toString(2).length - 1;
  }
  cecrCoordinateNeighbors() {
    const selfId = this.normalizePeerId(this.clientId);
    const liveIds = Array.from(/* @__PURE__ */ new Set([selfId, ...this.globalPeers])).filter(Boolean);
    const numeric = liveIds.map((peerId) => ({ peerId, value: this.cecrNumericPeerId(peerId) })).filter((peer) => peer.value != null).sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : left.peerId.localeCompare(right.peerId));
    const selfIndex = numeric.findIndex((peer) => peer.peerId === selfId);
    const required = /* @__PURE__ */ new Set();
    if (selfIndex > 0) required.add(numeric[selfIndex - 1].peerId);
    if (selfIndex >= 0 && selfIndex + 1 < numeric.length) required.add(numeric[selfIndex + 1].peerId);
    return required;
  }
  cecrOverlayDialPriority(peerId) {
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
  cecrProtectedConnectedPeerIds() {
    const protectedIds = this.cecrCoordinateNeighbors();
    const self = this.cecrNumericPeerId(this.clientId ?? "");
    if (self == null) return protectedIds;
    const representativeByBucket = /* @__PURE__ */ new Map();
    for (const peerId of this.getConnectedPeers().slice().sort()) {
      const peer = this.cecrNumericPeerId(peerId);
      if (peer == null) continue;
      const rank = this.cecrBucketRank(self ^ peer);
      if (!representativeByBucket.has(rank)) representativeByBucket.set(rank, peerId);
    }
    for (const peerId of representativeByBucket.values()) protectedIds.add(peerId);
    return protectedIds;
  }
  maybeRebalanceForCloserPeer(candidates) {
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
    if (connectedPeers.length <= this.config.minPeers) {
      return false;
    }
    const reservedDropPeerIds = new Set(this.pendingRebalanceDropByTarget.values());
    const cecrProtectedPeerIds = this.cecrProtectedConnectedPeerIds();
    const connectedByDistance = connectedPeers.filter((peerId) => !reservedDropPeerIds.has(peerId)).map((peerId) => ({
      peerId,
      distance: this.peerDistance(selfId, peerId),
      connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0,
      cecrProtected: cecrProtectedPeerIds.has(peerId)
    })).sort((a, b) => {
      if (a.cecrProtected !== b.cecrProtected) return a.cecrProtected ? -1 : 1;
      return a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId);
    });
    const candidateByDistance = candidates.map((peerId) => ({
      peerId,
      distance: this.peerDistance(selfId, peerId),
      discoveredAt: this.discoveredAtMs.get(peerId) ?? 0,
      lastAttemptAt: this.rebalanceAttemptAtMs.get(peerId) ?? 0
    })).sort((a, b) => {
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
      return discoveredAgeMs >= 1e3 && sinceAttemptMs >= 5e3;
    });
    if (!closestCandidate || !farthestConnected) {
      return false;
    }
    const connectedAgeMs = now - (farthestConnected.connectedAt || 0);
    if (connectedAgeMs < 4e3) {
      return false;
    }
    const candidateDiscoveredAgeMs = now - closestCandidate.discoveredAt;
    const repairsCecrOverlay = this.cecrOverlayDialPriority(closestCandidate.peerId) === 0;
    const materiallyCloser = repairsCecrOverlay || closestCandidate.distance * 4n < farthestConnected.distance * 3n;
    const staleExcludedCandidate = candidateDiscoveredAgeMs >= 3e3;
    if (!materiallyCloser && !staleExcludedCandidate) {
      return false;
    }
    const otherDiscoveredPeers = Array.from(this.discoveredPeers).filter((p) => {
      const id = this.normalizePeerId(p);
      return id && id !== selfId && id !== farthestConnected.peerId && id !== closestCandidate.peerId;
    }).length;
    if (otherDiscoveredPeers < 1) {
      return false;
    }
    this.rebalanceCooldownUntilMs = now + 4e3;
    this.rebalanceAttemptAtMs.set(closestCandidate.peerId, now);
    this.rebalanceAttemptAtMs.set(farthestConnected.peerId, now);
    this.pendingRebalanceDropByTarget.set(closestCandidate.peerId, farthestConnected.peerId);
    this.emit("signaling:log", {
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
  async init() {
    const signalingCandidates = Array.from(new Set(
      this.config.signalingServers.map((url) => this.normalizeSignalingUrl(url))
    ));
    const { requestedPeerId, previousPeerId, retiredPeerIds } = this.rotateBrowserPeerId(signalingCandidates);
    this.clientId = requestedPeerId;
    this.addSelfAlias(requestedPeerId);
    this.emit("identity:ready", { clientId: requestedPeerId });
    const signalingUrls = this.config.automaticSignalingServer ? await discoverClosestSignalingServers({
      bootstrapServer: this.config.signalingServer,
      peerId: requestedPeerId,
      fallbackServers: signalingCandidates,
      limit: DEFAULT_CLOSE_SIGNALING_RELAY_COUNT
    }) : [this.normalizeSignalingUrl(this.config.signalingServer)];
    this.emit("signaling:log", {
      message: `[signal] close federated relays ${signalingUrls.join(" -> ")}`
    });
    for (const peerId of retiredPeerIds) {
      this.retiredPeerIds.add(peerId);
      this.addSelfAlias(peerId);
    }
    this.signalingClient = new freertc_client_adapter_default(signalingUrls, {
      networkId: this.config.networkId,
      roomId: this.config.sessionId,
      peerId: requestedPeerId,
      previousPeerId,
      retiredPeerIds,
      iceServers: this.config.iceServers,
      trickleIce: this.config.trickleIce
    });
    this.signalingClient.on("connected", (data) => {
      const rawClientId = data?.clientId;
      const nextClientId = this.normalizePeerId(rawClientId);
      this.clientId = nextClientId;
      this.lastSignalingReconnectAtMs = Date.now();
      this.addSelfAlias(nextClientId);
      this.addSelfAlias(data?.requestedClientId);
      this.addSelfAlias(data?.previousClientId);
      this.renewLocalMembership(true);
      this.startMembershipLoop();
      this.emit("signaling:connected", {
        clientId: this.clientId,
        rawClientId,
        signalingServer: data?.signalUrl || signalingUrls[0]
      });
      if (this.config.autoDiscover) {
        this.signalingClient.joinSession(this.config.sessionId);
      }
      if (this.config.autoConnect) {
        this.startMaintenanceLoop();
      }
    });
    this.signalingClient.on("disconnected", () => {
      this.emit("signaling:disconnected");
    });
    this.signalingClient.on("lifecycle:resume", (data) => {
      this.recoverMeshAfterInactivity(String(data?.reason || "resume"));
    });
    this.signalingClient.on("joined", (data) => {
      data.clients.forEach((rawPeerId) => {
        const peerId = this.normalizePeerId(rawPeerId);
        this.addDiscoveredPeer(peerId);
      });
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    });
    this.signalingClient.on("peer-joined", (data) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (peerId) {
        this.addDiscoveredPeer(peerId);
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });
    this.signalingClient.on("peer-left", (data) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId) return;
      this.removeFromGlobalMembership(peerId);
      this.discoveredPeers.delete(peerId);
      this.dialFailureCount.delete(peerId);
      this.dialBackoffUntilMs.delete(peerId);
      this.removePeer(peerId, true);
    });
    this.signalingClient.on("peers-updated", (data) => {
      this.reconcileSignalingPeers(Array.isArray(data?.peers) ? data.peers : []);
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    });
    this.signalingClient.on("rtc:connected", (data) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) {
        try {
          this.signalingClient?.closeConnection?.(peerId);
        } catch {
        }
        return;
      }
      this.orphanRtcFirstSeenAtMs.delete(peerId);
      let peerConnection = this.peers.get(peerId);
      if (!peerConnection) {
        peerConnection = { id: peerId, connected: false, initiator: false };
        this.peers.set(peerId, peerConnection);
      }
      if (peerConnection.connected) return;
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
      this.emit("peer:connected", peerId);
      const rebalanceDropPeerId = this.pendingRebalanceDropByTarget.get(peerId);
      if (rebalanceDropPeerId) {
        this.pendingRebalanceDropByTarget.delete(peerId);
        if (rebalanceDropPeerId !== peerId && this.peers.get(rebalanceDropPeerId)?.connected) {
          if (this.getConnectedPeerCount() > this.config.maxPeers) {
            this.disconnectFromPeer(rebalanceDropPeerId);
          }
        }
      }
      this.trimExcessPeers();
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
      if (this.getConnectedPeers().length >= this.config.minPeers) {
        this.emit("mesh:ready");
      }
      this.broadcastMembership();
    });
    this.signalingClient.on("rtc:disconnected", (data) => {
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
          this.emit("peer:disconnected", peerId);
          this.broadcastMembership();
        }
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });
    this.signalingClient.on("rtc:data", (data) => {
      const msg = this.tryParseMembership(data.data);
      if (msg) {
        this.mergeMembership(msg.peers, msg.retiredPeers, msg.capacities, msg.topology, data.peerId, msg.records);
      } else {
        this.emit("peer:data", data);
      }
    });
    this.signalingClient.on("error", (error) => {
      this.emit("signaling:error", error);
    });
    this.signalingClient.on("signaling:log", (data) => {
      this.emit("signaling:log", data);
    });
    this.signalingClient.connect();
  }
  startMaintenanceLoop() {
    if (this.maintenanceTimer) return;
    if (!this.config.maintenanceIntervalMs || this.config.maintenanceIntervalMs <= 0) return;
    this.maintenanceTimer = setInterval(() => {
      try {
        this.maybeRefreshDiscovery();
        this.recoverStaleConnectedPeers("maintenance");
        this.maybeRecoverStalledNegotiations();
        this.maintainPeerConnections();
        this.maybeHardResetUnderConnected();
      } catch {
      }
    }, this.config.maintenanceIntervalMs);
  }
  startMembershipLoop() {
    if (this.membershipTimer) return;
    this.membershipTimer = setInterval(() => {
      try {
        this.renewLocalMembership(true);
        this.pruneMembershipRecords();
        this.broadcastMembership();
      } catch {
      }
    }, this.config.membershipGossipIntervalMs);
  }
  maybeRefreshDiscovery() {
    if (!this.config.autoDiscover) return;
    const connected = this.getConnectedPeers().length;
    const now = Date.now();
    const underConnected = connected < this.config.minPeers;
    const hasFewCandidates = this.discoveredPeers.size < this.config.minPeers;
    const saturatedWithoutSpareCandidates = connected >= this.config.maxPeers && this.discoveredPeers.size <= connected;
    if (!underConnected && !hasFewCandidates && !saturatedWithoutSpareCandidates) return;
    if (now - this.lastDiscoveryRefreshAtMs < 2e3) return;
    this.lastDiscoveryRefreshAtMs = now;
    try {
      this.signalingClient?.joinSession(this.config.sessionId);
    } catch {
    }
  }
  /**
   * Revalidate transports after browser suspension, network changes, or focus
   * restoration. Browsers do not always deliver every lifecycle event, so the
   * maintenance loop also calls the same stale-channel check.
   */
  recoverAfterInactivity(reason = "resume") {
    let adapterTriggeredMeshRecovery = false;
    try {
      adapterTriggeredMeshRecovery = this.signalingClient?.recoverAfterInactivity?.(reason) === true;
    } catch {
    }
    if (!adapterTriggeredMeshRecovery) {
      this.recoverMeshAfterInactivity(reason);
    }
  }
  recoverMeshAfterInactivity(reason) {
    const now = Date.now();
    this.restoreGraceUntilMs = Math.max(this.restoreGraceUntilMs, now + FREERTC_RESTORE_GRACE_MS);
    this.orphanRtcFirstSeenAtMs.clear();
    for (const peerId of this.connecting) {
      this.connectionStartedAtMs.set(peerId, now);
      this.scheduleConnectionTimeout(peerId);
    }
    this.lastDiscoveryRefreshAtMs = 0;
    this.underConnectedSinceMs = null;
    try {
      this.maybeRefreshDiscovery();
      if (!this.config.autoConnect) return;
      this.emit("signaling:log", {
        message: `[webrtc] ${reason} recovery: waiting for FreeRTC transport restoration`
      });
      this.maintainPeerConnections();
    } catch {
    }
  }
  recoverStaleConnectedPeers(_reason) {
  }
  /**
   * FreeRTC can retain a half-open connection that never became a PartialMesh
   * peer. Without local peer/pending state, the normal negotiation watchdog
   * cannot see it, while connectToPeerInternal treats it as active forever.
   */
  recoverOrphanedRtcNegotiations(now = Date.now()) {
    if (now < this.restoreGraceUntilMs) return;
    const connections = this.signalingClient?.client?.mesh?.connections;
    if (!connections || typeof connections.entries !== "function") return;
    const staleAfterMs = Math.max(32e3, this.config.connectionTimeoutMs);
    for (const [rawPeerId, entry] of Array.from(connections.entries())) {
      const peerId = this.normalizePeerId(rawPeerId);
      if (!peerId) continue;
      if (this.peers.has(peerId) || this.connecting.has(peerId)) {
        this.orphanRtcFirstSeenAtMs.delete(peerId);
        continue;
      }
      const connectionState = String(entry?.connection?.connectionState ?? entry?.state ?? "").toLowerCase();
      const channelState = String(entry?.channel?.readyState ?? "").toLowerCase();
      if (channelState === "open") {
        this.orphanRtcFirstSeenAtMs.delete(peerId);
        continue;
      }
      const lastSeen = Number(entry?.lastSeen);
      const initialObservation = Number.isFinite(lastSeen) && lastSeen > 0 ? Math.min(now, lastSeen) : now;
      const firstSeenAt = this.orphanRtcFirstSeenAtMs.get(peerId) ?? initialObservation;
      this.orphanRtcFirstSeenAtMs.set(peerId, firstSeenAt);
      const orphanAgeMs = Math.max(0, now - firstSeenAt);
      if (orphanAgeMs < staleAfterMs) continue;
      this.orphanRtcFirstSeenAtMs.delete(peerId);
      this.noteDialFailure(peerId);
      this.emit("peer:error", {
        peerId,
        error: new Error(`Untracked negotiation stalled (${connectionState || "unknown"}/${channelState || "closed"})`)
      });
      this.emit("signaling:log", {
        message: `[webrtc] purging stale untracked negotiation to ${peerId}; retrying`
      });
      try {
        this.signalingClient?.closeConnection?.(peerId);
      } catch {
        try {
          connections.delete?.(peerId);
        } catch {
        }
      }
    }
    for (const peerId of Array.from(this.orphanRtcFirstSeenAtMs.keys())) {
      if (!connections.has?.(peerId)) this.orphanRtcFirstSeenAtMs.delete(peerId);
    }
  }
  maybeRecoverStalledNegotiations() {
    const now = Date.now();
    if (now < this.restoreGraceUntilMs) return;
    const connectedCount = this.getConnectedPeerCount();
    const isolated = connectedCount === 0 && this.dialCandidatePeerIds(true).length > 0;
    const stallMs = Math.max(32e3, this.config.connectionTimeoutMs);
    for (const peer of this.peers.values()) {
      if (peer.connected) continue;
      const startedAt = this.connectionStartedAtMs.get(peer.id) ?? now;
      const ageMs = Math.max(0, now - startedAt);
      if (ageMs < stallMs) continue;
      const rtcEntry = this.signalingClient?.client?.mesh?.connections?.get?.(peer.id);
      const pc = rtcEntry?.connection;
      const signalingState = pc?.signalingState ?? "unknown";
      const connectionState = pc?.connectionState ?? rtcEntry?.state ?? "unknown";
      const dataState = rtcEntry?.channel?.readyState ?? "closed";
      const stalledOffer = signalingState === "have-local-offer" && dataState !== "open";
      const deadTransport = connectionState === "failed" || connectionState === "closed" || rtcEntry?.state === "dead";
      const noRtcProgress = !rtcEntry && this.connecting.has(peer.id);
      const answeredButNoChannel = signalingState === "stable" && dataState !== "open" && connectionState !== "connected";
      const repeatedlyFailing = (this.dialFailureCount.get(peer.id) ?? 0) >= 2;
      if (!stalledOffer && !deadTransport && !noRtcProgress && !answeredButNoChannel) {
        continue;
      }
      this.noteDialFailure(peer.id);
      this.emit("peer:error", {
        peerId: peer.id,
        error: new Error(`Negotiation stalled (${signalingState}/${connectionState}/${dataState})`)
      });
      this.removePeer(peer.id);
      if (isolated) {
        this.clearDialBackoff(peer.id);
        if (this.discoveredPeers.has(peer.id)) {
          this.connectToPeerInternal(peer.id, true);
        }
        if (answeredButNoChannel || repeatedlyFailing) this.maybeHardResetUnderConnected();
      }
      return;
    }
  }
  maybeHardResetUnderConnected() {
    if (Date.now() < this.restoreGraceUntilMs) return;
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
    const isolatedThresholdMs = Math.max(3500, Math.min(thresholdMs, 8e3));
    const hasStalePending = pending > 0 && oldestPendingAge >= isolatedThresholdMs;
    const hasRepeatedFailures = candidatePeerIds.some((peerId) => (this.dialFailureCount.get(peerId) ?? 0) >= 3);
    const now = Date.now();
    if (!underConnected && !isolated) {
      this.underConnectedSinceMs = null;
      return;
    }
    if (isolated && (hasStalePending || hasRepeatedFailures)) {
      if (now - this.lastUnderConnectedRecoveryAtMs < isolatedThresholdMs) {
        return;
      }
      this.lastUnderConnectedRecoveryAtMs = now;
      this.emit("signaling:log", {
        message: "[webrtc] isolated recovery: preserving FreeRTC negotiation and refreshing discovery"
      });
      this.signalingClient?.nudgeSignaling?.();
      try {
        this.signalingClient?.joinSession?.(this.config.sessionId);
      } catch {
      }
      this.maintainPeerConnections();
      return;
    }
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
    if (now - this.underConnectedSinceMs < thresholdMs) return;
    if (now - this.lastUnderConnectedRecoveryAtMs < thresholdMs) return;
    this.lastUnderConnectedRecoveryAtMs = now;
    this.underConnectedSinceMs = now;
    this.emit("signaling:log", {
      message: "[webrtc] under-connected recovery: refreshing discovery without resetting FreeRTC"
    });
    this.signalingClient?.nudgeSignaling?.();
    try {
      this.signalingClient?.joinSession?.(this.config.sessionId);
    } catch {
    }
    this.maintainPeerConnections();
  }
  isPeerBackedOff(peerId) {
    const until = this.dialBackoffUntilMs.get(peerId) ?? 0;
    return until > Date.now();
  }
  noteDialFailure(peerId) {
    const failures = (this.dialFailureCount.get(peerId) ?? 0) + 1;
    this.dialFailureCount.set(peerId, failures);
    const backoffMs = Math.min(3e4, 1e3 * Math.pow(2, Math.min(failures, 5)));
    this.dialBackoffUntilMs.set(peerId, Date.now() + backoffMs);
  }
  noteDialSuccess(peerId) {
    this.dialFailureCount.delete(peerId);
    this.dialBackoffUntilMs.delete(peerId);
  }
  noteIntentionalShed(peerId) {
    this.dialBackoffUntilMs.set(peerId, Date.now() + 5e3);
  }
  clearDialBackoff(peerId) {
    this.dialBackoffUntilMs.delete(peerId);
  }
  /**
   * Hard reset peer connections (keeps signaling + discovered peers).
   * Useful for recovering from rare stuck negotiation/ICE states.
   */
  hardReset(reason = "manual") {
    this.lastHardResetAtMs = Date.now();
    this.underConnectedSinceMs = null;
    for (const t of this.connectionTimers.values()) {
      clearTimeout(t);
    }
    this.connectionTimers.clear();
    this.connectionStartedAtMs.clear();
    this.peerConnectedAtMs.clear();
    this.pendingRebalanceDropByTarget.clear();
    const rtcConnections = this.signalingClient?.client?.mesh?.connections;
    const resetPeerIds = new Set(this.peers.keys());
    if (rtcConnections && typeof rtcConnections.keys === "function") {
      for (const rawPeerId of Array.from(rtcConnections.keys())) {
        const peerId = this.normalizePeerId(rawPeerId);
        if (peerId) resetPeerIds.add(peerId);
      }
    }
    for (const peerId of resetPeerIds) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
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
    try {
      if (this.signalingClient && this.config.sessionId) {
        this.signalingClient.joinSession(this.config.sessionId);
      }
    } catch {
    }
    if (this.config.autoConnect) {
      try {
        this.maintainPeerConnections();
      } catch {
      }
    }
    try {
      console.warn(`[PartialMesh] hardReset(${reason}) clientId=${this.clientId ?? ""} discovered=${this.discoveredPeers.size}`);
    } catch {
    }
  }
  /**
   * Create a new peer connection
   */
  createPeerConnection(peerId, initiator) {
    const peerConnection = {
      id: peerId,
      connected: false,
      initiator
    };
    this.scheduleConnectionTimeout(peerId);
    this.connectionStartedAtMs.set(peerId, Date.now());
    this.peers.set(peerId, peerConnection);
    if (initiator) {
      this.signalingClient?.nudgeSignaling?.();
      this.signalingClient.initiateConnection(peerId, this.config.iceServers, this.config.trickleIce).catch((err) => {
        this.connecting.delete(peerId);
        this.noteDialFailure(peerId);
        const t = this.connectionTimers.get(peerId);
        if (t) {
          clearTimeout(t);
          this.connectionTimers.delete(peerId);
        }
        this.connectionStartedAtMs.delete(peerId);
        this.emit("peer:error", { peerId, error: err });
        this.removePeer(peerId);
      });
    }
    return peerConnection;
  }
  scheduleConnectionTimeout(peerId) {
    const existingTimer = this.connectionTimers.get(peerId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      const current = this.peers.get(peerId);
      if (!current || current.connected) return;
      this.connecting.delete(peerId);
      this.connectionStartedAtMs.delete(peerId);
      this.noteDialFailure(peerId);
      this.emit("peer:error", { peerId, error: new Error("Connection timeout") });
      this.removePeer(peerId);
    }, this.config.connectionTimeoutMs);
    this.connectionTimers.set(peerId, timer);
  }
  /**
   * Maintain the target number of peer connections
   */
  dialCandidatePeerIds(includeLiveMembership) {
    const candidates = new Set(this.discoveredPeers);
    if (includeLiveMembership) {
      for (const peerId of this.getGlobalPeers()) candidates.add(peerId);
    }
    return Array.from(candidates).filter(
      (peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId)
    );
  }
  maintainPeerConnections() {
    const now = Date.now();
    this.recoverOrphanedRtcNegotiations(now);
    const connectedCount = this.getConnectedPeerCount();
    const pendingCount = this.getPendingPeerCount();
    const candidatePeerIds = this.dialCandidatePeerIds(connectedCount === 0);
    const emergencyIsolated = connectedCount === 0 && candidatePeerIds.length > 0;
    const totalInProgress = connectedCount + pendingCount;
    const allCandidates = candidatePeerIds.filter(
      (peerId) => !this.isSelfAlias(peerId) && !this.peers.has(peerId) && !this.connecting.has(peerId)
    );
    const available = emergencyIsolated ? allCandidates : allCandidates.filter((peerId) => !this.isPeerBackedOff(peerId));
    const pickCandidates = (count) => {
      if (available.length === 0 && allCandidates.length === 0 || count <= 0) return [];
      const source = available.length > 0 ? available : allCandidates;
      const sorted = source.slice().sort((a, b) => this.compareDialCandidates(a, b));
      return sorted.slice(0, Math.min(count, sorted.length));
    };
    if (totalInProgress < this.config.minPeers) {
      const needed = this.config.minPeers - totalInProgress;
      const emergencyBurst = emergencyIsolated ? Math.min(3, Math.max(2, available.length)) : 0;
      const dialCount = emergencyIsolated ? Math.max(needed, emergencyBurst) : needed;
      const tryCount = available.length <= this.config.maxPeers * 2 ? available.length : Math.max(dialCount, this.config.minPeers + 1);
      for (const peerId of pickCandidates(tryCount)) {
        this.connectToPeer(peerId);
      }
    } else if (totalInProgress < this.config.maxPeers && available.length > 0) {
      if (now < this.rebalanceCooldownUntilMs) {
        return;
      }
      for (const peerId of pickCandidates(1)) {
        this.connectToPeer(peerId);
      }
    } else if (connectedCount > this.config.maxPeers) {
      this.trimExcessPeers();
    } else if (connectedCount >= this.config.maxPeers && pendingCount < this.config.tolerantPeers && available.length > 0) {
      if (this.maybeRebalanceForCloserPeer(available)) {
        return;
      }
    }
  }
  /**
   * Connect to a specific peer
   */
  connectToPeer(peerId) {
    this.connectToPeerInternal(peerId, false);
  }
  connectToPeerInternal(peerId, allowTemporaryOverflow) {
    const selfId = this.normalizePeerId(this.clientId);
    const normalizedPeerId = this.normalizePeerId(peerId);
    const signalingConnected = this.signalingClient?.isConnected?.() ?? true;
    const emergencyIsolated = this.getConnectedPeerCount() === 0 && this.dialCandidatePeerIds(true).length > 0;
    if (!signalingConnected) {
      try {
        this.signalingClient?.connect?.();
      } catch {
      }
      return;
    }
    if (!selfId) {
      return;
    }
    if (!normalizedPeerId || this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId) || this.isSelfAlias(normalizedPeerId) || this.retiredPeerIds.has(normalizedPeerId) || normalizedPeerId === selfId) {
      return;
    }
    const existingRtcEntry = this.signalingClient?.client?.mesh?.connections?.get?.(normalizedPeerId);
    if (existingRtcEntry) {
      const existingState = String(existingRtcEntry.state ?? existingRtcEntry.connection?.connectionState ?? "").toLowerCase();
      const isDefinitelyDead = existingState === "failed" || existingState === "closed";
      if (!isDefinitelyDead) {
        return;
      }
      try {
        this.signalingClient?.closeConnection?.(normalizedPeerId);
      } catch {
      }
    }
    if (this.isPeerBackedOff(normalizedPeerId) && !emergencyIsolated) {
      return;
    }
    if (emergencyIsolated) {
      this.clearDialBackoff(normalizedPeerId);
    }
    const totalInProgress = this.getConnectedPeerCount() + this.getPendingPeerCount();
    const maxAllowed = this.config.maxPeers + (allowTemporaryOverflow ? this.config.tolerantPeers : 0);
    if (totalInProgress >= maxAllowed) {
      return;
    }
    const initiator = selfId < normalizedPeerId;
    if (!initiator) {
      this.signalingClient?.nudgeSignaling?.();
      const fallbackMs = this.config.nonInitiatorFallbackDialMs;
      if (!fallbackMs || fallbackMs <= 0) {
        return;
      }
      const candidatePeers = this.dialCandidatePeerIds(emergencyIsolated).map((id) => this.normalizePeerId(id)).filter((id) => {
        if (!id || id === selfId || this.isSelfAlias(id)) return false;
        if (this.peers.has(id) || this.connecting.has(id)) return false;
        if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
        return true;
      });
      if (candidatePeers.some((id) => selfId < id)) {
        return;
      }
      const fallbackTargets = candidatePeers.filter((id) => selfId > id).sort((a, b) => this.compareDialCandidates(a, b));
      if (fallbackTargets.length === 0) {
        return;
      }
      const selectedFallbackTarget = fallbackTargets.slice().sort((a, b) => this.compareDialCandidates(a, b))[0];
      if (selectedFallbackTarget !== normalizedPeerId) {
        return;
      }
      if (!this.nonInitiatorFallbackTimers.has(normalizedPeerId)) {
        const fallbackTimer = setTimeout(() => {
          this.nonInitiatorFallbackTimers.delete(normalizedPeerId);
          if (this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId)) {
            return;
          }
          const refreshedCandidates = this.dialCandidatePeerIds(emergencyIsolated).map((id) => this.normalizePeerId(id)).filter((id) => {
            if (!id || id === selfId || this.isSelfAlias(id)) return false;
            if (this.peers.has(id) || this.connecting.has(id)) return false;
            if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
            return true;
          });
          if (refreshedCandidates.some((id) => selfId < id)) {
            return;
          }
          const refreshedTargets = refreshedCandidates.filter((id) => selfId > id).sort((a, b) => this.compareDialCandidates(a, b));
          if (refreshedTargets.length === 0) {
            return;
          }
          const refreshedSelectedTarget = refreshedTargets.slice().sort((a, b) => this.compareDialCandidates(a, b))[0];
          if (refreshedSelectedTarget !== normalizedPeerId) {
            return;
          }
          const fallbackRtcEntry = this.signalingClient?.client?.mesh?.connections?.get?.(normalizedPeerId);
          if (fallbackRtcEntry) {
            const fallbackRtcState = String(fallbackRtcEntry.state ?? fallbackRtcEntry.connection?.connectionState ?? "").toLowerCase();
            const isFallbackDead = fallbackRtcState === "failed" || fallbackRtcState === "closed";
            if (!isFallbackDead) {
              return;
            }
            try {
              this.signalingClient?.closeConnection?.(normalizedPeerId);
            } catch {
            }
          }
          const currentInProgress = this.getConnectedPeerCount() + this.getPendingPeerCount();
          const fallbackMaxAllowed = allowTemporaryOverflow ? this.config.maxPeers + this.config.tolerantPeers : this.config.maxPeers;
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
  disconnectFromPeer(peerId) {
    const normalizedPeerId = this.normalizePeerId(peerId);
    if (!normalizedPeerId) return;
    this.removePeer(normalizedPeerId, false);
  }
  /**
   * Remove a peer connection
   */
  removePeer(peerId, forgetDiscovered = false) {
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
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
      }
      if (forgetDiscovered) {
        this.discoveredPeers.delete(peerId);
      }
      if (wasConnected) {
        this.noteLocalCapacityChanged();
        this.emit("peer:disconnected", peerId);
        this.broadcastMembership();
      }
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    }
  }
  /**
   * Send data to a specific peer
   */
  send(peerId, data) {
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
  broadcast(data) {
    this.signalingClient?.broadcast(data);
  }
  /**
   * Get list of connected peer IDs
   */
  getConnectedPeers() {
    return Array.from(this.peers.values()).filter((pc) => pc.connected).map((pc) => pc.id);
  }
  /**
   * Get list of discovered peer IDs
   */
  getDiscoveredPeers() {
    return Array.from(this.discoveredPeers).filter((peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId));
  }
  /**
   * Get the converged global peer set (all peers known via membership gossip).
   */
  getGlobalPeers() {
    this.pruneMembershipRecords(Date.now(), false);
    return Array.from(this.globalPeers).filter((peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId));
  }
  getCecrMembershipRecords() {
    this.pruneMembershipRecords();
    return Array.from(this.membershipRecordsById.values()).map((record) => ({ ...record })).sort((left, right) => left.peerId.localeCompare(right.peerId));
  }
  getCecrMembershipEquivocations() {
    this.pruneMembershipRecords();
    return Array.from(this.membershipEquivocationAtById.keys()).sort();
  }
  getCecrMembershipConfig() {
    return Object.freeze({
      leaseMs: this.config.membershipLeaseMs,
      gossipIntervalMs: this.config.membershipGossipIntervalMs,
      tombstoneRetentionMs: this.config.membershipTombstoneRetentionMs,
      clockSkewMs: this.config.membershipClockSkewMs
    });
  }
  /** Return the effective configuration, including constructor defaults. */
  getConfig() {
    return {
      ...this.config,
      signalingServers: [...this.config.signalingServers],
      iceServers: this.config.iceServers ? this.config.iceServers.map((server) => ({ ...server })) : null
    };
  }
  /**
   * Update connection-policy knobs without rebuilding the node. Signaling,
   * network/session identity, ICE, and trickle settings remain constructor-time
   * values because changing them requires reconnecting the transport.
   */
  updateConfig(patch) {
    const next = { ...this.config };
    for (const key of Object.keys(patch)) {
      const value = patch[key];
      if (value !== void 0) next[key] = value;
    }
    this.validatePeerLimits(next.minPeers, next.maxPeers, next.tolerantPeers);
    for (const [name, value] of [
      ["connectionTimeoutMs", next.connectionTimeoutMs],
      ["maintenanceIntervalMs", next.maintenanceIntervalMs],
      ["underConnectedResetMs", next.underConnectedResetMs],
      ["nonInitiatorFallbackDialMs", next.nonInitiatorFallbackDialMs]
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
      }
    }
    if (!Number.isSafeInteger(next.peerStateMaxAgeMs) || next.peerStateMaxAgeMs < 1e3) {
      throw new RangeError("peerStateMaxAgeMs must be a safe integer of at least 1000");
    }
    const maintenanceChanged = next.maintenanceIntervalMs !== this.config.maintenanceIntervalMs || next.autoConnect !== this.config.autoConnect;
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
  getPeerCapacity(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return null;
    const local = !!this.clientId && id === this.clientId;
    const state = local ? { maxPeers: this.config.maxPeers, connectedPeers: this.getConnectedPeerCount(), updatedAt: this.localCapacityUpdatedAtMs } : this.peerCapacityById.get(id);
    if (!state) return null;
    return {
      peerId: id,
      ...state,
      availableSlots: Math.max(0, state.maxPeers - state.connectedPeers),
      fresh: local || Date.now() - state.updatedAt <= this.config.peerStateMaxAgeMs,
      local
    };
  }
  /** Return advertised capacity for every known peer, including this node. */
  getPeerCapacities() {
    const ids = new Set(this.peerCapacityById.keys());
    if (this.clientId) ids.add(this.clientId);
    return Array.from(ids).map((peerId) => this.getPeerCapacity(peerId)).filter((value) => value != null).sort((a, b) => a.peerId.localeCompare(b.peerId));
  }
  /** Return the exact XOR-space distance used by partial-mesh rebalancing. */
  getXorDistance(peerId, fromPeerId = this.clientId) {
    const from = this.normalizePeerId(fromPeerId);
    const target = this.normalizePeerId(peerId);
    if (!from || !target) return null;
    return `0x${this.peerDistance(from, target).toString(16)}`;
  }
  /** Return the shortest currently-known topology path from this peer. */
  getHopDistance(peerId) {
    const target = this.normalizePeerId(peerId);
    if (!target) return null;
    return this.getGraphSnapshot().nodes.find((node) => node.peerId === target)?.hopDistance ?? null;
  }
  /** Reconstruct the complete currently-known node and undirected edge snapshot. */
  getGraphSnapshot() {
    const now = Date.now();
    this.pruneMembershipRecords(now, false);
    const self = this.normalizePeerId(this.clientId) || null;
    const connected = new Set(this.getConnectedPeers());
    const knownIds = /* @__PURE__ */ new Set();
    if (self) knownIds.add(self);
    for (const peerId of this.globalPeers) knownIds.add(peerId);
    for (const peerId of this.discoveredPeers) knownIds.add(peerId);
    for (const peerId of connected) knownIds.add(peerId);
    for (const peerId of Array.from(knownIds)) {
      if (!peerId || this.isSelfAlias(peerId) && peerId !== self || this.retiredPeerIds.has(peerId)) knownIds.delete(peerId);
    }
    const freshTopologyEntries = Array.from(this.peerTopologyById.entries()).filter(([peerId, state]) => knownIds.has(peerId) && state.updatedAt <= now + this.config.membershipClockSkewMs && now - state.updatedAt <= this.config.peerStateMaxAgeMs);
    const edgeMap = /* @__PURE__ */ new Map();
    const addEdge = (observer, left, right, updatedAt) => {
      if (!knownIds.has(left) || !knownIds.has(right) || left === right) return;
      const [source, target] = left < right ? [left, right] : [right, left];
      const key = `${source}\0${target}`;
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
    const distanceByPeerId = /* @__PURE__ */ new Map();
    if (self) {
      for (const peerId of knownIds) {
        if (peerId !== self) distanceByPeerId.set(peerId, this.peerDistance(self, peerId));
      }
    }
    const rankedDistances = Array.from(distanceByPeerId.entries()).sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0]));
    const rankByPeerId = new Map(rankedDistances.map(([peerId], rank) => [peerId, rank]));
    const minimumDistance = rankedDistances[0]?.[1] ?? 0n;
    const maximumDistance = rankedDistances[rankedDistances.length - 1]?.[1] ?? minimumDistance;
    const distanceSpan = maximumDistance - minimumDistance;
    const relativeDistance = (peerId) => {
      if (peerId === self) return 0;
      const distance = distanceByPeerId.get(peerId);
      if (distance == null) return null;
      if (distanceSpan <= 0n) return 0;
      const precision = 1000000n;
      return Number((distance - minimumDistance) * precision / distanceSpan) / Number(precision);
    };
    const edges = Array.from(edgeMap.values()).map((edge) => ({ ...edge, observedBy: edge.observedBy.sort() })).sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    const hopDistanceByPeerId = /* @__PURE__ */ new Map();
    if (self) {
      const adjacentByPeerId = /* @__PURE__ */ new Map();
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
    const missingTopologyPeerIds = Array.from(knownIds).filter((peerId) => peerId !== self && !freshTopologyPeerIds.has(peerId)).sort();
    const nodes = Array.from(knownIds).sort().map((peerId) => ({
      peerId,
      local: peerId === self,
      directlyConnected: connected.has(peerId),
      discovered: this.discoveredPeers.has(peerId),
      capacity: this.getPeerCapacity(peerId),
      hopDistance: hopDistanceByPeerId.get(peerId) ?? null,
      xorDistance: peerId === self ? "0x0" : distanceByPeerId.has(peerId) ? `0x${distanceByPeerId.get(peerId).toString(16)}` : null,
      xorDistanceRank: peerId === self ? null : rankByPeerId.get(peerId) ?? null,
      xorDistanceRatio: relativeDistance(peerId)
    }));
    return {
      localPeerId: self,
      nodes,
      edges,
      complete: missingTopologyPeerIds.length === 0,
      missingTopologyPeerIds,
      generatedAt: now
    };
  }
  /**
   * Get current peer count
   */
  getPeerCount() {
    return this.peers.size;
  }
  /**
   * Get this client's ID
   */
  getClientId() {
    return this.clientId;
  }
  /**
   * Register an event handler
   */
  on(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }
  /**
   * Unregister an event handler
   */
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }
  /**
   * Emit an event
   */
  emit(event, ...args) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(...args);
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err);
        }
      });
    }
  }
  // ─── Membership gossip ────────────────────────────────────────────────────
  renewLocalMembership(force = false) {
    const self = this.normalizePeerId(this.clientId);
    if (!self) return false;
    const now = Date.now();
    const existing = this.membershipRecordsById.get(self);
    if (!force && existing?.state === "alive" && existing.validUntil != null && existing.validUntil - now > this.config.membershipGossipIntervalMs * 2) return false;
    this.membershipSequence += 1;
    this.membershipRecordsById.set(self, {
      peerId: self,
      incarnation: this.membershipIncarnation,
      sequence: this.membershipSequence,
      state: "alive",
      issuedAt: now,
      validUntil: now + this.config.membershipLeaseMs
    });
    return true;
  }
  isMembershipRecordNewer(incoming, existing) {
    if (!existing) return true;
    if (incoming.incarnation !== existing.incarnation) return incoming.incarnation > existing.incarnation;
    return incoming.sequence > existing.sequence;
  }
  mergeMembershipRecord(record, now = Date.now()) {
    const peerId = this.normalizePeerId(record.peerId);
    if (!peerId || this.isSelfAlias(peerId) || this.retiredPeerIds.has(peerId)) return false;
    const canonicalId = peerId.replace(/-/g, "").toLowerCase();
    if (canonicalId.length !== 64 || !this.isHexId(canonicalId)) return false;
    if (!Number.isSafeInteger(record.incarnation) || record.incarnation < 0) return false;
    if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) return false;
    if (!Number.isSafeInteger(record.issuedAt) || record.issuedAt <= 0) return false;
    if (record.issuedAt > now + this.config.membershipClockSkewMs) return false;
    if (record.state !== "alive" && record.state !== "left") return false;
    if (record.state === "alive") {
      if (!Number.isSafeInteger(record.validUntil)) return false;
      if ((record.validUntil ?? 0) <= record.issuedAt) return false;
      if ((record.validUntil ?? 0) - record.issuedAt > this.config.membershipLeaseMs) return false;
      if ((record.validUntil ?? 0) + this.config.membershipTombstoneRetentionMs <= now) return false;
    } else if (record.validUntil !== null) {
      return false;
    }
    const normalized = { ...record, peerId };
    const existing = this.membershipRecordsById.get(peerId);
    if (existing && existing.incarnation === normalized.incarnation && existing.sequence === normalized.sequence) {
      const identical = existing.state === normalized.state && existing.issuedAt === normalized.issuedAt && existing.validUntil === normalized.validUntil;
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
  rebuildGlobalMembership(emitChanges = true) {
    const now = Date.now();
    const next = /* @__PURE__ */ new Set();
    for (const record of this.membershipRecordsById.values()) {
      if (record.state === "alive" && record.validUntil != null && record.validUntil > now && !this.isSelfAlias(record.peerId) && !this.retiredPeerIds.has(record.peerId) && !this.membershipEquivocationAtById.has(record.peerId)) next.add(record.peerId);
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
      this.emit("mesh:membership", Array.from(this.globalPeers));
      this.emit("mesh:capacity", this.getPeerCapacities());
      this.emit("mesh:graph", this.getGraphSnapshot());
    }
    return true;
  }
  pruneMembershipRecords(now = Date.now(), emitChanges = true) {
    let pruned = false;
    for (const [peerId, record] of this.membershipRecordsById.entries()) {
      const expiredAlive = record.state === "alive" && (record.validUntil == null || record.validUntil + this.config.membershipTombstoneRetentionMs <= now);
      const expiredTombstone = record.state === "left" && now - record.issuedAt > this.config.membershipTombstoneRetentionMs;
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
  membershipRecordsForWire() {
    const records = {};
    const now = Date.now();
    for (const record of this.membershipRecordsById.values()) {
      if (record.state === "alive" && (record.validUntil == null || record.validUntil <= now)) continue;
      if (record.state === "left" && now - record.issuedAt > this.config.membershipTombstoneRetentionMs) continue;
      records[record.peerId] = [
        record.incarnation,
        record.sequence,
        record.state,
        record.issuedAt,
        record.validUntil
      ];
    }
    return records;
  }
  sendMembership(toPeerId) {
    const self = this.normalizePeerId(this.clientId);
    this.renewLocalMembership(false);
    this.pruneMembershipRecords();
    const all = new Set(this.globalPeers);
    if (self) all.add(self);
    for (const retiredPeerId of this.retiredPeerIds) all.delete(retiredPeerId);
    const capacities = {};
    const topology = {};
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
      topology
    });
    try {
      this.signalingClient?.send(toPeerId, payload);
    } catch {
    }
  }
  broadcastMembership(exceptPeerId) {
    for (const peerId of this.getConnectedPeers()) {
      if (peerId !== exceptPeerId) this.sendMembership(peerId);
    }
  }
  tryParseMembership(raw) {
    try {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (obj?.__membership === true && Array.isArray(obj.peers)) {
        return {
          peers: obj.peers,
          retiredPeers: Array.isArray(obj.retiredPeers) ? obj.retiredPeers : [],
          capacities: obj.capacities && typeof obj.capacities === "object" && !Array.isArray(obj.capacities) ? obj.capacities : {},
          topology: obj.topology && typeof obj.topology === "object" && !Array.isArray(obj.topology) ? obj.topology : {},
          records: obj.records && typeof obj.records === "object" && !Array.isArray(obj.records) ? obj.records : {}
        };
      }
    } catch {
    }
    return null;
  }
  mergeMembership(incoming, retired, capacities, topologyInput = {}, fromPeerId = "", records = {}) {
    const topology = typeof topologyInput === "string" ? {} : topologyInput;
    if (typeof topologyInput === "string") fromPeerId = topologyInput;
    let membershipChanged = false;
    let capacityChanged = false;
    let topologyChanged = false;
    const now = Date.now();
    for (const [rawPeerId, rawRecord] of Object.entries(records || {})) {
      const peerId = this.normalizePeerId(rawPeerId);
      if (!peerId || !Array.isArray(rawRecord) || rawRecord.length < 5) continue;
      const record = {
        peerId,
        incarnation: Math.floor(Number(rawRecord[0])),
        sequence: Math.floor(Number(rawRecord[1])),
        state: rawRecord[2] === "left" ? "left" : "alive",
        issuedAt: Math.floor(Number(rawRecord[3])),
        validUntil: rawRecord[4] === null ? null : Math.floor(Number(rawRecord[4]))
      };
      if (this.mergeMembershipRecord(record, now)) membershipChanged = true;
    }
    const normalizedFromPeerId = this.normalizePeerId(fromPeerId);
    if (retired.some((raw) => this.normalizePeerId(raw) === normalizedFromPeerId) && normalizedFromPeerId) {
      const existing = this.membershipRecordsById.get(normalizedFromPeerId);
      const left = {
        peerId: normalizedFromPeerId,
        incarnation: existing?.incarnation ?? 0,
        sequence: (existing?.sequence ?? 0) + 1,
        state: "left",
        issuedAt: now,
        validUntil: null
      };
      if (this.mergeMembershipRecord(left, now)) membershipChanged = true;
    }
    for (const raw of incoming) {
      const id = this.normalizePeerId(raw);
      if (!id || this.isSelfAlias(id) || this.retiredPeerIds.has(id)) continue;
      const existing = this.membershipRecordsById.get(id);
      if (existing && (existing.incarnation > 0 || existing.state === "left")) continue;
      if (this.mergeMembershipRecord({
        peerId: id,
        incarnation: 0,
        sequence: now,
        state: "alive",
        issuedAt: now,
        validUntil: now + this.config.membershipLeaseMs
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
      if (!Number.isSafeInteger(maxPeers) || maxPeers < 1 || !Number.isSafeInteger(connectedPeers) || connectedPeers < 0 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) continue;
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
        rawState[0].map((value) => this.normalizePeerId(typeof value === "string" ? value : "")).filter((id) => id && id !== peerId && !this.retiredPeerIds.has(id))
      )).sort();
      const existing = this.peerTopologyById.get(peerId);
      if (existing && existing.updatedAt >= updatedAt) continue;
      this.peerTopologyById.set(peerId, { connectedPeerIds, updatedAt });
      topologyChanged = true;
    }
    if (membershipChanged || capacityChanged || topologyChanged) {
      this.emit("mesh:membership", Array.from(this.globalPeers));
      if (capacityChanged) this.emit("mesh:capacity", this.getPeerCapacities());
      if (membershipChanged || topologyChanged) this.emit("mesh:graph", this.getGraphSnapshot());
      this.broadcastMembership(fromPeerId);
      if (this.config.autoConnect) {
        this.maintainPeerConnections();
      }
    }
  }
  removeFromGlobalMembership(peerId) {
    const now = Date.now();
    const existing = this.membershipRecordsById.get(peerId);
    if (existing) {
      this.membershipRecordsById.set(peerId, {
        peerId,
        incarnation: existing.incarnation,
        sequence: existing.sequence + 1,
        state: "left",
        issuedAt: now,
        validUntil: null
      });
    }
    const removed = this.rebuildGlobalMembership(false) || this.globalPeers.delete(peerId);
    const removedCapacity = this.peerCapacityById.delete(peerId);
    const removedTopology = this.peerTopologyById.delete(peerId);
    if (!removed && !removedCapacity && !removedTopology) return;
    this.emit("mesh:membership", Array.from(this.globalPeers));
    if (removedCapacity) this.emit("mesh:capacity", this.getPeerCapacities());
    this.emit("mesh:graph", this.getGraphSnapshot());
    for (const connectedPeerId of this.getConnectedPeers()) {
      if (connectedPeerId !== peerId) {
        this.sendMembership(connectedPeerId);
      }
    }
  }
  /**
   * Disconnect from all peers and close signaling connection
   */
  destroy() {
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
    for (const peerId of this.peers.keys()) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
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
    if (this.signalingClient) {
      this.signalingClient.disconnect();
      this.signalingClient = null;
    }
    for (const handlers of this.eventHandlers.values()) {
      handlers.clear();
    }
  }
};
var PeerPigeonNode = class {
  constructor(options = {}) {
    this.storage = null;
    this.callbacks = {};
    this.started = false;
    const { gossip = {}, crypto = {}, storage = false, ...meshOptions } = options;
    this.mesh = new PartialMesh(meshOptions);
    this.gossip = new GossipProtocol(this.mesh, gossip);
    this.storageOptions = storage;
    if (crypto === false) {
      this.crypto = null;
    } else {
      const networkId = String(meshOptions.networkId ?? meshOptions.sessionId ?? "peerpigeon").trim();
      const sessionId = String(meshOptions.sessionId ?? "default-session").trim();
      this.crypto = new PeerPigeonCryptoProtocol(this.mesh, this.gossip, {
        ...crypto,
        roomId: String(crypto.roomId ?? `${networkId}:${sessionId}`).trim()
      });
    }
    this.bindComponentEvents();
  }
  async init() {
    return await this.start();
  }
  async start() {
    if (this.started) return;
    this.started = true;
    try {
      if (this.crypto) await this.crypto.init();
      if (this.storageOptions !== false) {
        const userId = String(
          this.storageOptions.userId ?? (this.crypto ? this.crypto.getKeyPair().epub : "")
        ).trim();
        if (!userId) throw new Error("storage.userId is required when crypto is disabled");
        const { userId: _ignoredUserId, ...storageOptions } = this.storageOptions;
        const config = this.mesh.getConfig();
        this.storage = new PeerPigeonStorage({
          ...storageOptions,
          userId,
          peerId: this.mesh.getClientId() ?? "",
          sessionId: storageOptions.sessionId ?? `${config.networkId}:${config.sessionId}`,
          gossip: this.gossip
        });
        await this.storage.init();
      }
      await this.mesh.init();
    } catch (error) {
      this.started = false;
      throw error;
    }
  }
  getConfig() {
    return this.mesh.getConfig();
  }
  updateConfig(patch) {
    return this.mesh.updateConfig(patch);
  }
  getGraphSnapshot() {
    return this.mesh.getGraphSnapshot();
  }
  getPeerCapacity(peerId) {
    return this.mesh.getPeerCapacity(peerId);
  }
  getPeerCapacities() {
    return this.mesh.getPeerCapacities();
  }
  getXorDistance(peerId, fromPeerId) {
    return this.mesh.getXorDistance(peerId, fromPeerId ?? this.mesh.getClientId());
  }
  getHopDistance(peerId) {
    return this.mesh.getHopDistance(peerId);
  }
  getCecrConfig() {
    return this.gossip.getCecrConfig();
  }
  getCecrState() {
    return this.gossip.getCecrState();
  }
  getClientId() {
    return this.mesh.getClientId();
  }
  getConnectedPeers() {
    return this.mesh.getConnectedPeers();
  }
  getDiscoveredPeers() {
    return this.mesh.getDiscoveredPeers();
  }
  getGlobalPeers() {
    return this.mesh.getGlobalPeers();
  }
  broadcast(data, metadata = {}, options = {}) {
    return this.gossip.broadcast(data, metadata, options);
  }
  broadcastReliable(data, metadata = {}, options = {}) {
    return this.gossip.broadcastReliable(data, metadata, options);
  }
  sendDirect(peerId, data) {
    return this.gossip.sendDirect(peerId, data);
  }
  getDeliveryStatus(messageId) {
    return this.gossip.getDeliveryStatus(messageId);
  }
  async broadcastEncrypted(plaintext, metadata = {}, options = {}) {
    if (!this.crypto) throw new Error("Crypto is disabled for this node");
    return await this.crypto.broadcastEncrypted(plaintext, metadata, options);
  }
  async broadcastEncryptedReliable(plaintext, metadata = {}, options = {}) {
    return await this.broadcastEncrypted(plaintext, metadata, { ...options, trackDelivery: true });
  }
  async sendEncryptedDirect(peerId, plaintext, timeoutMs) {
    if (!this.crypto) throw new Error("Crypto is disabled for this node");
    return await this.crypto.sendEncryptedDirect(peerId, plaintext, timeoutMs);
  }
  getKeyPair() {
    if (!this.crypto) throw new Error("Crypto is disabled for this node");
    return this.crypto.getKeyPair();
  }
  getPublicKey(peerId) {
    return this.crypto?.getPublicKey(peerId) ?? null;
  }
  getKnownPeerKeys() {
    return this.crypto?.getKnownPeerKeys() ?? [];
  }
  requestPeerKey(peerId) {
    if (!this.crypto) throw new Error("Crypto is disabled for this node");
    this.crypto.requestPeerKey(peerId);
  }
  waitForPeerKey(peerId, timeoutMs) {
    if (!this.crypto) return Promise.reject(new Error("Crypto is disabled for this node"));
    return timeoutMs === void 0 ? this.crypto.waitForPeerKey(peerId) : this.crypto.waitForPeerKey(peerId, timeoutMs);
  }
  recoverAfterInactivity(reason) {
    this.mesh.recoverAfterInactivity(reason);
  }
  on(event, callback) {
    const callbacks = this.callbacks[event];
    if (callbacks) callbacks.add(callback);
    else this.callbacks[event] = /* @__PURE__ */ new Set([callback]);
  }
  off(event, callback) {
    this.callbacks[event]?.delete(callback);
  }
  async destroy() {
    if (this.storage) await this.storage.close();
    this.storage = null;
    this.crypto?.destroy();
    this.gossip.destroy();
    this.mesh.destroy();
    this.started = false;
    for (const callbacks of Object.values(this.callbacks)) callbacks?.clear();
  }
  bindComponentEvents() {
    this.mesh.on("mesh:ready", () => this.emit("ready", void 0));
    this.mesh.on("peer:connected", (peerId) => this.emit("peerConnected", peerId));
    this.mesh.on("peer:disconnected", (peerId) => this.emit("peerDisconnected", peerId));
    this.mesh.on("mesh:graph", (snapshot) => this.emit("graphChanged", snapshot));
    this.mesh.on("mesh:capacity", (capacities) => this.emit("capacityChanged", capacities));
    this.mesh.on("signaling:connected", ({ clientId }) => this.storage?.setPeerId(clientId));
    this.mesh.on("signaling:error", (error) => this.emitError(error));
    this.mesh.on("peer:error", ({ error }) => this.emitError(error));
    this.gossip.on("messageReceived", ({ message, local, fromPeer }) => {
      if (this.isReservedPayload(message.data)) return;
      this.emit("message", {
        kind: "broadcast",
        data: message.data,
        encrypted: false,
        local,
        fromPeerId: fromPeer ?? message.sender,
        messageId: message.id,
        hops: message.hops,
        message
      });
    });
    this.gossip.on("directMessageReceived", ({ message }) => {
      if (this.isReservedPayload(message.data)) return;
      this.emit("message", {
        kind: "direct",
        data: message.data,
        encrypted: false,
        local: false,
        fromPeerId: message.from,
        messageId: message.id,
        hops: message.hops,
        message
      });
    });
    this.gossip.on("deliveryProgress", (status) => this.emit("deliveryProgress", status));
    this.gossip.on("deliveryComplete", (status) => this.emit("deliveryComplete", status));
    this.gossip.on("deliveryTimeout", (status) => this.emit("deliveryTimeout", status));
    this.crypto?.on("keyDiscovered", (key) => this.emit("keyDiscovered", key));
    this.crypto?.on("encryptedBroadcastReceived", ({ plaintext, message, local, fromPeer }) => {
      this.emit("message", {
        kind: "broadcast",
        data: plaintext,
        encrypted: true,
        local,
        fromPeerId: fromPeer ?? message.sender,
        messageId: message.id,
        hops: message.hops,
        message
      });
    });
    this.crypto?.on("encryptedDirectReceived", ({ plaintext, message }) => {
      this.emit("message", {
        kind: "direct",
        data: plaintext,
        encrypted: true,
        local: false,
        fromPeerId: message.from,
        messageId: message.id,
        hops: message.hops,
        message
      });
    });
    this.crypto?.on("error", (error) => this.emitError(error));
  }
  isReservedPayload(data) {
    if (PeerPigeonCryptoProtocol.isProtocolPayload(data)) return true;
    if (!data || typeof data !== "object") return false;
    const type = data.__ppType;
    return typeof type === "string" && type.startsWith("pp-storage-");
  }
  emitError(error) {
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }
  emit(event, data) {
    for (const callback of this.callbacks[event] ?? []) {
      try {
        callback(data);
      } catch {
      }
    }
  }
};
var index_default = PartialMesh;
export {
  DEFAULT_CLOSE_SIGNALING_RELAY_COUNT,
  DEFAULT_SIGNALING_SERVERS,
  GossipProtocol,
  PartialMesh,
  PeerPigeonCryptoProtocol,
  PeerPigeonNode,
  PeerPigeonStorage,
  index_default as default,
  discoverClosestSignalingServer,
  discoverClosestSignalingServers,
  rankSignalingServersByDistance,
  selectClosestSignalingServer
};
