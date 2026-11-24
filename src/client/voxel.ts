/**
 * Voxel modelling kit + sprite baker.
 *
 * Models are built from a few basic shapes (box, cylinder, ellipsoid, cone) in a voxel grid, VPC voxels per track
 * cell. Each model is baked once per view angle into an offscreen canvas (orthographic, lit, faces sorted far → near)
 * and drawn at run time as a billboard scaled by the same perspective factor as the grid (F / dz). That is the
 * classic pseudo-3D racer trick: detailed sprites, cheap frames, and the world underneath is still the grid.
 *
 * Model coordinates are centred: x ∈ [-W/2, W/2) left → right, y ∈ [0, H) up, z ∈ [-D/2, D/2) back → front
 * (+z = down the track, away from the camera). The model's origin (0, 0, 0) is the centre of its footprint.
 */

/** Voxels per track cell. */
export const VPC = 12;

export class Model {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly cells: Uint16Array;
  readonly pal: string[] = [''];
  private readonly palIdx = new Map<string, number>();
  /** Extra height (cells) the whole sprite floats at (flyers). */
  lift = 0;

  constructor(w: number, h: number, d: number) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.cells = new Uint16Array(w * h * d);
  }

  private ci(color: string): number {
    let i = this.palIdx.get(color);
    if (i === undefined) {
      i = this.pal.length;
      this.pal.push(color);
      this.palIdx.set(color, i);
    }
    return i;
  }
  private idx(x: number, y: number, z: number): number {
    const ix = Math.floor(x + this.w / 2);
    const iy = Math.floor(y);
    const iz = Math.floor(z + this.d / 2);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.w || iy >= this.h || iz >= this.d) return -1;
    return (iy * this.d + iz) * this.w + ix;
  }
  get(x: number, y: number, z: number): number {
    const i = this.idx(x, y, z);
    return i < 0 ? 0 : (this.cells[i] ?? 0);
  }
  set(x: number, y: number, z: number, color: string | null): this {
    const i = this.idx(x, y, z);
    if (i >= 0) this.cells[i] = color === null ? 0 : this.ci(color);
    return this;
  }

  /** Visit every voxel centre inside [x0,x1) × [y0,y1) × [z0,z1). */
  private each(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, f: (x: number, y: number, z: number) => void): void {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let z = Math.floor(z0); z < Math.ceil(z1); z++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) f(x, y, z);
  }

  /** Axis-aligned box, half-open ranges. `null` carves. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string | null): this {
    this.each(x0, x1, y0, y1, z0, z1, (x, y, z) => this.set(x, y, z, color));
    return this;
  }
  /** Ellipsoid centred at (cx, cy, cz). `paint` may pick a colour per voxel. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: string | null | ((x: number, y: number, z: number) => string | null)): this {
    this.each(cx - rx, cx + rx, cy - ry, cy + ry, cz - rz, cz + rz, (x, y, z) => {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, typeof color === 'function' ? color(x, y, z) : color);
    });
    return this;
  }
  /** Cylinder along an axis: `a0..a1` on that axis, centre (u, v) on the other two (x/z for y, y/z for x, x/y for z). */
  cyl(axis: 'x' | 'y' | 'z', u: number, v: number, r: number, a0: number, a1: number, color: string | null, hollow = 0): this {
    const inside = (p: number, q: number) => {
      const d = Math.hypot(p, q);
      return d <= r && d >= hollow;
    };
    if (axis === 'y') this.each(u - r, u + r, a0, a1, v - r, v + r, (x, y, z) => inside(x + 0.5 - u, z + 0.5 - v) && this.set(x, y, z, color));
    if (axis === 'x') this.each(a0, a1, u - r, u + r, v - r, v + r, (x, y, z) => inside(y + 0.5 - u, z + 0.5 - v) && this.set(x, y, z, color));
    if (axis === 'z') this.each(u - r, u + r, v - r, v + r, a0, a1, (x, y, z) => inside(x + 0.5 - u, y + 0.5 - v) && this.set(x, y, z, color));
    return this;
  }
  /** Cone / frustum standing on y0: radius r0 at y0 → r1 at y1. */
  cone(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, color: string | ((x: number, y: number, z: number) => string)): this {
    const rm = Math.max(r0, r1);
    this.each(cx - rm, cx + rm, y0, y1, cz - rm, cz + rm, (x, y, z) => {
      const t = (y + 0.5 - y0) / (y1 - y0);
      const r = r0 + (r1 - r0) * t;
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) this.set(x, y, z, typeof color === 'function' ? color(x, y, z) : color);
    });
    return this;
  }
  /** A 1-voxel line between two points (ropes, poles, frame tubes). */
  line(a: [number, number, number], b: [number, number, number], color: string, thick = 0): this {
    const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      if (thick > 0) this.box(x - thick, x + thick, y - thick, y + thick, z - thick, z + thick, color);
      else this.set(x, y, z, color);
    }
    return this;
  }
  /** Mirror the x < 0 half onto x ≥ 0 (model one side, get both). */
  mirrorX(): this {
    for (let y = 0; y < this.h; y++)
      for (let z = 0; z < this.d; z++)
        for (let x = 0; x < this.w / 2; x++) {
          const a = (y * this.d + z) * this.w + x;
          const b = (y * this.d + z) * this.w + (this.w - 1 - x);
          if (this.cells[a]) this.cells[b] = this.cells[a] ?? 0;
        }
    return this;
  }
  /** Repaint filled voxels where `pred` holds. */
  paint(pred: (x: number, y: number, z: number, color: string) => string | undefined): this {
    for (let y = 0; y < this.h; y++)
      for (let z = 0; z < this.d; z++)
        for (let x = 0; x < this.w; x++) {
          const i = (y * this.d + z) * this.w + x;
          const c = this.cells[i] ?? 0;
          if (!c) continue;
          const next = pred(x - this.w / 2, y, z - this.d / 2, this.pal[c] ?? '#000');
          if (next) this.cells[i] = this.ci(next);
        }
    return this;
  }
}

