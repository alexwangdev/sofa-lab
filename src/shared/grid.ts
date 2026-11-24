/** Grid constants and lookups shared by course generation, the sim and the renderer. */
import { Cell } from './types.ts';
import type { BiomeId, Course } from './types.ts';

export const COLS = 9;
/**
 * Daily track length: the one knob. Everything else (segments, walls, gate widths, par, UI) derives from it.
 * The spec's 700 rows felt long in play; 450 rows ≈ 900 m ≈ 50 s at cruise. Three equal segments.
 * Endless tracks (endless.ts) are daily-style legs of this length joined end to end.
 */
export const ROWS = 450;
export const FINISH_ROW = ROWS - 1;
/** Rows per segment (one biome each). The daily track has 3; an endless track has as many as it has grown. */
export const SEG_ROWS = ROWS / 3;
/** First row of each daily segment: 0, ROWS/3, 2·ROWS/3. */
export const SEGMENT_START = [0, SEG_ROWS, SEG_ROWS * 2] as const;
export const BOUNDARIES = [SEG_ROWS, SEG_ROWS * 2] as const;

export const segmentOf = (row: number): number => Math.max(0, Math.floor(row / SEG_ROWS));
export const segmentEnd = (seg: number): number => seg * SEG_ROWS + SEG_ROWS - 1;

/** The biome a row belongs to. */
export function biomeAt(course: Course, row: number): BiomeId {
  return course.biomes[Math.min(segmentOf(row), course.biomes.length - 1)] as BiomeId;
}
/** Last row of the track (the finish line on a daily track; just the end of what is generated so far on an endless one). */
export const finishRow = (course: Course): number => course.rows - 1;
/** First row of the next biome after `row`, or null if there is none. */
export function nextBoundary(course: Course, row: number): number | null {
  const b = (segmentOf(row) + 1) * SEG_ROWS;
  return b < course.rows ? b : null;
}

export function cellAt(course: Course, row: number, col: number): number {
  if (row < 0 || row >= course.rows || col < 0 || col >= COLS) return Cell.Normal;
  return course.cells[row * COLS + col] ?? Cell.Normal;
}

export const cellKey = (row: number, col: number): number => row * COLS + col;
