/** Spoiler-free share text (no shape data). Used for the Reddit comment and the copy button. */
import type { Course, Difficulty, Medal } from './types';
import { GERVER } from './sofa.ts';

const MEDAL_EMOJI: Record<'gold' | 'silver' | 'bronze', string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function twistShort(course: Course): string[] {
  const out: string[] = [];
  if (course.pillar) out.push(course.pillar.kind === 'corner' ? 'corner column' : 'wall pillar');
  if (course.torn.length > 0) out.push('torn fabric');
  return out;
}

/** 10-square progress bar of area / reference. */
export function bar(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction)) * 10;
  const full = Math.floor(f);
  const part = f - full >= 0.5 && full < 10 ? 1 : 0;
  return '🟩'.repeat(full) + '🟨'.repeat(part) + '⬜'.repeat(10 - full - part);
}

export type ShareInput = {
  weekday: string;
  difficulty: Difficulty;
  area: number;
  pass: boolean;
  par: number | null;
  medal: Medal;
  streak: number;
  course: Course;
};

/** Lines of the share card. Join with "\n" for the clipboard, "  \n" for Reddit markdown. */
export function shareLines(s: ShareInput): string[] {
  const gerverDay = s.difficulty === 'Gerver';
  const ref = gerverDay ? GERVER : s.par;
  const title = `Sofa Lab · ${s.weekday} ${gerverDay ? 'Gerver day' : s.difficulty}${s.medal ? ` ${MEDAL_EMOJI[s.medal]}` : ''}`;
  const streak = s.streak > 1 ? ` 🔥${s.streak}` : '';
  const score = !s.pass
    ? `Jammed 🧱 — 0 / ${ref?.toFixed(2) ?? '—'}${streak}`
    : `${s.area.toFixed(3)} / ${gerverDay ? `Gerver ${GERVER}` : `par ${ref?.toFixed(2) ?? '—'}`}${ref ? ` (${((s.area / ref) * 100).toFixed(1)}%)` : ''}${streak}`;
  const lines = [title, score, bar(ref && s.pass ? s.area / ref : 0)];
  const twists = twistShort(s.course);
  lines.push(`hallway w=${s.course.w}${twists.length ? ` · ${twists.join(' · ')}` : ''}`);
  return lines;
}
