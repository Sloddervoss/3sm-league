import type { PitwallTimelineEvent, PitwallPlannedStint } from "./pitwallHelpers";

interface Props {
  events: PitwallTimelineEvent[];
  plannedStints: PitwallPlannedStint[];
}

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  lap_completed: { icon: "○", color: "text-emerald-400/80" },
  pit_entry: { icon: "▼", color: "text-orange-400" },
  pit_exit: { icon: "▲", color: "text-emerald-400" },
  flag_change: { icon: "⚑", color: "text-yellow-400" },
  incident_change: { icon: "⚠", color: "text-red-400" },
};

export const RaceTimeline = ({ events, plannedStints }: Props) => {
  if (events.length === 0 && plannedStints.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">TIMELINE</div>
        <p className="text-xs text-gray-500">Geen events</p>
      </div>
    );
  }

  const filtered = events
    .filter((e) => ["lap_completed", "pit_entry", "pit_exit", "flag_change", "incident_change"].includes(e.event_type))
    .slice(-20);

  const latest3 = filtered.slice(-3).reverse();
  const history = filtered.slice(0, -3).reverse();

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">TIMELINE</div>

      {filtered.length > 0 && (
        <>
          {/* LATEST — bold, no scroll */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-2 pb-1.5 border-b border-white/5">
            {latest3.map((event, i) => (
              <EventItem key={event.event_key ?? `latest-${i}`} event={event} prominent={i === 0} />
            ))}
          </div>

          {/* HISTORY — compact scroll */}
          {history.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 max-h-16 overflow-y-auto mb-2">
              {history.map((event, i) => (
                <EventItem key={event.event_key ?? `hist-${i}`} event={event} />
              ))}
            </div>
          )}
        </>
      )}

      {/* GEPLAND */}
      {plannedStints.length > 0 && (
        <div className="pt-1.5 border-t border-white/5">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">PLAN</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
            {plannedStints.slice(0, 4).map((stint) => (
              <span key={stint.id} className={`${stint.status === "in_car" ? "text-orange-400" : "text-gray-400"}`}>
                <span className="font-bold">{stint.driver_id}</span>
                <span className="text-gray-500"> {stint.expected_laps}r</span>
                {stint.tyre_change && <span className="text-orange-500"> ⚡</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const EventItem = ({ event, prominent }: { event: PitwallTimelineEvent; prominent?: boolean }) => {
  const meta = EVENT_ICONS[event.event_type] ?? { icon: "·", color: "text-gray-500" };

  let detail: string;
  switch (event.event_type) {
    case "lap_completed": {
      const lapTime = event.lap_time_from_deltas_s ?? (event.payload?.lastLapTimeSeconds ? Number(event.payload.lastLapTimeSeconds) : null);
      detail = `L${event.completed_laps ?? "?"}${lapTime != null && lapTime > 0 ? ` ${lapTime.toFixed(1)}s` : ""}`;
      break;
    }
    case "pit_entry":
      detail = `▼ r${event.completed_laps ?? event.lap ?? "?"}`;
      break;
    case "pit_exit":
      detail = `▲ r${event.completed_laps ?? event.lap ?? "?"}${event.fuel_added_est_litres != null ? ` +${event.fuel_added_est_litres}L` : ""}`;
      break;
    default:
      detail = `${event.event_type}`;
  }

  return (
    <span className={`inline-flex items-center gap-1 ${prominent ? "text-xs" : "text-[10px]"}`}>
      <span className={`${meta.color} font-bold shrink-0`}>{meta.icon}</span>
      <span className={`${prominent ? "text-gray-200" : "text-gray-500"} truncate`}>{detail}</span>
    </span>
  );
};