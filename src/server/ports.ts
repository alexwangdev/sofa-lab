/**
 * The slice of Devvit's redis / reddit / context the routes use. Production passes the real `@devvit/web/server`
 * objects (index.ts); local mode and tests pass in-memory fakes (memory.ts).
 */
import type { Context as HonoContext } from 'hono';

export type ZMember = { member: string; score: number };

export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<string>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  zAdd(key: string, ...members: ZMember[]): Promise<number>;
  zRange(key: string, start: number, stop: number, options: { by: 'rank' | 'score'; reverse?: boolean }): Promise<ZMember[]>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zCard(key: string): Promise<number>;
};

export type RedditLike = {
  setUserFlair(options: { subredditName: string; username: string; text: string }): Promise<void>;
  submitComment(options: { id: `t3_${string}`; text: string; runAs: 'USER' }): Promise<unknown>;
  submitCustomPost(options: { title: string; postData: { date: string } }): Promise<{ id: string }>;
};

export type RequestCtx = {
  userId: string | undefined;
  username: () => Promise<string | undefined>;
  postId: `t3_${string}` | undefined;
  subredditName: string | undefined;
  /** Today's UTC date (local mode may override). */
  date: string;
};

export type Env = {
  redis: RedisLike;
  reddit: RedditLike;
  ctx: (c: HonoContext) => RequestCtx;
};
