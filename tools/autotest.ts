/**
 * Auto-play tracks start to finish with the autopilot, using the real rules at 60 Hz, and report whether every run
 * completes, plus coverage: every biome in every segment position, every timed vehicle offered / picked up / driven.
 * Exit code 1 if any run fails (usable in CI).
 *
 *   npm run autotest                                   60 daily tracks from today (UTC), holding Tuck
 *   npm run autotest -- --days 200 --from 2026-01-01   more days
 *   npm run autotest -- --all-routes                   all 336 biome routes (8 × 7 × 6), one track each
 *   npm run autotest -- --grab                         go out of the way for pickups (drives every vehicle)
 *   npm run autotest -- --cruise                       no Tuck
 */
import { decide, makePilot } from '../src/shared/autopilot.ts';
import { dailyRoute, dailySeed, generateCourse } from '../src/shared/course.ts';
import { FINISH_ROW, cellAt, segmentOf } from '../src/shared/grid.ts';
import { utcDate } from '../src/shared/rng.ts';
import { IN, MAX_TICKS, computePar, newRun, replay, score, startRun, tick, vehicleFor } from '../src/shared/sim.ts';
import { BIOMES } from '../src/shared/biomes.ts';
import { VEHICLE_LIST } from '../src/shared/vehicles.ts';
import { BIOME_IDS, Cell } from '../src/shared/types.ts';
import type { BiomeId } from '../src/shared/types.ts';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const flag = (name: string) => args.includes(`--${name}`);
const from = arg('from', utcDate());
const fast = !flag('cruise');
const grab = flag('grab');
const allRoutes = flag('all-routes');
const pilot = grab ? makePilot({ pickupBonus: 80 }) : decide;

const CELL_NAMES = Object.fromEntries(Object.entries(Cell).map(([k, v]) => [v, k])) as Record<number, string>;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// the runs: daily routes, or every ordered triple of distinct biomes (each on its own date's track)
type Job = { date: string; biomes: [BiomeId, BiomeId, BiomeId] };
const jobs: Job[] = [];
if (allRoutes) {
  let i = 0;
  for (const a of BIOME_IDS) for (const b of BIOME_IDS) for (const c of BIOME_IDS) if (a !== b && b !== c && a !== c) jobs.push({ date: addDays(from, i++), biomes: [a, b, c] });
} else {
  const days = Number(arg('days', '60'));
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    jobs.push({ date, biomes: dailyRoute(dailySeed(date)) });
  }
}
const quiet = jobs.length > 60 && !flag('verbose');

type Row = { date: string; route: string; ok: boolean; time: number; total: number; timeScore: number; gates: string; pickups: string[]; why: string; ms: number };
const rows: Row[] = [];
const par = computePar();
// coverage
const byPos: Record<string, [number, number]> = {}; // "biome@seg" → [runs, finished]
const veh: Record<string, { offered: number; taken: number; rowsDriven: number; crashedIn: number }> = {};
for (const v of VEHICLE_LIST) if (!v.base) veh[v.id] = { offered: 0, taken: 0, rowsDriven: 0, crashedIn: 0 };

