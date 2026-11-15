import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLayeredTrackManifest, type LayeredTrackManifest } from '@/lib/layeredTrackMaps';
import { resolvePitwallTrackPath } from '@/lib/pitwallTrackGeometry';

const manifest = JSON.parse(readFileSync('public/tracks/layered/manifest.json', 'utf8')) as LayeredTrackManifest;
const mapPath = 'public/tracks/layered/track-596.svg';

// SHA-256 of the five layer SVGs published by iRacing for TrackID 596
// (tracks_roadamerica/596-roadamerica-2026-full). The 2026 publication is
// byte-identical to the legacy Full Course layers, but this asset is generated
// from the 596 source folder, not aliased to TrackID 18.
const officialLayerHashes = [
  'cce4240f9fe5a5ede0223f15040a489b856931088056a2839134bc27142d4abc', // background
  '984841c04142ec82f028bf4e930b1124eeb7f8f71604362fcc3cc7a2537a9193', // inactive
  '390d2699222cf98e26aff2236e16a5833f4bb485d6f6c2def62385f6a5f691b3', // pitroad
  'c961edb5f87a80aaa33bade7e3798475355373168ef7319561e6148c354dd379', // active
  '65dd28e5e7155dab7a7c97012630b693392ec5888f77f176577c13443192d82f', // start-finish
];

describe('Road America 2026 TrackID 596 layered map', () => {
  it('is the only exact 596 catalog entry and resolves from the live SDK identity', () => {
    expect(manifest.count).toBe(425);
    expect(manifest.count).toBe(manifest.tracks.length);
    expect(isLayeredTrackManifest(manifest)).toBe(true);
    expect(manifest.tracks.filter(entry => entry.trackId === 596)).toEqual([{
      trackId: 596,
      name: 'Road America 2026 - Full Course',
      configName: 'Full Course',
      path: '/tracks/layered/track-596.svg',
      trackDirpath: 'roadamerica\\2026\\full',
      configNameShort: 'roadamerica-2026-full',
    }]);
    expect(resolvePitwallTrackPath('roadamerica 2026 full', 'Full Course', manifest, 596))
      .toBe('/tracks/layered/track-596.svg');
    expect(resolvePitwallTrackPath('roadamerica 2026 full', 'Full Course', manifest))
      .toBe('/tracks/layered/track-596.svg');
  });

  it('embeds the five official 596 layers with the official course geometry', () => {
    const svg = readFileSync(mapPath, 'utf8');
    expect(svg).toContain('<metadata>3SM layered track map; iRacing TrackID 596</metadata>');

    const layers = [...svg.matchAll(/href="data:image\/svg\+xml;base64,([^"]+)"/g)]
      .map(match => Buffer.from(match[1], 'base64').toString('utf8'));
    const hashes = layers.map(layer => createHash('sha256').update(layer).digest('hex'));
    expect(new Set(hashes)).toEqual(new Set(officialLayerHashes));

    for (const layer of layers) {
      expect(layer).toContain('viewBox="0 0 1920 1080"');
      expect(layer).toContain('<path');
    }
    expect(layers.some(layer => layer.includes('id="Full_-_Config"'))).toBe(true);
    expect(layers.some(layer => layer.includes('id="Full_-_Start_Finish_Line"'))).toBe(true);
  });
});
