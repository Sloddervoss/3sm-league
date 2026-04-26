import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const POSTER_DIR = path.join(__dirname, '.cache', 'result-posters');
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

const MEDAL_COLORS = {
  p1: '#f7c948',
  p2: '#cbd5e1',
  p3: '#d08b5b',
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
  return String(value || 'race-results')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'race-results';
}

function fitText(text, maxChars) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function driverName(result) {
  return result?.profiles?.display_name || 'Onbekend';
}

function pointsLabel(points) {
  const value = Number(points || 0);
  return `${value} PTS`;
}

function formatDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'DATUM ONBEKEND';
  return date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).replace(/\./g, '').toUpperCase();
}

function pickLayout(trackName) {
  const exact = TRACK_LAYOUTS[trackName];
  const base = TRACK_LAYOUTS[normalizeTrackName(trackName)];
  const relPath = exact || base;
  if (!relPath) return null;

  const absPath = path.join(ROOT_DIR, relPath);
  return fs.existsSync(absPath) ? absPath : null;
}

async function buildTrackLayer(trackName) {
  const layoutPath = pickLayout(trackName);
  if (!layoutPath) return null;

  const layoutBuffer = await sharp(layoutPath)
    .resize({ width: 760, height: 430, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .grayscale()
    .tint({ r: 255, g: 255, b: 255 })
    .modulate({ brightness: 2.2 })
    .png()
    .toBuffer();

  const meta = await sharp(layoutBuffer).metadata();
  const left = Math.round(755 + (760 - (meta.width || 760)) / 2);
  const top = Math.round(130 + (430 - (meta.height || 430)) / 2);
  const imageHref = `data:image/png;base64,${layoutBuffer.toString('base64')}`;

  return {
    input: Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
        <image href="${imageHref}" x="${left}" y="${top}" width="${meta.width || 760}" height="${meta.height || 430}" opacity="0.34"/>
      </svg>
    `),
    left: 0,
    top: 0,
    blend: 'screen',
  };
}

function podiumCard({ x, y, width, height, result, place, color, primary = false }) {
  const name = fitText(driverName(result), primary ? 18 : 17).toUpperCase();
  const points = result ? pointsLabel(result.points) : '-- PTS';
  const gap = result?.gap_to_leader ? `+${fitText(result.gap_to_leader, 14)}` : place === 'P1' ? 'WINNER' : '';
  const placeSize = primary ? 48 : 34;
  const nameSize = primary ? (name.length > 16 ? 30 : 36) : (name.length > 15 ? 22 : 25);
  const pointsSize = primary ? 27 : 22;

  return `
    <g transform="translate(${x} ${y})">
      <path d="M0 34 Q0 0 34 0 H${width - 34} Q${width} 0 ${width} 34 V${height} H0 Z" fill="#11151d" fill-opacity="0.88" stroke="${color}" stroke-opacity="0.7" stroke-width="2"/>
      <path d="M0 ${height - 42} H${width} V${height} H0 Z" fill="${color}" fill-opacity="${primary ? '0.32' : '0.22'}"/>
      <text x="${width / 2}" y="68" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${placeSize}" font-weight="900" fill="${color}" letter-spacing="3">${place}</text>
      <text x="${width / 2}" y="${primary ? 128 : 116}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${nameSize}" font-weight="900" fill="#ffffff">${escapeXml(name)}</text>
      <text x="${width / 2}" y="${primary ? 168 : 154}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${pointsSize}" font-weight="900" fill="#e2e8f0" letter-spacing="2">${escapeXml(points)}</text>
      ${gap ? `<text x="${width / 2}" y="${height - 16}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="${color}" letter-spacing="2">${escapeXml(gap)}</text>` : ''}
    </g>
  `;
}

function trophyIcon({ x, y, scale = 1, color }) {
  const cupW = 116 * scale;
  const cupH = 82 * scale;
  const stemW = 32 * scale;
  const stemH = 36 * scale;
  const baseW = 164 * scale;
  const baseH = 18 * scale;
  const cupX = x - cupW / 2;
  const baseX = x - baseW / 2;

  return `
    <g transform="translate(0 0)">
      <path d="M${cupX} ${y} H${cupX + cupW} L${cupX + cupW - 18 * scale} ${y + cupH} Q${x} ${y + cupH + 34 * scale} ${cupX + 18 * scale} ${y + cupH} Z" fill="${color}" fill-opacity="0.96"/>
      <path d="M${cupX} ${y + 24 * scale} H${cupX - 42 * scale} Q${cupX - 40 * scale} ${y + cupH} ${cupX + 16 * scale} ${y + cupH + 2 * scale}" fill="none" stroke="${color}" stroke-width="${17 * scale}" stroke-linecap="round" stroke-opacity="0.82"/>
      <path d="M${cupX + cupW} ${y + 24 * scale} H${cupX + cupW + 42 * scale} Q${cupX + cupW + 40 * scale} ${y + cupH} ${cupX + cupW - 16 * scale} ${y + cupH + 2 * scale}" fill="none" stroke="${color}" stroke-width="${17 * scale}" stroke-linecap="round" stroke-opacity="0.82"/>
      <rect x="${x - stemW / 2}" y="${y + cupH + 12 * scale}" width="${stemW}" height="${stemH}" fill="${color}"/>
      <rect x="${baseX + 26 * scale}" y="${y + cupH + stemH + 12 * scale}" width="${baseW - 52 * scale}" height="${baseH}" rx="${6 * scale}" fill="${color}"/>
      <rect x="${baseX}" y="${y + cupH + stemH + 34 * scale}" width="${baseW}" height="${baseH}" rx="${6 * scale}" fill="${color}" fill-opacity="0.82"/>
    </g>
  `;
}

function statPanel({ x, y, title, name, value, color }) {
  return `
    <g transform="translate(${x} ${y})">
      <rect x="0" y="0" width="430" height="112" rx="8" fill="#10141c" fill-opacity="0.86" stroke="${color}" stroke-opacity="0.45"/>
      <text x="24" y="34" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="${color}" letter-spacing="3">${escapeXml(title)}</text>
      <text x="24" y="70" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#ffffff">${escapeXml(fitText(name, 24).toUpperCase())}</text>
      <text x="24" y="99" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" fill="#cbd5e1">${escapeXml(value)}</text>
    </g>
  `;
}

function buildResultPosterSvg(race, results, options = {}) {
  const finishers = results.filter(result => !result.dnf);
  const podium = finishers.slice(0, 3);
  const winner = podium[0];
  const second = podium[1];
  const third = podium[2];
  const fastest = results.find(result => result.fastest_lap);
  const cleanResults = finishers.filter(result => result.incidents != null);
  const cleanest = cleanResults.length ? cleanResults.reduce((best, result) =>
    result.incidents < best.incidents || (result.incidents === best.incidents && result.position < best.position) ? result : best
  ) : null;
  const dnfCount = results.filter(result => result.dnf).length;
  const totalInc = results.reduce((sum, result) => sum + (result.incidents ?? 0), 0);
  const incResults = results.filter(result => result.incidents != null);
  const title = fitText(race.name || 'Race Results', 24).toUpperCase();
  const track = fitText(race.track || 'Unknown Circuit', 27).toUpperCase();
  const titleFontSize = title.length > 22 ? 40 : title.length > 18 ? 44 : 50;
  const trackFontSize = track.length > 24 ? 22 : 24;
  const round = race.round != null ? `ROUND ${String(race.round).padStart(2, '0')}` : 'RACE RESULTS';
  const stats = [
    `${finishers.length} FINISHERS`,
    `${dnfCount} DNF`,
    incResults.length ? `${totalInc} INC TOTAAL` : null,
  ].filter(Boolean).join('  /  ');
  const updated = Boolean(options.updated);
  const footerText = updated
    ? 'Uitslag aangepast na steward beslissing'
    : 'Voor volledige uitslag: bekijk de website';

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#050608"/>
          <stop offset="48%" stop-color="#14120d"/>
          <stop offset="100%" stop-color="#050608"/>
        </linearGradient>
        <radialGradient id="goldGlow" cx="50%" cy="42%" r="54%">
          <stop offset="0%" stop-color="#f7c948" stop-opacity="0.20"/>
          <stop offset="48%" stop-color="#f97316" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
          <path d="M 42 0 L 0 0 0 42" fill="none" stroke="#ffffff" stroke-opacity="0.034" stroke-width="1"/>
        </pattern>
        <filter id="softShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.50"/>
        </filter>
      </defs>

      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#goldGlow)"/>
      <path d="M0 116 H465 L548 0 H628 L545 116 H1600" stroke="#f97316" stroke-opacity="0.26" stroke-width="2" fill="none"/>
      <path d="M0 762 H520 L600 900 H680 L600 762 H1600" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2" fill="none"/>

      <g opacity="0.2">
        <rect x="0" y="0" width="18" height="900" fill="#f7c948"/>
        <rect x="34" y="0" width="10" height="900" fill="#f97316"/>
        <rect x="58" y="0" width="6" height="900" fill="#ffffff"/>
      </g>

      <g transform="translate(112 88)">
        <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="900" fill="#ffffff" letter-spacing="3">3 STRIPE MOTORSPORT</text>
        <text x="0" y="44" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="800" fill="#f7c948" letter-spacing="6">OFFICIAL RESULTS</text>
      </g>

      ${updated ? `
        <g transform="translate(1130 92)">
          <rect x="0" y="0" width="330" height="56" rx="7" fill="#f97316" fill-opacity="0.92"/>
          <text x="165" y="36" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="900" fill="#09090b" letter-spacing="2">UITSLAG AANGEPAST</text>
        </g>
      ` : ''}

      <g transform="translate(112 194)">
        <text x="0" y="0" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="40" font-weight="900" fill="#f97316" letter-spacing="2">${escapeXml(round)}</text>
        <text x="0" y="56" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${titleFontSize}" font-weight="900" fill="#ffffff">${escapeXml(title)}</text>
        <text x="0" y="94" font-family="Arial, Helvetica, sans-serif" font-size="${trackFontSize}" font-weight="900" fill="#cbd5e1" letter-spacing="2">${escapeXml(track)}</text>
        <text x="0" y="128" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="900" fill="#94a3b8" letter-spacing="2">${escapeXml(formatDate(race.race_date))}</text>
      </g>

      <g filter="url(#softShadow)">
        ${trophyIcon({ x: 800, y: 258, scale: 1, color: MEDAL_COLORS.p1 })}
        ${trophyIcon({ x: 332, y: 374, scale: 0.46, color: MEDAL_COLORS.p2 })}
        ${trophyIcon({ x: 1268, y: 374, scale: 0.46, color: MEDAL_COLORS.p3 })}
        ${podiumCard({ x: 585, y: 392, width: 430, height: 232, result: winner, place: 'P1', color: MEDAL_COLORS.p1, primary: true })}
        ${podiumCard({ x: 145, y: 456, width: 375, height: 190, result: second, place: 'P2', color: MEDAL_COLORS.p2 })}
        ${podiumCard({ x: 1080, y: 456, width: 375, height: 190, result: third, place: 'P3', color: MEDAL_COLORS.p3 })}
      </g>

      ${statPanel({
        x: 335,
        y: 682,
        title: 'FASTEST LAP',
        name: fastest ? driverName(fastest) : 'Niet beschikbaar',
        value: fastest?.best_lap || '--',
        color: '#f97316',
      })}
      ${statPanel({
        x: 835,
        y: 682,
        title: 'CLEAN DRIVE',
        name: cleanest ? driverName(cleanest) : 'Niet beschikbaar',
        value: cleanest ? `${cleanest.incidents} INC` : '--',
        color: '#38bdf8',
      })}

      <text x="800" y="835" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="900" fill="#94a3b8" letter-spacing="3">${escapeXml(stats)}</text>
      <text x="800" y="868" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="900" fill="#f7c948" letter-spacing="2">${escapeXml(footerText)}</text>
    </svg>
  `);
}

export async function createResultPosterAttachment(race, results, options = {}) {
  fs.mkdirSync(POSTER_DIR, { recursive: true });

  const suffix = options.updated ? 'results-updated' : 'results';
  const fileName = `${slugify(race.name)}-${slugify(race.track)}-${suffix}.png`;
  const outputPath = path.join(POSTER_DIR, fileName);
  const svg = buildResultPosterSvg(race, results, options);
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
