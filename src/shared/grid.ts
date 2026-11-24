/** Grid constants and lookups shared by course generation, the sim and the renderer. */
import { Cell } from './types.ts';
import type { Course } from './types.ts';

export const COLS = 9;
/**
 * Track length: the one knob. Everything else (segments, walls, gate widths, par, score cap, UI) derives from it.
 * The spec's 700 rows felt long in play; 450 rows ≈ 900 m ≈ 50 s at cruise. Three equal segments.
 */
export const ROWS = 450;
export const FINISH_ROW = ROWS - 1;
const SEG = Math.floor(ROWS / 3);
/** First row of each segment: 0, ROWS/3, 2·ROWS/3. */
export const SEGMENT_START = [0, SEG, SEG * 2] as const;
export const BOUNDARIES = [SEG, SEG * 2] as const;

export function segmentOf(row: number): 0 | 1 | 2 {
  return row >= SEG * 2 ? 2 : row >= SEG ? 1 : 0;
}
export function segmentEnd(seg: 0 | 1 | 2): number {
  return seg === 0 ? SEG - 1 : seg === 1 ? SEG * 2 - 1 : FINISH_ROW;
}


export function cellAt(course: Course, row: number, col: number): number {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return Cell.Normal;
  return course.cells[row * COLS + col] ?? Cell.Normal;
}

export const cellKey = (row: number, col: number): number => row * COLS + col;
