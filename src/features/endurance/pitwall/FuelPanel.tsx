import { Fuel } from "lucide-react";
import type { PitWindow } from "./strategy/types";
import { finiteNonNegative } from "./elementPresentation";
import type { PitwallPlannedStint } from "./pitwallHelpers";
import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatFuel, strategyStatusInfo } from "./pitwallHelpers";
import { fuelScenarios } from "./strategy/fuelScenarios";
import { PitwallPanel } from "./PitwallPanel";

interface Props {
  window?: PitWindow | null;
  plannedStints?: PitwallPlannedStint[];
  strategy: PitwallStrategyRow | null;
}

/**
 * Brandstof & stint.
 *
 * Grote huidige waarde, daaronder de bestaande range, het verbruik, de
 * finishbehoefte en de meetbasis. Het bestaande adviesvenster wordt alleen
 * weergegeven, niet opnieuw berekend. De lijst komt uit de echte planning.
 *
 * In de testmodus levert de adapter alleen de tankinhoud. Dan staat hier de
 * meting en verder niets: geen range, geen verbruik, geen strategie die er niet
 * is.
 */
export const FuelPanel = ({ strategy, window, plannedStints = [] }: Props) => {
  if (!strategy) {
    return (
      <PitwallPanel title="Brandstof & stint" slot="fuel">
        <p className="text-[12px] text-slate-500">Geen data</p>
      </PitwallPanel>
    );
  }

  const samples = strategy.valid_fuel_sample_count;
  const isLowSample = strategy.strategy_status === "low_sample" || samples < 5;
  const isInsufficient = strategy.strategy_status === "insufficient_data";
  const fuel = strategy.current_fuel_litres;
  const laps = strategy.fuel_laps_remaining;
  const perLap = strategy.fuel_per_lap_litres;
  const raceAvg = strategy.race_fuel_per_lap_litres;
  const toFinish = strategy.fuel_to_finish_litres;
  const sufficient = strategy.fuel_sufficient_to_finish;
  const currentLap = strategy.last_completed_laps;
  const validWindow = window && finiteNonNegative(window.earliestLap) && finiteNonNegative(window.latestLap) && window.latestLap >= window.earliestLap ? window : null;
  const windowPosition = validWindow && finiteNonNegative(currentLap) ? Math.max(0, Math.min(100, (currentLap - validWindow.earliestLap) / Math.max(1, validWindow.latestLap - validWindow.earliestLap) * 100)) : null;
  const consumptionDelta = finiteNonNegative(perLap) && perLap > 0 && finiteNonNegative(raceAvg) && raceAvg > 0 ? perLap - raceAvg : null;
  const status = strategyStatusInfo(strategy.strategy_status);
  // De finishbehoefte is in liters bekend; het aantal rondes volgt daaruit, zodat
  // de scenario's met dezelfde invoer rekenen als de rest van het paneel.
  const lapsToFinish = toFinish != null && perLap != null && perLap > 0 ? toFinish / perLap : null;
  const scenarios = fuelScenarios({ fuelLitres: fuel, perLap, lapsRemaining: lapsToFinish });

  if (isInsufficient && fuel == null) {
    return (
      <PitwallPanel title="Brandstof & stint" slot="fuel" meta={status.label}>
        <p className="text-[12px] text-slate-500">Geen live telemetrie</p>
      </PitwallPanel>
    );
  }

  return (
    <PitwallPanel
      title="Brandstof & stint"
      slot="fuel"
      meta={<span className={isLowSample ? "text-amber-300" : undefined}>{status.label}</span>}
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500"><Fuel className="mr-1 inline h-3 w-3" aria-hidden />In de tank</p>
          <p className="mt-1 font-mono text-[32px] font-bold leading-none tabular-nums text-white" data-pitwall-fuel-value="true">
            {fuel != null ? formatFuel(fuel) : "—"}
          </p>
        </div>
        {laps != null && (
          <div className="text-right">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">Nog</p>
            <p className="mt-1 font-mono text-[22px] font-bold leading-none tabular-nums text-emerald-300">{laps.toFixed(1)}</p>
            <p className="mt-1 text-[11px] text-slate-500">ronden</p>
          </div>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[#161C27] pt-2 text-[12px] leading-4">
        {perLap != null && <Row label="Verbruik" value={`${perLap.toFixed(3)} L/ronde`} />}
        {raceAvg != null && <Row label="Race gem." value={`${raceAvg.toFixed(3)} L/ronde`} />}
        {toFinish != null && <Row label="Tot finish" value={formatFuel(toFinish)} />}
        {sufficient != null && (
          <Row
            label="Voldoende (zonder reserve)"
            value={sufficient ? "Ja" : "Nee"}
            tone={sufficient ? "text-emerald-300" : "text-red-300"}
          />
        )}
        {scenarios.targetPerLap != null && (
          <Row label="Doel" value={`${scenarios.targetPerLap.toFixed(3)} L/ronde`} />
        )}
        {scenarios.extraLaps != null && (
          <Row
            label="Extra afstand"
            value={scenarios.extraLaps > 0 ? `${scenarios.extraLaps} ronde${scenarios.extraLaps === 1 ? "" : "s"}` : "geen"}
            tone={scenarios.extraLaps > 0 ? "text-emerald-300" : "text-slate-300"}
          />
        )}
      </dl>

      {scenarios.verdict !== "onbekend" && (
        <p
          className={`mt-1 text-[11px] ${
            scenarios.verdict === "tekort" ? "text-red-300" : scenarios.verdict === "extra_ronde" ? "text-emerald-300" : "text-slate-400"
          }`}
          data-pitwall-fuel-scenarios="true"
        >
          Met {scenarios.reserveLaps} ronde reserve: {scenarios.reason}
        </p>
      )}

      {consumptionDelta != null && <p className={`mt-1 text-[11px] ${consumptionDelta < 0 ? "text-emerald-300" : "text-orange-300"}`}>Δ vs racegem. {consumptionDelta >= 0 ? '+' : ''}{consumptionDelta.toFixed(3)} L/r</p>}
      {validWindow && <div className="mt-2 text-[12px]" data-pitwall-window="true">
        <p className="flex justify-between text-slate-400"><span>Pitwindow{currentLap != null ? ` · nu R${currentLap}` : ""}</span><span className="font-mono text-emerald-300">R{validWindow.earliestLap}–{validWindow.latestLap}</span></p>
        <div className="relative mt-1 h-2 rounded bg-emerald-400/20" role="img" aria-label={`Pitwindow ronde ${validWindow.earliestLap} tot ${validWindow.latestLap}${windowPosition != null ? `, huidige ronde ${currentLap}` : ''}`}>
          {windowPosition != null && <span className="absolute -top-0.5 h-3 w-1 bg-orange-400" style={{ left: `calc(${windowPosition}% - 2px)` }} />}
        </div>

      </div>}
      {plannedStints.length > 0 && <div className="mt-1 text-[12px]" data-pitwall-stint-plan="true">
        <p className="font-bold text-slate-300">Stintplanning</p>
        <ol className="max-h-[51px] overflow-auto overscroll-contain" tabIndex={0} aria-label="Volledige stintplanning" style={{ lineHeight: "16px" }}>
          {plannedStints.map((stint, i) => <li key={stint.id} className="flex justify-between gap-2 border-t border-white/5"><span>{i + 1}. {stint.driver_id}{stint.status === 'in_car' ? ' (huidig)' : ' (gepland)'}</span><span className="whitespace-nowrap font-mono">{stint.expected_laps} r</span></li>)}
        </ol>
      </div>}
      <p className={`mt-1 text-[11px] ${isLowSample ? "text-amber-300/90" : "text-slate-500"}`} data-pitwall-fuel-basis="true">
        {isInsufficient
          ? "Alleen tankinhoud; verbruik en bereik vereisen een gebonden race."
          : `Meetbasis: ${samples} geldige samples${isLowSample ? " — weinig data" : ""}`}
      </p>
    </PitwallPanel>
  );
};

function Row({ label, value, tone = "text-slate-200" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-mono font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
