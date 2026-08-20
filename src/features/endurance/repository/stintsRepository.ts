import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance stints repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_stints` (super-admin-only RLS).
 * Geen service-role key, geen fallback.
 */
const TABLE = "endurance_stints" as const;

export type EnduranceStintRow = {
  id: string;
  event_id: string;
  team_id: string;
  driver_id: string | null;
  original_start_at: string;
  original_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  expected_laps: number | null;
  fuel_litres: number | null;
  tyre_change: boolean;
  double_stint: boolean;
  notes: string | null;
  status: "draft" | "confirmed" | "ready" | "in_car" | "completed" | "expired" | "replaced";
  created_at: string;
  updated_at: string;
};

const selectColumns = "id,event_id,team_id,driver_id,original_start_at,original_end_at,actual_start_at,actual_end_at,expected_laps,fuel_litres,tyre_change,double_stint,notes,status,created_at,updated_at";

/** Race Control optimalistische correctie, semantisch delay (minuten) of repair (seconden). */
export type RaceControlOperation = "delay" | "repair" | "complete" | "replace_driver";

/**
 * Relatieve delta die de client naar de database stuurt. De client berekent
 * NOOIT een absolute eindtijd: de server past `deltaMinutes`/`repairSeconds`
 * toe en weigert een stale write wanneer `expectedUpdatedAt` niet overeenkomt
 * met de huidige `updated_at` van de stint.
 */
export type RaceControlDeltaOp = {
  stintId: string;
  operation: RaceControlOperation;
  deltaMinutes: number | null;
  repairSeconds: number | null;
  replacementDriverId: string | null;
  effectiveAt: string | null;
  expectedUpdatedAt: string | null;
};

export type EnduranceRaceControlAuditRow = {
  id: string;
  event_id: string;
  team_id: string;
  stint_id: string;
  actor_id: string;
  operation: RaceControlOperation;
  delta_minutes: number | null;
  repair_seconds: number | null;
  replacement_driver_id: string | null;
  effective_at: string | null;
  expected_updated_at: string | null;
  before_actual_start_at: string | null;
  before_actual_end_at: string | null;
  after_actual_start_at: string | null;
  after_actual_end_at: string | null;
  before_status: EnduranceStintRow["status"];
  after_status: EnduranceStintRow["status"];
  before_driver_id: string | null;
  after_driver_id: string | null;
  created_at: string;
};

/** Expliciete detectie van een optimistic-concurrency-conflict (SQLSTATE 40001). */
export class RaceControlConflictError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RaceControlConflictError";
    this.code = code;
  }
}

/** Plain: alle stints voor een event (+ optioneel team). */
export async function listEnduranceStints(eventId: string, teamId?: string): Promise<EnduranceStintRow[]> {
  assertEnduranceTable(TABLE);
  let query = enduranceClient()
    .from("endurance_stints")
    .select(selectColumns)
    .eq("event_id", eventId);
  if (teamId) query = query.eq("team_id", teamId);
  const { data, error } = await query.order("original_start_at", { ascending: true });
  if (error) throw new Error(`Endurance stints laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceStintRow[];
}

