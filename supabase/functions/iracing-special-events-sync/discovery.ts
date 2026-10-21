import { sourceSlug, type SpecialEventSeed } from "./normalize.ts";

export type PublishedSeason = {
  season_id: number;
  series_id?: number;
  season_year: number;
  season_name: string;
  /** Kwartaal binnen het jaar (1-4); nodig om het nieuwste seizoen te kiezen. */
  season_quarter?: number;
  /** iRacing meldt hier welk seizoen binnen de serie nu loopt. */
  active?: boolean;
  official?: boolean;
};

/**
 * Het seizoen dat iRacing nu voor deze serie publiceert.
 *
 * `/data/series/seasons` zonder parameters geeft per serie alleen het seizoen dat
 * nu loopt — de historie zit er niet in. Het vaste `seasonId` uit de seizoenskaart
 * staat daar na een seizoenswissel dus niet meer tussen. Daarom wordt hier op de
 * `seriesId` uit de kaart gematcht en niet op het oude seizoen.
 *
 * Valt er niets te kiezen (serie onbekend, geen seizoen in de lijst), dan blijft
 * het vaste nummer staan: deze stap kan een werkende koppeling nooit breken.
 */
export function resolveCurrentSeriesSeasonId(
  mappedSeasonId: number,
  seriesId: number | null | undefined,
  seasons: readonly PublishedSeason[],
): number {
  const series = Number(seriesId);
  if (!Number.isInteger(series) || series <= 0) return mappedSeasonId;

  const candidates = seasons.filter((season) => Number(season?.series_id) === series
    && season?.official !== false
    && Number.isInteger(Number(season?.season_id))
    && Number(season?.season_id) > 0);
  if (!candidates.length) return mappedSeasonId;

  // Meestal staat er één seizoen per serie in de lijst. Staan er meer, dan is het
  // actieve seizoen leidend en anders het nieuwste.
  const active = candidates.filter((season) => season?.active === true);
  const pool = active.length ? active : candidates;

  const rank = (season: PublishedSeason) => (Number.isInteger(Number(season.season_year)) ? Number(season.season_year) : 0) * 10
    + (Number.isInteger(Number(season.season_quarter)) ? Number(season.season_quarter) : 0);
  const best = [...pool].sort((a, b) => rank(b) - rank(a))[0];
  return Number(best.season_id);
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
