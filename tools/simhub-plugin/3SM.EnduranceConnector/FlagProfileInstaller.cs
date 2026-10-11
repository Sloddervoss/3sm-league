using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ThreeSM.EnduranceConnector
{
    // Genereert SimHub LED-profielen die de 3SM-vlaggen EN een volledig info-paneel
    // tonen, per box (gear/redline/pit/waarschuwingen/spotter/idle). Originele code.
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
            var columns = slot != null && slot.IsMld ? 25 : 8;
            var rows = slot != null && slot.IsMld ? 6 : 8;
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

        // ----- matrix -----

        public static JObject BuildMatrixProfile(FlagSettings s, string propertyPrefix, int box, int columns, int rows)
        {
            var slot = s == null ? new FlagBoxSlot() : s.Box(box - 1);
            var position = slot.EffectivePosition() > 0 ? slot.EffectivePosition() : box;
            var container = new JObject
            {
                ["ContentFormula"] = new JObject { ["JSExt"] = 0, ["Interpreter"] = 1, ["Expression"] = BuildMatrixScript(slot, s, propertyPrefix, box, columns, rows) },
                ["Rows"] = rows,
                ["Columns"] = columns,
                ["StartPositionMatrix"] = position,
                ["StartPositionX"] = 1,
                ["StartPositionY"] = 1,
                ["ContainerId"] = Guid.NewGuid().ToString(),
                ["ContainerType"] = "ScriptedContentContainer",
                ["Description"] = "3SM flags + panel box " + box,
                ["IsEnabled"] = true,
                ["DeviceKind"] = 2,
            };
            return ProfileShell(new JArray { container });
        }

        private static string BuildMatrixScript(FlagBoxSlot b, FlagSettings s, string propertyPrefix, int box, int columns, int rows)
        {
            var prefix = (string.IsNullOrWhiteSpace(propertyPrefix) ? "THREESM.Flags" : propertyPrefix.Trim()) + ".Box" + box;
            string F(string name) { return "$prop('" + prefix + "." + name + "')"; }
            string G(string name) { return "$prop('DataCorePlugin.GameData.NewData." + name + "')"; }
            string N(double v) { return v.ToString(CultureInfo.InvariantCulture); }

            var phaseMs = s != null && s.FlagPhaseMs > 0 ? s.FlagPhaseMs : 250;
            var brightness = b.Brightness / 100.0;
            var critical = b.CriticalFlags;
            var idleMode = b.IdleScreen;
            var theme = FlagThemes.For(b.IdleAnimationColour);
            var idleAccent = theme.Middle;

            var gearTheme = FlagThemes.For(b.GearColour);
            var gTop = gearTheme.Top; var gMid = gearTheme.Middle; var gBot = gearTheme.Bottom; var gBlend = gearTheme.Blend;
            var redlineBehaviour = b.RedlineBehaviour;
            var midPct = b.RedlineMidPct;
            var highPct = b.RedlineHighPct;
            var barStart = b.RedlineBarStartPct;
            var style = b.GearStyle;
            var inverted = b.GearInverted;
            var location = b.GearLocation;
            var pitStyle = b.PitLimiterStyle;
            var engineStyle = b.EngineStartStyle;
            var spotterSide = b.SpotterSide;
            var tempWater = s != null ? s.TempWarnWater : 110;
            var tempOil = s != null ? s.TempWarnOil : 120;
            var lowFuel = s != null ? s.LowFuelPercent : 15;

            // Idle-tekening als JS-array (eigen 3SM-kunst of Custom-payload).
            string idleFramesJs = "null", idleDurJs = "null";
            if (idleMode != 0)
            {
                var art = MatrixArt.Parse(FlagIdleArt.Effective(b, idleMode, theme.Top));
                if (art != null && art.Frames.Count > 0)
                {
                    var f = new StringBuilder("["); var d = new StringBuilder("[");
                    for (var i = 0; i < art.Frames.Count; i++)
                    {
                        if (i > 0) { f.Append(','); d.Append(','); }
                        f.Append('[');
                        for (var k = 0; k < art.Frames[i].Length; k++) { if (k > 0) f.Append(','); f.Append('\'').Append(art.Frames[i][k] ?? "").Append('\''); }
                        f.Append(']');
                        d.Append(art.Durations[i]);
                    }
                    f.Append(']'); d.Append(']');
                    idleFramesJs = f.ToString(); idleDurJs = d.ToString();
                }
            }

            var sb = new StringBuilder();
            sb.Append("var leds=[],w=").Append(columns).Append(",h=").Append(rows).Append(",now=Date.now();\r\n");
            sb.Append("var ph=(Math.floor(now/").Append(phaseMs).Append(")%2)===0;\r\n");
            sb.Append("var B=").Append(N(brightness)).Append(";\r\n");
            sb.Append("function idx(x,y){return y*w+x;}\r\n");
            sb.Append("function hx(c){return [parseInt(c.substr(1,2),16),parseInt(c.substr(3,2),16),parseInt(c.substr(5,2),16)];}\r\n");
            sb.Append("function dim(c){if(B>=0.999)return c;var a=hx(c);function h(v){var x=Math.round(v*B);return (x<16?'0':'')+x.toString(16);}return '#'+h(a[0])+h(a[1])+h(a[2]);}\r\n");
            sb.Append("function lift(c){var a=hx(c),p=Math.max(a[0],Math.max(a[1],a[2]));if(p<=0)return c;var s=(0.8+(p/255)*0.2)/(p/255);function h(v){var x=Math.min(255,Math.round(v*s));return (x<16?'0':'')+x.toString(16);}return '#'+h(a[0])+h(a[1])+h(a[2]);}\r\n");
            sb.Append("function solid(c){c=dim(c);for(var i=0;i<w*h;i++)leds[i]=c;}\r\n");
            sb.Append("function set(x,y,c){if(x>=0&&x<w&&y>=0&&y<h)leds[idx(x,y)]=dim(c);}\r\n");
            sb.Append("function checker2(a,b,p){var c1=p?a:b,c2=p?b:a;for(var y=0;y<h;y++)for(var x=0;x<w;x++)leds[idx(x,y)]=dim(((x+y)%2===0)?c1:c2);}\r\n");
            sb.Append("function rows2(a,b,p){var c1=p?a:b,c2=p?b:a;for(var y=0;y<h;y++)for(var x=0;x<w;x++)leds[idx(x,y)]=dim((y%2===0)?c1:c2);}\r\n");
            sb.Append("function border(c){for(var x=0;x<w;x++){set(x,0,c);set(x,h-1,c);}for(var y=0;y<h;y++){set(0,y,c);set(w-1,y,c);}}\r\n");
            sb.Append("function gs(a,col){var gw=0,gh=a.length,i;for(i=0;i<gh;i++)if(a[i].length>gw)gw=a[i].length;var gx=Math.floor((w-gw)/2),gy=Math.floor((h-gh)/2);if(gy<0)gy=0;for(var yy=0;yy<gh;yy++)for(var xx=0;xx<a[yy].length;xx++)if(a[yy].charAt(xx)==='#')set(gx+xx,gy+yy,col);}\r\n");
            sb.Append("function lerp(a,b,t){function p(c){return [parseInt(c.substr(1,2),16),parseInt(c.substr(3,2),16),parseInt(c.substr(5,2),16)];}var x=p(a),y=p(b);function h(v){v=Math.round(v);return (v<16?'0':'')+v.toString(16);}return '#'+h(x[0]+(y[0]-x[0])*t)+h(x[1]+(y[1]-x[1])*t)+h(x[2]+(y[2]-x[2])*t);}\r\n");
            sb.Append("function bc(step){var span=2*w+2*h-4;step=((step%span)+span)%span;if(step<w)return [step,0];step-=w;if(step<h-1)return [w-1,step+1];step-=h-1;if(step<w-1)return [w-2-step,h-1];step-=w-1;return [0,h-2-step];}\r\n");
            sb.Append("solid('#000000');\r\n");
            sb.Append("var rpmPct=").Append(G("RpmsPercent")).Append(";if(rpmPct<=1)rpmPct=rpmPct*100;if(!(rpmPct>=0))rpmPct=0;\r\n");

            // 1) Vlaggen (per-vlag patroon/knipperen/tempo).
            var spSb = new StringBuilder("["); var sbSb = new StringBuilder("["); var stSb = new StringBuilder("[");
            for (var si = 0; si < FlagSlotIndex.Count; si++)
            {
                var stl = b.StyleOf(si);
                if (si > 0) { spSb.Append(','); sbSb.Append(','); stSb.Append(','); }
                spSb.Append(stl.Pattern); sbSb.Append(stl.Blink); stSb.Append(stl.BlinkMs);
            }
            spSb.Append(']'); sbSb.Append(']'); stSb.Append(']');
            sb.Append("var _sp=").Append(spSb).Append(",_sb=").Append(sbSb).Append(",_st=").Append(stSb).Append(";\r\n");
            sb.Append("if(").Append(F("Active")).Append("==true){\r\n");
            if (critical) sb.Append("  if((").Append(F("Red")).Append("||").Append(F("Black")).Append(")&&!ph){solid('#000000');return leds;}\r\n");
            sb.Append("  var _i=-1,_c='#000000',_c2='#000000',_dp=0,_g='';\r\n");
            sb.Append("  if(").Append(F("Red")).Append("){_i=0;_c='#FF0000';}\r\n");
            sb.Append("  else if(").Append(F("Black")).Append("){_i=1;_c='#808080';_dp=1;}\r\n");
            sb.Append("  else if(").Append(F("SafetyCar")).Append("||").Append(F("VirtualSafetyCar")).Append("||").Append(F("FullCourseYellow")).Append("){_i=2;_c='#FFFF00';_g='SC';}\r\n");
            sb.Append("  else if(").Append(F("DoubleYellow")).Append("){_i=3;_c='#FFFF00';}\r\n");
            sb.Append("  else if(").Append(F("Yellow")).Append("){_i=4;_c='#FFFF00';}\r\n");
            sb.Append("  else if(").Append(F("White")).Append("||").Append(F("WhiteSlow")).Append("||").Append(F("WhiteFinal")).Append("){_i=5;_c='#FFFFFF';_g=").Append(F("WhiteFinal")).Append("?'FL':'SC';}\r\n");
            sb.Append("  else if(").Append(F("Orange")).Append("){_i=6;_c='#FF8C00';}\r\n");
            sb.Append("  else if(").Append(F("Debris")).Append("){_i=7;_c='#FF0000';_c2='#FFFF00';_g='DEBRIS';}\r\n");
            sb.Append("  else if(").Append(F("Blue")).Append("){_i=8;_c='#0000FF';}\r\n");
            sb.Append("  else if(").Append(F("Green")).Append("){_i=9;_c='#00FF00';}\r\n");
            sb.Append("  else if(").Append(F("Checkered")).Append("){_i=10;_c='#FFFFFF';_dp=1;}\r\n");
            sb.Append("  if(_i<0){solid('#000000');return leds;}\r\n");
            sb.Append("  _c=lift(_c);_c2=lift(_c2);\r\n");
            sb.Append("  var _pt=_sp[_i]>=0?_sp[_i]:_dp,_bl=_sb[_i]>=0?(_sb[_i]===1):(_pt!==0),_pd=_st[_i]>0?_st[_i]:").Append(phaseMs).Append(",fp=(Math.floor(now/_pd)%2)===0,gp=(Math.floor(now/700)%2)!==0,_ug=(").Append("_sp[_i]<0)?_g:'';\r\n");
            sb.Append("  if(_ug==='DEBRIS'){solid(lift('#FFFF00'));if(gp)gs(['#..#.','..#..','.#..#','#..#.','..#..','.#..#','#..#.'],_c);}\r\n");
            sb.Append("  else{if(_pt===0)solid(_bl&&!fp?'#000000':_c);else if(_pt===1)checker2(_c,_c2,_bl?fp:true);else rows2(_c,_c2,_bl?fp:true);if(gp){if(_ug==='SC')gs(['.....','##.##','#..#.','##.#.','.#.#.','##.##','.....'],'#101010');else if(_ug==='FL')gs(['.....','##.#.','#..#.','##.#.','#..#.','#..##','.....'],'#101010');}}\r\n");
            sb.Append("  return leds;\r\n}\r\n");

            // 2) Idle / engine-start.
            sb.Append("var gameOn=$prop('DataCorePlugin.GameRunning')==true;\r\n");
            sb.Append("if(!gameOn||rpmPct<=0.5){\r\n");
            if (b.IgnitionEngineStartupAnimation)
            {
                sb.Append("  if(rpmPct<=0.5&&gameOn){var t=Math.floor(now/60);\r\n");
                sb.Append(EngineStartJs(engineStyle)).Append("  return leds;}\r\n");
            }
            if (idleMode == 0) sb.Append("  solid('#000000');\r\n");
            else if (idleFramesJs != "null")
            {
                if (idleMode == 1)
                    sb.Append("  var IDF=").Append(idleFramesJs).Append(";var fr=IDF[0];for(var y=0;y<h;y++)for(var x=0;x<w;x++){var c=fr[y*w+x];leds[idx(x,y)]=dim((c&&c.length)?c:'#000000');}\r\n");
                else
                    sb.Append("  var IDF=").Append(idleFramesJs).Append(",IDD=").Append(idleDurJs).Append(";var tot=0,i;for(i=0;i<IDD.length;i++)tot+=IDD[i];var tt=tot>0?now%tot:0,fi=0;for(i=0;i<IDD.length;i++){if(tt<IDD[i]){fi=i;break;}tt-=IDD[i];}for(var y=0;y<h;y++)for(var x=0;x<w;x++){var c=IDF[fi][y*w+x];leds[idx(x,y)]=dim((c&&c.length)?c:'#000000');}\r\n");
            }
            else
            {
                sb.Append("  for(var y=0;y<h;y++)for(var x=0;x<w;x++)leds[idx(x,y)]=dim((((x+y+Math.floor(now/250))%2)===0)?'").Append(idleAccent).Append("':'#000000');\r\n");
            }
            sb.Append("  return leds;\r\n}\r\n");

            // 3) Paneel — kleurgradiënt (Top/Midden/Bottom); Custom werkt op toeren.
            var gearThemeId = (s != null && s.UniversalTheme) ? s.UniversalThemeId : b.GearColour;
            sb.Append("var gre=(rpmPct>=").Append(highPct).Append("),gbl=(gre&&").Append(redlineBehaviour == 2 ? "true" : "false").Append("&&!ph");
            if (s != null && s.LastGearRedlineOnly)
                sb.Append("&&(((").Append(G("CarSettings_MaxGears")).Append(")||0)>0&&(parseInt(''+").Append(G("Gear")).Append(",10)>=(").Append(G("CarSettings_MaxGears")).Append(")))");
            sb.Append(");\r\n");
            if (gearThemeId == FlagThemes.Custom)
            {
                sb.Append("var _pT=gre?'").Append(b.CustomGearRedlineColour1).Append("':'").Append(b.CustomGearColour1).Append("',_pM=gre?'").Append(b.CustomGearRedlineColour2).Append("':'").Append(b.CustomGearColour2).Append("',_pB=gre?'").Append(b.CustomGearRedlineColour3).Append("':'").Append(b.CustomGearColour3).Append("',_pc=").Append(b.CustomGearNumColours == 2 ? 2 : 3).Append(",_pb=0;\r\n");
            }
            else
            {
                var theme0 = FlagThemes.For(gearThemeId);
                sb.Append("var _pT,_pM,_pB,_pc=3,_pb=0;if(gre){_pT=_pM=_pB='").Append(b.RedlineColour).Append("';}else{_pT='").Append(theme0.Top).Append("';_pM='").Append(theme0.Middle).Append("';_pB='").Append(theme0.Bottom).Append("';_pb=").Append(theme0.Blend ? 1 : 0).Append(";}\r\n");
            }
            sb.Append("_pT=lift(_pT);_pM=lift(_pM);_pB=lift(_pB);\r\n");
            sb.Append("if(_pc===2)_pM=_pB;\r\n");
            sb.Append("function rc(f){f=f<0?0:(f>1?1:f);if(_pb)return lerp(_pT,_pB,f);return f<0.34?_pT:(f<0.67?_pM:_pB);}\r\n");

            if (b.ShowRedline)
                sb.Append("if(gbl){for(var x=0;x<w;x++)leds[idx(x,h-1)]='#101010';}else{var _bc=rc(rpmPct/100);for(var x=0;x<w;x++){var cp=(x+0.5)*100/w;leds[idx(x,h-1)]=dim((cp<=rpmPct&&cp>=").Append(barStart).Append(")?_bc:'#101010');}}\r\n");

            // Gear glyph.
            sb.Append("var FONTS=");
            if (!b.ShowRedline)
                sb.Append("{'0':['0110','1001','1001','1001','1001','0110'],'1':['0010','0110','0010','0010','0010','0111'],'2':['0110','1001','0001','0010','0100','1111'],'3':['1110','0001','0110','0001','0001','1110'],'4':['0010','0110','1010','1111','0010','0010'],'5':['1111','1000','1110','0001','0001','1110'],'6':['0110','1000','1110','1001','1001','0110'],'7':['1111','0001','0010','0100','0100','0100'],'8':['0110','1001','0110','1001','1001','0110'],'9':['0110','1001','1001','0111','0001','0110'],'N':['1001','1101','1011','1001','1001','1001'],'R':['1110','1001','1110','1010','1001','1001'],'-':['0000','0000','1111','0000','0000','0000']};");
            else if (style == 1) sb.Append("{'0':['11','11','11','11','11'],'1':['01','11','01','01','01'],'2':['11','01','11','10','11'],'3':['11','01','11','01','11'],'4':['10','10','11','01','01'],'5':['11','10','11','01','11'],'6':['11','10','11','11','11'],'7':['11','01','01','01','01'],'8':['11','11','11','11','11'],'9':['11','11','11','01','11'],'N':['10','11','11','11','10'],'R':['11','10','11','10','10'],'-':['00','00','11','00','00']};");
            else sb.Append("{'0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],'3':['111','001','111','001','111'],'4':['101','101','111','001','001'],'5':['111','100','111','001','111'],'6':['111','100','111','101','111'],'7':['111','001','001','001','001'],'8':['111','101','111','101','111'],'9':['111','101','111','001','111'],'N':['101','111','111','111','101'],'R':['111','101','110','101','101'],'-':['000','000','111','000','000']};");
            sb.Append("\r\n");
            {
                var LA = G("SpotterCarLeft"); var RA = G("SpotterCarRight");
                var spot = b.Spotters
                    ? "((((" + spotterSide + "===1)&&(" + LA + "==true||" + RA + "==true))||((" + spotterSide + "===2)&&" + LA + "==true)||((" + spotterSide + "===3)&&" + RA + "==true)))"
                    : "false";
                sb.Append("var _l=").Append(LA).Append("==true,_r=").Append(RA).Append("==true;");
                sb.Append("var _spot=").Append(spot).Append(";var _smode=").Append(b.SpotterMode)
                  .Append(",_sbl=").Append(b.SpotterBlink ? "1" : "0").Append(",_san=").Append(b.SpotterAnimation)
                  .Append(",_svis=_spot&&(_san?true:(_smode===2?ph:(_sbl?ph:true))),_gvis=!(_spot&&(_san||_smode===0||(_smode===2&&ph)));\r\n");
            }
            sb.Append("var gs=''+").Append(G("Gear")).Append(";var ch=gs.length?gs.charAt(0):'-';var gl=FONTS[ch];\r\n");
            if (inverted) sb.Append("if(!gbl)solid(rc(0.5));\r\n");
            sb.Append("var _loc=").Append(b.ShowRedline ? location : 0).Append(";");
            if (b.SpotterShiftsGear) sb.Append("if(_svis&&!_san){if(").Append(spotterSide).Append("===2)_loc=1;else if(").Append(spotterSide).Append("===3)_loc=2;}");
            sb.Append("\r\n");
            sb.Append("if(gl&&!gbl&&_gvis){var gw=gl[0].length,gh=gl.length,oy=Math.floor((h-gh)/2);if(oy<0)oy=0;var ink=").Append(inverted ? "'#000000'" : "rc(rpmPct/100)").Append(";var oxs=[];if(_loc===2||_loc===3)oxs.push(0);if(_loc===1||_loc===3)oxs.push(w-gw);if(oxs.length===0)oxs.push(Math.floor((w-gw)/2));for(var oi=0;oi<oxs.length;oi++){var ox=oxs[oi];for(var y=0;y<gh;y++)for(var x=0;x<gw;x++)if(gl[y].charAt(x)==='1'){set(ox+x,oy+y,ink);").Append(b.ShowRedline && style == 2 ? "set(ox+x+1,oy+y,ink);" : "").Append(";}}}\r\n");

            // Spotter.
            if (b.Spotters)
            {
                sb.Append("if(_svis){var AL=['.....','..#..','.#...','#####','.#...','..#..','.....'],AB=['.....','..#..','.#.#.','#####','.#.#.','..#..','.....'];")
                  .Append("var _tr=(").Append(spotterSide).Append("===3)?true:((").Append(spotterSide).Append("===2)?false:(_r&&!_l));")
                  .Append("var art=(!_san&&").Append(spotterSide).Append("===1)?AB:(_tr?AL.map(function(r){return r.split('').reverse().join('');}):AL);")
                  .Append("var gh=art.length,gw=0,i;for(i=0;i<gh;i++)if(art[i].length>gw)gw=art[i].length;var sp=w-gw;")
                  .Append("var gx=!_san?(").Append(spotterSide).Append("===2?0:(").Append(spotterSide).Append("===3?sp:Math.floor(sp/2))):Math.round((_tr?(now%900)/900:(1-(now%900)/900))*sp);")
                  .Append("var gy=Math.floor((h-gh)/2);if(gy<0)gy=0;")
                  .Append("for(var yy=0;yy<gh;yy++)for(var xx=0;xx<art[yy].length;xx++)if(art[yy].charAt(xx)==='#')set(gx+xx,gy+yy,lift('").Append((s != null && !string.IsNullOrEmpty(s.SpotterColour)) ? s.SpotterColour : "#FF1493").Append("'));}\r\n");
            }

            // Pit limiter.
            if (b.Pit)
            {
                sb.Append("if(").Append(G("PitLimiterOn")).Append("==true){\r\n");
                sb.Append(PitLimiterJs(pitStyle));
                if (b.PitCountdown) sb.Append("  var pf=Math.min(w,Math.floor(now/1000)%w);for(var x=0;x<w;x++)set(x,0,x<pf?'#2FD1FF':'#000000');\r\n");
                sb.Append("}\r\n");
            }

            // Waarschuwingen.
            if (b.TemperatureWarning || b.LowFuel)
            {
                sb.Append("var warn=false;\r\n");
                if (b.LowFuel) sb.Append("warn=warn||(").Append(G("LowFuelAlert")).Append("==true)||((").Append(G("FuelPercent")).Append("||-1)>=0&&(").Append(G("FuelPercent")).Append("<=1?(").Append(G("FuelPercent")).Append("*100):").Append(G("FuelPercent")).Append(")<").Append(lowFuel).Append(");\r\n");
                if (b.TemperatureWarning) sb.Append("warn=warn||((").Append(G("WaterTemperature")).Append("||0)>=").Append(tempWater).Append(")||((").Append(G("OilTemperature")).Append("||0)>=").Append(tempOil).Append(");\r\n");
                sb.Append("if(warn&&ph)border('#FF0000');\r\n");
            }
            sb.Append("return leds;\r\n");
            return sb.ToString();
        }

        private static string EngineStartJs(int style)
        {
            switch (style)
            {
                case 0: return "for(var i=0;i<Math.floor(w*h/3);i++){set((i*7+t*3)%w,(i*5+t*2)%h,(i%2===0)?'"+FlagThemes.For(1).Top+"':'#00AFFF');}";
                case 1: return "var fl=Math.min(h,Math.floor(t/4)%(h+1));for(var yy=h-fl;yy<h;yy++)for(var xx=0;xx<w;xx++)set(xx,yy,'#FF8C00');";
                case 2: return "var rd=Math.floor(t/3)%(Math.max(w,h)+1);for(var yy=0;yy<h;yy++)for(var xx=0;xx<w;xx++){var dx=xx-(w-1)/2,dy=yy-(h-1)/2;if(Math.sqrt(dx*dx+dy*dy)<=rd)set(xx,yy,'#00AFFF');}";
                default: return "if(Math.floor(t/6)%2===0)solid('#00AFFF');";
            }
        }

        private static string PitLimiterJs(int style)
        {
            switch (style)
            {
                case 0: return "  for(var y=0;y<h;y++)for(var x=0;x<w;x++)if((y%2===0)===ph)set(x,y,'#0000FF');\r\n";
                case 1: return "  border('#001040');var ws=bc(Math.floor(now/120));set(ws[0],ws[1],'#0000FF');\r\n";
                case 2: return "  if(!ph)solid('#0000FF');\r\n";
                case 3: return "  for(var y=0;y<h;y++)for(var x=0;x<w;x++)if((x+y)%2===0)set(x,y,'#0000FF');\r\n";
                default: return "  var sp=2*w-2;var pp=Math.floor(now/120)%sp;var bx=pp<w?pp:sp-pp;for(var x=0;x<w;x++)if(x===bx)for(var y=0;y<h;y++)set(x,y,'#0000FF');\r\n";
            }
        }

        // ----- strip -----

        public static JObject BuildStripProfile(FlagSettings s, string propertyPrefix, int box, int ledCount, int blinkDelay = 400)
        {
            if (ledCount < 1) ledCount = 8;
            var b = s == null ? new FlagBoxSlot() : s.Box(box - 1);
            var prefix = (string.IsNullOrWhiteSpace(propertyPrefix) ? "THREESM.Flags" : propertyPrefix.Trim()) + ".Box" + box;
            var containers = new JArray();

            containers.Add(StripGroup("off", "Black", null, blinkDelay, ledCount, "return true"));
            if (b.LowFuel || b.TemperatureWarning)
                containers.Add(StripGroup("warn", "Red", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.LowFuelAlert') == true"));
            if (b.Pit)
                containers.Add(StripGroup("pit", "Blue", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.PitLimiterOn') == true"));
            if (b.Spotters)
            {
                containers.Add(StripGroup("spotter-left", "Yellow", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.SpotterCarLeft') == true"));
                containers.Add(StripGroup("spotter-right", "Yellow", "Black", blinkDelay, ledCount, "return $prop('DataCorePlugin.GameData.NewData.SpotterCarRight') == true"));
            }
            containers.Add(StripGroup("checkered", "White", "Black", blinkDelay, ledCount, "return " + Prop(prefix, "Checkered") + " == true"));
            containers.Add(StripGroup("green", "Green", null, blinkDelay, ledCount, "return " + Prop(prefix, "Green") + " == true"));
            containers.Add(StripGroup("blue", "Blue", null, blinkDelay, ledCount, "return " + Prop(prefix, "Blue") + " == true"));
            containers.Add(StripGroup("debris", "Red", "Yellow", blinkDelay, ledCount, "return " + Prop(prefix, "Debris") + " == true"));
            containers.Add(StripGroup("orange", "Orange", null, blinkDelay, ledCount, "return " + Prop(prefix, "Orange") + " == true"));
            containers.Add(StripGroup("white", "White", null, blinkDelay, ledCount, "return " + Prop(prefix, "White") + " == true || " + Prop(prefix, "WhiteSlow") + " == true || " + Prop(prefix, "WhiteFinal") + " == true"));
            containers.Add(StripGroup("yellow", "Yellow", null, blinkDelay, ledCount, "return " + Prop(prefix, "Yellow") + " == true || " + Prop(prefix, "DoubleYellow") + " == true"));
            containers.Add(StripGroup("safetycar", "Yellow", "Black", blinkDelay, ledCount, "return " + Prop(prefix, "SafetyCar") + " == true || " + Prop(prefix, "VirtualSafetyCar") + " == true || " + Prop(prefix, "FullCourseYellow") + " == true"));
            containers.Add(StripGroup("black", "Grey", "Black", blinkDelay, ledCount, "return " + Prop(prefix, "Black") + " == true"));
            containers.Add(StripGroup("red", "Red", null, blinkDelay, ledCount, "return " + Prop(prefix, "Red") + " == true"));
            return ProfileShell(containers);
        }

        private static string Prop(string prefix, string name) { return "$prop('" + prefix + "." + name + "')"; }

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
