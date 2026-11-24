/**
 * HTTP routes (spec §12–§13), independent of where they run. Production: index.ts binds Devvit's redis/reddit/context.
 * Local mode and tests: memory.ts fakes. The server is the source of truth for the track and the best score.
 */
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { BIOMES } from '../shared/biomes.ts';
import { isDateString, prevDate } from '../shared/rng.ts';
import { MAX_LOG, replay, score as scoreOf } from '../shared/sim.ts';
import type { ErrorResponse, LeaderboardEntry, LeaderboardResponse, RunResponse, TodayResponse } from '../shared/types.ts';
import { courseFor, getPuzzle } from './daily.ts';
import type { Puzzle } from './daily.ts';
import type { Env, RedisLike } from './ports.ts';

// ---------- Redis keys (spec §12) ----------
export const kLb = (date: string) => `lb:${date}`;
const kUser = (userId: string, date: string) => `user:${userId}:${date}`;
const kStreak = (userId: string) => `streak:${userId}`;
export const kPost = (date: string) => `post:${date}`;

type UserDay = { best: number; runs: number; finished: boolean; submittedAt: number; username: string };

function parseUser(raw: string | null | undefined): UserDay | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<UserDay>;
    if (typeof v.best !== 'number' || typeof v.runs !== 'number') return null;
    return {
      best: v.best,
      runs: v.runs,
      finished: v.finished === true,
      submittedAt: typeof v.submittedAt === 'number' ? v.submittedAt : 0,
      username: typeof v.username === 'string' ? v.username : 'unknown',
    };
  } catch {
    return null;
  }
}

const bad = (c: HonoContext, error: string, status: 400 | 401 | 409 | 500 = 400) => c.json<ErrorResponse>({ error }, status);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const routeLine = (p: Puzzle) => p.biomes.map((b) => BIOMES[b].name).join(' → ');

/** Rank with the spec's tie-break: higher best first, then the earlier time that best was set. */
async function rankOf(redis: RedisLike, date: string, userId: string, best: number, at: number): Promise<number> {
  const [higher, tied] = await Promise.all([
    redis.zRange(kLb(date), best + 1, Number.MAX_SAFE_INTEGER, { by: 'score' }),
    redis.zRange(kLb(date), best, best, { by: 'score' }),
  ]);
  const others = tied.filter((m) => m.member !== userId);
  const recs = others.length > 0 ? await redis.mGet(others.map((m) => kUser(m.member, date))) : [];
  let earlier = 0;
  others.forEach((m, i) => {
    const t = parseUser(recs[i])?.submittedAt ?? 0;
    if (t < at || (t === at && m.member < userId)) earlier++;
  });
  return higher.length + earlier + 1;
}

/** Streak as displayed: alive if the user scored today or yesterday. */
async function currentStreak(redis: RedisLike, userId: string, today: string): Promise<number> {
  const [stored, t, y] = await Promise.all([redis.get(kStreak(userId)), redis.get(kUser(userId, today)), redis.get(kUser(userId, prevDate(today)))]);
  const n = stored ? Number.parseInt(stored, 10) || 0 : 0;
  return parseUser(t) || parseUser(y) ? n : 0;
}

function scoreBucket(score: number): string {
  if (score < 1000) return '<1000';
  if (score < 2000) return '1000-2000';
  if (score < 3000) return '2000-3000';
  return '3000+';
}

