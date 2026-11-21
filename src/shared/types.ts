/** Cell index in the build grid: id = row * cols + col. Row 0 is the inner-wall side (local y = 0). */
export type CellId = number;

/** A round column in the hallway (world coords). Sofa sample points may not enter it, ever. */
export type Pillar = { cx: number; cy: number; r: number; kind: 'corner' | 'outer' | 'inner' };

/** Everything that defines one day's challenge. Same for every player on that UTC date. */
export type Course = {
  /** Vertical-arm width (horizontal arm is always 1). */
  w: number;
  pillar: Pillar | null;
  /** Build cells that can't be used today ("torn fabric"). */
  torn: CellId[];
};

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Gerver';

export type Medal = 'gold' | 'silver' | 'bronze' | null;

/**
 * A rigid motion through the corner.
 * - `slide`: pure translation: in along the horizontal arm, then down the vertical arm, with the shape's left edge
 *   at x = ox in the junction (only shapes no wider than the vertical arm).
 * - `rotate`: Hammersley-type path. In the sofa's own frame the hallway turns by t (0 → 90°) while its
 *   inner corner runs along the semicircle q(t) = (bu + r·cos 2t, r·sin 2t). World = R(−t)·(p − q(t)).
 *   The sofa slides in before turning and slides down after.
 */
export type Motion = { kind: 'slide'; ox: number } | { kind: 'rotate'; r: number; bu: number };

/** Where a failing sofa got stuck. */
export type JamPhase = 'approach' | 'turn' | 'exit';

export type TestResult = {
  pass: boolean;
  /** cells × 0.01, rounded to 3 decimals. This is the area of the shape, not the score. */
  area: number;
  /** Angle in degrees where a cell left the hallway (failures only). 0 for approach, 90 for exit. */
  jamAngle?: number;
  jamPhase?: JamPhase;
  /** Offending cells at the jam (failures only). */
  jamCells?: CellId[];
  /** Motion that passed, or the motion that got furthest before jamming. Used for the animation. */
  motion: Motion | null;
};

export type ShapeCheck = { ok: true; cells: CellId[] } | { ok: false; error: string };

export type TodayResponse = {
  date: string;
  /** e.g. "Thu" */
  weekday: string;
  difficulty: Difficulty;
  /** Human-readable list of today's twists, e.g. ["Pillar in the corner", "Torn fabric"]. */
  twists: string[];
  course: Course;
  w: number;
  /** Best possible area today under the test (intersection method). null if not computed. */
  par: number | null;
  /** Ceiling shown to the player: Gerver 2.2195 on a clean w = 1 day, otherwise par. */
  target: number | null;
  targetLabel: string;
  hasSubmitted: boolean;
  myArea: number | null;
  myCells: CellId[] | null;
  myRank: number | null;
  /** Your most recent submission from the last 7 days before today (carve template). */
  prevCells: CellId[] | null;
  streak: number;
  username: string | null;
};

export type SubmitResult = {
  date: string;
  w: number;
  pass: boolean;
  /** Score: area if pass, 0 if fail. */
  area: number;
  rank: number | null;
  streak: number;
  target: number | null;
  par: number | null;
  medal: Medal;
};

export type LeaderboardEntry = { rank: number; username: string; area: number };

export type LeaderboardResponse = {
  date: string;
  top: LeaderboardEntry[];
  me: { rank: number; area: number } | null;
  total: number;
};

export type ErrorResponse = { error: string };

/** A shape shown in the next-day reveal. */
export type RevealShape = { label: string; area: number; cells: CellId[] };

/** Yesterday (or any past day): its challenge, the par shape, the top player's sofa, and yours. Never today. */
export type RevealResponse = {
  date: string;
  weekday: string;
  difficulty: Difficulty;
  twists: string[];
  course: Course;
  par: number | null;
  shapes: RevealShape[];
};
