import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const POSTER_DIR = path.join(__dirname, '.cache', 'race-posters');
const WIDTH = 1600;
const HEIGHT = 900;

const TRACK_LAYOUTS = {
  'Autodromo Internazionale Enzo e Dino Ferrari': 'public/tracks/autodromo-enzo-e-dino-ferrari.png',
  'Autodromo Nazionale Monza': 'public/tracks/autodromo-nazionale-monza.png',
  'Barber Motorsports Park': 'public/tracks/layouts/barber-motorsports-park.svg',
  'Brands Hatch Circuit': 'public/tracks/brands-hatch-circuit.png',
  'Circuit de Barcelona Catalunya': 'public/tracks/circuit-de-barcelona-catalunya.png',
  'Circuit de Barcelona-Catalunya': 'public/tracks/circuit-de-barcelona-catalunya.png',
  'Circuit de Monaco': 'public/tracks/circuit-de-monaco.png',
  'Circuit de Spa-Francorchamps': 'public/tracks/circuit-de-spa-francorchamps.png',
  'Circuit Zandvoort': 'public/tracks/circuit-zandvoort.png',
  'Circuit Park Zandvoort': 'public/tracks/circuit-zandvoort.png',
  'Circuit Zolder': 'public/tracks/circuit-zolder.png',
  'Nürburgring Combined': 'public/tracks/n-rburgring-combined.png',
  'Nürburgring Grand Prix Circuit': 'public/tracks/n-rburgring-combined.png',
  'Nürburgring Grand-Prix-Strecke': 'public/tracks/n-rburgring-combined.png',
  'Silverstone Circuit': 'public/tracks/silverstone-circuit.png',
  'St. Petersburg Grand Prix': 'public/tracks/layouts/st-petersburg-grand-prix.svg',
  'St. Petersburg Street Circuit': 'public/tracks/layouts/st-petersburg-grand-prix.svg',
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeTrackName(track) {
  return String(track || '').split(' - ')[0].trim();
}

function slugify(value) {
  return String(value || 'race')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'race';
}

function formatPosterDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return { date: 'DATUM ONBEKEND', time: '--:-- CEST' };

  const dateLabel = date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Amsterdam',
  }).replace(/\./g, '').toUpperCase();

  const timeLabel = date.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  });
  const zone = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    timeZoneName: 'short',
  }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'CET';

  return { date: dateLabel, time: `${timeLabel} ${zone}` };
}

function statusLabel(key, raceStatus) {
  if (key === '24h') return 'ENTRY OPEN';
  if (key === '1h') return 'SESSION SOON';
  if (key === '15m') return 'FINAL CALL';
  if (key === 'live') return 'GREEN FLAG';
  if (key === 'cancelled') return 'CANCELLED';
  if (raceStatus === 'live') return 'GREEN FLAG';
  if (raceStatus === 'cancelled') return 'CANCELLED';
  return 'RACE NIGHT';
}

function posterAccent(key, raceStatus) {
  const status = key || raceStatus;
  if (status === '15m') return '#ef4444';
  if (status === '1h') return '#f97316';
  if (status === 'live') return '#22c55e';
  if (status === 'cancelled') return '#8b949e';
  return '#f97316';
}

function pickLayout(trackName) {
  const exact = TRACK_LAYOUTS[trackName];
  const base = TRACK_LAYOUTS[normalizeTrackName(trackName)];
  const relPath = exact || base;
  if (!relPath) return null;

  const absPath = path.join(ROOT_DIR, relPath);
  return fs.existsSync(absPath) ? absPath : null;
}

function fitText(text, maxChars) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

