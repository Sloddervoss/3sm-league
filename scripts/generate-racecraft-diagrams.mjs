import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.resolve('public/racecraft-diagrams');
await fs.mkdir(outDir, { recursive: true });

const W = 1600;
const H = 900;

function car(id, x, y, angle, color, label, extras = '') {
  return `<g id="${id}" transform="translate(${x} ${y}) rotate(${angle})">
    <ellipse cx="0" cy="0" rx="74" ry="34" fill="#05070b" opacity="0.38" transform="translate(8 10)"/>
    <rect x="-86" y="-37" width="172" height="74" rx="20" fill="${color}" stroke="#f8fafc" stroke-width="4"/>
    <path d="M-58,-28 L-20,-36 L42,-31 L72,-16 L80,0 L72,16 L42,31 L-20,36 L-58,28 L-80,12 L-84,0 L-80,-12 Z" fill="${color}" stroke="#0f172a" stroke-width="3"/>
    <rect x="-27" y="-25" width="58" height="50" rx="11" fill="#dbeafe" opacity="0.9" stroke="#1e293b" stroke-width="2"/>
    <rect x="-77" y="-42" width="38" height="9" rx="4" fill="#0f172a"/>
    <rect x="39" y="-42" width="38" height="9" rx="4" fill="#0f172a"/>
    <rect x="-77" y="33" width="38" height="9" rx="4" fill="#0f172a"/>
    <rect x="39" y="33" width="38" height="9" rx="4" fill="#0f172a"/>
    <circle cx="-63" cy="-19" r="6" fill="#fde68a"/>
    <circle cx="-63" cy="19" r="6" fill="#fde68a"/>
    ${extras}
    <g transform="rotate(${-angle}) translate(0 76)">
      <rect x="-62" y="-22" width="124" height="36" rx="9" fill="#020617" opacity="0.84" stroke="#ffffff" stroke-width="2"/>
      <text x="0" y="3" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="800" fill="#fff">${label}</text>
    </g>
  </g>`;
}

function arrow(x1, y1, x2, y2, color = '#38bdf8', width = 10, dashed = false) {
  return `<path d="M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${dashed ? 'stroke-dasharray="20 18"' : ''} marker-end="url(#arrow-${color.replace('#','')})"/>`;
}
function straightArrow(x1, y1, x2, y2, color = '#38bdf8', width = 10, dashed = false) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${dashed ? 'stroke-dasharray="20 18"' : ''} marker-end="url(#arrow-${color.replace('#','')})"/>`;
}
function wrapText(text, maxChars = 34) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else { line = next; }
  }
  if (line) lines.push(line);
  return lines;
}
function labelBox(x, y, title, body, color = '#0f172a', width = 560) {
  const bodyLines = wrapText(body, Math.floor((width - 48) / 14));
  const height = Math.max(134, 68 + bodyLines.length * 31);
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="${height}" rx="18" fill="${color}" opacity="0.94" stroke="#f97316" stroke-width="4"/>
    <text x="24" y="38" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="900" fill="#fff">${title}</text>
    ${bodyLines.map((line, i) => `<text x="24" y="${78 + i * 31}" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="750" fill="#e2e8f0">${line}</text>`).join('')}
  </g>`;
}
function base(title, subtitle, defsExtra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow-38bdf8" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#38bdf8"/></marker>
    <marker id="arrow-f97316" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#f97316"/></marker>
    <marker id="arrow-22c55e" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#22c55e"/></marker>
    <marker id="arrow-ef4444" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#ef4444"/></marker>
    <pattern id="asphalt" width="90" height="90" patternUnits="userSpaceOnUse"><rect width="90" height="90" fill="#2b3037"/><circle cx="12" cy="20" r="1.8" fill="#525a66" opacity=".55"/><circle cx="50" cy="60" r="1.4" fill="#111827" opacity=".45"/><circle cx="78" cy="18" r="1.2" fill="#64748b" opacity=".35"/><path d="M0 45H90" stroke="#3f4651" stroke-width="1" opacity=".25"/></pattern>
    <pattern id="kerb" width="70" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(0)"><rect width="35" height="28" fill="#f8fafc"/><rect x="35" width="35" height="28" fill="#dc2626"/></pattern>
    ${defsExtra}
  </defs>
  <rect width="1600" height="900" fill="#14351f"/>
  <path d="M0,760 C260,690 430,740 600,800 C870,895 1160,850 1600,760 L1600,900 L0,900 Z" fill="#0f2a18" opacity="0.8"/>
  <text x="60" y="68" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="950" fill="#fff">${title}</text>
  <text x="62" y="112" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="700" fill="#cbd5e1">${subtitle}</text>
`;
}
function close() { return `</svg>`; }
function finish(name, svg) { return fs.writeFile(path.join(outDir, `${name}.svg`), svg, 'utf8').then(async()=>{
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${name}.png`));
}); }

