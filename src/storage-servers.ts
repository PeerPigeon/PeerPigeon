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
import type { PeerPigeonNode } from './index.js';

export const STORAGE_SERVER_NETWORK = 'peerpigeon-storage';
export const STORAGE_SERVER_ROOM = 'servers';
export const STORAGE_SERVER_ROLE = 'storage';
/** Servers per room. */
export const STORAGE_REPLICAS = 3;

const REQUEST_TIMEOUT_MS = 4_000;
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
  | { pp: typeof PP; t: 'sync'; recs: ServerRecord[] };

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** XOR distance between two hex ids, as a bigint. */
export function xorDistance(a: string, b: string): bigint {
  return BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
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
  return !!r && validId(r.room) && validId(r.slot) && validId(r.tag, 16) && Number.isFinite(r.at) && r.blob !== undefined;
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
  private readonly listings = new Map<string, Omit<ServerRecord, 'wh'>[]>();
  private readonly rooms = new Map<string, string[]>();
  private readonly listeners = new Set<LinkListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly node: PeerPigeonNode) {
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) this.onMessage(m.fromPeerId, m.data); });
    node.on('peerConnected', () => void this.refresh());
    node.on('peerDisconnected', (peerId) => { this.failPending(peerId); void this.refresh(); });
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
    return this.node.sendDirect(peerId, msg) !== null;
  }

  private ask(peerId: string, msg: Msg & { req: string }): Promise<Msg | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(msg.req); this.listings.delete(msg.req); resolve(null); }, REQUEST_TIMEOUT_MS);
      this.pending.set(msg.req, { resolve, timer, from: peerId });
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
    if (data.t === 'ack' || data.t === 'got') {
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
}

export interface StorageServerStats {
  rooms: number;
  records: number;
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
  private selfHash = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChange: ((rec: ServerRecord) => void) | null = null;

  constructor(private readonly node: PeerPigeonNode, private readonly store: ServerRecordStore = new MemoryServerRecordStore()) {
    node.on('message', (m) => { if (m.kind === 'direct' && m.fromPeerId) void this.onMessage(m.fromPeerId, m.data).catch(() => {}); });
    node.on('peerConnected', () => void this.rebalance());
    node.on('peerDisconnected', (peerId) => { for (const w of this.watchers.values()) w.delete(peerId); void this.rebalance(); });
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
    return { rooms: rooms.length, records, servers, clients: linked.length - servers };
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
    return this.node.sendDirect(peerId, msg) !== null;
  }

  /** Takes a record if it is new or newer, and its write token (or hash) is the slot's. */
  private async take(rec: ServerRecord): Promise<{ ok: boolean; why?: string }> {
    const have = await this.store.get(rec.room, rec.slot);
    if (have) {
      if (have.wh !== rec.wh) return { ok: false, why: 'not-yours' };
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
        const rec: ServerRecord = { room: data.rec.room, slot: data.rec.slot, tag: data.rec.tag, at: data.rec.at, blob: data.rec.blob, wh: await sha256Hex(data.write), ...(data.rec.once ? { once: true } : {}) };
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
        const rec = validId(data.room) && validId(data.slot) ? await this.store.get(data.room, data.slot) : null;
        this.send(from, { pp: PP, t: 'got', req: data.req, rec: rec ? strip(rec) : null });
        return;
      }
      case 'list': {
        const recs = validId(data.room) ? (await this.store.list(data.room, typeof data.tag === 'string' ? data.tag : undefined)).map(strip) : [];
        const parts = batches(recs);
        if (!parts.length) parts.push([]);
        parts.forEach((part, i) => this.send(from, { pp: PP, t: 'listed', req: data.req, recs: part, more: i < parts.length - 1 }));
        return;
      }
      case 'watch': {
        if (!validId(data.room)) return;
        let w = this.watchers.get(data.room);
        if (!w) this.watchers.set(data.room, (w = new Set()));
        w.add(from);
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
  }
}
