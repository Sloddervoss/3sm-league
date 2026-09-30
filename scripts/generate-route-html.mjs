import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createPrivateSeoRoutes } from './route-classification.mjs';

const SITE_URL = 'https://3stripemotorsport.cc';
const communitySupportConfig = JSON.parse(readFileSync(new URL('../community-support.config.json', import.meta.url), 'utf8'));
const communitySupportHasSharedData = communitySupportConfig.dataSource === 'supabase';
if (communitySupportConfig.public && !communitySupportHasSharedData) {
  throw new Error('Community Support cannot be public while dataSource is not supabase');
}
const communitySupportPublic = communitySupportConfig.public && communitySupportHasSharedData;
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const templatePath = join(distDir, 'index.html');
const manifestPath = join(distDir, '.route-html-manifest.json');
const template = readFileSync(templatePath, 'utf8');

// De hero-preload hoort alleen op de routes die de hero werkelijk renderen. De
// <head> is gedeeld door alle routes, dus zonder deze stap vraagt ELKE route de
// hero-afbeelding op (14,6 KB, fetchpriority=high) terwijl hij hem nooit toont -
// en dat concurreert met de kritieke JS. Alleen / (HomepagePrototype) en
// /homepage-prototype (Index) gebruiken HeroSection.
const HERO_PRELOAD_ROUTES = new Set(['/', '/homepage-prototype']);
const HERO_PRELOAD_RE = /\s*<link rel="preload" as="image" href="[^"]*hero-bg-[^"]*"[^>]*>/g;
const stripHeroPreload = (html, routePath) =>
  HERO_PRELOAD_ROUTES.has(routePath) ? html : html.replace(HERO_PRELOAD_RE, '');
const canonicalPath = (path) => {
  if (path === '/') return '/';
  return `/${String(path).replace(/^\/+|\/+$/g, '')}/`;
};

const routes = [
  {
    path: '/',
    title: '3 Stripe Motorsport - Nederlandse iRacing League & Community',
    priority: '1.0',
    changefreq: 'weekly',
    description:
      '3 Stripe Motorsport is een Nederlandse iRacing league en sim racing community. Race mee, sluit aan via Discord en bekijk kalender, standings en uitslagen.',
    h1: '3 Stripe Motorsport iRacing League',
    intro:
      '3 Stripe Motorsport is een Nederlandse iRacing league en sim racing community voor coureurs die clean, fair en met plezier willen racen.',
    details: [
      'Op de site vind je de racekalender, uitslagen, standings, coureurs, teams en nieuws van de 3SM community.',
      'Nieuwe en bestaande coureurs kunnen vanuit de homepage snel door naar meedoen, kalender, race-uitslagen en het actuele klassement.',
    ],
    links: [
      ['/meedoen', 'Meedoen met onze iRacing community'],
      ['/calendar', 'Racekalender bekijken'],
      ['/standings', 'Standings volgen'],
      ['/results', 'Race-uitslagen bekijken'],
      ['/news', '3SM nieuws lezen'],
      ['/seasons', 'Seizoenen bekijken'],
      ['/drivers', 'Coureurs bekijken'],
      ['/teams', 'Teams bekijken'],
    ],
  },
  {
    path: '/meedoen',
    title: 'Meedoen met 3SM – Nederlandse iRacing League',
    priority: '0.8',
    changefreq: 'monthly',
    description:
      'Zoek je een iRacing community in Nederland? Doe mee met 3 Stripe Motorsport: een Nederlandse iRacing league met Discord, kalender, standings en uitslagen.',
    h1: 'Een iRacing community voor competitie en plezier',
    intro:
      '3 Stripe Motorsport is een Nederlandse iRacing league en community, ontstaan in Nederland en open voor coureurs met dezelfde race-mentaliteit. Deelname is gratis en beginners en ervaren coureurs zijn welkom.',
    details: [
      'Echte kalender- en uitslagdata tonen welke races worden georganiseerd, waar er wordt gereden en hoe de standings zich ontwikkelen.',
      'Een raceavond begint met kalender, briefing en voorbereiding. Daarna volgen training, hard maar fair racen en na afloop de uitslagen en bijgewerkte standings.',
      'Voor deelname zijn een actief iRacing-account, Discord, een compleet 3SM-profiel, de juiste iRacing-naam en Customer ID nodig.',
      'Voorbereid starten, ruimte geven en incidenten netjes via de steward-flow afhandelen houden de competitie sterk en toegankelijk.',
      'Deelnemers kunnen solo of met een eigen team rijden en hoeven niet iedere race aanwezig te zijn.',
      'GT3 is momenteel de belangrijkste klasse. Andere klassen kunnen worden toegevoegd bij voldoende interesse.',
      'Een eigen planningslaag voor bestaande iRacing endurance-events is actief in ontwikkeling en nog niet volledig beschikbaar.',
      'Hard racen. Slim racen. Respectvol racen.',
    ],
    links: [
      ['/calendar', 'Bekijk aankomende races'],
      ['/standings', 'Bekijk het kampioenschap'],
      ['/results', 'Bekijk eerdere uitslagen'],
    ],
  },
  {
    path: '/calendar',
    title: 'iRacing racekalender Nederland | 3SM',
    priority: '0.9',
    changefreq: 'weekly',
    description:
      'Bekijk de 3SM iRacing racekalender: aankomende races, circuits, tijden en inschrijven bij een Nederlandse sim racing community.',
    h1: '3SM racekalender',
    intro:
      'De racekalender toont aankomende 3 Stripe Motorsport iRacing races met circuits, raceavonden, inschrijvingen en seizoensplanning.',
    details: [
      'Gebruik de kalender om te zien welke races eraan komen, op welk circuit er gereden wordt en hoe de planning van de league eruitziet.',
      'Na afloop komen gereden races terug in de uitslagen en tellen ze mee voor standings wanneer resultaten zijn geïmporteerd.',
    ],
    links: [
      ['/meedoen', 'Meedoen met 3SM'],
      ['/results', 'Bekijk gereden races'],
      ['/standings', 'Volg de standings'],
    ],
  },
  {
    path: '/standings',
    title: '3SM Standings & Klassement | 3 Stripe Motorsport',
    priority: '0.9',
    changefreq: 'weekly',
    description:
      'Bekijk de actuele 3SM standings: kampioenschapspunten, posities, teams en prestaties van coureurs in de iRacing league.',
    h1: '3SM standings en klassement',
    intro:
      'Volg de actuele 3 Stripe Motorsport kampioenschapsstand, punten en posities van coureurs binnen de iRacing league.',
    details: [
      'De standings tonen hoe coureurs en teams presteren over de lopende competitie van 3 Stripe Motorsport.',
      'Bekijk punten, posities en prestaties in samenhang met de gereden race-uitslagen en de kalender.',
    ],
    links: [
      ['/results', 'Bekijk race-uitslagen'],
      ['/calendar', 'Bekijk de kalender'],
      ['/drivers', 'Bekijk coureurs'],
    ],
  },
  {
    path: '/results',
    title: 'iRacing uitslagen & standings | 3SM',
    priority: '0.8',
    changefreq: 'weekly',
    description:
      'Bekijk 3SM iRacing uitslagen met winnaars, podiums, klasseringen, standings en race-details van de Nederlandse sim racing league.',
    h1: '3SM race-uitslagen',
    intro:
      'Bekijk de race-uitslagen van 3 Stripe Motorsport met gereden iRacing races, rondes, circuits, winnaars, podiums en kampioenschapspunten.',
    details: [
      'Elke race-uitslag heeft een eigen detailpagina met racegegevens, circuitinformatie, klasseringen en links naar andere recente uitslagen.',
      'De uitslagenpagina is de centrale plek om gereden 3SM races terug te vinden en door te klikken naar detailpagina’s.',
    ],
    links: [
      ['/standings', 'Bekijk de standings'],
      ['/calendar', 'Bekijk aankomende races'],
      ['/seasons', 'Bekijk seizoenen'],
      ['/drivers', 'Bekijk coureurs'],
    ],
  },
  {
    path: '/news',
    title: 'Nieuws - 3 Stripe Motorsport',
    priority: '0.8',
    changefreq: 'weekly',
    description:
      'Lees het laatste nieuws van 3 Stripe Motorsport: verhalen uit de paddock, raceverslagen en updates van de iRacing league.',
    h1: '3SM nieuws',
    intro:
      'Lees verhalen uit de paddock, raceverslagen en updates van 3 Stripe Motorsport.',
    details: [
      'Nieuwsartikelen en raceverslagen geven context bij de competitie, gereden races en ontwikkelingen binnen de 3SM community.',
      'Vanaf deze nieuwshub kun je doorklikken naar gepubliceerde artikelen en daarna terug naar kalender, uitslagen en standings.',
    ],
    links: [
      ['/calendar', 'Bekijk de racekalender'],
      ['/results', 'Bekijk uitslagen'],
      ['/standings', 'Volg de standings'],
      ['/meedoen', 'Meedoen met 3SM'],
    ],
  },
  {
    path: '/seasons',
    title: 'Seizoenen - 3 Stripe Motorsport',
    priority: '0.8',
    changefreq: 'monthly',
    description:
      'Ontdek de seizoenen en competities van 3 Stripe Motorsport, inclusief raceplanning, klassen en kampioenschappen.',
    h1: '3SM seizoenen en competities',
    intro:
      'Ontdek de seizoenen van 3 Stripe Motorsport met competities, klassen, raceplanning, uitslagen en kampioenschappen.',
    details: [
      'Seizoenen bundelen de competities, klassen en raceplanning van 3 Stripe Motorsport.',
      'Gebruik deze pagina als startpunt om seizoensinformatie te koppelen aan kalender, standings en race-uitslagen.',
    ],
    links: [
      ['/calendar', 'Bekijk raceplanning'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
  {
    path: '/drivers',
    title: '3SM Coureurs | iRacing Drivers & Profielen',
    priority: '0.7',
    changefreq: 'monthly',
    description:
      'Bekijk de coureurs van 3 Stripe Motorsport, hun profielen, teams en prestaties binnen de 3SM iRacing league.',
    h1: '3SM coureurs',
    intro:
      'Bekijk de coureurs binnen 3 Stripe Motorsport, inclusief profielen, teams en prestaties in de iRacing league.',
    details: [
      'De coureurspagina helpt bezoekers ontdekken wie er actief meerijdt binnen 3SM en hoe prestaties terugkomen in standings en uitslagen.',
      'Coureurs zijn gekoppeld aan teams, race-resultaten en profielen binnen de 3 Stripe Motorsport community.',
    ],
    links: [
      ['/teams', 'Bekijk teams'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
  {
    path: '/teams',
    title: '3SM Teams | iRacing Teams & Coureurs',
    priority: '0.7',
    changefreq: 'monthly',
    description:
      'Ontdek de teams binnen 3 Stripe Motorsport en bekijk hun coureurs, punten en overwinningen in de 3SM iRacing league.',
    h1: '3SM teams',
    intro:
      'Ontdek de teams binnen 3 Stripe Motorsport en zie hoe coureurs samen actief zijn in de iRacing community en league.',
    details: [
      'Teams maken zichtbaar hoe coureurs samenwerken binnen de 3SM league en community.',
      'Teaminformatie sluit aan op coureurs, standings en race-uitslagen zodat prestaties beter te volgen zijn.',
    ],
    links: [
      ['/drivers', 'Bekijk coureurs'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
];

if (communitySupportPublic) {
  routes.push({
    path: '/support',
    title: 'Community Support | 3SM',
    priority: '0.3',
    changefreq: 'monthly',
    description: 'Bekijk transparant hoe vrijwillige bijdragen de website, servers, software en communityactiviteiten van 3 Stripe Motorsport ondersteunen.',
    h1: 'Community Support',
    intro: '3 Stripe Motorsport wordt gebouwd, gehost en onderhouden door vrijwilligers. Wie wil, kan vrijwillig bijdragen aan de systemen, evenementen en toekomst van de community.',
    details: [
      'Bekijk de actuele maandkosten, het door de community gedragen deel en de beschikbare communityreserve.',
      'De financiële transparantie toont openbare inkomsten en uitgaven zonder private betaal- of factuurgegevens te publiceren.',
    ],
    links: [
      ['/', 'Terug naar 3 Stripe Motorsport'],
      ['/meedoen', 'Meedoen met de community'],
    ],
  });
}

const privateRoutes = createPrivateSeoRoutes(communitySupportPublic);

const joinFaq = [
  {
    question: 'Kost deelname aan 3SM geld?',
    answer: 'Nee. Deelname aan de 3SM-races en community is gratis.',
  },
  {
    question: 'Is er een minimum iRating?',
    answer: 'Nee. Er geldt geen minimum iRating om mee te mogen doen.',
  },
  {
    question: 'Is er een minimum Safety Rating?',
    answer: 'Nee. Er geldt geen minimum Safety Rating. Clean en respectvol rijden blijft wel de basis.',
  },
  {
    question: 'Zijn beginners welkom?',
    answer: 'Ja. Beginners en ervaren coureurs zijn welkom. Voorbereiding, respect en veilig rijgedrag zijn belangrijker dan een bepaald niveau.',
  },
  {
    question: 'Moet iedere race gereden worden?',
    answer: 'Nee. Rijd de races die in je planning passen. Iedere race aanwezig zijn is niet verplicht.',
  },
  {
    question: 'Kan ik zonder team meedoen?',
    answer: 'Ja. Solo coureurs kunnen zich gewoon inschrijven en deelnemen.',
  },
  {
    question: 'Kan mijn eigen team deelnemen?',
    answer: 'Ja. Eigen teams zijn welkom en hoeven niet onder de 3SM-teamnaam te rijden.',
  },
  {
    question: 'Welke klasse wordt momenteel gereden?',
    answer: 'De belangrijkste eigen league-klasse is momenteel GT3 in iRacing.',
  },
  {
    question: 'Komen er andere klassen?',
    answer: 'Dat kan. Andere klassen en formats kunnen worden toegevoegd wanneer daar binnen de community voldoende interesse voor is.',
  },
  {
    question: 'Hoe werkt aanmelden?',
    answer: 'Join Discord, maak je siteprofiel compleet, koppel je Discord-account en schrijf je daarna via de kalender in voor een race of seizoen.',
  },
  {
    question: 'Wat heb ik nodig om mee te doen?',
    answer: 'Een iRacing-account, Discord, een compleet 3SM-profiel en de bereidheid om voorbereid, clean en respectvol te racen.',
  },
  {
    question: 'Hoe zit het met endurance?',
    answer: '3SM werkt aan een eigen planningslaag voor bestaande iRacing endurance-events. Die omgeving is actief in ontwikkeling en nog niet volledig beschikbaar.',
  },
];

const joinRoute = routes.find((route) => route.path === '/meedoen');
if (joinRoute) joinRoute.faq = joinFaq;

const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const absoluteUrl = (path) => `${SITE_URL}${canonicalPath(path)}`;

// Eén canonieke beschrijving van de organisatie. Elk @id verwijst naar hetzelfde
// knooppunt, zodat Google niet vier losse versies van 3SM te zien krijgt maar
// één entiteit met één officiële URL en de bijbehorende profielen (sameAs).
const ORGANIZATION_ID = `${SITE_URL}/#organisatie`;

const organizationJsonLd = () => ({
  '@type': 'SportsOrganization',
  '@id': ORGANIZATION_ID,
  name: '3 Stripe Motorsport',
  alternateName: '3SM',
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/favicon-192x192.png`,
  description: '3 Stripe Motorsport is een Nederlandse iRacing league en community met een eigen kalender, uitslagen en standen.',
  sport: 'Sim racing',
  foundingDate: '2026',
  areaServed: { '@type': 'Country', name: 'Nederland' },
  knowsAbout: ['iRacing', 'sim racing', 'endurance racing'],
  sameAs: [
    'https://discord.gg/H7tZVuzBgT',
    'https://www.instagram.com/3stripemotorsport',
    'https://www.facebook.com/people/3-Stripe-Motorsport/61589158685020/',
  ],
});

// Compacte verwijzing voor herhaalde vermeldingen in ItemLists (kalender-events,
// uitslag-items). Houdt de koppeling via hetzelfde @id en behoudt naam en url
// voor rich-result-geschiktheid, maar herhaalt de volledige node niet tientallen
// keren per pagina.
const organizationRefJsonLd = () => ({
  '@type': 'SportsOrganization',
  '@id': ORGANIZATION_ID,
  name: '3 Stripe Motorsport',
  url: `${SITE_URL}/`,
});

// Sitemap <lastmod> must reflect real page-content changes, not build time.
// Static route entries intentionally omit lastmod unless that specific page's
// crawler-facing content was edited. Dynamic routes below use row timestamps.
const lastmodXml = (route) => route.lastmod ? `\n    <lastmod>${route.lastmod}</lastmod>` : '';

const normalizeSlugInput = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const categorySlugMap = new Map([
  ['Raceverslagen', 'raceverslagen'],
  ['Race Recaps', 'race-recaps'],
  ['League Updates', 'league-updates'],
  ['Interviews', 'interviews'],
  ['Reviews', 'reviews'],
  ['Community', 'community'],
  ['iRacing Nieuws', 'iracing-nieuws'],
  ['Special Events', 'special-events'],
]);

const categoryToSlug = (category) => categorySlugMap.get(category) || normalizeSlugInput(category);

const stripHtml = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const truncate = (value, max = 155) => {
  const clean = stripHtml(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

const formatDateNl = (value) => {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return dateOnly(value);
  }
};

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// Weergavenaam: alleen opschonen (spaties, trim) en een beginnende kleine letter
// kapitaliseren. Geen title-casing: "gt3" of "3SM" mag niet veranderen. De echte
// spelfouten in racenamen horen in de database te worden gecorrigeerd, niet hier.
const titleish = (value) => {
  const clean = cleanText(value);
  if (!clean) return clean;
  return /^[a-z]/.test(clean) ? `${clean[0].toUpperCase()}${clean.slice(1)}` : clean;
};

const slugify = (value) => normalizeSlugInput(cleanText(value));

const driverLabel = (profile) => cleanText(profile?.iracing_name || profile?.display_name) || 'Onbekende coureur';

// ---------- Entiteitspagina's ----------
// Coureurs, teams en seizoenen krijgen een eigen URL. Deze helpers spiegelen
// src/lib/entityLinks.ts: de client bouwt exact dezelfde slugs. Lopen die uit
// elkaar, dan linkt de statische HTML naar een andere URL dan de SPA opent.
// Een lege slug levert null op, zodat zo'n entiteit nooit met een hub botst.
const driverEntityPath = (value) => {
  const name = typeof value === 'string' ? value : (value?.name || driverLabel(value));
  const slug = slugify(name);
  return slug ? `/drivers/${slug}` : null;
};

const teamEntityPath = (team) => {
  const slug = slugify(team?.name);
  return slug ? `/teams/${slug}` : null;
};

const seasonEntityPath = (league) => {
  const slug = slugify([cleanText(league?.name), league?.season].filter(Boolean).join(' '));
  return slug ? `/seasons/${slug}` : null;
};

const entityLink = (path, label) => (path ? `<a href="${absoluteUrl(path)}">${escapeHtml(label)}</a>` : escapeHtml(label));
const entityUrl = (path) => (path ? absoluteUrl(path) : undefined);

// De tien publieke hubs. Elke route krijgt ze in zijn statische links, zodat ook
// een crawler zonder JavaScript van elke pagina bij elke hub kan komen. Zonder
// dit had /support nul inkomende links en waren /seasons, /teams en /drivers
// alleen via de homepage bereikbaar.
const SITE_HUB_LINKS = [
  ['/', '3 Stripe Motorsport homepage'],
  ['/calendar', 'iRacing racekalender'],
  ['/results', 'Race-uitslagen'],
  ['/standings', 'Standings en klassement'],
  ['/news', 'Nieuws en raceverslagen'],
  ['/seasons', 'Seizoenen en competities'],
  ['/drivers', 'Coureurs'],
  ['/teams', 'Teams'],
  ['/meedoen', 'Meedoen met 3SM'],
  ['/support', 'Community support'],
];

const driverName = (result) =>
  cleanText(result?.profiles?.iracing_name || result?.profiles?.display_name) || 'Onbekende coureur';

let resultsHubSummaries = [];
let calendarHubSummaries = [];
let newsHubSummaries = [];
let standingsByLeague = new Map();
let leagueSummaries = [];
let driverSummaries = [];
let teamSummaries = [];
// De afgeronde races mét publieke coureursnamen. Wordt gevuld zodra de races zijn
// opgehaald; de hubdata hieronder heeft dezelfde pool nodig maar staat buiten dat
// basisblok, dus hij staat op moduleniveau in plaats van in een else-scope.
let completedRacePool = [];

// --- Crawler-zichtbare hubdata -------------------------------------------------
// De hubs /standings, /drivers, /teams en /seasons leverden alleen een lege schil
// van ~8,5 KB: de stand, de 34 coureurs en de teams kwamen uitsluitend na
// hydratatie uit de Supabase-API. Voor een crawler zonder JavaScript waren die
// pagina's leeg. Deze bouwers zetten dezelfde data in de HTML-bytes.

const buildStandingsHubCrawlerHtml = () => {
  if (!standingsByLeague.size) return '';

  const sections = leaguesWithStandings().map((league) => {
    const rows = standingsByLeague.get(league.id) || [];
    if (!rows.length) return '';
    const table = rows.map((row) => `            <tr><td>${row.position}</td><td>${entityLink(driverEntityPath(row), row.name)}</td><td>${escapeHtml(row.teamName || '')}</td><td>${row.points}</td><td>${row.wins}</td><td>${row.podiums}</td></tr>`).join('\n');
    return `        <h2>Stand ${escapeHtml(league.label)}</h2>
        <p>${rows.length} coureurs met punten in ${escapeHtml(league.label)}${league.season ? ` (${escapeHtml(String(league.season))})` : ''}${league.leaderName ? `, aangevoerd door ${escapeHtml(league.leaderName)} met ${league.leaderPoints} punten` : ''}.</p>
        <table>
          <thead>
            <tr><th>Positie</th><th>Coureur</th><th>Team</th><th>Punten</th><th>Overwinningen</th><th>Podiums</th></tr>
          </thead>
          <tbody>
${table}
          </tbody>
        </table>`;
  }).filter(Boolean).join('\n');

  if (!sections) return '';
  return `<section aria-label="Crawler-zichtbare standings">
${sections}
      </section>`;
};

const buildStandingsItemListJsonLd = () => {
  const leagues = leaguesWithStandings();
  const primary = leagues[0];
  if (!primary) return null;
  const rows = standingsByLeague.get(primary.id) || [];
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `3 Stripe Motorsport stand ${primary.label}`,
    description: `Kampioenschapsstand van ${primary.label} met posities, punten, overwinningen en podiums.`,
    url: absoluteUrl('/standings'),
    itemListElement: rows.map((row) => ({
      '@type': 'ListItem',
      position: row.position,
      item: {
        '@type': 'Person',
        name: row.name,
        description: `${row.position}e plaats met ${row.points} punten, ${row.wins} overwinningen en ${row.podiums} podiums in ${primary.label}.`,
        memberOf: row.teamName ? { '@type': 'SportsTeam', name: row.teamName } : undefined,
      },
    })),
  };
};

const buildDriversHubCrawlerHtml = () => {
  if (!driverSummaries.length) return '';
  const items = driverSummaries.map((driver) => {
    const meta = [
      driver.teamName ? `Team: ${driver.teamName}` : null,
      driver.irating ? `iRating ${driver.irating}` : null,
      `${driver.races} races`,
      `${driver.wins} overwinningen`,
      `${driver.podiums} podiums`,
      `${driver.points} punten`,
    ].filter(Boolean).join(' · ');
    return `          <li>${entityLink(driverEntityPath(driver.name), driver.name)}${meta ? ` — ${escapeHtml(meta)}.` : ''}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare coureurs">
        <h2>Coureurs van 3 Stripe Motorsport</h2>
        <p>3SM telt ${driverSummaries.length} coureurs met een publiek profiel. Hieronder staan hun teams en hun prestaties in de iRacing league.</p>
        <ul>
${items}
        </ul>
      </section>`;
};

const buildDriversItemListJsonLd = () => (driverSummaries.length ? {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3 Stripe Motorsport coureurs',
  description: 'Overzicht van de coureurs binnen 3 Stripe Motorsport met hun team en prestaties.',
  url: absoluteUrl('/drivers'),
  itemListElement: driverSummaries.map((driver, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'Person',
      name: driver.name,
      url: entityUrl(driverEntityPath(driver.name)),
      description: driver.teamName ? `Coureur bij ${driver.teamName} met ${driver.points} punten in de 3SM iRacing league.` : `Coureur met ${driver.points} punten in de 3SM iRacing league.`,
      memberOf: driver.teamName ? { '@type': 'SportsTeam', name: driver.teamName } : undefined,
    },
  })),
} : null);

const buildTeamsHubCrawlerHtml = () => {
  const filled = teamSummaries.filter((team) => team.name);
  if (!filled.length) return '';
  const items = filled.map((team) => {
    const members = team.members.length
      ? ` Coureurs: ${team.members.map((member) => member.name).join(', ')}.`
      : '';
    const scores = team.points || team.wins || team.podiums
      ? ` Samen goed voor ${team.points} punten, ${team.wins} overwinningen en ${team.podiums} podiums.`
      : '';
    return `          <li>${entityLink(teamEntityPath(team), team.name)}${team.description ? ` — ${escapeHtml(team.description)}` : ''}${escapeHtml(members + scores)}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare teams">
        <h2>Teams binnen 3SM</h2>
        <p>3SM telt ${filled.length} team${filled.length === 1 ? '' : 's'} met een publiek profiel.</p>
        <ul>
${items}
        </ul>
      </section>`;
};

const buildTeamsItemListJsonLd = () => {
  const filled = teamSummaries.filter((team) => team.name);
  return filled.length ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: '3 Stripe Motorsport teams',
    description: 'Overzicht van de teams binnen 3 Stripe Motorsport met hun coureurs en prestaties.',
    url: absoluteUrl('/teams'),
    itemListElement: filled.map((team, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'SportsTeam',
        name: team.name,
        url: entityUrl(teamEntityPath(team)),
        description: team.description || `${team.name} is actief in de 3 Stripe Motorsport iRacing league.`,
        member: team.members.slice(0, 20).map((member) => ({ '@type': 'Person', name: member.name })),
        parentOrganization: organizationRefJsonLd(),
      },
    })),
  } : null;
};

const buildSeasonsHubCrawlerHtml = () => {
  if (!leagueSummaries.length) return '';
  const items = leagueSummaries.map((league) => {
    const meta = [
      league.season ? `Seizoen ${league.season}` : null,
      league.carClass ? `Klasse: ${league.carClass}` : null,
      `${league.completed} van ${league.total} races verreden`,
      league.leaderName ? `Aanvoerder: ${league.leaderName} (${league.leaderPoints} punten)` : null,
      league.topThree.length ? `Top 3: ${league.topThree.join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    return `          <li>${entityLink(seasonEntityPath(league), league.label)}${meta ? ` — ${escapeHtml(meta)}.` : ''}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare seizoenen">
        <h2>Seizoenen en competities</h2>
        <p>3SM heeft ${leagueSummaries.length} competitie${leagueSummaries.length === 1 ? '' : 's'} met een eigen kalender, stand en uitslagen.</p>
        <ul>
${items}
        </ul>
      </section>`;
};

const buildSeasonsItemListJsonLd = () => (leagueSummaries.length ? {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3 Stripe Motorsport seizoenen en competities',
  description: 'Overzicht van de competities van 3 Stripe Motorsport met kalender, stand en uitslagen.',
  url: absoluteUrl('/seasons'),
  itemListElement: leagueSummaries.map((league, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'WebPage',
      name: league.label,
      url: entityUrl(seasonEntityPath(league)),
      description: `${league.label}: ${league.completed} van ${league.total} races verreden${league.leaderName ? `, aanvoerder ${league.leaderName}` : ''}.`,
      isPartOf: { '@type': 'WebSite', name: '3 Stripe Motorsport', url: SITE_URL },
      about: organizationRefJsonLd(),
    },
  })),
} : null);

const leaguesWithStandings = () => leagueSummaries.filter((league) => (standingsByLeague.get(league.id) || []).length);

const summarizeCalendarRaceForHub = (race) => ({
  id: race.id,
  path: '/calendar',
  name: cleanText(race.name),
  track: cleanText(race.track),
  raceDate: race.race_date,
  formattedDate: formatDateNl(race.race_date) || dateOnly(race.race_date),
  round: race.round,
  leagueName: cleanText(race.leagues?.name) || null,
  carClass: cleanText(race.leagues?.car_class) || null,
});

const buildCalendarHubCrawlerHtml = (summaries) => {
  if (!summaries.length) return '';

  const next = summaries[0];
  const raceItems = summaries.slice(0, 40).map((race) => {
    const meta = [race.track, race.formattedDate, race.carClass || race.leagueName].filter(Boolean).join(' · ');
    return `          <li><a href="${absoluteUrl(race.path)}">${escapeHtml(race.name)}</a>${meta ? ` — ${escapeHtml(meta)}.` : ''}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare racekalender">
        <h2>Eerstvolgende 3SM race</h2>
        <p><a href="${absoluteUrl(next.path)}">${escapeHtml(next.name)}</a>${next.track ? ` op ${escapeHtml(next.track)}` : ''}${next.formattedDate ? ` (${escapeHtml(next.formattedDate)})` : ''}${next.carClass ? ` in de ${escapeHtml(next.carClass)} klasse` : ''}.</p>
        <h2>Aankomende races</h2>
        <ul>
${raceItems}
        </ul>
      </section>`;
};

const buildCalendarHubItemListJsonLd = (summaries) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3 Stripe Motorsport racekalender',
  description: 'Overzicht van aankomende 3SM iRacing races met datum, circuit, klasse en competitie.',
  url: absoluteUrl('/calendar'),
  itemListElement: summaries.slice(0, 40).map((race, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'SportsEvent',
      name: race.name,
      startDate: race.raceDate,
      url: absoluteUrl(race.path),
      location: race.track ? {
        '@type': 'Place',
        name: race.track,
      } : undefined,
      organizer: organizationRefJsonLd(),
      sport: 'Sim racing',
      eventStatus: 'https://schema.org/EventScheduled',
      description: `${race.name}${race.track ? ` op ${race.track}` : ''}${race.carClass ? ` met ${race.carClass}` : ''}: aankomende iRacing race van 3 Stripe Motorsport.`,
    },
  })),
});

const sortedRaceResults = (race) => [...(race.race_results || [])]
  .filter((result) => result.position)
  .sort((a, b) => (a.position || 999) - (b.position || 999));

const summarizeRaceForHub = (race) => {
  const results = sortedRaceResults(race);
  const podium = results.slice(0, 3).map((result) => ({
    position: result.position,
    name: driverName(result),
    points: result.points,
    laps: result.laps,
    fastestLap: Boolean(result.fastest_lap),
  }));
  const winner = podium[0]?.name || null;
  const fastestLap = results.find((result) => result.fastest_lap);

  const displayName = titleish(race.name);
  const trackName = cleanText(race.track);
  const className = cleanText(race.leagues?.car_class);
  const dateLabel = formatDateNl(race.race_date) || dateOnly(race.race_date);
  // Beschrijvend en uniek: naam alléén gaf duplicaten (twee keer "Race 1", twee
  // keer "daytona") en ankerteksten zonder context. Met circuit, klasse en datum
  // erbij is elke titel en elk anker uniek en zegt hij waar de link over gaat.
  const label = [displayName, trackName ? `op ${trackName}` : null, className, dateLabel].filter(Boolean).join(' · ');
  const linkLabel = `${displayName}${trackName ? ` op ${trackName}` : ''} race-uitslag`;

  return {
    id: race.id,
    path: `/results/${race.id}`,
    name: displayName,
    label,
    linkLabel,
    track: trackName,
    raceDate: race.race_date,
    formattedDate: dateLabel,
    round: race.round,
    leagueName: cleanText(race.leagues?.name) || null,
    carClass: className || null,
    winner,
    podium,
    fastestLap: fastestLap ? driverName(fastestLap) : null,
    classifiedCount: results.length,
  };
};

// B2: de kerninhoud ook in de crawler-HTML zetten. Race-detailpagina's hadden
// alleen een samenvatting (244 crawl-bare woorden tegen 763 met JS) en
// nieuwsartikelen alleen een excerpt van 220 tekens — de uitslag en de
// artikelbody stonden uitsluitend in de JS-render.
const buildRaceResultTableHtml = (race, limit = 25) => {
  const all = sortedRaceResults(race);
  if (!all.length) return '';
  const rows = all.slice(0, limit).map((result) => {
    const cells = [
      result.position ?? '',
      driverName(result) || '',
      result.laps ?? '',
      result.points ?? '',
      result.fastest_lap ? 'ja' : '',
    ];
    return `            <tr>${cells.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`;
  }).join('\n');
  const suffix = all.length > limit ? ` (eerste ${limit} van ${all.length})` : '';
  return `        <h2>Volledige uitslag${suffix}</h2>
        <table>
          <thead>
            <tr><th>Positie</th><th>Coureur</th><th>Rondes</th><th>Punten</th><th>Snelste ronde</th></tr>
          </thead>
          <tbody>
${rows}
          </tbody>
        </table>`;
};

const buildArticleBodyHtml = (post, maxWords = 350) => {
  const raw = String(post.content_html || '').trim();
  if (!raw) return '';
  const withBreaks = raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  const paragraphs = withBreaks.split(/\n{2,}/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    if (words >= maxWords) break;
    const slice = paragraph.split(' ').slice(0, maxWords - words).join(' ').trim();
    if (!slice) continue;
    out.push(`        <p>${escapeHtml(slice)}</p>`);
    words += slice.split(' ').length;
  }
  if (!out.length) return '';
  return `        <h2>Het volledige artikel</h2>\n${out.join('\n')}`;
};

// B4: structured data per pagina in plaats van alleen ItemList op de hubs.
// Een verreden race mag niet als "gepland" in de structured data staan. Google
// gebruikt eventStatus onder meer voor event-rich-results en voor het begrijpen
// of een pagina een aankondiging of een verslag is. Alle 42 uitslagpagina's
// stonden op EventScheduled terwijl de race allang gereden was.
const raceEventStatus = (race) => {
  if (race?.status === 'completed') return 'https://schema.org/EventEnded';
  if (race?.status === 'cancelled') return 'https://schema.org/EventCancelled';
  return 'https://schema.org/EventScheduled';
};

const buildRaceSportsEventJsonLd = (race) => ({
  '@context': 'https://schema.org',
  '@type': 'SportsEvent',
  name: cleanText(race.name),
  startDate: race.race_date || undefined,
  url: absoluteUrl(`/results/${race.id}`),
  eventStatus: raceEventStatus(race),
  sport: 'Motorsport',
  description: truncate(`Uitslag en racegegevens van ${cleanText(race.name)}${race.track ? ` op ${cleanText(race.track)}` : ''} bij 3 Stripe Motorsport.`),
  location: race.track ? { '@type': 'Place', name: cleanText(race.track) } : undefined,
  organizer: organizationJsonLd(),
  competitor: sortedRaceResults(race)
    .slice(0, 10)
    .map((result) => ({ '@type': 'Person', name: driverName(result) }))
    .filter((competitor) => competitor.name),
});

// Nieuwsartikelen hebben hero_image_url en og_image_url in de database, maar die
// kwamen niet in de structured data of in de meta-tags terecht. Zonder image is
// een BlogPosting onvolledig voor Google én voor social previews.
const articleImages = (post) => [post?.hero_image_url, post?.og_image_url]
  .filter((url) => typeof url === 'string' && url.startsWith('http'));

const buildArticleBlogPostingJsonLd = (post) => {
  const path = `/news/${categoryToSlug(post.category)}/${post.slug}`;
  const images = articleImages(post);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: cleanText(post.title),
    description: truncate(post.seo_description || post.excerpt || post.content_html || ''),
    url: absoluteUrl(path),
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at || post.published_at || undefined,
    articleSection: cleanText(post.category) || undefined,
    image: images.length ? images : undefined,
    thumbnailUrl: images[0],
    mainEntityOfPage: { '@type': 'WebPage', '@id': absoluteUrl(path) },
    author: { '@type': 'Organization', name: '3 Stripe Motorsport', url: 'https://3stripemotorsport.cc/' },
    publisher: { '@type': 'Organization', name: '3 Stripe Motorsport', url: 'https://3stripemotorsport.cc/' },
  };
};

const buildResultsHubCrawlerHtml = (summaries) => {
  if (!summaries.length) return '';

  const latest = summaries[0];
  const podiumList = latest.podium.length
    ? `\n          <ol>\n${latest.podium.map((entry) => `            <li>${escapeHtml(entry.position)}. ${escapeHtml(entry.name)}${entry.points != null ? ` (${escapeHtml(entry.points)} punten)` : ''}</li>`).join('\n')}\n          </ol>`
    : '';

  const archiveItems = summaries.slice(0, 80).map((race) => {
    const meta = [race.track, race.formattedDate, race.leagueName].filter(Boolean).join(' · ');
    const podium = race.podium.length
      ? ` Podium: ${race.podium.map((entry) => `${entry.position}. ${entry.name}`).join(', ')}.`
      : '';
    const winner = race.winner ? ` Winnaar: ${race.winner}.` : '';
    const anchor = race.linkLabel || `${race.name} race-uitslag`;
    return `          <li><a href="${absoluteUrl(race.path)}">${escapeHtml(anchor)}</a>${meta ? ` — ${escapeHtml(meta)}.` : ''}${escapeHtml(winner + podium)}</li>`;
  }).join('\n');

  const latestAnchor = latest.linkLabel || `${latest.name} race-uitslag`;

  return `<section aria-label="Crawler-zichtbare race-uitslagen">
        <h2>Laatste race-uitslag</h2>
        <p><a href="${absoluteUrl(latest.path)}">${escapeHtml(latestAnchor)}</a>${latest.track ? ` op ${escapeHtml(latest.track)}` : ''}${latest.formattedDate ? ` (${escapeHtml(latest.formattedDate)})` : ''}${latest.winner ? `, winnaar ${escapeHtml(latest.winner)}` : ''}.</p>${podiumList}
        <p>Details & delen: open de racepagina voor de volledige uitslag, klasseringen, podium en deelbare race-informatie.</p>
        <h2>Race archief</h2>
        <ul>
${archiveItems}
        </ul>
      </section>`;
};

const buildResultsHubItemListJsonLd = (summaries) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3 Stripe Motorsport race-uitslagen',
  description: 'Overzicht van gereden 3SM iRacing races met circuits, rondes, winnaars en resultaten.',
  url: absoluteUrl('/results'),
  itemListElement: summaries.slice(0, 80).map((race, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'WebPage',
      name: `${race.name} uitslag`,
      description: race.winner
        ? `${race.name}${race.track ? ` op ${race.track}` : ''}: winnaar ${race.winner}.`
        : `${race.name}${race.track ? ` op ${race.track}` : ''}: iRacing race-uitslag van 3 Stripe Motorsport.`,
      url: absoluteUrl(race.path),
      isPartOf: {
        '@type': 'WebSite',
        name: '3 Stripe Motorsport',
        url: SITE_URL,
      },
      about: organizationRefJsonLd(),
    },
  })),
});

const buildNewsSummarizePost = (post) => ({
  path: `/news/${categoryToSlug(post.category)}/${post.slug}`,
  title: cleanText(post.title),
  category: cleanText(post.category) || null,
  excerpt: truncate(post.excerpt || post.content_html || '', 220) || null,
  formattedDate: formatDateNl(post.published_at) || dateOnly(post.published_at),
  publishedDate: dateOnly(post.published_at),
  updatedDate: dateOnly(post.updated_at || post.published_at),
});

const buildNewsHubCrawlerHtml = (summaries) => {
  if (!summaries.length) return '';

  const archiveItems = summaries.slice(0, 80).map((post) => {
    const meta = [post.category, post.formattedDate].filter(Boolean).join(' · ');
    const excerpt = post.excerpt ? ` ${post.excerpt}` : '';
    return `          <li><a href="${absoluteUrl(post.path)}">${escapeHtml(post.title)}</a>${meta ? ` — ${escapeHtml(meta)}.` : ''}${escapeHtml(excerpt)}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare nieuws">
        <h2>Recente 3SM nieuwsartikelen</h2>
        <ul>
${archiveItems}
        </ul>
      </section>`;
};

const buildNewsHubItemListJsonLd = (summaries) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3 Stripe Motorsport nieuws',
  description: 'Overzicht van gepubliceerde 3SM nieuwsartikelen: raceverslagen, updates en verhalen uit de paddock.',
  url: absoluteUrl('/news'),
  itemListElement: summaries.slice(0, 80).map((post, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'BlogPosting',
      headline: post.title,
      datePublished: post.publishedDate,
      dateModified: post.updatedDate,
      description: post.excerpt || undefined,
      url: absoluteUrl(post.path),
      mainEntityOfPage: absoluteUrl(post.path),
    },
  })),
});

const buildRaceDetails = (race) => {
  const raceDate = formatDateNl(race.race_date) || dateOnly(race.race_date);
  const leagueName = race.leagues?.name;
  const carClass = race.leagues?.car_class;
  const results = [...(race.race_results || [])]
    .filter((result) => result.position)
    .sort((a, b) => (a.position || 999) - (b.position || 999));
  const podium = results.slice(0, 3).map((result) => `${result.position}. ${driverName(result)}`);
  const winner = results[0] ? driverName(results[0]) : null;
  const fastestLap = results.find((result) => result.fastest_lap);
  const facts = [
    raceDate ? `Datum: ${raceDate}.` : null,
    race.track ? `Circuit: ${race.track}.` : null,
    leagueName ? `Competitie: ${leagueName}.` : null,
    carClass ? `Klasse: ${carClass}.` : null,
    results.length ? `Aantal geklasseerde coureurs: ${results.length}.` : null,
    winner ? `Winnaar: ${winner}.` : null,
    podium.length ? `Podium: ${podium.join(', ')}.` : null,
    fastestLap ? `Snelste ronde: ${driverName(fastestLap)}.` : null,
  ].filter(Boolean);

  return {
    facts,
    summary: [
      `Deze racepagina bundelt de officiële 3SM uitslag van ${race.name}${race.track ? ` op ${race.track}` : ''}${raceDate ? ` (${raceDate})` : ''}.`,
      results.length
        ? `De pagina bevat klasseringen, ronden, punten en racegegevens voor ${results.length} coureurs${winner ? `, met ${winner} als winnaar` : ''}.`
        : 'De pagina is voorbereid als openbare uitslagpagina en verwijst door naar de volledige resultatenhub.',
    ],
  };
};

const parseEnvFile = (file) => {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
};

const getSupabaseClient = () => {
  const env = {
    ...parseEnvFile(new URL('../.env', import.meta.url).pathname),
    ...parseEnvFile(new URL('../.env.local', import.meta.url).pathname),
    ...parseEnvFile(new URL('../.env.production', import.meta.url).pathname),
    ...parseEnvFile(new URL('../.env.production.local', import.meta.url).pathname),
    ...process.env,
  };
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
};

const dateOnly = (value) => value ? new Date(value).toISOString().slice(0, 10) : buildDate;

const fetchDynamicRoutes = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    // Een build zonder Supabase-env genereert alleen de statische routes. Dat is
    // eerder stil doorgegaan en ruimde via rsync --delete 47 gepubliceerde nieuws-
    // en uitslagpagina's op (sitemap 57 -> 10). Breek daarom af VOORDAT er iets
    // gepubliceerd wordt; een release-worktree heeft geen .env (untracked).
    if (process.env.ALLOW_MISSING_SUPABASE_ENV === '1') {
      console.warn('Supabase env ontbreekt; alleen statische routes (ALLOW_MISSING_SUPABASE_ENV=1).');
      return [];
    }
    throw new Error(
      'Supabase env ontbreekt: nieuws- en uitslagroutes kunnen niet gegenereerd worden. '
      + 'Afgebroken voordat er iets gepubliceerd wordt. Zet een .env met VITE_SUPABASE_URL en '
      + 'VITE_SUPABASE_ANON_KEY in de checkout, of zet ALLOW_MISSING_SUPABASE_ENV=1 als je '
      + 'bewust een build zonder dynamische routes wilt.',
    );
  }

  const dynamicRoutes = [];

  const { data: upcomingRaces, error: upcomingRaceError } = await supabase
    .from('races')
    .select('id,name,track,race_date,round,status,leagues(name,car_class)')
    .neq('status', 'completed')
    .gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true })
    .limit(80);

  if (upcomingRaceError) {
    console.warn(`Kon aankomende races niet ophalen voor calendar SEO: ${upcomingRaceError.message}`);
  } else {
    calendarHubSummaries = (upcomingRaces || []).map(summarizeCalendarRaceForHub);
  }

  const { data: completedRaces, error: raceError } = await supabase
    .from('races')
    .select('id,name,track,race_date,round,updated_at,status,league_id,leagues(name,car_class),race_results(position,laps,points,fastest_lap,user_id)')
    .eq('status', 'completed')
    .order('race_date', { ascending: false })
    .limit(250);

  if (raceError) {
    console.warn(`Kon race-detail routes niet ophalen voor sitemap: ${raceError.message}`);
  } else {
    const resultUserIds = [...new Set((completedRaces || []).flatMap((race) => (race.race_results || []).map((result) => result.user_id).filter(Boolean)))];
    let publicProfileByUserId = new Map();

    if (resultUserIds.length) {
      const { data: publicProfiles, error: publicProfilesError } = await supabase
        .from('public_profiles')
        .select('user_id,display_name,iracing_name')
        .in('user_id', resultUserIds);

      if (publicProfilesError) {
        console.warn(`Kon publieke coureurnamen niet ophalen voor sitemap: ${publicProfilesError.message}`);
      } else {
        publicProfileByUserId = new Map((publicProfiles || []).map((profile) => [profile.user_id, profile]));
      }
    }

    const completedRacesWithPublicProfiles = (completedRaces || []).map((race) => ({
      ...race,
      race_results: (race.race_results || []).map((result) => ({
        ...result,
        profiles: publicProfileByUserId.get(result.user_id) || null,
      })),
    }));

    resultsHubSummaries = completedRacesWithPublicProfiles.map(summarizeRaceForHub);
    completedRacePool = completedRacesWithPublicProfiles;

    for (const race of completedRacesWithPublicProfiles) {
      const raceDate = dateOnly(race.race_date);
      const raceName = titleish(race.name);
      const trackName = cleanText(race.track);
      const track = trackName ? ` op ${trackName}` : '';
      const className = cleanText(race.leagues?.car_class);
      const carClass = className ? `${className} ` : '';
      const leagueName = cleanText(race.leagues?.name);
      // Titel en h1 met circuit, klasse en datum: zonder die context waren er zes
      // pagina's met een identieke titel (twee keer "Race 1 uitslag", twee keer
      // "Race 2 uitslag", twee keer "daytona uitslag") en 19 titels die niets
      // meer zeiden dan het racenummer.
      const dateLabel = formatDateNl(race.race_date) || raceDate;
      const routeLabel = [raceName, dateLabel, trackName, className, leagueName].filter(Boolean).join(' · ');
      const raceDetails = buildRaceDetails(race);
      dynamicRoutes.push({
        path: `/results/${race.id}`,
        // Datum direct na de naam: het circuit opslokte de 62 tekens en dan vielen
        // twee races op hetzelfde circuit samen in één titel (Daytona, twee keer).
        title: truncate(`Uitslag ${raceName} · ${dateLabel} · ${trackName}${className ? ` · ${className}` : ''}`, 62),
        priority: '0.6',
        changefreq: 'monthly',
        lastmod: dateOnly(race.race_date),
        description: truncate(`Bekijk de ${carClass}iRacing race-uitslag van ${raceName}${track}${leagueName ? ` in ${leagueName}` : ''} op ${raceDate}: klasseringen, rondes, podium en racegegevens van 3SM.`),
        h1: `Uitslag ${raceName}${track}${className ? ` (${className})` : ''}`,
        intro: `Bekijk de race-uitslag van ${raceName}${track}${className ? ` in de ${className} klasse` : ''}, inclusief klasseringen, rondes en racegegevens.`,
        details: raceDetails.summary,
        facts: raceDetails.facts,
        crawlerHtml: buildRaceResultTableHtml(race),
        extraJsonLd: [
          { id: 'sportsevent-jsonld', data: buildRaceSportsEventJsonLd(race) },
        ],
        links: [
          ['/results', 'Terug naar race-uitslagen'],
          ['/standings', 'Bekijk standings'],
          ['/calendar', 'Bekijk racekalender'],
        ],
      });
    }
  }

  // Hubdata voor /standings, /drivers, /teams en /seasons. Zonder deze data in de
  // HTML-bytes waren die vier pagina's voor een crawler zonder JavaScript leeg: de
  // stand, de coureurs en de teams kwamen uitsluitend na hydratatie uit de API.
  const { data: allRaceRows, error: allRaceError } = await supabase
    .from('races')
    .select('id,league_id,status');
  if (allRaceError) console.warn(`Kon alle races niet ophalen voor hubdata: ${allRaceError.message}`);

  const { data: leagueRows, error: leagueError } = await supabase
    .from('leagues')
    .select('id,name,season,car_class,description,status,created_at')
    .order('created_at', { ascending: false });
  if (leagueError) console.warn(`Kon competities niet ophalen voor hubdata: ${leagueError.message}`);

  const { data: profileRows, error: profileError } = await supabase
    .from('public_profiles')
    .select('user_id,display_name,iracing_name,irating,team_id');
  if (profileError) console.warn(`Kon coureursprofielen niet ophalen voor hubdata: ${profileError.message}`);

  const { data: teamRowData, error: teamRowError } = await supabase
    .from('teams')
    .select('id,name,color,description')
    .order('name');
  if (teamRowError) console.warn(`Kon teams niet ophalen voor hubdata: ${teamRowError.message}`);

  const { data: membershipData, error: membershipError } = await supabase
    .from('team_memberships')
    .select('team_id,user_id,role');
  if (membershipError) console.warn(`Kon teamleden niet ophalen voor hubdata: ${membershipError.message}`);

  const profileByUserId = new Map((profileRows || []).map((profile) => [profile.user_id, profile]));
  const teamById = new Map((teamRowData || []).map((team) => [team.id, team]));

  const teamNameFor = (userId) => {
    const teamId = profileByUserId.get(userId)?.team_id;
    return teamId ? cleanText(teamById.get(teamId)?.name) || null : null;
  };

  // Totaal en verreden per competitie. Een geannuleerde race telt niet mee: die
  // staat niet in het archief en zou het "x van y verreden"-beeld vertekenen.
  const leagueRaceCounts = new Map();
  for (const race of allRaceRows || []) {
    if (!race.league_id || race.status === 'cancelled') continue;
    const bucket = leagueRaceCounts.get(race.league_id) || { total: 0, completed: 0 };
    bucket.total += 1;
    if (race.status === 'completed') bucket.completed += 1;
    leagueRaceCounts.set(race.league_id, bucket);
  }

  const aggregatePool = (races) => {
    const byUser = new Map();
    for (const race of races) {
      for (const result of race.race_results || []) {
        if (!result.user_id) continue;
        const entry = byUser.get(result.user_id) || { points: 0, wins: 0, podiums: 0, fastestLaps: 0, races: 0 };
        entry.points += result.points || 0;
        entry.races += 1;
        if (result.position === 1) entry.wins += 1;
        if (result.position != null && result.position <= 3) entry.podiums += 1;
        if (result.fastest_lap) entry.fastestLaps += 1;
        byUser.set(result.user_id, entry);
      }
    }
    return byUser;
  };

  const completedRacesWithLeague = completedRacePool;

  const sortedRows = (byUser) => [...byUser.entries()]
    .map(([userId, stats]) => ({
      userId,
      name: driverLabel(profileByUserId.get(userId)),
      teamName: teamNameFor(userId),
      ...stats,
    }))
    .sort((a, b) =>
      b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || b.fastestLaps - a.fastestLaps || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, position: index + 1 }));

  standingsByLeague = new Map();
  for (const leagueId of leagueRaceCounts.keys()) {
    const rows = sortedRows(aggregatePool(completedRacesWithLeague.filter((race) => race.league_id === leagueId)));
    if (rows.length) standingsByLeague.set(leagueId, rows);
  }

  const leagueLabelOf = (league) =>
    [cleanText(league?.name), league?.season ? String(league.season) : null].filter(Boolean).join(' ');

  leagueSummaries = (leagueRows || [])
    .filter((league) => cleanText(league.name))
    .map((league) => {
      const rows = standingsByLeague.get(league.id) || [];
      const counts = leagueRaceCounts.get(league.id) || { total: 0, completed: 0 };
      return {
        id: league.id,
        // Let op: 'name' moet er blijven staan. seasonEntityPath() bouwt de
        // seizoens-URL uit naam + seizoen, precies zoals src/lib/entityLinks.ts
        // dat doet. Zonder dit veld werd de slug alleen het seizoen ("2026-s2")
        // en liep de prerender uit de pas met wat de client zelf opent.
        name: cleanText(league.name),
        label: leagueLabelOf(league) || 'Competitie',
        season: league.season,
        carClass: cleanText(league.car_class) || null,
        description: cleanText(league.description) || null,
        total: counts.total,
        completed: counts.completed,
        standingsCount: rows.length,
        leaderName: rows[0]?.name || null,
        leaderPoints: rows[0]?.points ?? null,
        topThree: rows.slice(0, 3).map((row) => `${row.name} (${row.points})`),
      };
    })
    .sort((a, b) => (b.standingsCount - a.standingsCount) || (b.total - a.total) || a.label.localeCompare(b.label));

  const overallByUser = aggregatePool(completedRacesWithLeague);
  driverSummaries = (profileRows || [])
    .map((profile) => ({
      userId: profile.user_id,
      name: driverLabel(profile),
      teamName: teamNameFor(profile.user_id),
      irating: profile.irating ?? null,
      ...(overallByUser.get(profile.user_id) || { points: 0, wins: 0, podiums: 0, fastestLaps: 0, races: 0 }),
    }))
    .filter((driver) => driver.name)
    .sort((a, b) =>
      b.points - a.points || b.wins - a.wins || b.races - a.races || a.name.localeCompare(b.name));

  teamSummaries = (teamRowData || []).map((team) => {
    const memberIds = new Set([
      ...(membershipData || []).filter((membership) => membership.team_id === team.id).map((membership) => membership.user_id),
      ...(profileRows || []).filter((profile) => profile.team_id === team.id).map((profile) => profile.user_id),
    ].filter(Boolean));
    const members = driverSummaries.filter((driver) => memberIds.has(driver.userId));
    return {
      id: team.id,
      name: cleanText(team.name),
      description: cleanText(team.description) || null,
      color: cleanText(team.color) || null,
      members: members.map((member) => ({ name: member.name, points: member.points, wins: member.wins })),
      points: members.reduce((sum, member) => sum + member.points, 0),
      wins: members.reduce((sum, member) => sum + member.wins, 0),
      podiums: members.reduce((sum, member) => sum + member.podiums, 0),
    };
  }).filter((team) => team.name && (team.members.length || team.description));

  const { data: publishedPosts, error: newsError } = await supabase
    .from('news_posts')
    .select('slug,category,title,excerpt,content_html,seo_title,seo_description,published_at,updated_at,status,hero_image_url,og_image_url,hero_image_alt,race_id')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(250);

  if (newsError) {
    console.warn(`Kon nieuws-routes niet ophalen voor sitemap: ${newsError.message}`);
  } else {
    newsHubSummaries = (publishedPosts || []).map(buildNewsSummarizePost);
    for (const post of publishedPosts || []) {
      const categorySlug = categoryToSlug(post.category);
      const isRaceRecap = categorySlug === 'race-recaps';
      const articleSummary = truncate(post.excerpt || post.content_html || 'Nieuws van 3 Stripe Motorsport.', 220);
      dynamicRoutes.push({
        path: `/news/${categorySlug}/${post.slug}`,
        title: truncate(post.seo_title || post.title, 58),
        priority: '0.6',
        changefreq: 'monthly',
        image: articleImages(post)[0],
        lastmod: dateOnly(post.updated_at || post.published_at),
        description: truncate(post.seo_description || post.excerpt || post.content_html || 'Nieuws van 3 Stripe Motorsport.'),
        h1: post.title,
        intro: articleSummary,
        details: [
          `Dit nieuwsartikel hoort bij de 3SM categorie ${post.category || 'Nieuws'} en is gepubliceerd als onderdeel van de 3 Stripe Motorsport community.`,
          articleSummary,
        ],
        crawlerHtml: buildArticleBodyHtml(post),
        extraJsonLd: [
          { id: 'blogposting-jsonld', data: buildArticleBlogPostingJsonLd(post) },
        ],
        links: [
          ['/news', 'Terug naar nieuws'],
          ...(isRaceRecap ? [['/meedoen', 'Zelf meerijden? Bekijk hoe je meedoet']] : []),
          ['/calendar', 'Bekijk racekalender'],
          ['/results', 'Bekijk uitslagen'],
        ],
      });
    }
  }

  // Categorie-hubs (/news/<categorie>). Dit zijn geldige app-routes die tot nu toe
  // HTTP 403 gaven omdat de map wel bestond maar geen index.html had. Ze worden nu
  // als echte, indexeerbare hub geprerenderd met de artikelen uit die categorie.
  const categoryGroups = new Map();
  for (const post of publishedPosts || []) {
    const slug = categoryToSlug(post.category);
    if (!slug) continue;
    if (!categoryGroups.has(slug)) {
      categoryGroups.set(slug, { label: cleanText(post.category) || 'Nieuws', posts: [] });
    }
    categoryGroups.get(slug).posts.push(post);
  }
  for (const [slug, group] of categoryGroups) {
    const summaries = group.posts.map(buildNewsSummarizePost);
    const latest = group.posts
      .map((post) => post.updated_at || post.published_at)
      .filter(Boolean)
      .sort()
      .pop();
    const label = group.label;
    dynamicRoutes.push({
      path: `/news/${slug}`,
      title: truncate(`${label} - 3 Stripe Motorsport nieuws`, 58),
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: dateOnly(latest),
      description: truncate(
        `Alle 3SM artikelen in de categorie ${label}: raceverslagen, updates en verhalen uit de 3 Stripe Motorsport paddock.`,
      ),
      h1: label,
      intro: `Overzicht van ${summaries.length} gepubliceerd${summaries.length === 1 ? '' : 'e'} artikel${summaries.length === 1 ? '' : 'en'} in de categorie ${label}.`,
      details: [
        `Deze categoriepagina bundelt de 3 Stripemotorsport-artikelen over ${label.toLowerCase()}.`,
        'Klik door naar een artikel voor het volledige verslag, of ga terug naar het volledige nieuwsoverzicht.',
      ],
      links: [
        ['/news', 'Alle nieuwsartikelen'],
        ['/results', 'Bekijk uitslagen'],
        ['/calendar', 'Bekijk racekalender'],
      ],
      crawlerHtml: buildNewsHubCrawlerHtml(summaries),
      extraJsonLd: [
        { id: 'news-category-itemlist-jsonld', data: buildNewsHubItemListJsonLd(summaries) },
      ],
    });
  }

  // De categoriehubs (/news/<categorie>) hadden nul inkomende links: alleen de
  // artikelen linkten terug. Zonder link vanaf de nieuwshub is zo'n hub voor een
  // crawler onvindbaar zolang de sitemap niet wordt opgehaald.
  const newsHubRoute = routes.find((route) => route.path === '/news');
  if (newsHubRoute) {
    for (const [slug, group] of categoryGroups) {
      const categoryPath = `/news/${slug}`;
      const alreadyLinked = (newsHubRoute.links || []).some(([href]) => href.replace(/\/$/, '') === categoryPath);
      if (!alreadyLinked) {
        newsHubRoute.links = [
          ...(newsHubRoute.links || []),
          [categoryPath, `Alle artikelen in ${group.label}`],
        ];
      }
    }
  }

  // ---------- Coureurs, teams en seizoenen als eigen pagina ----------
  // Deze drie bestonden alleen in een popup: geen URL, dus voor Google geen
  // entiteit. Elke coureur, elk team en elk seizoen krijgt hier een echte
  // pagina; de hub-HTML hierboven linkt er al naartoe.
  const hubSummaryByRaceId = new Map(resultsHubSummaries.map((summary) => [summary.id, summary]));
  const summaryForRace = (race) => hubSummaryByRaceId.get(race.id) || summarizeRaceForHub(race);
  const newestFirst = (a, b) => new Date(b.race_date || 0).getTime() - new Date(a.race_date || 0).getTime();
  const racesForDriver = (userId) => completedRacePool
    .filter((race) => (race.race_results || []).some((result) => result.user_id === userId))
    .sort(newestFirst);
  const racePathTaken = (candidate) => dynamicRoutes.some((route) => route.path === candidate);

  for (const driver of driverSummaries) {
    const entityPath = driverEntityPath(driver.name);
    if (!entityPath || racePathTaken(entityPath)) continue;

    const driverRaces = racesForDriver(driver.userId);
    const ownResults = driverRaces.slice(0, 40).map((race) => {
      const summary = summaryForRace(race);
      const own = (race.race_results || []).find((result) => result.user_id === driver.userId) || {};
      return { summary, position: own.position ?? null, points: own.points ?? 0, fastest: Boolean(own.fastest_lap) };
    });

    dynamicRoutes.push({
      path: entityPath,
      title: truncate(`${driver.name} — 3SM coureur`, 58),
      description: truncate(`Profiel van ${driver.name}${driver.teamName ? `, coureur bij team ${driver.teamName}` : ''} in de 3 Stripe Motorsport iRacing league: ${driver.points} punten, ${driver.wins} overwinningen en ${driver.podiums} podiums.`),
      h1: driver.name,
      priority: '0.5',
      changefreq: 'weekly',
      intro: `${driver.name} rijdt in de 3 Stripe Motorsport iRacing league${driver.teamName ? ` voor team ${driver.teamName}` : ''}. Hieronder staan de prestaties en de race-uitslagen waarin deze coureur voorkomt.`,
      facts: [
        driver.teamName ? `Team: ${driver.teamName}.` : null,
        driver.irating ? `iRating: ${driver.irating}.` : null,
        `${driver.races} gestarte race${driver.races === 1 ? '' : 's'}, ${driver.wins} overwinningen en ${driver.podiums} podiums.`,
        `${driver.fastestLaps} snelste ronde${driver.fastestLaps === 1 ? '' : 'n'} en ${driver.points} kampioenschapspunten.`,
      ].filter(Boolean),
      details: ownResults.slice(0, 8).map((entry) => `${entry.summary.formattedDate || ''} ${entry.summary.linkLabel}: ${entry.position ? `${entry.position}e plaats` : 'geen klassering'}${entry.points ? `, ${entry.points} punten` : ''}${entry.fastest ? ', snelste ronde' : ''}.`.replace(/^\\s+/, '')),
      crawlerLinksLabel: `Races van ${driver.name}`,
      crawlerLinks: ownResults.map((entry) => [entry.summary.path, entry.summary.linkLabel]),
      extraJsonLd: [{
        id: 'driver-person-jsonld',
        data: {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: driver.name,
          url: absoluteUrl(entityPath),
          description: `Coureur in de 3 Stripe Motorsport iRacing league${driver.teamName ? ` (team ${driver.teamName})` : ''}.`,
          knowsAbout: ['iRacing', 'sim racing'],
          memberOf: driver.teamName
            ? { '@type': 'SportsTeam', name: driver.teamName, url: entityUrl(teamEntityPath({ name: driver.teamName })) }
            : undefined,
          affiliation: organizationRefJsonLd(),
        },
      }],
    });
  }

  for (const team of teamSummaries) {
    const entityPath = teamEntityPath(team);
    if (!entityPath || racePathTaken(entityPath)) continue;

    const memberLinks = team.members
      .map((member) => [driverEntityPath(member.name), member.name])
      .filter(([memberPath]) => memberPath);

    dynamicRoutes.push({
      path: entityPath,
      title: truncate(`${team.name} — 3SM team`, 58),
      description: truncate(`Team ${team.name} in de 3 Stripe Motorsport iRacing league: ${team.members.length} coureur${team.members.length === 1 ? '' : 's'}, ${team.points} punten, ${team.wins} overwinningen en ${team.podiums} podiums.`),
      h1: team.name,
      priority: '0.5',
      changefreq: 'weekly',
      intro: `${team.name} is een team binnen de 3 Stripe Motorsport iRacing league. Hieronder staan de coureurs, hun punten en de races waarin het team uitkwam.`,
      facts: [
        team.description || null,
        `${team.members.length} coureur${team.members.length === 1 ? '' : 's'}: ${team.members.map((member) => `${member.name} (${member.points} punten)`).join(', ') || 'nog geen'}.`,
        `Samen ${team.points} punten, ${team.wins} overwinningen en ${team.podiums} podiums.`,
      ].filter(Boolean),
      crawlerLinksLabel: `Coureurs van ${team.name}`,
      crawlerLinks: memberLinks,
      extraJsonLd: [{
        id: 'team-sportsteam-jsonld',
        data: {
          '@context': 'https://schema.org',
          '@type': 'SportsTeam',
          name: team.name,
          url: absoluteUrl(entityPath),
          description: team.description || `${team.name} is actief in de 3 Stripe Motorsport iRacing league.`,
          sport: 'Sim racing',
          member: team.members.slice(0, 20).map((member) => ({
            '@type': 'Person',
            name: member.name,
            url: entityUrl(driverEntityPath(member.name)),
          })),
          parentOrganization: organizationRefJsonLd(),
        },
      }],
    });
  }

  for (const league of leagueSummaries) {
    const entityPath = seasonEntityPath(league);
    if (!entityPath || racePathTaken(entityPath)) continue;

    const leagueRaces = completedRacePool.filter((race) => race.league_id === league.id).sort(newestFirst);
    const rows = standingsByLeague.get(league.id) || [];

    dynamicRoutes.push({
      path: entityPath,
      title: truncate(`${league.label} — stand, uitslagen en kalender`, 60),
      description: truncate(`Seizoen ${league.label} van 3 Stripe Motorsport: ${league.completed} van ${league.total} races verreden${league.leaderName ? `, ${league.leaderName} aan de leiding met ${league.leaderPoints} punten` : ''}.`),
      h1: league.label,
      priority: '0.6',
      changefreq: 'weekly',
      intro: `Dit is het seizoensoverzicht van ${league.label}${league.carClass ? ` (${league.carClass})` : ''}: de volledige stand en alle ${leagueRaces.length} verreden races met hun uitslagen.`,
      facts: rows.slice(0, 10).map((row) => `${row.position}. ${row.name}${row.teamName ? ` (${row.teamName})` : ''} — ${row.points} punten, ${row.wins} overwinningen, ${row.podiums} podiums.`),
      details: [
        `${league.completed} van ${league.total} races verreden in ${league.label}.`,
        league.leaderName ? `Aanvoerder: ${league.leaderName} met ${league.leaderPoints} punten.` : null,
        `${rows.length} coureurs met punten in dit seizoen.`,
      ].filter(Boolean),
      crawlerLinksLabel: `Alle races in ${league.label}`,
      crawlerLinks: leagueRaces.map((race) => {
        const summary = summaryForRace(race);
        return [summary.path, summary.linkLabel];
      }),
      extraJsonLd: [{
        id: 'season-races-itemlist-jsonld',
        data: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `Races in ${league.label}`,
          description: `Alle verreden races van ${league.label} binnen de 3 Stripe Motorsport iRacing league.`,
          url: absoluteUrl(entityPath),
          numberOfItems: leagueRaces.length,
          itemListElement: leagueRaces.map((race, index) => {
            const summary = summaryForRace(race);
            return {
              '@type': 'ListItem',
              position: index + 1,
              item: {
                '@type': 'SportsEvent',
                name: summary.label || summary.name,
                url: absoluteUrl(summary.path),
                startDate: race.race_date || undefined,
                eventStatus: 'https://schema.org/EventEnded',
              },
            };
          }),
        },
      }],
    });
  }

  return dynamicRoutes;
};

