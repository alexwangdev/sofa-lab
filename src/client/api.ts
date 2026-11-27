/**
 * Fetch wrappers for spec §13. On Reddit they go to the Devvit server; in the standalone web build they are answered in
 * the page (see platform.ts). Paths, bodies and responses are the same either way.
 */
import type { EndlessRunBody, EndlessRunResponse, ErrorResponse, LeaderboardResponse, RunBody, RunResponse, TodayResponse } from '../shared/types.ts';
import { apiFetch } from './platform.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ErrorResponse;
      if (body.error) msg = body.error;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const getToday = (): Promise<TodayResponse> => call('/api/today');
export const postRun = (body: RunBody): Promise<RunResponse> => call('/api/run', { method: 'POST', body: JSON.stringify(body) });
export const getLeaderboard = (date: string): Promise<LeaderboardResponse> => call(`/api/leaderboard?date=${encodeURIComponent(date)}`);
export const postEndless = (body: EndlessRunBody): Promise<EndlessRunResponse> => call('/api/endless', { method: 'POST', body: JSON.stringify(body) });
export const getEndlessLeaderboard = (date: string): Promise<LeaderboardResponse> => call(`/api/endless-leaderboard?date=${encodeURIComponent(date)}`);
export const postShare = (): Promise<{ ok: boolean; text: string }> => call('/api/share', { method: 'POST', body: '{}' });
