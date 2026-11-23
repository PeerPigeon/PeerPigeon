/**
 * A storage server's history of its rooms: how many peers were in each room it keeps, over time. A room's
 * peers link to its closest storage servers and ask to hear of its changes (they 'watch' it), so a server
 * knows who is in each of its rooms. Once a minute it writes down how many: people, and peers with a role
 * (bots and the like). Each hour and each day it also counts how many different people it saw: by a visitor id each peer
 * gives (a hash of its key and the room), so someone who comes back with a new peer id counts once.
 *
 * Kept per room (the room's hashed id; a server never knows which app a room is): a sample a minute for the
 * last 26 hours, an hour's summary for 400 days, a day's for 400 days. Counts only: no peer ids are kept,
 * apart from the current hour's and day's, in memory, to count the different ones.
 */
export interface MinuteSample { at: number; people: number; roles: number }
export interface HourSummary { at: number; avg: number; peak: number; roles: number; visitors: number }
export interface DaySummary { at: number; avg: number; peak: number; roles: number; visitors: number }
export interface RoomHistory { minutes: MinuteSample[]; hours: HourSummary[]; days: DaySummary[] }

/** Where a server keeps its rooms' history (PigeonFS: a file per room). */
export interface RoomStatsStore {
  load(room: string): Promise<RoomHistory | null>;
  save(room: string, history: RoomHistory): Promise<void>;
}

export class MemoryRoomStatsStore implements RoomStatsStore {
  private readonly rooms = new Map<string, RoomHistory>();
  async load(room: string): Promise<RoomHistory | null> { return this.rooms.get(room) ?? null; }
  async save(room: string, history: RoomHistory): Promise<void> { this.rooms.set(room, JSON.parse(JSON.stringify(history))); }
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
const KEEP_MINUTES_MS = 26 * HOUR_MS;
const KEEP_SUMMARIES_MS = 400 * DAY_MS;
/** Saved at most this often (and when an hour ends). */
const SAVE_EVERY_MS = 5 * MINUTE_MS;

interface Live { history: RoomHistory; hourAt: number; hourSeen: Set<string>; dayAt: number; daySeen: Set<string>; savedAt: number }

export type RoomStatsPoint = { at: number; people: number; peak: number; roles: number; visitors?: number };

export class RoomStats {
  private readonly live = new Map<string, Promise<Live>>();

  constructor(private readonly store: RoomStatsStore = new MemoryRoomStatsStore()) {}

  private open(room: string): Promise<Live> {
    let l = this.live.get(room);
    if (!l) {
      l = this.store.load(room).catch(() => null).then((h) => ({
        history: h ?? { minutes: [], hours: [], days: [] },
        hourAt: 0, hourSeen: new Set<string>(), dayAt: 0, daySeen: new Set<string>(), savedAt: Date.now(),
      }));
      this.live.set(room, l);
    }
    return l;
  }

  /**
   * One minute's look at a room: who is in it (people: a visitor id each, the same person once however
   * many tabs), and how many peers with a role (bots and the like).
   */
  async sample(room: string, people: string[], roles: number, now = Date.now()): Promise<void> {
    const l = await this.open(room);
    const h = l.history;
    const at = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const unique = [...new Set(people)];
    const sample = { at, people: unique.length, roles };
    if (h.minutes.length && h.minutes[h.minutes.length - 1].at === at) h.minutes[h.minutes.length - 1] = sample;
    else h.minutes.push(sample);
    while (h.minutes.length && h.minutes[0].at < now - KEEP_MINUTES_MS) h.minutes.shift();

    // Different peers this hour and this day (ids in memory only; counts are what is kept).
    const hourAt = Math.floor(now / HOUR_MS) * HOUR_MS;
    const dayAt = Math.floor(now / DAY_MS) * DAY_MS;
    let rolled = false;
    if (l.hourAt !== hourAt) { l.hourAt = hourAt; l.hourSeen = new Set(); rolled = true }
    if (l.dayAt !== dayAt) { l.dayAt = dayAt; l.daySeen = new Set() }
    for (const p of unique) { l.hourSeen.add(p); l.daySeen.add(p); }

    this.summarize(h.hours, hourAt, h.minutes.filter((m) => m.at >= hourAt && m.at < hourAt + HOUR_MS), l.hourSeen.size);
    this.summarize(h.days, dayAt, h.minutes.filter((m) => m.at >= dayAt && m.at < dayAt + DAY_MS), l.daySeen.size, h.hours.filter((x) => x.at >= dayAt && x.at < dayAt + DAY_MS));
    for (const list of [h.hours, h.days]) while (list.length && list[0].at < now - KEEP_SUMMARIES_MS) list.shift();

    if (rolled || now - l.savedAt >= SAVE_EVERY_MS) { l.savedAt = now; await this.store.save(room, h).catch(() => {}); }
  }

