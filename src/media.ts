/**
 * Media streams over the mesh, with peers as forwarders: a "virtual SFU".
 *
 * A source (a camera, a microphone, or a file playing: mp4, mp3) encodes with WebCodecs and sends the
 * encoded frames, in fragments, over side channels: more data channels on the peers' own WebRTC links,
 * unordered, each fragment resent for at most a quarter of a second. A viewer not fed by the source is
 * fed by another viewer: every viewer forwards, passing the bytes on as they came (no decoding, no
 * re-encoding), so a stream reaches many peers while the source uploads it a few times. The relays
 * never carry any of it.
 *
 * Quality levels: the source can encode the video at three sizes (high, medium, low), and encodes only
 * the ones someone below it wants. Each peer tells its parent which levels it needs (its own, and its
 * children's); a viewer on Auto steps down when frames go missing and back up after a clean stretch.
 * Audio (Opus) goes to everyone.
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
const AUDIO_RATE = 48_000;
/** Opus frames of 20 ms. */
const AUDIO_FRAME = 960;

// A fragment on the wire: 'P' 'M', version 2, flags (bit 0: key frame, bit 1: audio), the video level
// (0 low, 1 medium, 2 high; 0 for audio), a spare byte, frame number (u32, counted per level and for
// audio), fragment index (u16), fragments in the frame (u16), capture time at the source (f64, its clock,
// ms), the encoder's timestamp (f64, µs), then the fragment's bytes.
// Upstream, a child sends two bytes: 'K' and a level (a key frame of that level, please), or 'L' and a
// mask of the levels it needs (bit n: level n).
const HEADER = 30;
const FRAGMENT = 15_000;
const KEY_REQUEST = 0x4b;
const LEVELS_WANTED = 0x4c;
const FLAG_KEY = 1;
const FLAG_AUDIO = 2;

export type MediaQuality = 'auto' | 'high' | 'medium' | 'low';
const QUALITY_LEVEL: Record<Exclude<MediaQuality, 'auto'>, number> = { low: 0, medium: 1, high: 2 };
const LEVEL_NAMES = ['low', 'medium', 'high'] as const;

export interface MediaPublishOptions {
  name?: string;
  /** The high level's size; medium is half, low a quarter. */
  width?: number;
  height?: number;
  fps?: number;
  /** The high level's bitrate, bits a second. */
  bitrate?: number;
  /** Viewers fed by the source itself; more are fed by viewers. */
  maxChildren?: number;
  /** Encode medium and low as well (on by default). */
  levels?: boolean;
}

/** What to send: a camera track, or a playing <video>; a microphone track, or a playing <audio>/<video>. */
export interface MediaPublishInput {
  video?: MediaStreamTrack | HTMLVideoElement;
  audio?: MediaStreamTrack | HTMLMediaElement;
}

/** A video level: 0 low, 1 medium, 2 high. */
export interface MediaLevel { level: number; width: number; height: number; fps: number; kbps: number }

