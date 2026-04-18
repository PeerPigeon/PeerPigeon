// src/rtc-peer.ts
var TinyEmitter = class {
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
    for (const fn of set) {
      try {
        fn(...args);
      } catch {
      }
    }
  }
};
var RtcPeer = class {
  constructor(options) {
    this.destroyed = false;
    this.dc = null;
    this.emitter = new TinyEmitter();
    this.connectedEmitted = false;
    this.initiator = options.initiator;
    this.trickleIce = options.trickleIce ?? options.trickle ?? true;
    this.pc = new RTCPeerConnection(options.config ?? {});
    this.pc.onicecandidate = (event) => {
      if (!event.candidate || !this.trickleIce) {
        return;
      }
      this.emitter.emit("signal", { candidate: event.candidate.toJSON() });
    };
    this.pc.onsignalingstatechange = () => {
      this.emitDebugSnapshot("signalingstatechange");
    };
    this.pc.oniceconnectionstatechange = () => {
      this.emitDebugSnapshot("iceconnectionstatechange");
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.emitDebugSnapshot("connectionstatechange");
      if (s === "failed" || s === "closed") {
        this.destroy();
      }
    };
    this.pc.ondatachannel = (event) => {
      this.attachDataChannel(event.channel);
    };
    if (this.initiator) {
      this.attachDataChannel(this.pc.createDataChannel("gossip"));
      this.createOffer().catch((err) => this.emitter.emit("error", err));
    }
    this.emitDebugSnapshot("constructed");
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  async signal(signal) {
    if (this.destroyed || !signal) return;
    if (signal.type === "offer" || signal.type === "answer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
      this.emitDebugSnapshot(`remote-${signal.type}`);
      if (signal.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.emitLocalDescription("answer");
      }
      return;
    }
    const candidate = signal.candidate ?? signal;
    if (candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
  send(data) {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("Data channel not open");
    }
    this.dc.send(data);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      if (this.dc && this.dc.readyState !== "closed") this.dc.close();
    } catch {
    }
    try {
      this.pc.close();
    } catch {
    }
    this.emitter.emit("close");
  }
  attachDataChannel(channel) {
    this.dc = channel;
    this.emitDebugSnapshot("datachannel-attached");
    channel.onopen = () => {
      this.emitDebugSnapshot("datachannel-open");
      if (!this.connectedEmitted) {
        this.connectedEmitted = true;
        this.emitter.emit("connect");
      }
    };
    channel.onmessage = (event) => {
      this.emitter.emit("data", event.data);
    };
    channel.onerror = (event) => {
      this.emitDebugSnapshot("datachannel-error");
      this.emitter.emit("error", event);
    };
    channel.onclose = () => {
      this.emitDebugSnapshot("datachannel-close");
      this.destroy();
    };
  }
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.emitLocalDescription("offer");
  }
  async emitLocalDescription(kind) {
    if (this.trickleIce) {
      this.emitter.emit("signal", this.pc.localDescription);
      this.emitDebugSnapshot(`local-${kind}`);
      return;
    }
    await this.waitForIceGatheringComplete();
    this.emitter.emit("signal", this.pc.localDescription);
    this.emitDebugSnapshot(`local-${kind}-ice-complete`);
  }
  async waitForIceGatheringComplete() {
    await new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const onIce = () => {
        if (this.pc.iceGatheringState === "complete") {
          this.pc.removeEventListener("icegatheringstatechange", onIce);
          resolve();
        }
      };
      this.pc.addEventListener("icegatheringstatechange", onIce);
    });
  }
  emitDebugSnapshot(reason) {
    this.emitter.emit("debug", {
      reason,
      signalingState: this.pc.signalingState,
      iceConnectionState: this.pc.iceConnectionState,
      connectionState: this.pc.connectionState,
      dataChannelState: this.dc?.readyState ?? "missing"
    });
  }
};

