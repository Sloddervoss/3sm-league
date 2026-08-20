import type { EnduranceOnlyTableName } from "./dataAccess";

export type EnduranceRealtimeFilter = { column: string; value: string };
export type EnduranceRealtimeBinding = {
  table: EnduranceOnlyTableName | "endurance_race_control_audit";
  filter: EnduranceRealtimeFilter;
  queryKeys: unknown[][];
};

const eventBinding = (
  table: EnduranceRealtimeBinding["table"],
  eventId: string,
  queryKeys: unknown[][],
  column = "event_id",
): EnduranceRealtimeBinding => ({ table, filter: { column, value: eventId }, queryKeys });

/** Centrale table → filter → TanStack-query-key matrix voor één eventworkspace. */
export const enduranceRealtimeBindingsForEvent = (
  eventId: string,
  options: { userId?: string } = {},
): EnduranceRealtimeBinding[] => {
  const bindings: EnduranceRealtimeBinding[] = [
    eventBinding("endurance_events", eventId, [["endurance", "events"], ["endurance", "events", eventId]], "id"),
    eventBinding("endurance_registrations", eventId, [["endurance", "registrations", eventId], ["endurance", "registrations", "all"]]),
    eventBinding("endurance_availability", eventId, [["endurance", "availability", eventId]]),
    eventBinding("endurance_pace_entries", eventId, [["endurance", "pace", eventId]]),
    eventBinding("endurance_practice_sessions", eventId, [["endurance", "practice", eventId]]),
    eventBinding("endurance_practice_laps", eventId, [["endurance", "practice", eventId]]),
    eventBinding("endurance_teams", eventId, [["endurance", "teams", eventId], ["endurance", "teams", "all"]]),
    eventBinding("endurance_team_members", eventId, [["endurance", "teams", eventId], ["endurance", "teams", "all"]]),
    eventBinding("endurance_stints", eventId, [["endurance", "stints", eventId], ["endurance", "stints", "all"]]),
    eventBinding("endurance_planning_versions", eventId, [["endurance", "plans", eventId]]),
    eventBinding("endurance_confirmations", eventId, [["endurance", "plans", eventId], ["endurance", "confirmations", eventId]]),
    eventBinding("endurance_race_control_audit", eventId, [["endurance", "race-control-audit", eventId]]),
  ];
  if (options.userId) {
    bindings.push({
      table: "endurance_notifications",
      filter: { column: "user_id", value: options.userId },
      queryKeys: [["endurance", "notifications"]],
    });
  }
  return bindings;
};

export const enduranceRealtimeUserBindings = (userId: string): EnduranceRealtimeBinding[] => [
  {
    table: "endurance_notifications",
    filter: { column: "user_id", value: userId },
    queryKeys: [["endurance", "notifications"]],
  },
  {
    table: "endurance_availability",
    filter: { column: "user_id", value: userId },
    queryKeys: [["endurance", "availability"]],
  },
];

export const enduranceRealtimeWorkspaceTables = (): EnduranceRealtimeBinding["table"][] => [
  "endurance_events",
  "endurance_registrations",
  "endurance_availability",
  "endurance_pace_entries",
  "endurance_practice_sessions",
  "endurance_practice_laps",
  "endurance_teams",
  "endurance_team_members",
  "endurance_stints",
  "endurance_planning_versions",
  "endurance_confirmations",
  "endurance_notifications",
  "endurance_race_control_audit",
];
