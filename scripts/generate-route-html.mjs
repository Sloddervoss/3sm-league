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
    description:
      'De officiële 3 Stripe Motorsport sim racing league. Race mee in onze competities, bekijk de kalender, standen, teams, coureurs en uitslagen.',
  },
  {
    path: '/meedoen',
    title: 'Meedoen met 3SM - iRacing Community & League',
    description:
      'Doe mee met 3 Stripe Motorsport: een iRacing community en league, begonnen in Nederland en open voor iedereen die clean, fair en met plezier wil racen.',
  },
  {
    path: '/calendar',
    title: 'Racekalender - 3 Stripe Motorsport',
    description:
      'Bekijk de 3 Stripe Motorsport racekalender met aankomende iRacing races, circuits, tijden en inschrijfmogelijkheden.',
  },
  {
    path: '/standings',
    title: 'Standings - 3 Stripe Motorsport',
    description:
      'Volg de actuele 3 Stripe Motorsport standings, kampioenschapspunten en posities van coureurs in de iRacing competitie.',
  },
  {
    path: '/results',
    title: 'Race-uitslagen - 3 Stripe Motorsport',
    description:
      'Bekijk race-uitslagen van 3 Stripe Motorsport met resultaten, rondes, klasseringen en terugblik op gereden iRacing races.',
  },
  {
    path: '/seasons',
    title: 'Seizoenen - 3 Stripe Motorsport',
    description:
      'Ontdek de seizoenen en competities van 3 Stripe Motorsport, inclusief raceplanning, klassen en kampioenschappen.',
  },
  {
    path: '/drivers',
    title: 'Coureurs - 3 Stripe Motorsport',
    description:
      'Bekijk de coureurs van 3 Stripe Motorsport, hun profielen, teams en prestaties binnen de iRacing league.',
  },
  {
    path: '/teams',
    title: 'Teams - 3 Stripe Motorsport',
    description:
      'Ontdek de teams binnen 3 Stripe Motorsport en zie hoe coureurs samen zichtbaar zijn in de iRacing community.',
  },
];

const escapeAttr = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const absoluteUrl = (path) => `${SITE_URL}${path === '/' ? '/' : path}`;

const replaceOrInsertMeta = (html, selectorRegex, replacement) => {
  if (selectorRegex.test(html)) return html.replace(selectorRegex, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
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
  return out;
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

console.log(`Generated route-specific HTML for ${routes.length} public routes.`);