// src/freertc-client-adapter.ts
function generatePeerId() {
  const bytes = new Uint8Array(32);
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
    this.pendingCandidates = /* @__PURE__ */ new Map();
    this.offerQueues = /* @__PURE__ */ new Map();
    this.lastRemoteOfferSdp = /* @__PURE__ */ new Map();
    this.lastAppliedAnswerSdp = /* @__PURE__ */ new Map();
    this.selfAliases = /* @__PURE__ */ new Set();
    this.peerEntries = /* @__PURE__ */ new Map();
    this.client = null;
    this.joinedOnce = false;
    this.socket = null;
    this.pingTimer = null;
    this.announceTimer = null;
    this.reconnectTimer = null;
    this.reconnectBackoffMs = 1e3;
    this.intentionallyDisconnected = false;
    this.signalUrl = signalUrl;
    this.networkId = options?.networkId ?? "default-session";
    this.requestedPeerId = options?.peerId ?? generatePeerId();
    this.defaultIceServers = options?.iceServers ?? null;
    this.defaultTrickleIce = options?.trickleIce ?? true;
    this.addSelfAlias(this.requestedPeerId);
    this.client = {
      mesh: { connections: this.peerEntries },
      peerId: this.requestedPeerId,
      isRegistered: true
    };
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  connect() {
    this.intentionallyDisconnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const wsUrl = new URL(this.signalUrl, typeof location !== "undefined" ? location.href : void 0);
    if (!wsUrl.searchParams.get("networkId")) {
      wsUrl.searchParams.set("networkId", this.networkId);
    }
    this.socket = new WebSocket(wsUrl.toString());
    this.socket.onopen = () => {
      this.reconnectBackoffMs = 1e3;
      this.emitter.emit("signaling:log", { message: "[signal] connected" });
      this.sendEnvelope("announce", {
        ttl_ms: 3e4,
        body: { hints: { wants_peers: true } }
      });
      this.startPingLoop();
      this.startAnnounceLoop();
      this.emitter.emit("connected", {
        clientId: this.requestedPeerId,
        requestedClientId: this.requestedPeerId,
        previousClientId: null
      });
    };
    this.socket.onmessage = (event) => {
      this.handleSocketMessage(event.data);
    };
    this.socket.onclose = () => {
      this.stopLoops();
      this.socket = null;
      this.closeAllPeerEntries();
      this.emitter.emit("disconnected");
      this.scheduleReconnect();
    };
    this.socket.onerror = () => {
      this.emitter.emit("error", new Error("WebSocket error"));
    };
  }
  scheduleReconnect() {
    if (this.intentionallyDisconnected) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectBackoffMs;
    this.reconnectBackoffMs = Math.min(15e3, Math.floor(this.reconnectBackoffMs * 1.5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
  normalizePeerId(peerId) {
    return String(peerId ?? "").trim();
  }
  addSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.selfAliases.add(id);
  }
  isSelfAlias(peerId) {
    const id = this.normalizePeerId(peerId);
    if (!id) return false;
    return this.selfAliases.has(id);
  }
  startPingLoop() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      this.sendEnvelope("ping", { body: { nonce: generatePeerId().slice(0, 16) } });
    }, 1e3);
  }
  startAnnounceLoop() {
    if (this.announceTimer) return;
    this.announceTimer = setInterval(() => {
      this.sendEnvelope("announce", {
        ttl_ms: 3e4,
        body: { hints: { wants_peers: true } }
      });
    }, 12e3);
  }
  stopLoops() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
  }
  sendEnvelope(type, options = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      psp_version: "1.0",
      type,
      network: this.networkId,
      from: this.requestedPeerId,
      to: options.to ?? null,
      session_id: options.session_id ?? null,
      message_id: generatePeerId().slice(0, 16),
      timestamp: Date.now(),
      ttl_ms: options.ttl_ms ?? null,
      body: options.body ?? {}
    }));
  }
  handleSocketMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message?.type) {
      case "peer_list": {
        const peers = Array.isArray(message?.body?.peers) ? message.body.peers : [];
        const nextPeers = new Set(
          peers.map((peer) => this.normalizePeerId(peer?.peer_id)).filter((peerId) => peerId && !this.isSelfAlias(peerId))
        );
        const peerList = Array.from(nextPeers);
        if (!this.joinedOnce) {
          this.joinedOnce = true;
          this.emitter.emit("joined", { sessionId: this.networkId, clients: peerList });
        }
        for (const peerId of peerList) {
          if (!this.knownPeers.has(peerId)) {
            this.emitter.emit("peer-joined", { peerId });
          }
        }
        for (const peerId of this.knownPeers) {
          if (!nextPeers.has(peerId)) {
            this.emitter.emit("peer-left", { peerId });
          }
        }
        this.knownPeers.clear();
        for (const peerId of nextPeers) {
          this.knownPeers.add(peerId);
        }
        return;
      }
      case "offer":
        this.enqueueIncomingOffer(this.normalizePeerId(message?.from), message?.body);
        return;
      case "answer":
        this.handleSignal(this.normalizePeerId(message?.from), { type: "answer", sdp: message?.body?.sdp }).catch((error) => {
          this.emitter.emit("signaling:log", { message: `[webrtc] answer handling error: ${String(error?.message ?? error ?? "")}` });
        });
        return;
      case "ice_candidate": {
        const candidate = this.normalizeCandidate(message?.body?.candidate);
        if (!candidate) {
          return;
        }
        this.handleSignal(this.normalizePeerId(message?.from), { candidate }).catch((error) => {
          this.emitter.emit("signaling:log", { message: `[webrtc] candidate handling error: ${String(error?.message ?? error ?? "")}` });
        });
        return;
      }
      case "bye":
        this.closeConnection(this.normalizePeerId(message?.from));
        return;
      case "pong":
        return;
      case "error":
        this.emitter.emit("signaling:log", { message: `[signal] error: ${String(message?.body?.error ?? "")}` });
        return;
      default:
        return;
    }
  }
  normalizeCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }
    const candidateText = String(candidate.candidate ?? "").trim();
    if (!candidateText) {
      return null;
    }
    return {
      candidate: candidateText,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
      usernameFragment: candidate.usernameFragment
    };
  }
  attachPeer(peerId, peer, initiator) {
    const entry = {
      peer,
      initiator,
      trickleIce: this.defaultTrickleIce,
      connected: false,
      state: "connecting",
      connection: peer.pc,
      channel: peer.dc ?? null
    };
    this.peerEntries.set(peerId, entry);
    peer.on("signal", (signal) => {
      entry.connection = peer.pc;
      entry.channel = peer.dc ?? null;
      if (signal?.type === "offer" || signal?.type === "answer") {
        this.sendEnvelope(signal.type, {
          to: peerId,
          body: { sdp: signal.sdp, trickle_ice: entry.trickleIce }
        });
      } else if (signal?.candidate) {
        this.sendEnvelope("ice_candidate", {
          to: peerId,
          body: { candidate: signal.candidate }
        });
      }
    });
    peer.on("connect", () => {
      const current = this.peerEntries.get(peerId);
      if (!current || current.connected) return;
      current.connected = true;
      current.state = "connected";
      current.connection = peer.pc;
      current.channel = peer.dc ?? null;
      this.emitter.emit("rtc:connected", { peerId });
    });
    peer.on("debug", (snapshot) => {
      const current = this.peerEntries.get(peerId);
      if (current) {
        current.connection = peer.pc;
        current.channel = peer.dc ?? null;
        current.state = snapshot.connectionState;
      }
      this.emitter.emit("signaling:log", {
        message: `[webrtc] ${peerId} ${snapshot.reason} signaling=${snapshot.signalingState} ice=${snapshot.iceConnectionState} pc=${snapshot.connectionState} dc=${snapshot.dataChannelState}`
      });
    });
    peer.on("data", (data) => {
      this.emitter.emit("rtc:data", { peerId, data });
    });
    peer.on("close", () => {
      const current = this.peerEntries.get(peerId);
      if (!current) return;
      this.peerEntries.delete(peerId);
      this.pendingCandidates.delete(peerId);
      this.emitter.emit("rtc:disconnected", { peerId });
    });
    peer.on("error", (error) => {
      this.emitter.emit("signaling:log", { message: `[webrtc] ${peerId} error: ${String(error?.message ?? error ?? "")}` });
    });
  }
  async handleIncomingOffer(peerId, body) {
    if (!peerId) return;
    const incomingOfferSdp = String(body?.sdp ?? "");
    if (!incomingOfferSdp) return;
    let entry = this.peerEntries.get(peerId);
    if (!entry) {
      const trickleIce = body?.trickle_ice ?? this.defaultTrickleIce;
      const peer = new RtcPeer({
        initiator: false,
        trickleIce,
        config: this.defaultIceServers ? { iceServers: this.defaultIceServers } : void 0
      });
      this.attachPeer(peerId, peer, false);
      entry = this.peerEntries.get(peerId);
      if (entry) {
        entry.trickleIce = trickleIce;
      }
    }
    const pc = entry?.connection;
    if (entry?.connected) {
      return;
    }
    const lastSdp = this.lastRemoteOfferSdp.get(peerId);
    if (lastSdp && lastSdp === incomingOfferSdp) {
      return;
    }
    if (pc?.signalingState === "have-remote-offer" || pc?.remoteDescription?.sdp === incomingOfferSdp || pc?.signalingState === "stable" && !!pc?.remoteDescription) {
      return;
    }
    await entry.peer.signal({ type: "offer", sdp: incomingOfferSdp });
    this.lastRemoteOfferSdp.set(peerId, incomingOfferSdp);
    await this.flushPendingCandidates(peerId);
  }
  enqueueIncomingOffer(peerId, body) {
    if (!peerId) return;
    const prior = this.offerQueues.get(peerId) ?? Promise.resolve();
    const next = prior.then(async () => {
      await this.handleIncomingOffer(peerId, body);
    }).catch(() => {
    });
    this.offerQueues.set(peerId, next);
  }
  async handleSignal(peerId, signal) {
    const entry = this.peerEntries.get(peerId);
    if (!entry) {
      if (signal?.candidate) {
        const queued = this.pendingCandidates.get(peerId) ?? [];
        queued.push(signal);
        this.pendingCandidates.set(peerId, queued);
      }
      return;
    }
    const pc = entry.connection;
    if (signal?.candidate) {
      if (!pc?.remoteDescription) {
        const queued = this.pendingCandidates.get(peerId) ?? [];
        queued.push(signal);
        this.pendingCandidates.set(peerId, queued);
        return;
      }
    }
    if (signal?.type === "answer") {
      const answerSdp = String(signal?.sdp ?? "");
      const lastAnswer = this.lastAppliedAnswerSdp.get(peerId);
      if (!pc || pc.signalingState === "stable" || pc.remoteDescription?.type === "answer") {
        return;
      }
      if (answerSdp && lastAnswer && lastAnswer === answerSdp) {
        return;
      }
    }
    try {
      await entry.peer.signal(signal);
      if (signal?.type === "answer") {
        if (signal?.sdp) {
          this.lastAppliedAnswerSdp.set(peerId, String(signal.sdp));
        }
        await this.flushPendingCandidates(peerId);
      }
    } catch (error) {
      const message = String(error?.message ?? error ?? "");
      if (/wrong state|remote description was null|expected candidate got/i.test(message)) {
        return;
      }
      throw error;
    }
  }
  async flushPendingCandidates(peerId) {
    const entry = this.peerEntries.get(peerId);
    if (!entry?.connection?.remoteDescription) return;
    const queued = this.pendingCandidates.get(peerId) ?? [];
    this.pendingCandidates.delete(peerId);
    for (const candidate of queued) {
      try {
        await entry.peer.signal(candidate);
      } catch {
      }
    }
  }
  disconnect() {
    this.intentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopLoops();
    if (this.socket) {
      try {
        this.socket.close(1e3, "user_disconnect");
      } catch {
      }
      this.socket = null;
    }
    this.closeAllPeerEntries();
    this.joinedOnce = false;
    this.knownPeers.clear();
  }
  isConnected() {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }
  closeAllPeerEntries() {
    const entries = Array.from(this.peerEntries.entries());
    for (const [peerId, entry] of entries) {
      this.peerEntries.delete(peerId);
      this.pendingCandidates.delete(peerId);
      this.offerQueues.delete(peerId);
      this.lastRemoteOfferSdp.delete(peerId);
      this.lastAppliedAnswerSdp.delete(peerId);
      try {
        entry.peer?.destroy?.();
      } catch {
      }
      this.emitter.emit("rtc:disconnected", { peerId });
    }
  }
  joinSession(sessionId) {
    if (sessionId && sessionId !== this.networkId) {
      this.emitter.emit("error", new Error("FreeRTC adapter does not support changing networkId after initialization"));
      return;
    }
    this.sendEnvelope("discover", {
      body: { exclude_peers: [], limit: 50 }
    });
  }
  async initiateConnection(peerId, iceServers, trickleIce) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.closeConnection(peerId);
    const resolvedTrickleIce = trickleIce ?? this.defaultTrickleIce;
    const peer = new RtcPeer({
      initiator: true,
      trickleIce: resolvedTrickleIce,
      config: iceServers ?? this.defaultIceServers ? { iceServers: iceServers ?? this.defaultIceServers ?? void 0 } : void 0
    });
    this.attachPeer(peerId, peer, true);
    const entry = this.peerEntries.get(peerId);
    if (entry) {
      entry.trickleIce = resolvedTrickleIce;
    }
  }
  nudgeSignaling() {
    this.sendEnvelope("announce", {
      ttl_ms: 3e4,
      body: { hints: { wants_peers: true } }
    });
    this.joinSession(this.networkId);
  }
  closeConnection(peerId) {
    const entry = this.peerEntries.get(peerId);
    if (!entry) return;
    this.peerEntries.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.offerQueues.delete(peerId);
    this.lastRemoteOfferSdp.delete(peerId);
    this.lastAppliedAnswerSdp.delete(peerId);
    try {
      entry.peer?.destroy?.();
    } catch {
    }
  }
  send(peerId, data) {
    const entry = this.peerEntries.get(peerId);
    if (!entry?.connected) {
      throw new Error("WebRTC not yet connected");
    }
    entry.peer.send(data);
  }
  broadcast(data) {
    for (const [, entry] of this.peerEntries.entries()) {
      if (!entry?.connected) continue;
      try {
        entry.peer.send(data);
      } catch {
      }
    }
  }
};
var freertc_client_adapter_default = FreeRTCClientAdapter;

