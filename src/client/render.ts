/**
 * Pseudo-3D renderer (spec §11, same projection as Ski Grid DESIGN.md §4). The world is the shared cell grid;
 * each point (x = lane, y = height, z = row) is projected with one perspective divide:
 *   sx = cx + (x − camX) · F / (z − camZ),   sy = horizon + (camY − y) · F / (z − camZ)
 * Rows are painted far → near (painter's algorithm). Per biome only colours and sprite shapes change; the projection,
 * camera height and lane width are identical everywhere.
 */
import { BIOMES } from '../shared/biomes.ts';
import type { Palette } from '../shared/biomes.ts';
import { BOUNDARIES, COLS, FINISH_ROW, segmentOf } from '../shared/grid.ts';
import { hash3 } from '../shared/rng.ts';
import { AIR_ROWS, cellFor, nextRow, vehicleFor } from '../shared/sim.ts';
import type { RunState } from '../shared/sim.ts';
import { Cell } from '../shared/types.ts';
import type { BiomeId, Course } from '../shared/types.ts';
import { collectModel, crashModel, pickupPadModel, poleModel, rampModel, slowModel, vehicleModel } from './models.ts';
import { VPC, YAW_STEP, beginFrame, evict, preloadViews, rgb, viewOf } from './voxel.ts';
import type { RGB } from './voxel.ts';
import { forgetBiomeAtlas, loadBiomeAtlas } from './atlas.ts';
import { CAM_H, ZP, biomeCatalog } from './catalog.ts';
import type { Entry } from './voxel.ts';

const NEAR = 0.7;
/** Dev-only layer switches for profiling (devHooks __profile). */
export const renderLayers = { ground: true, objects: true, fog: true, sky: true, cells: true, grid: true, marks: true };

/** Draw distance in rows (see setDrawDistance). */
let far = 46;
const SIDE = 7;
const FADE_ROWS = 10;

/** Visual-only state owned by the canvas component. */
export type Fx = {
  laneVis: number;
  toasts: { text: string; color: string; age: number }[];
  particles: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; color: string; size: number }[];
  banner: { title: string; sub: string; age: number } | null;
  flash: { color: string; age: number } | null;
  shake: number;
  clock: number;
};

export const newFx = (lane: number): Fx => ({ laneVis: lane, toasts: [], particles: [], banner: null, flash: null, shake: 0, clock: 0 });

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Pick from a 2-tuple by parity (keeps noUncheckedIndexedAccess happy). */
const two = (pair: readonly [string, string], i: number): string => ((i & 1) === 0 ? pair[0] : pair[1]);
const css = (c: RGB, k = 1, fog?: RGB, f = 0): string => {
  const m = (v: number, w: number) => Math.round(Math.min(255, v * k) * (1 - f) + w * f);
  return fog ? `rgb(${m(c[0], fog[0])},${m(c[1], fog[1])},${m(c[2], fog[2])})` : `rgb(${m(c[0], 0)},${m(c[1], 0)},${m(c[2], 0)})`;
};

/** Palette blend at a row: last FADE_ROWS rows before a boundary crossfade into the next biome. */
function blendAt(course: Course, row: number): { a: Palette; b: Palette; t: number } {
  const seg = segmentOf(row);
  const a = BIOMES[course.biomes[seg]].palette;
  for (const bd of BOUNDARIES) {
    if (row >= bd - FADE_ROWS && row < bd) {
      const nb = BIOMES[course.biomes[segmentOf(bd)]].palette;
      return { a, b: nb, t: (row - (bd - FADE_ROWS) + 1) / (FADE_ROWS + 1) };
    }
  }
  return { a, b: a, t: 0 };
}
const pick = (bl: { a: Palette; b: Palette; t: number }, f: (p: Palette) => string): RGB => mixRGB(rgb(f(bl.a)), rgb(f(bl.b)), bl.t);

function heightAt(course: Course, z: number): number {
  const p = (course.seed % 1000) / 159;
  const ramp = Math.min(1, Math.max(0, (z - 6) / 30));
  return ramp * (0.5 * Math.sin(z * 0.085 + p) + 0.7 * Math.sin(z * 0.031 + p * 2.3));
}

type Cam = { x: number; y: number; z: number; F: number; cx: number; hy: number; w: number; h: number; fog: RGB };
type P = [number, number];

function proj(c: Cam, x: number, y: number, z: number): P {
  const dz = Math.max(NEAR, z - c.z);
  const s = c.F / dz;
  return [c.cx + (x - c.x) * s, c.hy + (c.y - y) * s];
}
/** Fog starts this many rows out. Everything beyond is fogged by one gradient overlay (drawFog), not per sprite. */
const FOG_START = 14;
const fogAt = (dz: number) => {
  const t = Math.min(1, Math.max(0, (dz - FOG_START) / (far - FOG_START)));
  return t * t * 0.9;
};

