/** Shell (spec §14): title + route line, HUD, canvas, minimap, controls, preview, result card, leaderboard. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import { BIOMES } from '../shared/biomes.ts';
import { generateCourse } from '../shared/course.ts';
import { ROWS, biomeAt, nextBoundary, segmentOf } from '../shared/grid.ts';
import { METERS_PER_ROW, canControlSpeed, score } from '../shared/sim.ts';
import type { RunState } from '../shared/sim.ts';
import { vehicle } from '../shared/vehicles.ts';
import type { Course, EndlessRunResponse, LeaderboardResponse, Phase, RunResponse, ScoreParts, TodayResponse } from '../shared/types.ts';
import { ApiError, getEndlessLeaderboard, getLeaderboard, getToday, postEndless, postRun, postShare } from './api.ts';
import { ExpeditionCanvas } from './ExpeditionCanvas.tsx';
import type { CanvasHandle } from './ExpeditionCanvas.tsx';
import { MiniMap, TrackPreview } from './TrackPreview.tsx';
import { prewarmCourse } from './render.ts';
import { drawShareCard } from './shareCard.ts';
import { Intro, introSeen } from './Intro.tsx';
import { newEndless } from '../shared/endless.ts';
import { atlasLoading, readyToStart } from './atlas.ts';
import { DevToolbar } from './platform.ts';
import { Gallery } from './Gallery.tsx';
import { setSoundMode, soundMode } from './sfx.ts';
import type { SoundMode } from './sfx.ts';

const SOUND_NEXT: Record<SoundMode, SoundMode> = { all: 'sfx', sfx: 'off', off: 'all' };
const SOUND_LABEL: Record<SoundMode, string> = { all: 'Sound', sfx: 'No music', off: 'Muted' };

/** Cycles music + effects → effects only → muted. */
function SoundToggle() {
  const [mode, setMode] = useState(soundMode);
  return (
    <button
      className="btn btn-secondary"
      title={`${SOUND_LABEL[mode]} (click: ${SOUND_LABEL[SOUND_NEXT[mode]]})`}
      onClick={() => {
        setSoundMode(SOUND_NEXT[mode]);
        setMode(SOUND_NEXT[mode]);
      }}
    >
      {SOUND_LABEL[mode]}
    </button>
  );
}

type Hud = {
  score: number;
  row: number;
  phase: Phase;
  time: number;
  par: number;
  nextBiome: number | null;
  timed: string | null;
  timedLeft: number;
  canSpeed: boolean;
  taken: Set<number>;
  /** A biome's models still downloading: this one, or the next one when it is close. */
  loading: { name: string; pct: number } | null;
  canStart: boolean;
};

/** Start warning about the next biome's download this many rows before it. */
const LOADING_AHEAD = 60;
function loadingOf(s: RunState, next: number | undefined): Hud['loading'] {
  const seg = segmentOf(s.row);
  const segs = next !== undefined && next - s.row < LOADING_AHEAD ? [seg, seg + 1] : [seg];
  for (const i of segs) {
    const b = s.course.biomes[i];
    if (!b) continue;
    const f = atlasLoading(b);
    if (f !== null) return { name: BIOMES[b].name, pct: Math.round(f * 100) };
  }
  return null;
}
type Result = {
  phase: 'crash' | 'finish';
  parts: ScoreParts;
  distance: number;
  gates: number;
  time: number;
  server: RunResponse | null;
  error: string | null;
  /** Lane per row (the path drawn on the share image). */
  lanes: number[];
  /** Endless runs: the server's verdict (null while saving) and today's endless board. */
  endless?: { server: EndlessRunResponse | null; board: LeaderboardResponse | null };
};

const route = (t: TodayResponse) => t.biomes.map((b) => BIOMES[b].name).join(' → ');