// ---------- baking ----------

/** A sprite ready to draw: a rectangle inside an image (its own canvas, or a page of a build-time atlas). */
type Baked = {
  img: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Pixel position of the model origin (footprint centre on the ground) inside the rectangle. */
  ax: number;
  ay: number;
  /** Pixels per voxel. */
  k: number;
};

/** The same sprite as raw RGBA (no DOM): what the build-time atlas baker and the runtime fallback both produce. */
export type Raster = { w: number; h: number; data: Uint8ClampedArray; ax: number; ay: number; k: number };

export type RGB = [number, number, number];
const rgbCache = new Map<string, RGB>();
/** "#rrggbb" → [r, g, b], cached. */
export function rgb(hex: string): RGB {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = Number.parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}
const jitter = (x: number, y: number, z: number): number => {
  let h = Math.imul(x * 73856093, 1) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const NORMALS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const LIGHT = (() => {
  const v = [-0.45, 1, -0.55];
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return v.map((x) => x / l) as [number, number, number];
})();

/** Fill a convex quad into an RGBA buffer (pixel centres inside, edges grown by `grow` px so faces seal). */
function fillQuad(buf: Uint8ClampedArray, W: number, H: number, p: number[], r: number, g: number, b: number, grow: number): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const x = p[i] ?? 0;
    const y = p[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX - grow));
  const x1 = Math.min(W - 1, Math.ceil(maxX + grow));
  const y0 = Math.max(0, Math.floor(minY - grow));
  const y1 = Math.min(H - 1, Math.ceil(maxY + grow));
  // winding sign, so "inside" is the same side of every edge
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += (p[i * 2] ?? 0) * (p[j * 2 + 1] ?? 0) - (p[j * 2] ?? 0) * (p[i * 2 + 1] ?? 0);
  }
  if (Math.abs(area) < 1e-6) return;
  const sgn = area > 0 ? 1 : -1;
  const ex: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ax = p[i * 2] ?? 0;
    const ay = p[i * 2 + 1] ?? 0;
    const dx = (p[j * 2] ?? 0) - ax;
    const dy = (p[j * 2 + 1] ?? 0) - ay;
    const len = Math.hypot(dx, dy) || 1;
    ex.push(ax, ay, dx, dy, len);
  }
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      let inside = true;
      for (let e = 0; e < 20; e += 5) {
        const c = ((ex[e + 2] ?? 0) * (cy - (ex[e + 1] ?? 0)) - (ex[e + 3] ?? 0) * (cx - (ex[e] ?? 0))) * sgn;
        if (c < -grow * (ex[e + 4] ?? 1)) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      const o = (y * W + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
}

/**
 * Rasterise a model as seen from a camera that sits behind it (−z), `pitch` radians above, `yaw` radians to its right
 * (+x). Orthographic; `k` pixels per voxel; faces painted far → near. Pure JS: runs in Node (atlas build) and browsers.
 */
function rasterize(m: Model, yaw: number, pitch: number, k: number): Raster {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const f: [number, number, number] = [-Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp]; // view direction
  const r: [number, number, number] = [f[2], 0, -f[0]];
  const rl = Math.hypot(r[0], r[2]);
  r[0] /= rl;
  r[2] /= rl;
  const u: [number, number, number] = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const P = (x: number, y: number, z: number): [number, number] => [(x * r[0] + y * r[1] + z * r[2]) * k, -(x * u[0] + y * u[1] + z * u[2]) * k];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [-m.w / 2, m.w / 2])
    for (const y of [0, m.h])
      for (const z of [-m.d / 2, m.d / 2]) {
        const p = P(x, y, z);
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
  const pad = 1;
  const W = Math.max(1, Math.ceil(maxX - minX) + pad * 2);
  const H = Math.max(1, Math.ceil(maxY - minY) + pad * 2);
  const ox = pad - minX;
  const oy = pad - minY;
  const data = new Uint8ClampedArray(W * H * 4);

  type Face = { depth: number; pts: number[]; c: RGB };
  const faces: Face[] = [];
  const vis = NORMALS.filter((n) => n[0] * f[0] + n[1] * f[1] + n[2] * f[2] < 0);
  for (let iy = 0; iy < m.h; iy++)
    for (let iz = 0; iz < m.d; iz++)
      for (let ix = 0; ix < m.w; ix++) {
        const ci = m.cells[(iy * m.d + iz) * m.w + ix] ?? 0;
        if (!ci) continue;
        const x = ix - m.w / 2;
        const z = iz - m.d / 2;
        const base = rgb(m.pal[ci] ?? '#ff00ff');
        const j = 0.93 + 0.1 * jitter(ix, iy, iz);
        for (const n of vis) {
          if (m.get(x + n[0], iy + n[1], z + n[2])) continue;
          const cx = x + 0.5 + n[0] * 0.5;
          const cy = iy + 0.5 + n[1] * 0.5;
          const cz = z + 0.5 + n[2] * 0.5;
          // two tangent half-vectors spanning the face
          const a = n[0] ? [0, 0.5, 0] : [0.5, 0, 0];
          const b = n[2] ? [0, 0.5, 0] : [0, 0, 0.5];
          const pts: number[] = [];
          for (const [sa, sb] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ] as const) {
            const q = P(cx + sa * (a[0] ?? 0) + sb * (b[0] ?? 0), cy + sa * (a[1] ?? 0) + sb * (b[1] ?? 0), cz + sa * (a[2] ?? 0) + sb * (b[2] ?? 0));
            pts.push(q[0] + ox, q[1] + oy);
          }
          const lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
          const s = (0.52 + 0.55 * lam) * j;
          faces.push({ depth: cx * f[0] + cy * f[1] + cz * f[2], pts, c: [Math.min(255, base[0] * s), Math.min(255, base[1] * s), Math.min(255, base[2] * s)] });
        }
      }
  faces.sort((p, q) => q.depth - p.depth);
  for (const fc of faces) fillQuad(data, W, H, fc.pts, fc.c[0], fc.c[1], fc.c[2], 0.35);
  return { w: W, h: H, data, ax: ox, ay: oy, k };
}