/**
 * Fog for the whole far band in one fill: drawn right after the last row beyond FOG_START, so it covers far ground and
 * far objects but nothing nearer. Screen y ↔ depth on flat ground: y = horizon + CAM_H·F / dz.
 */
function drawFog(ctx: CanvasRenderingContext2D, c: Cam): void {
  const yEnd = c.hy + (CAM_H * c.F) / FOG_START;
  if (yEnd <= c.hy) return;
  const g = ctx.createLinearGradient(0, c.hy, 0, yEnd);
  const [r, gg, b] = c.fog.map(Math.round);
  for (const dz of [far, 40, 34, 28, 24, 20, 17, FOG_START]) {
    if (dz > far) continue;
    const y = c.hy + (CAM_H * c.F) / dz;
    g.addColorStop(Math.min(1, Math.max(0, (y - c.hy) / (yEnd - c.hy))), `rgba(${r},${gg},${b},${fogAt(dz).toFixed(3)})`);
  }
  g.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, c.hy - 1, c.w, yEnd - c.hy + 1);
}
function poly(ctx: CanvasRenderingContext2D, pts: P[], fill: string): void {
  const p0 = pts[0];
  if (!p0) return;
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Axis-aligned box, only camera-facing faces. */
function box(ctx: CanvasRenderingContext2D, c: Cam, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string | RGB): void {
  if (z0 - c.z < NEAR) return;
  const col = typeof color === 'string' ? rgb(color) : color;
  const f = fogAt(z0 - c.z);
  if (c.x < x0) poly(ctx, [proj(c, x0, y0, z0), proj(c, x0, y0, z1), proj(c, x0, y1, z1), proj(c, x0, y1, z0)], css(col, 0.72, c.fog, f));
  if (c.x > x1) poly(ctx, [proj(c, x1, y0, z0), proj(c, x1, y0, z1), proj(c, x1, y1, z1), proj(c, x1, y1, z0)], css(col, 0.72, c.fog, f));
  poly(ctx, [proj(c, x0, y0, z0), proj(c, x1, y0, z0), proj(c, x1, y1, z0), proj(c, x0, y1, z0)], css(col, 0.9, c.fog, f));
  if (y1 < c.y) poly(ctx, [proj(c, x0, y1, z0), proj(c, x1, y1, z0), proj(c, x1, y1, z1), proj(c, x0, y1, z1)], css(col, 1.12, c.fog, f));
}

/* ---------- camera & background ---------- */

function makeCamera(s: RunState, fx: Fx, w: number, h: number): Cam {
  const F = (w * 0.95 * ZP) / 9.2;
  const playerY = Math.min(h * 0.8, h * 0.26 + (CAM_H * F) / ZP);
  const bl = blendAt(s.course, Math.floor(s.pos));
  return {
    x: (fx.laneVis + 0.5) * 0.6 + (COLS / 2) * 0.4 + (fx.shake > 0 ? Math.sin(fx.clock * 70) * fx.shake * 0.25 : 0),
    y: heightAt(s.course, s.pos) + CAM_H,
    z: s.pos - ZP,
    F,
    cx: w / 2,
    hy: playerY - (CAM_H * F) / ZP,
    w,
    h,
    fog: pick(bl, (p) => p.fog),
  };
}

function drawSky(ctx: CanvasRenderingContext2D, c: Cam, s: RunState): void {
  const bl = blendAt(s.course, Math.floor(s.pos));
  const g = ctx.createLinearGradient(0, 0, 0, c.hy);
  g.addColorStop(0, css(pick(bl, (p) => p.sky[0])));
  g.addColorStop(0.55, css(pick(bl, (p) => p.sky[1])));
  g.addColorStop(1, css(pick(bl, (p) => p.sky[2])));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.w, c.hy + 1);
  if (s.course.biomes[segmentOf(Math.floor(s.pos))] === 'space') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 40; i++) ctx.fillRect(hash3(i, 1, 7) * c.w, hash3(i, 2, 7) * c.hy * 0.9, 1.5, 1.5);
  }
  const cell = Math.max(6, Math.round(c.w / 45));
  const shift = c.x * cell * 0.6;
  const n = Math.ceil(c.w / cell) + 2;
  const layers: [RGB, number, number][] = [
    [pick(bl, (p) => p.mountains[0]), 0.22, 11],
    [pick(bl, (p) => p.mountains[1]), 0.13, 29],
  ];
  const cap = css(pick(bl, (p) => p.cap));
  for (const [col, amp, salt] of layers) {
    for (let i = -1; i < n; i++) {
      const gx = i + Math.floor(shift / cell);
      const hgt = Math.round(((Math.sin(gx * 0.31 + salt + (s.course.seed % 7)) * 0.5 + Math.sin(gx * 0.13 + salt) * 0.8 + 1.4) * amp * c.hy) / cell) * cell;
      const x = i * cell - (shift % cell);
      ctx.fillStyle = css(col);
      ctx.fillRect(x, c.hy - hgt, cell + 0.5, hgt + 1);
      if (amp > 0.2 && hgt > cell * 3) {
        ctx.fillStyle = cap;
        ctx.fillRect(x, c.hy - hgt, cell + 0.5, cell);
      }
    }
  }
  ctx.fillStyle = css(c.fog);
  ctx.fillRect(0, c.hy, c.w, c.h - c.hy);
}

