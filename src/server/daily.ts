/** Seed, biome shuffle and par time for a date (spec §5, §10), cached in puzzle:{date}. */
import { dailyRoute, dailySeed, generateCourse } from '../shared/course.ts';
import { computePar } from '../shared/sim.ts';
import { ROWS } from '../shared/grid.ts';
import { BIOME_IDS } from '../shared/types.ts';
import type { BiomeId, Course } from '../shared/types.ts';
import type { RedisLike } from './ports.ts';

/** `rows` records the track length the par was computed for; a stored puzzle for another length is recomputed. */
export type Puzzle = { biomes: [BiomeId, BiomeId, BiomeId]; parSeconds: number; rows: number };

export const kPuzzle = (date: string) => `ge:puzzle:${date}`;

function parsePuzzle(raw: string | undefined): Puzzle | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Puzzle>;
    const ids: readonly string[] = BIOME_IDS;
    if (!Array.isArray(v.biomes) || v.biomes.length !== 3 || !v.biomes.every((b) => ids.includes(b))) return null;
    if (typeof v.parSeconds !== 'number' || v.rows !== ROWS) return null;
    return { biomes: [v.biomes[0], v.biomes[1], v.biomes[2]] as [BiomeId, BiomeId, BiomeId], parSeconds: v.parSeconds, rows: ROWS };
  } catch {
    return null;
  }
}

export async function getPuzzle(redis: RedisLike, date: string): Promise<Puzzle> {
  const stored = parsePuzzle(await redis.get(kPuzzle(date)));
  if (stored) return stored;
  const puzzle: Puzzle = { biomes: dailyRoute(dailySeed(date)), parSeconds: computePar(), rows: ROWS };
  await redis.set(kPuzzle(date), JSON.stringify(puzzle));
  return puzzle;
}

/** The server's own copy of the track; it wins over the client's. */
const courseCache = new Map<string, Course>();
export function courseFor(date: string, puzzle: Puzzle): Course {
  const key = `${date}:${puzzle.biomes.join()}`;
  let c = courseCache.get(key);
  if (!c) {
    c = generateCourse(date, puzzle.biomes);
    courseCache.set(key, c);
    if (courseCache.size > 8) courseCache.delete(courseCache.keys().next().value as string);
  }
  return c;
}