const diagrams = [];

// ─── EXISTING 8 DIAGRAMS (kept unchanged, they're good) ─────────────────

// 1 - Overlap voor turn-in
let svg = base('1. Inhaalactie vóór de bocht', 'Duidelijk overlap vóór turn-in: binnenauto mag ruimte krijgen, buitenauto laat één autobreedte.');
svg += `<path d="M-70,620 C380,620 625,530 748,392 C843,286 970,245 1665,260" fill="none" stroke="#111827" stroke-width="410" stroke-linecap="round"/>
<path d="M-70,620 C380,620 625,530 748,392 C843,286 970,245 1665,260" fill="none" stroke="url(#asphalt)" stroke-width="360" stroke-linecap="round"/>
<path d="M600,534 C690,492 736,438 780,370" fill="none" stroke="url(#kerb)" stroke-width="34" stroke-linecap="round"/>
<path d="M620,600 C730,550 790,485 842,398" stroke="#f8fafc" stroke-width="6" stroke-dasharray="26 20" opacity=".75"/>
<text x="590" y="268" font-size="26" font-weight="900" font-family="Arial" fill="#fde68a">turn-in punt</text>
${straightArrow(272,520,575,500,'#38bdf8',11)} ${straightArrow(290,642,605,610,'#f97316',11)}
${car('blue',428,500,0,'#2563eb','BLAUW binnen')} ${car('orange',416,626,0,'#f97316','ORANJE buiten')}
<path d="M585,420 L585,704" stroke="#fef08a" stroke-width="7" stroke-dasharray="16 14"/>
${labelBox(982,520,'Race-oog check','Overlap al vóór insturen = samen door de bocht')}` + close(); diagrams.push(['01-overlap-voor-turn-in', svg]);

// 2 - Apex
svg = base('2. Apex: ruimte laten aan de binnenkant', 'Bij side-by-side moet de buitenauto niet naar de apex knijpen.');
svg += `<path d="M-60,665 C250,615 475,565 590,405 C690,265 850,228 1660,245" fill="none" stroke="#111827" stroke-width="430" stroke-linecap="round"/>
<path d="M-60,665 C250,615 475,565 590,405 C690,265 850,228 1660,245" fill="none" stroke="url(#asphalt)" stroke-width="380" stroke-linecap="round"/>
<path d="M542,496 C600,388 666,330 779,286" stroke="url(#kerb)" stroke-width="44" fill="none" stroke-linecap="round"/>
<circle cx="638" cy="360" r="22" fill="#fde047" stroke="#111827" stroke-width="5"/><text x="676" y="370" font-size="28" font-weight="900" font-family="Arial" fill="#fde047">APEX</text>
<path d="M690,520 C760,463 820,420 934,392" stroke="#22c55e" stroke-width="58" fill="none" opacity=".42"/>
<text x="785" y="486" font-size="28" font-weight="900" font-family="Arial" fill="#bbf7d0">één auto ruimte</text>
${car('blue',675,445,-26,'#2563eb','BLAUW')} ${car('orange',735,550,-17,'#f97316','ORANJE')}
${arrow(470,660,640,475,'#38bdf8',10)} ${arrow(525,725,738,573,'#f97316',10)}
${labelBox(1000,555,'Duidelijk foutbeeld','Buitenauto mag de binnenlijn niet sluiten')}` + close(); diagrams.push(['02-apex-ruimte-binnenkant', svg]);

