import { Thermometer, Droplets } from 'lucide-react';
import { finiteNonNegative } from './elementPresentation';
import type { V3Normalized } from './pitwallHelpers';
import { TrackProjection } from './TrackProjection';
import { PitwallPanel } from './PitwallPanel';

/** Circuitkaart met bestaande projectie, meetwaarden en rondebalkfallback. */
export function LiveTrackPanel({ v3, live, fallbackTrack }: { v3: V3Normalized | null; live: boolean; fallbackTrack: string }) {
  const track = v3?.identity?.trackName || fallbackTrack;
  const config = v3?.identity?.trackConfig ?? '';
  const environment = live ? v3?.environment : null;
  const tyreEnvironment = live ? v3?.tyres?.environment : null;
  const rawWetness = live ? (v3?.weather?.trackWetnessPct ?? v3?.environment?.trackWetnessPct) : null;
  const wetness = finiteNonNegative(rawWetness) && rawWetness <= 100 ? rawWetness : null;
  const raining = live && typeof v3?.weather?.isRaining === "boolean" ? v3.weather.isRaining : null;
  const temperature = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n >= -40 && n <= 100 ? n.toFixed(1) : null;
  const trackTemp = temperature(environment?.trackTempC ?? tyreEnvironment?.trackTempC);
  const airTemp = temperature(environment?.airTempC ?? tyreEnvironment?.airTempC);
  const rubber = environment?.rubberState ?? tyreEnvironment?.rubberState;
  const cars = live ? (v3?.opponents ?? []).filter(car => car.connected !== false && typeof car.lapDistancePct === 'number' && Number.isFinite(car.lapDistancePct) && car.lapDistancePct >= 0 && car.lapDistancePct <= 1).slice(0,64) : [];

  return (
    <PitwallPanel title="Circuit" slot="trackmap" meta={live ? <span className="text-emerald-300">Live data</span> : 'Offline'}>
      <p className="mb-1 truncate font-heading text-[15px] font-bold text-white">{track || 'Wacht op circuit'}</p>
      <TrackProjection trackName={track} trackConfig={config} v3={v3} live={live} />
      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-300">
        <span className="text-slate-500">{cars.length ? `${cars.length} auto's met positie.` : "Wacht op autoposities."}</span>
        {(trackTemp != null || airTemp != null || rubber || wetness != null || raining != null) && (
          <span className="contents" data-pitwall-environment="true">
            {trackTemp != null && <span>Baan {trackTemp} °C</span>}
            {airTemp != null && <span className="inline-flex items-center gap-1"><Thermometer size={12} aria-hidden />Lucht {airTemp} °C</span>}
            {rubber && <span>Rubber: {rubber}</span>}
            {wetness != null && <span className="inline-flex items-center gap-1"><Droplets size={12} aria-hidden />{wetness === 0 ? 'Baan droog (0%)' : `Baanvocht ${wetness.toFixed(0)}%`}</span>}
            {raining != null && <span>{raining ? 'Regen gemeld' : 'Geen regen gemeld'}</span>}
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
