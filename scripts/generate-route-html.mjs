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
const distDir = new URL('../dist/', import.meta.url).pathname;
const templatePath = join(distDir, 'index.html');
const manifestPath = join(distDir, '.route-html-manifest.json');
const template = readFileSync(templatePath, 'utf8');
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
    h1: 'Meedoen met de 3SM iRacing community',
    intro:
      'Zoek je een iRacing community in Nederland of een Discord waar je mee kunt racen? Bij 3SM sluit je aan bij een Nederlandse iRacing league met kalender, standings en uitslagen.',
    details: [
      'Waarom 3 Stripe Motorsport? Geen losse lobby, maar een herkenbare competitie met geplande GT3-races, duidelijke communicatie, standings, teams en ruimte om door te groeien.',
      'Zo doe je mee: join de 3SM Discord, maak je profiel compleet, koppel Discord met /koppel en schrijf je via de kalender in voor de race die je wilt rijden.',
      'Wat heb je nodig? Een actief iRacing account, een Discord account, een compleet 3SM profiel met iRacing naam en Customer ID, respect voor regels en voorbereiding op de raceavond.',
      'Wat kun je verwachten? Een toegankelijke iRacing league met kalender, briefing, training, raceavond, uitslagen en standings na afloop.',
      'Begonnen in Nederland, maar open voor iedereen met dezelfde race-mentaliteit: leuk, fair en respectvol racen.',
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
    question: 'Hoe kan ik meedoen met 3 Stripe Motorsport?',
    answer:
      'Join eerst de Discord, maak daarna een profiel aan op de site, vul je iRacing gegevens in, koppel Discord met /koppel en schrijf je via de kalender in voor een race of seizoen.',
  },
  {
    question: 'Is 3SM alleen voor Nederlandse coureurs?',
    answer:
      'Nee. 3SM is begonnen als Nederlandse community en een groot deel van de coureurs is Nederlands, maar iedereen is welkom zolang het doel hetzelfde is: leuk, fair en respectvol racen.',
  },
  {
    question: 'Moet ik al ervaren zijn om mee te doen?',
    answer:
      'Nee. Ervaring helpt, maar de belangrijkste basis is veilig, respectvol en leergierig rijden. Nieuwe coureurs zijn welkom zolang ze de regels en andere rijders serieus nemen.',
  },
  {
    question: 'Waarom moet ik mijn iRacing gegevens invullen?',
    answer:
      'Je iRacing naam en Customer ID zorgen dat inschrijvingen, geïmporteerde resultaten, standings, teams en profielen betrouwbaar aan de juiste coureur gekoppeld worden.',
  },
  {
    question: 'Waar vind ik de volgende race?',
    answer:
      'De kalender op de site is je vaste startpunt voor races, circuits, tijden en inschrijven. Discord wordt gebruikt voor reminders, aankondigingen en praktische updates.',
  },
  {
    question: 'Welke klasse rijden jullie?',
    answer:
      'Op dit moment focussen we op GT3 in iRacing. Als de community groeit, willen we later uitbreiden naar bijvoorbeeld multiclass of extra raceformats.',
  },
  {
    question: 'Kan ik nog instappen?',
    answer:
      'Ja. De grid groeit en nieuwe coureurs kunnen nog aansluiten bij races, teams en seizoenen.',
  },
  {
    question: 'Kan ik met een team meedoen?',
    answer:
      'Ja. Je kunt aansluiten bij een bestaand team of een nieuw team aanvragen. Teams krijgen een eigen Discord-sectie voor teamleden.',
  },
];

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

const driverName = (result) =>
  cleanText(result?.profiles?.iracing_name || result?.profiles?.display_name) || 'Onbekende coureur';

