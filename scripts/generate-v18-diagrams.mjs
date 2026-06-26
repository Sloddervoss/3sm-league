import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.resolve('public/racecraft-diagrams');
await fs.mkdir(outDir, { recursive: true });

const W=1600,H=900; const C={b:'#2563eb',o:'#f97316',g:'#22c55e',r:'#ef4444',w:'#fff',s:'#cbd5e1'};
function car(x,y,angle,color,label){return `<g transform="translate(${x} ${y}) rotate(${angle})"><ellipse cx="0" cy="0" rx="74" ry="34" fill="#05070b" opacity="0.38" transform="translate(8 10)"/><rect x="-86" y="-37" width="172" height="74" rx="20" fill="${color}" stroke="${C.w}" stroke-width="4"/><path d="M-58,-28 L-20,-36 L42,-31 L72,-16 L80,0 L72,16 L42,31 L-20,36 L-58,28 L-80,12 L-84,0 L-80,-12 Z" fill="${color}" stroke="#0f172a" stroke-width="3"/><rect x="-27" y="-25" width="58" height="50" rx="11" fill="#dbeafe" opacity="0.9" stroke="#1e293b" stroke-width="2"/><rect x="-77" y="-42" width="38" height="9" rx="4" fill="#0f172a"/><rect x="39" y="-42" width="38" height="9" rx="4" fill="#0f172a"/><rect x="-77" y="33" width="38" height="9" rx="4" fill="#0f172a"/><rect x="39" y="33" width="38" height="9" rx="4" fill="#0f172a"/><circle cx="-63" cy="-19" r="6" fill="#fde68a"/><circle cx="-63" cy="19" r="6" fill="#fde68a"/><g transform="rotate(${-angle}) translate(0 76)"><rect x="-62" y="-22" width="170" height="36" rx="9" fill="#020617" opacity="0.84" stroke="#fff" stroke-width="2"/><text x="0" y="3" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#fff">${label}</text></g></g>`;}
function tx(x,y,s,sz,cl='#fff',w=''){return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" font-weight="900" fill="${cl}" ${w?'text-anchor="'+w+'"':''}>${s}</text>`;}
function rect(x,y,w,h,r,cl){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${cl}"/>`;}
function arrow(x1,y1,x2,y2,c,w){return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w||10}" stroke-linecap="round" marker-end="url(#a-${c.replace('#','')})"/>`;}
function curb(w,h,x,y){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#krb)"/>`;}
function finish(n,s){ return fs.writeFile(path.join(outDir,n+'.svg'),s,'utf8').then(()=>sharp(Buffer.from(s)).png().toFile(path.join(outDir,n+'.png')));}
function svg(name,content){const t=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<marker id="a-22c55e" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#22c55e"/></marker>
<marker id="a-ef4444" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#ef4444"/></marker>
<marker id="a-38bdf8" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#38bdf8"/></marker>
<pattern id="asphalt" width="90" height="90" patternUnits="userSpaceOnUse"><rect width="90" height="90" fill="#2b3037"/><circle cx="12" cy="20" r="1.8" fill="#525a66" opacity=".55"/><circle cx="50" cy="60" r="1.4" fill="#111827" opacity=".45"/><circle cx="78" cy="18" r="1.2" fill="#64748b" opacity=".35"/><path d="M0 45H90" stroke="#3f4651" stroke-width="1" opacity=".25"/></pattern>
<pattern id="krb" width="70" height="28" patternUnits="userSpaceOnUse"><rect width="35" height="28" fill="#f8fafc"/><rect x="35" width="35" height="28" fill="#dc2626"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="#14351f"/>
<path d="M0,760 C260,690 430,740 600,800 C870,895 1160,850 1600,760 L1600,900 L0,900Z" fill="#0f2a18" opacity="0.8"/>
${content}</svg>`;return finish(name,t);}

// ═══════════════════════════════════════════════════════════════════
// DIAGRAM 12 — DIVEBOMB (proper corner-based, side-by-side)
// ═══════════════════════════════════════════════════════════════════
const d12 = `
<text x="60" y="68" font-family="Arial,sans-serif" font-size="38" font-weight="950" fill="#fff">12. Divebomb: legale aanval vs divebomb</text>
<text x="62" y="110" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#cbd5e1">Linkerpaneel: tijdige overlap, controle, apex haalbaar. Rechterpaneel: te ver achter, mist apex, gebruikt ander als vangrail.</text>
<line x1="800" y1="135" x2="800" y2="800" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<!-- LEFT: LEGAL -->
<text x="340" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#22c55e" text-anchor="middle">LEGAAL</text>
<text x="340" y="175" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#bbf7d0" text-anchor="middle">tijdige overlap, controle</text>
<path d="M60,740 C180,700 260,620 310,510 C340,440 340,370 310,310" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M60,740 C180,700 260,620 310,510 C340,440 340,370 310,310" fill="none" stroke="url(#asphalt)" stroke-width="295" stroke-linecap="round"/>
<path d="M240,660 C310,540 340,460 340,380" fill="none" stroke="url(#krb)" stroke-width="32" stroke-linecap="round"/>
<path d="M275,660 C350,540 380,460 380,380" stroke="#fff" stroke-width="5" stroke-dasharray="24 20"/>
<circle cx="310" cy="410" r="16" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="332" y="416" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#fde047">APEX</text>
<text x="130" y="350" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fde68a">rempunt</text>
<!-- Car A (attacker, inside, blue) has overlap before turn-in -->
${car(230,600,-22,'#2563eb','AANVALLER')}
<!-- Car B (defender, outside, orange) -->
${car(100,700,0,'#f97316','VERDEDIGER')}
<path d="M200,685 L270,620" stroke="#38bdf8" stroke-width="8" fill="none" marker-end="url(#a-38bdf8)" opacity="0.7"/>
${tx(130,780,'✔ Tijdige overlap, eigen lijn, haalt apex','22','#bbf7d0')}
${tx(130,808,'✔ Bocht haalbaar, geeft ruimte','22','#bbf7d0')}
<!-- RIGHT: DIVEBOMB -->
<text x="1200" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#ef4444" text-anchor="middle">DIVEBOMB</text>
<text x="1200" y="175" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fecaca" text-anchor="middle">te ver achter, mist apex</text>
<path d="M850,720 C980,680 1060,610 1100,500 C1130,430 1130,360 1100,300" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M850,720 C980,680 1060,610 1100,500 C1130,430 1130,360 1100,300" fill="none" stroke="url(#asphalt)" stroke-width="295" stroke-linecap="round"/>
<path d="M1030,640 C1100,520 1130,440 1130,360" fill="none" stroke="url(#krb)" stroke-width="32" stroke-linecap="round"/>
<path d="M1065,640 C1140,520 1170,440 1170,360" stroke="#fff" stroke-width="5" stroke-dasharray="24 20"/>
<circle cx="1100" cy="400" r="16" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="1122" y="406" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#fde047">APEX</text>
<text x="910" y="340" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fecaca">mist rempunt</text>
<!-- attacker from way back -->
${car(1190,450,20,'#ef4444','AANVALLER')}
${car(880,700,0,'#2563eb','VERDEDIGER')}
<!-- attacker misses apex, goes wide toward defender -->
<path d="M1190,450 C1180,500 1160,560 1100,620" stroke="#ef4444" stroke-width="8" fill="none" stroke-dasharray="18 14"/>
<path d="M1090,680 C1080,720 1060,760 1040,790" stroke="#ef4444" stroke-width="8" fill="none" marker-end="url(#a-ef4444)"/>
<path d="M1060,700 L1060,780" stroke="#fef08a" stroke-width="6" stroke-dasharray="12 10"/>
${tx(930,780,'✗ Komt van te ver achter','22','#fecaca')}
${tx(930,808,'✗ Mist apex, gebruikt ander als vangrail','22','#fecaca')}
<!-- X-markers near missing apex -->
<line x1="1110" y1="370" x2="1130" y2="390" stroke="#ef4444" stroke-width="6"/><line x1="1130" y1="370" x2="1110" y2="390" stroke="#ef4444" stroke-width="6"/>
<!-- Bottom label box -->
<rect x="60" y="830" width="1480" height="62" rx="14" fill="#0f172a" opacity="0.93" stroke="#f97316" stroke-width="3"/>
<text x="76" y="860" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#fff">Divebomb checklist voor stewards</text>
<text x="76" y="883" font-family="Arial,sans-serif" font-size="20" font-weight="650" fill="#e2e8f0">Had de aanvaller controle?  •  Haalde hij de apex?  •  Had hij ruimte nodig van de tegenstander?  •  Kon hij de bocht zonder hulp?  </text>`;
await svg('12-divebomb-corner', d12);
console.log('12-divebomb-corner done');

// ═══════════════════════════════════════════════════════════════════
// DIAGRAM 13 — BLUE FLAG DEFENDING
// ═══════════════════════════════════════════════════════════════════
const d13 = `
<text x="60" y="68" font-family="Arial,sans-serif" font-size="38" font-weight="950" fill="#fff">13. Blauwe vlag: mag een achterblijver verdedigen?</text>
<text x="62" y="110" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#cbd5e1">Links: voorspelbaar op eigen lijn. Rechts: actief verdedigen = onnodig ophouden.</text>
<line x1="800" y1="135" x2="800" y2="800" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<!-- LEFT: CORRECT -->
<text x="340" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#22c55e" text-anchor="middle">CORRECT</text>
<path d="M60,660 C180,650 300,640 450,580 C600,520 720,440 800,380" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M60,660 C180,650 300,640 450,580 C600,520 720,440 800,380" fill="none" stroke="url(#asphalt)" stroke-width="295" stroke-linecap="round"/>
<line x1="100" y1="650" x2="700" y2="430" stroke="#f8fafc" stroke-width="6" stroke-dasharray="30 22" opacity=".6"/>
${car(360,640,-5,'#2563eb','GELAPT')}
${car(180,500,-5,'#f97316','LEIDER')}
<path d="M160,500 L340,640" stroke="#38bdf8" stroke-width="8" fill="none" marker-end="url(#a-38bdf8)" opacity="0.7"/>
${tx(140,780,'✔ Achterblijver op eigen lijn','22','#bbf7d0')}
${tx(140,808,'✔ Leider kiest veilig voorbij','22','#bbf7d0')}
<!-- RIGHT: INCORRECT -->
<text x="1200" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#ef4444" text-anchor="middle">ONNODIG VERDEDIGEN</text>
<path d="M850,660 C970,650 1090,640 1240,580 C1390,520 1510,440 1580,380" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M850,660 C970,650 1090,640 1240,580 C1390,520 1510,440 1580,380" fill="none" stroke="url(#asphalt)" stroke-width="295" stroke-linecap="round"/>
<line x1="890" y1="650" x2="1500" y2="430" stroke="#f8fafc" stroke-width="6" stroke-dasharray="30 22" opacity=".6"/>
${car(1200,645,5,'#2563eb','GELAPT')}
${car(1060,450,-3,'#f97316','LEIDER')}
<path d="M1050,450 L1250,645" stroke="#38bdf8" stroke-width="8" fill="none" opacity="0.5"/>
<!-- gelapte moves to block -->
<path d="M1250,645 C1300,640 1350,610 1400,580" stroke="#ef4444" stroke-width="8" fill="none" marker-end="url(#a-ef4444)"/>
<text x="1360" y="600" font-family="Arial,sans-serif" font-size="20" font-weight="900" fill="#fecaca">blokkeert</text>
${tx(990,780,'✗ Achterblijver verdedigt actief','22','#fecaca')}
${tx(990,808,'✗ Meerdere bochten blokkeren = ophouden','22','#fecaca')}
<rect x="60" y="830" width="1480" height="62" rx="14" fill="#0f172a" opacity="0.93" stroke="#f97316" stroke-width="3"/>
<text x="76" y="860" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#fff">Blue flag regel</text>
<text x="76" y="883" font-family="Arial,sans-serif" font-size="20" font-weight="650" fill="#e2e8f0">Een achterblijver mag zijn race rijden. Maar mag een duidelijk snellere leider niet onnodig meerdere bochten ophouden.</text>`;
await svg('13-blue-flag-defending', d13);
console.log('13-blue-flag-defending done');

// ═══════════════════════════════════════════════════════════════════
// DIAGRAM 14 — EERSTE BOCHT
// ═══════════════════════════════════════════════════════════════════
const d14 = `
<text x="60" y="68" font-family="Arial,sans-serif" font-size="38" font-weight="950" fill="#fff">14. Eerste bocht: marge vs te optimistisch</text>
<text x="62" y="110" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#cbd5e1">Koude banden, koude remmen, beperkt zicht, kettingreacties.</text>
<line x1="800" y1="135" x2="800" y2="800" stroke="#334155" stroke-width="5" stroke-dasharray="20 32"/>
<!-- LEFT: GOOD -->
<text x="340" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#22c55e" text-anchor="middle">MARGE NEMEN</text>
<path d="M60,750 C180,710 260,650 320,540 C380,430 420,340 450,260" fill="none" stroke="#111827" stroke-width="360" stroke-linecap="round"/>
<path d="M60,750 C180,710 260,650 320,540 C380,430 420,340 450,260" fill="none" stroke="url(#asphalt)" stroke-width="315" stroke-linecap="round"/>
<path d="M250,660 C370,510 400,420 420,330" fill="none" stroke="url(#krb)" stroke-width="34" stroke-linecap="round"/>
<circle cx="372" cy="460" r="16" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="394" y="466" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#fde047">APEX</text>
${car(250,690,-18,'#2563eb','BLAUW')}
${car(130,735,-8,'#f97316','ORANJE')}
${car(370,540,5,'#22c55e','GROEN')}
${tx(160,795,'✔ Ruimte, marge, overzicht','22','#bbf7d0')}
<text x="160" y="820" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#bbf7d0">Iedereen overleeft bocht 1</text>
<!-- RIGHT: BAD -->
<text x="1200" y="150" font-family="Arial,sans-serif" font-size="30" font-weight="950" fill="#ef4444" text-anchor="middle">WIN-OR-DIE</text>
<path d="M850,730 C970,690 1050,630 1110,520 C1170,410 1210,320 1240,240" fill="none" stroke="#111827" stroke-width="360" stroke-linecap="round"/>
<path d="M850,730 C970,690 1050,630 1110,520 C1170,410 1210,320 1240,240" fill="none" stroke="url(#asphalt)" stroke-width="315" stroke-linecap="round"/>
<path d="M1040,640 C1160,490 1190,400 1210,310" fill="none" stroke="url(#krb)" stroke-width="34" stroke-linecap="round"/>
${car(1030,680,-22,'#2563eb','BLAUW')}
${car(870,740,-8,'#f97316','ORANJE')}
${car(960,530,2,'#22c55e','GROEN')}
<!-- three wide -->
<line x1="1020" y1="535" x2="960" y2="530" stroke="#fef08a" stroke-width="5" stroke-dasharray="10 8"/>
<line x1="1030" y1="685" x2="960" y2="530" stroke="#fef08a" stroke-width="5" stroke-dasharray="10 8"/>
${tx(990,795,'✗ Drie auto\u2019s breed zonder ruimte','22','#fecaca')}
${tx(990,820,'✗ Kettingreactie: iedereen verliest','22','#fecaca')}
<rect x="60" y="835" width="1480" height="58" rx="14" fill="#0f172a" opacity="0.93" stroke="#f97316" stroke-width="3"/>
<text x="76" y="862" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#fff">Vuistregel voor bocht 1</text>
<text x="76" y="885" font-family="Arial,sans-serif" font-size="20" font-weight="650" fill="#e2e8f0">De eerste ronde vraagt niet om minder racecraft, maar om meer marge. Je wint zelden een race in bocht 1, maar je kunt er wel meerdere verpesten.</text>`;
await svg('14-eerste-bocht', d14);
console.log('14-eerste-bocht done');

// Remove old 09-divebomb-vs-legitiem
try { await fs.unlink(path.join(outDir,'09-divebomb-vs-legitiem.svg')); await fs.unlink(path.join(outDir,'09-divebomb-vs-legitiem.png')); console.log('removed old 09'); } catch(e) {}

console.log('All new diagrams generated');