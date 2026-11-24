/**
 * Every model in the game, built from basic shapes with the voxel kit (voxel.ts). Same reading in every biome:
 *   Crash  = something tall / solid you would not want to hit, on a red-tinted cell
 *   Slow   = low rough stuff (moguls, mud, waves, crowd) on a muddy cell with ripples
 *   Fast   = flat, bright, animated arrows on the ground (drawn in render.ts, no model)
 *   Collect= small spinning shiny thing      Pickup = gold ring + light beam + the vehicle itself, spinning
 */
import { hash3 as hash } from '../shared/rng.ts';
import type { BiomeId, VehicleId } from '../shared/types.ts';
import { Model, modelFor } from './voxel.ts';
import type { Entry } from './voxel.ts';


// ---------- shared parts ----------

type PersonOpts = {
  x?: number;
  y?: number;
  z?: number;
  jacket: string;
  pants: string;
  skin?: string;
  hat?: 'helmet' | 'beanie' | 'cap' | 'safari' | 'none';
  hatColor?: string;
  pose?: 'stand' | 'crouch' | 'sit';
  backpack?: string;
  bib?: boolean;
  stripe?: string;
};

/** A rider seen mostly from behind: boots, legs, jacket with a stripe, arms, head, hat, optional backpack and race bib. */
function person(m: Model, o: PersonOpts): void {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const z = o.z ?? 0;
  const skin = o.skin ?? '#f1c27d';
  const pose = o.pose ?? 'stand';
  let t0: number; // torso bottom
  if (pose === 'sit') {
    m.box(x - 3, x + 3, y, y + 2, z - 1, z + 4, o.pants);
    m.box(x - 3, x - 1, y - 3, y, z + 3, z + 5, o.pants);
    m.box(x + 1, x + 3, y - 3, y, z + 3, z + 5, o.pants);
    t0 = y + 2;
  } else {
    const leg = pose === 'crouch' ? 4 : 6;
    m.box(x - 3, x - 1, y, y + 1, z - 1, z + 2, '#1f2937');
    m.box(x + 1, x + 3, y, y + 1, z - 1, z + 2, '#1f2937');
    m.box(x - 3, x - 1, y + 1, y + leg, z - 1, z + 1, o.pants);
    m.box(x + 1, x + 3, y + 1, y + leg, z - 1, z + 1, o.pants);
    m.box(x - 3, x + 3, y + leg - 1, y + leg + 1, z - 1, z + 1, o.pants);
    t0 = y + leg + 1;
  }
  const lean = pose === 'crouch' ? 1 : 0;
  m.box(x - 3, x + 3, t0, t0 + 5, z - 2 + lean, z + 1 + lean, o.jacket);
  if (o.stripe) m.box(x - 3, x + 3, t0 + 2, t0 + 3, z - 2 + lean, z + 1 + lean, o.stripe);
  m.box(x - 4, x - 3, t0 + 1, t0 + 5, z - 1 + lean, z + 1 + lean, o.jacket);
  m.box(x + 3, x + 4, t0 + 1, t0 + 5, z - 1 + lean, z + 1 + lean, o.jacket);
  m.box(x - 4, x - 3, t0, t0 + 1, z - 1 + lean, z + 1 + lean, '#1f2937');
  m.box(x + 3, x + 4, t0, t0 + 1, z - 1 + lean, z + 1 + lean, '#1f2937');
  const h0 = t0 + 5;
  m.box(x - 2, x + 2, h0, h0 + 4, z - 2 + lean, z + 2 + lean, skin);
  m.box(x - 2, x + 2, h0 + 1, h0 + 4, z - 2 + lean, z - 1 + lean, '#3f2a1d'); // hair at the back
  const hc = o.hatColor ?? '#1d4ed8';
  switch (o.hat ?? 'helmet') {
    case 'helmet':
      m.box(x - 3, x + 3, h0 + 2, h0 + 5, z - 3 + lean, z + 2 + lean, hc);
      m.box(x - 2, x + 2, h0 + 5, h0 + 6, z - 2 + lean, z + 2 + lean, hc);
      m.box(x - 3, x + 3, h0 + 2, h0 + 3, z + 1 + lean, z + 3 + lean, '#0f172a'); // goggles
      break;
    case 'beanie':
      m.box(x - 2, x + 2, h0 + 3, h0 + 6, z - 2 + lean, z + 2 + lean, hc);
      m.box(x - 1, x + 1, h0 + 6, h0 + 7, z - 1 + lean, z + 1 + lean, '#f8fafc');
      break;
    case 'cap':
      m.box(x - 2, x + 2, h0 + 3, h0 + 5, z - 2 + lean, z + 2 + lean, hc);
      m.box(x - 2, x + 2, h0 + 3, h0 + 4, z + 2 + lean, z + 4 + lean, hc);
      break;
    case 'safari':
      m.box(x - 4, x + 4, h0 + 3, h0 + 4, z - 4 + lean, z + 4 + lean, hc);
      m.box(x - 2, x + 2, h0 + 4, h0 + 6, z - 2 + lean, z + 2 + lean, hc);
      break;
    case 'none':
      break;
  }
  if (o.backpack) {
    m.box(x - 2, x + 2, t0, t0 + 5, z - 4 + lean, z - 2 + lean, o.backpack);
    m.box(x - 2, x + 2, t0 + 4, t0 + 5, z - 4 + lean, z - 2 + lean, '#1f2937');
  }
  if (o.bib) {
    m.box(x - 2, x + 2, t0 + 1, t0 + 4, z - 3 + lean, z - 2 + lean, '#f8fafc');
    m.box(x - 1, x, t0 + 2, t0 + 3, z - 3 + lean, z - 2 + lean, '#0f172a');
    m.box(x + 1, x + 2, t0 + 2, t0 + 4, z - 3 + lean, z - 2 + lean, '#0f172a');
  }
}

