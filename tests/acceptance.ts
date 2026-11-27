/**
 * Spec §17 acceptance tests. Run: npm test
 * 1 route determinism · 2 base-only reachability · 3 pickup placement · 4–7 vehicle rules · 8 score check (server replay)
 * · 9 biome boundary. (10 is the manual playtest.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyRoute, dailySeed, generateCourse, isSolid } from '../src/shared/course.ts';
import { BOUNDARIES, COLS, FINISH_ROW, ROWS, segmentOf } from '../src/shared/grid.ts';
import { IN, MAX_LOG, MAX_TICKS, TIME_POINTS, computePar, enterRow, nextRow, newRun, queueSteer, replay, score, startRun, stateAt, step, tick, timeScore, vehicleFor } from '../src/shared/sim.ts';
import type { RunState } from '../src/shared/sim.ts';
import { vehicle } from '../src/shared/vehicles.ts';
import { BIOMES } from '../src/shared/biomes.ts';
import { Cell } from '../src/shared/types.ts';
import type { BiomeId, Course } from '../src/shared/types.ts';
import { createApp } from '../src/server/app.ts';
import { decide } from '../src/shared/autopilot.ts';
import { MemoryRedis, fakeReddit } from '../src/server/memory.ts';
import { extendTo, keepAhead, newEndless } from '../src/shared/endless.ts';

const day = (i: number): string => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

/** A blank synthetic track (all Normal) for rule tests. */
function blank(biomes: [BiomeId, BiomeId, BiomeId]): Course {
  return {
    date: 'test',
    seed: 1,
    biomes,
    rows: ROWS,
    cols: COLS,
    cells: new Uint8Array(ROWS * COLS),
    safe: new Int8Array(ROWS).fill(4),
    gateRows: new Map(),
    pickups: [],
    checksum: 0,
  };
}
const put = (c: Course, r: number, l: number, k: number) => {
  c.cells[r * COLS + l] = k;
};
function withPickup(biome: BiomeId, id: string, row: number, lane: number): Course {
  const c = blank([biome, biome, biome]);
  put(c, row, lane, Cell.Pickup);
  c.pickups.push({ row, lane, vehicle: id, segment: segmentOf(row) });
  return c;
}
/** Enter rows until `row`, each with request `req` (default 0). */
function runTo(s: RunState, row: number, req = 0): void {
  while (s.phase === 'run' && s.row < row) enterRow(s, nextRow(s), req);
}

// ---------- 1 ----------
test('1. same date → same route and track; different dates differ', () => {
  for (let i = 0; i < 6; i++) {
    const a = generateCourse(day(i));
    const b = generateCourse(day(i));
    assert.deepEqual(a.biomes, b.biomes);
    assert.equal(a.checksum, b.checksum);
    assert.deepEqual(a.pickups, b.pickups);
    assert.equal(new Set(a.biomes).size, 3, 'three distinct biomes');
  }
  let differ = 0;
  for (let i = 0; i < 6; i++) if (dailyRoute(dailySeed(day(i))).join() !== dailyRoute(dailySeed(day(i + 1))).join()) differ++;
  assert.ok(differ >= 4, `routes differ on ${differ}/6 days`);
});

// ---------- 2 ----------
test('2. base-only reachability: 300 seeds, ≤1 lane change per 2 rows, no Ramp, no pickups', () => {
  const bad: string[] = [];
  for (let i = 0; i < 300; i++) {
    const c = generateCourse(day(i * 7 + 3));
    // state: [lane][cooldown] — cooldown 1 = changed lane on the previous row
    let reach = Array.from({ length: COLS }, (_, l) => [l === c.safe[0], false]);
    for (let r = 1; r <= FINISH_ROW; r++) {
      const next = Array.from({ length: COLS }, () => [false, false]);
      const ok = (l: number) => !isSolid(c.cells[r * COLS + l] ?? 0);
      for (let l = 0; l < COLS; l++)
        for (let cd = 0; cd < 2; cd++) {
          if (!reach[l]?.[cd]) continue;
          if (ok(l)) next[l]![0] = true;
          if (cd === 0)
            for (const d of [-1, 1]) {
              const n = l + d;
              if (n >= 0 && n < COLS && ok(n)) next[n]![1] = true;
            }
        }
      reach = next;
      if (!reach.some((x) => x[0] || x[1])) {
        bad.push(`${c.date}@${r}`);
        break;
      }
    }
  }
  assert.deepEqual(bad, []);
});

