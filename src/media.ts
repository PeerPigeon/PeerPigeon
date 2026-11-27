/**
 * Media streams over the mesh, with peers as forwarders: a "virtual SFU".
 *
 * A source encodes its camera with WebCodecs and sends the encoded frames, in fragments, over side
 * channels: more data channels on the peers' own WebRTC links, unordered and never retransmitted. A
 * viewer that is not fed by the source is fed by another viewer: every viewer is a forwarder too, and
 * passes the bytes on untouched (no decoding, no re-encoding), so a stream reaches many peers while
 * the source uploads it a few times. The relays never carry any of it.
 *
 * The tree: the source keeps it, as soft state. Each viewer reports where it is attached every few
 * seconds; a viewer joining asks the source (a direct message across the mesh) and is given a parent:
 * one with a free place, a peer it is linked to already when there is one, nearest the source
 * otherwise. It links to that parent if it must and opens the side channel; the parent asks upstream
 * for a key frame, so the new viewer starts at once. A viewer whose parent goes silent asks again.
 *
 * Control (announce, join, attach, reports, clock pings) goes over the mesh as reserved pp-media-*
 * messages, never seen by the app's own message handlers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MEDIA_PAYLOAD_PREFIX = 'pp-media-';
const ANNOUNCE = 'pp-media-announce';
const END = 'pp-media-end';
const JOIN = 'pp-media-join';
const ATTACH = 'pp-media-attach';
const REPORT = 'pp-media-report';
const PING = 'pp-media-ping';
const PONG = 'pp-media-pong';

const ANNOUNCE_MS = 4_000;
const ANNOUNCE_STALE_MS = 13_000;
const REPORT_MS = 2_500;
const MEMBER_STALE_MS = 8_000;
/** A parent that sends nothing for this long is gone: ask the source for another. */
const PARENT_SILENT_MS = 3_000;
const LINK_WAIT_MS = 8_000;
const CHANNEL_OPEN_MS = 6_000;
const KEY_REQUEST_MIN_MS = 500;
/** A key frame at least this often, asked for or not. */
const KEY_INTERVAL_MS = 2_000;
/** How long a fragment may be resent before it is given up: video late is video lost. */
const FRAGMENT_LIFETIME_MS = 250;
const PING_MS = 5_000;
/** A child whose channel has this much waiting is behind: it gets key frames only until it drains. */
const CHILD_BACKLOG_BYTES = 1_000_000;

// A fragment on the wire: 'P' 'M', version, flags (bit 0: key frame), frame number (u32), fragment
// index (u16), fragments in the frame (u16), capture time at the source (f64, its clock, ms), the
// encoder's timestamp (f64, µs), then the fragment's bytes. Upstream, a child sends one byte: 'K'
// (a key frame, please).
const HEADER = 28;
const FRAGMENT = 15_000;
const KEY_REQUEST = 0x4b;

export interface MediaPublishOptions {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  /** Viewers fed by the source itself; more are fed by viewers. */
  maxChildren?: number;
}

export interface MediaStreamInfo {
  id: string;
  source: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Announced in the last few seconds. */
  live: boolean;
}

export interface MediaStats {
  id: string;
  role: 'source' | 'viewer';
  parent: string | null;
  children: string[];
  /** Hops from the source (1: fed by it). */
  depth: number;
  fps: number;
  kbps: number;
  /** Capture to arrival, through every hop, clock-corrected (approximate). */
  delayMs: number | null;
  /** Average time a frame spends in this peer before it goes on to the children. */
  forwardMs: number | null;
  framesDropped: number;
  keyRequests: number;
  /** The last time a parent was lost and the stream came back: how long it took. */
  lastRecoveryMs: number | null;
  recoveries: number;
}

interface Member { peerId: string; parent: string; depth: number; children: number; links: string[]; seen: number }

interface Child { peerId: string; channel: RTCDataChannel; waitingForKey: boolean }

