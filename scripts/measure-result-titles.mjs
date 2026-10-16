// Meetrapport van de titels die generator en SPA bouwen: tekens én pixelbreedte.
//
//   node scripts/measure-result-titles.mjs            # rapport
//   node scripts/measure-result-titles.mjs --alle     # elke titel op een regel
//
// Bron zijn twee fixtures met ECHTE invoer, één op één overgenomen uit de
// gegenereerde crawler-HTML:
//   src/test/fixtures/result-title-inputs.json — de 44 uitslagroutes uit
//     dist/results/*/index.html (racenaam, circuit, klasse, datum).
//   src/test/fixtures/news-title-inputs.json — de nieuwsartikelen uit
//     dist/news/<rubriek>/<slug>/index.html (kop, rubriek, publicatiedatum). De
//     nieuwshub en de rubriekhubs worden daaruit afgeleid.
// De titels komen uit dezelfde helper als de generator en de SPA
// (src/lib/seoTitle.mjs), dus dit meet wat er werkelijk op de pagina komt — niet
// een kopie van de logica.
//
// Het bestand wijzigt niets en raakt geen productie: het leest de fixtures, bouwt de
// titels en meet de breedte in 20px (de corpsgrootte van de titellink in Google).
// Harde eisen: maximaal TITLE_MAX tekens, alle titels uniek, en in Arial-metrics
// onder PIXEL_NEVER_AS_WRITTEN (600px). Als er geen Arial-metrisch font te vinden is,
// wordt DejaVu Sans gebruikt — dat is breder, dus dan staan er twee getallen.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TITLE_BRAND_MAX,
  TITLE_MAX,
  assignUniqueNewsArticleTitles,
  assignUniqueRaceResultTitles,
  buildNewsArticleTitle,
  buildNewsCategoryTitle,
  buildNewsHubTitle,
  buildRaceResultTitle,
  shortenHeadline,
} from '../src/lib/seoTitle.mjs';
import {
  PIXEL_DISPLAYED_MAX,
  PIXEL_NEVER_AS_WRITTEN,
  PIXEL_SAFE,
  findArialMetricFont,
  findFallbackFont,
  loadFontMetrics,
} from './font-metrics.mjs';

const SIZE = 20;
const resultFixturePath = fileURLToPath(new URL('../src/test/fixtures/result-title-inputs.json', import.meta.url));
const newsFixturePath = fileURLToPath(new URL('../src/test/fixtures/news-title-inputs.json', import.meta.url));
const races = JSON.parse(readFileSync(resultFixturePath, 'utf8'));
const newsArticles = JSON.parse(readFileSync(newsFixturePath, 'utf8'));

const stats = (values) => ({
  min: Math.min(...values),
  avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  max: Math.max(...values),
  over: (limit) => values.filter((value) => value > limit).length,
});

// ---------- Uitslagpagina's ----------
const single = races.map((race) => buildRaceResultTitle({
  raceName: race.raceName,
  circuit: race.circuit,
  carClass: race.carClass,
  date: race.date,
}));
const assigned = assignUniqueRaceResultTitles(races);

const lengths = assigned.map((entry) => entry.title.length);
const lengthStats = stats(lengths);
const uniqueTitles = new Set(assigned.map((entry) => entry.title));
const demoted = assigned.filter((entry) => entry.demoted);
const diverged = assigned.filter((entry, index) => entry.title !== single[index]);

console.log(`Uitslagtitels — ${races.length} echte uitslagroutes uit dist/results/*/index.html`);
console.log(`Grenzen: TITLE_MAX ${TITLE_MAX} tekens, merk alleen tot ${TITLE_BRAND_MAX} tekens\n`);

console.log('TEKENS');
console.log(`  min ${lengthStats.min}  gemiddeld ${lengthStats.avg.toFixed(1)}  max ${lengthStats.max}`);
console.log(`  boven ${TITLE_MAX}: ${lengthStats.over(TITLE_MAX)}`);
console.log(`  unieke titels: ${uniqueTitles.size}/${races.length}`);
console.log(`  met merk '| 3SM': ${assigned.filter((entry) => entry.title.includes('| 3SM')).length}`);
console.log(`  titels waarin een deel moest wijken voor de uniciteit: ${demoted.length}`);
for (const entry of demoted) {
  console.log(`    - "${entry.richest}" was al bezet; nu "${entry.title}"`);
}
console.log(`  generator en SPA-pad bouwen dezelfde titel voor alle ${races.length} races: ${diverged.length === 0 ? 'ja' : 'NEE'}`);
for (const entry of diverged) {
  console.log(`    - ${entry.raceName}: ${entry.title} ≠ ${single[assigned.indexOf(entry)]}`);
}

