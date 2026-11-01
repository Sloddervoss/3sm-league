import { useEffect, useState } from 'react';
import { TrackMap } from '@/components/track-map/TrackMap';
import { loadTrackProjection, type TrackProjectionGeometry } from '@/lib/pitwallTrackGeometry';
import type { V3Normalized } from './pitwallHelpers';
import { MovingTrackCar } from './MovingTrackCar';

export function TrackProjection({ trackName, trackConfig, v3, live }: { trackName: string; trackConfig: string; v3: V3Normalized | null; live: boolean }) {
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

  return <div><svg viewBox="0 0 1920 1080" className="h-60 w-full" role="img" aria-label={`${displayName || trackName} met schematische live autoposities`}>
    <image href={geometry.mapPath} width="1920" height="1080" />
    {geometry.points.length > 0 && cars.slice(0, 64).map(car => {
      const pct = car.lapDistancePct;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 1) return null;
      return <MovingTrackCar key={`${key}:${v3?.transportSessionId}:${car.id}`} car={car} points={geometry.points} capturedAt={v3?.capturedAt} />;
    })}
  </svg><p className="text-[10px] text-gray-500">{geometry.unavailableReason ? `${geometry.unavailableReason} Autoposities blijven zichtbaar op de rondevoortgangsbalk.` : 'Schematische projectie op de officiële layout op basis van rondeafstand. Pitauto’s blijven op de baanlijn; geen GPS- of pitboxpositie.'}</p></div>;
}
