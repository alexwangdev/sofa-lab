/**
 * The 8-biome pool (spec §6). A biome = palette + base vehicle + renamed cells. No biome has its own code path:
 * the renderer and models only read these colours.
 */
import type { BiomeId, VehicleId } from './types.ts';


export type Palette = {
  /** Sky gradient top → horizon. */
  sky: [string, string, string];
  fog: string;
  /** Checker ground colours. */
  ground: [string, string];
  /** Off-track ground colours. */
  side: [string, string];
  /** Grid line rgb ("r,g,b"). */
  line: string;
  edge: string;
  mountains: [string, string];
  cap: string;
  /** Crash sprites: two variants, each with its own colours (base, accent). */
  /** Crash cells on the minimap / preview strip, and smash particles. */
  hazard: string;
  /** Slow ground tint. */
  slow: string;
  fast: string;
  collect: [string, string];
  gate: [string, string];
  ramp: [string, string];
};

type BiomeDef = {
  id: BiomeId;
  name: string;
  base: VehicleId;
  cells: { normal: string; crash: string; slow: string; fast: string; collect: string; gate: string };
  palette: Palette;
};

export const BIOMES: Record<BiomeId, BiomeDef> = {
  snow: {
    id: 'snow',
    name: 'Snow',
    base: 'ski',
    cells: { normal: 'Snow', crash: 'Tree / rock', slow: 'Mogul', fast: 'Ice', collect: 'Snowflake', gate: 'Flag gate' },
    palette: {
      sky: ['#1e3a8a', '#60a5fa', '#d6e4f5'],
      fog: '#d6e4f5',
      ground: ['#f8fafc', '#eef3f9'],
      side: ['#e4eaf2', '#dfe6ef'],
      line: '100,116,139',
      edge: '#1e3a8a',
      mountains: ['#94a3b8', '#cbd5e1'],
      cap: '#f1f5f9',
      hazard: '#166534',
      slow: '#dbe3ee',
      fast: '#a5f3fc',
      collect: ['#facc15', '#fef9c3'],
      gate: ['#2563eb', '#dc2626'],
      ramp: ['#7dd3fc', '#0369a1'],
    },
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    base: 'sandboard',
    cells: { normal: 'Sand', crash: 'Cactus / rock', slow: 'Dune', fast: 'Hard sand', collect: 'Oasis drop', gate: 'Dune gate' },
    palette: {
      sky: ['#c2410c', '#fb923c', '#fde3b8'],
      fog: '#fde3b8',
      ground: ['#f6d79b', '#f0cd8a'],
      side: ['#e9bf7a', '#e4b870'],
      line: '146,94,40',
      edge: '#9a3412',
      mountains: ['#d97706', '#f59e0b'],
      cap: '#fcd34d',
      hazard: '#3f8a3a',
      slow: '#e8b866',
      fast: '#d9a45c',
      collect: ['#38bdf8', '#e0f2fe'],
      gate: ['#0d9488', '#b91c1c'],
      ramp: ['#fbbf24', '#92400e'],
    },
  },
  volcano: {
    id: 'volcano',
    name: 'Volcano',
    base: 'heatboard',
    cells: { normal: 'Basalt', crash: 'Lava flow', slow: 'Ember field', fast: 'Cooled rock', collect: 'Obsidian shard', gate: 'Vent gate' },
    palette: {
      sky: ['#1c0a0a', '#7f1d1d', '#d97757'],
      fog: '#5b2a22',
      ground: ['#3f3a3a', '#363232'],
      side: ['#2b2626', '#262121'],
      line: '20,10,10',
      edge: '#f97316',
      mountains: ['#292524', '#44403c'],
      cap: '#f97316',
      hazard: '#f97316',
      slow: '#7c2d12',
      fast: '#57534e',
      collect: ['#a78bfa', '#ede9fe'],
      gate: ['#facc15', '#f97316'],
      ramp: ['#78716c', '#292524'],
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    base: 'jetski',
    cells: { normal: 'Water', crash: 'Reef / rock', slow: 'Wave', fast: 'Current', collect: 'Shell', gate: 'Buoy gate' },
    palette: {
      sky: ['#0c4a6e', '#38bdf8', '#e0f7ff'],
      fog: '#cdeefb',
      ground: ['#1d8fd1', '#1a84c2'],
      side: ['#166fa6', '#14679b'],
      line: '224,242,254',
      edge: '#f8fafc',
      mountains: ['#0e7490', '#67e8f9'],
      cap: '#ecfeff',
      hazard: '#db2777',
      slow: '#bae6fd',
      fast: '#38bdf8',
      collect: ['#fda4af', '#fff1f2'],
      gate: ['#f97316', '#facc15'],
      ramp: ['#fde68a', '#b45309'],
    },
  },
  jungle: {
    id: 'jungle',
    name: 'Jungle',
    base: 'oxcart',
    cells: { normal: 'Trail', crash: 'Fallen tree / thorn', slow: 'Mud', fast: 'Vine path', collect: 'Fruit', gate: 'Vine gate' },
    palette: {
      sky: ['#14532d', '#4ade80', '#d9f99d'],
      fog: '#bfe3a0',
      ground: ['#a3804f', '#987546'],
      side: ['#3f6b2a', '#386026'],
      line: '60,40,20',
      edge: '#14532d',
      mountains: ['#166534', '#22c55e'],
      cap: '#86efac',
      hazard: '#365314',
      slow: '#5b3a1c',
      fast: '#84cc16',
      collect: ['#f43f5e', '#fde047'],
      gate: ['#65a30d', '#ca8a04'],
      ramp: ['#a16207', '#422006'],
    },
  },
  icefield: {
    id: 'icefield',
    name: 'Icefield',
    base: 'skates',
    cells: { normal: 'Ice', crash: 'Crevasse / ice block', slow: 'Snowdrift', fast: 'Smooth ice', collect: 'Ice crystal', gate: 'Ice gate' },
    palette: {
      sky: ['#312e81', '#818cf8', '#e0e7ff'],
      fog: '#e0e7ff',
      ground: ['#cfe8f7', '#c3e0f3'],
      side: ['#eef6fb', '#e6f1f8'],
      line: '59,130,246',
      edge: '#4338ca',
      mountains: ['#a5b4fc', '#e0e7ff'],
      cap: '#ffffff',
      hazard: '#1e3a8a',
      slow: '#f8fafc',
      fast: '#93c5fd',
      collect: ['#22d3ee', '#ecfeff'],
      gate: ['#6366f1', '#06b6d4'],
      ramp: ['#e0f2fe', '#0284c7'],
    },
  },
  city: {
    id: 'city',
    name: 'City',
    base: 'skateboard',
    cells: { normal: 'Asphalt', crash: 'Parked car / barrier', slow: 'Crowd / puddle', fast: 'Downhill street', collect: 'Coin', gate: 'Street gate' },
    palette: {
      sky: ['#1e1b4b', '#a855f7', '#fbcfe8'],
      fog: '#e9d5ff',
      ground: ['#4b5563', '#454e5b'],
      side: ['#9ca3af', '#949ba7'],
      line: '229,231,235',
      edge: '#facc15',
      mountains: ['#312e81', '#6d28d9'],
      cap: '#fde047',
      hazard: '#dc2626',
      slow: '#60a5fa',
      fast: '#374151',
      collect: ['#facc15', '#fef08a'],
      gate: ['#22c55e', '#ec4899'],
      ramp: ['#fde047', '#a16207'],
    },
  },
  space: {
    id: 'space',
    name: 'Space',
    base: 'rover',
    cells: { normal: 'Regolith', crash: 'Crater / rock', slow: 'Dust drift', fast: 'Smooth plain', collect: 'Sample', gate: 'Beacon gate' },
    palette: {
      sky: ['#020617', '#1e1b4b', '#3b3363'],
      fog: '#2e2a4f',
      ground: ['#a8a29e', '#9f9995'],
      side: ['#78716c', '#716a66'],
      line: '41,37,36',
      edge: '#22d3ee',
      mountains: ['#57534e', '#78716c'],
      cap: '#d6d3d1',
      hazard: '#1c1917',
      slow: '#c7c1bc',
      fast: '#d6d3d1',
      collect: ['#4ade80', '#dcfce7'],
      gate: ['#22d3ee', '#e879f9'],
      ramp: ['#e7e5e4', '#44403c'],
    },
  },
};
