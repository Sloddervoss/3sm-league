/**
 * iRacing endurance-races en hun circuits/configuraties.
 * Gebaseerd op de officiële iRacing Special Events-kalender. Circuit + configuratie
 * worden aangeboden als datalist-autocomplete bij het aanmaken van een endurance-event.
 */

export const IRACING_ENDURANCE_RACES: { name: string; circuit: string; configuration: string }[] = [
  { name: "Daytona 24", circuit: "Daytona International Speedway", configuration: "Road Course" },
  { name: "12 Hours of Sebring", circuit: "Sebring International Raceway", configuration: "International" },
  { name: "24 Hours of Spa", circuit: "Circuit de Spa-Francorchamps", configuration: "Endurance" },
  { name: "24 Hours of Nürburgring", circuit: "Nürburgring Combined", configuration: "Gesamtstrecke 24h" },
  { name: "6 Hours of The Glen", circuit: "Watkins Glen International", configuration: "Full Course" },
  { name: "6 Hours of Road America", circuit: "Road America", configuration: "Full Course" },
  { name: "8 Hours of Indianapolis", circuit: "Indianapolis Motor Speedway", configuration: "Road Course" },
  { name: "Petit Le Mans", circuit: "Road Atlanta", configuration: "Full Course" },
  { name: "Suzuka 1000km", circuit: "Suzuka International Racing Course", configuration: "Grand Prix" },
  { name: "Bathurst 12 Hour", circuit: "Mount Panorama", configuration: "Full Course" },
  { name: "Bathurst 1000", circuit: "Mount Panorama", configuration: "Full Course" },
  { name: "Britcar 24 Hour", circuit: "Silverstone Circuit", configuration: "Grand Prix" },
  { name: "4 Hours of Thruxton", circuit: "Thruxton Circuit", configuration: "Full Course" },
  { name: "992 Endurance Cup", circuit: "Circuit de Spa-Francorchamps", configuration: "Endurance" },
  { name: "24 Hours of Le Mans", circuit: "Circuit des 24 Heures", configuration: "Full Course" },
];

/** Unieke circuitnamen (gesorteerd) voor de autocomplete-lijst. */
export const ENDURANCE_CIRCUIT_OPTIONS = [...new Set(IRACING_ENDURANCE_RACES.map((r) => r.circuit))].sort((a, b) => a.localeCompare(b, "nl"));

/** Unieke configuraties (gesorteerd) voor de autocomplete-lijst. */
export const ENDURANCE_CONFIGURATION_OPTIONS = [...new Set(IRACING_ENDURANCE_RACES.map((r) => r.configuration))].sort((a, b) => a.localeCompare(b, "nl"));

/**
 * Kies bij het (her)selecteren van een circuit de meest gangbare configuratie,
 * zodat het veld niet leeg blijft bij een nieuw evenement dat gelinkt is aan een
 * iRacing-endurance-race.
 */
export const ENDURANCE_CONFIGURATION_FOR_CIRCUIT: Record<string, string> = Object.fromEntries(
  IRACING_ENDURANCE_RACES.map((r) => [r.circuit, r.configuration] as [string, string])
);