export interface MediaStreamInfo {
  id: string;
  source: string;
  name: string;
  video: boolean;
  audio: boolean;
  /** The video's levels, low to high. */
  levels: MediaLevel[];
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
  /** The level shown here (viewer), or the levels being encoded (source). */
  level: string | null;
  levels: string[];
  quality: MediaQuality | null;
  audio: boolean;
  audioKbps: number;
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

interface Child { peerId: string; channel: RTCDataChannel; mask: number; waiting: Set<number> }

interface LevelEncoder { level: number; width: number; height: number; fps: number; bitrate: number; encoder: any; canvas: any; frame: number; forceKey: boolean; lastKeyAt: number; keyTimer: ReturnType<typeof setTimeout> | null; tick: number }

interface Published {
  id: string;
  name: string;
  opts: Required<Omit<MediaPublishOptions, 'name' | 'width' | 'height' | 'levels'>>;
  video: HTMLVideoElement | null;
  ownVideo: boolean;
  levels: LevelEncoder[];
  timer: ReturnType<typeof setInterval> | null;
  audio: AudioSend | null;
  children: Map<string, Child>;
  members: Map<string, Member>;
  stats: Counter;
  audioStats: Counter;
  announceTimer: ReturnType<typeof setInterval> | null;
  info: MediaStreamInfo;
}

interface AudioSend { context: AudioContext; node: AudioWorkletNode; sourceNode: AudioNode; channels: number; encoder: any; samples: number; frame: number; ownElement: boolean }

interface LevelRx { frames: Map<number, { got: number; count: number; parts: Uint8Array[]; key: boolean; capturedAt: number; ts: number }>; lastFrame: number; needKey: boolean }

interface Watching {
  id: string;
  source: string;
  info: MediaStreamInfo;
  parent: string | null;
  depth: number;
  upstream: RTCDataChannel | null;
  children: Map<string, Child>;
  decoder: any;
  onFrame: ((frame: any) => void) | null;
  rx: Map<number, LevelRx>;
  /** The level decoded now, and the one being switched to (decoded from its first key frame on). */
  level: number;
  target: number;
  quality: MediaQuality;
  sentMask: number;
  lastKeyRequest: number;
  lastData: number;
  joining: boolean;
  lostAt: number | null;
  avoid: Set<string>;
  stats: Counter;
  audioStats: Counter;
  audio: AudioReceive | null;
  muted: boolean;
  /** Auto: windows in a row with losses, without, and when it last stepped down. */
  badWindows: number;
  goodWindows: number;
  lastDownAt: number;
  lastWindow: { frames: number; dropped: number };
  watchdog: ReturnType<typeof setInterval> | null;
  reportTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

interface AudioReceive { context: AudioContext; node: AudioWorkletNode | null; gain: GainNode; decoder: any; lastFrame: number; ready: Promise<void> }

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
  totalFrames = 0;
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
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Audio in and out of the page: capture hands the graph's samples to the main thread; playback plays
// what it is given, after a short buffer (60 ms), and drops the oldest when more than 250 ms waits.
const WORKLETS = `
class PPCapture extends AudioWorkletProcessor {
  process(inputs) { const i = inputs[0]; if (i && i.length && i[0].length) this.port.postMessage(i.map((c) => c.slice(0))); return true; }
}
registerProcessor('pp-capture', PPCapture);
class PPPlay extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = []; this.off = 0; this.started = false;
    this.port.onmessage = (e) => {
      this.q.push(e.data);
      let total = -this.off; for (const b of this.q) total += b[0].length;
      while (total > sampleRate * 0.25 && this.q.length > 1) { total -= this.q[0][0].length - this.off; this.q.shift(); this.off = 0; }
    };
  }
  process(_, outputs) {
    const out = outputs[0]; const n = out[0].length;
    let total = -this.off; for (const b of this.q) total += b[0].length;
    if (!this.started && total < sampleRate * 0.06) { for (const c of out) c.fill(0); return true; }
    this.started = total > 0;
    let w = 0;
    while (w < n && this.q.length) {
      const b = this.q[0]; const take = Math.min(n - w, b[0].length - this.off);
      for (let c = 0; c < out.length; c++) out[c].set(b[Math.min(c, b.length - 1)].subarray(this.off, this.off + take), w);
      w += take; this.off += take;
      if (this.off >= b[0].length) { this.q.shift(); this.off = 0; }
    }
    for (const c of out) c.fill(0, w);
    if (w < n) this.started = false;
    return true;
  }
}
registerProcessor('pp-play', PPPlay);
`;
const workletsLoaded = new WeakMap<AudioContext, Promise<void>>();
function loadWorklets(context: AudioContext): Promise<void> {
  let ready = workletsLoaded.get(context);
  if (!ready) {
    const url = URL.createObjectURL(new Blob([WORKLETS], { type: 'application/javascript' }));
    ready = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    workletsLoaded.set(context, ready);
  }
  return ready;
}

export class MediaStreams {
  private readonly published = new Map<string, Published>();
  private readonly watching = new Map<string, Watching>();
  private readonly streams = new Map<string, MediaStreamInfo & { seen: number }>();
  /** Clock offsets to sources: their clock minus ours, ms, from the quickest recent exchange. */
  private readonly offsets = new Map<string, number>();
  private readonly offsetSamples = new Map<string, { rtt: number; offset: number; at: number }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly pendingAttach = new Map<string, (value: { parent: string; depth: number } | null) => void>();

  constructor(private readonly host: MediaHost) {
    host.gossip.on('messageReceived', ({ message, local }: any) => { if (!local) this.onControl(message?.sender, message?.data); });
    host.gossip.on('directMessageReceived', ({ message }: any) => this.onControl(message?.from, message?.data));
    host.mesh.on('peer:sidechannel', ({ peerId, name, channel }: any) => this.onSideChannel(peerId, name, channel));
    host.mesh.on('peer:disconnected', (peerId: string) => this.onPeerGone(peerId));
    this.timers.push(setInterval(() => this.tick(), 1_000));
    this.timers.push(setInterval(() => this.pingSources(), PING_MS));
  }

  /** Whether this browser can send or receive video (WebCodecs). */
  static supported(): boolean {
    return typeof (globalThis as any).VideoEncoder === 'function' && typeof (globalThis as any).VideoDecoder === 'function';
  }

