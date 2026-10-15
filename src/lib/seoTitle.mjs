// Gedeelde opbouw van titels en omschrijvingen voor crawler-facing tekst.
//
// Dit bestand is bewust platte ESM (.mjs) zonder TypeScript-syntax: de generator
// (scripts/generate-route-html.mjs, gestart door node) en de SPA (src/lib/seo.ts,
// src/pages/RaceDetailPage.tsx) importeren exact dezelfde functies. Stond deze
// logica op twee plekken, dan liepen de tabtitel en de <title> in de HTML uit
// elkaar en herschrijft Google de titel (hetzelfde geldt voor de omschrijving).
//
// Twee harde regels voor alles wat hier wordt opgebouwd:
//   1. Nooit midden in een woord knippen en nooit eindigen op een scheidingsteken.
//   2. Een beletselteken alleen als er werkelijk iets is weggelaten.

// Streeflengte uit het onderzoek: 51-55 tekens wordt het minst herschreven,
// boven de 70 bijna altijd. De band is het doel; de harde grens is waar wij
// hele delen laten vallen.
export const TITLE_TARGET_MIN = 51;
export const TITLE_TARGET_MAX = 57;
export const TITLE_HARD_MAX = 70;
export const TITLE_SEPARATOR = ' · ';
export const TITLE_BRAND_SEPARATOR = ' | ';

// De omschrijving is 150-160 tekens. De eerste ~70 tekens moeten op zichzelf een
// volledige belofte zijn, want dat is wat Google meestal laat staan.
export const DESCRIPTION_MIN = 150;
export const DESCRIPTION_MAX = 160;
export const DESCRIPTION_PROMISE_MAX = 70;

export const stripHtml = (value) => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// Weergavenaam: alleen opschonen en een beginnende kleine letter kapitaliseren.
// Geen title-casing: "gt3" of "3SM" mag niet veranderen. De echte spelfouten in
// racenamen horen in de database te worden gecorrigeerd, niet hier.
export const titleish = (value) => {
  const clean = cleanText(value);
  if (!clean) return clean;
  return /^[a-z]/.test(clean) ? `${clean[0].toUpperCase()}${clean.slice(1)}` : clean;
};

// Scheidingstekens die nooit als laatste teken mogen blijven staan.
const TRAILING_SEPARATORS = /[\s·•|,;:/\\\-–—]+$/u;

// Knippen op woordgrens. De vorige versie knipte op `max - 1` tekens en haalde
// daarna alleen een open einde weg wanneer daar een SPATIE voor stond; viel de
// knip midden in een woord, dan bleef het halve woord staan ("Circuit de…",
// "Tsukuba Circuit - 2000 -…", "Okayam…").
export const truncate = (value, max = 155) => {
  const clean = stripHtml(value);
  if (clean.length <= max) return clean;

  const budget = Math.max(1, max - 1);
  const slice = clean.slice(0, budget);
  const lastSpace = slice.search(/\s+\S*$/);

  let kept;
  if (lastSpace > 0) {
    kept = slice.slice(0, lastSpace);
  } else {
    // Geen spatie binnen de ruimte: elke knip zou midden in een woord vallen.
    // Dan laten we het eerste woord heel, ook als dat de ruimte overschrijdt —
    // een half woord is erger dan een paar tekens te veel.
    const firstSpace = clean.indexOf(' ');
    if (firstSpace === -1) return clean;
    kept = clean.slice(0, firstSpace);
  }

  kept = kept.replace(TRAILING_SEPARATORS, '');
  return kept ? `${kept}…` : clean;
};

// Vaste Nederlandse maandnamen in plaats van Intl: de tabtitel moet byte voor
// byte gelijk zijn aan de crawler-HTML, en Intl verschilt per browser en per
// ICU-versie (en levert in sommige versies "okt." met punt).
const DUTCH_MONTHS = {
  short: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  long: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
};

// De dag komt uit het ISO-voorvoegsel (YYYY-MM-DD) en niet uit new Date(), zodat
// een race niet van dag verschuilt wanneer de browser in een andere tijdzone
// staat dan de server: tabtitel en crawler-HTML moeten hetzelfde zeggen.
const isoDateOnly = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

// Datum in woorden: '7 okt 2026' (kort, voor titels) of '7 oktober 2026' (lang).
// Nooit ISO: 'op 2026-10-01' is voor een lezer en voor een taalmodel onbruikbaar.
export const formatDateNl = (value, { style = 'short' } = {}) => {
  const iso = isoDateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-');
  const months = DUTCH_MONTHS[style] || DUTCH_MONTHS.short;
  const monthName = months[Number(month) - 1];
  if (!monthName) return null;
  return `${Number(day)} ${monthName} ${year}`;
};

