// Choosing a relay: local relays first, then by measured performance.
//
// 1. Candidates are the room's relays: the CANDIDATES relays closest to the
//    room key, the same key FreeRTC's relays publish the room under
//    (sha256 of ["freertc-kad",1,"scope",network,room]). A room's peers then
//    gather on a few relays, so little signaling crosses between relays.
//    Each relay is VIRTUAL_IDS points in the ID space (sha256 of
//    "<node id>:<i>"), which evens out how much of the space each one owns.
// 2. A local relay that is healthy comes before every cloud relay. A relay is
//    healthy until measurements say otherwise: a failure rate over 5% (with at
//    least two attempts), or a load at 90% of its capacity.
// 3. Within a tier, the lower score wins:
//      score = joinMs + 2000 · failureRate + 1000 · loadRatio (+ 300 when only
//      reached through its tunnel)
//    with ties broken by XOR distance to the peer ID. A relay nobody has
//    measured scores as an average one.
// 4. Hysteresis: the relay this peer used last is kept unless the best is at
//    least SWITCH_MARGIN better, so peers do not flap between similar relays.
// The other relays follow, nearest the peer first, as failover.
//
// Scores come from this peer's own joins and from what its neighbours share
// (RelayScoreBook); this peer's own measurements count three times as much.

export type RelayKind = 'cloud' | 'local';

export interface RelayInfo {
  url: string;
  nodeId: string;
  kind: RelayKind;
  connections?: number;
  capacity?: number;
  /** True when the relay can only be reached through a tunnel home (no punch). */
  tunnelOnly?: boolean;
}

export interface RelayMeasurement {
  /** Exponential moving average of connect-to-registered time, ms. */
  joinMs: number | null;
  attempts: number;
  failures: number;
  /** When this was last measured (ms since epoch). */
  at: number;
}

export const RELAY_CANDIDATES = 5;
export const RELAY_VIRTUAL_IDS = 4;
export const RELAY_SWITCH_MARGIN = 0.3;
const UNMEASURED_JOIN_MS = 600;
const TUNNEL_PENALTY_MS = 300;
const MAX_FAILURE_RATE = 0.05;
const MAX_LOAD_RATIO = 0.9;
const SCORE_MAX_AGE_MS = 24 * 60 * 60_000;
const OWN_WEIGHT = 3;
const JOIN_EMA = 0.3;
const MAX_BOOK_ENTRIES = 256;

const NODE_ID_RE = /^[0-9a-f]{64}$/;

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function compareDistance(a: Uint8Array, b: Uint8Array, target: Uint8Array): number {
  for (let i = 0; i < target.length; i += 1) {
    const da = a[i] ^ target[i];
    const db = b[i] ^ target[i];
    if (da !== db) return da - db;
  }
  return 0;
}

/** The key FreeRTC relays publish a room under. */
export async function roomRoutingKey(network: string, room: string): Promise<Uint8Array> {
  return sha256Bytes(JSON.stringify(['freertc-kad', 1, 'scope', network, room]));
}

async function virtualIds(nodeId: string, count = RELAY_VIRTUAL_IDS): Promise<Uint8Array[]> {
  const ids = [hexBytes(nodeId)];
  for (let i = 1; i < count; i += 1) ids.push(await sha256Bytes(`${nodeId}:${i}`));
  return ids;
}

function nearest(ids: Uint8Array[], target: Uint8Array): Uint8Array {
  return ids.reduce((best, id) => (compareDistance(id, best, target) < 0 ? id : best));
}

/** Failures count half after FAILURE_HALF_LIFE_MS, a quarter after twice that, and so on. */
const FAILURE_HALF_LIFE_MS = 10 * 60_000;
export function failureFade(ageMs: number): number {
  return ageMs <= 0 ? 1 : 0.5 ** (ageMs / FAILURE_HALF_LIFE_MS);
}

export function failureRate(m: RelayMeasurement | null | undefined): number {
  if (!m || m.attempts <= 0) return 0;
  return Math.min(1, m.failures / m.attempts);
}

function loadRatio(relay: RelayInfo): number {
  const capacity = Number(relay.capacity || 0);
  return capacity > 0 ? Math.min(1, Number(relay.connections || 0) / capacity) : 0;
}

export function isHealthy(relay: RelayInfo, m: RelayMeasurement | null | undefined): boolean {
  if (loadRatio(relay) >= MAX_LOAD_RATIO) return false;
  if (m && m.attempts >= 2 && failureRate(m) > MAX_FAILURE_RATE) return false;
  return true;
}

export function relayScore(relay: RelayInfo, m: RelayMeasurement | null | undefined): number {
  const joinMs = m?.joinMs ?? UNMEASURED_JOIN_MS;
  return joinMs
    + 2000 * failureRate(m)
    + 1000 * loadRatio(relay)
    + (relay.tunnelOnly ? TUNNEL_PENALTY_MS : 0);
}

export interface ChooseRelaysOptions {
  peerId: string;
  network: string;
  room: string;
  relays: readonly RelayInfo[];
  measurements?: (nodeId: string) => RelayMeasurement | null | undefined;
  /** The relay URL this peer used last, if any. */
  previousUrl?: string | null;
  candidates?: number;
  virtualIds?: number;
}