  /** The summary for the period starting at `at`, from its minutes (or, for a day, also its earlier hours). */
  private summarize(list: HourSummary[], at: number, minutes: MinuteSample[], visitors: number, hours: HourSummary[] = []): void {
    if (!minutes.length && !hours.length) return;
    // A day longer ago than the kept minutes: its hours carry what the minutes no longer can.
    const peaks = [...minutes.map((m) => m.people), ...hours.map((x) => x.peak)];
    const people = minutes.length ? minutes.reduce((s, m) => s + m.people, 0) / minutes.length : hours.reduce((s, x) => s + x.avg, 0) / hours.length;
    const roles = minutes.length ? minutes.reduce((s, m) => s + m.roles, 0) / minutes.length : hours.reduce((s, x) => s + x.roles, 0) / hours.length;
    const entry = { at, avg: Math.round(people * 10) / 10, peak: Math.max(...peaks), roles: Math.round(roles * 10) / 10, visitors };
    if (list.length && list[list.length - 1].at === at) list[list.length - 1] = entry;
    else list.push(entry);
  }

  /**
   * A room's history from `from` to `to` (ms), in steps that keep it to a few hundred points: a minute for
   * up to 2 hours, 5 minutes for up to 26 hours, an hour for up to 35 days, else a day. A step's `people`
   * is its average, `peak` its most; `visitors` (hours and days) the different peers seen in it.
   */
  async read(room: string, from: number, to: number): Promise<{ step: number; points: RoomStatsPoint[] }> {
    const h = (await this.open(room)).history;
    const span = to - from;
    if (span <= 26 * HOUR_MS) {
      const step = span <= 2 * HOUR_MS ? MINUTE_MS : 5 * MINUTE_MS;
      const buckets = new Map<number, MinuteSample[]>();
      for (const m of h.minutes) {
        if (m.at < from || m.at > to) continue;
        const at = Math.floor(m.at / step) * step;
        let b = buckets.get(at);
        if (!b) buckets.set(at, (b = []));
        b.push(m);
      }
      const round = (n: number) => Math.round(n * 10) / 10;
      return {
        step,
        points: [...buckets].map(([at, ms]) => ({
          at, people: round(ms.reduce((s, m) => s + m.people, 0) / ms.length), peak: Math.max(...ms.map((m) => m.people)), roles: round(ms.reduce((s, m) => s + m.roles, 0) / ms.length),
        })),
      };
    }
    const step = span <= 35 * DAY_MS ? HOUR_MS : DAY_MS;
    const list = step === HOUR_MS ? h.hours : h.days;
    return { step, points: list.filter((x) => x.at >= from - step && x.at <= to).map((x) => ({ at: x.at, people: x.avg, peak: x.peak, roles: x.roles, visitors: x.visitors })) };
  }

  /**
   * The room's newest point in each step a reader can be showing (a minute, 5 minutes, an hour, a day),
   * as read() gives them: sent to a page that follows the room, after each sample, so it needs no asking.
   */
  async current(room: string, now = Date.now()): Promise<Record<'minute' | 'five' | 'hour' | 'day', RoomStatsPoint | null>> {
    const h = (await this.open(room)).history;
    const last = h.minutes[h.minutes.length - 1] ?? null;
    const fiveAt = Math.floor(now / (5 * MINUTE_MS)) * 5 * MINUTE_MS;
    const five = h.minutes.filter((m) => m.at >= fiveAt);
    const round = (n: number) => Math.round(n * 10) / 10;
    const hour = h.hours[h.hours.length - 1] ?? null;
    const day = h.days[h.days.length - 1] ?? null;
    return {
      minute: last ? { at: last.at, people: last.people, peak: last.people, roles: last.roles } : null,
      five: five.length ? { at: fiveAt, people: round(five.reduce((t, m) => t + m.people, 0) / five.length), peak: Math.max(...five.map((m) => m.people)), roles: round(five.reduce((t, m) => t + m.roles, 0) / five.length) } : null,
      hour: hour ? { at: hour.at, people: hour.avg, peak: hour.peak, roles: hour.roles, visitors: hour.visitors } : null,
      day: day ? { at: day.at, people: day.avg, peak: day.peak, roles: day.roles, visitors: day.visitors } : null,
    };
  }

  /** The rooms with a history so far, in memory. */
  rooms(): string[] { return [...this.live.keys()]; }
}

/** Points, compact for sending: [at, people, peak, roles, visitors?]. */
export type PackedPoint = [number, number, number, number] | [number, number, number, number, number];
export const packPoints = (points: RoomStatsPoint[]): PackedPoint[] => points.map((p) => (p.visitors === undefined ? [p.at, p.people, p.peak, p.roles] : [p.at, p.people, p.peak, p.roles, p.visitors]));
export const unpackPoints = (packed: unknown): RoomStatsPoint[] => (Array.isArray(packed) ? packed : [])
  .filter((p): p is number[] => Array.isArray(p) && p.length >= 4 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
  .map((p) => ({ at: p[0], people: p[1], peak: p[2], roles: p[3], ...(p.length > 4 ? { visitors: p[4] } : {}) }));