/** A sled dog (body, head, ears, tail, legs, harness). */
function dog(m: Model, x: number, z: number, fur: string, belly: string, harness: string): void {
  m.box(x - 1.5, x + 1.5, 3, 6, z - 4, z + 3, fur);
  m.box(x - 1.5, x + 1.5, 3, 4, z - 3, z + 2, belly);
  m.box(x - 1.5, x + 1.5, 5, 8, z + 2, z + 5, fur);
  m.box(x - 1, x + 1, 5, 6, z + 5, z + 6, '#1f2937');
  m.box(x - 1.5, x - 0.5, 8, 9, z + 2, z + 3, fur);
  m.box(x + 0.5, x + 1.5, 8, 9, z + 2, z + 3, fur);
  m.box(x - 0.5, x + 0.5, 6, 8, z - 5, z - 4, fur);
  for (const lz of [z - 3, z + 1]) {
    m.box(x - 1.5, x - 0.5, 0, 3, lz, lz + 1, fur);
    m.box(x + 0.5, x + 1.5, 0, 3, lz, lz + 1, fur);
  }
  m.box(x - 1.6, x + 1.6, 4, 5, z - 1, z, harness);
}

/** Wheel facing sideways (axis along x). */
function wheel(m: Model, x: number, y: number, z: number, r: number, width: number, tire = '#111827', hub = '#9ca3af'): void {
  m.cyl('x', y, z, r, x - width / 2, x + width / 2, tire);
  m.cyl('x', y, z, r * 0.45, x - width / 2 - 0.5, x + width / 2 + 0.5, hub);
}

/** Snow / sand / dust on top surfaces, with a little randomness. */
function capTops(m: Model, color: string, minY: number, chance: number): void {
  m.paint((x, y, z) => (y >= minY && m.get(x, y + 1, z) === 0 && hash(x, y, z) < chance ? color : undefined));
}

// ---------- vehicles ----------