const replayMismatch: string[] = [];
for (const job of jobs) {
  const course = generateCourse(job.date, job.biomes);
  for (const p of course.pickups) {
    const v = veh[p.vehicle];
    if (v) v.offered++;
  }
  const s = newRun(course, par);
  startRun(s);
  const t0 = performance.now();
  const taken: string[] = [];
  // the same fixed ticks and input log as the game
  while (s.phase === 'run' && s.tick < MAX_TICKS) {
    const before = s.row;
    tick(s, s.tick === 0 && fast ? [IN.fastOn] : [], pilot);
    if (s.timed !== null && s.row < s.timedUntil) {
      const v = veh[s.timed];
      if (v) v.rowsDriven += s.row - before;
    }
    for (const e of s.events)
      if (e.kind === 'pickup' && e.vehicle) {
        taken.push(e.vehicle);
        const v = veh[e.vehicle];
        if (v) v.taken++;
      }
    s.events.length = 0;
  }
  const ms = performance.now() - t0;
  // the server would score this run by replaying its inputs: it must come out identical
  const rep = replay(course, par, s.log);
  if (!rep || score(rep).total !== score(s).total || rep.time !== s.time || rep.phase !== s.phase) replayMismatch.push(`${job.date} ${job.biomes.join('/')}`);
  const sc = score(s);
  let why = '';
  if (s.phase === 'crash') {
    const k = cellAt(course, s.row, s.lane);
    const b = BIOMES[course.biomes[segmentOf(s.row)]];
    const driving = vehicleFor(s, s.row);
    if (!driving.base) {
      const v = veh[driving.id];
      if (v) v.crashedIn++;
    }
    why = `crash row ${s.row} lane ${s.lane}: ${CELL_NAMES[k] ?? k} (${b.cells.crash}) on ${driving.name}`;
  } else if (s.phase !== 'finish') why = `stuck at row ${s.row}/${FINISH_ROW} (${s.phase})`;
  course.biomes.forEach((b, i) => {
    const key = `${b}@${i + 1}`;
    const c = (byPos[key] ??= [0, 0]);
    c[0]++;
    if (s.phase === 'finish') c[1]++;
  });
  rows.push({
    date: job.date,
    route: course.biomes.map((b) => BIOMES[b].name).join('→'),
    ok: s.phase === 'finish',
    time: s.time,
    total: sc.total,
    timeScore: sc.finish,
    gates: `${s.gates}/${course.gateRows.size}`,
    pickups: taken,
    why,
    ms,
  });
}

const mode = `${allRoutes ? `all ${jobs.length} routes` : `${jobs.length} daily tracks`} from ${from}, ${fast ? 'holding Tuck' : 'cruise (no Tuck)'}${grab ? ', going for pickups' : ''}, par ${par} s`;
console.log(`autotest: ${mode}\n`);
if (!quiet) console.log('date        route                      result   time    score  time pts  gates  pickups');
for (const r of rows) {
  if (quiet && r.ok) continue;
  console.log(
    `${r.date}  ${r.route.padEnd(26)} ${r.ok ? 'finish ' : 'FAIL   '} ${r.ok ? `${r.time.toFixed(1)}s`.padStart(6) : '     -'} ${String(r.total).padStart(7)} ${String(r.timeScore).padStart(8)}  ${r.gates.padStart(5)}  ${r.pickups.join(',') || '-'}${r.why ? `   ← ${r.why}` : ''}`,
  );
}
const ok = rows.filter((r) => r.ok);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log('\nbiome × segment position (finished/runs):');
for (const b of BIOME_IDS) {
  const cells = [1, 2, 3].map((i) => {
    const c = byPos[`${b}@${i}`];
    return c ? `${c[1]}/${c[0]}`.padStart(7) : '      -';
  });
  console.log(`  ${BIOMES[b].name.padEnd(9)} ${cells.join('  ')}`);
}
console.log('\ntimed vehicles (offered · picked up · rows driven · runs that crashed while driving it):');
for (const v of VEHICLE_LIST) {
  if (v.base) continue;
  const c = veh[v.id];
  if (!c) continue;
  console.log(`  ${v.name.padEnd(16)} ${String(c.offered).padStart(5)} · ${String(c.taken).padStart(4)} · ${String(c.rowsDriven).padStart(6)} · ${c.crashedIn}${c.taken === 0 ? '   ← never driven' : ''}`);
}
console.log(
  `\nfinished ${ok.length}/${rows.length} · avg time ${avg(ok.map((r) => r.time)).toFixed(1)} s · avg score ${Math.round(avg(ok.map((r) => r.total)))} · avg ${avg(rows.map((r) => r.ms)).toFixed(0)} ms per run`,
);
console.log(`replay check: ${rows.length - replayMismatch.length}/${rows.length} runs replay to the same score and time${replayMismatch.length ? ' · MISMATCH: ' + replayMismatch.slice(0, 5).join(', ') : ''}`);
if (ok.length < rows.length || replayMismatch.length > 0) process.exitCode = 1;
