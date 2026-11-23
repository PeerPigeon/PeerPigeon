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
import { subtle } from './subtle.js';
import { RoomStats, packPoints, unpackPoints, MINUTE_MS, type RoomStatsStore, type RoomStatsPoint } from './room-stats.js';
import type { PeerPigeonNode } from './index.js';

export const STORAGE_SERVER_NETWORK = 'peerpigeon-storage';
export const STORAGE_SERVER_ROOM = 'servers';
export const STORAGE_SERVER_ROLE = 'storage';
/** Servers per room. */
export const STORAGE_REPLICAS = 3;

const REQUEST_TIMEOUT_MS = 4_000;
/** A blob is larger: allow for a busy link. */
const BLOB_TIMEOUT_MS = 20_000;
/** How long a server keeps trying to send a blob as bytes before it sends it as base64. */
const BYTES_WAIT_MS = 1_500;
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
  const digest = await subtle().digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function blobKey(hash: string): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const key = await subtle().importKey('raw', hexBytes(await sha256Hex(`pp-blob-key-v1:${hash}`)) as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
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
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, bytes as Uint8Array<ArrayBuffer>));
  return { hash, address: await blobAddress(hash), sealed };
}

/** Opens a sealed blob; null unless it is the content with that SHA-256. */
export async function openBlob(hash: string, sealed: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { key, iv } = await blobKey(hash);
    const bytes = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, sealed as Uint8Array<ArrayBuffer>));
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
  // v: who is watching, the same from visit to visit (a hash of their key and the room; see visitorOf).
  // r: its role in its own network (a bot's 'bot'), which the server cannot see from its own scope.
  | { pp: typeof PP; t: 'watch'; room: string; v?: string; r?: string }
  | { pp: typeof PP; t: 'changed'; rec: Omit<ServerRecord, 'wh'> }
  | { pp: typeof PP; t: 'sync'; recs: ServerRecord[] }
  // A blob goes as base64 ('d'), or as bytes ('bytes': sent by sendBytes, to one that reads them).
  | { pp: typeof PP; t: 'bput'; req?: string; addr: string; d?: string; bytes?: Uint8Array }
  | { pp: typeof PP; t: 'back'; req: string; ok: boolean; bytes?: Uint8Array }
  // bin: the asker reads bytes (the answer may come as bytes).
  | { pp: typeof PP; t: 'bget'; req: string; addr: string; bin?: 1 }
  | { pp: typeof PP; t: 'bgot'; req: string; d?: string | null; bytes?: Uint8Array }
  // Who runs a server, and (asked by that owner, signed) how it is doing: see statsText.
  | { pp: typeof PP; t: 'stats'; req: string; at?: number; sig?: string; by?: string; until?: number; gsig?: string }
  | { pp: typeof PP; t: 'statsr'; req: string; owner: string | null; stats?: StorageServerStats & { uptimeMs: number } }
  // The owner taking a pass back (or giving it back: restore), signed: see revokeText.
  | { pp: typeof PP; t: 'revoke'; req: string; member: string; at: number; sig: string; restore?: boolean }
  | { pp: typeof PP; t: 'revoked'; req: string; ok: boolean }
  // A room's history (how many were in it, over time), asked as stats are: by the owner or a pass.
  | { pp: typeof PP; t: 'roomstats'; req: string; room: string; from: number; to: number; at: number; sig: string; by?: string; until?: number; gsig?: string }
  | { pp: typeof PP; t: 'roomstatsr'; req: string; ok: boolean; step?: number; points?: unknown }
  // Following a room's history (asked as roomstats is; stop: no more): after each minute's count the server
  // sends the room's newest point in each step (roomnow), so a page showing it never has to ask again.
  | { pp: typeof PP; t: 'roomfollow'; req: string; room: string; at?: number; sig?: string; by?: string; until?: number; gsig?: string; stop?: boolean }
  | { pp: typeof PP; t: 'roomfollowed'; req: string; ok: boolean }
  // Following the server's own numbers (asked as stats is; stop: no more): it sends them (statsnow) when
  // they change, so the console's Storage page never has to ask again.
  | { pp: typeof PP; t: 'statsfollow'; req: string; at?: number; sig?: string; by?: string; until?: number; gsig?: string; stop?: boolean }
  | { pp: typeof PP; t: 'statsfollowed'; req: string; ok: boolean; startedAt?: number }
  | { pp: typeof PP; t: 'statsnow'; stats: StorageServerStats }
  | { pp: typeof PP; t: 'roomnow'; room: string; minute?: unknown; five?: unknown; hour?: unknown; day?: unknown };

