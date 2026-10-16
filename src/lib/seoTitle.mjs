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
//
// De uitslagtitel begint met de RACENAAM en niet met het woord 'Uitslag'. Drie
// redenen: dat woord staat op alle 44 uitslagpagina's (herhaalde boilerplate is
// precies een van de redenen waarom Google een titel vervangt), het kost 8 van de
// 60 tekens, en met dat woord erbij zou het circuit bij de langste racenamen
// ('Saturday fun day race 1' op Spa) sneuvelen — terwijl het circuit juist is wat
// twee uitslagpagina's onderscheidt. De h1 van de pagina is de racenaam, dus de
// h1 is een voorvoegsel van de titel: gebruikt Google de h1 als titel, dan belooft
// hij nog steeds hetzelfde.

// Harde tekensgrens voor de titel. Google kapt op PIXELBREEDTE af, niet op tekens.
// In het onderzoek van oktober 2026 (504 echte Google-titellinks) was geen enkele
// titel van 60 tekens of minder breder dan 600px, en niets boven 577px werd ooit
// volledig getoond. In 20px Arial-metrics — de corpsgrootte van de titellink in de
// SERP — blijft 60 tekens daaronder. De oude streefband (51-57) keek alleen naar
// tekens en liet titels van 80 tekens en 720px door.
// scripts/measure-result-titles.mjs meet de werkelijke breedte na.
export const TITLE_MAX = 60;
// Bovengrens voor de titel MET het merk erachter. Het merk is versiering, geen
// inhoud: mag het alleen mee als de titel daarmee in de band blijft waar Google
// vrijwel nooit herschrijft. Zo blijft in 20px Arial-metrics elke titel onder
// 577px — de breedte waarvan het onderzoek laat zien dat niets daar boven ooit
// volledig werd getoond (gemeten: max 593px met een grens van 60, max 559px met
// deze grens).
export const TITLE_BRAND_MAX = 57;
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
// daarna alleen een open einde weg als daar een SPATIE voor stond. Op de 43
// gegenereerde uitslagroutes bracht dat de circuitnaam terug tot een nietszeggend
// stuk ('Circuit de…', 'Daytona International…', 'Tsukuba Circuit - 2000 -…') en
// bleef er een los streepje staan als de knip op een scheidingsteken viel. Deze
// versie knipt op de laatste hele woordgrens en laat een scheidingsteken nooit als
// laatste teken staan.
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

// Circuitnaam splitsen in een basis en een variant: 'Daytona International
// Speedway - Road Course' wordt basis 'Daytona International Speedway' en variant
// 'Road Course'. Alleen een omstreken streepje telt (' - ', ' – ', ' — '); het
// streepje in 'Spa-Francorchamps' hoort bij de naam en splitst niets.
const CIRCUIT_VARIANT_SEPARATOR = /\s+[-–—]\s+/;

export const splitCircuit = (value) => {
  const clean = cleanText(value);
  const match = clean.match(CIRCUIT_VARIANT_SEPARATOR);
  if (!match) return { base: clean, variant: '' };
  return {
    base: clean.slice(0, match.index),
    variant: clean.slice(match.index + match[0].length),
  };
};