function build(id: VehicleId): Model {
  switch (id) {
    case 'ski': {
      const m = new Model(14, 22, 24);
      m.box(-5, -3, 0, 1, -11, 10, '#f97316').box(3, 5, 0, 1, -11, 10, '#f97316');
      m.box(-5, -3, 1, 2, 9, 11, '#f97316').box(3, 5, 1, 2, 9, 11, '#f97316');
      person(m, { y: 1, jacket: '#dc2626', pants: '#1e3a8a', hat: 'helmet', hatColor: '#f8fafc', pose: 'crouch', bib: true, stripe: '#f8fafc' });
      m.line([-5, 8, 1], [-6, 0, -7], '#334155').line([5, 8, 1], [6, 0, -7], '#334155');
      return m;
    }
    case 'sandboard': {
      const m = new Model(14, 22, 22);
      m.box(-5, 5, 0, 1, -9, 9, '#7c2d12').box(-4, 4, 0, 1, -10, 10, '#7c2d12');
      m.box(-5, 5, 1, 2, -9, -8, '#fbbf24').box(-5, 5, 1, 2, 8, 9, '#fbbf24');
      person(m, { y: 1, jacket: '#0d9488', pants: '#1e3a8a', hat: 'cap', hatColor: '#f59e0b', pose: 'crouch', stripe: '#fde68a' });
      m.box(-6, 6, 9, 10, -1, 0, '#f8fafc'); // scarf trailing
      return m;
    }
    case 'heatboard': {
      const m = new Model(14, 22, 22);
      m.box(-5, 5, 0, 1, -10, 10, '#52525b').box(-5, 5, 0, 1, 8, 10, '#f97316').box(-5, -4, 0, 1, -10, 10, '#f97316').box(4, 5, 0, 1, -10, 10, '#f97316');
      person(m, { y: 1, jacket: '#d4d4d8', pants: '#a1a1aa', hat: 'helmet', hatColor: '#f97316', pose: 'crouch', stripe: '#f97316' });
      return m;
    }
    case 'jetski': {
      const m = new Model(14, 18, 26);
      for (let z = -12; z < 12; z++) {
        const w = z > 6 ? Math.max(1, 6 - (z - 6)) : 6;
        m.box(-w, w, 0, z > 8 ? 3 : 4, z, z + 1, z % 6 === 0 ? '#e11d48' : '#f8fafc');
      }
      m.box(-6, 6, 0, 1, -12, 12, '#e11d48');
      m.box(-3, 3, 4, 6, -8, 2, '#111827');
      m.box(-4, 4, 6, 7, 3, 4, '#111827').box(-1, 1, 4, 6, 3, 4, '#111827');
      person(m, { y: 6, z: -4, jacket: '#facc15', pants: '#1f2937', hat: 'none', pose: 'sit' });
      m.box(-6, 6, 0, 1, -13, -12, '#e0f2fe'); // spray
      return m;
    }
    case 'oxcart': {
      // an ox pulling a two-wheeled wooden cart; the driver sits on the cart's front bench
      const m = new Model(20, 22, 44);
      // ox (front): body, belly, legs with hooves, head with muzzle, horns, ears, tail
      m.ellipsoid(0, 9, 11, 4.5, 4, 7, '#8b5a2b');
      m.ellipsoid(0, 7.5, 11, 4, 2, 6, '#a0703f');
      for (const [x, z] of [
        [-2.5, 6],
        [2.5, 6],
        [-2.5, 16],
        [2.5, 16],
      ] as const)
        m.cyl('y', x, z, 1.2, 0, 7, '#6b4423').box(x - 1.2, x + 1.2, 0, 1, z - 1.2, z + 1.2, '#1f2937');
      m.box(-2.5, 2.5, 8, 13, 17, 22, '#8b5a2b').box(-2, 2, 8, 10, 21, 23, '#d6b38a').box(-1, 1, 8, 9, 22.5, 23.5, '#1f2937');
      m.box(-5, -2.5, 12, 13, 18, 19, '#f5f5f4').box(-5.5, -4.5, 13, 15, 18, 19, '#f5f5f4').box(2.5, 5, 12, 13, 18, 19, '#f5f5f4').box(4.5, 5.5, 13, 15, 18, 19, '#f5f5f4');
      m.box(-3, -2.5, 10, 12, 19, 20, '#6b4423').box(2.5, 3, 10, 12, 19, 20, '#6b4423');
      m.box(-0.5, 0.5, 5, 10, 3.5, 4.5, '#6b4423');
      // yoke and shafts
      m.box(-5.5, 5.5, 13, 14, 15, 16, '#78350f');
      m.line([-4, 9, -4], [-5, 13, 15], '#78350f', 0.4).line([4, 9, -4], [5, 13, 15], '#78350f', 0.4);
      // cart (back): bed, side boards with plank lines, a load of fruit, two big wheels with spokes
      m.box(-6, 6, 6, 8, -20, -2, '#a16207');
      m.box(-6, -5, 8, 11, -20, -2, '#854d0e').box(5, 6, 8, 11, -20, -2, '#854d0e').box(-6, 6, 8, 11, -21, -20, '#854d0e');
      m.paint((x, y, z) => (y >= 6 && y < 11 && z < -2 && z > -21 && Math.abs(x) <= 6 && (z + 21) % 4 === 0 ? '#713f12' : undefined));
      m.ellipsoid(-2, 9, -15, 3, 2.5, 3, '#65a30d').ellipsoid(2, 9, -12, 2.5, 2, 2.5, '#facc15');
      wheel(m, -7.5, 5, -11, 5, 1.5, '#78350f', '#451a03');
      wheel(m, 7.5, 5, -11, 5, 1.5, '#78350f', '#451a03');
      m.paint((x, y, z) => (Math.abs(x) >= 7 && Math.abs(Math.hypot(y - 5, z + 11) - 2.5) < 0.6 && (y - 5) * (z + 11) > 0 ? '#a16207' : undefined));
      // driver on the front bench, straw hat
      m.box(-4, 4, 8, 10, -6, -2, '#a16207');
      person(m, { y: 10, z: -4, jacket: '#15803d', pants: '#78350f', hat: 'safari', hatColor: '#facc15', pose: 'sit', stripe: '#86efac' });
      return m;
    }
    case 'skates': {
      const m = new Model(14, 22, 14);
      m.box(-3, -1, 0, 1, -3, 4, '#cbd5e1').box(1, 3, 0, 1, -3, 4, '#cbd5e1');
      person(m, { y: 1, jacket: '#6366f1', pants: '#1e1b4b', hat: 'beanie', hatColor: '#06b6d4' });
      m.box(-3, 1, 13, 14, -4, -2, '#ef4444').box(-1, 1, 9, 13, -5, -3, '#ef4444'); // scarf
      return m;
    }
    case 'skateboard': {
      const m = new Model(14, 22, 22);
      m.box(-4, 4, 2, 3, -9, 9, '#a855f7').box(-3, 3, 3, 4, -10, -9, '#a855f7').box(-3, 3, 3, 4, 9, 10, '#a855f7');
      for (const wz of [-6, 6]) for (const wx of [-4, 4]) m.box(wx - 1, wx + 1, 0, 2, wz - 1, wz + 1, '#fde047');
      person(m, { y: 3, jacket: '#f43f5e', pants: '#1e293b', hat: 'cap', hatColor: '#facc15', stripe: '#f8fafc' });
      return m;
    }
    case 'rover': {
      const m = new Model(18, 22, 26);
      m.box(-7, 7, 4, 8, -10, 10, '#e5e7eb').box(-7, 7, 4, 5, -10, 10, '#9ca3af');
      for (const wz of [-8, 0, 8]) {
        wheel(m, -8, 3, wz, 3, 2, '#374151', '#d1d5db');
        wheel(m, 8, 3, wz, 3, 2, '#374151', '#d1d5db');
      }
      m.box(-8, 8, 12, 13, -10, -2, '#1d4ed8').box(-8, 8, 12, 13, -6, -5, '#93c5fd');
      m.box(-1, 1, 8, 12, -8, -6, '#9ca3af');
      m.box(4, 5, 8, 18, 6, 7, '#9ca3af').box(3, 7, 18, 20, 5, 8, '#f8fafc');
      person(m, { y: 8, z: 2, jacket: '#f8fafc', pants: '#e5e7eb', hat: 'helmet', hatColor: '#f8fafc', pose: 'sit' });
      m.box(-2, 2, 15, 17, 4, 5, '#f59e0b'); // visor
      return m;
    }
    case 'snowmobile': {
      const m = new Model(16, 20, 28);
      m.box(-6, 6, 2, 7, -10, 8, '#dc2626').box(-5, 5, 7, 8, -10, 2, '#111827');
      m.box(-5, 5, 2, 9, 6, 10, '#dc2626').box(-5, 5, 9, 12, 7, 9, '#bae6fd');
      m.box(-5, 5, 0, 3, -12, 0, '#1f2937').box(-5, 5, 0, 1, -12, 0, '#4b5563');
      m.box(-7, -5, 0, 1, 4, 14, '#111827').box(5, 7, 0, 1, 4, 14, '#111827').box(-7, -5, 1, 2, 13, 14, '#111827').box(5, 7, 1, 2, 13, 14, '#111827');
      m.box(-6, 6, 4, 6, -11, -10, '#fca5a5'); // tail light
      person(m, { y: 8, z: -4, jacket: '#111827', pants: '#111827', hat: 'helmet', hatColor: '#dc2626', pose: 'sit' });
      return m;
    }
    case 'dogsled': {
      const m = new Model(16, 22, 44);
      m.box(-5, -4, 0, 1, -20, -6, '#111827').box(4, 5, 0, 1, -20, -6, '#111827');
      m.box(-5, 5, 2, 4, -18, -8, '#92400e').box(-5, -4, 4, 8, -18, -8, '#92400e').box(4, 5, 4, 8, -18, -8, '#92400e');
      person(m, { y: 1, z: -19, jacket: '#2563eb', pants: '#1e293b', hat: 'beanie', hatColor: '#e11d48', stripe: '#fde68a' });
      m.line([0, 4, -8], [0, 5, 14], '#78350f');
      dog(m, -3, 0, '#e5e7eb', '#f8fafc', '#dc2626');
      dog(m, 3, 0, '#78716c', '#d6d3d1', '#dc2626');
      dog(m, 0, 11, '#f5f5f4', '#ffffff', '#2563eb');
      return m;
    }
    case 'helicopter': {
      const m = new Model(30, 18, 34);
      m.ellipsoid(0, 7, 2, 6, 6, 8, (_x, y, z) => (z > 4 && y > 5 ? '#bae6fd' : y < 4 ? '#14532d' : '#16a34a'));
      m.box(-1.5, 1.5, 7, 9, -16, -5, '#16a34a').box(-0.5, 0.5, 9, 14, -16, -14, '#16a34a');
      m.box(-0.5, 0.5, 10, 15, -17, -16, '#111827').box(-0.5, 0.5, 12, 13, -19, -13, '#111827');
      m.box(-1, 1, 13, 15, 0, 3, '#111827');
      m.box(-15, 15, 15, 16, 1, 2, '#1f2937').box(-0.5, 0.5, 15, 16, -14, 17, '#1f2937');
      m.box(-6, -5, 0, 1, -4, 9, '#111827').box(5, 6, 0, 1, -4, 9, '#111827');
      m.box(-6, -5, 1, 3, 0, 1, '#111827').box(5, 6, 1, 3, 0, 1, '#111827').box(-6, -5, 1, 3, 6, 7, '#111827').box(5, 6, 1, 3, 6, 7, '#111827');
      m.box(-2, 2, 6, 8, -6, -5, '#facc15');
      m.lift = 1.7;
      return m;
    }
    case 'dunebuggy': {
      const m = new Model(18, 18, 26);
      m.box(-6, 6, 3, 6, -10, 10, '#f59e0b').box(-5, 5, 6, 7, 4, 10, '#f59e0b');
      for (const wz of [-7, 7]) {
        wheel(m, -7, 4, wz, 4, 3);
        wheel(m, 7, 4, wz, 4, 3);
      }
      for (const [a, b] of [
        [[-5, 6, -4], [-5, 14, -2]],
        [[5, 6, -4], [5, 14, -2]],
        [[-5, 14, -2], [5, 14, -2]],
        [[-5, 14, -2], [-5, 6, 4]],
        [[5, 14, -2], [5, 6, 4]],
      ] as [[number, number, number], [number, number, number]][])
        m.line(a, b, '#111827', 0.5);
      person(m, { y: 6, z: -3, jacket: '#0d9488', pants: '#1f2937', hat: 'helmet', hatColor: '#111827', pose: 'sit' });
      m.box(-6, 6, 5, 7, -11, -10, '#111827');
      return m;
    }
    case 'balloon': {
      const m = new Model(26, 44, 26);
      m.box(-4, 4, 0, 6, -4, 4, '#92400e').box(-4, 4, 5, 6, -4, 4, '#78350f');
      m.box(-2, 2, 6, 9, -2, 2, '#dc2626');
      for (const [x, z] of [
        [-3.5, -3.5],
        [3.5, -3.5],
        [-3.5, 3.5],
        [3.5, 3.5],
      ] as const)
        m.line([x, 6, z], [x * 2.4, 19, z * 2.4], '#78350f');
      const stripes = ['#dc2626', '#facc15', '#2563eb', '#facc15'];
      m.ellipsoid(0, 30, 0, 12, 13, 12, (x, _y, z) => stripes[Math.floor(((Math.atan2(z + 0.5, x + 0.5) + Math.PI) / (Math.PI * 2)) * 8) % 4] ?? '#dc2626');
      m.cone(0, 0, 17, 22, 5, 9, '#dc2626');
      m.lift = 1.2;
      return m;
    }
    case 'lavasurf': {
      const m = new Model(14, 22, 26);
      m.box(-5, 5, 0, 2, -11, 11, '#1c1917');
      m.paint((x, y, z) => (y === 1 && (hash(x, 0, z) < 0.25 || Math.abs(x) === 4) ? '#fb923c' : undefined));
      m.box(-4, 4, 0, 1, 11, 12, '#fde047');
      person(m, { y: 2, jacket: '#e5e7eb', pants: '#9ca3af', hat: 'helmet', hatColor: '#dc2626', pose: 'crouch', stripe: '#f97316' });
      return m;
    }
    case 'submarine': {
      const m = new Model(14, 14, 28);
      m.ellipsoid(0, 2, 0, 6, 5, 13, '#facc15');
      m.box(-7, 7, 0, 1, -14, 14, null); // waterline: keep only the top half visible
      m.box(-2, 2, 6, 10, -3, 3, '#eab308').box(-1, 1, 10, 13, -1, 0, '#374151').box(-1, 1, 12, 13, 0, 3, '#374151');
      for (const z of [-6, 0, 6]) m.box(-6.5, 6.5, 3, 4, z, z + 1, '#1e3a8a');
      m.box(-3, 3, 2, 4, -14, -13, '#64748b');
      m.box(-7, 7, 0, 1, -14, 14, null);
      return m;
    }
    case 'speedboat': {
      const m = new Model(16, 16, 30);
      for (let z = -13; z < 14; z++) {
        const w = z > 6 ? Math.max(1, 7 - (z - 6)) : 7;
        m.box(-w, w, 0, 5, z, z + 1, '#f8fafc');
        m.box(-w, w, 2, 3, z, z + 1, '#0ea5e9');
      }
      m.box(-6, 6, 5, 6, -12, 4, '#a16207');
      m.box(-6, 6, 5, 9, 4, 5, '#bae6fd');
      m.box(-2, 2, 2, 6, -14, -13, '#374151');
      person(m, { y: 5, z: -3, jacket: '#f97316', pants: '#1f2937', hat: 'cap', hatColor: '#0ea5e9', pose: 'sit' });
      return m;
    }
    case 'zipline': {
      const m = new Model(14, 34, 40);
      m.box(-0.5, 0.5, 32, 33, -20, 20, '#1f2937');
      m.box(-2, 2, 29, 32, -2, 2, '#a16207');
      m.line([-3, 23, 0], [0, 29, 0], '#facc15').line([3, 23, 0], [0, 29, 0], '#facc15');
      person(m, { y: 8, jacket: '#65a30d', pants: '#3f3f46', hat: 'helmet', hatColor: '#ca8a04' });
      return m;
    }
    case 'elephant': {
      const m = new Model(22, 30, 32);
      m.ellipsoid(0, 13, -2, 9, 7, 12, '#9ca3af');
      for (const [x, z] of [
        [-5, -9],
        [5, -9],
        [-5, 5],
        [5, 5],
      ] as const)
        m.cyl('y', x, z, 2.5, 0, 9, '#8b949e');
      m.ellipsoid(0, 16, 12, 6, 6, 5, '#9ca3af');
      m.ellipsoid(-8, 16, 11, 4, 5, 1.5, '#b3bac3').ellipsoid(8, 16, 11, 4, 5, 1.5, '#b3bac3');
      m.cyl('y', 0, 16, 1.6, 4, 13, '#9ca3af').box(-1, 1, 3, 5, 16, 19, '#9ca3af');
      m.line([-3, 12, 15], [-3, 9, 19], '#f8fafc').line([3, 12, 15], [3, 9, 19], '#f8fafc');
      m.box(-0.5, 0.5, 10, 14, -15, -14, '#6b7280');
      m.box(-6, 6, 19, 21, -6, 4, '#b91c1c').box(-6, 6, 19, 20, -6, 4, '#facc15');
      person(m, { y: 21, z: 0, jacket: '#b45309', pants: '#365314', hat: 'safari', hatColor: '#65a30d', pose: 'sit' });
      return m;
    }
    case 'icebreaker': {
      const m = new Model(20, 26, 36);
      for (let z = -16; z < 17; z++) {
        const w = z > 6 ? Math.max(1, 8 - Math.floor((z - 6) * 0.8)) : 8;
        m.box(-w, w, 0, 8, z, z + 1, '#b91c1c');
        m.box(-w, w, 6, 8, z, z + 1, '#111827');
      }
      m.box(-6, 6, 8, 15, -14, -3, '#f8fafc');
      for (const x of [-4, -1, 2]) m.box(x, x + 2, 12, 14, -14.5, -13.5, '#1e3a8a');
      m.box(-6, 6, 15, 16, -14, -3, '#9ca3af');
      m.box(-2, 2, 16, 23, -10, -6, '#facc15').box(-2, 2, 21, 23, -10, -6, '#111827');
      m.box(-1, 1, 8, 20, 8, 9, '#e5e7eb');
      return m;
    }
    case 'dogteam': {
      const m = new Model(16, 22, 56);
      m.box(-5, -4, 0, 1, -26, -12, '#111827').box(4, 5, 0, 1, -26, -12, '#111827');
      m.box(-5, 5, 2, 4, -24, -14, '#1d4ed8').box(-5, -4, 4, 8, -24, -14, '#1d4ed8').box(4, 5, 4, 8, -24, -14, '#1d4ed8');
      person(m, { y: 1, z: -25, jacket: '#06b6d4', pants: '#1e1b4b', hat: 'beanie', hatColor: '#6366f1', stripe: '#f8fafc' });
      m.line([0, 4, -14], [0, 5, 24], '#78350f');
      dog(m, -3, -6, '#57534e', '#d6d3d1', '#f59e0b');
      dog(m, 3, -6, '#f5f5f4', '#ffffff', '#f59e0b');
      dog(m, -3, 5, '#f5f5f4', '#ffffff', '#f59e0b');
      dog(m, 3, 5, '#57534e', '#d6d3d1', '#f59e0b');
      dog(m, 0, 17, '#a8a29e', '#f5f5f4', '#dc2626');
      return m;
    }
    case 'bicycle': {
      const m = new Model(12, 22, 24);
      m.cyl('x', 4.5, -7, 4.5, -0.5, 0.5, '#111827', 3.5).cyl('x', 4.5, 7, 4.5, -0.5, 0.5, '#111827', 3.5);
      m.line([0, 4.5, -7], [0, 9, -2], '#22c55e', 0.4).line([0, 9, -2], [0, 9, 5], '#22c55e', 0.4).line([0, 9, 5], [0, 4.5, 7], '#22c55e', 0.4).line([0, 4.5, -7], [0, 4.5, 0], '#22c55e', 0.4).line([0, 4.5, 0], [0, 9, 5], '#22c55e', 0.4);
      m.box(-4, 4, 12, 13, 5, 6, '#111827');
      person(m, { y: 8, z: -1, jacket: '#22c55e', pants: '#1e293b', hat: 'helmet', hatColor: '#ec4899', pose: 'sit', stripe: '#f8fafc' });
      return m;
    }
    case 'subway': {
      const m = new Model(16, 18, 44);
      m.box(-7, 7, 1, 15, -20, 20, '#e5e7eb').box(-7, 7, 15, 16, -19, 19, '#9ca3af');
      m.box(-7.5, 7.5, 7, 11, -18, 18, '#1e3a8a');
      for (let z = -16; z < 18; z += 6) m.box(-7.6, 7.6, 7, 11, z, z + 1, '#e5e7eb');
      m.box(-7.5, 7.5, 2, 5, -20, 20, '#dc2626');
      m.box(-5, 5, 7, 12, -20.5, -19.5, '#1e3a8a').box(-6, -4, 3, 5, -20.6, -19.5, '#fde68a').box(4, 6, 3, 5, -20.6, -19.5, '#fde68a');
      m.box(-6, -5, 0, 1, -22, 22, '#6b7280').box(5, 6, 0, 1, -22, 22, '#6b7280');
      return m;
    }
    case 'rocket': {
      const m = new Model(14, 26, 16);
      person(m, { y: 6, jacket: '#f8fafc', pants: '#94a3b8', hat: 'helmet', hatColor: '#ef4444', stripe: '#ef4444' });
      m.cyl('y', -2, -4, 1.8, 10, 18, '#ef4444').cyl('y', 2, -4, 1.8, 10, 18, '#ef4444');
      m.cone(-2, -4, 18, 20, 1.8, 0.5, '#f8fafc').cone(2, -4, 18, 20, 1.8, 0.5, '#f8fafc');
      m.cone(-2, -4, 2, 10, 0.5, 1.6, (_x, y) => (y < 5 ? '#fde047' : '#fb923c'));
      m.cone(2, -4, 2, 10, 0.5, 1.6, (_x, y) => (y < 5 ? '#fde047' : '#fb923c'));
      return m;
    }
  }
  const m = new Model(12, 14, 12);
  person(m, { jacket: '#64748b', pants: '#334155' });
  return m;
}