  /** Whether this browser can send or receive audio (WebCodecs' AudioEncoder and AudioDecoder, and AudioWorklet). */
  static audioSupported(): boolean {
    return typeof (globalThis as any).AudioEncoder === 'function' && typeof (globalThis as any).AudioDecoder === 'function'
      && typeof (globalThis as any).AudioWorkletNode === 'function';
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
      out.push({
        id: p.id, role: 'source', parent: null, children: [...p.children.keys()], depth: 0, fps: p.stats.fps, kbps: p.stats.kbps,
        level: null, levels: p.levels.filter((l) => l.encoder).map((l) => LEVEL_NAMES[l.level]), quality: null,
        audio: !!p.audio, audioKbps: p.audioStats.kbps, delayMs: null, forwardMs: null, framesDropped: p.stats.dropped,
        keyRequests: p.stats.keyRequests, lastRecoveryMs: null, recoveries: 0,
      });
    }
    for (const w of this.watching.values()) {
      out.push({
        id: w.id, role: 'viewer', parent: w.parent, children: [...w.children.keys()], depth: w.depth, fps: w.stats.fps, kbps: w.stats.kbps,
        level: w.info.video ? LEVEL_NAMES[w.level] : null, levels: levelsIn(this.neededMask(w)), quality: w.info.video ? w.quality : null,
        audio: w.info.audio, audioKbps: w.audioStats.kbps, delayMs: w.info.video ? w.stats.delayMs : w.audioStats.delayMs,
        forwardMs: w.children.size ? w.stats.forwardMs : null, framesDropped: w.stats.dropped, keyRequests: w.stats.keyRequests,
        lastRecoveryMs: w.stats.lastRecoveryMs, recoveries: w.stats.recoveries,
      });
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

  /**
   * Send video, audio or both: a camera or microphone track, or a <video>/<audio> playing a file (the
   * stream follows it: pause, seek). A track given alone is taken as video or audio by its kind.
   */
  async publish(input: MediaStreamTrack | MediaPublishInput, options: MediaPublishOptions = {}): Promise<string> {
    const given: MediaPublishInput = isTrack(input) ? (input.kind === 'audio' ? { audio: input } : { video: input }) : input;
    if (!given.video && !given.audio) throw new Error('Nothing to send: give a video or an audio source');
    if (given.video && !MediaStreams.supported()) throw new Error('This browser has no WebCodecs: it cannot send video');
    if (given.audio && !MediaStreams.audioSupported()) throw new Error('This browser cannot encode audio here');
    const id = randomId();
    const opts = { fps: options.fps ?? 30, bitrate: options.bitrate ?? 1_500_000, maxChildren: options.maxChildren ?? 3 };

    // Video: frames from a <video> (the camera's, or the file's), at each level's size.
    let video: HTMLVideoElement | null = null;
    let ownVideo = false;
    const levels: LevelEncoder[] = [];
    if (given.video) {
      if (isTrack(given.video)) {
        video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.autoplay = true;
        video.srcObject = new MediaStream([given.video]);
        await video.play().catch(() => {});
        ownVideo = true;
        const s = given.video.getSettings?.() ?? {};
        opts.fps = options.fps ?? Math.min(30, Math.round(s.frameRate ?? 30));
      } else {
        video = given.video;
        if (video.readyState < 1) {
          const el = video;
          const loaded = await new Promise<boolean>((r) => { const t = setTimeout(() => r(false), 10_000); el.addEventListener('loadedmetadata', () => { clearTimeout(t); r(true); }, { once: true }); el.addEventListener('error', () => { clearTimeout(t); r(false); }, { once: true }); });
          if (!loaded) throw new Error('This browser can’t play that video');
        }
      }
      const srcW = options.width ?? (video.videoWidth || 1280);
      const srcH = options.height ?? (video.videoHeight || 720);
      const scale = Math.min(1, 1280 / srcW, 720 / srcH);
      const highW = even(srcW * scale); const highH = even(srcH * scale);
      const plan = options.levels === false
        ? [{ level: 2, div: 1, rate: 1, fps: opts.fps }]
        : [{ level: 0, div: 4, rate: 0.1, fps: Math.min(15, opts.fps) }, { level: 1, div: 2, rate: 0.3, fps: opts.fps }, { level: 2, div: 1, rate: 1, fps: opts.fps }];
      for (const l of plan) {
        if (l.div > 1 && highW / l.div < 120) continue;
        levels.push({ level: l.level, width: even(highW / l.div), height: even(highH / l.div), fps: l.fps, bitrate: Math.round(opts.bitrate * l.rate), encoder: null, canvas: null, frame: 0, forceKey: true, lastKeyAt: 0, keyTimer: null, tick: 0 });
      }
    }

    const info: MediaStreamInfo = {
      id, source: this.host.mesh.getClientId() ?? '', name: options.name ?? (given.video ? 'Camera' : 'Audio'),
      video: levels.length > 0, audio: !!given.audio,
      levels: levels.map((l) => ({ level: l.level, width: l.width, height: l.height, fps: l.fps, kbps: Math.round(l.bitrate / 1000) })),
      width: levels[levels.length - 1]?.width ?? 0, height: levels[levels.length - 1]?.height ?? 0, fps: levels[levels.length - 1]?.fps ?? 0, live: true,
    };
    const p: Published = {
      id, name: info.name, opts, video, ownVideo, levels, timer: null, audio: null, children: new Map(), members: new Map(),
      stats: new Counter(), audioStats: new Counter(), announceTimer: null, info,
    };
    this.published.set(id, p);

    if (levels.length) {
      const started = performance.now();
      p.timer = setInterval(() => this.encodeTick(p, started), Math.round(1000 / opts.fps));
    }
    if (given.audio) p.audio = await this.startAudioSend(p, given.audio);

    this.streams.set(id, { ...info, seen: now() });
    const announce = () => this.host.gossip.broadcast({ __ppType: ANNOUNCE, ...announced(p.info) });
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
    if (p.announceTimer) clearInterval(p.announceTimer);
    for (const l of p.levels) { if (l.keyTimer) clearTimeout(l.keyTimer); try { l.encoder?.close(); } catch { /* closed */ } }
    if (p.ownVideo && p.video) p.video.srcObject = null;
    if (p.audio) {
      try { p.audio.node.disconnect(); p.audio.sourceNode.disconnect(); } catch { /* gone */ }
      try { p.audio.encoder.close(); } catch { /* closed */ }
      if (p.audio.ownElement) void p.audio.context.close().catch(() => {});
    }
    for (const c of p.children.values()) { try { c.channel.close(); } catch { /* closed */ } }
    this.streams.delete(id);
    this.host.gossip.broadcast({ __ppType: END, id });
    this.emit('streams', this.list());
  }

  /** The levels the source's children need, and so the ones it encodes. */
  private wantedLevels(p: Published): number {
    let mask = 0;
    for (const c of p.children.values()) mask |= c.mask;
    return mask;
  }

  private encodeTick(p: Published, started: number): void {
    const video = p.video;
    // A paused file is still sent (a still picture, cheap): silence would read as a lost parent.
    if (!video || video.readyState < 2) return;
    const wanted = this.wantedLevels(p);
    const VF = (globalThis as any).VideoFrame;
    const timestamp = Math.round((performance.now() - started) * 1000);
    for (const l of p.levels) {
      if (!(wanted & (1 << l.level))) {
        // Nobody below wants this level: stop encoding it (a key frame starts it again).
        if (l.encoder) { try { l.encoder.close(); } catch { /* closed */ } l.encoder = null; }
        continue;
      }
      if (!l.encoder) { this.openEncoder(p, l); l.forceKey = true; }
      if (l.encoder.state !== 'configured') continue;
      // A level at a lower frame rate skips ticks.
      l.tick++;
      if (l.fps < p.opts.fps && l.tick % Math.round(p.opts.fps / l.fps) !== 0) continue;
      if (l.encoder.encodeQueueSize > 2) { p.stats.dropped++; continue; }
      let frame: any;
      try {
        if (video.videoWidth === l.width && video.videoHeight === l.height) frame = new VF(video, { timestamp });
        else {
          if (!l.canvas) {
            const C = (globalThis as any).OffscreenCanvas;
            l.canvas = C ? new C(l.width, l.height) : Object.assign(document.createElement('canvas'), { width: l.width, height: l.height });
          }
          l.canvas.getContext('2d').drawImage(video, 0, 0, l.width, l.height);
          frame = new VF(l.canvas, { timestamp });
        }
      } catch { continue; }
      const key = l.forceKey || now() - l.lastKeyAt >= KEY_INTERVAL_MS;
      if (key) { l.forceKey = false; l.lastKeyAt = now(); }
      try { l.encoder.encode(frame, { keyFrame: key }); } catch { l.forceKey = true; } finally { frame.close(); }
    }
  }

  private openEncoder(p: Published, l: LevelEncoder): void {
    const Encoder = (globalThis as any).VideoEncoder;
    l.encoder = new Encoder({
      output: (chunk: any) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const key = chunk.type === 'key';
        const fragments = makeFragments(key ? FLAG_KEY : 0, l.level, l.frame++, Date.now(), chunk.timestamp, bytes);
        if (l.level === highestLevel(this.wantedLevels(p))) { p.stats.frames++; }
        p.stats.bytes += bytes.length;
        for (const child of p.children.values()) sendVideo(child, fragments, l.level, key, p.stats, true);
      },
      error: () => { l.forceKey = true; try { l.encoder?.close(); } catch { /* closed */ } l.encoder = null; },
    });
    l.encoder.configure({ codec: 'vp8', width: l.width, height: l.height, bitrate: l.bitrate, framerate: l.fps, latencyMode: 'realtime' });
  }

