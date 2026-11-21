/** Next-day reveal: yesterday's par shape, the top player's sofa, and yours. */
import { useState } from 'react';
import type { RevealResponse } from '../shared/types';
import { getReveal } from './api';
import { SofaCanvas } from './SofaCanvas';

export function Yesterday() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RevealResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data) {
      getReveal()
        .then((d) => {
          setData(d);
          setTab(0);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'could not load'));
    }
  };

  const shape = data?.shapes[tab];
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-2 flex flex-col gap-2">
      <button className="btn btn-secondary w-full text-left px-3" onClick={toggle} aria-expanded={open}>
        {open ? '▾' : '▸'} Yesterday's best sofas
      </button>
      {open && error && <p className="text-sm text-red-700">{error}</p>}
      {open && !data && !error && <p className="text-sm text-zinc-600">Loading…</p>}
      {open && data && (
        <>
          <p className="text-sm">
            <b>
              {data.weekday} {data.difficulty === 'Gerver' ? 'Gerver day' : data.difficulty}
            </b>{' '}
            · {data.date} · w={data.course.w}
            {data.twists.length > 0 && <span className="text-zinc-600"> · {data.twists.join(' · ')}</span>}
          </p>
          {data.shapes.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing to show for that day.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="tablist">
                {data.shapes.map((s, i) => (
                  <button
                    key={s.label}
                    role="tab"
                    aria-selected={i === tab}
                    className={`btn px-3 ${i === tab ? 'btn-dark' : 'btn-secondary'}`}
                    onClick={() => setTab(i)}
                  >
                    {s.label} · {s.area.toFixed(2)}
                  </button>
                ))}
              </div>
              {shape && <SofaCanvas cells={new Set(shape.cells)} course={data.course} editable={false} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