interface Published {
  id: string;
  name: string;
  track: MediaStreamTrack;
  opts: Required<Omit<MediaPublishOptions, 'name'>>;
  encoder: any;
  video: HTMLVideoElement | null;
  timer: ReturnType<typeof setInterval> | null;
  frame: number;
  forceKey: boolean;
  lastKeyAt: number;
  keyTimer: ReturnType<typeof setTimeout> | null;
  children: Map<string, Child>;
  members: Map<string, Member>;
  stats: Counter;
  announceTimer: ReturnType<typeof setInterval> | null;
}

interface Watching {
  id: string;
  source: string;
  parent: string | null;
  depth: number;
  upstream: RTCDataChannel | null;
  children: Map<string, Child>;
  decoder: any;
  onFrame: (frame: any) => void;
  frames: Map<number, { got: number; count: number; parts: Uint8Array[]; key: boolean; capturedAt: number; ts: number }>;
  lastFrame: number;
  needKey: boolean;
  lastKeyRequest: number;
  lastData: number;
  joining: boolean;
  lostAt: number | null;
  avoid: Set<string>;
  stats: Counter;
  watchdog: ReturnType<typeof setInterval> | null;
  reportTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

class Counter {
  frames = 0;
  bytes = 0;
  windowAt = Date.now();
  fps = 0;
  kbps = 0;
  delaySum = 0;
  delayCount = 0;
  delayMs: number | null = null;
  forwardSum = 0;
  forwardCount = 0;
  forwardMs: number | null = null;
  dropped = 0;
  keyRequests = 0;
  lastRecoveryMs: number | null = null;
  recoveries = 0;
  roll(now: number): void {
    const span = (now - this.windowAt) / 1000;
    if (span < 1) return;
    this.fps = Math.round(this.frames / span);
    this.kbps = Math.round((this.bytes * 8) / 1000 / span);
    this.delayMs = this.delayCount ? Math.round(this.delaySum / this.delayCount) : this.delayMs;
    this.forwardMs = this.forwardCount ? Math.round((this.forwardSum / this.forwardCount) * 100) / 100 : this.forwardMs;
    this.frames = 0; this.bytes = 0; this.delaySum = 0; this.delayCount = 0; this.forwardSum = 0; this.forwardCount = 0;
    this.windowAt = now;
  }
}

/** What MediaStreams needs of a PeerPigeonNode. */
export interface MediaHost {
  mesh: { getClientId(): string | null; getConnectedPeers(): string[]; on(event: string, handler: (...args: any[]) => void): void; openSideChannel(peerId: string, name: string, init?: any): RTCDataChannel | null };
  gossip: { broadcast(data: unknown): string; sendDirect(peerId: string, data: unknown, options?: { connectedOnly?: boolean }): string | null; on(event: string, handler: (...args: any[]) => void): void };
  connectToPeer(peerId: string): void;
}

type Listener = (...args: any[]) => void;

const now = () => Date.now();
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const channelName = (id: string) => `m:${id}`;

export class MediaStreams {
  private readonly published = new Map<string, Published>();
  private readonly watching = new Map<string, Watching>();
  private readonly streams = new Map<string, MediaStreamInfo & { seen: number }>();
  /** Clock offsets to sources: their clock minus ours, ms, from the quickest recent exchange. */
  private readonly offsets = new Map<string, number>();
  private readonly offsetSamples = new Map<string, { rtt: number; offset: number; at: number }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];

  constructor(private readonly host: MediaHost) {
    host.gossip.on('messageReceived', ({ message, local }: any) => { if (!local) this.onControl(message?.sender, message?.data); });
    host.gossip.on('directMessageReceived', ({ message }: any) => this.onControl(message?.from, message?.data));
    host.mesh.on('peer:sidechannel', ({ peerId, name, channel }: any) => this.onSideChannel(peerId, name, channel));
    host.mesh.on('peer:disconnected', (peerId: string) => this.onPeerGone(peerId));
    this.timers.push(setInterval(() => this.tick(), 1_000));
    this.timers.push(setInterval(() => this.pingSources(), PING_MS));
  }

