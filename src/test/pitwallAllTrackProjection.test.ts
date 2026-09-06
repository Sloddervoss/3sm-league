import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayeredTrackManifest } from '@/lib/layeredTrackMaps';
import { applySvgTransform, inferArrowDirection, orientProjectionPoints, parseSvgPointList, resolvePitwallTrackPath } from '@/lib/pitwallTrackGeometry';

const manifest = JSON.parse(readFileSync('public/tracks/layered/manifest.json', 'utf8')) as LayeredTrackManifest;

describe('Pitwall projection for the complete official track catalog', () => {
  it('accepts the observed Barcelona SDK identity with SimHub generic Full Course', () => {
    expect(resolvePitwallTrackPath('barcelona gp', 'Full Course', manifest)).toBe('/tracks/layered/track-345.svg');
    expect(resolvePitwallTrackPath('barcelona gp', 'National', manifest)).toBeNull();
    expect(resolvePitwallTrackPath('barcelona', 'Full Course', manifest)).toBeNull();
    const explicitLayout = { ...manifest, tracks: [...manifest.tracks, {
      trackId: 9999, name: 'Barcelona - Full Course', configName: 'Full Course',
      trackDirpath: 'barcelona\\full', path: '/tracks/layered/track-9999.svg',
    }] };
    expect(resolvePitwallTrackPath('barcelona gp', 'Full Course', explicitLayout)).toBeNull();
  });
  it('resolves every SDK directory and SimHub separator variant without guessing', () => {
    for (const entry of manifest.tracks) {
      expect(entry.trackDirpath).toBeTruthy();
      for (const name of [entry.trackDirpath!, entry.configNameShort!, entry.trackDirpath!.replace(/\\/g, ' ')]) {
        expect(resolvePitwallTrackPath(name, '', manifest), name).toBe(entry.path);
      }
      const parts = entry.trackDirpath!.split('\\');
      if (parts.length > 1) {
        const config = parts.pop()!;
        expect(resolvePitwallTrackPath(parts.join(' '), config, manifest), entry.name).toBe(entry.path);
        expect(resolvePitwallTrackPath(entry.trackDirpath!, config, manifest), entry.name).toBe(entry.path);
      }
    }
  });

  it('maps Watkins Glen fullcourse to Boot and rejects conflicting layouts', () => {
    expect(resolvePitwallTrackPath('watkinsglen 2021 fullcourse', '', manifest)).toBe('/tracks/layered/track-434.svg');
    expect(resolvePitwallTrackPath('watkinsglen 2021', 'fullcourse', manifest)).toBe('/tracks/layered/track-434.svg');
    expect(resolvePitwallTrackPath('watkinsglen 2021 fullcourse', 'Cup', manifest)).toBeNull();
    expect(resolvePitwallTrackPath('watkinsglen 2021', '', manifest)).toBeNull();
  });

  it('does not silently use another layout when explicit configuration disagrees', () => {
    const entry = manifest.tracks[0];
    expect(resolvePitwallTrackPath(entry.name, 'Nonexistent layout', manifest)).toBeNull();
  });

  it('finds the tip of both official chevron styles instead of choosing the wider half', () => {
    expect(inferArrowDirection(parseSvgPointList('1115.39 611.45 1043.88 594.95 1060.09 609.83 1043.03 623.73 1115.39 611.45'))?.x).toBeGreaterThan(0.9);
    expect(inferArrowDirection(parseSvgPointList('1163.22 601.6 1179.39 575.65 1089.79 624.35 1191.23 613.86 1163.22 601.6'))?.x).toBeLessThan(-0.8);
    expect(inferArrowDirection(parseSvgPointList('0 0 60 0 60 -20 100 10 60 40 60 20 0 20'))?.x).toBeGreaterThan(0.9);
  });
  it('resolves every official circuit/layout combination to its own SVG', () => {
    expect(manifest.count).toBe(424);
    for (const entry of manifest.tracks) {
      const escapedConfig = entry.configName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const circuit = entry.configName ? entry.name.replace(new RegExp(`\\s+-\\s+${escapedConfig}$`), '') : entry.name;
      expect(resolvePitwallTrackPath(circuit, entry.configName, manifest), entry.name).toBe(entry.path);
    }
  });

  it('finds the official active course and start/finish layers in all 424 SVGs', () => {
    for (const entry of manifest.tracks) {
      const svg = readFileSync(`public/tracks/layered/track-${entry.trackId}.svg`, 'utf8');
      expect(svg, `${entry.name}: active course`).toContain('filter="url(#activeColor)"');
      expect(svg, `${entry.name}: start/finish`).toContain('filter="url(#finishColor)"');
      expect(svg, `${entry.name}: embedded official geometry`).toContain('data:image/svg+xml;base64,');
    }
  }, 30_000);

  it('starts at the official line and follows the detected direction', () => {
    const contour = [
      { x: 0, y: 0 }, { x: -1, y: 0 }, { x: -2, y: 0 }, { x: -2, y: 1 },
      { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }, { x: 1, y: 0 },
    ];
    const oriented = orientProjectionPoints(contour, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(oriented[0]).toEqual({ x: 0, y: 0 });
    expect(oriented[1]).toEqual({ x: 1, y: 0 });
  });

  it('checks arrow direction at the arrow location, not at a distant start line', () => {
    const contour = parseSvgPointList('0 0 1 0 2 0 2 1 2 2 1 2 0 2 0 1');
    const oriented = orientProjectionPoints(contour, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 2 });
    expect(oriented[1]).toEqual({ x: 1, y: 0 });
  });

  it('reads both legacy comma-separated and current whitespace-separated SVG polygons', () => {
    expect(parseSvgPointList('1,2 3,4')).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(parseSvgPointList('1.5 2.5 3.5 4.5')).toEqual([{ x: 1.5, y: 2.5 }, { x: 3.5, y: 4.5 }]);
  });

  it('applies current rotated start-line transforms in official SVG order', () => {
    const [point] = applySvgTransform([{ x: 1, y: 0 }], 'translate(10 20) rotate(90)');
    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(21);
  });

  it('keeps a deterministic official contour order when a source has no direction arrow', () => {
    const contour = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }];
    expect(orientProjectionPoints(contour, { x: 4, y: 3 }, null)).toEqual([
      { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 3 },
    ]);
  });
});