  private async startAudioSend(p: Published, source: MediaStreamTrack | HTMLMediaElement): Promise<AudioSend> {
    const context = new AudioContext({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
    await loadWorklets(context);
    if (context.state === 'suspended') await context.resume().catch(() => {});
    let sourceNode: AudioNode;
    let ownElement = true;
    let channels = 1;
    if (isTrack(source)) {
      sourceNode = context.createMediaStreamSource(new MediaStream([source]));
      channels = Math.min(2, source.getSettings?.().channelCount ?? 1) || 1;
    } else {
      // A file playing: heard here too, and sent.
      sourceNode = context.createMediaElementSource(source);
      sourceNode.connect(context.destination);
      channels = 2;
    }
    const node = new AudioWorkletNode(context, 'pp-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: channels, channelCountMode: 'explicit' });
    sourceNode.connect(node);
    // Pulled through a silent gain, so the capture runs without playing the microphone back.
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(context.destination);
    const Encoder = (globalThis as any).AudioEncoder;
    const send: AudioSend = { context, node, sourceNode, channels, encoder: null, samples: 0, frame: 0, ownElement };
    send.encoder = new Encoder({
      output: (chunk: any) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const fragments = makeFragments(FLAG_AUDIO | FLAG_KEY, 0, send.frame++, Date.now(), chunk.timestamp, bytes);
        p.audioStats.frames++;
        p.audioStats.bytes += bytes.length;
        for (const child of p.children.values()) sendAudio(child, fragments);
      },
      error: () => { /* the next frames try again */ },
    });
    send.encoder.configure({ codec: 'opus', sampleRate: AUDIO_RATE, numberOfChannels: channels, bitrate: channels > 1 ? 96_000 : 48_000 });
    const AD = (globalThis as any).AudioData;
    // 20 ms frames, from the graph's 128-sample blocks.
    const frame = new Float32Array(AUDIO_FRAME * channels);
    let fill = 0;
    node.port.onmessage = (event) => {
      if (!p.children.size) { fill = 0; return; }
      const planes: Float32Array[] = event.data;
      const n = planes[0]?.length ?? 0;
      let read = 0;
      while (read < n) {
        const take = Math.min(n - read, AUDIO_FRAME - fill);
        for (let c = 0; c < channels; c++) frame.set(planes[Math.min(c, planes.length - 1)].subarray(read, read + take), c * AUDIO_FRAME + fill);
        fill += take; read += take;
        if (fill < AUDIO_FRAME) break;
        fill = 0;
        const timestamp = Math.round((send.samples / AUDIO_RATE) * 1e6);
        send.samples += AUDIO_FRAME;
        let audioData: any;
        try { audioData = new AD({ format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: AUDIO_FRAME, numberOfChannels: channels, timestamp, data: frame.slice() }); } catch { continue; }
        try { if (send.encoder.state === 'configured') send.encoder.encode(audioData); } finally { audioData.close(); }
      }
    };
    return send;
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

  /**
   * Watch a stream. Video frames go to onFrame (draw them, then frame.close()); audio plays here. Call
   * it from a click or a key press: browsers start sound only then.
   */
  watch(id: string, onFrame: ((frame: any) => void) | null, options: { quality?: MediaQuality; muted?: boolean } = {}): void {
    if (this.watching.has(id)) return;
    const known = this.streams.get(id);
    if (!known) throw new Error('No such stream in this room');
    const { seen: _seen, ...info } = known;
    if (info.video && !MediaStreams.supported()) throw new Error('This browser has no WebCodecs: it cannot show video');
    const quality = options.quality ?? 'auto';
    const level = info.video ? this.levelFor(info, quality === 'auto' ? 'high' : quality) : 0;
    const w: Watching = {
      id, source: info.source, info, parent: null, depth: 0, upstream: null, children: new Map(), decoder: null, onFrame,
      rx: new Map(), level, target: level, quality, sentMask: -1, lastKeyRequest: 0, lastData: now(), joining: false, lostAt: null,
      avoid: new Set(), stats: new Counter(), audioStats: new Counter(), audio: null, muted: !!options.muted,
      badWindows: 0, goodWindows: 0, lastDownAt: 0, lastWindow: { frames: 0, dropped: 0 }, watchdog: null, reportTimer: null, stopped: false,
    };
    if (info.video) {
      const Decoder = (globalThis as any).VideoDecoder;
      w.decoder = new Decoder({
        output: (frame: any) => {
          if (w.lostAt != null) { w.stats.lastRecoveryMs = now() - w.lostAt; w.stats.recoveries++; w.lostAt = null; }
          if (!w.onFrame) { frame.close(); return; }
          try { w.onFrame(frame); } catch { try { frame.close(); } catch { /* closed */ } }
        },
        error: () => { this.levelRx(w, w.level).needKey = true; this.resetDecoder(w); },
      });
      w.decoder.configure({ codec: 'vp8', optimizeForLatency: true });
    }
    if (info.audio && MediaStreams.audioSupported()) w.audio = this.startAudioReceive(w);
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
    if (w.audio) { try { w.audio.decoder?.close(); } catch { /* closed */ } void w.audio.context.close().catch(() => {}); }
  }

  /** Auto, or one level: high, medium or low (the nearest the stream has). */
  setQuality(id: string, quality: MediaQuality): void {
    const w = this.watching.get(id);
    if (!w || !w.info.video) return;
    w.quality = quality;
    w.badWindows = 0; w.goodWindows = 0;
    this.switchTo(w, this.levelFor(w.info, quality === 'auto' ? LEVEL_NAMES[w.level] : quality));
  }

  setMuted(id: string, muted: boolean): void {
    const w = this.watching.get(id);
    if (!w) return;
    w.muted = muted;
    if (w.audio) w.audio.gain.gain.value = muted ? 0 : 1;
    if (!muted) void w.audio?.context.resume().catch(() => {});
  }

  /** The level nearest a quality that the stream has: the highest at or below it, else its lowest. */
  private levelFor(info: MediaStreamInfo, quality: Exclude<MediaQuality, 'auto'>): number {
    const have = info.levels.map((l) => l.level).sort((a, b) => a - b);
    if (!have.length) return 0;
    const want = QUALITY_LEVEL[quality];
    const below = have.filter((l) => l <= want);
    return below.length ? below[below.length - 1] : have[0];
  }

  /** The stream's next level down or up from this one, or null at the end. */
  private stepLevel(info: MediaStreamInfo, level: number, by: 1 | -1): number | null {
    const have = info.levels.map((l) => l.level).sort((a, b) => a - b);
    const i = have.indexOf(level) + by;
    return i >= 0 && i < have.length && have.indexOf(level) >= 0 ? have[i] : null;
  }

  /** The levels this peer needs from its parent: the one it shows, one it is switching to, its children's. */
  private neededMask(w: Watching): number {
    if (!w.info.video) return 0;
    let mask = (1 << w.level) | (1 << w.target);
    for (const c of w.children.values()) mask |= c.mask;
    return mask;
  }

  private sendWanted(w: Watching, force = false): void {
    const mask = this.neededMask(w);
    if (!force && mask === w.sentMask) return;
    if (!w.upstream || w.upstream.readyState !== 'open') return;
    try { w.upstream.send(new Uint8Array([LEVELS_WANTED, mask])); w.sentMask = mask; } catch { /* closing */ }
  }

  private switchTo(w: Watching, level: number): void {
    if (level === w.target) return;
    w.target = level;
    const rx = this.levelRx(w, level);
    rx.needKey = true;
    rx.frames.clear();
    this.sendWanted(w);
    this.requestKey(w, level, true);
  }

  private levelRx(w: Watching, level: number): LevelRx {
    let rx = w.rx.get(level);
    if (!rx) { rx = { frames: new Map(), lastFrame: -1, needKey: true }; w.rx.set(level, rx); }
    return rx;
  }

  private resetDecoder(w: Watching): void {
    try { w.decoder.reset(); w.decoder.configure({ codec: 'vp8', optimizeForLatency: true }); } catch { /* closed */ }
  }

  private startAudioReceive(w: Watching): AudioReceive {
    // Made here, in the click that started watching: browsers let sound start only from one.
    const context = new AudioContext({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
    const gain = context.createGain();
    gain.gain.value = w.muted ? 0 : 1;
    gain.connect(context.destination);
    const audio: AudioReceive = { context, node: null, gain, decoder: null, lastFrame: -1, ready: Promise.resolve() };
    audio.ready = loadWorklets(context).then(() => {
      audio.node = new AudioWorkletNode(context, 'pp-play', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      audio.node.connect(gain);
    }).catch(() => {});
    void context.resume().catch(() => {});
    const Decoder = (globalThis as any).AudioDecoder;
    audio.decoder = new Decoder({
      output: (data: any) => {
        if (w.lostAt != null && !w.info.video) { w.stats.lastRecoveryMs = now() - w.lostAt; w.stats.recoveries++; w.lostAt = null; }
        try {
          if (!audio.node) return;
          const planes: Float32Array[] = [];
          for (let c = 0; c < data.numberOfChannels; c++) {
            const plane = new Float32Array(data.numberOfFrames);
            data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
            planes.push(plane);
          }
          audio.node.port.postMessage(planes, planes.map((pl) => pl.buffer));
        } finally { data.close(); }
      },
      error: () => { /* the next frames try again */ },
    });
    audio.decoder.configure({ codec: 'opus', sampleRate: AUDIO_RATE, numberOfChannels: 2 });
    return audio;
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
      for (const rx of w.rx.values()) { rx.needKey = true; rx.frames.clear(); }
      w.lastData = now();
      w.avoid.clear();
      channel.onmessage = (event) => this.onFragment(w, event.data);
      channel.onclose = () => { if (w.upstream === channel) this.lostParent(w, 'closed'); };
      this.sendWanted(w, true);
      if (w.info.video) this.requestKey(w, w.target, true);
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

  private lostParent(w: Watching, _why: string): void {
    if (w.stopped || w.joining) return;
    if (w.lostAt == null) w.lostAt = now();
    if (w.parent) w.avoid.add(w.parent);
    const old = w.upstream;
    w.upstream = null;
    w.parent = null;
    w.sentMask = -1;
    if (old) { old.onclose = null; try { old.close(); } catch { /* closed */ } }
    void this.join(w);
  }

  private onFragment(w: Watching, data: ArrayBuffer): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength < HEADER) return;
    const arrived = performance.now();
    w.lastData = now();
    const view = new DataView(data);
    if (view.getUint8(0) !== 0x50 || view.getUint8(1) !== 0x4d || view.getUint8(2) !== 2) return;
    const flags = view.getUint8(3);
    const level = view.getUint8(4);
    const frameNo = view.getUint32(6);
    const index = view.getUint16(10);
    const count = view.getUint16(12);
    const capturedAt = view.getFloat64(14);
    const ts = view.getFloat64(22);
    const audio = (flags & FLAG_AUDIO) !== 0;
    const key = (flags & FLAG_KEY) !== 0;
    // On to the children first, as received: this peer never decodes for them.
    if (w.children.size) {
      const frag = new Uint8Array(data);
      for (const child of w.children.values()) {
        if (audio) sendAudio(child, [frag]);
        else sendVideo(child, [frag], level, key, w.stats, index === 0);
      }
      w.stats.forwardSum += performance.now() - arrived;
      w.stats.forwardCount++;
    }
    if (audio) { this.onAudioFragment(w, count, ts, capturedAt, new Uint8Array(data, HEADER), data.byteLength, frameNo); return; }
    if (level !== w.level && level !== w.target) return;
    const counted = level === w.level;
    if (counted) w.stats.bytes += data.byteLength;
    const rx = this.levelRx(w, level);
    let entry = rx.frames.get(frameNo);
    if (!entry) {
      entry = { got: 0, count, parts: new Array(count), key, capturedAt, ts };
      rx.frames.set(frameNo, entry);
    }
    if (!entry.parts[index]) { entry.parts[index] = new Uint8Array(data, HEADER); entry.got++; }
    if (entry.got < entry.count) {
      // Frames well past this one complete while it waits: its fragments were lost.
      for (const n of rx.frames.keys()) if (n < frameNo - 3) { rx.frames.delete(n); if (counted) w.stats.dropped++; if (!rx.needKey) { rx.needKey = true; this.requestKey(w, level); } }
      return;
    }
    rx.frames.delete(frameNo);
    for (const n of rx.frames.keys()) if (n < frameNo) { rx.frames.delete(n); if (counted) w.stats.dropped++; rx.needKey = true; }
    if (frameNo <= rx.lastFrame) return;
    if (frameNo !== rx.lastFrame + 1 && !entry.key) rx.needKey = true;
    if (rx.needKey && !entry.key) { this.requestKey(w, level); if (counted) w.stats.dropped++; return; }
    rx.needKey = false;
    rx.lastFrame = frameNo;
    // The level being switched to has its key frame: show it from here, and stop asking for the old one.
    if (level === w.target && level !== w.level) {
      w.level = level;
      for (const [l, other] of w.rx) if (l !== level) { other.frames.clear(); other.needKey = true; }
      this.resetDecoder(w);
      this.sendWanted(w);
    }
    if (level !== w.level) return;
    const bytes = joinParts(entry.parts);
    const Chunk = (globalThis as any).EncodedVideoChunk;
    try {
      w.decoder.decode(new Chunk({ type: entry.key ? 'key' : 'delta', timestamp: ts, data: bytes }));
    } catch { rx.needKey = true; this.resetDecoder(w); return; }
    w.stats.frames++;
    w.stats.totalFrames++;
    const offset = this.offsets.get(w.source);
    if (offset != null) { w.stats.delaySum += Date.now() + offset - entry.capturedAt; w.stats.delayCount++; }
  }

  private onAudioFragment(w: Watching, count: number, ts: number, capturedAt: number, part: Uint8Array, size: number, frameNo: number): void {
    w.audioStats.bytes += size;
    const audio = w.audio;
    if (!audio || count !== 1 || !audio.node) return;
    if (frameNo <= audio.lastFrame && audio.lastFrame - frameNo < 1000) return;
    audio.lastFrame = frameNo;
    w.audioStats.frames++;
    const offset = this.offsets.get(w.source);
    if (offset != null) { w.audioStats.delaySum += Date.now() + offset - capturedAt; w.audioStats.delayCount++; }
    const Chunk = (globalThis as any).EncodedAudioChunk;
    try { if (audio.decoder.state === 'configured') audio.decoder.decode(new Chunk({ type: 'key', timestamp: ts, data: part.slice() })); } catch { /* the next one */ }
  }

  private requestKey(w: Watching, level: number, force = false): void {
    if (!w.upstream || w.upstream.readyState !== 'open') return;
    if (!force && now() - w.lastKeyRequest < KEY_REQUEST_MIN_MS) return;
    w.lastKeyRequest = now();
    w.stats.keyRequests++;
    try { w.upstream.send(new Uint8Array([KEY_REQUEST, level])); } catch { /* closing */ }
  }

  private report(w: Watching): void {
    if (!w.parent || w.stopped) return;
    this.host.gossip.sendDirect(w.source, { __ppType: REPORT, id: w.id, parent: w.parent, depth: w.depth, children: w.children.size, links: this.host.mesh.getConnectedPeers() });
  }

  /** Auto quality, once a second: down after losses, up after a clean stretch. */
  private adapt(w: Watching): void {
    if (!w.info.video || w.quality !== 'auto' || !w.parent || w.target !== w.level) return;
    const frames = w.stats.totalFrames - w.lastWindow.frames;
    const dropped = w.stats.dropped - w.lastWindow.dropped;
    w.lastWindow = { frames: w.stats.totalFrames, dropped: w.stats.dropped };
    const expected = w.info.levels.find((l) => l.level === w.level)?.fps ?? w.info.fps;
    const lossy = dropped / Math.max(1, frames + dropped) > 0.08 || (expected > 0 && frames < expected * 0.5);
    if (lossy) { w.badWindows++; w.goodWindows = 0; } else { w.goodWindows++; w.badWindows = 0; }
    const down = this.stepLevel(w.info, w.level, -1);
    const up = this.stepLevel(w.info, w.level, 1);
    if (w.badWindows >= 2 && down != null) {
      w.badWindows = 0; w.lastDownAt = now();
      this.switchTo(w, down);
    } else if (w.goodWindows >= 8 && up != null && now() - w.lastDownAt > 15_000) {
      w.goodWindows = 0;
      this.switchTo(w, up);
    }
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
    const child: Child = { peerId, channel, mask: 0, waiting: new Set() };
    const drop = () => { if (children.get(peerId)?.channel === channel) { children.delete(peerId); if (w) this.sendWanted(w); } };
    channel.onclose = drop;
    channel.onerror = drop;
    channel.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer) || data.byteLength !== 2) return;
      const [type, value] = new Uint8Array(data);
      if (type === KEY_REQUEST) {
        child.waiting.add(value);
        this.upstreamKey(id, value);
      } else if (type === LEVELS_WANTED) {
        const added = value & ~child.mask;
        child.mask = value;
        for (let l = 0; l < 3; l++) if (added & (1 << l)) { child.waiting.add(l); this.upstreamKey(id, l); }
        if (w) this.sendWanted(w);
      }
    };
    const old = children.get(peerId);
    if (old && old.channel !== channel) { old.channel.onclose = null; try { old.channel.close(); } catch { /* closed */ } }
    children.set(peerId, child);
  }

  /** A key frame of a level for a child: the source makes one, a viewer asks its own parent. */
  private upstreamKey(id: string, level: number): void {
    const p = this.published.get(id);
    if (p) {
      p.stats.keyRequests++;
      const l = p.levels.find((x) => x.level === level);
      if (!l) return;
      const wait = KEY_REQUEST_MIN_MS - (now() - l.lastKeyAt);
      // Too soon after the last one: one more, as soon as allowed (not none).
      if (wait <= 0) l.forceKey = true;
      else if (!l.keyTimer) l.keyTimer = setTimeout(() => { l.keyTimer = null; l.forceKey = true; }, wait);
      return;
    }
    const w = this.watching.get(id);
    if (w) this.requestKey(w, level);
  }

  private onPeerGone(peerId: string): void {
    for (const p of this.published.values()) { p.children.delete(peerId); p.members.delete(peerId); }
    for (const w of this.watching.values()) {
      if (w.children.delete(peerId)) this.sendWanted(w);
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
        const levels: MediaLevel[] = Array.isArray(data.levels)
          ? data.levels.slice(0, 3).map((l: any) => ({ level: Math.max(0, Math.min(2, Number(l?.level) || 0)), width: Number(l?.width) || 0, height: Number(l?.height) || 0, fps: Number(l?.fps) || 0, kbps: Number(l?.kbps) || 0 }))
          : [];
        const top = levels[levels.length - 1];
        this.streams.set(data.id, {
          id: data.id, source: from, name: String(data.name ?? 'Camera').slice(0, 80), video: data.video !== false && levels.length > 0, audio: data.audio === true,
          levels, width: top?.width ?? 0, height: top?.height ?? 0, fps: top?.fps ?? 0, live: true, seen: t,
        });
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
    for (const p of this.published.values()) { p.stats.roll(t); p.audioStats.roll(t); }
    for (const w of this.watching.values()) { w.stats.roll(t); w.audioStats.roll(t); this.adapt(w); }
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

function isTrack(value: unknown): value is MediaStreamTrack {
  return typeof MediaStreamTrack !== 'undefined' && value instanceof MediaStreamTrack;
}

function announced(info: MediaStreamInfo): Record<string, unknown> {
  return { id: info.id, name: info.name, video: info.video, audio: info.audio, levels: info.levels };
}

function levelsIn(mask: number): string[] {
  return LEVEL_NAMES.filter((_, i) => mask & (1 << i));
}

function highestLevel(mask: number): number {
  for (let l = 2; l >= 0; l--) if (mask & (1 << l)) return l;
  return -1;
}

function joinParts(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return bytes;
}

function makeFragments(flags: number, level: number, frameNo: number, capturedAt: number, ts: number, bytes: Uint8Array): Uint8Array[] {
  const count = Math.max(1, Math.ceil(bytes.length / FRAGMENT));
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const slice = bytes.subarray(i * FRAGMENT, Math.min(bytes.length, (i + 1) * FRAGMENT));
    const frag = new Uint8Array(HEADER + slice.length);
    const view = new DataView(frag.buffer);
    view.setUint8(0, 0x50); view.setUint8(1, 0x4d); view.setUint8(2, 2); view.setUint8(3, flags);
    view.setUint8(4, level); view.setUint8(5, 0);
    view.setUint32(6, frameNo >>> 0);
    view.setUint16(10, i); view.setUint16(12, count);
    view.setFloat64(14, capturedAt); view.setFloat64(22, ts);
    frag.set(slice, HEADER);
    out.push(frag);
  }
  return out;
}

/**
 * A level's fragments to one child, if it wants that level. A child that is behind (its channel's queue
 * too long) or that asked for a key frame gets nothing of the level until a key frame starts: a delta it
 * could not decode is upload spent for nothing.
 */
function sendVideo(child: Child, fragments: Uint8Array[], level: number, key: boolean, stats: Counter, frameStart: boolean): void {
  if (!(child.mask & (1 << level))) return;
  const ch = child.channel;
  if (ch.readyState !== 'open') return;
  if (frameStart) {
    if (ch.bufferedAmount > CHILD_BACKLOG_BYTES) { child.waiting.add(level); stats.dropped++; return; }
    if (child.waiting.has(level) && !key) return;
    if (key) child.waiting.delete(level);
  } else if (child.waiting.has(level)) return;
  for (const f of fragments) { try { ch.send(f as unknown as ArrayBuffer); } catch { return; } }
}

/** Audio goes to every child (it is small), unless the channel is badly behind. */
function sendAudio(child: Child, fragments: Uint8Array[]): void {
  const ch = child.channel;
  if (ch.readyState !== 'open' || ch.bufferedAmount > CHILD_BACKLOG_BYTES * 2) return;
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
