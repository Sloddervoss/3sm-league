import type { V3Normalized } from './pitwallHelpers';
import { TrackProjection } from './TrackProjection';

export function LiveTrackPanel({ v3, live, fallbackTrack }: { v3: V3Normalized | null; live: boolean; fallbackTrack: string }) {
  const track = v3?.identity?.trackName || fallbackTrack;
  const config = v3?.identity?.trackConfig ?? '';
  const cars = live ? (v3?.opponents ?? []).filter(car => car.connected !== false && typeof car.lapDistancePct === 'number' && Number.isFinite(car.lapDistancePct) && car.lapDistancePct >= 0 && car.lapDistancePct <= 1).slice(0,64) : [];
  return <section data-pitwall-slot="trackmap" className="rounded-xl border border-white/10 bg-black/40 p-4">
    <header className="flex items-center justify-between"><div><h3 className="text-xs font-black uppercase tracking-widest text-gray-300">Circuit</h3><p className="mt-1 text-sm font-bold text-white">{track || 'Wacht op circuit'}</p></div><span className={`text-[10px] font-bold ${live ? 'text-emerald-400' : 'text-gray-500'}`}>{live ? 'LIVE DATA' : 'OFFLINE'}</span></header>
    <TrackProjection trackName={track} trackConfig={config} v3={v3} live={live} />
    <div className="mb-2 flex justify-between text-[9px] uppercase tracking-wider text-gray-500"><span>Start / finish</span><span>Rondevoortgang</span><span>100%</span></div>
    <div className="relative mx-3 mb-8 h-1 rounded bg-white/15" aria-label="Live rondeposities">{cars.map(car => <span key={car.id} title={`${car.driverName ?? car.id}: ${(car.lapDistancePct! * 100).toFixed(1)}%${car.inPit ? ' · PIT' : ''}`} className={`absolute -top-2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded px-1 text-[8px] font-black ${car.isPlayer ? 'bg-orange-400 text-black' : car.inPit ? 'bg-amber-300 text-black' : 'bg-sky-900 text-sky-100'}`} style={{left:`${car.lapDistancePct! * 100}%`}}>{car.carNumber ?? '·'}</span>)}</div>
    <p className="text-[10px] text-gray-500">{cars.length ? `${cars.length} auto’s met positie.` : 'Wacht op autoposities.'}</p>
  </section>;
}
