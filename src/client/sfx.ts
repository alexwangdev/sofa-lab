/**
 * Sound, synthesised at run time with the Web Audio API: no audio files, nothing to license, nothing to download.
 *
 * - One-shot effects (gate, collect, crash, …) are short oscillator / filtered-noise envelopes built per call.
 * - No continuous ride sound (no sliding hiss, no engine drone): it sat under everything for the whole run. Moving is
 *   heard only as short sounds: a swish on lane changes, a thump on landing, and hoof / paw / wheel steps for the
 *   vehicles that have them (`sfxFrame`).
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created on the first key / pointer press.
 * The sound mode (all / effects only / off) is remembered in localStorage. Background music lives in music.ts and
 * plays through the same context.
 */
import { vehicleFor } from '../shared/sim.ts';
import type { GameEvent, RunState } from '../shared/sim.ts';
import type { VehicleId } from '../shared/types.ts';

const MUTE_KEY = 'grid-expedition:sound';
/** Overall level (the compressor after it catches peaks). */
const MASTER = 0.9;

/** Steps per second at cruise for vehicles that have feet or rails (hooves, paws, wheels on joints). */
const STEPS: Partial<Record<VehicleId, number>> = { bicycle: 3, subway: 2, oxcart: 2.2, elephant: 1.4, dogsled: 5, dogteam: 5 };
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

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

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
  // pointerdown counts as a user gesture only for a mouse; on touch screens the gesture is pointerup / touchend / click
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(type, unlock, true);
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
type ToneOpts = When & { type?: OscillatorType; vol?: number; attack?: number };
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

/** Per-run memory for edges (start, lane change, landing, steps). */
let seen: { run: RunState | null; phase: string; lane: number; air: boolean; step: number } = { run: null, phase: '', lane: 0, air: false, step: 0 };

/** Every frame: start beep, lane-change swish, landing thump, and steps for vehicles with feet. */
export function sfxFrame(s: RunState, dt: number): void {
  if (!live()) return;
  if (seen.run !== s) seen = { run: s, phase: s.phase, lane: s.lane, air: false, step: 0 };
  const running = s.phase === 'run';
  const air = running && s.row <= s.airUntil;
  const v = vehicleFor(s, s.row);
  const sp = Math.max(0, Math.min(1, (s.speed - 3) / 14));

  if (seen.phase === 'ready' && running) notes([660, 880], 0.09, 0.12, { type: 'triangle', vol: 0.16 });
  if (running && !air && s.lane !== seen.lane) noise(0.12, { hz: 1900, hz1: 3200, q: 1, vol: 0.18, attack: 0.02 });
  if (seen.air && !air && running) {
    noise(0.16, { f: 'lowpass', hz: 700, hz1: 150, vol: 0.45 });
    tone(110, 55, 0.14, { type: 'sine', vol: 0.3 });
  }
  const steps = STEPS[v.id];
  if (running && !air && steps) {
    seen.step += dt * steps * (0.6 + sp * 0.8);
    if (seen.step >= 1) {
      seen.step -= 1;
      if (HEAVY_STEPS.has(v.id)) tone(140, 90, 0.07, { type: 'sine', vol: 0.22 });
      else noise(0.035, { hz: 2500, q: 2, vol: 0.12 });
    }
  }

  seen.phase = s.phase;
  seen.lane = s.lane;
  seen.air = air;
}
