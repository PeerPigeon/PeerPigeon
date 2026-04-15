/**
 * PeerPigeon - P2P browser networking library
 * Built on gossip-protocol (refactor branch) — PartialMesh + GossipProtocol
 */
import { PartialMesh, GossipProtocol } from 'gossip-protocol';

// ─── Simple EventEmitter ────────────────────────────────────────────────────
class EventEmitter {
  constructor() {
    this._handlers = new Map();
  }

  addEventListener(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
  }

  removeEventListener(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  _emit(event, data) {
    this._handlers.get(event)?.forEach(h => {
      try { h(data); } catch (e) { console.error('[PeerPigeon] event error', e); }
    });
  }
}

// ─── CryptoManager ──────────────────────────────────────────────────────────
class CryptoManager {
  constructor() {
    this.keypair = null;
    this.peerKeys = new Map(); // peerId -> { publicKey: CryptoKey, exported: string }
    this._publicKeyExported = null;
  }

  async generateKeypair() {
    this.keypair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    const jwk = await crypto.subtle.exportKey('jwk', this.keypair.publicKey);
    this._publicKeyExported = JSON.stringify(jwk);
    return this.keypair;
  }

  getPublicKey() {
    return this._publicKeyExported;
  }

  async exportPublicKey() {
    if (!this.keypair) return null;
    return this._publicKeyExported;
  }

  async importPeerKey(peerId, keyData) {
    try {
      const jwk = typeof keyData === 'string' ? JSON.parse(keyData) : keyData;
      const key = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []
      );
      this.peerKeys.set(peerId, { publicKey: key, exported: typeof keyData === 'string' ? keyData : JSON.stringify(keyData) });
      return key;
    } catch (e) {
      console.error('[Crypto] importPeerKey error', e);
      return null;
    }
  }

  async _deriveSharedKey(peerId) {
    const peerEntry = this.peerKeys.get(peerId);
    if (!peerEntry || !this.keypair) throw new Error('No key for peer');
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerEntry.publicKey },
      this.keypair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(message, peerId) {
    const key = await this._deriveSharedKey(peerId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(typeof message === 'string' ? message : JSON.stringify(message));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext))
    };
  }

  async decrypt(encrypted, peerId) {
    try {
      const key = await this._deriveSharedKey(peerId);
      const iv = new Uint8Array(encrypted.iv);
      const data = new Uint8Array(encrypted.data);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error('[Crypto] decrypt error', e);
      return null;
    }
  }
}

// ─── WebDHT ─────────────────────────────────────────────────────────────────
class WebDHT {
  constructor(emitFn) {
    this._emit = emitFn;
    this._store = new Map(); // key -> { value, version, ttl, timestamp }
    this._subscriptions = new Set();
    this._broadcastFn = null; // set by PeerPigeonMesh
  }

  _handleIncoming(peerId, data) {
    if (data?.type !== 'dht') return false;
    if (data.action === 'put') {
      const existing = this._store.get(data.key);
      if (!existing || data.version > (existing.version || 0)) {
        this._store.set(data.key, { value: data.value, version: data.version, timestamp: Date.now() });
        if (this._subscriptions.has(data.key)) {
          this._emit('dhtValueChanged', { key: data.key, newValue: data.value, version: data.version });
        }
      }
    } else if (data.action === 'delete') {
      this._store.delete(data.key);
    }
    return true;
  }

  async put(key, value, options = {}) {
    const version = (this._store.get(key)?.version || 0) + 1;
    this._store.set(key, { value, version, timestamp: Date.now(), ttl: options.ttl });
    this._broadcastFn?.({ type: 'dht', action: 'put', key, value, version });
    return version;
  }

  async update(key, value) {
    return this.put(key, value);
  }

  async get(key) {
    return this._store.get(key)?.value ?? null;
  }

  async delete(key) {
    const existed = this._store.has(key);
    this._store.delete(key);
    if (existed) this._broadcastFn?.({ type: 'dht', action: 'delete', key });
    return existed;
  }

