import { decryptMessageWithMeta, encryptMessageWithMeta, generateRandomPair } from 'unsea';
import type { DirectMessage, GossipBroadcastOptions, GossipMessage } from './gossip.js';

export const CRYPTO_PUBLIC_INFO_TYPE = 'pp-crypto-public-info-v1';
export const CRYPTO_PUBLIC_REQUEST_TYPE = 'pp-crypto-public-request-v1';
export const ENCRYPTED_BROADCAST_TYPE = 'pp-encrypted-broadcast-v1';
export const ENCRYPTED_DIRECT_TYPE = 'pp-encrypted-direct-v1';

export type PeerPigeonKeyPair = {
  pub: string;
  priv: string;
  epub: string;
  epriv: string;
};

export type PeerPublicKey = {
  peerId: string;
  pub: string;
  epub: string;
  updatedAt: number;
  local: boolean;
};

export type RoomCipher = {
  alg: 'A256GCM';
  iv: string;
  ct: string;
};

export type EncryptedBroadcastPayload = {
  __ppType: typeof ENCRYPTED_BROADCAST_TYPE;
  from: string;
  roomCipher: RoomCipher;
  timestamp: number;
};

export type EncryptedDirectPayload = {
  __ppType: typeof ENCRYPTED_DIRECT_TYPE;
  from: string;
  to: string;
  cipher: unknown;
  timestamp: number;
};

export type PeerPigeonCryptoOptions = {
  /** Room scope mixed into the AES-GCM room key. */
  roomId: string;
  /** Optional shared secret mixed into the room key. */
  roomSecret?: string;
  /** Supply an identity instead of generating/loading a tab-scoped identity. */
  keyPair?: PeerPigeonKeyPair;
  /** Persist generated keys in sessionStorage when available. Default true. */
  persistKeyPair?: boolean;
  /** sessionStorage key prefix. */
  storageKey?: string;
  /** Key advertisement interval. Default 10 seconds; 0 disables it. */
  announceIntervalMs?: number;
  /** Default wait for direct-message key discovery. Default 8 seconds. */
  keyDiscoveryTimeoutMs?: number;
};

export type PeerPigeonCryptoEvents = {
  keyDiscovered: (key: PeerPublicKey) => void;
  encryptedBroadcastReceived: (data: {
    plaintext: string;
    payload: EncryptedBroadcastPayload;
    message: GossipMessage;
    local: boolean;
    fromPeer?: string;
  }) => void;
  encryptedDirectReceived: (data: {
    plaintext: string;
    payload: EncryptedDirectPayload;
    message: DirectMessage;
  }) => void;
  error: (error: Error) => void;
};

interface CryptoMeshLike {
  on(event: 'peer:connected', handler: (peerId: string) => void): void;
  on(event: 'signaling:connected', handler: (data: { clientId: string }) => void): void;
  off(event: 'peer:connected', handler: (peerId: string) => void): void;
  off(event: 'signaling:connected', handler: (data: { clientId: string }) => void): void;
  getClientId(): string | null;
  getConnectedPeers(): string[];
}

interface CryptoGossipLike {
  broadcast(data: unknown, metadata?: Record<string, unknown>, options?: GossipBroadcastOptions): string;
  broadcastReliable(data: unknown, metadata?: Record<string, unknown>, options?: Omit<GossipBroadcastOptions, 'trackDelivery'>): string;
  sendDirect(targetPeerId: string, data: unknown): string | null;
  on(event: 'messageReceived', callback: (data: { message: GossipMessage; local: boolean; fromPeer?: string }) => void): void;
  on(event: 'directMessageReceived', callback: (data: { message: DirectMessage }) => void): void;
  off(event: 'messageReceived', callback: (data: { message: GossipMessage; local: boolean; fromPeer?: string }) => void): void;
  off(event: 'directMessageReceived', callback: (data: { message: DirectMessage }) => void): void;
}

type CryptoPublicInfoPayload = {
  __ppType: typeof CRYPTO_PUBLIC_INFO_TYPE;
  from: string;
  pub: string;
  epub: string;
  timestamp: number;
};

type CryptoPublicRequestPayload = {
  __ppType: typeof CRYPTO_PUBLIC_REQUEST_TYPE;
  from: string;
  to: string;
  timestamp: number;
};

