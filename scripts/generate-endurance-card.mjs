#!/usr/bin/env node
/**
 * 3SM Endurance — premium card background generator.
 *
 * Refined visual language: original 3SM "3 STRIPE MOTORSPORT" brand tokens only —
 * no iRacing marks, no sponsors, no official text, no pixels.
 *
 * Design goals in this revision:
 *   • premium NIGHT-scene background card (not a text poster)
 *   • a LARGE, detailed prototype/GT silhouette as the hero (not a tiny generic car)
 *   • strong headlight glow + beams cutting the dark
 *   • the 3 orange stripes kept as a SUBTLE dynamic accent (not a full-bleed diagonal)
 *   • a CALM text zone reserved for the event overlay (branding kept small & quiet)
 *
 * Produces public/endurance/endurance-card.svg/.png/.webp
 *   portrait 1600x2000 and landscape 1600x900 variants.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "endurance");
mkdirSync(OUT, { recursive: true });

// ----------------------------------------------------------------- palette
const BG_TOP   = "#04060C";   // night sky zenith
const BG_MID   = "#0A1424";   // deep navy
const BG_HOR   = "#0A0D18";   // near horizon
const BG_DEEP  = "#05070D";   // asphalt deep
const ORANGE   = "#FF6B1A";
const ORANGE_W = "#FFD9A8";   // warm headlight
const RED      = "#E63B2E";
const BODY     = "#0E1522";   // car body
const BODY_LIT = "#1B2639";   // car body lit edge
const BODY_DK  = "#070B12";   // car shadow
const ANTR     = "#141D2C";   // track / structure
const ANTR_LIT = "#232F45";
const TEXT     = "#F4F6FA";
const MUTED    = "#7E8CA3";

// deterministic star field + scatter
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stars(W, H, n, seed, yMax, minO, maxO) {
  const rnd = mulberry32(seed);
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * W);
    const y = Math.round(rnd() * yMax);
    const r = (0.4 + rnd() * 1.6).toFixed(1);
    const o = (minO + rnd() * (maxO - minO)).toFixed(2);
    const c = rnd() > 0.9 ? ORANGE : "#ffffff";
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`;
  }
  return s;
}

// ------------------------------------------------------------- car (local art)
// A detailed prototype/GT silhouette facing RIGHT. Local canvas ~860x320,
// ground line at y=300. Callers apply translate+scale(+rotate).
function car() {
  return `
  <g>
    <!-- underbody / floor shadow -->
    <path d="M 18 300 C 220 306, 640 306, 848 300 L 848 308 C 640 314, 220 314, 18 308 Z" fill="#000000" opacity="0.6"/>

    <!-- main body silhouette -->
    <path d="M 20 296
             C 20 252, 26 216, 44 200
             L 92 190
             C 150 178, 210 184, 290 200
             C 340 210, 388 216, 414 202
             C 428 148, 458 116, 512 108
             C 552 102, 584 112, 610 132
             C 626 146, 648 158, 672 172
             C 698 188, 724 200, 740 210
             C 756 220, 774 226, 792 214
             C 814 200, 826 206, 836 224
             L 848 262
             C 826 276, 806 284, 794 290
             L 96 300
             L 26 300 Z"
          fill="${BODY}" stroke="${BODY_LIT}" stroke-width="2.5"/>

    <!-- shoulder highlight along the whole body -->
    <path d="M 70 198 C 150 186, 250 184, 330 198 C 380 206, 410 206, 430 196
             C 445 148, 470 120, 516 112 C 552 106, 578 114, 604 132
             C 622 146, 648 162, 676 178 C 700 192, 726 204, 744 212"
          fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="6" stroke-linecap="round"/>

    <!-- canopy / cockpit window (darker cut) -->
    <path d="M 480 118 C 516 110, 548 112, 574 126 C 594 138, 606 150, 612 162
             C 596 162, 540 158, 500 150 C 486 132, 480 124, 480 118 Z"
          fill="${BODY_DK}" stroke="${BODY_LIT}" stroke-width="1.5" stroke-opacity="0.9"/>
    <!-- canopy reflection -->
    <path d="M 492 128 C 520 118, 552 120, 574 130" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="3" stroke-linecap="round"/>

    <!-- sidepod intake -->
    <path d="M 360 216 C 380 202, 420 196, 462 200 C 452 214, 420 220, 382 222 Z"
          fill="${BODY_DK}" stroke="${ORANGE}" stroke-opacity="0.35" stroke-width="2"/>
    <path d="M 372 214 C 392 204, 428 200, 456 202" fill="none" stroke="${ORANGE}" stroke-opacity="0.5" stroke-width="2"/>

    <!-- ===== rear wing (red->orange) ===== -->
    <g>
      <path d="M 22 172 L 22 152 L 250 150 C 268 152, 274 158, 272 166 L 268 182 C 190 178, 90 174, 22 172 Z"
            fill="url(#wing)"/>
      <path d="M 34 172 L 34 158 L 246 156" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="3"/>
      <path d="M 20 150 L 20 174 L 30 174 L 30 150 Z" fill="${RED}"/>
      <!-- endplate -->
      <rect x="14" y="120" width="10" height="72" rx="2.5" fill="${RED}"/>
      <rect x="14" y="120" width="10" height="72" rx="2.5" fill="${RED}" opacity="0.35" filter="url(#soft)"/>
    </g>

    <!-- rear diffuser + fins -->
    <path d="M 24 300 L 24 258 L 120 268 L 120 300 Z" fill="${BODY_DK}"/>
    <path d="M 34 292 L 34 262 M 58 294 L 58 265 M 84 296 L 84 267 M 108 298 L 108 269"
          stroke="${ORANGE}" stroke-opacity="0.75" stroke-width="6" stroke-linecap="round"/>
    <path d="M 20 258 L 120 268 L 116 278 L 24 270 Z" fill="${ORANGE}" opacity="0.5"/>

    <!-- front splitter / dive plane (orange edge) -->
    <path d="C 800 296, 806 296, 810 292 M 812 288 L 846 278"
          stroke="${ORANGE}" stroke-opacity="0.8" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M 792 282 L 848 268 L 848 282 L 800 292 Z" fill="${ORANGE}" opacity="0.7"/>

    <!-- fender / front light pod -->
    <path d="M 806 224 C 820 214, 832 218, 840 232 C 844 244, 844 258, 840 268 L 806 266 C 806 252, 806 238, 806 224 Z"
          fill="${BODY_DK}"/>

    <!-- ===== wheels ===== -->
    <!-- rear -->
    <g>
      <ellipse cx="256" cy="262" rx="34" ry="46" fill="${BODY_DK}"/>
      <ellipse cx="256" cy="262" rx="40" ry="40" fill="${BODY_DK}"/>
      <ellipse cx="256" cy="262" rx="20" ry="20" fill="#0C1220"/>
      <ellipse cx="256" cy="262" rx="8" ry="8" fill="${ORANGE}"/>
      <ellipse cx="256" cy="262" rx="8" ry="8" fill="${ORANGE}" filter="url(#soft)" opacity="0.85"/>
      <path d="M 256 246 L 256 278 M 240 252 L 272 272 M 272 252 L 240 272" stroke="${ANTR_LIT}" stroke-width="3"/>
    </g>
    <!-- front -->
    <g>
      <ellipse cx="736" cy="258" rx="33" ry="45" fill="${BODY_DK}"/>
      <ellipse cx="736" cy="258" rx="39" ry="39" fill="${BODY_DK}"/>
      <ellipse cx="736" cy="258" rx="19" ry="19" fill="#0C1220"/>
      <ellipse cx="736" cy="258" rx="8" ry="8" fill="${ORANGE}"/>
      <ellipse cx="736" cy="258" rx="8" ry="8" fill="${ORANGE}" filter="url(#soft)" opacity="0.9"/>
      <path d="M 736 243 L 736 273 M 721 248 L 751 268 M 751 248 L 721 268" stroke="${ANTR_LIT}" stroke-width="3"/>
    </g>

    <!-- ===== headlights ===== -->
    <ellipse cx="834" cy="224" rx="7" ry="13" fill="${ORANGE_W}"/>
    <ellipse cx="830" cy="244" rx="6" ry="12" fill="#FFE0B0"/>
    <ellipse cx="824" cy="238" rx="30" ry="42" fill="url(#headGlow)"/>
  </g>`;
}

// ------------------------------------------------------- shared scene helpers
function nebula(W, H, cx, cy, r, color, op) {
  return `<radialGradient id="neb${cx}${cy}" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${color}" stop-opacity="${op}"/>
    <stop offset="0.55" stop-color="${color}" stop-opacity="${(op * 0.45).toFixed(2)}"/>
    <stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </radialGradient>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#neb${cx}${cy})"/>`;
}

function subtleStripes(g, x, y, dx, dy, w) {
  // three tapered speed-trails used as a quiet accent (not full-bleed diagonals)
  let s = "";
  for (let i = 0; i < 3; i++) {
    const o = 0.10 + (2 - i) * 0.05;
    const pts = [
      x, y + i * 16,
      x + w, y + i * 16 - 34,
      x + w + 40, y + i * 16 - 20,
      x + 10, y + i * 16 + 14
    ].map(n => n.toFixed(1)).join(" ");
    s += `<polygon points="${pts}" fill="${ORANGE}" opacity="${o.toFixed(2)}" transform="translate(${dx} ${dy})"/>`;
  }
  void g;
  return s;
}

// ================================================================ LANDSCAPE
function buildLandscape() {
  const W = 1600, H = 900;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="0.55" stop-color="${BG_MID}"/>
      <stop offset="0.82" stop-color="${BG_HOR}"/>
      <stop offset="1" stop-color="${BG_DEEP}"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFE9CB" stop-opacity="0.38"/>
      <stop offset="0.55" stop-color="${ORANGE}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="beam2" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#FFE9CB" stop-opacity="0.5"/>
      <stop offset="0.5" stop-color="${ORANGE}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="headGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFF1DA" stop-opacity="0.95"/>
      <stop offset="0.25" stop-color="${ORANGE}" stop-opacity="0.7"/>
      <stop offset="0.7" stop-color="${ORANGE}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${RED}"/>
      <stop offset="1" stop-color="${ORANGE}"/>
    </linearGradient>
    <radialGradient id="skyGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#2C3E63" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="#2C3E63" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#2C3E63" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- deep sky atmosphere -->
  ${nebula(W, H, 200, 150, 420, "#22304F", 0.55)}
  ${nebula(W, H, 1300, 90, 360, "#3A2547", 0.4)}
  <circle cx="820" cy="150" r="500" fill="url(#skyGlow)"/>

  <!-- stars -->
  ${stars(W, H, 150, 7, 560, 0.12, 0.9)}

  <!-- subtle 3-stripe accent in the sky (quiet, thin) -->
  <g blend-mode="screen">
    ${subtleStripes(W, 180, 60, 170, 0, 300)}
    ${subtleStripes(W, 120, -40, 560, 0, 340)}
  </g>

  <!-- ===== track / asphalt ===== -->
  <g>
    <path d="M -40 640 C 320 620, 700 660, 1040 730 C 1240 770, 1440 820, 1660 880
             L 1660 920 L -40 920 Z" fill="#060910" opacity="0.9"/>
    <path d="M -40 640 C 320 620, 700 660, 1040 730 C 1240 770, 1440 820, 1660 880"
          fill="none" stroke="${ANTR_LIT}" stroke-width="70" opacity="0.35" filter="url(#blur)"/>
    <!-- outer edge line -->
    <path d="M -40 622 C 300 600, 680 636, 1020 706 C 1240 750, 1460 806, 1680 872"
          fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="5"/>
    <!-- kerb -->
    <path d="M 700 656 C 900 678, 1120 724, 1360 790"
          fill="none" stroke="${RED}" stroke-opacity="0.35" stroke-width="8" stroke-dasharray="34 26"/>
  </g>

  <!-- distant field: small cars ahead on the track (pack scale + night depth) -->
  <g opacity="0.55">
    ${[ /* dist car*/ ]}${carShadow()}${carAbs(930, 600, 0.20, -4)}
    ${carAbs(1060, 636, 0.15, -3)}
  </g>

  <!-- headlight illumination wash across the dark -->
  <ellipse cx="640" cy="670" rx="900" ry="330" fill="url(#beam2)" opacity="0.5" transform="rotate(-8 640 670)"/>

  <!-- ===== HERO CAR ===== -->
  <g transform="translate(90 470) rotate(-3) scale(1.30)">
    <!-- beams: wide low cone + tight core -->
    <polygon points="300,120 1240,-300 1330,-220 300,240" fill="url(#beam)"/>
    <polygon points="300,120 1420,-520 1500,-430 300,240" fill="url(#beam)" opacity="0.75"/>
    <polygon points="300,120 1060,-90 1090,-40 300,200" fill="#FFFFFF" opacity="0.12"/>
    ${car()}
  </g>

  <!-- soft orange ambient glow rising from the car headlights -->
  <circle cx="1280" cy="560" r="300" fill="${ORANGE}" opacity="0.07" filter="url(#glow)"/>

  <!-- ===== calm text zone (event overlay reserved) ===== -->
  <g font-family="DejaVu Sans, Arial, sans-serif">
    <text x="72" y="96" font-size="30" font-weight="bold" fill="${ORANGE}" letter-spacing="8">3SM</text>
    <text x="162" y="96" font-size="22" font-weight="bold" fill="${MUTED}" letter-spacing="6">ENDURANCE</text>
    <text x="72" y="132" font-size="14" font-weight="bold" fill="${MUTED}" letter-spacing="5" opacity="0.7">THREE STRIPE MOTORSPORT</text>

    <!-- footer mark -->
    <rect x="72" y="820" width="46" height="3" fill="${ORANGE}" opacity="0.7"/>
    <text x="72" y="856" font-size="17" font-weight="bold" fill="${MUTED}" letter-spacing="5">3STRIPEMOTORSPORT.CC</text>
    <text x="1460" y="856" font-size="17" font-weight="bold" fill="${MUTED}" letter-spacing="5">#3SM</text>
  </g>
