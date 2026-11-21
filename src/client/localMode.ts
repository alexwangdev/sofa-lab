/** Local-mode settings (dev toolbar). Only used when the client runs under `npm run local` (import.meta.env.DEV). */
export type LocalSettings = { user: string; date: string; w: string };

const KEY = 'sofa-lab:local';
export const LOCAL_USERS = ['you', 'alice', 'bob', 'carol', 'dave'] as const;

export const isLocal = (): boolean => import.meta.env.DEV;

export function readLocal(): LocalSettings {
  try {
    const parsed: Partial<LocalSettings> = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { user: parsed.user ?? 'you', date: parsed.date ?? '', w: parsed.w ?? '' };
  } catch {
    return { user: 'you', date: '', w: '' };
  }
}

export function writeLocal(s: LocalSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Headers the local server reads instead of Devvit's context. Empty in production. */
export function localHeaders(): Record<string, string> {
  if (!import.meta.env.DEV) return {};
  const s = readLocal();
  return { 'x-local-user': s.user, 'x-local-date': s.date, 'x-local-w': s.w };
}
