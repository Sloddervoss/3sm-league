import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SITE_URL = 'https://3stripemotorsport.cc';
const distDir = new URL('../dist/', import.meta.url).pathname;
const templatePath = join(distDir, 'index.html');
const manifestPath = join(distDir, '.route-html-manifest.json');
const template = readFileSync(templatePath, 'utf8');

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
    links: [
      ['/meedoen', 'Meedoen met onze iRacing community'],
      ['/calendar', 'Racekalender bekijken'],
      ['/standings', 'Standings volgen'],
      ['/results', 'Race-uitslagen bekijken'],
    ],
  },
  {
    path: '/meedoen',
    title: 'Meedoen met 3SM - iRacing Nederland & Discord Community',
    priority: '0.8',
    changefreq: 'monthly',
    description:
      'Zoek je een iRacing community in Nederland? Doe mee met 3 Stripe Motorsport: een Nederlandse iRacing league met Discord, kalender, standings en uitslagen.',
    h1: 'Meedoen met de 3SM iRacing community',
    intro:
      'Zoek je een iRacing community in Nederland of een Discord waar je mee kunt racen? Bij 3SM sluit je aan bij een Nederlandse iRacing league met kalender, standings en uitslagen.',
    links: [
      ['/calendar', 'Bekijk aankomende races'],
      ['/standings', 'Bekijk het kampioenschap'],
      ['/results', 'Bekijk eerdere uitslagen'],
    ],
  },
  {
    path: '/calendar',
    title: 'iRacing racekalender - 3 Stripe Motorsport',
    priority: '0.9',
    changefreq: 'weekly',
    description:
      'Bekijk de 3SM iRacing racekalender met aankomende races, circuits, tijden en inschrijven voor 3 Stripe Motorsport.',
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
    changefreq: 'weekly',
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
    title: 'iRacing race-uitslagen - 3 Stripe Motorsport',
    priority: '0.8',
    changefreq: 'weekly',
    description:
      'Bekijk 3SM race-uitslagen, podiums, klasseringen en terugblik op gereden iRacing races van 3 Stripe Motorsport.',
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
    path: '/news',
    title: 'Nieuws - 3 Stripe Motorsport',
    priority: '0.8',
    changefreq: 'weekly',
    description:
      'Lees het laatste nieuws van 3 Stripe Motorsport: verhalen uit de paddock, raceverslagen en updates van de iRacing league.',
    h1: '3SM nieuws',
    intro:
      'Lees verhalen uit de paddock, raceverslagen en updates van 3 Stripe Motorsport.',
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
    changefreq: 'monthly',
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
    changefreq: 'monthly',
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

const privateRoutes = ['/auth', '/profile', '/admin', '/news-editor', '/stewards', '/koppel'];

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

  const { data: completedRaces, error: raceError } = await supabase
    .from('races')
    .select('id,name,track,race_date,updated_at,status,leagues(name,car_class)')
    .eq('status', 'completed')
    .order('race_date', { ascending: false })
    .limit(250);

  if (raceError) {
    console.warn(`Kon race-detail routes niet ophalen voor sitemap: ${raceError.message}`);
  } else {
    for (const race of completedRaces || []) {
      const raceDate = dateOnly(race.race_date);
      const track = race.track ? ` op ${race.track}` : '';
      const carClass = race.leagues?.car_class ? `${race.leagues.car_class} ` : '';
      dynamicRoutes.push({
        path: `/results/${race.id}`,
        title: `${race.name} uitslag - 3 Stripe Motorsport`,
        priority: '0.6',
        changefreq: 'monthly',
        lastmod: dateOnly(race.updated_at || race.race_date),
        description: truncate(`Bekijk de ${carClass}iRacing race-uitslag van ${race.name}${track} op ${raceDate}: klasseringen, rondes, podium en racegegevens van 3SM.`),
        h1: `${race.name} race-uitslag`,
        intro: `Bekijk de race-uitslag van ${race.name}${track}, inclusief klasseringen, rondes en racegegevens.`,
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
    for (const post of publishedPosts || []) {
      const categorySlug = categoryToSlug(post.category);
      dynamicRoutes.push({
        path: `/news/${categorySlug}/${post.slug}`,
        title: post.seo_title || `${post.title} - 3 Stripe Motorsport`,
        priority: '0.6',
        changefreq: 'monthly',
        lastmod: dateOnly(post.updated_at || post.published_at),
        description: truncate(post.seo_description || post.excerpt || post.content_html || 'Nieuws van 3 Stripe Motorsport.'),
        h1: post.title,
        intro: truncate(post.excerpt || post.content_html || 'Nieuws van 3 Stripe Motorsport.', 220),
        links: [
          ['/news', 'Terug naar nieuws'],
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
  out = out.replace(/<script type="application\/ld\+json" id="route-webpage"[\s\S]*?<\/script>\n?\s*/g, '');
  out = out.replace(/<script type="application\/ld\+json" id="route-breadcrumb"[\s\S]*?<\/script>\n?\s*/g, '');
  out = out.replace(/<script type="application\/ld\+json" id="route-faq"[\s\S]*?<\/script>\n?\s*/g, '');
  const extraJsonLd = ''; // FAQPage removed — sr-only workaround not accepted by Google
  out = out.replace(
    '</head>',
    `    ${buildJsonLdScript('route-webpage', buildWebPageJsonLd(route))}\n    ${buildJsonLdScript('route-breadcrumb', buildBreadcrumbJsonLd(route))}${extraJsonLd}\n  </head>`,
  );
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>\s*/g, '');
  const noscript = `<noscript>
    <main>
      <h1>${escapeHtml(route.h1)}</h1>
      <p>${escapeHtml(route.intro)}</p>
      <nav aria-label="Belangrijke 3SM links">
        <ul>${route.links.map(([href, label]) => `<li><a href="${absoluteUrl(href)}">${escapeHtml(label)}</a></li>`).join('')}</ul>
      </nav>
    </main>
  </noscript>`;
  const richContent = buildRichContent(route, null); // FAQ removed — no JSON-LD to back it
  // sr-only div: visible to Googlebot & screen readers, hidden from visual users
  out = out.replace(
    '<div id="root"></div>',
    `<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)">\n      ${richContent}\n    </div>\n  <div id="root"></div>\n  ${noscript}`,
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
