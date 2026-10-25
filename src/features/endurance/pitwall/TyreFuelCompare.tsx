import type { BindingConstraint, TyreFuelComparison } from "./strategy/types";
import { bindingHeading, bindingSentence, lapsLabel, limitLabel, rangeSuffix } from "./tyreCopy";

/**
 * Banden en tank naast elkaar, in dezelfde eenheid: rondes tot de grens.
 *
 * Dit component rekent niets. De twee getallen komen uit `Advice.tyreFuel` en
 * zijn exact de getallen waarmee `advise()` beslist; `laps` is `lapsUntilPit`
 * zelf. Daardoor kan de gemarkeerde rij niet iets anders zeggen dan de kop
 * erboven — en dat is de hele reden dat dit component bestaat.
 *
 * Volgorde is vast: banden boven, tank onder. Wie die per scherm wisselt, laat
 * de engineer elke ronde opnieuw zoeken.
 *
 * Is er geen grens (STAY_OUT of geen advies), dan rendert dit niets: één feit
 * hoort in één regel, niet in twee rijen die hetzelfde zeggen.
 */
export function TyreFuelCompare({
  comparison,
  binding,
  laps,
}: {
  comparison: TyreFuelComparison | null | undefined;
  binding?: BindingConstraint | null;
  /** `lapsUntilPit` uit het advies: hetzelfde getal als de kop. */
  laps: number | null;
}) {
  if (!comparison || !binding) return null;

  const rijen = [
    {
      key: "tyres" as const,
      label: "banden",
      row: comparison.tyres,
      grens: limitLabel(comparison.tyres.limitPct, true),
    },
    {
      key: "fuel" as const,
      label: "tank",
      row: comparison.fuel,
      // De tank is leeg, niet "kaal": dezelfde eenheid, ander woord.
      grens: "tot leeg",
    },
  ];

  return (
    <div className="min-w-0" data-pitwall-tyre-fuel="true" data-pitwall-binding={binding}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">{bindingHeading()}</p>
      <ul className="mt-1 space-y-0.5 font-mono text-[12px] leading-4 tabular-nums">
        {rijen.map(({ key, label, row, grens }) => {
          const actief = binding === key || binding === "both";
          const bereik = rangeSuffix(row.range);
          return (
            <li
              key={key}
              data-pitwall-constraint={key}
              data-pitwall-constraint-active={actief ? "true" : undefined}
              className={`flex flex-wrap items-baseline gap-x-1.5 ${actief ? "text-white" : "text-gray-400"}`}
            >
              <span aria-hidden className={actief ? "text-orange-300" : "text-transparent"}>
                ▸
              </span>
              <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
              <span className={actief ? "font-bold" : ""}>{lapsLabel(row.laps)}</span>
              {bereik && <span className="text-gray-500">{bereik}</span>}
              {grens && <span className="text-gray-500">· {grens}</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] leading-4 text-gray-300" data-pitwall-binding-sentence>
        {bindingSentence({
          binding,
          laps,
          tyreLaps: comparison.tyres.laps,
          fuelLaps: comparison.fuel.laps,
        })}
      </p>
    </div>
  );
}
