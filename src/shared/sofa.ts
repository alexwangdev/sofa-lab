/**
 * Sofa Lab geometry: shape rules + the corner test. Shared by client (preview) and server (authoritative).
 * No Redis, no DOM. Pure functions + memoised lookup tables.
 *
 * World (spec §5.1): horizontal arm y∈[0,1], x∈[-4, w]; vertical arm x∈[0,w], y∈[-4,1].
 * Inner corner (0,0). Sofa local coords: u∈[0, cols·0.1], v∈[0,1]; v = 0 is the inner-wall side.
 * A day's Course may add a round pillar (no sample point may ever be inside it) and torn build cells.
 *
 * Test motion (fixed for everyone, every day — see README "Test motion"):
 *   A shape passes if it survives at least one motion from a fixed, finite family:
 *   - slide(ox): pure translation in along the horizontal arm, then down the vertical arm, or
 *   - rotate(r, bu): slide in, then Hammersley's turn — sofa frame: hallway turned by t, inner corner at
 *     q(t) = (bu + r·cos2t, r·sin2t), world point = R(−t)(p − q(t)), t: 0 → 90° in STEPS equal steps — then slide out.
 *     r ∈ {0, 0.01, …, 1}; bu ∈ {k·0.1 + f : f ∈ {0, 0.05}}  (the corner path may sit anywhere along the sofa).
 *   Each cell is sampled at its centre + 4 points at ±SAMPLE_INSET (the cell "core").
 *   The slide-in and slide-out are checked exactly (a point's straight path vs the pillar), the turn in steps.
 */
import type { CellId, Course, JamPhase, Motion, Pillar, ShapeCheck, TestResult } from './types';

export const CELL = 0.1;
export const COLS = 36;
export const ROWS = 10;
export const MAX_CELLS = COLS * ROWS;
export const STEPS = 60;
export const SAMPLE_INSET = 0.01;
export const R_VALUES: readonly number[] = Array.from({ length: 101 }, (_, i) => i / 100);
export const OFFSETS: readonly number[] = [0, 0.05];
export const GERVER = 2.2195;
export const HAMMERSLEY = 2.2074;
export const HAMMERSLEY_R = 2 / Math.PI;

/** Fail codes: 0 = blocked on the way in, 1+k = left the hallway at turn step k, EXIT = blocked on the way out. */
const APPROACH = 0;
const EXIT = STEPS + 2;
const NEVER = STEPS + 3;
const EPS = 1e-9;
/** Relative column range of the lookup table (cells relative to the corner-path centre bu). */
const EXT_MIN = -26;
const EXT_COLS = 52;

export const cellCol = (id: CellId, cols: number = COLS): number => id % cols;
export const cellRow = (id: CellId, cols: number = COLS): number => Math.floor(id / cols);
export const cellIdOf = (col: number, row: number, cols: number = COLS): CellId => row * cols + col;
export const areaOf = (n: number): number => Math.round(n * 10) / 1000;

/** A plain hallway of width w — no pillar, no torn cells. */
export const plainCourse = (w: number): Course => ({ w, pillar: null, torn: [] });
const asCourse = (c: Course | number): Course => (typeof c === 'number' ? plainCourse(c) : c);
export const isPlain = (c: Course): boolean => c.pillar === null && c.torn.length === 0;

/** Spec §5.2: ints in range, non-empty, fits the box, 4-connected, not on torn fabric. Sorted, de-duplicated copy. */
export function checkShape(input: unknown, cols: number = COLS, torn: readonly CellId[] = []): ShapeCheck {
  if (!Array.isArray(input)) return { ok: false, error: 'cells must be an array' };
  const max = cols * ROWS;
  if (input.length === 0) return { ok: false, error: 'sofa is empty' };
  if (input.length > max) return { ok: false, error: `at most ${max} cells` };
  const tornSet = new Set(torn);
  const set = new Set<number>();
  for (const c of input) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= max) {
      return { ok: false, error: 'cell outside the build box' };
    }
    if (tornSet.has(c)) return { ok: false, error: "that fabric is torn — you can't build there today" };
    set.add(c);
  }
  const cells = [...set].sort((a, b) => a - b);
  const first = cells[0];
  if (first === undefined) return { ok: false, error: 'sofa is empty' };
  if (largestPiece(set, cols, first).size !== cells.length) return { ok: false, error: 'sofa must be one piece' };
  return { ok: true, cells };
}