export const vehicleModel = (id: VehicleId): Entry => modelFor(`v:${id}`, () => build(id), 'vehicle');

// ---------- obstacles (Crash) ----------

function pine(k: number): Model {
  const s = 0.85 + k * 0.4;
  const m = new Model(16, 34, 16);
  m.cyl('y', 0, 0, 1.6, 0, 6, '#78350f');
  m.cone(0, 0, 4, 4 + 10 * s, 7.5, 2.5, '#14532d');
  m.cone(0, 0, 4 + 7 * s, 4 + 17 * s, 6, 1.5, '#166534');
  m.cone(0, 0, 4 + 13 * s, 4 + 24 * s, 4.5, 0, '#15803d');
  return m;
}
function rock(base: string, light: string, k: number): Model {
  const m = new Model(14, 12, 14);
  m.ellipsoid(0, 0, 0, 6, 6 + k * 4, 5.5, base);
  m.ellipsoid(-2, 0, -1, 4, 8 + k * 3, 4, base);
  m.ellipsoid(3, 0, 2, 3.5, 5, 3.5, light);
  return m;
}

function crashBuild(biome: BiomeId, variant: 0 | 1, k: number): Model {
  switch (biome) {
    case 'snow': {
      if (variant === 0) {
        const m = pine(k);
        capTops(m, '#f8fafc', 6, 0.75);
        return m;
      }
      const m = rock('#64748b', '#94a3b8', k);
      capTops(m, '#f8fafc', 7, 0.55);
      return m;
    }
    case 'desert': {
      if (variant === 0) {
        const h = 18 + Math.round(k * 8);
        const m = new Model(16, 30, 8);
        m.cyl('y', 0, 0, 2.4, 0, h, '#3f8a3a').ellipsoid(0, h, 0, 2.4, 2, 2.4, '#3f8a3a');
        m.cyl('x', 9, 0, 1.6, -6, -1, '#3f8a3a').cyl('y', -5.5, 0, 1.6, 9, 15, '#3f8a3a').ellipsoid(-5.5, 15, 0, 1.6, 1.4, 1.6, '#3f8a3a');
        m.cyl('x', 12, 0, 1.6, 1, 6, '#3f8a3a').cyl('y', 5.5, 0, 1.6, 12, 18, '#3f8a3a').ellipsoid(5.5, 18, 0, 1.6, 1.4, 1.6, '#3f8a3a');
        m.paint((x, _y, z) => ((x + z) % 2 === 0 ? '#2f6b2b' : undefined));
        m.box(-1, 1, h + 1, h + 3, -1, 1, '#f472b6');
        return m;
      }
      const m = new Model(14, 14, 12);
      const bands = ['#b45309', '#d97706', '#c2410c', '#ea9a4c'];
      for (let y = 0; y < 10 + k * 3; y++) {
        const w = 6 - Math.abs(y - 4) * 0.35 + hash(y, 1, 2) * 1.2;
        m.box(-w, w, y, y + 1, -5 + hash(y, 3, 4), 5 - hash(y, 5, 6), bands[Math.floor(y / 2) % 4] ?? '#b45309');
      }
      return m;
    }
    case 'volcano': {
      // lava: a glowing pool with a dark crust rim; variant 1 adds a fire spout so it reads as "do not touch" from afar
      const m = new Model(14, variant === 1 ? 26 : 4, 14);
      m.cyl('y', 0, 0, 6.5, 0, 2, '#292524', 4.8);
      m.cyl('y', 0, 0, 5, 0, 1, '#f97316');
      m.paint((x, y, z) => (y === 0 && Math.hypot(x, z) < 5 ? (hash(x, 9, z) < 0.25 ? '#fde047' : hash(x, 8, z) < 0.15 ? '#7c2d12' : undefined) : undefined));
      if (variant === 1) {
        const h = 14 + Math.round(k * 9);
        m.cone(0, 0, 1, h, 3.5, 0.6, (x, y, z) => (y > h * 0.7 ? '#fde047' : hash(x, y, z) < 0.5 ? '#f97316' : '#ef4444'));
      }
      return m;
    }
    case 'ocean': {
      if (variant === 0) {
        const m = new Model(16, 20, 16);
        m.ellipsoid(0, 0, 0, 6, 3, 6, '#9f8a74');
        const cols = ['#f472b6', '#fb7185', '#c084fc', '#fb923c'];
        for (let i = 0; i < 6; i++) {
          const x = Math.round((hash(i, 1, k * 9) - 0.5) * 9);
          const z = Math.round((hash(i, 2, k * 9) - 0.5) * 9);
          const h = 7 + Math.round(hash(i, 3, k * 9) * 9);
          const c = cols[i % 4] ?? '#f472b6';
          m.cyl('y', x, z, 1.2, 1, h, c).ellipsoid(x, h, z, 1.8, 1.5, 1.8, c);
          m.line([x, h - 3, z], [x + 2, h + 1, z + 1], c);
        }
        return m;
      }
      const m = rock('#475569', '#64748b', k);
      m.cyl('y', 0, 0, 7, 0, 1, '#f8fafc', 5.5);
      return m;
    }
    case 'jungle': {
      if (variant === 0) {
        const m = new Model(16, 10, 10);
        m.cyl('x', 4, 0, 4, -8, 8, '#78350f');
        m.paint((x, y, z) => (Math.abs(x) >= 7.5 ? '#d6a36a' : (Math.round(Math.atan2(y - 4, z) * 3) % 2 === 0 ? '#5b2a0c' : undefined)));
        capTops(m, '#4d7c0f', 6, 0.6);
        m.box(2, 3, 8, 9, -1, 0, '#f8fafc').box(1, 4, 9, 10, -2, 1, '#dc2626');
        return m;
      }
      const m = new Model(16, 14, 16);
      m.ellipsoid(0, 4, 0, 7, 5, 7, '#365314');
      for (let i = 0; i < 14; i++) {
        const a = hash(i, 4, k * 7) * Math.PI * 2;
        const e = hash(i, 5, k * 7) * 1.2;
        m.line([0, 5, 0], [Math.cos(a) * 8 * Math.cos(e), 5 + Math.sin(e) * 8, Math.sin(a) * 8 * Math.cos(e)], '#a16207');
      }
      m.paint((x, y, z) => (hash(x, y, z) < 0.06 && m.get(x, y + 1, z) === 0 ? '#dc2626' : undefined));
      return m;
    }
    case 'icefield': {
      if (variant === 0) {
        // crevasse: a deep crack with jagged ice lips
        const m = new Model(14, 5, 14);
        m.box(-7, 7, 0, 1, -7, 7, '#e0f2fe');
        m.box(-7, 7, 0, 1, -3, 3, '#0b1d3a').box(-7, 7, 0, 1, -4, -3, '#1e3a8a').box(-7, 7, 0, 1, 3, 4, '#1e3a8a');
        for (let x = -7; x < 7; x++) {
          m.box(x, x + 1, 1, 1 + Math.round(hash(x, 1, k) * 3), -5, -3, '#bae6fd');
          m.box(x, x + 1, 1, 1 + Math.round(hash(x, 2, k) * 3), 3, 5, '#bae6fd');
        }
        return m;
      }
      const m = new Model(14, 14, 14);
      const s = 4.5 + k * 1.5;
      m.box(-s, s, 0, s * 2, -s, s, '#7dd3fc');
      m.paint((x, y, z) => (Math.abs(x) >= s - 1 || y >= s * 2 - 1 || Math.abs(z) >= s - 1 ? (hash(x, y, z) < 0.5 ? '#e0f2fe' : '#bae6fd') : undefined));
      m.box(-s + 1, -s + 2, 2, s * 2 - 1, -s - 0.5, -s + 0.5, '#f8fafc');
      return m;
    }
    case 'city': {
      if (variant === 0) {
        const m = new Model(14, 12, 22);
        const body = k < 0.5 ? '#ef4444' : '#2563eb'; // two size variants → red and blue cars
        m.box(-6, 6, 2, 6, -10, 10, body);
        m.box(-5, 5, 6, 10, -5, 5, '#bfdbfe').box(-5, 5, 9, 10, -4, 4, body).box(-5.5, 5.5, 6, 9, -1, 1, body);
        for (const wz of [-6, 6]) {
          wheel(m, -6, 2.5, wz, 2.5, 1.5);
          wheel(m, 6, 2.5, wz, 2.5, 1.5);
        }
        m.box(-6, -3, 4, 5, -10.5, -10, '#dc2626').box(3, 6, 4, 5, -10.5, -10, '#dc2626').box(-2, 2, 3, 4, -10.5, -10, '#f8fafc');
        m.box(-6, -3, 4, 5, 10, 10.5, '#fef08a').box(3, 6, 4, 5, 10, 10.5, '#fef08a');
        return m;
      }
      const m = new Model(14, 12, 6);
      for (let y = 0; y < 8; y++) {
        const w = y < 2 ? 3 : y < 4 ? 2.5 : 1.8;
        m.box(-7, 7, y, y + 1, -w, w, '#e5e7eb');
      }
      m.paint((x) => (Math.floor((x + 7) / 3.5) % 2 === 0 ? '#f97316' : undefined));
      m.box(-1, 1, 8, 10, -1, 1, '#facc15').box(-0.5, 0.5, 10, 11, -0.5, 0.5, '#fde047');
      return m;
    }
    case 'space': {
      if (variant === 0) {
        const m = new Model(14, 5, 14);
        m.cyl('y', 0, 0, 7, 0, 3, '#a8a29e', 4.5).cyl('y', 0, 0, 6, 3, 4, '#d6d3d1', 4.8);
        m.cyl('y', 0, 0, 4.5, 0, 1, '#1c1917');
        m.cyl('y', 0, 0, 2.5, 0, 1, '#0c0a09');
        return m;
      }
      const m = rock('#57534e', '#78716c', k);
      m.paint((x, y, z) => (hash(x, y, z) < 0.12 ? '#44403c' : undefined));
      return m;
    }
  }
}

