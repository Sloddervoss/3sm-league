import type { V3Normalized } from './pitwallHelpers';
import type { TyreEstimate } from './strategy/tyreGrade';
import { TyreAdviceLine } from './TyreAdviceLine';
import { PitwallPanel } from './PitwallPanel';

const value = (n: number | null | undefined, digits = 0) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : null;
const amount = (n: number | null | undefined, digits = 0) => value(n, digits) ?? '—';

/** Kleur is betekenis: groen is gezond, oranje let op, rood is bijna op. */
const wearTone = (pct: number | null): string => {
  if (pct == null) return 'border-[#1D2431] bg-white/[0.02] text-slate-400';
  if (pct >= 70) return 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300';
  if (pct >= 50) return 'border-amber-400/25 bg-amber-400/[0.07] text-amber-300';
  return 'border-red-400/30 bg-red-400/[0.08] text-red-300';
};

/**
 * De vier hoeken met hun stand.
 *
 * `wearPercent` is het resterende percentage: 100 is nieuw. Daarom staat het
 * als restwaarde groot in het vak en heet het niet "versleten". Temperatuur en
 * druk staan kleiner en alleen met de eenheid die de bron meegaf.
 *
 * "Laatst beschikbare bandenmeting" blijft zichtbaar: verse netwerkdata betekent
 * niet dat de bandenmeting continu vernieuwt.
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
  const tyres = live && inCar ? v3?.tyres : null;
  const counter = (n: number | null | undefined) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
  const compound = counter(tyres?.compoundId);
  const used = counter(tyres?.sets?.used);
  const available = counter(tyres?.sets?.available);
  const hasMetadata = compound != null || used != null || available != null;
  const status = !live ? 'Telemetrie offline' : !inCar ? 'Niet in de auto' : car || tyres ? 'Laatst beschikbare bandenmeting' : 'Niet aangeleverd';

  const tyre = (key: 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight', label: string) => {
    const t = car?.[key];
    const pct = value(t?.wearPercent);
    const temp = value(t?.temperature, 1);
    const press = value(t?.pressure, 1);
    const hasTemp = temp != null && Boolean(car?.temperatureUnit);
    const hasPress = press != null && Boolean(car?.pressureUnit);
    return (
      <div
        className={`rounded-lg border px-2.5 py-2 ${wearTone(pct != null ? Number(pct) : null)}`}
        data-pitwall-tyre-corner={key}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.14em] opacity-80">{label}</p>
        <p className="mt-1 font-mono text-[24px] font-bold leading-none tabular-nums">
          {pct != null ? `${pct}%` : '—'}
        </p>
        {(hasTemp || hasPress) && (
          <p className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-slate-400">
            {hasTemp && <span>{temp} °{car?.temperatureUnit}</span>}
            {hasPress && <span>{press} {car?.pressureUnit}</span>}
          </p>
        )}
      </div>
    );
  };

  return (
    <PitwallPanel title="Banden" slot="tyres" meta={status}>
      {hasMetadata && (
        <p className="flex flex-wrap gap-x-2 text-[11px] text-slate-300" data-pitwall-tyre-sets="true">
          {compound != null && <span>Compound-ID {compound}</span>}
          {(used != null || available != null) && <span>Sets: {used != null && <span>{used} gebruikt</span>}{used != null && available != null && " / "}{available != null && <span>{available === 255 ? "onbeperkt" : available} beschikbaar</span>}</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {tyre('frontLeft', 'LV')}
        {tyre('frontRight', 'RV')}
        {tyre('rearLeft', 'LA')}
        {tyre('rearRight', 'RA')}
      </div>

      <p className={`flex flex-wrap items-baseline gap-x-2 border-t border-[#161C27] font-mono text-[11px] text-slate-400 ${hasMetadata ? "mt-0.5 pt-1" : "mt-2.5 pt-2"}`}>
        <span className="text-slate-200">{amount(car?.speedKph)}</span> km/h
        <span className="text-slate-600">·</span>
        <span className="text-orange-300">{car?.gear ?? '—'}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-300">{amount(car?.rpm)}</span> rpm
      </p>

      {tyreEstimate ? (
        <div className="mt-1.5">
          <TyreAdviceLine estimate={tyreEstimate} />
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-slate-500">SimHub-stand; vernieuwt bij een stop.</p>
      )}
    </PitwallPanel>
  );
}
