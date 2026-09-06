import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackProjection } from '@/features/endurance/pitwall/TrackProjection';
import { loadTrackProjection, type TrackProjectionGeometry } from '@/lib/pitwallTrackGeometry';

vi.mock('@/lib/pitwallTrackGeometry', () => ({ loadTrackProjection: vi.fn() }));
vi.mock('@/components/track-map/TrackMap', () => ({ TrackMap: () => <div>Static map</div> }));
const geometry: TrackProjectionGeometry = { mapPath: '/tracks/layered/track-127.svg', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], hasOfficialDirection: true, unavailableReason: null };
const props = { trackName: 'Road Atlanta', trackConfig: 'Full Course', live: true };

describe('Pitwall official track projection UI', () => {
  beforeEach(() => { vi.mocked(loadTrackProjection).mockReset().mockResolvedValue(geometry); });

  it('omits disconnected and invalid opponents and uses valid own-car fallback', async () => {
    const { container } = render(<TrackProjection {...props} v3={{ track: { lapDistancePct: 0.5 }, opponents: [
      { id: 'ok', lapDistancePct: 0.2 }, { id: 'gone', connected: false, lapDistancePct: 0.3 }, { id: 'bad', lapDistancePct: -1 },
    ] }} />);
    await waitFor(() => expect(container.querySelectorAll('circle')).toHaveLength(2));
  });

  it('does not draw an own car while outside the car', async () => {
    const { container } = render(<TrackProjection {...props} v3={{ session: { isInCar: false }, track: { lapDistancePct: 0.5 }, opponents: [{ id: 'own', isPlayer: true, lapDistancePct: 0.5 }] }} />);
    await screen.findByRole('img');
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('does not show stale markers offline', async () => {
    const { container } = render(<TrackProjection {...props} live={false} v3={{ track: { lapDistancePct: 0.5 }, opponents: [{ id: 'a', lapDistancePct: 0.1 }] }} />);
    await screen.findByRole('img');
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('shows the official map but no guessed coordinates without calibration', async () => {
    vi.mocked(loadTrackProjection).mockResolvedValue({ ...geometry, points: [], hasOfficialDirection: false, unavailableReason: 'Geen rijrichtingspijl.' });
    const { container } = render(<TrackProjection {...props} v3={{ track: { lapDistancePct: 0.5 } }} />);
    await screen.findByText(/Geen rijrichtingspijl/);
    expect(container.querySelector('image')).toHaveAttribute('href', geometry.mapPath);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('clears the previous map immediately when switching layout', async () => {
    const { rerender, container } = render(<TrackProjection {...props} v3={{ track: { lapDistancePct: 0.5 } }} />);
    await waitFor(() => expect(container.querySelectorAll('circle')).toHaveLength(1));
    vi.mocked(loadTrackProjection).mockReturnValue(new Promise(() => {}));
    rerender(<TrackProjection {...props} trackConfig="Short Course" v3={{ track: { lapDistancePct: 0.5 } }} />);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });
});
