/**
 * Movement, cell resolution and scoring (spec §3, §4, §7, §8, §10). No rendering. Imported by the client (live run)
 * and the server (replay). Rules resolve only when the runner enters a row; time only moves the runner forward.
 *
 * Live runs move in fixed ticks (`tick`, 1/120 s) and record every input in `s.log`, so the server can replay the run
 * from its inputs alone (`replay`) and score it itself. The sim uses only + − × ÷ and min/max, so the replay gives the
 * same result in every JS engine.
 */
import { BIOMES } from './biomes.ts';
import { COLS, FINISH_ROW, cellAt, cellKey, segmentOf } from './grid.ts';
import { vehicle } from './vehicles.ts';
import { Cell } from './types.ts';
import type { Course, Phase, ScoreParts, VehicleDef, VehicleId } from './types.ts';

export const AIR_ROWS = 5;
const START_ROW = 0;
const MIN_SPEED = 3;
const MAX_SPEED = 17;
/** Fast cells can push past MAX_SPEED up to this. */
const SPEED_CAP = 20;
const START_SPEED = 5;
/** 1 row ≈ 2 m. */
export const METERS_PER_ROW = 2;

export type GameEvent = {
  kind: 'gate' | 'missed' | 'pole' | 'collect' | 'air' | 'break' | 'pickup' | 'expire' | 'biome' | 'crash' | 'finish' | 'slow' | 'fast';
  row: number;
  lane: number;
  points: number;
  vehicle?: VehicleId;
};

export type RunState = {
  course: Course;
  phase: Phase;
  /** Last row entered. */
  row: number;
  lane: number;
  timed: VehicleId | null;
  /** First row at which the timed vehicle is gone. */
  timedUntil: number;
  /** Lane delta of the last row entered (turnCooldown). */
  lastMove: number;
  /** Rows ≤ airUntil are airborne (Ramp). */
  airUntil: number;
  combo: number;
  gates: number;
  missed: number;
  gatePoints: number;
  collects: number;
  airs: number;
  airPoints: number;
  breaks: number;
  rowsScored: number;
  finishBonus: number;
  time: number;
  broken: Set<number>;
  taken: Set<number>;
  events: GameEvent[];
  // continuous part
  pos: number;
  speed: number;
  /** Queued lateral move (lanes), consumed on entering the next row. */
  pending: number;
  parSeconds: number;
  /** Fixed ticks run so far, the held Tuck/Brake state, and the input log ([tick, code] pairs; see `tick`). */
  tick: number;
  held: Input;
  log: number[];
};

type Input = { fast: boolean; brake: boolean };

export function newRun(course: Course, parSeconds: number): RunState {
  return {
    course,
    phase: 'ready',
    row: START_ROW,
    lane: course.safe[START_ROW] ?? 4,
    timed: null,
    timedUntil: 0,
    lastMove: 0,
    airUntil: -1,
    combo: 0,
    gates: 0,
    missed: 0,
    gatePoints: 0,
    collects: 0,
    airs: 0,
    airPoints: 0,
    breaks: 0,
    rowsScored: 0,
    finishBonus: 0,
    time: 0,
    broken: new Set(),
    taken: new Set(),
    events: [],
    pos: START_ROW,
    speed: 0,
    pending: 0,
    parSeconds,
    tick: 0,
    held: { fast: false, brake: false },
    log: [],
  };
}

export function startRun(s: RunState): void {
  if (s.phase !== 'ready') return;
  s.phase = 'run';
  s.speed = START_SPEED;
}

function pickupAt(course: Course, row: number, lane: number): VehicleId | undefined {
  return course.pickups.find((p) => p.row === row && p.lane === lane)?.vehicle;
}

const baseVehicleAt = (course: Course, row: number): VehicleDef => vehicle(BIOMES[course.biomes[segmentOf(row)]].base);

/** The vehicle in charge when entering `row`. */
export function vehicleFor(s: RunState, row: number): VehicleDef {
  if (s.timed !== null && row < s.timedUntil) return vehicle(s.timed);
  return baseVehicleAt(s.course, row);
}

const isAirborne = (s: RunState, row: number = s.row): boolean => row <= s.airUntil;

