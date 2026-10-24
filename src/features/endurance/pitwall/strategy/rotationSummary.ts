/**
 * Verdeling van een bestaande planning.
 *
 * `planRotation` maakt een planning; deze functie keurt er een. Dat verschil is
 * nodig omdat een manager meestal niet vanaf nul begint: hij genereert een
 * voorstel, schuift wat met de tijdlijn en wil dan weten of het nog eerlijk is.
 *
 * iRacing eist dat elke coureur minstens 25% van zijn gelijke deel rijdt. Wie
 * daaronder blijft wordt gediskwalificeerd, dus dit is een harde grens en geen
 * waarschuwing.
 */

export interface RotationStintInput {
  driverId: string;
  startMinute: number;
  endMinute: number;
}

export interface RotationSummaryDriver {
  id: string;
  name: string;
  minutes: number;
  /** Aandeel in de totale rijtijd, 0..1. */
  share: number;
  /** True als deze coureur onder het minimumdeel zit. */
  belowMinimum: boolean;
}

export interface RotationSummary {
  perDriver: RotationSummaryDriver[];
  /** Rijtijd die nog aan niemand is toegewezen. */
  unassignedMinutes: number;
  equalShareMinutes: number;
  minimumMinutes: number;
  fairShareSatisfied: boolean;
  reasonCode: "ok" | "fair_share_violated" | "no_drivers" | "no_duration";
}

export interface RotationSummaryInput {
  stints: RotationStintInput[];
  drivers: { id: string; name: string }[];
  totalMinutes: number;
  fairShareFraction?: number;
}

export function summariseRotation(input: RotationSummaryInput): RotationSummary {
  const { stints, drivers, totalMinutes, fairShareFraction = 0.25 } = input;

  const leeg = (reasonCode: RotationSummary["reasonCode"]): RotationSummary => ({
    perDriver: [],
    unassignedMinutes: Math.max(0, totalMinutes),
    equalShareMinutes: 0,
    minimumMinutes: 0,
    fairShareSatisfied: false,
    reasonCode,
  });

  if (drivers.length === 0) return leeg("no_drivers");
  if (totalMinutes <= 0) return leeg("no_duration");

  const minuten: Record<string, number> = {};
  for (const d of drivers) minuten[d.id] = 0;

  let toegewezen = 0;
  for (const stint of stints) {
    if (!(stint.driverId in minuten)) continue;
    const duur = Math.max(0, stint.endMinute - stint.startMinute);
    minuten[stint.driverId] += duur;
    toegewezen += duur;
  }

  const equalShare = totalMinutes / drivers.length;
  const minimum = equalShare * fairShareFraction;

  const perDriver: RotationSummaryDriver[] = drivers.map((d) => ({
    id: d.id,
    name: d.name,
    minutes: round1(minuten[d.id]),
    share: toegewezen > 0 ? minuten[d.id] / toegewezen : 0,
    belowMinimum: minuten[d.id] + 1e-9 < minimum,
  }));

  const eerlijk = perDriver.every((d) => !d.belowMinimum);

  return {
    perDriver,
    unassignedMinutes: round1(Math.max(0, totalMinutes - toegewezen)),
    equalShareMinutes: round1(equalShare),
    minimumMinutes: round1(minimum),
    fairShareSatisfied: eerlijk,
    reasonCode: eerlijk ? "ok" : "fair_share_violated",
  };
}

/** Eén regel die de UI letterlijk kan tonen. */
export function rotationSummaryLine(summary: RotationSummary, totalMinutes: number): string {
  if (summary.reasonCode === "no_drivers") return "Nog geen coureurs in deze auto.";
  if (summary.reasonCode === "no_duration") return "De raceduur is nog niet bekend.";

  const teKort = summary.perDriver.filter((d) => d.belowMinimum);
  if (teKort.length) {
    const namen = teKort.map((d) => `${d.name} (${Math.round(d.minutes)} min)`).join(", ");
    return `Onder het minimumdeel van ${Math.round(summary.minimumMinutes)} min: ${namen}. iRacing kan de auto diskwalificeren.`;
  }

  if (summary.unassignedMinutes > 0.5) {
    return `Nog ${Math.round(summary.unassignedMinutes)} van ${Math.round(totalMinutes)} minuten niet ingedeeld.`;
  }
  return "Iedere coureur rijdt minstens zijn minimumdeel.";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
