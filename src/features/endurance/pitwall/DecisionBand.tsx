import type { ReactNode } from "react";
import { Disc3, Fuel, TriangleAlert, Wrench } from "lucide-react";
import type { Advice, RepairState } from "./strategy/types";
import type { TyreAdvice } from "./strategy/tyreWear";
import { TyreAdviceLine } from "./TyreAdviceLine";
import { TyreFuelCompare } from "./TyreFuelCompare";
import { gradeWord, stayOutLine } from "./tyreCopy";

/**
 * De beslissingsband.
 *
 * Eén regel die zegt wat je moet doen, waarom, en met hoeveel vertrouwen. Geen
 * tweede getal dat het eerste tegenspreekt: de band is de enige plek waar een
 * advies staat, de panelen eronder tonen de onderbouwing.
 *
 * Wat hier sinds S4 staat en wat er niet meer staat:
 *
 * - De bandenrij is een **graad**, geen getal: A toont een puntgetal, B een getal
 *   met marge, C een bereik en D één oorzaakregel. Die regel staat in
 *   `TyreAdviceLine`; dit component kiest hem niet.
 * - De vakjes `in de tank` en `banden` zijn weg. Daarvoor in de plaats staat
 *   `TyreFuelCompare`: twee grenzen in dezelfde eenheid, met dezelfde getallen
 *   als `lapsUntilPit`. Eén tank, één getal.
 * - `tanken` (liters) blijft: dat is de enige plek met liters bij de stop. Het
 *   label `zekerheid` heet nu `zekerheid tank`, want de banden hebben hun eigen
 *   graad en twee soorten zekerheid onder één kop is precies hoe dit paneel
 *   eerder ongeloofwaardig werd.
 * - In de pitbox komt er één strook bij: `reparatie verplicht / optioneel /
 *   onbekend`, met de tijd ernaast. Die hangt aan `advice.inBox` en verdwijnt
 *   zodra de auto weer buiten staat — het is een toestand van dit moment, geen
 *   geschiedenis. Geen paneel, geen tabel: dezelfde regelmaat als de bandenrij.
 */

const decisionLabel = (advice: Advice): string => {
  switch (advice.decision) {
    case "STAY_OUT":
      return "BLIJF BUITEN";
    case "PIT_THIS_LAP":
      return "PIT DEZE RONDE";
    case "PIT_IN_LAPS":
      return advice.lapsUntilPit == null
        ? "PIT"
        : `PIT OVER ${advice.lapsUntilPit} ${advice.lapsUntilPit === 1 ? "RONDE" : "RONDES"}`;
    default:
      return "GEEN ADVIES";
  }
};

const confidenceLabel: Record<Advice["confidence"], string> = {
  high: "betrouwbaar",
  medium: "redelijk",
  low: "voorlopig",
  none: "onvoldoende data",
};

/** Het label boven de bandenregel: wat je met de band moet doen. */
const tyreLabel: Record<TyreAdvice["action"], string> = {
  NO_CHANGE: "banden ok",
  CHANGE_AT_PLANNED_STOP: "wisselen bij stop",
  CHANGE_BEFORE_PLANNED_STOP: "wissel vóór stop",
  NO_ADVICE: "geen bandenadvies",
};

const tyreTone: Record<TyreAdvice["action"], string> = {
  NO_CHANGE: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300",
  CHANGE_AT_PLANNED_STOP: "border-sky-400/30 bg-sky-400/[0.08] text-sky-200",
  CHANGE_BEFORE_PLANNED_STOP: "border-orange-400/40 bg-orange-400/[0.10] text-orange-300",
  NO_ADVICE: "border-white/10 bg-white/[0.03] text-gray-400",
};

/**
 * De reparatiestrook: drie woorden, en ze zijn niet inwisselbaar. "verplicht"
 * betekent dat de auto er niet zonder wegkomt; "optioneel" dat het tijdwinst is;
 * "onbekend" dat de connector geen reparatietijd gaf. Zwijgen zou het derde
 * geval als het tweede laten lezen.
 */
const repairLabel: Record<RepairState, string> = {
  mandatory: "reparatie verplicht",
  optional: "reparatie optioneel",
  unknown: "reparatie onbekend",
};

const repairTone: Record<RepairState, string> = {
  mandatory: "border-orange-400/40 bg-orange-400/[0.10] text-orange-300",
  optional: "border-sky-400/30 bg-sky-400/[0.08] text-sky-200",
  unknown: "border-white/10 bg-white/[0.03] text-gray-400",
};