/** 4-connected piece of `set` containing `start`. */
function largestPiece(set: ReadonlySet<number>, cols: number, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const stack: number[] = [start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    const col = cellCol(id, cols);
    const nbrs: number[] = [id - cols, id + cols];
    if (col > 0) nbrs.push(id - 1);
    if (col < cols - 1) nbrs.push(id + 1);
    for (const n of nbrs) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/** Largest 4-connected piece of a cell set (used for bots and par). */
export function biggestPiece(cells: Iterable<CellId>, cols: number = COLS): CellId[] {
  const set = new Set(cells);
  const done = new Set<number>();
  let best: Set<number> = new Set();
  for (const c of set) {
    if (done.has(c)) continue;
    const piece = largestPiece(set, cols, c);
    for (const p of piece) done.add(p);
    if (piece.size > best.size) best = piece;
  }
  return [...best].sort((a, b) => a - b);
}

function inPillar(x: number, y: number, p: Pillar | null): boolean {
  if (!p) return false;
  const dx = x - p.cx;
  const dy = y - p.cy;
  return dx * dx + dy * dy < p.r * p.r - EPS;
}

/** Point-in-hallway, spec §5.1, with vertical-arm width w (§6) and an optional pillar. Boundaries count as inside. */
export function inHallway(x: number, y: number, w: number, pillar: Pillar | null = null): boolean {
  const inL = (y >= -EPS && y <= 1 + EPS && x >= -4 - EPS && x <= w + EPS) || (x >= -EPS && x <= w + EPS && y >= -4 - EPS && y <= 1 + EPS);
  return inL && !inPillar(x, y, pillar);
}

/** A point that slid in from x = −∞ along height y to x: did it pass through the pillar? */
function approachBlocked(x: number, y: number, p: Pillar | null): boolean {
  if (!p) return false;
  const dy = y - p.cy;
  if (Math.abs(dy) >= p.r - EPS) return false;
  return x > p.cx - Math.sqrt(p.r * p.r - dy * dy) + EPS;
}

/** A point that slides out from y down to −∞ at x: does it hit the pillar? */
function exitBlocked(x: number, y: number, p: Pillar | null): boolean {
  if (!p) return false;
  const dx = x - p.cx;
  if (Math.abs(dx) >= p.r - EPS) return false;
  return y > p.cy - Math.sqrt(p.r * p.r - dx * dx) + EPS;
}

/** Corner-path point q(t) in sofa-local coords for a rotate motion. */
export function cornerAt(m: { r: number; bu: number }, t: number): [number, number] {
  return [m.bu + m.r * Math.cos(2 * t), m.r * Math.sin(2 * t)];
}

/** Map a sofa-local point to world at hallway angle t (radians) for a rotate motion. */
export function toWorld(m: { r: number; bu: number }, t: number, u: number, v: number): [number, number] {
  const [qx, qy] = cornerAt(m, t);
  const dx = u - qx;
  const dy = v - qy;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [dx * c + dy * s, -dx * s + dy * c];
}

/** Centre + 4 inset sample points of the cell whose lower-left corner is (u0, v0). */
function samplePoints(u0: number, v0: number): number[] {
  const cx = u0 + CELL / 2;
  const cy = v0 + CELL / 2;
  const h = SAMPLE_INSET;
  return [cx, cy, cx - h, cy - h, cx + h, cy - h, cx - h, cy + h, cx + h, cy + h];
}

export function stepAngle(k: number): number {
  return (k / STEPS) * (Math.PI / 2);
}

/** First fail code for one cell under one rotate motion (see APPROACH / EXIT / NEVER). The §5.3 check. */
function failCode(m: { r: number; bu: number }, u0: number, v0: number, course: Course): number {
  const pts = samplePoints(u0, v0);
  const { w, pillar } = course;
  if (pillar) {
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = toWorld(m, 0, pts[i] ?? 0, pts[i + 1] ?? 0);
      if (approachBlocked(x, y, pillar)) return APPROACH;
    }
  }
  for (let k = 0; k <= STEPS; k++) {
    const t = stepAngle(k);
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = toWorld(m, t, pts[i] ?? 0, pts[i + 1] ?? 0);
      if (!inHallway(x, y, w, pillar)) return 1 + k;
    }
  }
  if (pillar) {
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = toWorld(m, Math.PI / 2, pts[i] ?? 0, pts[i + 1] ?? 0);
      if (exitBlocked(x, y, pillar)) return EXIT;
    }
  }
  return NEVER;
}

