import type { PitLossBreakdown, PitServiceInput } from "./types";

/**
 * Pitverlies.
 *
 * In iRacing lopen tanken en banden wisselen parallel: de stop duurt zo lang als
 * de langzaamste bewerking, niet de som. Wie ze optelt, plant stops die in
 * werkelijkheid korter zijn en mist daardoor een window.
 *
 * `pitLaneSeconds` is de vaste tijd van pit-entry tot pit-exit zonder service.
 * Zonder die basis is er geen verlies te berekenen: dan is het antwoord null en
 * niet een gok.
 */
export function computePitLoss(input: PitServiceInput): PitLossBreakdown {
  const { pitLaneSeconds, fuelLitres, secondsPerLitre, tyreSeconds } = input;
  const repairSeconds = input.repairSeconds ?? null;

  const fuel =
    fuelLitres != null && secondsPerLitre != null && fuelLitres > 0
      ? fuelLitres * secondsPerLitre
      : fuelLitres === 0
        ? 0
        : null;

  const diensten: Array<{ naam: "fuel" | "tyre" | "repair"; waarde: number }> = [];
  if (fuel != null) diensten.push({ naam: "fuel", waarde: fuel });
  if (tyreSeconds != null && tyreSeconds > 0) diensten.push({ naam: "tyre", waarde: tyreSeconds });
  if (repairSeconds != null && repairSeconds > 0) diensten.push({ naam: "repair", waarde: repairSeconds });

  const langzaamste = diensten.reduce<{ naam: "fuel" | "tyre" | "repair"; waarde: number } | null>(
    (acc, d) => (acc == null || d.waarde > acc.waarde ? d : acc),
    null,
  );

  const total =
    pitLaneSeconds == null
      ? null
      : pitLaneSeconds + (langzaamste?.waarde ?? 0);

  return {
    total,
    pitLane: pitLaneSeconds,
    fuel,
    tyre: tyreSeconds,
    repair: repairSeconds,
    boundedBy: langzaamste?.naam ?? null,
  };
}
