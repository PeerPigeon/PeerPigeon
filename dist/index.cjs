"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  GossipProtocol: () => GossipProtocol,
  PartialMesh: () => PartialMesh,
  PeerPigeonStorage: () => PeerPigeonStorage,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/freertc-client-adapter.ts
var import_client = require("freertc/client");
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
  constructor(signalUrl, options) {
    this.emitter = new Emitter();
    this.knownPeers = /* @__PURE__ */ new Set();
    this.selfAliases = /* @__PURE__ */ new Set();
    this.connectedPeers = /* @__PURE__ */ new Set();
    this.openChannelTimers = /* @__PURE__ */ new Map();
    this.client = null;
    this.joinedOnce = false;
    this.intentionallyDisconnected = false;
    this.signalingConnected = false;
    this.signalUrl = signalUrl;
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
  connect() {
    this.intentionallyDisconnected = false;
    if (this.client) {
      this.client.connect?.();
      return;
    }
    this.withdrawRetiredPeerIds();
    this.client = (0, import_client.createSignalingClient)({
      peerId: this.requestedPeerId,
      networkId: this.networkId,
      roomId: this.roomId,
      signalUrl: this.signalUrl,
      iceServers: this.defaultIceServers ?? void 0,
      autoConnect: false,
      onLog: (message) => {
        this.emitter.emit("signaling:log", { message: String(message ?? "") });
      },
      onRegistered: () => {
        this.signalingConnected = true;
        this.emitter.emit("connected", {
          clientId: this.requestedPeerId,
          requestedClientId: this.requestedPeerId,
          previousClientId: this.previousPeerId
        });
        this.client?.requestBootstrap?.(Array.from(this.selfAliases));
      },
      onBootstrap: (candidates) => {
        this.handleBootstrapCandidates(candidates);
      },
      onConnectionStateChange: (data) => {
        this.handleConnectionState(data);
      },
      onDataMessage: (data) => {
        const peerId = this.normalizePeerId(data?.peerId);
        if (!peerId || this.isSelfAlias(peerId)) return;
        this.emitter.emit("rtc:data", { peerId, data: data.data });
      },
      onNegotiationFailure: (data) => {
        this.emitter.emit("signaling:log", {
          message: `[webrtc] ${this.normalizePeerId(data?.peerId)} negotiation failed: ${String(data?.reason ?? "unknown")}`
        });
      },
      onStatusChange: (status) => {
        if (!String(status).startsWith("disconnected")) return;
        const wasConnected = this.signalingConnected;
        this.signalingConnected = false;
        if (wasConnected && !this.intentionallyDisconnected) {
          this.emitter.emit("disconnected");
        }
      }
    });
    this.client.connect();
  }
  disconnect() {
    this.intentionallyDisconnected = true;
    this.signalingConnected = false;
    this.clearOpenChannelTimers();
    try {
      this.client?.disconnect?.();
    } catch {
    }
    this.client = null;
    this.connectedPeers.clear();
    this.knownPeers.clear();
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
  closeConnection(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.clearOpenChannelTimer(id);
    const entry = this.client?.mesh?.connections?.get?.(id);
    try {
      entry?.channel?.close?.();
    } catch {
    }
    try {
      entry?.connection?.close?.();
    } catch {
    }
    this.client?.mesh?.connections?.delete?.(id);
    if (this.connectedPeers.delete(id)) {
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
    const nextPeers = new Set(
      (Array.isArray(candidates) ? candidates : []).map((candidate) => this.normalizePeerId(candidate?.peerId)).filter((peerId) => peerId && !this.isSelfAlias(peerId))
    );
    const peerList = Array.from(nextPeers);
    if (!this.joinedOnce) {
      this.joinedOnce = true;
      this.emitter.emit("joined", { sessionId: this.roomId, clients: peerList });
    }
    for (const peerId of peerList) {
      if (!this.knownPeers.has(peerId)) this.emitter.emit("peer-joined", { peerId });
    }
    for (const peerId of this.knownPeers) {
      if (!nextPeers.has(peerId)) this.emitter.emit("peer-left", { peerId });
    }
    this.knownPeers.clear();
    for (const peerId of nextPeers) this.knownPeers.add(peerId);
    this.emitter.emit("peers-updated", { peers: peerList });
  }
  handleConnectionState(data) {
    const peerId = this.normalizePeerId(data?.peerId);
    const state = String(data?.state ?? "").toLowerCase();
    if (!peerId || this.isSelfAlias(peerId)) {
      if (peerId) this.closeConnection(peerId);
      return;
    }
    if (state === "connected") {
      this.waitForOpenDataChannel(peerId);
      return;
    }
    if (state === "failed" || state === "closed") {
      this.clearOpenChannelTimer(peerId);
      if (this.connectedPeers.delete(peerId)) {
        this.emitter.emit("rtc:disconnected", { peerId });
      }
    }
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
      if (!entry || entry?.connection?.connectionState === "failed" || entry?.connection?.connectionState === "closed" || Date.now() - startedAt > 15e3) {
        this.clearOpenChannelTimer(peerId);
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
  withdrawRetiredPeerIds() {
    for (const peerId of this.retiredPeerIds) {
      let socket = null;
      const timeout = setTimeout(() => {
        try {
          socket?.close();
        } catch {
        }
      }, 3e3);
      try {
        const url = new URL(this.signalUrl, typeof location !== "undefined" ? location.href : void 0);
        url.searchParams.set("networkId", this.networkId);
        url.searchParams.set("room", this.roomId);
        socket = new WebSocket(url.toString());
        socket.onopen = () => {
          socket?.send(JSON.stringify({
            psp_version: "1.0",
            type: "withdraw",
            network: this.networkId,
            from: peerId,
            to: null,
            session_id: this.roomId,
            message_id: generateMessageId(),
            timestamp: Date.now(),
            ttl_ms: null,
            body: { reason: "identity_replaced" }
          }));
          setTimeout(() => {
            clearTimeout(timeout);
            try {
              socket?.close(1e3, "identity_replaced");
            } catch {
            }
          }, 100);
        };
        socket.onerror = () => clearTimeout(timeout);
      } catch {
        clearTimeout(timeout);
      }
    }
  }
};
var freertc_client_adapter_default = FreeRTCClientAdapter;

// src/gossip.ts
var GossipProtocol = class {
  constructor(mesh, options = {}) {
    this.messageLog = /* @__PURE__ */ new Map();
    this.maxTrackedMessages = 12e3;
    this.maxTrackedDirectIds = 12e3;
    this.trackingRetentionMs = 10 * 6e4;
    this.cecrCurrentExtrema = null;
    this.cecrPreviousExtrema = null;
    this.cecrRemoteStates = /* @__PURE__ */ new Map();
    this.cecrSyncTimer = null;
    this.trackingCleanupTimer = null;
    this.seenDirectIds = /* @__PURE__ */ new Map();
    this.callbacks = {};
    this.peers = /* @__PURE__ */ new Map();
    this.mesh = mesh;
    this.maxHops = options.maxHops ?? 5;
    this.maxDirectHops = options.maxDirectHops ?? 20;
    this.cecrCoordinateWeight = Math.max(0, Math.min(1, options.cecrCoordinateWeight ?? 0.35));
    this.cecrExtremaMaxAgeMs = Math.max(1e3, options.cecrExtremaMaxAgeMs ?? 2e4);
    this.cecrMaxAcceptedDrift = Math.max(0.01, Math.min(1, options.cecrMaxAcceptedDrift ?? 0.18));
    this.cecrRequireConsensus = options.cecrRequireConsensus ?? true;
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
      } else {
        this.handleIncomingMessage(parsed, peerId);
      }
    });
    this.mesh.on("peer:connected", (peerId) => {
      this.peers.set(peerId, { connected: true, timestamp: Date.now() });
      this.publishCecrState();
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
      this.publishCecrState();
    }, 2e3);
  }
  startTrackingCleanupLoop() {
    if (this.trackingCleanupTimer) return;
    this.trackingCleanupTimer = setInterval(() => {
      this.pruneTracking();
    }, 3e4);
  }
  /**
   * Broadcast an application payload using gossip-style re-propagation.
   */
  broadcast(data, metadata = {}) {
    const sender = this.mesh.getClientId();
    const connected = this.mesh.getConnectedPeers();
    const global = this.mesh.getGlobalPeers?.() ?? connected;
    const networkSize = Math.max(connected.length, global.length, 1);
    const message = {
      id: this.generateMessageId(sender),
      timestamp: Date.now(),
      hops: 0,
      // Ensure messages can cross long sparse paths (e.g. saturation/rebalance chains).
      maxHops: Math.max(this.maxHops, networkSize * 2),
      sender,
      data,
      metadata,
      type: "gossip"
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
    this.emit("messageReceived", { message, local: true });
    return message.id;
  }
  /**
   * Propagate a message to all currently-connected peers.
   */
  propagate(message, exceptPeerId) {
    const connectedPeers = this.mesh.getConnectedPeers();
    for (const peerId of connectedPeers) {
      if (peerId === message.sender) continue;
      if (exceptPeerId && peerId === exceptPeerId) continue;
      const forwarded = {
        ...message,
        hops: message.hops + 1
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
  // ─── Direct / XOR-routed messaging ───────────────────────────────────────
  /**
   * XOR distance between two hex-encoded peer IDs.
   * Returns a BigInt (lower = closer).
   */
  xorDistance(a, b) {
    const left = this.peerIdToNumeric(a);
    const right = this.peerIdToNumeric(b);
    if (left == null || right == null) {
      throw new Error("Peer IDs are not comparable in XOR space");
    }
    return left ^ right;
  }
  /**
   * Pick the connected peer closest (by XOR distance) to target.
   * Falls back to any connected peer if IDs can't be compared.
   */
  closestPeerTo(target, exclude) {
    const connected = this.mesh.getConnectedPeers().filter((p) => p !== exclude);
    if (connected.length === 0) return null;
    let best = null;
    let bestDist = null;
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
  peerIdToNumeric(peerId) {
    try {
      const hex = peerId.replace(/-/g, "").toLowerCase();
      if (!hex || !/^[0-9a-f]+$/.test(hex)) return null;
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
      this.cecrPreviousExtrema = this.cecrCurrentExtrema;
      this.cecrCurrentExtrema = next;
    } else {
      this.cecrCurrentExtrema.updatedAtMs = next.updatedAtMs;
    }
    return this.cecrCurrentExtrema;
  }
  coordinateFor(peerId, extrema) {
    const value = this.peerIdToNumeric(peerId);
    if (value == null) return null;
    const span = extrema.max - extrema.min;
    if (span <= 0n) return null;
    return Number(value - extrema.min) / Number(span);
  }
  effectiveCecrCoordinateWeight(targetPeerId) {
    let weight = this.cecrCoordinateWeight;
    const current = this.cecrCurrentExtrema ?? this.updateCecrExtremaSnapshot();
    if (!current) return 0;
    if (!this.hasCecrConsensus(current)) return 0;
    const ageMs = Date.now() - current.updatedAtMs;
    if (ageMs > this.cecrExtremaMaxAgeMs) {
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
  hasCecrConsensus(local) {
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
  publishCecrState() {
    const self = this.mesh.getClientId();
    if (!self) return;
    const extrema = this.updateCecrExtremaSnapshot();
    if (!extrema) return;
    const message = {
      id: this.generateMessageId(self),
      type: "cecr-state",
      from: self,
      timestamp: Date.now(),
      setHash: extrema.setHash,
      minHex: extrema.min.toString(16),
      maxHex: extrema.max.toString(16),
      size: extrema.size
    };
    for (const peerId of this.mesh.getConnectedPeers()) {
      try {
        this.mesh.send(peerId, JSON.stringify(message));
      } catch {
      }
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
      this.cecrRemoteStates.set(fromPeerId, {
        setHash: message.setHash,
        min,
        max,
        size: Math.floor(message.size),
        updatedAtMs: Date.now()
      });
    } catch {
    }
  }
  normalizedBigIntRatio(numerator, denominator) {
    if (denominator <= 0n) return 1;
    if (numerator <= 0n) return 0;
    const scale = 1000000n;
    const scaled = numerator * scale / denominator;
    return Number(scaled) / Number(scale);
  }
  closestPeerHybrid(target, exclude) {
    const connected = this.mesh.getConnectedPeers().filter((p) => p !== exclude);
    if (connected.length === 0) return null;
    const coordWeight = this.effectiveCecrCoordinateWeight(target);
    if (coordWeight <= 1e-3) {
      return this.closestPeerTo(target, exclude);
    }
    const extrema = this.cecrCurrentExtrema ?? this.updateCecrExtremaSnapshot();
    const targetCoord = extrema ? this.coordinateFor(target, extrema) : null;
    if (!extrema || targetCoord == null) {
      return this.closestPeerTo(target, exclude);
    }
    let maxXor = 1n;
    const xorDistances = /* @__PURE__ */ new Map();
    for (const peerId of connected) {
      try {
        const d = this.xorDistance(peerId, target);
        xorDistances.set(peerId, d);
        if (d > maxXor) maxXor = d;
      } catch {
        xorDistances.set(peerId, maxXor);
      }
    }
    let bestPeer = null;
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
      timestamp: Date.now()
    };
    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, null);
    return message.id;
  }
  routeDirect(message, fromPeerId) {
    const self = this.mesh.getClientId();
    if (message.to === self) {
      this.emit("directMessageReceived", { message });
      return;
    }
    const connected = this.mesh.getConnectedPeers();
    if (connected.includes(message.to)) {
      try {
        this.mesh.send(message.to, JSON.stringify({ ...message, hops: message.hops + 1 }));
      } catch {
      }
      return;
    }
    if (message.hops >= message.maxHops) return;
    const next = this.closestPeerHybrid(message.to, fromPeerId ?? void 0);
    if (!next) return;
    try {
      this.mesh.send(next, JSON.stringify({ ...message, hops: message.hops + 1 }));
    } catch {
    }
  }
  handleIncomingDirect(message, fromPeerId) {
    if (this.seenDirectIds.has(message.id)) return;
    this.markDirectSeen(message.id, message.timestamp);
    this.routeDirect(message, fromPeerId);
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
    return null;
  }
  generateMessageId(sender) {
    const safeSender = (sender ?? "unknown").toString();
    return `${safeSender}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

// src/index.ts
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
    this.peerConnectedAtMs = /* @__PURE__ */ new Map();
    this.discoveredAtMs = /* @__PURE__ */ new Map();
    this.maintenanceTimer = null;
    this.underConnectedSinceMs = null;
    this.lastHardResetAtMs = 0;
    this.lastDiscoveryRefreshAtMs = 0;
    this.lastSignalingReconnectAtMs = 0;
    this.dialFailureCount = /* @__PURE__ */ new Map();
    this.dialBackoffUntilMs = /* @__PURE__ */ new Map();
    this.nonInitiatorFallbackTimers = /* @__PURE__ */ new Map();
    this.rebalanceCooldownUntilMs = 0;
    this.rebalanceAttemptAtMs = /* @__PURE__ */ new Map();
    this.pendingRebalanceDropByTarget = /* @__PURE__ */ new Map();
    /** Converged global peer membership — populated via in-band membership gossip. */
    this.globalPeers = /* @__PURE__ */ new Set();
    this.config = {
      minPeers: config.minPeers ?? 2,
      maxPeers: config.maxPeers ?? 10,
      tolerantPeers: config.tolerantPeers ?? Math.max(1, Math.min(2, Math.floor((config.maxPeers ?? 10) * 0.25))),
      signalingServer: config.signalingServer ?? "wss://peer.ooo/ws",
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
      trickleIce: config.trickleIce ?? true
    };
    const events = [
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
      "mesh:membership"
    ];
    events.forEach((event) => this.eventHandlers.set(event, /* @__PURE__ */ new Set()));
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
  }
  rotateBrowserPeerId(signalingUrl) {
    const requestedPeerId = Array.from(
      (globalThis.window?.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, "0")
    ).join("");
    let previousPeerId = null;
    let retiredPeerIds = [];
    try {
      const storage = globalThis.window?.sessionStorage;
      if (storage) {
        const relayScope = new URL(signalingUrl).origin;
        const key = `peerpigeon:previous-peer-id:${relayScope}:${this.config.networkId}:${this.config.sessionId}`;
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
    const changed = removedDiscovered || removedGlobal;
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
  getMaxPeersWithTolerance() {
    const tolerance = Math.max(0, Math.floor(this.config.tolerantPeers));
    return this.config.maxPeers + tolerance;
  }
  trimExcessPeers() {
    const connectedPeers = this.getConnectedPeers();
    const overflow = connectedPeers.length - this.getMaxPeersWithTolerance();
    if (overflow <= 0) return;
    this.rebalanceCooldownUntilMs = Math.max(this.rebalanceCooldownUntilMs, Date.now() + 2e3);
    const dropOrder = connectedPeers.map((peerId) => ({
      peerId,
      connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0
    })).sort((a, b) => {
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
  maybeRebalanceForCloserPeer(candidates) {
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
    if (connectedPeers.length <= this.config.minPeers) {
      return false;
    }
    const connectedByDistance = connectedPeers.map((peerId) => ({
      peerId,
      distance: this.peerDistance(selfId, peerId),
      connectedAt: this.peerConnectedAtMs.get(peerId) ?? 0
    })).sort((a, b) => a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId));
    const candidateByDistance = candidates.map((peerId) => ({
      peerId,
      distance: this.peerDistance(selfId, peerId),
      discoveredAt: this.discoveredAtMs.get(peerId) ?? 0,
      lastAttemptAt: this.rebalanceAttemptAtMs.get(peerId) ?? 0
    })).sort((a, b) => a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : a.peerId.localeCompare(b.peerId));
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
    const materiallyCloser = closestCandidate.distance * 4n < farthestConnected.distance * 3n;
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
      message: `[rebalance] dial closer ${closestCandidate.peerId.slice(0, 8)} then drop ${farthestConnected.peerId.slice(0, 8)}`
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
    const signalingUrl = this.normalizeSignalingUrl(this.config.signalingServer);
    const { requestedPeerId, previousPeerId, retiredPeerIds } = this.rotateBrowserPeerId(signalingUrl);
    this.addSelfAlias(requestedPeerId);
    for (const peerId of retiredPeerIds) {
      this.retiredPeerIds.add(peerId);
      this.addSelfAlias(peerId);
    }
    this.signalingClient = new freertc_client_adapter_default(signalingUrl, {
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
      this.emit("signaling:connected", { clientId: this.clientId, rawClientId });
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
      this.sendMembership(peerId);
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
          this.emit("peer:disconnected", peerId);
        }
        if (this.config.autoConnect) {
          this.maintainPeerConnections();
        }
      }
    });
    this.signalingClient.on("rtc:data", (data) => {
      const msg = this.tryParseMembership(data.data);
      if (msg) {
        this.mergeMembership(msg.peers, msg.retiredPeers, data.peerId);
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
        this.maybeRecoverStalledNegotiations();
        this.maintainPeerConnections();
        this.maybeHardResetUnderConnected();
      } catch {
      }
    }, this.config.maintenanceIntervalMs);
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
  maybeRecoverStalledNegotiations() {
    const now = Date.now();
    const connectedCount = this.getConnectedPeerCount();
    const isolated = connectedCount === 0 && this.discoveredPeers.size > 0;
    const baseStallMs = Math.max(1e4, Math.min(this.config.connectionTimeoutMs, 15e3));
    const stallMs = isolated ? Math.max(8e3, Math.min(this.config.connectionTimeoutMs, 12e3)) : baseStallMs;
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
        if (answeredButNoChannel || repeatedlyFailing) {
          this.maybeHardResetUnderConnected();
        }
      }
      return;
    }
  }
  maybeHardResetUnderConnected() {
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
    const isolatedThresholdMs = Math.max(3500, Math.min(thresholdMs, 8e3));
    const hasStalePending = pending > 0 && oldestPendingAge >= isolatedThresholdMs;
    const hasRepeatedFailures = Array.from(this.discoveredPeers).some((peerId) => (this.dialFailureCount.get(peerId) ?? 0) >= 3);
    const now = Date.now();
    if (!underConnected && !isolated) {
      this.underConnectedSinceMs = null;
      return;
    }
    if (isolated && (hasStalePending || hasRepeatedFailures)) {
      if (now - this.lastHardResetAtMs < isolatedThresholdMs) {
        return;
      }
      this.hardReset("isolated-stalled");
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
    if (now - this.lastHardResetAtMs < thresholdMs) return;
    this.hardReset("under-connected");
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
    for (const peerId of this.peers.keys()) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
      }
    }
    this.peers.clear();
    this.connecting.clear();
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
  /**
   * Maintain the target number of peer connections
   */
  maintainPeerConnections() {
    const now = Date.now();
    const connectedCount = this.getConnectedPeerCount();
    const pendingCount = this.getPendingPeerCount();
    const emergencyIsolated = connectedCount === 0 && this.discoveredPeers.size > 0;
    const totalInProgress = connectedCount + pendingCount;
    const allCandidates = Array.from(this.discoveredPeers).filter(
      (peerId) => !this.isSelfAlias(peerId) && !this.peers.has(peerId) && !this.connecting.has(peerId)
    );
    const available = emergencyIsolated ? allCandidates : allCandidates.filter((peerId) => !this.isPeerBackedOff(peerId));
    const pickCandidates = (count) => {
      if (available.length === 0 && allCandidates.length === 0 || count <= 0) return [];
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
          hash = hash * 31 + selfId.charCodeAt(i) >>> 0;
        }
        offset = sorted.length ? hash % sorted.length : 0;
      }
      const selected = [];
      for (let i = 0; i < Math.min(count, sorted.length); i++) {
        selected.push(sorted[(offset + i) % sorted.length]);
      }
      return selected;
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
    } else if (connectedCount > this.getMaxPeersWithTolerance()) {
      this.trimExcessPeers();
    } else if (connectedCount >= this.config.maxPeers && pendingCount === 0 && available.length > 0) {
      if (connectedCount < this.getMaxPeersWithTolerance()) {
        for (const peerId of pickCandidates(1)) {
          this.connectToPeer(peerId);
        }
        return;
      }
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
    const emergencyIsolated = this.getConnectedPeerCount() === 0 && this.discoveredPeers.size > 0;
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
    const connectedCount = this.getConnectedPeerCount();
    const maxAllowed = allowTemporaryOverflow ? this.config.maxPeers + 1 : this.getMaxPeersWithTolerance();
    if (connectedCount >= maxAllowed) {
      console.warn("Max peers reached, cannot connect to more peers");
      return;
    }
    const initiator = selfId < normalizedPeerId;
    if (!initiator) {
      this.signalingClient?.nudgeSignaling?.();
      const fallbackMs = this.config.nonInitiatorFallbackDialMs;
      if (!fallbackMs || fallbackMs <= 0) {
        return;
      }
      const candidatePeers = Array.from(this.discoveredPeers).map((id) => this.normalizePeerId(id)).filter((id) => {
        if (!id || id === selfId || this.isSelfAlias(id)) return false;
        if (this.peers.has(id) || this.connecting.has(id)) return false;
        if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
        return true;
      });
      if (candidatePeers.some((id) => selfId < id)) {
        return;
      }
      const fallbackTargets = candidatePeers.filter((id) => selfId > id).sort((a, b) => a.localeCompare(b));
      if (fallbackTargets.length === 0) {
        return;
      }
      const selectedFallbackTarget = fallbackTargets.slice().sort((a, b) => {
        const failA = this.dialFailureCount.get(a) ?? 0;
        const failB = this.dialFailureCount.get(b) ?? 0;
        if (failA !== failB) return failA - failB;
        const discoveredA = this.discoveredAtMs.get(a) ?? 0;
        const discoveredB = this.discoveredAtMs.get(b) ?? 0;
        if (discoveredA !== discoveredB) return discoveredA - discoveredB;
        return a.localeCompare(b);
      })[0];
      if (selectedFallbackTarget !== normalizedPeerId) {
        return;
      }
      if (!this.nonInitiatorFallbackTimers.has(normalizedPeerId)) {
        const fallbackTimer = setTimeout(() => {
          this.nonInitiatorFallbackTimers.delete(normalizedPeerId);
          if (this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId)) {
            return;
          }
          const refreshedCandidates = Array.from(this.discoveredPeers).map((id) => this.normalizePeerId(id)).filter((id) => {
            if (!id || id === selfId || this.isSelfAlias(id)) return false;
            if (this.peers.has(id) || this.connecting.has(id)) return false;
            if (!emergencyIsolated && this.isPeerBackedOff(id)) return false;
            return true;
          });
          if (refreshedCandidates.some((id) => selfId < id)) {
            return;
          }
          const refreshedTargets = refreshedCandidates.filter((id) => selfId > id).sort((a, b) => a.localeCompare(b));
          if (refreshedTargets.length === 0) {
            return;
          }
          const refreshedSelectedTarget = refreshedTargets.slice().sort((a, b) => {
            const failA = this.dialFailureCount.get(a) ?? 0;
            const failB = this.dialFailureCount.get(b) ?? 0;
            if (failA !== failB) return failA - failB;
            const discoveredA = this.discoveredAtMs.get(a) ?? 0;
            const discoveredB = this.discoveredAtMs.get(b) ?? 0;
            if (discoveredA !== discoveredB) return discoveredA - discoveredB;
            return a.localeCompare(b);
          })[0];
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
          const currentConnectedCount = this.getConnectedPeerCount();
          const fallbackMaxAllowed = allowTemporaryOverflow ? this.config.maxPeers + 1 : this.getMaxPeersWithTolerance();
          if (currentConnectedCount >= fallbackMaxAllowed) {
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
        this.emit("peer:disconnected", peerId);
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
    return Array.from(this.globalPeers).filter((peerId) => !this.isSelfAlias(peerId) && !this.retiredPeerIds.has(peerId));
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
  sendMembership(toPeerId) {
    const self = this.normalizePeerId(this.clientId);
    const all = new Set(this.globalPeers);
    if (self) all.add(self);
    for (const p of this.discoveredPeers) all.add(p);
    for (const retiredPeerId of this.retiredPeerIds) all.delete(retiredPeerId);
    const payload = JSON.stringify({
      __membership: true,
      peers: Array.from(all),
      retiredPeers: Array.from(this.retiredPeerIds)
    });
    try {
      this.signalingClient?.send(toPeerId, payload);
    } catch {
    }
  }
  tryParseMembership(raw) {
    try {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (obj?.__membership === true && Array.isArray(obj.peers)) {
        return {
          peers: obj.peers,
          retiredPeers: Array.isArray(obj.retiredPeers) ? obj.retiredPeers : []
        };
      }
    } catch {
    }
    return null;
  }
  mergeMembership(incoming, retired, fromPeerId) {
    let changed = false;
    for (const raw of retired) {
      if (this.retirePeerId(raw)) changed = true;
    }
    for (const raw of incoming) {
      const id = this.normalizePeerId(raw);
      if (!id || this.isSelfAlias(id) || this.retiredPeerIds.has(id)) continue;
      if (!this.globalPeers.has(id)) {
        this.globalPeers.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.emit("mesh:membership", Array.from(this.globalPeers));
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
  removeFromGlobalMembership(peerId) {
    const removed = this.globalPeers.delete(peerId);
    if (!removed) return;
    this.emit("mesh:membership", Array.from(this.globalPeers));
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
    this.peerConnectedAtMs.clear();
    this.rebalanceAttemptAtMs.clear();
    this.pendingRebalanceDropByTarget.clear();
    this.globalPeers.clear();
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
var index_default = PartialMesh;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GossipProtocol,
  PartialMesh,
  PeerPigeonStorage
});