  /** Whether this browser can send or receive (WebCodecs). */
  static supported(): boolean {
    return typeof (globalThis as any).VideoEncoder === 'function' && typeof (globalThis as any).VideoDecoder === 'function';
  }

  on(event: 'streams' | 'stats', handler: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: 'streams' | 'stats', handler: Listener): void { this.listeners.get(event)?.delete(handler); }

  /** The streams announced in the room (this peer's own too). */
  list(): MediaStreamInfo[] {
    const t = now();
    return [...this.streams.values()].map(({ seen, ...info }) => ({ ...info, live: t - seen < ANNOUNCE_STALE_MS }));
  }

  stats(): MediaStats[] {
    const out: MediaStats[] = [];
    for (const p of this.published.values()) {
      out.push({ id: p.id, role: 'source', parent: null, children: [...p.children.keys()], depth: 0, fps: p.stats.fps, kbps: p.stats.kbps, delayMs: null, forwardMs: null, framesDropped: p.stats.dropped, keyRequests: p.stats.keyRequests, lastRecoveryMs: null, recoveries: 0 });
    }
    for (const w of this.watching.values()) {
      out.push({ id: w.id, role: 'viewer', parent: w.parent, children: [...w.children.keys()], depth: w.depth, fps: w.stats.fps, kbps: w.stats.kbps, delayMs: w.stats.delayMs, forwardMs: w.children.size ? w.stats.forwardMs : null, framesDropped: w.stats.dropped, keyRequests: w.stats.keyRequests, lastRecoveryMs: w.stats.lastRecoveryMs, recoveries: w.stats.recoveries });
    }
    return out;
  }

  /** The source's tree, as it knows it: who feeds whom. */
  tree(id: string): { peerId: string; parent: string; depth: number }[] {
    const p = this.published.get(id);
    if (!p) return [];
    return [...p.members.values()].map(({ peerId, parent, depth }) => ({ peerId, parent, depth }));
  }

  // ---------------------------------------------------------------- source

  async publish(track: MediaStreamTrack, options: MediaPublishOptions = {}): Promise<string> {
    if (!MediaStreams.supported()) throw new Error('This browser has no WebCodecs: it cannot send video');
    const settings = track.getSettings?.() ?? {};
    const opts = {
      width: options.width ?? settings.width ?? 1280,
      height: options.height ?? settings.height ?? 720,
      fps: options.fps ?? Math.min(30, Math.round(settings.frameRate ?? 30)),
      bitrate: options.bitrate ?? 1_500_000,
      maxChildren: options.maxChildren ?? 3,
    };
    const id = randomId();
    const p: Published = {
      id, name: options.name ?? 'Camera', track, opts, encoder: null, video: null, timer: null, frame: 0,
      forceKey: true, lastKeyAt: 0, keyTimer: null, children: new Map(), members: new Map(), stats: new Counter(), announceTimer: null,
    };
    const Encoder = (globalThis as any).VideoEncoder;
    p.encoder = new Encoder({
      output: (chunk: any) => this.sendChunk(p, chunk),
      error: () => { p.forceKey = true; },
    });
    p.encoder.configure({ codec: 'vp8', width: opts.width, height: opts.height, bitrate: opts.bitrate, framerate: opts.fps, latencyMode: 'realtime' });
    // Frames from the track through a <video>: works wherever WebCodecs does (no track processor needed).
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    await video.play().catch(() => {});
    p.video = video;
    const started = performance.now();
    p.timer = setInterval(() => {
      if (!p.encoder || p.encoder.state !== 'configured' || video.readyState < 2) return;
      if (p.encoder.encodeQueueSize > 2) { p.stats.dropped++; return; }
      const VF = (globalThis as any).VideoFrame;
      let frame: any;
      try { frame = new VF(video, { timestamp: Math.round((performance.now() - started) * 1000) }); } catch { return; }
      const key = p.forceKey || now() - p.lastKeyAt >= KEY_INTERVAL_MS;
      if (key) { p.forceKey = false; p.lastKeyAt = now(); }
      try { p.encoder.encode(frame, { keyFrame: key }); } finally { frame.close(); }
      p.frame++;
    }, Math.round(1000 / opts.fps));
    this.published.set(id, p);
    const me = this.host.mesh.getClientId() ?? '';
    this.streams.set(id, { id, source: me, name: p.name, width: opts.width, height: opts.height, fps: opts.fps, live: true, seen: now() });
    const announce = () => this.host.gossip.broadcast({ __ppType: ANNOUNCE, id, name: p.name, width: opts.width, height: opts.height, fps: opts.fps });
    announce();
    p.announceTimer = setInterval(announce, ANNOUNCE_MS);
    this.emit('streams', this.list());
    return id;
  }

