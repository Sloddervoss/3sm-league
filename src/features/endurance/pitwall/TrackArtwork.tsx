import { useEffect, useId, useState, type RefObject } from 'react';
import { loadTrackArtwork, type readTrackArtwork } from '@/lib/pitwallTrackArtwork';

type Artwork = NonNullable<ReturnType<typeof readTrackArtwork>>;

/** Embedded images only: no injected SVG, background layer, labels or grid. */
export function TrackArtwork({ mapPath, progressMask, progressPoints }: {
  mapPath: string; progressMask: RefObject<SVGPolylineElement>; progressPoints: string;
}) {
  const id = useId().replace(/:/g, '');
  const [loaded, setLoaded] = useState<{ path: string; layers: Artwork } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadTrackArtwork(mapPath, controller.signal).then(layers => {
      if (!controller.signal.aborted && layers) setLoaded({ path: mapPath, layers });
    }).catch(() => { /* Preserve the existing full-asset fallback on failure. */ });
    return () => controller.abort();
  }, [mapPath]);
  if (loaded?.path !== mapPath) return <image href={mapPath} width="1920" height="1080" />;
  const { layers } = loaded;
  const image = (href: string, filter: string, key?: number) => <image key={key} href={href} width="1920" height="1080" filter={`url(#${id}-${filter})`} />;
  return <g data-pitwall-track-artwork="layered">
    <defs>
      {([['dim', '#435968'], ['orange', '#f97316'], ['finish', '#cbd5df']] as const).map(([name, color]) =>
        <filter key={name} id={`${id}-${name}`} colorInterpolationFilters="sRGB"><feFlood floodColor={color} /><feComposite in2="SourceAlpha" operator="in" /></filter>)}
      <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%"><feMorphology operator="dilate" radius="4" /><feGaussianBlur stdDeviation="9" /></filter>
      <mask id={`${id}-progress`} maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080" style={{ maskType: 'alpha' }}>
        <polyline ref={progressMask} points={progressPoints} fill="none" stroke="white" strokeWidth="42" strokeLinejoin="round" />
      </mask>
    </defs>
    <g opacity="0.55">{layers.inactive.map((href, index) => image(href, 'dim', index))}</g>
    {image(layers.active, 'dim')}
    <g mask={`url(#${id}-progress)`} data-pitwall-track-progress="true">
      <g filter={`url(#${id}-glow)`} opacity="1">{image(layers.active, 'orange')}</g>
      {image(layers.active, 'orange')}
    </g>
    {image(layers.finish, 'finish')}
  </g>;
}
