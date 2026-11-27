/** Production entry: the routes from app.ts bound to Devvit's real redis / reddit / context. */
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { utcDate } from '../shared/rng.ts';
import { createApp } from './app.ts';
import type { RedisLike } from './ports.ts';

const app = createApp({
  redis: redis as unknown as RedisLike,
  reddit,
  ctx: () => ({
    userId: context.userId,
    username: () => reddit.getCurrentUsername(),
    postId: context.postId,
    subredditName: context.subredditName,
    date: utcDate(),
  }),
});

serve({ fetch: app.fetch, createServer, port: getServerPort() });