// ---------- Nieuws ----------
const newsAssigned = assignUniqueNewsArticleTitles(newsArticles);
const newsCategories = [...new Set(newsArticles.map((article) => article.category).filter(Boolean))];
const newsEntries = [
  ...newsAssigned.map((entry) => ({
    kind: 'artikel',
    title: entry.title,
    h1: entry.h1,
    demoted: entry.demoted,
    richest: entry.richest,
  })),
  ...newsCategories.map((category) => ({
    kind: 'rubriekhub',
    title: buildNewsCategoryTitle({ category }),
    h1: category,
    demoted: false,
    richest: buildNewsCategoryTitle({ category }),
  })),
  {
    kind: 'nieuwshub',
    title: buildNewsHubTitle(),
    h1: '3SM nieuws',
    demoted: false,
    richest: buildNewsHubTitle(),
  },
];
const newsLengthStats = stats(newsEntries.map((entry) => entry.title.length));
const newsUnique = new Set(newsEntries.map((entry) => entry.title));
const newsDemoted = newsEntries.filter((entry) => entry.demoted);
const newsH1Prefix = newsEntries.filter((entry) => !entry.title.startsWith(entry.h1));
const newsSingle = newsAssigned.map((entry) => buildNewsArticleTitle({
  headline: entry.headline,
  category: entry.category,
  date: entry.date,
}));
const newsDiverged = newsAssigned.filter((entry, index) => entry.title !== newsSingle[index]);
// De kopregel mag nooit midden in een woord afgebroken zijn: hij moet een heel
// woord-voor-woord-voorvoegsel van de echte kop blijven, bij elke grens.
const newsH1Broken = [];
for (const article of newsArticles) {
  for (let max = 12; max <= 200; max += 1) {
    const output = shortenHeadline(article.headline, max);
    if (output && !article.headline.startsWith(output)) newsH1Broken.push(`${article.slug} @ ${max}: ${output}`);
  }
}

console.log(`\nNieuwstitels — ${newsArticles.length} echte artikelen uit dist/news/<rubriek>/<slug>/index.html + ${newsEntries.length - newsAssigned.length} hubs`);

console.log('TEKENS');
console.log(`  min ${newsLengthStats.min}  gemiddeld ${newsLengthStats.avg.toFixed(1)}  max ${newsLengthStats.max}`);
console.log(`  boven ${TITLE_MAX}: ${newsLengthStats.over(TITLE_MAX)}`);
console.log(`  unieke titels: ${newsUnique.size}/${newsEntries.length}`);
console.log(`  kopregels (h1) met beletselteken, midden in een woord of op een scheidingsteken: ${newsH1Broken.length}`);
for (const entry of newsH1Broken) console.log(`    - ${entry}`);
console.log(`  h1 is een voorvoegsel van de titel: ${newsH1Prefix.length === 0 ? 'ja' : 'NEE'}`);
for (const entry of newsH1Prefix) console.log(`    - ${entry.kind}: "${entry.h1}" past niet op "${entry.title}"`);
console.log(`  titels waarin een deel moest wijken voor de uniciteit: ${newsDemoted.length}`);
for (const entry of newsDemoted) {
  console.log(`    - "${entry.richest}" was al bezet; nu "${entry.title}"`);
}
console.log(`  generator en SPA-pad bouwen dezelfde titel voor alle ${newsAssigned.length} artikelen: ${newsDiverged.length === 0 ? 'ja' : 'NEE'}`);
for (const entry of newsDiverged) {
  console.log(`    - ${entry.slug}: ${entry.title} ≠ ${newsSingle[newsAssigned.indexOf(entry)]}`);
}

// ---------- Pixelbreedte ----------
const metricFont = await findArialMetricFont();
const fallbackFont = findFallbackFont();
const fonts = [];
if (metricFont) fonts.push({ ...metricFont, metrics: loadFontMetrics(metricFont.path), arialMetrics: true });
else if (fallbackFont) fonts.push({ ...fallbackFont, metrics: loadFontMetrics(fallbackFont.path), arialMetrics: false });
if (fallbackFont && (!metricFont || fallbackFont.path !== metricFont.path)) {
  fonts.push({ ...fallbackFont, label: `${fallbackFont.label} (bovengrens)`, metrics: loadFontMetrics(fallbackFont.path), arialMetrics: false });
}

