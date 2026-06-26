import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.resolve('public/racecraft-diagrams');
await fs.mkdir(outDir, { recursive: true });

const W = 1600, H = 900;
const C = {
  blue: '#2563eb', orange: '#f97316', green: '#22c55e', red: '#ef4444',
  white: '#fff', asphalt: '#2b3037', greenBg: '#0e2a18', redBg: '#2a1414',
  greenHead: '#16a34a', redHead: '#dc2626', gravel: '#b08a42',
};

// ── shared defs (asphalt, kerb, markers) ──────────────────────────
const DEFS = `<defs>
<marker id="ag" markerWidth="13" markerHeight="13" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#22c55e"/></marker>
<marker id="ar" markerWidth="13" markerHeight="13" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#ef4444"/></marker>
<marker id="ab" markerWidth="13" markerHeight="13" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#38bdf8"/></marker>
<pattern id="asph" width="90" height="90" patternUnits="userSpaceOnUse"><rect width="90" height="90" fill="#2b3037"/><circle cx="12" cy="20" r="1.8" fill="#525a66" opacity=".55"/><circle cx="50" cy="60" r="1.4" fill="#111827" opacity=".45"/><circle cx="78" cy="18" r="1.2" fill="#64748b" opacity=".35"/></pattern>
<pattern id="kerb" width="64" height="26" patternUnits="userSpaceOnUse"><rect width="32" height="26" fill="#f8fafc"/><rect x="32" width="32" height="26" fill="#dc2626"/></pattern>
</defs>`;

// top-down car. cx,cy center; ang rotation; col body; label below
function car(cx, cy, ang, col, label) {
  return `<g transform="translate(${cx} ${cy}) rotate(${ang})">
<ellipse cx="0" cy="0" rx="66" ry="30" fill="#05070b" opacity="0.4" transform="translate(7 9)"/>
<path d="M-54,-26 L-18,-33 L40,-29 L66,-15 L74,0 L66,15 L40,29 L-18,33 L-54,26 L-74,11 L-78,0 L-74,-11Z" fill="${col}" stroke="#0f172a" stroke-width="3"/>
<rect x="-25" y="-23" width="54" height="46" rx="10" fill="#dbeafe" opacity="0.92" stroke="#1e293b" stroke-width="2"/>
<rect x="-70" y="-39" width="34" height="8" rx="4" fill="#0f172a"/><rect x="36" y="-39" width="34" height="8" rx="4" fill="#0f172a"/>
<rect x="-70" y="31" width="34" height="8" rx="4" fill="#0f172a"/><rect x="36" y="31" width="34" height="8" rx="4" fill="#0f172a"/>
<circle cx="-58" cy="-17" r="5" fill="#fde68a"/><circle cx="-58" cy="17" r="5" fill="#fde68a"/>
${label ? `<g transform="rotate(${-ang}) translate(0 68)"><rect x="-92" y="-23" width="184" height="40" rx="9" fill="#020617" opacity="0.9" stroke="#fff" stroke-width="2"/><text x="0" y="6" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#fff">${label}</text></g>` : ''}
</g>`;
}

// checklist line with big icon
function checkLine(x, y, ok, text) {
  const icon = ok ? '✓' : '✗';
  const iconCol = ok ? '#22c55e' : '#ef4444';
  const txtCol = ok ? '#dcfce7' : '#fee2e2';
  return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="40" font-weight="900" fill="${iconCol}">${icon}</text>`
       + `<text x="${x + 52}" y="${y}" font-family="Arial,sans-serif" font-size="34" font-weight="800" fill="${txtCol}">${text}</text>`;
}

function header(x, y, w, col, title) {
  return `<rect x="${x}" y="${y}" width="${w}" height="64" rx="12" fill="${col}"/>`
       + `<text x="${x + w / 2}" y="${y + 44}" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" font-weight="950" fill="#fff">${title}</text>`;
}