/* ---------- ground ---------- */

function decorAt(course: Course, row: number, col: number): number {
  // sparse scenery: the column next to the track stays empty, then 18% / 12% of rows, nothing further out
  const d = col < 0 ? -col : col - COLS + 1;
  const p = d === 2 ? 0.18 : d === 3 ? 0.12 : 0;
  return hash3(row, col, course.seed) < p ? Cell.Crash : Cell.Normal;
}

const HAZARD: RGB = [220, 38, 38];

const variant = (course: Course, r: number, col: number): 0 | 1 => (hash3(r, col, course.seed + 3) < 0.6 ? 0 : 1);

/** Checker cells are drawn only this close; further out they are a few pixels wide and under fog. */
const CHECKER_ROWS = 22;

/** A batch of sub-paths drawn with one fill or one stroke. */
class Batch {
  private readonly groups = new Map<string, number[]>();
  /** Add a polygon (x, y pairs) under a style key. */
  add(key: string, pts: number[]): void {
    let g = this.groups.get(key);
    if (!g) {
      g = [];
      this.groups.set(key, g);
    }
    g.push(pts.length, ...pts);
  }
  private path(ctx: CanvasRenderingContext2D, g: number[], close: boolean): void {
    ctx.beginPath();
    for (let i = 0; i < g.length; ) {
      const n = g[i] ?? 0;
      ctx.moveTo(g[i + 1] ?? 0, g[i + 2] ?? 0);
      for (let k = 2; k < n; k += 2) ctx.lineTo(g[i + 1 + k] ?? 0, g[i + 2 + k] ?? 0);
      if (close) ctx.closePath();
      i += n + 1;
    }
  }
  fill(ctx: CanvasRenderingContext2D): void {
    for (const [style, g] of this.groups) {
      this.path(ctx, g, true);
      ctx.fillStyle = style;
      ctx.fill();
    }
  }
  /** Stroke; key = "style|lineWidth". */
  stroke(ctx: CanvasRenderingContext2D): void {
    for (const [key, g] of this.groups) {
      const bar = key.lastIndexOf('|');
      this.path(ctx, g, false);
      ctx.strokeStyle = key.slice(0, bar);
      ctx.lineWidth = Number(key.slice(bar + 1));
      ctx.stroke();
    }
  }
}

/**
 * The whole ground in one pass, before any object: base strips, then every special/checker cell batched by colour,
 * the grid and track edges as one stroke per colour, and the boost arrows / slow ripples / hazard brackets batched.
 * ~500 separate fills and strokes per frame became a few dozen; this was most of the frame time. (Trade-off: a far
 * object can no longer be hidden behind a nearer hill crest; the hills are gentle enough that it does not show.)
 */
