using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ThreeSM.EnduranceConnector
{
    // Genereert SimHub LED-profielen die de 3SM-vlaggen én het paneel tonen.
    // Het profiel leest ALLES live uit onze SimHub-properties: eenmalig installeren,
    // daarna werken instellingswijzigingen direct (geen herinstallatie nodig).
    // Originele code.
    public static class FlagProfileInstaller
    {
        public const string ProfileName = "3SM Flags";
        private const string ProfileId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

        public static string SimHubDirectory()
        {
            try { var module = Process.GetCurrentProcess().MainModule; return module == null ? null : Path.GetDirectoryName(module.FileName); }
            catch { return null; }
        }

        public static string SettingsFileFor(string kind)
        {
            var directory = SimHubDirectory();
            if (directory == null) return null;
            var file = string.Equals(kind, "matrix", StringComparison.OrdinalIgnoreCase) ? "ArduinoRGBMatrixSettings.json"
                     : string.Equals(kind, "tm1638", StringComparison.OrdinalIgnoreCase) ? "ArduinoTM1638LedsSettings.json"
                     : "ArduinoRGBLedsSettings.json";
            return Path.Combine(directory, "PluginsData", "Common", file);
        }

        public static string DefaultMatrixSettingsPath() { return SettingsFileFor("matrix"); }

        public static JObject BuildProfile(FlagSettings settings, string kind, int box)
        {
            var prefix = settings == null ? "THREESM.Flags" : settings.PropertyPrefix;
            var slot = settings == null ? new FlagBoxSlot() : settings.Box(box - 1);
            var mld = slot != null && slot.IsMld;
            var columns = mld ? 25 : 8;
            var rows = mld ? 6 : 8;
            return string.Equals(kind, "matrix", StringComparison.OrdinalIgnoreCase)
                ? BuildMatrixProfile(settings, prefix, box, columns, rows)
                : BuildStripProfile(settings, prefix, box, settings == null ? 8 : settings.ProfileLedCount);
        }

        public static bool InstallProfile(string settingsPath, JObject profile, out string message)
        {
            message = null;
            try
            {
                if (string.IsNullOrWhiteSpace(settingsPath) || !File.Exists(settingsPath)) { message = "LED-instellingenbestand niet gevonden:\n" + settingsPath; return false; }
                var root = JObject.Parse(File.ReadAllText(settingsPath));
                var profiles = root["Profiles"] as JArray;
                if (profiles == null) { message = "Geen \"Profiles\"-sectie in het bestand."; return false; }
                var existing = profiles.FirstOrDefault(p => p is JObject && string.Equals((string)p["Name"], ProfileName, StringComparison.OrdinalIgnoreCase));
                if (existing != null) profiles.Remove(existing);
                profiles.Add(profile);
                File.Copy(settingsPath, settingsPath + ".3smbak", true);
                File.WriteAllText(settingsPath, root.ToString(Formatting.None));
                message = "Profiel \"" + ProfileName + "\" geïnstalleerd in " + Path.GetFileName(settingsPath)
                        + ".\nBackup: " + Path.GetFileName(settingsPath) + ".3smbak\n\nHerstart SimHub en kies dit profiel op het device.";
                return true;
            }
            catch (Exception ex) { message = "Installatie mislukt: " + ex.Message; return false; }
        }

        // ----- matrix: één profiel met alle geconfigureerde boxen -----

        public static JObject BuildMatrixProfile(FlagSettings s, string propertyPrefix, int box, int columns, int rows)
        {
            var settings = s ?? new FlagSettings();
            var mld = columns == 25 || rows == 6;
            var count = Math.Max(0, Math.Min(4, mld ? settings.MldCount : settings.BoxCount));
            var containers = new JArray();
            for (var i = 0; i < count; i++)
            {
                var slotIndex = mld ? 4 + i : i;
                containers.Add(BuildContainer(settings, propertyPrefix, slotIndex, columns, rows));
            }
            if (containers.Count == 0) containers.Add(BuildContainer(settings, propertyPrefix, mld ? 4 : 0, columns, rows));
            return ProfileShell(containers);
        }

        private static JObject BuildContainer(FlagSettings settings, string propertyPrefix, int slotIndex, int columns, int rows)
        {
            var slot = settings.Box(slotIndex);
            var boxNumber = slotIndex + 1;
            var position = slot.EffectivePosition() > 0 ? slot.EffectivePosition() : boxNumber;
            return new JObject
            {
                ["ContentFormula"] = new JObject { ["JSExt"] = 0, ["Interpreter"] = 1, ["Expression"] = BuildMatrixScript(settings, propertyPrefix, boxNumber, columns, rows) },
                ["Rows"] = rows,
                ["Columns"] = columns,
                ["StartPositionMatrix"] = position,
                ["StartPositionX"] = 1,
                ["StartPositionY"] = 1,
                ["ContainerId"] = Guid.NewGuid().ToString(),
                ["ContainerType"] = "ScriptedContentContainer",
                ["Description"] = "3SM flags + panel box " + boxNumber,
                ["IsEnabled"] = true,
                ["DeviceKind"] = 2,
            };
        }

        // De JS leest de vlaggen én de instellingen live uit de SimHub-properties.
        private static string BuildMatrixScript(FlagSettings s, string propertyPrefix, int box, int columns, int rows)
        {
            var prefix = (string.IsNullOrWhiteSpace(propertyPrefix) ? "THREESM.Flags" : propertyPrefix.Trim());
            var bp = prefix + ".Box" + box;
            var sb = new StringBuilder();

            sb.Append("var leds=[],w=").Append(columns).Append(",h=").Append(rows).Append(",now=Date.now();\r\n");
            sb.Append("function P(n){return $prop('").Append(bp).Append(".'+n);}\r\n");
            sb.Append("function S(n){return $prop('").Append(bp).Append(".Set.'+n);}\r\n");
            sb.Append("function U(n){return $prop('").Append(prefix).Append(".'+n);}\r\n");
            sb.Append("function G(n){return $prop('DataCorePlugin.GameData.NewData.'+n);}\r\n");
            sb.Append("function idx(x,y){return y*w+x;}\r\n");
            sb.Append("function hx(c){c=''+c;if(c.charAt(0)!=='#')return [0,0,0];return [parseInt(c.substr(1,2),16),parseInt(c.substr(3,2),16),parseInt(c.substr(5,2),16)];}\r\n");
            sb.Append("function dim(c){c=''+c;if(c.charAt(0)!=='#')return '#000000';if(c.length===9)c='#'+c.substring(3);if(B>=0.999)return c;var a=hx(c);function q(v){var x=Math.round(v*B);return (x<16?'0':'')+x.toString(16);}return '#'+q(a[0])+q(a[1])+q(a[2]);}\r\n");
            sb.Append("function lift(c){c=''+c;if(c.charAt(0)!=='#')return c;if(c.length===9)c='#'+c.substring(3);var a=hx(c),p=Math.max(a[0],Math.max(a[1],a[2]));if(p<=0)return c;var s=(0.8+(p/255)*0.2)/(p/255);function q(v){var x=Math.min(255,Math.round(v*s));return (x<16?'0':'')+x.toString(16);}return '#'+q(a[0])+q(a[1])+q(a[2]);}\r\n");
            sb.Append("function solid(c){c=dim(c);for(var i=0;i<w*h;i++)leds[i]=c;}\r\n");
            sb.Append("function set(x,y,c){if(x>=0&&x<w&&y>=0&&y<h)leds[idx(x,y)]=dim(c);}\r\n");
            sb.Append("function checker2(a,b,p){var c1=p?a:b,c2=p?b:a;for(var y=0;y<h;y++)for(var x=0;x<w;x++)leds[idx(x,y)]=dim(((x+y)%2===0)?c1:c2);}\r\n");
            sb.Append("function rows2(a,b,p){var c1=p?a:b,c2=p?b:a;for(var y=0;y<h;y++)for(var x=0;x<w;x++)leds[idx(x,y)]=dim((y%2===0)?c1:c2);}\r\n");
            sb.Append("function border(c){for(var x=0;x<w;x++){set(x,0,c);set(x,h-1,c);}for(var y=0;y<h;y++){set(0,y,c);set(w-1,y,c);}}\r\n");
            sb.Append("function gs(a,col){var gw=0,gh=a.length,i;for(i=0;i<gh;i++)if(a[i].length>gw)gw=a[i].length;var gx=Math.floor((w-gw)/2),gy=Math.floor((h-gh)/2);if(gy<0)gy=0;for(var yy=0;yy<gh;yy++)for(var xx=0;xx<a[yy].length;xx++)if(a[yy].charAt(xx)==='#')set(gx+xx,gy+yy,col);}\r\n");
            sb.Append("function lerp(a,b,t){a=''+a;b=''+b;if(a.charAt(0)!=='#'||b.charAt(0)!=='#')return a;var x=hx(a),y=hx(b);function q(v){v=Math.round(v);return (v<16?'0':'')+v.toString(16);}return '#'+q(x[0]+(y[0]-x[0])*t)+q(x[1]+(y[1]-x[1])*t)+q(x[2]+(y[2]-x[2])*t);}\r\n");
            sb.Append("function bc(step){var span=2*w+2*h-4;step=((step%span)+span)%span;if(step<w)return [step,0];step-=w;if(step<h-1)return [w-1,step+1];step-=h-1;if(step<w-1)return [w-2-step,h-1];step-=w-1;return [0,h-2-step];}\r\n");

            // Lettertypen (alle drie; de keuze gebeurt live).
            sb.Append("var F0={'0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],'3':['111','001','111','001','111'],'4':['101','101','111','001','001'],'5':['111','100','111','001','111'],'6':['111','100','111','101','111'],'7':['111','001','001','001','001'],'8':['111','101','111','101','111'],'9':['111','101','111','001','111'],'N':['101','111','111','111','101'],'R':['111','101','110','101','101'],'-':['000','000','111','000','000']};\r\n");
            sb.Append("var F1={'0':['11','11','11','11','11'],'1':['01','11','01','01','01'],'2':['11','01','11','10','11'],'3':['11','01','11','01','11'],'4':['10','10','11','01','01'],'5':['11','10','11','01','11'],'6':['11','10','11','11','11'],'7':['11','01','01','01','01'],'8':['11','11','11','11','11'],'9':['11','11','11','01','11'],'N':['10','11','11','11','10'],'R':['11','10','11','10','10'],'-':['00','00','11','00','00']};\r\n");
            sb.Append("var F5={'0':['0110','1001','1001','1001','1001','0110'],'1':['0010','0110','0010','0010','0010','0111'],'2':['0110','1001','0001','0010','0100','1111'],'3':['1110','0001','0110','0001','0001','1110'],'4':['0010','0110','1010','1111','0010','0010'],'5':['1111','1000','1110','0001','0001','1110'],'6':['0110','1000','1110','1001','1001','0110'],'7':['1111','0001','0010','0100','0100','0100'],'8':['0110','1001','0110','1001','1001','0110'],'9':['0110','1001','1001','0111','0001','0110'],'N':['1001','1101','1011','1001','1001','1001'],'R':['1110','1001','1110','1010','1001','1001'],'-':['0000','0000','1111','0000','0000','0000']};\r\n");
            sb.Append("function art(p){if(!p)return null;var t=(''+p).trim();if(!t)return null;var m=t.indexOf(';');if(m>0)t=t.substring(m+1);var fr=t.split('|'),out=[];for(var i=0;i<fr.length;i++){var f=fr[i],ci=f.indexOf(':');if(ci<=0)continue;var d=parseInt(f.substring(0,ci),10);if(!(d>=1))d=100;out.push([d,f.substring(ci+1).split(',')]);}return out.length?out:null;}\r\n");
            sb.Append("function drawArt(a,anim){if(!a)return false;var tot=0,i;for(i=0;i<a.length;i++)tot+=a[i][0];if(tot<=0)tot=1;var t=anim?(now%tot):0,fi=0;for(i=0;i<a.length;i++){if(t<a[i][0]){fi=i;break;}t-=a[i][0];}var c=a[fi][1];for(var y=0;y<h;y++)for(var x=0;x<w;x++){var v=(y*w+x<c.length)?(''+c[y*w+x]).replace(/^\\s+|\\s+$/g,''):'';leds[idx(x,y)]=(v&&v.charAt(0)==='#')?dim(v):'#000000';}return true;}\r\n");

            // ---- instellingen (live) ----
            sb.Append("var B=(''+S('Brightness'))*1;if(!(B>=0))B=100;B=Math.max(0,Math.min(1,B/100));\r\n");
            sb.Append("var PH=(''+U('FlagPhase'))*1;if(!(PH>0))PH=300;\r\n");
            sb.Append("var SS=(''+S('FlagStyles')).split(','),FS=[];for(var i=0;i<SS.length;i++){var q=(''+SS[i]).split(':');FS.push([parseInt(q[0],10),parseInt(q[1],10),parseInt(q[2],10)]);}\r\n");
            sb.Append("var PT=lift(S('PalTop')||'#00FF00'),PM=lift(S('PalMid')||'#FFFF00'),PB=lift(S('PalBot')||'#FF0000'),PBL=S('PalBlend')==true;\r\n");
            sb.Append("var RT=lift(S('RedTop')||'#FF0000'),RM=lift(S('RedMid')||'#FF0000'),RB=lift(S('RedBot')||'#FF0000');\r\n");
            sb.Append("var HIGH=(''+S('RedlineHighPct'))*1;if(!(HIGH>0))HIGH=95;var MIDP=(''+S('RedlineMidPct'))*1;if(!(MIDP>0))MIDP=80;var BEH=(''+S('RedlineBehaviour'))*1;if(!(BEH>=0))BEH=2;\r\n");
            sb.Append("var LOG=(''+S('GearLocation'))*1;if(!(LOG>=1))LOG=1;var STY=(''+S('GearStyle'))*1;if(!(STY>=0))STY=0;var INV=S('GearInverted')==true;var SHOWR=S('ShowRedline')!=false;var BAR=(''+S('RedlineBarStart'))*1;if(!(BAR>=0))BAR=0;\r\n");
            sb.Append("var SD=(''+S('SpotterSide'))*1;if(!(SD>=1))SD=1;var SM=(''+S('SpotterMode'))*1;if(!(SM>=0))SM=2;var SAN=S('SpotterAnimation')!=false;var SBL=S('SpotterBlink')!=false;var SG=S('SpotterShiftsGear')!=false;var SPON=S('Spotters')!=false;var SPCOL=U('SpotterColour')||'#FF1493';\r\n");
            sb.Append("var PIT=S('Pit')!=false,PCD=S('PitCountdown')!=false,PST=(''+S('PitStyle'))*1;if(!(PST>=0))PST=0;var IGN=S('Ignition')!=false,EST=(''+S('EngineStyle'))*1;if(!(EST>=0))EST=0;\r\n");
            sb.Append("var TW=S('TempWarn')!=false,LFW=S('LowFuel')!=false,WT=(''+U('TempWater'))*1||110,OT=(''+U('TempOil'))*1||120,LFP=(''+U('LowFuelPct'))*1||15;\r\n");
            sb.Append("var CRIT=S('Critical')!=false,IM=(''+S('IdleScreen'))*1;if(!(IM>=0))IM=2;\r\n");
            sb.Append("var rpmPct=G('RpmsPercent');if(rpmPct<=1)rpmPct=rpmPct*100;if(!(rpmPct>=0))rpmPct=0;\r\n");
            sb.Append("var ph=(Math.floor(now/PH)%2)===0;\r\n");
            sb.Append("function rc(f){f=f<0?0:(f>1?1:f);if(PBL)return lerp(PT,PB,f);return f<0.34?PT:(f<0.67?PM:PB);}\r\n");
            sb.Append("solid('#000000');\r\n");

            // ---- 1) vlaggen ----
            sb.Append("if(P('Active')==true){\r\n");
            sb.Append("  if((P('Red')||P('Black'))&&CRIT&&!ph){solid('#000000');return leds;}\r\n");
            sb.Append("  var _i=-1,_c='#000000',_c2='#000000',_dp=0,_g='';\r\n");
            sb.Append("  if(P('Red')){_i=0;_c='#FF0000';}\r\n");
            sb.Append("  else if(P('Black')){_i=1;_c='#808080';_dp=1;}\r\n");
            sb.Append("  else if(P('SafetyCar')||P('VirtualSafetyCar')||P('FullCourseYellow')){_i=2;_c='#FFFF00';_g='SC';}\r\n");
            sb.Append("  else if(P('DoubleYellow')){_i=3;_c='#FFFF00';}\r\n");
            sb.Append("  else if(P('Yellow')){_i=4;_c='#FFFF00';}\r\n");
            sb.Append("  else if(P('White')||P('WhiteSlow')||P('WhiteFinal')){_i=5;_c='#FFFFFF';_g=P('WhiteFinal')?'FL':'SC';}\r\n");
            sb.Append("  else if(P('Orange')){_i=6;_c='#FF8C00';}\r\n");
            sb.Append("  else if(P('Debris')){_i=7;_c='#FF0000';_c2='#FFFF00';_dp=2;}\r\n");
            sb.Append("  else if(P('Blue')){_i=8;_c='#0000FF';}\r\n");
            sb.Append("  else if(P('Green')){_i=9;_c='#00FF00';}\r\n");
            sb.Append("  else if(P('Checkered')){_i=10;_c='#FFFFFF';_dp=1;}\r\n");
            sb.Append("  if(_i<0){solid('#000000');return leds;}\r\n");
            sb.Append("  _c=lift(_c);_c2=lift(_c2);\r\n");
            sb.Append("  var _st=(_i<FS.length&&FS[_i])?FS[_i]:[-1,-1,0];var _pt=_st[0]>=0?_st[0]:_dp,_bl=_st[1]>=0?(_st[1]===1):(_pt!==0),_pd=_st[2]>0?_st[2]:PH;\r\n");
            sb.Append("  var _fp=(Math.floor(now/_pd)%2)===0,_gp=(Math.floor(now/700)%2)!==0,_ug=(_st[0]<0)?_g:'';\r\n");
            sb.Append("  if(_pt===3){solid(_c2);if(!_bl||_fp)gs(['#..#.','..#..','.#..#','#..#.','..#..','.#..#','#..#.'],_c);}\r\n");
            sb.Append("  else{if(_pt===0)solid(_bl&&!_fp?'#000000':_c);else if(_pt===1)checker2(_c,_c2,_bl?_fp:true);else rows2(_c,_c2,_bl?_fp:true);if(_gp){if(_ug==='SC')gs(['.....','##.##','#..#.','##.#.','.#.#.','##.##','.....'],'#101010');else if(_ug==='FL')gs(['.....','##.#.','#..#.','##.#.','#..#.','#..##','.....'],'#101010');}}\r\n");
            sb.Append("  return leds;\r\n}\r\n");

            // ---- 2) Idle / engine-start ----
            sb.Append("var gameOn=$prop('DataCorePlugin.GameRunning')==true;\r\n");
            sb.Append("if(!gameOn||rpmPct<=0.5){\r\n");
            sb.Append("  if(IGN&&rpmPct<=0.5&&gameOn){var t=Math.floor(now/60);\r\n");
            sb.Append("    if(EST===0){for(var i=0;i<Math.floor(w*h/3);i++)set((i*7+t*3)%w,(i*5+t*2)%h,(i%2===0)?PT:PB);}\r\n");
            sb.Append("    else if(EST===1){var fl=Math.min(h,Math.floor(t/4)%(h+1));for(var yy=h-fl;yy<h;yy++)for(var xx=0;xx<w;xx++)set(xx,yy,PM);}\r\n");
            sb.Append("    else if(EST===2){var rd=Math.floor(t/3)%(Math.max(w,h)+1);for(var yy=0;yy<h;yy++)for(var xx=0;xx<w;xx++){var dx=xx-(w-1)/2,dy=yy-(h-1)/2;if(Math.sqrt(dx*dx+dy*dy)<=rd)set(xx,yy,PT);}}\r\n");
            sb.Append("    else if(EST===4){gs(['...##','..##.','.##..','####.','..##.','.##..','##...'],'#FF4500');}\r\n");
            sb.Append("    else{if(Math.floor(t/6)%2===0)solid(PM);}\r\n");
            sb.Append("    return leds;}\r\n");
            sb.Append("  if(IM===0){solid('#000000');}\r\n");
            sb.Append("  else{var _a=art(S('IdleArt'));if(!drawArt(_a,IM!==1))solid('#000000');}\r\n");
            sb.Append("  return leds;\r\n}\r\n");

            // ---- 3) Paneel ----
            sb.Append("var gre=(rpmPct>=HIGH),gbl=(gre&&BEH===2&&!ph);\r\n");
            sb.Append("var PT2=gre?RT:PT,PM2=gre?RM:PM,PB2=gre?RB:PB;\r\n");
            sb.Append("var _sp=SPON&&((SD===1&&(G('SpotterCarLeft')==true||G('SpotterCarRight')==true))||(SD===2&&G('SpotterCarLeft')==true)||(SD===3&&G('SpotterCarRight')==true));\r\n");
            sb.Append("var _svis=_sp&&(SAN?true:(SM===2?ph:(SBL?ph:true))),_gvis=!(_sp&&(SAN||SM===0||(SM===2&&ph)));\r\n");
            sb.Append("function rr(f){f=f<0?0:(f>1?1:f);return f<0.34?PT2:(f<0.67?PM2:PB2);}\r\n");
            sb.Append("if(SHOWR!==false){if(gbl){for(var x=0;x<w;x++)leds[idx(x,h-1)]='#101010';}else{var _bc=rr(rpmPct/100);for(var x=0;x<w;x++){var cp=(x+0.5)*100/w;leds[idx(x,h-1)]=dim((cp<=rpmPct&&cp>=BAR)?_bc:'#101010');}}}\r\n");
            sb.Append("var big=(SHOWR===false);var gs2=''+G('Gear');var ch=gs2.length?gs2.charAt(0):'-';var gl=(big?F5:(STY===1?F1:F0))[ch];\r\n");
            sb.Append("if(INV&&!gbl)solid(rr(0.5));\r\n");
            sb.Append("var _loc=big?0:LOG;if(_svis&&SAN&&SG){if(SD===2)_loc=1;else if(SD===3)_loc=2;}\r\n");
            sb.Append("if(gl&&!gbl&&_gvis){var gw=gl[0].length,gh=gl.length,oy=Math.floor((h-gh)/2);if(oy<0)oy=0;var ink=INV?'#000000':rr(rpmPct/100);var oxs=[];if(_loc===2||_loc===3)oxs.push(0);if(_loc===1||_loc===3)oxs.push(w-gw);if(oxs.length===0)oxs.push(Math.floor((w-gw)/2));for(var oi=0;oi<oxs.length;oi++){var ox=oxs[oi];for(var y=0;y<gh;y++)for(var x=0;x<gw;x++)if(gl[y].charAt(x)==='1'){set(ox+x,oy+y,ink);if(STY===2&&!big)set(ox+x+1,oy+y,ink);}}}\r\n");
            sb.Append("if(_svis&&(SAN||ph)){var AL=['.....','..#..','.#...','#####','.#...','..#..','.....'],AB=['.....','..#..','.#.#.','#####','.#.#.','..#..','.....'];var _tr=(SD===3)?true:((SD===2)?false:(G('SpotterCarRight')==true&&G('SpotterCarLeft')!=true));var _ar=(!SAN&&SD===1)?AB:(_tr?AL.map(function(r){return r.split('').reverse().join('');}):AL);var _gw=0,_gh=_ar.length,i2;for(i2=0;i2<_gh;i2++)if(_ar[i2].length>_gw)_gw=_ar[i2].length;var _sx=SAN?Math.round((_tr?(now%900)/900:(1-(now%900)/900))*(w-_gw)):((SD===2)?0:((SD===3)?(w-_gw):Math.floor((w-_gw)/2)));var _gy=Math.floor((h-_gh)/2);if(_gy<0)_gy=0;for(var yy=0;yy<_gh;yy++)for(var xx=0;xx<_ar[yy].length;xx++)if(_ar[yy].charAt(xx)==='#')set(_sx+xx,_gy+yy,lift(SPCOL));}\r\n");
            sb.Append("if(PIT&&G('PitLimiterOn')==true){\r\n");
            sb.Append("  if(PST===0){for(var y=0;y<h;y++)for(var x=0;x<w;x++)if((y%2===0)===ph)set(x,y,'#0000FF');}\r\n");
            sb.Append("  else if(PST===1){border('#001040');var ws=bc(Math.floor(now/120));set(ws[0],ws[1],'#0000FF');}\r\n");
            sb.Append("  else if(PST===2){if(!ph)solid('#0000FF');}\r\n");
            sb.Append("  else if(PST===3){for(var y=0;y<h;y++)for(var x=0;x<w;x++)if((x+y)%2===0)set(x,y,'#0000FF');}\r\n");
            sb.Append("  else{var sp2=2*w-2,pp=Math.floor(now/120)%sp2,bx2=pp<w?pp:sp2-pp;for(var x=0;x<w;x++)if(x===bx2)for(var y=0;y<h;y++)set(x,y,'#0000FF');}\r\n");
            sb.Append("  if(PCD){var pf=Math.min(w,Math.floor(now/1000)%w);for(var x=0;x<w;x++)set(x,0,x<pf?'#2FD1FF':'#000000');}\r\n");
            sb.Append("}\r\n");
            sb.Append("var _fuel=(''+G('FuelPercent'))*1;if(G('FuelPercent')<=1)_fuel=_fuel*100;var _warn=(LFW&&(G('LowFuelAlert')==true||(G('FuelPercent')>0&&_fuel<LFP)))||(TW&&((((''+G('WaterTemperature'))*1)>=WT)||(((''+G('OilTemperature'))*1)>=OT)));\r\n");
            sb.Append("if(_warn&&(Math.floor(now/1000)%2===0)){var _tw=TW&&((((''+G('WaterTemperature'))*1)>=WT)||(((''+G('OilTemperature'))*1)>=OT));gs(_tw?['..##.','..#..','..##.','..#..','.###.','#####','.###.']:['####.','#..##','#..##','####.','####.','####.','####.'],_tw?'#FFA500':'#FF0000');}\r\n");
            sb.Append("return leds;\r\n");
            return sb.ToString();
        }

        // ----- strip (RGB / TM1638) -----

        public static JObject BuildStripProfile(FlagSettings s, string propertyPrefix, int box, int ledCount, int blinkDelay = 400)
        {
            if (ledCount < 1) ledCount = 8;
            var settings = s ?? new FlagSettings();
            var prefix = (string.IsNullOrWhiteSpace(propertyPrefix) ? "THREESM.Flags" : propertyPrefix.Trim());
            var containers = new JArray();

            containers.Add(StripGroup("off", "Black", null, blinkDelay, ledCount, "return true"));
            containers.Add(StripGroup("warn", "Red", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.LowFuelAlert') == true"));
            containers.Add(StripGroup("pit", "Blue", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.PitLimiterOn') == true"));
            containers.Add(StripGroup("spotter-left", "Yellow", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.SpotterCarLeft') == true"));
            containers.Add(StripGroup("spotter-right", "Yellow", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.SpotterCarRight') == true"));
            containers.Add(StripGroup("checkered", "White", "Black", blinkDelay, ledCount, AnyBox(settings, prefix, "Checkered")));
            containers.Add(StripGroup("green", "Green", null, blinkDelay, ledCount, AnyBox(settings, prefix, "Green")));
            containers.Add(StripGroup("blue", "Blue", null, blinkDelay, ledCount, AnyBox(settings, prefix, "Blue")));
            containers.Add(StripGroup("debris", "Red", "Yellow", blinkDelay, ledCount, AnyBox(settings, prefix, "Debris")));
            containers.Add(StripGroup("orange", "Orange", null, blinkDelay, ledCount, AnyBox(settings, prefix, "Orange")));
            containers.Add(StripGroup("white", "White", null, blinkDelay, ledCount, "(" + AnyBoxNoReturn(settings, prefix, "White") + ") || (" + AnyBoxNoReturn(settings, prefix, "WhiteSlow") + ") || (" + AnyBoxNoReturn(settings, prefix, "WhiteFinal") + ")"));
            containers.Add(StripGroup("yellow", "Yellow", null, blinkDelay, ledCount, "(" + AnyBoxNoReturn(settings, prefix, "Yellow") + ") || (" + AnyBoxNoReturn(settings, prefix, "DoubleYellow") + ")"));
            containers.Add(StripGroup("safetycar", "Yellow", "Black", blinkDelay, ledCount, "(" + AnyBoxNoReturn(settings, prefix, "SafetyCar") + ") || (" + AnyBoxNoReturn(settings, prefix, "VirtualSafetyCar") + ") || (" + AnyBoxNoReturn(settings, prefix, "FullCourseYellow") + ")"));
            containers.Add(StripGroup("black", "Grey", "Black", blinkDelay, ledCount, AnyBox(settings, prefix, "Black")));
            containers.Add(StripGroup("red", "Red", null, blinkDelay, ledCount, AnyBox(settings, prefix, "Red")));
            return ProfileShell(containers);
        }

        private static string AnyBoxNoReturn(FlagSettings settings, string prefix, string name)
        {
            var count = Math.Max(1, Math.Min(4, settings.BoxCount));
            var sb = new StringBuilder();
            for (var i = 0; i < count; i++)
            {
                if (i > 0) sb.Append(" || ");
                sb.Append("$prop('").Append(prefix).Append(".Box").Append(i + 1).Append('.').Append(name).Append("') == true");
            }
            return sb.ToString();
        }

        private static string AnyBox(FlagSettings settings, string prefix, string name)
        {
            return "return (" + AnyBoxNoReturn(settings, prefix, name) + ")";
        }

        private static JObject StripGroup(string name, string color, string blinkColour, int blinkDelay, int ledCount, string expression)
        {
            var status = new JObject
            {
                ["IdleColor"] = "Transparent",
                ["IdleBlinkingColor"] = "Transparent",
                ["EnableIdleBlinking"] = false,
                ["LedCount"] = ledCount,
                ["StartPosition"] = 1,
                ["Color"] = color,
                ["BlinkingColor"] = blinkColour ?? "Transparent",
                ["BlinkEnabled"] = blinkColour != null,
                ["BlinkDelay"] = blinkDelay,
                ["ContainerId"] = Guid.NewGuid().ToString(),
                ["ContainerType"] = "CustomStatus",
                ["Description"] = "3SM " + name,
            };
            return new JObject
            {
                ["TriggerFormula"] = new JObject { ["JSExt"] = 0, ["Interpreter"] = 1, ["Expression"] = expression },
                ["LedContainers"] = new JArray { status },
                ["ContainerId"] = Guid.NewGuid().ToString(),
                ["ContainerType"] = "Groups.CustomConditionalGroup",
                ["Description"] = "3SM " + name,
            };
        }

        private static JObject ProfileShell(JArray containers)
        {
            return new JObject
            {
                ["CarChoices"] = new JArray(),
                ["UseStrictJSIsolation"] = true,
                ["EmbeddedJavascript"] = JValue.CreateNull(),
                ["LedContainers"] = containers,
                ["GlobalBrightness"] = 50.0,
                ["GlobalBrightnessPreset"] = new JObject { ["CurrentMode"] = 0, ["Brightness"] = 50.0, ["BrightnessSettings"] = new JObject() },
                ["UseProfileBrightness"] = false,
                ["LastLoaded"] = "0001-01-01T00:00:00",
                ["Name"] = ProfileName,
                ["ProfileId"] = ProfileId,
                ["GameCode"] = JValue.CreateNull(),
                ["CarChoice"] = JValue.CreateNull(),
            };
        }
    }
}
