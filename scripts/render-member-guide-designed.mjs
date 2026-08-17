import PDFDocument from 'pdfkit';
import fs from 'node:fs';

const OUT = '/home/hermes/tmp/track-scanner-redesign/3sm-track-scanner-uitleg-members-release.pdf';
const LOGO = '/home/hermes/projects/3sm-league/public/auth-templates/3sm-logo-email-v2.png';
const C = { bg:'#090d14', panel:'#111925', panel2:'#0d141f', line:'#283547', ink:'#f8fafc', muted:'#aeb8c8', orange:'#f97316', red:'#ef4444', green:'#22c55e', cream:'#fed7aa', white:'#ffffff', dark:'#10151f', blue:'#38bdf8' };
const doc = new PDFDocument({ size:'A4', margin:0, info:{ Title:'3SM Track Scanner — uitleg voor members', Author:'3 Stripe Motorsport', Subject:'Handleiding voor installatie en gebruik van de 3SM Track Scanner', Keywords:'3SM, Track Scanner, iRacing, handleiding' }, autoFirstPage:false });
const stream = fs.createWriteStream(OUT); doc.pipe(stream);
const W=595.28,H=841.89,M=43;

function bg(){
  doc.rect(0,0,W,H).fill(C.bg);
  doc.save().opacity(.12).fillColor(C.orange).circle(-20,-30,210).fill().restore();
  doc.save().opacity(.04).strokeColor('#ffffff').lineWidth(.5);
  for(let x=-500;x<900;x+=22) doc.moveTo(x,0).lineTo(x+840,H).stroke();
  doc.restore();
}
function top(kicker,title,badge){
  if(fs.existsSync(LOGO)) doc.image(LOGO,M,26,{fit:[138,46]});
  pill(W-M-108,29,108,25,badge);
  txt(kicker,M,84,9,C.orange,'bold',{characterSpacing:1.25});
  txt(title,M,101,24,C.ink,'bold',{width:W-2*M,lineGap:0});
}
function txt(s,x,y,size=10,color=C.ink,font='regular',opts={}){
  doc.font(font==='bold'?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(s,x,y,{lineGap:2,...opts});
}
function panel(x,y,w,h,fill=C.panel,stroke=C.line,r=12){ doc.roundedRect(x,y,w,h,r).fillAndStroke(fill,stroke); }
function pill(x,y,w,h,s){ doc.roundedRect(x,y,w,h,h/2).fillAndStroke('#24150d','#9a410d'); txt(s,x,y+8,7.4,C.cream,'bold',{width:w,align:'center',characterSpacing:.7}); }
function circleNum(n,x,y){ doc.circle(x+12,y+12,12).fill(C.orange); txt(String(n),x,y+5,10,'#111111','bold',{width:24,align:'center'}); }
function step(n,title,body,x,y,w){ circleNum(n,x,y); txt(title,x+34,y,10.5,C.ink,'bold',{width:w-34}); txt(body,x+34,y+16,8.7,'#cbd5e1','regular',{width:w-34,lineGap:1.5}); }
function callout(x,y,w,h,title,body,color=C.orange,fill='#1c130d'){
  doc.roundedRect(x,y,w,h,9).fillAndStroke(fill,color); doc.rect(x,y,4,h).fill(color); txt(title,x+14,y+10,9.5,color==='green'?C.green:C.cream,'bold',{width:w-24}); txt(body,x+14,y+27,8.7,'#d9e2ed','regular',{width:w-24,lineGap:1.5});
}
function verify(x,y,w,s){ doc.roundedRect(x,y,w,33,9).fillAndStroke('#081b12','#176c39'); doc.circle(x+17,y+16.5,10).fill(C.green); txt('OK',x+7,y+11,6.5,'#07150b','bold',{width:20,align:'center'}); txt(s,x+34,y+9,8.7,'#d0ffe0','bold',{width:w-44}); }
function footer(n,label){ doc.moveTo(M,H-37).lineTo(W-M,H-37).strokeColor('#202b3b').lineWidth(.7).stroke(); txt(label,M,H-27,7.5,'#8894a6'); txt(`${n} / 5`,W-M-45,H-27,8,C.cream,'bold',{width:45,align:'right'}); }
function button(x,y,w,label,primary=true){ doc.roundedRect(x,y,w,25,5).fill(primary?C.orange:'#29292d'); txt(label,x,y+8,7.5,C.white,'bold',{width:w,align:'center',characterSpacing:.2}); }
function scanner(x,y,w,h,result=false){
  doc.roundedRect(x,y,w,h,11).fillAndStroke('#09090b','#3f4756');
  doc.rect(x,y,w,23).fill('#151519'); txt('3 Stripe Track Scanner',x+10,y+8,6.5,'#a1a1aa');
  txt('3 STRIPE MOTORSPORT',x+12,y+35,6.5,C.orange,'bold',{characterSpacing:1}); txt('TRACK SCANNER',x+12,y+46,15,C.white,'bold');
  if(!result){
    txt('Open de iRacing tracks pagina om je tracks te scannen.',x+12,y+68,7.8,'#a1a1aa',{width:w-24});
    button(x+12,y+94,w-24,'OPEN iRACING TRACKS PAGINA'); button(x+12,y+124,w-24,'OPEN SCANNER IN VASTE TAB',false);
    txt('Of scan de huidige pagina als de tracks al zichtbaar zijn.',x+12,y+159,7.3,'#7c7c86',{width:w-24}); button(x+12,y+186,w-24,'SCAN HUIDIGE PAGINA',false);
  } else {
    const sy=y+72, gap=5, sw=(w-24-gap*2)/3;
    [['75','TRACKS GEVONDEN'],['534134','iRACING ID'],['Vincent','INGELOGD ALS']].forEach((a,i)=>{ const sx=x+12+i*(sw+gap); doc.roundedRect(sx,sy,sw,48,5).fillAndStroke('#18181b','#303036'); txt(a[0],sx+6,sy+8,i===2?10:14,C.white,'bold',{width:sw-12}); txt(a[1],sx+6,sy+31,5.4,'#a1a1aa','bold',{width:sw-12,characterSpacing:.4}); });
    button(x+12,y+128,(w-29)/2,'UPLOAD NAAR 3 STRIPE'); button(x+17+(w-29)/2,y+128,(w-29)/2,'KOPIEER EXPORT',false);
    txt('BEKIJK EXPORT DATA',x+12,y+163,7.4,'#a1a1aa','bold');
    doc.roundedRect(x+12,y+185,w-24,31,5).fillAndStroke('#073d20','#168045'); txt('GELUKT · 75 tracks opgeslagen/bijgewerkt voor jouw profiel.',x+20,y+196,7.5,'#c6f6d5','bold',{width:w-40});
  }
}
function browserMock(x,y,w,h){
  doc.roundedRect(x,y,w,h,11).fillAndStroke('#f7f8fa','#415067'); doc.roundedRect(x,y,w,30,11).fill('#dce2e9'); doc.rect(x,y+15,w,15).fill('#dce2e9');
  [0,1,2].forEach(i=>doc.circle(x+14+i*12,y+15,3).fill('#9ea8b5')); doc.roundedRect(x+56,y+8,w-72,15,8).fillAndStroke(C.white,'#bdc6d1'); txt('chrome://extensions',x+67,y+12,7,'#1d2430','regular',{width:w-90});
  txt('Extensies',x+18,y+43,17,'#172033','bold');
  txt('Ontwikkelaarsmodus',x+w-174,y+49,8.5,'#172033','bold'); doc.roundedRect(x+w-58,y+46,26,13,7).fill(C.orange); doc.circle(x+w-40,y+52.5,5).fill(C.white); doc.circle(x+w-20,y+52,11).stroke(C.orange); txt('1',x+w-26,y+46,9,'#172033','bold',{width:12,align:'center'});
  doc.save().dash(6,{space:4}).roundedRect(x+18,y+75,w-36,62,8).fillAndStroke('#fff7ed',C.orange).undash().restore();
  txt('SLEEP HET ZIP-BESTAND HIERHEEN',x+30,y+91,12,'#8b3005','bold',{width:w-60,align:'center'}); txt('vanuit je map Downloads · niet uitpakken',x+30,y+113,8,'#9a5a31','regular',{width:w-60,align:'center'}); doc.circle(x+w-35,y+106,11).stroke(C.orange); txt('2',x+w-41,y+100,9,'#172033','bold',{width:12,align:'center'});
  doc.roundedRect(x+18,y+153,w-36,57,8).fillAndStroke(C.white,'#d0d7e0'); doc.roundedRect(x+30,y+164,35,35,5).fill(C.orange); txt('3S',x+30,y+176,10,C.white,'bold',{width:35,align:'center'}); txt('3 Stripe iRacing Content Scanner',x+78,y+164,10,'#172033','bold',{width:w-130}); txt('Versie 0.6.2 · ingeschakeld',x+78,y+183,7.5,'#687386',{width:w-130});
  doc.circle(x+w-32,y+181,11).stroke(C.orange); txt('3',x+w-38,y+175,9,'#172033','bold',{width:12,align:'center'});
}
function startPage(){ doc.addPage(); bg(); }

// Page 1
startPage();
if(fs.existsSync(LOGO)) doc.image(LOGO,M,30,{fit:[150,52]}); pill(W-M-108,32,108,25,'MEMBERHANDLEIDING');
txt('MEMBERHANDLEIDING · EXTENSIE 0.6.2',M,102,9,C.orange,'bold',{characterSpacing:1.2});
txt('Track Scanner',M,121,34,C.ink,'bold'); txt('installeren & gebruiken',M,158,27,C.orange,'bold');
txt('In ongeveer vijf minuten help je 3SM met betere kalenderplanning. Eén hoofdtaak per pagina, met grote herkenningspunten en een controle na iedere stap.',M,205,13,'#d6dde8','regular',{width:500,lineGap:4});
callout(M,268,W-2*M,57,'Alleen voor desktop of laptop','Gebruik Chrome of Edge. Een telefoon of tablet kan deze extensie niet installeren.');
const rx=M, rw=W-2*M; const labels=['Download','Laat ZIP dicht','Sleep ZIP','Scan','Upload'];
for(let i=0;i<5;i++){ const cx=rx+51+i*102; doc.circle(cx,373,22).fillAndStroke('#17120e',C.orange); txt(String(i+1),cx-11,364,14,C.cream,'bold',{width:22,align:'center'}); txt(labels[i],cx-39,403,9,C.ink,'bold',{width:78,align:'center'}); if(i<4) txt('›',cx+43,361,22,C.orange,'bold'); }
const cards=[['PRIVACY','GEEN WACHTWOORD','Je logt alleen zelf in op de officiële iRacing-site.'],['CHECK','EERST CONTROLEREN','Bekijk vóór uploaden precies welke exportdata klaarstaat.'],['DATA','ALLEEN PLANNING','De scan helpt bij Track Intelligence en kalenderkeuzes.']];
for(let i=0;i<3;i++){ const x=M+i*173; panel(x,451,160,105); doc.roundedRect(x+14,464,55,20,10).fillAndStroke('#1b130e',C.orange); txt(cards[i][0],x+14,471,6.5,C.cream,'bold',{width:55,align:'center',characterSpacing:.5}); txt(cards[i][1],x+14,493,9.5,C.ink,'bold',{width:132}); txt(cards[i][2],x+14,512,8.7,C.muted,'regular',{width:132,lineGap:2}); }
panel(M,580,rw,117,'#17110d','#71320d'); txt('Wat wordt gedeeld?',M+18,597,14,C.ink,'bold');
[['iRacing Customer ID',0],['iRacing-naam',145],['gevonden tracknamen',267],['scantijd',423]].forEach(([s,dx])=>{ doc.roundedRect(M+18+dx,628,String(s).length*5.2+20,24,12).fillAndStroke('#0b111b',C.line); txt(s,M+28+dx,636,7.8,'#d9e1ec','bold'); });
txt('Niet gedeeld: je iRacing-wachtwoord, betaalgegevens of inloggegevens.',M+18,669,9,C.muted,'regular',{width:rw-36});
footer(1,'3 Stripe Motorsport · Track Scanner');

// Page 2
startPage(); top('STAP 1 EN 2','Download de ZIP en laat hem ingepakt','± 1 MINUUT');
panel(M,154,252,362); step(1,'Download de extensie','Open op je computer de 3SM-downloadlink voor iracing-content-extension.zip.',M+16,174,220); txt('3stripemotorsport.cc/iracing-content-extension.zip?v=0.6.2',M+50,218,7.6,C.orange,'bold',{width:200,link:'https://3stripemotorsport.cc/iracing-content-extension.zip?v=0.6.2'}); step(2,'Open je map Downloads','Zoek iracing-content-extension.zip en laat de map openstaan.',M+16,256,220); step(3,'Laat de ZIP ingepakt','Niet dubbelklikken, niet uitpakken en geen losse bestanden zoeken.',M+16,330,220); step(4,'Pak het ZIP-bestand straks vast','Sleep precies dit ZIP-bestand vanuit Downloads naar het extensiescherm.',M+16,400,220); callout(M+16,466,220,47,'Belangrijk','Gebruik het ZIP-bestand zelf.');
panel(316,154,236,362); txt('DIT BESTAND HEB JE NODIG',335,177,8,C.orange,'bold',{width:198,align:'center',characterSpacing:.5}); doc.roundedRect(374,209,120,149,12).fillAndStroke('#090f18',C.orange); doc.roundedRect(405,229,58,72,6).fillAndStroke('#30170a','#d45c14'); txt('ZIP',405,256,15,C.cream,'bold',{width:58,align:'center'}); txt('iracing-content-',386,319,9,C.ink,'bold',{width:96,align:'center'}); txt('extension.zip',386,335,9,C.ink,'bold',{width:96,align:'center'}); verify(335,382,198,'Goed: ZIP blijft dicht in Downloads.'); callout(335,431,198,67,'Volgende stap','Open chrome://extensions of edge://extensions en sleep deze ZIP daarheen.');
callout(M,545,W-2*M,73,'Niet doen','Pak de ZIP niet uit en selecteer geen map. De actuele 3SM-installatie werkt door het ZIP-bestand rechtstreeks vanuit Downloads naar het extensiescherm te slepen.');
footer(2,'3SM · Download ZIP · niet uitpakken · Downloads openhouden');

// Page 3
startPage(); top('STAP 3','Sleep de ZIP naar Chrome of Edge','DEVELOPER MODE'); browserMock(M,153,W-2*M,238);
panel(M,412,246,79); txt('Chrome',M+16,429,12,C.ink,'bold'); txt('Typ chrome://extensions, zet Developer mode aan en sleep de ZIP vanuit Downloads naar dit scherm.',M+16,451,8.5,'#cbd5e1','regular',{width:214}); panel(306,412,246,79); txt('Edge',322,429,12,C.ink,'bold'); txt('Typ edge://extensions, zet Ontwikkelaarsmodus aan en sleep dezelfde ZIP naar dit scherm.',322,451,8.5,'#cbd5e1','regular',{width:214});
verify(M,511,W-2*M,'Goed: 3 Stripe iRacing Content Scanner staat als ingeschakeld in beeld.');
callout(M,561,W-2*M,77,'Zie je geen installatie?','Controleer of Developer mode aan staat en of je het ZIP-bestand zelf sleept — niet een map, snelkoppeling of los bestand. Probeer daarna opnieuw vanuit Downloads.');
footer(3,'3SM · Extensiescherm · Developer mode · sleep ZIP vanuit Downloads');

// Page 4
startPage(); top('STAP 4','Open de scanner en start de scan','LOG IN BIJ iRACING');
panel(M,153,248,442); step(1,'Log zelf in bij iRacing','Open iRacing in dezelfde browser. 3SM ziet of bewaart je wachtwoord niet.',M+15,172,218); step(2,'Open je extensies','Klik rechtsboven op het puzzelstukje en kies 3 Stripe iRacing Content Scanner.',M+15,239,218); step(3,'Kies de vaste tab','Klik op Open scanner in vaste tab. Dat is het duidelijkst tijdens het wisselen naar iRacing.',M+15,316,218); step(4,'Open de trackspagina','Klik op Open iRacing tracks pagina. De scanner probeert na het laden automatisch te scannen.',M+15,398,218); step(5,'Zo nodig handmatig','Staan de tracks in beeld maar gebeurt er niets? Klik Scan huidige pagina.',M+15,480,218); callout(M+15,544,218,35,'Even wachten','Laat de iRacing-pagina volledig laden.');
scanner(314,153,238,282,false); callout(314,454,238,71,'Waarom vaste tab?','Een extensie-popup kan sluiten zodra je naar iRacing wisselt. De vaste scanner-tab blijft zichtbaar.'); verify(314,544,238,'Goed: aantal tracks + je ID en naam.');
footer(4,'3SM · Inloggen · vaste scanner-tab · trackspagina · scan');

// Page 5
startPage(); top('STAP 5','Controleer, upload en rond af','LAATSTE CONTROLE'); scanner(M,153,260,238,true); panel(320,153,232,238); step(1,'Controleer het aantal','Zie je een logisch aantal tracks en herken je je iRacing-naam?',335,174,202); step(2,'Bekijk de export','Open Bekijk export data als je precies wilt zien wat klaarstaat.',335,231,202); step(3,'Upload één keer','Klik op Upload naar 3 Stripe.',335,290,202); step(4,'Wacht op groen','Je bent pas klaar als de groene succesmelding verschijnt.',335,341,202);
txt('Als het niet lukt',M,419,15,C.ink,'bold'); const troubles=[['0 tracks gevonden','Controleer of je bent ingelogd, open opnieuw de iRacing-trackspagina en scan opnieuw.'],['Geen iRacing ID','Herlaad de iRacing-pagina, log opnieuw in en scan daarna nogmaals.'],['Upload mislukt','Controleer internet en probeer één keer opnieuw. Blijft het fout gaan, maak een screenshot.'],['Hulp nodig?','Klik bij een lege scan op Kopieer debug info en stuur die plus een screenshot naar de 3SM-admins.']];
for(let i=0;i<4;i++){ const x=M+(i%2)*258,y=448+Math.floor(i/2)*94; panel(x,y,246,81,C.panel2,C.line,10); txt(troubles[i][0],x+14,y+13,10,C.cream,'bold',{width:218}); txt(troubles[i][1],x+14,y+34,8.4,'#cbd5e1','regular',{width:218,lineGap:1.5}); }
callout(M,649,W-2*M,69,'Klaar voor kalenderplanning','Je hoeft de extensie niet permanent open te laten. Scan opnieuw wanneer 3SM daarom vraagt of wanneer je trackcollectie duidelijk is veranderd.',C.green,'#081b12');
footer(5,'3SM · Controleer · Upload · wacht op groene bevestiging');

doc.end();
await new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject)});
console.log(OUT);