function drawGround(ctx: CanvasRenderingContext2D, c: Cam, s: RunState, fx: Fx, rStart: number, rEnd: number): void {
  type Edge = { z: number; sy: number; sc: number };
  const E: Edge[] = [];
  for (let r = rStart; r <= rEnd + 1; r++) {
    const z = Math.max(r, c.z + NEAR);
    const sc = c.F / (z - c.z);
    E.push({ z, sy: c.hy + (c.y - heightAt(s.course, z)) * sc, sc });
  }
  const X = (e: Edge, col: number) => c.cx + (col - c.x) * e.sc;
  const quad = (e0: Edge, e1: Edge, a: number, b: number) => [X(e0, a), e0.sy, X(e0, b), e0.sy, X(e1, b), e1.sy, X(e1, a), e1.sy];

  // 1. base strips (sides + lanes), one polygon per run of rows with the same colour
  const strip = (a: number, b: number, pick: (rc: RowColors) => RGB) => {
    let i = 0;
    while (i < E.length - 1) {
      const fill = fillFor(pick(rowColors(s.course, rStart + i)), c, 0);
      let j = i + 1;
      while (j < E.length - 1 && fillFor(pick(rowColors(s.course, rStart + j)), c, 0) === fill) j++;
      const pts: number[] = [];
      for (let k = i; k <= j; k++) {
        const e = E[k];
        if (e) pts.push(X(e, a), e.sy);
      }
      for (let k = j; k >= i; k--) {
        const e = E[k];
        if (e) pts.push(X(e, b), e.sy);
      }
      const bt = new Batch();
      bt.add(fill, pts);
      bt.fill(ctx);
      i = j;
    }
  };
  if (!renderLayers.ground) return;
  strip(-SIDE, 0, (rc) => rc.side);
  strip(COLS, COLS + SIDE, (rc) => rc.side);
  strip(0, COLS, (rc) => rc.g0);

  // 2. cells, grid, edges, marks — collected per row, drawn batched
  const cells = new Batch();
  const lines = new Batch();
  const arrows = new Batch();
  const strokes = new Batch();
  const ph = (fx.clock * 1.6) % 0.5;
  for (let i = 0; i < E.length - 1; i++) {
    const r = rStart + i;
    const e0 = E[i];
    const e1 = E[i + 1];
    if (!e0 || !e1 || r + 1 - c.z <= NEAR || e1.sy >= e0.sy) continue; // behind the camera or the back of a crest
    const dz = e0.z - c.z;
    const rc = rowColors(s.course, r);
    const checker = dz < CHECKER_ROWS;
    const near = fogAt(dz) < 0.85;
    const lw = (w: number) => Math.max(1, Math.round(((w * c.F) / Math.max(1, r + 0.5 - c.z)) * 2) / 2);
    const gpt = (x: number, z: number): [number, number] => {
      const p = proj(c, x, heightAt(s.course, z) + 0.01, z);
      return [p[0], p[1]];
    };
    for (let col = 0; col < COLS; col++) {
      const kind = cellFor(s, r, col);
      let color: RGB | null;
      switch (kind) {
        case Cell.Gate:
          color = rc.gate;
          break;
        case Cell.Fast:
          color = rc.fast;
          break;
        case Cell.Crash:
          color = rc.hazard;
          break;
        case Cell.Slow:
          color = rc.slow;
          break;
        case Cell.Finish:
          color = (col & 1) === 0 ? FINISH_DARK : FINISH_LIGHT;
          break;
        default:
          color = checker && ((r + col) & 1) === 1 ? rc.g1 : null;
      }
      if (color && renderLayers.cells) cells.add(fillFor(color, c, 0), quad(e0, e1, col, col + 1));
      if (!near || !renderLayers.marks) continue;
      if (kind === Cell.Fast) {
        // two forward chevrons scrolling down the cell
        for (const base of [0, 0.5]) {
          const z = r + 0.04 + ((base + ph) % 1) * 0.5;
          arrows.add('rgba(255,255,255,0.95)', [...gpt(col + 0.18, z), ...gpt(col + 0.5, z + 0.3), ...gpt(col + 0.82, z), ...gpt(col + 0.82, z + 0.13), ...gpt(col + 0.5, z + 0.43), ...gpt(col + 0.18, z + 0.13)]);
        }
      } else if (kind === Cell.Slow) {
        for (const zz of [0.3, 0.65]) {
          const pts: number[] = [];
          for (let k = 0; k <= 8; k++) pts.push(...gpt(col + 0.08 + (k / 8) * 0.84, r + zz + Math.sin(k * 1.6) * 0.06));
          strokes.add(`rgba(41,24,8,0.55)|${lw(0.05)}`, pts);
        }
      } else if (kind === Cell.Crash) {
        // red corner brackets: "danger" even when the obstacle is low (lava, crevasse, crater)
        const k = 0.22;
        for (const [x0, z0, dx, dzz] of [
          [col + 0.06, r + 0.06, 1, 1],
          [col + 0.94, r + 0.06, -1, 1],
          [col + 0.06, r + 0.94, 1, -1],
          [col + 0.94, r + 0.94, -1, -1],
        ] as const)
          strokes.add(`rgba(220,38,38,0.9)|${lw(0.06)}`, [...gpt(x0 + dx * k, z0), ...gpt(x0, z0), ...gpt(x0, z0 + dzz * k)]);
      }
    }
    if (renderLayers.grid) {
      const line = `${rc.lineCss[10] ?? 'transparent'}|1`;
      lines.add(line, [X(e0, 0), e0.sy, X(e0, COLS), e0.sy]);
      for (let col = 1; col < COLS; col++) lines.add(line, [X(e0, col), e0.sy, X(e1, col), e1.sy]);
      const edge = `${rc.edgeCss[10] ?? 'transparent'}|2`;
      lines.add(edge, [X(e0, 0), e0.sy, X(e1, 0), e1.sy]);
      lines.add(edge, [X(e0, COLS), e0.sy, X(e1, COLS), e1.sy]);
    }
  }
  cells.fill(ctx);
  lines.stroke(ctx);
  arrows.fill(ctx);
  strokes.stroke(ctx);
}