function hudOf(s: RunState): Hud {
  const next = nextBoundary(s.course, s.row) ?? undefined;
  return {
    score: score(s).total,
    row: s.row,
    phase: s.phase,
    nextBiome: next === undefined ? null : next - s.row,
    timed: s.timed !== null && s.row < s.timedUntil ? s.timed : null,
    timedLeft: Math.max(0, s.timedUntil - s.row),
    time: s.time,
    par: s.parSeconds,
    canSpeed: canControlSpeed(s),
    taken: s.taken,
    loading: loadingOf(s, next),
    // only before the start: during a run the passed biome's atlas is dropped on purpose and must not be fetched again
    canStart: s.phase === 'ready' && readyToStart(biomeAt(s.course, 0)),
  };
}

export function App() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<'preview' | 'run' | 'gallery'>('preview');
  const [mode, setMode] = useState<'daily' | 'endless'>('daily');
  // the 15-second how-to-play: on the first visit, and from the How to play link
  const [intro, setIntro] = useState(() => !introSeen());
  const [run, setRun] = useState({ key: 0, auto: false });
  const [hud, setHud] = useState<Hud | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [shared, setShared] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const canvas = useRef<CanvasHandle>(null);

  const load = useCallback(() => {
    setToday(null);
    setLoadError(null);
    getToday()
      .then((t) => {
        setToday(t);
        setMode('daily'); // a (re)load always starts from the day's track, never mid-endless
        setScreen(t.playedToday ? 'run' : 'preview');
        setResult(null);
        setRun((r) => ({ key: r.key + 1, auto: false }));
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  // keyed on date + route only: updating myBest/streak after a run must not rebuild the track (it would reset the run)
  const routeKey = today ? `${today.date}|${today.biomes.join()}` : null;
  const course = useMemo(() => {
    if (!routeKey) return null;
    const [date = "", ids = ""] = routeKey.split("|");
    // endless: the day's endless track (same for everyone that date), grown as the run goes
    if (mode === 'endless') return newEndless(date);
    return generateCourse(date, ids.split(",") as TodayResponse["biomes"]);
  }, [routeKey, mode]);
  const endless = mode === 'endless';
  const playMode = (m: 'daily' | 'endless') => {
    setMode(m);
    setResult(null);
    setRun((r) => ({ key: r.key + 1, auto: false }));
    setScreen(m === 'endless' ? 'run' : 'preview');
  };

  // start baking the first two biomes in idle time as soon as the day is known (while the preview is open)
  useEffect(() => {
    if (course) prewarmCourse(course);
  }, [course]);

  const onTick = useCallback((s: RunState) => setHud(hudOf(s)), []);
  const onEnd = useCallback(
    (s: RunState) => {
      if (!today || !course) return;
      const parts = score(s);
      const base: Result = { phase: s.phase === 'finish' ? 'finish' : 'crash', parts, distance: s.row, gates: s.gates, time: s.time, server: null, error: null, lanes: s.lanes.slice() };
      if (import.meta.env.DEV && autoRef.current) {
        // test runs by the autopilot never reach the leaderboard (the server would refuse them anyway)
        setResult({ ...base, error: 'Auto run (test): not submitted.' });
        return;
      }
      if (course.endless) {
        // the server replays the run on the day's endless track and ranks the distance it reached
        const start: Result = { ...base, endless: { server: null, board: null } };
        setResult(start);
        const board = () => getEndlessLeaderboard(today.date).catch(() => null);
        postEndless({ rows: s.row, inputs: s.log })
          .then(async (server) => {
            setResult({ ...start, endless: { server, board: await board() } });
            setToday((t) => (t ? { ...t, myEndlessBest: server.best } : t));
          })
          .catch(async (e: unknown) =>
            setResult({ ...start, error: e instanceof ApiError && e.status === 401 ? 'Log in to Reddit to save your distance.' : e instanceof Error ? e.message : String(e), endless: { server: null, board: await board() } }),
          );
        return;
      }
      setResult(base);
      setShared('idle');
      // the server replays s.log and scores the run itself; the claimed score must match its replay
      postRun({ score: parts.total, seedCheck: course.checksum, inputs: s.log })
        .then((server) => {
          setResult({ ...base, server });
          setToday((t) => (t ? { ...t, myBest: server.best, myStreak: server.streak, playedToday: true } : t));
        })
        .catch((e: unknown) => setResult({ ...base, error: e instanceof ApiError && e.status === 401 ? 'Log in to Reddit to save your score.' : e instanceof Error ? e.message : String(e) }))
        .finally(() => {
          getLeaderboard(today.date)
            .then(setBoard)
            .catch(() => setBoard(null));
        });
    },
    [today, course],
  );
  // Auto mode (TEST bar): the autopilot drives; after each result it starts the next run by itself
  const [autoPilot, setAutoPilot] = useState(false);
  const autoRef = useRef(false);
  autoRef.current = autoPilot;
  useEffect(() => {
    if (!autoPilot || !result) return;
    const t = window.setTimeout(() => {
      setResult(null);
      setRun((r) => ({ key: r.key + 1, auto: true }));
    }, 3000);
    return () => window.clearTimeout(t);
  }, [autoPilot, result]);

  const retry = useCallback(() => {
    setResult(null);
    setRun((r) => ({ key: r.key + 1, auto: true }));
  }, []);
  const share = () => {
    setShared('busy');
    postShare()
      .then(() => setShared('done'))
      .catch(() => setShared('error'));
  };

  return (
    <div className="min-h-dvh w-full text-slate-100 flex flex-col items-center px-2 pt-2 pb-3 gap-2">
      <header className="w-full max-w-[480px] flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold leading-tight tracking-tight">
            Grid <span className="text-orange-500">Expedition</span>
          </h1>
          <p className="text-xs text-slate-400 truncate">{today ? `${today.date} · ${route(today)}` : 'Loading today’s route…'}</p>
        </div>
        {today && screen === 'run' && (
          <div className="flex gap-2 shrink-0">
            <SoundToggle />
            {endless ? (
              <button className="btn btn-secondary" onClick={() => playMode('daily')}>
                Exit endless
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  canvas.current?.setPaused(true);
                  setScreen('preview');
                }}
              >
                View track
              </button>
            )}
          </div>
        )}
      </header>

      {loadError && (
        <div className="w-full max-w-[480px] rounded-xl bg-red-950/60 p-4 text-sm">
          <p className="mb-3">Could not load today’s track: {loadError}</p>
          <button className="btn btn-primary" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!today && !loadError && <Skeleton />}

      {today && course && screen === 'preview' && (
        <main className="w-full max-w-[480px]">
          <TrackPreview course={course} startLabel={hud?.phase === 'run' ? 'Back to the run (paused)' : today.playedToday ? 'Back to the run' : 'Start run'} onStart={() => setScreen('run')} />
          <section className="mt-3 rounded-xl bg-slate-800/70 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">Endless</p>
              <p className="text-xs text-slate-400">No finish line. Every 450 rows brings three new biomes and more obstacles. {today.myEndlessBest !== null ? `Your best today: ${today.myEndlessBest * METERS_PER_ROW} m` : 'Daily leaderboard by distance.'}</p>
            </div>
            <button className="btn btn-secondary shrink-0" onClick={() => playMode('endless')}>
              Play endless
            </button>
          </section>
        </main>
      )}

      {/* the run stays mounted while the preview or gallery is open (hidden), so viewing the track never loses a run */}
      {today && course && (
        <div className={screen === 'run' ? 'contents' : 'hidden'}>
          <HudBar hud={hud} endless={endless} />
          <main className="relative w-full max-w-[480px]">
            <ExpeditionCanvas key={run.key} ref={canvas} active={screen === 'run'} course={course} parSeconds={today.parSeconds} autoStart={run.auto} autoPilot={import.meta.env.DEV && autoPilot} onTick={onTick} onEnd={onEnd} onRetry={retry} />
            {hud?.phase === 'ready' && !result && (
              <Overlay>
                {intro ? (
                  <Intro
                    biome={today.biomes[0]}
                    canStart={hud.canStart}
                    onStart={() => {
                      setIntro(false);
                      canvas.current?.start();
                    }}
                    onClose={() => setIntro(false)}
                  />
                ) : (
                  <>
                    <p className="text-xl font-extrabold">{endless ? 'Endless: how far can you go?' : `${BIOMES[today.biomes[0]].name} first`}</p>
                    <p className="text-sm text-slate-300 text-center max-w-64">
                      {endless
                        ? 'No finish line. Every 450 rows: three new biomes and more obstacles. One crash ends the run.'
                        : 'One lane per row. Crash cells end the run. Finish faster for a bigger time score (only if you reach the finish). Grab pickups to change how you move.'}
                    </p>
                    <button className="btn btn-primary text-base px-6" disabled={!hud.canStart} onClick={() => canvas.current?.start()}>
                      {hud.canStart ? 'Start' : `Loading ${hud.loading?.name ?? ''} ${hud.loading?.pct ?? 0}%`}
                    </button>
                    <p className="text-xs text-slate-400">Space · ← → lanes · ↑ tuck · ↓ brake</p>
                    <button className="text-xs text-sky-300 underline underline-offset-2 cursor-pointer" onClick={() => setIntro(true)}>
                      How to play (15 s)
                    </button>
                  </>
                )}
              </Overlay>
            )}
            {hud?.phase === 'run' && hud.loading && (
              <p className="absolute top-2 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900/75 px-3 py-1 text-xs font-semibold pointer-events-none" role="status">
                Loading {hud.loading.name} · {hud.loading.pct}%
              </p>
            )}
            {result && (result.endless ? <EndlessResult result={result} onRetry={retry} /> : <ResultCard result={result} course={course} today={today} board={board} shared={shared} onShare={share} onRetry={retry} />)}
          </main>
          {!endless && (
            <div className="w-full max-w-[480px]">
              <MiniMap course={course} pos={hud?.row ?? 0} taken={hud?.taken ?? new Set()} />
            </div>
          )}
          <nav className="w-full max-w-[480px] grid grid-cols-4 gap-2" aria-label="Controls">
            <Pad label="◀" title="Lane left" onPress={() => canvas.current?.steer(-1)} repeat />
            <Pad label="Brake" title="Brake (hold)" disabled={hud ? !hud.canSpeed : false} onHold={(on) => canvas.current?.hold('brake', on)} />
            <Pad label="Tuck" title="Tuck for speed (hold)" disabled={hud ? !hud.canSpeed : false} onHold={(on) => canvas.current?.hold('fast', on)} />
            <Pad label="▶" title="Lane right" onPress={() => canvas.current?.steer(1)} repeat />
          </nav>
        </div>
      )}
      {/* test toolbar, model gallery and autopilot: dev server only (npm run dev); the built game has none of them */}
      {import.meta.env.DEV && screen === 'gallery' && <Gallery onClose={() => setScreen('preview')} />}
      {import.meta.env.DEV && DevToolbar && (
        <DevToolbar
          onChange={load}
          onModels={() => setScreen('gallery')}
          auto={autoPilot}
          onAuto={(on) => {
            setAutoPilot(on);
            if (on) setScreen('run');
          }}
        />
      )}
    </div>
  );
}

/** m:ss for long (endless) runs. */
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function HudBar({ hud, endless }: { hud: Hud | null; endless: boolean }) {
  const cell = 'rounded-md bg-slate-800 px-1.5 py-1 leading-tight min-w-0';
  // elapsed time; turns amber once you are slower than par (the time score is 3000 × par / time). Endless: no par.
  const slow = !endless && hud !== null && hud.time > hud.par;
  return (
    <div className="w-full max-w-[480px] grid grid-cols-4 gap-1.5 text-center text-xs tabular-nums" aria-live="off">
      <div className={cell}>
        <p className="text-slate-400">Time</p>
        <p className={`text-base font-bold ${slow ? 'text-amber-400' : ''}`} title="Finish faster than par for more than 3000 time points">
          {endless ? clock(hud?.time ?? 0) : (hud?.time ?? 0).toFixed(1)}
          {!endless && <span className="text-slate-400 text-xs">/{Math.round(hud?.par ?? 0)}</span>}
        </p>
      </div>
      <div className={cell}>
        <p className="text-slate-400">Score</p>
        <p className="text-base font-bold">{hud?.score ?? 0}</p>
      </div>
      <div className={cell}>
        <p className="text-slate-400">Distance</p>
        <p className="text-base font-bold">
          {endless ? `${(hud?.row ?? 0) * METERS_PER_ROW} m` : (hud?.row ?? 0)}
          {!endless && <span className="text-slate-400 text-xs">/{ROWS}</span>}
        </p>
      </div>
      <div className={cell}>
        {hud?.timed ? (
          <>
            <p className="text-yellow-300 truncate">{vehicle(hud.timed).name}</p>
            <p className="text-base font-bold">{hud.timedLeft} rows</p>
          </>
        ) : (
          <>
            <p className="text-slate-400 truncate">Next biome</p>
            <p className="text-base font-bold">{hud?.nextBiome != null ? `${hud.nextBiome} rows` : 'finish'}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="w-full max-w-[480px] flex flex-col gap-2 animate-pulse" aria-label="Loading">
      <div className="h-11 rounded-md bg-slate-800" />
      <div className="aspect-[2/3] max-h-[60vh] rounded-xl bg-slate-800" />
      <div className="h-8 rounded-md bg-slate-800" />
      <div className="h-14 rounded-lg bg-slate-800" />
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto mx-3 max-h-full overflow-y-auto rounded-xl bg-slate-900/90 backdrop-blur-sm px-4 py-4 flex flex-col items-center gap-3 shadow-xl">
        {children}
      </div>
    </div>
  );
}

/** Top 10 of a daily board, plus the caller if lower. `fmt` formats a score (points, or metres for endless). */
function BoardList({ board, fmt = String }: { board: LeaderboardResponse | null; fmt?: (n: number) => string }) {
  if (!board || board.top.length === 0) return null;
  return (
    <ol className="w-full max-w-64 text-xs tabular-nums">
      {board.top.map((e) => (
        <li key={e.rank} className="flex justify-between gap-2">
          <span className="truncate">
            #{e.rank} {e.username}
          </span>
          <span className="font-semibold">{fmt(e.score)}</span>
        </li>
      ))}
      {board.me && board.me.rank > 10 && (
        <li className="flex justify-between gap-2 text-orange-300">
          <span>#{board.me.rank} you</span>
          <span className="font-semibold">{fmt(board.me.best)}</span>
        </li>
      )}
    </ol>
  );
}

const metres = (rows: number) => `${rows * METERS_PER_ROW} m`;

function EndlessResult({ result: r, onRetry }: { result: Result; onRetry: () => void }) {
  const server = r.endless?.server ?? null;
  return (
    <Overlay>
      <p className="text-2xl font-extrabold text-red-400">Crashed</p>
      <p className="text-4xl font-black tabular-nums -mt-1">{metres(r.distance)}</p>
      <p className="text-sm text-slate-300 tabular-nums">
        {r.distance} rows · {clock(r.time)} · {r.parts.total} points
      </p>
      {server ? (
        <p className="text-xs text-slate-300 text-center">
          Best today <b>{metres(server.best)}</b>
          {server.improved && <span className="text-orange-400"> · new best</span>} · rank <b>#{server.rank}</b>
        </p>
      ) : r.error ? (
        <p className="text-xs text-red-300 text-center max-w-64">{r.error}</p>
      ) : (
        <p className="text-xs text-slate-400">Saving…</p>
      )}
      <BoardList board={r.endless?.board ?? null} fmt={metres} />
      <button className="btn btn-primary px-5" onClick={onRetry}>
        Retry
      </button>
    </Overlay>
  );
}

function ResultCard(props: { result: Result; course: Course; today: TodayResponse; board: LeaderboardResponse | null; shared: string; onShare: () => void; onRetry: () => void }) {
  const { result: r, course, today, board, shared } = props;
  const fin = r.phase === 'finish';
  // the share image: whole track + this run's path + score, time and rank (redrawn once the rank is known)
  const card = useMemo(
    () =>
      drawShareCard({
        course,
        lanes: r.lanes,
        finished: fin,
        row: r.distance,
        score: r.parts.total,
        time: r.time,
        par: today.parSeconds,
        gates: r.gates,
        rank: r.server?.rank ?? null,
        total: board?.total ?? null,
      }),
    [course, r, fin, today.parSeconds, board],
  );
  const row = (k: string, v: number | string) => (
    <tr key={k}>
      <td className="pr-4 text-slate-300">{k}</td>
      <td className="text-right font-semibold">{v}</td>
    </tr>
  );
  return (
    <Overlay>
      <p className={`text-xl font-extrabold ${fin ? 'text-green-400' : 'text-red-400'}`}>{fin ? '✓ Finished' : 'Crashed'}</p>
      {card && <img src={card} alt={`Run summary: ${r.parts.total} points`} className="w-full max-w-80 rounded-lg shadow-lg" />}
      <details className="text-xs text-slate-300">
        <summary className="cursor-pointer text-center">Score breakdown</summary>
        <table className="text-sm tabular-nums">
        <tbody>
          {row(`Distance ${r.distance}/${ROWS} · ${r.distance * METERS_PER_ROW} m`, r.parts.rows)}
          {row(`Gates ${r.gates}`, r.parts.gates)}
          {row('Collect', r.parts.collect)}
          {row('Air', r.parts.air)}
          {r.parts.breaks > 0 && row('Smash', r.parts.breaks)}
          {fin ? row(`Time ${r.time.toFixed(1)} s (par ${today.parSeconds} s)`, r.parts.finish) : row('Time score: finish to earn it', '—')}
        </tbody>
      </table>
      </details>
      {r.server ? (
        <p className="text-xs text-slate-300 text-center">
          Best today <b>{r.server.best}</b>
          {r.server.improved && <span className="text-orange-400"> · new best</span>} · rank <b>#{r.server.rank ?? '–'}</b> · streak <b>{r.server.streak}</b>
        </p>
      ) : r.error ? (
        <p className="text-xs text-red-300 text-center max-w-64">{r.error}</p>
      ) : (
        <p className="text-xs text-slate-400">Saving…</p>
      )}
      <BoardList board={board} />
      <div className="flex gap-2">
        <button className="btn btn-primary px-5" onClick={props.onRetry}>
          Retry
        </button>
        <button className="btn btn-secondary" disabled={!r.server || shared === 'busy' || shared === 'done'} onClick={props.onShare}>
          {shared === 'done' ? 'Shared ✓' : shared === 'error' ? 'Share failed, retry' : 'Share my run'}
        </button>
        {card && (
          <a className="btn btn-secondary" href={card} download={`grid-expedition-${today.date}.png`}>
            Save image
          </a>
        )}
      </div>
    </Overlay>
  );
}

/** Hold-able control pad button (≥44 px). `repeat` re-fires onPress while held. */
function Pad(props: { label: string; title: string; onPress?: () => void; onHold?: (on: boolean) => void; repeat?: boolean; disabled?: boolean }) {
  const { label, title, onPress, onHold, repeat, disabled } = props;
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onHold?.(false);
  };
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    onPress?.();
    onHold?.(true);
    if (repeat && onPress) {
      const tick = (delay: number) => {
        timer.current = window.setTimeout(() => {
          onPress();
          tick(110);
        }, delay);
      };
      tick(220);
    }
  };
  return (
    <button
      className="btn btn-pad h-14 text-base"
      title={title}
      aria-label={title}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