// 3 - Exit
svg = base('3. Exit: ruimte laten aan de buitenkant', 'Binnenauto mag bij uitkomen niet volledig naar buiten wassen als er nog overlap is.');
svg += `<path d="M-50,665 C300,620 480,560 600,430 C705,315 900,300 1660,455" fill="none" stroke="#111827" stroke-width="430" stroke-linecap="round"/>
<path d="M-50,665 C300,620 480,560 600,430 C705,315 900,300 1660,455" fill="none" stroke="url(#asphalt)" stroke-width="380" stroke-linecap="round"/>
<path d="M1050,315 C1210,334 1370,390 1540,455" stroke="url(#kerb)" stroke-width="42" fill="none" stroke-linecap="round"/>
<path d="M1080,535 C1240,565 1380,615 1540,688" stroke="#22c55e" stroke-width="62" fill="none" opacity=".42"/>
<text x="1160" y="642" font-size="29" font-weight="900" font-family="Arial" fill="#bbf7d0">buitenlijn blijft open</text>
${car('blue',1010,430,8,'#2563eb','BLAUW binnen')} ${car('orange',1060,565,11,'#f97316','ORANJE buiten')}
${straightArrow(780,410,1230,458,'#38bdf8',10)} ${straightArrow(790,548,1250,602,'#f97316',10)}
<path d="M1045,488 C1180,500 1300,546 1440,606" stroke="#ef4444" stroke-width="9" stroke-dasharray="18 14" fill="none"/>
<text x="1178" y="505" font-size="25" font-weight="900" font-family="Arial" fill="#fecaca">niet helemaal uitwaaieren</text>
${labelBox(58,150,'Race-oog check','Zit er nog overlap op exit? Laat asfalt over.')}` + close(); diagrams.push(['03-exit-ruimte-buitenkant', svg]);

// 4 - Verdedigen
svg = base('4. Verdedigen op het rechte stuk', 'Eén duidelijke verdedigende move; niet terug bewegen in de remzone.');
svg += `<rect x="-40" y="250" width="1680" height="430" rx="60" fill="#111827"/><rect x="-40" y="275" width="1680" height="380" rx="48" fill="url(#asphalt)"/>
<line x1="40" y1="465" x2="1560" y2="465" stroke="#f8fafc" stroke-width="6" stroke-dasharray="36 28" opacity=".8"/>
<path d="M960 286 L960 652" stroke="#fde047" stroke-width="7" stroke-dasharray="22 18"/><text x="985" y="318" font-size="28" font-weight="900" font-family="Arial" fill="#fde047">remzone</text>
${car('blue',600,390,0,'#2563eb','BLAUW verdedigt')} ${car('orange',365,520,0,'#f97316','ORANJE valt aan')}
${straightArrow(205,390,760,390,'#38bdf8',11)} ${straightArrow(205,520,920,520,'#f97316',11)}
<path d="M690,390 C780,420 840,465 905,520" stroke="#22c55e" stroke-width="12" fill="none" marker-end="url(#arrow-22c55e)"/>
<path d="M1080,390 C1140,430 1165,490 1200,545" stroke="#ef4444" stroke-width="12" stroke-dasharray="20 16" fill="none" marker-end="url(#arrow-ef4444)"/>
<text x="705" y="340" font-size="28" font-weight="900" font-family="Arial" fill="#bbf7d0">1 move OK</text><text x="1065" y="370" font-size="28" font-weight="900" font-family="Arial" fill="#fecaca">late move fout</text>
${labelBox(935,700,'Duidelijk voor stewards','Kies je lijn vóór de remzone en houd die lijn')}` + close(); diagrams.push(['04-verdedigen-een-move', svg]);

// 5 - Rejoin
svg = base('5. Unsafe rejoin na uitstap', 'Auto buiten de baan moet parallel terugkomen en verkeer voorrang geven.');
svg += `<path d="M-80,540 C330,510 600,470 930,438 C1150,416 1370,415 1680,440" fill="none" stroke="#111827" stroke-width="360" stroke-linecap="round"/>
<path d="M-80,540 C330,510 600,470 930,438 C1150,416 1370,415 1680,440" fill="none" stroke="url(#asphalt)" stroke-width="315" stroke-linecap="round"/>
<path d="M-50,338 C360,314 660,292 990,272 C1250,257 1450,260 1650,276" stroke="url(#kerb)" stroke-width="38" fill="none"/>
<rect x="0" y="60" width="1600" height="218" fill="#b08a42" opacity=".95"/><text x="65" y="136" font-size="34" font-weight="900" font-family="Arial" fill="#2b1702">grind / gras buiten de baan</text>
${car('blue',800,425,0,'#2563eb','BLAUW verkeer')} ${car('orange',620,175,8,'#f97316','ORANJE rejoin')}
${straightArrow(520,425,1140,425,'#38bdf8',11)}
<path d="M670,205 C760,265 770,335 830,425" stroke="#ef4444" stroke-width="14" fill="none" marker-end="url(#arrow-ef4444)"/><text x="780" y="265" font-size="30" font-weight="900" font-family="Arial" fill="#fecaca">fout: haaks de racelijn op</text>
<path d="M530,238 C760,286 995,306 1240,315" stroke="#22c55e" stroke-width="12" fill="none" stroke-dasharray="24 18" marker-end="url(#arrow-22c55e)"/><text x="930" y="245" font-size="30" font-weight="900" font-family="Arial" fill="#bbf7d0">goed: eerst snelheid parallel</text>
${labelBox(1015,560,'Race-oog check','Rejoin mag niemand laten liften of uitwijken')}` + close(); diagrams.push(['05-unsafe-rejoin', svg]);