/* ---------- per-row colours and cached fill strings (keeps the ground pass allocation-free) ---------- */

const FINISH_DARK: RGB = [17, 24, 39];
const FINISH_LIGHT: RGB = [248, 250, 252];
type RowColors = { g0: RGB; g1: RGB; side: RGB; gate: RGB; fast: RGB; slow: RGB; hazard: RGB; lineCss: string[]; edgeCss: string[] };
const rowCache = new WeakMap<Course, Map<number, RowColors>>();

function rowColors(course: Course, r: number): RowColors {
  let m = rowCache.get(course);
  if (!m) {
    m = new Map();
    rowCache.set(course, m);
  }
  let rc = m.get(r);
  if (!rc) {
    const bl = blendAt(course, r);
    const g0 = pick(bl, (p) => p.ground[0]);
    const line = mixRGB(rgbList(bl.a.line), rgbList(bl.b.line), bl.t).map(Math.round);
    const edge = pick(bl, (p) => p.edge).map(Math.round);
    const alphas = (rgbv: number[], a: number) => Array.from({ length: 11 }, (_, i) => `rgba(${rgbv.join(',')},${((a * i) / 10).toFixed(3)})`);
    rc = {
      g0,
      g1: pick(bl, (p) => p.ground[1]),
      side: pick(bl, (p) => p.side[0]),
      gate: mixRGB(g0, pick(bl, (p) => two(p.gate, course.gateRows.get(r) ?? 0)), 0.35),
      fast: mixRGB(pick(bl, (p) => p.fast), [34, 211, 238], 0.55),
      slow: mixRGB(g0, rgb(BIOMES[course.biomes[segmentOf(r)]].palette.slow), 0.45),
      hazard: mixRGB(g0, HAZARD, 0.32),
      lineCss: alphas(line, 0.45),
      edgeCss: alphas(edge, 0.6),
    };
    m.set(r, rc);
  }
  return rc;
}
const rgbList = (s: string): RGB => {
  const [a = 0, b = 0, d = 0] = s.split(',').map(Number);
  return [a, b, d];
};

/** Fill string for a colour faded into the current fog; fog is quantised to 1/24 steps so strings are reused. */
const fillCache = new Map<number, string>();
let fillFog = -1;
function fillFor(col: RGB, c: Cam, f: number): string {
  const fogStamp = (((c.fog[0] | 0) * 256 + (c.fog[1] | 0)) * 256 + (c.fog[2] | 0)) | 0;
  if (fogStamp !== fillFog || fillCache.size > 20000) {
    fillCache.clear();
    fillFog = fogStamp;
  }
  const fq = Math.round(f * 24);
  const key = ((((col[0] | 0) * 256 + (col[1] | 0)) * 256 + (col[2] | 0)) * 25 + fq) | 0;
  let v = fillCache.get(key);
  if (v === undefined) {
    v = css(col, 1, c.fog, fq / 24);
    fillCache.set(key, v);
  }
  return v;
}

/* ---------- billboards ---------- */

/** `smooth`: blend the two nearest pre-rendered yaw angles instead of snapping (the runner, while leaning). */
type BillboardOpts = { scale?: number; spin?: number; shadow?: number; alpha?: number; smooth?: boolean };

/**
 * Draw a baked voxel model standing at world (x, y, z): pick the view nearest to the angle the camera sees it from,
 * scale it by the same F / dz as the grid, then fade it into the fog.
 */
