/**
 * Background music, composed and synthesised at run time (Web Audio, no files): a 4-bar loop per biome.
 *
 * - Each biome has a style: mode/scale, key, tempo, chord progression, instruments, drum level.
 * - The lead melody is generated from the day's seed, so each biome has its own tune that day (same for everyone).
 * - Layers: pad (held chord), bass, lead, arpeggio, chip drums. Speed raises the tempo (−15 % … +25 %) and adds
 *   layers: arpeggios past half speed, an extra drum level near top speed.
 * - Notes are scheduled ~0.3 s ahead on the AudioContext clock, topped up by a 50 ms timer as well as by the render loop
 *   (`musicFrame`), so timing does not depend on frame rate. The music bus sits under the sound effects and follows the Sound / No music / Muted mode.
 */
import { SEG_ROWS, biomeAt, segmentOf } from '../shared/grid.ts';
import { hash3, mulberry32 } from '../shared/rng.ts';
import type { RunState } from '../shared/sim.ts';
import type { BiomeId } from '../shared/types.ts';
import { audioOut, noise, soundMode, tone } from './sfx.ts';

type Lead = OscillatorType | 'bell' | 'marimba';
type Style = {
  bpm: number;
  /** MIDI note of the tonic (lead octave). */
  root: number;
  /** Semitones of the mode. */
  scale: readonly number[];
  /** Scale degree of each of the 4 bars' chords. */
  prog: readonly [number, number, number, number];
  lead: Lead;
  bass: OscillatorType;
  pad: OscillatorType | null;
  /** 0 ambient (no drums until top speed), 1 light, 2 full. */
  drums: 0 | 1 | 2;
  /** Chance of a note on each off-beat eighth (melody density). */
  density: number;
  /** Arpeggio from the start (otherwise only once the run is past half speed). */
  arp: boolean;
};

const MAJOR_PENTA = [0, 2, 4, 7, 9];
const STYLES: Record<BiomeId, Style> = {
  // clear and bright: major pentatonic bells
  snow: { bpm: 112, root: 74, scale: MAJOR_PENTA, prog: [0, 3, 1, 0], lead: 'bell', bass: 'triangle', pad: 'triangle', drums: 1, density: 0.55, arp: true },
  // phrygian dominant, plucky square lead over hand-drum kicks
  desert: { bpm: 100, root: 64, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 3], lead: 'square', bass: 'triangle', pad: null, drums: 1, density: 0.5, arp: false },
  // low and heavy: phrygian, saw bass, sparse lead, full drums
  volcano: { bpm: 92, root: 57, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 0, 5, 1], lead: 'sawtooth', bass: 'sawtooth', pad: 'sawtooth', drums: 2, density: 0.35, arp: false },
  // rolling mixolydian arpeggios over soft sine pads
  ocean: { bpm: 96, root: 67, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 3, 6, 3], lead: 'triangle', bass: 'sine', pad: 'sine', drums: 1, density: 0.4, arp: true },
  // busy dorian marimba with full percussion
  jungle: { bpm: 120, root: 69, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 0, 4], lead: 'marimba', bass: 'square', pad: null, drums: 2, density: 0.65, arp: false },
  // slow lydian sparkle, no drums
  icefield: { bpm: 84, root: 76, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 0, 4], lead: 'bell', bass: 'sine', pad: 'sine', drums: 0, density: 0.3, arp: true },
  // natural-minor chiptune, driving beat
  city: { bpm: 124, root: 62, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], lead: 'square', bass: 'square', pad: null, drums: 2, density: 0.6, arp: false },
  // floating whole-tone bells over long pads, no drums
  space: { bpm: 72, root: 60, scale: [0, 2, 4, 6, 8, 10], prog: [0, 1, 0, 2], lead: 'bell', bass: 'sine', pad: 'sine', drums: 0, density: 0.25, arp: false },
};

