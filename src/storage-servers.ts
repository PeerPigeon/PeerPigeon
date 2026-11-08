/**
 * Storage servers: PeerPigeon peers that keep a room's storage for it, the way
 * relays keep its signaling. A server announces the role 'storage' in one
 * well-known scope; relays list it with that role, so every peer, in any app
 * or room, finds the servers there (its own relay's first, as with relays) and
 * links to them over WebRTC. Relays carry signaling only.
 *
 * Placement is Kademlia's: a room's records live on the STORAGE_REPLICAS
 * servers whose ids are closest (XOR of SHA-256) to the room's id, and a
 * server that joins or leaves moves them to whichever servers are now closest.
 *
 * A server learns nothing of what it keeps. The room's id, each record's slot
 * and space tag are hashes of the room's sync secret; each record is the
 * room-encrypted storage mutation itself. A write carries a token derived from
 * that secret: the server keeps its hash on the first write and takes later
 * writes to the slot only with it, so nobody outside the room can overwrite a
 * slot, and a frozen slot is never overwritten at all.
 */
import { verifyMessage } from 'unsea';
import type { PeerPigeonNode } from './index.js';

export const STORAGE_SERVER_NETWORK = 'peerpigeon-storage';
export const STORAGE_SERVER_ROOM = 'servers';
export const STORAGE_SERVER_ROLE = 'storage';
/** Servers per room. */
export const STORAGE_REPLICAS = 3;

const REQUEST_TIMEOUT_MS = 4_000;
/** A blob is larger: allow for a busy link. */
const BLOB_TIMEOUT_MS = 20_000;
/** Records per message, and roughly bytes, so one stays well under a data channel's limit. */
const BATCH_RECORDS = 64;
const BATCH_BYTES = 96 * 1024;
const PP = 'pp-ss-v1';

/** One record as a server keeps it. Every field is a hash or ciphertext, except `at` and `once`. */
export interface ServerRecord {
  /** sha256 of the room's secret: which room. */
  room: string;
  /** sha256 of the room's secret, space and key: which record. */
  slot: string;
  /** sha256 of the room's secret and space (16 hex): which space, for listing. */
  tag: string;
  /** When it was written (the mutation's timestamp, ms): a newer one replaces it. */
  at: number;
  /** The room-encrypted mutation. */
  blob: unknown;
  /** sha256 of the slot's write token. */
  wh: string;
  /** Write-once (frozen). */
  once?: boolean;
  /** A user record's owner (its signing key): only writes it signs replace it. */
  owner?: string;
  /** The owner's signature of ownerText(this record). */
  osig?: string;
}

/** What an owner signs for a server: the record's place, time and ciphertext, nothing it could read. */
export async function ownerText(rec: Pick<ServerRecord, 'room' | 'slot' | 'at' | 'blob'>): Promise<string> {
  return `pp-ss-owner-v1:${rec.room}:${rec.slot}:${rec.at}:${await sha256Hex(JSON.stringify(rec.blob))}`;
}

/** Whether a record's owner signature holds (a record without an owner needs none). */
async function ownerSigned(rec: Omit<ServerRecord, 'wh'>): Promise<boolean> {
  if (rec.owner === undefined && rec.osig === undefined) return true;
  if (typeof rec.owner !== 'string' || typeof rec.osig !== 'string') return false;
  try { return await verifyMessage(await ownerText(rec), rec.osig, rec.owner); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Blobs: content kept on servers by what it is (a file's chunk, a model's
// part), sealed so that a server cannot read it and identical content is kept
// once wherever it comes from. Whoever knows a blob's SHA-256 (from a manifest
// it was given) can find it, open it and check it; nobody else can.
// ---------------------------------------------------------------------------

/** Largest blob: one message, base64, under a data channel's limit. */
export const MAX_BLOB_BYTES = 160 * 1024;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function blobKey(hash: string): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const key = await globalThis.crypto.subtle.importKey('raw', hexBytes(await sha256Hex(`pp-blob-key-v1:${hash}`)) as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, iv: hexBytes(await sha256Hex(`pp-blob-iv-v1:${hash}`)).slice(0, 12) };
}

/** Where a blob with this SHA-256 is kept (what servers see). */
export function blobAddress(hash: string): Promise<string> {
  return sha256Hex(`pp-blob-addr-v1:${hash}`);
}

/** Seals content for the servers: its address, and the bytes a server keeps. */
export async function sealBlob(bytes: Uint8Array): Promise<{ hash: string; address: string; sealed: Uint8Array }> {
  const hash = await sha256Bytes(bytes);
  const { key, iv } = await blobKey(hash);
  const sealed = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, bytes as Uint8Array<ArrayBuffer>));
  return { hash, address: await blobAddress(hash), sealed };
}

