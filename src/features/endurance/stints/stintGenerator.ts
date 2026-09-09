import { makeId } from "../core/actions";
import type { EnduranceEvent, EnduranceStint, StintPlanningState } from "../core/types";
import { availableUntil, coversAvailability } from "../core/availabilityCoverage";

/**
 * Per-coureur planningsbeperkingen (alle optioneel als de coureur niks kiest).
 * Gebaseerd op de JRES-solver constrainthuis (MIT) → geïmplementeerd als TS-heuristiek.
 */
export interface DriverLimits {
  maxStints?: number | null;
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
  stintCount: number;
}

export const generateStints = (
  state: Pick<StintPlanningState, "teamMembers" | "availability" | "paceEntries">,
  event: EnduranceEvent,
  teamId: string,
  tankMinutes: number,
  options: GenerateStintsOptions = {}
): EnduranceStint[] => {
  const mode = options.mode ?? "race";
  const limits = options.driverLimits ?? {};
  const members = state.teamMembers.filter((member) => member.teamId === teamId && member.role !== "reserve").map((member) => member.userId);
  if (!members.length) return [];
  if (!Number.isFinite(tankMinutes) || tankMinutes < 5) throw new Error("Kies een geldige tankduur van minimaal 5 minuten.");

  const startMs = new Date(event.startAt).getTime();
  const endMs = new Date(event.endAt).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("De race heeft ongeldige start- of eindtijden.");

  // Per-coureur planningstoestand.
  const run: Record<string, Candidate> = {};
  for (const userId of members) {
    const l = limits[userId];
    run[userId] = {
      userId,
      consecutive: 0,
      totalMinutes: 0,
      hasDriven: false,
      stintCount: 0,
      // Coureurs met willingToStart mogen de eerste stint rijden.
      lastEndMs: l?.willingToStart ? startMs - 1 : startMs,
    };
  }

  const result: EnduranceStint[] = [];
  let cursor = startMs;
  let index = 0;
  let prevDriverId: string | null = null;

  // Beschikbaarheid per coureur bepalen (een coureur is "beschikbaar" als er
  // een overlap-blok is, of als er helemaal geen availability-blokken zijn).
  // Beschikbaarheid per coureur: een coureur die GEEN availability-blokken heeft
  // ingesteld is altijd beschikbaar. Heeft hij/zij wél blokken, dan is hij/zij
  // alleen beschikbaar in 'available'/'preferred'-blokken (en dus niet beschikbaar
  // buiten die tijden, bv. in 'unavailable'/'avoid'-gaten).
  const isAvailable = (userId: string, fromMs: number, toMs: number): boolean => {
    const ownBlocks = state.availability.filter((block) => block.eventId === event.id && block.userId === userId);
    return coversAvailability(ownBlocks, userId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  };

  // Startcoureur: expliciet doorgegeven, anders de eerste willingToStart-coureur.
  const firstStintDriver = options.firstStintDriver || members.find((userId) => limits[userId]?.willingToStart);

  while (cursor < endMs) {
    const defaultEndMs = Math.min(endMs, cursor + tankMinutes * 60_000);

    // Kies de minst-belaste coureur die aan alle constraints voldoet (fair-share plust).
    const candidateEnds: Record<string, number> = {};
    const candidatesForThisStint = members.filter((userId) => {
      const c = run[userId];
      const l = limits[userId];
      if (c.stintCount >= (l?.maxStints ?? Infinity)) return false;
      const candidateEnd = availableUntil(state.availability.filter(b => b.eventId === event.id), userId, cursor, Math.min(defaultEndMs,
        cursor + (l?.maxStintMinutes ?? tankMinutes) * 60_000,
        cursor + ((l?.maxTotalMinutes ?? Infinity) - c.totalMinutes) * 60_000));
      candidateEnds[userId] = candidateEnd;
      if (candidateEnd <= cursor || (candidateEnd - cursor < MIN_STINT_MS && candidateEnd !== endMs)) return false;
      if (c.consecutive >= (l?.maxConsecutiveStints ?? 1)) return false;
      // Rest applies between driving blocks, not between tanks in one block.
      if (prevDriverId !== userId && l?.minRestMinutes && c.hasDriven && cursor - c.lastEndMs < l.minRestMinutes * 60_000) return false;
      return isAvailable(userId, cursor, candidateEnd);
    });

    if (!candidatesForThisStint.length) throw new Error(`Geen geldige coureur beschikbaar vanaf ${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" }).format(new Date(cursor))}. Controleer beschikbaarheid, rusttijd en rijlimieten. De bestaande planning blijft behouden.`);
    let pool = candidatesForThisStint;

    // Startcoureur dwingen op stint 0 als die beschikbaar is.
    if (index === 0 && firstStintDriver && pool.includes(firstStintDriver)) {
      pool = [firstStintDriver];
    }

    // Vast-houden: als de coureur die net reed expliciet een maxConsecutiveStints
    // > 1 heeft ingesteld en nog binnen die grens zit (en beschikbaar blijft),
    // laat hem de volgende stint rijden i.p.v. altijd naar de minst-belaste door
    // te roteren. Zo respecteert de planner de wens om 2/3 stints achter elkaar
    // te rijden, en iedereen zonder die instelling blijft gewoon 1-om-1 wisselen.
    // Wanneer de coureur op zijn grens zit (of net pas gereden heeft zonder
    // ingestelde grens, of niet meer beschikbaar) valt hij terug op fair-share.
    let driverId: string | null = null;
    if (prevDriverId) {
      const prev = run[prevDriverId];
      const prevLimit = limits[prevDriverId];
      const wantsContinue = prevLimit?.maxConsecutiveStints != null && prevLimit.maxConsecutiveStints > prev.consecutive;
      if (wantsContinue && pool.includes(prevDriverId)) driverId = prevDriverId;
    }

    // Fair-share (of vastgehouden coureur): kies de coureur met de minste totale rijtijd.
    if (!driverId) {
      let candidate = pool[0];
      let minTotal = Infinity;
      for (const userId of pool) {
        const t = run[userId].totalMinutes;
        if (t < minTotal) { minTotal = t; candidate = userId; }
      }
      driverId = candidate;
    }

    const stintEndMsCapped = candidateEnds[driverId];

    const pace = state.paceEntries.find((entry) => entry.eventId === event.id && entry.userId === driverId)?.averageLapSeconds ?? 0;
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
      expectedLaps: pace > 0 ? Math.floor((stintEndMsCapped - cursor) / 1000 / pace) : 0,
      fuelLitres: 0,
      tyreChange: index % 2 === 1,
      doubleStint: prevDriverId === driverId,
      notes: `Automatisch voorstel (${mode})`,
      status: "draft",
    });

    const c = run[driverId];
    c.consecutive += 1;
    c.stintCount += 1;
    c.totalMinutes += (stintEndMsCapped - cursor) / 60_000;
    c.lastEndMs = stintEndMsCapped;
    c.hasDriven = true;
    // Andere coureurs tellen hun consecutive-stints niet meer mee (switch).
    for (const userId of members) {
      if (userId !== driverId) run[userId].consecutive = 0;
    }

    cursor = stintEndMsCapped;
    prevDriverId = driverId;
    index += 1;
  }
  return result;
};
