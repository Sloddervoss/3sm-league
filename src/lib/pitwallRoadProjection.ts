import type { TrackProjectionPoint } from './pitwallTrackGeometry';

export const ROAD_PROJECTION_IDS = [145,146,168,173,175,176,202,207,209,211,215,216,239,242,244,319] as const;

export function validateRoadProjection(value: unknown, trackId: number, mapSha256: string): TrackProjectionPoint[] | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.trackId !== trackId || data.mapPath !== `/tracks/layered/track-${trackId}.svg` || data.mapSha256 !== mapSha256) return null;
  if (data.directionSource !== 'official-arrow' && data.directionSource !== 'official-turn-order') return null;
  if (!Array.isArray(data.points) || data.points.length !== 1024) return null;
  const points: TrackProjectionPoint[] = [];
  for (const point of data.points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] < 0 || point[0] > 1920 || point[1] < 0 || point[1] > 1080) return null;
    points.push({ x: point[0], y: point[1] });
  }
  // All reviewed road centerlines have short uniform steps, including overpasses
  // and the last-to-first segment. Reject corrupt or partially populated assets.
  if (points.some((point, i) => {
    const next = points[(i + 1) % points.length];
    const distance = Math.hypot(next.x - point.x, next.y - point.y);
    return distance < 0.1 || distance > 20;
  })) return null;
  return points;
}

export async function loadRoadProjection(trackId: number, mapSource: string, signal: AbortSignal): Promise<TrackProjectionPoint[]> {
  const response = await fetch(`/tracks/projections/track-${trackId}.json`, { signal });
  if (!response.ok) throw new Error('Road projection unavailable');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mapSource.replace(/\r\n/g, '\n')));
  const mapSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const points = validateRoadProjection(await response.json(), trackId, mapSha256);
  if (!points || signal.aborted) throw new Error('Road projection does not match the official layout');
  return points;
}