/** Opens a sealed blob; null unless it is the content with that SHA-256. */
export async function openBlob(hash: string, sealed: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { key, iv } = await blobKey(hash);
    const bytes = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, sealed as Uint8Array<ArrayBuffer>));
    return (await sha256Bytes(bytes)) === hash ? bytes : null;
  } catch {
    return null;
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

type Msg =
  | { pp: typeof PP; t: 'put'; req: string; rec: Omit<ServerRecord, 'wh'>; write: string }
  | { pp: typeof PP; t: 'ack'; req: string; ok: boolean; at?: number; why?: string }
  | { pp: typeof PP; t: 'get'; req: string; room: string; slot: string }
  | { pp: typeof PP; t: 'got'; req: string; rec: Omit<ServerRecord, 'wh'> | null }
  | { pp: typeof PP; t: 'list'; req: string; room: string; tag?: string }
  | { pp: typeof PP; t: 'listed'; req: string; recs: Omit<ServerRecord, 'wh'>[]; more: boolean }
  | { pp: typeof PP; t: 'watch'; room: string }
  | { pp: typeof PP; t: 'changed'; rec: Omit<ServerRecord, 'wh'> }
  | { pp: typeof PP; t: 'sync'; recs: ServerRecord[] }
  // A blob goes as base64 ('d'), or as bytes ('bytes': sent by sendBytes, to one that reads them).
  | { pp: typeof PP; t: 'bput'; req?: string; addr: string; d?: string; bytes?: Uint8Array }
  | { pp: typeof PP; t: 'back'; req: string; ok: boolean; bytes?: Uint8Array }
  // bin: the asker reads bytes (the answer may come as bytes).
  | { pp: typeof PP; t: 'bget'; req: string; addr: string; bin?: 1 }
  | { pp: typeof PP; t: 'bgot'; req: string; d?: string | null; bytes?: Uint8Array };

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** XOR distance between two hex ids, as a bigint. */
export function xorDistance(a: string, b: string): bigint {
  return BigInt(`0x${a.startsWith('o') ? a.slice(1) : a}`) ^ BigInt(`0x${b.startsWith('o') ? b.slice(1) : b}`);
}

/**
 * A room only one key writes to (a person's own records): 'o' and the hash of that key. A server
 * takes a record for it only when the record carries that key as its owner, signed by it; so
 * nobody else, knowing the key or not, can put anything in it.
 */
export async function ownedRoomOf(owner: string): Promise<string> {
  return `o${await sha256Hex(`pp-ss-owned-room-v1:${owner}`)}`;
}

/** A room id: 64 hex (a shared room), or 'o' and 64 hex (an owned room). */
export function validRoom(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const id: string = v;
  return /^o?[0-9a-f]{64}$/.test(id);
}

/** The `count` ids (of `ids`, by their sha256 `hashed`) closest to `target`. */
export function closestIds(target: string, ids: Iterable<string>, hashed: Map<string, string>, count = STORAGE_REPLICAS): string[] {
  return [...ids]
    .filter((id) => hashed.has(id))
    .map((id) => ({ id, d: xorDistance(hashed.get(id)!, target) }))
    .sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0))
    .slice(0, count)
    .map((x) => x.id);
}

const strip = ({ wh: _wh, ...rec }: ServerRecord): Omit<ServerRecord, 'wh'> => rec;

function isMsg(data: unknown): data is Msg {
  return !!data && typeof data === 'object' && (data as { pp?: unknown }).pp === PP && typeof (data as { t?: unknown }).t === 'string';
}

function validId(v: unknown, len = 64): v is string {
  return typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v);
}

