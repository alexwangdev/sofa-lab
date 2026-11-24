/**
 * Standalone web build: the real server routes (src/server/app.ts) run inside the page. Requests go to
 * `app.request()` instead of the network; Redis is in memory and saved to localStorage; Reddit is a fake that logs
 * and copies "Share my run" text to the clipboard. Moving to Devvit later = make api.ts use fetch() again
 * (see devvit/README.md); the routes, keys and responses stay the same.
 */
import { createApp, kLb, kPost } from '../server/app.ts';
import { kPuzzle } from '../server/daily.ts';
import { MemoryRedis, fakeReddit } from '../server/memory.ts';
import type { Store } from '../server/memory.ts';
import type { RequestCtx } from '../server/ports.ts';
import { isDateString, utcDate } from '../shared/rng.ts';

const STORE_KEY = 'grid-expedition:redis';
const USER_KEY = 'grid-expedition:local';

type LocalSettings = { user: string; date: string };
export const LOCAL_USERS = ['you', 'alice', 'bob', 'carol'] as const;
type LocalEvent = { at: string; kind: string; detail: string };

export function readLocal(): LocalSettings {
  try {
    const p = JSON.parse(localStorage.getItem(USER_KEY) ?? '{}') as Partial<LocalSettings>;
    return { user: p.user ?? 'you', date: p.date ?? '' };
  } catch {
    return { user: 'you', date: '' };
  }
}
export function writeLocal(s: LocalSettings): void {
  localStorage.setItem(USER_KEY, JSON.stringify(s));
}

function loadStore(): Store | null {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Store> | null;
    return p ? { strings: p.strings ?? {}, zsets: p.zsets ?? {} } : null;
  } catch {
    return null;
  }
}
let saveTimer: number | null = null;
const redis = new MemoryRedis(loadStore(), (s) => {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {
      /* storage full / private mode: keep playing in memory */
    }
  }, 50);
});

export const events: LocalEvent[] = [];
function record(kind: string, detail: string): void {
  events.unshift({ at: new Date().toISOString().slice(11, 19), kind, detail });
  events.length = Math.min(events.length, 50);
  console.info(`[local reddit] ${kind}: ${detail}`);
}

function ctx(): RequestCtx {
  const s = readLocal();
  const name = /^[a-z0-9_]{1,20}$/i.test(s.user) ? s.user : 'you';
  const date = isDateString(s.date) ? s.date : utcDate();
  return {
    userId: `t2_${name}`,
    username: async () => name,
    postId: `t3_local${date.replaceAll('-', '')}`,
    subredditName: 'gridexpedition_local',
    date,
  };
}

const app = createApp({
  redis,
  reddit: fakeReddit(record, async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked: the text is still in the event log */
    }
  }),
  ctx,
});

/** Same signature as fetch(); used by api.ts. */
export function localFetch(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init));
}

/** Test helpers for the dev toolbar. */
export function resetDay(): number {
  const { date } = ctx();
  const n = redis.deleteWhere((k) => k === kLb(date) || k === kPost(date) || k === kPuzzle(date) || (k.startsWith('user:') && k.endsWith(`:${date}`)));
  record('reset', `${date} (${n} keys)`);
  return n;
}
export function resetAll(): void {
  redis.deleteWhere(() => true);
  events.length = 0;
}
export async function runScheduler(): Promise<string> {
  await app.request('/internal/scheduler/daily-post', { method: 'POST' });
  return events[0]?.detail ?? '';
}
