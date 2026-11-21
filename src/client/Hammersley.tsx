import { useMemo, useState } from 'react';
import { CELL, HAMMERSLEY_R, plainCourse, hammersleyArea, hammersleyCells, runTest } from '../shared/sofa';
import { SofaCanvas } from './SofaCanvas';
import type { AnimRequest } from './SofaCanvas';

const TUT_COLS = 40;
const TUT_COURSE = plainCourse(1);

/** Exact Hammersley outline (local coords) for bite radius r centred at bu. */
function outline(r: number, bu: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const arc = (cx: number, rad: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + rad * Math.cos(a), rad * Math.sin(a)]);
    }
  };
  arc(bu - r, 1, Math.PI, Math.PI / 2, 24);
  arc(bu + r, 1, Math.PI / 2, 0, 24);
  if (r > 0) arc(bu, r, 0, Math.PI, 32);
  return pts;
}

/** Spec §4: the one-screen onboarding. */
export function Hammersley({ onDone }: { onDone: () => void }) {
  const [r, setR] = useState(0.3);
  const [anim, setAnim] = useState<AnimRequest | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const cells = useMemo(() => new Set(hammersleyCells(r, TUT_COLS)), [r]);
  const ghost = useMemo(() => outline(r, Math.round(TUT_COLS / 2) * CELL), [r]);

  const test = () => {
    const res = runTest([...cells], 1, TUT_COLS);
    if (!res.ok) {
      setVerdict(res.error);
      return;
    }
    setVerdict(null);
    setAnim({ id: Date.now(), result: res.result, cells: res.cells });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">Hammersley's sofa (1968)</h2>
        <p className="text-sm text-zinc-600">Two quarter-discs + a block with a bite. Slide the bite.</p>
      </div>
      <SofaCanvas
        cells={cells}
        course={TUT_COURSE}
        cols={TUT_COLS}
        editable={false}
        anim={anim}
        ghost={ghost}
        onAnimDone={(res) => setVerdict(res.pass ? `Passed · grid area ${res.area.toFixed(3)}` : `Jammed at ${res.jamAngle}°`)}
      />
      <label className="flex flex-col gap-1">
        <span className="flex justify-between text-sm font-medium">
          <span>bite radius r = {r.toFixed(2)}</span>
          <span>
            area = <b>{hammersleyArea(r).toFixed(3)}</b>
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={r}
          onChange={(e) => {
            setR(Number(e.target.value));
            setVerdict(null);
          }}
          className="w-full h-11 accent-blue-600"
          aria-label="bite radius"
        />
      </label>
      <p className="text-sm text-zinc-700">
        Bigger bite = longer block, but the bite eats area. Best r = 2/π ≈ {HAMMERSLEY_R.toFixed(3)}, area 2.2074.
      </p>
      {verdict && <p className="text-sm font-semibold text-zinc-900" role="status">{verdict}</p>}
      <div className="flex gap-2">
        <button className="btn btn-secondary flex-1" onClick={test}>
          Test this sofa
        </button>
        <button className="btn btn-primary flex-1" onClick={onDone}>
          Start building
        </button>
      </div>
    </div>
  );
}
