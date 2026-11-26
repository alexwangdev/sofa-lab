/**
 * Build-time sprite atlases (made by `npm run atlas`, see tools/bake-atlas.ts): one JSON index + a few WebP pages per
 * biome under atlas/. The game downloads only the day's three biomes, each when its segment is coming up, and drops
 * it again once the segment is behind. If a file is missing (e.g. a dev server without atlases), the caller falls back
 * to baking the same catalog at run time.
 */
import type { BiomeId } from '../shared/types.ts';
import { biomeCatalog } from './catalog.ts';
import { viewKey } from './voxel.ts';

/** [yi, pi, k, page, x, y, w, h, ax, ay] */
type AtlasView = [number, number, number, number, number, number, number, number, number, number];
type AtlasMeta = { biome: BiomeId; pages: string[]; items: Record<string, { lift: number; fit?: number; views: AtlasView[] }> };

const loads = new Map<BiomeId, Promise<boolean>>();

/** Download progress per biome, for the loading hint (bytes when the server sends sizes, else pages). */
type Progress = { state: 'loading' | 'ready' | 'failed'; got: number[]; size: number[]; done: number; since: number };
const progress = new Map<BiomeId, Progress>();

/** 0…1 while a biome's atlas is downloading; null when it is ready, failed (run-time fallback) or never requested. */
export function atlasLoading(biome: BiomeId): number | null {
  const p = progress.get(biome);
  if (!p || p.state !== 'loading') return null;
  const total = p.size.reduce((a, b) => a + b, 0);
  const got = p.got.reduce((a, b) => a + b, 0);
  if (p.size.length > 0 && p.size.every((n) => n > 0)) return Math.min(0.99, got / total);
  return p.got.length === 0 ? 0 : Math.min(0.99, p.done / p.got.length);
}

/** Longest a run waits for its first biome; after that it starts anyway and bakes missing sprites as it goes. */
const START_WAIT_MS = 10_000;
/** A run may start: the biome's atlas is in (or failed, or is taking too long). Requests it if nobody has yet. */
export function readyToStart(biome: BiomeId): boolean {
  const p = progress.get(biome);
  if (!p) {
    void loadBiomeAtlas(biome);
    return false;
  }
  return p.state !== 'loading' || performance.now() - p.since > START_WAIT_MS;
}

/** Fetch one page, counting bytes as they arrive, then decode it from the downloaded blob. */
async function loadPage(src: string, prog: Progress, i: number): Promise<HTMLImageElement> {
  const res = await fetch(src);
  if (!res.ok || !res.body) throw new Error(`atlas page ${src}`);
  prog.size[i] = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    prog.got[i] = (prog.got[i] ?? 0) + value.length;
  }
  prog.size[i] = prog.got[i] ?? 0;
  prog.done++;
  const url = URL.createObjectURL(new Blob(parts, { type: res.headers.get('content-type') ?? 'image/webp' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const prog: Progress = { state: 'loading', got: [], size: [], done: 0, since: performance.now() };
  progress.set(biome, prog);
  p = (async () => {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}atlas/${biome}.json`);
    if (!res.ok) return false;
    const meta = (await res.json()) as AtlasMeta;
    prog.got = meta.pages.map(() => 0);
    prog.size = meta.pages.map(() => 0);
    const pages = await Promise.all(meta.pages.map((f, i) => loadPage(`${base}atlas/${f}`, prog, i)));
    warmUp(pages);
    const byKey = new Map(biomeCatalog(biome).map((i) => [i.entry.key, i.entry]));
    for (const [key, item] of Object.entries(meta.items)) {
      const e = byKey.get(key);
      if (!e || !e.alive) continue;
      e.liftCells = item.lift;
      if (item.fit !== undefined) e.fitScale = item.fit;
      for (const [yi, pi, k, page, x, y, w, h, ax, ay] of item.views) {
        const img = pages[page];
        if (img) e.views.set(viewKey(yi, pi, k), { img, sx: x, sy: y, w, h, ax, ay, k });
      }
      e.complete = true;
    }
    return true;
  })()
    .catch(() => false)
    .then((ok) => {
      prog.state = ok ? 'ready' : 'failed';
      return ok;
    });
  loads.set(biome, p);
  return p;
}

/** Forget a biome's atlas (after its sprites were evicted) so a later run fetches it again (from the HTTP cache). */
export function forgetBiomeAtlas(biome: BiomeId): void {
  loads.delete(biome);
  progress.delete(biome);
}