export const crashModel = (biome: BiomeId, variant: 0 | 1, k: number): Entry => {
  const kk = k < 0.5 ? 0.25 : 0.85; // 2 size variants (fewer models to bake and keep)
  return modelFor(`c:${biome}:${variant}:${kk}`, () => crashBuild(biome, variant, kk), biome);
};

// ---------- Slow ----------

function slowBuild(biome: BiomeId): Model {
  const m = new Model(14, 16, 14);
  switch (biome) {
    case 'snow':
    case 'icefield':
      m.ellipsoid(-2.5, 0, -2, 4.5, 3, 4, '#e2e8f0').ellipsoid(3, 0, 3, 3.5, 2.5, 3.5, '#e2e8f0');
      capTops(m, '#f8fafc', 1, 1);
      return m;
    case 'desert':
      for (let z = -6; z < 7; z += 4) m.ellipsoid(0, 0, z, 7, 2.5, 1.8, '#e8b866');
      capTops(m, '#f6d79b', 1, 1);
      return m;
    case 'volcano':
      m.box(-6, 6, 0, 1, -6, 6, '#451a03');
      m.paint((x, y, z) => (y === 0 && hash(x, 7, z) < 0.3 ? '#f97316' : undefined));
      for (let i = 0; i < 8; i++) m.box(Math.round((hash(i, 1, 3) - 0.5) * 10), Math.round((hash(i, 1, 3) - 0.5) * 10) + 1, 2 + i, 3 + i, Math.round((hash(i, 2, 3) - 0.5) * 10), Math.round((hash(i, 2, 3) - 0.5) * 10) + 1, i % 2 ? '#fde047' : '#fb923c');
      return m;
    case 'ocean':
      for (let x = -7; x < 7; x++) {
        const h = 4 + Math.round(Math.sin(x * 0.6) * 1.5);
        m.box(x, x + 1, 0, h, -3, 2, '#38bdf8').box(x, x + 1, h - 1, h + 1, 0, 3, '#f8fafc');
      }
      return m;
    case 'jungle':
      m.cyl('y', 0, 0, 6.5, 0, 1, '#5b3a1c');
      for (const [x, z] of [
        [-2, -2],
        [3, 1],
        [0, 4],
      ] as const)
        m.ellipsoid(x, 1, z, 1.2, 1, 1.2, '#7c5530');
      return m;
    case 'city':
      person(m, { x: -3, z: -2, jacket: '#60a5fa', pants: '#334155', hat: 'cap', hatColor: '#f43f5e' });
      person(m, { x: 3, z: 3, jacket: '#fbbf24', pants: '#1f2937', hat: 'none' });
      return m;
    case 'space':
      m.ellipsoid(0, 0, 0, 6.5, 2.5, 6, '#c7c1bc').ellipsoid(2, 0, -2, 3, 3.5, 3, '#d6d3d1');
      return m;
  }
}
export const slowModel = (biome: BiomeId): Entry => modelFor(`s:${biome}`, () => slowBuild(biome), biome);

