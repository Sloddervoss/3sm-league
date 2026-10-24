import type { ReactNode } from "react";
import { Fuel, Gauge, TriangleAlert } from "lucide-react";
import type { Advice } from "./strategy/types";

/**
 * De beslissingsband.
 *
 * Eén regel die zegt wat je moet doen, waarom, en met hoeveel vertrouwen. Geen
 * tweede getal dat het eerste tegenspreekt: de band is de enige plek waar een
 * advies staat, de panelen eronder tonen de onderbouwing.
 *
 * "Geen advies" is bewust grijs en rustig. Het is geen fout, het is een meting
 * die nog niet genoeg houvast geeft — en de band zegt dan welke.
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

export function DecisionBand({ advice }: { advice: Advice }) {
  const rustig = advice.decision === "NO_ADVICE";
  const naarBinnen = advice.decision === "PIT_THIS_LAP";

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
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Advies</p>
        <p className={`mt-1 text-2xl font-black leading-tight tracking-tight ${actieKleur}`}>{decisionLabel(advice)}</p>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-400">{advice.reason}</p>
      </div>

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
        <div className="flex min-w-[92px] flex-col justify-center rounded-xl border border-white/5 bg-black/20 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">zekerheid</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-gray-200">
            {advice.confidence === "none" && <TriangleAlert className="h-3.5 w-3.5 text-amber-300" />}
            {confidenceLabel[advice.confidence]}
          </span>
        </div>
      </div>
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
    <div className="flex min-w-[92px] flex-col justify-center rounded-xl border border-white/5 bg-black/20 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        <span className="text-gray-400">{icon}</span>
        {label}
      </span>
      <span className={`mt-0.5 text-sm font-bold ${onbekend ? "text-gray-500" : "text-white"}`}>{waarde}</span>
    </div>
  );
}
