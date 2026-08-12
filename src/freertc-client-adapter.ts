import { createSignalingClient } from 'freertc/client';

type Handler = (...args: any[]) => void;

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
  private readonly signalUrl: string;
  private readonly networkId: string;
  private readonly roomId: string;
  private readonly requestedPeerId: string;
  private readonly previousPeerId: string | null;
  private readonly retiredPeerIds: string[];
  private readonly defaultIceServers: RTCIceServer[] | null;
  private readonly emitter = new Emitter();
  private readonly knownPeers = new Set<string>();
  private readonly selfAliases = new Set<string>();
  private readonly connectedPeers = new Set<string>();
  private readonly openChannelTimers = new Map<string, ReturnType<typeof setInterval>>();
  private client: any = null;
  private joinedOnce = false;
  private intentionallyDisconnected = false;
  private signalingConnected = false;

  constructor(signalUrl: string, options?: {
    networkId?: string;
    roomId?: string;
    peerId?: string;
    previousPeerId?: string | null;
    retiredPeerIds?: string[];
    iceServers?: RTCIceServer[] | null;
    trickleIce?: boolean;
  }) {
    this.signalUrl = signalUrl;
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

  connect(): void {
    this.intentionallyDisconnected = false;
    if (this.client) {
      this.client.connect?.();
      return;
    }

    // Best effort cleanup for identities used by this tab before a hard reload.
    // The current FreeRTC client handles withdrawal of the active identity.
    this.withdrawRetiredPeerIds();

    this.client = createSignalingClient({
      peerId: this.requestedPeerId,
      networkId: this.networkId,
      roomId: this.roomId,
      signalUrl: this.signalUrl,
      iceServers: this.defaultIceServers ?? undefined,
      autoConnect: false,
      onLog: (message: string) => {
        this.emitter.emit('signaling:log', { message: String(message ?? '') });
      },
      onRegistered: () => {
        this.signalingConnected = true;
        this.emitter.emit('connected', {
          clientId: this.requestedPeerId,
          requestedClientId: this.requestedPeerId,
          previousClientId: this.previousPeerId
        });
        this.client?.requestBootstrap?.(Array.from(this.selfAliases));
      },
      onBootstrap: (candidates: any[]) => {
        this.handleBootstrapCandidates(candidates);
      },
      onConnectionStateChange: (data: { peerId?: string; state?: string }) => {
        this.handleConnectionState(data);
      },
      onDataMessage: (data: { peerId: string; data: any }) => {
        const peerId = this.normalizePeerId(data?.peerId);
        if (!peerId || this.isSelfAlias(peerId)) return;
        this.emitter.emit('rtc:data', { peerId, data: data.data });
      },
      onNegotiationFailure: (data: { peerId?: string; reason?: string }) => {
        this.emitter.emit('signaling:log', {
          message: `[webrtc] ${this.normalizePeerId(data?.peerId)} negotiation failed: ${String(data?.reason ?? 'unknown')}`
        });
      },
      onStatusChange: (status: string) => {
        if (!String(status).startsWith('disconnected')) return;
        const wasConnected = this.signalingConnected;
        this.signalingConnected = false;
        if (wasConnected && !this.intentionallyDisconnected) {
          this.emitter.emit('disconnected');
        }
      }
    });

    this.client.connect();
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    this.signalingConnected = false;
    this.clearOpenChannelTimers();
    try { this.client?.disconnect?.(); } catch { /* best effort */ }
    this.client = null;
    this.connectedPeers.clear();
    this.knownPeers.clear();
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

  closeConnection(peerId: string): void {
    const id = this.normalizePeerId(peerId);
    if (!id) return;
    this.clearOpenChannelTimer(id);
    const entry = this.client?.mesh?.connections?.get?.(id);
    try { entry?.channel?.close?.(); } catch { /* best effort */ }
    try { entry?.connection?.close?.(); } catch { /* best effort */ }
    this.client?.mesh?.connections?.delete?.(id);
    if (this.connectedPeers.delete(id)) {
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
    const nextPeers = new Set<string>(
      (Array.isArray(candidates) ? candidates : [])
        .map((candidate) => this.normalizePeerId(candidate?.peerId))
        .filter((peerId) => peerId && !this.isSelfAlias(peerId))
    );
    const peerList = Array.from(nextPeers);

    if (!this.joinedOnce) {
      this.joinedOnce = true;
      this.emitter.emit('joined', { sessionId: this.roomId, clients: peerList });
    }
    for (const peerId of peerList) {
      if (!this.knownPeers.has(peerId)) this.emitter.emit('peer-joined', { peerId });
    }
    for (const peerId of this.knownPeers) {
      if (!nextPeers.has(peerId)) this.emitter.emit('peer-left', { peerId });
    }

    this.knownPeers.clear();
    for (const peerId of nextPeers) this.knownPeers.add(peerId);
    this.emitter.emit('peers-updated', { peers: peerList });
  }

  private handleConnectionState(data: { peerId?: string; state?: string }): void {
    const peerId = this.normalizePeerId(data?.peerId);
    const state = String(data?.state ?? '').toLowerCase();
    if (!peerId || this.isSelfAlias(peerId)) {
      if (peerId) this.closeConnection(peerId);
      return;
    }

    if (state === 'connected') {
      this.waitForOpenDataChannel(peerId);
      return;
    }
    if (state === 'failed' || state === 'closed') {
      this.clearOpenChannelTimer(peerId);
      if (this.connectedPeers.delete(peerId)) {
        this.emitter.emit('rtc:disconnected', { peerId });
      }
    }
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
      if (!entry || entry?.connection?.connectionState === 'failed' || entry?.connection?.connectionState === 'closed' || Date.now() - startedAt > 15_000) {
        this.clearOpenChannelTimer(peerId);
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

  private withdrawRetiredPeerIds(): void {
    for (const peerId of this.retiredPeerIds) {
      let socket: WebSocket | null = null;
      const timeout = setTimeout(() => {
        try { socket?.close(); } catch { /* best effort */ }
      }, 3_000);
      try {
        const url = new URL(this.signalUrl, typeof location !== 'undefined' ? location.href : undefined);
        url.searchParams.set('networkId', this.networkId);
        url.searchParams.set('room', this.roomId);
        socket = new WebSocket(url.toString());
        socket.onopen = () => {
          socket?.send(JSON.stringify({
            psp_version: '1.0',
            type: 'withdraw',
            network: this.networkId,
            from: peerId,
            to: null,
            session_id: this.roomId,
            message_id: generateMessageId(),
            timestamp: Date.now(),
            ttl_ms: null,
            body: { reason: 'identity_replaced' }
          }));
          setTimeout(() => {
            clearTimeout(timeout);
            try { socket?.close(1000, 'identity_replaced'); } catch { /* best effort */ }
          }, 100);
        };
        socket.onerror = () => clearTimeout(timeout);
      } catch {
        clearTimeout(timeout);
      }
    }
  }
}

export default FreeRTCClientAdapter;
