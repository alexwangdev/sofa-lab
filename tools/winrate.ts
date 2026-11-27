/**
 * Win rate: how often players of different skill finish the daily track, beat par, and how far they get in endless.
 *
 * A "player" is the autopilot with a shorter look-ahead (how many rows ahead it plans) and a mistake rate (the chance,
 * per row, of pressing a random lane instead of the planned one). Speed: experts hold Tuck, others cruise.
 * These are models, not real players: they show how the difficulty curve is shaped, not exact human numbers.
 *
 *   npm run winrate                      60 days from today, 3 tries per player per day
 *   npm run winrate -- --days 30 --tries 5 --from 2026-01-01
 */
import { makePilot } from '../src/shared/autopilot.ts';
import { generateCourse } from '../src/shared/course.ts';
import { keepAhead, newEndless } from '../src/shared/endless.ts';
import { ROWS } from '../src/shared/grid.ts';
import { mulberry32, utcDate } from '../src/shared/rng.ts';
import { IN, computePar, maxLanesFor, newRun, score, startRun, tick } from '../src/shared/sim.ts';
import type { RunState } from '../src/shared/sim.ts';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const days = Number(arg('days', '60')) || 60;
const tries = Number(arg('tries', '3')) || 3;
const from = arg('from', utcDate());
const endlessCap = Number(arg('endless-legs', '10')) || 10;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Player = { name: string; depth: number; horizon: number; mistake: number; tuck: boolean };
const PLAYERS: Player[] = [
  { name: 'Expert (looks 6 rows ahead, no mistakes, Tuck)', depth: 6, horizon: 16, mistake: 0, tuck: true },
  { name: 'Good (4 rows, 1 % mistakes, Tuck)', depth: 4, horizon: 8, mistake: 0.01, tuck: true },
  { name: 'Casual (3 rows, 3 % mistakes)', depth: 3, horizon: 5, mistake: 0.03, tuck: false },
  { name: 'Beginner (2 rows, 6 % mistakes)', depth: 2, horizon: 3, mistake: 0.06, tuck: false },
];

function play(p: Player, s: RunState, seed: number, maxRow: number): void {
  const pilot = makePilot({ depth: p.depth, horizon: p.horizon });
  const rnd = mulberry32(seed);
  const human = (st: RunState, row: number) => {
    if (rnd() < p.mistake) {
      const max = maxLanesFor(st, row);
      return Math.floor(rnd() * (2 * max + 1)) - max; // a slip: any allowed move, maybe the wrong one
    }
    return pilot(st, row);
  };
  startRun(s);
  while (s.phase === 'run' && s.row < maxRow) {
    if (s.course.endless) keepAhead(s);
    tick(s, s.tick === 0 && p.tuck ? [IN.fastOn] : [], human);
    s.events.length = 0;
  }
}

const par = computePar();
console.log(`win rate over ${days} days × ${tries} tries (from ${from}); endless capped at ${endlessCap} legs\n`);
for (const [pi, p] of PLAYERS.entries()) {
  let finished = 0;
  let beatPar = 0;
  let scoreSum = 0;
  let runs = 0;
  const crashRows: number[] = [];
  const endless: number[] = [];
  const t0 = performance.now();
  for (let d = 0; d < days; d++) {
    const date = addDays(from, d);
    const course = generateCourse(date);
    for (let t = 0; t < tries; t++) {
      const s = newRun(course, par);
      play(p, s, (pi + 1) * 1_000_003 + d * 101 + t, Number.POSITIVE_INFINITY);
      runs++;
      scoreSum += score(s).total;
      if (s.phase === 'finish') {
        finished++;
        if (s.time < par) beatPar++;
      } else crashRows.push(s.row);
    }
    // endless: one try per day
    const e = newRun(newEndless(date), par);
    play(p, e, (pi + 7) * 999_983 + d, endlessCap * ROWS);
    endless.push(e.row);
  }
  crashRows.sort((a, b) => a - b);
  endless.sort((a, b) => a - b);
  const pct = (n: number) => `${((100 * n) / runs).toFixed(0)} %`;
  const med = (a: number[]) => (a.length ? (a[Math.floor(a.length / 2)] ?? 0) : 0);
  console.log(p.name);
  console.log(`  daily: finish ${pct(finished)} · beat par ${pct(beatPar)} · avg score ${Math.round(scoreSum / runs)} · median crash at row ${med(crashRows) || '—'}`);
  console.log(`  endless: median ${(med(endless) * 2 / 1000).toFixed(2)} km (${med(endless)} rows) · best ${(endless.at(-1)! * 2 / 1000).toFixed(2)} km · ${endless.filter((r) => r >= endlessCap * ROWS).length}/${days} hit the cap`);
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
}