type Table = { fail: Uint8Array[] /* index ri * OFFSETS.length + fi */ };
const tables = new Map<string, Table>();
const tableKey = (c: Course): string =>
  `${Math.round(c.w * 1000)}|${c.pillar ? `${c.pillar.cx.toFixed(4)},${c.pillar.cy.toFixed(4)},${c.pillar.r.toFixed(4)}` : ''}`;

/** Lookup table: for every (r, offset) and every relative cell, its fail code. Memoised per hallway. */
function tableFor(course: Course): Table {
  const key = tableKey(course);
  const hit = tables.get(key);
  if (hit) return hit;
  const fail: Uint8Array[] = [];
  for (const r of R_VALUES) {
    for (const f of OFFSETS) {
      const arr = new Uint8Array(EXT_COLS * ROWS);
      for (let i = 0; i < EXT_COLS; i++) {
        for (let row = 0; row < ROWS; row++) {
          const u0 = (EXT_MIN + i) * CELL - f;
          arr[i * ROWS + row] = failCode({ r, bu: 0 }, u0, row * CELL, course);
        }
      }
      fail.push(arr);
    }
  }
  const t: Table = { fail };
  if (tables.size > 8) tables.clear();
  tables.set(key, t);
  return t;
}

/** Slide test: translation only. Tries every junction offset ox (0.01 steps). Returns ox or null. */
function slideOffset(cells: readonly CellId[], course: Course, cols: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of cells) {
    const c = cellCol(id, cols);
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  const uMin = lo * CELL + CELL / 2 - SAMPLE_INSET;
  const width = (hi - lo) * CELL + 2 * SAMPLE_INSET;
  if (width > course.w + EPS) return null;
  const p = course.pillar;
  const pts: number[] = [];
  for (const id of cells) pts.push(...samplePoints(cellCol(id, cols) * CELL, cellRow(id, cols) * CELL));
  for (let k = 0; k * 0.01 <= course.w - width + EPS; k++) {
    const ox = k * 0.01;
    let ok = true;
    for (let i = 0; i < pts.length && ok; i += 2) {
      const x = (pts[i] ?? 0) - uMin + ox;
      const y = pts[i + 1] ?? 0;
      ok = inHallway(x, y, course.w, p) && !approachBlocked(x, y, p) && !exitBlocked(x, y, p);
    }
    if (ok) return Math.round((ox - (CELL / 2 - SAMPLE_INSET)) * 1000) / 1000;
    if (!p) break;
  }
  return null;
}

function phaseOf(code: number): { phase: JamPhase; angle: number } {
  if (code === APPROACH) return { phase: 'approach', angle: 0 };
  if (code === EXIT) return { phase: 'exit', angle: 90 };
  return { phase: 'turn', angle: Math.round(((code - 1) / STEPS) * 90 * 100) / 100 };
}

