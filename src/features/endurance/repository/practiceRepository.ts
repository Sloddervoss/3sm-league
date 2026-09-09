import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance practice-sessie repository — Fase 3.5 (raamwerk).
 * Schrijft/leest uitsluitend `endurance_practice_sessions` en
 * `endurance_practice_laps` (super-admin-only RLS). Deze laag biedt de
 * manager-knop (start/beëindig een sessie); de SimHub-opname koppelt later aan
 * door laps in te vullen voor de actieve sessie van een event.
 */
const SESSION_TABLE = "endurance_practice_sessions" as const;
const LAP_TABLE = "endurance_practice_laps" as const;

export type PracticeSessionRow = {
  id: string;
  event_id: string;
  team_id: string | null;
  label: string;
  conditions?: "dry" | "wet";
  started_at: string;
  ended_at: string | null;
  requires_registered: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PracticeLapRow = {
  id: string;
  session_id: string;
  event_id: string;
  user_id: string | null;
  car_id: string | null;
  circuit: string | null;
  lap_seconds: number;
  fuel_used_litres: number | null;
  fuel_per_lap_litres: number | null;
  incident_count: number;
  recorded_at: string;
};

const sessionColumns = "id,event_id,team_id,label,conditions,started_at,ended_at,requires_registered,created_by,created_at,updated_at";
const lapColumns = "id,session_id,event_id,user_id,car_id,circuit,lap_seconds,fuel_used_litres,fuel_per_lap_litres,incident_count,recorded_at";

/** Plain: de actiefste (niet gesloten) practice-sessies voor een event. */
export async function listEndurancePracticeSessions(eventId: string): Promise<PracticeSessionRow[]> {
  assertEnduranceTable(SESSION_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_practice_sessions")
    .select(sessionColumns)
    .eq("event_id", eventId)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`Endurance practice-sessies laden mislukt: ${error.message}`);
  return (data ?? []) as PracticeSessionRow[];
}

/** Plain: laps voor een sessie. */
export async function listEndurancePracticeLaps(sessionId: string): Promise<PracticeLapRow[]> {
  assertEnduranceTable(LAP_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_practice_laps")
    .select(lapColumns)
    .eq("session_id", sessionId)
    .order("recorded_at", { ascending: true });
  if (error) throw new Error(`Endurance practice-rondes laden mislukt: ${error.message}`);
  return (data ?? []) as PracticeLapRow[];
}

export type CreatePracticeSessionInput = {
  event_id: string;
  team_id?: string | null;
  label?: string;
  conditions?: "dry" | "wet";
  requires_registered?: boolean;
  created_by?: string | null;
};

/** Plain: start een practice-sessie. */
export async function createEndurancePracticeSession(input: CreatePracticeSessionInput): Promise<PracticeSessionRow> {
  assertEnduranceTable(SESSION_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_practice_sessions")
    .insert({
      event_id: input.event_id,
      team_id: input.team_id ?? null,
      conditions: input.conditions ?? "dry",
      label: input.label ?? "Practice",
      requires_registered: input.requires_registered ?? true,
      created_by: input.created_by ?? null,
    })
    .select(sessionColumns)
    .single();
  if (error) throw new Error(`Endurance practice-sessie starten mislukt: ${error.message}`);
  return data as PracticeSessionRow;
}

/** Plain: sluit een practice-sessie (ended_at). */
export async function closeEndurancePracticeSession(sessionId: string): Promise<void> {
  assertEnduranceTable(SESSION_TABLE);
  const { error } = await enduranceClient()
    .from("endurance_practice_sessions")
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(`Endurance practice-sessie sluiten mislukt: ${error.message}`);
}

/** TanStack Query: practice-sessies + laps voor een event. */
export function useEndurancePracticeWorkspace(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "practice", eventId],
    queryFn: async () => {
      const sessions = await listEndurancePracticeSessions(eventId);
      const lapsBySession: Record<string, PracticeLapRow[]> = {};
      for (const session of sessions.slice(0, 20)) {
        lapsBySession[session.id] = await listEndurancePracticeLaps(session.id);
      }
      return { sessions, lapsBySession };
    },
    enabled: Boolean(eventId),
  });
}

/** TanStack Query: starten + sluiten. */
export function useEndurancePracticeMutations(eventId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "practice", eventId] });
  const start = useMutation({
    mutationFn: (input: Omit<CreatePracticeSessionInput, "event_id">) => createEndurancePracticeSession({ ...input, event_id: eventId }),
    onSettled,
  });
  const close = useMutation({ mutationFn: closeEndurancePracticeSession, onSettled });
  return { start, close };
}

/**
 * Koppelt practice-laps van een sessie door naar pace-entries (source="practice").
 * Voor elke coureur met geldige laps in de sessie wordt één pace-entry geschreven
 * of bijgewerkt (per circuit/configuratie/auto), berekend uit de gemsurde laps.
 * Handmatig ingevulde pace blijft onaangeroerd (source="manual").
 */
export async function syncPracticeSessionToPace(
  sessionId: string,
  race: { event_id: string; circuit: string; configuration: string; car: string }
): Promise<number> {
  const { data, error } = await enduranceClient().rpc("endurance_sync_practice_pace", { p_session_id: sessionId, p_car_alias: race.car });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
