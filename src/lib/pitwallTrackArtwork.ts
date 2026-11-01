/** Visual layers from the already-selected shipped asset; no geometry changes. */
export function readTrackArtwork(source: string) {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (svg.querySelector('parsererror')) return null;
  const images = [...svg.querySelectorAll('svg > image')];
  const embedded = (name: string) => images.find(image => image.getAttribute('filter') === `url(#${name})`)
    ?.getAttribute('href');
  // Also accept the original named layers. Keep their own styles/definitions
  // inside an isolated SVG image, never inject asset markup into the page.
  const named = (matches: (name: string) => boolean) => {
    const layer = [...svg.querySelectorAll('[data-name]')].find(node => matches(node.getAttribute('data-name') ?? ''));
    if (!layer) return null;
    const root = svg.documentElement.cloneNode(false) as Element;
    root.removeAttribute('id');
    for (const node of [...svg.documentElement.children]) {
      if (['defs', 'style'].includes(node.localName)) root.append(node.cloneNode(true));
    }
    root.append(layer.cloneNode(true));
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(root))))}`;
  };
  const layer = (filter: string, matches: (name: string) => boolean) => {
    const href = embedded(filter);
    return href?.startsWith('data:image/svg+xml;base64,') ? href : named(matches);
  };
  const background = layer('backgroundColor', name => /^background[ _]details$/i.test(name));
  const active = layer('activeColor', name => / - config$/i.test(name));
  const finish = layer('finishColor', name => /start[ _-]*finish|finish[ _-]*line/i.test(name));
  // Inactive Configs, pitroad and the asset's unmasked activeGlow are
  // deliberately excluded: only the selected layout belongs in the pitwall.
  return active && finish ? { background, active, finish } : null;
}

export async function loadTrackArtwork(mapPath: string, signal: AbortSignal) {
  const response = await fetch(mapPath, { signal });
  if (!response.ok) throw new Error('track artwork unavailable');
  return readTrackArtwork(await response.text());
}
