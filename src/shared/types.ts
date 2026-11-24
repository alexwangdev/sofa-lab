/** Shared types (spec §4, §7, §13). */

/** Generic cells (spec §4). A biome only renames them; never add a cell type for one biome. */
export const Cell = {
  Normal: 0,
  Crash: 1,
  Gate: 2,
  Pole: 3,
  Ramp: 4,
  Fast: 5,
  Slow: 6,
  Collect: 7,
  Pickup: 8,
  Finish: 9,
} as const;

export const BIOME_IDS = ['snow', 'desert', 'volcano', 'ocean', 'jungle', 'icefield', 'city', 'space'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export type VehicleId = string;

/** One data row per vehicle (spec §7). Base vehicles: durationRows = Infinity and every flag off. */
export type VehicleDef = {
  id: VehicleId;
  name: string;
  biomes: readonly BiomeId[];
  base: boolean;
  durationRows: number;
  /** 0, 1 or 2 lanes per row. */
  lanesPerRow: 0 | 1 | 2;
  ignoreCrash: boolean;
  ignoreSlow: boolean;
  /** Crash cell is destroyed (+5), run continues. Poles are never broken. */
  breakCrash: boolean;
  /** lanesPerRow forced to 0. */
  straightOnly: boolean;
  noCollect: boolean;
  noGate: boolean;
  /** 0, or 2: each step skips that many rows; their cells never resolve. Landing row allows 0 lane change. */
  jumpRows: 0 | 2;
  /** Ramp +20 × rampBonus. */
  rampBonus: 1 | 2;
  /** After a 2-lane move, the next row allows 0 lane change. */
  turnCooldown: boolean;
  /** Ramp cells act as Normal (Elephant: too heavy). Data flag, not a code path. */
  noRamp: boolean;
};

export type Pickup = { row: number; lane: number; vehicle: VehicleId; segment: number };

export type Course = {
  date: string;
  seed: number;
  biomes: readonly [BiomeId, BiomeId, BiomeId];
  rows: number;
  cols: number;
  cells: Uint8Array;
  /** Guaranteed-clear lane per row (generation only, never shown to the player). */
  safe: Int8Array;
  /** Gate row → gate index. */
  gateRows: Map<number, number>;
  pickups: Pickup[];
  /** FNV-1a over the cells: client and server must agree on the track. */
  checksum: number;
};

export type Phase = 'ready' | 'run' | 'crash' | 'finish';

export type ScoreParts = {
  rows: number;
  gates: number;
  collect: number;
  air: number;
  breaks: number;
  finish: number;
  total: number;
};

// ---------- API (spec §13) ----------

export type TodayResponse = {
  date: string;
  biomes: [BiomeId, BiomeId, BiomeId];
  parSeconds: number;
  myBest: number | null;
  myStreak: number;
  /** Has the caller played today (skip the preview on later runs). */
  playedToday: boolean;
  username: string | null;
};

/** A finished or crashed run: the track checksum, the claimed score, and the input log the server replays (sim.ts). */
export type RunBody = { score: number; seedCheck: number; inputs: number[] };

export type RunResponse = { score: number; best: number; rank: number | null; streak: number; improved: boolean };

export type LeaderboardEntry = { rank: number; username: string; score: number };
export type LeaderboardResponse = { date: string; top: LeaderboardEntry[]; me: { rank: number; best: number } | null; total: number };

export type ErrorResponse = { error: string };
