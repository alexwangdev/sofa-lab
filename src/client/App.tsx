import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CellId, LeaderboardResponse, SubmitResult, TestResult, TodayResponse } from '../shared/types';
import { GERVER, areaOf, checkShape, runTest } from '../shared/sofa';
import { ApiError, getLeaderboard, getToday, postShare, postSubmit, postSubscribe, postTest } from './api';
import { CanvasSkeleton, SofaCanvas } from './SofaCanvas';
import type { AnimRequest } from './SofaCanvas';
import { Hammersley } from './Hammersley';
import { DevToolbar } from './DevToolbar';
import { MEDALS, medalFor } from '../shared/daily';
import type { Difficulty } from '../shared/types';
import { jamText } from './jam';
import { CarveTools } from './Carve';
import { Yesterday } from './Reveal';
import { biggestPiece, hintsFor } from '../shared/sofa';
import type { Hints } from '../shared/sofa';
import { shareLines } from '../shared/share';

const MEDAL_LABEL: Record<'gold' | 'silver' | 'bronze', string> = { gold: '🥇 Gold', silver: '🥈 Silver', bronze: '🥉 Bronze' };
const DIFF_STYLE: Record<Difficulty, string> = {
  Easy: 'bg-green-100 text-green-900',
  Medium: 'bg-amber-100 text-amber-900',
  Hard: 'bg-red-100 text-red-900',
  Gerver: 'bg-indigo-100 text-indigo-900',
};

/** Next medal the player hasn't reached yet, and the area it needs. */
function nextMedal(area: number, par: number | null): { medal: 'gold' | 'silver' | 'bronze'; need: number } | null {
  if (!par) return null;
  for (const m of ['bronze', 'silver', 'gold'] as const) {
    const need = Math.ceil(par * MEDALS[m] * 100) / 100;
    if (area < need) return { medal: m, need };
  }
  return null;
}

const TUTORIAL_KEY = 'sofa-lab:tutorial-seen';
const MAX_UNDO = 100;