// src/gossip.ts
var GossipProtocol = class {
  constructor(mesh, options = {}) {
    this.messageLog = /* @__PURE__ */ new Map();
    this.cecrCurrentExtrema = null;
    this.cecrPreviousExtrema = null;
    this.cecrRemoteStates = /* @__PURE__ */ new Map();
    this.cecrSyncTimer = null;
    this.seenDirectIds = /* @__PURE__ */ new Set();
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
    this.seenDirectIds.add(message.id);
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
    this.seenDirectIds.add(message.id);
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
var _PeerPigeonStorage = class _PeerPigeonStorage {
  constructor(options) {
    this.storeName = "records";
    this.driver = null;
    this.seenMutationIds = /* @__PURE__ */ new Set();
    this.listeners = /* @__PURE__ */ new Set();
    this.pendingRetrieveRequests = /* @__PURE__ */ new Map();
    this.closed = false;
    const userId = String(options.userId ?? "").trim();
    if (!userId) {
      throw new Error("PeerPigeonStorage requires a non-empty userId");
    }
    this.userId = userId;
    this.gossip = options.gossip ?? null;
    this.sessionId = String(options.sessionId ?? "default-session").trim() || "default-session";
    this.syncSecret = String(options.syncSecret ?? "").trim();
    this.syncFilter = typeof options.syncFilter === "function" ? options.syncFilter : null;
    this.dbName = String(options.dbName ?? "peerpigeon-storage-v1").trim() || "peerpigeon-storage-v1";
    this.onGossipMessageBound = (data) => {
      this.handleGossipMessage(data).catch(() => {
      });
    };
  }
  async init() {
    if (this.closed) {
      throw new Error("PeerPigeonStorage is closed");
    }
    if (this.driver) return;
    this.driver = await this.createDriver();
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
  off(event, listener) {
    if (event !== "change") return;
    this.listeners.delete(listener);
  }
  async put(space, key, value, options = {}) {
    const mutation = await this.applyLocalUpsert(space, key, value, options);
    if (space !== "private") {
      await this.broadcastMutation(mutation);
    }
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
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      version: persisted.version
    };
  }
  async retrieve(space, key, options = {}) {
    const normalizedKey = this.normalizeKey(key);
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
    const mutation = await this.applyLocalDelete(space, key);
    if (!mutation) return false;
    if (space !== "private") {
      await this.broadcastMutation(mutation);
    }
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
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        version: record.version
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
    this.listeners.clear();
    this.seenMutationIds.clear();
    for (const pending of this.pendingRetrieveRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRetrieveRequests.clear();
  }
  async applyLocalUpsert(space, key, value, options) {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    const now = Date.now();
    this.assertCanWrite(space, existing, actorId, options.ownerId);
    const ownerId = this.resolveOwnerId(space, existing, actorId, options.ownerId);
    const nextVersion = (existing?.version ?? 0) + 1;
    const encoded = await this.encodeValueForStore(space, value);
    const persisted = {
      pk,
      space,
      key: normalizedKey,
      ownerId,
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
    this.seenMutationIds.add(opId);
    this.emitChange({
      origin: "local",
      op: "upsert",
      record: {
        space,
        key: normalizedKey,
        value,
        ownerId,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        version: persisted.version
      },
      space,
      key: normalizedKey,
      actorId
    });
    return mutation;
  }
  async applyLocalDelete(space, key) {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    if (!existing) return null;
    this.assertCanDelete(space, existing, actorId);
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
    this.seenMutationIds.add(opId);
    this.emitChange({
      origin: "local",
      op: "delete",
      record: null,
      space,
      key: normalizedKey,
      actorId
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
      if (this.seenMutationIds.has(decrypted.opId)) return;
      if (decrypted.space === "private") return;
      this.seenMutationIds.add(decrypted.opId);
      await this.applyRemoteMutation(decrypted);
      return;
    }
    if (this.isStorageRetrieveRequest(decrypted)) {
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
      if (!existing) return;
      if (mutation.timestamp <= existing.updatedAt) return;
      if (!this.canDelete(mutation.space, existing, mutation.actorId)) return;
      await driver.delete(pk);
      this.emitChange({
        origin: "remote",
        op: "delete",
        record: null,
        space: mutation.space,
        key: mutation.key,
        actorId: mutation.actorId
      });
      return;
    }
    if (!mutation.record) return;
    if (existing) {
      const existingVersion = Number(existing.version ?? 0);
      const incomingVersion = Number(mutation.record.version ?? 0);
      const existingUpdatedAt = Number(existing.updatedAt ?? 0);
      const incomingUpdatedAt = Number(mutation.timestamp ?? 0);
      const existingAgeMs = Math.max(0, Date.now() - existingUpdatedAt);
      if (incomingVersion < existingVersion) {
        if (mutation.space === "public" && existingAgeMs > _PeerPigeonStorage.STALE_LOCAL_MAX_AGE_MS) {
        } else if (incomingUpdatedAt <= existingUpdatedAt + _PeerPigeonStorage.STALE_VERSION_OVERRIDE_MS) {
          return;
        }
      }
      if (incomingVersion === existingVersion && incomingUpdatedAt <= existingUpdatedAt) return;
    }
    if (!this.canWrite(mutation.space, existing, mutation.actorId)) return;
    if (mutation.space === "user" && !existing) {
      const incomingOwner = String(mutation.record.ownerId ?? "").trim();
      if (incomingOwner && incomingOwner !== mutation.actorId) {
        return;
      }
    }
    const incoming = {
      ...mutation.record,
      pk,
      ownerId: mutation.space === "user" ? existing?.ownerId ?? mutation.record.ownerId ?? mutation.actorId : mutation.record.ownerId,
      updatedAt: mutation.timestamp,
      createdAt: existing?.createdAt ?? mutation.record.createdAt,
      version: Math.max(existing?.version ?? 0, mutation.record.version)
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
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
        version: incoming.version
      },
      space: incoming.space,
      key: incoming.key,
      actorId: mutation.actorId
    });
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
    this.gossip.broadcast(envelope, { storageSync: true, encrypted: true });
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
    const pending = this.pendingRetrieveRequests.get(response.reqId);
    if (!pending) return;
    this.pendingRetrieveRequests.delete(response.reqId);
    clearTimeout(pending.timeout);
    if (response.record && response.space !== "private") {
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
    const latest = await this.get(response.space, response.key);
    pending.resolve(latest);
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
    if (event.origin === "remote" && !this.shouldSyncKey(event.space, event.key)) {
      return;
    }
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
  shouldSyncKey(space, key) {
    if (!this.syncFilter) return true;
    try {
      return this.syncFilter(space, key);
    } catch {
      return false;
    }
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
    return existing?.ownerId ?? null;
  }
  assertCanWrite(space, existing, actorId, ownerOverride) {
    if (!this.canWrite(space, existing, actorId, ownerOverride)) {
      throw new Error(`Write denied for ${space} space key`);
    }
  }
  canWrite(space, existing, actorId, ownerOverride) {
    if (space === "public") return true;
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
  assertCanDelete(space, existing, actorId) {
    if (!this.canDelete(space, existing, actorId)) {
      throw new Error(`Delete denied for ${space} space key`);
    }
  }
  canDelete(space, existing, actorId) {
    if (space === "public") return true;
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
    return !!maybe && maybe.__ppType === "pp-storage-op-v1" && typeof maybe.opId === "string" && (maybe.op === "upsert" || maybe.op === "delete") && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number";
  }
  isStorageRetrieveRequest(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-req-v1" && typeof maybe.reqId === "string" && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number";
  }
  isStorageRetrieveResponse(value) {
    const maybe = value;
    return !!maybe && maybe.__ppType === "pp-storage-res-v1" && typeof maybe.reqId === "string" && (maybe.space === "public" || maybe.space === "user" || maybe.space === "frozen" || maybe.space === "private") && typeof maybe.key === "string" && typeof maybe.actorId === "string" && typeof maybe.timestamp === "number" && (maybe.record === null || typeof maybe.record === "object");
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
    return JSON.parse(text);
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
_PeerPigeonStorage.STALE_VERSION_OVERRIDE_MS = 3e4;
_PeerPigeonStorage.STALE_LOCAL_MAX_AGE_MS = 5 * 6e4;
var PeerPigeonStorage = _PeerPigeonStorage;

// src/index.ts
var PartialMesh = class {
  constructor(config = {}) {
    this.peers = /* @__PURE__ */ new Map();
    this.signalingClient = null;
    this.discoveredPeers = /* @__PURE__ */ new Set();
    this.clientId = null;
    this.selfAliases = /* @__PURE__ */ new Set();
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
      sessionId: config.sessionId ?? "default-session",
      autoDiscover: config.autoDiscover ?? true,
      autoConnect: config.autoConnect ?? true,
      // Prefer FreeRTC's richer built-in ICE profile by default.
      iceServers: config.iceServers ?? null,
      // FreeRTC retries relayed offers for up to ~30s; keep this above that window
      // so we do not abort otherwise-recoverable negotiations.
      connectionTimeoutMs: config.connectionTimeoutMs ?? 45e3,
      maintenanceIntervalMs: config.maintenanceIntervalMs ?? 2e3,
      underConnectedResetMs: config.underConnectedResetMs ?? 0,
      nonInitiatorFallbackDialMs: config.nonInitiatorFallbackDialMs ?? 8e3,
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
    if (!id || this.isSelfAlias(id)) return;
    if (this.discoveredPeers.has(id)) return;
    this.discoveredPeers.add(id);
    this.discoveredAtMs.set(id, Date.now());
    this.emit("peer:discovered", id);
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
      return discoveredAgeMs >= 2e3 && sinceAttemptMs >= 2e4;
    });
    if (!closestCandidate || !farthestConnected) {
      return false;
    }
    const connectedAgeMs = now - (farthestConnected.connectedAt || 0);
    if (connectedAgeMs < 12e3) {
      return false;
    }
    if (closestCandidate.distance * 4n >= farthestConnected.distance * 3n) {
      return false;
    }
    const otherDiscoveredPeers = Array.from(this.discoveredPeers).filter((p) => {
      const id = this.normalizePeerId(p);
      return id && id !== selfId && id !== farthestConnected.peerId && id !== closestCandidate.peerId;
    }).length;
    if (otherDiscoveredPeers < 1) {
      return false;
    }
    this.rebalanceCooldownUntilMs = now + 12e3;
    this.rebalanceAttemptAtMs.set(closestCandidate.peerId, now);
    this.rebalanceAttemptAtMs.set(farthestConnected.peerId, now);
    this.pendingRebalanceDropByTarget.set(closestCandidate.peerId, farthestConnected.peerId);
    this.emit("signaling:log", {
      message: `[rebalance] dial closer ${closestCandidate.peerId.slice(0, 8)} then drop ${farthestConnected.peerId.slice(0, 8)}`
    });
    this.connectToPeerInternal(closestCandidate.peerId, true);
    return true;
  }
  /**
   * Initialize and connect to the signaling server
   */
  async init() {
    const url = new URL(this.config.signalingServer);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    const signalingUrl = url.toString();
    const requestedPeerId = Array.from(
      (globalThis.window?.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, "0")
    ).join("");
    this.addSelfAlias(requestedPeerId);
    this.signalingClient = new freertc_client_adapter_default(signalingUrl, {
      networkId: this.config.sessionId,
      peerId: requestedPeerId,
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
    this.signalingClient.on("rtc:connected", (data) => {
      const peerId = this.normalizePeerId(data.peerId);
      if (!peerId || this.isSelfAlias(peerId)) return;
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
        this.mergeMembership(msg.peers, data.peerId);
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
    if (!underConnected && !hasFewCandidates) return;
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
    const stallMs = isolated ? Math.max(3500, Math.min(this.config.connectionTimeoutMs, 6e3)) : baseStallMs;
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
      for (const peerId of pickCandidates(dialCount)) {
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
    if (!normalizedPeerId || this.peers.has(normalizedPeerId) || this.connecting.has(normalizedPeerId) || this.isSelfAlias(normalizedPeerId) || normalizedPeerId === selfId) {
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
      const candidatePeers = Array.from(this.discoveredPeers).map((id) => this.normalizePeerId(id)).filter((id) => id && !this.isSelfAlias(id) && id !== selfId && !this.peers.has(id) && !this.connecting.has(id) && !this.isPeerBackedOff(id));
      const hasNaturalInitiatorTarget = candidatePeers.some((id) => selfId < id);
      if (hasNaturalInitiatorTarget) {
        return;
      }
      const fallbackTargets = candidatePeers.filter((id) => selfId > id).sort((a, b) => a.localeCompare(b));
      if (fallbackTargets.length === 0) {
        return;
      }
      let hash = 0;
      for (let i = 0; i < selfId.length; i++) {
        hash = hash * 31 + selfId.charCodeAt(i) >>> 0;
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
          const refreshedCandidates = Array.from(this.discoveredPeers).map((id) => this.normalizePeerId(id)).filter((id) => id && !this.isSelfAlias(id) && id !== selfId && !this.peers.has(id) && !this.connecting.has(id) && !this.isPeerBackedOff(id));
          if (refreshedCandidates.some((id) => selfId < id)) {
            return;
          }
          const refreshedFallbackTargets = refreshedCandidates.filter((id) => selfId > id).sort((a, b) => a.localeCompare(b));
          if (refreshedFallbackTargets.length === 0) {
            return;
          }
          let refreshedHash = 0;
          for (let i = 0; i < selfId.length; i++) {
            refreshedHash = refreshedHash * 31 + selfId.charCodeAt(i) >>> 0;
          }
          const refreshedSelected = refreshedFallbackTargets[refreshedHash % refreshedFallbackTargets.length];
          if (refreshedSelected !== normalizedPeerId) {
            return;
          }
          const rtcEntry = this.signalingClient?.client?.mesh?.connections?.get?.(normalizedPeerId);
          if (rtcEntry?.state === "connecting" || rtcEntry?.state === "connected") {
            return;
          }
          if (rtcEntry?.channel?.readyState === "open") {
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
    return Array.from(this.discoveredPeers);
  }
  /**
   * Get the converged global peer set (all peers known via membership gossip).
   */
  getGlobalPeers() {
    return Array.from(this.globalPeers);
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
    const payload = JSON.stringify({ __membership: true, peers: Array.from(all) });
    try {
      this.signalingClient?.send(toPeerId, payload);
    } catch {
    }
  }
  tryParseMembership(raw) {
    try {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (obj?.__membership === true && Array.isArray(obj.peers)) {
        return { peers: obj.peers };
      }
    } catch {
    }
    return null;
  }
  mergeMembership(incoming, fromPeerId) {
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
    for (const peerId of this.peers.keys()) {
      try {
        this.signalingClient?.closeConnection(peerId);
      } catch {
      }
    }
    this.peers.clear();
    this.connecting.clear();
    this.discoveredPeers.clear();
    this.clientId = null;
    this.underConnectedSinceMs = null;
    this.lastHardResetAtMs = 0;
    this.lastDiscoveryRefreshAtMs = 0;
    this.dialFailureCount.clear();
    this.dialBackoffUntilMs.clear();
    if (this.signalingClient) {
      this.signalingClient.disconnect();
      this.signalingClient = null;
    }
  }
};
var index_default = PartialMesh;
export {
  GossipProtocol,
  PartialMesh,
  PeerPigeonStorage,
  index_default as default
};