/** The cell as this run sees it (broken Crash cells are Normal; taken Collect/Pickup cells are Normal). */
export function cellFor(s: RunState, row: number, lane: number): number {
  const k = cellAt(s.course, row, lane);
  const key = cellKey(row, lane);
  if (k === Cell.Crash && s.broken.has(key)) return Cell.Normal;
  if ((k === Cell.Collect || k === Cell.Pickup) && s.taken.has(key)) return Cell.Normal;
  return k;
}

/** The next row this run will enter (rocket-type vehicles skip `jumpRows`). */
export function nextRow(s: RunState): number {
  const v = vehicleFor(s, s.row);
  const step = s.row < s.timedUntil && s.timed !== null ? 1 + v.jumpRows : 1;
  return Math.min(FINISH_ROW, s.row + step);
}

/** Largest lane change allowed when entering `row` (0 also means queued input is dropped). */
export function maxLanesFor(s: RunState, row: number): number {
  const v = vehicleFor(s, row);
  if (v.straightOnly) return 0;
  if (v.turnCooldown && Math.abs(s.lastMove) >= 2) return 0;
  if (row - s.row > 1) return 0; // landing after a skip
  return v.lanesPerRow;
}

function emit(s: RunState, kind: GameEvent['kind'], points = 0, extra?: Partial<GameEvent>): void {
  s.events.push({ kind, row: s.row, lane: s.lane, points, ...extra });
}

function crash(s: RunState): void {
  s.phase = 'crash';
  s.combo = 0;
  s.speed = 0;
  emit(s, 'crash');
}

/** A Crash cell at (row, lane): ignored, broken (+5) or the end of the run. Returns true if the run is over. */
function hitCrash(s: RunState, v: VehicleDef, row: number, lane: number): boolean {
  if (v.ignoreCrash) return false;
  if (v.breakCrash) {
    s.broken.add(cellKey(row, lane));
    s.breaks++;
    emit(s, 'break', 5);
    return false;
  }
  crash(s);
  return true;
}

/** Enter `row` with a requested lateral move. All per-cell rules live here. */
export function enterRow(s: RunState, row: number, request: number): void {
  if (s.phase !== 'run') return;
  const prevSeg = segmentOf(s.row);
  if (s.timed !== null && row >= s.timedUntil) {
    emit(s, 'expire', 0, { vehicle: s.timed });
    s.timed = null;
  }
  const v = vehicleFor(s, row);
  const max = maxLanesFor(s, row);
  const air = isAirborne(s, row);
  let delta = Math.max(-max, Math.min(max, request));
  delta = Math.max(-s.lane, Math.min(COLS - 1 - s.lane, delta));
  const from = s.lane;
  s.row = row;
  s.rowsScored++;
  if (segmentOf(row) !== prevSeg) emit(s, 'biome', 0, { vehicle: v.id });

  // moving sideways through a Crash cell in the new row counts as hitting it
  if (!air && delta !== 0) {
    const dir = Math.sign(delta);
    for (let l = from + dir; l !== from + delta; l += dir) {
      s.lane = l;
      if (cellFor(s, row, l) === Cell.Crash && hitCrash(s, v, row, l)) return;
    }
  }
  s.lane = from + delta;
  s.lastMove = delta;

  if (row >= FINISH_ROW) {
    finish(s);
    return;
  }
  if (air) return;

  const k = cellFor(s, row, s.lane);
  if (k === Cell.Crash && hitCrash(s, v, row, s.lane)) return;

  if (s.course.gateRows.has(row)) {
    if (v.noGate) return; // no score, combo untouched
    if (k === Cell.Gate) {
      s.gates++;
      s.combo++;
      const pts = 30 * Math.min(3, s.combo);
      s.gatePoints += pts;
      emit(s, 'gate', pts);
    } else {
      s.missed++;
      s.combo = 0;
      if (k === Cell.Pole) {
        s.speed *= 0.55;
        emit(s, 'pole');
      } else emit(s, 'missed');
    }
    return;
  }

  switch (k) {
    case Cell.Slow:
      if (!v.ignoreSlow) {
        s.speed *= 0.72;
        emit(s, 'slow');
      }
      return;
    case Cell.Fast:
      s.speed = Math.min(SPEED_CAP, s.speed + 2.5);
      emit(s, 'fast');
      return;
    case Cell.Collect:
      if (!v.noCollect) {
        s.taken.add(cellKey(row, s.lane));
        s.collects++;
        emit(s, 'collect', 10);
      }
      return;
    case Cell.Ramp:
      if (!v.noRamp) {
        s.airUntil = row + AIR_ROWS;
        s.airs++;
        const pts = 20 * v.rampBonus;
        s.airPoints += pts;
        emit(s, 'air', pts);
      }
      return;
    case Cell.Pickup: {
      const id = pickupAt(s.course, row, s.lane);
      if (id === undefined) return;
      s.taken.add(cellKey(row, s.lane));
      s.timed = id; // replaces any active timed vehicle, duration reset, no stacking
      s.timedUntil = row + vehicle(id).durationRows;
      s.lastMove = 0;
      emit(s, 'pickup', 0, { vehicle: id });
      return;
    }
  }
}