/**
 * The corner test (spec §5.3 with the motion family above). Assumes `cells` already passed checkShape.
 * Returns pass/fail, area, and for failures the jam point + offending cells of the motion that got furthest.
 */
export function testCells(cells: readonly CellId[], courseIn: Course | number = 1, cols: number = COLS): TestResult {
  const course = asCourse(courseIn);
  const area = areaOf(cells.length);
  if (cells.length === 0) return { pass: false, area: 0, jamAngle: 0, jamPhase: 'approach', jamCells: [], motion: null };
  const ox = slideOffset(cells, course, cols);
  if (ox !== null) return { pass: true, area, motion: { kind: 'slide', ox } };

  const table = tableFor(course);
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of cells) {
    const c = cellCol(id, cols);
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  const rows = cells.map((id) => cellRow(id, cols));
  const colsOf = cells.map((id) => cellCol(id, cols));

  let best: { code: number; count: number; ri: number; fi: number; s: number } | null = null;
  for (let ri = 0; ri < R_VALUES.length; ri++) {
    for (let fi = 0; fi < OFFSETS.length; fi++) {
      const arr = table.fail[ri * OFFSETS.length + fi];
      if (!arr) continue;
      // shift s: bu = s·0.1 + f. Relative index of col c is c − s − EXT_MIN.
      for (let s = lo + EXT_MIN + 1; s <= hi + EXT_MIN + EXT_COLS - 1; s++) {
        let min = NEVER;
        let count = 0;
        for (let j = 0; j < cells.length; j++) {
          const rel = (colsOf[j] ?? 0) - s - EXT_MIN;
          const v = rel < 0 || rel >= EXT_COLS ? 1 : (arr[rel * ROWS + (rows[j] ?? 0)] ?? 1);
          if (v < min) {
            min = v;
            count = 1;
            if (best && min < best.code) break;
          } else if (v === min) count++;
        }
        if (min === NEVER) {
          return { pass: true, area, motion: { kind: 'rotate', r: R_VALUES[ri] ?? 0, bu: s * CELL + (OFFSETS[fi] ?? 0) } };
        }
        if (!best || min > best.code || (min === best.code && count < best.count)) {
          best = { code: min, count, ri, fi, s };
        }
      }
    }
  }
  if (!best) return { pass: false, area, jamAngle: 0, jamPhase: 'approach', jamCells: [...cells], motion: null };
  const motion: Motion = { kind: 'rotate', r: R_VALUES[best.ri] ?? 0, bu: best.s * CELL + (OFFSETS[best.fi] ?? 0) };
  // Recompute offending cells directly with the per-cell check (independent of the table indexing).
  const jamCells: CellId[] = [];
  for (const id of cells) {
    if (failCode(motion, cellCol(id, cols) * CELL, cellRow(id, cols) * CELL, course) === best.code) jamCells.push(id);
  }
  const { phase, angle } = phaseOf(best.code);
  return { pass: false, area, jamAngle: angle, jamPhase: phase, jamCells, motion };
}

/** Validate + test in one call. Invalid shapes are rejected (never "fail the test"). */
export function runTest(
  input: unknown,
  courseIn: Course | number = 1,
  cols: number = COLS,
): { ok: true; result: TestResult; cells: CellId[] } | { ok: false; error: string } {
  const course = asCourse(courseIn);
  const chk = checkShape(input, cols, course.torn);
  if (!chk.ok) return chk;
  return { ok: true, cells: chk.cells, result: testCells(chk.cells, course, cols) };
}

// ---------- Hammersley (tutorial §4, acceptance §5.4) ----------

export const hammersleyArea = (r: number): number => Math.PI / 2 + 2 * r - (Math.PI * r * r) / 2;

/** Closed-form Hammersley sofa with bite radius r centred at u = bu. */
export function insideHammersley(u: number, v: number, r: number, bu: number): boolean {
  if (v < -EPS || v > 1 + EPS) return false;
  const x = u - bu;
  if (Math.abs(x) <= r) return x * x + v * v >= r * r - EPS;
  const d = Math.abs(x) - r;
  return d * d + v * v <= 1 + EPS;
}

