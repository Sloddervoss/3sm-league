import type { EnduranceEvent, EnduranceState, EnduranceStint } from "../core/types";
import { makeId } from "../core/actions";

/**
 * Marshallt een 3SM endurance race-model naar het JRES-solver (C++) JSON-input-formaat.
 * Alleen pure vertaling — geen netwerk/DB. Dit maakt de optimalisatie-microservice
 * afroepbaar zonder dat de StintPlanner iets van de JRES-spec hoeft te weten.
 *
 * Belangrijke JRES-formaat-afspraken (uit de aan auteurs geverifieerde data):
 *  - Beschikbaarheid per uur-UTC-key: "YYYY-MM-DDTHH:00:00.000Z" = Available|Preferred|Unavailable.
 *  - Stints zijn vaste segmenten (input); de solver verdeelt coureurs/spotters erover.
 *  - "success": true wordt door de solver geaccepteerd maar is triviaal.
 */

export interface JresInputMember {
  name: string;
  isDriver: boolean;
  isSpotter: boolean;
  tzOffset: number;
}

export interface JresInput {
  success: boolean;
  consecutiveStints: number;
  minimumRestHours: number;
  maximumBusyHours: number;
  firstStintDriver?: string | null;
  teamMembers: JresInputMember[];
  stints: { id: number; startTime: string; endTime: string }[];
  availability: Record<string, Record<string, string>>;
}

export interface DriverOpts {
  isSpotter?: boolean;
  isDriver?: boolean;
  maxConsecutiveStints?: number | null;
  minRestMinutes?: number | null;
  maxTotalMinutes?: number | null;
  willingToStart?: boolean;
}

/** In te stellen: waar de optimizer-microservice bereikbaar is (edge function proxy). */
export type OptimizerFetcher = (input: unknown, options: Record<string, unknown>) => Promise<{ status: "ok" | "infeasible" | "error" | string; output?: unknown; error?: string }>;

export interface MarshalOptions {
  /** Per-coureur JRES-gerelateerde opties (key = user_id). */
  driverOpts?: Record<string, DriverOpts>;
  tankMinutes: number;
  /** Optionele expliciete startcoureur (user_id). */
  firstStintDriver?: string | null;
}

/** Alias zodat StintPlanner's driverLimits (met maxStint/min/maxTotal velden) doorgegeven kan worden. */
export type DriverLimitsAsOpts = Record<string, DriverOpts>;

/** Vaste segmenten over de raceduur van ~tankMinutes lang (JRES neemt stints als input).
 *  BELANGRIJK (uit end-to-end deploys testen): de JRES-solver vereist dat
 *  stints[].id een INTEGER is (geen string) — anders crasht hij met
 *  "free(): invalid pointer" (heap). Ook discretiseert hij op HELE uren en
 *  crasht als een stint halve-uur-grenzen of ongedekte availability-buckets raakt.
 *  Daarom: numerieke id's, segmenten op hele uren, availability per heel uur. */
export function buildJresStints(event: EnduranceEvent, tankMinutes: number): { id: number; startTime: string; endTime: string }[] {
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  // Rond het racevenster af naar hele uren (JRES vereist uurlijkse discretisatie).
  const startRounded = Math.ceil(start / 3_600_000) * 3_600_000;
  const endRounded = Math.floor(end / 3_600_000) * 3_600_000;
  if (endRounded <= startRounded) return [];
  const step = Math.max(3_600_000, Math.round((tankMinutes * 60_000) / 3_600_000) * 3_600_000);
  const segs: { id: number; startTime: string; endTime: string }[] = [];
  let cursor = startRounded;
  let i = 1;
  while (cursor < endRounded) {
    const next = Math.min(endRounded, cursor + step);
    // id als INTEGER (JRES verwacht int; string id veroorzaakt heap-crash).
    segs.push({ id: i, startTime: new Date(cursor).toISOString(), endTime: new Date(next).toISOString() });
    cursor = next;
    i += 1;
  }
  return segs;
}

/** Vult beschikbaarheid per coureur vanuit endurance_availability naar uurkeys.
 *  Belangrijk: de JRES-solver vereist dat de availability ALLE start-uur-buckets
 *  van de stints dekt, anders crasht hij (heap). Daarom wordt beschikbaarheid
 *  per heel-uur-bucket over het hele racevenster gegenereerd (niet alleen de
 *  start-uren van de input-stints), zodat elke mogelijke stintstart gedekt is. */
export function buildJresAvailability(state: EnduranceState, event: EnduranceEvent, userIds: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const anyBlocks = state.availability.some((b) => b.eventId === event.id);
  // Alle hele-uur-buckets over het (afgeronde) racevenster.
  const hours = buildJresStints(event, 60);
  for (const userId of userIds) {
    const map: Record<string, string> = {};
    const blocks = state.availability.filter((b) => b.eventId === event.id && b.userId === userId);
    for (const s of hours) {
      const k = keyFor(s.startTime);
      if (!anyBlocks) {
        map[k] = "Available";
      } else {
        const hit = blocks.find((b) => overlap(b, s.startTime, s.endTime));
        map[k] = !hit ? "Unavailable" : hit.type === "preferred" ? "Preferred" : "Available";
      }
    }
    out[userId] = map;
  }
  return out;
}

