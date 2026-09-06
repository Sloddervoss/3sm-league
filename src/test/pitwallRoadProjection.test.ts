import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRoadProjection, ROAD_PROJECTION_IDS, validateRoadProjection } from '@/lib/pitwallRoadProjection';

const source = (id: number) => readFileSync(`public/tracks/layered/track-${id}.svg`, 'utf8');
const asset = (id: number) => JSON.parse(readFileSync(`public/tracks/projections/track-${id}.json`, 'utf8'));
const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

describe('reviewed road-only centerlines', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('covers exactly the 16 requested road exceptions and not the six deferred layouts', () => {
    expect(ROAD_PROJECTION_IDS).toEqual([145,146,168,173,175,176,202,207,209,211,215,216,239,242,244,319]);
    for (const id of [143,189,214,398,399,581]) expect(ROAD_PROJECTION_IDS).not.toContain(id);
  });

  for (const id of ROAD_PROJECTION_IDS) it(`validates source identity, start, turn order and continuity for ${id}`, () => {
    const data = asset(id);
    const points = validateRoadProjection(data, id, hash(source(id)));
    expect(points).toHaveLength(1024);
    expect(data.sourceRevision).toBe('b182cb7faeda236cce740530e52f3774364f3c0b');
    expect(Math.hypot(points![0].x - data.start.x, points![0].y - data.start.y)).toBeLessThan(20);
    const indices = ['1','2','3'].map(label => {
      const marker = data.turnMarkers.find((p: {label: string}) => p.label === label);
      expect(marker).toBeTruthy();
      return points!.reduce((best, p, i) => Math.hypot(p.x-marker.x, p.y-marker.y) < Math.hypot(points![best].x-marker.x, points![best].y-marker.y) ? i : best, 0);
    });
    expect(indices[0]).toBeGreaterThan(0);
    expect(indices[0]).toBeLessThan(indices[1]);
    expect(indices[1]).toBeLessThan(indices[2]);
  });

  it('rejects a different layout or changed source SVG', () => {
    expect(validateRoadProjection(asset(145), 146, hash(source(145)))).toBeNull();
    expect(validateRoadProjection(asset(145), 145, hash(source(145)+'changed'))).toBeNull();
  });

  it.each(['nan','out-of-bounds','jump','missing-point','direction','version'])('rejects corrupted data: %s', corruption => {
    const data = asset(145);
    if (corruption === 'nan') data.points[5][0] = NaN;
    if (corruption === 'out-of-bounds') data.points[5][0] = 1921;
    if (corruption === 'jump') data.points[5] = data.points[500];
    if (corruption === 'missing-point') data.points.pop();
    if (corruption === 'direction') data.directionSource = 'guessed';
    if (corruption === 'version') data.schemaVersion = 99;
    expect(validateRoadProjection(data, 145, hash(source(145)))).toBeNull();
  });

  it('loads the matching reviewed asset with the caller abort signal', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => asset(145) });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(await loadRoadProjection(145, source(145), signal)).toHaveLength(1024);
    expect(fetch).toHaveBeenCalledWith('/tracks/projections/track-145.json', { signal });
  });

  it('rejects missing assets instead of silently loading another circuit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadRoadProjection(145, source(145), new AbortController().signal)).rejects.toThrow('unavailable');
  });
});