/** Rasterise any region onto the grid with the same sample rule as the test (all 5 samples inside). */
export function rasterize(inside: (u: number, v: number) => boolean, cols: number = COLS): CellId[] {
  const out: CellId[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < cols; col++) {
      const pts = samplePoints(col * CELL, row * CELL);
      let ok = true;
      for (let i = 0; i < pts.length && ok; i += 2) ok = inside(pts[i] ?? 0, pts[i + 1] ?? 0);
      if (ok) out.push(cellIdOf(col, row, cols));
    }
  }
  return out;
}

/** Hammersley sofa of bite radius r, centred in a grid of `cols` columns. */
export function hammersleyCells(r: number, cols: number = COLS): CellId[] {
  const bu = Math.round(cols / 2) * CELL;
  return rasterize((u, v) => insideHammersley(u, v, r, bu), cols);
}

// ---------- Par: best possible area for a course (§5.5, intersection method) ----------

export type Par = { area: number; cells: CellId[]; r: number | null };

/**
 * Max passing area under the test for a course: for every motion in the family and every placement in the build box,
 * intersect all hallway positions (cells that never fail), drop torn cells, take the largest 4-connected piece.
 * Returns the winning shape too (it passes the test by construction).
 */
export function parFor(courseIn: Course | number, cols: number = COLS): Par {
  const course = asCourse(courseIn);
  const torn = new Set(course.torn);
  let best: Par = { area: 0, cells: [], r: null };
  const consider = (allowed: CellId[], r: number | null) => {
    if (allowed.length <= best.cells.length) return;
    const piece = biggestPiece(allowed, cols);
    if (piece.length > best.cells.length) best = { area: areaOf(piece.length), cells: piece, r };
  };

  // slide: widest block that slides, at every column start
  const n = Math.min(cols, Math.floor((course.w - 2 * SAMPLE_INSET + EPS) / CELL) + 1);
  for (let c0 = 0; c0 + n <= cols; c0++) {
    const block: CellId[] = [];
    for (let row = 0; row < ROWS; row++) for (let c = c0; c < c0 + n; c++) if (!torn.has(cellIdOf(c, row, cols))) block.push(cellIdOf(c, row, cols));
    const piece = biggestPiece(block, cols);
    if (piece.length > best.cells.length && slideOffset(piece, course, cols) !== null) consider(piece, null);
    if (!course.pillar && torn.size === 0) break; // all placements equal
  }

  // rotate: every motion × every shift of the build box
  const table = tableFor(course);
  for (let ri = 0; ri < R_VALUES.length; ri++) {
    for (let fi = 0; fi < OFFSETS.length; fi++) {
      const arr = table.fail[ri * OFFSETS.length + fi];
      if (!arr) continue;
      for (let s = -EXT_MIN - EXT_COLS + 1; s <= cols - 1 - EXT_MIN; s++) {
        const allowed: CellId[] = [];
        for (let col = 0; col < cols; col++) {
          const rel = col - s - EXT_MIN;
          if (rel < 0 || rel >= EXT_COLS) continue;
          for (let row = 0; row < ROWS; row++) {
            const id = cellIdOf(col, row, cols);
            if (arr[rel * ROWS + row] === NEVER && !torn.has(id)) allowed.push(id);
          }
        }
        consider(allowed, R_VALUES[ri] ?? null);
      }
    }
  }
  return best;
}

/** Backwards-compatible name used by tests: max area for a plain hallway of width w. */
export function maxAreaUnderTest(w: number, cols: number = COLS): { area: number; cells: number; r: number | null } {
  const p = parFor(plainCourse(w), cols);
  return { area: p.area, cells: p.cells.length, r: p.r };
}

// ---------- Hints (heatmap after a test) ----------

