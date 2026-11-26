/**
 * Build-time sprite atlases. Run: npm run atlas (also runs before dev and build).
 *
 * For each biome: build every model in the catalog (src/client/catalog.ts), rasterise every view it can be seen from
 * with the same pure-JS rasteriser the game uses (src/client/voxel.ts), shelf-pack them into ≤2048×2048 pages and
 * write  src/client/public/atlas/<biome>.json  +  <biome>-<n>.webp  (encoded with sharp, a build-time dev dependency).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BIOME_IDS } from '../src/shared/types.ts';
import type { BiomeId } from '../src/shared/types.ts';
import { biomeCatalog } from '../src/client/catalog.ts';
import { rasterView } from '../src/client/voxel.ts';
import type { Raster } from '../src/client/voxel.ts';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/public/atlas');
const PAGE = 2048;
const GAP = 2;

// ---------- WebP ----------

/**
 * RGBA8 → WebP: lossy colour at quality 85 with lossless alpha (clean sprite edges). About half the size of the old
 * optimised PNGs, and no visible difference at the size sprites are drawn (checked side by side at 3× zoom).
 */
const WEBP = { quality: 85, alphaQuality: 100, effort: 4 } as const; // effort 6 is ~1 % smaller and 10× slower
const encodeWebp = (w: number, h: number, rgba: Uint8Array): Promise<Buffer> => sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).webp(WEBP).toBuffer();

// ---------- packing ----------

type Sprite = { key: string; view: readonly [number, number, number]; r: Raster; page: number; x: number; y: number };

/** Shelf packing, tallest first; a new page when one is full. Returns each page's used height. */
function pack(sprites: Sprite[]): number[] {
  sprites.sort((a, b) => b.r.h - a.r.h || b.r.w - a.r.w);
  const heights: number[] = [];
  let page = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const s of sprites) {
    if (x + s.r.w > PAGE) {
      x = 0;
      y += shelf + GAP;
      shelf = 0;
    }
    if (y + s.r.h > PAGE) {
      heights[page] = y;
      page++;
      x = 0;
      y = 0;
      shelf = 0;
    }
    s.page = page;
    s.x = x;
    s.y = y;
    x += s.r.w + GAP;
    shelf = Math.max(shelf, s.r.h);
    heights[page] = y + shelf;
  }
  return heights;
}

// ---------- main ----------

async function bakeBiome(biome: BiomeId): Promise<{ bytes: number; views: number; pages: number }> {
  const sprites: Sprite[] = [];
  const lifts: Record<string, number> = {};
  const fits: Record<string, number> = {};
  for (const item of biomeCatalog(biome)) {
    const m = item.entry.model;
    lifts[item.entry.key] = m.lift;
    fits[item.entry.key] = Math.round(item.entry.fit * 1000) / 1000;
    for (const v of item.views) sprites.push({ key: item.entry.key, view: v, r: rasterView(m, v[0], v[1], v[2]), page: 0, x: 0, y: 0 });
  }
  const heights = pack(sprites);
  const pages = heights.map((h) => ({ w: PAGE, h: Math.max(1, h), data: new Uint8Array(PAGE * Math.max(1, h) * 4) }));
  for (const s of sprites) {
    const p = pages[s.page];
    if (!p) continue;
    for (let row = 0; row < s.r.h; row++) {
      const src = s.r.data.subarray(row * s.r.w * 4, (row + 1) * s.r.w * 4);
      p.data.set(src, ((s.y + row) * p.w + s.x) * 4);
    }
  }
  // trim page width to what is used
  const files: string[] = [];
  let bytes = 0;
  for (const [i, p] of pages.entries()) {
    let maxX = 1;
    for (const s of sprites) if (s.page === i) maxX = Math.max(maxX, s.x + s.r.w);
    const w = maxX;
    const data = new Uint8Array(w * p.h * 4);
    for (let y = 0; y < p.h; y++) data.set(p.data.subarray(y * p.w * 4, (y * p.w + w) * 4), y * w * 4);
    const img = await encodeWebp(w, p.h, data);
    const name = `${biome}-${i}.webp`;
    writeFileSync(resolve(OUT, name), img);
    files.push(name);
    bytes += img.length;
  }
  const items: Record<string, { lift: number; fit: number; views: number[][] }> = {};
  for (const s of sprites) {
    const it = (items[s.key] ??= { lift: lifts[s.key] ?? 0, fit: fits[s.key] ?? 1, views: [] });
    it.views.push([s.view[0], s.view[1], s.view[2], s.page, s.x, s.y, s.r.w, s.r.h, Math.round(s.r.ax * 100) / 100, Math.round(s.r.ay * 100) / 100]);
  }
  const json = JSON.stringify({ biome, pages: files, items });
  writeFileSync(resolve(OUT, `${biome}.json`), json);
  return { bytes: bytes + json.length, views: sprites.length, pages: files.length };
}

const t0 = performance.now();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const b of BIOME_IDS) {
  const r = await bakeBiome(b);
  total += r.bytes;
  console.log(`atlas ${b.padEnd(9)} ${String(r.views).padStart(5)} views  ${r.pages} page(s)  ${(r.bytes / 1024).toFixed(0)} KB`);
}
console.log(`atlas total ${(total / 1024 / 1024).toFixed(2)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${OUT}`);
