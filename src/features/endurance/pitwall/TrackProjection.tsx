import { useEffect, useState } from 'react';
import { TrackMap } from '@/components/track-map/TrackMap';
import { loadTrackProjection, type TrackProjectionGeometry } from '@/lib/pitwallTrackGeometry';
import type { V3Normalized } from './pitwallHelpers';
import { MovingTrackCar } from './MovingTrackCar';

export type TrackProjectionPresentation = 'default' | 'premium';

/**
 * `premium` is een expliciete opt-in voor de pitwall-testkaart. De standaard
 * (endurance en klassiek) houdt exact dezelfde markup, klasse en viewBox.
 * Beide standen gebruiken dezelfde officiële geometrie en puntprojectie.
 */
export function TrackProjection({ trackName, trackConfig, v3, live, presentation = 'default' }: { trackName: string; trackConfig: string; v3: V3Normalized | null; live: boolean; presentation?: TrackProjectionPresentation }) {
  const premium = presentation === 'premium';
  const [geometry, setGeometry] = useState<TrackProjectionGeometry | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [failed, setFailed] = useState(false);
  const trackId = v3?.identity?.trackId;
  const key = JSON.stringify([trackId, trackName, trackConfig]);
  const displayName = trackName.toLowerCase().endsWith(trackConfig.toLowerCase()) ? trackName : [trackName, trackConfig].filter(Boolean).join(' - ');
  useEffect(() => {
    const controller = new AbortController();
    setGeometry(null); setFailed(false);
    void loadTrackProjection(trackName, trackConfig, controller.signal, trackId).then(result => {
      if (!controller.signal.aborted) { setGeometry(result); setLoadedKey(key); setFailed(result === null); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [trackId, trackName, trackConfig, key]);

  const cars = live ? [...(v3?.opponents ?? [])].filter(car => car.connected !== false && !(car.isPlayer && v3?.session?.isInCar === false)) : [];
  if (live && v3?.session?.isInCar !== false && !cars.some(car => car.isPlayer) && v3?.track?.lapDistancePct != null) cars.push({ id: 'own', isPlayer: true, lapDistancePct: v3.track.lapDistancePct, carNumber: 'JIJ' });
  if (!geometry || loadedKey !== key) return <div>{trackId == null && <TrackMap track={displayName || trackName} className="h-60 w-full object-contain" />}<p className="text-[10px] text-gray-500">{failed ? `Officiële baangeometrie niet beschikbaar${trackId != null ? ` voor TrackID ${trackId}` : ''}; rondevoortgang blijft zichtbaar.` : 'Officiële baangeometrie laden…'}</p></div>;

  // Zelfde kaart en dezelfde laagopbouw, maar ingeknipt op de baandomvang zodat
  // het circuit het paneel vult en de auto's ruimte hebben. De afbeelding blijft
  // op 1920×1080 staan, dus de projectie en de markers schuiven mee.
  const viewBox = (() => {
    const pts = geometry.points;
    if (pts.length < 2) return '0 0 1920 1080';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    if (!(w > 0) || !(h > 0)) return '0 0 1920 1080';
    const pad = Math.max(w, h) * 0.08;
    return `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(w + pad * 2).toFixed(1)} ${(h + pad * 2).toFixed(1)}`;
  })();
  return <div><svg
    viewBox={viewBox}
    className={premium ? 'ptp-circuit-map' : 'h-60 w-full'}
    preserveAspectRatio={premium ? 'xMidYMid meet' : undefined}
    data-track-presentation={premium ? 'premium' : undefined}
    role="img"
    aria-label={`${displayName || trackName} met schematische live autoposities`}
  >
    <image href={geometry.mapPath} width="1920" height="1080" />
    {geometry.points.length > 0 && cars.slice(0, 64).map(car => {
      const pct = car.lapDistancePct;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 1) return null;
      return <MovingTrackCar key={`${key}:${v3?.transportSessionId}:${car.id}`} car={car} points={geometry.points} capturedAt={v3?.capturedAt} />;
    })}
  </svg><p className="text-[10px] text-gray-500">{geometry.unavailableReason ? `${geometry.unavailableReason} Autoposities blijven zichtbaar op de rondevoortgangsbalk.` : 'Schematische projectie op de officiële layout op basis van rondeafstand. Pitauto’s blijven op de baanlijn; geen GPS- of pitboxpositie.'}</p></div>;
}