let resultsHubSummaries = [];
let calendarHubSummaries = [];
let newsHubSummaries = [];

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
      organizer: {
        '@type': 'SportsOrganization',
        name: '3 Stripe Motorsport',
        sport: 'Sim racing',
        url: SITE_URL,
      },
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

  return {
    id: race.id,
    path: `/results/${race.id}`,
    name: cleanText(race.name),
    track: cleanText(race.track),
    raceDate: race.race_date,
    formattedDate: formatDateNl(race.race_date) || dateOnly(race.race_date),
    round: race.round,
    leagueName: cleanText(race.leagues?.name) || null,
    carClass: cleanText(race.leagues?.car_class) || null,
    winner,
    podium,
    fastestLap: fastestLap ? driverName(fastestLap) : null,
    classifiedCount: results.length,
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
    return `          <li><a href="${absoluteUrl(race.path)}">${escapeHtml(race.name)} race-uitslag</a>${meta ? ` — ${escapeHtml(meta)}.` : ''}${escapeHtml(winner + podium)}</li>`;
  }).join('\n');

  return `<section aria-label="Crawler-zichtbare race-uitslagen">
        <h2>Laatste race-uitslag</h2>
        <p><a href="${absoluteUrl(latest.path)}">${escapeHtml(latest.name)} race-uitslag</a>${latest.track ? ` op ${escapeHtml(latest.track)}` : ''}${latest.formattedDate ? ` (${escapeHtml(latest.formattedDate)})` : ''}${latest.winner ? `, winnaar ${escapeHtml(latest.winner)}` : ''}.</p>${podiumList}
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
      about: {
        '@type': 'SportsOrganization',
        name: '3 Stripe Motorsport',
        sport: 'Sim racing',
        url: SITE_URL,
      },
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
    console.warn('Supabase env ontbreekt; dynamische sitemap-routes worden overgeslagen.');
    return [];
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
    .select('id,name,track,race_date,round,updated_at,status,leagues(name,car_class),race_results(position,laps,points,fastest_lap,user_id)')
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

    for (const race of completedRacesWithPublicProfiles) {
      const raceDate = dateOnly(race.race_date);
      const track = race.track ? ` op ${race.track}` : '';
      const carClass = race.leagues?.car_class ? `${race.leagues.car_class} ` : '';
      const raceDetails = buildRaceDetails(race);
      dynamicRoutes.push({
        path: `/results/${race.id}`,
        title: `${race.name} uitslag - 3 Stripe Motorsport`,
        priority: '0.6',
        changefreq: 'monthly',
        lastmod: dateOnly(race.updated_at || race.race_date),
        description: truncate(`Bekijk de ${carClass}iRacing race-uitslag van ${race.name}${track} op ${raceDate}: klasseringen, rondes, podium en racegegevens van 3SM.`),
        h1: `${race.name} race-uitslag`,
        intro: `Bekijk de race-uitslag van ${race.name}${track}, inclusief klasseringen, rondes en racegegevens.`,
        details: raceDetails.summary,
        facts: raceDetails.facts,
        links: [
          ['/results', 'Terug naar race-uitslagen'],
          ['/standings', 'Bekijk standings'],
          ['/calendar', 'Bekijk racekalender'],
        ],
      });
    }
  }

  const { data: publishedPosts, error: newsError } = await supabase
    .from('news_posts')
    .select('slug,category,title,excerpt,content_html,seo_title,seo_description,published_at,updated_at,status')
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
        lastmod: dateOnly(post.updated_at || post.published_at),
        description: truncate(post.seo_description || post.excerpt || post.content_html || 'Nieuws van 3 Stripe Motorsport.'),
        h1: post.title,
        intro: articleSummary,
        details: [
          `Dit nieuwsartikel hoort bij de 3SM categorie ${post.category || 'Nieuws'} en is gepubliceerd als onderdeel van de 3 Stripe Motorsport community.`,
          articleSummary,
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
  },
  about: {
    '@type': 'SportsOrganization',
    name: '3 Stripe Motorsport',
    sport: 'Sim racing',
    url: SITE_URL,
  },
});

const buildWebSiteJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: '3 Stripe Motorsport',
  alternateName: '3SM',
  url: `${SITE_URL}/`,
  inLanguage: 'nl-NL',
  publisher: {
    '@type': 'SportsOrganization',
    name: '3 Stripe Motorsport',
    sport: 'Sim racing',
    url: `${SITE_URL}/`,
  },
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
  mainEntity: joinFaq.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: answer,
    },
  })),
});

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
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-webpage"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-breadcrumb"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="site-website"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="site-navigation"[\s\S]*?<\/script>\n?\s*/g, '\n');
  out = out.replace(/\s*<script type="application\/ld\+json" id="route-faq"[\s\S]*?<\/script>\n?\s*/g, '\n');
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
  <div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)">
      ${richContent}
    </div>
  ${noscript}
  ${routeSeoEnd}`;
  // sr-only div: visible to Googlebot & screen readers, hidden from visual users
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
  for (const stalePath of previousManifest?.dynamicRoutes || []) {
    if (nextDynamicPaths.has(stalePath)) continue;
    if (!stalePath.startsWith('/news/') && !stalePath.startsWith('/results/')) continue;
    rmSync(routeDirectoryPath(stalePath), { recursive: true, force: true });
  }
};

const dynamicRoutes = await fetchDynamicRoutes();
const resultDetailRoutes = dynamicRoutes.filter((route) => route.path.startsWith('/results/'));
const newsDetailRoutes = dynamicRoutes.filter((route) => route.path.startsWith('/news/'));
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

for (const route of sitemapRoutes) {
  const html = applyRouteMeta(template, route);
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
  writeFileSync(privateIndex, applyNoindexMeta(template, privatePath));
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
