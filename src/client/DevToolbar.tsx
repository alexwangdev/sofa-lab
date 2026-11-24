/** Test toolbar (standalone build): switch player / UTC date, reset the day or everything, fire the daily-post job. */
import { useState } from 'react';
import { LOCAL_USERS, readLocal, resetAll, resetDay, runScheduler, writeLocal } from './backend.ts';

export function DevToolbar({ onChange, onModels, auto, onAuto }: { onChange: () => void; onModels: () => void; auto: boolean; onAuto: (on: boolean) => void }) {
  const [s, setS] = useState(readLocal);
  const [msg, setMsg] = useState('');
  const update = (next: typeof s) => {
    setS(next);
    writeLocal(next);
    onChange();
  };
  const btn = 'underline min-h-8 px-1';
  return (
    <div className="w-full max-w-[480px] mt-2 rounded-lg border border-dashed border-slate-600 p-2 text-xs text-slate-300 flex flex-wrap gap-2 items-center">
      <span className="font-bold text-slate-400">TEST</span>
      <label className="flex items-center gap-1 min-h-8 px-1 rounded bg-slate-800 cursor-pointer">
        <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
        auto
      </label>
      <select className="bg-slate-800 rounded px-1 h-8" value={s.user} onChange={(e) => update({ ...s, user: e.target.value })} aria-label="Player">
        {LOCAL_USERS.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
      <input className="bg-slate-800 rounded px-1 h-8 w-32" type="date" value={s.date} onChange={(e) => update({ ...s, date: e.target.value })} aria-label="Date (UTC)" />
      <button
        className={btn}
        onClick={() => {
          setMsg(`reset ${resetDay()} keys`);
          onChange();
        }}
      >
        reset day
      </button>
      <button
        className={btn}
        onClick={() => {
          resetAll();
          setMsg('all data cleared');
          onChange();
        }}
      >
        reset all
      </button>
      <button className={btn} onClick={() => void runScheduler().then(setMsg)}>
        daily post
      </button>
      <button className={btn} onClick={onModels}>
        models
      </button>
      {msg && <span className="basis-full truncate text-slate-500">{msg}</span>}
    </div>
  );
}
