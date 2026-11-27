/**
 * HTTP routes (spec §12–§13), independent of where they run. Production: index.ts binds Devvit's redis/reddit/context.
 * Local mode and tests: memory.ts fakes. The server is the source of truth for the track and the best score.
 */
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { BIOMES } from '../shared/biomes.ts';
import { SEGMENT_START, segmentEnd } from '../shared/grid.ts';
import type { BiomeId } from '../shared/types.ts';
import { isDateString, prevDate } from '../shared/rng.ts';
import { ENDLESS_MAX_LOG, replayEndless } from '../shared/endless.ts';
import { MAX_LOG, METERS_PER_ROW, hasPilotInputs, replay, score as scoreOf } from '../shared/sim.ts';
import type { EndlessRunResponse, ErrorResponse, LeaderboardEntry, LeaderboardResponse, RunResponse, TodayResponse } from '../shared/types.ts';
import { courseFor, getPuzzle } from './daily.ts';
import type { Puzzle } from './daily.ts';
import type { Env, RedisLike } from './ports.ts';

// ---------- Redis keys (spec §12) ----------
export const kLb = (date: string) => `ge:lb:${date}`;
const kUser = (userId: string, date: string) => `ge:user:${userId}:${date}`;
const kStreak = (userId: string) => `ge:streak:${userId}`;
export const kPost = (date: string) => `ge:post:${date}`;
/** Endless mode has its own daily board: best distance (rows) per user and date. */
export const kElb = (date: string) => `ge:elb:${date}`;
const kEuser = (userId: string, date: string) => `ge:euser:${userId}:${date}`;

/** A daily leaderboard: the sorted set of bests and the per-user record that holds the tie-break time. */
type Board = { lb: (date: string) => string; user: (userId: string, date: string) => string };
const DAILY: Board = { lb: kLb, user: kUser };
const ENDLESS: Board = { lb: kElb, user: kEuser };

/** What the share comment shows about the best run (from the server's own replay). */
type RunSummary = { time: number; row: number; gates: number; collects: number; rides: number; finished: boolean };
type UserDay = { best: number; runs: number; finished: boolean; submittedAt: number; username: string; run?: RunSummary };

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
      ...(v.run && typeof v.run === 'object' ? { run: v.run } : {}),
    };
  } catch {
    return null;
  }
}

const bad = (c: HonoContext, error: string, status: 400 | 401 | 409 | 500 = 400) => c.json<ErrorResponse>({ error }, status);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const routeLine = (p: Puzzle) => p.biomes.map((b) => BIOMES[b].name).join(' → ');

