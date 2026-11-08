/**
 * Brandstofscenario's naast de bestaande "tot de finish"-berekening.
 *
 * De bestaande laag zegt hoeveel liter er tot de finish nodig is. Een team aan de
 * muur wil daarnaast drie dingen weten:
 *
 *   1. welk verbruik ik maximaal mag rijden om het met de brandstof die er nu in
 *      zit te halen (het doel),
 *   2. of ik een ronde extra kan doorrijden voordat ik naar binnen moet,
 *   3. hoeveel liter ik tekortkom of overhoud.
 *
 * Alles rekent met dezelfde reserve als `fuelToAddForFinish` (standaard een halve
 * ronde). Ontbreekt een van de invoerwaarden, dan is er geen scenario: liever geen
 * getal dan een getal dat niet klopt.
 */

export const DEFAULT_RESERVE_LAPS = 0.5;

export interface FuelScenarioInput {
  /** Nu in de tank, in liters. */
  fuelLitres: number | null;
  /** Verbruik per ronde; pessimistische schatting uit de meetlaag. */
  perLap: number | null;
  /** Nog te rijden rondes tot de finish. */
  lapsRemaining: number | null;
  /** Tankinhoud, alleen gebruikt om te melden dat een stop niet toereikend is. */
  tankCapacityLitres?: number | null;
  reserveLaps?: number;
}

export type FuelVerdict = "tekort" | "op_schema" | "extra_ronde" | "onbekend";

export interface FuelScenarios {
  /** Maximaal verbruik per ronde om de finish met de huidige tank te halen. */
  targetPerLap: number | null;
  /** Positief = over, negatief = tekort, in liters. */
  surplusLitres: number | null;
  /** Hele rondes die je verder komt dan de finishafstand (0 als geen). */
  extraLaps: number | null;
  /** Liters die één extra ronde kost. */
  fuelPerExtraLap: number | null;
  /** Past het tekort in één tankstop? Null als het tekort of de tank onbekend is. */
  fitsInOneStop: boolean | null;
  /** De gebruikte reserve, zodat de UI hem kan benoemen. */
  reserveLaps: number;
  verdict: FuelVerdict;
  reason: string;
}

const pos = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const round2 = (value: number) => Math.round(value * 100) / 100;

const leeg = (reason: string, reserveLaps = DEFAULT_RESERVE_LAPS): FuelScenarios => ({
  targetPerLap: null,
  surplusLitres: null,
  extraLaps: null,
  fuelPerExtraLap: null,
  fitsInOneStop: null,
  reserveLaps,
  verdict: "onbekend",
  reason,
});

/**
 * Een bovengrens mag nooit door afronding omhoog schuiven: 3,010 L/ronde bij 31,56 L
 * zou meer vragen dan er is. Daarom naar beneden op milliseconden.
 */
const floor3 = (value: number) => Math.floor(value * 1000) / 1000;

export function fuelScenarios(input: FuelScenarioInput): FuelScenarios {
  const { fuelLitres, perLap, lapsRemaining } = input;
  const reserve = typeof input.reserveLaps === "number" && Number.isFinite(input.reserveLaps) && input.reserveLaps >= 0
    ? input.reserveLaps
    : DEFAULT_RESERVE_LAPS;

  if (typeof lapsRemaining !== "number" || !Number.isFinite(lapsRemaining) || lapsRemaining <= 0) {
    return leeg("Geen resterende afstand; scenario's zijn niet te berekenen.", reserve);
  }
  if (!pos(perLap)) {
    return leeg("Geen verbruik per ronde; scenario's zijn niet te berekenen.", reserve);
  }
  // Nul liter is een geldige meting (lege tank), geen ontbrekende invoer.
  if (typeof fuelLitres !== "number" || !Number.isFinite(fuelLitres) || fuelLitres < 0) {
    return leeg("Geen brandstofmeting; scenario's zijn niet te berekenen.", reserve);
  }

  const metReserve = lapsRemaining + reserve;
  const nodig = metReserve * perLap;
  const surplus = fuelLitres - nodig;
  const target = fuelLitres / metReserve;
  // Rondes die de tank nog meegaat, min de afstand die je toch al moet: alleen
  // hele rondes tellen, en nooit negatief.
  const extra = Math.max(0, Math.floor(fuelLitres / perLap - metReserve));
  const tank = input.tankCapacityLitres;
  const fits = surplus >= 0 ? true : pos(tank) ? Math.abs(surplus) <= tank : null;

  if (surplus < 0) {
    const tekort = round2(Math.abs(surplus));
    return {
      targetPerLap: floor3(Math.max(0, target)),
      surplusLitres: -tekort,
      extraLaps: 0,
      fuelPerExtraLap: Math.floor(perLap * 1000) / 1000,
      fitsInOneStop: fits,
      reserveLaps: reserve,
      verdict: "tekort",
      reason: `${tekort.toFixed(1)} L tekort voor de finish bij ${perLap.toFixed(3)} L/ronde.`,
    };
  }

  if (extra >= 1) {
    return {
      targetPerLap: floor3(Math.max(0, target)),
      surplusLitres: round2(surplus),
      extraLaps: extra,
      fuelPerExtraLap: Math.floor(perLap * 1000) / 1000,
      fitsInOneStop: fits,
      reserveLaps: reserve,
      verdict: "extra_ronde",
      reason: `Brandstof voor ${extra} ${extra === 1 ? "ronde" : "rondes"} voorbij de finish; ${round2(surplus).toFixed(1)} L over.`,
    };
  }

  return {
    targetPerLap: floor3(Math.max(0, target)),
    surplusLitres: round2(surplus),
    extraLaps: 0,
    fuelPerExtraLap: Math.floor(perLap * 1000) / 1000,
    fitsInOneStop: fits,
    reserveLaps: reserve,
    verdict: "op_schema",
    reason: `Net voldoende: ${round2(surplus).toFixed(1)} L over, geen hele ronde extra.`,
  };
}