const replaceOrInsertMeta = (html, selectorRegex, replacement) => {
  if (selectorRegex.test(html)) return html.replace(selectorRegex, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
};

const breadcrumbItem = (position, name, path) => ({
  '@type': 'ListItem',
  position,
  name,
  item: {
    '@type': 'WebPage',
    '@id': absoluteUrl(path),
    url: absoluteUrl(path),
    name,
  },
});

const breadcrumbItemsForRoute = (route) => {
  const items = [breadcrumbItem(1, '3 Stripe Motorsport', '/')];
  if (route.path === '/') return items;

  if (route.path.startsWith('/results/')) {
    items.push(breadcrumbItem(2, 'Race-uitslagen', '/results'));
    items.push(breadcrumbItem(3, route.h1, route.path));
    return items;
  }

  if (route.path.startsWith('/news/') && route.path !== '/news') {
    items.push(breadcrumbItem(2, 'Nieuws', '/news'));
    items.push(breadcrumbItem(3, route.h1, route.path));
    return items;
  }

  items.push(breadcrumbItem(2, route.h1, route.path));
  return items;
};

const buildBreadcrumbJsonLd = (route) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: breadcrumbItemsForRoute(route),
});

const buildWebPageJsonLd = (route) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: route.title,
  description: route.description,
  url: absoluteUrl(route.path),
  isPartOf: {
    '@type': 'WebSite',
    name: '3 Stripe Motorsport',
    url: SITE_URL,
    publisher: organizationJsonLd(),
  },
  about: organizationJsonLd(),
});

const buildWebSiteJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: '3 Stripe Motorsport',
  alternateName: '3SM',
  url: `${SITE_URL}/`,
  inLanguage: 'nl-NL',
  publisher: organizationJsonLd(),
});

const mainNavigationItems = [
  ['Home', '/'],
  ['Racekalender', '/calendar'],
  ['Standings', '/standings'],
  ['Coureurs', '/drivers'],
  ['Teams', '/teams'],
  ['Uitslagen', '/results'],
  ['Nieuws', '/news'],
  ['Seizoenen', '/seasons'],
  ['Meedoen', '/meedoen'],
];

const buildSiteNavigationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: '3SM hoofdnavigatie',
  itemListElement: mainNavigationItems.map(([name, path], index) => ({
    '@type': 'SiteNavigationElement',
    position: index + 1,
    name,
    url: absoluteUrl(path),
  })),
});

const buildJoinFaqJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  inLanguage: 'nl-NL',
  mainEntity: joinFaq.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: answer,
    },
  })),
});

if (joinRoute) {
  joinRoute.extraJsonLd = [{ id: 'join-page-faq-schema', data: buildJoinFaqJsonLd() }];
}

const buildJsonLdScript = (id, data) =>
  `<script type="application/ld+json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const routeSeoStart = '<!-- 3sm-route-seo:start -->';
const routeSeoEnd = '<!-- 3sm-route-seo:end -->';
const legacyRouteSeoStyle = '<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)">';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripGeneratedRouteSeo = (html) => html
  // Current marked route SEO block. This makes repeated generator runs idempotent.
  .replace(new RegExp(`\\s*${escapeRegex(routeSeoStart)}[\\s\\S]*?${escapeRegex(routeSeoEnd)}\\s*`, 'g'), '\n    ')
  // Legacy unmarked block from older builds. Delete everything from the first hidden
  // SEO div until the React root, because nested route content contains many </div>s.
  .replace(new RegExp(`\\s*${escapeRegex(legacyRouteSeoStyle)}[\\s\\S]*?(?=<div id="root"><\\/div>)`, 'g'), '\n    ')
  .replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');

const buildCrawlerLinksHtml = (route) => {
  if (!route.crawlerLinks?.length) return '';

  const links = route.crawlerLinks
    .map(([href, label]) => `          <li><a href="${absoluteUrl(href)}">${escapeHtml(label)}</a></li>`)
    .join('\n');

  return `<nav aria-label="Gerelateerde 3SM pagina's">
        <strong>${escapeHtml(route.crawlerLinksLabel || 'Gerelateerde pagina\'s')}</strong>
        <ul>
