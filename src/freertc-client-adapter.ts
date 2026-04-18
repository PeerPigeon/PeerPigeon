import { RtcPeer } from './rtc-peer.js';

type Handler = (...args: any[]) => void;

function generatePeerId(): string {
  const bytes = new Uint8Array(32);
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
        // ignore listener errors
      }
    }
  }
}

export class FreeRTCClientAdapter {
  private readonly signalUrl: string;
  private readonly networkId: string;
  private readonly requestedPeerId: string;
  private readonly defaultIceServers: RTCIceServer[] | null;
  private readonly defaultTrickleIce: boolean;
  private readonly emitter = new Emitter();
  private readonly knownPeers = new Set<string>();
  private readonly pendingCandidates = new Map<string, any[]>();
  private readonly offerQueues = new Map<string, Promise<void>>();
  private readonly lastRemoteOfferSdp = new Map<string, string>();
  private readonly lastAppliedAnswerSdp = new Map<string, string>();
  private readonly selfAliases = new Set<string>();
  private readonly peerEntries = new Map<string, any>();
  private client: any = null;
  private joinedOnce = false;
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectBackoffMs = 1_000;
  private intentionallyDisconnected = false;

  constructor(signalUrl: string, options?: { networkId?: string; peerId?: string; iceServers?: RTCIceServer[] | null; trickleIce?: boolean }) {
    this.signalUrl = signalUrl;
    this.networkId = options?.networkId ?? 'default-session';
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

  on(event: string, handler: Handler): void {
    this.emitter.on(event, handler);
  }

  connect(): void {
    this.intentionallyDisconnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = new URL(this.signalUrl, typeof location !== 'undefined' ? location.href : undefined);
    if (!wsUrl.searchParams.get('networkId')) {
      wsUrl.searchParams.set('networkId', this.networkId);
    }

    this.socket = new WebSocket(wsUrl.toString());
    this.socket.onopen = () => {
      this.reconnectBackoffMs = 1_000;
      this.emitter.emit('signaling:log', { message: '[signal] connected' });
      this.sendEnvelope('announce', {
        ttl_ms: 30_000,
        body: { hints: { wants_peers: true } }
      });
      this.startPingLoop();
      this.startAnnounceLoop();
      this.emitter.emit('connected', {
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
      this.emitter.emit('disconnected');
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.emitter.emit('error', new Error('WebSocket error'));
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionallyDisconnected) return;
    if (this.reconnectTimer) return;

    const delay = this.reconnectBackoffMs;
    this.reconnectBackoffMs = Math.min(15_000, Math.floor(this.reconnectBackoffMs * 1.5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private normalizePeerId(peerId: string | null | undefined): string {
    return String(peerId ?? '').trim();
  }

  private addSelfAlias(peerId: string | null | undefined): void {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.selfAliases.add(id);
  }

  private isSelfAlias(peerId: string | null | undefined): boolean {
    const id = this.normalizePeerId(peerId);
    if (!id) return false;
    return this.selfAliases.has(id);
  }

  private startPingLoop(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      this.sendEnvelope('ping', { body: { nonce: generatePeerId().slice(0, 16) } });
    }, 1_000);
  }

  private startAnnounceLoop(): void {
    if (this.announceTimer) return;
    this.announceTimer = setInterval(() => {
      this.sendEnvelope('announce', {
        ttl_ms: 30_000,
        body: { hints: { wants_peers: true } }
      });
    }, 12_000);
  }

  private stopLoops(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
  }

  private sendEnvelope(type: string, options: { to?: string | null; body?: any; ttl_ms?: number | null; session_id?: string | null } = {}): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({
      psp_version: '1.0',
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

  private handleSocketMessage(raw: any): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message?.type) {
      case 'peer_list': {
        const peers = Array.isArray(message?.body?.peers) ? message.body.peers : [];
        const nextPeers = new Set(
          peers
            .map((peer: any) => this.normalizePeerId(peer?.peer_id))
            .filter((peerId: string) => peerId && !this.isSelfAlias(peerId))
        );

        const peerList = Array.from(nextPeers);
        if (!this.joinedOnce) {
          this.joinedOnce = true;
          this.emitter.emit('joined', { sessionId: this.networkId, clients: peerList });
        }

        for (const peerId of peerList) {
          if (!this.knownPeers.has(peerId)) {
            this.emitter.emit('peer-joined', { peerId });
          }
        }

        for (const peerId of this.knownPeers) {
          if (!nextPeers.has(peerId)) {
            this.emitter.emit('peer-left', { peerId });
          }
        }

        this.knownPeers.clear();
        for (const peerId of nextPeers) {
          this.knownPeers.add(peerId);
        }
        return;
      }
      case 'offer':
        this.enqueueIncomingOffer(this.normalizePeerId(message?.from), message?.body);
        return;
      case 'answer':
        this.handleSignal(this.normalizePeerId(message?.from), { type: 'answer', sdp: message?.body?.sdp }).catch((error) => {
          this.emitter.emit('signaling:log', { message: `[webrtc] answer handling error: ${String((error as any)?.message ?? error ?? '')}` });
        });
        return;
      case 'ice_candidate': {
        const candidate = this.normalizeCandidate(message?.body?.candidate);
        if (!candidate) {
          return;
        }
        this.handleSignal(this.normalizePeerId(message?.from), { candidate }).catch((error) => {
          this.emitter.emit('signaling:log', { message: `[webrtc] candidate handling error: ${String((error as any)?.message ?? error ?? '')}` });
        });
        return;
      }
      case 'bye':
        this.closeConnection(this.normalizePeerId(message?.from));
        return;
      case 'pong':
        return;
      case 'error':
        this.emitter.emit('signaling:log', { message: `[signal] error: ${String(message?.body?.error ?? '')}` });
        return;
      default:
        return;
    }
  }

  private normalizeCandidate(candidate: any): RTCIceCandidateInit | null {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const candidateText = String(candidate.candidate ?? '').trim();
    if (!candidateText) {
      // Ignore malformed/end-of-candidates messages in this path.
      return null;
    }

    return {
      candidate: candidateText,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null,
      usernameFragment: candidate.usernameFragment
    };
  }

  private attachPeer(peerId: string, peer: RtcPeer, initiator: boolean): void {
    const entry: any = {
      peer,
      initiator,
      trickleIce: this.defaultTrickleIce,
      connected: false,
      state: 'connecting',
      connection: (peer as any).pc,
      channel: (peer as any).dc ?? null
    };
    this.peerEntries.set(peerId, entry);

    peer.on('signal', (signal: any) => {
      entry.connection = (peer as any).pc;
      entry.channel = (peer as any).dc ?? null;
      if (signal?.type === 'offer' || signal?.type === 'answer') {
        this.sendEnvelope(signal.type, {
          to: peerId,
          body: { sdp: signal.sdp, trickle_ice: entry.trickleIce }
        });
      } else if (signal?.candidate) {
        this.sendEnvelope('ice_candidate', {
          to: peerId,
          body: { candidate: signal.candidate }
        });
      }
    });

    peer.on('connect', () => {
      const current = this.peerEntries.get(peerId);
      if (!current || current.connected) return;
      current.connected = true;
      current.state = 'connected';
      current.connection = (peer as any).pc;
      current.channel = (peer as any).dc ?? null;
      this.emitter.emit('rtc:connected', { peerId });
    });

    peer.on('debug', (snapshot) => {
      const current = this.peerEntries.get(peerId);
      if (current) {
        current.connection = (peer as any).pc;
        current.channel = (peer as any).dc ?? null;
        current.state = snapshot.connectionState;
      }
      this.emitter.emit('signaling:log', {
        message: `[webrtc] ${peerId} ${snapshot.reason} signaling=${snapshot.signalingState} ice=${snapshot.iceConnectionState} pc=${snapshot.connectionState} dc=${snapshot.dataChannelState}`
      });
    });

    peer.on('data', (data: any) => {
      this.emitter.emit('rtc:data', { peerId, data });
    });

    peer.on('close', () => {
      const current = this.peerEntries.get(peerId);
      if (!current) return;
      this.peerEntries.delete(peerId);
      this.pendingCandidates.delete(peerId);
      this.emitter.emit('rtc:disconnected', { peerId });
    });

    peer.on('error', (error: any) => {
      this.emitter.emit('signaling:log', { message: `[webrtc] ${peerId} error: ${String(error?.message ?? error ?? '')}` });
    });
  }

  private async handleIncomingOffer(peerId: string, body: any): Promise<void> {
    if (!peerId) return;
    const incomingOfferSdp = String(body?.sdp ?? '');
    if (!incomingOfferSdp) return;

    let entry = this.peerEntries.get(peerId);
    if (!entry) {
      const trickleIce = body?.trickle_ice ?? this.defaultTrickleIce;
      const peer = new RtcPeer({
        initiator: false,
        trickleIce,
        config: this.defaultIceServers ? { iceServers: this.defaultIceServers } : undefined
      });
      this.attachPeer(peerId, peer, false);
      entry = this.peerEntries.get(peerId);
      if (entry) {
        entry.trickleIce = trickleIce;
      }
    }

    const pc = entry?.connection as RTCPeerConnection | undefined;
    if (entry?.connected) {
      return;
    }

    const lastSdp = this.lastRemoteOfferSdp.get(peerId);
    if (lastSdp && lastSdp === incomingOfferSdp) {
      return;
    }

    if (
      pc?.signalingState === 'have-remote-offer' ||
      pc?.remoteDescription?.sdp === incomingOfferSdp ||
      (pc?.signalingState === 'stable' && !!pc?.remoteDescription)
    ) {
      return;
    }

    await entry.peer.signal({ type: 'offer', sdp: incomingOfferSdp });
    this.lastRemoteOfferSdp.set(peerId, incomingOfferSdp);
    await this.flushPendingCandidates(peerId);
  }

  private enqueueIncomingOffer(peerId: string, body: any): void {
    if (!peerId) return;

    const prior = this.offerQueues.get(peerId) ?? Promise.resolve();
    const next = prior
      .then(async () => {
        await this.handleIncomingOffer(peerId, body);
      })
      .catch(() => {
        // Keep queue alive on per-offer failures.
      });

    this.offerQueues.set(peerId, next);
  }

  private async handleSignal(peerId: string, signal: any): Promise<void> {
    const entry = this.peerEntries.get(peerId);
    if (!entry) {
      if (signal?.candidate) {
        const queued = this.pendingCandidates.get(peerId) ?? [];
        queued.push(signal);
        this.pendingCandidates.set(peerId, queued);
      }
      return;
    }

    const pc = entry.connection as RTCPeerConnection | undefined;

    if (signal?.candidate) {
      if (!pc?.remoteDescription) {
        const queued = this.pendingCandidates.get(peerId) ?? [];
        queued.push(signal);
        this.pendingCandidates.set(peerId, queued);
        return;
      }
    }

    if (signal?.type === 'answer') {
      const answerSdp = String(signal?.sdp ?? '');
      const lastAnswer = this.lastAppliedAnswerSdp.get(peerId);
      if (!pc || pc.signalingState === 'stable' || pc.remoteDescription?.type === 'answer') {
        return;
      }
      if (answerSdp && lastAnswer && lastAnswer === answerSdp) {
        return;
      }
    }

    try {
      await entry.peer.signal(signal);
      if (signal?.type === 'answer') {
        if (signal?.sdp) {
          this.lastAppliedAnswerSdp.set(peerId, String(signal.sdp));
        }
        await this.flushPendingCandidates(peerId);
      }
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '');
      if (/wrong state|remote description was null|expected candidate got/i.test(message)) {
        return;
      }
      throw error;
    }
  }

  private async flushPendingCandidates(peerId: string): Promise<void> {
    const entry = this.peerEntries.get(peerId);
    if (!entry?.connection?.remoteDescription) return;

    const queued = this.pendingCandidates.get(peerId) ?? [];
    this.pendingCandidates.delete(peerId);
    for (const candidate of queued) {
      try {
        await entry.peer.signal(candidate);
      } catch {
        // ignore stale candidate failures
      }
    }
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopLoops();
    if (this.socket) {
      try {
        this.socket.close(1000, 'user_disconnect');
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.closeAllPeerEntries();
    this.joinedOnce = false;
    this.knownPeers.clear();
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  private closeAllPeerEntries(): void {
    const entries = Array.from(this.peerEntries.entries());
    for (const [peerId, entry] of entries) {
      this.peerEntries.delete(peerId);
      this.pendingCandidates.delete(peerId);
      this.offerQueues.delete(peerId);
      this.lastRemoteOfferSdp.delete(peerId);
      this.lastAppliedAnswerSdp.delete(peerId);
      try { entry.peer?.destroy?.(); } catch { /* ignore */ }
      this.emitter.emit('rtc:disconnected', { peerId });
    }
  }

  joinSession(sessionId: string): void {
    if (sessionId && sessionId !== this.networkId) {
      this.emitter.emit('error', new Error('FreeRTC adapter does not support changing networkId after initialization'));
      return;
    }
    this.sendEnvelope('discover', {
      body: { exclude_peers: [], limit: 50 }
    });
  }

  async initiateConnection(peerId: string, iceServers?: RTCIceServer[] | null, trickleIce?: boolean): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    this.closeConnection(peerId);
    const resolvedTrickleIce = trickleIce ?? this.defaultTrickleIce;
    const peer = new RtcPeer({
      initiator: true,
      trickleIce: resolvedTrickleIce,
      config: (iceServers ?? this.defaultIceServers) ? { iceServers: iceServers ?? this.defaultIceServers ?? undefined } : undefined
    });
    this.attachPeer(peerId, peer, true);
    const entry = this.peerEntries.get(peerId);
    if (entry) {
      entry.trickleIce = resolvedTrickleIce;
    }
  }

  nudgeSignaling(): void {
    this.sendEnvelope('announce', {
      ttl_ms: 30_000,
      body: { hints: { wants_peers: true } }
    });
    this.joinSession(this.networkId);
  }

  closeConnection(peerId: string): void {
    const entry = this.peerEntries.get(peerId);
    if (!entry) return;
    this.peerEntries.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.offerQueues.delete(peerId);
    this.lastRemoteOfferSdp.delete(peerId);
    this.lastAppliedAnswerSdp.delete(peerId);
    try { entry.peer?.destroy?.(); } catch { /* ignore */ }
  }

  send(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void {
    const entry = this.peerEntries.get(peerId);
    if (!entry?.connected) {
      throw new Error('WebRTC not yet connected');
    }
    entry.peer.send(data);
  }

  broadcast(data: string | ArrayBuffer | ArrayBufferView): void {
    for (const [, entry] of this.peerEntries.entries()) {
      if (!entry?.connected) continue;
      try {
        entry.peer.send(data);
      } catch {
        // ignore individual send errors
      }
    }
  }
}

export default FreeRTCClientAdapter;