  unpublish(id: string): void {
    const p = this.published.get(id);
    if (!p) return;
    this.published.delete(id);
    if (p.timer) clearInterval(p.timer);
    if (p.keyTimer) clearTimeout(p.keyTimer);
    if (p.announceTimer) clearInterval(p.announceTimer);
    try { p.encoder?.close(); } catch { /* closed */ }
    if (p.video) p.video.srcObject = null;
    for (const c of p.children.values()) { try { c.channel.close(); } catch { /* closed */ } }
    this.streams.delete(id);
    this.host.gossip.broadcast({ __ppType: END, id });
    this.emit('streams', this.list());
  }

  private sendChunk(p: Published, chunk: any): void {
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    const key = chunk.type === 'key';
    const fragments = makeFragments(p.frame, key, Date.now(), chunk.timestamp, bytes);
    p.stats.frames++;
    p.stats.bytes += bytes.length;
    for (const child of p.children.values()) sendToChild(child, fragments, key, p.stats);
  }

  /** The source picks a parent for a joining viewer. */
  private pickParent(p: Published, viewer: string, links: string[], avoid: string[]): { parent: string; depth: number } {
    const me = this.host.mesh.getClientId() ?? '';
    const t = now();
    for (const [peerId, m] of p.members) if (t - m.seen > MEMBER_STALE_MS) p.members.delete(peerId);
    const below = new Set<string>();
    // Never under itself or its own subtree.
    const subtree = (root: string) => { for (const m of p.members.values()) if (m.parent === root && !below.has(m.peerId)) { below.add(m.peerId); subtree(m.peerId); } };
    subtree(viewer);
    const candidates: { peerId: string; depth: number; children: number }[] = [{ peerId: me, depth: 0, children: p.children.size }];
    for (const m of p.members.values()) {
      if (m.peerId === viewer || below.has(m.peerId)) continue;
      candidates.push({ peerId: m.peerId, depth: m.depth, children: m.children });
    }
    const free = candidates.filter((c) => c.children < p.opts.maxChildren && !avoid.includes(c.peerId));
    const pool = free.length ? free : candidates.filter((c) => !avoid.includes(c.peerId));
    pool.sort((a, b) => {
      const la = links.includes(a.peerId) ? 0 : 1;
      const lb = links.includes(b.peerId) ? 0 : 1;
      return a.depth - b.depth || la - lb || a.children - b.children;
    });
    const chosen = pool[0] ?? candidates[0];
    // Counted now, so viewers joining together spread out before their reports arrive.
    if (chosen.peerId !== me) { const m = p.members.get(chosen.peerId); if (m) m.children++; }
    p.members.set(viewer, { peerId: viewer, parent: chosen.peerId, depth: chosen.depth + 1, children: p.members.get(viewer)?.children ?? 0, links, seen: t });
    return { parent: chosen.peerId, depth: chosen.depth + 1 };
  }

  // ---------------------------------------------------------------- viewer

