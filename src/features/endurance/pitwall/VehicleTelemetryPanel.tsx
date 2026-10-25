import type { V3Normalized } from './pitwallHelpers';
import type { TyreEstimate } from './strategy/tyreGrade';
import { TyreAdviceLine } from './TyreAdviceLine';

const value = (n: number | null | undefined, digits = 0) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : null;
const amount = (n: number | null | undefined, digits = 0) => value(n, digits) ?? '—';

/** Kleur is betekenis: groen is gezond, oranje let op, rood is bijna op. */
const wearTone = (pct: number | null): string => {
  if (pct == null) return 'border-white/10 bg-white/[0.02] text-gray-400';
  if (pct >= 70) return 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300';
  if (pct >= 50) return 'border-amber-400/25 bg-amber-400/[0.07] text-amber-300';
  return 'border-red-400/30 bg-red-400/[0.08] text-red-300';
};

/**
 * De vier hoeken met hun stand.
 *
 * `tyreEstimate` is optioneel: is het er, dan staat onder de hoekgrid de ene
 * regel die bij de graad hoort (puntgetal, getal met marge, bereik of oorzaak).
 * Is het er niet, dan blijft de oude voetnoot staan — die is waar, maar zegt
 * niets over de beslissing.
 */
export function VehicleTelemetryPanel({
  v3,
  live,
  tyreEstimate,
}: {
  v3: V3Normalized | null;
  live: boolean;
  tyreEstimate?: TyreEstimate | null;
}) {
  const inCar = v3?.session?.isInCar !== false;
  const car = live && inCar ? v3?.vehicle : null;
  const status = !live ? 'Telemetrie offline' : !inCar ? 'Niet in de auto' : car ? 'Laatst beschikbare bandenmeting' : 'Niet aangeleverd';

  const tyre = (key: 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight', label: string) => {
    const t = car?.[key];
    const pct = value(t?.wearPercent);
    const temp = value(t?.temperature, 1);
    const press = value(t?.pressure, 1);
    const hasTemp = temp != null && Boolean(car?.temperatureUnit);
    const hasPress = press != null && Boolean(car?.pressureUnit);
    return (
      <div className={`rounded-lg border px-2 py-1.5 font-mono ${wearTone(pct != null ? Number(pct) : null)}`}>
        <div className="flex items-baseline justify-between gap-1">
          <b className="text-[10px] tracking-wider opacity-80">{label}</b>
          <span className="text-base font-black leading-none">{pct != null ? `${pct}%` : '—'}</span>
        </div>
        {(hasTemp || hasPress) && (
          <p className="mt-0.5 flex gap-1 text-[9px] text-gray-500">
            {hasTemp && <span>{temp} °{car?.temperatureUnit}</span>}
            {hasPress && <span>{press} {car?.pressureUnit}</span>}
          </p>
        )}
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

      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[8px] uppercase tracking-widest text-gray-600">voor</span>
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            {tyre('frontLeft', 'LV')}
            {tyre('frontRight', 'RV')}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[8px] uppercase tracking-widest text-gray-600">achter</span>
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            {tyre('rearLeft', 'LA')}
            {tyre('rearRight', 'RA')}
          </div>
        </div>
        <p className="pl-[3.25rem] text-[8px] uppercase tracking-widest text-gray-600">slicks</p>
      </div>
      {tyreEstimate ? (
        <div className="mt-1.5 border-t border-white/5 pt-1.5">
          <TyreAdviceLine estimate={tyreEstimate} />
        </div>
      ) : (
        <p className="mt-1.5 text-[9px] text-gray-600">Stand van SimHub; verspringt alleen bij een stop.</p>
      )}
    </section>
  );
}