export class PeerPigeonCryptoProtocol {
  private readonly mesh: CryptoMeshLike;
  private readonly gossip: CryptoGossipLike;
  private readonly options: Required<Omit<PeerPigeonCryptoOptions, 'keyPair'>> & { keyPair?: PeerPigeonKeyPair };
  private keyPair: PeerPigeonKeyPair | null = null;
  private readonly publicKeys = new Map<string, PeerPublicKey>();
  private readonly callbacks: Partial<Record<keyof PeerPigeonCryptoEvents, Set<Function>>> = {};
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  private readonly onGossipMessageBound = (data: { message: GossipMessage; local: boolean; fromPeer?: string }): void => {
    this.handleGossipMessage(data).catch((error) => this.emitError(error));
  };
  private readonly onDirectMessageBound = (data: { message: DirectMessage }): void => {
    this.handleDirectMessage(data.message).catch((error) => this.emitError(error));
  };
  private readonly onPeerConnectedBound = (peerId: string): void => {
    this.sendPublicInfoDirect(peerId);
    if (!this.publicKeys.has(peerId)) this.requestPeerKey(peerId);
  };
  private readonly onSignalingConnectedBound = (): void => {
    this.registerLocalKey();
    this.announcePublicKey();
  };

  constructor(mesh: CryptoMeshLike, gossip: CryptoGossipLike, options: PeerPigeonCryptoOptions) {
    const roomId = String(options.roomId ?? '').trim();
    if (!roomId) throw new Error('PeerPigeonCryptoProtocol requires a non-empty roomId');
    this.mesh = mesh;
    this.gossip = gossip;
    this.options = {
      roomId,
      roomSecret: String(options.roomSecret ?? ''),
      keyPair: options.keyPair,
      persistKeyPair: options.persistKeyPair ?? true,
      storageKey: String(options.storageKey ?? 'peerpigeon:crypto-keys:v1'),
      announceIntervalMs: options.announceIntervalMs ?? 10_000,
      keyDiscoveryTimeoutMs: options.keyDiscoveryTimeoutMs ?? 8_000,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.keyPair = this.options.keyPair ?? this.loadStoredKeyPair() ?? await generateRandomPair();
    this.validateKeyPair(this.keyPair);
    this.persistKeyPair(this.keyPair);
    this.initialized = true;
    this.gossip.on('messageReceived', this.onGossipMessageBound);
    this.gossip.on('directMessageReceived', this.onDirectMessageBound);
    this.mesh.on('peer:connected', this.onPeerConnectedBound);
    this.mesh.on('signaling:connected', this.onSignalingConnectedBound);
    this.registerLocalKey();
    this.announcePublicKey();
    if (this.options.announceIntervalMs > 0) {
      this.announceTimer = setInterval(() => this.announcePublicKey(), this.options.announceIntervalMs);
    }
  }

  getKeyPair(): Readonly<PeerPigeonKeyPair> {
    if (!this.keyPair) throw new Error('Crypto protocol has not been initialized');
    return { ...this.keyPair };
  }

  getPublicKey(peerId: string): PeerPublicKey | null {
    const value = this.publicKeys.get(String(peerId ?? '').trim());
    return value ? { ...value } : null;
  }

  getKnownPeerKeys(): PeerPublicKey[] {
    return Array.from(this.publicKeys.values())
      .map((value) => ({ ...value }))
      .sort((a, b) => a.peerId.localeCompare(b.peerId));
  }

  announcePublicKey(): void {
    const payload = this.localPublicInfoPayload();
    if (!payload) return;
    this.gossip.broadcast(payload, { sender: payload.from, timestamp: payload.timestamp, internal: true });
    for (const peerId of this.mesh.getConnectedPeers()) this.sendPublicInfoDirect(peerId, payload);
  }

  requestPeerKey(peerId: string): void {
    const self = String(this.mesh.getClientId() ?? '').trim();
    const target = String(peerId ?? '').trim();
    if (!self || !target || target === self) return;
    const payload: CryptoPublicRequestPayload = {
      __ppType: CRYPTO_PUBLIC_REQUEST_TYPE,
      from: self,
      to: target,
      timestamp: Date.now(),
    };
    this.gossip.sendDirect(target, payload);
    this.gossip.broadcast(payload, { sender: self, timestamp: payload.timestamp, internal: true });
  }

  async waitForPeerKey(peerId: string, timeoutMs: number = this.options.keyDiscoveryTimeoutMs): Promise<PeerPublicKey> {
    const target = String(peerId ?? '').trim();
    const existing = this.getPublicKey(target);
    if (existing) return existing;
    this.requestPeerKey(target);
    return await new Promise<PeerPublicKey>((resolve, reject) => {
      const handler = (key: PeerPublicKey): void => {
        if (key.peerId !== target) return;
        clearTimeout(timer);
        this.off('keyDiscovered', handler);
        resolve({ ...key });
      };
      const timer = setTimeout(() => {
        this.off('keyDiscovered', handler);
        reject(new Error(`Timed out discovering encryption key for peer ${target}`));
      }, Math.max(0, timeoutMs));
      this.on('keyDiscovered', handler);
    });
  }

  async encryptRoom(plaintext: string): Promise<RoomCipher> {
    const cryptoApi = this.cryptoApi();
    const key = await this.deriveRoomKey();
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const cipher = await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(String(plaintext))
    );
    return { alg: 'A256GCM', iv: this.toBase64Url(iv), ct: this.toBase64Url(new Uint8Array(cipher)) };
  }