// 6 - Track limits
svg = base('6. Track limits: binnen witte lijnen', 'Kerbs mogen, maar vier wielen buiten de witte lijn is track-limit.');
svg += `<path d="M-50,635 C280,578 450,510 560,380 C675,245 858,230 1650,255" fill="none" stroke="#111827" stroke-width="420" stroke-linecap="round"/>
<path d="M-50,635 C280,578 450,510 560,380 C675,245 858,230 1650,255" fill="none" stroke="url(#asphalt)" stroke-width="370" stroke-linecap="round"/>
<path d="M560,480 C650,380 745,328 895,304" stroke="#fff" stroke-width="8" fill="none"/><path d="M520,528 C632,420 735,360 914,342" stroke="url(#kerb)" stroke-width="36" fill="none"/>
<path d="M455,595 C610,450 735,392 945,378" stroke="#22c55e" stroke-width="10" fill="none"/><path d="M400,630 C610,492 775,455 1020,455" stroke="#ef4444" stroke-width="10" stroke-dasharray="22 16" fill="none"/>
${car('blue',710,406,-20,'#2563eb','OK')} ${car('orange',772,518,-12,'#f97316','FOUT')}
<text x="910" y="388" font-size="29" font-weight="900" font-family="Arial" fill="#bbf7d0">minstens deel banden binnen wit</text>
<text x="980" y="500" font-size="29" font-weight="900" font-family="Arial" fill="#fecaca">4 wielen buiten lijn</text>
${labelBox(80,140,'Duidelijk beeld','Witte lijn is grens; kerb is geen extra baan')}` + close(); diagrams.push(['06-track-limits', svg]);

// 7 - Remzone
svg = base('7. Remzone: achterop rijden voorkomen', 'Aanvallende auto moet rempunt aanpassen als hij in de slipstream zit.');
svg += `<rect x="-40" y="225" width="1680" height="470" rx="65" fill="#111827"/><rect x="-40" y="250" width="1680" height="420" rx="52" fill="url(#asphalt)"/>
<line x1="90" y1="460" x2="1510" y2="460" stroke="#f8fafc" stroke-width="6" stroke-dasharray="38 30" opacity=".75"/>
<rect x="920" y="250" width="360" height="420" fill="#991b1b" opacity=".22"/><text x="955" y="306" font-size="32" font-weight="950" font-family="Arial" fill="#fecaca">remzone</text>
${car('blue',880,388,0,'#2563eb','VOORLIGGER')} ${car('orange',650,388,0,'#f97316','AANVALLER')}
${straightArrow(360,388,805,388,'#38bdf8',10)} ${straightArrow(330,388,910,388,'#f97316',10,true)}
<path d="M725,470 C780,515 850,520 915,470" stroke="#ef4444" stroke-width="12" fill="none" marker-end="url(#arrow-ef4444)"/><text x="610" y="560" font-size="30" font-weight="900" font-family="Arial" fill="#fecaca">te laat remmen = tik achterop</text>
<path d="M520,545 C660,625 840,625 1030,548" stroke="#22c55e" stroke-width="12" fill="none" stroke-dasharray="22 16" marker-end="url(#arrow-22c55e)"/><text x="1035" y="590" font-size="28" font-weight="900" font-family="Arial" fill="#bbf7d0">eerder liften/remmen</text>
${labelBox(950,705,'Race-oog check','Kun je de auto vóór je niet missen? Dan is jouw rempunt te laat.')}` + close(); diagrams.push(['07-remzone-achterop', svg]);