  async subscribe(key) {
    this._subscriptions.add(key);
  }

  async unsubscribe(key) {
    this._subscriptions.delete(key);
  }
}

// ─── DistributedStorage ─────────────────────────────────────────────────────
class DistributedStorage {
  constructor(dht, emitFn) {
    this._dht = dht;
    this._emit = emitFn;
    this._enabled = true;
    this._items = new Map();
  }

  async enable() { this._enabled = true; }
  async disable() { this._enabled = false; }

  async getStatus() {
    return { enabled: this._enabled, itemCount: this._items.size };
  }

  async store(key, data, options = {}) {
    if (!this._enabled) throw new Error('Storage disabled');
    const item = { data, space: options.space || 'private', timestamp: Date.now() };
    this._items.set(key, item);
    await this._dht.put(`_storage:${key}`, item);
    this._emit('storageDataStored', { key });
  }

  async retrieve(key) {
    if (!this._enabled) throw new Error('Storage disabled');
    const cached = this._items.get(key);
    if (cached) return cached.data;
    const fromDHT = await this._dht.get(`_storage:${key}`);
    if (fromDHT) {
      this._items.set(key, fromDHT);
      return fromDHT.data;
    }
    return null;
  }

  async delete(key) {
    this._items.delete(key);
    await this._dht.delete(`_storage:${key}`);
  }

  async listKeys() {
    return Array.from(this._items.keys());
  }

  async getStats() {
    return { totalItems: this._items.size, enabled: this._enabled };
  }

  async clear() {
    const keys = Array.from(this._items.keys());
    for (const key of keys) await this.delete(key);
  }
}

// ─── MediaManager ────────────────────────────────────────────────────────────
class MediaManager extends EventEmitter {
  constructor() {
    super();
    this.localStream = null;
    this._remoteStreams = new Map();
    this._peerConnections = new Map();
    this.videoEnabled = false;
    this.audioEnabled = false;
    this.streamingToAll = true;
    this.blockedPeers = new Set();
    this.targetPeers = null; // null = all peers
    this._sendFn = null;    // set by PeerPigeonMesh: (peerId, data) => void
    this._getConnectedFn = null; // set by PeerPigeonMesh: () => string[]
  }

  async initialize() {
    // Pre-flight check only — we don't request permissions here
    return true;
  }

