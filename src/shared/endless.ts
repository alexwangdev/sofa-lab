/**
 * Endless mode: a track with no finish line, built from daily-style legs of ROWS rows joined end to end.
 *
 * - Each leg is a normal generated track (same rules: safe line, pickups, gates, ramps, walls) with three biomes of
 *   its own, its finish row turned into plain ground. A leg starts with 16 empty rows, so the runner can cross over
 *   from wherever the last leg's safe line ended.
 * - Every leg is a little denser than the one before (LEG_DENSITY per leg, up to MAX_EXTRA), so a run ends sooner or
 *   later.
 * - The track is the same for everyone on a given date, and grows on demand: callers keep it EXTEND_AHEAD rows ahead
 *   of the runner (`extendTo`).
 * - Endless runs are local only: no server, no leaderboard; the best distance is kept in the browser.
 */
import { COLS, ROWS } from './grid.ts';
import { dailyRoute, dailySeed, generateCourse } from './course.ts';
import { hashSeed } from './rng.ts';
import { Cell } from './types.ts';
import type { BiomeId, Course } from './types.ts';
import { computePar, newRun, startRun, tick, validLog } from './sim.ts';
import type { RunState } from './sim.ts';

/** Extra obstacle density per leg (the daily ramp is 5 % → 20 % inside each leg). */
export const LEG_DENSITY = 0.02;
/** Cap on the extra density (leg 13 on), so the safe line stays the only gap only in the hardest stretches. */
export const MAX_EXTRA = 0.25;
/** Rows of track kept generated ahead of the runner (draw distance + autopilot look-ahead, with room to spare). */
const EXTEND_AHEAD = 200;

export function newEndless(date: string): Course {
  const course: Course = {
    date,
    seed: dailySeed(date),
    biomes: [],
    rows: 0,
    cols: COLS,
    cells: new Uint8Array(0),
    safe: new Int8Array(0),
    gateRows: new Map(),
    pickups: [],
    checksum: 0,
    endless: true,
  };
  extendTo(course, EXTEND_AHEAD);
  return course;
}

/** Make sure rows 0…row exist. Generating a leg takes a few tens of ms, about once every 30 s of play. */
export function extendTo(course: Course, row: number): void {
  while (course.rows <= row) appendLeg(course);
}

function appendLeg(course: Course): void {
  const k = course.rows / ROWS;
  const key = `endless:${course.date}:${k}`;
  let route = dailyRoute(hashSeed(key));
  // no repeat across the joint: rotate the leg's route if it would start with the biome just left
  if (route[0] === course.biomes[course.biomes.length - 1]) route = [route[1], route[2], route[0]];
  const leg = generateCourse(key, route, { extraDensity: Math.min(MAX_EXTRA, k * LEG_DENSITY) });
  leg.cells.fill(Cell.Normal, (ROWS - 1) * COLS, ROWS * COLS); // no finish line between legs

  const off = course.rows;
  const cells = new Uint8Array((off + ROWS) * COLS);
  cells.set(course.cells);
  cells.set(leg.cells, off * COLS);
  const safe = new Int8Array(off + ROWS);
  safe.set(course.safe);
  safe.set(leg.safe, off);
  course.cells = cells;
  course.safe = safe;
  for (const r of [...leg.gateRows.keys()].sort((a, b) => a - b)) course.gateRows.set(r + off, course.gateRows.size);
  for (const p of leg.pickups) course.pickups.push({ ...p, row: p.row + off, segment: p.segment + k * 3 });
  course.biomes = [...course.biomes, ...route] as BiomeId[];
  course.rows = off + ROWS;
}

/**
 * Per-step upkeep for an endless run: keep the track EXTEND_AHEAD rows ahead, and forget broken / taken cells far
 * behind the runner. Rows behind are never visited again, and the autopilot copies these sets for every line it
 * tries, so on a long run they would otherwise slow it down more and more.
 */
export function keepAhead(s: RunState): void {
  extendTo(s.course, s.row + EXTEND_AHEAD);
  if (s.row - (prunedAt.get(s) ?? 0) >= ROWS) {
    const cut = (s.row - 8) * COLS;
    for (const k of s.broken) if (k < cut) s.broken.delete(k);
    for (const k of s.taken) if (k < cut) s.taken.delete(k);
    prunedAt.set(s, s.row);
  }
}
const prunedAt = new WeakMap<RunState, number>();

/** Longest endless run the server replays (2 h of play; replaying 13 min takes ~35 ms) and its longest input log. */
export const ENDLESS_MAX_TICKS = 120 * 60 * 60 * 2;
export const ENDLESS_MAX_LOG = 200_000;

/**
 * Rerun an endless run from its input log (server side), on the date's endless track. Returns the crashed run, or
 * null if the log is malformed or the run has not ended within ENDLESS_MAX_TICKS.
 */
export function replayEndless(date: string, log: unknown): RunState | null {
  if (!validLog(log, ENDLESS_MAX_TICKS, ENDLESS_MAX_LOG)) return null;
  const s = newRun(newEndless(date), computePar());
  startRun(s);
  let i = 0;
  const codes: number[] = [];
  while (s.phase === 'run' && s.tick < ENDLESS_MAX_TICKS) {
    keepAhead(s);
    codes.length = 0;
    while (i < log.length && log[i] === s.tick) {
      codes.push(log[i + 1] ?? 0);
      i += 2;
    }
    tick(s, codes);
    s.events.length = 0;
  }
  return s.phase === 'crash' ? s : null;
}
