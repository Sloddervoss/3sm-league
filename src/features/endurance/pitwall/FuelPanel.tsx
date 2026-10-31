import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatFuel, strategyStatusInfo } from "./pitwallHelpers";
import { PitwallPanel } from "./PitwallPanel";

interface Props {
  strategy: PitwallStrategyRow | null;
}

/**
 * Brandstof & stint.
 *
 * Grote huidige waarde, daaronder de bestaande range, het verbruik, de
 * finishbehoefte en de meetbasis. Dezelfde velden, dezelfde formules; geen
 * tweede pitwindow en geen bijtankadvies dat hier niet vandaan komt (dat staat
 * in de beslissingsband).
 *
 * In de testmodus levert de adapter alleen de tankinhoud. Dan staat hier de
 * meting en verder niets: geen range, geen verbruik, geen strategie die er niet
 * is.
 */
export const FuelPanel = ({ strategy }: Props) => {
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
  const status = strategyStatusInfo(strategy.strategy_status);

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
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">In de tank</p>
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

      <dl className="mt-3 space-y-1.5 border-t border-[#161C27] pt-2.5 text-[12px]">
        {perLap != null && <Row label="Verbruik" value={`${perLap.toFixed(3)} L/ronde`} />}
        {raceAvg != null && <Row label="Race gem." value={`${raceAvg.toFixed(3)} L/ronde`} />}
        {toFinish != null && <Row label="Tot finish" value={formatFuel(toFinish)} />}
        {sufficient != null && (
          <Row
            label="Voldoende"
            value={sufficient ? "Ja" : "Nee"}
            tone={sufficient ? "text-emerald-300" : "text-red-300"}
          />
        )}
      </dl>

      <p className={`mt-2.5 text-[11px] ${isLowSample ? "text-amber-300/90" : "text-slate-500"}`} data-pitwall-fuel-basis="true">
        {isInsufficient
          ? "Alleen tankinhoud; verbruik en bereik vereisen een gebonden race."
          : `Meetbasis: ${samples} geldige samples${isLowSample ? " — weinig data" : ""}`}
      </p>
    </PitwallPanel>
  );
};

function Row({ label, value, tone = "text-slate-200" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-mono font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
