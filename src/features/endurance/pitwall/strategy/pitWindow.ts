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
 * Het aantal stops telt vanaf nu, dus de brandstof die er nog in zit doet mee.
 * Dat was eerder niet zo: het venster deelde de hele restafstand door de
 * tankinhoud en kwam daardoor één stop te hoog uit. Bij een halfvolle tank in
 * een zesuurrace betekent dat een stop die je niet hoeft te maken.
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

  const capaciteit = Math.floor(lapsOnFuel);

  // Rondes die nog uit tanks gevuld moeten worden, dus zonder wat er nu in zit.
  const teTankenRondes = Math.max(0, lapsToFinish - capaciteit);
  const stopsRequired = Math.ceil(teTankenRondes / stintCapacityLaps);

  // De laatste stop hoeft zelden vol: dat is de short-fill waarmee je gewicht
  // en dus rondetijd spaart.
  const finalStintLaps =
    stopsRequired <= 0 ? 0 : teTankenRondes - (stopsRequired - 1) * stintCapacityLaps;

  return {
    earliestLap: lapsCompleted,
    latestLap: lapsCompleted + capaciteit,
    stopsRequired,
    lapsOnFuel: capaciteit,
    // Sparen kan het aantal stops niet verlagen: het verlengt een stint, maar
    // een stint kan nooit langer dan een volle tank. Wat wél kan is de laatste
    // stop gedeeltelijk vullen; dat staat in finalStintLaps.
    saveRequired: false,
    lapsToSave: 0,
    finalStintLaps,
  };
}

/** True als de window niet meer bestaat: de tank is al leeg. */
export function windowIsInfeasible(window: PitWindow | null): boolean {
  return window != null && window.earliestLap > window.latestLap;
}
