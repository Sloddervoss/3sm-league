import type { V3Normalized } from './pitwallHelpers';
import { TrackProjection } from './TrackProjection';
import { PitwallPanel } from './PitwallPanel';

/**
 * Circuit en eigen auto.
 *
 * Alles aan de kaart is ongewijzigd: dezelfde TrackProjection, dezelfde
 * markers, dezelfde projectie. Alleen het kader, de kop en de ruimte eromheen
 * zijn van deze look.
 */
export function LiveTrackPanel({ v3, live, fallbackTrack }: { v3: V3Normalized | null; live: boolean; fallbackTrack: string }) {
  const track = v3?.identity?.trackName || fallbackTrack;
  const config = v3?.identity?.trackConfig ?? '';
  const environment = live ? v3?.tyres?.environment : null;
  const temperature = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n >= -40 && n <= 100 ? n.toFixed(1) : null;
  const trackTemp = temperature(environment?.trackTempC);
  const airTemp = temperature(environment?.airTempC);
  const rubber = environment?.rubberState;
  const cars = live ? (v3?.opponents ?? []).filter(car => car.connected !== false && typeof car.lapDistancePct === 'number' && Number.isFinite(car.lapDistancePct) && car.lapDistancePct >= 0 && car.lapDistancePct <= 1).slice(0,64) : [];

  return (
    <PitwallPanel title="Circuit" slot="trackmap" meta={live ? <span className="text-emerald-300">Live data</span> : 'Offline'}>
      <p className="mb-1 truncate font-heading text-[15px] font-bold text-white">{track || 'Wacht op circuit'}</p>
      <TrackProjection trackName={track} trackConfig={config} v3={v3} live={live} />
      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-300">
        <span className="text-slate-500">{cars.length ? `${cars.length} auto's met positie.` : "Wacht op autoposities."}</span>
        {(trackTemp != null || airTemp != null || rubber) && (
          <span className="contents" data-pitwall-environment="true">
            {trackTemp != null && <span>Baan {trackTemp} °C</span>}
            {airTemp != null && <span>Lucht {airTemp} °C</span>}
            {rubber && <span>Rubber: {rubber}</span>}
          </span>
        )}
      </div>
      <div className="mb-2 mt-2 flex justify-between text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <span>Start / finish</span>
        <span>Rondevoortgang</span>
        <span>100%</span>
      </div>
      <div className="relative mx-3 mb-8 h-1 rounded bg-white/15" aria-label="Live rondeposities">
        {cars.map(car => (
          <span
            key={car.id}
            title={`${car.driverName ?? car.id}: ${(car.lapDistancePct! * 100).toFixed(1)}%${car.inPit ? ' · PIT' : ''}`}
            className={`absolute -top-2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded px-1 text-[9px] font-black ${
              car.isPlayer ? 'bg-orange-400 text-black' : car.inPit ? 'bg-amber-300 text-black' : 'bg-sky-900 text-sky-100'
            }`}
            style={{ left: `${car.lapDistancePct! * 100}%` }}
          >
            {car.carNumber ?? '·'}
          </span>
        ))}
      </div>
    </PitwallPanel>
  );
}
