import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatFuel } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
}

export const FuelPanel = ({ strategy }: Props) => {
  if (!strategy) {
    return <PanelShell title="BRANDSTOF"><p className="text-xs text-gray-500">Geen data</p></PanelShell>;
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

  if (isInsufficient && fuel == null) {
    return <PanelShell title="BRANDSTOF"><p className="text-xs text-gray-500">Geen live telemetrie</p></PanelShell>;
  }

  return (
    <PanelShell title="BRANDSTOF">
      {/* Primary: 3-wide compact grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <PrimaryBox value={fuel != null ? formatFuel(fuel) : "—"} label="Over" />
        <PrimaryBox value={laps != null ? `${laps.toFixed(1)}` : "—"} label="Ronden" />
        <PrimaryBox value={perLap != null ? `${perLap.toFixed(3)}L` : "—"} label="Per ronde" />
      </div>

      {/* Secondary: compact inline */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {raceAvg != null && <span className="text-gray-500">Race: <span className="font-bold text-gray-300">{raceAvg.toFixed(3)}L</span></span>}
        {toFinish != null && <span className="text-gray-500">Finish: <span className="font-bold text-gray-300">{formatFuel(toFinish)}</span></span>}
        {sufficient != null && (
          <span className="text-gray-500">Voldoende: <span className={`font-bold ${sufficient ? "text-emerald-400" : "text-red-400"}`}>{sufficient ? "Ja" : "Nee"}</span></span>
        )}
        {!isInsufficient && (
          <span className={`text-gray-500`}>Samples: <span className={`font-bold ${isLowSample ? "text-yellow-400" : "text-gray-300"}`}>{samples}</span></span>
        )}
      </div>
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{title}</div>
    {children}
  </div>
);

const PrimaryBox = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded bg-black/20 px-2 py-1.5 text-center">
    <div className="font-mono font-black text-white text-sm">{value}</div>
    <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
  </div>
);