export async function sha256Hex(text: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(text));
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
 * as it drains: still as bytes. False when the peer is not linked or bytes still can't go after a moment
 * (no data channel just now: a hidden tab, a link waiting on its keepalive, a peer reached through the
 * relay): the caller sends base64 then, which goes however the peer is reachable. Waiting longer here
 * held up every piece of a picture by as much.
 */
async function sendBytesSoon(node: PeerPigeonNode, peerId: string, meta: Record<string, unknown>, bytes: Uint8Array): Promise<boolean> {
  if (node.sendBytes(peerId, meta, bytes)) { noBytesTo.get(node)?.delete(peerId); return true; }
  // Bytes did not go to this peer a moment ago: base64 now, not another wait (the rest of a file's pieces).
  const until = noBytesTo.get(node)?.get(peerId) ?? 0;
  if (until > Date.now()) return false;
  for (let wait = 10, spent = 0; spent < BYTES_WAIT_MS; spent += wait, wait = Math.min(200, wait * 2)) {
    await new Promise((r) => setTimeout(r, wait));
    if (!node.getConnectedPeers().includes(peerId)) return false;
    if (node.sendBytes(peerId, meta, bytes)) return true;
  }
  let peers = noBytesTo.get(node);
  if (!peers) noBytesTo.set(node, (peers = new Map()));
  peers.set(peerId, Date.now() + NO_BYTES_MS);
  return false;
}
/** For each node: peers bytes could not be sent to lately, and until when to send them base64. */
const noBytesTo = new WeakMap<PeerPigeonNode, Map<string, number>>();
const NO_BYTES_MS = 30_000;

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
  private readonly visitors = new Map<string, string>();
  /** This peer's role in its own network (a bot's 'bot'), told to the servers with each watch. */
  role: string | null = null;
  private readonly listeners = new Set<LinkListener>();
  /** Servers whose own numbers this peer follows. */
  private readonly statsFollowing = new Map<string, (stats: StorageServerStats) => void>();
  /** What to call when a follow ends because the link to its server dropped, by server (and room). */
  private readonly followEnds = new Map<string, () => void>();

  private endFollowing(serverId: string): void {
    for (const [key, end] of [...this.followEnds]) {
      if (key !== serverId && !key.startsWith(`${serverId}:`)) continue;
      this.followEnds.delete(key);
      this.statsFollowing.delete(key);
      this.following.delete(key);
      try { end(); } catch { /* the listener's own trouble */ }
    }
  }
  /** Rooms whose history this peer follows, by server and room. */
  private readonly following = new Map<string, (now: RoomNow) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly node: PeerPigeonNode) {
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) this.onMessage(m.fromPeerId, m.data); });
    node.on('peerConnected', () => void this.refresh());
    node.on('peerDisconnected', (peerId) => { this.failPending(peerId); this.endFollowing(peerId); void this.refresh(); });
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

  /**
   * Keep this room: link to its closest servers, and hear of changes to it. `visitor` (see visitorOf) lets
   * the servers count the same person once, from visit to visit, though the peer id is new each time.
   */
  keep(room: string, visitor?: string): void {
    if (!this.rooms.has(room)) this.rooms.set(room, []);
    if (visitor) this.visitors.set(room, visitor);
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
      for (const id of fresh) this.send(id, { pp: PP, t: 'watch', room, ...(this.visitors.has(room) ? { v: this.visitors.get(room) } : {}), ...(this.role ? { r: this.role } : {}) });
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
    if (data.t === 'statsnow') {
      const f = this.statsFollowing.get(from);
      if (f && data.stats && typeof data.stats === 'object') { try { f(data.stats); } catch { /* the listener's own trouble */ } }
      return;
    }
    if (data.t === 'roomnow') {
      const f = this.following.get(`${from}:${data.room}`);
      if (f) {
        const one = (v: unknown) => unpackPoints(Array.isArray(v) ? [v] : [])[0] ?? null;
        try { f({ minute: one(data.minute), five: one(data.five), hour: one(data.hour), day: one(data.day) }); } catch { /* the listener's own trouble */ }
      }
      return;
    }
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
    if (data.t === 'ack' || data.t === 'got' || data.t === 'back' || data.t === 'bgot' || data.t === 'statsr' || data.t === 'revoked' || data.t === 'roomstatsr' || data.t === 'roomfollowed' || data.t === 'statsfollowed') {
      if ('bytes' in data && data.bytes instanceof Uint8Array) this.readsBytes.add(from);
      const p = this.pending.get(data.req);
      if (p && p.from === from) { clearTimeout(p.timer); this.pending.delete(data.req); p.resolve(data); }
    }
  }

  /**
   * Who runs a server, and its stats when `sign` (the owner's signer, given the text to sign) is that
   * owner's. Links to the server first if needed (waiting up to `waitMs`); null if it cannot be reached.
   */
  async serverStats(serverId: string, sign?: (text: string) => Promise<string>, waitMs = 6_000, pass?: StatsPass): Promise<{ owner: string | null; stats?: StorageServerStats & { uptimeMs: number } } | null> {
    if (!this.node.getConnectedPeers().includes(serverId)) {
      this.node.connectToPeer(serverId);
      const until = Date.now() + waitMs;
      while (!this.node.getConnectedPeers().includes(serverId) && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 100));
      if (!this.node.getConnectedPeers().includes(serverId)) return null;
    }
    const at = Date.now();
    const sig = sign ? await sign(statsText(serverId, at)).catch(() => undefined) : undefined;
    const answer = await this.ask(serverId, { pp: PP, t: 'stats', req: newReq(), ...(sig ? { at, sig } : {}), ...(sig && pass ? { by: pass.by, until: pass.until, gsig: pass.gsig } : {}) });
    if (answer?.t !== 'statsr') return null;
    const owner = typeof answer.owner === 'string' ? answer.owner : null;
    return answer.stats && typeof answer.stats === 'object' ? { owner, stats: answer.stats } : { owner };
  }

  /**
   * How many were in `room` (a storage room id) from `from` to `to`, as one server saw it, asked as the
   * owner or with the owner's pass (signed the same way as serverStats). Null if it cannot be reached or
   * the ask is refused.
   */
  async roomStats(serverId: string, room: string, from: number, to: number, sign: (text: string) => Promise<string>, pass?: StatsPass, waitMs = 6_000): Promise<{ step: number; points: RoomStatsPoint[] } | null> {
    if (!this.node.getConnectedPeers().includes(serverId)) {
      this.node.connectToPeer(serverId);
      const until = Date.now() + waitMs;
      while (!this.node.getConnectedPeers().includes(serverId) && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 100));
      if (!this.node.getConnectedPeers().includes(serverId)) return null;
    }
    const at = Date.now();
    const sig = await sign(statsText(serverId, at)).catch(() => null);
    if (!sig) return null;
    const answer = await this.ask(serverId, { pp: PP, t: 'roomstats', req: newReq(), room, from, to, at, sig, ...(pass ? { by: pass.by, until: pass.until, gsig: pass.gsig } : {}) });
    if (answer?.t !== 'roomstatsr' || !answer.ok || typeof answer.step !== 'number') return null;
    return { step: answer.step, points: unpackPoints(answer.points) };
  }

  /**
   * Follow a server's own numbers: `onStats` gets them now and again whenever they change. Asked as
   * serverStats is (the owner, or a pass). Resolves to { startedAt, stop }, or null if refused or not
   * reached. Ends by itself when the link to the server drops.
   */
  async followServerStats(serverId: string, sign: (text: string) => Promise<string>, onStats: (stats: StorageServerStats) => void, pass?: StatsPass, onEnd?: () => void, waitMs = 6_000): Promise<{ startedAt: number; stop: () => void } | null> {
    if (!this.node.getConnectedPeers().includes(serverId)) {
      this.node.connectToPeer(serverId);
      const until = Date.now() + waitMs;
      while (!this.node.getConnectedPeers().includes(serverId) && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 100));
      if (!this.node.getConnectedPeers().includes(serverId)) return null;
    }
    const at = Date.now();
    const sig = await sign(statsText(serverId, at)).catch(() => null);
    if (!sig) return null;
    this.statsFollowing.set(serverId, onStats);
    const answer = await this.ask(serverId, { pp: PP, t: 'statsfollow', req: newReq(), at, sig, ...(pass ? { by: pass.by, until: pass.until, gsig: pass.gsig } : {}) });
    if (answer?.t !== 'statsfollowed' || !answer.ok) { if (this.statsFollowing.get(serverId) === onStats) this.statsFollowing.delete(serverId); return null; }
    if (onEnd) this.followEnds.set(serverId, onEnd);
    return {
      startedAt: typeof answer.startedAt === 'number' ? answer.startedAt : Date.now(),
      stop: () => {
        if (this.statsFollowing.get(serverId) !== onStats) return;
        this.statsFollowing.delete(serverId);
        this.followEnds.delete(serverId);
        this.send(serverId, { pp: PP, t: 'statsfollow', req: newReq(), stop: true });
      },
    };
  }

  /**
   * Follow a room's history at a server: after each minute's count, `onNow` gets the room's newest point in
   * each step. Asked as roomStats is (the owner, or a pass). Resolves to a function that stops it, or null
   * if the server refused or could not be reached. Ends by itself when the link to the server drops.
   */
  async followRoomStats(serverId: string, room: string, sign: (text: string) => Promise<string>, onNow: (now: RoomNow) => void, pass?: StatsPass, waitMs = 6_000, onEnd?: () => void): Promise<(() => void) | null> {
    if (!this.node.getConnectedPeers().includes(serverId)) {
      this.node.connectToPeer(serverId);
      const until = Date.now() + waitMs;
      while (!this.node.getConnectedPeers().includes(serverId) && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 100));
      if (!this.node.getConnectedPeers().includes(serverId)) return null;
    }
    const at = Date.now();
    const sig = await sign(statsText(serverId, at)).catch(() => null);
    if (!sig) return null;
    const key = `${serverId}:${room}`;
    this.following.set(key, onNow);
    const answer = await this.ask(serverId, { pp: PP, t: 'roomfollow', req: newReq(), room, at, sig, ...(pass ? { by: pass.by, until: pass.until, gsig: pass.gsig } : {}) });
    if (answer?.t !== 'roomfollowed' || !answer.ok) { if (this.following.get(key) === onNow) this.following.delete(key); return null; }
    if (onEnd) this.followEnds.set(key, onEnd);
    return () => {
      if (this.following.get(key) !== onNow) return;
      this.following.delete(key);
      this.followEnds.delete(key);
      this.send(serverId, { pp: PP, t: 'roomfollow', req: newReq(), room, stop: true });
    };
  }

  /**
   * The owner takes `member`'s pass back at a server (restore: gives it back); `sign` signs as the owner.
   * Resolves true once the server has it, false if it refused or could not be reached.
   */
  async revokePass(serverId: string, member: string, sign: (text: string) => Promise<string>, restore = false, waitMs = 6_000): Promise<boolean> {
    if (!this.node.getConnectedPeers().includes(serverId)) {
      this.node.connectToPeer(serverId);
      const until = Date.now() + waitMs;
      while (!this.node.getConnectedPeers().includes(serverId) && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 100));
      if (!this.node.getConnectedPeers().includes(serverId)) return false;
    }
    const at = Date.now();
    const sig = await sign(revokeText(serverId, member, at, restore)).catch(() => null);
    if (!sig) return false;
    const answer = await this.ask(serverId, { pp: PP, t: 'revoke', req: newReq(), member, at, sig, ...(restore ? { restore: true } : {}) });
    return answer?.t === 'revoked' && answer.ok === true;
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

  /** Servers that answered this page's recent blob reads, newest first. */
  private readonly blobHolders: string[] = [];
  private heldBy(id: string): void {
    const at = this.blobHolders.indexOf(id);
    if (at !== 0) { if (at > 0) this.blobHolders.splice(at, 1); this.blobHolders.unshift(id); this.blobHolders.length = Math.min(this.blobHolders.length, 4); }
  }

  /** Content by its SHA-256 from the servers, checked; null if none has it. */
  async getBlob(hash: string): Promise<Uint8Array | null> {
    const address = await blobAddress(hash);
    // A page just opened may not know the servers yet: give it a moment to hear of them.
    for (const until = Date.now() + 4_000; !(await this.knownServers()).length && Date.now() < until;) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const asked = new Set<string>();
    const tryOn = async (id: string): Promise<Uint8Array | null> => {
      asked.add(id);
      // bin: we read bytes; a server that does answers with them, one that doesn't with base64 ('d').
      const a = await this.ask(id, { pp: PP, t: 'bget', req: newReq(), addr: address, bin: 1 }, BLOB_TIMEOUT_MS);
      const sealed = a?.t !== 'bgot' ? null : a.bytes instanceof Uint8Array ? a.bytes : typeof a.d === 'string' ? fromB64(a.d) : null;
      return sealed ? await openBlob(hash, sealed) : null;
    };
    // The servers that had this page's last blobs first (a file's pieces were kept together), then
    // the closest ones linked.
    const linkedNow = () => new Set(this.node.getConnectedPeers());
    for (const id of [...this.blobHolders].filter((id) => linkedNow().has(id))) {
      const bytes = await tryOn(id);
      if (bytes) { this.heldBy(id); return bytes; }
    }
    for (const id of await this.serversForBlob(address)) {
      if (asked.has(id)) continue;
      const bytes = await tryOn(id);
      if (bytes) { this.heldBy(id); return bytes; }
    }
    // Not on those (this page may know other servers than the writer did, or they have not been
    // given it yet): every other known server at once, each asked as soon as it is linked; the
    // first that has it answers.
    const rest = (await this.knownServers()).filter((id) => !asked.has(id));
    if (!rest.length) return null;
    for (const id of rest) if (!linkedNow().has(id)) this.node.connectToPeer(id);
    return await new Promise<Uint8Array | null>((resolve) => {
      let open = rest.length, done = false;
      const finish = (bytes: Uint8Array | null) => { if (!done && (bytes || --open === 0)) { done = true; resolve(bytes); } };
      for (const id of rest) {
        void (async () => {
          for (const until = Date.now() + 6_000; !linkedNow().has(id) && Date.now() < until && !done;) {
            await new Promise((r) => setTimeout(r, 100));
          }
          if (done || !linkedNow().has(id)) return finish(null);
          const bytes = await tryOn(id).catch(() => null);
          if (bytes) this.heldBy(id);
          finish(bytes);
        })();
      }
    });
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

/**
 * What a server's owner signs to ask it for its stats: the server's peer id and the time, so the ask is
 * good for that server only, for five minutes. Signed with the owner's P-256 key (an unsea signature).
 */
/**
 * Who someone is in a room, for counting them once from visit to visit (their peer id is new each time):
 * a hash of the room and their key, so a server cannot tell them in one room from another, nor who they are.
 */
export const visitorOf = (room: string, key: string): Promise<string> => sha256Hex(`peerpigeon:visitor:v1:${room}:${key}`);

export const statsText = (serverId: string, at: number): string => `pp-ss-stats-v1:${serverId}:${at}`;
const STATS_SKEW_MS = 5 * 60_000;

/**
 * A pass a server's owner gives someone on their team (console.peerpigeon.io): `member` may ask for the
 * stats as the owner may; `until` is 0 for a pass that holds until the owner takes it back, else a time
 * (ms). Signed by the owner; the member signs each ask itself.
 */
export const grantText = (owner: string, member: string, until: number): string => JSON.stringify(['pp-console-grant', 1, owner, member, until]);

/** What the owner signs to take a pass back from `member` at this server (restore: to give it back). */
export const revokeText = (serverId: string, member: string, at: number, restore: boolean): string => JSON.stringify(['pp-ss-revoke', 1, serverId, member, at, restore]);

/** A member's pass, sent with an ask. */
export interface StatsPass { by: string; until: number; gsig: string }

export interface StorageServerOptions {
  /**
   * The signing key of the account that runs this server (a PigeonIdP account's `pub`), or a function
   * giving it. Anyone can ask a server who its owner is; only the owner gets its stats.
   */
  owner?: string | null | (() => string | null);
  /**
   * Where the server keeps the keys whose passes its owner took back. Kept in memory when not given; a
   * server that restarts should keep them (PigeonFS: revoked.json in its folder).
   */
  revoked?: { has(member: string): boolean | Promise<boolean>; set(member: string, revoked: boolean): void | Promise<void> };
  /**
   * Where the server keeps its rooms' history: how many peers were in each room, a minute at a time (see
   * RoomStats). In memory when not given; PigeonFS keeps it in its folder.
   */
  roomStats?: RoomStatsStore;
}

/** A room's newest point in each step (see RoomStats.current), as a following page gets it. */
export interface RoomNow { minute: RoomStatsPoint | null; five: RoomStatsPoint | null; hour: RoomStatsPoint | null; day: RoomStatsPoint | null }

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
  /** For each room: the peers watching it, who each is (its visitor id, else the peer id), and its role. */
  private readonly watchers = new Map<string, Map<string, { who: string; role: string | null }>>();
  /** For each room: the servers last given its records. */
  private readonly placed = new Map<string, string[]>();
  /** For each blob: the servers last given it. */
  private readonly placedBlobs = new Map<string, string[]>();
  private selfHash = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChange: ((rec: ServerRecord) => void) | null = null;

  private readonly startedAt = Date.now();
  private readonly revoked: NonNullable<StorageServerOptions['revoked']>;
  private readonly history: RoomStats;
  /** The peers following this server's own numbers, and whose pass each came with (null: the owner's). */
  private readonly statsFollowers = new Map<string, string | null>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private statsSent = '';
  /** For each room: the peers following its history, and whose pass each came with (null: the owner's). */
  private readonly followers = new Map<string, Map<string, string | null>>();
  private sampler: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly node: PeerPigeonNode,
    private readonly store: ServerRecordStore = new MemoryServerRecordStore(),
    private readonly options: StorageServerOptions = {},
  ) {
    const kept = new Set<string>();
    this.history = new RoomStats(options.roomStats);
    this.revoked = options.revoked ?? { has: (m) => kept.has(m), set: (m, r) => { if (r) kept.add(m); else kept.delete(m); } };
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) void this.onMessage(m.fromPeerId, m.data).catch(() => {}); });
    node.on('peerConnected', () => void this.rebalance());
    node.on('peerDisconnected', (peerId) => {
      for (const [room, w] of this.watchers) if (w.delete(peerId)) void this.sampleRoom(room);
      for (const f of this.followers.values()) f.delete(peerId);
      this.statsFollowers.delete(peerId);
      void this.rebalance();
    });
    (node as { mesh?: { on?: (e: string, cb: () => void) => void } }).mesh?.on?.('peer:discovered', () => void this.rebalance());
  }

  /** Called with each record this server takes (a write, or one handed to it). */
  onRecord(listener: (rec: ServerRecord) => void): void { this.onChange = listener; }

  async start(): Promise<void> {
    await this.node.start();
    this.timer = setInterval(() => void this.rebalance(), 10_000);
    (this.timer as { unref?: () => void }).unref?.();
    this.sampler = setInterval(() => void this.sampleRooms(), MINUTE_MS);
    (this.sampler as { unref?: () => void }).unref?.();
  }

  /** The server's numbers to those following them, when they changed. */
  private async sendStats(): Promise<void> {
    if (!this.statsFollowers.size) {
      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = null;
      this.statsSent = '';
      return;
    }
    const stats = await this.stats();
    const text = JSON.stringify(stats);
    if (text === this.statsSent) return;
    this.statsSent = text;
    const linked = new Set(this.node.getConnectedPeers());
    for (const peer of this.statsFollowers.keys()) if (linked.has(peer)) this.send(peer, { pp: PP, t: 'statsnow', stats });
  }

  /** Once a minute: how many are in each room watched here (people, and peers with a role). */
  async sampleRooms(now = Date.now()): Promise<void> {
    for (const room of this.watchers.keys()) await this.sampleRoom(room, now);
  }

  /**
   * One room's count now (the minute's, replaced as it changes), sent at once to the pages following it.
   * Taken each minute, and also the moment someone starts or stops watching the room, so a page sees a
   * peer come and go within seconds, not at the next minute.
   */
  async sampleRoom(room: string, now = Date.now()): Promise<void> {
    const peers = this.watchers.get(room);
    if (!peers) return;
    const linked = new Set(this.node.getConnectedPeers());
    const people: string[] = [];
    let roles = 0;
    for (const [peer, { who, role: told }] of peers) {
      if (!linked.has(peer)) continue;
      const role = told ?? this.node.getPeerRole(peer);
      if (role && role !== 'client') roles++; else people.push(who);
    }
    await this.history.sample(room, people, roles, now).catch(() => {});
    const following = this.followers.get(room);
    if (following?.size) {
      const c = await this.history.current(room, now);
      const one = (p: RoomStatsPoint | null) => (p ? packPoints([p])[0] : undefined);
      const msg: Msg = { pp: PP, t: 'roomnow', room, minute: one(c.minute), five: one(c.five), hour: one(c.hour), day: one(c.day) };
      for (const peer of following.keys()) if (linked.has(peer)) this.send(peer, msg);
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.sampler) clearInterval(this.sampler);
    if (this.statsTimer) clearInterval(this.statsTimer);
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

  /** The owner this server was given, or null. */
  owner(): string | null {
    const value = typeof this.options.owner === 'function' ? this.options.owner() : this.options.owner;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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

  /** An ask signed, for this server and recently, by its owner or by someone holding the owner's pass. */
  private async askedByOwner(data: { at?: number; sig?: string; by?: string; until?: number; gsig?: string }): Promise<boolean> {
    const owner = this.owner();
    if (!owner || typeof data.sig !== 'string' || typeof data.at !== 'number' || Math.abs(Date.now() - data.at) > STATS_SKEW_MS) return false;
    let signer: string | null = owner;
    if (typeof data.by === 'string') {
      const now = Date.now();
      const valid = typeof data.until === 'number' && (data.until === 0 || data.until >= now) && typeof data.gsig === 'string'
        && await verifyMessage(grantText(owner, data.by, data.until), data.gsig, owner).catch(() => false)
        && !(await this.revoked.has(data.by));
      signer = valid ? data.by : null;
    }
    if (!signer) return false;
    try { return await verifyMessage(statsText(this.node.getClientId() ?? '', data.at), data.sig, signer); } catch { return false; }
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
          for (const peer of this.watchers.get(rec.room)?.keys() ?? []) if (peer !== from) this.send(peer, { pp: PP, t: 'changed', rec: strip(rec) });
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
        if (!w) this.watchers.set(data.room, (w = new Map()));
        const fresh = !w.has(from);
        w.set(from, { who: validId(data.v) ? data.v : from, role: typeof data.r === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(data.r) ? data.r : null });
        if (fresh) void this.sampleRoom(data.room);
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
      case 'stats': {
        // Who runs it, to anyone; its numbers, only to an ask its owner signed for this server, recently.
        const owner = this.owner();
        const ok = await this.askedByOwner(data);
        this.send(from, { pp: PP, t: 'statsr', req: data.req, owner, ...(ok ? { stats: { ...(await this.stats()), uptimeMs: Date.now() - this.startedAt } } : {}) });
        return;
      }
      case 'roomstats': {
        const fine = validRoom(data.room) && typeof data.from === 'number' && typeof data.to === 'number' && data.to > data.from && await this.askedByOwner(data);
        if (!fine) return void this.send(from, { pp: PP, t: 'roomstatsr', req: data.req, ok: false });
        const got = await this.history.read(data.room, data.from, data.to);
        this.send(from, { pp: PP, t: 'roomstatsr', req: data.req, ok: true, step: got.step, points: packPoints(got.points) });
        return;
      }
      case 'statsfollow': {
        if (data.stop) { this.statsFollowers.delete(from); return; }
        if (!(await this.askedByOwner(data))) return void this.send(from, { pp: PP, t: 'statsfollowed', req: data.req, ok: false });
        this.statsFollowers.set(from, typeof data.by === 'string' ? data.by : null);
        this.send(from, { pp: PP, t: 'statsfollowed', req: data.req, ok: true, startedAt: this.startedAt });
        this.send(from, { pp: PP, t: 'statsnow', stats: await this.stats() });
        // Looked at every 5 seconds while anyone follows; sent only when something changed.
        if (!this.statsTimer) {
          this.statsTimer = setInterval(() => void this.sendStats(), 5_000);
          (this.statsTimer as { unref?: () => void }).unref?.();
        }
        return;
      }
      case 'roomfollow': {
        if (!validRoom(data.room)) return void this.send(from, { pp: PP, t: 'roomfollowed', req: data.req, ok: false });
        if (data.stop) { this.followers.get(data.room)?.delete(from); return; }
        if (!(await this.askedByOwner(data))) return void this.send(from, { pp: PP, t: 'roomfollowed', req: data.req, ok: false });
        let f = this.followers.get(data.room);
        if (!f) this.followers.set(data.room, (f = new Map()));
        f.set(from, typeof data.by === 'string' ? data.by : null);
        this.send(from, { pp: PP, t: 'roomfollowed', req: data.req, ok: true });
        return;
      }
      case 'revoke': {
        const owner = this.owner();
        let ok = false;
        if (owner && typeof data.member === 'string' && typeof data.sig === 'string' && typeof data.at === 'number' && Math.abs(Date.now() - data.at) <= STATS_SKEW_MS) {
          try { ok = await verifyMessage(revokeText(this.node.getClientId() ?? '', data.member, data.at, !!data.restore), data.sig, owner); } catch { ok = false; }
          if (ok) await this.revoked.set(data.member, !data.restore);
          // A pass taken back: the history it was following stops coming.
          if (ok && !data.restore) for (const f of this.followers.values()) for (const [peer, by] of f) if (by === data.member) f.delete(peer);
          if (ok && !data.restore) for (const [peer, by] of this.statsFollowers) if (by === data.member) this.statsFollowers.delete(peer);
        }
        this.send(from, { pp: PP, t: 'revoked', req: data.req, ok });
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
            for (const peer of this.watchers.get(rec.room)?.keys() ?? []) this.send(peer, { pp: PP, t: 'changed', rec: strip(rec) });
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