async function buildTrackLayer(trackName) {
  const layoutPath = pickLayout(trackName);
  if (!layoutPath) return null;

  const layoutBuffer = await sharp(layoutPath)
    .resize({ width: 820, height: 520, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .grayscale()
    .tint({ r: 255, g: 255, b: 255 })
    .modulate({ brightness: 1.7 })
    .png()
    .toBuffer();

  const meta = await sharp(layoutBuffer).metadata();
  const left = Math.round(700 + (820 - (meta.width || 820)) / 2);
  const top = Math.round(185 + (520 - (meta.height || 520)) / 2);
  const imageHref = `data:image/png;base64,${layoutBuffer.toString('base64')}`;
  const layerSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <image href="${imageHref}" x="${left}" y="${top}" width="${meta.width || 820}" height="${meta.height || 520}" opacity="0.24"/>
    </svg>
  `);

  return {
    input: layerSvg,
    left: 0,
    top: 0,
    blend: 'screen',
  };
}

function buildPosterSvg(race, key) {
  const accent = posterAccent(key, race.status);
  const round = race.round != null ? `ROUND ${String(race.round).padStart(2, '0')}` : 'RACE NIGHT';
  const track = fitText(race.track || 'Unknown Circuit', 34).toUpperCase();
  const raceName = fitText(race.name || 'Race', 36).toUpperCase();
  const trackFontSize = track.length > 28 ? 56 : track.length > 22 ? 64 : 78;
  const leagueName = fitText(race.leagues?.name || race.race_type || '3SM SERIES', 28).toUpperCase();
  const carClass = fitText(race.leagues?.car_class || race.race_type || 'LEAGUE EVENT', 28).toUpperCase();
  const { date, time } = formatPosterDate(race.race_date);
  const status = statusLabel(key, race.status);
  const formatParts = [
    race.practice_duration ? `P ${race.practice_duration}` : null,
    race.qualifying_duration ? `Q ${race.qualifying_duration}` : null,
    race.race_duration ? `R ${race.race_duration}` : null,
  ].filter(Boolean);
  const formatLine = fitText(formatParts.join('  /  ') || 'RACE FORMAT TBA', 44).toUpperCase();
  const conditions = fitText([race.start_type, race.weather, race.setup].filter(Boolean).join('  /  ') || 'SESSION DETAILS TBA', 44).toUpperCase();

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#050608"/>
          <stop offset="45%" stop-color="#101318"/>
          <stop offset="100%" stop-color="#050608"/>
        </linearGradient>
        <radialGradient id="glow" cx="75%" cy="48%" r="60%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
          <stop offset="55%" stop-color="${accent}" stop-opacity="0.06"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
          <path d="M 42 0 L 0 0 0 42" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
        </pattern>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000" flood-opacity="0.45"/>
        </filter>
      </defs>

      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
      <path d="M0 115 H520 L600 0 H680 L600 115 H1600" stroke="${accent}" stroke-opacity="0.28" stroke-width="2" fill="none"/>
      <path d="M0 760 H500 L580 900 H660 L580 760 H1600" stroke="#ffffff" stroke-opacity="0.09" stroke-width="2" fill="none"/>

      <g opacity="0.18">
        <rect x="0" y="0" width="18" height="900" fill="${accent}"/>
        <rect x="34" y="0" width="10" height="900" fill="${accent}"/>
        <rect x="58" y="0" width="6" height="900" fill="#ffffff"/>
      </g>

      <g transform="translate(112 94)">
        <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800" fill="#ffffff" letter-spacing="3">3 STRIPE MOTORSPORT</text>
        <text x="0" y="44" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="${accent}" letter-spacing="6">RACE CONTROL</text>
      </g>

      <g filter="url(#softShadow)" transform="translate(112 265)">
        <text x="0" y="0" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="68" font-weight="900" fill="${accent}" letter-spacing="2">${escapeXml(round)}</text>
        <text x="0" y="94" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${trackFontSize}" font-weight="900" fill="#ffffff">${escapeXml(track)}</text>
        <text x="0" y="154" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="800" fill="#cbd5e1" letter-spacing="2">${escapeXml(raceName)}</text>
      </g>

      <g transform="translate(112 595)">
        <rect x="0" y="0" width="338" height="70" rx="6" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.1"/>
        <text x="24" y="27" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#94a3b8" letter-spacing="3">DATE</text>
        <text x="24" y="55" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#ffffff">${escapeXml(date)}</text>
        <rect x="360" y="0" width="284" height="70" rx="6" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.1"/>
        <text x="384" y="27" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#94a3b8" letter-spacing="3">START</text>
        <text x="384" y="55" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#ffffff">${escapeXml(time)}</text>
      </g>

      <g transform="translate(112 706)">
        <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" fill="#ffffff" letter-spacing="2">${escapeXml(leagueName)}</text>
        <text x="0" y="36" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#94a3b8" letter-spacing="2">${escapeXml(carClass)}</text>
        <text x="0" y="78" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#e2e8f0">${escapeXml(formatLine)}</text>
        <text x="0" y="111" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#94a3b8">${escapeXml(conditions)}</text>
      </g>

      <g transform="translate(1135 95)">
        <rect x="0" y="0" width="300" height="58" rx="6" fill="${accent}" fill-opacity="0.92"/>
        <text x="150" y="38" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#09090b" letter-spacing="3">${escapeXml(status)}</text>
      </g>

      <g transform="translate(1125 740)">
        <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#94a3b8" letter-spacing="4">TRACK MAP</text>
        <text x="0" y="38" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#ffffff">${escapeXml(fitText(race.track || 'Unknown', 26))}</text>
      </g>

      <text x="112" y="852" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#64748b" letter-spacing="4">3SM // RACE NIGHT</text>
      <text x="1488" y="852" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#64748b" letter-spacing="4">DISCORD RACE POSTER</text>
    </svg>
  `);
}

export async function createRacePosterAttachment(race, key = 'race') {
  fs.mkdirSync(POSTER_DIR, { recursive: true });

  const fileName = `${slugify(race.name)}-${slugify(race.track)}-${key}.png`;
  const outputPath = path.join(POSTER_DIR, fileName);
  const svg = buildPosterSvg(race, key);
  const composites = [];
  const trackLayer = await buildTrackLayer(race.track);
  if (trackLayer) composites.push(trackLayer);

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: '#050608',
    },
  })
    .composite([
      { input: svg, left: 0, top: 0 },
      ...composites,
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  return {
    fileName,
    outputPath,
    hasTrackMap: Boolean(trackLayer),
  };
}

export function hasRacePosterTrackMap(trackName) {
  return Boolean(pickLayout(trackName));
}
