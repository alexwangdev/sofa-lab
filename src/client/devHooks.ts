/**
 * Dev-only window hooks for automated playtests and profiling. Loaded with a dynamic import behind
 * `import.meta.env.DEV`, so production builds do not contain this file at all.
 *
 *   __run()            the live RunState            __cache()        sprite cache stats
 *   __advance(row)     play on with the autopilot   __snap(name)     save a frame to .shots/name.jpg
 *   __bench(n, warm)   time drawFrame               __profile()      play a whole fresh run frame by frame and
 *                                                                    report sim/draw times and the worst frames
 */
import { decide } from '../shared/autopilot.ts';
import { newRun, startRun, step } from '../shared/sim.ts';
import type { RunState } from '../shared/sim.ts';
import type { Course } from '../shared/types.ts';
import { drawFrame, newFx, renderLayers } from './render.ts';
import type { Fx } from './render.ts';
import { bakeStats, cacheStats } from './voxel.ts';
import { loadBiomeAtlas } from './atlas.ts';

type Ctx = {
  course: Course;
  parSeconds: number;
  run: () => RunState;
  fx: () => Fx;
  applyEvent: (fx: Fx, s: RunState, e: RunState['events'][number]) => void;
  stepFx: (fx: Fx, s: RunState, dt: number) => void;
  onEnd: (s: RunState) => void;
  onTick: (s: RunState) => void;
};

function offscreen(): CanvasRenderingContext2D | null {
  const cv = document.createElement('canvas');
  cv.width = 688;
  cv.height = 1032;
  const g = cv.getContext('2d');
  g?.setTransform(2, 0, 0, 2, 0, 0);
  return g;
}

export function installDevHooks(c: Ctx): void {
  const w = window as unknown as Record<string, unknown>;
  w.__run = c.run;
  w.__cache = () => ({ ...cacheStats(), evicted: bakeStats.evicted, runtimeBakes: bakeStats.bakes });

  w.__advance = (toRow: number) => {
    const run = c.run();
    const fx = c.fx();
    if (run.phase === 'ready') startRun(run);
    for (let i = 0; i < 60 * 120 && run.phase === 'run' && run.row < toRow; i++) {
      step(run, 1 / 60, { fast: true, brake: false }, decide);
      for (const e of run.events) c.applyEvent(fx, run, e);
      run.events.length = 0;
      c.stepFx(fx, run, 1 / 60);
    }
    if (run.phase !== 'run') c.onEnd(run);
    c.onTick(run);
    return `${run.phase} row ${run.row} lane ${run.lane} t ${run.time.toFixed(1)} ${run.timed ?? ''}`;
  };

  w.__snap = async (name: string) => {
    const g = offscreen();
    if (!g) return 'no canvas';
    for (let i = 0; i < 40; i++) drawFrame(g, c.run(), c.fx(), 344, 516); // lets any missing sprite bake
    const res = await fetch(`/__dev/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: g.canvas.toDataURL('image/jpeg', 0.85) });
    return res.text();
  };

  w.__bench = (frames: number, warm: number) => {
    const g = offscreen();
    if (!g) return { ms: 0, bakes: 0, bakeMs: 0 };
    for (let i = 0; i < warm; i++) drawFrame(g, c.run(), c.fx(), 344, 516);
    const b0 = bakeStats.bakes;
    const m0 = bakeStats.ms;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) drawFrame(g, c.run(), c.fx(), 344, 516);
    return { ms: (performance.now() - t0) / frames, bakes: bakeStats.bakes - b0, bakeMs: bakeStats.ms - m0 };
  };

  /** A fresh run of today's course, start to finish at 60 Hz with the autopilot, every frame drawn and timed. */
  w.__layers = renderLayers;
  w.__profile = async (pilot = true) => {
    // the real game streams each atlas in ~9 s before its segment; a synchronous loop cannot wait, so load all three first
    await Promise.all(c.course.biomes.map((b) => loadBiomeAtlas(b)));
    const g = offscreen();
    if (!g) return 'no canvas';
    const s = newRun(c.course, c.parSeconds);
    const fx = newFx(s.lane);
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
    const probe = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!probe) return 'no probe';
    startRun(s);
    const frames: { row: number; sim: number; draw: number; bakes: number }[] = [];
    for (let i = 0; i < 60 * 120 && s.phase === 'run'; i++) {
      const b0 = bakeStats.bakes;
      const t0 = performance.now();
      step(s, 1 / 60, { fast: true, brake: false }, pilot ? decide : undefined);
      for (const e of s.events) c.applyEvent(fx, s, e);
      s.events.length = 0;
      c.stepFx(fx, s, 1 / 60);
      const t1 = performance.now();
      drawFrame(g, s, fx, 344, 516);
      // force this frame's GPU work to finish (copy into a 1×1 canvas and read that, so the main canvas stays on the GPU)
      probe.drawImage(g.canvas, 0, 0, 1, 1);
      probe.getImageData(0, 0, 1, 1);
      const t2 = performance.now();
      frames.push({ row: s.row, sim: t1 - t0, draw: t2 - t1, bakes: bakeStats.bakes - b0 });
    }
    const pct = (xs: number[], p: number) => {
      const a = [...xs].sort((x, y) => x - y);
      return Math.round((a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0) * 100) / 100;
    };
    const total = frames.map((f) => f.sim + f.draw);
    const worst = frames
      .map((f, i) => ({ i, row: f.row, ms: Math.round((f.sim + f.draw) * 100) / 100, sim: Math.round(f.sim * 100) / 100, bakes: f.bakes }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8);
    return {
      phase: s.phase,
      frames: frames.length,
      total: { avg: Math.round((total.reduce((a, b) => a + b, 0) / total.length) * 100) / 100, p95: pct(total, 0.95), p99: pct(total, 0.99), max: pct(total, 1) },
      sim: { avg: Math.round((frames.reduce((a, f) => a + f.sim, 0) / frames.length) * 100) / 100, p99: pct(frames.map((f) => f.sim), 0.99) },
      over16ms: total.filter((t) => t > 16.7).length,
      runtimeBakes: frames.reduce((a, f) => a + f.bakes, 0),
      worst,
    };
  };
}

/** Per-frame perf readout for the live loop (window.__perf). */
export function recordFrame(spentMs: number): void {
  const w = window as unknown as { __perf?: { avg: number; frames: number; bakes: number; bakeMs: number } };
  const p = (w.__perf ??= { avg: 0, frames: 0, bakes: 0, bakeMs: 0 });
  p.avg = p.frames === 0 ? spentMs : p.avg * 0.9 + spentMs * 0.1;
  p.frames++;
  p.bakes = bakeStats.bakes;
  p.bakeMs = Math.round(bakeStats.ms);
}
