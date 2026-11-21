import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import type { CellId, Course, TestResult } from '../shared/types';
import { jamText } from './jam';
import type { Hints } from '../shared/sofa';
import { mirrorCell, CELL, COLS, ROWS, STEPS, cellCol, cellIdOf, cellRow, cornerAt, stepAngle } from '../shared/sofa';

/** A pose of the sofa: world = R(−t)·(p − q). Start pose: t = 0, q = (boxW, 0) → local (u,v) ↦ (u − boxW, v). */
type Pose = { t: number; qx: number; qy: number };

export type AnimRequest = { id: number; result: TestResult; cells: CellId[] };

type Props = {
  cells: ReadonlySet<CellId>;
  course: Course;
  cols?: number;
  editable: boolean;
  erase?: boolean;
  /** Called once per stroke (pointer up) with the new cell set. */
  onStroke?: (next: Set<CellId>) => void;
  anim?: AnimRequest | null;
  onAnimDone?: (result: TestResult) => void;
  /** Cells highlighted red in the build view (last jam). */
  jamCells?: ReadonlySet<CellId>;
  /** Heatmap from the last test (early/late jams, room to grow). */
  hints?: Hints | null;
  /** Brush size in cells (1 = single cell, 2 = 2×2, 3 = 3×3). */
  brush?: 1 | 2 | 3;
  /** Also paint the mirror image about the centre of the build box. */
  mirror?: boolean;
  /** Optional exact outline (local coords) drawn over the grid in the build pose — tutorial only. */
  ghost?: ReadonlyArray<readonly [number, number]>;
};

const COLORS = {
  wall: '#27272a',
  floor: '#fafaf9',
  floorLine: '#a8a29e',
  grid: '#e7e5e4',
  sofa: '#2563eb',
  sofaEdge: '#1e40af',
  jam: '#dc2626',
  pass: '#16a34a',
  ghost: '#f59e0b',
  late: '#f97316',
  grow: '#16a34a',
  axis: '#93c5fd',
  torn: '#a8a29e',
  pillar: '#52525b',
  text: '#fafaf9',
};

const ROTATE_MS = 1200;
const SLIDE_IN_MS = 350;
const SLIDE_OUT_MS = 500;
const HOLD_MS = 1600;

type Timeline = { duration: number; poseAt: (ms: number) => Pose; final: 'pass' | 'jam' };

function buildTimeline(res: TestResult, cells: CellId[], boxW: number, cols: number): Timeline {
  const m = res.motion;
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
  if (!m) return { duration: 0, poseAt: () => ({ t: 0, qx: boxW, qy: 0 }), final: 'jam' };
  if (m.kind === 'slide') {
    let uMin = Infinity;
    for (const id of cells) uMin = Math.min(uMin, cellCol(id, cols) * CELL);
    const a = 500;
    const b = 700;
    return {
      duration: a + b,
      final: 'pass',
      poseAt: (ms) =>
        ms < a
          ? { t: 0, qx: lerp(boxW, uMin - m.ox, ease(ms / a)), qy: 0 }
          : { t: 0, qx: uMin - m.ox, qy: lerp(0, 2.6, ease((ms - a) / b)) },
    };
  }
  // approach jams stop before turning; exit jams turn fully, then stop.
  const jamStep = res.pass || res.jamPhase === 'exit' ? STEPS : res.jamPhase === 'approach' ? 0 : Math.round(((res.jamAngle ?? 0) / 90) * STEPS);
  const endT = stepAngle(jamStep);
  const rotMs = jamStep === 0 ? 1 : Math.max(250, ROTATE_MS * (jamStep / STEPS));
  const outMs = res.pass ? SLIDE_OUT_MS : 0;
  const [q0x] = cornerAt(m, 0);
  const [q1x] = cornerAt(m, Math.PI / 2);
  return {
    duration: SLIDE_IN_MS + rotMs + outMs,
    final: res.pass ? 'pass' : 'jam',
    poseAt: (ms) => {
      if (ms < SLIDE_IN_MS) return { t: 0, qx: lerp(boxW, q0x, ease(ms / SLIDE_IN_MS)), qy: 0 };
      const r = ms - SLIDE_IN_MS;
      if (r < rotMs || outMs === 0) {
        const t = endT * Math.min(1, r / rotMs);
        const [qx, qy] = cornerAt(m, t);
        return { t, qx, qy };
      }
      const s = ease((r - rotMs) / outMs);
      return { t: Math.PI / 2, qx: q1x - 2.6 * s, qy: 0 };
    },
  };
}

