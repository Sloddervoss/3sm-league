import { makeId } from "../core/actions";
import type { EnduranceEvent, EnduranceState, EnduranceStint } from "../core/types";
import { rangesOverlap } from "../core/selectors";

/**
 * Per-coureur planningsbeperkingen (alle optioneel als de coureur niks kiest).
 * Gebaseerd op de JRES-solver constrainthuis (MIT) → geïmplementeerd als TS-heuristiek.
 */
export interface DriverLimits {
  /** Langste stint die deze coureur mag rijden (min). */
  maxStintMinutes?: number | null;
  /** Max totale rijtijd over de hele race (min). */
  maxTotalMinutes?: number | null;
  /** Max aantal OPEENVOLGENDE stints achter elkaar (hard). */
  maxConsecutiveStints?: number | null;
  /** Min rusttijd tussen twee stints van deze coureur (min). */
  minRestMinutes?: number | null;
  /** Wil deze coureur de race starten? */
  willingToStart?: boolean;
}

/** Reeksmodus: 'comfort' respecteert per-coureur limieten; 'race' optimaliseert op tankduur. */
export type StintMode = "comfort" | "race";

export interface GenerateStintsOptions {
  /** Per-coureur rijlijven (key = user_id). */
  driverLimits?: Record<string, DriverLimits>;
  /** comfort = limieten respecteren; race = tank-gebaseerd. */
  mode?: StintMode;
  /** Optionele expliciete startcoureur (user_id). */
  firstStintDriver?: string | null;
  /** Verplichte minimale totale rijtijd per coureur (fair-share, min). */
  fairShareMinutes?: number | null;
}

const MIN_STINT_MS = 5 * 60_000;

interface Candidate {
  userId: string;
  consecutive: number;
  totalMinutes: number;
  lastEndMs: number;
  /** Heeft deze coureur al daadwerkelijk een stint gereden? */
  hasDriven: boolean;
}