export function DecisionBand({ advice }: { advice: Advice }) {
  const rustig = advice.decision === "NO_ADVICE";
  const naarBinnen = advice.decision === "PIT_THIS_LAP";
  const banden = advice.tyres ?? null;
  const estimate = advice.tyreEstimate ?? null;
  // De pitbox-fase komt uit de motor en is alleen gevuld zolang de auto binnen
  // staat; buiten de stop is er geen strook en geen reparatievraag.
  const inBox = advice.inBox ?? null;

  const rand = rustig
    ? "border-white/10 bg-white/[0.03]"
    : naarBinnen
      ? "border-orange-500/40 bg-orange-500/[0.10]"
      : "border-emerald-500/25 bg-emerald-500/[0.06]";

  const actieKleur = rustig
    ? "text-gray-300"
    : naarBinnen
      ? "text-orange-300"
      : "text-emerald-300";

  return (
    <section
      className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between ${rand}`}
      data-pitwall-decision-band="true"
    >
      <div className="min-w-0 flex-1">
        {/* Alleen de korte beslissing zit in de live region: één keer per ronde
            voorlezen, niet elke seconde. De onderbouwing staat eronder. */}
        <p
          className={`text-2xl font-black leading-tight tracking-tight ${actieKleur}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {decisionLabel(advice)}
        </p>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-400">{advice.reason}</p>

        {/* Reparatiestrook: één regel over wat er in de box moet gebeuren. Geen
            paneel en geen tabel — dezelfde strook als de bandenrij eronder. */}
        {inBox && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 ${repairTone[inBox.repair]}`}
            data-pitwall-in-box={inBox.repair}
          >
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
              <Wrench className="h-3 w-3" aria-hidden />
              in de box
            </span>
            <span className="text-[12px] font-bold">{repairLabel[inBox.repair]}</span>
            <span
              className="ml-auto font-mono text-[12px] tabular-nums"
              data-pitwall-repair-seconds={inBox.repairSeconds == null ? "unknown" : Math.round(inBox.repairSeconds)}
              aria-label={
                inBox.repairSeconds == null
                  ? "reparatietijd onbekend"
                  : `reparatietijd ${Math.round(inBox.repairSeconds)} seconden`
              }
            >
              {inBox.repairSeconds == null ? "—" : `${Math.round(inBox.repairSeconds)} s`}
            </span>
          </div>
        )}

        {banden && (
          <div className="mt-2 space-y-1.5" data-pitwall-tyre-action={banden.action}>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tyreTone[banden.action]}`}
              >
                <Disc3 className="h-3 w-3" />
                {tyreLabel[banden.action]}
              </span>
              {estimate ? (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider text-gray-500"
                  data-pitwall-tyre-grade-label={estimate.grade}
                >
                  {estimate.grade} · {gradeWord(estimate.grade)}
                </span>
              ) : (
                <span className={banden.action === "NO_ADVICE" ? "text-gray-500" : "text-gray-300"}>
                  {banden.reason}
                </span>
              )}
            </p>
            {estimate && <TyreAdviceLine estimate={estimate} />}
          </div>
        )}

        {advice.decision === "STAY_OUT" && (
          <p className="mt-3 font-mono text-[12px] tabular-nums text-gray-300" data-pitwall-stay-out>
            {stayOutLine({
              restPct: estimate?.restPct ?? null,
              fuelLaps: advice.tyreFuel?.fuel.laps ?? null,
              lapsToFinish: advice.lapsToFinish,
            })}
          </p>
        )}

        <div className="mt-3">
          <TyreFuelCompare
            comparison={advice.tyreFuel ?? null}
            binding={advice.binding ?? null}
            laps={advice.lapsUntilPit}
          />
        </div>
      </div>

      {!rustig && (
        <div className="flex shrink-0 items-stretch gap-2">
          <Stat
            icon={<Fuel className="h-4 w-4" />}
            label="tanken"
            waarde={advice.fuelToAddLitres == null ? "—" : `${Math.round(advice.fuelToAddLitres)} L`}
            onbekend={advice.fuelToAddLitres == null}
          />
          <div className="flex min-w-[104px] flex-col justify-center rounded-xl border border-white/5 bg-black/20 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">zekerheid tank</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-gray-200">
              {advice.confidence === "none" && <TriangleAlert className="h-3.5 w-3.5 text-amber-300" />}
              {confidenceLabel[advice.confidence]}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  icon,
  label,
  waarde,
  onbekend,
}: {
  icon: ReactNode;
  label: string;
  waarde: string;
  onbekend: boolean;
}) {
  return (
    <div className="flex min-w-[104px] flex-col justify-center rounded-xl border border-white/5 bg-black/20 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        <span className="text-gray-400">{icon}</span>
        {label}
      </span>
      <span className={`mt-0.5 text-sm font-bold ${onbekend ? "text-gray-500" : "text-white"}`}>{waarde}</span>
    </div>
  );
}