// Titel uit gerangschikte delen. De delen staan op volgorde van belangrijkheid
// (het meest onderscheidende deel vooraan); wat niet past valt van achteren af,
// als HEEL deel. Er wordt nooit binnen een deel geknipt, dus het circuit — het
// deel dat twee races op hetzelfde circuit onderscheidt — blijft altijd staan.
//
// De twee drempels:
//   - TITLE_HARD_MAX: hierboven laten we hele delen vallen (gemeten grens waar
//     Google vrijwel altijd herschrijft). De datum valt dan als eerste af, want
//     die is minder onderscheidend dan het circuit en de klasse.
//   - TITLE_TARGET_MAX: de streefband. Past de titel binnen de band, dan mag het
//     merk erachter; anders sneuvelt het merk als eerste (Google bepaalt de
//     sitenaam tegenwoordig zelf).
export const buildRankedTitle = (parts, {
  brand = null,
  max = TITLE_HARD_MAX,
  targetMax = TITLE_TARGET_MAX,
  separator = TITLE_SEPARATOR,
} = {}) => {
  const ranked = (parts || []).map((part) => cleanText(part)).filter(Boolean);
  if (!ranked.length) return '';

  const join = (list) => list.join(separator);
  let kept = ranked;
  while (kept.length > 2 && join(kept).length > max) kept = kept.slice(0, -1);

  const title = join(kept);
  const brandText = cleanText(brand);
  if (brandText && `${title}${TITLE_BRAND_SEPARATOR}${brandText}`.length <= targetMax) {
    return `${title}${TITLE_BRAND_SEPARATOR}${brandText}`;
  }
  return title;
};

// Rangorde voor een uitslagtitel: race-identificatie, circuit, klasse, datum.
// Het circuit blijft dus staan wanneer de datum of de klasse moet wijken.
export const buildRaceResultTitle = ({ raceName, circuit, carClass, date, brand = '3SM' }) => {
  const name = titleish(raceName);
  const dateLabel = formatDateNl(date, { style: 'short' });
  return buildRankedTitle([
    name ? `Uitslag ${name}` : 'Race-uitslag',
    cleanText(circuit),
    cleanText(carClass),
    dateLabel,
  ], { brand });
};

// Omschrijving van een uitslagpagina. De eerste zin is een belofte die op
// zichzelf staat (de eerste ~70 tekens blijven meestal staan), daarna volgen
// hele zinnen. Elke zin heeft een volledige en een beknopte variant; de bouwer
// kiest de combinatie waarmee het geheel binnen 150-160 tekens valt. Elke
// variant is een bewering die de pagina ook waarmaakt (de uitslagtabel bevat
// positie, rondes, punten en de snelste ronde, en de pagina toont het podium),
// dus er wordt gevuld met informatie en niet met opvultekst. Wat niet in hele
// zinnen past, blijft weg: nooit midden in een woord knippen, nooit op een
// streepje eindigen.
export const buildRaceResultDescription = ({ raceName, circuit, carClass, leagueName, date }) => {
  const name = titleish(raceName);
  const classe = cleanText(carClass);
  const league = cleanText(leagueName);
  const dateLabel = formatDateNl(date, { style: 'short' });

  const promise = `Bekijk de race-uitslag van ${name || 'deze race'}${circuit ? ` op ${cleanText(circuit)}` : ''}.`;

  // Per zin: van volledig naar beknopt. De eerste variant die past is de beste.
  const sentenceVariants = [
    classe
      ? [
        `Alle klasseringen, rondes en punten van de ${classe}-klasse van 3SM.`,
        `Alle klasseringen, rondes en punten van de ${classe}-klasse.`,
      ]
      : [],
    ['Alle klasseringen, rondes en punten.'],
    dateLabel ? [`Verreden op ${dateLabel}.`, `Op ${dateLabel}.`] : [],
    league ? [`Onderdeel van ${league}.`, `In ${league}.`] : [],
    ['Inclusief het volledige podium en de snelste ronden.', 'Met het volledige podium.'],
    ['Met de volledige iRacing-uitslag van 3 Stripe Motorsport.', 'iRacing-uitslag van 3 Stripe Motorsport.'],
  ].filter((variants) => variants.length);

  // Alle combinaties langsgaan en de varianten kiezen die het dichtst bij de
  // streefband uitkomen. Dit is een handvol zinnen, dus dat is een kleine
  // vermenigvuldiging — geen aanname dat het toevallig goed valt.
  let best = '';
  let bestScore = -Infinity;
  const walk = (index, parts, length) => {
    if (index === sentenceVariants.length) {
      const text = parts.join(' ');
      const inBand = length >= DESCRIPTION_MIN && length <= DESCRIPTION_MAX;
      // Binnen de band wint de variant die het dichtst bij het midden zit; anders
      // wint de langste die nog past (dan is de ruimte zo goed mogelijk benut).
      const score = inBand ? 1000 - Math.abs(length - 155) : length;
      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
      return;
    }
    // Zin overslaan mag altijd (soms past de langere variant niet meer).
    walk(index + 1, parts, length);
    for (const variant of sentenceVariants[index]) {
      const next = length + 1 + variant.length;
      if (next > DESCRIPTION_MAX) break;
      walk(index + 1, [...parts, variant], next);
    }
  };
  walk(0, [promise], promise.length);

  // Alleen als de belofte zelf al te lang is (een uitzonderlijk lang circuit)
  // knippen we — op woordgrens, dus nooit midden in een woord.
  return best.length > DESCRIPTION_MAX ? truncate(best, DESCRIPTION_MAX) : best;
};
