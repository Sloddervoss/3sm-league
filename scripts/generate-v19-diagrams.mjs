import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.resolve('public/racecraft-diagrams');
await fs.mkdir(outDir, { recursive: true });

const W=1600,H=900;
function car(x,y,angle,color,label){return `<g transform="translate(${x} ${y}) rotate(${angle})"><ellipse cx="0" cy="0" rx="74" ry="34" fill="#05070b" opacity="0.38" transform="translate(8 10)"/><rect x="-86" y="-37" width="172" height="74" rx="20" fill="${color}" stroke="#fff" stroke-width="3"/><path d="M-58,-28 L-20,-36 L42,-31 L72,-16 L80,0 L72,16 L42,31 L-20,36 L-58,28 L-80,12 L-84,0 L-80,-12Z" fill="${color}" stroke="#0f172a" stroke-width="3"/><rect x="-27" y="-25" width="58" height="50" rx="11" fill="#dbeafe" opacity="0.9" stroke="#1e293b" stroke-width="2"/><rect x="-77" y="-42" width="38" height="9" rx="4" fill="#0f172a"/><rect x="39" y="-42" width="38" height="9" rx="4" fill="#0f172a"/><rect x="-77" y="33" width="38" height="9" rx="4" fill="#0f172a"/><rect x="39" y="33" width="38" height="9" rx="4" fill="#0f172a"/><circle cx="-63" cy="-19" r="6" fill="#fde68a"/><circle cx="-63" cy="19" r="6" fill="#fde68a"/><g transform="rotate(${-angle}) translate(0 76)"><rect x="-62" y="-22" width="170" height="36" rx="9" fill="#020617" opacity="0.84" stroke="#fff" stroke-width="2"/><text x="0" y="3" text-anchor="middle" font-family="Arial,Inter,sans-serif" font-size="22" font-weight="800" fill="#fff">${label}</text></g></g>`;}
function svg(name,content){const t=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<marker id="ag" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#22c55e"/></marker>
<marker id="ar" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#ef4444"/></marker>
<marker id="ab" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#38bdf8"/></marker>
<pattern id="a" width="90" height="90" patternUnits="userSpaceOnUse"><rect width="90" height="90" fill="#2b3037"/><circle cx="12" cy="20" r="1.8" fill="#525a66" opacity=".55"/><circle cx="50" cy="60" r="1.4" fill="#111827" opacity=".45"/><circle cx="78" cy="18" r="1.2" fill="#64748b" opacity=".35"/><path d="M0 45H90" stroke="#3f4651" stroke-width="1" opacity=".25"/></pattern>
<pattern id="k" width="70" height="28" patternUnits="userSpaceOnUse"><rect width="35" height="28" fill="#f8fafc"/><rect x="35" width="35" height="28" fill="#dc2626"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="#14351f"/>
<path d="M0,760 C260,690 430,740 600,800 C870,895 1160,850 1600,760 L1600,900 L0,900Z" fill="#0f2a18" opacity="0.8"/>
${content}</svg>`;return fs.writeFile(path.join(outDir,name+'.svg'),t,'utf8').then(()=>sharp(Buffer.from(t)).png().toFile(path.join(outDir,name+'.png')));}

// ═══════════════════════════════════════════════════════════════════════
// NEW DIVEBOMB — cleaner, bigger labels, 3-second understanding
// ═══════════════════════════════════════════════════════════════════════
const d_dive = `
<text x="60" y="62" font-family="Arial,Inter,sans-serif" font-size="36" font-weight="950" fill="#fff">Divebomb: legale aanval vs divebomb</text>
<line x1="800" y1="120" x2="800" y2="790" stroke="#334155" stroke-width="5" stroke-dasharray="20 30"/>
<!-- LEFT: LEGITIMATE -->
<rect x="36" y="120" width="12" height="170" rx="4" fill="#22c55e"/>
<text x="70" y="165" font-family="Arial,Inter,sans-serif" font-size="32" font-weight="950" fill="#22c55e">LEGITIEME AANVAL</text>
<text x="70" y="198" font-family="Arial,Inter,sans-serif" font-size="22" font-weight="700" fill="#bbf7d0">Overlap voor turn-in • Controle • Apex haalbaar • Ruimte</text>
<!-- Track -->
<path d="M40,710 C160,670 240,590 290,480 C320,410 320,340 290,280" fill="none" stroke="#111827" stroke-width="330" stroke-linecap="round"/>
<path d="M40,710 C160,670 240,590 290,480 C320,410 320,340 290,280" fill="none" stroke="url(#a)" stroke-width="285" stroke-linecap="round"/>
<path d="M220,620 C290,500 320,420 320,340" fill="none" stroke="url(#k)" stroke-width="30" stroke-linecap="round"/>
<circle cx="290" cy="400" r="18" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="318" y="406" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#fde047">APEX</text>
<circle cx="170" cy="330" r="8" fill="#f97316"/><text x="185" y="338" font-family="Arial,Inter,sans-serif" font-size="18" font-weight="700" fill="#fde68a">REMPUNT</text>
${car(200,615,-20,'#2563eb','AANVALLER')}
${car(80,705,0,'#f97316','VERDEDIGER')}
<path d="M170,680 L240,625" stroke="#38bdf8" stroke-width="7" fill="none" marker-end="url(#ab)"/>
<text x="115" y="775" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#bbf7d0">✔ Overlap, controle, apex gehaald</text>
<!-- RIGHT: DIVEBOMB -->
<rect x="840" y="120" width="12" height="170" rx="4" fill="#ef4444"/>
<text x="874" y="165" font-family="Arial,Inter,sans-serif" font-size="32" font-weight="950" fill="#ef4444">DIVEBOMB</text>
<text x="874" y="198" font-family="Arial,Inter,sans-serif" font-size="22" font-weight="700" fill="#fecaca">Te ver achter • Mist apex • Ander als vangrail</text>
<!-- Track -->
<path d="M850,690 C970,650 1050,570 1100,460 C1130,390 1130,320 1100,260" fill="none" stroke="#111827" stroke-width="330" stroke-linecap="round"/>
<path d="M850,690 C970,650 1050,570 1100,460 C1130,390 1130,320 1100,260" fill="none" stroke="url(#a)" stroke-width="285" stroke-linecap="round"/>
<path d="M1030,600 C1100,480 1130,400 1130,320" fill="none" stroke="url(#k)" stroke-width="30" stroke-linecap="round"/>
<circle cx="1100" cy="380" r="18" fill="#fde047" stroke="#111827" stroke-width="4"/><text x="1128" y="386" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#fde047">APEX</text>
<rect x="1250" y="340" width="200" height="60" rx="6" fill="#991b1b" opacity="0.4"/>
<text x="1260" y="374" font-family="Arial,Inter,sans-serif" font-size="18" font-weight="700" fill="#fecaca">✗ Mist apex</text>
${car(1180,430,22,'#ef4444','AANVALLER')}
${car(860,690,0,'#2563eb','VERDEDIGER')}
<path d="M920,680 L1150,460" stroke="#ef4444" stroke-width="7" fill="none" stroke-dasharray="18 12" marker-end="url(#ar)"/>
<text x="870" y="775" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#fecaca">✗ Alleen mogelijk als ander uitwijkt</text>
<rect x="40" y="820" width="1520" height="70" rx="12" fill="#0f172a" opacity="0.93" stroke="#f97316" stroke-width="3"/>
<text x="60" y="850" font-family="Arial,Inter,sans-serif" font-size="24" font-weight="800" fill="#fff">Checklist voor stewards</text>
<text x="60" y="878" font-family="Arial,Inter,sans-serif" font-size="20" font-weight="650" fill="#e2e8f0">Had de aanvaller overlap voor turn-in?  •  Haalde hij de apex?  •  Had hij ruimte van de ander nodig?  •  Kon hij de bocht zonder hulp?</text>`;
await svg('12-divebomb-corner-v2', d_dive);
console.log('12-divebomb-corner-v2 done');

// ═══════════════════════════════════════════════════════════════════════
// NEW REJOIN — cleaner, side-by-side, bigger labels
// ═══════════════════════════════════════════════════════════════════════
const d_rejoin = `
<text x="60" y="62" font-family="Arial,Inter,sans-serif" font-size="36" font-weight="950" fill="#fff">Rejoin: veilig invoegen vs onveilige terugkeer</text>
<line x1="800" y1="120" x2="800" y2="790" stroke="#334155" stroke-width="5" stroke-dasharray="20 30"/>
<!-- LEFT: SAFE -->
<rect x="36" y="120" width="12" height="140" rx="4" fill="#22c55e"/>
<text x="70" y="158" font-family="Arial,Inter,sans-serif" font-size="32" font-weight="950" fill="#22c55e">VEILIGE REJOIN</text>
<text x="70" y="185" font-family="Arial,Inter,sans-serif" font-size="18" font-weight="700" fill="#bbf7d0">Snelheid onder controle • Verkeer checken • Parallel invoegen</text>
<!-- Track + gravel area -->
<path d="M30,660 C150,640 280,620 450,580 C600,540 720,480 800,440" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M30,660 C150,640 280,620 450,580 C600,540 720,480 800,440" fill="none" stroke="url(#a)" stroke-width="295" stroke-linecap="round"/>
<path d="M10,390 C140,380 260,370 400,350 C530,330 650,310 780,300" fill="none" stroke="url(#k)" stroke-width="36"/>
<rect x="30" y="100" width="770" height="180" fill="#b08a42" opacity="0.90"/>
<text x="60" y="175" font-family="Arial,Inter,sans-serif" font-size="30" font-weight="900" fill="#2b1702">GRIND / GRAS — BUITEN DE BAAN</text>
<text x="60" y="210" font-family="Arial,Inter,sans-serif" font-size="20" font-weight="700" fill="#4a2d08">Eerst snelheid parallel • Dan pas invoegen</text>
${car(200,170,2,'#f97316','REJOIN')}
${car(560,600,0,'#2563eb','VERKEER')}
<path d="M340,600 L670,600" stroke="#38bdf8" stroke-width="7" fill="none" marker-end="url(#ab)"/>
<path d="M260,220 C380,260 480,330 540,480" stroke="#22c55e" stroke-width="8" fill="none" stroke-dasharray="24 16" marker-end="url(#ag)"/>
<text x="370" y="430" font-family="Arial,Inter,sans-serif" font-size="22" font-weight="900" fill="#bbf7d0">Goed: parallel, checkt verkeer</text>
<text x="130" y="790" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#bbf7d0">✔ Snelheid gecontroleerd, verkeer voorrang, veilig ingevoegd</text>
<!-- RIGHT: UNSAFE -->
<rect x="840" y="120" width="12" height="140" rx="4" fill="#ef4444"/>
<text x="874" y="158" font-family="Arial,Inter,sans-serif" font-size="32" font-weight="950" fill="#ef4444">ONVEILIGE REJOIN</text>
<text x="874" y="185" font-family="Arial,Inter,sans-serif" font-size="18" font-weight="700" fill="#fecaca">Haaks de baan op • Verkeer moet remmen of uitwijken</text>
<path d="M830,660 C950,640 1080,620 1250,580 C1400,540 1520,480 1580,440" fill="none" stroke="#111827" stroke-width="340" stroke-linecap="round"/>
<path d="M830,660 C950,640 1080,620 1250,580 C1400,540 1520,480 1580,440" fill="none" stroke="url(#a)" stroke-width="295" stroke-linecap="round"/>
<path d="M810,390 C940,380 1060,370 1200,350 C1330,330 1450,310 1580,300" fill="none" stroke="url(#k)" stroke-width="36"/>
<rect x="830" y="100" width="770" height="180" fill="#b08a42" opacity="0.90"/>
<text x="860" y="175" font-family="Arial,Inter,sans-serif" font-size="30" font-weight="900" fill="#2b1702">GRIND / GRAS — BUITEN DE BAAN</text>
<text x="860" y="210" font-family="Arial,Inter,sans-serif" font-size="20" font-weight="700" fill="#4a2d08">Haaks de baan op zonder te checken</text>
${car(1000,155,-5,'#f97316','REJOIN')}
${car(1200,600,0,'#2563eb','VERKEER')}
<path d="M1050,600 L1320,600" stroke="#f8fafc" stroke-width="6" stroke-dasharray="24 18" opacity=".6"/>
<path d="M1050,210 C1100,280 1180,380 1320,540" stroke="#ef4444" stroke-width="9" fill="none" marker-end="url(#ar)"/>
<text x="1210" y="420" font-family="Arial,Inter,sans-serif" font-size="22" font-weight="900" fill="#fecaca">Fout: haaks de racelijn op</text>
<text x="870" y="790" font-family="Arial,Inter,sans-serif" font-size="26" font-weight="900" fill="#fecaca">✗ Verkeer moet remmen of uitwijken — volledig vermijdbaar</text>
<rect x="40" y="820" width="1520" height="70" rx="12" fill="#0f172a" opacity="0.93" stroke="#f97316" stroke-width="3"/>
<text x="60" y="850" font-family="Arial,Inter,sans-serif" font-size="24" font-weight="800" fill="#fff">Belangrijk</text>
<text x="60" y="878" font-family="Arial,Inter,sans-serif" font-size="20" font-weight="650" fill="#e2e8f0">Verkeer heeft altijd voorrang. Posities verliezen is beter dan een nieuw incident veroorzaken. Wacht tot het veilig is.</text>`;
await svg('05-rejoin-v2', d_rejoin);
console.log('05-rejoin-v2 done');

// Delete old diagrams
try { await fs.unlink(path.join(outDir,'05-unsafe-rejoin.svg')); await fs.unlink(path.join(outDir,'05-unsafe-rejoin.png')); console.log('removed old 05'); } catch(e){}
try { await fs.unlink(path.join(outDir,'12-divebomb-corner.svg')); await fs.unlink(path.join(outDir,'12-divebomb-corner.png')); console.log('removed old 12'); } catch(e){}

console.log('ALL DONE');