/** Plain: alle endurance-stints (overzichts-tabs). */
export async function listAllEnduranceStints(): Promise<EnduranceStintRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_stints")
    .select(selectColumns)
    .order("original_start_at", { ascending: true });
  if (error) throw new Error(`Endurance stints laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceStintRow[];
}

export type UpsertEnduranceStintInput = {
  id?: string;
  event_id: string;
  team_id: string;
  driver_id?: string | null;
  original_start_at: string;
  original_end_at: string;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  expected_laps?: number | null;
  fuel_litres?: number | null;
  tyre_change?: boolean;
  double_stint?: boolean;
  notes?: string | null;
  status?: EnduranceStintRow["status"];
};

const stintRpcPayload = (input: UpsertEnduranceStintInput, includeId: boolean): Json => ({
  ...(includeId ? { id: input.id ?? null } : {}),
  driver_id: input.driver_id ?? null,
  original_start_at: input.original_start_at,
  original_end_at: input.original_end_at,
  actual_start_at: input.actual_start_at ?? input.original_start_at,
  actual_end_at: input.actual_end_at ?? input.original_end_at,
  expected_laps: input.expected_laps ?? null,
  fuel_litres: input.fuel_litres ?? null,
  tyre_change: input.tyre_change ?? false,
  double_stint: input.double_stint ?? false,
  notes: input.notes ?? null,
  ...(includeId ? { status: input.status ?? "draft" } : {}),
});

/** Plain: maak of werk een stint bij (super-admin-sessie). */
export async function upsertEnduranceStint(input: UpsertEnduranceStintInput): Promise<EnduranceStintRow> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_stints")
    .upsert({
      id: input.id,
      event_id: input.event_id,
      team_id: input.team_id,
      driver_id: input.driver_id ?? null,
      original_start_at: input.original_start_at,
      original_end_at: input.original_end_at,
      actual_start_at: input.actual_start_at ?? input.original_start_at,
      actual_end_at: input.actual_end_at ?? input.original_end_at,
      expected_laps: input.expected_laps ?? null,
      fuel_litres: input.fuel_litres ?? null,
      tyre_change: input.tyre_change ?? false,
      double_stint: input.double_stint ?? false,
      notes: input.notes ?? null,
      status: input.status ?? "draft",
    })
    .select(selectColumns)
    .single();
  if (error) throw new Error(`Endurance stint opslaan mislukt: ${error.message}`);
  return data as EnduranceStintRow;
}

/** Plain: verwijder een stint (super-admin-sessie). */
export async function deleteEnduranceStint(id: string): Promise<void> {
  assertEnduranceTable(TABLE);
  const { error } = await enduranceClient()
    .from("endurance_stints")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`Endurance stint verwijderen mislukt: ${error.message}`);
}

/** Atomair: vervang uitsluitend de conceptplanning van één event/team. */
export async function replaceDraftEnduranceStints(eventId: string, teamId: string, stints: UpsertEnduranceStintInput[]): Promise<EnduranceStintRow[]> {
  const { data, error } = await enduranceClient().rpc("endurance_replace_draft_stints", {
    p_event_id: eventId,
    p_team_id: teamId,
    p_stints: stints.map((stint) => stintRpcPayload(stint, false)),
  });
  if (error) throw new Error(`Conceptplanning vervangen mislukt: ${error.message}`);
  return (data ?? []) as EnduranceStintRow[];
}

/** Atomair: pas één or meer bestaande stints volledig toe. */
export async function applyEnduranceStintUpdates(eventId: string, teamId: string, stints: UpsertEnduranceStintInput[]): Promise<EnduranceStintRow[]> {
  if (stints.some((stint) => !stint.id)) throw new Error("Batchupdate vereist voor iedere stint een id.");
  const { data, error } = await enduranceClient().rpc("endurance_apply_stint_updates", {
    p_event_id: eventId,
    p_team_id: teamId,
    p_stints: stints.map((stint) => stintRpcPayload(stint, true)),
  });
  if (error) throw new Error(`Stintcorrecties opslaan mislukt: ${error.message}`);
  return (data ?? []) as EnduranceStintRow[];
}

/**
 * Race Control (Fase 3B) — optimistic, server-side delta: verschuift één stip
 * met een relatieve delay/repair en weigert een stale write (SQLSTATE 40001)
 * expliciet, zonder silent retry/overwrite.
 */
export async function applyRaceControlDelta(eventId: string, teamId: string, delta: RaceControlDeltaOp): Promise<EnduranceStintRow> {
  if (!delta.stintId) throw new Error("Race Control correctie vereist een stint id.");
  const { data, error } = await enduranceClient().rpc("endurance_race_control_apply", {
    p_event_id: eventId,
    p_team_id: teamId,
    p_stint_id: delta.stintId,
    p_operation: delta.operation,
    p_delta_minutes: delta.deltaMinutes,
    p_repair_seconds: delta.repairSeconds,
    p_replacement_driver_id: delta.replacementDriverId,
    p_effective_at: delta.effectiveAt,
    p_expected_updated_at: delta.expectedUpdatedAt,
  });
  if (error) {
    if (error.code === "40001") {
      throw new RaceControlConflictError(`Race Control conflict: ${error.message}`, error.code);
    }
    throw new Error(`Race Control correctie mislukt: ${error.message}`);
  }
  return data as EnduranceStintRow;
}

/** Append-only Race Control auditleez: uitsluitend via SECURITY DEFINER RPC (manager-scoped). */
export async function listRaceControlAudit(eventId: string): Promise<EnduranceRaceControlAuditRow[]> {
  const { data, error } = await enduranceClient().rpc("endurance_list_race_control_audit", { p_event_id: eventId });
  if (error) throw new Error(`Race Control auditlog laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceRaceControlAuditRow[];
}

/** TanStack Query: stints voor een event/team. */
export function useEnduranceStints(eventId: string, teamId?: string) {
  return useQuery({
    queryKey: ["endurance", "stints", eventId, teamId ?? ""],
    queryFn: () => listEnduranceStints(eventId, teamId),
    enabled: Boolean(eventId),
  });
}

/** TanStack Query: alle endurance-stints (overzichts-tabs). */
export function useAllEnduranceStints() {
  return useQuery({
    queryKey: ["endurance", "stints", "all"],
    queryFn: listAllEnduranceStints,
  });
}

/** TanStack Query: write-hooks voor stints. */
export function useEnduranceStintMutations(eventId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "stints", eventId] });
  const upsert = useMutation({ mutationFn: upsertEnduranceStint, onSettled });
  const remove = useMutation({ mutationFn: deleteEnduranceStint, onSettled });
  const replaceDraft = useMutation({
    mutationFn: ({ teamId, stints }: { teamId: string; stints: UpsertEnduranceStintInput[] }) => replaceDraftEnduranceStints(eventId, teamId, stints),
    onSettled,
  });
  const applyBatch = useMutation({
    mutationFn: ({ teamId, stints }: { teamId: string; stints: UpsertEnduranceStintInput[] }) => applyEnduranceStintUpdates(eventId, teamId, stints),
    onSettled,
  });
  const raceControlApply = useMutation({
    mutationFn: ({ teamId, delta }: { teamId: string; delta: RaceControlDeltaOp }) => applyRaceControlDelta(eventId, teamId, delta),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["endurance", "stints", eventId] });
      queryClient.invalidateQueries({ queryKey: ["endurance", "race-control-audit", eventId] });
    },
  });
  return { upsert, remove, replaceDraft, applyBatch, raceControlApply };
}

/** TanStack Query: append-only Race Control auditlog (manager-scoped RPC). */
export function useRaceControlAudit(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "race-control-audit", eventId],
    queryFn: () => listRaceControlAudit(eventId),
    enabled: Boolean(eventId),
  });
}
