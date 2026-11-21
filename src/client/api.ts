/** Fetch wrappers for spec §8. Same calls in production (Devvit) and local mode (`npm run local`). */
import type {
  CellId,
  ErrorResponse,
  LeaderboardResponse,
  RevealResponse,
  SubmitResult,
  TestResult,
  TodayResponse,
} from '../shared/types';
import { localHeaders } from './localMode';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...localHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body: ErrorResponse = await res.json();
      if (body.error) msg = body.error;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  const data: T = await res.json();
  return data;
}

export const getToday = (): Promise<TodayResponse> => call('/api/today');

export const postTest = (cells: CellId[]): Promise<TestResult> =>
  call('/api/test', { method: 'POST', body: JSON.stringify({ cells }) });

export const postSubmit = (cells: CellId[]): Promise<SubmitResult> =>
  call('/api/submit', { method: 'POST', body: JSON.stringify({ cells }) });

export const getLeaderboard = (date: string): Promise<LeaderboardResponse> =>
  call(`/api/leaderboard?date=${encodeURIComponent(date)}`);

export const postShare = (): Promise<{ ok: boolean; text: string }> => call('/api/share', { method: 'POST', body: '{}' });

export const postSubscribe = (): Promise<{ ok: boolean }> => call('/api/subscribe', { method: 'POST', body: '{}' });

export const getReveal = (date?: string): Promise<RevealResponse> =>
  call(date ? `/api/reveal?date=${encodeURIComponent(date)}` : '/api/reveal');
