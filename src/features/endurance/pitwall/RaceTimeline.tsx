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

  /* Only show meaningful event types */
  const filtered = events.filter((e) =>
    ["lap_completed", "pit_entry", "pit_exit", "flag_change", "incident_change"].includes(e.event_type)
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">TIMELINE</h3>

      {filtered.length > 0 ? (
        <div className="max-h-36 space-y-1 overflow-y-auto">
          {filtered.slice(0, 15).map((event, i) => (
            <TimelineEvent key={event.event_key ?? i} event={event} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">Geen race-events (vereist V3 events)</p>
      )}

      {plannedStints.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">GEPLAND</div>
          <div className="space-y-0.5 text-xs">
            {plannedStints.slice(0, 4).map((stint) => (
              <div key={stint.id} className="flex gap-2 text-gray-400">
                <span className="font-bold text-gray-300">{stint.driver_id}</span>
                <span>{stint.expected_laps}r</span>
                {stint.tyre_change && <span className="text-orange-500">banden</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const TimelineEvent = ({ event }: { event: PitwallTimelineEvent }) => {
  let icon: string;
  let color: string;
  let detail: string;

  switch (event.event_type) {
    case "lap_completed": {
      icon = "○";
      color = "text-emerald-400";
      const lapTime = event.lap_time_from_deltas_s ?? event.payload?.lastLapTimeSeconds;
      detail = `Lap ${event.completed_laps ?? "?"}${lapTime != null ? ` (${Number(lapTime).toFixed(1)}s)` : ""}`;
      break;
    }
    case "pit_entry":
      icon = "▼";
      color = "text-orange-400";
      detail = `Pit in lap ${event.completed_laps ?? event.lap ?? "?"}`;
      break;
    case "pit_exit":
      icon = "▲";
      color = "text-emerald-400";
      detail = `Pit uit lap ${event.completed_laps ?? event.lap ?? "?"}`;
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
      detail = `${event.event_type}`;
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`${color} font-bold`}>{icon}</span>
      <span className="text-gray-400">{detail}</span>
    </div>
  );
};