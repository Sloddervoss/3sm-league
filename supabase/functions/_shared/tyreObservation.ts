/**
 * Tijd en ronde van een bandenwaarneming.
 *
 * Het `tyres`-blok in het frame draagt de meettijd van de **wear/karkaswaarde**:
 * die verandert alleen bij een pitstop of een nieuwe set, dus het blok wordt
 * tussendoor steeds opnieuw verzonden met dezelfde `observedAt`, `lap` en
 * `sessionTimeSeconds` (zie TelemetryContractsV3.V3Tyres en TyrePublishGate).
 *
 * Tot nu toe nam de ingest die drie waarden over. Gevolg in productie op
 * 2026-11-08: elke rij van een hele stint droeg hetzelfde tijdstip (14:44:29) en
 * hetzelfde rondenummer, waardoor een pitstop van 15:59 aan ronde 6 en aan het
 * oude tijdstip werd gekoppeld. De stop bestond wel, maar stond op de verkeerde
 * plek in de tijd.
 *
 * Daarom: het **frame** is leidend voor het moment van deze publicatie (ronde en
 * sessietijd), en het tyres-blok is de terugval als het frame die waarden niet
 * heeft. De meettijd van de wear blijft in `observedAt` staan; die verzinnen we
 * niet opnieuw.
 */

export interface TyreTimingSource {
  lap?: number | null;
  sessionTimeSeconds?: number | null;
}

export interface NormalizedTimingSource {
  timing?: { completedLaps?: number | null } | null;
  session?: { sessionTimeSeconds?: number | null } | null;
}

export interface TyreObservationTiming {
  lap: number | null;
  sessionTimeSeconds: number | null;
  /** Waar de ronde vandaan komt; alleen voor diagnose/tests. */
  lapSource: "frame" | "tyres" | null;
  sessionTimeSource: "frame" | "tyres" | null;
}

const getal = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function tyreObservationTiming(
  tyres: TyreTimingSource | null | undefined,
  normalized: NormalizedTimingSource | null | undefined,
): TyreObservationTiming {
  const frameLap = getal(normalized?.timing?.completedLaps);
  const tyreLap = getal(tyres?.lap);
  const frameTime = getal(normalized?.session?.sessionTimeSeconds);
  const tyreTime = getal(tyres?.sessionTimeSeconds);

  return {
    lap: frameLap ?? tyreLap,
    sessionTimeSeconds: frameTime ?? tyreTime,
    lapSource: frameLap != null ? "frame" : tyreLap != null ? "tyres" : null,
    sessionTimeSource: frameTime != null ? "frame" : tyreTime != null ? "tyres" : null,
  };
}
