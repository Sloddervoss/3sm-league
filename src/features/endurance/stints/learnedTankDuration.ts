import { tankMinutesFromSpec, type CarSpec } from "./tankDuration";

/**
 * Tankduur: eerst het archief, dan pas de specificatie.
 *
 * Het archief (punt 8, `endurance_learning_summary`) weet wat deze auto op deze
 * baan werkelijk deed: 104 liter, 2,94 liter per ronde, 95,67 s per ronde →
 * 56,4 minuten. De specificatie kent alleen de tank en een prior voor het
 * verbruik, en zegt met dezelfde getallen 56 minuten — maar op een andere baan
 * of met een andere setup wijkt dat af, en dan is de meting de betere bron.
 *
 * `tankDuration.ts` blijft ongewijzigd de terugval: zonder leerwaarde (te weinig
 * rondes, onbekende auto, archief nog leeg) rekent die zoals voorheen uit
 * tankinhoud, verbruik en rondetijd.
 */
export type LearnedTankSource = "archive" | "spec" | "none";

export type LearnedTankInput = {
  tank_minutes: number | null;
  avg_lap_seconds: number | null;
};

export type ResolvedTankMinutes = {
  minutes: number | null;
  source: LearnedTankSource;
};

const usableMinutes = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/**
 * De planner werkt met hele minuten (stintlengte, validatie, tijdlijn), dus de
 * leerwaarde wordt afgerond zoals `tankMinutesFromSpec` dat ook doet. De ruwe
 * waarde blijft beschikbaar in `EnduranceLearningSummary.tank_minutes`.
 */
export const resolveTankMinutes = (
  learned: LearnedTankInput | null | undefined,
  spec: CarSpec | null,
  fallbackLapSeconds: number | null,
): ResolvedTankMinutes => {
  const fromArchive = usableMinutes(learned?.tank_minutes);
  if (fromArchive !== null) {
    return { minutes: Math.round(fromArchive), source: "archive" };
  }
  // Geen tankduur uit het archief: gebruik de gemeten rondetijd van deze auto op
  // deze baan als die er is, anders de pace die de aanroeper al had.
  const lapSeconds = usableMinutes(learned?.avg_lap_seconds) ?? fallbackLapSeconds;
  const minutes = tankMinutesFromSpec(spec, lapSeconds);
  return minutes === null ? { minutes: null, source: "none" } : { minutes, source: "spec" };
};