/** Relay URLs in the order to try them. */
export async function chooseRelays(options: ChooseRelaysOptions): Promise<string[]> {
  const relays = dedupeRelays(options.relays);
  if (relays.length === 0) return [];
  const measure = options.measurements ?? (() => null);
  const roomKey = await roomRoutingKey(options.network, options.room);
  const peerKey = NODE_ID_RE.test(options.peerId) ? hexBytes(options.peerId) : await sha256Bytes(options.peerId);
  const placed = await Promise.all(relays.map(async (relay) => {
    const ids = await virtualIds(relay.nodeId, Math.max(1, options.virtualIds ?? RELAY_VIRTUAL_IDS));
    return { relay, toRoom: nearest(ids, roomKey), toPeer: nearest(ids, peerKey) };
  }));

  const byRoom = [...placed].sort((a, b) => compareDistance(a.toRoom, b.toRoom, roomKey) || a.relay.url.localeCompare(b.relay.url));
  const candidates = byRoom.slice(0, Math.max(1, options.candidates ?? RELAY_CANDIDATES));
  const rest = byRoom.slice(candidates.length).sort((a, b) => compareDistance(a.toPeer, b.toPeer, peerKey) || a.relay.url.localeCompare(b.relay.url));

  const ranked = candidates.map((entry) => {
    const m = measure(entry.relay.nodeId);
    const healthy = isHealthy(entry.relay, m);
    const tier = healthy && entry.relay.kind === 'local' ? 0 : healthy ? 1 : 2;
    return { ...entry, tier, score: relayScore(entry.relay, m) };
  }).sort((a, b) => a.tier - b.tier || a.score - b.score || compareDistance(a.toPeer, b.toPeer, peerKey));

  // Hysteresis: stay on the previous relay unless the best beats it clearly.
  if (options.previousUrl) {
    const previous = ranked.findIndex((entry) => entry.relay.url === options.previousUrl);
    if (previous > 0) {
      const best = ranked[0];
      const kept = ranked[previous];
      const clearlyBetter = best.tier < kept.tier || best.score < kept.score * (1 - RELAY_SWITCH_MARGIN);
      if (!clearlyBetter) {
        ranked.splice(previous, 1);
        ranked.unshift(kept);
      }
    }
  }
  return [...ranked, ...rest].map((entry) => entry.relay.url);
}

function dedupeRelays(relays: readonly RelayInfo[]): RelayInfo[] {
  const byUrl = new Map<string, RelayInfo>();
  for (const relay of relays) {
    if (!relay?.url || !NODE_ID_RE.test(String(relay.nodeId || ''))) continue;
    if (!byUrl.has(relay.url)) byUrl.set(relay.url, relay);
  }
  return Array.from(byUrl.values());
}

// ─── Scores ───────────────────────────────────────────────────────────────

export interface SharedRelayScore {
  nodeId: string;
  joinMs: number | null;
  attempts: number;
  failures: number;
  at: number;
}

interface BookEntry {
  own: RelayMeasurement | null;
  shared: Map<string, RelayMeasurement>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RELAY_SCORE_STORAGE_KEY = 'peerpigeon:relay-scores:v1';
const MAX_SHARED_SOURCES = 16;
const PERSISTED_SHARED_SOURCES = 4;

function freshMeasurement(m: unknown, now: number): RelayMeasurement | null {
  const value = m as Partial<RelayMeasurement> | null;
  if (!value || typeof value !== 'object') return null;
  const at = Number(value.at);
  if (!Number.isFinite(at) || now - at > SCORE_MAX_AGE_MS || at > now + 60_000) return null;
  const attempts = Math.max(0, Math.min(1_000_000, Number(value.attempts) || 0));
  const failures = Math.max(0, Math.min(attempts, Number(value.failures) || 0));
  const joinMs = value.joinMs === null || value.joinMs === undefined ? null : Number(value.joinMs);
  return {
    joinMs: joinMs !== null && Number.isFinite(joinMs) && joinMs >= 0 ? Math.min(60_000, joinMs) : null,
    attempts,
    failures,
    at,
  };
}

/**
 * Relay measurements: this peer's own joins, and what other peers share.
 * Kept in localStorage when there is one, so a returning peer goes straight
 * to the relay that worked last time.
 */
export class RelayScoreBook {
  private entries = new Map<string, BookEntry>();
  private storage: StorageLike | null;
  private now: () => number;

  constructor(options: { storage?: StorageLike | null; now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.storage = options.storage === undefined ? RelayScoreBook.defaultStorage() : options.storage;
    this.load();
  }

  static defaultStorage(): StorageLike | null {
    try {
      const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
      return storage && typeof storage.getItem === 'function' ? storage : null;
    } catch {
      return null;
    }
  }

  private entry(nodeId: string): BookEntry {
    let entry = this.entries.get(nodeId);
    if (!entry) {
      entry = { own: null, shared: new Map() };
      this.entries.set(nodeId, entry);
      if (this.entries.size > MAX_BOOK_ENTRIES) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined && oldest !== nodeId) this.entries.delete(oldest);
      }
    }
    return entry;
  }