async function render(name, content) {
  const t = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
<rect width="${W}" height="${H}" fill="#0b1220"/>
<rect x="0" y="0" width="${W / 2}" height="${H}" fill="${C.greenBg}"/>
<rect x="${W / 2}" y="0" width="${W / 2}" height="${H}" fill="${C.redBg}"/>
<line x1="${W / 2}" y1="40" x2="${W / 2}" y2="${H - 40}" stroke="#475569" stroke-width="4" stroke-dasharray="18 26"/>
${content}</svg>`;
  await fs.writeFile(path.join(outDir, name + '.svg'), t, 'utf8');
  // 2x density → crisp 3200x1800 PNG
  await sharp(Buffer.from(t), { density: 144 }).resize(W * 2, H * 2).png().toFile(path.join(outDir, name + '.png'));
}

// helper: a small corner/track scene on one half (used for divebomb)
// returns SVG for a curved corner with apex marker
function corner(ox) {
  return `<path d="M${ox + 40},740 C${ox + 170},700 ${ox + 250},610 ${ox + 300},500 C${ox + 332},425 ${ox + 332},355 ${ox + 300},300" fill="none" stroke="#111827" stroke-width="170" stroke-linecap="round"/>
<path d="M${ox + 40},740 C${ox + 170},700 ${ox + 250},610 ${ox + 300},500 C${ox + 332},425 ${ox + 332},355 ${ox + 300},300" fill="none" stroke="url(#asph)" stroke-width="146" stroke-linecap="round"/>
<path d="M${ox + 235},625 C${ox + 300},510 ${ox + 330},435 ${ox + 330},360" fill="none" stroke="url(#kerb)" stroke-width="24" stroke-linecap="round"/>`;
}

// ═══════════════════════════════════════════════════════════════════
// REJOIN  (05-rejoin-v2)
// ═══════════════════════════════════════════════════════════════════
const rejoin = `
<text x="${W / 2}" y="60" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="950" fill="#fff">REJOIN — terugkeren naar de baan</text>
${header(60, 95, 680, C.greenHead, 'VEILIGE REJOIN')}
${header(860, 95, 680, C.redHead, 'UNSAFE REJOIN')}

<!-- LEFT track + cars (placed low, out of text zone) -->
<path d="M80,640 C260,610 460,580 700,540" fill="none" stroke="#111827" stroke-width="150" stroke-linecap="round"/>
<path d="M80,640 C260,610 460,580 700,540" fill="none" stroke="url(#asph)" stroke-width="128" stroke-linecap="round"/>
<rect x="60" y="690" width="700" height="150" fill="${C.gravel}" opacity="0.55"/>
${car(560, 560, -4, C.blue, 'VERKEER')}
${car(230, 720, -18, C.orange, 'JIJ')}
<path d="M300,690 C380,640 460,600 540,575" stroke="#22c55e" stroke-width="9" fill="none" stroke-dasharray="22 14" marker-end="url(#ag)"/>
${checkLine(80, 180, true, 'Snelheid controleren')}
${checkLine(80, 240, true, 'Verkeer controleren')}
${checkLine(80, 300, true, 'Parallel invoegen')}
${checkLine(80, 360, true, 'Verkeer behoudt voorrang')}

<!-- RIGHT track + cars -->
<path d="M880,640 C1060,610 1260,580 1500,540" fill="none" stroke="#111827" stroke-width="150" stroke-linecap="round"/>
<path d="M880,640 C1060,610 1260,580 1500,540" fill="none" stroke="url(#asph)" stroke-width="128" stroke-linecap="round"/>
<rect x="860" y="690" width="700" height="150" fill="${C.gravel}" opacity="0.55"/>
${car(1320, 555, -4, C.blue, 'VERKEER')}
${car(1080, 760, -55, C.orange, 'JIJ')}
<path d="M1060,720 C1110,650 1180,600 1290,565" stroke="#ef4444" stroke-width="10" fill="none" marker-end="url(#ar)"/>
${checkLine(880, 180, false, 'Haaks de baan op')}
${checkLine(880, 240, false, 'Verkeer moet remmen')}
${checkLine(880, 300, false, 'Verkeer moet uitwijken')}
${checkLine(880, 360, false, 'Veroorzaakt nieuw incident')}
`;

// ═══════════════════════════════════════════════════════════════════
// DIVEBOMB  (12-divebomb-corner-v2)
// ═══════════════════════════════════════════════════════════════════
const divebomb = `
<text x="${W / 2}" y="60" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="950" fill="#fff">DIVEBOMB — aanval in de bocht</text>
${header(60, 95, 680, C.greenHead, 'LEGITIEME AANVAL')}
${header(860, 95, 680, C.redHead, 'DIVEBOMB')}

<!-- LEFT corner -->
${corner(40)}
<circle cx="372" cy="395" r="15" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="398" y="403" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#fde047">APEX</text>
<!-- turn-in point marker -->
<circle cx="305" cy="615" r="11" fill="#38bdf8" stroke="#0f172a" stroke-width="3"/>
<text x="322" y="638" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#bae6fd">moment van insturen</text>
<!-- overlap bracket between the two cars BEFORE turn-in -->
<line x1="180" y1="735" x2="295" y2="690" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/>
<line x1="180" y1="735" x2="180" y2="715" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/>
<line x1="295" y1="690" x2="295" y2="670" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/>
<rect x="150" y="745" width="230" height="34" rx="8" fill="#052e16" stroke="#22c55e" stroke-width="2"/>
<text x="165" y="769" font-family="Arial,sans-serif" font-size="21" font-weight="800" fill="#bbf7d0">overlap vóór turn-in</text>
${car(250, 660, -28, C.blue, 'AANVALLER')}
${car(120, 720, -8, C.orange, 'VERDEDIGER')}
${checkLine(80, 200, true, 'Overlap vóór turn-in')}
${checkLine(80, 270, true, 'Controle')}
${checkLine(80, 340, true, 'Apex haalbaar')}

<!-- RIGHT corner -->
${corner(840)}
<circle cx="1172" cy="395" r="15" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="1198" y="403" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#fde047">APEX</text>
<!-- right: attacker still far back at turn-in → no overlap -->
<circle cx="1095" cy="610" r="11" fill="#38bdf8" stroke="#0f172a" stroke-width="3"/>
<text x="900" y="633" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#bae6fd">geen overlap bij insturen</text>
${car(1180, 470, 28, C.red, 'AANVALLER')}
${car(990, 700, -8, C.orange, 'VERDEDIGER')}
<path d="M1230,540 C1180,470 1120,430 1060,440" stroke="#ef4444" stroke-width="9" fill="none" marker-end="url(#ar)"/>
${checkLine(880, 200, false, 'Te ver achter')}
${checkLine(880, 270, false, 'Mist apex')}
${checkLine(880, 340, false, 'Tegenstander als vangrail')}
`;

// ═══════════════════════════════════════════════════════════════════
// BLUE FLAG  (08-blauwe-vlag-lappen) — single non-split layout
// ═══════════════════════════════════════════════════════════════════
async function renderBlue(name) {
  const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
<rect width="${W}" height="${H}" fill="#0b1220"/>
<text x="${W / 2}" y="62" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="950" fill="#fff">BLAUWE VLAG — gelapt worden</text>
<rect x="60" y="95" width="1480" height="60" rx="12" fill="#1d4ed8"/>
<text x="${W / 2}" y="135" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="900" fill="#fff">Snellere leider komt eraan — laat hem voorbij</text>

<!-- track -->
<path d="M120,560 C420,500 820,500 1120,560 C1300,594 1420,600 1500,580" fill="none" stroke="#111827" stroke-width="190" stroke-linecap="round"/>
<path d="M120,560 C420,500 820,500 1120,560 C1300,594 1420,600 1500,580" fill="none" stroke="url(#asph)" stroke-width="166" stroke-linecap="round"/>

${car(760, 590, -2, C.orange, 'GELAPT')}
${car(470, 510, -4, C.blue, 'LEIDER')}
<path d="M560,520 C660,505 720,540 760,560" stroke="#38bdf8" stroke-width="9" fill="none" marker-end="url(#ab)"/>

<rect x="60" y="700" width="720" height="150" rx="14" fill="${C.greenBg}" stroke="${C.green}" stroke-width="3"/>
<text x="84" y="745" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="${C.green}">✓  MAG WEL</text>
<text x="84" y="788" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#dcfce7">Je eigen lijn blijven rijden</text>
<text x="84" y="824" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#dcfce7">Voorspelbaar blijven, niet abrupt remmen</text>

<rect x="820" y="700" width="720" height="150" rx="14" fill="${C.redBg}" stroke="${C.red}" stroke-width="3"/>
<text x="844" y="745" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="${C.red}">✗  MAG NIET</text>
<text x="844" y="788" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fee2e2">Actief verdedigen tegen de leider</text>
<text x="844" y="824" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fee2e2">De leider bewust ophouden</text>
</svg>`;
  await fs.writeFile(path.join(outDir, name + '.svg'), content, 'utf8');
  await sharp(Buffer.from(content), { density: 144 }).resize(W * 2, H * 2).png().toFile(path.join(outDir, name + '.png'));
}

