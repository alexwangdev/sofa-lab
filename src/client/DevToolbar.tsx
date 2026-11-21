/** Local-mode toolbar: switch user / date / width, seed bots, reset, watch fake Reddit actions. Dev builds only. */
import { useCallback, useEffect, useState } from 'react';
import { WIDTHS, pickWidth, utcDate } from '../shared/daily';
import { call } from './api';
import { LOCAL_USERS, readLocal, writeLocal } from './localMode';
import type { LocalSettings } from './localMode';

type LocalEvent = { at: string; kind: string; detail: string };

export function DevToolbar() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<LocalSettings>(readLocal);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const date = s.date || utcDate();
  const autoW = pickWidth(date);

  const refresh = useCallback(() => {
    call<{ events: LocalEvent[] }>('/api/__local/state')
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  const apply = (next: LocalSettings) => {
    writeLocal(next);
    setS(next);
    location.reload();
  };

  const action = async (label: string, path: string, reload: boolean) => {
    setBusy(label);
    try {
      await call(path, { method: 'POST', body: '{}' });
    } finally {
      setBusy(null);
      if (reload) location.reload();
      else refresh();
    }
  };

  const shiftDay = (d: number) => {
    const t = new Date(`${date}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + d);
    apply({ ...s, date: t.toISOString().slice(0, 10) });
  };

  if (!open) {
    return (
      <button
        className="fixed bottom-2 right-2 z-20 rounded-full bg-amber-400 px-3 min-h-11 text-xs font-bold text-zinc-900 shadow-lg"
        onClick={() => setOpen(true)}
        aria-label="Open local mode toolbar"
      >
        LOCAL · u/{s.user} · {date.slice(5)}
      </button>
    );
  }

  const field = 'min-h-11 rounded border border-zinc-300 bg-white px-2 text-sm';
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 max-h-[70vh] overflow-y-auto border-t-4 border-amber-400 bg-amber-50 p-2 text-sm shadow-2xl">
      <div className="mx-auto flex max-w-[480px] flex-col gap-2">
        <div className="flex items-center justify-between">
          <b>Local mode</b>
          <button className="btn btn-secondary px-3" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-600">Player</span>
            <select className={field} value={s.user} onChange={(e) => apply({ ...s, user: e.target.value })}>
              {LOCAL_USERS.map((u) => (
                <option key={u} value={u}>
                  u/{u}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-600">Hallway w</span>
            <select className={field} value={s.w} onChange={(e) => apply({ ...s, w: e.target.value })}>
              <option value="">auto ({autoW})</option>
              {[...new Set(WIDTHS)].map((w) => (
                <option key={w} value={String(w)}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs text-zinc-600">Day (UTC){s.date ? '' : ' — today'}</span>
            <input
              type="date"
              className={field}
              value={date}
              onChange={(e) => apply({ ...s, date: e.target.value === utcDate() ? '' : e.target.value })}
            />
          </label>
          <button className="btn btn-secondary px-3" onClick={() => shiftDay(-1)} aria-label="Previous day">
            ◀
          </button>
          <button className="btn btn-secondary px-3" onClick={() => shiftDay(1)} aria-label="Next day">
            ▶
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void action('seed', '/api/__local/seed', true)}>
            Seed 5 bot players
          </button>
          <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void action('reset', '/api/__local/reset-day', true)}>
            Reset this day
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => void action('sched', '/api/__local/run-scheduler', false)}
          >
            Run daily-post job
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => {
              writeLocal({ user: 'you', date: '', w: '' });
              try {
                localStorage.removeItem('sofa-lab:tutorial-seen');
              } catch {
                /* ignore */
              }
              void action('all', '/api/__local/reset-all', true);
            }}
          >
            Wipe everything
          </button>
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-600">Reddit actions (faked)</div>
          {events.length === 0 ? (
            <p className="text-xs text-zinc-500">None yet — submit, share or subscribe to see them here.</p>
          ) : (
            <ul className="text-xs font-mono">
              {events.slice(0, 8).map((e, i) => (
                <li key={`${e.at}-${i}`} className="truncate">
                  {e.at} <b>{e.kind}</b> {e.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