// ---------- 3 ----------
/** Breadth-first over real sim states: can the runner get from `from` to the target and survive? */
function reachable(start: RunState, goal: (s: RunState) => boolean, untilRow: number): boolean {
  let frontier: RunState[] = [start];
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const next: RunState[] = [];
    for (const s of frontier) {
      if (goal(s)) return true;
      if (s.row >= untilRow) continue;
      for (const req of [-2, -1, 0, 1, 2]) {
        const t = clone(s);
        enterRow(t, nextRow(t), req);
        if (t.phase !== 'run') continue;
        const key = `${t.row}:${t.lane}:${t.timed}:${t.timedUntil}:${t.lastMove}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(t);
      }
    }
    frontier = next;
  }
  return false;
}
function clone(s: RunState): RunState {
  return { ...s, broken: new Set(s.broken), taken: new Set(s.taken), events: [] };
}

test('3. pickups: 2 per segment, placement rules, reachable from the safe line and back within the window', () => {
  for (let i = 0; i < 300; i++) {
    const c = generateCourse(day(i * 11 + 5));
    for (const seg of [0, 1, 2]) assert.equal(c.pickups.filter((p) => p.segment === seg).length, 2, `${c.date} seg ${seg}`);
    for (const p of c.pickups) {
      const v = vehicle(p.vehicle);
      assert.ok(v.biomes.includes(c.biomes[p.segment]!), `${p.vehicle} belongs to ${c.biomes[p.segment]}`);
      assert.equal(c.cells[p.row * COLS + p.lane], Cell.Pickup, 'pickup cell is not Crash');
      for (const b of BOUNDARIES) assert.ok(Math.abs(p.row - b) >= 8, `${c.date} pickup ${p.row} near boundary`);
      for (const q of c.pickups) if (q !== p) assert.ok(Math.abs(q.row - p.row) >= 5, 'pickups ≥5 rows apart');
      const off = Math.abs(p.lane - (c.safe[p.row] ?? 0));
      assert.ok(off >= 1 && off <= 2, 'pickup is 1–2 lanes off the safe line');
      // from the safe line 12 rows earlier, with the base vehicle, reach the pickup
      const approach = stateAt(c, p.row - 12, c.safe[p.row - 12] ?? 4);
      assert.ok(reachable(approach, (s) => s.row === p.row && s.lane === p.lane && s.timed === p.vehicle, p.row), `${c.date} reach ${p.vehicle}@${p.row}`);
      // after grabbing it, the safe line is reachable again by expiry + 6 rows, alive
      const after = stateAt(c, p.row - 1, p.lane);
      enterRow(after, p.row, 0);
      assert.equal(after.timed, p.vehicle);
      const back = p.row + v.durationRows + 6;
      assert.ok(reachable(after, (s) => s.row >= back - 1 && s.lane === c.safe[s.row], back), `${c.date} return from ${p.vehicle}@${p.row}`);
    }
  }
});

// ---------- 4 ----------
test('4. Helicopter: ignores Crash and Slow for exactly its duration, no Collect/Gate, base again right after', () => {
  const P = 60;
  const D = vehicle('helicopter').durationRows;
  const c = withPickup('snow', 'helicopter', P, 4);
  for (let r = P + 1; r <= P + D - 1; r++) put(c, r, 4, r % 2 ? Cell.Crash : Cell.Slow);
  put(c, P + 3, 4, Cell.Collect);
  put(c, P + 5, 4, Cell.Gate);
  c.gateRows.set(P + 5, 0);
  put(c, P + D, 4, Cell.Crash);
  const s = stateAt(c, P - 1, 4);
  s.combo = 2;
  enterRow(s, P, 0);
  const speed = s.speed;
  runTo(s, P + D - 1);
  assert.equal(s.phase, 'run', 'flies over every crash row while active');
  assert.equal(s.speed, speed, 'slow ignored');
  assert.equal(s.collects, 0, 'no collect');
  assert.equal(s.gates, 0, 'no gate');
  assert.equal(s.combo, 2, 'noGate keeps the combo');
  assert.equal(vehicleFor(s, P + D - 1).id, 'helicopter');
  assert.equal(vehicleFor(s, P + D).id, 'ski', 'the row after expiry is the base vehicle');
  enterRow(s, P + D, 0);
  assert.equal(s.phase, 'crash', 'Crash is deadly again after expiry');
});

// ---------- 5 ----------
test('5. Snowmobile moves 2 lanes in one row; Speedboat cools down after a 2-lane move', () => {
  const c = withPickup('snow', 'snowmobile', 50, 4);
  const s = stateAt(c, 49, 4);
  enterRow(s, 50, 0);
  enterRow(s, 51, 2);
  assert.equal(s.lane, 6);
  const base = stateAt(blank(['snow', 'snow', 'snow']), 49, 4);
  enterRow(base, 50, 2);
  assert.equal(base.lane, 5, 'base vehicle: 1 lane per row');

  const o = withPickup('ocean', 'speedboat', 50, 4);
  const b = stateAt(o, 49, 4);
  enterRow(b, 50, 0);
  enterRow(b, 51, -2);
  assert.equal(b.lane, 2);
  enterRow(b, 52, -2);
  assert.equal(b.lane, 2, 'cooldown row: 0 lane change');
  enterRow(b, 53, 1);
  assert.equal(b.lane, 3, 'free again');
});

// ---------- 6 ----------
test('6. Lava surfboard: lava is Normal for its duration, straight only; Crash again after expiry', () => {
  const P = 60;
  const D = vehicle('lavasurf').durationRows;
  const c = withPickup('volcano', 'lavasurf', P, 3);
  for (let r = P + 1; r <= P + D + 2; r++) put(c, r, 3, Cell.Crash);
  const s = stateAt(c, P - 1, 3);
  enterRow(s, P, 0);
  for (let r = P + 1; r <= P + D - 1; r++) {
    enterRow(s, r, r % 2 ? 1 : -1);
    assert.equal(s.lane, 3, 'no lane change while active');
    assert.equal(s.phase, 'run', `lava row ${r} is Normal`);
  }
  enterRow(s, P + D, 0);
  assert.equal(s.phase, 'crash', 'lava is Crash after expiry');
});

// ---------- 7 ----------
test('7. Rocket backpack: skips 2 rows per step, skipped rows score nothing, landing row 0 lane change', () => {
  const P = 120;
  const c = withPickup('space', 'rocket', P, 4);
  put(c, P + 1, 4, Cell.Crash);
  put(c, P + 2, 4, Cell.Crash);
  put(c, P + 4, 4, Cell.Collect);
  put(c, P + 5, 4, Cell.Crash);
  const s = stateAt(c, P - 1, 4);
  enterRow(s, P, 0);
  const rows0 = s.rowsScored;
  assert.equal(nextRow(s), P + 3, 'skips P+1, P+2');
  enterRow(s, nextRow(s), 1);
  assert.equal(s.row, P + 3);
  assert.equal(s.lane, 4, 'landing row: 0 lane change');
  assert.equal(nextRow(s), P + 6);
  enterRow(s, nextRow(s), 0);
  assert.equal(s.phase, 'run', 'skipped crash cells never resolve');
  assert.equal(s.collects, 0, 'skipped collect gives nothing');
  assert.equal(s.rowsScored - rows0, 2, 'only the two landing rows score');
  const D = vehicle('rocket').durationRows;
  assert.equal(vehicleFor(s, P + D - 1).id, 'rocket');
  assert.equal(vehicleFor(s, P + D).id, 'rover', 'back to base after its duration');
  while (s.row < P + D && s.phase === 'run') enterRow(s, nextRow(s), 0);
  assert.equal(nextRow(s), s.row + 1, 'normal steps again');
});

// ---------- 8 ----------
test('8. score check: the server replays the inputs; a fabricated score or a forged log is rejected, no write', async () => {
  const redis = new MemoryRedis(null);
  const date = '2026-11-22';
  const app = createApp({
    redis,
    reddit: fakeReddit(() => undefined),
    ctx: () => ({ userId: 't2_cheater', username: async () => 'cheater', postId: 't3_x', subredditName: 'sub', date }),
  });
  const today = (await (await app.request('/api/today')).json()) as { parSeconds: number };
  const course = generateCourse(date);
  // a real run (autopilot, holding Tuck), recorded tick by tick as the client does
  const s = newRun(course, today.parSeconds);
  startRun(s);
  while (s.phase === 'run' && s.tick < MAX_TICKS) {
    tick(s, s.tick === 0 ? [IN.fastOn] : [], decide);
    s.events.length = 0;
  }
  assert.equal(s.phase, 'finish');
  const real = score(s).total;
  // the replay is exact: same score, time and row from the inputs alone
  const r = replay(course, today.parSeconds, s.log);
  assert.ok(r);
  assert.deepEqual([score(r).total, r.time, r.row, r.lane], [real, s.time, s.row, s.lane]);

  // the same run as a player would send it: each autopilot lane request becomes that many left/right presses
  const asPlayer = (log: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < log.length; i += 2) {
      const [t, code] = [log[i] ?? 0, log[i + 1] ?? 0];
      if (code <= IN.brakeOff) out.push(t, code);
      else for (let n = 0; n < Math.abs(code - 8); n++) out.push(t, code < 8 ? IN.left : IN.right);
    }
    return out;
  };
  const player = asPlayer(s.log);
  const rp = replay(course, today.parSeconds, player);
  assert.ok(rp && score(rp).total === real, 'player-style log replays to the same run');

  const post = (o: unknown) => app.request('/api/run', { method: 'POST', body: JSON.stringify(o), headers: { 'Content-Type': 'application/json' } });
  const total = async () => ((await (await app.request(`/api/leaderboard?date=${date}`)).json()) as { total: number }).total;
  assert.equal((await post({ score: real, seedCheck: course.checksum, inputs: s.log })).status, 400, 'autopilot inputs are refused');
  assert.equal((await post({ score: real + 1, seedCheck: course.checksum, inputs: player })).status, 400, 'claimed more than the replay');
  for (const inputs of [[1], [5, 0, 3, 0], [0, 99], [0.5, 0], 'x', new Array(MAX_LOG + 2).fill(0)])
    assert.equal((await post({ score: real, seedCheck: course.checksum, inputs })).status, 400, `inputs ${JSON.stringify(inputs).slice(0, 30)}`);
  assert.equal((await post({ score: -1, seedCheck: course.checksum, inputs: player })).status, 400);
  assert.equal((await post({ score: real, seedCheck: course.checksum + 1, inputs: player })).status, 409, 'wrong track');
  assert.equal(await total(), 0, 'leaderboard unchanged');

  const ok = await post({ score: real, seedCheck: course.checksum, inputs: player });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { score: number }).score, real);
  assert.equal(await total(), 1);
  // the share comment: Wordle-style summary of the verified best run
  const shared = (await (await app.request('/api/share', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).json()) as { text: string };
  console.log(shared.text);
  assert.match(shared.text, /✅ → .*✅ → .*✅/u);
  assert.match(shared.text, /#1 of 1 today/);
});

// ---------- 9 ----------
test('9. biome boundary: the first row of each segment swaps the base vehicle and raises the banner, no pause, input kept', () => {
  const c = blank(['snow', 'ocean', 'city']);
  const s = newRun(c, computePar());
  startRun(s);
  const [B1, B2] = BOUNDARIES;
  s.pos = B1 - 3;
  s.row = B1 - 3;
  s.speed = 12;
  queueSteer(s, -1);
  queueSteer(s, -1);
  queueSteer(s, -1);
  for (let i = 0; i < 40 && s.row < B1 + 3; i++) step(s, 1 / 60, { fast: false, brake: false });
  assert.equal(s.phase, 'run', 'no pause');
  assert.equal(vehicleFor(s, B1 - 1).id, BIOMES.snow.base);
  assert.equal(vehicleFor(s, B1).id, BIOMES.ocean.base);
  assert.ok(s.events.some((e) => e.kind === 'biome' && e.row === B1 && e.vehicle === 'jetski'), 'banner event at the first boundary');
  assert.equal(s.lane, 4 - 2, 'queued input still applied across the boundary (2 queued max)');
  s.row = B2 - 3;
  s.pos = B2 - 3;
  for (let i = 0; i < 40 && s.row < B2 + 1; i++) step(s, 1 / 60, { fast: false, brake: false });
  assert.ok(s.events.some((e) => e.kind === 'biome' && e.row === B2 && e.vehicle === 'skateboard'));
});

test('par time comes from the sim and is stable', () => {
  const a = computePar();
  assert.equal(a, computePar());
  assert.ok(a > 40 && a < 120, `par ${a}s`);
});

// ---------- time score (only for finishing; faster = more) ----------
test('time score: only on finishing, faster always scores more, braking to a safe finish scores far less', () => {
  const run = (input: { fast: boolean; brake: boolean }) => {
    const s = newRun(blank(['snow', 'ocean', 'city']), computePar());
    startRun(s);
    for (let i = 0; i < 60 * 400 && s.phase === 'run'; i++) step(s, 1 / 60, input);
    return s;
  };
  const brake = run({ fast: false, brake: true });
  const cruise = run({ fast: false, brake: false });
  const tuck = run({ fast: true, brake: false });
  for (const s of [brake, cruise, tuck]) assert.equal(s.phase, 'finish');
  assert.ok(tuck.time < cruise.time && cruise.time < brake.time);
  assert.ok(score(tuck).finish > score(cruise).finish && score(cruise).finish > score(brake).finish, 'shorter time → more points');
  assert.equal(score(cruise).finish, timeScore(cruise.time, cruise.parSeconds));
  assert.ok(Math.abs(score(cruise).finish - TIME_POINTS) < 60, 'cruising ≈ par ≈ TIME_POINTS');
  // the gap must outweigh what extra care can earn elsewhere (all gates at ×3 on a normal day is ~1500)
  assert.ok(score(tuck).total - score(brake).total > 2000, `tuck ${score(tuck).total} vs brake ${score(brake).total}`);
  // a crash gets no time score at all
  const c = blank(['snow', 'ocean', 'city']);
  put(c, 100, 4, Cell.Crash);
  const s = newRun(c, computePar());
  startRun(s);
  for (let i = 0; i < 60 * 60 && s.phase === 'run'; i++) step(s, 1 / 60, { fast: false, brake: false });
  assert.equal(s.phase, 'crash');
  assert.equal(score(s).finish, 0);
});

// ---------- autopilot: whole runs can be completed (the full sweep is `npm run autotest`) ----------
test('autopilot finishes whole daily runs (5 days, holding Tuck)', () => {
  for (let i = 0; i < 5; i++) {
    const c = generateCourse(day(i * 37 + 11));
    const s = newRun(c, computePar());
    startRun(s);
    for (let f = 0; f < 60 * 300 && s.phase === 'run'; f++) {
      step(s, 1 / 60, { fast: true, brake: false }, decide);
      s.events.length = 0;
    }
    assert.equal(s.phase, 'finish', `${c.date}: ${s.phase} at row ${s.row}`);
    assert.ok(score(s).finish > TIME_POINTS, 'faster than par');
  }
});

// ---------- endless mode ----------
test('endless: legs join without a finish line, the track is the same per date, and the autopilot gets through 4 legs', () => {
  const a = newEndless('2026-11-23');
  const b = newEndless('2026-11-23');
  extendTo(a, ROWS * 4);
  extendTo(b, ROWS * 4);
  assert.ok(a.rows > ROWS * 4 && a.biomes.length === (a.rows / ROWS) * 3);
  assert.deepEqual(a.cells, b.cells, 'same date → same endless track');
  assert.ok(!a.cells.includes(Cell.Finish), 'no finish line anywhere');
  for (let k = 1; k < a.biomes.length; k++) assert.notEqual(a.biomes[k], a.biomes[k - 1], 'no biome twice in a row');
  const s = newRun(a, computePar());
  startRun(s);
  while (s.phase === 'run' && s.row < ROWS * 4) {
    keepAhead(s);
    tick(s, s.tick === 0 ? [IN.fastOn] : [], decide);
    s.events.length = 0;
  }
  assert.equal(s.phase, 'run', `crashed at row ${s.row}`);
  assert.ok(s.broken.size + s.taken.size < 400, 'cells far behind are forgotten');
});

test('endless leaderboard: the server replays the run on the endless track, ranks the distance, refuses fakes', async () => {
  const redis = new MemoryRedis(null);
  const date = '2026-11-26';
  const app = createApp({
    redis,
    reddit: fakeReddit(() => undefined),
    ctx: () => ({ userId: 't2_runner', username: async () => 'runner', postId: 't3_x', subredditName: 'sub', date }),
  });
  // a real endless run: hold Tuck, never steer → it crashes somewhere in the first leg
  const s = newRun(newEndless(date), computePar());
  startRun(s);
  while (s.phase === 'run') {
    keepAhead(s);
    tick(s, s.tick === 0 ? [IN.fastOn] : []);
    s.events.length = 0;
  }
  assert.equal(s.phase, 'crash');
  const post = (o: unknown) => app.request('/api/endless', { method: 'POST', body: JSON.stringify(o), headers: { 'Content-Type': 'application/json' } });
  assert.equal((await post({ rows: s.row + 50, inputs: s.log })).status, 400, 'claimed further than the replay');
  assert.equal((await post({ rows: s.row, inputs: [0, 9] })).status, 400, 'autopilot inputs refused');
  assert.equal((await post({ rows: s.row, inputs: 'x' })).status, 400);
  const ok = await post({ rows: s.row, inputs: s.log });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { rows: s.row, best: s.row, rank: 1, improved: true });
  const lb = (await (await app.request(`/api/endless-leaderboard?date=${date}`)).json()) as { total: number; top: { score: number }[] };
  assert.equal(lb.total, 1);
  assert.equal(lb.top[0]?.score, s.row);
  const today = (await (await app.request('/api/today')).json()) as { myEndlessBest: number | null };
  assert.equal(today.myEndlessBest, s.row);
  // the daily board is separate
  assert.equal(((await (await app.request(`/api/leaderboard?date=${date}`)).json()) as { total: number }).total, 0);
});