/** Rank with the spec's tie-break: higher best first, then the earlier time that best was set. */
async function rankOf(redis: RedisLike, board: Board, date: string, userId: string, best: number, at: number): Promise<number> {
  const [higher, tied] = await Promise.all([
    redis.zRange(board.lb(date), best + 1, Number.MAX_SAFE_INTEGER, { by: 'score' }),
    redis.zRange(board.lb(date), best, best, { by: 'score' }),
  ]);
  const others = tied.filter((m) => m.member !== userId);
  const recs = others.length > 0 ? await redis.mGet(others.map((m) => board.user(m.member, date))) : [];
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

const BIOME_EMOJI: Record<BiomeId, string> = { snow: '🏔️', desert: '🏜️', volcano: '🌋', ocean: '🌊', jungle: '🌴', icefield: '🧊', city: '🏙️', space: '🚀' };

/**
 * The "Share my run" comment, Wordle-style: one emoji per biome with ✅ (crossed), 💥 (crashed there) or ⬜ (not
 * reached), then time, gates, collects, rides, rank and streak. Built from the server's replay of the best run.
 */
function shareText(date: string, p: Puzzle, rec: UserDay, rank: number, total: number, streak: number): string {
  const run = rec.run;
  const segs = p.biomes.map((b, i) => {
    const end = segmentEnd(i);
    const mark = !run ? '' : run.finished || run.row > end ? '✅' : run.row >= SEGMENT_START[i as 0 | 1 | 2] ? '💥' : '⬜';
    return `${BIOME_EMOJI[b]}${mark}`;
  });
  const lines = [`Grid Expedition ${date} · **${rec.best}**`, segs.join(' → ')];
  if (run) {
    lines.push(run.finished ? `⏱️ ${run.time.toFixed(1)} s (par ${p.parSeconds} s)` : `💥 crashed at ${run.row * METERS_PER_ROW} m`);
    lines.push(`🚩 ${run.gates} gates · ⭐ ${run.collects} · 🚁 ${run.rides} ride${run.rides === 1 ? '' : 's'}`);
  }
  lines.push(`#${rank} of ${total} today${streak > 1 ? ` · 🔥 ${streak}-day streak` : ''}`);
  // two trailing spaces = markdown line break, so the lines stay lines in the comment
  return lines.join('  \n');
}

function scoreBucket(score: number): string {
  if (score < 1000) return '<1000';
  if (score < 2000) return '1000-2000';
  if (score < 3000) return '2000-3000';
  return '3000+';
}

/** Top 10 + the caller's rank on a board (tie-break: earlier time first). */
async function boardFor(redis: RedisLike, board: Board, date: string, userId: string | undefined): Promise<LeaderboardResponse> {
  const [rows, total] = await Promise.all([redis.zRange(board.lb(date), 0, 29, { by: 'rank', reverse: true }), redis.zCard(board.lb(date))]);
  const recs = rows.length > 0 ? await redis.mGet(rows.map((r) => board.user(r.member, date))) : [];
  const list = rows.map((r, i) => {
    const u = parseUser(recs[i]);
    return { member: r.member, score: r.score, at: u?.submittedAt ?? 0, username: u?.username ?? 'unknown' };
  });
  list.sort((a, b) => b.score - a.score || a.at - b.at || (a.member < b.member ? -1 : 1));
  const top: LeaderboardEntry[] = list.slice(0, 10).map((r, i) => ({ rank: i + 1, username: r.username, score: r.score }));
  let me: LeaderboardResponse['me'] = null;
  if (userId) {
    const rec = parseUser(await redis.get(board.user(userId, date)));
    if (rec) me = { rank: await rankOf(redis, board, date, userId, rec.best, rec.submittedAt), best: rec.best };
  }
  return { date, top, me, total };
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
    let myEndlessBest: number | null = null;
    if (ctx.userId) {
      const [raw, streak, name, eraw] = await Promise.all([
        redis.get(kUser(ctx.userId, ctx.date)),
        currentStreak(redis, ctx.userId, ctx.date),
        ctx.username(),
        redis.get(kEuser(ctx.userId, ctx.date)),
      ]);
      const rec = parseUser(raw);
      myBest = rec ? rec.best : null;
      playedToday = rec !== null;
      myStreak = streak;
      username = name ?? null;
      myEndlessBest = parseUser(eraw)?.best ?? null;
    }
    return c.json<TodayResponse>({ date: ctx.date, biomes: puzzle.biomes, parSeconds: puzzle.parSeconds, myBest, myStreak, playedToday, username, myEndlessBest });
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
    if (hasPilotInputs(inputs)) return bad(c, 'autopilot runs are not accepted');
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
    const rides = course.pickups.filter((p) => run.taken.has(p.row * course.cols + p.lane)).length;
    const summary: RunSummary = { time: Math.round(run.time * 10) / 10, row: run.row, gates: run.gates, collects: run.collects, rides, finished: body.finished };

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
      ...(improved ? { run: summary } : prev.run ? { run: prev.run } : {}),
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

    const rank = await rankOf(redis, DAILY, date, userId, rec.best, rec.submittedAt);

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
    return c.json<LeaderboardResponse>(await boardFor(redis, DAILY, date, ctx.userId));
  });

  /** Endless mode: the server replays the run on the day's endless track and ranks the distance it reached. */
  api.post('/endless', async (c) => {
    const ctx = env.ctx(c);
    const { userId, date } = ctx;
    const b = await readBody(c);
    if (!b) return bad(c, 'body must be JSON');
    const { rows, inputs } = b;
    if (!isInt(rows) || rows < 0) return bad(c, 'rows must be an int ≥ 0');
    if (!Array.isArray(inputs) || inputs.length > ENDLESS_MAX_LOG) return bad(c, `inputs must be an array of at most ${ENDLESS_MAX_LOG} numbers`);
    if (hasPilotInputs(inputs)) return bad(c, 'autopilot runs are not accepted');
    if (!userId) return bad(c, 'log in to post a score', 401);
    const run = replayEndless(date, inputs);
    if (!run) return bad(c, 'inputs are not a valid endless run');
    if (run.row !== rows) return bad(c, 'distance does not match the replayed run');

    const username = (await ctx.username()) ?? 'unknown';
    const prev = parseUser(await redis.get(kEuser(userId, date)));
    const improved = !prev || run.row > prev.best;
    const rec: UserDay = {
      best: improved ? run.row : prev.best,
      runs: (prev?.runs ?? 0) + 1,
      finished: false,
      submittedAt: improved ? Date.now() : prev.submittedAt,
      username,
    };
    await redis.set(kEuser(userId, date), JSON.stringify(rec));
    if (improved) await redis.zAdd(kElb(date), { member: userId, score: rec.best });
    const rank = await rankOf(redis, ENDLESS, date, userId, rec.best, rec.submittedAt);
    return c.json<EndlessRunResponse>({ rows: run.row, best: rec.best, rank, improved });
  });

  api.get('/endless-leaderboard', async (c) => {
    const ctx = env.ctx(c);
    const date = c.req.query('date') ?? ctx.date;
    if (!isDateString(date)) return bad(c, 'date must be YYYY-MM-DD');
    return c.json<LeaderboardResponse>(await boardFor(redis, ENDLESS, date, ctx.userId));
  });

  /** "Share my run": one comment, only on the user's tap. Text is built server-side from the stored best. */
  api.post('/share', async (c) => {
    const ctx = env.ctx(c);
    if (!ctx.userId || !ctx.postId) return bad(c, 'not available here');
    const rec = parseUser(await redis.get(kUser(ctx.userId, ctx.date)));
    if (!rec) return bad(c, 'play a run first');
    const puzzle = await getPuzzle(redis, ctx.date);
    const [rank, total, streak] = await Promise.all([rankOf(redis, DAILY, ctx.date, ctx.userId, rec.best, rec.submittedAt), redis.zCard(kLb(ctx.date)), currentStreak(redis, ctx.userId, ctx.date)]);
    const text = shareText(ctx.date, puzzle, rec, rank, total, streak);
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