// De delen van een uitslagtitel, in volgorde van belangrijkheid:
//   1. de racenaam (deze staat er altijd in)
//   2. het circuit: eerst de hele naam (basis + variant), anders alleen de basis
//   3. de datum in woorden
//   4. de klasse
// Daarachter hangt het merk (zie withTitleBrand) — als het nog past.
//
// De functie geeft ALLE titelvormen terug die binnen de tekensgrens passen, van
// rijk naar arm. De rijke vormen staan vooraan; de kale racenaam staat er altijd
// bij. De bitwaarde van een vorm IS de rangorde (het hoogste bit is het
// belangrijkste deel), dus van hoog naar laag proberen betekent letterlijk: wat het
// belangrijkst is, blijft het langst staan. Er wordt nooit binnen een deel geknipt,
// dus het circuit blijft heel of valt in zijn geheel weg.
export const raceResultTitleCandidates = ({ raceName, circuit, carClass, date }, { max = TITLE_MAX } = {}) => {
  const name = titleish(raceName) || 'Race-uitslag';
  const circuitText = cleanText(circuit);
  const { base } = splitCircuit(circuitText);
  const dateLabel = formatDateNl(date, { style: 'short' }) || '';
  const classe = cleanText(carClass);

  const FORM_BITS = { circuitFull: 8, circuitBase: 4, date: 2, carClass: 1 };
  const candidates = [];
  for (let mask = 15; mask >= 0; mask -= 1) {
    const hasFull = (mask & FORM_BITS.circuitFull) !== 0;
    const hasBase = (mask & FORM_BITS.circuitBase) !== 0;
    // Precies één circuitvorm (of geen): de hele naam en de basis sluiten elkaar uit.
    if (hasFull && hasBase) continue;

    const parts = [name];
    if (hasFull && circuitText) parts.push(circuitText);
    else if (hasBase && base) parts.push(base);
    if ((mask & FORM_BITS.date) && dateLabel) parts.push(dateLabel);
    if ((mask & FORM_BITS.carClass) && classe) parts.push(classe);

    const title = parts.join(TITLE_SEPARATOR);
    if (!candidates.includes(title)) candidates.push(title);
  }

  // De kale racenaam is het vangnet: die past altijd (of is zelf al te lang, en
  // dan blijft hij heel in plaats van afgekapt).
  const fitting = candidates.filter((title) => title.length <= max);
  return fitting.length ? fitting : [name];
};

// Het merk is geen onderscheider: '| 3SM' staat op elke uitslagpagina en zegt niets
// over deze race. Het hangt daarom achter de gekozen titel zolang de titel MET merk
// binnen TITLE_BRAND_MAX blijft, en vervalt anders. Google toont de sitenaam
// tegenwoordig zelf boven de URL, dus dat kost niets; in de browsertab blijft hij
// staan zolang er ruimte is.
//
// `max` is de harde grens waarbinnen de TITEL moet passen; het merk mag daar nooit
// doorheen duwen, dus het merkbudget is het minimum van die grens en TITLE_BRAND_MAX.
// De inhoud zelf is op dat moment allang gekozen en blijft staan.
export const withTitleBrand = (title, brand = '3SM', max = TITLE_MAX) => {
  const clean = cleanText(title);
  const brandText = cleanText(brand);
  if (!brandText) return clean;
  const decorated = `${clean}${TITLE_BRAND_SEPARATOR}${brandText}`;
  return decorated.length <= Math.min(max, TITLE_BRAND_MAX) ? decorated : clean;
};

// Eén uitslagtitel: de rijkste vorm die binnen TITLE_MAX past, met het merk erachter
// als dat nog past. Dit is wat de generator én de SPA voor één race gebruiken; de
// twee moeten letterlijk hetzelfde zeggen, anders herschrijft Google de titel.
export const buildRaceResultTitle = ({ raceName, circuit, carClass, date, brand = '3SM' }, { max = TITLE_MAX } = {}) => {
  const [richest] = raceResultTitleCandidates({ raceName, circuit, carClass, date }, { max });
  return withTitleBrand(richest, brand, max);
};

