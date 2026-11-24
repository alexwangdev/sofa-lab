/**
 * Autopilot: drives a run with the real rules, for testing that whole runs can be completed (tools/autotest.ts) and
 * for the in-game Auto mode. Before each row it tries every lane-request sequence a few rows deep on cloned states
 * (enterRow — the same code a player runs), rejects anything that crashes, prefers lines that stay survivable much
 * further ahead, then the best score. Speed never changes which rows are safe (rules resolve per row), so it can
 * hold Tuck the whole way.
 */
import { COLS, FINISH_ROW, cellAt } from './grid.ts';
import { enterRow, maxLanesFor, nextRow, score } from './sim.ts';
import type { RunState } from './sim.ts';
import { Cell } from './types.ts';
import type { Course } from './types.ts';

const DEPTH = 6;
const HORIZON = 16;

function clone(s: RunState): RunState {
  return { ...s, broken: new Set(s.broken), taken: new Set(s.taken), events: [] };
}

/** Can a plain one-lane-per-row runner get from (row, lane) through the next `horizon` rows without a Crash cell? */
function survivable(course: Course, row: number, lane: number, horizon: number): boolean {
  let reach = 1 << lane;
  const end = Math.min(FINISH_ROW, row + horizon);
  for (let r = row + 1; r <= end; r++) {
    let next = 0;
    for (let l = 0; l < COLS; l++) {
      if (!(reach & (1 << l))) continue;
      for (const d of [-1, 0, 1]) {
        const n = l + d;
        if (n >= 0 && n < COLS && cellAt(course, r, n) !== Cell.Crash) next |= 1 << n;
      }
    }
    reach = next;
    if (!reach) return false;
  }
  return true;
}

/** Autopilot style. `pickupBonus` > 0 makes it go out of its way for vehicle pickups (to test every vehicle). */
type PilotOptions = { pickupBonus?: number };
let pickupBonus = 0;

/** Points a line is worth beyond the score: slow cells and poles cost time, which costs time score. */
function eventCost(s: RunState): number {
  let c = 0;
  for (const e of s.events) {
    if (e.kind === 'pickup') c += pickupBonus;
    else if (e.kind === 'slow') c -= 25;
    else if (e.kind === 'pole') c -= 50;
    else if (e.kind === 'missed') c -= 10;
  }
  return c;
}

function value(s: RunState, depth: number, base: number): number {
  if (s.phase === 'crash') return -1e6 + (DEPTH - depth) * 1000; // later crashes are less bad (more chances)
  if (s.phase === 'finish' || depth === 0) {
    const safe = s.phase === 'finish' || survivable(s.course, s.row, s.lane, HORIZON);
    return score(s).total - base + eventCost(s) + (safe ? 0 : -50_000);
  }
  let best = -Infinity;
  const nr = nextRow(s);
  const max = Math.min(1, maxLanesFor(s, nr)); // deeper levels: one lane at a time keeps the search small
  for (let d = -max; d <= max; d++) {
    const t = clone(s);
    t.events = s.events.slice();
    enterRow(t, nr, d);
    const v = value(t, depth - 1, base) - Math.abs(d) * 0.5;
    if (v > best) best = v;
  }
  return best;
}

/** A pilot with options (same search, different preferences). */
export function makePilot(opts: PilotOptions = {}): (s: RunState, row: number) => number {
  return (s, row) => {
    pickupBonus = opts.pickupBonus ?? 0;
    return search(s, row);
  };
}

/** The lane request for entering `row` next (what a player would have queued). Default style. */
export function decide(s: RunState, row: number): number {
  pickupBonus = 0;
  return search(s, row);
}

function search(s: RunState, row: number): number {
  const base = score(s).total;
  const max = maxLanesFor(s, row);
  let bestReq = 0;
  let best = -Infinity;
  for (let d = -max; d <= max; d++) {
    const t = clone(s);
    enterRow(t, row, d);
    const v = value(t, DEPTH - 1, base) - Math.abs(d) * 0.5;
    if (v > best || (v === best && Math.abs(d) < Math.abs(bestReq))) {
      best = v;
      bestReq = d;
    }
  }
  return bestReq;
}