/** Rasterise into a canvas (runtime fallback when no atlas view exists, and gallery thumbnails). */
export function bake(m: Model, yaw: number, pitch: number, k: number): Baked {
  const r = rasterize(m, yaw, pitch, k);
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(r.data as unknown as Uint8ClampedArray<ArrayBuffer>, r.w, r.h), 0, 0);
  return { img: canvas, sx: 0, sy: 0, w: r.w, h: r.h, ax: r.ax, ay: r.ay, k };
}

// ---------- cache: stream in what is coming, drop what is behind ----------

export const YAW_STEP = (10 * Math.PI) / 180;
const PITCH_STEP = (8 * Math.PI) / 180;
/** Max canvas pixels per voxel (near views, gallery thumbnails). */
const MAX_K = 4;

/**
 * Bake resolution for a pitch bucket. The camera looks down at ~atan(4.6 / dz), so a small pitch means a far object
 * that covers few screen pixels; baking it at full resolution would only waste memory. 7.2·tan(pitch) ≈ screen
 * pixels per voxel on a 480 px wide, 2× DPR canvas.
 */
export const kForPitch = (pi: number): number => Math.max(1, Math.min(MAX_K, Math.ceil(7.2 * Math.tan(pi * PITCH_STEP) - 0.2)));

/**
 * One model and its baked views. The voxel model is built lazily (an atlas-backed entry may never need it).
 * `tag` groups models for eviction: a biome id, or "vehicle" / "shared". `complete` = all views it will ever
 * need came from the build-time atlas, so a missing angle uses the nearest view instead of baking.
 */
