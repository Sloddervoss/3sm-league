// ---------------------------------------------------------------------------
// Sitemap-<lastmod> voor de dynamische routes
// ---------------------------------------------------------------------------
// Een <lastmod> die altijd 'nu' is (de bouwtijd) is een leugen: Google ziet dat
// het element bij elke build verschuift zonder dat de pagina verandert en gaat
// het negeren. Daarom komt elke datum hier uit de rij zelf:
//
//   /results/<id>   races.updated_at (wijziging van de uitslag), terugval race_date
//   /drivers/<slug> de nieuwste race waarin de coureur voorkomt
//   /teams/<slug>   teams.updated_at, team_memberships.created_at en de races van
//                   de leden (punten, overwinningen en podiums komen daaruit)
//   /seasons/<slug> leagues.updated_at en de nieuwste wijziging (updated_at) van
//                   de races in die competitie - bewust NIET race_date, want het
//                   raceschema loopt vooruit (zie verderop)
//
// De profielrij levert géén tijdstempel: public_profiles is met opzet een
// kolomveilige view zonder auditvelden en public.profiles is met de anon-key
// niet leesbaar (zie 20260712100000_harden_profile_reads.sql). Voor een coureur
// zonder enkele race is er dus geen echte wijzigingstijd; dan blijft <lastmod>
// weg in plaats van dat er een verzonnen datum in komt.
//
// Alles hier is puur: geen Date.now(), geen netwerk, geen fs. Daardoor kan de
// unit test bewijzen dat de datum uit de rijdata komt en niet uit de klok.

const toIsoString = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

// Nieuwste geldige tijdstempel uit de meegegeven waarden. Arrays mogen en
// worden volledig platgeslagen, zodat een aanroeper een kolom of een lijst
// rijen kan doorgeven zonder eerst zelf het maximum te zoeken.
export const latestTimestamp = (...values) => {
  let latest = null;
  for (const value of values.flat(Infinity)) {
    const iso = toIsoString(value);
    if (!iso) continue;
    if (!latest || iso > latest) latest = iso;
  }
  return latest;
};

// Datum zoals de sitemap hem wil (YYYY-MM-DD), of null als er geen echte
// tijdstempel is. Nooit een terugval naar de bouwdatum: zonder rijdatum hoort
// het element te ontbreken.
export const lastmodDate = (...values) => {
  const latest = latestTimestamp(...values);
  return latest ? latest.slice(0, 10) : null;
};

// Voor coureurs, teams en uitslagen mag race_date als terugval dienen: die
// pagina's gaan over verreden races, dus race_date ligt in het verleden en de
// terugval vuurt in de praktijk nooit (elke races-rij heeft een updated_at).
const raceTimestamps = (races = []) => races.map((race) => [race?.updated_at, race?.race_date]);

// Voor een seizoen mag race_date GEEN rol spelen. De seizoenspagina bundelt alle
// races van de competitie, inclusief de nog te rijden races; hun race_date ligt
// bewust in de toekomst (het raceschema). Zo'n datum als <lastmod> is onwaar -
// de pagina is dan niet gewijzigd - en Google negeert hem. De wijzigingstijd van
// de pagina is wanneer de rij zelf veranderde (updated_at), en een nieuw
// ingeplande race krijgt die tijd op het moment dat hij wordt toegevoegd.
const raceUpdatedTimestamps = (races = []) => races.map((race) => race?.updated_at);

export const resultRouteLastmod = (race) => lastmodDate(race?.updated_at, race?.race_date);

export const driverRouteLastmod = (races = []) => lastmodDate(raceTimestamps(races));

export const teamRouteLastmod = ({ updatedAt, membershipTimestamps = [], memberRaces = [] } = {}) =>
  lastmodDate(updatedAt, membershipTimestamps, raceTimestamps(memberRaces));

export const seasonRouteLastmod = ({ updatedAt, races = [] } = {}) =>
  lastmodDate(updatedAt, raceUpdatedTimestamps(races));

// Harde bovengrens: de bouwtijd. Geen enkele <lastmod> mag in de toekomst liggen
// - een pagina kan niet gewijzigd zijn voordat hij bestond, en Google negeert
// zo'n datum. We knippen niet naar de bouwtijd toe (dat zou de bouwdatum als
// wijzigingstijd presenteren en bij elke build verschuiven - precies de leugen
// die deze module wil vermijden) maar laten het element WEG. Zonder datum is de
// waarheid 'onbekend'. buildTime komt van buiten, zodat deze helper puur blijft.
export const dropFutureLastmod = (lastmod, buildTime) => {
  if (!lastmod) return null;
  const build = toIsoString(buildTime)?.slice(0, 10);
  if (!build) return lastmod;
  return lastmod.slice(0, 10) > build ? null : lastmod;
};

// Sitemap-regel voor het element. Zonder rijdatum komt er niets te staan, en een
// datum voorbij de bouwtijd (buildTime) valt weg.
export const lastmodXml = (route, buildTime) => {
  const lastmod = dropFutureLastmod(route?.lastmod, buildTime);
  return lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
};