  async decryptRoom(cipher: RoomCipher): Promise<string> {
    if (!cipher || cipher.alg !== 'A256GCM') throw new Error('Unsupported room cipher');
    const cryptoApi = this.cryptoApi();
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: this.fromBase64Url(cipher.iv) as BufferSource },
      await this.deriveRoomKey(),
      this.fromBase64Url(cipher.ct) as BufferSource
    );
    return new TextDecoder().decode(plaintext);
  }

  async createEncryptedBroadcast(plaintext: string): Promise<EncryptedBroadcastPayload> {
    return {
      __ppType: ENCRYPTED_BROADCAST_TYPE,
      from: String(this.mesh.getClientId() ?? '').trim(),
      roomCipher: await this.encryptRoom(plaintext),
      timestamp: Date.now(),
    };
  }

  async createEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<EncryptedDirectPayload> {
    if (!this.keyPair) throw new Error('Crypto protocol has not been initialized');
    const target = String(peerId ?? '').trim();
    const recipient = this.getPublicKey(target) ?? await this.waitForPeerKey(target, timeoutMs);
    return {
      __ppType: ENCRYPTED_DIRECT_TYPE,
      from: String(this.mesh.getClientId() ?? '').trim(),
      to: target,
      cipher: await encryptMessageWithMeta(String(plaintext), { epub: recipient.epub }),
      timestamp: Date.now(),
    };
  }

  async broadcastEncrypted(
    plaintext: string,
    metadata: Record<string, unknown> = {},
    options: GossipBroadcastOptions = {}
  ): Promise<string> {
    const payload = await this.createEncryptedBroadcast(plaintext);
    const messageMetadata = { ...metadata, encrypted: true, sender: payload.from, timestamp: payload.timestamp };
    return options.trackDelivery
      ? this.gossip.broadcastReliable(payload, messageMetadata, options)
      : this.gossip.broadcast(payload, messageMetadata, options);
  }

  async sendEncryptedDirect(peerId: string, plaintext: string, timeoutMs?: number): Promise<string> {
    const payload = await this.createEncryptedDirect(peerId, plaintext, timeoutMs);
    const messageId = this.gossip.sendDirect(payload.to, payload);
    if (!messageId) throw new Error(`No route to peer ${payload.to}`);
    return messageId;
  }

  async decryptEncryptedBroadcast(payload: EncryptedBroadcastPayload): Promise<string> {
    return await this.decryptRoom(payload.roomCipher);
  }

  async decryptEncryptedDirect(payload: EncryptedDirectPayload): Promise<string> {
    if (!this.keyPair) throw new Error('Crypto protocol has not been initialized');
    return await decryptMessageWithMeta(payload.cipher, this.keyPair.epriv);
  }

  on<K extends keyof PeerPigeonCryptoEvents>(event: K, callback: PeerPigeonCryptoEvents[K]): void {
    const callbacks = this.callbacks[event];
    if (callbacks) callbacks.add(callback);
    else this.callbacks[event] = new Set([callback]);
  }

  off<K extends keyof PeerPigeonCryptoEvents>(event: K, callback: PeerPigeonCryptoEvents[K]): void {
    this.callbacks[event]?.delete(callback);
  }

  destroy(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    if (this.initialized) {
      this.gossip.off('messageReceived', this.onGossipMessageBound);
      this.gossip.off('directMessageReceived', this.onDirectMessageBound);
      this.mesh.off('peer:connected', this.onPeerConnectedBound);
      this.mesh.off('signaling:connected', this.onSignalingConnectedBound);
    }
    this.initialized = false;
    this.publicKeys.clear();
    for (const callbacks of Object.values(this.callbacks)) callbacks?.clear();
  }

  static isProtocolPayload(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { __ppType?: unknown }).__ppType;
    return type === CRYPTO_PUBLIC_INFO_TYPE || type === CRYPTO_PUBLIC_REQUEST_TYPE
      || type === ENCRYPTED_BROADCAST_TYPE || type === ENCRYPTED_DIRECT_TYPE;
  }

  private validateKeyPair(value: PeerPigeonKeyPair): void {
    if (!value || ['pub', 'priv', 'epub', 'epriv'].some((key) => typeof value[key as keyof PeerPigeonKeyPair] !== 'string')) {
      throw new Error('Invalid PeerPigeon key pair');
    }
  }

  private loadStoredKeyPair(): PeerPigeonKeyPair | null {
    if (!this.options.persistKeyPair) return null;
    try {
      const raw = globalThis.sessionStorage?.getItem(`${this.options.storageKey}:${this.options.roomId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PeerPigeonKeyPair;
      this.validateKeyPair(parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private persistKeyPair(value: PeerPigeonKeyPair): void {
    if (!this.options.persistKeyPair) return;
    try {
      globalThis.sessionStorage?.setItem(`${this.options.storageKey}:${this.options.roomId}`, JSON.stringify(value));
    } catch {
      // sessionStorage can be unavailable in restricted contexts.
    }
  }

  private registerLocalKey(): void {
    const payload = this.localPublicInfoPayload();
    if (payload) this.upsertPublicKey(payload.from, payload);
  }

  private localPublicInfoPayload(): CryptoPublicInfoPayload | null {
    const peerId = String(this.mesh.getClientId() ?? '').trim();
    if (!peerId || !this.keyPair) return null;
    return {
      __ppType: CRYPTO_PUBLIC_INFO_TYPE,
      from: peerId,
      pub: this.keyPair.pub,
      epub: this.keyPair.epub,
      timestamp: Date.now(),
    };
  }

  private sendPublicInfoDirect(peerId: string, payload: CryptoPublicInfoPayload | null = this.localPublicInfoPayload()): void {
    if (!payload || !peerId || peerId === payload.from) return;
    this.gossip.sendDirect(peerId, payload);
  }

  private upsertPublicKey(peerId: string, payload: CryptoPublicInfoPayload): void {
    const id = String(peerId ?? '').trim();
    if (!id || typeof payload.pub !== 'string' || typeof payload.epub !== 'string') return;
    const existing = this.publicKeys.get(id);
    if (existing && existing.updatedAt > payload.timestamp) return;
    const value: PeerPublicKey = {
      peerId: id,
      pub: payload.pub,
      epub: payload.epub,
      updatedAt: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now(),
      local: id === this.mesh.getClientId(),
    };
    this.publicKeys.set(id, value);
    this.emit('keyDiscovered', { ...value });
  }

  private isPublicInfo(value: unknown): value is CryptoPublicInfoPayload {
    const payload = value as Partial<CryptoPublicInfoPayload> | null;
    return !!payload && payload.__ppType === CRYPTO_PUBLIC_INFO_TYPE
      && typeof payload.from === 'string' && typeof payload.pub === 'string' && typeof payload.epub === 'string';
  }

  private isPublicRequest(value: unknown): value is CryptoPublicRequestPayload {
    const payload = value as Partial<CryptoPublicRequestPayload> | null;
    return !!payload && payload.__ppType === CRYPTO_PUBLIC_REQUEST_TYPE
      && typeof payload.from === 'string' && typeof payload.to === 'string';
  }

  private isEncryptedBroadcast(value: unknown): value is EncryptedBroadcastPayload {
    const payload = value as Partial<EncryptedBroadcastPayload> | null;
    return !!payload && payload.__ppType === ENCRYPTED_BROADCAST_TYPE && !!payload.roomCipher;
  }

  private isEncryptedDirect(value: unknown): value is EncryptedDirectPayload {
    const payload = value as Partial<EncryptedDirectPayload> | null;
    return !!payload && payload.__ppType === ENCRYPTED_DIRECT_TYPE
      && typeof payload.from === 'string' && typeof payload.to === 'string' && payload.cipher != null;
  }

  private async handleGossipMessage(data: { message: GossipMessage; local: boolean; fromPeer?: string }): Promise<void> {
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
    this.emit('encryptedBroadcastReceived', { plaintext, payload, ...data });
  }

  private async handleDirectMessage(message: DirectMessage): Promise<void> {
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
    this.emit('encryptedDirectReceived', { plaintext, payload, message });
  }

  private async deriveRoomKey(): Promise<CryptoKey> {
    const cryptoApi = this.cryptoApi();
    const roomScope = this.options.roomSecret
      ? `${this.options.roomId}:${this.options.roomSecret}`
      : this.options.roomId;
    const seed = new TextEncoder().encode(
      `peerpigeon:room-broadcast:v1:${roomScope}`
    );
    const hash = await cryptoApi.subtle.digest('SHA-256', seed);
    return await cryptoApi.subtle.importKey('raw', hash, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  private cryptoApi(): Crypto {
    if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is unavailable');
    return globalThis.crypto;
  }

  private toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private fromBase64Url(value: string): Uint8Array {
    const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  private emitError(error: unknown): void {
    this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }

  private emit<K extends keyof PeerPigeonCryptoEvents>(event: K, data: Parameters<PeerPigeonCryptoEvents[K]>[0]): void {
    for (const callback of this.callbacks[event] ?? []) {
      try { (callback as (value: typeof data) => void)(data); } catch { /* listener errors are isolated */ }
    }
  }
}
