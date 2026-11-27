/**
 * Whole-track strip (spec §9). `full`: the pre-run preview, the three segments as three top-down columns plus the
 * pickup list. `mini`: a horizontal strip under the canvas with the runner's position. The safe line is never shown.
 */
import { useEffect, useRef } from 'react';
import { BIOMES } from '../shared/biomes.ts';
import { BOUNDARIES, COLS, FINISH_ROW, SEGMENT_START, biomeAt, segmentEnd } from '../shared/grid.ts';
import { vehicle } from '../shared/vehicles.ts';
import { Cell } from '../shared/types.ts';
import type { Course } from '../shared/types.ts';
import { effectText, vehicleModel } from './models.ts';
import { BiomeLegend, Thumb } from './Gallery.tsx';

export function cellColor(course: Course, row: number, col: number): string {
  const pal = BIOMES[biomeAt(course, row)].palette;
  const k = course.cells[row * COLS + col] ?? 0;
  switch (k) {
    case Cell.Crash:
      return pal.hazard;
    case Cell.Slow:
      return pal.slow;
    case Cell.Fast:
      return pal.fast;
    case Cell.Gate:
      return pal.gate[0];
    case Cell.Pole:
      return '#0f172a';
    case Cell.Ramp:
      return pal.ramp[1];
    case Cell.Collect:
      return pal.collect[0];
    case Cell.Finish:
      return (col & 1) === 0 ? '#111827' : '#f8fafc';
    default:
      return (row + col) % 2 === 0 ? pal.ground[0] : pal.ground[1];
  }
}

const dpr = () => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

function FullStrip({ course }: { course: Course }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const W = cv.clientWidth;
    const gap = 10;
    const cw = Math.max(3, Math.floor((W - 2 * gap) / (3 * COLS)));
    const colW = cw * COLS;
    const rh = 1.6;
    const top = 4;
    const H = Math.ceil((FINISH_ROW - SEGMENT_START[2] + 1) * rh) + top + 4;
    const k = dpr();
    cv.width = Math.round(W * k);
    cv.height = Math.round(H * k);
    cv.style.height = `${H}px`;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const left = (W - (3 * colW + 2 * gap)) / 2;
    for (const seg of [0, 1, 2] as const) {
      const x0 = left + seg * (colW + gap);
      for (let r = SEGMENT_START[seg]; r <= segmentEnd(seg); r++) {
        const y = top + (r - SEGMENT_START[seg]) * rh;
        for (let c = 0; c < COLS; c++) {
          ctx.fillStyle = cellColor(course, r, c);
          ctx.fillRect(x0 + c * cw, y, cw, rh + 0.5);
        }
      }
      ctx.strokeStyle = 'rgba(15,23,42,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 0.5, top - 0.5, colW + 1, (segmentEnd(seg) - SEGMENT_START[seg] + 1) * rh + 1);
    }
    // pickups: numbered markers
    course.pickups.forEach((p, i) => {
      const seg = p.segment as 0 | 1 | 2;
      const x = left + seg * (colW + gap) + (p.lane + 0.5) * cw;
      const y = top + (p.row - SEGMENT_START[seg] + 0.5) * rh;
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });
  }, [course]);
  return <canvas ref={ref} className="block w-full" aria-label="Whole track, three biomes top to bottom" />;
}

export function TrackPreview({ course, onStart, startLabel }: { course: Course; onStart: () => void; startLabel: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {course.biomes.map((b, i) => (
          <div key={b} className="rounded-lg bg-slate-800 px-1 py-1.5">
            <p className="text-[11px] text-slate-400">
              rows {SEGMENT_START[i as 0 | 1 | 2]}–{segmentEnd(i as 0 | 1 | 2)}
            </p>
            <p className="text-sm font-bold leading-tight">{BIOMES[b].name}</p>
            <p className="text-[11px] text-slate-300 leading-tight">{vehicle(BIOMES[b].base).name}</p>
          </div>
        ))}
      </div>
      <FullStrip course={course} />
      <div className="flex flex-col gap-1.5">
        {course.biomes.map((b) => (
          <BiomeLegend key={b} biome={b} />
        ))}
      </div>
      <ol className="flex flex-col gap-1 text-xs">
        {course.pickups.map((p, i) => {
          const v = vehicle(p.vehicle);
          return (
            <li key={`${p.row}`} className="flex gap-2 items-start rounded-md bg-slate-800/70 px-2 py-1">
              <span className="shrink-0 mt-0.5 size-5 rounded-full bg-yellow-400 text-slate-900 font-extrabold grid place-items-center text-[11px]">{i + 1}</span>
              <span className="shrink-0 rounded bg-slate-700/60">
                <Thumb entry={vehicleModel(v.id)} size={40} yaw={0.4} pitch={0.4} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold">
                  {v.name} · {v.durationRows} rows
                </span>{' '}
                <span className="text-slate-400">row {p.row}</span>
                <br />
                <span className="text-slate-300">{effectText(v)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-slate-400 leading-snug">
        Pickups sit 1–2 lanes off the clear route; each one covers a dense patch right after it. Miss one and it is gone for this run.
      </p>
      <button className="btn btn-primary text-base" onClick={onStart}>
        {startLabel}
      </button>
    </div>
  );
}

/** Horizontal minimap under the canvas: rows left → right, lanes top → bottom. */
export function MiniMap({ course, pos, taken }: { course: Course; pos: number; taken: ReadonlySet<number> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  // the track itself is drawn once into an offscreen canvas
  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = FINISH_ROW + 1;
    off.height = COLS;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    for (let r = 0; r <= FINISH_ROW; r++)
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = cellColor(course, r, c);
        ctx.fillRect(r, c, 1, 1);
      }
    base.current = off;
  }, [course]);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    const off = base.current;
    if (!cv || !ctx || !off) return;
    const W = cv.clientWidth;
    const H = 30;
    const k = dpr();
    if (cv.width !== Math.round(W * k)) {
      cv.width = Math.round(W * k);
      cv.height = Math.round(H * k);
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);
    const sx = W / (FINISH_ROW + 1);
    ctx.fillStyle = '#0f172a';
    for (const b of BOUNDARIES) ctx.fillRect(b * sx - 1, 0, 2, H);
    for (const p of course.pickups) {
      if (p.row < pos - 1 || taken.has(p.row * COLS + p.lane)) continue;
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.row * sx, ((p.lane + 0.5) * H) / COLS, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,23,42,0.45)';
    ctx.fillRect(0, 0, pos * sx, H);
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(pos * sx - 1.5, 0, 3, H);
  });
  return <canvas ref={ref} className="block w-full rounded-md" style={{ height: 30 }} aria-label="Minimap" />;
}
