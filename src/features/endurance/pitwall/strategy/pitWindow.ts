import type { PitWindow } from "./types";

/**
 * Pitwindow: van welke ronde tot welke ronde je mag stoppen.
 *
 * Een enkele drempel ("pit bij minder dan 1,5 ronde") kan niet tegelijk waar
 * zijn voor "je hebt nog tijd" en "je haalt de finish niet meer". Daarom een
 * venster met twee randen:
 *
 *   - earliest: nu. Je mag altijd naar binnen; de tank bepaalt alleen hoe lang
 *     je hem nog kunt uitstellen.
 *   - latest: de ronde waarin je droogvalt.
 *
 * Daarnaast is er een aparte waarschuwing: `saveRequired`. Die zegt dat je,
 * om met dit aantal stops uit te komen, meer rondes op deze tank moet rijden dan
 * hij aankan. Dat is geen onmogelijk venster maar een spaaropdracht.
 */
export interface PitWindowInput {
  /** Resterende rondes tot de finish. Null bij een tijdrace zonder duur. */
  lapsToFinish: number | null;
  /** Rondes die de huidige tank nog meegaat. */
  lapsOnFuel: number | null;
  /** Rondes die een volle tank meegaat. */
  stintCapacityLaps: number | null;
  lapsCompleted: number;
}

export function computePitWindow(input: PitWindowInput): PitWindow | null {
  const { lapsToFinish, lapsOnFuel, stintCapacityLaps, lapsCompleted } = input;

  if (lapsToFinish == null || lapsOnFuel == null) return null;
  if (stintCapacityLaps == null || stintCapacityLaps <= 0) return null;
  if (lapsToFinish <= 0) return null;

  const stopsRequired = Math.ceil(lapsToFinish / stintCapacityLaps);
  // Rondes die deze tank moet dragen om met ditzelfde aantal stops uit te komen.
  const requiredThisStint = lapsToFinish - (stopsRequired - 1) * stintCapacityLaps;
  const capaciteit = Math.floor(lapsOnFuel);

  return {
    earliestLap: lapsCompleted,
    latestLap: lapsCompleted + capaciteit,
    stopsRequired,
    lapsOnFuel: capaciteit,
    saveRequired: requiredThisStint > capaciteit,
    lapsToSave: Math.max(0, Math.ceil(requiredThisStint - capaciteit)),
  };
}

/** True als de window niet meer bestaat: de tank is al leeg. */
export function windowIsInfeasible(window: PitWindow | null): boolean {
  return window != null && window.earliestLap > window.latestLap;
}
