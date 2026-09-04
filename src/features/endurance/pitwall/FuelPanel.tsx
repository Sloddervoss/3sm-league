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

  return (
    <PanelShell title="Brandstof">
      <div className="space-y-2 text-sm">
        <Row label="Resterend" value={strategy.current_fuel_litres != null ? formatFuel(strategy.current_fuel_litres) : "—"} />
        <Row
          label="Per ronde (V3)"
          value={strategy.fuel_per_lap_litres != null ? `${strategy.fuel_per_lap_litres.toFixed(3)}L` : "—"}
          note={isLowSample ? `${samples} sample(s)` : undefined}
        />
        <Row
          label="Race gem."
          value={strategy.race_fuel_per_lap_litres != null ? `${strategy.race_fuel_per_lap_litres.toFixed(3)}L` : "—"}
        />
        <Row
          label="Ronden over"
          value={strategy.fuel_laps_remaining != null ? `${strategy.fuel_laps_remaining.toFixed(1)}` : "—"}
        />
        {strategy.fuel_to_finish_litres != null && (
          <Row label="Naar finish" value={formatFuel(strategy.fuel_to_finish_litres)} />
        )}
        {strategy.fuel_sufficient_to_finish != null && (
          <Row
            label="Voldoende?"
            value={strategy.fuel_sufficient_to_finish ? "Ja" : "Nee"}
            valueColor={strategy.fuel_sufficient_to_finish ? "text-emerald-400" : "text-red-400"}
          />
        )}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500">
        <StatusDot status={strategy.strategy_status} />
        <span>{strategy.strategy_status === "ready" ? `${samples} geldige samples` : `${samples} sample(s)`}</span>
      </div>
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">{title}</h3>
    {children}
  </div>
);

const Row = ({ label, value, note, valueColor }: { label: string; value: string; note?: string; valueColor?: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-gray-400">{label}</span>
    <span className={`font-mono font-bold ${valueColor ?? "text-white"}`}>
      {value}
      {note && <span className="ml-1 text-[10px] text-gray-500">({note})</span>}
    </span>
  </div>
);

const StatusDot = ({ status }: { status: string }) => {
  const color = status === "ready" ? "bg-emerald-400" :
    status === "low_sample" ? "bg-yellow-400" :
    status === "insufficient_data" ? "bg-red-400" : "bg-gray-500";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
};