// Titels voor een hele SET races, met de garantie dat ze onderling uniek zijn.
//
// Twee races met dezelfde naam op hetzelfde circuit (twee keer 'Race 3' op Daytona)
// zouden dezelfde titel krijgen. In dat geval schuift de tweede door naar de
// eerstvolgende vorm die nog vrij is — de circuitvariant of anders de datum, precies
// het deel dat de twee races onderscheidt. Het merk doet aan die keuze niet mee: dat
// zou de botsing alleen maar verbergen achter boilerplate.
//
// `demoted` vertelt welke race niet zijn rijkste titel kreeg, zodat de generator dat
// kan melden in plaats van het stil te laten gebeuren.
export const assignUniqueRaceResultTitles = (races, { max = TITLE_MAX, brand = '3SM' } = {}) => {
  const used = new Set();
  return (races || []).map((race) => {
    const candidates = raceResultTitleCandidates(race, { max });
    const distinguishing = candidates.find((candidate) => !used.has(candidate)) || candidates[0];
    used.add(distinguishing);
    return {
      ...race,
      distinguishing,
      richest: candidates[0],
      title: withTitleBrand(distinguishing, brand, max),
      demoted: distinguishing !== candidates[0],
    };
  });
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

// ---------- Nieuws ----------
// Dezelfde behandeling als de uitslagpagina's, nu voor de nieuwsroutes (/news, de
// rubriekhubs /news/<rubriek> en de artikelen /news/<rubriek>/<slug>): harde
// tekengrens, gerangschikte delen, nooit midden in een woord, nooit een
// scheidingsteken achteraan en alle titels onderling uniek.
//
// Het verschil met een race is het ONDERWERP zelf. Een racenaam is kort ('Race 3');
// een nieuwsKOP kan 90 tekens zijn ('Jaimy Peters pakt de overwinning na
// spectaculaire raceavond bij 3 Stripe Motorsport'). De kop wordt daarom heel
// woord voor heel woord ingekort tot hij past. Die korte kop is de h1 van de
// pagina en de titel begint ermee, zodat een SERP-titel die Google uit de h1 haalt
// nog steeds hetzelfde belooft — precies de afspraak die de uitslagpagina's al
// hebben (daar is de h1 de racenaam). Google mag de h1 als SERP-titel gebruiken,
// dus een lange kop als h1 is een tweede kans om de titel te laten herschrijven.

// Korte kopregel: laat hele woorden vallen tot de kop binnen de ruimte past. Nooit
// midden in een woord, nooit een scheidingsteken achteraan en géén beletselteken —
// dit is de kopregel van de pagina, geen afgekapte samenvatting (bij de uitslagen
// valt er ook geen deel half weg). Past zelfs het eerste woord niet, dan blijft dat
// ene woord heel: een half woord is erger dan een paar tekens te veel, dezelfde
// regel als in truncate.
export const shortenHeadline = (value, max = TITLE_MAX) => {
  const clean = stripHtml(value);
  if (!clean || clean.length <= max) return clean;
  const words = clean.split(' ').filter(Boolean);
  let kept = '';
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word;
    if (next.length > max) break;
    kept = next;
  }
  if (!kept) kept = words[0] || clean;
  return kept.replace(TRAILING_SEPARATORS, '');
};

// De delen van een nieuwsartikeltitel, van belangrijk naar minder belangrijk:
//   1. de korte kop (het onderwerp van de pagina — staat er altijd in)
//   2. de datum in woorden
//   3. de rubriek
// Daarachter hangt het merk (withTitleBrand) — als het nog past.
//
// De rubriek staat bewust LAAG. 'Race Recaps' zou op elk artikel uit die rubriek
// dezelfde tekst zijn, en herhaalde sjabloontekst over een deelverzameling pagina's
// is precies een van de redenen waarom Google een titel vervangt. De datum
// onderscheidt wél: twee artikelen met dezelfde kop vallen op hun publicatiedatum
// uiteen. Rangorde (hoog bit = blijft het langst staan): datum (2), rubriek (1). De
// korte kop is het vangnet en past altijd.
export const newsArticleTitleCandidates = ({ headline, category, date }, { max = TITLE_MAX } = {}) => {
  const subject = shortenHeadline(headline, max) || 'Nieuws van 3SM';
  const dateLabel = formatDateNl(date, { style: 'short' }) || '';
  const rubriek = cleanText(category);
  const FORM_BITS = { date: 2, category: 1 };
  const candidates = [];
  for (let mask = 3; mask >= 0; mask -= 1) {
    const parts = [subject];
    if ((mask & FORM_BITS.date) && dateLabel) parts.push(dateLabel);
    if ((mask & FORM_BITS.category) && rubriek) parts.push(rubriek);
    const title = parts.join(TITLE_SEPARATOR);
    if (!candidates.includes(title)) candidates.push(title);
  }
  const fitting = candidates.filter((title) => title.length <= max);
  return fitting.length ? fitting : [subject];
};