// 8 - Blue flags
svg = base('8. Blauwe vlag / lappen', 'Gepasseerde auto blijft voorspelbaar; snellere auto kiest veilig voorbij.');
svg += `<path d="M-60,600 C260,555 440,545 650,520 C900,490 1130,395 1660,380" fill="none" stroke="#111827" stroke-width="390" stroke-linecap="round"/>
<path d="M-60,600 C260,555 440,545 650,520 C900,490 1130,395 1660,380" fill="none" stroke="url(#asphalt)" stroke-width="342" stroke-linecap="round"/>
<line x1="100" y1="548" x2="1480" y2="412" stroke="#f8fafc" stroke-width="6" stroke-dasharray="34 28" opacity=".7"/>
${car('blue',720,520,-6,'#2563eb','GELAPT')} ${car('orange',500,405,-6,'#f97316','SNELLER')}
${straightArrow(330,520,1080,460,'#38bdf8',10)} ${straightArrow(240,405,1045,355,'#f97316',10)}
<path d="M710,520 C790,590 925,600 1060,535" stroke="#ef4444" stroke-width="12" fill="none" stroke-dasharray="20 16" marker-end="url(#arrow-ef4444)"/><text x="885" y="615" font-size="29" font-weight="900" font-family="Arial" fill="#fecaca">niet plots van lijn</text>
<path d="M760,430 C900,405 1020,382 1145,360" stroke="#22c55e" stroke-width="12" fill="none" marker-end="url(#arrow-22c55e)"/><text x="870" y="330" font-size="29" font-weight="900" font-family="Arial" fill="#bbf7d0">voorspelbaar voorbij</text>
${labelBox(70,140,'Duidelijk voor coureurs','Geen paniekmove; snelheidverschil oplossen met voorspelbare lijnen')}` + close(); diagrams.push(['08-blauwe-vlag-lappen', svg]);

// ─── NEW DIAGRAMS for v1.7 ──────────────────────────────────────────

// 9 - Divebomb vs legitiem
svg = base('9. Divebomb: legale remactie vs divebomb', 'Linkerpaneel: gecontroleerd, bocht haalbaar. Rechterpaneel: te optimistisch, mist apex.');
svg += `<rect x="-40" y="225" width="1680" height="470" rx="65" fill="#111827"/><rect x="-40" y="250" width="1680" height="420" rx="52" fill="url(#asphalt)"/>
<line x1="90" y1="460" x2="400" y2="460" stroke="#f8fafc" stroke-width="6" stroke-dasharray="38 30" opacity=".75"/>
<line x1="1200" y1="460" x2="1510" y2="460" stroke="#f8fafc" stroke-width="6" stroke-dasharray="38 30" opacity=".75"/>
<line x1="800" y1="250" x2="800" y2="670" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<text x="140" y="350" font-size="30" font-weight="950" font-family="Arial" fill="#22c55e">GOED</text><text x="1060" y="350" font-size="30" font-weight="950" font-family="Arial" fill="#ef4444">FOUT</text>
<rect x="200" y="250" width="180" height="420" fill="#15803d" opacity=".18"/><rect x="1220" y="250" width="180" height="420" fill="#991b1b" opacity=".22"/>
<text x="210" y="306" font-size="24" font-weight="900" font-family="Arial" fill="#bbf7d0">tijdig remmen</text>
<text x="1230" y="306" font-size="24" font-weight="900" font-family="Arial" fill="#fecaca">te laat remmen</text>
${car('blue',500,410,0,'#2563eb','VOOR','')} ${car('orange',310,410,0,'#f97316','AANVALLER','')}
${car('blue',500,410,0,'#2563eb','VOOR','')} ${car('orange',1140,410,0,'#f97316','AANVALLER','')}
${straightArrow(100,410,290,410,'#22c55e',10)} ${straightArrow(100,410,1120,410,'#ef4444',12)}
${labelBox(100,670,'Divebomb','Rempunt gehaald, controle over de auto, bocht haalbaar zonder hulp van de tegenstander.','#0f172a',500)}
${labelBox(900,670,'Divebomb','Komt van te ver achter, mist rempunt, gebruikt tegenstander als vangrail.','#0f172a',600)}` + close(); diagrams.push(['09-divebomb-vs-legitiem', svg]);