  static async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        cameras: devices.filter(d => d.kind === 'videoinput'),
        microphones: devices.filter(d => d.kind === 'audioinput')
      };
    } catch {
      return { cameras: [], microphones: [] };
    }
  }

  async start(options = {}) {
    const constraints = {};
    if (options.video) {
      constraints.video = options.deviceIds?.camera
        ? { deviceId: { exact: options.deviceIds.camera } }
        : true;
    }
    if (options.audio) {
      constraints.audio = options.deviceIds?.microphone
        ? { deviceId: { exact: options.deviceIds.microphone } }
        : true;
    }

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.videoEnabled = !!options.video;
    this.audioEnabled = !!options.audio;

    this._emit('localStreamStarted', { stream: this.localStream });

    // Initiate connections to already-connected peers
    const peers = this._getConnectedFn?.() || [];
    for (const peerId of peers) {
      if (!this.blockedPeers.has(peerId) &&
          (this.streamingToAll || this.targetPeers?.has(peerId))) {
        await this._createOffer(peerId);
      }
    }

    return this.localStream;
  }

  async _createOffer(peerId) {
    const pc = this._getOrCreatePC(peerId);
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._sendFn?.(peerId, JSON.stringify({ type: 'media-offer', sdp: offer.sdp }));
  }

  _getOrCreatePC(peerId) {
    if (this._peerConnections.has(peerId)) return this._peerConnections.get(peerId);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        try {
          this._sendFn?.(peerId, JSON.stringify({ type: 'media-ice', candidate: event.candidate.toJSON() }));
        } catch { /* best-effort */ }
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this._remoteStreams.set(peerId, stream);
        this._emit('remoteStream', { peerId, stream });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        this._cleanupPC(peerId);
      }
    };

    this._peerConnections.set(peerId, pc);
    return pc;
  }

  async handleSignaling(peerId, msg) {
    if (msg.type === 'media-offer') {
      const pc = this._getOrCreatePC(peerId);
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
      }
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._sendFn?.(peerId, JSON.stringify({ type: 'media-answer', sdp: answer.sdp }));
    } else if (msg.type === 'media-answer') {
      const pc = this._peerConnections.get(peerId);
      if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'media-ice') {
      const pc = this._peerConnections.get(peerId);
      if (pc && msg.candidate) {
        try { await pc.addIceCandidate(msg.candidate); } catch { /* ignore */ }
      }
    } else if (msg.type === 'media-stop') {
      this._remoteStreams.delete(peerId);
      this._emit('remoteStreamEnded', { peerId });
    }
  }

  _cleanupPC(peerId) {
    const pc = this._peerConnections.get(peerId);
    if (pc) { pc.close(); this._peerConnections.delete(peerId); }
    if (this._remoteStreams.has(peerId)) {
      this._remoteStreams.delete(peerId);
      this._emit('remoteStreamEnded', { peerId });
    }
  }

  onPeerDisconnected(peerId) {
    this._cleanupPC(peerId);
  }

  async stop() {
    // Signal peers
    const peers = this._getConnectedFn?.() || [];
    for (const peerId of peers) {
      try { this._sendFn?.(peerId, JSON.stringify({ type: 'media-stop' })); } catch { /* best-effort */ }
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
      this._emit('localStreamStopped', null);
    }

    for (const pc of this._peerConnections.values()) pc.close();
    this._peerConnections.clear();
    this._remoteStreams.clear();
    this.videoEnabled = false;
    this.audioEnabled = false;
  }

  toggleVideo() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getVideoTracks();
    const newState = !tracks.some(t => t.enabled);
    tracks.forEach(t => { t.enabled = newState; });
    this.videoEnabled = newState;
    return newState;
  }

  toggleAudio() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getAudioTracks();
    const newState = !tracks.some(t => t.enabled);
    tracks.forEach(t => { t.enabled = newState; });
    this.audioEnabled = newState;
    return newState;
  }

  getState() {
    return {
      hasStream: !!this.localStream,
      isVideoEnabled: this.videoEnabled,
      isAudioEnabled: this.audioEnabled,
      videoDeviceId: this.localStream?.getVideoTracks()[0]?.label || null,
      audioDeviceId: this.localStream?.getAudioTracks()[0]?.label || null
    };
  }
}

// ─── PeerPigeonMesh ──────────────────────────────────────────────────────────
export class PeerPigeonMesh extends EventEmitter {
  constructor(options = {}) {
    super();
    this._opts = options;
    this.peerId = options.peerId || PeerPigeonMesh.createPeerId();
    this.connected = false;
    this.signalingUrl = null;
    this.startTime = null;

    // Feature flags
    this.enableCrypto = options.enableCrypto !== false;
    this.enableWebDHT = options.enableWebDHT !== false;
    this.enableDistributedStorage = options.enableDistributedStorage !== false;

    // Network
    this._networkName = options.networkName || 'global';
    this._allowGlobalFallback = options.allowGlobalFallback !== false;

    // Config
    this._config = {
      maxPeers: options.maxPeers ?? 6,
      minPeers: options.minPeers ?? 2,
      autoConnect: options.autoConnect !== false,
      autoDiscovery: options.autoDiscovery !== false,
      evictionStrategy: options.evictionStrategy !== false,
      xorRouting: options.xorRouting !== false
    };

    // Internals
    this._mesh = null;
    this._gossip = null;
    this._connectedPeers = new Set();
    this._discoveredPeers = new Map(); // peerId -> { peerId, discoveredAt }

    // Subsystems
    this.cryptoManager = null;
    this._dht = null;
    this.distributedStorage = null;
    this._media = null;
    this._monitorInterval = null;
    this._selfPeerIds = new Set();

    // ConnectionManager stub for template compatibility
    this.connectionManager = this._makeConnectionManagerStub();

    // peerDiscovery stub
    this.peerDiscovery = { maxPeers: this._config.maxPeers, minPeers: this._config.minPeers };
  }

