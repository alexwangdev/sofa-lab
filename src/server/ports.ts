/**
 * The slice of Devvit's redis / reddit / context that the routes use. Production passes the real
 * `@devvit/web/server` objects (src/server/index.ts); local mode passes in-memory fakes (src/server/local.ts).
 */
import type { Context as HonoContext } from 'hono';

export type ZMember = { member: string; score: number };

export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<string>;
  exists(...keys: string[]): Promise<number>;
  incrBy(key: string, value: number): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  zAdd(key: string, ...members: ZMember[]): Promise<number>;
  zRange(key: string, start: number, stop: number, options: { by: 'rank'; reverse: boolean }): Promise<ZMember[]>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zCard(key: string): Promise<number>;
  mGet(keys: string[]): Promise<(string | null)[]>;
};

export type RedditLike = {
  setUserFlair(options: { subredditName: string; username: string; text: string }): Promise<void>;
  submitComment(options: { id: `t3_${string}`; text: string; runAs: 'USER' }): Promise<unknown>;
  submitCustomPost(options: { title: string; postData: { date: string } }): Promise<{ id: string }>;
  subscribeToCurrentSubreddit(): Promise<void>;
};

/** Per-request identity and environment. */
export type RequestCtx = {
  userId: string | undefined;
  username: () => Promise<string | undefined>;
  postId: `t3_${string}` | undefined;
  subredditName: string | undefined;
  /** Today's UTC date (local mode may override). */
  date: string;
  /** Local mode only: force the hallway width. */
  wOverride: number | undefined;
};

export type Env = {
  redis: RedisLike;
  reddit: RedditLike;
  ctx: (c: HonoContext) => RequestCtx;
};
