/**
 * Files shared in a room, peer to peer.
 *
 * A peer shares a file: it is cut into 256 KiB pieces, each hashed (SHA-256), and the list of hashes is
 * the file's manifest; the file's ID is the manifest's hash, so whatever arrives is checked against the
 * ID itself, from whoever it came. The peer announces the file to the room (gossip) every few seconds
 * while it has it.
 *
 * A download asks peers that have the file (they announce it) over side channels: more data channels on
 * the peers' own WebRTC links, reliable and ordered. It takes the manifest from one, checks it, then
 * pieces from several at once, a few at a time from each, each checked against its hash; a piece from a
 * peer that lied or left is asked of another. A peer that has the whole file shares it in turn. Relays
 * carry none of it, and a file is there while someone who has it is online.
 *
 * Control goes over the mesh as reserved pp-files-* messages, never seen by the app's own handlers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FILES_PAYLOAD_PREFIX = 'pp-files-';
const ANNOUNCE = 'pp-files-have';
const GONE = 'pp-files-gone';

const PIECE = 256 * 1024;
/** Bytes of a piece in one frame (under Safari's 64 KiB message limit). */
const FRAME = 48 * 1024;
const ANNOUNCE_MS = 5_000;
const HOLDER_STALE_MS = 16_000;
const LINK_WAIT_MS = 8_000;
const CHANNEL_OPEN_MS = 6_000;
/** Pieces asked of one holder at a time. */
const PER_HOLDER = 4;
/** Holders a download uses at once. */
const MAX_SOURCES = 4;
const PIECE_TIMEOUT_MS = 20_000;
/** A source with pieces asked of it that sends nothing for this long is dropped. */
const SOURCE_SILENT_MS = 4_000;
/** A sender stops filling the channel past this, and goes on when it drains. */
const SEND_HIGH = 2 * 1024 * 1024;
const MAX_NAME = 200;

// On a file channel ('f:<id>'): the asker sends JSON text { t: 'manifest' } or { t: 'piece', i }; the
// holder answers the manifest as JSON text { t: 'manifest', m }, a piece as binary frames
// 'P' 'F' | piece index (u32) | offset in the piece (u32) | the piece's length (u32) | bytes, and
// { t: 'none', i } when it doesn't have one.
const FRAME_HEADER = 14;

export interface SharedFileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Peers announcing the whole file now. */
  holders: string[];
  /** Shared by this peer, or downloaded and now shared by it. */
  mine: boolean;
}

export interface FileDownload {
  id: string;
  name: string;
  size: number;
  received: number;
  /** Peers it is taking pieces from now. */
  sources: string[];
  state: 'starting' | 'downloading' | 'done' | 'failed';
  error?: string;
  /** Bytes a second, over the last few seconds. */
  rate: number;
  file?: Blob;
}

interface Manifest { v: 1; name: string; size: number; type: string; piece: number; hashes: string[] }

interface Held { id: string; manifest: Manifest; blob: Blob; announced: ReturnType<typeof setInterval> | null }

interface Source { peerId: string; channel: RTCDataChannel; inFlight: Set<number>; failed: boolean; lastByte: number }

interface Active {
  id: string;
  manifest: Manifest | null;
  pieces: (Uint8Array | null)[];
  partial: Map<number, { bytes: Uint8Array; got: number }>;
  asked: Map<number, { peerId: string; at: number }>;
  sources: Map<string, Source>;
  tried: Set<string>;
  info: FileDownload;
  done: (blob: Blob) => void;
  fail: (error: Error) => void;
  timer: ReturnType<typeof setInterval> | null;
  rateWindow: { at: number; bytes: number }[];
  manifestFrom: string | null;
  idle: number;
}

export interface FilesHost {
  mesh: { getClientId(): string | null; getConnectedPeers(): string[]; on(event: string, handler: (...args: any[]) => void): void; openSideChannel(peerId: string, name: string, init?: any): RTCDataChannel | null };
  gossip: { broadcast(data: unknown): string; on(event: string, handler: (...args: any[]) => void): void };
  connectToPeer(peerId: string): void;
}

type Listener = (...args: any[]) => void;
const now = () => Date.now();

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function manifestBytes(m: Manifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ v: 1, name: m.name, size: m.size, type: m.type, piece: m.piece, hashes: m.hashes }));
}

