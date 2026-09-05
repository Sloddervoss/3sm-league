import type { V3Normalized } from './pitwallHelpers';
import {PedalTrace} from './PedalTrace';

const value = (n: number | null | undefined, digits = 0) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—';
export function VehicleTelemetryPanel({ v3, live }: { v3: V3Normalized | null; live: boolean }) {
  const inCar = v3?.session?.isInCar !== false;
  const car = live && inCar ? v3?.vehicle : null;
  return <section data-pitwall-slot="tyres" className="rounded-xl border border-white/10 bg-black/40 p-4">
    <header className="flex justify-between gap-3"><h3 className="text-xs font-black uppercase tracking-widest text-gray-300">Auto & banden</h3><span className="text-[10px] text-amber-300">{!live ? 'Telemetrie offline' : !inCar ? 'Niet in de auto' : car ? 'Laatst beschikbare bandenmeting' : 'Niet aangeleverd'}</span></header>
    <div className="my-4 grid grid-cols-3 gap-2 font-mono"><div><small className="text-gray-500">SNELHEID</small><p className="text-xl text-white">{value(car?.speedKph)} <small className="text-xs">km/h</small></p></div><div><small className="text-gray-500">GEAR</small><p className="text-xl text-orange-300">{car?.gear ?? '—'}</p></div><div><small className="text-gray-500">RPM</small><p className="text-xl text-white">{value(car?.rpm)}</p></div></div>
    <div className="grid grid-cols-2 gap-2">{([['frontLeft','LV'],['frontRight','RV'],['rearLeft','LA'],['rearRight','RA']] as const).map(([key,label]) => {
      const tyre = car?.[key];
      return <div key={key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 font-mono"><div className="flex justify-between"><b className="text-gray-300">{label}</b><span className="text-orange-300">{value(tyre?.wearPercent)}%</span></div><p className="mt-2 text-sm text-gray-300">{car?.temperatureUnit ? `${value(tyre?.temperature,1)} °${car.temperatureUnit}` : '— temperatuur'}</p><p className="text-sm text-gray-400">{car?.pressureUnit ? `${value(tyre?.pressure,1)} ${car.pressureUnit}` : '— druk'}</p></div>;
    })}</div>
    <p className="mt-3 text-[10px] leading-relaxed text-gray-500">Bandenpercentage zoals gemeld door SimHub; geen berekende slijtage. De simulator kan deze metingen alleen bij een pitstop bijwerken. Een onbekende waarde blijft leeg.</p>
    <div className="mt-4 space-y-3">{([['throttlePct','GAS','bg-emerald-400'],['brakePct','REM','bg-red-400']] as const).map(([key,label,color]) => <div key={key}><div className="mb-1 flex justify-between text-[10px] font-bold text-gray-400"><span>{label}</span><span>{value(car?.[key])}%</span></div><div className="h-2 rounded bg-white/5"><div className={`h-full rounded ${color}`} style={{width:`${car?.[key] ?? 0}%`}} /></div></div>)}</div>
    <PedalTrace v3={v3} live={live && inCar}/>
    <p className="mt-2 text-[10px] text-gray-500">Relayfrequentie; geen high-frequency rijanalyse. Gaten worden niet opgevuld.</p>
  </section>;
}
