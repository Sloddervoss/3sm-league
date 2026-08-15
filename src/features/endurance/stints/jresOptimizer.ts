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
  // Alle hele-uur-buckets over het (afgeronde) racevenster.
  const hours = buildJresStints(event, 60);
  for (const userId of userIds) {
    const map: Record<string, string> = {};
    const blocks = state.availability.filter((b) => b.eventId === event.id && b.userId === userId);
    // Per coureur: géén eigen blokken = altijd beschikbaar. Alleen coureurs met
    // eigen blokken krijgen 'Available'/'Preferred' in hun blokken en
    // 'Unavailable' daarbuiten (zodat 'niet ingevuld' niet als 'nooit
    // beschikbaar' wordt uitgelegd wanneer een teamgenoot wél blokken heeft).
    for (const s of hours) {
      const k = keyFor(s.startTime);
      if (!blocks.length) {
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
    // De JRES-solver kent één globale consecutiveStints-parameter. We moeten
    // daarin aansluiten bij de GROOTSTE gewenste reeks (anders respecteert de
    // optimizer de 'max stints achter elkaar'-wens van de manager niet: bij een
    // team met min=1 zou iedereen op 1-om-1 worden gezet). De solver egaliseert
    // de workload vanzelf, dus een coureur wil 1 blijft in de praktijk eerlijk
    // verdeeld; wie 2/3 wil kan die reeks daadwerkelijk krijgen.
    consecutiveStints: Math.max(1, maxDefined(memberUserIds.map((u) => driverOpts[u]?.maxConsecutiveStints), 1)),
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

function maxDefined(values: (number | null | undefined)[], fallback: number): number {
  const nums = values.filter((v): v is number => typeof v === "number" && v > 0);
  return nums.length ? Math.max(...nums) : fallback;
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
 * Post-correctie na de JRES-berekening. JRES kent maar ÉÉN globale
 * `consecutiveStints` (we zetten die op het MAX van de wensen zodat wie 2/3 wil
 * het ook kan rijden) — maar daardoor kan een coureur met een STRENGERE eigen
 * limiet (max 1) tóch 2/3 achter elkaar krijgen. Deze stap herverdeelt die
 * overtollige, aaneengesloten stints naar een andere teamcoureur die (a) nog
 * binnen zijn eigen limiet zit en (b) beschikbaar is. Zo handhaaft het eindresultaat
 * per coureur de gewenste reeks zonder dat de optimizer globale keuze wordt opgeheven.
 */
export function enforceConsecutiveLimits(
  stints: EnduranceStint[],
  driverOpts: MarshalOptions["driverOpts"],
  availability: Record<string, Record<string, string>>,
  userIds: string[]
): EnduranceStint[] {
  if (!driverOpts) return stints;
  const sorted = [...stints].sort((a, b) => a.actualStartAt.localeCompare(b.actualStartAt));
  const result: EnduranceStint[] = [];
  let runDriver: string | null = null;
  let runCount = 0;

  const availAt = (userId: string, startAt: string): boolean => {
    const key = keyFor(startAt);
    const map = availability[userId];
    if (!map) return true; // geen blokken = altijd beschikbaar
    return map[key] !== "Unavailable";
  };

  for (const stint of sorted) {
    const limit = driverOpts[stint.driverId]?.maxConsecutiveStints;
    const same = stint.driverId === runDriver;
    const nextRunCount = same ? runCount + 1 : 1;
    const exceeds = Boolean(limit != null && limit > 0 && nextRunCount > limit);

    if (exceeds && runDriver) {
      // Zoek een vervanger: ander lid, binnen beperking, beschikbaar, met de
      // minste workload tot nu toe (voorkeur voor de rustigste).
      let replacement: string | null = null;
      let bestTotal = Infinity;
      for (const candidate of userIds) {
        if (candidate === runDriver) continue;
        const cl = driverOpts[candidate]?.maxConsecutiveStints;
        const cAllowed = cl == null || cl === 0 || cl >= 1; // elke coureur mag op z'n minst 1
        if (!cAllowed) continue;
        if (!availAt(candidate, stint.actualStartAt)) continue;
        const total = result.filter((s) => s.driverId === candidate).length;
        if (total < bestTotal) { bestTotal = total; replacement = candidate; }
      }
      if (replacement) {
        result.push({ ...stint, driverId: replacement, notes: `${stint.notes ?? "Optimale planning (JRES/HiGHS)"} · gecorrigeerd` });
        // run van de vervanger moet opnieuw geteld worden vanaf deze stint
        runDriver = replacement;
        runCount = 1;
        continue;
      }
    }

    result.push(stint);
    runDriver = same ? runDriver : stint.driverId;
    runCount = nextRunCount;
  }
  return result;
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
  const parsedStints = parseJresOutput(result.output as JresOutput, event, teamId);
  if (!parsedStints.length) return { ok: false, message: "Optimalisatie leverde geen stints op.", stints: [] };
  // Post-correctie: respecteer per coureur de eigen maxConsecutiveStints (JRES
  // kent maar één globale waarde; die overtollige aaneengesloten stints worden
  // herverdeeld naar een beschikbare teamgenoot binnen diens limiet).
  const stints = enforceConsecutiveLimits(
    parsedStints,
    options.driverOpts,
    input.availability,
    memberUserIds
  );
  return { ok: true, message: `Optimale planning opgehaald (${stints.length} stints).`, stints };
}
