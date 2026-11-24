/**
 * In-memory Redis (only the commands the routes use) + a recording fake Reddit. Browser-safe: no Node APIs.
 * The standalone web build persists it to localStorage (client/backend.ts); the tests use it as-is.
 */
import type { RedditLike, RedisLike, ZMember } from './ports.ts';

export type Store = { strings: Record<string, string>; zsets: Record<string, Record<string, number>> };

export class MemoryRedis implements RedisLike {
  store: Store;
  /** Called after every write (debounce it yourself if needed). */
  private readonly onWrite: ((s: Store) => void) | null;

  constructor(initial: Store | null = null, onWrite: ((s: Store) => void) | null = null) {
    this.store = initial ?? { strings: {}, zsets: {} };
    this.onWrite = onWrite;
  }

  private touch(): void {
    this.onWrite?.(this.store);
  }

  /** Redis order: score asc, then member asc. */
  private sorted(key: string): ZMember[] {
    return Object.entries(this.store.zsets[key] ?? {})
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
  async mGet(keys: string[]) {
    return keys.map((k) => this.store.strings[k] ?? null);
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
  async zRange(key: string, start: number, stop: number, options: { by: 'rank' | 'score'; reverse?: boolean }) {
    const list = this.sorted(key);
    if (options.by === 'score') {
      const out = list.filter((m) => m.score >= start && m.score <= stop);
      return options.reverse ? out.reverse() : out;
    }
    if (options.reverse) list.reverse();
    const end = stop < 0 ? list.length + stop : stop;
    return list.slice(start, end + 1);
  }
  async zScore(key: string, member: string) {
    return this.store.zsets[key]?.[member];
  }
  async zCard(key: string) {
    return Object.keys(this.store.zsets[key] ?? {}).length;
  }

  deleteWhere(pred: (key: string) => boolean): number {
    let n = 0;
    for (const bucket of [this.store.strings, this.store.zsets]) {
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

/** Fake Reddit that only records what it would have done (`comment` text is handed to `onComment`). */
export function fakeReddit(record: (kind: string, detail: string) => void, onComment?: (text: string) => Promise<void>): RedditLike {
  return {
    async setUserFlair(o) {
      record('flair', `u/${o.username} → "${o.text}"`);
    },
    async submitComment(o) {
      record('comment', `${o.id}: ${o.text}`);
      await onComment?.(o.text);
      return { id: `t1_local${Date.now()}` };
    },
    async submitCustomPost(o) {
      const id = `t3_local${o.postData.date.replaceAll('-', '')}`;
      record('post', `${id}: ${o.title}`);
      return { id };
    },
  };
}
