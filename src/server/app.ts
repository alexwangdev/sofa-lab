/**
 * All HTTP routes (spec §8 + internal endpoints), independent of where they run.
 * Production: src/server/index.ts passes Devvit's redis/reddit/context. Local mode: src/server/local.ts passes fakes.
 */
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { runTest } from '../shared/sofa';
import { isDateString, medalFor, prevDate } from '../shared/daily';
import type {
  ErrorResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  RevealResponse,
  RevealShape,
  SubmitResult,
  TestResult,
  TodayResponse,
} from '../shared/types';
import { getPuzzle } from './daily';
import { shareLines } from '../shared/share';
import type { Env, RedisLike } from './ports';

// ---------- Redis keys (spec §7) ----------
export const kLb = (date: string) => `lb:${date}`;
export const kUser = (userId: string, date: string) => `user:${userId}:${date}`;
export const kStreak = (userId: string) => `streak:${userId}`;
/** Submit lock: hSetNX makes "one submit per day" atomic under concurrent requests. */
export const kLock = (date: string) => `submitted:${date}`;
export const kPost = (date: string) => `post:${date}`;

type UserRecord = { area: number; cells: number[]; submittedAt: number; pass: boolean; username: string };

/**
 * Sorted-set score: area×1000 as an int (spec §7) in the high digits, plus an inverted time-of-day in the low
 * 8 digits so equal areas rank the earlier submission first (spec §6 tie-break). area×1000 = floor(score / 1e8).
 */
const TIME_SPAN = 100_000_000;
function lbScore(area: number, submittedAt: number): number {
  const msOfDay = submittedAt % 86_400_000;
  return Math.round(area * 1000) * TIME_SPAN + (TIME_SPAN - 1 - msOfDay);
}
const areaFromScore = (score: number): number => Math.floor(score / TIME_SPAN) / 1000;

function parseUser(raw: string | null | undefined): UserRecord | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || !('area' in v) || !('cells' in v) || !('submittedAt' in v)) return null;
    if (typeof v.area !== 'number' || !Array.isArray(v.cells) || typeof v.submittedAt !== 'number') return null;
    const cells = v.cells.filter((c): c is number => typeof c === 'number');
    const pass = 'pass' in v && typeof v.pass === 'boolean' ? v.pass : v.area > 0;
    const username = 'username' in v && typeof v.username === 'string' ? v.username : 'unknown';
    return { area: v.area, cells, submittedAt: v.submittedAt, pass, username };
  } catch {
    return null;
  }
}

async function rankOf(redis: RedisLike, date: string, userId: string): Promise<number | null> {
  const [asc, card] = await Promise.all([redis.zRank(kLb(date), userId), redis.zCard(kLb(date))]);
  return asc === undefined ? null : card - asc;
}

/** Streak as displayed: broken if there is no pass today or yesterday. */
async function currentStreak(redis: RedisLike, userId: string, today: string): Promise<number> {
  const [stored, t, y] = await Promise.all([
    redis.get(kStreak(userId)),
    redis.get(kUser(userId, today)),
    redis.get(kUser(userId, prevDate(today))),
  ]);
  const n = stored ? Number.parseInt(stored, 10) || 0 : 0;
  const alive = parseUser(t)?.pass === true || parseUser(y)?.pass === true;
  return alive ? n : 0;
}

async function readCells(c: HonoContext): Promise<unknown> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body === 'object' && body !== null && 'cells' in body) return body.cells;
    return undefined;
  } catch {
    return undefined;
  }
}

const bad = (c: HonoContext, error: string, status: 400 | 401 | 409 | 500 = 400) =>
  c.json<ErrorResponse>({ error }, status);

function areaBucket(area: number): string {
  if (area <= 0) return '0';
  if (area < 1) return '<1';
  if (area < 1.5) return '1-1.5';
  if (area < 2) return '1.5-2';
  if (area < 2.1) return '2-2.1';
  if (area < 2.2) return '2.1-2.2';
  return '2.2+';
}

