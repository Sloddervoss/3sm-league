import { readFileSync } from 'node:fs';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackProjection } from '../TrackProjection';
import { LiveTrackPanel } from '../LiveTrackPanel';
import type { V3Normalized } from '../pitwallHelpers';
import { loadTrackProjection, type TrackProjectionGeometry } from '@/lib/pitwallTrackGeometry';
import { PremiumCircuitPanel } from './PremiumCircuitPanel';

vi.mock('@/lib/pitwallTrackGeometry', () => ({ loadTrackProjection: vi.fn() }));

/**
 * De officiële Nordschleife-lijn is bijna vierkant (1271 × 1001 in het
 * 1920×1080-bronframe). Deze fixture houdt die verhouding vast, zodat een
 * compacte GP-layout nooit als Nordschleife doorgaat.
 */
const nordschleife: TrackProjectionGeometry = {
  mapPath: '/tracks/layered/track-249.svg',
  points: [
    { x: 415, y: 20 },
    { x: 1686, y: 20 },
    { x: 1686, y: 1021 },
    { x: 415, y: 1021 },
  ],
  hasOfficialDirection: true,
  unavailableReason: null,
};

const v3: V3Normalized = {
  identity: { trackName: 'Nürburgring Nordschleife', trackConfig: 'Industriefahrten' },
  opponents: [
    { id: '36', carNumber: '36', lapDistancePct: 0 },
    { id: '57', carNumber: '57', lapDistancePct: 0.5 },
    { id: 'own', carNumber: 'JIJ', isPlayer: true, lapDistancePct: 1 },
  ],
};

const renderPremium = (live = true) =>
  render(
    <PremiumCircuitPanel
      v3={v3}
      live={live}
      fallbackTrack="Nürburgring Nordschleife"
    />,
  );

beforeEach(() => {
  vi.mocked(loadTrackProjection).mockReset().mockResolvedValue(nordschleife);
});

describe('PremiumCircuitPanel — officiële geometrie en verhouding', () => {
  it('gebruikt de officiële Nordschleife-layout en nooit een compacte fallback', async () => {
    const { container } = renderPremium(false);

    await screen.findByRole('img');
    expect(loadTrackProjection).toHaveBeenCalledWith(
      'Nürburgring Nordschleife',
      'Industriefahrten',
      expect.any(AbortSignal),
      undefined,
    );
    expect(container.querySelector('image')).toHaveAttribute('href', nordschleife.mapPath);
  });

  it('geeft de premiumkaart de echte baangeometrieverhouding en geen vaste 16:9-box', async () => {
    renderPremium(false);
    const svg = await screen.findByRole('img');

    expect(svg).toHaveAttribute('data-track-presentation', 'premium');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
    expect(svg.getAttribute('class')).not.toContain('h-60');

    const [x, y, width, height] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    expect([x, y, width, height].every(Number.isFinite)).toBe(true);
    // 1271 × 1001 plus 8% marge rond de grootste zijde.
    const pad = Math.max(1271, 1001) * 0.08;
    expect(width).toBeCloseTo(1271 + pad * 2, 1);
    expect(height).toBeCloseTo(1001 + pad * 2, 1);
    expect(width / height).toBeGreaterThan(1.1);
    expect(width / height).toBeLessThan(1.35);
  });

  it('houdt markers in verhouding tot de getekende baan', async () => {
    const { container } = renderPremium(true);
    await waitFor(() =>
      expect(container.querySelectorAll('svg[data-track-presentation="premium"] circle')).toHaveLength(3),
    );

    const svg = container.querySelector('svg[data-track-presentation="premium"]');
    const height = Number((svg?.getAttribute('viewBox') ?? '').split(/\s+/)[3]);
    const radii = [...(svg?.querySelectorAll('circle') ?? [])].map((circle) => Number(circle.getAttribute('r')));

    expect(radii).toEqual(expect.arrayContaining([25, 32]));
    for (const radius of radii) {
      expect(radius / height).toBeLessThan(0.03);
      expect(radius).toBeGreaterThan(0);
    }
  });
});

describe('PremiumCircuitPanel — rondebalk en eerlijke toelichting', () => {
  it('houdt badges op 0% en 100% binnen de eigen baan met marge', async () => {
    const { container } = renderPremium(true);
    const bar = await waitFor(() => {
      const node = container.querySelector<HTMLElement>('[data-ptp-lap-bar]');
      expect(node).not.toBeNull();
      return node!;
    });

    expect(bar).toHaveAttribute('aria-label', 'Live rondeposities');
    const badge = within(bar).getByText('36');
    expect(badge).toHaveAttribute('data-ptp-lap-badge', 'true');
    expect(badge.style.left).toBe('0%');
    expect(within(bar).getByText('JIJ').style.left).toBe('100%');

    const css = readFileSync(
      'src/features/endurance/pitwall/test-premium/PremiumCircuitPanel.css',
      'utf8',
    );
    expect(css).toMatch(/\[data-ptp-lap-bar\][^{]*\{[^}]*margin-inline:\s*20px/s);
    expect(css).toMatch(/\[data-ptp-lap-badge\][^{]*\{[^}]*min-width:\s*28px/s);
    expect(css).not.toMatch(/[^-]height:\s*160px/);
  });

  it('toont geen verzonnen GPS- of bochtlabels', async () => {
    renderPremium(false);
    await screen.findByRole('img');

    expect(screen.getByText(/Schematische projectie/)).toHaveTextContent(
      'geen GPS- of pitboxpositie',
    );
    expect(screen.queryByText(/bocht\s*\d+/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GPS\s*(actief|positie)/i)).not.toBeInTheDocument();
  });

  it('schaalt de kaart via breedte en intrinsieke verhouding, niet met een vaste hoogte', () => {
    const css = readFileSync(
      'src/features/endurance/pitwall/test-premium/PremiumCircuitPanel.css',
      'utf8',
    );
    expect(css).toMatch(/\[data-track-presentation="premium"\][^{]*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\[data-track-presentation="premium"\][^{]*\{[^}]*height:\s*auto/s);
    expect(css).toMatch(/max-height:/);
  });
});

describe('TrackProjection — standaardweergave blijft exact', () => {
  it('houdt de klassieke/endurance-klasse en attributen ongewijzigd', async () => {
    const { container } = render(
      <TrackProjection
        trackName="Nürburgring Nordschleife"
        trackConfig="Industriefahrten"
        v3={v3}
        live={false}
      />,
    );

    const svg = await screen.findByRole('img');
    expect(svg.getAttribute('class')).toBe('h-60 w-full');
    expect(svg).not.toHaveAttribute('data-track-presentation');
    expect(svg).not.toHaveAttribute('preserveAspectRatio');
    expect(container.querySelector('image')).toHaveAttribute('href', nordschleife.mapPath);
  });

  it('laat de klassieke/endurance LiveTrackPanel zonder premiumkenmerk', async () => {
    const { container } = render(
      <LiveTrackPanel
        v3={v3}
        live={false}
        fallbackTrack="Nürburgring Nordschleife"
      />,
    );

    await screen.findByRole('img');
    expect(container.querySelector('.ptp-circuit-panel')).toBeNull();
    expect(container.querySelector('[data-track-presentation]')).toBeNull();
    expect(container.querySelector('svg[role="img"]')).toHaveAttribute('class', 'h-60 w-full');
  });
});
