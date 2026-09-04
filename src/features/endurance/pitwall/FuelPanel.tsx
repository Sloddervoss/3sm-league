import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatFuel } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
}

export const FuelPanel = ({ strategy }: Props) => {
  if (!strategy) {
    return <PanelShell title="Brandstof"><p className="text-sm text-gray-500">Geen data</p></PanelShell>;
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

  const showPrimary = fuel != null || perLap != null || laps != null;

  return (
    <PanelShell title="Brandstof">
      {!showPrimary && isInsufficient ? (
        <p className="text-sm text-gray-500">Geen live telemetrie</p>
      ) : (
        <div className="space-y-2 text-sm">
          {/* PRIMARY: remaining, laps, per-lap */}
          <div className="grid grid-cols-3 gap-2">
            <PrimaryCard value={fuel != null ? formatFuel(fuel) : "—"} label="Over" />
            <PrimaryCard value={laps != null ? `${laps.toFixed(1)}` : "—"} label="Ronden" />
            <PrimaryCard value={perLap != null ? `${perLap.toFixed(3)}L` : "—"} label="Per ronde" />
          </div>

          {/* SECONDARY: race avg, sample count */}
          <div className="space-y-1 text-xs mt-3 pt-2 border-t border-white/5">
            {raceAvg != null && (
              <Row label="Race gem." value={`${raceAvg.toFixed(3)}L`} />
            )}
            {toFinish != null && (
              <Row label="Naar finish" value={formatFuel(toFinish)} />
            )}
            {sufficient != null && (
              <Row
                label="Voldoende?"
                value={sufficient ? "Ja" : "Nee"}
                valueColor={sufficient ? "text-emerald-400" : "text-red-400"}
              />
            )}
            {!isInsufficient && (
              <Row
                label="Samples"
                value={`${samples}${isLowSample ? " (weinig)" : ""}`}
                valueColor={isLowSample ? "text-yellow-400" : "text-gray-400"}
              />
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
};

/* ====== Sub-components ====== */

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">{title}</h3>
    {children}
  </div>
);

const PrimaryCard = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded-lg bg-black/20 px-2.5 py-2 text-center">
    <div className="font-mono font-black text-white text-base">{value}</div>
    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
  </div>
);

const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-gray-500">{label}</span>
    <span className={`font-mono font-bold ${valueColor ?? "text-gray-400"}`}>{value}</span>
  </div>
);