  /** Record one of this peer's own joins through a relay. */
  recordJoin(nodeId: string, result: { ok: boolean; joinMs?: number | null }): void {
    if (!NODE_ID_RE.test(nodeId)) return;
    const entry = this.entry(nodeId);
    const own = entry.own ?? { joinMs: null, attempts: 0, failures: 0, at: 0 };
    if (own.at > 0) {
      const fade = failureFade(this.now() - own.at);
      own.attempts *= fade;
      own.failures *= fade;
    }
    own.attempts += 1;
    if (!result.ok) own.failures += 1;
    const joinMs = Number(result.joinMs);
    if (result.ok && Number.isFinite(joinMs) && joinMs >= 0) {
      own.joinMs = own.joinMs === null ? joinMs : own.joinMs * (1 - JOIN_EMA) + joinMs * JOIN_EMA;
    }
    own.at = this.now();
    entry.own = own;
    this.save();
  }

  /** Merge scores another peer shared. Only its own measurements, one set per source. */
  mergeShared(sourcePeerId: string, scores: readonly SharedRelayScore[]): void {
    if (!sourcePeerId || !Array.isArray(scores)) return;
    const now = this.now();
    for (const score of scores.slice(0, 32)) {
      if (!NODE_ID_RE.test(String(score?.nodeId || ''))) continue;
      const m = freshMeasurement(score, now);
      if (!m) continue;
      const entry = this.entry(score.nodeId);
      entry.shared.set(sourcePeerId, m);
      while (entry.shared.size > MAX_SHARED_SOURCES) {
        const oldest = entry.shared.keys().next().value;
        if (oldest === undefined) break;
        entry.shared.delete(oldest);
      }
    }
    this.save();
  }

  /** The combined measurement for a relay, own counted OWN_WEIGHT times. */
  measurement(nodeId: string): RelayMeasurement | null {
    const entry = this.entries.get(nodeId);
    if (!entry) return null;
    const now = this.now();
    const parts: Array<{ m: RelayMeasurement; weight: number }> = [];
    const own = entry.own && freshMeasurement(entry.own, now);
    if (own) parts.push({ m: own, weight: OWN_WEIGHT });
    for (const shared of entry.shared.values()) {
      const m = freshMeasurement(shared, now);
      if (m) parts.push({ m, weight: 1 });
    }
    if (parts.length === 0) return null;
    let attempts = 0;
    let failures = 0;
    let joinSum = 0;
    let joinWeight = 0;
    let at = 0;
    for (const { m, weight } of parts) {
      // Old failures fade: a relay that was down earlier (restarted, asleep)
      // is judged by how it does now, not held below every other relay.
      const fade = failureFade(now - m.at);
      attempts += m.attempts * weight;
      failures += m.failures * weight * fade;
      if (m.joinMs !== null) { joinSum += m.joinMs * weight; joinWeight += weight; }
      at = Math.max(at, m.at);
    }
    return { joinMs: joinWeight ? joinSum / joinWeight : null, attempts, failures, at };
  }

  /** This peer's own measurements, to share with others. */
  ownScores(limit = 8): SharedRelayScore[] {
    const now = this.now();
    const out: SharedRelayScore[] = [];
    for (const [nodeId, entry] of this.entries) {
      const own = entry.own && freshMeasurement(entry.own, now);
      if (own) out.push({ nodeId, ...own });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = JSON.parse(this.storage.getItem(RELAY_SCORE_STORAGE_KEY) || '{}');
      const now = this.now();
      for (const [nodeId, own] of Object.entries(raw?.own ?? {})) {
        if (!NODE_ID_RE.test(nodeId)) continue;
        const m = freshMeasurement(own, now);
        if (m) this.entry(nodeId).own = m;
      }
      for (const [nodeId, sources] of Object.entries(raw?.shared ?? {})) {
        if (!NODE_ID_RE.test(nodeId) || !sources || typeof sources !== 'object') continue;
        for (const [source, shared] of Object.entries(sources as Record<string, unknown>).slice(0, PERSISTED_SHARED_SOURCES)) {
          const m = freshMeasurement(shared, now);
          if (m) this.entry(nodeId).shared.set(source, m);
        }
      }
    } catch {
      // A corrupt or blocked store is the same as an empty one.
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      const own: Record<string, RelayMeasurement> = {};
      const shared: Record<string, Record<string, RelayMeasurement>> = {};
      for (const [nodeId, entry] of this.entries) {
        if (entry.own) own[nodeId] = entry.own;
        const recent = Array.from(entry.shared.entries()).slice(-PERSISTED_SHARED_SOURCES);
        if (recent.length) shared[nodeId] = Object.fromEntries(recent);
      }
      this.storage.setItem(RELAY_SCORE_STORAGE_KEY, JSON.stringify({ own, shared }));
    } catch {
      // Storage full or blocked: scores still work for this session.
    }
  }
}