export const generateStints = (
  state: EnduranceState,
  event: EnduranceEvent,
  teamId: string,
  tankMinutes: number,
  options: GenerateStintsOptions = {}
): EnduranceStint[] => {
  const mode = options.mode ?? "race";
  const limits = options.driverLimits ?? {};
  const members = state.teamMembers.filter((member) => member.teamId === teamId && member.role !== "reserve").map((member) => member.userId);
  if (!members.length || tankMinutes < 5) return [];

  const startMs = new Date(event.startAt).getTime();
  const endMs = new Date(event.endAt).getTime();

  // Per-coureur planningstoestand.
  const run: Record<string, Candidate> = {};
  for (const userId of members) {
    const l = limits[userId];
    run[userId] = {
      userId,
      consecutive: 0,
      totalMinutes: 0,
      hasDriven: false,
      // Coureurs met willingToStart mogen de eerste stint rijden.
      lastEndMs: l?.willingToStart ? startMs - 1 : startMs,
    };
  }

  const result: EnduranceStint[] = [];
  let cursor = startMs;
  let index = 0;

  // Beschikbaarheid per coureur bepalen (een coureur is "beschikbaar" als er
  // een overlap-blok is, of als er helemaal geen availability-blokken zijn).
  const hasAvailabilityBlocks = state.availability.some((block) => block.eventId === event.id);
  const isAvailable = (userId: string, fromMs: number, toMs: number): boolean => {
    if (!hasAvailabilityBlocks) return true;
    return state.availability.some(
      (block) =>
        block.eventId === event.id &&
        block.userId === userId &&
        ["available", "preferred"].includes(block.type) &&
        rangesOverlap(block.startAt, block.endAt, new Date(fromMs).toISOString(), new Date(toMs).toISOString())
    );
  };

  // Startcoureur: expliciet doorgegeven, anders de eerste willingToStart-coureur.
  const firstStintDriver = options.firstStintDriver || members.find((userId) => limits[userId]?.willingToStart);

  while (cursor < endMs) {
    const defaultEndMs = Math.min(endMs, cursor + tankMinutes * 60_000);

    // Kies de minst-belaste coureur die aan alle constraints voldoet (fair-share plust).
    const candidatesForThisStint = members.filter((userId) => {
      const c = run[userId];
      const l = limits[userId];
      const stintMinutes = (defaultEndMs - cursor) / 60_000;
      // Consecutive-stint limiet (hard) in beide modi.
      if (l?.maxConsecutiveStints && c.consecutive >= l.maxConsecutiveStints) return false;
      // Min rusttijd (hard) in beide modi — maar alleen NADAT deze coureur al
      // een stint gereden heeft. Een coureur met minRest blijft dus wél
      // inzetbaar voor zijn EERSTE stint (anders valt hij/zij in korte races
      // structureel uit ten gunste van dezelfde 1-2 rijders).
      if (l?.minRestMinutes && c.hasDriven && cursor - c.lastEndMs < l.minRestMinutes * 60_000) return false;
      // Per-coureur stintduur + totale limiet (alleen comfort rekt ze niet; race houdt tankduur).
      if (mode === "comfort" && l?.maxStintMinutes && stintMinutes > l.maxStintMinutes) return false;
      if (mode === "comfort" && l?.maxTotalMinutes && c.totalMinutes + stintMinutes > l.maxTotalMinutes) return false;
      // Beschikbaarheid altijd.
      return isAvailable(userId, cursor, defaultEndMs);
    });

    let pool = candidatesForThisStint.length ? candidatesForThisStint : members;

    // Startcoureur dwingen op stint 0 als die beschikbaar is.
    if (index === 0 && firstStintDriver && pool.includes(firstStintDriver)) {
      pool = [firstStintDriver];
    }

    if (mode === "comfort") {
      // Comfort-modus: sluit coureurs uit die we écht niet met hun limieten kunnen plaatsen.
      const viable = pool.filter((userId) => {
        const l = limits[userId];
        const c = run[userId];
        if (l?.maxTotalMinutes && c.totalMinutes + MIN_STINT_MS / 60_000 > l.maxTotalMinutes) return false;
        return true;
      });
      if (viable.length) pool = viable;
    }

    // Fair-share: kies de coureur met de minste totale rijtijd tot nu toe.
    let driverId = pool[0];
    let minTotal = Infinity;
    for (const userId of pool) {
      const t = run[userId].totalMinutes;
      if (t < minTotal) { minTotal = t; driverId = userId; }
    }

    // Stint-eindtijd: cappen op per-coureur stintduur/totale rijtijd in comfort-modus.
    let stintEndMsCapped = defaultEndMs;
    const driverLimit = limits[driverId];
    if (mode === "comfort") {
      if (driverLimit?.maxStintMinutes) stintEndMsCapped = Math.min(stintEndMsCapped, cursor + driverLimit.maxStintMinutes * 60_000);
      if (driverLimit?.maxTotalMinutes) stintEndMsCapped = Math.min(stintEndMsCapped, cursor + (driverLimit.maxTotalMinutes - run[driverId].totalMinutes) * 60_000);
    }
    stintEndMsCapped = Math.max(cursor + MIN_STINT_MS, Math.min(endMs, stintEndMsCapped));

    const pace = state.paceEntries.find((entry) => entry.eventId === event.id && entry.userId === driverId)?.averageLapSeconds ?? 130;
    const startAt = new Date(cursor).toISOString();
    const endAt = new Date(stintEndMsCapped).toISOString();

    result.push({
      id: makeId("stint"),
      eventId: event.id,
      teamId,
      driverId,
      originalStartAt: startAt,
      originalEndAt: endAt,
      actualStartAt: startAt,
      actualEndAt: endAt,
      expectedLaps: Math.max(1, Math.floor((stintEndMsCapped - cursor) / 1000 / pace)),
      fuelLitres: 102,
      tyreChange: index % 2 === 1,
      doubleStint: tankMinutes >= 80,
      notes: `Automatisch voorstel (${mode})`,
      status: "draft",
    });

    const c = run[driverId];
    c.consecutive += 1;
    c.totalMinutes += (stintEndMsCapped - cursor) / 60_000;
    c.lastEndMs = stintEndMsCapped;
    c.hasDriven = true;
    // Andere coureurs tellen hun consecutive-stints niet meer mee (switch).
    for (const userId of members) {
      if (userId !== driverId) run[userId].consecutive = 0;
    }

    cursor = stintEndMsCapped;
    index += 1;
  }
  return result;
};