function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(() => !tutorialSeen());

  const [cells, setCells] = useState<Set<CellId>>(() => new Set());
  const [history, setHistory] = useState<Set<CellId>[]>([]);
  const [erase, setErase] = useState(false);
  const [practice, setPractice] = useState(false);

  const [anim, setAnim] = useState<AnimRequest | null>(null);
  const [testing, setTesting] = useState(false);
  const [jamCells, setJamCells] = useState<Set<CellId>>(() => new Set());
  const [hints, setHints] = useState<Hints | null>(null);
  const [brush, setBrush] = useState<1 | 2 | 3>(1);
  const [mirror, setMirror] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' } | null>(null);

  const [confirming, setConfirming] = useState<{ cells: CellId[]; preview: TestResult } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const applyToday = useCallback((t: TodayResponse) => {
    setLoadError(null);
    setToday(t);
    if (t.hasSubmitted && t.myCells) {
      setCells(new Set(t.myCells));
      setResult({
        date: t.date,
        w: t.w,
        pass: (t.myArea ?? 0) > 0,
        area: t.myArea ?? 0,
        rank: t.myRank,
        streak: t.streak,
        target: t.target,
        par: t.par,
        medal: medalFor(t.myArea ?? 0, t.par),
      });
    }
  }, []);
  const failToday = useCallback((e: unknown) => setLoadError(e instanceof Error ? e.message : 'failed to load'), []);
  const load = useCallback(() => getToday().then(applyToday, failToday), [applyToday, failToday]);

  useEffect(() => {
    getToday().then(applyToday, failToday);
  }, [applyToday, failToday]);

  const submitted = today?.hasSubmitted === true || result !== null;
  const editable = !submitted || practice;
  const area = areaOf(cells.size);

  const commit = (next: Set<CellId>) => {
    setHistory((h) => [...h.slice(-MAX_UNDO + 1), cells]);
    setCells(next);
    setJamCells(new Set());
    setHints(null);
    setStatus(null);
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setCells(prev);
    setJamCells(new Set());
    setHints(null);
    setStatus(null);
  };

  const clear = () => {
    if (cells.size > 0) commit(new Set());
  };

  const doTest = async () => {
    if (!today || testing) return;
    const local = runTest([...cells], today.course);
    if (!local.ok) {
      setStatus({ text: local.error, tone: 'bad' });
      return;
    }
    setTesting(true);
    setStatus(null);
    let res: TestResult = local.result;
    let preview = true;
    try {
      res = await postTest(local.cells);
      preview = false;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setStatus({ text: e.message, tone: 'bad' });
        setTesting(false);
        return;
      }
    }
    setAnim({ id: Date.now(), result: res, cells: local.cells });
    setStatus({
      text: `${res.pass ? passText(res.area, today.par) : `${jamText(res)} · score 0`}${preview ? ' (preview)' : ''}`,
      tone: res.pass ? 'ok' : 'bad',
    });
  };

  const onAnimDone = (res: TestResult) => {
    setTesting(false);
    setJamCells(new Set(res.pass ? [] : (res.jamCells ?? [])));
    if (today) setHints(hintsFor([...cells], res, today.course));
  };

  const askSubmit = () => {
    if (!today) return;
    const chk = checkShape([...cells], undefined, today.course.torn);
    if (!chk.ok) {
      setStatus({ text: chk.error, tone: 'bad' });
      return;
    }
    const local = runTest(chk.cells, today.course);
    if (!local.ok) return;
    setConfirming({ cells: chk.cells, preview: local.result });
  };

  const doSubmit = async () => {
    if (!confirming) return;
    setSubmitting(true);
    try {
      const r = await postSubmit(confirming.cells);
      setResult(r);
      setToday((t) => (t ? { ...t, hasSubmitted: true, myArea: r.area, myCells: confirming.cells, myRank: r.rank, streak: r.streak } : t));
      setPractice(false);
      setConfirming(null);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'submit failed', tone: 'bad' });
      setConfirming(null);
      if (e instanceof ApiError && e.status === 409) void load();
    } finally {
      setSubmitting(false);
    }
  };

  const finishTutorial = () => {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      /* storage blocked */
    }
    setShowTutorial(false);
  };

  const shownArea = submitted && !practice && result ? result.area : area;

  return (
    <main className="mx-auto w-full max-w-[480px] px-2 pt-2 pb-16 flex flex-col gap-2 text-zinc-900">
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-extrabold tracking-tight">Sofa Lab</h1>
        <span className="text-sm text-zinc-600">{today ? `${today.weekday} ${today.date}` : ' '}</span>
      </header>
      {today && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-bold ${DIFF_STYLE[today.difficulty]}`}>
            {today.difficulty === 'Gerver' ? 'Gerver day' : today.difficulty}
          </span>
          <span className="rounded-full bg-zinc-200 px-2 py-0.5">hallway w={today.w}</span>
          {today.twists.map((t) => (
            <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-white">
              {t}
            </span>
          ))}
        </div>
      )}
      <p className="text-sm font-semibold" aria-live="polite">
        {today ? today.targetLabel : 'Gerver 2.2195'}
        {today && today.difficulty === 'Gerver' && today.par !== null && <span className="font-normal"> · par {today.par.toFixed(2)}</span>} · you:{' '}
        {shownArea.toFixed(3)}
        {today && (() => {
          const done = submitted && !practice && result ? result.medal : null;
          if (done) return <span> · {MEDAL_LABEL[done]}</span>;
          const next = nextMedal(shownArea, today.par);
          return next ? (
            <span className="font-normal text-zinc-500">
              {' '}
              · {MEDAL_LABEL[next.medal]} at {next.need.toFixed(2)}
            </span>
          ) : null;
        })()}
      </p>

      {loadError && (
        <div className="rounded bg-red-50 p-2 text-sm text-red-800">
          {loadError}{' '}
          <button className="underline min-h-11" onClick={() => void load()}>
            retry
          </button>
        </div>
      )}

      {showTutorial ? (
        <Hammersley onDone={finishTutorial} />
      ) : !today ? (
        <CanvasSkeleton />
      ) : (
        <>
          <SofaCanvas
            cells={cells}
            course={today.course}
            editable={editable && !testing}
            erase={erase}
            onStroke={commit}
            anim={anim}
            onAnimDone={onAnimDone}
            jamCells={jamCells}
            hints={hints}
            brush={brush}
            mirror={mirror}
          />
          <div className="flex items-center justify-between text-xs text-zinc-600 min-h-5">
            <span>
              {!editable
                ? 'Submitted — building is locked for today.'
                : hints && (hints.early.length || hints.late.length)
                  ? '■ red: jams early · ■ orange: jams late — trim these'
                  : hints && hints.grow.length
                    ? '□ green: room to grow — still fits'
                    : 'Tap to toggle, drag to paint.'}
            </span>
            <button className="underline" onClick={() => setShowTutorial(true)}>
              Tutorial
            </button>
          </div>
          {status && (
            <p
              role="status"
              className={`text-sm font-semibold ${status.tone === 'ok' ? 'text-green-700' : status.tone === 'bad' ? 'text-red-700' : 'text-zinc-700'}`}
            >
              {status.text}
              {status.text === 'sofa must be one piece' && editable && (
                <button className="btn btn-secondary ml-2 px-3" onClick={() => commit(new Set(biggestPiece(cells)))}>
                  Remove loose bits
                </button>
              )}
            </p>
          )}
          <div className="grid grid-cols-5 gap-1.5">
            <button className="btn btn-primary" onClick={() => void doTest()} disabled={testing || cells.size === 0}>
              Test
            </button>
            <button className="btn btn-secondary" onClick={undo} disabled={!editable || history.length === 0 || testing}>
              Undo
            </button>
            <button className="btn btn-secondary" onClick={clear} disabled={!editable || cells.size === 0 || testing}>
              Clear
            </button>
            <button
              className={`btn ${erase ? 'btn-dark' : 'btn-secondary'}`}
              onClick={() => setErase((x) => !x)}
              disabled={!editable}
              aria-pressed={erase}
            >
              Erase
            </button>
            {submitted ? (
              <button className={`btn ${practice ? 'btn-dark' : 'btn-secondary'}`} onClick={() => setPractice((p) => !p)} aria-pressed={practice}>
                Practice
              </button>
            ) : (
              <button className="btn btn-accent" onClick={askSubmit} disabled={cells.size === 0 || testing}>
                Submit
              </button>
            )}
          </div>
          <CarveTools
            course={today.course}
            prevCells={today.prevCells}
            brush={brush}
            mirror={mirror}
            disabled={!editable || testing}
            onBrush={setBrush}
            onMirror={setMirror}
            onTemplate={(t) => commit(new Set(t))}
          />
          {practice && <p className="text-xs text-zinc-600">Practice copy — edits and tests don't change your score.</p>}
          {result && today && <ResultCard result={result} today={today} />}
          <Yesterday />
        </>
      )}

      {confirming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 flex flex-col gap-3">
            <h2 className="text-lg font-bold">Submit this sofa?</h2>
            <p className="text-sm">
              Area <b>{confirming.preview.area.toFixed(3)}</b>
              {confirming.preview.pass ? (
                <span className="text-green-700"> · clears the corner (preview)</span>
              ) : (
                <span className="text-red-700"> · jams at {confirming.preview.jamAngle}° — scores 0</span>
              )}
            </p>
            <p className="text-sm font-semibold">One submit per day, this cannot be undone.</p>
            <div className="flex gap-2">
              <button className="btn btn-secondary flex-1" onClick={() => setConfirming(null)} disabled={submitting}>
                Cancel
              </button>
              <button className="btn btn-accent flex-1" onClick={() => void doSubmit()} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
      {import.meta.env.DEV && <DevToolbar />}
    </main>
  );
}

function passText(area: number, par: number | null): string {
  const m = medalFor(area, par);
  return `Clears the corner · area ${area.toFixed(3)}${m ? ` · ${MEDAL_LABEL[m]}` : ''}`;
}

function ResultCard({ result, today }: { result: SubmitResult; today: TodayResponse }) {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [subState, setSubState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  useEffect(() => {
    getLeaderboard(today.date)
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [today.date, result.area]);

  const par = result.par ?? today.par;
  const pct = useMemo(() => (par ? ((result.area / par) * 100).toFixed(1) : null), [par, result.area]);
  const gerverDay = today.difficulty === 'Gerver';
  const [copied, setCopied] = useState(false);
  const shareText = shareLines({
    weekday: today.weekday,
    difficulty: today.difficulty,
    area: result.area,
    pass: result.pass,
    par,
    medal: result.medal,
    streak: result.streak,
    course: today.course,
  }).join('\n');
  const rank = board?.me?.rank ?? result.rank;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-3 flex flex-col gap-2" aria-label="Result">
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-extrabold">{result.area.toFixed(3)}</span>
        <span className="text-sm text-zinc-600">{result.pass ? 'cleared the corner' : 'jammed — score 0'}</span>
      </div>
      <p className="text-base font-bold">
        {result.medal ? MEDAL_LABEL[result.medal] : result.pass ? 'No medal today' : 'Jammed — no medal'}
        <span className="font-normal text-sm text-zinc-600">
          {' '}
          · {today.weekday} {today.difficulty === 'Gerver' ? 'Gerver day' : today.difficulty}
          {gerverDay && result.area > 0 ? ` · ${((result.area / GERVER) * 100).toFixed(1)}% of Gerver` : ''}
        </span>
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <dt className="text-zinc-500">% of par{par ? ` ${par.toFixed(2)}` : ''}</dt>
          <dd className="font-bold">{pct !== null ? `${pct}%` : '—'}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Rank</dt>
          <dd className="font-bold">{rank !== null ? `#${rank}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Streak</dt>
          <dd className="font-bold">{result.streak}d</dd>
        </div>
      </dl>
      {board && board.top.length > 0 && (
        <ol className="text-sm divide-y divide-zinc-100">
          {board.top.map((e) => (
            <li key={`${e.rank}-${e.username}`} className={`flex justify-between py-1 ${board.me?.rank === e.rank ? 'font-bold' : ''}`}>
              <span>
                {e.rank}. u/{e.username}
              </span>
              <span>{e.area.toFixed(3)}</span>
            </li>
          ))}
          {board.me && board.me.rank > 10 && (
            <li className="flex justify-between py-1 font-bold">
              <span>{board.me.rank}. you</span>
              <span>{board.me.area.toFixed(3)}</span>
            </li>
          )}
        </ol>
      )}
      <pre className="rounded-lg bg-zinc-100 p-2 text-sm leading-snug whitespace-pre-wrap font-sans" aria-label="Share card">
        {shareText}
      </pre>
      <div className="flex gap-2">
        <button
          className="btn btn-secondary px-3"
          onClick={() => {
            navigator.clipboard
              .writeText(shareText)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button
          className="btn btn-primary flex-1"
          disabled={shareState === 'busy' || shareState === 'done'}
          onClick={() => {
            setShareState('busy');
            postShare()
              .then(() => setShareState('done'))
              .catch(() => setShareState('error'));
          }}
        >
          {shareState === 'done' ? 'Commented ✓' : shareState === 'error' ? 'Retry' : 'Comment'}
        </button>
        <button
          className="btn btn-secondary flex-1"
          disabled={subState === 'busy' || subState === 'done'}
          onClick={() => {
            setSubState('busy');
            postSubscribe()
              .then(() => setSubState('done'))
              .catch(() => setSubState('error'));
          }}
        >
          {subState === 'done' ? 'Joined ✓' : 'Join for tomorrow'}
        </button>
      </div>
    </section>
  );
}
