import type { PitwallStrategyRow, PitwallPlannedStint } from "./pitwallHelpers";
import { PitwallPanel } from "./PitwallPanel";

interface Props {
  strategy: PitwallStrategyRow | null;
  plannedStints: PitwallPlannedStint[];
  driverName: string | null;
  currentStint?: PitwallPlannedStint;
}

/**
 * Coureur & wissel — alleen in de endurance-pitwall.
 *
 * NU, VOLGENDE en DAARNA, met de geplande bandenwissel als losse regel en
 * alleen wanneer `tyre_change` dat zegt. Geen bevestigingsvinkjes: een geplande
 * rijder is niet automatisch bevestigd. `current_stint_valid_sample_count` is
 * een teller van geldige samples, geen gereden afstand.
 */
export const StintDriverPanel = ({ strategy, plannedStints, driverName, currentStint }: Props) => {
  const current = currentStint;
  const rest = plannedStints?.filter((s) => s.id !== current?.id);
  const firstNext = rest?.[0];
  const secondNext = rest?.[1];

  if (!strategy || !current) {
    return (
      <PitwallPanel title="Coureur & wissel" slot="driver">
        <p className="text-[12px] text-slate-500">Geen data</p>
      </PitwallPanel>
    );
  }

  const stintLaps = strategy.current_stint_valid_sample_count ?? null;

  return (
    <PitwallPanel title="Coureur & wissel" slot="driver" meta="alleen endurance">
      <div data-pitwall-driver-current="true">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Nu</p>
        <p className="mt-1 truncate font-heading text-[22px] font-black leading-tight text-white">
          {driverName ?? current?.driver_id ?? "—"}
        </p>
        {stintLaps != null && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            {stintLaps} geldige samples{current?.expected_laps ? ` · max ${current.expected_laps} ronden` : ""}
          </p>
        )}
      </div>

      {firstNext && (
        <div className="mt-3 border-t border-[#161C27] pt-2.5" data-pitwall-driver-next="true">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Volgende</p>
          <p className="mt-1 truncate font-heading text-[16px] font-bold leading-tight text-orange-300">{firstNext.driver_id}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{firstNext.expected_laps} ronden gepland</p>
          {firstNext.tyre_change && (
            <p
              className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-orange-500/30 bg-orange-500/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-300"
              data-pitwall-tyre-change="true"
            >
              Bandenwissel gepland
            </p>
          )}
        </div>
      )}

      {secondNext && (
        <p className="mt-2 text-[11px] text-slate-500">
          Daarna: <span className="font-semibold text-slate-300">{secondNext.driver_id}</span>
          <span> · {secondNext.expected_laps} ronden</span>
        </p>
      )}

      {rest && rest.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 border-t border-[#161C27] pt-2 text-[11px] text-slate-500">
          {rest.slice(0, 4).map((stint) => (
            <span key={stint.id}>
              <span className="font-semibold text-slate-400">{stint.driver_id}</span>
              <span> {stint.expected_laps}r</span>
              {stint.tyre_change && <span className="text-orange-400"> ⚡</span>}
            </span>
          ))}
        </div>
      )}
    </PitwallPanel>
  );
};
