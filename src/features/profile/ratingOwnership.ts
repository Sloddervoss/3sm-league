/**
 * Wie is eigenaar van iRating/Safety Rating?
 *
 * De resultatenimport (en de iRacing-sync) zet `profiles.rating_source` op
 * 'imported'; self-service schrijft alleen zolang de herkomst 'self' is. Deze
 * helpers houden die regel op één plek, zodat de UI en de RPC-payload niet uit
 * elkaar kunnen lopen.
 */
export type RatingSource = "self" | "imported";

export const DEFAULT_RATING_SOURCE: RatingSource = "self";

/**
 * Lege of onbekende waarden vallen terug op 'self': de kolom is NOT NULL met
 * default 'self', dus alleen 'imported' betekent echt "de import is eigenaar".
 */
export function normalizeRatingSource(value: string | null | undefined): RatingSource {
  return value === "imported" ? "imported" : DEFAULT_RATING_SOURCE;
}

/** Self-service mag de ratings alleen zetten als de import ze niet bezit. */
export function canEditRatingsFromSource(value: string | null | undefined): boolean {
  return normalizeRatingSource(value) !== "imported";
}

/** Korte uitleg bij het label boven de ratingvelden. */
export function ratingSourceLabel(value: string | null | undefined): string {
  return normalizeRatingSource(value) === "imported" ? "uit de import" : "zelf ingevuld";
}

export type OwnRacingProfilePayload = {
  iracingId: string | null;
  irating: number | null;
  safetyRating: string | null;
};

/**
 * Payload voor update_own_racing_profile.
 *
 * Bij 'imported' sturen we de bestaande waarden mee: de RPC laat ratings met
 * die herkomst staan, dus alleen de iRacing-koppeling wijzigt. Zo blijft
 * "opslaan" doen wat de gebruiker ziet, zonder een verborgen schrijfpoging op
 * kolommen die de import bezit.
 */
export function ownRacingProfilePayload(input: {
  ratingSource: string | null | undefined;
  iracingId: string;
  iratingInput: string;
  safetyRatingInput: string;
  currentIrating: number | null;
  currentSafetyRating: string | null;
}): OwnRacingProfilePayload {
  const iracingId = input.iracingId.trim() || null;

  if (!canEditRatingsFromSource(input.ratingSource)) {
    return { iracingId, irating: input.currentIrating, safetyRating: input.currentSafetyRating };
  }

  const rawIrating = input.iratingInput.trim();
  const parsed = rawIrating === "" ? null : Number(rawIrating);

  return {
    iracingId,
    irating: parsed !== null && Number.isFinite(parsed) ? Math.trunc(parsed) : null,
    safetyRating: input.safetyRatingInput.trim() || null,
  };
}
