/** Model thumbnails: the per-biome legend (preview screen) and the full model gallery (TEST bar → models). */
import { useEffect, useRef } from 'react';
import { BIOMES } from '../shared/biomes.ts';
import { VEHICLE_LIST } from '../shared/vehicles.ts';
import { BIOME_IDS } from '../shared/types.ts';
import type { BiomeId } from '../shared/types.ts';
import { collectModel, crashModel, effectText, pickupPadModel, slowModel, vehicleModel } from './models.ts';
import { beginFrame, viewOf } from './voxel.ts';
import type { Entry } from './voxel.ts';

/** One baked view drawn to fit a square canvas. */
export function Thumb({ entry, size = 56, yaw = 0.45, pitch = 0.45, bg }: { entry: Entry; size?: number; yaw?: number; pitch?: number; bg?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const k = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * k;
    cv.height = size * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
    }
    beginFrame(1e6); // thumbnails always get their exact angle
    const v = viewOf(entry, yaw, pitch, 4);
    const s = Math.min((size - 6) / v.w, (size - 6) / v.h);
    ctx.drawImage(v.img, v.sx, v.sy, v.w, v.h, (size - v.w * s) / 2, (size - v.h * s) / 2, v.w * s, v.h * s);
  }, [entry, size, yaw, pitch, bg]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="block" />;
}

/** The boost pad has no model: a cyan tile with white forward chevrons, as on the track. */
function BoostIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <polygon points="10,46 46,46 40,14 16,14" fill="#22d3ee" stroke="#0e7490" strokeWidth="1.5" />
      <polyline points="19,40 28,30 37,40" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
      <polyline points="21,29 28,22 35,29" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

function Item({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 w-[62px]">
      <div className="rounded-md bg-slate-700/60">{children}</div>
      <span className={`text-[10px] leading-tight text-center ${tone}`}>{label}</span>
    </div>
  );
}

/** What each cell looks like in one biome, with what it does. */
export function BiomeLegend({ biome }: { biome: BiomeId }) {
  const b = BIOMES[biome];
  return (
    <div className="rounded-lg bg-slate-800/70 p-2">
      <p className="text-xs font-semibold mb-1">
        {b.name}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Item label={`${b.cells.crash} · crash`} tone="text-red-300">
          <Thumb entry={crashModel(biome, 0, 0.5)} />
        </Item>
        <Item label="also crash" tone="text-red-300">
          <Thumb entry={crashModel(biome, 1, 0.5)} />
        </Item>
        <Item label={`${b.cells.slow} · slow`} tone="text-amber-300">
          <Thumb entry={slowModel(biome)} />
        </Item>
        <Item label={`${b.cells.fast} · boost`} tone="text-cyan-300">
          <BoostIcon />
        </Item>
        <Item label={`${b.cells.collect} +10`} tone="text-yellow-300">
          <Thumb entry={collectModel(biome)} yaw={0} pitch={0.25} />
        </Item>
        <Item label="pickup" tone="text-yellow-300">
          <Thumb entry={pickupPadModel()} />
        </Item>
      </div>
    </div>
  );
}

/** Everything, for review: all 23 vehicles from two angles, then each biome's legend. */
export function Gallery({ onClose }: { onClose: () => void }) {
  return (
    <div className="w-full max-w-[480px] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Models</h2>
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {VEHICLE_LIST.map((v) => (
          <div key={v.id} className="rounded-lg bg-slate-800 p-1.5 flex flex-col items-center">
            <div className="flex">
              <Thumb entry={vehicleModel(v.id)} size={64} yaw={0.15} pitch={0.4} />
              <Thumb entry={vehicleModel(v.id)} size={64} yaw={1.5} pitch={0.3} />
            </div>
            <p className="text-[11px] font-semibold leading-tight text-center">
              {v.name}
            </p>
            <p className="text-[10px] text-slate-400 leading-tight text-center">{v.base ? 'base' : `${v.durationRows} rows · ${effectText(v)}`}</p>
          </div>
        ))}
      </div>
      {BIOME_IDS.map((b) => (
        <BiomeLegend key={b} biome={b} />
      ))}
    </div>
  );
}
