export type StorageSpace = 'public' | 'user' | 'frozen' | 'private' | 'epublic';
export type StorageVersion = string | number;

export type StorageChangeOrigin = 'local' | 'remote';

export interface StorageRecord<T = unknown> {
  space: StorageSpace;
  key: string;
  value: T;
  ownerId: string | null;
  createdAt: number;
  updatedAt: number;
  version: StorageVersion;
}

export interface StoragePutOptions {
  /**
   * Override owner for first write in user-space records.
   */
  ownerId?: string;
}

export interface StorageSyncOptions {
  /**
   * Shared room scope used to derive sync encryption keys.
   */
  sessionId?: string;
  /**
   * Optional secret mixed into key derivation for stronger room privacy.
   */
  syncSecret?: string;
}

export interface StorageRetrieveOptions {
  timeoutMs?: number;
}

export interface StorageSyncFilterContext {
  kind: 'mutation' | 'retrieve-request' | 'retrieve-response';
  actorId: string;
  op?: 'upsert' | 'delete';
}

export interface StorageOptions extends StorageSyncOptions {
  /**
   * Local user identity used by ACL checks.
   */
  userId: string;
  /**
   * Optional mesh gossip helper.
   */
  gossip?: GossipLike;
  /**
   * Optional IndexedDB name (default: peerpigeon-storage-v1).
   */
  dbName?: string;
  /**
   * Optional local gate for remote sync payloads.
   * Returning false drops remote storage updates for the given key.
   */
  syncFilter?: (space: StorageSpace, key: string, context: StorageSyncFilterContext) => boolean;
}

export type StorageEvents = {
  change: (event: {
    origin: StorageChangeOrigin;
    op: 'upsert' | 'delete';
    record: StorageRecord | null;
    space: StorageSpace;
    key: string;
    actorId: string;
  }) => void;
};

export type StorageUnsubscribe = () => void;

interface GossipLike {
  broadcast(data: unknown, metadata?: Record<string, unknown>): string;
  on(event: 'messageReceived', callback: (data: { message: { data: unknown }; local: boolean; fromPeer?: string }) => void): void;
  off(event: 'messageReceived', callback: (data: { message: { data: unknown }; local: boolean; fromPeer?: string }) => void): void;
}

type PersistedRecord = {
  pk: string;
  space: StorageSpace;
  key: string;
  ownerId: string | null;
  value: unknown;
  valueCipher: CipherPayload | null;
  createdAt: number;
  updatedAt: number;
  version: StorageVersion;
};

type StorageMutation = {
  __ppType: 'pp-storage-op-v1';
  opId: string;
  op: 'upsert' | 'delete';
  space: StorageSpace;
  key: string;
  actorId: string;
  timestamp: number;
  record: PersistedRecord | null;
};

type StorageRetrieveRequest = {
  __ppType: 'pp-storage-req-v1';
  reqId: string;
  space: StorageSpace;
  key: string;
  actorId: string;
  timestamp: number;
};

type StorageRetrieveResponse = {
  __ppType: 'pp-storage-res-v1';
  reqId: string;
  space: StorageSpace;
  key: string;
  actorId: string;
  timestamp: number;
  record: PersistedRecord | null;
};

type StorageSyncPayload = StorageMutation | StorageRetrieveRequest | StorageRetrieveResponse;

type StorageCrossTabNotice = {
  __ppType: 'pp-storage-cross-tab-v1';
  id: string;
  source: string;
  op: 'upsert' | 'delete';
  space: StorageSpace;
  key: string;
  actorId: string;
  timestamp: number;
};

type SyncEnvelope = {
  __ppType: 'pp-storage-sync-v1';
  from: string;
  timestamp: number;
  cipher: CipherPayload;
};

type CipherPayload = {
  alg: 'A256GCM';
  iv: string;
  ct: string;
};

type ChangeListener = (event: Parameters<StorageEvents['change']>[0]) => void;

interface StorageDriver {
  get(pk: string): Promise<PersistedRecord | null>;
  put(record: PersistedRecord): Promise<void>;
  delete(pk: string): Promise<void>;
  listBySpace(space: StorageSpace): Promise<PersistedRecord[]>;
  close(): void;
}

class MemoryStorageDriver implements StorageDriver {
  private map = new Map<string, PersistedRecord>();

  async get(pk: string): Promise<PersistedRecord | null> {
    return this.map.get(pk) ?? null;
  }

  async put(record: PersistedRecord): Promise<void> {
    this.map.set(record.pk, record);
  }

  async delete(pk: string): Promise<void> {
    this.map.delete(pk);
  }