/** Music bus level: measured to sit about level with the ride sound and effects (it was ~9 dB under them at 0.3). */
const MUSIC = 0.9;
/** Notes are queued this far ahead; a 50 ms timer tops the queue up, so slow or throttled frames do not cause gaps. */
const AHEAD = 0.3;
const PUMP_MS = 50;
const BARS = 4;
const STEPS = 16;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
function midiOf(st: Style, deg: number): number {
  const n = st.scale.length;
  const oct = Math.floor(deg / n);
  return st.root + 12 * oct + (st.scale[deg - oct * n] ?? 0);
}
const chord = (st: Style, bar: number) => {
  const r = st.prog[bar % BARS] ?? 0;
  return [r, r + 2, r + 4];
};

type Note = { deg: number; len: number };
/** Seeded 4-bar melody: chord tones on strong beats, small steps in between, held until the next note. */
function compose(st: Style, seed: number): (Note | undefined)[] {
  const r = mulberry32(seed);
  const n = st.scale.length;
  const at: (Note | undefined)[] = new Array(BARS * STEPS);
  let d = 0;
  for (let bar = 0; bar < BARS; bar++) {
    const ch = chord(st, bar);
    for (let s = 0; s < STEPS; s += 2) {
      const strong = s % 8 === 0;
      if (strong ? r() < 0.15 : r() > st.density) continue;
      if (strong) d = ch[Math.floor(r() * 3)] ?? 0;
      else d += [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)] ?? 1;
      d = Math.max(-2, Math.min(n + 4, d));
      at[bar * STEPS + s] = { deg: d, len: 2 };
    }
  }
  // hold each note until the next one (at most 6 sixteenths)
  let last = -1;
  for (let i = 0; i <= at.length; i++) {
    if (i < at.length && !at[i]) continue;
    const prev = last >= 0 ? at[last] : undefined;
    if (prev) prev.len = Math.min(6, i - last);
    last = i;
  }
  return at;
}

let bus: GainNode | null = null;
let busOn = false;
const play = { run: null as RunState | null, playing: false, next: 0, step: 0, seg: -1, sp: 0, tune: [] as (Note | undefined)[] };

function lead(st: Style, f: number, t: number, dur: number, vol: number, out: AudioNode): void {
  if (st.lead === 'bell') {
    tone(f, f, dur + 0.4, { type: 'sine', vol: 0.08 * vol, when: t, out });
    tone(f * 2, f * 2, dur * 0.5 + 0.1, { type: 'sine', vol: 0.02 * vol, when: t, out });
  } else if (st.lead === 'marimba') {
    tone(f, f, 0.28, { type: 'sine', vol: 0.11 * vol, when: t, out });
    tone(f * 4, f * 4, 0.05, { type: 'sine', vol: 0.02 * vol, when: t, out });
  } else {
    tone(f, f, dur * 0.9, { type: st.lead, vol: (st.lead === 'triangle' ? 0.08 : 0.035) * vol, when: t, out });
  }
}

