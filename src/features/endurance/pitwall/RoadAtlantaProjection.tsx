import { useEffect, useState } from 'react';
import type { V3Normalized } from './pitwallHelpers';
import {loadRoadAtlantaProjection,type TrackProjectionPoint} from '@/lib/pitwallTrackGeometry';

/** Full Course only. Start line and downward direction come from track-127's
 * official start/finish SVG layer. Uses the outer outline: schematic, not GPS. */
export function RoadAtlantaProjection({ v3, live }: { v3: V3Normalized | null; live: boolean }) {
  const [points, setPoints] = useState<TrackProjectionPoint[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void loadRoadAtlantaProjection(controller.signal).then(sampled => {
      if (!controller.signal.aborted) setPoints(sampled);
    }).catch(() => { /* Static map remains available; never guess positions. */ });
    return () => controller.abort();
  }, []);
  const cars = live ? [...(v3?.opponents ?? [])].filter(c => c.connected !== false) : [];
  if (live && !cars.some(c=>c.isPlayer) && v3?.track?.lapDistancePct != null) cars.push({id:'own',isPlayer:true,lapDistancePct:v3.track.lapDistancePct,carNumber:'JIJ'});
  return <div><svg viewBox="0 0 1920 1080" className="h-60 w-full" role="img" aria-label="Road Atlanta Full Course met schematische live autoposities">
    <image href="/tracks/layered/track-127.svg" width="1920" height="1080" />
    {points.length > 0 && cars.slice(0,64).map(car => {
      const pct=car.lapDistancePct;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 1) return null;
      const p=points[Math.floor(pct*points.length)%points.length];
      return <g key={car.id} transform={`translate(${p.x} ${p.y})`}><title>{car.driverName ?? car.carNumber ?? car.id}{car.inPit ? ' · PIT (baanprojectie)' : ''}</title><circle r={car.isPlayer?32:25} fill={car.isPlayer?'#fb923c':car.inPit?'#fbbf24':'#38bdf8'} stroke="#101418" strokeWidth="7"/><text textAnchor="middle" dominantBaseline="central" fill="#07111a" fontSize="23" fontWeight="900">{car.carNumber ?? '·'}</text></g>;
    })}
  </svg><p className="text-[10px] text-gray-500">{points.length ? 'Schematische baanprojectie op basis van rondeafstand. Pitauto’s blijven op de baanlijn; geen exacte GPS- of pitboxpositie.' : 'Kaart laden; autoplaatsing wacht op geldige baangeometrie.'}</p></div>;
}