  /** Watch a stream: decoded frames go to onFrame (draw them, then frame.close()). */
  watch(id: string, onFrame: (frame: any) => void): void {
    if (!MediaStreams.supported()) throw new Error('This browser has no WebCodecs: it cannot show video');
    if (this.watching.has(id)) return;
    const info = this.streams.get(id);
    if (!info) throw new Error('No such stream in this room');
    const Decoder = (globalThis as any).VideoDecoder;
    const w: Watching = {
      id, source: info.source, parent: null, depth: 0, upstream: null, children: new Map(), decoder: null, onFrame,
      frames: new Map(), lastFrame: -1, needKey: true, lastKeyRequest: 0, lastData: now(), joining: false, lostAt: null,
      avoid: new Set(), stats: new Counter(), watchdog: null, reportTimer: null, stopped: false,
    };
    w.decoder = new Decoder({
      output: (frame: any) => {
        if (w.lostAt != null) { w.stats.lastRecoveryMs = now() - w.lostAt; w.stats.recoveries++; w.lostAt = null; }
        try { w.onFrame(frame); } catch { try { frame.close(); } catch { /* closed */ } }
      },
      error: () => { w.needKey = true; this.resetDecoder(w); },
    });
    w.decoder.configure({ codec: 'vp8', optimizeForLatency: true });
    this.watching.set(id, w);
    w.watchdog = setInterval(() => {
      if (w.stopped || w.joining) return;
      if (now() - w.lastData > PARENT_SILENT_MS) this.lostParent(w, 'silent');
    }, 1_000);
    w.reportTimer = setInterval(() => this.report(w), REPORT_MS);
    void this.join(w);
  }

  unwatch(id: string): void {
    const w = this.watching.get(id);
    if (!w) return;
    w.stopped = true;
    this.watching.delete(id);
    if (w.watchdog) clearInterval(w.watchdog);
    if (w.reportTimer) clearInterval(w.reportTimer);
    try { w.upstream?.close(); } catch { /* closed */ }
    for (const c of w.children.values()) { try { c.channel.close(); } catch { /* closed */ } }
    try { w.decoder?.close(); } catch { /* closed */ }
  }

  private resetDecoder(w: Watching): void {
    try { w.decoder.reset(); w.decoder.configure({ codec: 'vp8', optimizeForLatency: true }); } catch { /* closed */ }
  }

  private async join(w: Watching): Promise<void> {
    if (w.stopped || w.joining) return;
    w.joining = true;
    try {
      const attach = await this.ask(w);
      if (w.stopped) return;
      if (!attach) { w.lastData = now(); return; }
      const parent = attach.parent;
      const me = this.host.mesh.getClientId() ?? '';
      if (parent === me) return;
      if (!this.host.mesh.getConnectedPeers().includes(parent)) {
        this.host.connectToPeer(parent);
        const until = now() + LINK_WAIT_MS;
        while (!this.host.mesh.getConnectedPeers().includes(parent) && now() < until && !w.stopped) await sleep(150);
      }
      const channel = this.host.mesh.openSideChannel(parent, channelName(w.id), { ordered: false, maxPacketLifeTime: FRAGMENT_LIFETIME_MS });
      if (!channel) { w.avoid.add(parent); w.lastData = now() - PARENT_SILENT_MS; return; }
      const opened = await waitOpen(channel, CHANNEL_OPEN_MS);
      if (!opened || w.stopped) { try { channel.close(); } catch { /* closed */ } w.avoid.add(parent); w.lastData = now() - PARENT_SILENT_MS; return; }
      try { w.upstream?.close(); } catch { /* closed */ }
      w.upstream = channel;
      w.parent = parent;
      w.depth = attach.depth;
      w.needKey = true;
      w.lastData = now();
      w.avoid.clear();
      channel.onmessage = (event) => this.onFragment(w, channel, event.data);
      channel.onclose = () => { if (w.upstream === channel) this.lostParent(w, 'closed'); };
      this.requestKey(w, true);
      this.report(w);
    } finally {
      w.joining = false;
    }
  }

  /** Ask the source where to attach; null when it does not answer. */
  private ask(w: Watching): Promise<{ parent: string; depth: number } | null> {
    return new Promise((resolve) => {
      const nonce = randomId();
      const done = (value: { parent: string; depth: number } | null) => { clearTimeout(timer); this.pendingAttach.delete(nonce); resolve(value); };
      const timer = setTimeout(() => done(null), 5_000);
      this.pendingAttach.set(nonce, done);
      this.host.gossip.sendDirect(w.source, { __ppType: JOIN, id: w.id, nonce, links: this.host.mesh.getConnectedPeers(), avoid: [...w.avoid] });
    });
  }

