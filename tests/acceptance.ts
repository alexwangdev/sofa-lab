/**
 * Spec §5.4 acceptance tests + §12 checks that don't need Reddit. Run: `npm run acceptance`.
 * Exits non-zero if any check fails. Same code path as the game test (runTest).
 */
import {
  COLS,
  GERVER,
  HAMMERSLEY,
  HAMMERSLEY_R,
  ROWS,
  cellIdOf,
  hammersleyArea,
  hammersleyCells,
  maxAreaUnderTest,
  biggestPiece,
  cellCol,
  hintsFor,
  mirrorCell,
  parFor,
  runTest,
  templateCells,
} from '../src/shared/sofa.ts';
import { shareLines } from '../src/shared/share.ts';
import { dailyChallenge, pickWidth } from '../src/shared/daily.ts';

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`);
  if (!ok) failures++;
}

function block(cols: number, rows: number, col0 = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(cellIdOf(col0 + c, r));
  return out;
}

const t0 = performance.now();

// 1. 1×1 square
{
  const res = runTest(block(10, 10, 13));
  const ok = res.ok && res.result.pass && res.result.area === 1;
  check('1x1 square must PASS', ok, res.ok ? `area=${res.result.area.toFixed(3)} motion=${JSON.stringify(res.result.motion)}` : res.error);
}

// 2. Semicircle radius 1 (= Hammersley r = 0)
{
  const cells = hammersleyCells(0);
  const res = runTest(cells);
  const ok = res.ok && res.result.pass;
  check('semicircle r=1 must PASS', ok, res.ok ? `area=${res.result.area.toFixed(3)} (exact ${(Math.PI / 2).toFixed(3)}) motion=${JSON.stringify(res.result.motion)}` : res.error);
}

// 3. Hammersley r = 2/π
{
  const cells = hammersleyCells(HAMMERSLEY_R);
  const res = runTest(cells);
  const area = res.ok ? res.result.area : 0;
  const ok = res.ok && res.result.pass && Math.abs(area - HAMMERSLEY) <= 0.03;
  check('Hammersley r=2/pi must PASS, area ±0.03', ok, `area=${area.toFixed(3)} target=${HAMMERSLEY} diff=${(area - HAMMERSLEY).toFixed(3)} motion=${res.ok ? JSON.stringify(res.result.motion) : '-'}`);
}

// 4. 3×1 block
{
  const res = runTest(block(30, 10, 3));
  const ok = res.ok && !res.result.pass && (res.result.jamAngle ?? 90) < 90;
  check('3x1 block must FAIL, jam < 90°', ok, res.ok ? `pass=${res.result.pass} jamAngle=${res.result.jamAngle}° jamCells=${res.result.jamCells?.length}` : res.error);
}

// 5. Disconnected cell -> rejected by shape rules
{
  const cells = [...block(10, 10, 5), cellIdOf(20, 5)];
  const res = runTest(cells);
  const ok = !res.ok && res.error === 'sofa must be one piece';
  check('disconnected shape must be REJECTED', ok, res.ok ? 'was tested, not rejected' : `error="${res.error}"`);
}

// Extra: tutorial sweep (§4: must pass for r <= ~0.64) on the tutorial grid
{
  const TUT_COLS = 40;
  const failsAt: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const r = i / 100;
    const res = runTest(hammersleyCells(r, TUT_COLS), 1, TUT_COLS);
    if (!res.ok || !res.result.pass) failsAt.push(r);
  }
  check('tutorial Hammersley r in [0,0.64] all PASS', failsAt.length === 0, failsAt.length ? `fails at r=${failsAt.join(',')}` : `65/65 pass; area(0.637)=${hammersleyArea(HAMMERSLEY_R).toFixed(3)}`);
}

// Extra: the grid ceiling must stay below Gerver (nobody can "beat the theorem")
{
  for (const w of [0.85, 0.9, 1.0, 1.1, 1.15]) {
    const m = maxAreaUnderTest(w);
    const ok = w !== 1 || m.area < GERVER;
    check(`max area under test, w=${w}`, ok, `max=${m.area.toFixed(3)} (r=${m.r})${w === 1 ? ` < Gerver ${GERVER}` : ''}`);
  }
}

// Extra: invalid inputs rejected
{
  const bad: unknown[] = [[], [-1], [COLS * ROWS], [1.5], 'x', [0, 'a']];
  const allRejected = bad.every((b) => !runTest(b).ok);
  check('invalid inputs rejected', allRejected, `${bad.length} cases`);
}

// Twists: torn cells are rejected by shape rules; a corner column jams a sofa that used to pass.
{
  const ch = { w: 1, pillar: null, torn: [cellIdOf(15, 5)] };
  const res = runTest(block(10, 10, 13), ch);
  check('torn cell is REJECTED', !res.ok && res.error.includes('torn'), res.ok ? 'was accepted' : `error="${res.error}"`);

  const ham = hammersleyCells(HAMMERSLEY_R);
  const col = { w: 1, pillar: { kind: 'corner' as const, cx: 1, cy: 1, r: 0.7 }, torn: [] };
  const r1 = runTest(ham, col);
  const ok1 = r1.ok && !r1.result.pass && r1.result.jamPhase !== undefined;
  check('corner column jams Hammersley', ok1, r1.ok ? `pass=${r1.result.pass} phase=${r1.result.jamPhase} angle=${r1.result.jamAngle}°` : r1.error);

  // A pillar on the outer wall of the vertical arm: a 1x1 square passes on a plain day but must hit it on the way down.
  const wall = { w: 1, pillar: { kind: 'outer' as const, cx: 1, cy: -0.8, r: 0.5 }, torn: [] };
  const sq = block(10, 10, 13);
  const plain = runTest(sq, 1);
  const r2 = runTest(sq, wall);
  const ok2 = plain.ok && plain.result.pass && r2.ok && !r2.result.pass;
  check('wall pillar blocks the slide-out', ok2, r2.ok ? `plain=${plain.ok && plain.result.pass} pillar: pass=${r2.result.pass} phase=${r2.result.jamPhase}` : r2.error);
}

// Daily challenges: 4 weeks — par shape always passes its own day, Gerver day is clean, hard days par < easy days par.
{
  let bad = 0;
  const byDiff: Record<string, number[]> = {};
  const d = new Date('2026-11-23T00:00:00Z');
  for (let i = 0; i < 28; i++) {
    const date = d.toISOString().slice(0, 10);
    const ch = dailyChallenge(date);
    const par = parFor(ch.course);
    const res = runTest(par.cells, ch.course);
    if (!res.ok || !res.result.pass || res.result.area !== par.area) bad++;
    if (ch.difficulty === 'Gerver' && (ch.course.w !== 1 || ch.course.pillar || ch.course.torn.length)) bad++;
    (byDiff[ch.difficulty] ??= []).push(par.area);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const avg = (xs: number[] = []) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const order = avg(byDiff.Easy) > avg(byDiff.Medium) && avg(byDiff.Medium) > avg(byDiff.Hard);
  const summary = Object.entries(byDiff).map(([k, v]) => `${k} ${avg(v).toFixed(2)}`).join(', ');
  check('28 days: par shapes pass, Easy > Medium > Hard', bad === 0 && order, `bad=${bad}; avg par: ${summary}`);
}


// Carve tools + hints + share card
{
  // Mirror is an involution and the Hammersley template is mirror-symmetric.
  const tmpl = templateCells(0.6);
  const set = new Set(tmpl);
  const sym = tmpl.every((c) => set.has(mirrorCell(c))) && tmpl.every((c) => mirrorCell(mirrorCell(c)) === c);
  check('mirror + template symmetric', sym, `${tmpl.length} cells`);

  // Hints on a failing shape: removing the red (early) cells must get further or pass.
  const colDay = { w: 1, pillar: { kind: 'corner' as const, cx: 1, cy: 1, r: 0.67 }, torn: [] };
  const big = templateCells(0.64);
  const r0 = runTest(big, colDay);
  let improved = 'template unexpectedly passed';
  let okHint = false;
  if (r0.ok && !r0.result.pass) {
    const h = hintsFor(r0.cells, r0.result, colDay);
    const kill = new Set([...h.early, ...h.late]);
    const trimmed = biggestPiece(r0.cells.filter((c) => !kill.has(c)));
    const r1 = runTest(trimmed, colDay);
    okHint = h.early.length + h.late.length > 0 && r1.ok && (r1.result.pass || (r1.result.jamAngle ?? 0) >= (r0.result.jamAngle ?? 0));
    improved = `red+orange=${kill.size}, after trim: pass=${r1.ok && r1.result.pass} area=${r1.ok ? r1.result.area : '-'}`;
  }
  check('trimming hinted cells helps', okHint, improved);

  // Hints on a passing shape: every green cell can be added and it still passes.
  const par = parFor(1).cells;
  const cols = par.map((c) => cellCol(c));
  const lo = Math.min(...cols);
  const trimmedPar = biggestPiece(par.filter((c) => cellCol(c) > lo + 1));
  const rp = runTest(trimmedPar, 1);
  let growOk = false;
  let growDetail = '';
  if (rp.ok && rp.result.pass) {
    const h = hintsFor(rp.cells, rp.result, 1);
    const grown = runTest([...rp.cells, ...h.grow], 1);
    growOk = h.grow.length > 0 && grown.ok && grown.result.pass;
    growDetail = `grow=${h.grow.length}, ${rp.result.area} → ${grown.ok ? grown.result.area : '-'}`;
  }
  check('growing into green cells still passes', growOk, growDetail);

  const lines = shareLines({ weekday: 'Thu', difficulty: 'Hard', area: 1.82, pass: true, par: 1.86, medal: 'gold', streak: 3, course: { w: 1, pillar: { kind: 'corner', cx: 1, cy: 1, r: 0.67 }, torn: [5] } });
  const text = lines.join('\n');
  check('share card: no shape data, medal + bar', lines.length === 4 && text.includes('🥇') && text.includes('🟩') && !/\[|\d{3},/.test(text), text.replace(/\n/g, ' | '));
}


// §12.3 daily seed
{
  const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
  const ws = dates.map(pickWidth);
  let diff = 0;
  for (let i = 1; i < ws.length; i++) if (ws[i] !== ws[i - 1]) diff++;
  const stable = dates.every((d) => pickWidth(d) === pickWidth(d));
  check('seed: >=4 of 6 day-to-day changes; stable', diff >= 4 && stable, `w=${ws.join(', ')} changes=${diff}/6`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} in ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(failures === 0 ? 0 : 1);
