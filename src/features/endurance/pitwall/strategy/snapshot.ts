import { averageLapSecondsFromLaps } from "./fuelToFinish";
import type { PitwallStrategyRow, V3Normalized } from "../pitwallHelpers";
import type { StrategySnapshot } from "./types";

/**
 * Vertaalt wat de pitwall al binnenkrijgt naar de invoer van de rekenkern.
 *
 * Deze functie is bewust dom: geen fetch, geen formattering, geen aannames over
 * wat "er zou moeten zijn". Wat ontbreekt blijft null, en de motor weigert dan
 * advies in plaats van iets te verzinnen.
 */
export interface SnapshotInput {
  strategy: PitwallStrategyRow | null;
  v3: V3Normalized | null;
  /** Klok waarmee de leeftijd van de meting wordt bepaald. */
  nowMs?: number;
  /** Geplande afstand van het event, als die bekend is. */
  plannedLaps?: number | null;
  plannedDurationMinutes?: number | null;
  /** Gemeten pitverlies-basis; null zolang er geen stop is waargenomen. */
  pitLaneSeconds?: number | null;
  secondsPerLitre?: number | null;
  tyreSeconds?: number | null;
  reserveLaps?: number;
  /** Verbruik per ronde uit eerdere rondes, indien beschikbaar. */
  fuelPerLapSamples?: number[];
  /** Gemeten rondetijden; de mediaan daarvan is de gemiddelde rondetijd. */
  lapTimeSamples?: number[];
  /** Al berekende gemiddelde rondetijd, als de aanroeper die zelf heeft. */
  averageLapSeconds?: number | null;
}

export function buildStrategySnapshot(input: SnapshotInput): StrategySnapshot {
  const { strategy, v3, nowMs = Date.now() } = input;

  const updatedAt = strategy?.updated_at ? Date.parse(strategy.updated_at) : NaN;
  const capturedAt = v3?.capturedAt ? Date.parse(v3.capturedAt) : NaN;
  const laatsteMeting = Number.isFinite(updatedAt)
    ? updatedAt
    : Number.isFinite(capturedAt)
      ? capturedAt
      : null;

  const fuelLitres =
    firstNumber(v3?.fuel?.fuelLitres, strategy?.current_fuel_litres) ?? null;

  const tankCapacity =
    firstNumber(v3?.fuel?.fuelCapacityLitres) ?? null;

  const lapsCompleted =
    firstNumber(v3?.timing?.completedLaps, strategy?.last_completed_laps) ?? 0;

  const prior = firstNumber(
    strategy?.race_fuel_per_lap_litres,
    strategy?.fuel_per_lap_litres,
    v3?.fuel?.fuelPerLapLitres,
  );

  const resterendeSeconden = firstNumber(v3?.session?.sessionTimeRemainingSeconds);

  // Voorkeur voor een aangeleverde gemiddelde rondetijd; anders de mediaan van
  // de gemeten rondetijden. Zonder beide blijft het null en rekent de motor
  // niets uit.
  const gemiddeldeRonde =
    input.averageLapSeconds != null &&
    Number.isFinite(input.averageLapSeconds) &&
    input.averageLapSeconds > 0
      ? input.averageLapSeconds
      : averageLapSecondsFromLaps(input.lapTimeSamples ?? []);

  return {
    raceClockSeconds: firstNumber(v3?.session?.sessionTimeSeconds) ?? 0,
    lapsCompleted,
    currentLapSeconds: firstNumber(v3?.timing?.lastLapTimeSeconds) ?? null,
    // De klok die de connector zelf meestuurt is de enige bron die ook bij een
    // tijdrace zonder geplande duur bestaat.
    sessionTimeRemainingSeconds:
      resterendeSeconden != null && resterendeSeconden >= 0 ? resterendeSeconden : null,
    averageLapSeconds: gemiddeldeRonde,
    fuelLitres: fuelLitres ?? null,
    tankCapacityLitres: tankCapacity ?? null,
    plannedLaps: input.plannedLaps ?? null,
    plannedDurationMinutes: input.plannedDurationMinutes ?? null,
    fuelPerLapSamples: input.fuelPerLapSamples ?? [],
    fuelPerLapPrior: prior ?? null,
    sampleAgeSeconds:
      laatsteMeting == null ? Number.POSITIVE_INFINITY : Math.max(0, (nowMs - laatsteMeting) / 1000),
    pitLaneSeconds: input.pitLaneSeconds ?? null,
    secondsPerLitre: input.secondsPerLitre ?? null,
    tyreSeconds: input.tyreSeconds ?? null,
    reserveLaps: input.reserveLaps,
  };
}

function firstNumber(...waarden: Array<number | null | undefined>): number | null {
  for (const waarde of waarden) {
    if (typeof waarde === "number" && Number.isFinite(waarde)) return waarde;
  }
  return null;
}

/**
 * De server levert samples als rijen met een lap-nummer en een verbruik. De
 * motor wil alleen de getallen, en alleen de bruikbare: een rij zonder waarde
 * of met nul is geen meting maar een gat.
 */
export function fuelPerLapFromSamples(
  rows: Array<{ used: number | null }> | null | undefined,
): number[] {
  if (!rows) return [];
  return rows
    .map((rij) => rij.used)
    .filter((waarde): waarde is number => typeof waarde === "number" && Number.isFinite(waarde) && waarde > 0);
}
