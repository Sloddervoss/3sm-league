import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackArtwork } from '@/features/endurance/pitwall/TrackArtwork';
import { readTrackArtwork } from '@/lib/pitwallTrackArtwork';
import { trackProgressPoints } from '@/features/endurance/pitwall/trackArtworkPresentation';

const source = readFileSync('public/tracks/layered/track-163.svg', 'utf8');
const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
afterEach(() => vi.unstubAllGlobals());

describe('pitwall circuit artwork', () => {
  it('reuses the exact source layers, excluding inactive configurations and unmasked glow', () => {
    const layers = readTrackArtwork(source)!;
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
    expect(layers.background).toBe(svg.querySelector('image[filter="url(#backgroundColor)"]')!.getAttribute('href'));
    expect(layers.active).toBe(svg.querySelector('image[filter="url(#activeColor)"]')!.getAttribute('href'));
    expect(layers.finish).toBe(svg.querySelector('image[filter="url(#finishColor)"]')!.getAttribute('href'));
    expect(Object.keys(layers).sort()).toEqual(['active', 'background', 'finish']);
    expect(readTrackArtwork('<svg/>')).toBeNull();
  });

  it('reads named source layers without copying other configurations', () => {
    const layers = readTrackArtwork(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><style>.road{fill:white}</style><g data-name="Background Details"><path id="background"/></g><g data-name="Inactive Configs"><path id="other"/></g><g data-name="Spa - config"><path class="road" id="selected"/></g><g data-name="Spa - Start Finish Line"><path id="finish"/></g></svg>`)!;
    expect(layers).not.toBeNull();
    const decode = (uri: string) => atob(uri.split(',')[1]);
    expect(decode(layers.active)).toContain('id="selected"');
    expect(decode(layers.active)).toContain('.road{fill:white}');
    expect(decode(layers.active)).not.toContain('id="other"');
    expect(decode(layers.background!)).toContain('id="background"');
    expect(decode(layers.finish)).toContain('id="finish"');
  });

  it('reveals the ordered path up to exactly the same interpolated point as the car', () => {
    expect(trackProgressPoints(points, .375)).toBe('0,0 100,0 100,50');
    expect(trackProgressPoints(points, 1)).toBe('0,0 100,0 100,100 0,100 0,0');
    for (const pct of [0, -1, 1.1, NaN, Infinity, null, undefined]) expect(trackProgressPoints(points, pct)).toBe('');
    expect(trackProgressPoints([], .5)).toBe('');
  });

  it('renders dim base, masked orange and glow, source background and finish, no inactive layouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => source }));
    const ref = createRef<SVGPolylineElement>();
    const { container, rerender } = render(<svg><TrackArtwork mapPath="/track.svg" progressMask={ref} progressPoints="0,0 100,0" /></svg>);
    await waitFor(() => expect(container.querySelector('[data-pitwall-track-artwork]')).not.toBeNull());
    expect(ref.current).toHaveAttribute('points', '0,0 100,0');
    expect(container.querySelectorAll('[data-pitwall-track-progress] image')).toHaveLength(2);
    expect(container.querySelectorAll('image[filter$="-finish)"]')).toHaveLength(1);
    expect(container.querySelectorAll('text, pattern, line')).toHaveLength(0);
    expect(container.querySelectorAll('image')).toHaveLength(5);
    const layers = readTrackArtwork(source)!;
    const hrefs = [...container.querySelectorAll('image')].map(image => image.getAttribute('href'));
    const asset = new DOMParser().parseFromString(source, 'image/svg+xml');
    for (const inactive of asset.querySelectorAll('image[filter="url(#inactiveColor)"]')) expect(hrefs).not.toContain(inactive.getAttribute('href'));
    expect(container.querySelector('[data-pitwall-track-background] image')).toHaveAttribute('href', layers.background);
    expect(container.querySelector('[data-pitwall-track-progress]')).toHaveAttribute('mask');
    expect(container.querySelector('mask')).toHaveAttribute('maskContentUnits', 'userSpaceOnUse');
    rerender(<svg><TrackArtwork mapPath="/track.svg" progressMask={ref} progressPoints="" /></svg>);
    expect(ref.current).toHaveAttribute('points', '');
  });

  it('retains the full-asset fallback on fetch failure or missing layers', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, text: async () => '<svg/>' });
    vi.stubGlobal('fetch', fetch);
    const ref = createRef<SVGPolylineElement>();
    const { container, rerender } = render(<svg><TrackArtwork mapPath="/failed.svg" progressMask={ref} progressPoints="" /></svg>);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(container.querySelector('image')).toHaveAttribute('href', '/failed.svg');
    rerender(<svg><TrackArtwork mapPath="/empty.svg" progressMask={ref} progressPoints="" /></svg>);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(container.querySelector('image')).toHaveAttribute('href', '/empty.svg');
  });

  it('does not show previous artwork while a different layout loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, text: async () => source }).mockReturnValueOnce(new Promise(() => {})));
    const ref = createRef<SVGPolylineElement>();
    const { container, rerender } = render(<svg><TrackArtwork mapPath="/first.svg" progressMask={ref} progressPoints="" /></svg>);
    await waitFor(() => expect(container.querySelector('[data-pitwall-track-artwork]')).not.toBeNull());
    rerender(<svg><TrackArtwork mapPath="/second.svg" progressMask={ref} progressPoints="" /></svg>);
    expect(container.querySelector('[data-pitwall-track-artwork]')).toBeNull();
    expect(container.querySelector('image')).toHaveAttribute('href', '/second.svg');
  });
});
