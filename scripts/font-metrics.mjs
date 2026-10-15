// Pure-Node fontmeting voor de titelcontrole.
//
// Google kapt de titellink in de SERP af op PIXELBREEDTE, niet op tekens. Tekens
// zijn dus alleen een proxy; om te weten of een titel volledig past, moet de echte
// breedte in de corpsgrootte van de SERP (20px) gemeten worden. Dit bestand leest
// daarvoor de advance widths rechtstreeks uit de tabellen van een TrueType-font
// (head, hhea, hmtx, cmap) — geen npm-afhankelijkheid, geen fontconfig-binding.
//
// Belangrijk: Arial, Liberation Sans en Arimo hebben exact dezelfde advance widths.
// DejaVu Sans is breder en geeft dus te hoge (te pessimistische) getallen. De
// aanroeper hoort daarom te weten welk font gebruikt is; vandaar dat elke meting
// het font meelevert.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const u16 = (buffer, offset) => buffer.readUInt16BE(offset);
const u32 = (buffer, offset) => buffer.readUInt32BE(offset);

const readTableDirectory = (buffer) => {
  const numTables = u16(buffer, 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    const tag = buffer.toString('latin1', record, record + 4);
    tables.set(tag, { offset: u32(buffer, record + 8), length: u32(buffer, record + 12) });
  }
  return tables;
};

// cmap-subtabel kiezen (Unicode, bij voorkeur het formaat dat alle tekens dekt) en
// er een code -> glyphId-functie van maken.
const cmapLookup = (buffer, table) => {
  const base = table.offset;
  const numTables = u16(buffer, base + 2);
  const candidates = [];
  for (let i = 0; i < numTables; i += 1) {
    const record = base + 4 + i * 8;
    const platformID = u16(buffer, record);
    const encodingID = u16(buffer, record + 2);
    const offset = base + u32(buffer, record + 4);
    const format = u16(buffer, offset);
    if (format !== 4 && format !== 12) continue;
    const score = (format === 12 ? 4 : 0)
      + (platformID === 3 && encodingID === 10 ? 2 : 0)
      + (platformID === 0 ? 1 : 0)
      + (platformID === 3 && encodingID === 1 ? 1 : 0);
    candidates.push({ score, offset, format });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  if (!chosen) throw new Error('geen bruikbare cmap-subtabel gevonden');

  if (chosen.format === 12) {
    const groups = u32(buffer, chosen.offset + 12);
    return (code) => {
      for (let i = 0; i < groups; i += 1) {
        const group = chosen.offset + 16 + i * 12;
        const start = u32(buffer, group);
        const end = u32(buffer, group + 4);
        if (code >= start && code <= end) return u32(buffer, group + 8) + (code - start);
      }
      return 0;
    };
  }

  const segCount = u16(buffer, chosen.offset + 6) / 2;
  const endCodes = chosen.offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  return (code) => {
    for (let i = 0; i < segCount; i += 1) {
      if (u16(buffer, endCodes + i * 2) < code) continue;
      const start = u16(buffer, startCodes + i * 2);
      if (start > code) return 0;
      const delta = buffer.readInt16BE(idDeltas + i * 2);
      const rangeOffset = u16(buffer, idRangeOffsets + i * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyphOffset = idRangeOffsets + i * 2 + rangeOffset + (code - start) * 2;
      const glyph = u16(buffer, glyphOffset);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
};

export const loadFontMetrics = (path) => {
  const buffer = readFileSync(path);
  const tables = readTableDirectory(buffer);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');
  if (!head || !hhea || !hmtx || !cmap) {
    throw new Error(`${path} is geen TrueType-font met head/hhea/hmtx/cmap`);
  }
  const unitsPerEm = u16(buffer, head.offset + 18);
  const numberOfHMetrics = u16(buffer, hhea.offset + 34);
  const glyphFor = cmapLookup(buffer, cmap);
  // Voorbij het aantal hMetrics herhaalt de laatste advance zich (TrueType-regel).
  const advanceOf = (glyphId) => u16(buffer, hmtx.offset + 4 * Math.min(glyphId, numberOfHMetrics - 1));

  return {
    path,
    unitsPerEm,
    width(text, size = 20) {
      let total = 0;
      for (const character of String(text)) {
        total += advanceOf(glyphFor(character.codePointAt(0)));
      }
      return (total / unitsPerEm) * size;
    },
  };
};

const fcMatch = (family) => {
  try {
    const path = execFileSync('fc-match', ['-f', '%{file}', family], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
};

// Arimo is de metrisch identieke open variant van Arial (Apache-licentie). Alleen
// gedownload als er lokaal geen Arial-metrisch font staat; daarna uit de cache.
const ARIMO_URL = 'https://raw.githubusercontent.com/googlefonts/Arimo/main/fonts/ttf/Arimo-Regular.ttf';
const CACHE_DIR = 'node_modules/.cache/3sm-title-metrics';
const CACHED_ARIMO = join(CACHE_DIR, 'Arimo-Regular.ttf');

const downloadArimo = async () => {
  try {
    const response = await fetch(ARIMO_URL);
    if (!response.ok) return null;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHED_ARIMO, Buffer.from(await response.arrayBuffer()));
    return CACHED_ARIMO;
  } catch {
    return null;
  }
};

// Zoekt een font met Arial-metrics, in deze volgorde: TITLE_METRIC_FONT,
// Liberation Sans, Arimo, de gedownloade Arimo. Levert null als dat alles faalt —
// dan moet de aanroeper terugvallen op DejaVu en beide getallen melden.
export const findArialMetricFont = async () => {
  const explicit = process.env.TITLE_METRIC_FONT;
  if (explicit && existsSync(explicit)) return { path: explicit, label: `TITLE_METRIC_FONT (${explicit})` };

  for (const family of ['Liberation Sans', 'Liberation Sans Narrow', 'Arimo']) {
    const path = fcMatch(family);
    if (path && /liberation|arimo|arial/i.test(path)) return { path, label: family };
  }

  if (existsSync(CACHED_ARIMO)) return { path: CACHED_ARIMO, label: 'Arimo (cache)' };
  const downloaded = await downloadArimo();
  if (downloaded) return { path: downloaded, label: 'Arimo (gedownload)' };
  return null;
};

export const findFallbackFont = () => {
  const path = fcMatch('DejaVu Sans') || (existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    : null);
  return path ? { path, label: 'DejaVu Sans' } : null;
};

// De grenzen uit het onderzoek van oktober 2026 (504 echte Google-titellinks):
// onder 500px veilig, boven 577px nooit volledig getoond, boven 600px nooit zoals
// geschreven. De titel moet daar met Arial-metrics onder blijven.
export const PIXEL_SAFE = 500;
export const PIXEL_DISPLAYED_MAX = 577;
export const PIXEL_NEVER_AS_WRITTEN = 600;
