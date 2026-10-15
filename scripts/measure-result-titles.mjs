// Meetrapport van de uitslagtitels: tekens én pixelbreedte.
//
//   node scripts/measure-result-titles.mjs            # rapport
//   node scripts/measure-result-titles.mjs --alle     # elke titel op een regel
//
// Bron is src/test/fixtures/result-title-inputs.json: de 44 echte uitslagroutes
// zoals ze in dist/results/*/index.html staan (racenaam, circuit, klasse, datum,
// één op één uit de SportsEvent-JSON-LD en de h1 van die bestanden). De titels komen
// uit dezelfde helper als de generator en de SPA gebruiken, dus dit meet wat er
// werkelijk op de pagina komt — niet een kopie van de logica.
//
// Het bestand wijzigt niets en raakt geen productie: het leest de fixture, bouwt de
// titels en meet de breedte in 20px (de corpsgrootte van de titellink in Google).
// Harde eisen: maximaal TITLE_MAX tekens, alle titels uniek, en in Arial-metrics
// onder PIXEL_NEVER_AS_WRITTEN (600px). Als er geen Arial-metrisch font te vinden is,
// wordt DejaVu Sans gebruikt — dat is breder, dus dan staan er twee getallen.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TITLE_BRAND_MAX,
  TITLE_MAX,
  assignUniqueRaceResultTitles,
  buildRaceResultTitle,
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
const fixturePath = fileURLToPath(new URL('../src/test/fixtures/result-title-inputs.json', import.meta.url));
const races = JSON.parse(readFileSync(fixturePath, 'utf8'));

const single = races.map((race) => buildRaceResultTitle({
  raceName: race.raceName,
  circuit: race.circuit,
  carClass: race.carClass,
  date: race.date,
}));
const assigned = assignUniqueRaceResultTitles(races);

const lengths = assigned.map((entry) => entry.title.length);
const stats = (values) => ({
  min: Math.min(...values),
  avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  max: Math.max(...values),
  over: (limit) => values.filter((value) => value > limit).length,
});

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

const metricFont = await findArialMetricFont();
const fallbackFont = findFallbackFont();
const fonts = [];
if (metricFont) fonts.push({ ...metricFont, metrics: loadFontMetrics(metricFont.path), arialMetrics: true });
else if (fallbackFont) fonts.push({ ...fallbackFont, metrics: loadFontMetrics(fallbackFont.path), arialMetrics: false });
if (fallbackFont && (!metricFont || fallbackFont.path !== metricFont.path)) {
  fonts.push({ ...fallbackFont, label: `${fallbackFont.label} (bovengrens)`, metrics: loadFontMetrics(fallbackFont.path), arialMetrics: false });
}

console.log('\nPIXELBREEDTE IN 20px');
if (!metricFont) {
  console.log('  LET OP: geen font met Arial-metrics gevonden (Liberation Sans / Arimo).');
  console.log('  De meting hieronder komt uit een breder font en valt dus te hoog uit.');
  console.log('  Zet TITLE_METRIC_FONT naar een Arial-metrisch font voor het echte getal.');
}
let pixelFailures = 0;
for (const font of fonts) {
  const widths = assigned.map((entry) => font.metrics.width(entry.title, SIZE));
  const widthStats = stats(widths);
  console.log(`  ${font.label}${font.arialMetrics ? ' — Arial-metrics, dit is het getal dat Google gebruikt' : ' — breder dan Arial'}`);
  console.log(`    min ${widthStats.min.toFixed(0)}px  gemiddeld ${widthStats.avg.toFixed(0)}px  max ${widthStats.max.toFixed(0)}px`);
  console.log(`    boven ${PIXEL_SAFE}px: ${widthStats.over(PIXEL_SAFE)}   boven ${PIXEL_DISPLAYED_MAX}px: ${widthStats.over(PIXEL_DISPLAYED_MAX)}   boven ${PIXEL_NEVER_AS_WRITTEN}px: ${widthStats.over(PIXEL_NEVER_AS_WRITTEN)}`);
  if (font.arialMetrics) {
    pixelFailures = widthStats.over(PIXEL_NEVER_AS_WRITTEN);
    const widest = assigned
      .map((entry, index) => ({ title: entry.title, width: widths[index] }))
      .sort((a, b) => b.width - a.width)
      .slice(0, 3);
    console.log('    breedste drie:');
    for (const entry of widest) console.log(`      ${entry.width.toFixed(0).padStart(4)}px  ${entry.title.length.toString().padStart(2)}  ${entry.title}`);
  }
}

if (process.argv.includes('--alle')) {
  console.log('\nALLE TITELS');
  const metrics = fonts[0]?.metrics;
  for (const entry of assigned) {
    const width = metrics ? ` ${metrics.width(entry.title, SIZE).toFixed(0).padStart(4)}px` : '';
    console.log(`  ${entry.title.length.toString().padStart(2)}${width}  ${entry.title}`);
  }
}

const failures = [];
if (lengthStats.over(TITLE_MAX) > 0) failures.push(`${lengthStats.over(TITLE_MAX)} titels boven ${TITLE_MAX} tekens`);
if (uniqueTitles.size !== races.length) failures.push(`${races.length - uniqueTitles.size} dubbele titels`);
if (diverged.length > 0) failures.push(`${diverged.length} titels wijken af tussen generator en SPA`);
if (pixelFailures > 0) failures.push(`${pixelFailures} titels breder dan ${PIXEL_NEVER_AS_WRITTEN}px in Arial-metrics`);

console.log('');
if (failures.length) {
  console.log(`AFGEKEURD: ${failures.join('; ')}.`);
  process.exit(1);
}
console.log('OK: alle titels binnen de tekengrens, uniek, en in Arial-metrics smaller dan'
  + ` de ${PIXEL_NEVER_AS_WRITTEN}px waarop Google nooit meer volledig toont.`);