/** Time score at par. Finishing in half the par time doubles it; taking three times as long gives a third. */
export const TIME_POINTS = 3000;

/**
 * Time score, only for finishing the whole track: TIME_POINTS × par / your time. Shorter time → more points, with no
 * cap or floor to game; a crash scores none. It dominates the other points, so riding the brakes to a safe finish
 * scores far below a fast, risky one.
 */
export function timeScore(time: number, par: number): number {
  return time > 0 ? Math.round((TIME_POINTS * par) / time) : 0;
}

function finish(s: RunState): void {
  s.phase = 'finish';
  s.finishBonus = timeScore(s.time, s.parSeconds);
  emit(s, 'finish', s.finishBonus);
}

export function score(s: RunState): ScoreParts {
  const parts = {
    rows: s.rowsScored,
    gates: s.gatePoints,
    collect: s.collects * 10,
    air: s.airPoints,
    breaks: s.breaks * 5,
    finish: s.finishBonus,
  };
  return { ...parts, total: parts.rows + parts.gates + parts.collect + parts.air + parts.breaks + parts.finish };
}

/** Can the player use Tuck / Brake right now (not airborne, not in a straight-only vehicle)? */
export function canControlSpeed(s: RunState): boolean {
  return !isAirborne(s) && !vehicleFor(s, s.row).straightOnly;
}

const cruiseAt = (pos: number): number => 7 + 5 * Math.min(1, pos / FINISH_ROW);

function advanceSpeed(speed: number, pos: number, dt: number, fast: boolean, brake: boolean): number {
  const cruise = cruiseAt(pos);
  const target = brake ? MIN_SPEED : fast ? MAX_SPEED : cruise;
  const rate = brake ? 2.8 : target > speed ? 0.9 : 0.5;
  return speed + (target - speed) * Math.min(1, rate * dt);
}

/**
 * Advance the run by dt seconds, entering every row the runner reaches. `pilot`, if given, chooses the lane request
 * for each row just before it is entered (autopilot); otherwise the queued player input is used.
 */
export function step(s: RunState, dt: number, input: Input, pilot?: (s: RunState, row: number) => number): void {
  if (s.phase !== 'run') return;
  dt = Math.min(dt, 0.05);
  s.time += dt;
  const control = canControlSpeed(s);
  s.speed = advanceSpeed(s.speed, s.pos, dt, control && input.fast && !input.brake, control && input.brake);
  s.pos += s.speed * dt;
  let guard = 0;
  while (s.phase === 'run' && guard++ < 8) {
    const r = nextRow(s);
    if (s.pos < r) break;
    const max = maxLanesFor(s, r);
    if (pilot) s.pending = pilot(s, r);
    const req = Math.max(-max, Math.min(max, s.pending));
    s.pending = max === 0 || pilot ? 0 : s.pending - req;
    enterRow(s, r, req);
  }
  if (s.phase !== 'run') s.pos = Math.min(s.pos, s.row + 0.2);
}

/** Queue a lane change (keyboard/touch). Up to 2 lanes can be queued ahead. */
export function queueSteer(s: RunState, dir: -1 | 1): void {
  if (s.phase !== 'run') return;
  s.pending = Math.max(-2, Math.min(2, s.pending + dir));
}

// ---------- fixed ticks, input log, replay ----------

