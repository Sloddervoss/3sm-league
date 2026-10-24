/**
 * Tankduur uit de autospecificatie en de gemeten pace.
 *
 * De planner had een vast rijtje van 45, 60 of 90 minuten. Geen daarvan klopt
 * voor een GT3: met 104 liter en 2,9 liter per ronde haal je ongeveer 35 rondes,
 * en bij rondjes van 96 seconden is dat 56 minuten. Wie 60 of 90 kiest, plant
 * stints die de tank niet haalt; wie 45 kiest, plant onnodig veel stops.
 *
 * Daarom rekenen we het uit: tankinhoud / verbruik per ronde x rondetijd.
 */

export type CarSpec = {
  car_id: string;
  display_name: string | null;
  tank_capacity_litres: number | null;
  fuel_per_lap_prior_litres: number | null;
};

/** Namen lopen uiteen (lamborghini-huracan-gt3-evo tegenover lamborghinievogt3). */
export const normaliseCarName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Zoekt de specificatie die bij deze auto hoort. Eerst exact, daarna op naam:
 * alle woorden van de ene naam moeten in de andere terugkomen, zodat
 * "lamborghini-huracan-gt3-evo" bij "Lamborghini Huracán GT3 EVO" uitkomt.
 */
export const matchCarSpec = <T extends CarSpec>(specs: T[], carId: string | null | undefined): T | null => {
  if (!carId) return null;
  const exact = specs.find((spec) => spec.car_id === carId);
  if (exact) return exact;
  const wanted = normaliseCarName(carId);
  if (!wanted) return null;
  const wordMatch = (spec: T) => {
    for (const candidate of [spec.car_id, spec.display_name ?? ""]) {
      const normalised = normaliseCarName(candidate);
      if (!normalised) continue;
      if (normalised === wanted) return true;
      if (normalised.includes(wanted) || wanted.includes(normalised)) return true;
    }
    return false;
  };
  return specs.find(wordMatch) ?? null;
};

/**
 * Minuten dat één tank meegaat. Geeft null als de specificatie onbruikbaar is,
 * zodat de aanroeper een eigen default kan kiezen in plaats van een getal te
 * verzinnen.
 */
export const tankMinutesFromSpec = (spec: CarSpec | null, lapSeconds: number | null): number | null => {
  if (!spec) return null;
  const capacity = spec.tank_capacity_litres;
  const perLap = spec.fuel_per_lap_prior_litres;
  if (!capacity || !perLap || capacity <= 0 || perLap <= 0) return null;
  if (!lapSeconds || lapSeconds <= 0) return null;
  const laps = capacity / perLap;
  const minutes = (laps * lapSeconds) / 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes);
};

/**
 * De rondetijd om mee te rekenen: het gemiddelde van de beste rondes van de
 * coureurs die pace hebben doorgevoerd. Eén hele snelle ronde zou de tankduur
 * te ruim maken, één langzame te krap.
 */
export const representativeLapSeconds = (bestLaps: Array<number | null | undefined>): number | null => {
  const usable = bestLaps.filter((lap): lap is number => typeof lap === "number" && Number.isFinite(lap) && lap > 0);
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
