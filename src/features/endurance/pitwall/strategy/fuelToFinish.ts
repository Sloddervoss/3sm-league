import { median } from "./fuelModel";
import type {
  FuelToFinishEstimate,
  FuelToFinishInput,
  FuelToFinishReason,
} from "./types";

/**
 * Brandstof tot de finish, gerekend uit tijd in plaats van rondes.
 *
 * De strategierij vult `fuel_to_finish_litres` alleen als de connector een
 * betrouwbaar `sessionLapsRemaining` levert. Bij een tijdrace is dat veld leeg
 * (122 van de 139 catalogus-events), dus stond het getal permanent op null
 * terwijl de resterende sessietijd en het verbruik er wel waren.
 *
 * Daarom rekenen we het hier zelf uit:
 *
 *     liters = (resterende seconden / gemiddelde rondetijd) * verbruik per ronde
 *
 * De tank is de bovengrens voor wat er in één keer bij kan, niet voor de
 * resterende afstand: over vier uur is de behoefte groter dan één tank, en dat
 * mag je niet wegpoetsen. Daarom staan `litres` (de hele afstand) en
 * `litresWithinTank` (wat er nu bij past) naast elkaar.
 *
 * Ontbreekt er invoer, dan is er geen getal. Een half ingevulde formule levert
 * geen schatting maar een verzinsel.
 */

const leeg = (reasonCode: FuelToFinishReason, reason: string): FuelToFinishEstimate => ({
  lapsRemaining: null,
  litres: null,
  litresWithinTank: null,
  sufficient: null,
  reasonCode,
  reason,
});

const positief = (waarde: number | null | undefined): waarde is number =>
  typeof waarde === "number" && Number.isFinite(waarde) && waarde > 0;

/** Rondt op twee decimalen: genoeg voor liters, geen ruis in de tests. */
const afronden = (waarde: number): number => Math.round(waarde * 100) / 100;

/**
 * Gemiddelde rondetijd uit gemeten rondetijden.
 *
 * Mediaan in plaats van gemiddelde: één pit- of uitloopronde van 363 s mag het
 * beeld niet bepalen. Rondes zonder bruikbare tijd tellen niet mee.
 */
export function averageLapSecondsFromLaps(
  lapSeconds: ReadonlyArray<number | null | undefined> | null | undefined,
): number | null {
  if (!lapSeconds) return null;
  const bruikbaar = lapSeconds.filter(positief);
  if (bruikbaar.length === 0) return null;
  return median(bruikbaar);
}

export function estimateFuelToFinish(input: FuelToFinishInput): FuelToFinishEstimate {
  const { remainingSeconds, averageLapSeconds, fuelPerLap } = input;

  if (typeof remainingSeconds !== "number" || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
    return leeg(
      "no_time_remaining",
      "Geen resterende sessietijd; brandstof tot de finish is niet te berekenen.",
    );
  }

  if (!positief(averageLapSeconds)) {
    return leeg(
      "no_average_lap",
      "Geen gemiddelde rondetijd; brandstof tot de finish is niet te berekenen.",
    );
  }

  if (!positief(fuelPerLap)) {
    return leeg("no_consumption", "Geen verbruik per ronde; brandstof tot de finish is niet te berekenen.");
  }

  const rondes = remainingSeconds / averageLapSeconds;
  const litres = afronden(rondes * fuelPerLap);
  const tank = input.tankCapacityLitres;

  return {
    lapsRemaining: Math.ceil(rondes),
    litres,
    litresWithinTank: positief(tank) ? Math.min(litres, tank) : null,
    // Nul liter is een geldige meting (lege tank) en dus "niet voldoende",
    // geen ontbrekende invoer.
    sufficient:
      typeof input.fuelLitres === "number" && Number.isFinite(input.fuelLitres)
        ? input.fuelLitres >= litres
        : null,
    reasonCode: "ok",
    reason:
      remainingSeconds === 0
        ? "De sessie is afgelopen; er hoeft geen brandstof meer bij."
        : `${Math.ceil(rondes)} ${Math.ceil(rondes) === 1 ? "ronde" : "rondes"} te gaan bij ${Math.round(averageLapSeconds)} s per ronde: ${litres.toFixed(1)} L nodig.`,
  };
}
