/**
 * The catalog: every model a biome uses and every view (yaw bucket, pitch bucket, resolution) it can be seen from.
 * The atlas build script (tools/bake-atlas.ts) bakes exactly this list into PNG pages; the game loads those pages
 * per biome (atlas.ts) and, if an atlas is missing, bakes the same list at run time in idle time.
 */
import { BIOMES } from '../shared/biomes.ts';
import { timedFor } from '../shared/vehicles.ts';
import type { BiomeId } from '../shared/types.ts';
import { collectModel, crashModel, pickupPadModel, poleModel, rampModel, slowModel, vehicleModel } from './models.ts';
import { buckets, kForPitch } from './voxel.ts';
import type { Entry } from './voxel.ts';

/** Camera: this many rows behind the runner and this high above the ground (render.ts uses the same). */
export const ZP = 4;
export const CAM_H = 4.6;

type Angle = readonly [yaw: number, pitch: number];

/** Angles a track object is seen from on its way from the horizon to the camera (only those that can be on screen). */
const TRACK_ANGLES: readonly Angle[] = (() => {
  const out: Angle[] = [];
  for (const dz of [44, 34, 26, 20, 15, 11, 8, 6, 4.6, 3.6]) {
    const half = Math.min(7.5, dz * 1.2 + 1); // half the view is ~1.2·dz cells wide at depth dz
    for (let dx = -half; dx <= half; dx += 1) out.push([-Math.atan2(dx, dz), Math.atan2(CAM_H, dz)]);
  }
  return out;
})();

/** Angles the runner is seen from (ZP rows ahead, a lane or two off-centre, leaning into lane changes). */
const RUNNER_ANGLES: readonly Angle[] = (() => {
  const out: Angle[] = [];
  for (let dx = -2.5; dx <= 2.5; dx += 0.5) for (const lean of [-0.4, 0, 0.4]) out.push([-Math.atan2(dx, ZP) + lean, Math.atan2(CAM_H, ZP)]);
  return out;
})();

/** Spinning things (collectibles, vehicles hovering over a pickup): every 30°, at a few distances. */
const SPIN_ANGLES: readonly Angle[] = (() => {
  const out: Angle[] = [];
  for (const dz of [34, 20, 12, 7, 4.6]) for (let a = 0; a < 12; a++) out.push([(a * Math.PI) / 6 - Math.PI, Math.atan2(CAM_H, dz)]);
  return out;
})();

export type View = readonly [yi: number, pi: number, k: number];
type CatalogItem = { entry: Entry; views: View[] };

function views(...sets: (readonly Angle[])[]): View[] {
  const seen = new Set<string>();
  const out: View[] = [];
  for (const set of sets)
    for (const [yaw, pitch] of set) {
      const [yi, pi] = buckets(yaw, pitch);
      const k = kForPitch(pi);
      const key = `${yi}:${pi}:${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([yi, pi, k]);
    }
  return out;
}

const TRACK = views(TRACK_ANGLES);
const RUNNER = views(RUNNER_ANGLES);
const SPIN = views(SPIN_ANGLES);
const RUNNER_AND_SPIN = views(RUNNER_ANGLES, SPIN_ANGLES);

/** Everything one biome needs. */
export function biomeCatalog(biome: BiomeId): CatalogItem[] {
  const b = BIOMES[biome];
  const items: CatalogItem[] = [];
  for (const v of [0, 1] as const) for (const k of [0.2, 0.8]) items.push({ entry: crashModel(biome, v, k), views: TRACK });
  items.push({ entry: slowModel(biome), views: TRACK });
  items.push({ entry: rampModel(b.palette.ramp[0], b.palette.ramp[1]), views: TRACK });
  for (const color of b.palette.gate) for (const side of [true, false]) items.push({ entry: poleModel(color, side), views: TRACK });
  items.push({ entry: collectModel(biome), views: SPIN });
  items.push({ entry: pickupPadModel(), views: TRACK });
  items.push({ entry: vehicleModel(b.base), views: RUNNER });
  for (const t of timedFor(biome)) items.push({ entry: vehicleModel(t.id), views: RUNNER_AND_SPIN });
  return items;
}