${links}
        </ul>
      </nav>`;
};

const buildRouteDetailsHtml = (route) => {
  const detailParagraphs = (route.details || [])
    .filter(Boolean)
    .map((detail) => `        <p>${escapeHtml(detail)}</p>`)
    .join('\n');
  const facts = (route.facts || [])
    .filter(Boolean)
    .map((fact) => `          <li>${escapeHtml(fact)}</li>`)
    .join('\n');

  return `${detailParagraphs}${facts ? `\n        <ul>\n${facts}\n        </ul>` : ''}${route.crawlerHtml ? `\n${route.crawlerHtml}` : ''}`;
};

const buildRichContent = (route, faq) => {
  const breadcrumb = route.path === '/'
    ? ''
    : `<nav aria-label="Breadcrumb">
      <ol>
        <li><a href="${SITE_URL}/">3 Stripe Motorsport</a></li>
        <li aria-current="page">${escapeHtml(route.h1)}</li>
      </ol>
    </nav>`;

  // Use generic tags (strong/span) instead of semantic FAQ tags (section/article/h3)
  // to avoid Google detecting a duplicate FAQPage from HTML alongside JSON-LD
  const faqHtml = faq
    ? `<div>
${faq
          .map(
            ({ question, answer }) =>
              `        <div style="margin-bottom:1em">
          <strong>${escapeHtml(question)}</strong><br>
          <span>${escapeHtml(answer)}</span>
        </div>`,
          )
          .join('\n')}
      </div>`
    : '';

  return `${breadcrumb}
      <div aria-hidden="true" aria-label="3SM pagina-informatie">
        <p><strong>${escapeHtml(route.h1)}</strong></p>
        <p>${escapeHtml(route.intro)}</p>