export const TICK = 1 / 120;
/** Longest run the server will replay (10 minutes; braking all the way takes ~2.5). */
export const MAX_TICKS = 120 * 600;
/** Longest input log the server accepts (numbers, i.e. 2 per input). */
export const MAX_LOG = 40_000;
/** Input codes: 0/1 lane left/right, 2/3 Tuck on/off, 4/5 Brake on/off, 6–10 autopilot lane request −2…+2. */
export const IN = { left: 0, right: 1, fastOn: 2, fastOff: 3, brakeOn: 4, brakeOff: 5 } as const;
const PILOT = 8;

function applyInput(s: RunState, code: number): void {
  if (code === IN.left || code === IN.right) queueSteer(s, code === IN.left ? -1 : 1);
  else if (code === IN.fastOn || code === IN.fastOff) s.held.fast = code === IN.fastOn;
  else if (code === IN.brakeOn || code === IN.brakeOff) s.held.brake = code === IN.brakeOn;
  else s.pending = code - PILOT;
}

/** Codes that bring the held Tuck/Brake state to the wanted one (empty when nothing changed). */
export function heldCodes(s: RunState, fast: boolean, brake: boolean): number[] {
  const out: number[] = [];
  if (fast !== s.held.fast) out.push(fast ? IN.fastOn : IN.fastOff);
  if (brake !== s.held.brake) out.push(brake ? IN.brakeOn : IN.brakeOff);
  return out;
}

/**
 * One fixed tick of a live run: apply and record `codes`, then advance TICK seconds. A pilot's lane requests are
 * recorded as codes too, so autopilot runs replay without the pilot.
 */
export function tick(s: RunState, codes: readonly number[], pilot?: (s: RunState, row: number) => number): void {
  if (s.phase !== 'run') return;
  for (const code of codes) {
    s.log.push(s.tick, code);
    applyInput(s, code);
  }
  const rec = pilot
    ? (st: RunState, row: number) => {
        const max = maxLanesFor(st, row);
        const v = Math.max(-max, Math.min(max, pilot(st, row)));
        st.log.push(st.tick, PILOT + v);
        return v;
      }
    : undefined;
  step(s, TICK, s.held, rec);
  s.tick++;
}

/** The input log is well formed: [tick, code] pairs, ticks in order and in range, known codes. */
function validLog(log: unknown): log is number[] {
  if (!Array.isArray(log) || log.length % 2 !== 0 || log.length > MAX_LOG) return false;
  let last = 0;
  for (let i = 0; i < log.length; i += 2) {
    const t: unknown = log[i];
    const code: unknown = log[i + 1];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < last || t >= MAX_TICKS) return false;
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > PILOT + 2) return false;
    last = t;
  }
  return true;
}

/** Rerun a whole run from its input log (server side). null if the log is malformed or the run never ends. */
export function replay(course: Course, parSeconds: number, log: unknown): RunState | null {
  if (!validLog(log)) return null;
  const s = newRun(course, parSeconds);
  startRun(s);
  let i = 0;
  const codes: number[] = [];
  while (s.phase === 'run' && s.tick < MAX_TICKS) {
    codes.length = 0;
    while (i < log.length && log[i] === s.tick) {
      codes.push(log[i + 1] ?? 0);
      i += 2;
    }
    tick(s, codes);
    s.events.length = 0;
  }
  return s.phase === 'run' ? null : s;
}

/**
 * Par time: the whole track at cruise speed, no Tuck/Brake, no cells (spec §10). Computed by the same speed model as the
 * live run, at a fixed 60 Hz step. Never hand-written.
 */
export function computePar(): number {
  let pos = START_ROW;
  let speed = START_SPEED;
  let t = 0;
  const dt = 1 / 60;
  while (pos < FINISH_ROW) {
    speed = advanceSpeed(speed, pos, dt, false, false);
    pos += speed * dt;
    t += dt;
  }
  return Math.round(t * 10) / 10;
}

/** A run state placed at an arbitrary row/lane, already running (for probes and tests). */
export function stateAt(course: Course, row: number, lane: number, parSeconds = 60): RunState {
  const s = newRun(course, parSeconds);
  s.phase = 'run';
  s.row = row;
  s.lane = lane;
  s.pos = row;
  s.speed = 10;
  return s;
}