// ---------- Collect ----------

function collectBuild(biome: BiomeId): Model {
  const m = new Model(10, 10, 4);
  switch (biome) {
    case 'snow':
      for (let a = 0; a < 6; a++) {
        const c = Math.cos((a * Math.PI) / 3);
        const s = Math.sin((a * Math.PI) / 3);
        m.line([0, 5, 0], [c * 4.5, 5 + s * 4.5, 0], '#e0f2fe', 0.5);
      }
      m.box(-1, 1, 4, 6, -1, 1, '#38bdf8');
      return m;
    case 'desert':
      m.ellipsoid(0, 3.5, 0, 3, 3, 1.8, '#38bdf8').cone(0, 0, 5, 9, 2.2, 0.3, '#38bdf8');
      m.box(-1, 0, 4, 6, -2, -1, '#e0f2fe');
      return m;
    case 'volcano':
    case 'icefield': {
      const col = biome === 'volcano' ? '#7c3aed' : '#22d3ee';
      const hi = biome === 'volcano' ? '#c4b5fd' : '#ecfeff';
      m.cone(0, 0, 0, 5, 0.5, 3, col).cone(0, 0, 5, 10, 3, 0.4, col);
      m.paint((x, y) => (x < 0 && y > 4 ? hi : undefined));
      return m;
    }
    case 'ocean':
      for (let a = 0; a < 7; a++) {
        const t = (a / 6) * Math.PI;
        m.line([0, 1, 0], [Math.cos(t) * 4.5, 1 + Math.sin(t) * 6, 0], a % 2 ? '#fda4af' : '#fb7185', 0.6);
      }
      return m;
    case 'jungle':
      m.ellipsoid(0, 4, 0, 3.5, 3.5, 2, '#ef4444').box(0, 1, 7, 9, -0.5, 0.5, '#78350f').box(1, 3, 8, 9, -0.5, 0.5, '#22c55e');
      m.box(-2, -1, 5, 6, -2.1, -1.5, '#fecaca');
      return m;
    case 'city':
      m.cyl('z', 0, 5, 4.5, -0.8, 0.8, '#eab308').cyl('z', 0, 5, 3.3, -1, 1, '#facc15');
      m.box(-1, 1, 3, 7, -1.2, 1.2, '#fef08a');
      return m;
    case 'space':
      m.cyl('y', 0, 0, 1.8, 0, 5, '#4ade80').cyl('y', 0, 0, 1.8, 5, 8, '#e0f2fe').box(-2, 2, 8, 9, -2, 2, '#94a3b8');
m.box(-1, 0, 1, 4, -1.9, -1.2, '#bbf7d0');
      return m;
  }
}
export const collectModel = (biome: BiomeId): Entry => modelFor(`k:${biome}`, () => collectBuild(biome), biome);