// Eén nieuwsartikeltitel: de rijkste vorm die binnen TITLE_MAX past, met het merk
// erachter als dat nog past. Dit is exact het pad dat de generator én de SPA voor
// één artikel gebruiken; de twee moeten letterlijk hetzelfde zeggen.
export const buildNewsArticleTitle = ({ headline, category, date, brand = '3SM' }, { max = TITLE_MAX } = {}) => {
  const [richest] = newsArticleTitleCandidates({ headline, category, date }, { max });
  return withTitleBrand(richest, brand, max);
};

// De kopregel (h1) die bij die titel hoort: dezelfde korte kop, zodat de titel
// ermee begint. De generator zet dit als h1 in de crawler-HTML en de SPA toont
// precies dezelfde regel als kop van het artikel.
export const buildNewsArticleH1 = ({ headline }, { max = TITLE_MAX } = {}) => shortenHeadline(headline, max) || 'Nieuws van 3SM';

// Titels voor een hele SET nieuwsartikelen, met de garantie dat ze onderling uniek
// zijn — dezelfde set-brede aanpak als assignUniqueRaceResultTitles. Twee artikelen
// met dezelfde (ingekorte) kop zouden dezelfde titel krijgen; in dat geval schuift
// de tweede door naar de eerstvolgende vorm die nog vrij is: eerst de datum, anders
// de rubriek. `demoted` vertelt welk artikel niet zijn rijkste titel kreeg.
export const assignUniqueNewsArticleTitles = (articles, { max = TITLE_MAX, brand = '3SM' } = {}) => {
  const used = new Set();
  return (articles || []).map((article) => {
    const candidates = newsArticleTitleCandidates(article, { max });
    const distinguishing = candidates.find((candidate) => !used.has(candidate)) || candidates[0];
    used.add(distinguishing);
    return {
      ...article,
      distinguishing,
      richest: candidates[0],
      h1: buildNewsArticleH1(article, { max }),
      title: withTitleBrand(distinguishing, brand, max),
      demoted: distinguishing !== candidates[0],
    };
  });
};

// Titel van de nieuwshub (/news). Delen: het onderwerp ('3SM nieuws') en wat er
// staat ('raceverslagen en updates'). Zonder merk: '3SM' staat al in het onderwerp
// en de sitenaam toont Google tegenwoordig zelf boven de URL.
export const buildNewsHubTitle = ({ subject = '3SM nieuws', detail = 'raceverslagen en updates', brand = '' } = {}, { max = TITLE_MAX } = {}) => {
  const herkenning = cleanText(subject);
  const varianten = [
    [herkenning, cleanText(detail)].filter(Boolean).join(TITLE_SEPARATOR),
    herkenning,
  ].filter((title) => title && title.length <= max);
  const [richest] = varianten.length ? varianten : [herkenning];
  return withTitleBrand(richest, brand, max);
};

// Titel van een rubriekhub (/news/<rubriek>). Delen: de rubriek (onderwerp) en het
// woord 'nieuws' (wat de pagina is); daarachter het merk. De kop van die hub is de
// rubriek zelf ('Race Recaps') en is dus een voorvoegsel van de titel.
export const buildNewsCategoryTitle = ({ category, brand = '3SM' }, { max = TITLE_MAX } = {}) => {
  const subject = titleish(category) || 'Nieuws';
  const varianten = [
    [subject, 'nieuws'].join(TITLE_SEPARATOR),
    subject,
  ].filter((title) => title.length <= max);
  const [richest] = varianten.length ? varianten : [subject];
  return withTitleBrand(richest, brand, max);
};
