import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SITE_URL = 'https://3stripemotorsport.cc';
const distDir = new URL('../dist/', import.meta.url).pathname;
const templatePath = join(distDir, 'index.html');
const template = readFileSync(templatePath, 'utf8');

const routes = [
  {
    path: '/',
    title: '3 Stripe Motorsport - iRacing League',
    priority: '1.0',
    description:
      'De officiële 3 Stripe Motorsport sim racing league. Race mee in onze competities, bekijk de kalender, standen, teams, coureurs en uitslagen.',
    h1: '3 Stripe Motorsport iRacing League',
    intro:
      '3 Stripe Motorsport is een iRacing league en sim racing community, begonnen in Nederland en open voor coureurs die clean, fair en met plezier willen racen.',
    links: [
      ['/meedoen', 'Meedoen met 3SM'],
      ['/calendar', 'Racekalender bekijken'],
      ['/standings', 'Standings volgen'],
      ['/results', 'Race-uitslagen bekijken'],
    ],
  },
  {
    path: '/meedoen',
    title: 'Meedoen met 3SM - iRacing League & Community',
    priority: '0.8',
    description:
      'Doe mee met 3 Stripe Motorsport: een iRacing community en league, begonnen in Nederland en open voor iedereen die clean, fair en met plezier wil racen.',
    h1: 'Meedoen met 3 Stripe Motorsport',
    intro:
      'Lees hoe je aansluit bij de 3SM iRacing community, wat je nodig hebt voor je eerste race en hoe Discord, profielkoppeling en race-inschrijvingen werken.',
    links: [
      ['/calendar', 'Bekijk aankomende races'],
      ['/standings', 'Bekijk het kampioenschap'],
      ['/results', 'Bekijk eerdere uitslagen'],
    ],
  },
  {
    path: '/calendar',
    title: 'Racekalender - 3 Stripe Motorsport',
    priority: '0.9',
    description:
      'Bekijk de 3 Stripe Motorsport racekalender met aankomende iRacing races, circuits, tijden en inschrijfmogelijkheden.',
    h1: '3SM racekalender',
    intro:
      'De racekalender toont aankomende 3 Stripe Motorsport iRacing races met circuits, raceavonden, inschrijvingen en seizoensplanning.',
    links: [
      ['/meedoen', 'Meedoen met 3SM'],
      ['/results', 'Bekijk gereden races'],
      ['/standings', 'Volg de standings'],
    ],
  },
  {
    path: '/standings',
    title: 'Standings - 3 Stripe Motorsport',
    priority: '0.9',
    description:
      'Volg de actuele 3 Stripe Motorsport standings, kampioenschapspunten en posities van coureurs in de iRacing competitie.',
    h1: '3SM standings en klassement',
    intro:
      'Volg de actuele 3 Stripe Motorsport kampioenschapsstand, punten en posities van coureurs binnen de iRacing league.',
    links: [
      ['/results', 'Bekijk race-uitslagen'],
      ['/calendar', 'Bekijk de kalender'],
      ['/drivers', 'Bekijk coureurs'],
    ],
  },
  {
    path: '/results',
    title: 'Race-uitslagen - 3 Stripe Motorsport',
    priority: '0.8',
    description:
      'Bekijk race-uitslagen van 3 Stripe Motorsport met resultaten, rondes, klasseringen en terugblik op gereden iRacing races.',
    h1: '3SM race-uitslagen',
    intro:
      'Bekijk de race-uitslagen van 3 Stripe Motorsport met gereden iRacing races, rondes, circuits, winnaars, podiums en kampioenschapspunten.',
    links: [
      ['/standings', 'Bekijk de standings'],
      ['/calendar', 'Bekijk aankomende races'],
      ['/seasons', 'Bekijk seizoenen'],
      ['/drivers', 'Bekijk coureurs'],
    ],
  },
  {
    path: '/seasons',
    title: 'Seizoenen - 3 Stripe Motorsport',
    priority: '0.8',
    description:
      'Ontdek de seizoenen en competities van 3 Stripe Motorsport, inclusief raceplanning, klassen en kampioenschappen.',
    h1: '3SM seizoenen en competities',
    intro:
      'Ontdek de seizoenen van 3 Stripe Motorsport met competities, klassen, raceplanning, uitslagen en kampioenschappen.',
    links: [
      ['/calendar', 'Bekijk raceplanning'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
  {
    path: '/drivers',
    title: 'Coureurs - 3 Stripe Motorsport',
    priority: '0.7',
    description:
      'Bekijk de coureurs van 3 Stripe Motorsport, hun profielen, teams en prestaties binnen de iRacing league.',
    h1: '3SM coureurs',
    intro:
      'Bekijk de coureurs binnen 3 Stripe Motorsport, inclusief profielen, teams en prestaties in de iRacing league.',
    links: [
      ['/teams', 'Bekijk teams'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
  {
    path: '/teams',
    title: 'Teams - 3 Stripe Motorsport',
    priority: '0.7',
    description:
      'Ontdek de teams binnen 3 Stripe Motorsport en zie hoe coureurs samen zichtbaar zijn in de iRacing community.',
    h1: '3SM teams',
    intro:
      'Ontdek de teams binnen 3 Stripe Motorsport en zie hoe coureurs samen actief zijn in de iRacing community en league.',
    links: [
      ['/drivers', 'Bekijk coureurs'],
      ['/standings', 'Bekijk standings'],
      ['/results', 'Bekijk uitslagen'],
    ],
  },
];

const privateRoutes = ['/auth', '/profile', '/admin', '/stewards', '/koppel'];

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
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const absoluteUrl = (path) => `${SITE_URL}${path === '/' ? '/' : `${path}/`}`;
const buildDate = new Date().toISOString().slice(0, 10);

const replaceOrInsertMeta = (html, selectorRegex, replacement) => {
  if (selectorRegex.test(html)) return html.replace(selectorRegex, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
};

const buildBreadcrumbJsonLd = (route) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: '3 Stripe Motorsport',
      item: SITE_URL,
    },
    ...(route.path === '/'
      ? []
      : [
          {
            '@type': 'ListItem',
            position: 2,
            name: route.h1,
            item: absoluteUrl(route.path),
          },
        ]),
  ],
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

const buildNoscriptFallback = (route, faq) => {
  const links = route.links
    .map(([href, label]) => `<li><a href="${absoluteUrl(href)}">${escapeHtml(label)}</a></li>`)
    .join('');

  const breadcrumb = route.path === '/'
    ? ''
    : `<nav aria-label="Breadcrumb">
      <ol>
        <li><a href="${SITE_URL}/">3 Stripe Motorsport</a></li>
        <li aria-current="page">${escapeHtml(route.h1)}</li>
      </ol>
    </nav>\n      `;

  const faqHtml = faq
    ? `\n      <section aria-label="Veelgestelde vragen">\n        <h2>Veelgestelde vragen</h2>\n${faq
        .map(
          ({ question, answer }) =>
            `        <article>\n          <h3>${escapeHtml(question)}</h3>\n          <p>${escapeHtml(answer)}</p>\n        </article>`,
        )
        .join('\n')}\n      </section>`
    : '';

  return `<noscript>
    <main>
      ${breadcrumb}<h1>${escapeHtml(route.h1)}</h1>
      <p>${escapeHtml(route.intro)}</p>
      <nav aria-label="Belangrijke 3SM links">
        <ul>${links}</ul>
      </nav>${faqHtml}
    </main>
  </noscript>`;
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
  out = out.replace(/<script type="application\/ld\+json" id="route-webpage"[\s\S]*?<\/script>\n?\s*/g, '');
  out = out.replace(/<script type="application\/ld\+json" id="route-breadcrumb"[\s\S]*?<\/script>\n?\s*/g, '');
  out = out.replace(/<script type="application\/ld\+json" id="route-faq"[\s\S]*?<\/script>\n?\s*/g, '');
  const extraJsonLd = route.path === '/meedoen' ? `\n    ${buildJsonLdScript('route-faq', buildJoinFaqJsonLd())}` : '';
  out = out.replace(
    '</head>',
    `    ${buildJsonLdScript('route-webpage', buildWebPageJsonLd(route))}\n    ${buildJsonLdScript('route-breadcrumb', buildBreadcrumbJsonLd(route))}${extraJsonLd}\n  </head>`,
  );
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');
  out = out.replace('<div id="root"></div>', `<div id="root"></div>\n  ${buildNoscriptFallback(route, route.path === '/meedoen' ? joinFaq : null)}`);
  return out;
};

const applyNoindexMeta = (html, path) => {
  const canonical = escapeAttr(absoluteUrl(path));
  let out = replaceOrInsertMeta(html, /<meta name="robots" content="[^"]*"\s*\/>/, '<meta name="robots" content="noindex, nofollow" />');
  out = replaceOrInsertMeta(out, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`);
  out = out.replace(/<title>.*?<\/title>/s, '<title>3 Stripe Motorsport</title>');
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');
  return out;
};

const generateSitemap = () => {
  const urls = routes
    .map(
      (route) => `  <url>
    <loc>${absoluteUrl(route.path)}</loc>
    <lastmod>${buildDate}</lastmod>
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

for (const route of routes) {
  const html = applyRouteMeta(template, route);
  if (route.path === '/') {
    writeFileSync(templatePath, html);
    continue;
  }

  const routeIndex = join(distDir, route.path.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(routeIndex), { recursive: true });
  writeFileSync(routeIndex, html);
}

for (const privatePath of privateRoutes) {
  const privateIndex = join(distDir, privatePath.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(privateIndex), { recursive: true });
  writeFileSync(privateIndex, applyNoindexMeta(template, privatePath));
}

writeFileSync(join(distDir, 'sitemap.xml'), generateSitemap());

console.log(`Generated route-specific HTML and sitemap for ${routes.length} public routes. Added noindex HTML for ${privateRoutes.length} utility routes.`);
