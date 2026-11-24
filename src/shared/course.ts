/**
 * Daily route + track generation (spec §5, §9). Pure and deterministic: same date → same biomes and the same cells,
 * on the client (which draws and plays it) and on the server (which bounds scores with it).
 */
import { COLS, FINISH_ROW, ROWS, SEGMENT_START, segmentEnd } from './grid.ts';
import { hashBytes, hashSeed, mulberry32 } from './rng.ts';
import { enterRow, nextRow, stateAt } from './sim.ts';
import { timedFor, vehicle } from './vehicles.ts';
import { BIOME_IDS, Cell } from './types.ts';
import type { BiomeId, Course, Pickup } from './types.ts';

export const dailySeed = (date: string): number => hashSeed(`gridexpedition:${date}`);

/** Fisher–Yates over the 8-biome pool with the day's RNG; the first 3 are the route, in order. */
export function dailyRoute(seed: number): [BiomeId, BiomeId, BiomeId] {
  const rng = mulberry32(seed);
  const pool: BiomeId[] = [...BIOME_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i] as BiomeId;
    pool[i] = pool[j] as BiomeId;
    pool[j] = a;
  }
  return [pool[0] as BiomeId, pool[1] as BiomeId, pool[2] as BiomeId];
}

export const isSolid = (k: number): boolean => k === Cell.Crash;

/** Rows before / after a boundary that a pickup must keep clear of (spec §9). */
const BOUNDARY_GAP = 8;
const PICKUP_GAP = 5;
/** Walls with a gap, second half only, every 70 rows. */
const WALLS: readonly number[] = Array.from({ length: Math.max(0, Math.floor((FINISH_ROW - 10 - (Math.floor(ROWS / 2) + 15)) / 70) + 1) }, (_, i) => Math.floor(ROWS / 2) + 15 + i * 70);

