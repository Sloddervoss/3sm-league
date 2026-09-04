import type { PitwallStrategyRow, PitwallPositionData, PitwallRaceClock } from "./pitwallHelpers";
import { formatFuel, formatSeconds } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
  raceClock: PitwallRaceClock | null;
  /** When true, telemetry is stale/offline */
  offlineMode?: boolean;
}

export const TopRaceBar = ({ strategy, position, raceClock, offlineMode }: Props) => {
  /* === OFFLINE === */
  if (offlineMode || strategy?.strategy_status === "insufficient_data") {
    return (
      <div className="rounded-xl bg-black/60 px-5 py-4 text-sm ring-1 ring-gray-600/30">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-orange-400">TELEMETRIE VERLOREN</span>
          <span className="h-4 w-px bg-white/10" />
          <span className="text-xs text-gray-400">Planning blijft beschikbaar</span>
        </div>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="rounded-xl bg-black/40 px-4 py-3 text-center text-sm text-gray-500 ring-1 ring-white/5">
        Geen live data
      </div>
    );
  }

  const completedLaps = strategy.last_completed_laps;
  const currentFuel = strategy.current_fuel_litres;
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = fuelLaps != null && completedLaps != null
    ? Math.floor(completedLaps + fuelLaps - 1)
    : null;
  const pitInLaps = pitLap != null && completedLaps != null
    ? Math.max(0, pitLap - completedLaps)
    : null;

  const isPitThisLap = fuelLaps != null && fuelLaps < 1.5;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl bg-black/50 px-5 py-3 text-sm ring-1 ring-white/8">
      {/* POSITION */}
      <PositionBlock position={position} />

      <Divider />

      {/* LAP */}
      <DataGroup label="RONDE" value={completedLaps != null ? `LAP ${completedLaps}` : "—"} mono />

      <Divider />

      {/* RACE CLOCK */}
      {raceClock?.remainingSeconds != null ? (
        <DataGroup label="OVER" value={formatSeconds(raceClock.remainingSeconds)} mono />
      ) : (
        <DataGroup label="OVER" value="—" mono />
      )}

      <Divider />

      {/* GAP LEADER */}
      {position?.gapToLeaderSeconds != null && !isPitThisLap && (
        <>
          <DataGroup label="LEIDER" value={`+${position.gapToLeaderSeconds.toFixed(1)}s`} mono />
          <Divider />
        </>
      )}

      {/* FUEL */}
      <DataGroup
        label="BRANDSTOF"
        value={currentFuel != null ? formatFuel(currentFuel) : "—"}
        mono
      />

      <Divider />

      {/* FUEL RANGE */}
      <DataGroup
        label="RND OVER"
        value={fuelLaps != null ? `${fuelLaps.toFixed(1)}` : "—"}
        mono
      />

      <Divider />

      {/* PIT IN — strongest item right */}
      {isPitThisLap ? (
        <span className="rounded-md bg-red-500/20 px-3 py-1.5 font-black text-red-300 text-sm tracking-wider ring-1 ring-red-500/20">
          PIT DEZE RONDE
        </span>
      ) : pitInLaps != null ? (
        <span className={`rounded-md px-3 py-1.5 font-black text-sm tracking-wider ${
          pitInLaps <= 3
            ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/20"
            : "bg-white/8 text-gray-200"
        }`}>
          PIT IN {pitInLaps}
        </span>
      ) : null}
    </div>
  );
};

/* ====== Sub-components ====== */

const PositionBlock = ({ position }: { position: PitwallPositionData | null }) => {
  if (!position || position.overallPosition == null) {
    return <DataGroup label="POS" value="— / —" />;
  }
  const ov = position.overallPosition;
  const cls = position.classPosition;
  return (
    <span className="whitespace-nowrap font-black text-lg tracking-tight text-white">
      P{ov}
      {cls != null && (
        <span className="ml-1 font-bold text-orange-300 text-sm">/ K{cls}</span>
      )}
    </span>
  );
};

const Divider = () => <span className="h-5 w-px bg-white/10" />;

const DataGroup = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <span className="whitespace-nowrap">
    <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
    <span className={`font-bold text-white ${mono ? "font-mono" : ""}`}>{value}</span>
  </span>
);