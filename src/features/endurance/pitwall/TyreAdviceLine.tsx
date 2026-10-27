import { Disc3 } from "lucide-react";
import type { TyreEstimate } from "./strategy/tyreGrade";
import { adviceLine, causeLine, gradeWord, lapsAdvice, rangeAria } from "./tyreCopy";

/**
 * De ene regel onder de hoekgrid.
 *
 * Dit component kent alleen "graad → vorm". Het rekent niets: het bereik komt
 * uit `TyreEstimate` en de woorden uit `tyreCopy`. Daarmee is er één plek waar
 * een graad een getal wordt en één plek waar een getal een zin wordt.
 *
 *   A  `11–14 rondes tot 40%`   gemeten: bereik uit twee ankers
 *   B  `10–14 rondes tot 40%`   voorlopig: bereik met een brede band
 *   C  `rondes onbekend · wacht op stop`   schatting: geen tempo, geen rondes
 *   D  `— · <oorzaak>`          plan: de stop komt uit het plan, niet uit de band
 *
 * Het percentage rest is hier bewust weg: het zegt niets over het aantal rondes
 * dat je ermee doet, en dat is de enige vraag aan een pitwall. Het woord
 * (gemeten/voorlopig/schatting/plan) staat één keer in het label erboven; deze
 * regel zegt het getal, niet nog een keer de herkomst.
 *
 * De streep bij D is het antwoord "geen", niet een ontbrekend getal (plan-04 §8
 * punt 7). Kleur is nooit de enige drager: de letter en het woord staan in de kop
 * van het paneel, de regel zelf zegt het met rondes of met een oorzaak.
 */
export function TyreAdviceLine({ estimate }: { estimate: TyreEstimate | null }) {
  if (!estimate) return null;

  const { grade } = estimate;
  const metRondes = grade === "A" || grade === "B";

  return (
    <div
      className={`flex items-baseline gap-2 text-[13px] leading-5 ${toonKleur(grade)}`}
      data-pitwall-tyre-grade={grade}
      data-pitwall-tyre-confidence={gradeWord(grade)}
      data-pitwall-tyre-line={adviceLine(estimate)}
    >
      <Disc3 className={`h-3.5 w-3.5 shrink-0 ${grade === "D" ? "text-gray-600" : "text-gray-400"}`} aria-hidden />
      <p
        className={`min-w-0 flex-1 font-mono tabular-nums ${grade === "C" ? "italic" : ""}`}
        title={grade === "D" ? causeLine(estimate) : undefined}
      >
        <span className="sr-only">{`Banden: ${gradeWord(grade)}. `}</span>
        {metRondes ? <RondesRegel estimate={estimate} /> : adviceLine(estimate)}
      </p>
    </div>
  );
}

/**
 * Het bereik als losse delen, zodat de voorlezer `11–14` als "elf tot veertien
 * rondes" hoort en niet als "elf en veertien". De rest van de regel is gewone
 * tekst: daar valt niets te verwarren.
 */
function RondesRegel({ estimate }: { estimate: TyreEstimate }) {
  const { rangeText, range, limit } = lapsAdvice(estimate);

  return (
    <>
      {rangeText == null ? (
        <>rondes onbekend</>
      ) : (
        <>
          {range == null ? rangeText : <span aria-label={rangeAria(range) ?? undefined}>{rangeText}</span>}
          {" rondes"}
        </>
      )}
      {limit != null && <> {limit}</>}
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