/** extraDensity: added to the obstacle density of every row (endless legs get harder; the daily track uses 0). */
export function generateCourse(date: string, biomes: readonly [BiomeId, BiomeId, BiomeId] = dailyRoute(dailySeed(date)), opts: { extraDensity?: number } = {}): Course {
  const extra = opts.extraDensity ?? 0;
  const seed = dailySeed(date);
  // the route draws from mulberry32(seed); the track uses its own stream so both stay stable
  const rng = mulberry32(hashSeed(`gridexpedition:${date}:track`));
  const cells = new Uint8Array(ROWS * COLS);
  const set = (r: number, c: number, k: number) => {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) cells[r * COLS + c] = k;
  };
  const get = (r: number, c: number): number => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? (cells[r * COLS + c] ?? 0) : Cell.Normal);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  // 0. plan the pickups first (2 per segment): their windows lock the safe line and stay free of gates/ramps/walls
  //    (a wall that would fall inside a window is skipped, see 3)
  const plan: { row: number; vehicle: string; segment: 0 | 1 | 2; lo: number; hi: number }[] = [];
  for (const seg of [0, 1, 2] as const) {
    const list = timedFor(biomes[seg]);
    const picks = [0, 1].map(() => list[Math.floor(rng() * list.length)] ?? list[0]).filter((v) => v !== undefined);
    // place the segment's two windows together (retrying both), so a badly placed first one cannot crowd out the second
    for (let attempt = 0; attempt < 400; attempt++) {
      const got: typeof plan = [];
      for (const v of picks) {
        const P = int(SEGMENT_START[seg] + BOUNDARY_GAP + 14, segmentEnd(seg) - BOUNDARY_GAP - v.durationRows - 8);
        const lo = P - 14;
        const hi = P + v.durationRows + 8;
        if ([...plan, ...got].some((p) => Math.abs(p.row - P) < Math.max(PICKUP_GAP, 20) || (lo <= p.hi && hi >= p.lo))) break;
        got.push({ row: P, vehicle: v.id, segment: seg, lo, hi });
      }
      if (got.length === picks.length) {
        plan.push(...got);
        break;
      }
    }
  }
  const inWindow = (r: number): boolean => plan.some((p) => r >= p.lo && r <= p.hi);

  // 1. safe line: random walk, at most one lane shift every 4 rows, never inside a pickup window
  const safe = new Int8Array(ROWS);
  let path = 4;
  let lastMove = 0;
  for (let r = 0; r < ROWS; r++) {
    if (r > 16 && r < FINISH_ROW - 4 && r - lastMove >= 4 && !inWindow(r) && rng() < 0.3) {
      const next = Math.max(0, Math.min(COLS - 1, path + (rng() < 0.5 ? -1 : 1)));
      if (next !== path) lastMove = r;
      path = next;
    }
    safe[r] = path;
  }
  const safeAt = (r: number): number => safe[Math.max(0, Math.min(ROWS - 1, r))] ?? 4;

  // 2. obstacles 5% → 20% over the whole run, plus Slow cells
  for (let r = 16; r < FINISH_ROW - 2; r++) {
    const density = 0.05 + 0.15 * (r / FINISH_ROW) + extra;
    for (let c = 0; c < COLS; c++) {
      const x = rng();
      if (x < density) set(r, c, Cell.Crash);
      else if (x < density + 0.014) set(r, c, Cell.Slow);
    }
  }
  // 3. walls with a gap in the second half (none inside a pickup window)
  for (const r of WALLS) {
    if (inWindow(r)) continue;
    const gap = safeAt(r);
    for (let c = 0; c < COLS; c++) {
      const open = c === gap || c === gap + (gap < COLS - 1 ? 1 : -1);
      if (!open) set(r, c, Cell.Crash);
    }
  }
  // 4. Fast streaks
  for (let r = 30; r < FINISH_ROW - 12; r += int(25, 45)) {
    const c = int(0, COLS - 1);
    const n = int(3, 6);
    for (let i = 0; i < n; i++) if (!isSolid(get(r + i, c))) set(r + i, c, Cell.Fast);
  }
  // 5. clear the safe line (both lanes where it shifts), sprinkle Collect on it
  for (let r = 0; r < FINISH_ROW; r++) {
    const s = safeAt(r);
    set(r, s, r > 16 && rng() < 0.1 ? Cell.Collect : Cell.Normal);
    if (r > 0 && safeAt(r - 1) !== s) {
      set(r, safeAt(r - 1), Cell.Normal);
      set(r - 1, s, Cell.Normal);
      set(r + 1, s, Cell.Normal);
    }
  }
  // 6. ramps on the safe line with a cleared landing
  // a spot that collides with a pickup window or a safe-line shift slides forward (up to 24 rows) instead of being
  // dropped — on a 450-row track dropping them left many days with no ramp at all
  const rampRows: number[] = [];
  for (let r = 45; r < FINISH_ROW - 30; r += int(45, 70)) {
    for (let off = 0; off <= 24; off++) {
      const rr = r + off;
      if (rr >= FINISH_ROW - 30) break;
      const c = safeAt(rr);
      if (safeAt(rr - 1) !== c || inWindow(rr) || inWindow(rr + 14) || rampRows.some((q) => rr - q < 30)) continue;
      set(rr, c, Cell.Ramp);
      set(rr - 1, c, Cell.Normal);
      for (let i = 1; i <= 14; i++) if (isSolid(get(rr + i, c))) set(rr + i, c, Cell.Normal);
      rampRows.push(rr);
      r = rr;
      break;
    }
  }
  // 7. gates: an opening of 2–3 lanes containing the safe line, a pole either side
  const gateRows = new Map<number, number>();
  for (let r = 28; r < FINISH_ROW - 12; r += int(20, 30)) {
    if (rampRows.some((rr) => r >= rr - 1 && r <= rr + 8) || inWindow(r)) continue;
    const w = r < ROWS * 0.4 ? 3 : 2;
    const lo = Math.max(0, Math.min(COLS - w, safeAt(r) - int(0, w - 1)));
    for (let c = 0; c < COLS; c++) {
      if (c >= lo && c < lo + w) set(r, c, Cell.Gate);
      else if (c === lo - 1 || c === lo + w) set(r, c, Cell.Pole);
      else if (get(r, c) === Cell.Collect) set(r, c, Cell.Normal);
    }
    for (let c = lo; c < lo + w; c++) if (isSolid(get(r - 1, c))) set(r - 1, c, Cell.Normal);
    gateRows.set(r, gateRows.size);
  }

  // 8. pickups: 2 per segment
  const course: Course = { date, seed, biomes: [biomes[0], biomes[1], biomes[2]], rows: ROWS, cols: COLS, cells, safe, gateRows, pickups: [], checksum: 0 };
  for (const p of plan.sort((a, b) => a.row - b.row)) placePickup(course, p.segment, p.vehicle, p.row, rng);

  for (let c = 0; c < COLS; c++) set(FINISH_ROW, c, Cell.Finish);
  course.checksum = hashBytes(cells);
  return course;
}

