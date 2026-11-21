/** Carve tools: start from a template, brush size, mirror. Makes a sofa a 2-minute job instead of 200 taps. */
import { useMemo, useState } from 'react';
import type { CellId, Course } from '../shared/types';
import { areaOf, biggestPiece, templateCells } from '../shared/sofa';

type Props = {
  course: Course;
  prevCells: CellId[] | null;
  brush: 1 | 2 | 3;
  mirror: boolean;
  disabled: boolean;
  onBrush: (b: 1 | 2 | 3) => void;
  onMirror: (m: boolean) => void;
  onTemplate: (cells: CellId[]) => void;
};

export function CarveTools({ course, prevCells, brush, mirror, disabled, onBrush, onMirror, onTemplate }: Props) {
  const [open, setOpen] = useState(false);
  const [r, setR] = useState(0.6);
  const preview = useMemo(() => templateCells(r, course), [r, course]);
  const last = useMemo(() => {
    if (!prevCells) return null;
    const torn = new Set(course.torn);
    return biggestPiece(prevCells.filter((c) => !torn.has(c)));
  }, [prevCells, course]);

  const nextBrush = (): 1 | 2 | 3 => (brush === 1 ? 2 : brush === 2 ? 3 : 1);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <button className={`btn ${open ? 'btn-dark' : 'btn-secondary'}`} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Start from…
        </button>
        <button className="btn btn-secondary" disabled={disabled} onClick={() => onBrush(nextBrush())} aria-label={`Brush size ${brush}`}>
          Brush {brush}×{brush}
        </button>
        <button className={`btn ${mirror ? 'btn-dark' : 'btn-secondary'}`} disabled={disabled} onClick={() => onMirror(!mirror)} aria-pressed={mirror}>
          Mirror
        </button>
      </div>
      {open && !disabled && (
        <div className="rounded-lg border border-zinc-200 bg-white p-2 flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="flex justify-between">
              <span>Hammersley, bite r = {r.toFixed(2)}</span>
              <span className="text-zinc-600">{areaOf(preview.length).toFixed(2)} on today's grid</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={r}
              onChange={(e) => setR(Number(e.target.value))}
              className="w-full h-11 accent-blue-600"
              aria-label="template bite radius"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="btn btn-primary"
              onClick={() => {
                onTemplate(preview);
                setOpen(false);
              }}
            >
              Use Hammersley
            </button>
            <button
              className="btn btn-secondary"
              disabled={!last || last.length === 0}
              onClick={() => {
                if (last) onTemplate(last);
                setOpen(false);
              }}
            >
              {last ? `My last sofa (${areaOf(last.length).toFixed(2)})` : 'No recent sofa'}
            </button>
          </div>
          <p className="text-xs text-zinc-600">Templates skip torn fabric. Then carve: test, trim the red, grow into the green.</p>
        </div>
      )}
    </div>
  );
}
