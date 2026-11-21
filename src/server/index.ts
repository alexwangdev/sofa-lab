/** Production entry: the routes from app.ts, bound to Devvit's real redis / reddit / context. */
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { utcDate } from '../shared/daily';
import { createApp } from './app';

const app = createApp({
  redis,
  reddit,
  ctx: () => ({
    userId: context.userId,
    username: () => reddit.getCurrentUsername(),
    postId: context.postId,
    subredditName: context.subredditName,
    date: utcDate(),
    wOverride: undefined,
  }),
});

serve({ fetch: app.fetch, createServer, port: getServerPort() });
