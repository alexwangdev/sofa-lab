/** Daily seed + challenge (spec §6, extended with a weekday difficulty ramp and twists). Pure; shared by server, client and tests. */
import type { CellId, Course, Difficulty, Pillar } from './types';
import { COLS, ROWS } from './sofa.ts';

export const WIDTHS: readonly number[] = [0.85, 0.9, 1.0, 1.0, 1.1, 1.15];

/** UTC date as YYYY-MM-DD. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Previous UTC date string. */
export function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDate(d);
}

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** String → 32-bit seed (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DailyChallenge = {
  date: string;
  weekday: string;
  difficulty: Difficulty;
  course: Course;
  /** Human-readable twists, shown under the title. */
  twists: string[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** UTC weekday → difficulty and twists. Saturday is the clean "Gerver day" that keeps the theorem in play. */
const PLAN: Record<number, { difficulty: Difficulty; pillar: boolean | 'maybe'; torn: boolean | 'maybe'; widths: readonly number[] }> = {
  1: { difficulty: 'Easy', pillar: false, torn: false, widths: [1.1, 1.15] },
  2: { difficulty: 'Medium', pillar: false, torn: true, widths: [0.9, 1.0, 1.1] },
  3: { difficulty: 'Medium', pillar: true, torn: false, widths: [0.9, 1.0, 1.1] },
  4: { difficulty: 'Hard', pillar: true, torn: true, widths: [0.85, 0.9, 1.0] },
  5: { difficulty: 'Medium', pillar: 'maybe', torn: 'maybe', widths: [0.9, 1.0, 1.1] },
  6: { difficulty: 'Gerver', pillar: false, torn: false, widths: [1.0] },
  0: { difficulty: 'Hard', pillar: true, torn: true, widths: [0.85, 0.9, 1.0] },
};

const round2 = (x: number): number => Math.round(x * 100) / 100;

function makePillar(rnd: () => number, w: number, hard: boolean): { pillar: Pillar; label: string } {
  const pick = rnd();
  if (pick < 0.4) {
    const r = round2((hard ? 0.62 : 0.55) + 0.1 * rnd());
    return { pillar: { kind: 'corner', cx: w, cy: 1, r }, label: `Column in the outer corner (r ${r})` };
  }
  const y = round2(-0.35 - 0.9 * rnd());
  const r = round2((hard ? 0.18 : 0.13) + 0.08 * rnd());
  if (pick < 0.7) return { pillar: { kind: 'outer', cx: w, cy: y, r }, label: `Pillar on the outer wall (r ${r})` };
  return { pillar: { kind: 'inner', cx: 0, cy: y, r }, label: `Pillar on the inner wall (r ${r})` };
}

/** 2–3 small tears (random walks of 2–4 cells) in the part of the box where big sofas live. */
function makeTorn(rnd: () => number, hard: boolean): CellId[] {
  const out = new Set<CellId>();
  const blobs = hard ? 3 : 2;
  for (let b = 0; b < blobs; b++) {
    let col = 8 + Math.floor(rnd() * 22);
    let row = Math.floor(rnd() * ROWS);
    const len = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < len; i++) {
      out.add(row * COLS + col);
      if (rnd() < 0.5) col = Math.min(COLS - 1, Math.max(0, col + (rnd() < 0.5 ? -1 : 1)));
      else row = Math.min(ROWS - 1, Math.max(0, row + (rnd() < 0.5 ? -1 : 1)));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The challenge for a UTC date. Same date → same challenge for everyone (seed = date, mulberry32).
 * `wOverride` is for local mode only.
 */
export function dailyChallenge(date: string, wOverride?: number): DailyChallenge {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const plan = PLAN[day] ?? PLAN[1];
  if (!plan) throw new Error('no plan');
  const rnd = mulberry32(hashSeed(date));
  const drawnW = plan.widths[Math.floor(rnd() * plan.widths.length)] ?? 1;
  const w = wOverride ?? drawnW;
  const hard = plan.difficulty === 'Hard';
  const coin = rnd() < 0.5;
  const wantPillar = plan.pillar === 'maybe' ? coin : plan.pillar;
  const wantTorn = plan.torn === 'maybe' ? !coin : plan.torn;
  const twists: string[] = [];
  let pillar: Pillar | null = null;
  // Always consume the same RNG draws so a w override doesn't reshuffle the twists.
  const p = makePillar(rnd, w, hard);
  const torn = makeTorn(rnd, hard);
  if (wantPillar) {
    pillar = p.pillar;
    twists.push(p.label);
  }
  if (wantTorn) twists.push(`Torn fabric (${torn.length} cells)`);
  return {
    date,
    weekday: WEEKDAYS[day] ?? '',
    difficulty: plan.difficulty,
    course: { w, pillar, torn: wantTorn ? torn : [] },
    twists,
  };
}

/** Vertical-arm width for a date (kept for the seed check and the dev toolbar). */
export function pickWidth(date: string): number {
  return dailyChallenge(date).course.w;
}

/** Medal thresholds as a fraction of the day's par. */
export const MEDALS = { gold: 0.97, silver: 0.9, bronze: 0.8 } as const;

export function medalFor(area: number, par: number | null): 'gold' | 'silver' | 'bronze' | null {
  if (!par || area <= 0) return null;
  const f = area / par;
  if (f >= MEDALS.gold) return 'gold';
  if (f >= MEDALS.silver) return 'silver';
  if (f >= MEDALS.bronze) return 'bronze';
  return null;
}
