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
//   /seasons/<slug> leagues.updated_at en alle races in die competitie
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

const raceTimestamps = (races = []) => races.map((race) => [race?.updated_at, race?.race_date]);

export const resultRouteLastmod = (race) => lastmodDate(race?.updated_at, race?.race_date);

export const driverRouteLastmod = (races = []) => lastmodDate(raceTimestamps(races));

export const teamRouteLastmod = ({ updatedAt, membershipTimestamps = [], memberRaces = [] } = {}) =>
  lastmodDate(updatedAt, membershipTimestamps, raceTimestamps(memberRaces));

export const seasonRouteLastmod = ({ updatedAt, races = [] } = {}) =>
  lastmodDate(updatedAt, raceTimestamps(races));

// Sitemap-regel voor het element. Zonder rijdatum komt er niets te staan.
export const lastmodXml = (route) => (route?.lastmod ? `\n    <lastmod>${route.lastmod}</lastmod>` : '');