const measurePixels = (entries, { title, note }) => {
  console.log(title);
  if (!metricFont) {
    console.log('  LET OP: geen font met Arial-metrics gevonden (Liberation Sans / Arimo).');
    console.log('  De meting hieronder komt uit een breder font en valt dus te hoog uit.');
    console.log('  Zet TITLE_METRIC_FONT naar een Arial-metrisch font voor het echte getal.');
  }
  let failures = 0;
  for (const font of fonts) {
    const widths = entries.map((entry) => font.metrics.width(entry.title, SIZE));
    const widthStats = stats(widths);
    console.log(`  ${font.label}${font.arialMetrics ? ' — Arial-metrics, dit is het getal dat Google gebruikt' : ' — breder dan Arial'}`);
    console.log(`    min ${widthStats.min.toFixed(0)}px  gemiddeld ${widthStats.avg.toFixed(0)}px  max ${widthStats.max.toFixed(0)}px`);
    console.log(`    boven ${PIXEL_SAFE}px: ${widthStats.over(PIXEL_SAFE)}   boven ${PIXEL_DISPLAYED_MAX}px: ${widthStats.over(PIXEL_DISPLAYED_MAX)}   boven ${PIXEL_NEVER_AS_WRITTEN}px: ${widthStats.over(PIXEL_NEVER_AS_WRITTEN)}`);
    if (font.arialMetrics) {
      failures = widthStats.over(PIXEL_NEVER_AS_WRITTEN);
      const widest = entries
        .map((entry, index) => ({ ...entry, width: widths[index] }))
        .sort((a, b) => b.width - a.width)
        .slice(0, 3);
      console.log('    breedste drie:');
      for (const entry of widest) console.log(`      ${entry.width.toFixed(0).padStart(4)}px  ${entry.title.length.toString().padStart(2)}  ${entry.title}`);
    }
  }
  console.log(`  (${note})`);
  return failures;
};

const racePixelFailures = measurePixels(assigned, {
  title: '\nPIXELBREEDTE IN 20px — uitslagen',
  note: `max TITLE_MAX ${TITLE_MAX} tekens; titels van 60 tekens of minder bleven in het onderzoek van okt 2026 allemaal onder de 600px`,
});
const newsPixelFailures = measurePixels(newsEntries, {
  title: '\nPIXELBREEDTE IN 20px — nieuws',
  note: `max TITLE_MAX ${TITLE_MAX} tekens; de kopregel is het eerste deel van de titel`,
});

if (process.argv.includes('--alle')) {
  console.log('\nALLE TITELS');
  const metrics = fonts[0]?.metrics;
  for (const [label, entries] of [['Uitslagen', assigned], ['Nieuws', newsEntries]]) {
    console.log(`  ${label}:`);
    for (const entry of entries) {
      const width = metrics ? ` ${metrics.width(entry.title, SIZE).toFixed(0).padStart(4)}px` : '';
      console.log(`    ${entry.title.length.toString().padStart(2)}${width}  ${entry.title}`);
    }
  }
}

const failures = [];
if (lengthStats.over(TITLE_MAX) > 0) failures.push(`${lengthStats.over(TITLE_MAX)} uitslagtitels boven ${TITLE_MAX} tekens`);
if (uniqueTitles.size !== races.length) failures.push(`${races.length - uniqueTitles.size} dubbele uitslagtitels`);
if (diverged.length > 0) failures.push(`${diverged.length} uitslagtitels wijken af tussen generator en SPA`);
if (racePixelFailures > 0) failures.push(`${racePixelFailures} uitslagtitels breder dan ${PIXEL_NEVER_AS_WRITTEN}px in Arial-metrics`);
if (newsLengthStats.over(TITLE_MAX) > 0) failures.push(`${newsLengthStats.over(TITLE_MAX)} nieuwstitels boven ${TITLE_MAX} tekens`);
if (newsUnique.size !== newsEntries.length) failures.push(`${newsEntries.length - newsUnique.size} dubbele nieuwstitels`);
if (newsH1Broken.length > 0) failures.push(`${newsH1Broken.length} nieuwsKOPREGELS midden in een woord of op een scheidingsteken afgebroken`);
if (newsH1Prefix.length > 0) failures.push(`${newsH1Prefix.length} nieuwstitels beginnen niet met de h1`);
if (newsDiverged.length > 0) failures.push(`${newsDiverged.length} nieuwstitels wijken af tussen generator en SPA`);
if (newsPixelFailures > 0) failures.push(`${newsPixelFailures} nieuwstitels breder dan ${PIXEL_NEVER_AS_WRITTEN}px in Arial-metrics`);

console.log('');
if (failures.length) {
  console.log(`AFGEKEURD: ${failures.join('; ')}.`);
  process.exit(1);
}
console.log('OK: alle titels binnen de tekengrens, uniek, en in Arial-metrics smaller dan'
  + ` de ${PIXEL_NEVER_AS_WRITTEN}px waarop Google nooit meer volledig toont.`);
