export type TrackProjectionPoint = { x: number; y: number };
/** Reads only the shipped official asset; no telemetry or authenticated API calls. */
export async function loadRoadAtlantaProjection(signal: AbortSignal): Promise<TrackProjectionPoint[]> {
  const response = await fetch('/tracks/layered/track-127.svg', {signal});
  if (!response.ok) throw Error('track unavailable');
  const outer = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const layer = Array.from(outer.querySelectorAll('image')).find(node => node.getAttribute('filter') === 'url(#activeColor)');
  const uri = layer?.getAttribute('href');
  if (!uri?.startsWith('data:image/svg+xml;base64,')) return [];
  const inner = new DOMParser().parseFromString(atob(uri.split(',')[1]), 'image/svg+xml');
  const d = inner.querySelector('path')?.getAttribute('d')?.match(/^[\s\S]*?[zZ]/)?.[0];
  if (!d || (d.match(/[mM]/g)?.length ?? 0) !== 1) return [];
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return [];
  const n = 1024;
  const sampled = Array.from({length:n},(_,i) => { const p=path.getPointAtLength(i/n*length); return {x:p.x,y:p.y}; });
  // Center of the official start/finish line. The official direction arrow
  // points down the main straight, opposite the first contour's winding.
  let start = 0;
  sampled.forEach((p,i) => { if (Math.hypot(p.x-1749,p.y-327.7) < Math.hypot(sampled[start].x-1749,sampled[start].y-327.7)) start=i; });
  return Array.from({length:n},(_,i) => sampled[(start-i+n)%n]);
}