export function SofaCanvas({ cells, course, cols = COLS, editable, erase = false, onStroke, anim, onAnimDone, jamCells, ghost, hints = null, brush = 1, mirror = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(360);
  const boxW = cols * CELL;
  const w = course.w;
  const tornSet = new Set(course.torn);

  // View window in world coords (aspect 3:2).
  const X0 = -boxW - 0.15;
  const X1 = Math.max(1, w) + 0.3;
  const viewW = X1 - X0;
  const viewH = viewW / 1.5;
  const Y1 = 1.12;
  const scale = cssW / viewW;
  const sx = useCallback((x: number) => (x - X0) * scale, [X0, scale]);
  const sy = useCallback((y: number) => (Y1 - y) * scale, [scale]);

  // stroke state
  const working = useRef<Set<CellId> | null>(null);
  const paintValue = useRef(true);
  const [, force] = useState(0);

  // animation state
  const animState = useRef<{ tl: Timeline; start: number; req: AnimRequest } | null>(null);
  const [pose, setPose] = useState<Pose | null>(null);
  const [overlay, setOverlay] = useState<{ kind: 'pass' | 'jam'; text: string; flash: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCssW(Math.max(280, Math.min(480, el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Run an animation when a new request arrives.
  useEffect(() => {
    if (!anim) return;
    const tl = buildTimeline(anim.result, anim.cells, boxW, cols);
    animState.current = { tl, start: performance.now(), req: anim };
    let first = true;
    let raf = 0;
    let holdTimer = 0;
    const tick = (now: number) => {
      const st = animState.current;
      if (!st || st.req.id !== anim.id) return;
      const ms = now - st.start;
      if (first) {
        first = false;
        setOverlay(null);
      }
      if (ms < tl.duration) {
        setPose(tl.poseAt(ms));
        raf = requestAnimationFrame(tick);
        return;
      }
      setPose(tl.poseAt(tl.duration));
      const res = anim.result;
      if (tl.final === 'pass') setOverlay({ kind: 'pass', text: `✓ ${res.area.toFixed(3)}`, flash: false });
      else setOverlay({ kind: 'jam', text: jamText(res), flash: true });
      holdTimer = window.setTimeout(() => {
        if (animState.current?.req.id !== anim.id) return;
        animState.current = null;
        setPose(null);
        setOverlay(null);
        onAnimDone?.(res);
      }, HOLD_MS);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(holdTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim?.id]);

  // jam flash blink
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    if (!overlay?.flash) return;
    const id = window.setInterval(() => setBlink((b) => !b), 160);
    return () => window.clearInterval(id);
  }, [overlay?.flash]);

  // ---------- draw ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssH = cssW / 1.5;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // walls + floor
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(sx(X0 - 1), sy(1), sx(w) - sx(X0 - 1), sy(0) - sy(1));
    ctx.fillRect(sx(0), sy(1), sx(w) - sx(0), sy(Y1 - viewH - 1) - sy(1));
    ctx.strokeStyle = COLORS.floorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(X0 - 1), sy(1));
    ctx.lineTo(sx(w), sy(1));
    ctx.lineTo(sx(w), sy(-10));
    ctx.moveTo(sx(X0 - 1), sy(0));
    ctx.lineTo(sx(0), sy(0));
    ctx.lineTo(sx(0), sy(-10));
    ctx.stroke();
    // pillar (drawn as part of the wall)
    const p = course.pillar;
    if (p) {
      ctx.fillStyle = COLORS.pillar;
      ctx.beginPath();
      ctx.arc(sx(p.cx), sy(p.cy), p.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.wall;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // labels
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`w = ${w}`, sx(w / 2), sy(-1.6));
    ctx.textAlign = 'left';
    ctx.fillText('width 1', sx(X0) + 4, sy(0) + 13);

    const shown = working.current ?? cells;
    const early = new Set(working.current ? [] : (hints?.early ?? []));
    const late = new Set(working.current ? [] : (hints?.late ?? []));
    const atStart = pose === null;

    if (atStart) {
      // build box + grid
      const bx0 = sx(-boxW);
      const by0 = sy(1);
      const step = CELL * scale;
      if (editable) {
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
          ctx.moveTo(bx0 + c * step, by0);
          ctx.lineTo(bx0 + c * step, by0 + ROWS * step);
        }
        for (let r = 0; r <= ROWS; r++) {
          ctx.moveTo(bx0, by0 + r * step);
          ctx.lineTo(bx0 + cols * step, by0 + r * step);
        }
        ctx.stroke();
      }
      // torn fabric: grey cells with an X; can't be painted
      for (const id of tornSet) {
        const x = sx(cellCol(id, cols) * CELL - boxW);
        const y = sy(cellRow(id, cols) * CELL + CELL);
        ctx.fillStyle = COLORS.torn;
        ctx.fillRect(x, y, step, step);
        ctx.strokeStyle = COLORS.wall;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + 1);
        ctx.lineTo(x + step - 1, y + step - 1);
        ctx.moveTo(x + step - 1, y + 1);
        ctx.lineTo(x + 1, y + step - 1);
        ctx.stroke();
      }
      for (const id of shown) {
        const u = cellCol(id, cols) * CELL;
        const v = cellRow(id, cols) * CELL;
        const isJam = jamCells?.has(id) === true || early.has(id);
        ctx.fillStyle = isJam ? COLORS.jam : late.has(id) ? COLORS.late : COLORS.sofa;
        ctx.fillRect(sx(u - boxW), sy(v + CELL), step + 0.4, step + 0.4);
      }
      // room to grow: green rings in empty neighbour cells
      if (hints && !working.current) {
        ctx.strokeStyle = COLORS.grow;
        ctx.lineWidth = 1.5;
        for (const id of hints.grow) {
          if (shown.has(id)) continue;
          const x = sx(cellCol(id, cols) * CELL - boxW);
          const y = sy(cellRow(id, cols) * CELL + CELL);
          ctx.strokeRect(x + 1, y + 1, step - 2, step - 2);
        }
      }
      if (mirror && editable) {
        ctx.strokeStyle = COLORS.axis;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx(boxW / 2 - boxW), sy(1));
        ctx.lineTo(sx(boxW / 2 - boxW), sy(0));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ghost && ghost.length > 1) {
        ctx.strokeStyle = COLORS.ghost;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ghost.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(sx(u - boxW), sy(v)) : ctx.lineTo(sx(u - boxW), sy(v))));
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      const c = Math.cos(pose.t);
      const s = Math.sin(pose.t);
      const toS = (u: number, v: number): [number, number] => {
        const dx = u - pose.qx;
        const dy = v - pose.qy;
        return [sx(dx * c + dy * s), sy(-dx * s + dy * c)];
      };
      const jam = overlay?.kind === 'jam' ? new Set(anim?.result.jamCells ?? []) : null;
      for (const id of anim?.cells ?? []) {
        const u = cellCol(id, cols) * CELL;
        const v = cellRow(id, cols) * CELL;
        const isJam = jam?.has(id) === true;
        ctx.fillStyle = isJam ? (blink ? COLORS.jam : '#fecaca') : overlay?.kind === 'pass' ? COLORS.pass : COLORS.sofa;
        ctx.beginPath();
        const p = [toS(u, v), toS(u + CELL, v), toS(u + CELL, v + CELL), toS(u, v + CELL)];
        p.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    if (overlay) {
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const x = sx(-boxW / 2);
      const y = sy(-1.0);
      ctx.fillStyle = overlay.kind === 'pass' ? COLORS.pass : COLORS.jam;
      const tw = ctx.measureText(overlay.text).width;
      ctx.fillRect(x - tw / 2 - 10, y - 24, tw + 20, 34);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(overlay.text, x, y);
    }
  });

  // ---------- input ----------
  const lastPt = useRef<[number, number] | null>(null);
  const localPt = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const cellAtPx = (px: number, py: number): CellId | null => {
    const x = X0 + px / scale;
    const y = Y1 - py / scale;
    const col = Math.floor((x + boxW) / CELL);
    const row = Math.floor(y / CELL);
    if (col < 0 || col >= cols || row < 0 || row >= ROWS) return null;
    return cellIdOf(col, row, cols);
  };

  /** Cells touched by one brush dab at uid=197609(Alex) gid=197609 groups=197609 (brush size + mirror), inside the box and not torn. */
  const expand = (id: CellId): CellId[] => {
    const col = cellCol(id, cols);
    const row = cellRow(id, cols);
    const out: CellId[] = [];
    const lo = -Math.floor((brush - 1) / 2);
    for (let dc = lo; dc < lo + brush; dc++) {
      for (let dr = lo; dr < lo + brush; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= cols || r < 0 || r >= ROWS) continue;
        const cell = cellIdOf(c, r, cols);
        out.push(cell);
        if (mirror) out.push(mirrorCell(cell, cols));
      }
    }
    return out.filter((c) => !tornSet.has(c));
  };

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!editable || pose !== null) return;
    const pt = localPt(e);
    const id = cellAtPx(pt[0], pt[1]);
    if (id === null || tornSet.has(id)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const next = new Set(cells);
    paintValue.current = erase ? false : !next.has(id);
    for (const c of expand(id)) {
      if (paintValue.current) next.add(c);
      else next.delete(c);
    }
    working.current = next;
    lastPt.current = pt;
    force((n) => n + 1);
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const wk = working.current;
    const from = lastPt.current;
    if (!wk || !from) return;
    const to = localPt(e);
    // Walk the segment in half-cell steps so fast drags don't skip cells.
    const stepPx = (CELL * scale) / 2;
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / stepPx));
    let changed = false;
    for (let i = 1; i <= n; i++) {
      const id = cellAtPx(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
      if (id === null) continue;
      for (const c of expand(id)) {
        if (paintValue.current === wk.has(c)) continue;
        if (paintValue.current) wk.add(c);
        else wk.delete(c);
        changed = true;
      }
    }
    lastPt.current = to;
    if (changed) force((k) => k + 1);
  };
  const onUp = () => {
    const wk = working.current;
    working.current = null;
    lastPt.current = null;
    if (wk) onStroke?.(wk);
  };

  return (
    <div ref={wrapRef} className="w-full flex justify-center">
      <canvas
        ref={canvasRef}
        className="rounded-lg block"
        style={{ touchAction: 'none', cursor: editable ? 'crosshair' : 'default' }}
        role="img"
        aria-label={`Hallway with sofa, ${cells.size} cells`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  );
}

/** Skeleton shown while /api/today loads. */
export function CanvasSkeleton() {
  return <div className="w-full max-w-[480px] mx-auto aspect-[3/2] rounded-lg bg-zinc-300 animate-pulse" />;
}
