import type { ReactNode } from "react";
import { Disc3, Fuel, Gauge, TriangleAlert } from "lucide-react";
import type { Advice } from "./strategy/types";
import type { TyreAdvice } from "./strategy/tyreWear";

/**
 * De beslissingsband.
 *
 * Eén regel die zegt wat je moet doen, waarom, en met hoeveel vertrouwen. Geen
 * tweede getal dat het eerste tegenspreekt: de band is de enige plek waar een
 * advies staat, de panelen eronder tonen de onderbouwing.
 *
 * Het bandenadvies staat er als tweede regel onder, want het is de enige andere
 * reden om naar binnen te gaan. Haalt de band de geplande stop niet, dan is de
 * hoofdregel al meegeschoven en zegt deze regel waarom.
 *
 * "Geen advies" is bewust grijs en rustig. Het is geen fout, het is een meting
 * die nog niet genoeg houvast geeft — en de band zegt dan welke. Voor de banden
 * geldt dat net zo hard: staat de slijtage stil of springt ze, dan staat er
 * "geen bandenadvies" met de oorzaak en geen rondes-tot-nu-toe.
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

/** Het label boven de bandenreden: wat je met de band moet doen. */
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

export function DecisionBand({ advice }: { advice: Advice }) {
  const rustig = advice.decision === "NO_ADVICE";
  const naarBinnen = advice.decision === "PIT_THIS_LAP";
  const banden = advice.tyres ?? null;

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
    <section className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${rand}`}>
      <div className="min-w-0">
        <p className={`text-2xl font-black leading-tight tracking-tight ${actieKleur}`}>{decisionLabel(advice)}</p>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-400">{advice.reason}</p>

        {banden && (
          <p
            className="mt-2 flex max-w-2xl flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5"
            data-pitwall-tyre-action={banden.action}
          >
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tyreTone[banden.action]}`}
            >
              <Disc3 className="h-3 w-3" />
              {tyreLabel[banden.action]}
            </span>
            <span className={banden.action === "NO_ADVICE" ? "text-gray-500" : "text-gray-300"}>
              {banden.reason}
            </span>
          </p>
        )}
      </div>

      {!rustig && (
      <div className="flex shrink-0 items-stretch gap-2">
        <Stat
          icon={<Gauge className="h-4 w-4" />}
          label="in de tank"
          waarde={advice.lapsOnFuel == null ? "—" : `${advice.lapsOnFuel} r`}
          onbekend={advice.lapsOnFuel == null}
        />
        <Stat
          icon={<Fuel className="h-4 w-4" />}
          label="tanken"
          waarde={advice.fuelToAddLitres == null ? "—" : `${Math.round(advice.fuelToAddLitres)} L`}
          onbekend={advice.fuelToAddLitres == null}
        />
        {banden?.lapsRemaining != null && (
          <Stat
            icon={<Disc3 className="h-4 w-4" />}
            label="banden"
            waarde={`${banden.lapsRemaining} r`}
            onbekend={false}
          />
        )}
        <div className="flex min-w-[104px] flex-col justify-center rounded-xl border border-white/5 bg-black/20 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">zekerheid</span>
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