</svg>`;
}

// mini distant car (tiny silhouette, no detail) — for the "field" ahead
function carShadow() {
  return `<path d="M 0 120 L 0 66 C 26 60, 52 64, 74 76 C 92 85, 100 92, 106 108
           L 168 120 L 8 130 Z" fill="#0A101C" stroke="#1B2639" stroke-width="2" opacity="0.0"/>`;
}
function carAbs(x, y, s, r) {
  return `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">
    <polygon points="300,120 900,-140 950,-90 300,170" fill="url(#beam)" opacity="0.6"/>
    <path d="M 20 130 C 26 92, 90 62, 180 60 C 240 58, 330 84, 400 104 C 430 116, 428 130, 400 130 Z"
          fill="#0A101C" stroke="#1B2639" stroke-width="3"/>
    <ellipse cx="130" cy="128" rx="26" ry="38" fill="#05070C"/>
    <ellipse cx="370" cy="126" rx="26" ry="38" fill="#05070C"/>
    <ellipse cx="430" cy="86" rx="8" ry="16" fill="#FFE0B0"/>
    <ellipse cx="422" cy="92" rx="26" ry="36" fill="url(#headGlow)"/>
  </g>`;
}

// ================================================================ PORTRAIT
function buildPortrait() {
  const W = 1600, H = 2000;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="0.5" stop-color="${BG_MID}"/>
      <stop offset="0.82" stop-color="${BG_HOR}"/>
      <stop offset="1" stop-color="${BG_DEEP}"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFE9CB" stop-opacity="0.4"/>
      <stop offset="0.55" stop-color="${ORANGE}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="beam2" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" stop-color="#FFE9CB" stop-opacity="0.5"/>
      <stop offset="0.5" stop-color="${ORANGE}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="headGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFF1DA" stop-opacity="0.95"/>
      <stop offset="0.25" stop-color="${ORANGE}" stop-opacity="0.7"/>
      <stop offset="0.7" stop-color="${ORANGE}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${RED}"/>
      <stop offset="1" stop-color="${ORANGE}"/>
    </linearGradient>
    <radialGradient id="skyGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#2C3E63" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="#2C3E63" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#2C3E63" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  ${nebula(W, H, 260, 300, 500, "#22304F", 0.5)}
  ${nebula(W, H, 1320, 220, 430, "#3A2547", 0.38)}
  <circle cx="820" cy="330" r="560" fill="url(#skyGlow)"/>

  ${stars(W, H, 170, 11, 1250, 0.1, 0.85)}

  <!-- subtle 3-stripe accent -->
  <g blend-mode="screen">
    ${subtleStripes(W, 300, 120, 540, 0, 380)}
  </g>

  <!-- track flowing through the lower half -->
  <g>
    <path d="M -60 1290 C 420 1220, 900 1340, 1340 1500 C 1560 1584, 1680 1640, 1800 1720
             L 1800 2100 L -60 2100 Z" fill="#060910" opacity="0.9"/>
    <path d="M -60 1290 C 420 1220, 900 1340, 1340 1500 C 1560 1584, 1680 1640, 1800 1720"
          fill="none" stroke="${ANTR_LIT}" stroke-width="90" opacity="0.35" filter="url(#blur)"/>
    <path d="M -60 1260 C 380 1188, 860 1304, 1290 1466 C 1520 1554, 1660 1612, 1800 1696"
          fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="6"/>
    <path d="M 820 1300 C 1040 1344, 1280 1418, 1520 1520"
          fill="none" stroke="${RED}" stroke-opacity="0.3" stroke-width="9" stroke-dasharray="40 30"/>
  </g>

  <!-- distant field -->
  <g opacity="0.55">
    ${carAbs(800, 1150, 0.22, -4)}
    ${carAbs(980, 1210, 0.16, -3)}
  </g>

  <ellipse cx="620" cy="1330" rx="980" ry="420" fill="url(#beam2)" opacity="0.5" transform="rotate(-6 620 1330)"/>

  <!-- HERO CAR (larger in portrait) -->
  <g transform="translate(120 1220) rotate(-3) scale(1.42)">
    <polygon points="300,120 1280,-300 1370,-220 300,240" fill="url(#beam)"/>
    <polygon points="300,120 1460,-560 1540,-470 300,240" fill="url(#beam)" opacity="0.72"/>
    <polygon points="300,120 1100,-90 1130,-40 300,200" fill="#FFFFFF" opacity="0.12"/>
    ${car()}
  </g>

  <circle cx="1330" cy="1320" r="360" fill="${ORANGE}" opacity="0.07" filter="url(#glow)"/>

  <!-- calm text zone -->
  <g font-family="DejaVu Sans, Arial, sans-serif">
    <text x="96" y="180" font-size="40" font-weight="bold" fill="${ORANGE}" letter-spacing="10">3SM</text>
    <text x="236" y="180" font-size="30" font-weight="bold" fill="${MUTED}" letter-spacing="7">ENDURANCE</text>
    <text x="96" y="232" font-size="18" font-weight="bold" fill="${MUTED}" letter-spacing="6" opacity="0.7">THREE STRIPE MOTORSPORT</text>

    <rect x="96" y="1880" width="56" height="3" fill="${ORANGE}" opacity="0.7"/>
    <text x="96" y="1932" font-size="20" font-weight="bold" fill="${MUTED}" letter-spacing="6">3STRIPEMOTORSPORT.CC</text>
    <text x="1340" y="1932" font-size="20" font-weight="bold" fill="${MUTED}" letter-spacing="6">#3SM</text>
  </g>
</svg>`;
}

// ------------------------------------------------------------------ render
async function render(svg, base, width, height) {
  const svgPath = `${base}.svg`;
  writeFileSync(svgPath, svg);
  const png = `${base}.png`;
  const webp = `${base}.webp`;
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height)
    .png()
    .toFile(png);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height)
    .webp({ quality: 90 })
    .toFile(webp);
  const meta = await sharp(png).metadata();
  console.log(`✓ ${svgPath}`);
  const sz = (p) => `${Math.round(statSync(p).size / 1024)}KB`;
  console.log(`  → ${png}  ${meta.width}×${meta.height} ${sz(png)}`);
  const wm = await sharp(webp).metadata();
  console.log(`  → ${webp} ${wm.width}×${wm.height} ${sz(webp)}`);
}

const portrait = buildPortrait();
const landscape = buildLandscape();

await render(portrait, join(OUT, "endurance-card-portrait"), 1600, 2000);
await render(landscape, join(OUT, "endurance-card-landscape"), 1600, 900);
writeFileSync(join(OUT, "endurance-card.svg"), portrait);
console.log("done");
