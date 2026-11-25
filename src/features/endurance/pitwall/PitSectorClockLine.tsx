import { mapSectorClock, type SectorClock } from "./strategy/sectorClock";

/**
 * Eén regel met de klok van de huidige sector. Verschijnt alleen als het frame
 * een geldige meting meebrengt; verder niets — geen lege balk, geen nul.
 */
export const PitSectorClockLine = ({ raw }: { raw: unknown }) => {
  const clock: SectorClock | null = mapSectorClock(raw);
  if (!clock) return null;
  return (
    <div
      className="mb-2 flex items-center justify-between gap-2 text-[11px]"
      data-sector-clock={clock.index}
      data-sector-learned={clock.learned ? "1" : "0"}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
        Sector {clock.index}/{clock.count}
      </span>
      <span className="flex items-center gap-2">
        {clock.learned && <span className="h-[3px] w-14 overflow-hidden rounded bg-white/10">
          <span
            className="block h-full bg-sky-400"
            style={{ width: `${Math.round(clock.progressPct)}%` }}
          />
        </span>}
        <span className="font-bold text-sky-300">{clock.elapsedSeconds.toFixed(1)} s</span>
      </span>
    </div>
  );
};
