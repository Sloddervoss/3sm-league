import { sourceSlug, type SpecialEventSeed } from "./normalize.ts";

export type PublishedSeason = { season_id: number; series_id?: number; season_year: number; season_name: string };

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