// 10 - Blocking / reactief verdedigen
svg = base('10. Blocking: één lijn vs reactief bewegen', 'Links: vaste lijn voor de remzone. Rechts: reactief mee bewegen met de aanvaller.');
svg += `<rect x="-40" y="225" width="1680" height="470" rx="65" fill="#111827"/><rect x="-40" y="250" width="1680" height="420" rx="52" fill="url(#asphalt)"/>
<line x1="90" y1="460" x2="400" y2="460" stroke="#f8fafc" stroke-width="6" stroke-dasharray="38 30" opacity=".75"/>
<line x1="1200" y1="460" x2="1510" y2="460" stroke="#f8fafc" stroke-width="6" stroke-dasharray="38 30" opacity=".75"/>
<line x1="800" y1="250" x2="800" y2="670" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<text x="160" y="330" font-size="30" font-weight="950" font-family="Arial" fill="#22c55e">CORRECT</text><text x="1040" y="330" font-size="30" font-weight="950" font-family="Arial" fill="#ef4444">BLOKKEN</text>
${car('blue',400,360,0,'#2563eb','VERDEDIGT','')} ${car('orange',180,520,0,'#f97316','VALT AAN','')}
${car('orange',1080,380,0,'#f97316','VALT AAN','')} ${car('blue',1040,360,0,'#2563eb','BLOKKERT','')}
${straightArrow(60,360,360,360,'#22c55e',8)} ${straightArrow(60,520,340,520,'#f97316',8)}
${straightArrow(950,380,1060,380,'#f97316',8)} ${straightArrow(950,520,1360,500,'#f97316',8,true)}
<path d="M1060,380 C1120,430 1180,460 1250,500" stroke="#ef4444" stroke-width="12" fill="none" marker-end="url(#arrow-ef4444)"/>
<text x="1160" y="420" font-size="26" font-weight="900" font-family="Arial" fill="#fecaca">mee</text><text x="1150" y="448" font-size="26" font-weight="900" font-family="Arial" fill="#fecaca">bewegen</text>
<path d="M480,520 C500,560 540,580 600,600" stroke="#22c55e" stroke-width="12" fill="none" marker-end="url(#arrow-22c55e)"/>
<text x="510" y="580" font-size="26" font-weight="900" font-family="Arial" fill="#bbf7d0">vaste lijn</text>
${labelBox(100,670,'Duidelijk','Verdedigen = lijn kiezen voordat de aanvaller een kant kiest. Blokken = reageren op de aanvalslijn.','#0f172a',620)}` + close(); diagrams.push(['10-blocking-reactief', svg]);

// 11 - Blue flag incorrect
svg = base('11. Blauwe vlag: correct vs onveilig', 'Links: snellere passeert veilig, achterblijver voorspelbaar. Rechts: achterblijver verdedigt of reageert paniekerig.');
svg += `<path d="M-60,620 C280,578 450,545 650,520 C900,490 1130,395 1660,380" fill="none" stroke="#111827" stroke-width="390" stroke-linecap="round"/>
<path d="M-60,620 C280,578 450,545 650,520 C900,490 1130,395 1660,380" fill="none" stroke="url(#asphalt)" stroke-width="342" stroke-linecap="round"/>
<line x1="100" y1="548" x2="1480" y2="412" stroke="#f8fafc" stroke-width="6" stroke-dasharray="34 28" opacity=".7"/>
<line x1="800" y1="230" x2="800" y2="700" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<text x="150" y="305" font-size="34" font-weight="950" font-family="Arial" fill="#22c55e">CORRECT</text><text x="1070" y="305" font-size="34" font-weight="950" font-family="Arial" fill="#ef4444">FOUT</text>
${car('blue',400,530,-6,'#2563eb','GELAPT','')} ${car('orange',210,390,-6,'#f97316','SNELLER','')}
${car('orange',1290,390,0,'#f97316','SNELLER','')} ${car('blue',1170,530,0,'#2563eb','GELAPT','')}
${straightArrow(40,530,380,530,'#38bdf8',8)} ${straightArrow(40,390,380,390,'#f97316',8)}
${straightArrow(1080,530,1150,530,'#38bdf8',8)} ${straightArrow(1080,390,1270,390,'#f97316',8)}
<path d="M1170,530 C1200,580 1240,610 1290,610" stroke="#ef4444" stroke-width="10" fill="none" stroke-dasharray="18 14" marker-end="url(#arrow-ef4444)"/>
<text x="1220" y="600" font-size="26" font-weight="900" font-family="Arial" fill="#fecaca">blijft verdedigen</text>
${labelBox(60,670,'Wat voegt dit diagram toe?','Blauwe vlag betekent niet dat je abrupt moet remmen, van de baan moet of moet verdedigen. Blijf voorspelbaar.','#0f172a',560)}` + close(); diagrams.push(['11-blue-flag-fout', svg]);

for (const [name, content] of diagrams) await finish(name, content);
console.log(`Generated ${diagrams.length} diagrams in ${outDir}`);
