/** Visual layers from the already-selected shipped asset; no geometry changes. */
export function readTrackArtwork(source: string) {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  const images = [...svg.querySelectorAll('svg > image')];
  const layer = (name: string) => images.filter(image => image.getAttribute('filter') === `url(#${name})`)
    .map(image => image.getAttribute('href')).filter((href): href is string => !!href?.startsWith('data:image/svg+xml;base64,'));
  const active = layer('activeColor')[0];
  const finish = layer('finishColor')[0];
  return active && finish ? { inactive: layer('inactiveColor'), active, finish } : null;
}

export async function loadTrackArtwork(mapPath: string, signal: AbortSignal) {
  const response = await fetch(mapPath, { signal });
  if (!response.ok) throw new Error('track artwork unavailable');
  return readTrackArtwork(await response.text());
}