  async listBySpace(space: StorageSpace): Promise<PersistedRecord[]> {
    const out: PersistedRecord[] = [];
    for (const value of this.map.values()) {
      if (value.space === space) out.push(value);
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  close(): void {
    // no-op
  }
}

class IndexedDbStorageDriver implements StorageDriver {
  private db: IDBDatabase;
  private storeName: string;

  private constructor(db: IDBDatabase, storeName: string) {
    this.db = db;
    this.storeName = storeName;
  }

  static async create(dbName: string, storeName: string): Promise<IndexedDbStorageDriver> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const next = req.result;
        if (!next.objectStoreNames.contains(storeName)) {
          const store = next.createObjectStore(storeName, { keyPath: 'pk' });
          store.createIndex('space', 'space', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });

    return new IndexedDbStorageDriver(db, storeName);
  }

  async get(pk: string): Promise<PersistedRecord | null> {
    return await this.runRead<PersistedRecord | undefined>((store) => store.get(pk)).then((value) => value ?? null);
  }

  async put(record: PersistedRecord): Promise<void> {
    await this.runWrite((store) => store.put(record));
  }

  async delete(pk: string): Promise<void> {
    await this.runWrite((store) => store.delete(pk));
  }

  async listBySpace(space: StorageSpace): Promise<PersistedRecord[]> {
    return await this.runRead<PersistedRecord[]>((store) => {
      const index = store.index('space');
      const request = index.getAll(space);
      return request;
    });
  }

  close(): void {
    this.db.close();
  }

  private runRead<T>(factory: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = factory(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  private runWrite(factory: (store: IDBObjectStore) => IDBRequest<any>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = factory(store);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB write failed'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
}

/**
 * PeerPigeonStorage
 *
 * - Persists records in IndexedDB (fallback: in-memory)
 * - Syncs non-private spaces over encrypted gossip envelopes
 * - Enforces five built-in ACL spaces: public, user, frozen, private, epublic
 * - epublic is internal-only and can only be mutated through putSystem/deleteSystem
 */
export class PeerPigeonStorage {
  private readonly userId: string;
  private readonly gossip: GossipLike | null;
  private readonly sessionId: string;
  private readonly syncSecret: string;
  private readonly dbName: string;
  private readonly syncFilter: ((space: StorageSpace, key: string, context: StorageSyncFilterContext) => boolean) | null;
  private readonly storeName = 'records';
  private driver: StorageDriver | null = null;
  private readonly listeners = new Set<ChangeListener>();
  private readonly pendingRetrieveRequests = new Map<string, { resolve: (value: StorageRecord | null) => void; timeout: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private readonly seenMutationOpIds = new Set<string>();
  private readonly onGossipMessageBound: (data: { message: { data: unknown }; local: boolean; fromPeer?: string }) => void;
  private readonly instanceId = `storage-${Math.random().toString(36).slice(2, 11)}`;
  private crossTabChannel: BroadcastChannel | null = null;
  private readonly crossTabSeenNoticeIds = new Set<string>();
  private readonly crossTabStorageEventBound: (event: StorageEvent) => void;
  private readonly crossTabChannelMessageBound: (event: MessageEvent) => void;

  constructor(options: StorageOptions) {
    const userId = String(options.userId ?? '').trim();
    if (!userId) {
      throw new Error('PeerPigeonStorage requires a non-empty userId');
    }

    this.userId = userId;
    this.gossip = options.gossip ?? null;
    this.sessionId = String(options.sessionId ?? 'default-session').trim() || 'default-session';
    this.syncSecret = String(options.syncSecret ?? '').trim();
    this.dbName = String(options.dbName ?? 'peerpigeon-storage-v1').trim() || 'peerpigeon-storage-v1';
    this.syncFilter = typeof options.syncFilter === 'function' ? options.syncFilter : null;
    this.onGossipMessageBound = (data) => {
      this.handleGossipMessage(data).catch(() => {
        // ignore malformed or undecryptable sync messages
      });
    };
    this.crossTabStorageEventBound = (event: StorageEvent) => {
      this.handleCrossTabStorageEvent(event);
    };
    this.crossTabChannelMessageBound = (event: MessageEvent) => {
      this.handleCrossTabChannelMessage(event);
    };
  }

  async init(): Promise<void> {
    if (this.closed) {
      throw new Error('PeerPigeonStorage is closed');
    }
    if (this.driver) return;

    this.driver = await this.createDriver();
    this.setupCrossTabSync();

    if (this.gossip) {
      this.gossip.on('messageReceived', this.onGossipMessageBound);
    }
  }

  on(event: 'change', listener: StorageEvents['change']): void {
    if (event !== 'change') return;
    this.listeners.add(listener);
  }

  subscribe(listener: StorageEvents['change']): StorageUnsubscribe {
    this.on('change', listener);
    return () => {
      this.off('change', listener);
    };
  }

  off(event: 'change', listener: StorageEvents['change']): void {
    if (event !== 'change') return;
    this.listeners.delete(listener);
  }

  async put<T = unknown>(space: StorageSpace, key: string, value: T, options: StoragePutOptions = {}): Promise<StorageRecord<T>> {
    const mutation = await this.applyLocalUpsert(space, key, value, options, false);
    if (space !== 'private') {
      await this.broadcastMutation(mutation);
    }
    return (await this.get(space, key)) as StorageRecord<T>;
  }

  async putSystem<T = unknown>(space: StorageSpace, key: string, value: T, options: StoragePutOptions = {}): Promise<StorageRecord<T>> {
    if (space !== 'epublic') {
      throw new Error('putSystem is only allowed for epublic space');
    }

    const mutation = await this.applyLocalUpsert(space, key, value, options, true);
    await this.broadcastMutation(mutation);
    return (await this.get(space, key)) as StorageRecord<T>;
  }

  async get<T = unknown>(space: StorageSpace, key: string): Promise<StorageRecord<T> | null> {
    const driver = this.requireDriver();
    const pk = this.makePk(space, key);
    const persisted = await driver.get(pk);
    if (!persisted) return null;

    let value: unknown;
    try {
      value = await this.decodeValueForRead(persisted, this.userId);
    } catch {
      // Private records can become undecryptable if they were written by a
      // previous local user identity/session. Treat as missing for this user.
      if (space === 'private') return null;
      throw new Error('Failed to decode storage value');
    }

    return {
      space: persisted.space,
      key: persisted.key,
      value: value as T,
      ownerId: persisted.ownerId,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      version: this.normalizeStorageVersion(persisted.version, this.versionSourceToken(persisted.ownerId ?? this.userId)),
    };
  }

  async retrieve<T = unknown>(space: StorageSpace, key: string, options: StorageRetrieveOptions = {}): Promise<StorageRecord<T> | null> {
    const normalizedKey = this.normalizeKey(key);
    const existing = await this.get<T>(space, normalizedKey);
    if (space === 'private') return existing;
    if (!this.gossip) return existing;

    const reqId = `${this.makeMutationId(this.userId)}-req`;
    const request: StorageRetrieveRequest = {
      __ppType: 'pp-storage-req-v1',
      reqId,
      space,
      key: normalizedKey,
      actorId: this.userId,
      timestamp: Date.now(),
    };

    const timeoutMs = Math.max(100, Math.floor(Number(options.timeoutMs ?? 2000)));

    return await new Promise<StorageRecord<T> | null>(async (resolve) => {
      const timeout = setTimeout(async () => {
        this.pendingRetrieveRequests.delete(reqId);
        const latest = await this.get<T>(space, normalizedKey);
        resolve(latest);
      }, timeoutMs);

      this.pendingRetrieveRequests.set(reqId, {
        resolve: (value) => resolve(value as StorageRecord<T> | null),
        timeout,
      });

      await this.broadcastSyncPayload(request);
    });
  }

  async delete(space: StorageSpace, key: string): Promise<boolean> {
    const mutation = await this.applyLocalDelete(space, key, false);
    if (!mutation) return false;

    if (space !== 'private') {
      await this.broadcastMutation(mutation);
    }
    return true;
  }

  async deleteSystem(space: StorageSpace, key: string): Promise<boolean> {
    if (space !== 'epublic') {
      throw new Error('deleteSystem is only allowed for epublic space');
    }

    const mutation = await this.applyLocalDelete(space, key, true);
    if (!mutation) return false;

    await this.broadcastMutation(mutation);
    return true;
  }

  async list(space: StorageSpace): Promise<StorageRecord[]> {
    const driver = this.requireDriver();
    const persisted = await driver.listBySpace(space);

    const out: StorageRecord[] = [];
    for (const record of persisted) {
      let value: unknown;
      try {
        value = await this.decodeValueForRead(record, this.userId);
      } catch {
        // Skip unreadable private records from old local identities.
        if (record.space === 'private') continue;
        throw new Error('Failed to decode storage value');
      }

      out.push({
        space: record.space,
        key: record.key,
        value,
        ownerId: record.ownerId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        version: this.normalizeStorageVersion(record.version, this.versionSourceToken(record.ownerId ?? this.userId)),
      });
    }

    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.gossip) {
      this.gossip.off('messageReceived', this.onGossipMessageBound);
    }

    this.driver?.close();
    this.driver = null;
    this.teardownCrossTabSync();
    this.listeners.clear();
    for (const pending of this.pendingRetrieveRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRetrieveRequests.clear();
  }

  private async applyLocalUpsert(space: StorageSpace, key: string, value: unknown, options: StoragePutOptions, allowSystemWrite = false): Promise<StorageMutation> {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    const now = Date.now();

    this.assertCanWrite(space, existing, actorId, options.ownerId, allowSystemWrite);

    const ownerId = this.resolveOwnerId(space, existing, actorId, options.ownerId);
    const nextVersion = this.nextStorageVersion(existing?.version, ownerId || actorId);
    const encoded = await this.encodeValueForStore(space, value);

    const persisted: PersistedRecord = {
      pk,
      space,
      key: normalizedKey,
      ownerId,
      value: encoded.value,
      valueCipher: encoded.valueCipher,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: nextVersion,
    };

    await driver.put(persisted);

    const opId = this.makeMutationId(actorId);
    const mutation: StorageMutation = {
      __ppType: 'pp-storage-op-v1',
      opId,
      op: 'upsert',
      space,
      key: normalizedKey,
      actorId,
      timestamp: now,
      record: persisted,
    };

    this.emitChange({
      origin: 'local',
      op: 'upsert',
      record: {
        space,
        key: normalizedKey,
        value,
        ownerId,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        version: persisted.version,
      },
      space,
      key: normalizedKey,
      actorId,
    });

    this.publishCrossTabNotice({
      __ppType: 'pp-storage-cross-tab-v1',
      id: this.makeMutationId(actorId),
      source: this.instanceId,
      op: 'upsert',
      space,
      key: normalizedKey,
      actorId,
      timestamp: now,
    });

    // Mark locally-created mutations as seen so they never re-apply
    this.seenMutationOpIds.add(opId);
    return mutation;
  }

  private async applyLocalDelete(space: StorageSpace, key: string, allowSystemWrite = false): Promise<StorageMutation | null> {
    const normalizedKey = this.normalizeKey(key);
    const actorId = this.userId;
    const driver = this.requireDriver();
    const pk = this.makePk(space, normalizedKey);
    const existing = await driver.get(pk);
    if (!existing) return null;

    this.assertCanDelete(space, existing, actorId, allowSystemWrite);
    await driver.delete(pk);

    const opId = this.makeMutationId(actorId);
    const mutation: StorageMutation = {
      __ppType: 'pp-storage-op-v1',
      opId,
      op: 'delete',
      space,
      key: normalizedKey,
      actorId,
      timestamp: Date.now(),
      record: null,
    };

    this.emitChange({
      origin: 'local',
      op: 'delete',
      record: null,
      space,
      key: normalizedKey,
      actorId,
    });

    this.publishCrossTabNotice({
      __ppType: 'pp-storage-cross-tab-v1',
      id: this.makeMutationId(actorId),
      source: this.instanceId,
      op: 'delete',
      space,
      key: normalizedKey,
      actorId,
      timestamp: Date.now(),
    });

    // Mark locally-created mutations as seen so they never re-apply
    this.seenMutationOpIds.add(opId);
    return mutation;
  }

  private async handleGossipMessage(data: { message: { data: unknown }; local: boolean; fromPeer?: string }): Promise<void> {
    if (data.local) return;
    const payload = data.message?.data;
    if (!this.isSyncEnvelope(payload)) return;

    const decrypted = await this.decryptSyncEnvelope(payload.cipher);
    if (!decrypted) return;

    if (this.isStorageMutation(decrypted)) {
      if (decrypted.space === 'private') return;
      if (!this.shouldAcceptRemoteSync(decrypted.space, decrypted.key, {
        kind: 'mutation',
        actorId: decrypted.actorId,
        op: decrypted.op,
      })) {
        return;
      }

      // Treat every arrived mutation as a candidate update and resolve conflicts
      // at apply-time (newer version/timestamp wins).
      await this.applyRemoteMutation(decrypted);
      return;
    }

    if (this.isStorageRetrieveRequest(decrypted)) {
      if (!this.shouldAcceptRemoteSync(decrypted.space, decrypted.key, {
        kind: 'retrieve-request',
        actorId: decrypted.actorId,
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

  private async applyRemoteMutation(mutation: StorageMutation): Promise<boolean> {
    const driver = this.requireDriver();
    const pk = this.makePk(mutation.space, mutation.key);
    const existing = await driver.get(pk);

    if (mutation.op === 'delete') {
      if (!existing) return false;
      // Never re-apply the same mutation twice globally
      if (this.seenMutationOpIds.has(mutation.opId)) {
        return false;
      }
      this.seenMutationOpIds.add(mutation.opId);
      // Public space allows any actor to delete; avoid wall-clock skew
      // blocking legitimate remote deletes from peers with older clocks.
      if (mutation.space !== 'public' && mutation.timestamp <= existing.updatedAt) return false;
      if (!this.canDelete(mutation.space, existing, mutation.actorId, mutation.space === 'epublic')) return false;
      await driver.delete(pk);
      this.emitChange({
        origin: 'remote',
        op: 'delete',
        record: null,
        space: mutation.space,
        key: mutation.key,
        actorId: mutation.actorId,
      });
      this.publishCrossTabNotice({
        __ppType: 'pp-storage-cross-tab-v1',
        id: mutation.opId,
        source: this.instanceId,
        op: 'delete',
        space: mutation.space,
        key: mutation.key,
        actorId: mutation.actorId,
        timestamp: mutation.timestamp,
      });
      return true;
    }

    if (!mutation.record) return false;

    // Never re-apply the same mutation (opId) twice, whether delete or upsert
    if (this.seenMutationOpIds.has(mutation.opId)) {
      return false;
    }

    if (existing) {
      const existingVersion = existing.version;
      const incomingVersion = mutation.record.version;
      const existingUpdatedAt = Number(existing.updatedAt ?? 0);
      const incomingUpdatedAt = Number(mutation.timestamp ?? mutation.record.updatedAt ?? 0);
      const versionCmp = this.compareStorageVersions(incomingVersion, existingVersion);

      const normalizedIncomingVersion = this.normalizeStorageVersion(
        incomingVersion,
        this.versionSourceToken(mutation.record.ownerId ?? mutation.actorId)
      );
      const normalizedExistingVersion = this.normalizeStorageVersion(
        existingVersion,
        this.versionSourceToken(existing.ownerId ?? this.userId)
      );

      // Idempotency guard: identical same-version payloads should never churn
      // local state or trigger UI refresh loops.
      if (
        normalizedIncomingVersion === normalizedExistingVersion
        && String(existing.ownerId ?? '') === String(mutation.record.ownerId ?? '')
        && this.persistedValueEqual(existing.value, mutation.record.value)
        && this.cipherPayloadEqual(existing.valueCipher, mutation.record.valueCipher)
      ) {
        return false;
      }

      // Arrival-time conflict resolution: accept newer version; if equal version,
      // accept only newer wall-clock value.
      if (versionCmp < 0) return false;
      if (versionCmp === 0 && incomingUpdatedAt <= existingUpdatedAt) return false;
    }

    if (!this.canWrite(mutation.space, existing, mutation.actorId, undefined, mutation.space === 'epublic')) return false;

    if (mutation.space === 'user' && !existing) {
      const incomingOwner = String(mutation.record.ownerId ?? '').trim();
      if (incomingOwner && incomingOwner !== mutation.actorId) {
        return false;
      }
    }

    const incoming = {
      ...mutation.record,
      pk,
      ownerId: mutation.space === 'user'
        ? (existing?.ownerId ?? mutation.record.ownerId ?? mutation.actorId)
        : mutation.record.ownerId,
      updatedAt: mutation.timestamp,
      createdAt: existing?.createdAt ?? mutation.record.createdAt,
      version: this.normalizeStorageVersion(
        mutation.record.version,
        this.versionSourceToken(mutation.record.ownerId ?? mutation.actorId)
      ),
    };

    await driver.put(incoming);

    const value = await this.decodeValueForRead(incoming, this.userId);
    this.emitChange({
      origin: 'remote',
      op: 'upsert',
      record: {
        space: incoming.space,
        key: incoming.key,
        value,
        ownerId: incoming.ownerId,
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
        version: incoming.version,
      },
      space: incoming.space,
      key: incoming.key,
      actorId: mutation.actorId,
    });
    this.publishCrossTabNotice({
      __ppType: 'pp-storage-cross-tab-v1',
      id: mutation.opId,
      source: this.instanceId,
      op: 'upsert',
      space: incoming.space,
      key: incoming.key,
      actorId: mutation.actorId,
      timestamp: mutation.timestamp,
    });
    // Mark as seen so this exact opId never re-applies on any peer
    this.seenMutationOpIds.add(mutation.opId);
    return true;
  }

  private setupCrossTabSync(): void {
    if (typeof window === 'undefined') return;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.crossTabChannel = new BroadcastChannel(this.crossTabChannelName());
        this.crossTabChannel.addEventListener('message', this.crossTabChannelMessageBound);
      } catch {
        this.crossTabChannel = null;
      }
    }

    window.addEventListener('storage', this.crossTabStorageEventBound);
  }

  private teardownCrossTabSync(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.crossTabStorageEventBound);
    }

    if (this.crossTabChannel) {
      try {
        this.crossTabChannel.removeEventListener('message', this.crossTabChannelMessageBound);
        this.crossTabChannel.close();
      } catch {
        // ignore teardown failures
      }
      this.crossTabChannel = null;
    }

    this.crossTabSeenNoticeIds.clear();
  }

  private crossTabChannelName(): string {
    return `peerpigeon-storage-ct:${this.dbName}:${this.sessionId}`;
  }

  private crossTabStorageKey(): string {
    return `peerpigeon-storage-ct:${this.dbName}:${this.sessionId}:notice`;
  }

  private publishCrossTabNotice(notice: StorageCrossTabNotice): void {
    this.crossTabSeenNoticeIds.add(notice.id);
    this.trimSeenNoticeIds();

    if (this.crossTabChannel) {
      try {
        this.crossTabChannel.postMessage(notice);
      } catch {
        // ignore channel failures
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const key = this.crossTabStorageKey();
        localStorage.setItem(key, JSON.stringify(notice));
        localStorage.removeItem(key);
      } catch {
        // ignore localStorage failures (privacy mode / quota)
      }
    }
  }

  private handleCrossTabChannelMessage(event: MessageEvent): void {
    const notice = event?.data;
    if (!this.isCrossTabNotice(notice)) return;
    this.consumeCrossTabNotice(notice);
  }

  private handleCrossTabStorageEvent(event: StorageEvent): void {
    if (!event || event.key !== this.crossTabStorageKey()) return;
    if (!event.newValue) return;

    try {
      const parsed = JSON.parse(event.newValue);
      if (!this.isCrossTabNotice(parsed)) return;
      this.consumeCrossTabNotice(parsed);
    } catch {
      // ignore malformed notices
    }
  }

  private consumeCrossTabNotice(notice: StorageCrossTabNotice): void {
    if (notice.source === this.instanceId) return;
    if (this.crossTabSeenNoticeIds.has(notice.id)) return;
    this.crossTabSeenNoticeIds.add(notice.id);
    this.trimSeenNoticeIds();

    this.applyCrossTabNotice(notice).catch(() => {
      // best-effort local cross-tab signal
    });
  }

  private async applyCrossTabNotice(notice: StorageCrossTabNotice): Promise<void> {
    if (this.closed) return;
    const driver = this.requireDriver();
    const pk = this.makePk(notice.space, notice.key);

    if (notice.op === 'delete') {
      this.emitChange({
        origin: 'remote',
        op: 'delete',
        record: null,
        space: notice.space,
        key: notice.key,
        actorId: notice.actorId,
      });
      return;
    }

    const persisted = await driver.get(pk);
    if (!persisted) return;

    const value = await this.decodeValueForRead(persisted, this.userId);
    this.emitChange({
      origin: 'remote',
      op: 'upsert',
      record: {
        space: persisted.space,
        key: persisted.key,
        value,
        ownerId: persisted.ownerId,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        version: persisted.version,
      },
      space: persisted.space,
      key: persisted.key,
      actorId: notice.actorId,
    });
  }

  private trimSeenNoticeIds(): void {
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

  private async broadcastMutation(mutation: StorageMutation): Promise<void> {
    await this.broadcastSyncPayload(mutation);
  }

  private async broadcastSyncPayload(payload: StorageSyncPayload): Promise<void> {
    if (!this.gossip) return;
    const cipher = await this.encryptSyncPayload(payload);
    const envelope: SyncEnvelope = {
      __ppType: 'pp-storage-sync-v1',
      from: this.userId,
      timestamp: Date.now(),
      cipher,
    };

    this.gossip.broadcast(envelope);
  }

  private async handleRetrieveRequest(request: StorageRetrieveRequest): Promise<void> {
    if (request.actorId === this.userId) return;
    if (request.space === 'private') return;

    const driver = this.requireDriver();
    const pk = this.makePk(request.space, request.key);
    const existing = await driver.get(pk);
    if (!existing) return;

    const response: StorageRetrieveResponse = {
      __ppType: 'pp-storage-res-v1',
      reqId: request.reqId,
      space: request.space,
      key: request.key,
      actorId: this.userId,
      timestamp: Date.now(),
      record: existing,
    };

    await this.broadcastSyncPayload(response);
  }

  private async handleRetrieveResponse(response: StorageRetrieveResponse): Promise<void> {
    const pending = this.pendingRetrieveRequests.get(response.reqId) ?? null;
    if (pending) {
      this.pendingRetrieveRequests.delete(response.reqId);
      clearTimeout(pending.timeout);
    } else {
      // Ignore unsolicited retrieve responses. Applying these on peers that
      // did not request them creates fanout churn and apparent save loops.
      return;
    }

    if (response.record && response.space !== 'private') {
      if (!this.shouldAcceptRemoteSync(response.space, response.key, {
        kind: 'retrieve-response',
        actorId: response.actorId,
      })) {
        if (pending) {
          const latest = await this.get(response.space, response.key);
          pending.resolve(latest);
        }
        return;
      }

      const mutation: StorageMutation = {
        __ppType: 'pp-storage-op-v1',
        opId: `retrieve-${response.reqId}-${response.actorId}`,
        op: 'upsert',
        space: response.space,
        key: response.key,
        actorId: response.actorId,
        // Preserve source record freshness to avoid treating every retrieve
        // response as a newer write based on responder wall-clock.
        timestamp: Number(response.record.updatedAt || 0) || response.timestamp,
        record: response.record,
      };
      await this.applyRemoteMutation(mutation);
    }

    if (pending) {
      const latest = await this.get(response.space, response.key);
      pending.resolve(latest);
    }
  }

  private shouldAcceptRemoteSync(space: StorageSpace, key: string, context: StorageSyncFilterContext): boolean {
    if (space === 'private') return false;
    if (!this.syncFilter) return true;
    try {
      return this.syncFilter(space, key, context) !== false;
    } catch {
      return false;
    }
  }

  private async createDriver(): Promise<StorageDriver> {
    if (typeof indexedDB === 'undefined') {
      return new MemoryStorageDriver();
    }

    try {
      return await IndexedDbStorageDriver.create(this.dbName, this.storeName);
    } catch {
      return new MemoryStorageDriver();
    }
  }

  private emitChange(event: Parameters<StorageEvents['change']>[0]): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  private requireDriver(): StorageDriver {
    if (!this.driver) {
      throw new Error('PeerPigeonStorage.init() must be called before use');
    }
    return this.driver;
  }

  private normalizeKey(key: string): string {
    const normalized = String(key ?? '').trim();
    if (!normalized) throw new Error('Storage key must be a non-empty string');
    return normalized;
  }

  private makePk(space: StorageSpace, key: string): string {
    if (space === 'private') {
      // Namespace private keys by local user so one browser profile can hold
      // multiple local identities without decryption collisions.
      return `${space}:${this.userId}:${key}`;
    }
    return `${space}:${key}`;
  }

  private makeMutationId(actorId: string): string {
    return `${actorId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private parseStorageVersion(version: StorageVersion | null | undefined): { parts: [number, number, number, number]; source: string } {
    const raw = String(version ?? '').trim();
    if (!raw) {
      return { parts: [0, 0, 0, 0], source: '0' };
    }

    if (/^\d+$/.test(raw)) {
      const major = Math.max(0, Math.floor(Number(raw)));
      return { parts: [major, 0, 0, 0], source: '0' };
    }

    const split = raw.split('.');
    const numeric = split.slice(0, 4);
    while (numeric.length < 4) numeric.push('0');

    const parts = numeric.map((part) => {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.floor(n);
    }) as [number, number, number, number];

    const source = this.versionSourceToken(split[4] || '0');
    return { parts, source };
  }

  private versionSourceToken(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '0';

    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly) {
      const trimmed = digitsOnly.slice(0, 10);
      return String(Number(trimmed));
    }

    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!cleaned) return '0';

    const hexPrefix = cleaned.replace(/[^0-9a-f]/g, '').slice(0, 8);
    if (hexPrefix.length >= 4) {
      return String(parseInt(hexPrefix, 16));
    }

    // Stable fallback for non-hex ids (e.g. epub formats).
    let hash = 2166136261;
    for (let i = 0; i < cleaned.length; i += 1) {
      hash ^= cleaned.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  private normalizeStorageVersion(version: StorageVersion | null | undefined, fallbackSource = '0'): string {
    const parsed = this.parseStorageVersion(version);
    const source = parsed.source === '0'
      ? this.versionSourceToken(fallbackSource)
      : parsed.source;
    const [major, minor, patch, build] = parsed.parts;
    return `${major}.${minor}.${patch}.${build}.${source}`;
  }

  private compareStorageVersions(a: StorageVersion | null | undefined, b: StorageVersion | null | undefined): number {
    const leftParsed = this.parseStorageVersion(a);
    const rightParsed = this.parseStorageVersion(b);
    const left = leftParsed.parts;
    const right = rightParsed.parts;
    for (let i = 0; i < 4; i += 1) {
      if (left[i] > right[i]) return 1;
      if (left[i] < right[i]) return -1;
    }
    const leftSource = Number(leftParsed.source || '0');
    const rightSource = Number(rightParsed.source || '0');
    if (leftSource > rightSource) return 1;
    if (leftSource < rightSource) return -1;
    return 0;
  }

  private persistedValueEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private cipherPayloadEqual(a: CipherPayload | null, b: CipherPayload | null): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.alg === b.alg && a.iv === b.iv && a.ct === b.ct;
  }

  private nextStorageVersion(previous: StorageVersion | null | undefined, actorId: string): string {
    const parsed = this.parseStorageVersion(previous);
    const nextMajor = parsed.parts[0] + 1;
    return `${nextMajor}.0.0.0.${this.versionSourceToken(actorId)}`;
  }

  private resolveOwnerId(space: StorageSpace, existing: PersistedRecord | null, actorId: string, ownerOverride?: string): string | null {
    if (space === 'user') {
      if (existing?.ownerId) {
        // If migrating from peer ID format to epub format, take ownership.
        if (this.isPeerIdFormat(existing.ownerId) && !this.isPeerIdFormat(actorId)) {
          return actorId;
        }
        return existing.ownerId;
      }
      const requested = String(ownerOverride ?? '').trim();
      return requested || actorId;
    }
    if (space === 'public' || space === 'frozen' || space === 'epublic') {
      return actorId;
    }
    return existing?.ownerId ?? null;
  }

  private assertCanWrite(space: StorageSpace, existing: PersistedRecord | null, actorId: string, ownerOverride?: string, allowSystemWrite = false): void {
    if (!this.canWrite(space, existing, actorId, ownerOverride, allowSystemWrite)) {
      throw new Error(`Write denied for ${space} space key`);
    }
  }

  private canWrite(space: StorageSpace, existing: PersistedRecord | null, actorId: string, ownerOverride?: string, allowSystemWrite = false): boolean {
    if (space === 'public') return true;
    if (space === 'epublic') return allowSystemWrite === true;
    if (space === 'private') return actorId === this.userId;
    if (space === 'user') {
      if (!existing) return true;
      // Allow write if current actor is owner
      if (existing.ownerId === actorId) return true;
      // Allow write if owner is being explicitly migrated via override
      if (ownerOverride && String(ownerOverride).trim()) return true;
      // Auto-allow migration from old peer ID format to new epub format:
      // if existing owner is 64-char hex (peer ID) and current actor is not hex format (epub),
      // allow the write as an implicit identity migration.
      if (this.isPeerIdFormat(existing.ownerId) && !this.isPeerIdFormat(actorId)) {
        return true;
      }
      return false;
    }
    if (space === 'frozen') {
      return !existing;
    }
    return false;
  }

  private isPeerIdFormat(id: string | null): boolean {
    if (!id) return false;
    const str = String(id).trim();
    // Peer IDs are 64 hex characters; epub format is compact like "x.y" or similar
    return /^[0-9a-f]{64}$/i.test(str);
  }

  private assertCanDelete(space: StorageSpace, existing: PersistedRecord, actorId: string, allowSystemWrite = false): void {
    if (!this.canDelete(space, existing, actorId, allowSystemWrite)) {
      throw new Error(`Delete denied for ${space} space key`);
    }
  }

  private canDelete(space: StorageSpace, existing: PersistedRecord, actorId: string, allowSystemWrite = false): boolean {
    if (space === 'public') return true;
    if (space === 'epublic') return allowSystemWrite === true;
    if (space === 'private') return actorId === this.userId;
    if (space === 'user') return existing.ownerId === actorId;
    if (space === 'frozen') return false;
    return false;
  }

  private async encodeValueForStore(space: StorageSpace, value: unknown): Promise<{ value: unknown; valueCipher: CipherPayload | null }> {
    if (space !== 'private') {
      return { value, valueCipher: null };
    }

    const cipher = await this.encryptPrivateValue(value);
    return { value: null, valueCipher: cipher };
  }

  private async decodeValueForRead(record: PersistedRecord, readerId: string): Promise<unknown> {
    if (record.space !== 'private') {
      return record.value;
    }
    if (readerId !== this.userId) {
      throw new Error('Read denied for private space key');
    }
    if (!record.valueCipher) {
      throw new Error('Missing cipher for private value');
    }
    return await this.decryptPrivateValue(record.valueCipher);
  }

  private isSyncEnvelope(value: unknown): value is SyncEnvelope {
    const maybe = value as Partial<SyncEnvelope> | null;
    return !!maybe &&
      maybe.__ppType === 'pp-storage-sync-v1' &&
      typeof maybe.from === 'string' &&
      typeof maybe.timestamp === 'number' &&
      this.isCipherPayload(maybe.cipher);
  }

  private isStorageMutation(value: unknown): value is StorageMutation {
    const maybe = value as Partial<StorageMutation> | null;
    return !!maybe &&
      maybe.__ppType === 'pp-storage-op-v1' &&
      typeof maybe.opId === 'string' &&
      (maybe.op === 'upsert' || maybe.op === 'delete') &&
      (maybe.space === 'public' || maybe.space === 'user' || maybe.space === 'frozen' || maybe.space === 'private' || maybe.space === 'epublic') &&
      typeof maybe.key === 'string' &&
      typeof maybe.actorId === 'string' &&
      typeof maybe.timestamp === 'number';
  }

  private isStorageRetrieveRequest(value: unknown): value is StorageRetrieveRequest {
    const maybe = value as Partial<StorageRetrieveRequest> | null;
    return !!maybe &&
      maybe.__ppType === 'pp-storage-req-v1' &&
      typeof maybe.reqId === 'string' &&
      (maybe.space === 'public' || maybe.space === 'user' || maybe.space === 'frozen' || maybe.space === 'private' || maybe.space === 'epublic') &&
      typeof maybe.key === 'string' &&
      typeof maybe.actorId === 'string' &&
      typeof maybe.timestamp === 'number';
  }

  private isStorageRetrieveResponse(value: unknown): value is StorageRetrieveResponse {
    const maybe = value as Partial<StorageRetrieveResponse> | null;
    return !!maybe &&
      maybe.__ppType === 'pp-storage-res-v1' &&
      typeof maybe.reqId === 'string' &&
      (maybe.space === 'public' || maybe.space === 'user' || maybe.space === 'frozen' || maybe.space === 'private' || maybe.space === 'epublic') &&
      typeof maybe.key === 'string' &&
      typeof maybe.actorId === 'string' &&
      typeof maybe.timestamp === 'number' &&
      (maybe.record === null || typeof maybe.record === 'object');
  }


  private isCrossTabNotice(value: unknown): value is StorageCrossTabNotice {
    const maybe = value as Partial<StorageCrossTabNotice> | null;
    return !!(
      maybe &&
      maybe.__ppType === 'pp-storage-cross-tab-v1' &&
      typeof maybe.id === 'string' &&
      typeof maybe.source === 'string' &&
      (maybe.op === 'upsert' || maybe.op === 'delete') &&
      typeof maybe.space === 'string' &&
      typeof maybe.key === 'string' &&
      typeof maybe.actorId === 'string' &&
      typeof maybe.timestamp === 'number'
    );
  }
  private isCipherPayload(value: unknown): value is CipherPayload {
    const maybe = value as Partial<CipherPayload> | null;
    return !!maybe &&
      maybe.alg === 'A256GCM' &&
      typeof maybe.iv === 'string' &&
      typeof maybe.ct === 'string';
  }

  private async encryptSyncPayload(payload: StorageSyncPayload): Promise<CipherPayload> {
    const key = await this.deriveAesKey(`peerpigeon:storage-sync:v1:${this.sessionId}:${this.syncSecret}`);
    return await this.encryptJson(payload, key);
  }

  private async decryptSyncEnvelope(cipher: CipherPayload): Promise<unknown | null> {
    try {
      const key = await this.deriveAesKey(`peerpigeon:storage-sync:v1:${this.sessionId}:${this.syncSecret}`);
      return await this.decryptJson(cipher, key);
    } catch {
      return null;
    }
  }

  private async encryptPrivateValue(value: unknown): Promise<CipherPayload> {
    const key = await this.deriveAesKey(`peerpigeon:storage-private:v1:${this.userId}:${this.sessionId}:${this.syncSecret}`);
    return await this.encryptJson(value, key);
  }

  private async decryptPrivateValue(cipher: CipherPayload): Promise<unknown> {
    const key = await this.deriveAesKey(`peerpigeon:storage-private:v1:${this.userId}:${this.sessionId}:${this.syncSecret}`);
    return await this.decryptJson(cipher, key);
  }

  private async deriveAesKey(seed: string): Promise<CryptoKey> {
    if (!globalThis.crypto?.subtle) {
      throw new Error('WebCrypto subtle API is required for encrypted storage sync');
    }

    const seedBytes = new TextEncoder().encode(seed);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', seedBytes);
    return await globalThis.crypto.subtle.importKey(
      'raw',
      digest,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encryptJson(value: unknown, key: CryptoKey): Promise<CipherPayload> {
    const ivBuffer = new ArrayBuffer(12);
    const ivView = new Uint8Array(ivBuffer);
    globalThis.crypto.getRandomValues(ivView);
    const plainBytes = new TextEncoder().encode(JSON.stringify(value));
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      key,
      plainBytes
    );

    return {
      alg: 'A256GCM',
      iv: this.toBase64Url(ivView),
      ct: this.toBase64Url(new Uint8Array(cipherBuffer)),
    };
  }

  private async decryptJson(cipher: CipherPayload, key: CryptoKey): Promise<unknown> {
    const iv = this.fromBase64Url(cipher.iv);
    const ivCopy = new Uint8Array(new ArrayBuffer(iv.byteLength));
    ivCopy.set(iv);
    const data = this.fromBase64Url(cipher.ct);
    const cipherCopy = new Uint8Array(new ArrayBuffer(data.byteLength));
    cipherCopy.set(data);
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivCopy },
      key,
      cipherCopy
    );

    const text = new TextDecoder().decode(plainBuffer);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('storage decrypt produced non-JSON payload');
    }
  }

  private toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private fromBase64Url(text: string): Uint8Array {
    const raw = String(text ?? '');
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
}
