import { GERVER, isPlain, parFor } from '../shared/sofa';
import { dailyChallenge } from '../shared/daily';
import type { DailyChallenge } from '../shared/daily';
import type { RedisLike } from './ports';

export type Puzzle = DailyChallenge & {
  /** Best possible area today under the test; null if the computation failed. */
  par: number | null;
  /** The par shape (server-only; revealed the next day). */
  parCells: number[];
  /** Ceiling shown to the player: Gerver on a clean w = 1 day, otherwise par. */
  target: number | null;
  targetLabel: string;
};

export function labelFor(ch: DailyChallenge, par: number | null): { target: number | null; targetLabel: string } {
  if (ch.course.w === 1 && isPlain(ch.course)) return { target: GERVER, targetLabel: `Gerver ${GERVER}` };
  if (par === null) return { target: null, targetLabel: 'target: —' };
  return { target: par, targetLabel: `Par ${par.toFixed(2)}` };
}

/**
 * The day's challenge (pure, from the date seed) + its par, computed once by the intersection method and cached at
 * puzzle:{date}. `wOverride` exists only for local mode (dev toolbar); production never passes it.
 */
export async function getPuzzle(redis: RedisLike, date: string, wOverride?: number): Promise<Puzzle> {
  const ch = dailyChallenge(date, wOverride);
  const key = `puzzle:${date}`;
  const sig = JSON.stringify(ch.course);
  let par: number | null = null;
  let parCells: number[] = [];
  try {
    const raw = await redis.get(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'sig' in parsed && 'par' in parsed && parsed.sig === sig && typeof parsed.par === 'number') {
        par = parsed.par;
        if ('cells' in parsed && Array.isArray(parsed.cells)) parCells = parsed.cells.filter((c): c is number => typeof c === 'number');
        if (parCells.length === 0) par = null; // old cache entry without the shape: recompute
      }
    }
  } catch (err) {
    console.error('puzzle cache read failed', err);
  }
  if (par === null) {
    try {
      const p = parFor(ch.course);
      par = p.area;
      parCells = p.cells;
      await redis.set(key, JSON.stringify({ sig, w: ch.course.w, par, cells: parCells }));
    } catch (err) {
      console.error('par compute/cache failed', err);
    }
  }
  return { ...ch, par, parCells, ...labelFor(ch, par) };
}
