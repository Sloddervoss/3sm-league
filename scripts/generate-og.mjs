/**
 * Genereert public/og-image.png zonder externe packages
 * Gebruik: node scripts/generate-og.mjs
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

const W = 1200, H = 630;

// ── Pixel buffer (RGB, geen alpha — PNG type 2) ──────────────────────────────
const pixels = Buffer.alloc(W * H * 3);

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
}

function fillRect(x, y, w, h, r, g, b) {
  for (let row = y; row < y + h; row++)
    for (let col = x; col < x + w; col++)
      setPixel(col, row, r, g, b);
}

function fillRectAlpha(x, y, w, h, r, g, b, a, bgR, bgG, bgB) {
  const ar = a / 255;
  const fr = Math.round(r * ar + bgR * (1 - ar));
  const fg = Math.round(g * ar + bgG * (1 - ar));
  const fb = Math.round(b * ar + bgB * (1 - ar));
  fillRect(x, y, w, h, fr, fg, fb);
}

// ── Kleuren ──────────────────────────────────────────────────────────────────
const BG   = [15, 17, 23];     // #0F1117
const ORA  = [255, 107, 26];   // #FF6B1A
const WHT  = [255, 255, 255];
const GRY  = [136, 146, 164];  // #8892A4
const DRK  = [30, 35, 50];     // grid lijnen

// Achtergrond
fillRect(0, 0, W, H, ...BG);

// Subtiele grid lijnen
fillRect(0, H / 2, W, 1, ...DRK);
fillRect(W / 2, 0, 1, H, ...DRK);

// 3 oranje strepen links
fillRect(80, 180, 180, 20, ...ORA);
fillRectAlpha(80, 214, 130, 20, ...ORA, 178, ...BG);
fillRectAlpha(80, 248, 180, 20, ...ORA, 100, ...BG);

// Verticale scheiding
fillRect(314, 158, 4, 164, ...ORA);

// Onderlijn
fillRectAlpha(80, 480, 1040, 3, ...ORA, 100, ...BG);

// ── Tekst via bitmap font (7-segment stijl voor cijfers + blokletters) ───────
// Gebruik een 8x13 pixel bitmap font benadering
// Voor leesbare tekst: render blokken per karakter

function drawBitmapText(text, startX, startY, scaleX, scaleY, r, g, b) {
  // Simpele pixel font definitie (5x7 grid per karakter)
  const font = {
    '3': [[0,1,1,1,0],[0,0,0,1,1],[0,0,1,1,0],[0,0,0,1,1],[0,0,0,1,1],[0,0,0,1,1],[0,1,1,1,0]],
    'S': [[0,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
    'T': [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
    'R': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
    'I': [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[1,1,1,1,1]],
    'P': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
    'E': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    'M': [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    'O': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    'A': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    'N': [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    'G': [[0,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    'U': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
    'C': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
    'L': [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
    'H': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
    ' ': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
    '.': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,1,0,0]],
    'i': [[0,0,1,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
    'R': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
    'c': [[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
    'a': [[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[0,1,1,1,1],[1,0,0,0,1],[0,1,1,1,1]],
    'g': [[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,1,1,1,0]],
    'e': [[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,0],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,0],[0,1,1,1,0]],
    'u': [[0,0,0,0,0],[0,0,0,0,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1]],
  };

  let cx = startX;
  for (const ch of text) {
    const glyph = font[ch] || font[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col]) {
          fillRect(cx + col * scaleX, startY + row * scaleY, scaleX, scaleY, r, g, b);
        }
      }
    }
    cx += (5 + 1) * scaleX;
  }
}

// "3 STRIPE" groot wit
drawBitmapText('3 STRIPE', 340, 170, 14, 14, ...WHT);
// "MOTORSPORT" groot oranje
drawBitmapText('MOTORSPORT', 340, 290, 14, 14, ...ORA);
// "iRacing League" kleiner grijs
drawBitmapText('iRacing League', 344, 420, 6, 6, ...GRY);

// ── PNG encoderen ─────────────────────────────────────────────────────────────
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

// IDAT: voeg filter byte 0 toe per rij
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter None
  pixels.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}
const compressed = deflateSync(raw, { level: 6 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('public/og-image.png', png);
console.log('✓ public/og-image.png gegenereerd');