export type Hints = {
  /** Shape cells that leave the hallway in the first half of the trip (or on the way in). */
  early: CellId[];
  /** Shape cells that leave later (second half of the turn, or on the way out). */
  late: CellId[];
  /** Empty neighbour cells that would still fit under the passing motion — room to grow. */
  grow: CellId[];
};

/**
 * Heatmap for the build view, from the motion the test reported (the passing one, or the one that got furthest).
 * Only looks at the player's own cells and their direct neighbours — it never reveals the whole safe region.
 */
export function hintsFor(cells: readonly CellId[], result: TestResult, courseIn: Course | number = 1, cols: number = COLS): Hints {
  const course = asCourse(courseIn);
  const m = result.motion;
  const out: Hints = { early: [], late: [], grow: [] };
  if (!m || m.kind !== 'rotate') return out;
  const code = (id: CellId) => failCode(m, cellCol(id, cols) * CELL, cellRow(id, cols) * CELL, course);
  if (!result.pass) {
    const half = 1 + STEPS / 2;
    const fix = fewestBadMotion(cells, course, cols);
    const fixCode = (id: CellId) => (fix ? failCode(fix, cellCol(id, cols) * CELL, cellRow(id, cols) * CELL, course) : code(id));
    for (const id of cells) {
      const c = fixCode(id);
      if (c === NEVER) continue;
      if (c === APPROACH || c <= half) out.early.push(id);
      else out.late.push(id);
    }
    return out;
  }
  const own = new Set(cells);
  const torn = new Set(course.torn);
  const seen = new Set<CellId>();
  for (const id of cells) {
    const col = cellCol(id, cols);
    const nbrs: CellId[] = [];
    if (id - cols >= 0) nbrs.push(id - cols);
    if (id + cols < cols * ROWS) nbrs.push(id + cols);
    if (col > 0) nbrs.push(id - 1);
    if (col < cols - 1) nbrs.push(id + 1);
    for (const n of nbrs) {
      if (own.has(n) || torn.has(n) || seen.has(n)) continue;
      seen.add(n);
      if (code(n) === NEVER) out.grow.push(n);
    }
  }
  return out;
}

/** The rotate motion under which the fewest of these cells fail — the smallest fix. */
function fewestBadMotion(cells: readonly CellId[], course: Course, cols: number): { r: number; bu: number } | null {
  const table = tableFor(course);
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of cells) {
    const c = cellCol(id, cols);
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  let best: { bad: number; ri: number; fi: number; s: number } | null = null;
  for (let ri = 0; ri < R_VALUES.length; ri++) {
    for (let fi = 0; fi < OFFSETS.length; fi++) {
      const arr = table.fail[ri * OFFSETS.length + fi];
      if (!arr) continue;
      for (let s = hi - EXT_MIN - EXT_COLS + 1; s <= lo - EXT_MIN; s++) {
        let bad = 0;
        for (const id of cells) {
          const rel = cellCol(id, cols) - s - EXT_MIN;
          if (rel < 0 || rel >= EXT_COLS || arr[rel * ROWS + cellRow(id, cols)] !== NEVER) bad++;
          if (best && bad >= best.bad) break;
        }
        if (!best || bad < best.bad) best = { bad, ri, fi, s };
      }
    }
  }
  return best ? { r: R_VALUES[best.ri] ?? 0, bu: best.s * CELL + (OFFSETS[best.fi] ?? 0) } : null;
}

/** Mirror column for the carve tool: reflects about the centre of the build box (u = cols·0.05). */
export const mirrorCell = (id: CellId, cols: number = COLS): CellId => cellIdOf(cols - 1 - cellCol(id, cols), cellRow(id, cols), cols);

/** Template for carving: Hammersley sofa with bite r, minus today's torn cells, largest piece. */
export function templateCells(r: number, courseIn: Course | number = 1, cols: number = COLS): CellId[] {
  const torn = new Set(asCourse(courseIn).torn);
  return biggestPiece(hammersleyCells(r, cols).filter((c) => !torn.has(c)), cols);
}
