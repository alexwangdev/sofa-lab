/**
 * Build-time sprite atlases. Run: npm run atlas (also runs before dev and build).
 *
 * For each biome: build every model in the catalog (src/client/catalog.ts), rasterise every view it can be seen from
 * with the same pure-JS rasteriser the game uses (src/client/voxel.ts), shelf-pack them into ≤2048×2048 pages and
 * write  src/client/public/atlas/<biome>.json  +  <biome>-<n>.png.  No canvas library: a tiny PNG encoder below.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { BIOME_IDS } from '../src/shared/types.ts';
import type { BiomeId } from '../src/shared/types.ts';
import { biomeCatalog } from '../src/client/catalog.ts';
import { rasterView } from '../src/client/voxel.ts';
import type { Raster } from '../src/client/voxel.ts';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/public/atlas');
const PAGE = 2048;
const GAP = 2;

// ---------- PNG ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}
/** RGBA8 → PNG, choosing the best of the five scanline filters per row (smaller files for flat voxel art). */
function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = (y - 1) * stride;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f] as Buffer;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i] ?? 0;
        const a = i >= 4 ? (rgba[row + i - 4] ?? 0) : 0;
        const b = y > 0 ? (rgba[prev + i] ?? 0) : 0;
        const c = y > 0 && i >= 4 ? (rgba[prev + i - 4] ?? 0) : 0;
        let v: number;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    (cand[best] as Buffer).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

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

function bakeBiome(biome: BiomeId): { bytes: number; views: number; pages: number } {
  const sprites: Sprite[] = [];
  const lifts: Record<string, number> = {};
  for (const item of biomeCatalog(biome)) {
    const m = item.entry.model;
    lifts[item.entry.key] = m.lift;
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
  pages.forEach((p, i) => {
    let maxX = 1;
    for (const s of sprites) if (s.page === i) maxX = Math.max(maxX, s.x + s.r.w);
    const w = maxX;
    const data = new Uint8Array(w * p.h * 4);
    for (let y = 0; y < p.h; y++) data.set(p.data.subarray(y * p.w * 4, (y * p.w + w) * 4), y * w * 4);
    const png = encodePng(w, p.h, data);
    const name = `${biome}-${i}.png`;
    writeFileSync(resolve(OUT, name), png);
    files.push(name);
    bytes += png.length;
  });
  const items: Record<string, { lift: number; views: number[][] }> = {};
  for (const s of sprites) {
    const it = (items[s.key] ??= { lift: lifts[s.key] ?? 0, views: [] });
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
  const r = bakeBiome(b);
  total += r.bytes;
  console.log(`atlas ${b.padEnd(9)} ${String(r.views).padStart(5)} views  ${r.pages} page(s)  ${(r.bytes / 1024).toFixed(0)} KB`);
}
console.log(`atlas total ${(total / 1024 / 1024).toFixed(2)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${OUT}`);