function validRecord(rec: unknown): rec is Omit<ServerRecord, 'wh'> {
  const r = rec as ServerRecord;
  return !!r && validRoom(r.room) && validId(r.slot) && validId(r.tag, 16) && Number.isFinite(r.at) && r.blob !== undefined;
}

/** Splits records into batches small enough for one message each. */
function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (cur.length && (cur.length >= BATCH_RECORDS || bytes + size > BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(item);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Sends again until the channel takes it (its buffer drains) or the peer is gone; up to 15 s. */
async function sendLater(node: PeerPigeonNode, peerId: string, msg: unknown): Promise<boolean> {
  for (let wait = 50, spent = 0; spent < 15_000; spent += wait, wait = Math.min(500, wait * 2)) {
    await new Promise((r) => setTimeout(r, wait));
    if (!node.getConnectedPeers().includes(peerId)) return false;
    if (node.sendDirect(peerId, msg) !== null) return true;
  }
  return false;
}

/**
 * Bytes to a linked peer (sendBytes), now or, while its send buffer is full (many blobs at once), as soon
 * as it drains: still as bytes. False when the peer is not linked (send base64 instead) or it never drains.
 */
async function sendBytesSoon(node: PeerPigeonNode, peerId: string, meta: Record<string, unknown>, bytes: Uint8Array): Promise<boolean> {
  if (node.sendBytes(peerId, meta, bytes)) return true;
  for (let wait = 10, spent = 0; spent < 15_000; spent += wait, wait = Math.min(200, wait * 2)) {
    await new Promise((r) => setTimeout(r, wait));
    if (!node.getConnectedPeers().includes(peerId)) return false;
    if (node.sendBytes(peerId, meta, bytes)) return true;
  }
  return false;
}

let reqCounter = 0;
const newReq = () => `${Date.now().toString(36)}-${(reqCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// The client side: a peer's link to the servers.
// ---------------------------------------------------------------------------

type LinkListener = (event: { type: 'servers'; room: string; servers: string[] } | { type: 'changed'; rec: Omit<ServerRecord, 'wh'> }) => void;

/**
 * A peer's link to the storage servers: a small PeerPigeon node in the
 * servers' scope that dials no one on its own, only the servers closest to the
 * rooms it keeps.
 */
export class StorageServerLink {
  private readonly hashed = new Map<string, string>();
  private readonly pending = new Map<string, { resolve: (m: Msg | null) => void; timer: ReturnType<typeof setTimeout>; from: string }>();
  /** Servers that have sent us bytes (a blob, as bytes): they read them too. */
  private readonly readsBytes = new Set<string>();
  private readonly listings = new Map<string, Omit<ServerRecord, 'wh'>[]>();
  private readonly rooms = new Map<string, string[]>();
  private readonly listeners = new Set<LinkListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly node: PeerPigeonNode) {
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) this.onMessage(m.fromPeerId, m.data); });
    node.on('peerConnected', () => void this.refresh());
    node.on('peerDisconnected', (peerId) => { this.failPending(peerId); void this.refresh(); });
    // A server listed by the relay is dialled at once, not at the next look.
    (node as { mesh?: { on?: (e: string, cb: () => void) => void } }).mesh?.on?.('peer:discovered', () => void this.refresh());
  }

  async start(): Promise<void> {
    await this.node.start();
    this.timer = setInterval(() => void this.refresh(), 2_000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.pending.clear();
    await this.node.destroy().catch(() => {});
  }

  on(listener: LinkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Keep this room: link to its closest servers, and hear of changes to it. */
  keep(room: string): void {
    if (!this.rooms.has(room)) this.rooms.set(room, []);
    void this.refresh();
  }

  /** The linked servers that keep this room, closest first. */
  serversFor(room: string): string[] {
    return this.rooms.get(room) ?? [];
  }

  /** Every server listed in the servers' scope. */
  async knownServers(): Promise<string[]> {
    const ids = new Set<string>();
    for (const id of [...this.node.getDiscoveredPeers(), ...this.node.getConnectedPeers()]) {
      if (this.node.getPeerRole(id) === STORAGE_SERVER_ROLE) ids.add(id);
    }
    for (const id of ids) if (!this.hashed.has(id)) this.hashed.set(id, await sha256Hex(id));
    return [...ids];
  }

  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  /** Looks again at the servers; one asked for while a look is under way runs after it. */
  private refresh(): Promise<void> {
    if (this.refreshing) { this.refreshAgain = true; return this.refreshing; }
    return (this.refreshing = (async () => {
      do { this.refreshAgain = false; await this.refreshNow().catch(() => {}); } while (this.refreshAgain && !this.closed);
    })().finally(() => { this.refreshing = null; }));
  }

  private async refreshNow(): Promise<void> {
    if (this.closed) return;
    const known = await this.knownServers();
    const linked = new Set(this.node.getConnectedPeers());
    const wanted = new Set<string>();
    for (const [room, before] of this.rooms) {
      const closest = closestIds(room, known, this.hashed);
      for (const id of closest) { wanted.add(id); if (!linked.has(id)) this.node.connectToPeer(id); }
      const now = closest.filter((id) => linked.has(id));
      const fresh = now.filter((id) => !before.includes(id));
      this.rooms.set(room, now);
      for (const id of fresh) this.send(id, { pp: PP, t: 'watch', room });
      if (fresh.length || now.length !== before.length) this.emit({ type: 'servers', room, servers: now });
    }
  }

  private emit(event: Parameters<LinkListener>[0]): void {
    for (const l of this.listeners) { try { l(event); } catch { /* a listener's own trouble */ } }
  }

  private send(peerId: string, msg: Msg): boolean {
    if (this.node.sendDirect(peerId, msg) !== null) return true;
    // Refused now (most often a full send buffer: blobs are large): again shortly, for a while.
    void sendLater(this.node, peerId, msg);
    return true;
  }

  private ask(peerId: string, msg: Msg & { req: string }, timeoutMs = REQUEST_TIMEOUT_MS, bytes?: Uint8Array): Promise<Msg | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(msg.req); this.listings.delete(msg.req); resolve(null); }, timeoutMs);
      this.pending.set(msg.req, { resolve, timer, from: peerId });
      // With bytes: as one binary frame to the (linked) server, waiting for a full send buffer to drain;
      // not linked, as base64 instead.
      if (bytes) {
        void sendBytesSoon(this.node, peerId, msg, bytes).then((ok) => { if (!ok) this.send(peerId, { ...msg, d: toB64(bytes) } as Msg); });
        return;
      }
      if (!this.send(peerId, msg)) { clearTimeout(timer); this.pending.delete(msg.req); resolve(null); }
    });
  }

  private failPending(peerId: string): void {
    for (const [req, p] of this.pending) if (p.from === peerId) { clearTimeout(p.timer); this.pending.delete(req); this.listings.delete(req); p.resolve(null); }
  }

  private onMessage(from: string, data: unknown): void {
    if (!isMsg(data)) return;
    if (data.t === 'changed') {
      if (validRecord(data.rec)) this.emit({ type: 'changed', rec: data.rec });
      return;
    }
    if (data.t === 'listed') {
      const got = this.listings.get(data.req) ?? [];
      got.push(...(Array.isArray(data.recs) ? data.recs.filter(validRecord) : []));
      if (data.more) { this.listings.set(data.req, got); return; }
      this.listings.delete(data.req);
      const p = this.pending.get(data.req);
      if (p && p.from === from) { clearTimeout(p.timer); this.pending.delete(data.req); p.resolve({ ...data, recs: got }); }
      return;
    }
    if (data.t === 'ack' || data.t === 'got' || data.t === 'back' || data.t === 'bgot') {
      if ('bytes' in data && data.bytes instanceof Uint8Array) this.readsBytes.add(from);
      const p = this.pending.get(data.req);
      if (p && p.from === from) { clearTimeout(p.timer); this.pending.delete(data.req); p.resolve(data); }
    }
  }

  /** Writes a record to the room's servers; resolves with how many took it. */
  async put(rec: Omit<ServerRecord, 'wh'>, write: string): Promise<number> {
    const servers = this.serversFor(rec.room);
    const acks = await Promise.all(servers.map((id) => this.ask(id, { pp: PP, t: 'put', req: newReq(), rec, write })));
    return acks.filter((a) => a?.t === 'ack' && a.ok).length;
  }

  /** The newest copy of a record the room's servers hold, or null. */
  async get(room: string, slot: string): Promise<Omit<ServerRecord, 'wh'> | null> {
    const answers = await Promise.all(this.serversFor(room).map((id) => this.ask(id, { pp: PP, t: 'get', req: newReq(), room, slot })));
    let best: Omit<ServerRecord, 'wh'> | null = null;
    for (const a of answers) if (a?.t === 'got' && a.rec && validRecord(a.rec) && a.rec.slot === slot && (!best || a.rec.at > best.at)) best = a.rec;
    return best;
  }

  /** The servers closest to a blob's address, linked (waits up to `waitMs` for new links). */
  private async serversForBlob(address: string, waitMs = 4_000): Promise<string[]> {
    const closest = closestIds(address, await this.knownServers(), this.hashed);
    const linked = () => closest.filter((id) => this.node.getConnectedPeers().includes(id));
    for (const id of closest) if (!this.node.getConnectedPeers().includes(id)) this.node.connectToPeer(id);
    const until = Date.now() + waitMs;
    while (!linked().length && closest.length && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    return linked();
  }

  /** Whether any server is known in the scope (linked or not). */
  async hasServers(): Promise<boolean> {
    return (await this.knownServers()).length > 0;
  }

  /** Keeps content on the servers closest to it; resolves with how many took it. */
  async putBlob(bytes: Uint8Array): Promise<number> {
    if (bytes.length > MAX_BLOB_BYTES) throw new Error(`a blob is at most ${MAX_BLOB_BYTES} bytes`);
    const { address, sealed } = await sealBlob(bytes);
    let d: string | null = null;
    const acks = await Promise.all((await this.serversForBlob(address)).map((id) => {
      const req = newReq();
      // A server that has sent us bytes reads them too: the blob as bytes (no base64).
      if (this.readsBytes.has(id)) return this.ask(id, { pp: PP, t: 'bput', req, addr: address }, BLOB_TIMEOUT_MS, sealed);
      return this.ask(id, { pp: PP, t: 'bput', req, addr: address, d: (d ??= toB64(sealed)) }, BLOB_TIMEOUT_MS);
    }));
    return acks.filter((a) => a?.t === 'back' && a.ok).length;
  }

  /** Content by its SHA-256 from the servers, checked; null if none has it. */
  async getBlob(hash: string): Promise<Uint8Array | null> {
    const address = await blobAddress(hash);
    for (const id of await this.serversForBlob(address)) {
      // bin: we read bytes; a server that does answers with them, one that doesn't with base64 ('d').
      const a = await this.ask(id, { pp: PP, t: 'bget', req: newReq(), addr: address, bin: 1 }, BLOB_TIMEOUT_MS);
      const sealed = a?.t !== 'bgot' ? null : a.bytes instanceof Uint8Array ? a.bytes : typeof a.d === 'string' ? fromB64(a.d) : null;
      if (sealed) {
        const bytes = await openBlob(hash, sealed);
        if (bytes) return bytes;
      }
    }
    return null;
  }

  /** Every record the room's servers hold (of one space, with `tag`), the newest copy of each. */
  async list(room: string, tag?: string): Promise<Omit<ServerRecord, 'wh'>[]> {
    const answers = await Promise.all(this.serversFor(room).map((id) => {
      const req = newReq();
      this.listings.set(req, []);
      return this.ask(id, { pp: PP, t: 'list', req, room, ...(tag ? { tag } : {}) });
    }));
    const best = new Map<string, Omit<ServerRecord, 'wh'>>();
    for (const a of answers) {
      if (a?.t !== 'listed') continue;
      for (const r of a.recs) if (r.room === room && (!tag || r.tag === tag) && (best.get(r.slot)?.at ?? -1) < r.at) best.set(r.slot, r);
    }
    return [...best.values()];
  }
}

// ---------------------------------------------------------------------------
// The server side.
// ---------------------------------------------------------------------------

/** Where a server keeps records: memory by default, a disk or a database in a real server. */
export interface ServerRecordStore {
  get(room: string, slot: string): Promise<ServerRecord | null>;
  put(rec: ServerRecord): Promise<void>;
  list(room: string, tag?: string): Promise<ServerRecord[]>;
  rooms(): Promise<string[]>;
  /** Sealed blobs by address (a store without them keeps records only). */
  getBlob?(address: string): Promise<Uint8Array | null>;
  putBlob?(address: string, sealed: Uint8Array): Promise<void>;
  blobs?(): Promise<string[]>;
  blobUsage?(): Promise<{ count: number; bytes: number }>;
}

export class MemoryServerRecordStore implements ServerRecordStore {
  private readonly byRoom = new Map<string, Map<string, ServerRecord>>();
  async get(room: string, slot: string) { return this.byRoom.get(room)?.get(slot) ?? null; }
  async put(rec: ServerRecord) {
    let m = this.byRoom.get(rec.room);
    if (!m) this.byRoom.set(rec.room, (m = new Map()));
    m.set(rec.slot, rec);
  }
  async list(room: string, tag?: string) { return [...(this.byRoom.get(room)?.values() ?? [])].filter((r) => !tag || r.tag === tag); }
  async rooms() { return [...this.byRoom.keys()]; }
  private readonly blobMap = new Map<string, Uint8Array>();
  async getBlob(address: string) { return this.blobMap.get(address) ?? null; }
  async putBlob(address: string, sealed: Uint8Array) { this.blobMap.set(address, sealed); }
  async blobs() { return [...this.blobMap.keys()]; }
  async blobUsage() { let bytes = 0; for (const b of this.blobMap.values()) bytes += b.length; return { count: this.blobMap.size, bytes }; }
}

export interface StorageServerStats {
  rooms: number;
  records: number;
  blobs: number;
  blobBytes: number;
  servers: number;
  clients: number;
}

/**
 * A storage server: keeps the records of the rooms it is among the closest
 * servers for, answers the peers linked to it, tells the peers watching a room
 * what changed in it, and hands each room's records to whichever servers are
 * closest to it as servers come and go.
 */
export class StorageServer {
  private readonly hashed = new Map<string, string>();
  private readonly watchers = new Map<string, Set<string>>();
  /** For each room: the servers last given its records. */
  private readonly placed = new Map<string, string[]>();
  /** For each blob: the servers last given it. */
  private readonly placedBlobs = new Map<string, string[]>();
  private selfHash = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChange: ((rec: ServerRecord) => void) | null = null;

  constructor(private readonly node: PeerPigeonNode, private readonly store: ServerRecordStore = new MemoryServerRecordStore()) {
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) void this.onMessage(m.fromPeerId, m.data).catch(() => {}); });
    node.on('peerConnected', () => void this.rebalance());
    node.on('peerDisconnected', (peerId) => { for (const w of this.watchers.values()) w.delete(peerId); void this.rebalance(); });
    (node as { mesh?: { on?: (e: string, cb: () => void) => void } }).mesh?.on?.('peer:discovered', () => void this.rebalance());
  }

  /** Called with each record this server takes (a write, or one handed to it). */
  onRecord(listener: (rec: ServerRecord) => void): void { this.onChange = listener; }

  async start(): Promise<void> {
    await this.node.start();
    this.timer = setInterval(() => void this.rebalance(), 10_000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.node.destroy().catch(() => {});
  }

  async stats(): Promise<StorageServerStats> {
    const rooms = await this.store.rooms();
    let records = 0;
    for (const room of rooms) records += (await this.store.list(room)).length;
    const linked = this.node.getConnectedPeers();
    const servers = linked.filter((id) => this.node.getPeerRole(id) === STORAGE_SERVER_ROLE).length;
    const b = (await this.store.blobUsage?.()) ?? { count: 0, bytes: 0 };
    return { rooms: rooms.length, records, blobs: b.count, blobBytes: b.bytes, servers, clients: linked.length - servers };
  }

  private async self(): Promise<string> {
    const id = this.node.getClientId() ?? '';
    if (id && !this.hashed.has(id)) this.hashed.set(id, await sha256Hex(id));
    this.selfHash = this.hashed.get(id) ?? '';
    return id;
  }

  /** Every server known in the scope, this one included. */
  private async servers(): Promise<string[]> {
    const ids = new Set<string>();
    const selfId = await this.self();
    if (selfId) ids.add(selfId);
    for (const id of [...this.node.getDiscoveredPeers(), ...this.node.getConnectedPeers()]) {
      if (this.node.getPeerRole(id) === STORAGE_SERVER_ROLE) ids.add(id);
    }
    for (const id of ids) if (!this.hashed.has(id)) this.hashed.set(id, await sha256Hex(id));
    return [...ids];
  }

  private send(peerId: string, msg: Msg): boolean {
    if (this.node.sendDirect(peerId, msg) !== null) return true;
    // Refused now (most often a full send buffer: blobs are large): again shortly, for a while.
    void sendLater(this.node, peerId, msg);
    return true;
  }

  /** Takes a record if it is new or newer, and its write token (or hash) is the slot's. */
  private async take(rec: ServerRecord): Promise<{ ok: boolean; why?: string }> {
    if (!(await ownerSigned(rec))) return { ok: false, why: 'bad-signature' };
    // An owned room takes only its owner's records (signed: checked just above).
    if (rec.room.startsWith('o') && (typeof rec.owner !== 'string' || (await ownedRoomOf(rec.owner)) !== rec.room)) return { ok: false, why: 'not-owner' };
    const have = await this.store.get(rec.room, rec.slot);
    if (have) {
      if (have.wh !== rec.wh) return { ok: false, why: 'not-yours' };
      // A user record's owner is whoever wrote it first; only that key replaces it.
      if (have.owner !== undefined && have.owner !== rec.owner) return { ok: false, why: 'not-owner' };
      if (have.once) return { ok: have.at === rec.at, ...(have.at === rec.at ? {} : { why: 'frozen' }) };
      if (have.at >= rec.at) return { ok: true }; // as new already: nothing to do
    }
    await this.store.put(rec);
    this.onChange?.(rec);
    return { ok: true };
  }

  private async onMessage(from: string, data: unknown): Promise<void> {
    if (!isMsg(data)) return;
    switch (data.t) {
      case 'put': {
        if (!validRecord(data.rec) || !validId(data.write)) return void this.send(from, { pp: PP, t: 'ack', req: data.req, ok: false, why: 'bad' });
        const rec: ServerRecord = {
          room: data.rec.room, slot: data.rec.slot, tag: data.rec.tag, at: data.rec.at, blob: data.rec.blob, wh: await sha256Hex(data.write),
          ...(data.rec.once ? { once: true } : {}),
          ...(typeof data.rec.owner === 'string' ? { owner: data.rec.owner, osig: String(data.rec.osig ?? '') } : {}),
        };
        const before = await this.store.get(rec.room, rec.slot);
        const result = await this.take(rec);
        this.send(from, { pp: PP, t: 'ack', req: data.req, ...result, at: rec.at });
        if (result.ok && (!before || before.at < rec.at)) {
          for (const peer of this.watchers.get(rec.room) ?? []) if (peer !== from) this.send(peer, { pp: PP, t: 'changed', rec: strip(rec) });
          // The room's other closest servers get it at once.
          const closest = closestIds(rec.room, await this.servers(), this.hashed).filter((id) => id !== this.node.getClientId());
          for (const id of closest) this.send(id, { pp: PP, t: 'sync', recs: [rec] });
        }
        return;
      }
      case 'get': {
        const rec = validRoom(data.room) && validId(data.slot) ? await this.store.get(data.room, data.slot) : null;
        this.send(from, { pp: PP, t: 'got', req: data.req, rec: rec ? strip(rec) : null });
        return;
      }
      case 'list': {
        const recs = validRoom(data.room) ? (await this.store.list(data.room, typeof data.tag === 'string' ? data.tag : undefined)).map(strip) : [];
        const parts = batches(recs);
        if (!parts.length) parts.push([]);
        parts.forEach((part, i) => this.send(from, { pp: PP, t: 'listed', req: data.req, recs: part, more: i < parts.length - 1 }));
        return;
      }
      case 'watch': {
        if (!validRoom(data.room)) return;
        let w = this.watchers.get(data.room);
        if (!w) this.watchers.set(data.room, (w = new Set()));
        w.add(from);
        return;
      }
      case 'bput': {
        // A blob, from a peer or another server (as bytes, or base64 in 'd'): kept if it fits, and passed
        // to the other closest servers.
        const sealed = data.bytes instanceof Uint8Array ? data.bytes : typeof data.d === 'string' && data.d.length <= Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 64 ? fromB64(data.d) : null;
        const ok = !!this.store.putBlob && validId(data.addr) && !!sealed && sealed.length <= MAX_BLOB_BYTES + 64;
        if (ok) {
          const have = await this.store.getBlob!(data.addr);
          if (!have) {
            await this.store.putBlob!(data.addr, sealed!);
            if (this.node.getPeerRole(from) !== STORAGE_SERVER_ROLE) {
              const selfId = this.node.getClientId();
              for (const id of closestIds(data.addr, await this.servers(), this.hashed)) {
                if (id !== selfId && id !== from && this.node.getConnectedPeers().includes(id)) this.send(id, { pp: PP, t: 'bput', addr: data.addr, d: typeof data.d === 'string' ? data.d : toB64(sealed!) });
              }
            }
          }
        }
        if (data.req) this.send(from, { pp: PP, t: 'back', req: data.req, ok });
        return;
      }
      case 'bget': {
        const sealed = validId(data.addr) && this.store.getBlob ? await this.store.getBlob(data.addr) : null;
        // Asked by one that reads bytes (bin): as bytes, in one binary frame; else (or not linked) base64.
        if (sealed && data.bin && await sendBytesSoon(this.node, from, { pp: PP, t: 'bgot', req: data.req }, sealed)) return;
        this.send(from, { pp: PP, t: 'bgot', req: data.req, d: sealed ? toB64(sealed) : null });
        return;
      }
      case 'sync': {
        // Only from another server, of records it holds.
        if (this.node.getPeerRole(from) !== STORAGE_SERVER_ROLE || !Array.isArray(data.recs)) return;
        for (const rec of data.recs) {
          if (!validRecord(rec) || !validId((rec as ServerRecord).wh)) continue;
          const before = await this.store.get(rec.room, rec.slot);
          const result = await this.take(rec);
          if (result.ok && (!before || before.at < rec.at)) {
            for (const peer of this.watchers.get(rec.room) ?? []) this.send(peer, { pp: PP, t: 'changed', rec: strip(rec) });
          }
        }
        return;
      }
    }
  }

  private rebalancing: Promise<void> | null = null;
  private rebalanceAgain = false;
  rebalance(): Promise<void> {
    if (this.rebalancing) { this.rebalanceAgain = true; return this.rebalancing; }
    return (this.rebalancing = (async () => {
      do { this.rebalanceAgain = false; await this.rebalanceNow().catch(() => {}); } while (this.rebalanceAgain);
    })().finally(() => { this.rebalancing = null; }));
  }

  /**
   * Hands each room's records to the servers now closest to it that were not
   * given them yet: a server that joins gets the rooms it is now closest for,
   * and when one leaves, the next closest gets its rooms.
   */
  private async rebalanceNow(): Promise<void> {
    const servers = await this.servers();
    const selfId = this.node.getClientId();
    const linked = new Set(this.node.getConnectedPeers());
    for (const room of await this.store.rooms()) {
      const closest = closestIds(room, servers, this.hashed).filter((id) => id !== selfId);
      const given = this.placed.get(room) ?? [];
      const todo = closest.filter((id) => !given.includes(id));
      if (!todo.length) continue;
      const recs = await this.store.list(room);
      const done: string[] = [];
      for (const id of todo) {
        if (!linked.has(id)) { this.node.connectToPeer(id); continue; }
        for (const part of batches(recs)) this.send(id, { pp: PP, t: 'sync', recs: part });
        done.push(id);
      }
      this.placed.set(room, [...given.filter((id) => closest.includes(id)), ...done]);
    }
    // Blobs: each to the closest servers it was not given yet.
    if (this.store.blobs && this.store.getBlob) {
      for (const addr of await this.store.blobs()) {
        const closest = closestIds(addr, servers, this.hashed).filter((id) => id !== selfId);
        const given = this.placedBlobs.get(addr) ?? [];
        const todo = closest.filter((id) => !given.includes(id) && linked.has(id));
        if (!todo.length) continue;
        const sealed = await this.store.getBlob(addr);
        if (!sealed) continue;
        const d = toB64(sealed);
        for (const id of todo) this.send(id, { pp: PP, t: 'bput', addr, d });
        this.placedBlobs.set(addr, [...given.filter((id) => closest.includes(id)), ...todo]);
      }
    }
  }
}