export class FileShares {
  private readonly held = new Map<string, Held>();
  private readonly known = new Map<string, { name: string; size: number; type: string; holders: Map<string, number> }>();
  private readonly active = new Map<string, Active>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly host: FilesHost) {
    host.gossip.on('messageReceived', ({ message, local }: any) => { if (!local) this.onControl(message?.sender, message?.data); });
    host.mesh.on('peer:sidechannel', ({ peerId, name, channel }: any) => this.onSideChannel(peerId, name, channel));
    host.mesh.on('peer:disconnected', (peerId: string) => this.onPeerGone(peerId));
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  on(event: 'files' | 'progress', handler: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: 'files' | 'progress', handler: Listener): void { this.listeners.get(event)?.delete(handler); }

  /** The files in the room: announced by someone in the last few seconds, or this peer's own. */
  list(): SharedFileInfo[] {
    const t = now();
    const out: SharedFileInfo[] = [];
    const seen = new Set<string>();
    for (const h of this.held.values()) {
      const holders = this.liveHolders(h.id, t);
      out.push({ id: h.id, name: h.manifest.name, size: h.manifest.size, type: h.manifest.type, holders, mine: true });
      seen.add(h.id);
    }
    for (const [id, k] of this.known) {
      if (seen.has(id)) continue;
      const holders = this.liveHolders(id, t);
      if (!holders.length) continue;
      out.push({ id, name: k.name, size: k.size, type: k.type, holders, mine: false });
    }
    return out;
  }

  downloads(): FileDownload[] {
    return [...this.active.values()].map((a) => ({ ...a.info, sources: [...a.sources.keys()] }));
  }

  /** Share a file with the room. Resolves to its ID once it is hashed (a few seconds for a large one). */
  async share(file: Blob, name?: string): Promise<string> {
    const fileName = String(name ?? (file as File).name ?? 'file').slice(0, MAX_NAME);
    const hashes: string[] = [];
    for (let at = 0; at < file.size || (file.size === 0 && hashes.length === 0); at += PIECE) {
      hashes.push(await sha256Hex(await file.slice(at, at + PIECE).arrayBuffer()));
      if (file.size === 0) break;
    }
    const manifest: Manifest = { v: 1, name: fileName, size: file.size, type: file.type || 'application/octet-stream', piece: PIECE, hashes };
    const id = await sha256Hex(manifestBytes(manifest));
    this.hold(id, manifest, file);
    return id;
  }

  /** Stop sharing a file (this peer no longer announces or serves it). */
  unshare(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    if (h.announced) clearInterval(h.announced);
    this.host.gossip.broadcast({ __ppType: GONE, id });
    this.emit('files', this.list());
  }

  /** The file, from this peer if it has it, else downloaded from the room's holders. */
  download(id: string): Promise<Blob> {
    const h = this.held.get(id);
    if (h) return Promise.resolve(h.blob);
    const existing = this.active.get(id);
    if (existing) return new Promise((resolve, reject) => {
      const done = existing.done; const fail = existing.fail;
      existing.done = (b) => { done(b); resolve(b); };
      existing.fail = (e) => { fail(e); reject(e); };
    });
    const k = this.known.get(id);
    return new Promise((resolve, reject) => {
      const a: Active = {
        id, manifest: null, pieces: [], partial: new Map(), asked: new Map(), sources: new Map(), tried: new Set(),
        info: { id, name: k?.name ?? 'file', size: k?.size ?? 0, received: 0, sources: [], state: 'starting', rate: 0 },
        done: resolve, fail: reject, timer: null, rateWindow: [], manifestFrom: null, idle: 0,
      };
      this.active.set(id, a);
      a.timer = setInterval(() => this.pump(a), 500);
      this.pump(a);
      this.progress();
    });
  }

  /** Give up a download. */
  cancel(id: string): void {
    const a = this.active.get(id);
    if (!a) return;
    this.finish(a, new Error('Cancelled'));
  }

  private hold(id: string, manifest: Manifest, blob: Blob): void {
    if (this.held.has(id)) return;
    const h: Held = { id, manifest, blob, announced: null };
    const announce = () => this.host.gossip.broadcast({ __ppType: ANNOUNCE, id, name: manifest.name, size: manifest.size, type: manifest.type });
    announce();
    h.announced = setInterval(announce, ANNOUNCE_MS);
    this.held.set(id, h);
    this.emit('files', this.list());
  }

  private liveHolders(id: string, t: number): string[] {
    const me = this.host.mesh.getClientId() ?? '';
    const holders = [...(this.known.get(id)?.holders ?? new Map()).entries()].filter(([, seen]) => t - seen < HOLDER_STALE_MS).map(([p]) => p);
    if (this.held.has(id) && me && !holders.includes(me)) holders.unshift(me);
    return holders;
  }

  // ---------------------------------------------------------------- downloading

  /** Keep a download moving: sources up to MAX_SOURCES, the manifest, then pieces, a few per source. */
  private pump(a: Active): void {
    if (!this.active.has(a.id)) return;
    const t = now();
    const me = this.host.mesh.getClientId() ?? '';
    const holders = this.liveHolders(a.id, t).filter((p) => p !== me);
    // More sources, linked peers first.
    const linked = new Set(this.host.mesh.getConnectedPeers());
    const fresh = holders.filter((p) => !a.sources.has(p) && !a.tried.has(p)).sort((x, y) => (linked.has(x) ? 0 : 1) - (linked.has(y) ? 0 : 1));
    for (const p of fresh) {
      if (a.sources.size + this.opening(a) >= MAX_SOURCES) break;
      void this.addSource(a, p);
    }
    if (!a.sources.size && !this.opening(a) && fresh.length === 0 && holders.every((p) => a.tried.has(p))) a.tried.clear();
    if (!a.manifest) {
      const s = [...a.sources.values()].find((x) => !x.failed && x.channel.readyState === 'open');
      if (s && (!a.manifestFrom || !a.sources.has(a.manifestFrom))) {
        a.manifestFrom = s.peerId;
        try { s.channel.send(JSON.stringify({ t: 'manifest' })); } catch { /* closing */ }
      }
      return;
    }
    // A source that has pieces to send and has sent nothing for a while has gone (a closed laptop's
    // channel can take much longer to close): its pieces go to the others.
    for (const src of [...a.sources.values()]) if (src.inFlight.size && t - src.lastByte > SOURCE_SILENT_MS) this.dropSource(a, src);
    // Pieces asked too long ago go back in the pool.
    for (const [i, ask] of a.asked) if (t - ask.at > PIECE_TIMEOUT_MS) { a.asked.delete(i); a.sources.get(ask.peerId)?.inFlight.delete(i); a.partial.delete(i); }
    const missing: number[] = [];
    for (let i = 0; i < a.pieces.length; i++) if (!a.pieces[i] && !a.asked.has(i)) missing.push(i);
    for (const s of a.sources.values()) {
      if (s.failed || s.channel.readyState !== 'open') continue;
      if (!s.inFlight.size) s.lastByte = t;
      while (s.inFlight.size < PER_HOLDER && missing.length) {
        const i = missing.shift()!;
        s.inFlight.add(i);
        a.asked.set(i, { peerId: s.peerId, at: t });
        try { s.channel.send(JSON.stringify({ t: 'piece', i })); } catch { s.inFlight.delete(i); a.asked.delete(i); break; }
      }
    }
  }

  private readonly openingSources = new Map<string, Set<string>>();
  private opening(a: Active): number { return this.openingSources.get(a.id)?.size ?? 0; }

  private async addSource(a: Active, peerId: string): Promise<void> {
    let set = this.openingSources.get(a.id);
    if (!set) { set = new Set(); this.openingSources.set(a.id, set); }
    if (set.has(peerId)) return;
    set.add(peerId);
    a.tried.add(peerId);
    try {
      if (!this.host.mesh.getConnectedPeers().includes(peerId)) {
        this.host.connectToPeer(peerId);
        const until = now() + LINK_WAIT_MS;
        while (!this.host.mesh.getConnectedPeers().includes(peerId) && now() < until && this.active.has(a.id)) await sleep(150);
      }
      const channel = this.host.mesh.openSideChannel(peerId, `f:${a.id}`, { reliable: true });
      if (!channel) return;
      channel.binaryType = 'arraybuffer';
      if (!(await waitOpen(channel, CHANNEL_OPEN_MS)) || !this.active.has(a.id)) { try { channel.close(); } catch { /* closed */ } return; }
      const s: Source = { peerId, channel, inFlight: new Set(), failed: false, lastByte: now() };
      a.sources.set(peerId, s);
      channel.onmessage = (event) => void this.onReply(a, s, event.data);
      channel.onclose = () => this.dropSource(a, s);
      if (a.info.state === 'starting') a.info.state = 'downloading';
      this.pump(a);
    } finally {
      set.delete(peerId);
    }
  }

  private dropSource(a: Active, s: Source): void {
    if (a.sources.get(s.peerId) !== s) return;
    a.sources.delete(s.peerId);
    for (const i of s.inFlight) { a.asked.delete(i); a.partial.delete(i); }
    s.inFlight.clear();
    if (a.manifestFrom === s.peerId) a.manifestFrom = null;
    try { s.channel.close(); } catch { /* closed */ }
    this.pump(a);
  }

  private async onReply(a: Active, s: Source, data: unknown): Promise<void> {
    if (!this.active.has(a.id)) return;
    if (typeof data === 'string') {
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg?.t === 'manifest' && !a.manifest) {
        const m = msg.m as Manifest;
        if (!m || m.v !== 1 || !Array.isArray(m.hashes) || typeof m.size !== 'number' || m.piece !== PIECE) { s.failed = true; this.dropSource(a, s); return; }
        const id = await sha256Hex(manifestBytes(m));
        if (id !== a.id) { s.failed = true; this.dropSource(a, s); return; }
        if (a.manifest) return;
        a.manifest = m;
        a.pieces = new Array(m.hashes.length).fill(null);
        a.info.name = m.name; a.info.size = m.size;
        this.pump(a);
      } else if (msg?.t === 'none' && Number.isInteger(msg.i)) {
        // This holder hasn't that piece: someone else's.
        s.inFlight.delete(msg.i); a.asked.delete(msg.i);
        s.failed = true;
        this.dropSource(a, s);
      }
      return;
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength < FRAME_HEADER || !a.manifest) return;
    s.lastByte = now();
    const view = new DataView(data);
    if (view.getUint8(0) !== 0x50 || view.getUint8(1) !== 0x46) return;
    const i = view.getUint32(2);
    const offset = view.getUint32(6);
    const length = view.getUint32(10);
    if (i >= a.pieces.length || a.pieces[i] || length > PIECE || offset + data.byteLength - FRAME_HEADER > length) return;
    let part = a.partial.get(i);
    if (!part) { part = { bytes: new Uint8Array(length), got: 0 }; a.partial.set(i, part); }
    part.bytes.set(new Uint8Array(data, FRAME_HEADER), offset);
    part.got += data.byteLength - FRAME_HEADER;
    this.counted(a, data.byteLength - FRAME_HEADER);
    if (part.got < length) return;
    a.partial.delete(i);
    s.inFlight.delete(i);
    a.asked.delete(i);
    const hash = await sha256Hex(part.bytes);
    if (hash !== a.manifest.hashes[i]) {
      // A holder that sends a wrong piece is not asked again.
      a.info.received -= length;
      s.failed = true;
      this.dropSource(a, s);
      return;
    }
    a.pieces[i] = part.bytes;
    if (a.pieces.every((p) => p)) {
      const blob = new Blob(a.pieces as BlobPart[], { type: a.manifest.type });
      this.finish(a, null, blob);
      return;
    }
    this.pump(a);
  }

  private counted(a: Active, bytes: number): void {
    a.info.received += bytes;
    a.rateWindow.push({ at: now(), bytes });
  }

  private finish(a: Active, error: Error | null, blob?: Blob): void {
    if (!this.active.has(a.id)) return;
    this.active.delete(a.id);
    if (a.timer) clearInterval(a.timer);
    for (const s of a.sources.values()) { s.channel.onclose = null; try { s.channel.close(); } catch { /* closed */ } }
    if (blob && a.manifest) {
      a.info.state = 'done';
      a.info.received = a.manifest.size;
      a.info.file = blob;
      this.hold(a.id, a.manifest, blob);
      this.emit('progress', [...this.downloads(), a.info]);
      a.done(blob);
    } else {
      a.info.state = 'failed';
      a.info.error = error?.message ?? 'Failed';
      this.emit('progress', [...this.downloads(), a.info]);
      a.fail(error ?? new Error('Failed'));
    }
  }

  // ---------------------------------------------------------------- serving

  private onSideChannel(peerId: string, name: string, channel: RTCDataChannel): void {
    if (!name.startsWith('f:')) return;
    const id = name.slice(2);
    channel.binaryType = 'arraybuffer';
    const queue: number[] = [];
    let sending = false;
    const sendNext = async (): Promise<void> => {
      if (sending) return;
      sending = true;
      try {
        while (queue.length && channel.readyState === 'open') {
          const h = this.held.get(id);
          const i = queue.shift()!;
          if (!h || i >= h.manifest.hashes.length) { channel.send(JSON.stringify({ t: 'none', i })); continue; }
          const bytes = new Uint8Array(await h.blob.slice(i * PIECE, Math.min(h.manifest.size, (i + 1) * PIECE)).arrayBuffer());
          for (let off = 0; off < bytes.length || (bytes.length === 0 && off === 0); off += FRAME) {
            if (channel.bufferedAmount > SEND_HIGH) await drained(channel);
            if (channel.readyState !== 'open') return;
            const slice = bytes.subarray(off, Math.min(bytes.length, off + FRAME));
            const frame = new Uint8Array(FRAME_HEADER + slice.length);
            const v = new DataView(frame.buffer);
            v.setUint8(0, 0x50); v.setUint8(1, 0x46);
            v.setUint32(2, i); v.setUint32(6, off); v.setUint32(10, bytes.length);
            frame.set(slice, FRAME_HEADER);
            channel.send(frame);
            if (bytes.length === 0) break;
          }
        }
      } catch { /* the channel closed */ } finally {
        sending = false;
      }
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      const h = this.held.get(id);
      if (msg?.t === 'manifest') {
        if (!h) { try { channel.close(); } catch { /* closed */ } return; }
        try { channel.send(JSON.stringify({ t: 'manifest', m: h.manifest })); } catch { /* closing */ }
      } else if (msg?.t === 'piece' && Number.isInteger(msg.i) && msg.i >= 0) {
        if (queue.length < 64) queue.push(msg.i);
        void sendNext();
      }
    };
    void peerId;
  }

  // ---------------------------------------------------------------- room

  private onControl(from: string | undefined, data: any): void {
    if (!from || !data || typeof data !== 'object' || typeof data.__ppType !== 'string' || !data.__ppType.startsWith(FILES_PAYLOAD_PREFIX)) return;
    if (typeof data.id !== 'string' || !/^[0-9a-f]{64}$/.test(data.id)) return;
    if (data.__ppType === ANNOUNCE) {
      let k = this.known.get(data.id);
      const isNew = !k || !this.liveHolders(data.id, now()).length;
      if (!k) {
        k = { name: String(data.name ?? 'file').slice(0, MAX_NAME), size: Math.max(0, Number(data.size) || 0), type: String(data.type ?? '').slice(0, 100), holders: new Map() };
        this.known.set(data.id, k);
      }
      const had = k.holders.has(from);
      k.holders.set(from, now());
      if (isNew || !had) this.emit('files', this.list());
      for (const a of this.active.values()) if (a.id === data.id) this.pump(a);
    } else if (data.__ppType === GONE) {
      if (this.known.get(data.id)?.holders.delete(from)) this.emit('files', this.list());
    }
  }

  private onPeerGone(peerId: string): void {
    let changed = false;
    for (const k of this.known.values()) if (k.holders.delete(peerId)) changed = true;
    for (const a of this.active.values()) { const s = a.sources.get(peerId); if (s) this.dropSource(a, s); }
    if (changed) this.emit('files', this.list());
  }

  private progress(): void {
    if (this.active.size) this.emit('progress', this.downloads());
  }

  private tick(): void {
    const t = now();
    const me = this.host.mesh.getClientId();
    for (const a of [...this.active.values()]) {
      a.rateWindow = a.rateWindow.filter((r) => t - r.at < 3_000);
      a.info.rate = Math.round(a.rateWindow.reduce((n, r) => n + r.bytes, 0) / 3);
      // Nobody left who has it, for 15 s in a row: the download fails (what came is dropped).
      const anyone = a.sources.size > 0 || this.liveHolders(a.id, t).some((p) => p !== me);
      a.idle = anyone ? 0 : a.idle + 1;
      if (a.idle > 15) this.finish(a, new Error('Nobody who has this file is online'));
    }
    let expired = false;
    for (const [id, k] of this.known) {
      for (const [p, seen] of k.holders) if (t - seen > HOLDER_STALE_MS) { k.holders.delete(p); expired = true; }
      if (!k.holders.size && !this.held.has(id) && !this.active.has(id)) this.known.delete(id);
    }
    if (expired) this.emit('files', this.list());
    this.progress();
  }

  destroy(): void {
    for (const id of [...this.held.keys()]) this.unshare(id);
    for (const a of [...this.active.values()]) this.finish(a, new Error('Stopped'));
    clearInterval(this.timer);
    this.listeners.clear();
  }

  private emit(event: string, ...args: any[]): void {
    for (const handler of this.listeners.get(event) ?? []) { try { handler(...args); } catch { /* the app's */ } }
  }
}

function waitOpen(channel: RTCDataChannel, ms: number): Promise<boolean> {
  if (channel.readyState === 'open') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    channel.addEventListener('open', () => { clearTimeout(timer); resolve(true); }, { once: true });
    channel.addEventListener('close', () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
}

function drained(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = SEND_HIGH / 4;
    const done = () => { channel.removeEventListener('bufferedamountlow', done); channel.removeEventListener('close', done); resolve(); };
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