await render('05-rejoin-v2', rejoin);
await render('12-divebomb-corner-v2', divebomb);
await renderBlue('08-blauwe-vlag-lappen');

// ═══════════════════════════════════════════════════════════════════
// FIRST CORNER  (14-eerste-bocht) — stewarding style, CORRECT vs FOUT
// ═══════════════════════════════════════════════════════════════════
const firstCorner = `
<text x="${W / 2}" y="60" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="950" fill="#fff">EERSTE BOCHT — marge vs te optimistisch</text>
${header(60, 95, 680, C.greenHead, 'CORRECT')}
${header(860, 95, 680, C.redHead, 'FOUT')}

<!-- LEFT corner: cars take margin, single file, gap kept -->
${corner(40)}
${car(150, 700, -14, C.orange, '')}
${car(280, 640, -24, C.blue, '')}
${car(360, 560, -40, C.green, '')}
<path d="M170,690 C260,620 330,560 372,470" stroke="#22c55e" stroke-width="9" fill="none" stroke-dasharray="22 14" marker-end="url(#ag)"/>
${checkLine(80, 200, true, 'Extra marge')}
${checkLine(80, 270, true, 'Ruimte laten')}
${checkLine(80, 340, true, 'Incident voorkomen')}

<!-- RIGHT corner: 3-wide dive, no room, contact burst -->
${corner(840)}
${car(950, 700, -10, C.orange, '')}
${car(1010, 660, -16, C.blue, '')}
${car(1090, 660, -20, C.red, '')}
<path d="M1230,520 C1170,470 1110,450 1050,470" stroke="#ef4444" stroke-width="9" fill="none" marker-end="url(#ar)"/>
<g transform="translate(1075 645)"><path d="M0,-34 L9,-11 L33,-11 L13,4 L21,28 L0,13 L-21,28 L-13,4 L-33,-11 L-9,-11Z" fill="#fde047" stroke="#b45309" stroke-width="3"/></g>
${checkLine(880, 200, false, 'Te optimistische aanval')}
${checkLine(880, 270, false, 'Onvoldoende ruimte')}
${checkLine(880, 340, false, 'Vermijdbaar contact')}
`;
await render('14-eerste-bocht', firstCorner);

console.log('done: rejoin, divebomb, blueflag, firstcorner regenerated at 2x density');
