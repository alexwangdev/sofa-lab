/** Canvas render + input + run loop (spec §11, §14). The run itself lives in shared/sim.ts. */
import { memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, Ref } from 'react';
import { BIOMES } from '../shared/biomes.ts';
import { segmentOf } from '../shared/grid.ts';
import { IN, TICK, heldCodes, newRun, startRun, tick } from '../shared/sim.ts';
import { decide } from '../shared/autopilot.ts';
import type { GameEvent, RunState } from '../shared/sim.ts';
import { vehicle } from '../shared/vehicles.ts';
import type { Course } from '../shared/types.ts';
import { drawFrame, newFx, setDrawDistance } from './render.ts';
import { readyToStart } from './atlas.ts';
import { installSfx, sfxEvent, sfxFrame, sfxQuiet } from './sfx.ts';
import { musicFrame, musicQuiet } from './music.ts';

/**
 * Adaptive quality: if drawing stays slow, step down (pixel ratio, draw distance); step back up when it is fast again.
 * Tier 0 = full quality.
 */
const TIERS = [
  { dpr: 2, far: 46 },
  { dpr: 1.5, far: 40 },
  { dpr: 1, far: 32 },
] as const;
/** Dev-only per-frame perf hook (set once devHooks.ts is loaded). */
let devFrame: ((ms: number) => void) | null = null;

const SLOW_MS = 11;
const FAST_MS = 4;
import type { Fx } from './render.ts';

export type CanvasHandle = {
  steer: (dir: -1 | 1) => void;
  hold: (key: 'fast' | 'brake', on: boolean) => void;
  start: () => void;
  /** Pause / resume a run in progress. */
  setPaused: (on: boolean) => void;
};

type Props = {
  course: Course;
  parSeconds: number;
  autoStart: boolean;
  /** Auto mode: the autopilot steers and holds Tuck (testing / watching full runs). */
  autoPilot?: boolean;
  /** ~10 Hz snapshot for the HUD / minimap. */
  onTick: (s: RunState) => void;
  onEnd: (s: RunState) => void;
  /** Space / tap after the run is over. */
  onRetry: () => void;
  ref?: Ref<CanvasHandle>;
};

const REPEAT_DELAY = 0.2;
const REPEAT_EVERY = 0.11;
const DRAG_LANE = 34;

function applyEvent(fx: Fx, s: RunState, e: GameEvent): void {
  const toast = (text: string, color: string) => {
    fx.toasts.push({ text, color, age: 0 });
    if (fx.toasts.length > 4) fx.toasts.shift();
  };
  const burst = (n: number, colors: string[], power: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = power * (0.4 + Math.random());
      fx.particles.push({
        x: fx.laneVis + 0.5,
        y: 0.4,
        z: s.pos,
        vx: Math.cos(a) * v,
        vy: 1.5 + Math.random() * 3 * power,
        vz: Math.sin(a) * v + s.speed * 0.3,
        life: 0.8 + Math.random() * 0.6,
        color: colors[i % colors.length] ?? '#fff',
        size: 0.08 + Math.random() * 0.1,
      });
    }
  };
  const pal = BIOMES[s.course.biomes[segmentOf(e.row)]].palette;
  switch (e.kind) {
    case 'gate':
      toast(`GATE +${e.points}`, '#2563eb');
      break;
    case 'missed':
      toast('MISSED', '#64748b');
      break;
    case 'pole':
      toast('POLE!', '#dc2626');
      break;
    case 'collect':
      toast('+10', '#ca8a04');
      break;
    case 'air':
      toast(`AIR +${e.points}`, '#0284c7');
      break;
    case 'break':
      toast('SMASH +5', '#b45309');
      burst(14, [pal.hazard, '#f5f5f4'], 1.4);
      break;
    case 'slow':
      toast('SLOW', '#64748b');
      break;
    case 'fast':
      toast('BOOST', '#0891b2');
      break;
    case 'pickup':
      if (e.vehicle) toast(`${vehicle(e.vehicle).name.toUpperCase()}!`, '#a16207');
      burst(16, ['#facc15', '#fef9c3'], 1.2);
      break;
    case 'expire':
      toast(`${vehicle(BIOMES[s.course.biomes[segmentOf(e.row)]].base).name} again`, '#475569');
      break;
    case 'biome': {
      const b = BIOMES[s.course.biomes[segmentOf(e.row)]];
      fx.banner = { title: `${b.name} — ${vehicle(b.base).name}`, sub: `Segment ${segmentOf(e.row) + 1} of 3`, age: 0 };
      break;
    }
    case 'crash':
      fx.flash = { color: '#dc2626', age: 0 };
      fx.shake = 0.5;
      toast('CRASH!', '#dc2626');
      burst(36, ['#f8fafc', '#e2e8f0', '#ea580c'], 2);
      break;
    case 'finish':
      fx.flash = { color: '#16a34a', age: 0 };
      toast('FINISH!', '#16a34a');
      burst(40, ['#facc15', '#16a34a', '#2563eb', '#ea580c'], 2.5);
      break;
  }
}

