/**
 * Sound, synthesised at run time with the Web Audio API: no audio files, nothing to license, nothing to download.
 *
 * - One-shot effects (gate, collect, crash, …) are short oscillator / filtered-noise envelopes built per call.
 * - The ride sound is a looped noise buffer through a filter, plus an optional engine oscillator and hoof/paw steps,
 *   shaped every frame by the current vehicle and speed (`sfxFrame`).
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created on the first key / pointer press.
 * The sound mode (all / effects only / off) is remembered in localStorage. Background music lives in music.ts and
 * plays through the same context.
 */
import { vehicleFor } from '../shared/sim.ts';
import type { GameEvent, RunState } from '../shared/sim.ts';
import type { VehicleId } from '../shared/types.ts';

const MUTE_KEY = 'grid-expedition:sound';
const MASTER = 0.5;

/** How a vehicle sounds while moving: noise (filter type, centre Hz, Q, level), engine (base Hz, level), steps per second. */
type Ride = { f: BiquadFilterType; hz: number; q: number; vol: number; engine?: number; ev?: number; steps?: number };
const GLIDE: Ride = { f: 'bandpass', hz: 3200, q: 0.6, vol: 0.32 };
const RIDES: Partial<Record<VehicleId, Ride>> = {
  ski: GLIDE,
  sandboard: { f: 'bandpass', hz: 1400, q: 0.5, vol: 0.34 },
  heatboard: { f: 'highpass', hz: 2500, q: 0.7, vol: 0.22 },
  lavasurf: { f: 'lowpass', hz: 500, q: 1.5, vol: 0.5 },
  skates: { f: 'bandpass', hz: 5500, q: 1.2, vol: 0.28 },
  skateboard: { f: 'lowpass', hz: 700, q: 0.8, vol: 0.5 },
  bicycle: { f: 'bandpass', hz: 900, q: 0.8, vol: 0.2, steps: 3 },
  jetski: { f: 'lowpass', hz: 900, q: 0.7, vol: 0.4, engine: 70, ev: 0.06 },
  speedboat: { f: 'lowpass', hz: 900, q: 0.7, vol: 0.4, engine: 55, ev: 0.08 },
  submarine: { f: 'lowpass', hz: 260, q: 2, vol: 0.5, engine: 40, ev: 0.05 },
  snowmobile: { f: 'bandpass', hz: 2600, q: 0.6, vol: 0.22, engine: 62, ev: 0.08 },
  dunebuggy: { f: 'bandpass', hz: 1200, q: 0.5, vol: 0.22, engine: 48, ev: 0.09 },
  rover: { f: 'lowpass', hz: 400, q: 0.6, vol: 0.18, engine: 90, ev: 0.05 },
  icebreaker: { f: 'lowpass', hz: 600, q: 1, vol: 0.4, engine: 38, ev: 0.09 },
  subway: { f: 'lowpass', hz: 500, q: 1, vol: 0.4, engine: 45, ev: 0.06, steps: 2 },
  helicopter: { f: 'lowpass', hz: 300, q: 0.8, vol: 0.35, engine: 30, ev: 0.1 },
  rocket: { f: 'lowpass', hz: 1800, q: 0.4, vol: 0.45 },
  balloon: { f: 'bandpass', hz: 600, q: 0.4, vol: 0.12 },
  zipline: { f: 'bandpass', hz: 4200, q: 3, vol: 0.2 },
  oxcart: { f: 'lowpass', hz: 350, q: 0.8, vol: 0.3, steps: 2.2 },
  elephant: { f: 'lowpass', hz: 300, q: 0.8, vol: 0.25, steps: 1.4 },
  dogsled: { f: 'bandpass', hz: 3000, q: 0.6, vol: 0.25, steps: 5 },
  dogteam: { f: 'bandpass', hz: 4500, q: 0.8, vol: 0.22, steps: 5 },
};
const HEAVY_STEPS = new Set<VehicleId>(['oxcart', 'elephant']);

export type SoundMode = 'all' | 'sfx' | 'off';
let mode: SoundMode = (() => {
  try {
    const v = localStorage.getItem(MUTE_KEY);
    return v === 'off' || v === 'sfx' ? v : 'all';
  } catch {
    return 'all';
  }
})();

type Loop = { filter: BiquadFilterNode; ng: GainNode; osc: OscillatorNode; lp: BiquadFilterNode; eg: GainNode };
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let loop: Loop | null = null;

