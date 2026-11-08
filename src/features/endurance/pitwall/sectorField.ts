/**
 * Sectorvergelijking over het veld.
 *
 * De pitwall toont per coureur de sectortijden van de laatst gecontroleerde ronde.
 * Wat daar ontbreekt is de vraag die een team aan de muur stelt: waar verliezen we
 * tijd? Daarvoor is per sector de snelste tijd in het veld nodig en het verschil
 * daarmee.
 *
 * Vergelijken mag alleen tussen reeksen met dezelfde indeling: een baan met drie
 * sectoren naast een baan met vijf is geen vergelijking maar een fout. Ontbreekt de
 * indeling of is een tijd onbruikbaar, dan blijft het verschil null.
 */

export interface SectorRow {
  id: string;
  /** Sectortijden van de laatst gecontroleerde ronde, of null. */
  sectors: ReadonlyArray<number> | null;
}

export interface SectorBest {
  index: number;
  seconds: number;
  /** Coureur met de snelste tijd in deze sector, of null als niemand bruikbaar was. */
  holderId: string | null;
}

const bruikbaar = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const gelijkeLengte = (rows: ReadonlyArray<SectorRow>): number => {
  const lengtes = new Set(
    rows
      .map((row) => (row.sectors ? row.sectors.length : 0))
      .filter((lengte) => lengte > 0),
  );
  return lengtes.size === 1 ? [...lengtes][0] : 0;
};

/**
 * Snelste tijd per sector over de meegegeven rijen. Null als er geen geldige
 * gemeenschappelijke indeling is.
 */
export function fieldSectorBests(rows: ReadonlyArray<SectorRow>): SectorBest[] | null {
  const lengte = gelijkeLengte(rows);
  if (lengte === 0) return null;

  const bests: SectorBest[] = Array.from({ length: lengte }, (_, index) => ({
    index,
    seconds: Number.POSITIVE_INFINITY,
    holderId: null,
  }));

  for (const row of rows) {
    if (!row.sectors || row.sectors.length !== lengte) continue;
    row.sectors.forEach((seconds, index) => {
      if (!bruikbaar(seconds)) return;
      if (seconds < bests[index].seconds) {
        bests[index] = { index, seconds, holderId: row.id };
      }
    });
  }

  return bests.every((best) => Number.isFinite(best.seconds)) ? bests : null;
}

/**
 * Verschil per sector tegen de veldbeste, in seconden. Positief = trager.
 * Null per sector als de eigen tijd of de veldbeste ontbreekt.
 */
export function sectorDeltas(
  own: ReadonlyArray<number> | null | undefined,
  bests: ReadonlyArray<SectorBest> | null | undefined,
): Array<number | null> | null {
  if (!own || !bests || own.length !== bests.length || bests.length === 0) return null;

  return bests.map((best, index) => {
    const seconds = own[index];
    if (!bruikbaar(seconds) || !bruikbaar(best.seconds)) return null;
    // Afronden op milliseconden: de weergave gaat niet fijner dan dat.
    return Math.round((seconds - best.seconds) * 1000) / 1000;
  });
}