function stepFx(fx: Fx, s: RunState, dt: number): void {
  fx.clock += dt;
  for (const p of fx.particles) {
    p.vy -= 9 * dt;
    p.x += p.vx * dt;
    p.y = Math.max(0, p.y + p.vy * dt);
    p.z += p.vz * dt;
    p.life -= dt;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  for (const t of fx.toasts) t.age += dt;
  fx.toasts = fx.toasts.filter((t) => t.age < 1.1);
  if (fx.banner && (fx.banner.age += dt) > 1.5) fx.banner = null;
  if (fx.flash && (fx.flash.age += dt) > 0.5) fx.flash = null;
  fx.shake = Math.max(0, fx.shake - dt);
  fx.laneVis += (s.lane - fx.laneVis) * Math.min(1, dt * 16);
  if (s.phase === 'run' && s.speed > 6 && Math.random() < (s.speed - 5) * dt * 5) {
    const side = Math.random() < 0.5 ? -0.15 : 0.15;
    fx.particles.push({ x: fx.laneVis + 0.5 + side, y: 0.05, z: s.pos - 0.4, vx: side * 4, vy: 1 + Math.random() * 1.5, vz: s.speed * 0.6, life: 0.35 + Math.random() * 0.25, color: 'rgba(255,255,255,0.85)', size: 0.06 + Math.random() * 0.06 });
  }
}

/** Memoised: the HUD re-renders App ~10×/s and must not re-render the canvas component with it. */
export const ExpeditionCanvas = memo(function ExpeditionCanvas({ course, parSeconds, autoStart, autoPilot = false, onTick, onEnd, onRetry, ref }: Props) {
  const pilotRef = useRef(autoPilot);
  pilotRef.current = autoPilot;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef<RunState>(newRun(course, parSeconds));
  const fxRef = useRef<Fx>(newFx(runRef.current.lane));
  const held = useRef({ fast: false, brake: false, dragFast: false, dragBrake: false });
  const keySteer = useRef<{ dir: -1 | 1; next: number } | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; lanes: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [tier, setTier] = useState(0);
  /** Lane inputs waiting for the next fixed tick (IN.left / IN.right). */
  const inputQ = useRef<number[]>([]);
  const pausedRef = useRef(false);
  const [paused, setPausedState] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  /** Retry: start by itself as soon as the first biome's models are in. */
  const autoStartRef = useRef(false);
  const cb = useRef({ onTick, onEnd, onRetry });
  useEffect(() => {
    cb.current = { onTick, onEnd, onRetry };
  });

  useEffect(() => {
    const s = newRun(course, parSeconds);
    runRef.current = s;
    fxRef.current = newFx(s.lane);
    inputQ.current.length = 0;
    pausedRef.current = false;
    setPausedState(false);
    autoStartRef.current = autoStart;
    cb.current.onTick(s);
    if (import.meta.env.DEV)
      void import('./devHooks.ts').then((d) => {
        devFrame = d.recordFrame;
        d.installDevHooks({ course, parSeconds, run: () => runRef.current, fx: () => fxRef.current, applyEvent, stepFx, onEnd: (r) => cb.current.onEnd(r), onTick: (r) => cb.current.onTick(r) });
      });
  }, [course, parSeconds, autoStart]);

  const doStart = () => {
    const s = runRef.current;
    if (s.phase === 'ready') {
      if (!readyToStart(s.course.biomes[0])) return; // first biome still downloading (the overlay says so)
      startRun(s);
      cb.current.onTick(s);
    } else if (s.phase !== 'run') cb.current.onRetry();
  };
  // inputs go through the next fixed tick so they land in the input log the server replays
  const steer = (dir: -1 | 1) => {
    if (runRef.current.phase === 'run' && !pausedRef.current && !pilotRef.current) inputQ.current.push(dir < 0 ? IN.left : IN.right);
  };
  const setPaused = (on: boolean) => {
    const want = on && runRef.current.phase === 'run';
    if (want === pausedRef.current) return;
    pausedRef.current = want;
    setPausedState(want);
    inputQ.current.length = 0;
    keySteer.current = null;
    Object.assign(held.current, { fast: false, brake: false, dragFast: false, dragBrake: false });
  };

  useImperativeHandle(ref, () => ({
    steer,
    hold: (key, on) => {
      held.current[key] = on;
    },
    start: doStart,
    setPaused,
  }));

  // canvas 360–480 px wide, ~3:2 tall, bounded by the viewport
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.min(480, Math.floor(el.clientWidth));
      const h = Math.max(300, Math.min(Math.round(w * 1.5), window.innerHeight - 250));
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    installSfx();
    const q = TIERS[tier] ?? TIERS[0];
    const k = Math.min(q.dpr, window.devicePixelRatio || 1);
    setDrawDistance(q.far);
    let ema = 0;
    let slowFrames = 0;
    let fastFrames = 0;
    canvas.width = Math.round(size.w * k);
    canvas.height = Math.round(size.h * k);
    let raf = 0;
    let last = performance.now();
    let tickAt = 0;
    /** Sim time not yet run as fixed ticks, and the position before the last tick (to draw between ticks). */
    let acc = 0;
    let prevPos = runRef.current.pos;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = runRef.current;
      const fx = fxRef.current;
      const before = s.phase;
      const h = held.current;
      const pilot = pilotRef.current;
      if ((pilot || autoStartRef.current) && s.phase === 'ready' && readyToStart(s.course.biomes[0])) {
        autoStartRef.current = false;
        startRun(s);
        cb.current.onTick(s);
      }
      if (pausedRef.current && s.phase !== 'run') setPaused(false); // a run that ended cannot stay paused
      // dev-only: automated playtests can freeze the sim (window.__pause) while they inspect a frame
      const frozen = pausedRef.current || (import.meta.env.DEV && (window as unknown as { __pause?: boolean }).__pause === true);
      if (s.phase === 'run' && !frozen) {
        const ks = keySteer.current;
        if (ks && fx.clock >= ks.next) {
          steer(ks.dir);
          ks.next = fx.clock + REPEAT_EVERY;
        }
        acc += dt;
        while (acc >= TICK && s.phase === 'run') {
          acc -= TICK;
          prevPos = s.pos;
          const fast = pilot || h.fast || h.dragFast;
          const brake = !pilot && (h.brake || h.dragBrake);
          const codes = [...inputQ.current, ...heldCodes(s, fast, brake)];
          inputQ.current.length = 0;
          tick(s, codes, pilot ? decide : undefined);
        }
      } else {
        acc = 0;
        prevPos = s.pos;
        inputQ.current.length = 0;
      }
      if ((s.phase === 'run') !== runningRef.current) {
        runningRef.current = s.phase === 'run';
        setRunning(runningRef.current);
      }
      for (const e of s.events) {
        applyEvent(fx, s, e);
        sfxEvent(s, e);
      }
      s.events.length = 0;
      if (pausedRef.current) {
        sfxQuiet();
        musicQuiet();
      } else {
        sfxFrame(s, dt);
        musicFrame(s, dt);
        stepFx(fx, s, dt);
      }
      if (s.phase !== before && (s.phase === 'crash' || s.phase === 'finish')) cb.current.onEnd(s);
      if (fx.clock >= tickAt) {
        tickAt = fx.clock + 0.1;
        cb.current.onTick(s);
      }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const t0 = performance.now();
      // draw between the last two ticks so motion stays smooth at any refresh rate
      const real = s.pos;
      if (s.phase === 'run') s.pos = prevPos + (real - prevPos) * Math.min(1, acc / TICK);
      drawFrame(ctx, s, fx, size.w, size.h);
      s.pos = real;
      const spent = performance.now() - t0;
      ema = ema === 0 ? spent : ema * 0.95 + spent * 0.05;
      slowFrames = ema > SLOW_MS ? slowFrames + 1 : 0;
      fastFrames = ema < FAST_MS ? fastFrames + 1 : 0;
      // only judge while the page is visible and the run is moving (hidden tabs and paused frames lie)
      if (document.visibilityState === 'visible' && s.phase === 'run') {
        if (slowFrames > 90 && tier < TIERS.length - 1) setTier(tier + 1);
        else if (fastFrames > 600 && tier > 0) setTier(tier - 1);
      }
      if (import.meta.env.DEV) devFrame?.(spent);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const isL = (k2: string) => k2 === 'ArrowLeft' || k2 === 'a' || k2 === 'A';
    const isR = (k2: string) => k2 === 'ArrowRight' || k2 === 'd' || k2 === 'D';
    const isUp = (k2: string) => k2 === 'ArrowUp' || k2 === 'w' || k2 === 'W';
    const isDown = (k2: string) => k2 === 'ArrowDown' || k2 === 's' || k2 === 'S';
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (isL(e.key) || isR(e.key) || isUp(e.key) || isDown(e.key) || e.key === ' ') e.preventDefault();
      if (e.repeat) return;
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        setPaused(!pausedRef.current);
        return;
      }
      if (pausedRef.current) {
        if (e.key === ' ' || e.key === 'Enter') setPaused(false);
        return;
      }
      if (isL(e.key) || isR(e.key)) {
        const dir = isL(e.key) ? -1 : 1;
        steer(dir);
        keySteer.current = { dir, next: fxRef.current.clock + REPEAT_DELAY };
      } else if (isUp(e.key)) held.current.fast = true;
      else if (isDown(e.key)) held.current.brake = true;
      else if (e.key === ' ' || e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement) return; // let the focused button handle it
        doStart();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if ((isL(e.key) && keySteer.current?.dir === -1) || (isR(e.key) && keySteer.current?.dir === 1)) keySteer.current = null;
      if (isUp(e.key)) held.current.fast = false;
      if (isDown(e.key)) held.current.brake = false;
    };
    // leaving the page (tab switch, app switch, devtools, a phone call) pauses a run in progress
    const blur = () => {
      keySteer.current = null;
      Object.assign(held.current, { fast: false, brake: false, dragFast: false, dragBrake: false });
      if (!pilotRef.current) setPaused(true);
    };
    const vis = () => {
      if (document.visibilityState === 'hidden') blur();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(raf);
      sfxQuiet();
      musicQuiet();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
    };
    // doStart, steer and setPaused only touch refs and state setters, so capturing them here is safe
  }, [size, tier]);

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (pausedRef.current) return;
    if (runRef.current.phase !== 'run') {
      doStart();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lanes: 0, moved: false };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) d.moved = true;
    const want = Math.trunc(dx / DRAG_LANE);
    while (d.lanes < want) {
      steer(1);
      d.lanes++;
    }
    while (d.lanes > want) {
      steer(-1);
      d.lanes--;
    }
    held.current.dragBrake = dy > 40;
    held.current.dragFast = dy < -40;
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      steer(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
    }
    drag.current = null;
    held.current.dragBrake = false;
    held.current.dragFast = false;
  };

  return (
    <div ref={wrapRef} className="w-full flex justify-center">
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, touchAction: 'none' }}
          className="block rounded-xl shadow-lg select-none"
          aria-label="Track. Arrow keys or drag to change lanes. P to pause."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {running && !paused && !autoPilot && (
          <button className="absolute top-2 right-2 rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm font-bold text-white" aria-label="Pause" title="Pause (P)" onClick={() => setPaused(true)}>
            ❚❚
          </button>
        )}
        {paused && (
          // the track is hidden while paused, so a pause is not free time to study the road ahead
          <div className="absolute inset-0 rounded-xl bg-slate-950/90 flex flex-col items-center justify-center gap-3">
            <p className="text-2xl font-extrabold">Paused</p>
            <button className="btn btn-primary text-base px-6" autoFocus onClick={() => setPaused(false)}>
              Resume
            </button>
            <p className="text-xs text-slate-400">P · Esc · Space</p>
          </div>
        )}
      </div>
    </div>
  );
});