function ensure(): AudioContext | null {
  if (ac) return ac;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ac = new Ctor();
  const comp = ac.createDynamicsCompressor();
  comp.connect(ac.destination);
  master = ac.createGain();
  master.gain.value = mode === 'off' ? 0 : MASTER;
  master.connect(comp);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

/** Call once: the first gesture creates / resumes the context; hidden tabs go quiet. */
let installed = false;
export function installSfx(): void {
  if (installed) return;
  installed = true;
  const unlock = () => {
    const c = ensure();
    if (c && c.state === 'suspended' && document.visibilityState === 'visible') void c.resume();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.visibilityState === 'hidden') void ac.suspend();
    else void ac.resume();
  });
}

export const soundMode = (): SoundMode => mode;
export function setSoundMode(m: SoundMode): void {
  mode = m;
  try {
    localStorage.setItem(MUTE_KEY, m);
  } catch {
    /* private mode */
  }
  if (ac && master) master.gain.setTargetAtTime(m === 'off' ? 0 : MASTER, ac.currentTime, 0.03);
}

/** Usable context, or null if audio is locked, off or unsupported (then sounds are skipped entirely). */
function live(): AudioContext | null {
  return ac && master && mode !== 'off' && ac.state === 'running' ? ac : null;
}
/** For music.ts: the running context and the master bus, or null. */
export function audioOut(): { c: AudioContext; master: GainNode } | null {
  const c = live();
  return c && master ? { c, master } : null;
}

