import type { PitwallStrategyRow, PitwallPositionData, PitwallRaceClock } from "./pitwallHelpers";
import { formatFuel, formatSeconds } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
  raceClock: PitwallRaceClock | null;
  offlineMode?: boolean;
}

export const TopRaceBar = ({ strategy, position, raceClock, offlineMode }: Props) => {
  if (offlineMode) {
    return (
      <div className="flex items-center gap-4 rounded-lg bg-black/60 px-5 py-3 text-sm ring-1 ring-gray-700/30">
        <span className="text-xs font-bold uppercase tracking-widest text-orange-400">TELEMETRIE VERLOREN</span>
        <span className="h-4 w-px bg-white/8" />
        <span className="text-xs text-gray-400">Planning blijft beschikbaar</span>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="rounded-lg bg-black/40 px-4 py-3 text-center text-sm text-gray-500 ring-1 ring-white/5">
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
  const isLowSample = strategy.strategy_status === "low_sample";

  return (
    <div className="flex items-center gap-0 rounded-lg bg-black/50 px-4 py-2.5 text-sm ring-1 ring-white/8">
      {/* POSITION */}
      <BarItem>
        <PositionBlock position={position} />
      </BarItem>

      <BarSep />
      {/* LAP */}
      <BarItem>
        <BarLabel>RONDE</BarLabel>
        <BarValue mono>{completedLaps != null ? String(completedLaps) : "—"}</BarValue>
      </BarItem>

      <BarSep />
      {/* TIME LEFT */}
      <BarItem>
        <BarLabel>OVER</BarLabel>
        <BarValue mono>{raceClock?.remainingSeconds != null ? formatSeconds(raceClock.remainingSeconds) : "—"}</BarValue>
      </BarItem>

      <BarSep />
      {/* LEADER GAP */}
      <BarItem>
        <BarLabel>LEIDER</BarLabel>
        <BarValue mono>
          {position?.gapToLeaderSeconds != null
            ? `+${position.gapToLeaderSeconds.toFixed(1)}s`
            : "—"}
        </BarValue>
      </BarItem>

      <BarSep />
      {/* FUEL */}
      <BarItem>
        <BarLabel>BRANDSTOF</BarLabel>
        <BarValue mono>{currentFuel != null ? formatFuel(currentFuel) : "—"}</BarValue>
      </BarItem>

      <BarSep />
      {/* RANGE */}
      <BarItem>
        <BarLabel>RND OVER</BarLabel>
        <BarValue mono>{fuelLaps != null ? `${fuelLaps.toFixed(1)}` : "—"}</BarValue>
      </BarItem>

      {/* NEXT ACTION — pushed right via ml-auto */}
      <div className="ml-auto">
        {isLowSample ? (
          <span className="rounded-md px-4 py-2 font-black text-xs tracking-wider bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/15">
            WACHT OP DATA
          </span>
        ) : isPitThisLap ? (
          <span className="rounded-md bg-red-500/20 px-4 py-2 font-black text-red-300 text-base tracking-wider ring-1 ring-red-500/20">
            PIT DEZE RONDE
          </span>
        ) : pitInLaps != null ? (
          <span className={`rounded-md px-4 py-2 font-black text-base tracking-wider ${
            pitInLaps <= 3
              ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/20"
              : "bg-white/8 text-gray-200 ring-1 ring-white/10"
          }`}>
            PIT IN {pitInLaps}
          </span>
        ) : (
          <span className="text-xs text-gray-600">—</span>
        )}
      </div>
    </div>
  );
};

/* Sub-components */

const PositionBlock = ({ position }: { position: PitwallPositionData | null }) => {
  if (!position || position.overallPosition == null) {
    return <span className="font-black text-lg tracking-tight text-white">— / —</span>;
  }
  const ov = position.overallPosition;
  const cls = position.classPosition;
  return (
    <span className="whitespace-nowrap font-black text-xl tracking-tight text-white">
      P{ov}
      {cls != null && (
        <span className="ml-1 font-bold text-orange-300 text-sm">/ K{cls}</span>
      )}
    </span>
  );
};

const BarItem = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col items-center px-3 py-0.5 min-w-0">{children}</div>
);

const BarSep = () => <span className="h-8 w-px shrink-0 bg-white/8" />;

const BarLabel = ({ children }: { children: string }) => (
  <span className="text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">{children}</span>
);

const BarValue = ({ children, mono }: { children: string; mono?: boolean }) => (
  <span className={`font-bold text-white text-sm leading-tight ${mono ? "font-mono" : ""}`}>{children}</span>
);
