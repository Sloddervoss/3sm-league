import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { V3Normalized } from '../pitwallHelpers';
import { deriveStandings } from '../standings';
import { RaceTelemetryStrip } from '../RaceTelemetryStrip';
import { PremiumTimingPanel } from './PremiumTimingPanel';
import { PremiumMasthead } from './PremiumMasthead';
import { retainSectorLayout, useSectorLayoutCount, validSectorLayoutCount } from './useSectorLayout';

/** Synthetic, production-shaped PACE data. These tests do not claim live driving accuracy. */
const frame = (count = 3, sessionTime = 100): V3Normalized => ({
  transportSessionId: 'transport-a',
  identity: { trackId: 596, trackConfig: 'Full Course' },
  session: { sessionTimeSeconds: sessionTime },
  timing: { lastLapTimeSeconds: 90, bestLapTimeSeconds: 89 },
  opponents: [{ id: 'me', isPlayer: true, position: 1, lap: 10, lastLapSeconds: 90, bestLapSeconds: 89, driverName: 'Synthetic driver', carName: 'Synthetic car' }],
  paceHistory: {
    schemaRevision: 1, observedSessionId: 'synthetic-session', segmentId: 'synthetic-segment', transportSessionId: 'transport-a', updatedAt: new Date().toISOString(),
    cars: [{ id: 'me', laps: [], traces: [], metrics: {
      id: 'me', observedSessionTimeSeconds: 100, lastLapSeconds: 90, bestLapSeconds: 89, lapValid: true,
      bestLapSectorSeconds: null, bestSectorSeconds: null, bestLapDeltaToFieldBestSeconds: null,
      bestLapDeltaToPlayerSeconds: null, lapHighPrecision: null, trackPositionPercentRaw: null, sectorMismatchCount: 0,
      sectorCount: count, lastLapSectorSeconds: Array.from({ length: count }, () => 90 / count), sectorLap: 9,
    } }],
  },
});

const timing = (v3: V3Normalized, contextKey = 'device|transport-a|596', live = true) => <PremiumTimingPanel
  v3={v3} standings={deriveStandings(v3, 40)} ownCarLabel="Synthetic car" ownCarNumber="1"
  live={live} contextKey={contextKey} motionEnabled={false}
/>;

