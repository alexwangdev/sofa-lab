import type { TestResult } from '../shared/types';

/** Short jam description, shared with the status line. */
export function jamText(res: TestResult): string {
  if (res.jamPhase === 'approach') return 'Blocked on the way in';
  if (res.jamPhase === 'exit') return 'Blocked on the way out';
  return `Jammed at ${(res.jamAngle ?? 0).toFixed(1)}°`;
}