/** at: seconds from now, or when: absolute context time; out: destination (default the master bus). */
type When = { at?: number; when?: number; out?: AudioNode };
export type ToneOpts = When & { type?: OscillatorType; vol?: number; attack?: number };
/** Oscillator from f0 to f1 Hz over dur seconds with a fast attack and exponential decay. */
export function tone(f0: number, f1: number, dur: number, { type = 'square', vol = 0.15, at = 0, when, out, attack = 0.005 }: ToneOpts = {}): void {
  const c = live();
  if (!c || !master) return;
  const t = when ?? c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out ?? master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

type NoiseOpts = When & { f?: BiquadFilterType; hz?: number; hz1?: number; q?: number; vol?: number; attack?: number };
/** Filtered noise burst; the filter can sweep from hz to hz1. */
export function noise(dur: number, { f = 'bandpass', hz = 1000, hz1 = hz, q = 1, vol = 0.3, at = 0, when, out, attack = 0.005 }: NoiseOpts = {}): void {
  const c = live();
  if (!c || !master || !noiseBuf) return;
  const t = when ?? c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const fl = c.createBiquadFilter();
  fl.type = f;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(hz, t);
  if (hz1 !== hz) fl.frequency.exponentialRampToValueAtTime(hz1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(out ?? master);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

const notes = (hz: number[], step: number, dur: number, opts: ToneOpts = {}) => hz.forEach((h, i) => tone(h, h, dur, { ...opts, at: (opts.at ?? 0) + i * step }));

/** Same kind twice within this many seconds plays once (several collects in a row stay readable). */
const MIN_GAP = 0.045;
const lastAt = new Map<string, number>();

export function sfxEvent(s: RunState, e: GameEvent): void {
  const c = live();
  if (!c) return;
  const prev = lastAt.get(e.kind) ?? -1;
  if (c.currentTime - prev < MIN_GAP) return;
  lastAt.set(e.kind, c.currentTime);
  switch (e.kind) {
    case 'gate': {
      const f = 660 * 2 ** (Math.min(s.combo, 12) / 12); // climbs a semitone per gate in a row
      tone(f, f, 0.18, { type: 'sine', vol: 0.22 });
      tone(f * 1.5, f * 1.5, 0.22, { type: 'sine', vol: 0.12, at: 0.05 });
      break;
    }
    case 'missed':
      tone(240, 150, 0.18, { type: 'triangle', vol: 0.18 });
      break;
    case 'pole':
      noise(0.14, { f: 'lowpass', hz: 900, hz1: 200, vol: 0.4 });
      tone(160, 70, 0.16, { type: 'sine', vol: 0.3 });
      break;
    case 'collect':
      tone(988, 988, 0.07, { vol: 0.08 });
      tone(1319, 1319, 0.16, { vol: 0.08, at: 0.06 });
      break;
    case 'air':
      noise(0.4, { hz: 400, hz1: 2400, q: 1.2, vol: 0.25, attack: 0.08 });
      break;
    case 'break':
      noise(0.32, { f: 'lowpass', hz: 2500, hz1: 180, vol: 0.55 });
      tone(150, 50, 0.22, { vol: 0.12 });
      break;
    case 'slow':
      tone(320, 120, 0.28, { type: 'sawtooth', vol: 0.08 });
      noise(0.25, { f: 'lowpass', hz: 600, vol: 0.2 });
      break;
    case 'fast':
      tone(260, 900, 0.26, { type: 'sawtooth', vol: 0.06 });
      noise(0.3, { hz: 800, hz1: 4000, vol: 0.18, attack: 0.05 });
      break;
    case 'pickup':
      notes([523, 659, 784, 1047], 0.07, 0.12, { vol: 0.09 });
      break;
    case 'expire':
      notes([784, 523], 0.1, 0.16, { type: 'triangle', vol: 0.16 });
      break;
    case 'biome':
      notes([660, 990], 0.12, 0.7, { type: 'sine', vol: 0.16 });
      break;
    case 'crash':
      noise(0.8, { f: 'lowpass', hz: 3000, hz1: 90, vol: 0.8 });
      tone(160, 40, 0.6, { type: 'sine', vol: 0.4 });
      break;
    case 'finish':
      notes([523, 659, 784], 0.1, 0.14, { type: 'triangle', vol: 0.2 });
      tone(1047, 1047, 0.7, { type: 'triangle', vol: 0.2, at: 0.3 });
      tone(1047, 1047, 0.7, { vol: 0.05, at: 0.3 });
      break;
  }
}

function makeLoop(c: AudioContext, out: GainNode): Loop {
  const noiseSrc = c.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const filter = c.createBiquadFilter();
  const ng = c.createGain();
  ng.gain.value = 0;
  noiseSrc.connect(filter).connect(ng).connect(out);
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const eg = c.createGain();
  eg.gain.value = 0;
  osc.connect(lp).connect(eg).connect(out);
  noiseSrc.start();
  osc.start();
  return { filter, ng, osc, lp, eg };
}

/** Per-run memory for edges (start, lane change, landing, steps). */
let seen: { run: RunState | null; phase: string; lane: number; air: boolean; ride: Ride | null; step: number } = { run: null, phase: '', lane: 0, air: false, ride: null, step: 0 };

/** Every frame: ride sound follows vehicle and speed; plays start / lane-change / landing / step sounds. */
export function sfxFrame(s: RunState, dt: number): void {
  const c = live();
  if (!c || !master) return;
  if (seen.run !== s) seen = { run: s, phase: s.phase, lane: s.lane, air: false, ride: null, step: 0 };
  loop ??= makeLoop(c, master);
  const t = c.currentTime;
  const running = s.phase === 'run';
  const air = running && s.row <= s.airUntil;
  const v = vehicleFor(s, s.row);
  const ride = RIDES[v.id] ?? GLIDE;
  const sp = Math.max(0, Math.min(1, (s.speed - 3) / 14));

  if (seen.phase === 'ready' && running) notes([660, 880], 0.09, 0.12, { type: 'triangle', vol: 0.16 });
  if (running && !air && s.lane !== seen.lane) noise(0.12, { hz: ride.hz * 0.8, hz1: ride.hz * 1.3, q: 1, vol: 0.18, attack: 0.02 });
  if (seen.air && !air && running) {
    noise(0.16, { f: 'lowpass', hz: 700, hz1: 150, vol: 0.45 });
    tone(110, 55, 0.14, { type: 'sine', vol: 0.3 });
  }
  if (running && !air && ride.steps) {
    seen.step += dt * ride.steps * (0.6 + sp * 0.8);
    if (seen.step >= 1) {
      seen.step -= 1;
      if (HEAVY_STEPS.has(v.id)) tone(140, 90, 0.07, { type: 'sine', vol: 0.22 });
      else noise(0.035, { hz: 2500, q: 2, vol: 0.12 });
    }
  }

  if (ride !== seen.ride) {
    loop.filter.type = ride.f;
    loop.filter.Q.setTargetAtTime(ride.q, t, 0.05);
  }
  loop.filter.frequency.setTargetAtTime(ride.hz * (0.7 + sp * 0.6) * (air ? 1.6 : 1), t, 0.08);
  const nv = running ? (air ? 0.08 : ride.vol * (0.35 + sp * 0.65)) : 0;
  loop.ng.gain.setTargetAtTime(nv, t, running ? 0.08 : 0.15);
  const ev = running && ride.engine ? (ride.ev ?? 0.06) * (air ? 0.6 : 1) : 0;
  if (ride.engine) loop.osc.frequency.setTargetAtTime(ride.engine * (1 + sp * 1.4), t, 0.1);
  loop.lp.frequency.setTargetAtTime(400 + sp * 900, t, 0.1);
  loop.eg.gain.setTargetAtTime(ev, t, 0.1);

  seen.phase = s.phase;
  seen.lane = s.lane;
  seen.air = air;
  seen.ride = ride;
}

/** Fade the ride sound out (run screen closed). */
export function sfxQuiet(): void {
  if (!ac || !loop) return;
  loop.ng.gain.setTargetAtTime(0, ac.currentTime, 0.05);
  loop.eg.gain.setTargetAtTime(0, ac.currentTime, 0.05);
}
