/**
 * Build-time sprite atlases (made by `npm run atlas`, see tools/bake-atlas.ts): one JSON index + a few PNG pages per
 * biome under atlas/. The game downloads only the day's three biomes, each when its segment is coming up, and drops
 * it again once the segment is behind. If a file is missing (e.g. a dev server without atlases), the caller falls back
 * to baking the same catalog at run time.
 */
import type { BiomeId } from '../shared/types.ts';
import { biomeCatalog } from './catalog.ts';
import { viewKey } from './voxel.ts';

/** [yi, pi, k, page, x, y, w, h, ax, ay] */
type AtlasView = [number, number, number, number, number, number, number, number, number, number];
type AtlasMeta = { biome: BiomeId; pages: string[]; items: Record<string, { lift: number; views: AtlasView[] }> };

const loads = new Map<BiomeId, Promise<boolean>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`atlas page ${src}`));
    img.src = src;
  });
}

/**
 * A 2048-px page is decoded and uploaded to the GPU the first time it is drawn, which costs a frame. Do that now, in
 * idle time, one page per idle slot, by drawing each page into a 1×1 canvas.
 */
function warmUp(pages: HTMLImageElement[]): void {
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const g = cv.getContext('2d');
  if (!g) return;
  const idle = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 16));
  const next = (i: number) => {
    const img = pages[i];
    if (!img) return;
    idle(() => {
      img.decode().catch(() => undefined).finally(() => {
        g.drawImage(img, 0, 0, 1, 1);
        next(i + 1);
      });
    });
  };
  next(0);
}

/** Fetch a biome's atlas and attach its views to the catalog entries. Resolves false if there is no atlas. */
export function loadBiomeAtlas(biome: BiomeId): Promise<boolean> {
  let p = loads.get(biome);
  if (p) return p;
  p = (async () => {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}atlas/${biome}.json`);
    if (!res.ok) return false;
    const meta = (await res.json()) as AtlasMeta;
    const pages = await Promise.all(meta.pages.map((f) => loadImage(`${base}atlas/${f}`)));
    warmUp(pages);
    const byKey = new Map(biomeCatalog(biome).map((i) => [i.entry.key, i.entry]));
    for (const [key, item] of Object.entries(meta.items)) {
      const e = byKey.get(key);
      if (!e || !e.alive) continue;
      e.liftCells = item.lift;
      for (const [yi, pi, k, page, x, y, w, h, ax, ay] of item.views) {
        const img = pages[page];
        if (img) e.views.set(viewKey(yi, pi, k), { img, sx: x, sy: y, w, h, ax, ay, k });
      }
      e.complete = true;
    }
    return true;
  })().catch(() => false);
  loads.set(biome, p);
  return p;
}

/** Forget a biome's atlas (after its sprites were evicted) so a later run fetches it again (from the HTTP cache). */
export function forgetBiomeAtlas(biome: BiomeId): void {
  loads.delete(biome);
}
