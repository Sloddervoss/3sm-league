import type { V3Normalized } from './pitwallHelpers';

const value = (n: number | null | undefined, digits = 0) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : null;
const amount = (n: number | null | undefined, digits = 0) => value(n, digits) ?? '—';

/** Kleur is betekenis: groen is gezond, oranje let op, rood is bijna op. */
const wearTone = (pct: number | null): string => {
  if (pct == null) return 'border-white/10 bg-white/[0.02] text-gray-400';
  if (pct >= 70) return 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300';
  if (pct >= 50) return 'border-amber-400/25 bg-amber-400/[0.07] text-amber-300';
  return 'border-red-400/30 bg-red-400/[0.08] text-red-300';
};

export function VehicleTelemetryPanel({ v3, live }: { v3: V3Normalized | null; live: boolean }) {
  const inCar = v3?.session?.isInCar !== false;
  const car = live && inCar ? v3?.vehicle : null;
  const status = !live ? 'Telemetrie offline' : !inCar ? 'Niet in de auto' : car ? 'Laatste meting' : 'Niet aangeleverd';

  const tyre = (key: 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight', label: string) => {
    const t = car?.[key];
    const pct = value(t?.wearPercent);
    const temp = value(t?.temperature, 1);
    const press = value(t?.pressure, 1);
    const detail = [
      temp != null && car?.temperatureUnit ? `${temp}°${car.temperatureUnit}` : null,
      press != null && car?.pressureUnit ? `${press} ${car.pressureUnit}` : null,
    ].filter(Boolean).join(' · ');
    return (
      <div className={`rounded-lg border px-2 py-1.5 font-mono ${wearTone(pct != null ? Number(pct) : null)}`}>
        <div className="flex items-baseline justify-between gap-1">
          <b className="text-[10px] tracking-wider opacity-80">{label}</b>
          <span className="text-base font-black leading-none">{pct != null ? `${pct}%` : '—'}</span>
        </div>
        {detail && <p className="mt-0.5 text-[9px] text-gray-500">{detail}</p>}
      </div>
    );
  };

  return (
    <section data-pitwall-slot="tyres" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Banden</h3>
        <span className="text-[10px] text-gray-500">{status}</span>
      </header>

      <p className="mt-1 font-mono text-[11px] text-gray-400">
        <span className="text-white">{amount(car?.speedKph)}</span> km/h
        <span className="mx-1.5 text-gray-600">·</span>
        <span className="text-orange-300">{car?.gear ?? '—'}</span>
        <span className="mx-1.5 text-gray-600">·</span>
        <span className="text-gray-300">{amount(car?.rpm)}</span> rpm
      </p>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div />
        {tyre('frontLeft', 'LV')}
        <div />
        {tyre('rearLeft', 'LA')}
        <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 text-center">
          <span className="text-[8px] uppercase tracking-widest text-gray-600">banden</span>
          <span className="font-heading text-[10px] font-black text-gray-400">SLICKS</span>
        </div>
        {tyre('rearRight', 'RA')}
        <div />
        {tyre('frontRight', 'RV')}
        <div />
      </div>
    </section>
  );
}
