import type { PracticeLapRow } from "../repository/practiceRepository";

/**
 * Practice → pace aggregatie (pure, Fase 3.5).
 * Berekent uit rauwe practice-laps de pace-statistieken voor één coureur,
 * zoals die in `endurance_pace_entries` belanden met source="practice".
 * Handmatig invullen blijft bestaan als fallback (source="manual"); deze functie
 * levert de automatische bron wanneer een coureur wél op practice aanwezig was.
 */
export interface PracticePaceAggregate {
  averageLapSeconds: number | null;
  medianLapSeconds: number | null;
  bestLapSeconds: number | null;
  bestFiveAverageSeconds: number | null;
  consistencySeconds: number | null;
  validLaps: number;
  incidents: number;
  /** Gemiddeld brandstofverbruik per ronde (liters), indien gemeten. */
  fuelPerLapLitres: number | null;
}

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const variance = (values: number[]) => mean(values.map((v) => (v - mean(values)) ** 2));
/** Zoveelste percentage-consistency: 1 = perfect gelijk, 0 = grote spreiding. */
const consistencyScore = (values: number[]) => {
  if (values.length < 2) return 0;
  const sd = Math.sqrt(variance(values));
  const avg = mean(values);
  if (avg <= 0 || !Number.isFinite(sd)) return 0;
  return Math.max(0, Math.min(1, 1 - sd / avg));
};

/**
 * Agregeert de laps van één coureur tot pace-statistieken.
 * Negeert laps zonder geldige tijd én (optioneel) uitbijters >3σ maak niet
 * kapot — we houden het eenvoudig en robuust: neem alle geldige laps.
 */
export function aggregatePracticeLaps(laps: PracticeLapRow[]): PracticePaceAggregate {
  const times = laps
    .map((lap) => lap.lap_seconds)
    .filter((seconds): seconds is number => Number.isFinite(seconds) && seconds > 0);
  if (times.length === 0) {
    return { averageLapSeconds: null, medianLapSeconds: null, bestLapSeconds: null, bestFiveAverageSeconds: null, consistencySeconds: null, validLaps: 0, incidents: 0, fuelPerLapLitres: null };
  }
  const sorted = [...times].sort((a, b) => a - b);
  const bestFive = sorted.slice(0, Math.min(5, sorted.length));
  const fuels = laps.map((lap) => lap.fuel_per_lap_litres).filter((f): f is number => Number.isFinite(f) && f > 0);
  return {
    averageLapSeconds: mean(times),
    medianLapSeconds: median(times),
    bestLapSeconds: sorted[0],
    bestFiveAverageSeconds: mean(bestFive),
    consistencySeconds: consistencyScore(times),
    validLaps: times.length,
    incidents: laps.reduce((s, lap) => s + (lap.incident_count ?? 0), 0),
    fuelPerLapLitres: fuels.length ? mean(fuels) : null,
  };
}
