import { sourceSlug, type SpecialEventSeed } from "./normalize.ts";

export type PublishedSeason = {
  season_id: number;
  series_id?: number;
  season_year: number;
  season_name: string;
  /** iRacing meldt hier welk seizoen binnen de serie nu loopt. */
  active?: boolean;
  /** Kwartaal binnen het jaar (1-4); nodig om het nieuwste seizoen te kiezen. */
  season_quarter?: number;
  official?: boolean;
};

/**
 * Het seizoen dat nu loopt binnen dezelfde serie als de gekoppelde kaart.
 *
 * De seizoenskaart (`ENDURANCE_IRACING_SEASON_MAP_JSON`) bevat een vast
 * `seasonId`. Zodra iRacing een nieuw seizoen start hoort daarbij een nieuw
 * `season_id`, maar de kaart blijft naar het oude wijzen. De synchronisatie vroeg
 * daardoor elke ronde opnieuw de kalender van een afgelopen seizoen op en zag de
 * nieuwe races nooit — de endurance-kalender liep stil leeg zonder foutmelding.
 *
 * Daarom zoeken we hier het seizoen op dat iRacing zelf als actief meldt binnen
 * dezelfde serie. Valt er niets te kiezen (geen actief seizoen, serie onbekend,
 * of een onverwachte vorm van de lijst), dan blijft het gekoppelde nummer staan.
 * Zo kan deze stap nooit een werkende koppeling breken.
 */
export function resolveCurrentSeriesSeasonId(mappedSeasonId: number, seasons: readonly PublishedSeason[]): number {
  const mapped = seasons.find((season) => Number(season?.season_id) === mappedSeasonId);
  const seriesId = Number(mapped?.series_id);
  if (!Number.isInteger(seriesId) || seriesId <= 0) return mappedSeasonId;

  const candidates = seasons.filter((season) => Number(season?.series_id) === seriesId
    && season?.active === true
    && season?.official !== false
    && Number.isInteger(Number(season?.season_id))
    && Number(season.season_id) > 0);
  if (!candidates.length) return mappedSeasonId;

  const rank = (season: PublishedSeason) => (Number.isInteger(Number(season.season_year)) ? Number(season.season_year) : 0) * 10
    + (Number.isInteger(Number(season.season_quarter)) ? Number(season.season_quarter) : 0);
  return [...candidates].sort((a, b) => rank(b) - rank(a))[0].season_id;
}

// Only remove explicit year/sponsor decorations. No fuzzy track/name matching:
// practice, fixed, alternative distances and ambiguous seasons must not match.
export function findPublishedSpecialSeason(seed: SpecialEventSeed, seasons: PublishedSeason[]): PublishedSeason | null {
  const matches = seasons.filter((season) => {
    if (season.season_year !== seed.year || !Number.isInteger(season.season_id) || season.season_id <= 0) return false;
    const name = String(season.season_name ?? "")
      .replace(new RegExp(`^\\s*${seed.year}\\s+`), "")
      .replace(/\s+presented by\s+.+$/i, "");
    return sourceSlug(name) === sourceSlug(seed.name);
  });
  if (matches.length > 1) throw new Error(`${seed.sourceKey}: meerdere officiële seasons; expliciete mapping vereist`);
  return matches[0] ?? null;
}