  _makeConnectionManagerStub() {
    const peersMap = new Map();
    const cm = {
      peers: peersMap,
      getAllConnections: () => Array.from(peersMap.values()),
    };
    return cm;
  }

  _stubConn(peerId) {
    return {
      peerId,
      getStatus: () => 'connected',
      dataChannelReady: true,
      allowRemoteStreamEmission: () => {},
      blockRemoteStreamEmission: () => {}
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  static createPeerId() {
    return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  }

  async init() {
    if (!this.peerId) {
      this.peerId = PeerPigeonMesh.createPeerId();
    }

    if (this.enableCrypto) {
      this.cryptoManager = new CryptoManager();
      await this.cryptoManager.generateKeypair();
      setTimeout(() => this._emit('cryptoReady', {}), 0);
    }

    // Set up media subsystem
    this._media = new MediaManager();
    this._media.addEventListener('localStreamStarted', (d) => this._emit('localStreamStarted', d));
    this._media.addEventListener('localStreamStopped', () => this._emit('localStreamStopped', {}));
    this._media.addEventListener('remoteStream', (d) => this._emit('remoteStream', d));
    this._media.addEventListener('remoteStreamEnded', (d) => this._emit('remoteStreamEnded', d));

    return this;
  }

  async connect(signalingUrl) {
    if (!signalingUrl) throw new Error('Signaling URL required');
    this.signalingUrl = signalingUrl;

    this._mesh = new PartialMesh({
      peerId: this.peerId,
      signalingServer: signalingUrl,
      sessionId: this._networkName,
      minPeers: this._config.minPeers,
      maxPeers: this._config.maxPeers,
      autoDiscover: this._config.autoDiscovery,
      autoConnect: this._config.autoConnect
    });

    this._gossip = new GossipProtocol(this._mesh, { maxHops: 5 });

    // Wire media manager
    this._media._sendFn = (peerId, data) => {
      try { this._mesh.send(peerId, data); } catch { /* peer may not be connected */ }
    };
    this._media._getConnectedFn = () => Array.from(this._connectedPeers);

    // Wire DHT
    if (this.enableWebDHT) {
      this._dht = new WebDHT((event, data) => this._emit(event, data));
      this._dht._broadcastFn = (data) => {
        try { this._gossip.broadcast(data); } catch { /* ignore */ }
      };
    }

    if (this.enableDistributedStorage && this._dht) {
      this.distributedStorage = new DistributedStorage(
        this._dht,
        (event, data) => this._emit(event, data)
      );
    }

    this._setupMeshHandlers();
    this._setupGossipHandlers();

    await this._mesh.init();
    return this;
  }

  _setupMeshHandlers() {
    this._mesh.on('signaling:connected', ({ clientId, rawClientId }) => {
      this.peerId = String(clientId || rawClientId || this.peerId || '').trim() || this.peerId;
      this._selfPeerIds.clear();
      if (this.peerId) this._selfPeerIds.add(String(this.peerId));
      if (clientId) this._selfPeerIds.add(String(clientId));
      if (rawClientId) this._selfPeerIds.add(String(rawClientId));
      this.connected = true;
      this.startTime = Date.now();
      this._emit('statusChanged', { type: 'connected', message: 'Connected to signaling server' });
    });

    this._mesh.on('signaling:disconnected', () => {
      this.connected = false;
      this._emit('statusChanged', { type: 'disconnected', message: 'Disconnected from signaling server' });
    });

    this._mesh.on('signaling:error', (error) => {
      this._emit('statusChanged', { type: 'error', message: String(error?.message || error) });
    });

    this._mesh.on('peer:error', ({ peerId, error }) => {
      this._emit('statusChanged', {
        type: 'peer-error',
        peerId,
        message: String(error?.message || error || 'Unknown peer error')
      });
    });

    this._mesh.on('peer:connected', (peerId) => {
      this._connectedPeers.add(peerId);
      this.connectionManager.peers.set(peerId, this._stubConn(peerId));
      this._emit('peerConnected', { peerId });

      // Auto-exchange crypto keys
      if (this.enableCrypto && this.cryptoManager) {
        this._sendKeyExchange(peerId).catch(() => {});
      }
    });

    this._mesh.on('peer:disconnected', (peerId) => {
      this._connectedPeers.delete(peerId);
      this.connectionManager.peers.delete(peerId);
      this._media?.onPeerDisconnected(peerId);
      this._emit('peerDisconnected', { peerId, reason: 'disconnect' });
    });

    this._mesh.on('peer:discovered', (peerId) => {
      if (this._isSelfPeerId(peerId)) return;
      if (!this._discoveredPeers.has(peerId)) {
        this._discoveredPeers.set(peerId, { peerId, discoveredAt: Date.now() });
        this._emit('peerDiscovered', { peerId });
      }
      this._emit('statusChanged', {
        type: 'protocol-debug',
        message: `discovered=${this._mesh.getDiscoveredPeers().length} connected=${this._mesh.getConnectedPeers().length}`
      });
    });

    this._mesh.on('mesh:membership', (peerIds) => {
      for (const peerId of (peerIds || [])) {
        if (!peerId || this._isSelfPeerId(peerId)) continue;
        if (!this._discoveredPeers.has(peerId)) {
          this._discoveredPeers.set(peerId, { peerId, discoveredAt: Date.now() });
          this._emit('peerDiscovered', { peerId });
        }
      }
      this._emit('statusChanged', {
        type: 'protocol-membership',
        message: `globalPeers=${(peerIds || []).length} discovered=${this._mesh.getDiscoveredPeers().length} connected=${this._mesh.getConnectedPeers().length}`
      });
    });

    // Handle direct messages sent via mesh.send() (for media signaling, key exchange)
    this._mesh.on('peer:data', ({ peerId, data }) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!parsed || typeof parsed !== 'object') return;

        const t = parsed.type;

        // Key exchange
        if (t === 'key_exchange') {
          this._handleKeyExchange(peerId, parsed);
          return;
        }

        // Media signaling
        if (['media-offer', 'media-answer', 'media-ice', 'media-stop'].includes(t)) {
          this._media?.handleSignaling(peerId, parsed);
          return;
        }

        // Direct app message (non-gossip)
        if (t === 'direct') {
          this._emit('messageReceived', {
            from: parsed.from || peerId,
            message: parsed.message,
            messageId: parsed.id || crypto.randomUUID(),
            subtype: 'direct',
            direct: true,
            encrypted: false
          });
          return;
        }

        // Direct encrypted message
        if (t === 'direct_encrypted') {
          this._handleEncryptedDirect(peerId, parsed);
          return;
        }
      } catch { /* ignore parse errors */ }
    });

