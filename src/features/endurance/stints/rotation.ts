/**
 * Rotatieverdeling voor de stintplanner.
 *
 * De generator verdeelde eerder "eerlijk" op totale rijtijd: wie het minst had
 * gereden kwam als eerste aan de beurt. Zolang de race deelbaar is door het
 * aantal coureurs gaat dat goed, maar bij een restje belandde de laatste stint
 * bij wie toevallig achteraan stond. Bij zeven stints en drie coureurs kon één
 * coureur daardoor bijna vier uur wachten terwijl een ander twee keer kort na
 * elkaar reed.
 *
 * Daarom staat er nu één expliciete regel:
 *  1. strikte afwisseling in een vaste rijvolgorde (wie start begint de reeks,
 *     daarna komt iedereen in dezelfde volgorde opnieuw aan de beurt);
 *  2. de extra stint — als de race niet deelbaar is door het aantal coureurs —
 *     gaat naar de snelste coureur.
 *
 * Alle functies hier zijn puur: geen tijd, geen database, geen beschikbaarheid.
 * De generator gebruikt ze als stemadvies en valt terug op de eerstvolgende
 * coureur die wél mag rijden.
 */

/**
 * Rijvolgorde: de gekozen startcoureur eerst, daarna de rest in de volgorde van
 * de teamleden. Zo schuift "wie start" de hele reeks door zonder dat iemand uit
 * de verdeling valt.
 */
export const buildRotationOrder = (memberIds: string[], startDriverId?: string | null): string[] => {
  const unique = [...new Set(memberIds.filter((id) => Boolean(id)))];
  if (!startDriverId || !unique.includes(startDriverId)) return unique;
  return [startDriverId, ...unique.filter((id) => id !== startDriverId)];
};

/**
 * Snelste coureur eerst, op basis van de gemeten gemiddelde rondetijd. Coureurs
 * zonder pace (0 of ontbrekend) tellen niet mee als snelste: zonder meting is er
 * geen reden om hen de extra stint te geven. Zij sluiten in teamvolgorde aan.
 */
export const fastestFirstFromPace = (
  paceEntries: Array<{ userId: string; averageLapSeconds: number }>,
  memberIds: string[]
): string[] => {
  const measured = paceEntries
    .filter((entry) => memberIds.includes(entry.userId) && Number.isFinite(entry.averageLapSeconds) && entry.averageLapSeconds > 0)
    .sort((a, b) => a.averageLapSeconds - b.averageLapSeconds)
    .map((entry) => entry.userId);
  const rest = memberIds.filter((id) => !measured.includes(id));
  return [...new Set([...measured, ...rest])];
};

/**
 * Hoeveel stints elke coureur krijgt. Iedereen krijgt hetzelfde aantal; de
 * resterende stints gaan één voor één naar de snelste coureurs. Zo blijft de
 * verdeling gelijk wanneer de manager een andere startcoureur kiest.
 */
export const rotationCounts = (order: string[], stintCount: number, fastestFirst: string[] = []): Record<string, number> => {
  const counts: Record<string, number> = {};
  if (!order.length) return counts;
  const total = Math.max(0, Math.floor(stintCount));
  const base = Math.floor(total / order.length);
  let extra = total % order.length;
  for (const id of order) counts[id] = base;
  const receivers = [...new Set([...fastestFirst.filter((id) => order.includes(id)), ...order])];
  for (const id of receivers) {
    if (extra <= 0) break;
    counts[id] += 1;
    extra -= 1;
  }
  return counts;
};

/** Afstand tot de vorige coureur in de rijvolgorde; kleiner = eerder aan de beurt. */
const distanceFrom = (order: string[], prevDriverId: string | null, driverId: string): number => {
  const index = order.indexOf(driverId);
  if (index < 0) return order.length;
  if (!prevDriverId) return index;
  const prevIndex = order.indexOf(prevDriverId);
  if (prevIndex < 0) return index;
  return (index - prevIndex + order.length) % order.length;
};

const pickNext = (pool: string[], order: string[], remaining: Record<string, number>, prevDriverId: string | null): string => {
  const withoutPrev = pool.filter((id) => id !== prevDriverId);
  const candidates = withoutPrev.length ? withoutPrev : pool;
  let best = candidates[0];
  for (const id of candidates) {
    if (id === best) continue;
    const mine = remaining[id] ?? 0;
    const theirs = remaining[best] ?? 0;
    if (mine > theirs) { best = id; continue; }
    if (mine === theirs && distanceFrom(order, prevDriverId, id) < distanceFrom(order, prevDriverId, best)) best = id;
  }
  return best;
};

/**
 * De volledige rijreeks voor een planning: strikte afwisseling, startcoureur
 * eerst, extra stints bij de snelste coureurs. Wordt door de generator gebruikt
 * als richtlijn; wat de generator per stint kiest is altijd de eerstvolgende
 * coureur uit deze reeks die op dat moment beschikbaar is en mag rijden.
 */
export const rotationSequence = (order: string[], stintCount: number, fastestFirst: string[] = []): string[] => {
  if (!order.length) return [];
  const remaining = rotationCounts(order, stintCount, fastestFirst);
  const sequence: string[] = [];
  let prev: string | null = null;
  for (let index = 0; index < Math.max(0, Math.floor(stintCount)); index += 1) {
    // De gekozen startcoureur begint, ook als een snellere coureur de extra
    // stint krijgt: de start is een wens van de manager, niet een uitkomst.
    if (index === 0) {
      sequence.push(order[0]);
      remaining[order[0]] = Math.max(0, (remaining[order[0]] ?? 0) - 1);
      prev = order[0];
      continue;
    }
    let live = order.filter((id) => (remaining[id] ?? 0) > 0);
    if (!live.length) {
      // Meer stints dan vooraf berekend (kortere stints door een rijlimiet of
      // beschikbaarheid): begin een nieuwe ronde met gelijke delen.
      for (const id of order) remaining[id] = (remaining[id] ?? 0) + 1;
      live = order.filter((id) => (remaining[id] ?? 0) > 0);
    }
    if (!live.length) break;
    const chosen = pickNext(live, order, remaining, prev);
    sequence.push(chosen);
    remaining[chosen] = Math.max(0, (remaining[chosen] ?? 0) - 1);
    prev = chosen;
  }
  return sequence;
};
