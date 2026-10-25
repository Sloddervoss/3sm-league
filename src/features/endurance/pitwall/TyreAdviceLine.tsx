import { Disc3 } from "lucide-react";
import { formatLapsRange, formatPct, type TyreEstimate } from "./strategy/tyreGrade";
import { adviceLine, causeLine, gradeWord, marginAria, rangeAria } from "./tyreCopy";

/**
 * De ene regel onder de hoekgrid.
 *
 * Dit component kent alleen "graad → vorm". Het rekent niets: de getallen komen
 * uit `TyreEstimate` en de woorden uit `tyreCopy`. Daarmee is er één plek waar
 * een graad een getal wordt en één plek waar een getal een zin wordt.
 *
 *   A  `62% · −1,8/r · nog 12 rondes tot 40%`   puntgetal, helling, rondes
 *   B  `62% ±4 · 10–14 rondes (geschat)`        getal met marge, rondes als bereik
 *   C  `55–70% · geschat · wacht op stop`       bereik, geen tempo, geen rondes
 *   D  `— · <oorzaak>`                          alleen de oorzaak
 *
 * De streep bij D is het antwoord "geen", niet een ontbrekend getal (plan-04 §8
 * punt 7). Kleur is nooit de enige drager: de letter en het woord staan in de kop
 * van het paneel, de regel zelf zegt het met getallen of met een oorzaak.
 */
export function TyreAdviceLine({ estimate }: { estimate: TyreEstimate | null }) {
  if (!estimate) return null;

  const { grade } = estimate;
  const toon = grade === "B" ? <GraadB estimate={estimate} /> : <>{adviceLine(estimate)}</>;

  return (
    <div
      className={`flex items-baseline gap-2 text-[13px] leading-5 ${toonKleur(grade)}`}
      data-pitwall-tyre-grade={grade}
      data-pitwall-tyre-line={adviceLine(estimate)}
    >
      <Disc3 className={`h-3.5 w-3.5 shrink-0 ${grade === "D" ? "text-gray-600" : "text-gray-400"}`} aria-hidden />
      <p
        className={`min-w-0 flex-1 font-mono tabular-nums ${grade === "C" ? "italic" : ""}`}
        title={grade === "D" ? causeLine(estimate) : undefined}
      >
        <span className="sr-only">{`Banden: ${gradeWord(grade)}. `}</span>
        {toon}
      </p>
    </div>
  );
}

/**
 * Graad B: getal met marge, rondes als bereik.
 *
 * De `±` en het bereik krijgen ieder een eigen voorleeslabel. `10–14` wordt
 * anders soms als "tien en veertien" gelezen en `±4` helemaal niet.
 */
function GraadB({ estimate }: { estimate: TyreEstimate }) {
  const pct = formatPct(estimate.restPct);
  const marge = estimate.marginPp == null ? null : Math.round(estimate.marginPp);
  const bereik = formatLapsRange(estimate.lapsRange);

  return (
    <>
      {pct == null ? "—" : `${pct}%`}
      {marge != null && (
        <>
          {" "}
          <span aria-label={marginAria(marge) ?? undefined}>±{marge}</span>
        </>
      )}
      {bereik == null ? (
        <> · rondes onbekend (geschat)</>
      ) : (
        <>
          {" · "}
          <span aria-label={rangeAria(estimate.lapsRange) ?? undefined}>{bereik}</span> rondes (geschat)
        </>
      )}
    </>
  );
}

function toonKleur(grade: TyreEstimate["grade"]): string {
  switch (grade) {
    case "A":
      return "text-gray-100";
    case "B":
      return "text-gray-200";
    case "C":
      return "text-gray-300";
    default:
      return "text-gray-400";
  }
}