    this._mesh.on('mesh:ready', () => {
      this._emit('statusChanged', { type: 'mesh-ready', message: 'Mesh is ready' });
    });
  }

  _isSelfPeerId(peerId) {
    if (!peerId) return true;
    const normalized = String(peerId).trim();
    if (!normalized) return true;
    if (this.peerId && normalized === String(this.peerId)) return true;
    if (this._selfPeerIds.has(normalized)) return true;
    return false;
  }

  _setupGossipHandlers() {
    this._gossip.on('messageReceived', ({ message, local }) => {
      if (local) return; // we sent it — don't double-display

      const content = message.data;

      // Filter DHT internal messages
      if (content && typeof content === 'object' && content.type === 'dht') {
        this._dht?._handleIncoming(message.sender, content);
        return;
      }

      // Filter key exchange sent via gossip (fallback)
      if (content && typeof content === 'object' && content.type === 'key_exchange') {
        this._handleKeyExchange(message.sender, content);
        return;
      }

      this._emit('messageReceived', {
        from: message.sender,
        message: content,
        messageId: message.id,
        subtype: 'broadcast',
        direct: false,
        encrypted: false
      });
    });

    this._gossip.on('directMessageReceived', ({ message }) => {
      if (message.to !== this.peerId) return;

      const content = message.data;
      this._emit('messageReceived', {
        from: message.from,
        message: content,
        messageId: message.id,
        subtype: 'direct',
        direct: true,
        encrypted: false
      });
    });
  }

  disconnect() {
    this.stopConnectionMonitoring();
    this._media?.stop().catch(() => {});
    if (this._mesh) {
      this._mesh.destroy();
      this._mesh = null;
    }
    if (this._gossip) {
      this._gossip.destroy();
      this._gossip = null;
    }
    this._connectedPeers.clear();
    this._discoveredPeers.clear();
    this._selfPeerIds.clear();
    this.connectionManager.peers.clear();
    this.connected = false;
    this.startTime = null;
    if (!this.peerId) {
      this.peerId = PeerPigeonMesh.createPeerId();
    }
    this._emit('statusChanged', { type: 'disconnected', message: 'Disconnected' });
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  sendMessage(message) {
    if (!this._gossip) return null;
    try {
      const id = this._gossip.broadcast(message);
      return id || crypto.randomUUID();
    } catch (e) {
      console.error('[PeerPigeon] sendMessage error', e);
      return null;
    }
  }

  sendDirectMessage(peerId, message) {
    if (!this._gossip) return null;
    try {
      const id = this._gossip.sendDirect(peerId, { type: 'direct', message, from: this.peerId });
      return id || crypto.randomUUID();
    } catch (e) {
      // Fallback to raw mesh.send if gossip routing fails
      try {
        const id = crypto.randomUUID();
        this._mesh.send(peerId, JSON.stringify({ type: 'direct', message, id, from: this.peerId }));
        return id;
      } catch { return null; }
    }
  }

  async sendEncryptedBroadcast(message, groupId = null) {
    if (!this._gossip) return null;
    const payload = { type: 'encrypted_broadcast', message, groupId, encrypted: true };
    const id = this._gossip.broadcast(payload);
    return id || crypto.randomUUID();
  }

  async sendEncryptedMessage(peerId, message) {
    if (!this._mesh || !this.cryptoManager) return null;
    const id = crypto.randomUUID();
    let payload;
    if (this.cryptoManager.peerKeys.has(peerId)) {
      const encrypted = await this.cryptoManager.encrypt(message, peerId);
      payload = { type: 'direct_encrypted', encrypted: true, data: encrypted, id, from: this.peerId };
    } else {
      payload = { type: 'direct', message, id, from: this.peerId };
    }
    try {
      this._mesh.send(peerId, JSON.stringify(payload));
    } catch {
      this._gossip?.sendDirect(peerId, payload);
    }
    return id;
  }

  // ── Crypto ─────────────────────────────────────────────────────────────────

  async _sendKeyExchange(peerId) {
    if (!this.cryptoManager) return;
    const publicKey = await this.cryptoManager.exportPublicKey();
    if (!publicKey) return;
    try {
      this._mesh.send(peerId, JSON.stringify({ type: 'key_exchange', publicKey, from: this.peerId }));
    } catch {
      this._gossip?.sendDirect(peerId, { type: 'key_exchange', publicKey, from: this.peerId });
    }
  }

  async exchangeKeysWithPeer(peerId) {
    return this._sendKeyExchange(peerId);
  }

  async _handleKeyExchange(peerId, data) {
    if (!this.cryptoManager || !data.publicKey) return;
    try {
      await this.cryptoManager.importPeerKey(peerId, data.publicKey);
      this._emit('peerKeyAdded', { peerId, publicKey: data.publicKey });
      // Respond with our own key if this was an incoming request
      if (data.from && data.from !== this.peerId && !this.cryptoManager.peerKeys.has(peerId + '_acked')) {
        this.cryptoManager.peerKeys.set(peerId + '_acked', true);
        await this._sendKeyExchange(peerId);
      }
    } catch (e) {
      console.error('[PeerPigeon] key exchange error', e);
    }
  }

  async _handleEncryptedDirect(peerId, parsed) {
    if (!this.cryptoManager) return;
    try {
      const decrypted = await this.cryptoManager.decrypt(parsed.data, peerId);
      this._emit('messageReceived', {
        from: parsed.from || peerId,
        message: decrypted,
        messageId: parsed.id || crypto.randomUUID(),
        subtype: 'direct',
        direct: true,
        encrypted: true
      });
    } catch (e) {
      console.error('[PeerPigeon] decrypt error', e);
    }
  }

  async addPeerKey(peerId, publicKey) {
    if (!this.cryptoManager) throw new Error('Crypto not enabled');
    await this.cryptoManager.importPeerKey(peerId, publicKey);
    this._emit('peerKeyAdded', { peerId, publicKey });
  }

  exportPublicKey() {
    return this.cryptoManager?.getPublicKey() || null;
  }

  // ── DHT ────────────────────────────────────────────────────────────────────

  async dhtPut(key, value, options) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.put(key, value, options);
  }

  async dhtGet(key) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.get(key);
  }

  async dhtUpdate(key, value) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.update(key, value);
  }

  async dhtDelete(key) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.delete(key);
  }

  async dhtSubscribe(key) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.subscribe(key);
  }

  async dhtUnsubscribe(key) {
    if (!this._dht) throw new Error('DHT not available — call connect() first');
    return this._dht.unsubscribe(key);
  }

  // ── Media ──────────────────────────────────────────────────────────────────

  async initializeMedia() {
    return this._media?.initialize();
  }

  async startMedia(options) {
    if (!this._media) throw new Error('Media not initialized');
    return this._media.start(options);
  }

  async stopMedia() {
    return this._media?.stop();
  }

  toggleVideo() {
    return this._media?.toggleVideo() ?? false;
  }

  toggleAudio() {
    return this._media?.toggleAudio() ?? false;
  }

  async enumerateMediaDevices() {
    return MediaManager.enumerateDevices();
  }

  getMediaState() {
    return this._media?.getState() ?? {
      hasStream: false, isVideoEnabled: false, isAudioEnabled: false,
      videoDeviceId: null, audioDeviceId: null
    };
  }

  // Selective streaming
  async startSelectiveStream(targetPeerIds, options) {
    if (!this._media) throw new Error('Media not initialized');
    this._media.targetPeers = new Set(targetPeerIds);
    this._media.streamingToAll = false;
    this._emit('selectiveStreamStarted', { targetPeerIds, streamType: targetPeerIds.length === 1 ? '1:1' : '1:many' });
    return this._media.start(options);
  }

  async stopSelectiveStream(returnToBroadcast = false) {
    if (!this._media) return;
    if (returnToBroadcast) {
      this._media.targetPeers = null;
      this._media.streamingToAll = true;
      this._emit('broadcastStreamEnabled', {});
    } else {
      await this._media.stop();
      this._emit('selectiveStreamStopped', { returnToBroadcast: false });
    }
  }

  async blockStreamingToPeers(peerIds) {
    if (!this._media) return;
    peerIds.forEach(id => this._media.blockedPeers.add(id));
    this._emit('streamingBlockedToPeers', { blockedPeerIds: peerIds });
  }

  async allowStreamingToPeers(peerIds) {
    if (!this._media) return;
    peerIds.forEach(id => this._media.blockedPeers.delete(id));
    this._emit('streamingAllowedToPeers', { allowedPeerIds: peerIds });
  }

  getStreamingPeers() {
    if (!this._media) return [];
    return Array.from(this._connectedPeers).filter(id =>
      !this._media.blockedPeers.has(id) &&
      (this._media.streamingToAll || this._media.targetPeers?.has(id))
    );
  }

  getBlockedStreamingPeers() {
    return this._media ? Array.from(this._media.blockedPeers) : [];
  }

  isStreamingToAll() {
    return this._media?.streamingToAll ?? true;
  }

  // ── Network Info ──────────────────────────────────────────────────────────

  getStatus() {
    return {
      connected: this.connected,
      connectedCount: this._connectedPeers.size,
      discoveredCount: this._discoveredPeers.size,
      maxPeers: this._config.maxPeers,
      minPeers: this._config.minPeers,
      autoDiscovery: this._config.autoDiscovery,
      evictionStrategy: this._config.evictionStrategy,
      xorRouting: this._config.xorRouting,
      signalingUrl: this.signalingUrl,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  getDiscoveredPeers() {
    return Array.from(this._discoveredPeers.values());
  }

  canAcceptMorePeers() {
    return this._connectedPeers.size < this._config.maxPeers;
  }

  getPeerStateSummary() {
    const states = {};
    for (const id of this._connectedPeers) states[id] = 'connected';
    return {
      total: this._connectedPeers.size,
      connected: this._connectedPeers.size,
      connecting: 0,
      failed: 0,
      states
    };
  }

  forceConnectToAllPeers() {
    if (!this._mesh) return 0;
    let count = 0;
    for (const peerId of this._mesh.getDiscoveredPeers()) {
      if (!this._connectedPeers.has(peerId) && !this._isSelfPeerId(peerId)) {
        try { this._mesh.connectToPeer(peerId); count++; } catch { /* ignore */ }
      }
    }
    return count;
  }

  async connectToPeer(peerId) {
    if (!this._mesh) throw new Error('Not connected to signaling server');
    if (!peerId || typeof peerId !== 'string') throw new Error('Peer ID is required');
    if (this._isSelfPeerId(peerId)) throw new Error('Cannot connect to self');
    if (this._connectedPeers.has(peerId)) return false;
    this._mesh.connectToPeer(peerId);
    return true;
  }

  async cleanupStaleSignalingData() {
    // PartialMesh manages this internally; re-join the session to refresh
    this._mesh?.hardReset('cleanup');
  }

  debugConnectivity() {
    console.log('[PeerPigeon] Connectivity debug:', {
      connected: this.connected,
      peerId: this.peerId,
      connectedPeers: Array.from(this._connectedPeers),
      discoveredPeers: Array.from(this._discoveredPeers.keys()),
      networkName: this._networkName,
      config: this._config
    });
  }

  // ── Network Settings ──────────────────────────────────────────────────────

  setNetworkName(name) {
    this._networkName = name || 'global';
    this._emit('statusChanged', { type: 'setting', setting: 'networkName', value: this._networkName });
  }

  getNetworkName() { return this._networkName; }
  getOriginalNetworkName() { return this._networkName; }

  setAllowGlobalFallback(allow) {
    this._allowGlobalFallback = allow;
    this._emit('statusChanged', { type: 'setting', setting: 'allowGlobalFallback', value: allow });
  }

  isUsingGlobalFallback() { return false; }

  // ── Config Setters ────────────────────────────────────────────────────────

  setMaxPeers(n) { this._config.maxPeers = n; }
  setMinPeers(n) { this._config.minPeers = n; }
  setAutoConnect(v) { this._config.autoConnect = v; }
  setAutoDiscovery(v) { this._config.autoDiscovery = v; }
  setEvictionStrategy(v) { this._config.evictionStrategy = v; }
  setXorRouting(v) { this._config.xorRouting = v; }

  // ── Connection Monitoring ─────────────────────────────────────────────────

  startConnectionMonitoring() {
    if (this._monitorInterval) return;
    this._monitorInterval = setInterval(() => {
      this._emit('connectionStats', {
        bytesReceived: 0, bytesSent: 0, packetsLost: 0, roundTripTime: 0,
        connectedPeers: this._connectedPeers.size
      });
    }, 2000);
  }

  stopConnectionMonitoring() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }

  // ── Static Utils ──────────────────────────────────────────────────────────

  static validatePeerId(peerId) {
    // Accept UUID format (from PartialMesh)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(peerId)) return true;
    // Accept 40-char hex (original peerpigeon format)
    if (/^[0-9a-f]{40}$/.test(peerId)) return true;
    return false;
  }
}

export default PeerPigeonMesh;