describe('premium sector layout — metadata stays, measurements do not', () => {
  it('reserves the same masthead fields while refresh and team metadata change', () => {
    const props = { deviceName: 'Synthetic device', trackLabel: 'Road America 2026', driverName: null, carName: null,
      teamName: null, connector: null, lastSeen: '1s', state: 'live' as const, sectorCount: 3, refreshing: false };
    const view = render(<PremiumMasthead {...props} />);
    expect(view.container.querySelectorAll('.ptp-meta > div')).toHaveLength(6);
    expect(view.container.querySelector<HTMLElement>('.ptp-meta-refresh')?.style.visibility).toBe('hidden');
    view.rerender(<PremiumMasthead {...props} refreshing teamName="Synthetic team" />);
    expect(view.container.querySelectorAll('.ptp-meta > div')).toHaveLength(6);
    expect(view.container.querySelector<HTMLElement>('.ptp-meta-refresh')?.style.visibility).toBe('visible');
  });

  it('keeps the normal shared KPI behavior unchanged without premium options', () => {
    render(<RaceTelemetryStrip v3={null} live={false} />);
    expect(screen.queryByText('S1')).toBeNull();
    expect(screen.queryByText('Δ laatste − beste')).toBeNull();
    expect(screen.queryByText('Verstreken sessie')).toBeNull();
    expect(screen.getByText('Sectorindeling onbekend')).toBeTruthy();
  });

  it('remembers a known layout through missing observations and rejects invalid sizes', () => {
    const state = { contextKey: 'a', count: 3 };
    expect(retainSectorLayout(state, 'a', 0)).toBe(state);
    expect(retainSectorLayout(state, 'a', 6)).toBe(state);
    expect(retainSectorLayout(state, 'b', 0)).toEqual({ contextKey: 'b', count: 0 });
    for (const value of [0, -1, 17, 1.5, NaN, Infinity, '3', null]) expect(validSectorLayoutCount(value)).toBe(0);
    expect(validSectorLayoutCount(16)).toBe(16);
  });

  it('the hook resets at a context boundary without one frame of old columns', () => {
    const { result, rerender } = renderHook(({ key, count }) => useSectorLayoutCount(key, count), { initialProps: { key: 'a', count: 6 } });
    expect(result.current).toBe(6);
    rerender({ key: 'a', count: 0 }); expect(result.current).toBe(6);
    rerender({ key: 'b', count: 0 }); expect(result.current).toBe(0);
    rerender({ key: 'b', count: 3 }); expect(result.current).toBe(3);
  });

  it('keeps S1..S3 and the validated result when metrics age out', () => {
    const view = render(timing(frame()));
    expect(screen.getByRole('columnheader', { name: 'S1' })).toBeTruthy();
    expect(view.container.querySelector('thead .ptp-col-sector')?.textContent).toBe('S1');
    expect(view.container.querySelector('tbody .ptp-col-sector')?.textContent).toBe('30.000R9');
    view.rerender(timing(frame(3, 107)));
    expect(screen.getByRole('columnheader', { name: 'S1' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'S3' })).toBeTruthy();
    expect(view.container.querySelector('tbody .ptp-col-sector')?.textContent).toBe('30.000R9');
    expect(view.container.querySelectorAll('colgroup col').length).toBe(12);
    // Een nieuwe context zonder eigen PACE begint zonder oude kolommen; een
    // frame dat nog de oude layout meedraagt, is geen bewijs voor de nieuwe.
    const otherContext = frame(3, 107);
    delete (otherContext as { paceHistory?: unknown }).paceHistory;
    view.rerender(timing(otherContext, 'other-device|transport-b|168'));
    expect(screen.queryByRole('columnheader', { name: 'S1' })).toBeNull();
  });

  it('keeps S1..S6 and dims the validated result when the live feed is missing', () => {
    const view = render(timing(frame(6)));
    expect(screen.getByRole('columnheader', { name: 'S6' })).toBeTruthy();
    view.rerender(timing(frame(6), 'device|transport-a|596', false));
    expect(screen.getByRole('columnheader', { name: 'S6' })).toBeTruthy();
    const cell = view.container.querySelector('tbody .ptp-col-sector') as HTMLElement;
    expect(cell.textContent).toBe('15.000R9');
    expect(cell.querySelector('[data-retained-stale="true"]')).not.toBeNull();
  });

  it('does not truncate a conflicting measurement into an old fixed layout', () => {
    const view = render(timing(frame()));
    view.rerender(timing(frame(6)));
    expect(screen.getByRole('columnheader', { name: 'S3' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'S6' })).toBeNull();
    expect(view.container.querySelector('tbody .ptp-col-sector')?.textContent).toBe('—');
    expect(view.container.textContent).not.toContain('15.000');
  });

  it('the KPI strip keeps the supplied layout with dimmed retained times and unknown clock', () => {
    const view = render(<RaceTelemetryStrip v3={frame()} live sectorCountOverride={3} stableLayout />);
    expect(screen.getByText('S3')).toBeTruthy();
    view.rerender(<RaceTelemetryStrip v3={null} live={false} sectorCountOverride={3} stableLayout />);
    expect(screen.getByText('S1')).toBeTruthy();
    expect(screen.getByText('S3')).toBeTruthy();
    expect(screen.getByText('Δ laatste − beste')).toBeTruthy();
    expect(screen.getByText('Verstreken sessie')).toBeTruthy();
    expect(view.container.textContent).toContain('30.000');
    expect(view.container.querySelector('[data-retained-stale="true"]')).not.toBeNull();
  });
});
