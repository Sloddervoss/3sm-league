export const wrapLap = (value: number) => ((value % 1) + 1) % 1;

/** Interpolate measurements, never extrapolate beyond the latest received point. */
export function lapMotion(from: number, to: number, elapsedMs: number) {
  let delta = to - from;
  if (delta < -0.5) delta += 1;
  if (delta > 0.5) delta -= 1;
  const animate = elapsedMs > 0 && elapsedMs <= 3000 && Math.abs(delta) <= 0.15;
  return { delta, duration: animate ? Math.min(1200, Math.max(100, elapsedMs)) : 0 };
}

export function pointOnTrack(points: { x: number; y: number }[], lap: number) {
  const index = wrapLap(lap) * points.length;
  const a = points[Math.floor(index) % points.length];
  const b = points[(Math.floor(index) + 1) % points.length];
  const fraction = index - Math.floor(index);
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}