async function readBody(c: HonoContext): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await c.req.json();
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createApp(env: Env): Hono {
  const { redis, reddit } = env;
  const api = new Hono();

  api.get('/today', async (c) => {
    const ctx = env.ctx(c);
    const puzzle = await getPuzzle(redis, ctx.date);
    let myBest: number | null = null;
    let myStreak = 0;
    let playedToday = false;
    let username: string | null = null;
    if (ctx.userId) {
      const [raw, streak, name] = await Promise.all([redis.get(kUser(ctx.userId, ctx.date)), currentStreak(redis, ctx.userId, ctx.date), ctx.username()]);
      const rec = parseUser(raw);
      myBest = rec ? rec.best : null;
      playedToday = rec !== null;
      myStreak = streak;
      username = name ?? null;
    }
    return c.json<TodayResponse>({ date: ctx.date, biomes: puzzle.biomes, parSeconds: puzzle.parSeconds, myBest, myStreak, playedToday, username });
  });

  api.post('/run', async (c) => {
    const ctx = env.ctx(c);
    const { userId, date } = ctx;
    const b = await readBody(c);
    if (!b) return bad(c, 'body must be JSON');
    const { score, seedCheck, inputs } = b;
    if (!isInt(score) || score < 0) return bad(c, 'score must be an int ≥ 0');
    if (!isInt(seedCheck)) return bad(c, 'seedCheck must be an int');
    if (!Array.isArray(inputs) || inputs.length > MAX_LOG) return bad(c, `inputs must be an array of at most ${MAX_LOG} numbers`);
    if (!userId) return bad(c, 'log in to post a score', 401);

    const puzzle = await getPuzzle(redis, date);
    const course = courseFor(date, puzzle);
    if (seedCheck !== course.checksum) return bad(c, 'track mismatch, reload the post', 409);
    // the server never trusts the client's numbers: it reruns the run from its inputs and scores that
    const run = replay(course, puzzle.parSeconds, inputs);
    if (!run) return bad(c, 'inputs are not a valid run');
    const verified = scoreOf(run).total;
    if (verified !== score) return bad(c, 'score does not match the replayed run');
    const body = { score: verified, finished: run.phase === 'finish' };

    const username = (await ctx.username()) ?? 'unknown';
    const prev = parseUser(await redis.get(kUser(userId, date)));
    const now = Date.now();
    const improved = !prev || body.score > prev.best;
    const rec: UserDay = {
      best: improved ? body.score : prev.best,
      runs: (prev?.runs ?? 0) + 1,
      finished: (prev?.finished ?? false) || body.finished,
      submittedAt: improved ? now : prev.submittedAt,
      username,
    };
    await redis.set(kUser(userId, date), JSON.stringify(rec));
    if (improved) await redis.zAdd(kLb(date), { member: userId, score: rec.best });

    // streak: consecutive UTC days with a scored run, counted once per day
    let streak: number;
    if (!prev) {
      const y = parseUser(await redis.get(kUser(userId, prevDate(date))));
      const stored = Number.parseInt((await redis.get(kStreak(userId))) ?? '0', 10) || 0;
      streak = y ? stored + 1 : 1;
      await redis.set(kStreak(userId), String(streak));
    } else streak = await currentStreak(redis, userId, date);

    const rank = await rankOf(redis, date, userId, rec.best, rec.submittedAt);

    // flair: best-effort, never blocks the result
    const flair = rank <= 10 ? `Top 10 · ${rec.best}` : streak >= 7 ? '7-day explorer' : body.finished ? `Finisher · ${body.score}` : null;
    if (flair && ctx.subredditName && username !== 'unknown') {
      reddit.setUserFlair({ subredditName: ctx.subredditName, username, text: flair }).catch((err: unknown) => console.error('flair failed', err));
    }
    // Journeys: one event per finished run, score bucket only; crashes send nothing
    if (body.finished) console.log(`[journey] finish bucket=${scoreBucket(body.score)}`);

    return c.json<RunResponse>({ score: verified, best: rec.best, rank, streak, improved });
  });

  api.get('/leaderboard', async (c) => {
    const ctx = env.ctx(c);
    const date = c.req.query('date') ?? ctx.date;
    if (!isDateString(date)) return bad(c, 'date must be YYYY-MM-DD');
    const [rows, total] = await Promise.all([redis.zRange(kLb(date), 0, 29, { by: 'rank', reverse: true }), redis.zCard(kLb(date))]);
    const recs = rows.length > 0 ? await redis.mGet(rows.map((r) => kUser(r.member, date))) : [];
    const list = rows.map((r, i) => {
      const u = parseUser(recs[i]);
      return { member: r.member, score: r.score, at: u?.submittedAt ?? 0, username: u?.username ?? 'unknown' };
    });
    list.sort((a, b) => b.score - a.score || a.at - b.at || (a.member < b.member ? -1 : 1));
    const top: LeaderboardEntry[] = list.slice(0, 10).map((r, i) => ({ rank: i + 1, username: r.username, score: r.score }));
    let me: LeaderboardResponse['me'] = null;
    if (ctx.userId) {
      const rec = parseUser(await redis.get(kUser(ctx.userId, date)));
      if (rec) me = { rank: await rankOf(redis, date, ctx.userId, rec.best, rec.submittedAt), best: rec.best };
    }
    return c.json<LeaderboardResponse>({ date, top, me, total });
  });

  /** "Share my run": one comment, only on the user's tap. Text is built server-side from the stored best. */
  api.post('/share', async (c) => {
    const ctx = env.ctx(c);
    if (!ctx.userId || !ctx.postId) return bad(c, 'not available here');
    const rec = parseUser(await redis.get(kUser(ctx.userId, ctx.date)));
    if (!rec) return bad(c, 'play a run first');
    const puzzle = await getPuzzle(redis, ctx.date);
    const text = `Grid Expedition ${rec.best} — ${routeLine(puzzle)}`;
    try {
      await reddit.submitComment({ id: ctx.postId, text, runAs: 'USER' });
      return c.json({ ok: true, text });
    } catch (err) {
      console.error('share failed', err);
      return bad(c, 'could not post the comment', 500);
    }
  });

  // ---------- internal: daily post, menu, install ----------
  async function createDailyPost(c: HonoContext): Promise<{ id: string; date: string }> {
    const { date } = env.ctx(c);
    const existing = await redis.get(kPost(date));
    if (existing) return { id: existing, date };
    const puzzle = await getPuzzle(redis, date);
    const post = await reddit.submitCustomPost({ title: `Grid Expedition — ${date}: ${routeLine(puzzle)}`, postData: { date } });
    await redis.set(kPost(date), post.id);
    return { id: post.id, date };
  }

  const internal = new Hono();
  internal.post('/scheduler/daily-post', async (c) => {
    try {
      const { id, date } = await createDailyPost(c);
      console.log(`daily post ${date}: ${id}`);
      return c.json({ status: 'ok' });
    } catch (err) {
      console.error('daily post failed', err);
      return c.json({ status: 'error' }, 500);
    }
  });
  internal.post('/menu/post-create', async (c) => {
    try {
      const { id } = await createDailyPost(c);
      return c.json({ navigateTo: `https://reddit.com/r/${env.ctx(c).subredditName}/comments/${id}` });
    } catch (err) {
      console.error('menu post failed', err);
      return c.json({ showToast: 'Failed to create post' }, 400);
    }
  });
  internal.post('/triggers/on-app-install', async (c) => {
    try {
      const { id } = await createDailyPost(c);
      return c.json({ status: 'success', message: `post ${id}` });
    } catch (err) {
      console.error('install post failed', err);
      return c.json({ status: 'error', message: 'Failed to create post' }, 400);
    }
  });

  const app = new Hono();
  app.route('/api', api);
  app.route('/internal', internal);
  return app;
}
