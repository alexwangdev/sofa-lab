/**
 * "How to play" in about 15 seconds: three cards that advance by themselves every 5 s (tap to go faster), shown on
 * the first visit and from the "How to play" button. 1) changing lanes, with a small animation; 2) what the ground
 * means, with the first biome's real sprites; 3) speed and score.
 */
import { useEffect, useState } from 'react';
import type { BiomeId } from '../shared/types.ts';
import { BiomeLegend } from './Gallery.tsx';

const STEP_MS = 5000;
const SEEN_KEY = 'grid-expedition:intro-seen';

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode */
  }
}

/** Five lanes and a runner that hops one lane left and right, the way a swipe or an arrow key moves it. */
function LaneDemo() {
  return (
    <div className="relative mx-auto grid h-16 w-48 grid-cols-5 gap-0.5 rounded-md bg-slate-700 p-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="rounded-sm bg-slate-200/90" />
      ))}
      <div className="absolute inset-y-0 left-[40%] flex w-[20%] items-center justify-center">
        <div className="intro-hop h-7 w-5 rounded-md bg-orange-500 shadow ring-2 ring-white" />
      </div>
    </div>
  );
}

const CARDS = (biome: BiomeId) => [
  {
    title: 'Switch lanes',
    body: (
      <>
        <LaneDemo />
        <p>
          Swipe or tap left / right, or press <kbd>←</kbd> <kbd>→</kbd>. You move one lane per row.
        </p>
      </>
    ),
  },
  {
    title: 'Read the ground',
    body: (
      <>
        <BiomeLegend biome={biome} />
        <p>
          <b className="text-red-300">Red brackets end the run.</b> Ripples slow you, cyan arrows boost you, gold rings swap your vehicle for a while.
        </p>
      </>
    ),
  },
  {
    title: 'Go fast, finish',
    body: (
      <>
        <p className="text-3xl" aria-hidden>
          ⬆️ 🏁 ⏱️
        </p>
        <p>
          Hold <b>Tuck</b> (<kbd>↑</kbd> / swipe up) to speed up, <b>Brake</b> (<kbd>↓</kbd>) to slow down. Finish faster than par for a bigger score. Everyone gets the
          same track today.
        </p>
      </>
    ),
  },
];

export function Intro({ biome, canStart, onStart, onClose }: { biome: BiomeId; canStart: boolean; onStart: () => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const cards = CARDS(biome);
  const last = step === cards.length - 1;
  useEffect(() => {
    if (last) return;
    const t = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [step, last]);
  const card = cards[step] ?? cards[0];
  const done = (start: boolean) => {
    markSeen();
    if (start) onStart();
    else onClose();
  };
  return (
    <div className="flex w-72 max-w-full flex-col items-center gap-2 text-center text-sm text-slate-200 [&_kbd]:rounded [&_kbd]:bg-slate-700 [&_kbd]:px-1">
      <div className="flex w-full gap-1" aria-hidden>
        {cards.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded bg-slate-700">
            <div className={i < step ? 'h-full w-full bg-orange-500' : i === step ? 'intro-fill h-full bg-orange-500' : ''} key={i === step ? `on${step}` : 'off'} />
          </div>
        ))}
      </div>
      <p className="text-lg font-extrabold">
        {step + 1}/{cards.length} · {card?.title}
      </p>
      <div className="flex min-h-40 flex-col items-center justify-center gap-2" onClick={() => !last && setStep(step + 1)}>
        {card?.body}
      </div>
      <div className="flex gap-2">
        {last ? (
          <button className="btn btn-primary px-6 text-base" disabled={!canStart} onClick={() => done(true)}>
            {canStart ? 'Start' : 'Loading…'}
          </button>
        ) : (
          <button className="btn btn-primary px-5" onClick={() => setStep(step + 1)}>
            Next
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => done(false)}>
          {last ? 'Close' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
