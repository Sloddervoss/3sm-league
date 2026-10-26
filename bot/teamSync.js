// Hulpmiddelen voor de team-sync in index.js.
//
// Deze staan los van index.js omdat index.js bij het importeren meteen de
// Discord-client opzet. Zo kan de begrenzing, de isolatie per team of lid, de
// databasecontrole en het eindverslag met echte timers getest worden, zonder
// Discord-server.

import { formatDuration } from './cronGuard.js';

// Eén Discord- of database-aanroep binnen de sync mag nooit langer duren.
export const TEAM_SYNC_TIMEOUT_MS = 8_000;

// Bovengrens voor één team (rol + categorie + vier kanalen) of één lid
// (lid ophalen + nickname + alle teamrollen). Zonder deze grens kan één
// hangend team de hele run van 15 minuten opslokken.
export const TEAM_SYNC_ENTITEIT_BUDGET_MS = 45_000;

// Discord saneert namen: het trimt spaties, vouwt dubbele spaties samen en
// verwijdert zero-width tekens. Vergelijken met de ruwe databasewaarde gaf
// daardoor elke ronde opnieuw een verschil, ook als de naam identiek leek.
export function normaliseerNick(naam) {
  if (!naam) return '';
  return String(naam)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

// Een enkele aanroep mag de hele sync niet gijzelen.
// Zonder deze grens bleef een run 15 minuten op één team staan.
//
// LET OP: dit annuleert de onderliggende aanroep niet. JavaScript kan een
// lopende promise niet afbreken, dus een Discord-verzoek of databasequery die
// na de grens alsnog afrondt, schrijft gewoon door. Daarom staat vóór elke
// schrijfactie een aparte isActief()-controle (alleenAlsActief hieronder): dat
// is de enige plek waar "te laat" nog tegen te houden is.
export function metTimeout(promise, ms, label) {
  let timer;
  const grens = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout na ${ms} ms: ${label}`)), ms);
  });
  return Promise.race([promise, grens]).finally(() => clearTimeout(timer));
}

// Wordt gegooid als een entiteit bewust niets te doen had (lid bestaat niet
// meer, team heeft geen rol). Dat is geen fout en moet apart geteld worden,
// anders lijkt elke ronde kapot terwijl er niets aan de hand is.
export class Overgeslagen extends Error {
  constructor(reden) {
    super(reden);
    this.name = 'Overgeslagen';
    this.reden = reden;
  }
}

// Wordt gegooid zodra de run (of het werk van deze entiteit) niet meer actief
// is. De run stopt dan meteen in plaats van door te schrijven op een stand die
// een volgende run al aan het overschrijven is.
export class Afgebroken extends Error {
  constructor(reden) {
    super(reden || 'run afgebroken');
    this.name = 'Afgebroken';
    this.reden = reden || 'run afgebroken';
  }
}

// Begrensde aanroep die nooit gooit: de aanroeper krijgt altijd een
// resultaatobject en kan door met de volgende regel of entiteit.
export async function begrensd(promise, label, { ms = TEAM_SYNC_TIMEOUT_MS, onError } = {}) {
  try {
    return { ok: true, waarde: await metTimeout(promise, ms, label) };
  } catch (fout) {
    if (typeof onError === 'function') onError(fout, label);
    return { ok: false, fout, label };
  }
}

// Voert `maakAanroep` alleen uit als de run nog actief is.
//
// Belangrijk: de aanroep wordt pas aangemaakt nadat de controle geslaagd is.
// Een `supabase.from(...).update(...)` of `role.edit(...)` die al bestaat,
// vuurt hoe dan ook; alleen de aanroep uitstellen geeft de controle betekenis.
export function alleenAlsActief(isActief, wat, maakAanroep) {
  if (typeof isActief === 'function' && !isActief()) {
    throw new Afgebroken(`run afgebroken vóór ${wat}`);
  }
  return maakAanroep();
}

// Best-effort schrijfactie: een Discord-fout (rate limit, ontbrekende rechten)
// mag de rest van het team niet blokkeren, maar een afgebroken run moet wel
// meteen ophouden met schrijven.
export async function schrijfStilUit(isActief, wat, maakAanroep, { ms = TEAM_SYNC_TIMEOUT_MS } = {}) {
  const belofte = alleenAlsActief(isActief, wat, maakAanroep);
  try {
    return await metTimeout(belofte, ms, wat);
  } catch (fout) {
    if (fout instanceof Afgebroken) throw fout;
    return undefined;
  }
}

// Eén schrijfactie naar Supabase, met dezelfde garanties als een
// Discord-schrijfactie.
//
// PostgREST rejectet niet: de client resolve't met { data, error }. Een
// `await supabase...update(...)` die "slaagt" met een error erin is dus een
// mislukte schrijfactie. Zonder deze controle werd zo'n update als succes
// geteld en liep de sync verder met een rol- of categorie-id die nooit is
// opgeslagen. Hier is elk van beide gevallen een echte fout.
export async function dbStap(label, maakQuery, { ms = TEAM_SYNC_TIMEOUT_MS, isActief, onError } = {}) {
  // De controle staat vóór het aanmaken van de query: ook een databasewrite
  // mag niet meer vertrekken als de run al is afgebroken.
  if (typeof isActief === 'function' && !isActief()) {
    throw new Afgebroken(`run afgebroken vóór ${label}`);
  }

  const resultaat = await begrensd(Promise.resolve().then(() => maakQuery()), label, { ms, onError });
  if (!resultaat.ok) throw resultaat.fout;

  const waarde = resultaat.waarde;
  if (waarde?.error) {
    const fout = new Error(`[db] ${label}: ${waarde.error.message || JSON.stringify(waarde.error)}`);
    fout.cause = waarde.error;
    fout.code = waarde.error.code;
    if (typeof onError === 'function') onError(fout, label);
    throw fout;
  }

  return waarde;
}

// Roept een callback aan zonder de lus te laten vallen. Een callback die
// gooit (bijvoorbeeld een teller die op een onverwacht ontbrekend veld stuit)
// mag de rest van de teams of leden niet overslaan.
function veiligAanroepen(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    callback(...args);
  } catch (fout) {
    console.error(`[teamSync] callback faalde: ${fout?.message || fout}`);
  }
}

// Voert `taak` uit voor elke entiteit, met per entiteit een eigen foutvang en
// tijdsbudget. Eén kapot team of lid stopt de rest van de run niet meer.
//
// De taak krijgt (item, { overslaan, isActief }) en kan met overslaan(reden)
// melden dat er niets te doen was. Dat telt als 'overgeslagen', niet als fout.
//
// `isActief()` in de taak is de run-status én de status van deze entiteit: na
// het budget van deze entiteit is verstreken zegt hij false, zodat laat
// afgerond werk van een afgekapte taak niets meer schrijft.
export async function voerPerEntiteitUit({
  items = [],
  label = 'entiteit',
  taak,
  isActief = () => true,
  budgetMs = TEAM_SYNC_ENTITEIT_BUDGET_MS,
  onFout = () => {},
  onOvergeslagen = () => {},
}) {
  const uitkomst = { verwerkt: 0, fouten: 0, overgeslagen: 0, afgebroken: false, reden: null };

  for (const item of items) {
    if (!isActief()) {
      uitkomst.afgebroken = true;
      uitkomst.reden = 'run niet meer actief';
      break;
    }

    let entiteitActief = true;
    const nogActief = () => entiteitActief && isActief();

    try {
      const werk = Promise.resolve().then(() =>
        taak(item, {
          overslaan: (reden) => {
            throw new Overgeslagen(reden || 'overgeslagen');
          },
          isActief: nogActief,
        })
      );
      await metTimeout(werk, budgetMs, `${label}-budget`);
      uitkomst.verwerkt += 1;
    } catch (fout) {
      // Vanaf hier mag het achtergebleven werk van deze entiteit niets meer
      // schrijven, ook als de promise pas veel later afrondt.
      entiteitActief = false;

      if (fout instanceof Afgebroken) {
        uitkomst.afgebroken = true;
        uitkomst.reden = fout.reden || fout.message;
        break;
      }
      if (fout instanceof Overgeslagen) {
        uitkomst.overgeslagen += 1;
        veiligAanroepen(onOvergeslagen, item, fout.reden, fout);
      } else {
        uitkomst.fouten += 1;
        veiligAanroepen(onFout, item, fout);
      }
    }
  }

  return uitkomst;
}

// Het eindverslag: één regel per run, altijd hetzelfde formaat, met de
// foutreden erachter als die er is. Zonder reden is een afgebroken run niet te
// onderscheiden van een geslaagde.
export function maakEindverslag({ stats = {}, duurMs = 0, status = 'klaar', reden = null } = {}) {
  const aantal = (naam) => Number(stats?.[naam]) || 0;
  const kern = [
    `teams=${aantal('teams')}`,
    `team_fout=${aantal('teamErrors')}`,
    `team_overgeslagen=${aantal('teamsSkipped')}`,
    `profiles=${aantal('profiles')}`,
    `verwerkt=${aantal('membersProcessed')}`,
    `niet_gevonden=${aantal('membersMissing')}`,
    `lid_overgeslagen=${aantal('membersSkipped')}`,
    `nicknames=${aantal('nicknamesUpdated')}`,
    `rollen_plus=${aantal('rolesAdded')}`,
    `rollen_min=${aantal('rolesRemoved')}`,
    `fouten=${aantal('memberErrors')}`,
    `opruim_fout=${aantal('cleanupErrors')}`,
  ].join(', ');
  const staart = reden ? `, reden=${String(reden).replace(/\s+/g, ' ').slice(0, 300)}` : '';
  return `[syncTeamRoles] ${status} in ${formatDuration(duurMs)}: ${kern}${staart}`;
}

// Draait de sync en garandeert precies één eindverslag.
//
// Alles staat in try/finally, zodat ook een vroege `return` (geen guild, geen
// teams) of een gegooide fout het verslag oplevert. Bij fouten of een
// afgebroken run gaat hetzelfde verslag één keer naar Discord; bij een
// geslaagde ronde blijft Discord stil.
//
// De fout wordt hier opgevangen en niet doorgegooid: het verslag is het
// resultaat van de run, en doorgooien zou bij de aanroeper een tweede melding
// opleveren.
export async function draaiMetEindverslag({
  stats = {},
  werk,
  log = (...args) => console.log(...args),
  meld,
  isActief = () => true,
  ms = TEAM_SYNC_TIMEOUT_MS,
  nu = () => Date.now(),
  onVerslagFout,
} = {}) {
  const startedAt = nu();
  let status = 'klaar';
  let reden = null;
  const markeer = (waarom, nieuweStatus = 'fout') => {
    reden = waarom || 'onbekende reden';
    status = nieuweStatus;
  };

  try {
    await werk({ markeer });
  } catch (fout) {
    status = fout instanceof Afgebroken ? 'afgebroken' : 'fout';
    reden = fout?.message || String(fout);
  } finally {
    const samenvatting = maakEindverslag({ stats, duurMs: nu() - startedAt, status, reden });
    try {
      log(samenvatting);
    } catch (fout) {
      if (typeof onVerslagFout === 'function') onVerslagFout(fout);
    }

    const heeftFouten = Number(stats?.memberErrors) || Number(stats?.teamErrors) || Number(stats?.cleanupErrors);
    // Een run die de bewaker al heeft afgebroken meldt alleen nog op de
    // console: een tweede Discord-bericht over een oude run zou de indruk geven
    // dat er nu iets mis is.
    if ((heeftFouten || reden) && typeof meld === 'function' && isActief()) {
      await metTimeout(Promise.resolve().then(() => meld(samenvatting)), ms, 'eindverslag').catch((fout) => {
        if (typeof onVerslagFout === 'function') onVerslagFout(fout);
      });
    }
  }

  return { status, reden };
}
