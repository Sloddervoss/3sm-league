import type { TrackProjectionGeometry } from '@/lib/pitwallTrackGeometry';
import { pointOnTrack } from './trackMotion';

/** Reveal the same ordered path used by the cars, never invent sector borders. */
export function trackProgressPoints(points: TrackProjectionGeometry['points'], pct: number | null | undefined): string {
  if (!points.length || typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 1) return '';
  const end = pct === 1 ? points[0] : pointOnTrack(points, pct);
  return [...points.slice(0, Math.floor(pct * points.length) + 1), end].map(p => `${p.x},${p.y}`).join(' ');
}
