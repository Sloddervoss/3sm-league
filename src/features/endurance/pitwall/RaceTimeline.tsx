import type { PitwallTimelineEvent, PitwallPlannedStint } from "./pitwallHelpers";

interface Props {
  events: PitwallTimelineEvent[];
  plannedStints: PitwallPlannedStint[];
}

export const RaceTimeline = ({ events, plannedStints }: Props) => {
  if (events.length === 0 && plannedStints.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">TIMELINE</h3>
        <p className="text-sm text-gray-500">Geen events</p>
      </div>
    );
  }

  /* Only meaningful event types */
  const filtered = events.filter((e) =>
    ["lap_completed", "pit_entry", "pit_exit", "flag_change", "incident_change"].includes(e.event_type)
  ).slice(-20);

  /* Separate last 3 events as "latest" for quick scan */
  const latest = filtered.slice(-3).reverse();
  const history = filtered.slice(0, -3).reverse();

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">TIMELINE</h3>

      {filtered.length > 0 && (
        <>
          {/* Latest events — no scroll */}
          <div className="space-y-0.5 mb-2 pb-2 border-b border-white/5">
            {latest.map((event, i) => (
              <TimelineEvent key={event.event_key ?? `latest-${i}`} event={event} highlight={i === 0} />
            ))}
          </div>

          {/* History — scrollable */}
          {history.length > 0 && (
            <div className="max-h-24 space-y-0.5 overflow-y-auto">
              {history.map((event, i) => (
                <TimelineEvent key={event.event_key ?? `hist-${i}`} event={event} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Planned stints — compact schedule */}
      {plannedStints.length > 0 && (
        <div className="mt-3 pt-2 border-t border-white/5">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">PLAN</div>
          <div className="space-y-0.5 text-xs">
            {plannedStints.slice(0, 4).map((stint) => (
              <div key={stint.id} className="flex gap-2 rounded-lg bg-black/10 px-2 py-1">
                <span className={`font-bold ${stint.status === "in_car" ? "text-orange-400" : "text-gray-300"}`}>
                  {stint.driver_id}
                </span>
                <span className="text-gray-500">{stint.expected_laps}r</span>
                {stint.tyre_change && <span className="text-orange-500">banden</span>}
                {stint.status === "in_car" && <span className="text-orange-400/60">· in de auto</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const TimelineEvent = ({ event, highlight }: { event: PitwallTimelineEvent; highlight?: boolean }) => {
  /* Group pit entry/exit pairs — check if this is pit entry and next event is pit exit at same lap */
  const isPitIn = event.event_type === "pit_entry";

  let icon: string;
  let color: string;
  let detail: string;

  switch (event.event_type) {
    case "lap_completed": {
      icon = "○";
      color = highlight ? "text-emerald-300" : "text-emerald-400/70";
      const lapTime = event.lap_time_from_deltas_s ?? (event.payload?.lastLapTimeSeconds ? Number(event.payload.lastLapTimeSeconds) : null);
      detail = `Lap ${event.completed_laps ?? "?"}${lapTime != null && !isNaN(lapTime) && lapTime > 0 ? ` (${lapTime.toFixed(1)}s)` : ""}`;
      break;
    }
    case "pit_entry":
      icon = "▼";
      color = "text-orange-400";
      detail = `Pit in (r${event.completed_laps ?? event.lap ?? "?"})`;
      break;
    case "pit_exit":
      icon = "▲";
      color = "text-emerald-400";
      detail = `Pit uit (r${event.completed_laps ?? event.lap ?? "?"})`;
      break;
    case "flag_change":
      icon = "⚑";
      color = "text-yellow-400";
      detail = `Vlag: ${event.flag ?? event.payload?.flag ?? "?"}`;
      break;
    case "incident_change":
      icon = "⚠";
      color = "text-red-400";
      detail = `Incidenten: ${event.incidents ?? "?"}`;
      break;
    default:
      icon = "·";
      color = "text-gray-500";
      detail = event.event_type;
  }

  return (
    <div className={`flex items-center gap-2 ${highlight ? "text-sm" : "text-xs"}`}>
      <span className={`${color} font-bold shrink-0`}>{icon}</span>
      <span className={`${highlight ? "text-gray-200" : "text-gray-400"} truncate`}>{detail}</span>
      {event.fuel_added_est_litres != null && (
        <span className="text-[10px] text-gray-500 ml-auto shrink-0">+{event.fuel_added_est_litres}L</span>
      )}
      {event.driver_id && (
        <span className="text-[10px] text-gray-600 shrink-0">{event.driver_id}</span>
      )}
    </div>
  );
};