/**
 * Place one pickup in segment `seg` (spec §9): 1–2 lanes off the safe line, on a non-Crash cell, ≥8 rows from a
 * boundary, ≥5 rows from another pickup, then build the dense section it helps with inside its duration window.
 */
function placePickup(course: Course, seg: 0 | 1 | 2, id: string, P: number, rng: () => number): Pickup {
  const v = vehicle(id);
  const dur = v.durationRows;
  const get = (r: number, c: number) => course.cells[r * COLS + c] ?? 0;
  const set = (r: number, c: number, k: number) => {
    course.cells[r * COLS + c] = k;
  };
  // the planner locked the safe line and kept gates / ramps / walls out of [P-14, P+dur+8]
  const s = course.safe[P] ?? 4;
  {
    const off = (rng() < 0.5 ? 1 : 2) * (rng() < 0.5 ? -1 : 1);
    let lane = s + off;
    if (lane < 0 || lane >= COLS) lane = s - off;
    const lo = Math.min(lane, s);
    const hi = Math.max(lane, s);
    const side = Math.sign(lane - s);

    // approach corridor (rows P-6 … P-1) between the safe line and the pickup lane
    for (let r = P - 6; r < P; r++) for (let c = lo; c <= hi; c++) if (get(r, c) === Cell.Crash) set(r, c, Cell.Normal);
    set(P, lane, Cell.Pickup);
    const pickup: Pickup = { row: P, lane, vehicle: id, segment: seg };
    course.pickups.push(pickup);

    // dense section inside the duration window, on the pickup side of the safe line (never on the safe line)
    const helpsCrash = v.ignoreCrash || v.breakCrash || v.jumpRows > 0 || v.lanesPerRow === 2;
    const d0 = P + 2;
    const d1 = P + Math.max(3, dur - 2);
    for (let r = d0; r <= d1; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c === s || Math.sign(c - s) !== side) continue;
        const x = rng();
        if (helpsCrash) set(r, c, x < 0.6 ? Cell.Crash : get(r, c) === Cell.Crash ? Cell.Crash : Cell.Normal);
        else set(r, c, x < 0.65 ? Cell.Slow : x < 0.75 ? Cell.Crash : Cell.Normal);
      }
      if (!v.noCollect && r % 2 === 0 && get(r, lane) !== Cell.Crash) set(r, lane, Cell.Collect);
    }

    // staying in the pickup lane with the vehicle must be safe through expiry + 3 rows: clear whatever would crash
    for (let tries = 0; tries < 40; tries++) {
      const st = stateAt(course, P - 1, lane);
      enterRow(st, P, 0);
      while (st.phase === 'run' && st.row < P + dur + 3) enterRow(st, nextRow(st), 0);
      if (st.phase !== 'crash') break;
      set(st.row, st.lane, Cell.Normal);
    }
    // exit corridor back to the safe line after expiry
    for (let r = P + dur; r <= P + dur + 6; r++) for (let c = lo; c <= hi; c++) if (get(r, c) === Cell.Crash) set(r, c, Cell.Normal);
    // the pickup itself is never removed by the clearing above
    set(P, lane, Cell.Pickup);
    return pickup;
  }
}