// ---------- gate poles, ramp, pickup pad ----------

/** A gate pole on the edge of its cell next to the opening; the flag points away from the opening. */
export const poleModel = (color: string, openingOnRight: boolean): Entry =>
  modelFor(`p:${color}:${openingOnRight}`, () => {
    const m = new Model(12, 20, 4);
    const px = openingOnRight ? 5 : -6;
    m.box(px, px + 1, 0, 18, -0.5, 0.5, '#f8fafc');
    m.paint((_x, y) => (y % 4 < 2 ? '#1f2937' : undefined));
    const dir = openingOnRight ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      const x = px + dir * (i + 1);
      m.box(x, x + 1, 12 + Math.floor(i / 2), 18 - Math.floor(i / 3), -0.5, 0.5, color);
    }
    m.box(px - 0.5, px + 1.5, 18, 19, -1, 1, '#facc15');
    return m;
  });

export const rampModel = (top: string, side: string): Entry =>
  modelFor(`r:${top}:${side}`, () => {
    const m = new Model(12, 8, 12);
    for (let z = -6; z < 6; z++) {
      const h = Math.max(1, Math.round(((z + 6) / 12) * 7));
      m.box(-5, 5, 0, h, z, z + 1, side);
      m.box(-5, 5, h - 1, h, z, z + 1, top);
    }
    // hazard stripes along both edges and a forward arrow on top
    m.paint((x, y, z) => (Math.abs(x) >= 4 && m.get(x, y + 1, z) === 0 ? ((x + z + y) % 4 < 2 ? '#111827' : '#facc15') : undefined));
    m.paint((x, y, z) => {
      const onTop = m.get(x, y + 1, z) === 0;
      if (!onTop) return undefined;
      const ax = Math.abs(x + 0.5);
      const arrow = (z >= -2 && z <= 2 && ax <= 1) || (z >= 2 && z <= 5 && ax <= 5 - z + 0.5 && ax <= 3);
      return arrow ? '#f8fafc' : undefined;
    });
    return m;
  });

