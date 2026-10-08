/**
 * De endurance-special-events die 3SM jaarlijks wil volgen.
 *
 * WAAROM DIT BESTAAT
 * De sync importeert bewust nooit een event dat hij niet kent: een event moet
 * ofwel in de seizoenslijst (`ENDURANCE_IRACING_SEASON_MAP_JSON`) staan, ofwel al
 * in de catalogus bestaan. Die regel voorkomt gokwerk, maar heeft één gevolg: de
 * eventsleutel bevat het jaartal (`iracing:2027:daytona-24`). Zodra iRacing het
 * nieuwe seizoen publiceert is élk event dus onbekend en wordt het overgeslagen —
 * de endurance-kalender loopt dan stil leeg.
 *
 * Deze lijst is de expliciete uitzondering: een event waarvan de naam hier staat
 * mag als nieuw event worden opgenomen. Zodra iRacing het bijbehorende seizoen
 * publiceert vindt de bestaande seizoensopzoeking (`findPublishedSpecialSeason`)
 * de exacte tijdsloten alsnog; tot dat moment worden alleen de kalendergegevens
 * vastgelegd (date_only), precies zoals bij de 8 Hours of Indianapolis.
 *
 * TOEVOEGEN of AANPASSEN: alleen op uitdrukkelijk besluit van de projecteigenaar.
 * Neem de naam over zoals iRacing die op https://www.iracing.com/special-events/
 * hanteert — daarvan is de slug (kleine letters, koppelstreepjes) de sleutel.
 * Twijfel je over de spelling? Kijk op die pagina. De tweede slug per regel staat
 * er omdat dezelfde race in de wandelgangen anders genoemd wordt (Sebring 12 vs
 * Sebring 12HR); beide vormen komen op hetzelfde event uit.
 *
 * NIET OP DEZE LIJST (bewust, besluit eigenaar):
 * - 992 Endurance Cup en THE Production Car Challenge @ViR: endurance, maar één
 *   klasse en geen GT3 — vallen buiten het 3SM-programma.
 * - De overige iRacing-special-events (ovals, sprints, off-road, één-type-races,
 *   week-format-evenementen) zijn geen endurance.
 */

import { sourceSlug } from "./normalize.ts";

export type ApprovedSpecialEvent = {
  /** Naam zoals de projecteigenaar het event noemt; gebruikt in meldingen. */
  readonly name: string;
  /** Alle slugs waaronder dit event op de officiële pagina kan staan. */
  readonly slugs: readonly string[];
};

export const APPROVED_ENDURANCE_SPECIAL_EVENTS: readonly ApprovedSpecialEvent[] = [
  { name: "Daytona 24", slugs: ["daytona-24"] },
  { name: "Bathurst 12", slugs: ["bathurst-12"] },
  { name: "Sebring 12HR", slugs: ["sebring-12hr", "sebring-12"] },
  { name: "Nürburgring 24h", slugs: ["nurburgring-24h"] },
  { name: "4 Hours at Thruxton", slugs: ["4-hours-at-thruxton"] },
  { name: "Watkins Glen 6 Hour", slugs: ["watkins-glen-6-hour"] },
  { name: "Spa 24HR", slugs: ["spa-24hr", "spa-24"] },
  { name: "6 Hours Of Road America", slugs: ["6-hours-of-road-america"] },
  { name: "Portimao 1000", slugs: ["portimao-1000", "portimao-1000km"] },
  { name: "Suzuka 1000km", slugs: ["suzuka-1000km"] },
  { name: "Britcar 24HR", slugs: ["britcar-24hr", "britcar-24"] },
  { name: "Petit Le Mans", slugs: ["petit-le-mans"] },
  { name: "Bathurst 1000", slugs: ["bathurst-1000"] },
  { name: "8 Hours of Indianapolis", slugs: ["8-hours-of-indianapolis"] },
];

/** Het slugdeel van een eventsleutel: `iracing:2027:daytona-24` -> `daytona-24`. */
export const slugFromSourceKey = (sourceKey: string): string => {
  const parts = sourceKey.split(":");
  const last = parts.length ? parts[parts.length - 1] : sourceKey;
  return last.trim().toLowerCase();
};

/**
 * Zoekt het goedgekeurde event dat bij deze seed hoort, of null.
 * Er wordt op twee onafhankelijke dingen gematcht — de sleutel én de zichtbare
 * naam — zodat een kleine naamsverandering aan één kant het event niet stil laat
 * verdwijnen.
 */
export const findApprovedSpecialEvent = (seed: { name: string; sourceKey: string }): ApprovedSpecialEvent | null => {
  const keySlug = slugFromSourceKey(seed.sourceKey);
  const nameSlug = sourceSlug(seed.name);
  return APPROVED_ENDURANCE_SPECIAL_EVENTS.find((entry) =>
    entry.slugs.some((slug) => slug === keySlug || slug === nameSlug)) ?? null;
};

/**
 * De beslissing of een ontdekt special event geïmporteerd mag worden.
 * Bewust een pure functie: de regel staat los van de syncloop en is daardoor
 * direkt te testen — dit is de regel die eerder ontbrak.
 */
export const shouldImportSpecialEvent = (input: { mapped: boolean; known: boolean; approved: boolean }): boolean =>
  input.mapped || input.known || input.approved;

/** Een event van de pagina, met alleen de velden die deze telling nodig heeft. */
export type UpcomingCandidate = {
  readonly name: string;
  readonly sourceKey: string;
  readonly dateStart?: string | null;
  readonly dateEnd?: string | null;
};

/**
 * Hoeveel events biedt de pagina die deze ronde daadwerkelijk in de catalogus
 * kunnen komen én die nog moeten plaatsvinden?
 *
 * Alleen die tellen mee voor het signaal "de endurance-kalender loopt leeg". De
 * pagina staat namelijk vol events die 3SM bewust niet volgt (Winter Derby, Chili
 * Bowl, FF1600-festival). Zou je die meetellen — zoals een eerdere versie deed —
 * dan zwijgt het signaal juist op het moment dat de endurance-kalender leegloopt,
 * en is de waarschuwing niets meer waard. Andersom telt een event dat deze ronde
 * nieuw binnenkomt wél mee, zodat de waarschuwing niet afgaat op de momentopname
 * van vóór de ronde.
 */
export const countAdmittedUpcomingEvents = (
  seeds: readonly UpcomingCandidate[],
  today: string,
  mappedKeys: ReadonlySet<string>,
  knownKeys: ReadonlySet<string>,
): number => seeds.filter((seed) => {
  // Geen datum betekent: staat (nog) niet in de aankomende kalender.
  if ((seed.dateEnd ?? seed.dateStart ?? "") < today) return false;
  return shouldImportSpecialEvent({
    mapped: mappedKeys.has(seed.sourceKey),
    known: knownKeys.has(seed.sourceKey),
    approved: Boolean(findApprovedSpecialEvent(seed)),
  });
}).length;