export function createApp(env: Env): Hono {
  const { redis, reddit } = env;

  // ---------- API (spec §8) ----------
  const api = new Hono();

  api.get('/today', async (c) => {
    const ctx = env.ctx(c);
    const date = ctx.date;
    const puzzle = await getPuzzle(redis, date, ctx.wOverride);
    const { userId } = ctx;
    let rec: UserRecord | null = null;
    let rank: number | null = null;
    let streak = 0;
    let username: string | null = null;
    let prevCells: number[] | null = null;
    if (userId) {
      const back: string[] = [];
      for (let d = prevDate(date), i = 0; i < 7; i++, d = prevDate(d)) back.push(kUser(userId, d));
      const [raw, s, u, prev] = await Promise.all([
        redis.get(kUser(userId, date)),
        currentStreak(redis, userId, date),
        ctx.username(),
        redis.mGet(back),
      ]);
      rec = parseUser(raw);
      streak = s;
      username = u ?? null;
      if (rec) rank = await rankOf(redis, date, userId);
      for (const p of prev) {
        const r = parseUser(p);
        if (r && r.cells.length > 0) {
          prevCells = r.cells;
          break;
        }
      }
    }
    return c.json<TodayResponse>({
      date,
      weekday: puzzle.weekday,
      difficulty: puzzle.difficulty,
      twists: puzzle.twists,
      course: puzzle.course,
      w: puzzle.course.w,
      par: puzzle.par,
      target: puzzle.target,
      targetLabel: puzzle.targetLabel,
      hasSubmitted: rec !== null,
      myArea: rec ? rec.area : null,
      myCells: rec ? rec.cells : null,
      myRank: rank,
      prevCells,
      streak,
      username,
    });
  });

  api.post('/test', async (c) => {
    const ctx = env.ctx(c);
    const { course } = await getPuzzle(redis, ctx.date, ctx.wOverride);
    const res = runTest(await readCells(c), course);
    if (!res.ok) return bad(c, res.error);
    return c.json<TestResult>(res.result);
  });

  api.post('/submit', async (c) => {
    const ctx = env.ctx(c);
    const { userId, date } = ctx;
    if (!userId) return bad(c, 'log in to submit', 401);
    const puzzle = await getPuzzle(redis, date, ctx.wOverride);
    const res = runTest(await readCells(c), puzzle.course);
    if (!res.ok) return bad(c, res.error); // invalid → 400, no write

    // One submit per user per UTC day (atomic).
    const locked = await redis.hSetNX(kLock(date), userId, '1');
    if (locked !== 1 || (await redis.exists(kUser(userId, date))) > 0) {
      return bad(c, 'already submitted today', 409);
    }

    const username = (await ctx.username()) ?? 'unknown';
    const pass = res.result.pass;
    const area = pass ? res.result.area : 0;
    const submittedAt = Date.now();
    const rec: UserRecord = { area, cells: res.cells, submittedAt, pass, username };

    await redis.set(kUser(userId, date), JSON.stringify(rec));
    await redis.zAdd(kLb(date), { member: userId, score: lbScore(area, submittedAt) });

    let streak = 0;
    if (pass) {
      const y = parseUser(await redis.get(kUser(userId, prevDate(date))));
      if (y?.pass) streak = await redis.incrBy(kStreak(userId), 1);
      else {
        await redis.set(kStreak(userId), '1');
        streak = 1;
      }
    } else {
      await redis.set(kStreak(userId), '0');
    }
    const rank = await rankOf(redis, date, userId);

    // Flair: best-effort, never blocks submit (spec §7).
    if (pass && ctx.subredditName && username !== 'unknown') {
      const text =
        rank !== null && rank <= 10 ? `Top 10 · ${area.toFixed(2)}` : streak >= 7 ? '7-day mover' : `Sofa ${area.toFixed(2)}`;
      reddit.setUserFlair({ subredditName: ctx.subredditName, username, text }).catch((err: unknown) => {
        console.error('flair failed', err);
      });
    }

    // Journeys: one event per submit, area bucket only (no shape data). See README.
    console.log(`[journey] submit bucket=${areaBucket(area)}`);

    const medal = medalFor(area, puzzle.par);
    return c.json<SubmitResult>({ date, w: puzzle.course.w, pass, area, rank, streak, target: puzzle.target, par: puzzle.par, medal });
  });

  api.get('/leaderboard', async (c) => {
    const ctx = env.ctx(c);
    const q = c.req.query('date');
    const date = q === undefined ? ctx.date : q;
    if (!isDateString(date)) return bad(c, 'date must be YYYY-MM-DD');
    const [rows, total] = await Promise.all([
      redis.zRange(kLb(date), 0, 9, { by: 'rank', reverse: true }),
      redis.zCard(kLb(date)),
    ]);
    const users = rows.length > 0 ? await redis.mGet(rows.map((r) => kUser(r.member, date))) : [];
    const top: LeaderboardEntry[] = rows.map((r, i) => ({
      rank: i + 1,
      username: parseUser(users[i])?.username ?? 'unknown',
      area: areaFromScore(r.score),
    }));
    let me: LeaderboardResponse['me'] = null;
    if (ctx.userId) {
      const score = await redis.zScore(kLb(date), ctx.userId);
      const rank = score === undefined ? null : await rankOf(redis, date, ctx.userId);
      if (score !== undefined && rank !== null) me = { rank, area: areaFromScore(score) };
    }
    return c.json<LeaderboardResponse>({ date, top, me, total });
  });

  /**
   * Next-day reveal: a past day's par shape, its top player's sofa and the caller's own. Today is refused, so the
   * answer only comes out once the day is over.
   */
  api.get('/reveal', async (c) => {
    const ctx = env.ctx(c);
    const q = c.req.query('date');
    const date = q === undefined ? prevDate(ctx.date) : q;
    if (!isDateString(date)) return bad(c, 'date must be YYYY-MM-DD');
    if (date >= ctx.date) return bad(c, 'today is revealed tomorrow');
    const puzzle = await getPuzzle(redis, date, ctx.wOverride);
    const shapes: RevealShape[] = [];
    if (puzzle.par !== null && puzzle.parCells.length > 0) shapes.push({ label: 'Par (best possible)', area: puzzle.par, cells: puzzle.parCells });
    const [top] = await redis.zRange(kLb(date), 0, 0, { by: 'rank', reverse: true });
    if (top) {
      const rec = parseUser(await redis.get(kUser(top.member, date)));
      if (rec && rec.pass) shapes.push({ label: `#1 u/${rec.username}`, area: rec.area, cells: rec.cells });
    }
    if (ctx.userId && ctx.userId !== top?.member) {
      const mine = parseUser(await redis.get(kUser(ctx.userId, date)));
      if (mine) shapes.push({ label: 'You', area: mine.area, cells: mine.cells });
    }
    return c.json<RevealResponse>({
      date,
      weekday: puzzle.weekday,
      difficulty: puzzle.difficulty,
      twists: puzzle.twists,
      course: puzzle.course,
      par: puzzle.par,
      shapes,
    });
  });

  /** "Share my sofa" — posts one comment, only when the user taps the button. Text built server-side. */
  api.post('/share', async (c) => {
    const ctx = env.ctx(c);
    const { userId, postId, date } = ctx;
    if (!userId || !postId) return bad(c, 'not available here', 400);
    const rec = parseUser(await redis.get(kUser(userId, date)));
    if (!rec) return bad(c, 'submit first', 400);
    const puzzle = await getPuzzle(redis, date, ctx.wOverride);
    const streak = await currentStreak(redis, userId, date);
    const text = shareLines({
      weekday: puzzle.weekday,
      difficulty: puzzle.difficulty,
      area: rec.area,
      pass: rec.pass,
      par: puzzle.par,
      medal: medalFor(rec.area, puzzle.par),
      streak,
      course: puzzle.course,
    }).join('  \n');
    try {
      await reddit.submitComment({ id: postId, text, runAs: 'USER' });
      return c.json({ ok: true, text });
    } catch (err) {
      console.error('share comment failed', err);
      return bad(c, 'could not post comment', 500);
    }
  });

  /** Subscribe prompt on the result card. */
  api.post('/subscribe', async (c) => {
    if (!env.ctx(c).userId) return bad(c, 'log in first', 401);
    try {
      await reddit.subscribeToCurrentSubreddit();
      return c.json({ ok: true });
    } catch (err) {
      console.error('subscribe failed', err);
      return bad(c, 'could not subscribe', 500);
    }
  });

  // ---------- Internal: daily post, menu, install ----------
  async function createDailyPost(c: HonoContext): Promise<{ id: string; date: string }> {
    const ctx = env.ctx(c);
    const date = ctx.date;
    const puzzle = await getPuzzle(redis, date, ctx.wOverride);
    const existing = await redis.get(kPost(date));
    if (existing) return { id: existing, date };
    const post = await reddit.submitCustomPost({
      title: `Sofa Lab — ${date} · ${puzzle.weekday} ${puzzle.difficulty}: hallway width ${puzzle.course.w}`,
      postData: { date },
    });
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