/** Rondt een ISO-tijd af op het hele uur (JRES-key). */
export function keyFor(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function overlap(block: { startAt: string; endAt: string }, a: string, b: string): boolean {
  return new Date(block.startAt).getTime() < new Date(b).getTime() && new Date(block.endAt).getTime() > new Date(a).getTime();
}

/**
 * Bouwt het volledige JRES-input-object voor een team.
 * members = actieve teamleden (userIds). firstStintDriver uit opties of willingToStart.
 */
export function marshalJresInput(
  state: EnduranceState,
  event: EnduranceEvent,
  memberUserIds: string[],
  options: MarshalOptions
): JresInput {
  const tankMinutes = options.tankMinutes;
  const driverOpts = options.driverOpts ?? {};
  const teamMembers = memberUserIds.map((uid) => ({
    name: uid,
    isDriver: driverOpts[uid]?.isDriver !== false,
    isSpotter: driverOpts[uid]?.isSpotter ?? false,
    tzOffset: 0,
  }));
  const first = options.firstStintDriver ?? memberUserIds.find((uid) => driverOpts[uid]?.willingToStart) ?? null;
  return {
    success: true,
    consecutiveStints: Math.max(1, minDefined(memberUserIds.map((u) => driverOpts[u]?.maxConsecutiveStints), 1)),
    minimumRestHours: Math.max(0, (minDefined(memberUserIds.map((u) => driverOpts[u]?.minRestMinutes), 0) ?? 0) / 60),
    maximumBusyHours: 8,
    firstStintDriver: first,
    teamMembers,
    stints: buildJresStints(event, tankMinutes),
    availability: buildJresAvailability(state, event, memberUserIds),
  };
}

function minDefined(values: (number | null | undefined)[], fallback: number): number {
  const nums = values.filter((v): v is number => typeof v === "number" && v > 0);
  return nums.length ? Math.min(...nums) : fallback;
}

export interface JresScheduleEntry {
  id: number;
  startTime: string;
  endTime: string;
  driver: string;
  spotter?: string;
}

export interface JresOutput {
  schedule: JresScheduleEntry[];
  diagnosis?: string[];
  stats?: { modelRows?: number; modelColumns?: number; finalGap?: number; driverSolveDurationMs?: number };
}

/** Vertaalt JRES-schedule terug naar EnduranceStint[] (draft). */
export function parseJresOutput(output: JresOutput, event: EnduranceEvent, teamId: string): EnduranceStint[] {
  return (output?.schedule ?? []).map((entry) => {
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    const pace = 130;
    return {
      id: makeId("stint"),
      eventId: event.id,
      teamId,
      driverId: entry.driver,
      originalStartAt: entry.startTime,
      originalEndAt: entry.endTime,
      actualStartAt: entry.startTime,
      actualEndAt: entry.endTime,
      expectedLaps: Math.max(1, Math.floor((end - start) / 1000 / pace)),
      fuelLitres: 102,
      tyreChange: false,
      doubleStint: false,
      notes: "Optimale planning (JRES/HiGHS)",
      status: "draft",
    };
  });
}

export interface OptimizeResult {
  ok: boolean;
  message: string;
  stints: EnduranceStint[];
}

/**
 * Orkestreert de optimizer-stap voor een team, puur en testbaar:
 * marshall → fetcher → parse. Event/model-agnostisch in/uit.
 */
export async function runOptimize(
  state: EnduranceState,
  event: EnduranceEvent,
  memberUserIds: string[],
  teamId: string,
  options: { tankMinutes: number; driverOpts?: MarshalOptions["driverOpts"]; firstStintDriver?: MarshalOptions["firstStintDriver"]; spotterMode?: string; timeLimit?: number },
  fetcher: OptimizerFetcher
): Promise<OptimizeResult> {
  if (!memberUserIds.length || options.tankMinutes < 5) {
    return { ok: false, message: "Voeg eerst coureurs toe aan deze auto.", stints: [] };
  }
  const input = marshalJresInput(state, event, memberUserIds, {
    tankMinutes: options.tankMinutes,
    driverOpts: options.driverOpts,
    firstStintDriver: options.firstStintDriver,
  });
  const result = await fetcher(input, { timeLimit: options.timeLimit ?? 20, spotterMode: options.spotterMode ?? "none" });
  if (result.status === "error") return { ok: false, message: `Optimalisatie mislukt: ${result.error ?? "onbekende fout"}`, stints: [] };
  if (result.status === "infeasible") return { ok: false, message: "Geen geldige planning mogelijk (constraints conflicteren). Pas limieten aan.", stints: [] };
  if (!result.output) return { ok: false, message: "Optimalisatie gaf geen planning terug.", stints: [] };
  const stints = parseJresOutput(result.output as JresOutput, event, teamId);
  if (!stints.length) return { ok: false, message: "Optimalisatie leverde geen stints op.", stints: [] };
  return { ok: true, message: `Optimale planning opgehaald (${stints.length} stints).`, stints };
}