${buildRouteDetailsHtml(route)}
      </div>
      ${faqHtml}`;
};

const buildJoinRootFallback = (route) => {
  const details = (route.details || []).map((detail) => `<p>${escapeHtml(detail)}</p>`).join('\n        ');
  const links = (route.links || []).map(([href, label]) => `<li><a href="${absoluteUrl(href)}">${escapeHtml(label)}</a></li>`).join('');
  const faq = (route.faq || []).map(({ question, answer }) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('\n        ');
  return `<main style="max-width:72rem;margin:0 auto;padding:3rem 1.25rem;color:#f5f5f5;background:#080a0f;font-family:system-ui,sans-serif;line-height:1.7">
      <header>
        <p>3 Stripe Motorsport</p>
        <h1>${escapeHtml(route.h1)}</h1>
        <p>${escapeHtml(route.intro)}</p>
      </header>
      <section aria-labelledby="join-facts-heading">
        <h2 id="join-facts-heading">Nederlandse iRacing community en league</h2>
        ${details}
        <p>Deelname is gratis. Er geldt geen minimum iRating of Safety Rating. Beginners, ervaren coureurs, solo racers en eigen teams zijn welkom.</p>
        <p>GT3 is momenteel de belangrijkste klasse. Andere klassen kunnen volgen bij voldoende interesse. De endurance-planningslaag is actief in ontwikkeling en nog niet volledig beschikbaar.</p>
      </section>
      <nav aria-label="Belangrijke 3SM links"><ul>${links}</ul></nav>
      <section aria-labelledby="join-faq-heading">
        <h2 id="join-faq-heading">Veelgestelde vragen over meedoen</h2>
        ${faq}
      </section>
      <p><a href="https://discord.gg/H7tZVuzBgT">Join de 3SM Discord</a></p>
    </main>`;
};

const applyRouteMeta = (html, route) => {
  const canonical = absoluteUrl(route.path);
  const title = escapeAttr(route.title);
  const description = escapeAttr(route.description);
  const url = escapeAttr(canonical);

  let out = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  out = replaceOrInsertMeta(out, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${description}" />`);
  out = replaceOrInsertMeta(out, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${url}" />`);
  out = replaceOrInsertMeta(out, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${title}" />`);
  out = replaceOrInsertMeta(out, /<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${description}" />`);
  out = replaceOrInsertMeta(out, /<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${url}" />`);
  out = replaceOrInsertMeta(out, /<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${title}" />`);
  out = replaceOrInsertMeta(out, /<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${description}" />`);
  if (route.image) {
    const imageUrl = escapeAttr(route.image);
    out = replaceOrInsertMeta(out, /<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${imageUrl}" />`);
    out = replaceOrInsertMeta(out, /<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${imageUrl}" />`);
  }
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-webpage"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-breadcrumb"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="site-website"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="site-navigation"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-faq"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="join-page-faq-schema"[\s\S]*?<\/script>\n?\s*/g, '\n');
  const routeJsonLd = [
    ...(route.path === '/' ? [
      buildJsonLdScript('site-website', buildWebSiteJsonLd()),
      buildJsonLdScript('site-navigation', buildSiteNavigationJsonLd()),
    ] : []),
    buildJsonLdScript('route-webpage', buildWebPageJsonLd(route)),
    buildJsonLdScript('route-breadcrumb', buildBreadcrumbJsonLd(route)),
    ...(route.extraJsonLd || []).map(({ id, data }) => buildJsonLdScript(id, data)),
  ].join('\n    ');
  const extraJsonLd = ''; // FAQPage removed — sr-only workaround not accepted by Google
  out = out.replace(
    '</head>',
    `    ${routeJsonLd}${extraJsonLd}\n  </head>`,
  );
  out = stripGeneratedRouteSeo(out);
  if (route.path === '/meedoen') {
    return out.replace(
      '<div id="root"></div>',
      `<div id="root">${buildJoinRootFallback(route)}</div>`,
    );
  }
  const richContent = buildRichContent(route, null); // FAQ removed — no JSON-LD to back it
  const noscriptLinks = route.links || [];
  const noscriptCrawlerLinks = route.crawlerLinks?.length ? buildCrawlerLinksHtml(route) : '';
  const noscript = `<noscript>
    <main>
      <h1>${escapeHtml(route.h1)}</h1>
      <p>${escapeHtml(route.intro)}</p>
${buildRouteDetailsHtml(route)}
      <nav aria-label="Belangrijke 3SM links">
        <ul>${noscriptLinks.map(([href, label]) => `<li><a href="${absoluteUrl(href)}">${escapeHtml(label)}</a></li>`).join('')}</ul>
      </nav>
      ${noscriptCrawlerLinks}
    </main>
  </noscript>`;
  const routeSeoBlock = `${routeSeoStart}
  <div inert aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)">
      ${richContent}
    </div>
  ${noscript}
  ${routeSeoEnd}`;
  // sr-only blok: de inhoud staat in de HTML-bytes voor crawlers die geen JS
  // draaien, maar is onzichtbaar en mag daarom ook niet bedienbaar zijn.
  // inert + aria-hidden is geen sier: de clip-truc hierboven verbergt het blok
  // voor het oog maar niet voor het toetsenbord, dus de links erin waren
  // focusbaar (tabben door onzichtbare links) en axe-core zakte op deze regel
  // (aria-hidden-focus: een aria-hidden element mag geen focusbare inhoud
  // bevatten). inert haalt het uit de tab-volgorde en uit de
  // toegankelijkheidsboom; de HTML-bytes voor crawlers blijven ongewijzigd.
  out = out.replace(
    '<div id="root"></div>',
    `${routeSeoBlock}\n  <div id="root"></div>`,
  );
  return out;
}

const applyNoindexMeta = (html, path) => {
  const canonical = escapeAttr(absoluteUrl(path));
  let out = replaceOrInsertMeta(html, /<meta name="robots" content="[^"]*"\s*\/>/, '<meta name="robots" content="noindex, nofollow" />');
  out = replaceOrInsertMeta(out, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`);
  out = out.replace(/<title>.*?<\/title>/s, '<title>3 Stripe Motorsport</title>');
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');
  return out;
};

const generateSitemap = () => {
  const urls = sitemapRoutes
    .map(
      (route) => `  <url>
    <loc>${absoluteUrl(route.path)}</loc>${lastmodXml(route)}
    <changefreq>${route.changefreq || 'monthly'}</changefreq>
    <priority>${route.priority}</priority>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

const routeIndexPath = (routePath, baseDir = distDir) => join(baseDir, routePath.replace(/^\//, ''), 'index.html');
const routeDirectoryPath = (routePath, baseDir = distDir) => dirname(routeIndexPath(routePath, baseDir));

const readPreviousManifest = () => {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
};

const cleanupStaleGeneratedRoutes = (previousManifest, nextDynamicRoutes) => {
  const nextDynamicPaths = new Set(nextDynamicRoutes.map((route) => route.path));
  // Prefixen van gegenereerde pagina's. Staat hier ook /drivers/<naam> tussen,
  // dan ruimt het opschonen een verwijderde coureur op; zonder dat blijft zo'n
  // pagina als spook-URL in de build staan.
  const generatedPrefixes = ['/news/', '/results/', '/drivers/', '/teams/', '/seasons/'];
  for (const stalePath of previousManifest?.dynamicRoutes || []) {
    if (nextDynamicPaths.has(stalePath)) continue;
    if (!generatedPrefixes.some((prefix) => stalePath.startsWith(prefix))) continue;
    rmSync(routeDirectoryPath(stalePath), { recursive: true, force: true });
  }
};

const dynamicRoutes = await fetchDynamicRoutes();
const resultDetailRoutes = dynamicRoutes.filter((route) => route.path.startsWith('/results/'));
// Detailroutes hebben 3 segmenten (/news/<categorie>/<slug>); categorie-hubs 2.
const newsDetailRoutes = dynamicRoutes.filter(
  (route) => route.path.startsWith('/news/') && route.path.split('/').filter(Boolean).length === 3,
);
const toCrawlerLinks = (items, limit = 60, excludePath = '') => items
  .filter((item) => item.path !== excludePath)
  .slice(0, limit)
  .map((item) => [item.path, item.h1 || item.title]);

const calendarRoute = routes.find((route) => route.path === '/calendar');
if (calendarRoute && calendarHubSummaries.length) {
  const next = calendarHubSummaries[0];
  calendarRoute.details = [
    `Eerstvolgende race: ${next.name}${next.track ? ` op ${next.track}` : ''}${next.formattedDate ? ` (${next.formattedDate})` : ''}${next.carClass ? ` met ${next.carClass}` : ''}.`,
    `De kalender bevat ${calendarHubSummaries.length} aankomende races met datum, circuit, klasse en competitie-informatie voor de 3SM iRacing league.`,
  ];
  calendarRoute.facts = calendarHubSummaries.slice(0, 10).map((race) => {
    const parts = [
      race.name,
      race.track ? `Circuit: ${race.track}` : null,
      race.formattedDate ? `Datum: ${race.formattedDate}` : null,
      race.carClass ? `Klasse: ${race.carClass}` : null,
      race.leagueName ? `Competitie: ${race.leagueName}` : null,
    ].filter(Boolean);
    return `${parts.join(' — ')}.`;
  });
  calendarRoute.crawlerHtml = buildCalendarHubCrawlerHtml(calendarHubSummaries);
  calendarRoute.extraJsonLd = [
    { id: 'calendar-itemlist-jsonld', data: buildCalendarHubItemListJsonLd(calendarHubSummaries) },
  ];
}

const resultsRoute = routes.find((route) => route.path === '/results');
if (resultsRoute) {
  resultsRoute.crawlerLinksLabel = 'Recente race-uitslagen';
  resultsRoute.crawlerLinks = toCrawlerLinks(resultDetailRoutes, 80);
  if (resultsHubSummaries.length) {
    const latest = resultsHubSummaries[0];
    resultsRoute.details = [
      `Laatste race: ${latest.name}${latest.track ? ` op ${latest.track}` : ''}${latest.formattedDate ? ` (${latest.formattedDate})` : ''}${latest.winner ? `, gewonnen door ${latest.winner}` : ''}.`,
      `Het archief bevat ${resultsHubSummaries.length} afgeronde races met detailpagina's, winnaars, podiums en links naar de volledige uitslagen.`,
    ];
    resultsRoute.facts = resultsHubSummaries.slice(0, 10).map((race) => {
      const podium = race.podium.length ? ` Podium: ${race.podium.map((entry) => `${entry.position}. ${entry.name}`).join(', ')}.` : '';
      return `${race.name}${race.track ? ` — ${race.track}` : ''}${race.formattedDate ? ` — ${race.formattedDate}` : ''}.${race.winner ? ` Winnaar: ${race.winner}.` : ''}${podium}`;
    });
    resultsRoute.crawlerHtml = buildResultsHubCrawlerHtml(resultsHubSummaries);
    resultsRoute.extraJsonLd = [
      { id: 'results-itemlist-jsonld', data: buildResultsHubItemListJsonLd(resultsHubSummaries) },
    ];
  }
}

const newsRoute = routes.find((route) => route.path === '/news');
if (newsRoute) {
  newsRoute.crawlerLinksLabel = 'Laatste nieuwsartikelen';
  newsRoute.crawlerLinks = toCrawlerLinks(newsDetailRoutes, 80);
  if (newsHubSummaries.length) {
    newsRoute.details = [
      `De nieuwshub bevat ${newsHubSummaries.length} gepubliceerd${newsHubSummaries.length === 1 ? '' : 'e'} nieuwsartikel${newsHubSummaries.length === 1 ? '' : 'en'} met raceverslagen, updates en verhalen uit de paddock van 3 Stripe Motorsport.`,
      'Vanaf deze nieuwshub kun je doorklikken naar gepubliceerde artikelen en daarna terug naar kalender, uitslagen en standings.',
    ];
    newsRoute.crawlerHtml = buildNewsHubCrawlerHtml(newsHubSummaries);
    newsRoute.extraJsonLd = [
      { id: 'news-itemlist-jsonld', data: buildNewsHubItemListJsonLd(newsHubSummaries) },
    ];
  }
}

const homeRoute = routes.find((route) => route.path === '/');
if (homeRoute) {
  homeRoute.crawlerLinksLabel = 'Laatste 3SM updates';
  homeRoute.crawlerLinks = [
    ...toCrawlerLinks(newsDetailRoutes, 5),
    ...toCrawlerLinks(resultDetailRoutes, 8),
  ];
}

// De vier hubs die hiervoor leeg waren. Ze kregen alleen een titel, h1 en intro;
// de stand, de coureurs en de teams kwamen uitsluitend na hydratatie uit de API.
// Nu staat dezelfde data ook in de HTML-bytes, met eigen structured data.
const standingsRoute = routes.find((route) => route.path === '/standings');
if (standingsRoute) {
  const standLeagues = leaguesWithStandings();
  const primary = standLeagues[0];
  if (primary) {
    const rows = standingsByLeague.get(primary.id) || [];
    standingsRoute.intro = `Volg de actuele kampioenschapsstand van ${primary.label}: ${rows.length} coureurs met punten, posities, overwinningen en podiums binnen de 3 Stripe Motorsport iRacing league.`;
    standingsRoute.details = [
      primary.leaderName
        ? `${primary.leaderName} gaat aan de leiding met ${primary.leaderPoints} punten na ${primary.completed} verreden races in ${primary.label}.`
        : `De stand van ${primary.label} bevat ${rows.length} coureurs met punten.`,
      'De stand wordt bijgewerkt na elke gereden race en sluit direct aan op de race-uitslagen en de kalender.',
    ];
    standingsRoute.facts = rows.slice(0, 10).map((row) =>
      `${row.position}. ${row.name}${row.teamName ? ` (${row.teamName})` : ''} — ${row.points} punten, ${row.wins} overwinningen, ${row.podiums} podiums.`);
  }
  standingsRoute.crawlerHtml = buildStandingsHubCrawlerHtml();
  const standingsItemList = buildStandingsItemListJsonLd();
  if (standingsItemList) {
    standingsRoute.extraJsonLd = [{ id: 'standings-itemlist-jsonld', data: standingsItemList }];
  }
}

const driversRoute = routes.find((route) => route.path === '/drivers');
if (driversRoute && driverSummaries.length) {
  const withRaces = driverSummaries.filter((driver) => driver.races > 0);
  const teamCount = new Set(driverSummaries.map((driver) => driver.teamName).filter(Boolean)).size;
  driversRoute.intro = `Bekijk de ${driverSummaries.length} coureurs binnen 3 Stripe Motorsport, inclusief hun team, iRating en prestaties in de iRacing league.`;
  driversRoute.details = [
    `3SM telt ${driverSummaries.length} coureurs met een publiek profiel${teamCount ? `, verdeeld over ${teamCount} team${teamCount === 1 ? '' : 's'}` : ''}. ${withRaces.length} van hen hebben al races gereden in de league.`,
    'Prestaties per coureur komen terug in de standings en in de race-uitslagen, zodat je een coureur door de seizoenen heen kunt volgen.',
  ];
  driversRoute.facts = driverSummaries.slice(0, 10).map((driver) =>
    `${driver.name}${driver.teamName ? ` (${driver.teamName})` : ''} — ${driver.races} races, ${driver.wins} overwinningen, ${driver.podiums} podiums, ${driver.points} punten.`);
  driversRoute.crawlerHtml = buildDriversHubCrawlerHtml();
  const driversItemList = buildDriversItemListJsonLd();
  if (driversItemList) {
    driversRoute.extraJsonLd = [{ id: 'drivers-itemlist-jsonld', data: driversItemList }];
  }
}

const teamsRoute = routes.find((route) => route.path === '/teams');
if (teamsRoute && teamSummaries.length) {
  teamsRoute.intro = `Ontdek de ${teamSummaries.length} teams binnen 3 Stripe Motorsport en bekijk welke coureurs er samen rijden in de iRacing league.`;
  teamsRoute.details = [
    teamSummaries.map((team) => `${team.name}${team.members.length ? ` met ${team.members.length} coureur${team.members.length === 1 ? '' : 's'}` : ''}`).join(', ') + ' zijn de teams met een publiek profiel bij 3SM.',
    'Teaminformatie sluit aan op coureurs, standings en race-uitslagen zodat prestaties per team te volgen zijn.',
  ];
  teamsRoute.facts = teamSummaries.slice(0, 10).map((team) =>
    `${team.name} — ${team.members.length} coureurs, ${team.points} punten, ${team.wins} overwinningen, ${team.podiums} podiums.`);
  teamsRoute.crawlerHtml = buildTeamsHubCrawlerHtml();
  const teamsItemList = buildTeamsItemListJsonLd();
  if (teamsItemList) {
    teamsRoute.extraJsonLd = [{ id: 'teams-itemlist-jsonld', data: teamsItemList }];
  }
}

const seasonsRoute = routes.find((route) => route.path === '/seasons');
if (seasonsRoute && leagueSummaries.length) {
  seasonsRoute.intro = `Ontdek de ${leagueSummaries.length} competities van 3 Stripe Motorsport met klassen, raceplanning, standen en uitslagen.`;
  seasonsRoute.details = [
    leagueSummaries.map((league) => `${league.label} (${league.completed} van ${league.total} races verreden${league.carClass ? `, ${league.carClass}` : ''})`).join('; ') + '.',
    'Elke competitie heeft een eigen kalender, stand en archief met race-uitslagen.',
  ];
  seasonsRoute.facts = leagueSummaries.slice(0, 10).map((league) =>
    `${league.label}${league.season ? ` (${league.season})` : ''} — ${league.completed} van ${league.total} races verreden${league.leaderName ? `, aanvoerder ${league.leaderName} met ${league.leaderPoints} punten` : ''}.`);
  seasonsRoute.crawlerHtml = buildSeasonsHubCrawlerHtml();
  const seasonsItemList = buildSeasonsItemListJsonLd();
  if (seasonsItemList) {
    seasonsRoute.extraJsonLd = [{ id: 'seasons-itemlist-jsonld', data: seasonsItemList }];
  }
}

// Sitebrede hublinks in de statische HTML van elke route. Zonder dit had
// /support nul inkomende links (de footerlink staat achter een admin-conditie)
// en waren /seasons, /teams en /drivers alleen via de homepage bereikbaar.
for (const route of [...routes, ...dynamicRoutes]) {
  const ownPath = route.path.replace(/\/$/, '') || '/';
  const existing = new Set((route.links || []).map(([href]) => href.replace(/\/$/, '') || '/'));
  const extraLinks = SITE_HUB_LINKS.filter(([href]) => {
    const hubPath = href.replace(/\/$/, '') || '/';
    return hubPath !== ownPath && !existing.has(hubPath);
  });
  if (extraLinks.length) route.links = [...(route.links || []), ...extraLinks];
}

for (const route of dynamicRoutes) {
  if (route.path.startsWith('/results/')) {
    route.crawlerLinksLabel = 'Andere recente race-uitslagen';
    route.crawlerLinks = [
      ['/results', 'Alle race-uitslagen'],
      ...toCrawlerLinks(resultDetailRoutes, 10, route.path),
    ];
  }
  if (route.path.startsWith('/news/')) {
    route.crawlerLinksLabel = 'Meer 3SM nieuws';
    route.crawlerLinks = [
      ['/news', 'Alle nieuwsartikelen'],
      ...toCrawlerLinks(newsDetailRoutes, 10, route.path),
    ];
  }
}

const previousManifest = readPreviousManifest();
cleanupStaleGeneratedRoutes(previousManifest, dynamicRoutes);
const sitemapRoutes = [...routes, ...dynamicRoutes];

// Vangnet tegen een stille regressie: als de generator ooit minder routes oplevert
// dan verwacht (bijv. omdat een API faalt), mag er geen kale/verouderde sitemap of
// halve site online komen. De oude public/sitemap.xml-stub had 9 URL's.
// Nooit een sitemap publiceren die (veel) kleiner is dan wat er al live staat.
// Een ontbrekende .env liet de sitemap eerder van 57 naar 10 URL's vallen en
// ruimde de bijbehorende pagina's op. Op een dev-machine bestaat de webroot niet,
// dan slaan we deze controle over.
const liveWebroot = process.env.WEBROOT || '/var/www/3sm';
const liveSitemapPath = join(liveWebroot, 'sitemap.xml');
if (existsSync(liveSitemapPath)) {
  const liveCount = (readFileSync(liveSitemapPath, 'utf8').match(/<loc>/g) || []).length;
  if (liveCount > 0 && sitemapRoutes.length < liveCount / 2) {
    throw new Error(
      `Sitemap-generatie afgebroken: ${sitemapRoutes.length} URL's terwijl er live ${liveCount} staan `
      + '(meer dan een halvering). Meestal ontbreekt de Supabase-env. Er is niets weggeschreven.',
    );
  }
}

const MIN_SITEMAP_URLS = 25;
// De ondergrens vangt een stil half-geslaagde build af. De expliciete
// ALLOW_MISSING_SUPABASE_ENV=1 mag hem omzeilen; het halveringsvangnet tegen de
// live sitemap hierboven blijft dan gewoon actief.
if (sitemapRoutes.length < MIN_SITEMAP_URLS && process.env.ALLOW_MISSING_SUPABASE_ENV !== '1') {
  throw new Error(
    `Sitemap-generatie afgebroken: slechts ${sitemapRoutes.length} URL's (< ${MIN_SITEMAP_URLS}). `
    + 'Waarschijnlijk faalde het ophalen van dynamische routes; niets weggeschreven.',
  );
}

// Twee niet-indexeerbare varianten van de app-shell, beide zonder canonical naar
// de homepage (anders zou elke deep link als duplicaat van "/" gelden):
//   404.html               -> via error_page, met HTTP 404
//   app-shell-fallback.html -> interne fallback voor geldige app-routes die (nog)
//                              geen geprerenderd bestand hebben, met HTTP 200
const buildNonCanonicalShell = ({ title, description }) => {
  let out = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  out = replaceOrInsertMeta(
    out,
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${description}" />`,
  );
  out = replaceOrInsertMeta(
    out,
    /<meta name="robots" content="[^"]*"\s*\/>/,
    '<meta name="robots" content="noindex, follow" />',
  );
  out = out.replace(/\s*<link rel="canonical" href="[^"]*"\s*\/>/g, '');
  out = out.replace(/\s*<meta property="og:url" content="[^"]*"\s*\/>/g, '');
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');
  return stripHeroPreload(out, null);
};

writeFileSync(join(distDir, '404.html'), buildNonCanonicalShell({
  title: 'Pagina niet gevonden - 3 Stripe Motorsport',
  description: 'Deze pagina bestaat niet (meer) op 3stripemotorsport.cc. Ga terug naar de homepage of gebruik de navigatie.',
}));

// Geldige app-route zonder geprerenderde HTML (bijv. /news/author/<naam>, een
// endurance-deeplink of een net aangemaakte race-uitslag): de SPA moet blijven
// werken, maar de pagina mag niet als duplicaat van de homepage in de index komen.
writeFileSync(join(distDir, 'app-shell-fallback.html'), buildNonCanonicalShell({
  title: '3 Stripe Motorsport - Nederlandse iRacing league',
  description: '3 Stripe Motorsport is een Nederlandse iRacing league met endurance-races, sprintkampioenschappen en een actieve community.',
}));

for (const route of sitemapRoutes) {
  const html = stripHeroPreload(applyRouteMeta(template, route), route.path);
  if (route.path === '/') {
    writeFileSync(templatePath, html);
    continue;
  }

  const routeIndex = routeIndexPath(route.path);
  mkdirSync(dirname(routeIndex), { recursive: true });
  writeFileSync(routeIndex, html);
}

for (const privatePath of privateRoutes) {
  const privateIndex = routeIndexPath(privatePath);
  mkdirSync(dirname(privateIndex), { recursive: true });
  writeFileSync(privateIndex, stripHeroPreload(applyNoindexMeta(template, privatePath), privatePath));
}

writeFileSync(join(distDir, 'sitemap.xml'), generateSitemap());
writeFileSync(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  publicRoutes: sitemapRoutes.map((route) => route.path),
  staticRoutes: routes.map((route) => route.path),
  dynamicRoutes: dynamicRoutes.map((route) => route.path),
  privateRoutes,
}, null, 2)}\n`);

console.log(`Generated route-specific HTML and sitemap for ${sitemapRoutes.length} public routes (${routes.length} static, ${dynamicRoutes.length} dynamic). Added noindex HTML for ${privateRoutes.length} utility routes.`);