export const pickupPadModel = (): Entry =>
  modelFor('pad', () => {
    const m = new Model(12, 2, 12);
    m.cyl('y', 0, 0, 5.8, 0, 1, '#facc15', 4.2).cyl('y', 0, 0, 4.2, 0, 1, '#fef9c3', 3.3);
    m.paint((x, _y, z) => (Math.round(Math.atan2(z, x) * 4) % 2 === 0 && Math.hypot(x, z) > 4 ? '#f59e0b' : undefined));
    return m;
  });

// ---------- texts ----------

/** Short effect line for HUD / preview, derived only from the vehicle's data flags. */
export function effectText(v: {
  lanesPerRow: number;
  ignoreCrash: boolean;
  ignoreSlow: boolean;
  breakCrash: boolean;
  straightOnly: boolean;
  noCollect: boolean;
  noGate: boolean;
  jumpRows: number;
  rampBonus: number;
  turnCooldown: boolean;
  noRamp: boolean;
}): string {
  const out: string[] = [];
  if (v.jumpRows > 0) out.push(`hops ${v.jumpRows} rows per step, no steering`);
  if (v.straightOnly) out.push('straight only');
  else if (v.lanesPerRow === 2) out.push(v.turnCooldown ? '2 lanes per row, then 1 row cooldown' : '2 lanes per row');
  if (v.ignoreCrash) out.push('passes obstacles');
  if (v.breakCrash) out.push('smashes obstacles +5');
  if (v.ignoreSlow) out.push('ignores slow ground');
  if (v.rampBonus > 1) out.push(`ramp +${20 * v.rampBonus}`);
  if (v.noRamp) out.push('no ramps');
  if (v.noCollect && v.noGate) out.push('no collect/gate points');
  else if (v.noGate) out.push('no gate points');
  else if (v.noCollect) out.push('no collect points');
  return out.join(' · ');
}