  private readonly pendingAttach = new Map<string, (value: { parent: string; depth: number } | null) => void>();

  private lostParent(w: Watching, _why: string): void {
    if (w.stopped || w.joining) return;
    if (w.lostAt == null) w.lostAt = now();
    if (w.parent) w.avoid.add(w.parent);
    const old = w.upstream;
    w.upstream = null;
    w.parent = null;
    if (old) { old.onclose = null; try { old.close(); } catch { /* closed */ } }
    void this.join(w);
  }

  private onFragment(w: Watching, channel: RTCDataChannel, data: ArrayBuffer): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength < HEADER) return;
    const arrived = performance.now();
    w.lastData = now();
    const view = new DataView(data);
    if (view.getUint8(0) !== 0x50 || view.getUint8(1) !== 0x4d) return;
    const key = (view.getUint8(3) & 1) === 1;
    const frameNo = view.getUint32(4);
    const index = view.getUint16(8);
    const count = view.getUint16(10);
    const capturedAt = view.getFloat64(12);
    const ts = view.getFloat64(20);
    // On to the children first, as received: this peer never decodes for them.
    if (w.children.size) {
      const frag = new Uint8Array(data);
      for (const child of w.children.values()) sendToChild(child, [frag], key, w.stats, index === 0);
      w.stats.forwardSum += performance.now() - arrived;
      w.stats.forwardCount++;
    }
    w.stats.bytes += data.byteLength;
    let entry = w.frames.get(frameNo);
    if (!entry) {
      entry = { got: 0, count, parts: new Array(count), key, capturedAt, ts };
      w.frames.set(frameNo, entry);
    }
    if (!entry.parts[index]) { entry.parts[index] = new Uint8Array(data, HEADER); entry.got++; }
    if (entry.got < entry.count) {
      // A newer frame complete while this one waits: its fragments were lost.
      for (const n of w.frames.keys()) if (n < frameNo - 3) { w.frames.delete(n); w.stats.dropped++; if (!w.needKey) { w.needKey = true; this.requestKey(w); } }
      return;
    }
    w.frames.delete(frameNo);
    for (const n of w.frames.keys()) if (n < frameNo) { w.frames.delete(n); w.stats.dropped++; w.needKey = true; }
    if (frameNo <= w.lastFrame) return;
    if (frameNo !== w.lastFrame + 1 && !entry.key) w.needKey = true;
    if (w.needKey && !entry.key) { this.requestKey(w); w.stats.dropped++; return; }
    w.needKey = false;
    w.lastFrame = frameNo;
    const size = entry.parts.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of entry.parts) { bytes.set(p, at); at += p.length; }
    const Chunk = (globalThis as any).EncodedVideoChunk;
    try {
      w.decoder.decode(new Chunk({ type: entry.key ? 'key' : 'delta', timestamp: ts, data: bytes }));
    } catch { w.needKey = true; this.resetDecoder(w); return; }
    w.stats.frames++;
    const offset = this.offsets.get(w.source);
    if (offset != null) { w.stats.delaySum += Date.now() + offset - entry.capturedAt; w.stats.delayCount++; }
    void channel;
  }

  private requestKey(w: Watching, force = false): void {
    if (!w.upstream || w.upstream.readyState !== 'open') return;
    if (!force && now() - w.lastKeyRequest < KEY_REQUEST_MIN_MS) return;
    w.lastKeyRequest = now();
    w.stats.keyRequests++;
    try { w.upstream.send(new Uint8Array([KEY_REQUEST])); } catch { /* closing */ }
  }

  private report(w: Watching): void {
    if (!w.parent || w.stopped) return;
    this.host.gossip.sendDirect(w.source, { __ppType: REPORT, id: w.id, parent: w.parent, depth: w.depth, children: w.children.size, links: this.host.mesh.getConnectedPeers() });
  }

  // ---------------------------------------------------------------- both

  /** A child opened a side channel to this peer: feed it, if this peer has the stream. */
  private onSideChannel(peerId: string, name: string, channel: RTCDataChannel): void {
    if (!name.startsWith('m:')) return;
    const id = name.slice(2);
    const p = this.published.get(id);
    const w = this.watching.get(id);
    const children = p?.children ?? w?.children;
    if (!children || (w && w.parent === peerId)) { try { channel.close(); } catch { /* closed */ } return; }
    const child: Child = { peerId, channel, waitingForKey: true };
    const drop = () => { if (children.get(peerId)?.channel === channel) children.delete(peerId); };
    channel.onclose = drop;
    channel.onerror = drop;
    channel.onmessage = (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer && data.byteLength === 1 && new Uint8Array(data)[0] === KEY_REQUEST) {
        child.waitingForKey = true;
        this.upstreamKey(id);
      }
    };
    const old = children.get(peerId);
    if (old && old.channel !== channel) { old.channel.onclose = null; try { old.channel.close(); } catch { /* closed */ } }
    children.set(peerId, child);
    this.upstreamKey(id);
  }

  /** A key frame for a child: the source makes one, a viewer asks its own parent. */
  private upstreamKey(id: string): void {
    const p = this.published.get(id);
    if (p) {
      p.stats.keyRequests++;
      const wait = KEY_REQUEST_MIN_MS - (now() - p.lastKeyAt);
      // Too soon after the last one: one more, as soon as allowed (not none).
      if (wait <= 0) p.forceKey = true;
      else if (!p.keyTimer) p.keyTimer = setTimeout(() => { p.keyTimer = null; p.forceKey = true; }, wait);
      return;
    }
    const w = this.watching.get(id);
    if (w) this.requestKey(w);
  }

  private onPeerGone(peerId: string): void {
    for (const p of this.published.values()) { p.children.delete(peerId); p.members.delete(peerId); }
    for (const w of this.watching.values()) {
      w.children.delete(peerId);
      if (w.parent === peerId) this.lostParent(w, 'disconnected');
    }
  }

  private onControl(from: string | undefined, data: any): void {
    if (!from || !data || typeof data !== 'object' || typeof data.__ppType !== 'string' || !data.__ppType.startsWith(MEDIA_PAYLOAD_PREFIX)) return;
    const t = now();
    switch (data.__ppType) {
      case ANNOUNCE: {
        if (typeof data.id !== 'string') return;
        const known = this.streams.has(data.id);
        this.streams.set(data.id, { id: data.id, source: from, name: String(data.name ?? 'Camera').slice(0, 80), width: Number(data.width) || 0, height: Number(data.height) || 0, fps: Number(data.fps) || 0, live: true, seen: t });
        if (!known) this.emit('streams', this.list());
        return;
      }
      case END: {
        if (this.streams.get(data.id)?.source !== from) return;
        this.streams.delete(data.id);
        this.unwatch(data.id);
        this.emit('streams', this.list());
        return;
      }
      case JOIN: {
        const p = this.published.get(data.id);
        if (!p || typeof data.nonce !== 'string') return;
        const links = Array.isArray(data.links) ? data.links.map(String) : [];
        const avoid = Array.isArray(data.avoid) ? data.avoid.map(String) : [];
        const { parent, depth } = this.pickParent(p, from, links, avoid);
        this.host.gossip.sendDirect(from, { __ppType: ATTACH, id: p.id, nonce: data.nonce, parent, depth });
        return;
      }
      case ATTACH: {
        const done = this.pendingAttach.get(data.nonce);
        if (done && typeof data.parent === 'string') done({ parent: data.parent, depth: Number(data.depth) || 1 });
        return;
      }
      case REPORT: {
        const p = this.published.get(data.id);
        if (!p || typeof data.parent !== 'string') return;
        p.members.set(from, { peerId: from, parent: data.parent, depth: Number(data.depth) || 1, children: Number(data.children) || 0, links: Array.isArray(data.links) ? data.links.map(String) : [], seen: t });
        return;
      }
      case PING: {
        this.host.gossip.sendDirect(from, { __ppType: PONG, t0: data.t0, t1: Date.now() });
        return;
      }
      case PONG: {
        const t0 = Number(data.t0); const t1 = Number(data.t1); const t3 = Date.now();
        if (!Number.isFinite(t0) || !Number.isFinite(t1) || t3 - t0 > 2_000) return;
        const offset = t1 - (t0 + t3) / 2;
        const rtt = t3 - t0;
        // The quickest exchange wins: a slow answer (a busy peer, a long route) says more about the
        // delay than about the clock. A best sample a minute old gives way.
        const best = this.offsetSamples.get(from);
        if (!best || rtt <= best.rtt * 1.2 || t3 - best.at > 60_000) {
          this.offsetSamples.set(from, { rtt, offset, at: t3 });
          this.offsets.set(from, offset);
        }
        return;
      }
    }
  }

  private pingSources(): void {
    const sources = new Set([...this.watching.values()].map((w) => w.source));
    for (const s of sources) this.host.gossip.sendDirect(s, { __ppType: PING, t0: Date.now() });
  }

  private tick(): void {
    const t = now();
    for (const p of this.published.values()) p.stats.roll(t);
    for (const w of this.watching.values()) w.stats.roll(t);
    let changed = false;
    for (const [id, s] of this.streams) {
      if (this.published.has(id)) { s.seen = t; continue; }
      if (t - s.seen > ANNOUNCE_STALE_MS * 2) { this.streams.delete(id); this.unwatch(id); changed = true; }
    }
    if (changed) this.emit('streams', this.list());
    if (this.published.size || this.watching.size) this.emit('stats', this.stats());
  }

  destroy(): void {
    for (const id of [...this.published.keys()]) this.unpublish(id);
    for (const id of [...this.watching.keys()]) this.unwatch(id);
    for (const timer of this.timers) clearInterval(timer);
    this.listeners.clear();
  }

  private emit(event: string, ...args: any[]): void {
    for (const handler of this.listeners.get(event) ?? []) { try { handler(...args); } catch { /* the app's */ } }
  }
}