function billboard(ctx: CanvasRenderingContext2D, c: Cam, e: Entry, x: number, y: number, z: number, opt: BillboardOpts = {}): void {
  const dz = z - c.z;
  if (dz < NEAR + 0.2) return;
  const scale = opt.scale ?? 1;
  const lift = e.lift * scale;
  const yaw = -Math.atan2(x - c.x, dz) + (opt.spin ?? 0);
  const pitch = Math.atan2(c.y - (y + lift), dz);
  // smooth: the two neighbouring yaw buckets and how far we are between them
  const yf = yaw / YAW_STEP;
  const t = opt.smooth ? yf - Math.floor(yf) : 0;
  const v = viewOf(e, opt.smooth ? Math.floor(yf) * YAW_STEP : yaw, pitch);
  const v2 = t > 0.04 ? viewOf(e, (Math.floor(yf) + 1) * YAW_STEP, pitch) : null;
  const k = ((c.F / dz) * scale) / (VPC * v.k);
  if (opt.shadow) {
    const [gx, gy] = proj(c, x, y, z);
    const rx = (opt.shadow * c.F) / dz;
    ctx.fillStyle = 'rgba(15,23,42,0.28)';
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx, rx * Math.max(0.18, Math.sin(pitch)) * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const [sx, sy] = proj(c, x, y + lift, z);
  const dx = sx - v.ax * k;
  const dy = sy - v.ay * k;
  const w = v.w * k;
  const h = v.h * k;
  if (dx > c.w || dx + w < 0 || dy > c.h || dy + h < 0) return;
  if (opt.alpha !== undefined) ctx.globalAlpha = opt.alpha;
  ctx.drawImage(v.img, v.sx, v.sy, v.w, v.h, dx, dy, w, h);
  if (v2) {
    // cross-fade into the next angle (same anchor maths for its own size)
    const k2 = ((c.F / dz) * scale) / (VPC * v2.k);
    ctx.globalAlpha = t * (opt.alpha ?? 1);
    ctx.drawImage(v2.img, v2.sx, v2.sy, v2.w, v2.h, sx - v2.ax * k2, sy - v2.ay * k2, v2.w * k2, v2.h * k2);
  }
  ctx.globalAlpha = 1;
}

function drawRowObjects(ctx: CanvasRenderingContext2D, c: Cam, s: RunState, fx: Fx, r: number): void {
  if (r - c.z < NEAR) return;
  const course = s.course;
  const g = heightAt(course, r + 0.5);
  const biome = course.biomes[segmentOf(r)];
  const pal = BIOMES[biome].palette;
  const cellPx = c.F / (r + 0.5 - c.z);
  if (cellPx < 2.5) return; // too far to see anything
  const cols: number[] = [];
  for (let col = -SIDE; col < COLS + SIDE; col++) {
    const inside = col >= 0 && col < COLS;
    // off-track scenery lives only in the 2nd/3rd column out, and is skipped when tiny
    if (!inside && (col < -3 || col > COLS + 2 || cellPx < 5)) continue;
    const sx = c.cx + (col + 0.5 - c.x) * cellPx;
    if (sx < -cellPx * 1.5 || sx > c.w + cellPx * 1.5) continue;
    const k = inside ? cellFor(s, r, col) : decorAt(course, r, col);
    if (k === Cell.Crash || k === Cell.Pole || k === Cell.Ramp || k === Cell.Slow || k === Cell.Collect || k === Cell.Pickup) cols.push(col);
  }
  cols.sort((a, b) => Math.abs(b + 0.5 - c.x) - Math.abs(a + 0.5 - c.x));
  const z = r + 0.5;
  for (const col of cols) {
    const inside = col >= 0 && col < COLS;
    const k = inside ? cellFor(s, r, col) : decorAt(course, r, col);
    const x = col + 0.5;
    const kk = hash3(col, r, 5);
    switch (k) {
      case Cell.Crash:
        billboard(ctx, c, crashModel(biome, variant(course, r, col), kk), x, g, z, { shadow: 0.42, scale: inside ? 1 : 0.85 + kk * 0.3 });
        break;
      case Cell.Pole:
        billboard(ctx, c, poleModel(two(pal.gate, course.gateRows.get(r) ?? 0), cellFor(s, r, col + 1) === Cell.Gate), x, g, z);
        break;
      case Cell.Ramp:
        billboard(ctx, c, rampModel(pal.ramp[0], pal.ramp[1]), x, g, z, { shadow: 0.4 });
        break;
      case Cell.Slow:
        billboard(ctx, c, slowModel(biome), x, g, z);
        break;
      case Cell.Collect:
        billboard(ctx, c, collectModel(biome), x, g + 0.25 + Math.sin(fx.clock * 4 + r) * 0.06, z, { spin: fx.clock * 2.5 + r, shadow: 0.18, scale: 0.9 });
        break;
      case Cell.Pickup: {
        const p = course.pickups.find((q) => q.row === r && q.lane === col);
        billboard(ctx, c, pickupPadModel(), x, g, z);
        // light beam so pickups are visible from far away
        const [bx, by] = proj(c, x, g, z);
        const [, ty] = proj(c, x, g + 3.2, z);
        const bw = (0.5 * c.F) / (z - c.z);
        const grad = ctx.createLinearGradient(0, by, 0, ty);
        grad.addColorStop(0, 'rgba(250,204,21,0.55)');
        grad.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(bx - bw / 2, ty, bw, by - ty);
        if (p) billboard(ctx, c, vehicleModel(p.vehicle), x, g + 0.35 + Math.sin(fx.clock * 3) * 0.08, z, { spin: fx.clock * 1.8, scale: 0.6 });
        break;
      }
    }
  }
  if (r === FINISH_ROW) {
    box(ctx, c, -0.6, -0.3, g, g + 2.6, r, r + 0.3, '#334155');
    box(ctx, c, COLS + 0.3, COLS + 0.6, g, g + 2.6, r, r + 0.3, '#334155');
    box(ctx, c, -0.6, COLS + 0.6, g + 2.0, g + 2.6, r, r + 0.15, '#ea580c');
    const [sx, sy] = proj(c, COLS / 2, g + 2.3, r);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.max(6, (0.42 * c.F) / (r - c.z))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', sx, sy);
  }
}

/* ---------- runner ---------- */

function runnerHeight(s: RunState): number {
  // Ramp air: a parabola over AIR_ROWS rows. Rocket hops: an arc between landing rows.
  if (s.pos <= s.airUntil + 1 && s.airUntil >= 0) {
    const start = s.airUntil - AIR_ROWS;
    const t = Math.min(1, Math.max(0, (s.pos - start) / (AIR_ROWS + 1)));
    return 4 * (0.5 + AIR_ROWS * 0.12) * t * (1 - t);
  }
  const nr = nextRow(s);
  if (s.phase === 'run' && nr - s.row > 1) {
    const t = Math.min(1, Math.max(0, (s.pos - s.row) / (nr - s.row)));
    return 1.6 * 4 * t * (1 - t);
  }
  return 0;
}

function drawRunner(ctx: CanvasRenderingContext2D, c: Cam, s: RunState, fx: Fx): void {
  const x = fx.laneVis + 0.5;
  const z = s.pos;
  const ground = heightAt(s.course, z);
  const v = vehicleFor(s, Math.max(s.row, Math.floor(s.pos)));
  const entry = vehicleModel(v.id);
  if (s.phase === 'crash') {
    // wiped out: the vehicle spun sideways, half faded
    billboard(ctx, c, entry, x, ground, z, { spin: 1.4, alpha: 0.85, shadow: 0.45 });
    return;
  }
  const up = runnerHeight(s);
  const flying = up > 0.05 || entry.lift > 0;
  if (flying) {
    const [gx, gy] = proj(c, x, ground, z);
    const rx = (0.38 * c.F) / (z - c.z);
    ctx.fillStyle = 'rgba(15,23,42,0.25)';
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx, rx * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // lean into lane changes by turning the sprite slightly
  billboard(ctx, c, entry, x, ground + up, z, { spin: (fx.laneVis - s.lane) * 0.5, shadow: flying ? 0 : 0.4, smooth: true });
}

function drawParticles(ctx: CanvasRenderingContext2D, c: Cam, s: RunState, fx: Fx): void {
  for (const p of fx.particles) {
    const dz = p.z - c.z;
    if (dz < NEAR) continue;
    const [sx, sy] = proj(c, p.x, heightAt(s.course, p.z) + p.y, p.z);
    const r = (p.size * c.F) / dz;
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
}

function drawOverlays(ctx: CanvasRenderingContext2D, c: Cam, s: RunState, fx: Fx): void {
  // toasts float up from the runner
  const [px, py] = proj(c, fx.laneVis + 0.5, heightAt(s.course, s.pos) + 1.6 + runnerHeight(s), s.pos);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fx.toasts.forEach((t, i) => {
    const yy = Math.max(20, py - 18 - t.age * 40 - (fx.toasts.length - 1 - i) * 18);
    ctx.globalAlpha = Math.max(0, 1 - t.age / 1.1);
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(t.text, px, yy);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, px, yy);
  });
  ctx.globalAlpha = 1;
  if (fx.banner) {
    const a = Math.min(1, Math.min(fx.banner.age * 5, (1.5 - fx.banner.age) * 4));
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    const w = Math.min(c.w - 24, 300);
    ctx.beginPath();
    ctx.roundRect(c.w / 2 - w / 2, c.h * 0.12, w, 58, 10);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(fx.banner.title, c.w / 2, c.h * 0.12 + 21);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(fx.banner.sub, c.w / 2, c.h * 0.12 + 42);
    ctx.globalAlpha = 1;
  }
  if (fx.flash) {
    ctx.globalAlpha = Math.max(0, 0.45 - fx.flash.age);
    ctx.fillStyle = fx.flash.color;
    ctx.fillRect(0, 0, c.w, c.h);
    ctx.globalAlpha = 1;
  }
}

/* ---------- streaming: preload the biome ahead, drop what is behind ---------- */

/** Bring a segment's sprites in: the build-time atlas if there is one, otherwise bake the same catalog in idle time. */
function preloadSegment(course: Course, seg: 0 | 1 | 2): void {
  const biome = course.biomes[seg];
  void loadBiomeAtlas(biome).then((ok) => {
    if (!ok) for (const item of biomeCatalog(biome)) preloadViews(item.entry, item.views);
  });
}

/** Call once the day's course is known (e.g. while the preview is open): first two biomes start baking in idle time. */
export function prewarmCourse(course: Course): void {
  preloadSegment(course, 0);
  preloadSegment(course, 1);
}

const streams = new WeakMap<Course, { seg: number; frame: number }>();

/** Per-frame bookkeeping: on entering a segment, drop the passed biome and preload the next; prune row caches. */
function streamTick(course: Course, row: number): void {
  let st = streams.get(course);
  if (!st) {
    st = { seg: -1, frame: 0 };
    streams.set(course, st);
  }
  st.frame++;
  const seg = segmentOf(row);
  if (seg !== st.seg) {
    st.seg = seg;
    const passed = new Set<string>(course.biomes.slice(0, seg));
    evict((tag) => passed.has(tag)); // the road behind is gone: its sprites and fog tints are freed
    for (const b of passed) forgetBiomeAtlas(b as BiomeId);
    preloadSegment(course, seg);
    if (seg < 2) preloadSegment(course, (seg + 1) as 1 | 2);
  }
  if (st.frame % 120 === 0) {
    evict((tag, idle) => (tag === 'shared' || tag === 'vehicle') && idle > 20_000);
    const rows = rowCache.get(course);
    if (rows) for (const r of rows.keys()) if (r < row - 4) rows.delete(r);
  }
}

/* ---------- sky cache: gradient + stepped mountains change only when the camera slides or the biome blends ---------- */

let skyCanvas: HTMLCanvasElement | null = null;
let skyKey = '';
function drawSkyCached(ctx: CanvasRenderingContext2D, c: Cam, s: RunState): void {
  const dpr = ctx.getTransform().a || 1;
  const bl = blendAt(s.course, Math.floor(s.pos));
  const cell = Math.max(6, Math.round(c.w / 45));
  const key = `${c.w}x${c.h}@${dpr}|${Math.round(c.hy)}|${Math.round(c.x * cell * 0.6)}|${s.course.biomes.join()}|${segmentOf(Math.floor(s.pos))}|${bl.t.toFixed(2)}`;
  if (key !== skyKey || !skyCanvas) {
    skyCanvas ??= document.createElement('canvas');
    skyCanvas.width = Math.round(c.w * dpr);
    skyCanvas.height = Math.round(c.h * dpr);
    const g = skyCanvas.getContext('2d');
    if (g) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky(g, c, s);
    }
    skyKey = key;
  }
  ctx.drawImage(skyCanvas, 0, 0, c.w, c.h);
}

/* ---------- quality ---------- */

/** Draw distance in rows (adaptive quality lowers it on slow devices). */
export function setDrawDistance(rows: number): void {
  far = Math.max(24, Math.min(46, rows));
}

export function drawFrame(ctx: CanvasRenderingContext2D, s: RunState, fx: Fx, w: number, h: number): void {
  beginFrame(6); // at most ~6 ms of new sprite baking per frame; the rest waits for later frames
  streamTick(s.course, s.row);
  const c = makeCamera(s, fx, w, h);
  if (renderLayers.sky) drawSkyCached(ctx, c, s);
  const rStart = Math.floor(c.z + NEAR) - 1;
  const rEnd = Math.min(FINISH_ROW + 6, Math.floor(c.z + far));
  const runnerRow = Math.floor(s.pos - 0.6);
  drawGround(ctx, c, s, fx, rStart, rEnd);
  let fogged = false;
  for (let r = rEnd; r >= rStart; r--) {
    if (!fogged && r - c.z <= FOG_START) {
      if (renderLayers.fog) drawFog(ctx, c);
      fogged = true;
    }
    if (r === runnerRow) drawRunner(ctx, c, s, fx);
    if (renderLayers.objects) drawRowObjects(ctx, c, s, fx, r);
  }
  if (runnerRow < rStart) drawRunner(ctx, c, s, fx);
  drawParticles(ctx, c, s, fx);
  drawOverlays(ctx, c, s, fx);
}