export class Entry {
  readonly key: string;
  readonly tag: string;
  readonly views = new Map<number, Baked>();
  lastUsed = 0;
  alive = true;
  complete = false;
  /** Set from the atlas so drawing never has to build the model just to read it. */
  liftCells: number | null = null;
  private readonly build: () => Model;
  private built: Model | null = null;
  constructor(key: string, tag: string, build: () => Model) {
    this.key = key;
    this.tag = tag;
    this.build = build;
  }
  get model(): Model {
    this.built ??= this.build();
    return this.built;
  }
  get lift(): number {
    return this.liftCells ?? this.model.lift;
  }
}
const cache = new Map<string, Entry>();
export const viewKey = (yi: number, pi: number, k: number): number => ((yi + 64) * 64 + pi) * 8 + k;

/** Register (or look up) a model by key; `build` runs only once per key (until evicted). */
export function modelFor(key: string, build: () => Model, tag = 'shared'): Entry {
  let e = cache.get(key);
  if (!e) {
    e = new Entry(key, tag, build);
    e.lastUsed = performance.now();
    cache.set(key, e);
  }
  return e;
}

/** Bake counters (debugging / perf checks). */
export const bakeStats = { bakes: 0, ms: 0, evicted: 0, queued: 0 };

/** Bake budget: once a frame has spent this many ms baking, reuse the nearest view already baked instead. */
let budgetEnd = Number.POSITIVE_INFINITY;
export function beginFrame(budgetMs: number): void {
  budgetEnd = performance.now() + budgetMs;
}