function makeFragments(frameNo: number, key: boolean, capturedAt: number, ts: number, bytes: Uint8Array): Uint8Array[] {
  const count = Math.max(1, Math.ceil(bytes.length / FRAGMENT));
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const slice = bytes.subarray(i * FRAGMENT, Math.min(bytes.length, (i + 1) * FRAGMENT));
    const frag = new Uint8Array(HEADER + slice.length);
    const view = new DataView(frag.buffer);
    view.setUint8(0, 0x50); view.setUint8(1, 0x4d); view.setUint8(2, 1); view.setUint8(3, key ? 1 : 0);
    view.setUint32(4, frameNo >>> 0);
    view.setUint16(8, i); view.setUint16(10, count);
    view.setFloat64(12, capturedAt); view.setFloat64(20, ts);
    frag.set(slice, HEADER);
    out.push(frag);
  }
  return out;
}

/**
 * Fragments to one child. A child that is behind (its channel's queue too long) or that asked for a key
 * frame gets nothing until a key frame starts: a delta it could not decode is upload spent for nothing.
 */
function sendToChild(child: Child, fragments: Uint8Array[], key: boolean, stats: Counter, frameStart = true): void {
  const ch = child.channel;
  if (ch.readyState !== 'open') return;
  if (frameStart) {
    if (ch.bufferedAmount > CHILD_BACKLOG_BYTES) { child.waitingForKey = true; stats.dropped++; return; }
    if (child.waitingForKey && !key) return;
    if (key) child.waitingForKey = false;
  } else if (child.waitingForKey) return;
  for (const f of fragments) { try { ch.send(f as unknown as ArrayBuffer); } catch { return; } }
}

function waitOpen(channel: RTCDataChannel, ms: number): Promise<boolean> {
  if (channel.readyState === 'open') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    channel.addEventListener('open', () => { clearTimeout(timer); resolve(true); }, { once: true });
    channel.addEventListener('close', () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
