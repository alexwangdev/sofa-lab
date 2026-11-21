/**
 * Local mode (no Reddit): the real routes from app.ts with an in-memory Redis (persisted to .local-data/redis.json)
 * and a fake Reddit that records what it would have done. Identity/date/width come from request headers set by the
 * dev toolbar. Never bundled into the Devvit build (index.ts doesn't import this file).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { CELL, biggestPiece, cellCol, cellIdOf, hammersleyCells, parFor } from '../shared/sofa';
import { dailyChallenge } from '../shared/daily';
import type { Course } from '../shared/types';
import { isDateString, utcDate } from '../shared/daily';
import { createApp, kLb, kLock, kPost } from './app';
import type { RedditLike, RedisLike, RequestCtx, ZMember } from './ports';

const DATA_FILE = resolve(process.cwd(), '.local-data/redis.json');

type Store = { strings: Record<string, string>; hashes: Record<string, Record<string, string>>; zsets: Record<string, Record<string, number>> };

export type LocalEvent = { at: string; kind: string; detail: string };

function load(): Store {
  try {
    const parsed: Partial<Store> = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return { strings: parsed.strings ?? {}, hashes: parsed.hashes ?? {}, zsets: parsed.zsets ?? {} };
  } catch {
    /* first run */
  }
  return { strings: {}, hashes: {}, zsets: {} };
}

class MemoryRedis implements RedisLike {
  store: Store = load();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private touch(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(this.store, null, 1));
    }, 50);
  }
  private sorted(key: string): ZMember[] {
    const z = this.store.zsets[key] ?? {};
    // Redis order: score asc, then member lexicographic asc
    return Object.entries(z)
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
  }

  async get(key: string) {
    return this.store.strings[key];
  }
  async set(key: string, value: string) {
    this.store.strings[key] = value;
    this.touch();
    return 'OK';
  }
  async exists(...keys: string[]) {
    return keys.filter((k) => k in this.store.strings || k in this.store.hashes || k in this.store.zsets).length;
  }
  async incrBy(key: string, value: number) {
    const n = (Number.parseInt(this.store.strings[key] ?? '0', 10) || 0) + value;
    this.store.strings[key] = String(n);
    this.touch();
    return n;
  }
  async hSetNX(key: string, field: string, value: string) {
    const h = (this.store.hashes[key] ??= {});
    if (field in h) return 0;
    h[field] = value;
    this.touch();
    return 1;
  }
  async zAdd(key: string, ...members: ZMember[]) {
    const z = (this.store.zsets[key] ??= {});
    let added = 0;
    for (const m of members) {
      if (!(m.member in z)) added++;
      z[m.member] = m.score;
    }
    this.touch();
    return added;
  }
  async zRange(key: string, start: number, stop: number, options: { by: 'rank'; reverse: boolean }) {
    const list = this.sorted(key);
    if (options.reverse) list.reverse();
    const end = stop < 0 ? list.length + stop : stop;
    return list.slice(start, end + 1);
  }
  async zRank(key: string, member: string) {
    const i = this.sorted(key).findIndex((m) => m.member === member);
    return i < 0 ? undefined : i;
  }
  async zScore(key: string, member: string) {
    return this.store.zsets[key]?.[member];
  }
  async zCard(key: string) {
    return Object.keys(this.store.zsets[key] ?? {}).length;
  }
  async mGet(keys: string[]) {
    return keys.map((k) => this.store.strings[k] ?? null);
  }

  deleteWhere(pred: (key: string) => boolean): number {
    let n = 0;
    for (const bucket of [this.store.strings, this.store.hashes, this.store.zsets]) {
      for (const k of Object.keys(bucket)) {
        if (pred(k)) {
          delete bucket[k];
          n++;
        }
      }
    }
    this.touch();
    return n;
  }
}

export const events: LocalEvent[] = [];
function record(kind: string, detail: string): void {
  events.unshift({ at: new Date().toISOString().slice(11, 19), kind, detail });
  events.length = Math.min(events.length, 50);
  console.log(`[local reddit] ${kind}: ${detail}`);
}

const fakeReddit: RedditLike = {
  async setUserFlair(o) {
    record('flair', `u/${o.username} → "${o.text}"`);
  },
  async submitComment(o) {
    record('comment', `${o.id}: ${o.text}`);
    return { id: `t1_local${Date.now()}` };
  },
  async submitCustomPost(o) {
    const id = `t3_local${o.postData.date.replaceAll('-', '')}`;
    record('post', `${id}: ${o.title}`);
    return { id };
  },
  async subscribeToCurrentSubreddit() {
    record('subscribe', 'r/sofa_lab_local');
  },
};