export function buckets(yaw: number, pitch: number): [number, number] {
  const wrapped = ((((yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return [Math.round(wrapped / YAW_STEP), Math.round(Math.max(0.12, Math.min(1.2, pitch)) / PITCH_STEP)];
}

function bakeInto(e: Entry, yi: number, pi: number, k: number): Baked {
  const t0 = performance.now();
  const v = bake(e.model, yi * YAW_STEP, pi * PITCH_STEP, k);
  bakeStats.bakes++;
  bakeStats.ms += performance.now() - t0;
  e.views.set(viewKey(yi, pi, k), v);
  return v;
}

/** Rasterise one view bucket of a model (used by the atlas build script). */
export const rasterView = (m: Model, yi: number, pi: number, k: number): Raster => rasterize(m, yi * YAW_STEP, pi * PITCH_STEP, k);

/** The baked view nearest to (yaw, pitch). `k` forces a resolution and an exact bake (thumbnails). */
export function viewOf(e: Entry, yaw: number, pitch: number, k?: number): Baked {
  e.lastUsed = performance.now();
  const [yi, pi] = buckets(yaw, pitch);
  const kk = k ?? kForPitch(pi);
  const v = e.views.get(viewKey(yi, pi, kk));
  if (v) return v;
  if (k === undefined && e.views.size > 0 && (e.complete || performance.now() > budgetEnd)) {
    // over budget this frame: show the nearest view we already have; the idle pump bakes the right one
    let best: Baked | undefined;
    let bd = Infinity;
    for (const [key, b] of e.views) {
      const by = Math.floor(key / 512) - 64;
      const bp = Math.floor(key / 8) % 64;
      const d = Math.abs(by - yi) + Math.abs(bp - pi);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!e.complete) enqueue(e, yi, pi, kk);
    if (best) return best;
  }
  return bakeInto(e, yi, pi, kk);
}

// ---------- preload queue, baked in idle time ----------

type Job = { e: Entry; yi: number; pi: number; k: number };
const queue: Job[] = [];
const queued = new Set<string>();
const jobKey = (j: Job): string => `${j.e.key}|${viewKey(j.yi, j.pi, j.k)}`;

function enqueue(e: Entry, yi: number, pi: number, k: number): void {
  if (e.views.has(viewKey(yi, pi, k))) return;
  const job = { e, yi, pi, k };
  const key = jobKey(job);
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(job);
  bakeStats.queued = queue.length;
  schedulePump();
}

/** Queue exact view buckets [yi, pi, k] (from the catalog); they bake in idle time. */
export function preloadViews(e: Entry, views: readonly (readonly [number, number, number])[]): void {
  for (const [yi, pi, k] of views) enqueue(e, yi, pi, k);
}

let pumping = false;
type IdleDeadline = { timeRemaining: () => number };
type Ric = (cb: (d: IdleDeadline) => void, opts?: { timeout: number }) => number;
const ric: Ric | undefined = (globalThis as unknown as { requestIdleCallback?: Ric }).requestIdleCallback;

function schedulePump(): void {
  if (pumping || queue.length === 0) return;
  pumping = true;
  const run = (remaining: () => number) => {
    pumping = false;
    while (queue.length > 0 && remaining() > 2) {
      const j = queue.shift();
      if (!j) break;
      queued.delete(jobKey(j));
      if (!j.e.alive || j.e.views.has(viewKey(j.yi, j.pi, j.k))) continue; // evicted meanwhile, or already baked
      bakeInto(j.e, j.yi, j.pi, j.k);
    }
    bakeStats.queued = queue.length;
    schedulePump();
  };
  if (ric) ric((d) => run(() => d.timeRemaining()), { timeout: 250 });
  else {
    // Safari has no requestIdleCallback: bake in small slices between frames
    setTimeout(() => {
      const end = performance.now() + 5;
      run(() => end - performance.now());
    }, 30);
  }
}

// ---------- eviction ----------

/**
 * Drop models for which `drop(tag, msSinceLastUse)` is true, with every baked view and fog tint of them (their
 * canvases become garbage). A model that is needed again later is simply rebuilt.
 */
export function evict(drop: (tag: string, idleMs: number) => boolean): number {
  const now = performance.now();
  let n = 0;
  for (const [key, e] of cache) {
    if (drop(e.tag, now - e.lastUsed)) {
      e.alive = false;
      e.views.clear();
      cache.delete(key);
      n++;
    }
  }
  if (n > 0) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i];
      if (j && !j.e.alive) {
        queue.splice(i, 1);
        queued.delete(jobKey(j));
      }
    }
    bakeStats.queued = queue.length;
  }
  bakeStats.evicted += n;
  return n;
}

/** Cache size, for the dev perf readout. */
export function cacheStats(): { models: number; views: number; megapixels: number; queued: number } {
  let views = 0;
  let pixels = 0;
  for (const e of cache.values())
    for (const v of e.views.values()) {
      views++;
      pixels += v.w * v.h;
    }
  return { models: cache.size, views, megapixels: Math.round(pixels / 1e4) / 100, queued: queue.length };
}

