/**
 * The share image shown on the result card (and saved with "Save image"): the day's whole track as a strip with the
 * exact path the runner took, the route, the score, time against par and the rank. Drawn on a canvas, 1200 × 630
 * (the usual link-preview ratio).
 */
import { BIOMES } from '../shared/biomes.ts';
import { COLS, FINISH_ROW, SEGMENT_START, segmentEnd } from '../shared/grid.ts';
import { METERS_PER_ROW } from '../shared/sim.ts';
import type { Course } from '../shared/types.ts';
import { cellColor } from './TrackPreview.tsx';

export type ShareInfo = {
  course: Course;
  lanes: readonly number[];
  finished: boolean;
  row: number;
  score: number;
  time: number;
  par: number;
  gates: number;
  rank: number | null;
  total: number | null;
};

const W = 1200;
const H = 630;

export function drawShareCard(info: ShareInfo): string {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return '';
  const { course } = info;
  const font = (px: number, weight = 800) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  // background: the three biomes' skies, left to right
  const bg = g.createLinearGradient(0, 0, W, 0);
  course.biomes.slice(0, 3).forEach((b, i) => {
    const sky = BIOMES[b].palette.sky;
    bg.addColorStop(i / 2, sky[0]);
  });
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(2,6,23,0.55)';
  g.fillRect(0, 0, W, H);

  // title + date
  g.fillStyle = '#fff';
  g.font = font(44);
  g.textBaseline = 'top';
  g.fillText('Grid', 56, 44);
  const gw = g.measureText('Grid ').width;
  g.fillStyle = '#f97316';
  g.fillText('Expedition', 56 + gw, 44);
  g.fillStyle = '#cbd5e1';
  g.font = font(28, 600);
  g.textAlign = 'right';
  g.fillText(course.date, W - 56, 54);
  g.textAlign = 'left';

  // the track: rows left → right, lanes top → bottom, with the runner's path on top
  const x0 = 56;
  const y0 = 140;
  const sw = W - 112;
  const ch = 17;
  const cw = sw / (FINISH_ROW + 1);
  for (let r = 0; r <= FINISH_ROW; r++)
    for (let c = 0; c < COLS; c++) {
      g.fillStyle = cellColor(course, r, c);
      g.fillRect(x0 + r * cw, y0 + c * ch, Math.ceil(cw) + 0.5, ch);
    }
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.strokeRect(x0, y0, sw, ch * COLS);
  g.beginPath();
  let started = false;
  for (let r = 0; r <= info.row; r++) {
    const lane = info.lanes[r];
    if (lane === undefined) continue;
    const x = x0 + (r + 0.5) * cw;
    const y = y0 + (lane + 0.5) * ch;
    if (started) g.lineTo(x, y);
    else g.moveTo(x, y);
    started = true;
  }
  g.strokeStyle = '#0f172a';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.stroke();
  g.strokeStyle = '#facc15';
  g.lineWidth = 3.5;
  g.stroke();
  // end marker: flag on a finish, burst on a crash
  const endLane = info.lanes[info.row] ?? 4;
  const ex = x0 + (info.row + 0.5) * cw;
  const ey = y0 + (endLane + 0.5) * ch;
  g.font = font(30);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.finished ? '🏁' : '💥', ex, ey);

  // biome names under their stretch of the strip
  g.font = font(24, 700);
  g.textBaseline = 'top';
  for (let i = 0; i < 3; i++) {
    const b = course.biomes[i];
    if (!b) continue;
    const mid = (SEGMENT_START[i as 0 | 1 | 2] + segmentEnd(i)) / 2;
    g.fillStyle = '#e2e8f0';
    g.fillText(BIOMES[b].name, x0 + mid * cw, y0 + ch * COLS + 14);
  }

  // the numbers
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.font = font(120, 900);
  g.fillText(String(info.score), 56, 470);
  const sx = 56 + g.measureText(String(info.score)).width + 24;
  g.font = font(30, 700);
  g.fillStyle = '#cbd5e1';
  g.fillText('points', sx, 470);
  g.font = font(34, 700);
  g.fillStyle = info.finished ? '#4ade80' : '#f87171';
  const line = info.finished
    ? `✓ Finished in ${info.time.toFixed(1)} s  (par ${info.par} s)`
    : `Crashed at ${info.row * METERS_PER_ROW} m of ${(FINISH_ROW + 1) * METERS_PER_ROW} m`;
  g.fillText(line, 56, 540);
  g.fillStyle = '#e2e8f0';
  g.font = font(30, 600);
  const rank = info.rank !== null ? `#${info.rank}${info.total ? ` of ${info.total}` : ''} today` : '';
  g.fillText([`🚩 ${info.gates} gates`, rank].filter(Boolean).join('   ·   '), 56, 590);
  g.textAlign = 'right';
  g.fillStyle = '#94a3b8';
  g.font = font(24, 600);
  g.fillText('Same track for everyone today', W - 56, 590);
  return cv.toDataURL('image/png');
}
