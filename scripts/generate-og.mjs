/**
 * Genereert public/og-image.png vanuit de SVG via sharp
 * Gebruik: node scripts/generate-og.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dir, '../public/og-image.svg');
const outPath = join(__dir, '../public/og-image.png');

const svg = readFileSync(svgPath);

await sharp(svg)
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log('✓ public/og-image.png gegenereerd vanuit SVG');