/** One sixteenth at time t. calm = the run has not started yet (pad and a soft lead only). */
function scheduleStep(st: Style, i: number, t: number, dur: number, sp: number, calm: boolean, out: AudioNode): void {
  const bar = Math.floor(i / STEPS) % BARS;
  const s = i % STEPS;
  const ch = chord(st, bar);
  const n = st.scale.length;
  if (s === 0 && st.pad)
    for (const d of ch) tone(hz(midiOf(st, d - n)), hz(midiOf(st, d - n)), dur * STEPS * 1.05, { type: st.pad, vol: st.pad === 'sawtooth' ? 0.012 : 0.03, attack: 0.5, when: t, out });
  const note = play.tune[(bar * STEPS + s) % (BARS * STEPS)];
  if (note) lead(st, hz(midiOf(st, note.deg)), t, note.len * dur, calm ? 0.5 : 1, out);
  if (calm) return;

  const root = ch[0] ?? 0;
  const bassVol = st.bass === 'sine' || st.bass === 'triangle' ? 0.14 : 0.06;
  if (s === 0 || s === 8) {
    const d = (s === 0 ? root : root + 4) - 2 * n;
    tone(hz(midiOf(st, d)), hz(midiOf(st, d)), dur * 6, { type: st.bass, vol: bassVol, when: t, out });
  } else if (st.drums === 2 && sp > 0.5 && (s === 4 || s === 12)) tone(hz(midiOf(st, root - 2 * n)), hz(midiOf(st, root - 2 * n)), dur * 2, { type: st.bass, vol: bassVol * 0.7, when: t, out });

  if (st.arp || sp > 0.5) {
    const every = sp > 0.75 ? 1 : 2;
    if (s % every === 0) {
      const d = (ch[(s / every) % 3] ?? 0) + n;
      tone(hz(midiOf(st, d)), hz(midiOf(st, d)), dur * 0.9, { type: 'triangle', vol: 0.022, when: t, out });
    }
  }

  const lvl = Math.min(2, st.drums + (sp > 0.7 ? 1 : 0));
  if (lvl >= 1) {
    if (s === 0 || s === 8) tone(150, 45, 0.16, { type: 'sine', vol: 0.3, when: t, out });
    if (s % 4 === 2) noise(0.03, { f: 'highpass', hz: 7000, vol: 0.05, when: t, out });
  }
  if (lvl >= 2) {
    if (s === 4 || s === 12) {
      noise(0.12, { hz: 1800, q: 0.8, vol: 0.12, when: t, out });
      tone(220, 180, 0.06, { type: 'triangle', vol: 0.05, when: t, out });
    }
    if (s % 2 === 1 && sp > 0.8) noise(0.02, { f: 'highpass', hz: 8000, vol: 0.025, when: t, out });
  }
}

/** Every frame from the render loop: keeps ~0.2 s of music scheduled for the current biome and speed. */
export function musicFrame(s: RunState, dt: number): void {
  const a = audioOut();
  if (!a) return;
  const { c } = a;
  if (!bus) {
    bus = c.createGain();
    bus.gain.value = 0;
    bus.connect(a.master);
  }
  const want = soundMode() === 'all' && (s.phase === 'ready' || s.phase === 'run');
  if (want !== busOn) {
    busOn = want;
    bus.gain.setTargetAtTime(want ? MUSIC : 0, c.currentTime, want ? 0.3 : 0.15);
  }
  if (!want) {
    play.playing = false;
    return;
  }
  const seg = segmentOf(s.row);
  if (play.run !== s || !play.playing || seg !== play.seg) {
    // new run, restart, or a new biome: start its tune from the top of the loop
    const biome = biomeAt(s.course, s.row);
    play.tune = compose(STYLES[biome], hash3(s.course.seed, seg, 0x6d75));
    play.run = s;
    play.seg = seg;
    play.step = 0;
    if (!play.playing) play.next = c.currentTime + 0.05;
    play.playing = true;
  }
  const target = s.phase === 'run' ? Math.max(0, Math.min(1, (s.speed - 3) / 14)) : 0;
  play.sp += (target - play.sp) * Math.min(1, dt * 1.5);
  pump();
  pumpTimer ??= window.setInterval(pump, PUMP_MS);
}

let pumpTimer: number | null = null;
/** Queue notes up to AHEAD seconds past now for the run musicFrame last saw. */
function pump(): void {
  const a = audioOut();
  const s = play.run;
  if (!a || !bus || !s || !play.playing) return;
  const { c } = a;
  const st = STYLES[biomeAt(s.course, play.seg * SEG_ROWS)];
  // a long stall (or a hidden tab) must not dump a burst of late notes
  if (play.next < c.currentTime - 0.05) play.next = c.currentTime + 0.02;
  const calm = s.phase !== 'run';
  while (play.next < c.currentTime + AHEAD) {
    const dur = 60 / (st.bpm * (0.85 + 0.4 * play.sp)) / 4;
    scheduleStep(st, play.step, play.next, dur, play.sp, calm, bus);
    play.next += dur;
    play.step++;
  }
}

/** Fade the music out (run screen closed). */
export function musicQuiet(): void {
  const a = audioOut();
  if (bus && a && busOn) bus.gain.setTargetAtTime(0, a.c.currentTime, 0.15);
  busOn = false;
  play.playing = false;
}