const redis = new MemoryRedis();

function header(c: HonoContext, name: string): string | undefined {
  const v = c.req.header(name);
  return v === undefined || v === '' ? undefined : v;
}

function localCtx(c: HonoContext): RequestCtx {
  const user = header(c, 'x-local-user');
  const date = header(c, 'x-local-date');
  const w = Number(header(c, 'x-local-w'));
  const name = user && /^[a-z0-9_]{1,20}$/i.test(user) ? user : undefined;
  const day = date && isDateString(date) ? date : utcDate();
  return {
    userId: name ? `t2_${name}` : undefined,
    username: async () => name,
    postId: `t3_local${day.replaceAll('-', '')}`,
    subredditName: 'sofa_lab_local',
    date: day,
    wOverride: Number.isFinite(w) && w > 0 ? w : undefined,
  };
}

/**
 * Bot sofas for "Seed bot players": real shapes for *this* day's course, submitted through the real route.
 * par_hunter plays the optimal shape (gold); the others trim it or play simpler shapes.
 */
function botShapes(course: Course): Array<{ name: string; cells: number[] }> {
  const torn = new Set(course.torn);
  const clean = (cells: number[]) => biggestPiece(cells.filter((c) => !torn.has(c)));
  const par = parFor(course).cells;
  const cols = par.map((id) => cellCol(id));
  const lo = Math.min(...cols);
  const hi = Math.max(...cols);
  const trim = (k: number) => clean(par.filter((id) => cellCol(id) >= lo + k && cellCol(id) <= hi - k));
  const square: number[] = [];
  const n = Math.max(1, Math.floor((course.w - 0.02) / CELL) + 1);
  for (let r = 0; r < 10; r++) for (let c = 0; c < n; c++) square.push(cellIdOf(4 + c, r));
  return [
    { name: 'par_hunter', cells: par },
    { name: 'close_call', cells: trim(1) },
    { name: 'safe_bet', cells: trim(3) },
    { name: 'boxy_bob', cells: clean(square) },
    { name: 'hammersley_fan', cells: clean(hammersleyCells(2 / Math.PI)) },
  ];
}

export function createLocalApp(): Hono {
  const app = createApp({ redis, reddit: fakeReddit, ctx: localCtx });

  const dev = new Hono();
  dev.get('/state', (c) => c.json({ events, dataFile: DATA_FILE }));

  /** Forget everything for one day (all users), so you can submit again. */
  dev.post('/reset-day', (c) => {
    const { date } = localCtx(c);
    const n = redis.deleteWhere(
      (k) => k === kLb(date) || k === kLock(date) || k === kPost(date) || k === `puzzle:${date}` || (k.startsWith('user:') && k.endsWith(`:${date}`)),
    );
    record('reset', `${date} (${n} keys)`);
    return c.json({ ok: true, deleted: n });
  });

  dev.post('/reset-all', (c) => {
    const n = redis.deleteWhere(() => true);
    events.length = 0;
    return c.json({ ok: true, deleted: n });
  });

  /** Submit five bot sofas through the real /api/submit route. */
  dev.post('/seed', async (c) => {
    const { date, wOverride } = localCtx(c);
    const w = header(c, 'x-local-w') ?? '';
    const course = dailyChallenge(date, wOverride).course;
    const results: string[] = [];
    for (const bot of botShapes(course)) {
      const res = await app.request('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-local-user': bot.name, 'x-local-date': date, 'x-local-w': w },
        body: JSON.stringify({ cells: bot.cells }),
      });
      const body: unknown = await res.json();
      results.push(`${bot.name}: ${res.status} ${JSON.stringify(body)}`);
    }
    record('seed', `${date}: ${results.length} bots`);
    return c.json({ results });
  });

  /** Fire the 00:00 UTC scheduler job by hand. */
  dev.post('/run-scheduler', async (c) => {
    const res = await app.request('/internal/scheduler/daily-post', {
      method: 'POST',
      headers: { 'x-local-date': localCtx(c).date, 'x-local-w': header(c, 'x-local-w') ?? '' },
    });
    return c.json({ status: res.status, body: await res.json() });
  });

  app.route('/api/__local', dev);
  return app;
}

let cached: Hono | null = null;
/** Memoised per module instance (Vite reloads the module when server files change). */
export function getLocalApp(): Hono {
  cached ??= createLocalApp();
  return cached;
}
