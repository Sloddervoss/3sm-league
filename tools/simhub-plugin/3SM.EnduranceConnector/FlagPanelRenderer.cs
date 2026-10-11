using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    // C#-spiegel van het gegenereerde JS-paneel. Volgt DNR's model: patronen wisselen
    // tussen twee frames; effen kleuren blijven. Per-box instellingen, gear-thema's,
    // gear-stijlen/locatie, idle-tekening, engine-start en pit-limiter-stijlen.
    public static class FlagPanelRenderer
    {
        public sealed class PanelInput
        {
            public RaceFlags Flags = RaceFlags.None;
            public bool InGame;
            public string Gear;
            public double RpmsPercent;
            public bool PitLimiter;
            public double PitLimiterSeconds;
            public bool SpotterLeft;
            public bool SpotterRight;
            public bool Warn;                 // LowFuelAlert
            public double FuelPercent = -1;   // <0 = onbekend
            public double WaterTemp;
            public double OilTemp;
            public bool EngineOff;
            public bool IsLastGear;
            public long NowMs;
        }

        // 3x5 (as shipped), 2x5 (slim), 3x5 dik (bold = met schaduw).
        private static readonly Dictionary<char, string[]> Font3x5 = new Dictionary<char, string[]>
        {
            { '0', new[] { "111", "101", "101", "101", "111" } },
            { '1', new[] { "010", "110", "010", "010", "111" } },
            { '2', new[] { "111", "001", "111", "100", "111" } },
            { '3', new[] { "111", "001", "111", "001", "111" } },
            { '4', new[] { "101", "101", "111", "001", "001" } },
            { '5', new[] { "111", "100", "111", "001", "111" } },
            { '6', new[] { "111", "100", "111", "101", "111" } },
            { '7', new[] { "111", "001", "001", "001", "001" } },
            { '8', new[] { "111", "101", "111", "101", "111" } },
            { '9', new[] { "111", "101", "111", "001", "111" } },
            { 'N', new[] { "101", "111", "111", "111", "101" } },
            { 'R', new[] { "111", "101", "110", "101", "101" } },
            { '-', new[] { "000", "000", "111", "000", "000" } },
        };

        private static readonly Dictionary<char, string[]> Font2x5 = new Dictionary<char, string[]>
        {
            { '0', new[] { "11", "11", "11", "11", "11" } },
            { '1', new[] { "01", "11", "01", "01", "01" } },
            { '2', new[] { "11", "01", "11", "10", "11" } },
            { '3', new[] { "11", "01", "11", "01", "11" } },
            { '4', new[] { "10", "10", "11", "01", "01" } },
            { '5', new[] { "11", "10", "11", "01", "11" } },
            { '6', new[] { "11", "10", "11", "11", "11" } },
            { '7', new[] { "11", "01", "01", "01", "01" } },
            { '8', new[] { "11", "11", "11", "11", "11" } },
            { '9', new[] { "11", "11", "11", "01", "11" } },
            { 'N', new[] { "10", "11", "11", "11", "10" } },
            { 'R', new[] { "11", "10", "11", "10", "10" } },
            { '-', new[] { "00", "00", "11", "00", "00" } },
        };

        private static readonly Dictionary<char, string[]> Font4x6 = new Dictionary<char, string[]>
        {
            { '0', new[] { "0110", "1001", "1001", "1001", "1001", "0110" } },
            { '1', new[] { "0010", "0110", "0010", "0010", "0010", "0111" } },
            { '2', new[] { "0110", "1001", "0001", "0010", "0100", "1111" } },
            { '3', new[] { "1110", "0001", "0110", "0001", "0001", "1110" } },
            { '4', new[] { "0010", "0110", "1010", "1111", "0010", "0010" } },
            { '5', new[] { "1111", "1000", "1110", "0001", "0001", "1110" } },
            { '6', new[] { "0110", "1000", "1110", "1001", "1001", "0110" } },
            { '7', new[] { "1111", "0001", "0010", "0100", "0100", "0100" } },
            { '8', new[] { "0110", "1001", "0110", "1001", "1001", "0110" } },
            { '9', new[] { "0110", "1001", "1001", "0111", "0001", "0110" } },
            { 'N', new[] { "1001", "1101", "1011", "1001", "1001", "1001" } },
            { 'R', new[] { "1110", "1001", "1110", "1010", "1001", "1001" } },
            { '-', new[] { "0000", "0000", "1111", "0000", "0000", "0000" } },
        };

        public static string[] Frame(int columns, int rows, PanelInput input, FlagBoxSlot box, FlagSettings global)
        {
            var leds = new string[columns * rows];
            Solid(leds, "#000000");
            if (input == null) return leds;

            var phaseMs = (global != null && global.FlagPhaseMs > 0) ? global.FlagPhaseMs : 250;
            var phase = (input.NowMs / phaseMs) % 2 == 0;
            var brightness = Clamp01(((box != null ? box.Brightness : 100)) / 100.0);
            var showGear = box == null || box.Gears;
            var showRedline = box == null || box.ShowRedline;
            var showSpotter = box == null || box.Spotters;
            var showPit = box == null || box.Pit;
            var showWarn = box == null || box.TemperatureWarning || box.LowFuel;
            var idleMode = box != null ? box.IdleScreen : 2;

            // 1) Vlaggen (met optionele kritieke-vlag-blink).
            if (input.Flags != RaceFlags.None)
            {
                int idx; string colour, colour2; int defPattern; string glyph;
                Primary(input.Flags, out idx, out colour, out colour2, out defPattern, out glyph);
                var style = box != null ? box.StyleOf(idx) : null;
                var patternOverridden = style != null && style.Pattern >= 0;
                var pattern = patternOverridden ? style.Pattern : defPattern;
                var useGlyph = patternOverridden ? "" : glyph;
                var blink = style != null && style.Blink >= 0 ? style.Blink == 1 : pattern != 0;
                var period = style != null && style.BlinkMs > 0 ? style.BlinkMs : phaseMs;
                var fph = (input.NowMs / period) % 2 == 0;
                var glyphPage = (input.NowMs / 700) % 2 != 0;
                var critical = Has(input.Flags, RaceFlags.Red) || Has(input.Flags, RaceFlags.Black);
                if (critical && (box == null || box.CriticalFlags) && !phase) { Solid(leds, "#000000"); return leds; }
                PaintStyled(leds, columns, rows, colour, colour2, pattern, blink, fph, useGlyph, glyphPage);
                ApplyBrightness(leds, brightness);
                return leds;
            }

            // 2) Idle (geen game, engine uit, of idle-scherm actief).
            if (!input.InGame || input.EngineOff)
            {
                Idle(leds, columns, rows, input, box, global, idleMode, phase);
                ApplyBrightness(leds, brightness);
                return leds;
            }

            // 3) Paneel.
            var spotterSide = box == null || box.SpotterSide <= 0 ? 1 : box.SpotterSide;
            var spotterActive = showSpotter && (
                (spotterSide == 1 && (input.SpotterLeft || input.SpotterRight))
                || (spotterSide == 2 && input.SpotterLeft)
                || (spotterSide == 3 && input.SpotterRight));
            var spotterMode = box != null ? box.SpotterMode : 2;

            var spotterAnimate = box == null || box.SpotterAnimation != 0;
            var spotterBlink = box == null || box.SpotterBlink;
            var arrowVisible = spotterActive && (spotterAnimate || (spotterMode == 2 ? phase : (!spotterBlink || phase)));
            // Glijdende pijl loopt over het hele paneel -> verberg dan de gear (anders overlap op 8x8).
            var gearVisible = showGear && !(spotterActive && (spotterAnimate || spotterMode == 0 || (spotterMode == 2 && phase)));

            if (showRedline) DrawRevBar(leds, columns, rows, input, box, global, phase);
            var gearAvoid = (arrowVisible && !spotterAnimate && (box == null || box.SpotterShiftsGear)) ? spotterSide : 0;
            if (gearVisible) DrawGear(leds, columns, rows, input, box, global, phase, gearAvoid);
            if (arrowVisible) DrawSpotter(leds, columns, rows, spotterSide, input.SpotterLeft, input.SpotterRight, spotterAnimate, input.NowMs, global != null ? global.SpotterColour : null);
            if (showPit && input.PitLimiter) PitLimiter(leds, columns, rows, input, box, phase);
            if (showWarn && (input.NowMs / 1000) % 2 == 0)
            {
                if (WarnIsTemp(box, global, input)) GlyphCentered(leds, columns, rows, TempArt, "#FFA500");
                else if (WarnActive(box, global, input)) GlyphCentered(leds, columns, rows, LowFuelArt, "#FF0000");
            }

            ApplyBrightness(leds, brightness);
            return leds;
        }

        public static string[] FrameStrip(int ledCount, PanelInput input, FlagBoxSlot box, FlagSettings global)
        {
            if (ledCount < 1) ledCount = 8;
            var leds = new string[ledCount];
            for (var i = 0; i < leds.Length; i++) leds[i] = "#000000";
            if (input == null) return leds;

            var phaseMs = (global != null && global.FlagPhaseMs > 0) ? global.FlagPhaseMs : 250;
            var phase = (input.NowMs / phaseMs) % 2 == 0;
            var brightness = Clamp01((box != null ? box.Brightness : 100) / 100.0);

            if (input.Flags != RaceFlags.None)
            {
                int idx; string colour, colour2; int defPattern; string glyph;
                Primary(input.Flags, out idx, out colour, out colour2, out defPattern, out glyph);
                var style = box != null ? box.StyleOf(idx) : null;
                var pattern = style != null && style.Pattern >= 0 ? style.Pattern : defPattern;
                var fBlink = style != null && style.Blink >= 0 ? style.Blink == 1 : pattern != 0;
                var fPeriod = style != null && style.BlinkMs > 0 ? style.BlinkMs : phaseMs;
                var fph = (input.NowMs / fPeriod) % 2 == 0;
                var critical = Has(input.Flags, RaceFlags.Red) || Has(input.Flags, RaceFlags.Black);
                if (critical && (box == null || box.CriticalFlags) && !phase) { ApplyBrightness(leds, brightness); return leds; }
                if (!fBlink || fph) Solid(leds, Lift(colour));
                ApplyBrightness(leds, brightness);
                return leds;
            }

            var showWarn = box == null || box.TemperatureWarning || box.LowFuel;
            var showPit = box == null || box.Pit;
            var showSpotter = box == null || box.Spotters;
            var blink = box == null || box.PitLimiterStyle != 2;
            if (showWarn && WarnActive(box, global, input) && phase) Solid(leds, "#FF0000");
            else if (showPit && input.PitLimiter && (blink || phase)) Solid(leds, "#0000FF");
            else if (showSpotter && (input.SpotterLeft || input.SpotterRight) && phase) Solid(leds, "#FFFF00");
            ApplyBrightness(leds, brightness);
            return leds;
        }

        // ---- helpers ----

        private static bool WarnIsTemp(FlagBoxSlot box, FlagSettings global, PanelInput input)
        {
            if (box != null && !box.TemperatureWarning) return false;
            if (input.WaterTemp > 0 && input.WaterTemp >= (global != null ? global.TempWarnWater : 110)) return true;
            if (input.OilTemp > 0 && input.OilTemp >= (global != null ? global.TempWarnOil : 120)) return true;
            return false;
        }

        private static bool WarnActive(FlagBoxSlot box, FlagSettings global, PanelInput input)
        {
            if (input.Warn && (box == null || box.LowFuel)) return true;
            var fuelPct = global != null ? global.LowFuelPercent : 15;
            if ((box == null || box.LowFuel) && input.FuelPercent >= 0 && input.FuelPercent < fuelPct) return true;
            if (box == null || box.TemperatureWarning)
            {
                if (input.WaterTemp > 0 && input.WaterTemp >= (global != null ? global.TempWarnWater : 110)) return true;
                if (input.OilTemp > 0 && input.OilTemp >= (global != null ? global.TempWarnOil : 120)) return true;
            }
            return false;
        }

        private static void Palette(FlagBoxSlot box, PanelInput input, FlagSettings global, out string top, out string mid, out string bot, out bool blend)
        {
            var high = box != null ? box.RedlineHighPct : 95;
            var atRedline = input.RpmsPercent >= high;
            var themeId = (global != null && global.UniversalTheme) ? global.UniversalThemeId : (box != null ? box.GearColour : 2);
            if (themeId == FlagThemes.Custom && box != null)
            {
                if (atRedline) { top = box.CustomGearRedlineColour1; mid = box.CustomGearRedlineColour2; bot = box.CustomGearRedlineColour3; }
                else { top = box.CustomGearColour1; mid = box.CustomGearColour2; bot = box.CustomGearColour3; }
                if (box.CustomGearNumColours == 2) mid = bot;
                blend = false;
            }
            else
            {
                var theme = FlagThemes.For(themeId);
                if (atRedline)
                {
                    // Thema's: bij redline de eigen redline-kleur (default rood).
                    var rl = (box != null ? box.RedlineColour : "#FF0000") ?? "#FF0000";
                    top = mid = bot = rl; blend = false;
                }
                else { top = theme.Top; mid = theme.Middle; bot = theme.Bottom; blend = theme.Blend; }
            }
            top = Lift(top); mid = Lift(mid); bot = Lift(bot);
        }

        private static bool BlinkOff(FlagBoxSlot box, PanelInput input, FlagSettings global, bool phase)
        {
            var high = box != null ? box.RedlineHighPct : 95;
            var behaviour = box != null ? box.RedlineBehaviour : 2;
            if (global != null && global.LastGearRedlineOnly && !input.IsLastGear) return false;
            return input.RpmsPercent >= high && behaviour == 2 && !phase;
        }

        private static string RowColour(string top, string mid, string bot, bool blend, double f)
        {
            f = f < 0 ? 0 : f > 1 ? 1 : f;
            if (blend) return Lerp(top, bot, f);
            return f < 0.34 ? top : f < 0.67 ? mid : bot;
        }

        private static void DrawRevBar(string[] leds, int columns, int rows, PanelInput input, FlagBoxSlot box, FlagSettings global, bool phase)
        {
            var start = box != null ? box.RedlineBarStartPct : 0;
            if (BlinkOff(box, input, global, phase))
            {
                for (var x = 0; x < columns; x++) leds[Idx(columns, x, rows - 1)] = "#101010";
                return;
            }
            string top, mid, bot; bool blend;
            Palette(box, input, global, out top, out mid, out bot, out blend);
            var colour = RowColour(top, mid, bot, blend, input.RpmsPercent / 100.0);
            for (var x = 0; x < columns; x++)
            {
                var cell = (x + 0.5) * 100.0 / columns;
                leds[Idx(columns, x, rows - 1)] = (cell <= input.RpmsPercent && cell >= start) ? colour : "#101010";
            }
        }

        private static string Lerp(string a, string b, double t)
        {
            int r1, g1, b1, r2, g2, b2;
            if (!TryRgb(a, out r1, out g1, out b1) || !TryRgb(b, out r2, out g2, out b2)) return a;
            t = Math.Max(0, Math.Min(1, t));
            return ToHex((int)Math.Round(r1 + (r2 - r1) * t), (int)Math.Round(g1 + (g2 - g1) * t), (int)Math.Round(b1 + (b2 - b1) * t));
        }

        private static bool TryRgb(string c, out int r, out int g, out int b)
        {
            r = g = b = 0;
            if (string.IsNullOrEmpty(c) || c[0] != '#') return false;
            var t = c.Substring(1);
            if (t.Length == 8) t = t.Substring(2); // AARRGGBB -> RRGGBB
            if (t.Length != 6) return false;
            r = ParseHex(t.Substring(0, 2)); g = ParseHex(t.Substring(2, 2)); b = ParseHex(t.Substring(4, 2));
            return true;
        }

        private static int ParseHex(string s)
        {
            int v;
            return int.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out v) ? v : 0;
        }

        private static void Idle(string[] leds, int columns, int rows, PanelInput input, FlagBoxSlot box, FlagSettings global, int mode, bool phase)
        {
            if (mode == 0) { Solid(leds, "#000000"); return; }

            // Engine-start animatie.
            if (input.EngineOff && box != null && box.IgnitionEngineStartupAnimation)
            {
                EngineStart(leds, columns, rows, input, box, (int)(input.NowMs / 60));
                return;
            }

            // Eigen 3SM-idle-kunst in de gekozen themakleur: Static = frame 0, Animated/Custom = cyclus.
            var idleTheme = FlagThemes.For(box != null ? box.IdleAnimationColour : 1);
            var art = MatrixArt.Parse(FlagIdleArt.Effective(box, mode, idleTheme.Top));
            if (art != null && art.Frames.Count > 0)
            {
                if (mode == 1) MatrixArt.DrawFrame(leds, columns, rows, art, 0);
                else MatrixArt.Draw(leds, columns, rows, art, input.NowMs);
                return;
            }

            // Fallback: accentkleur-patroon.
            var accent = idleTheme.Middle;
            for (var y = 0; y < rows; y++)
                for (var x = 0; x < columns; x++)
                    Set(leds, columns, rows, x, y, ((x + y + (int)(input.NowMs / 250)) % 2 == 0) ? accent : "#000000");
        }

        private static (int, int) BorderCell(int step, int columns, int rows)
        {
            var span = 2 * columns + 2 * rows - 4;
            step = ((step % span) + span) % span;
            if (step < columns) return (step, 0);
            step -= columns;
            if (step < rows - 1) return (columns - 1, step + 1);
            step -= rows - 1;
            if (step < columns - 1) return (columns - 2 - step, rows - 1);
            step -= columns - 1;
            return (0, rows - 2 - step);
        }

        private static void EngineStart(string[] leds, int columns, int rows, PanelInput input, FlagBoxSlot box, int t)
        {
            Solid(leds, "#000000");
            var style = box.EngineStartStyle;
            var theme = FlagThemes.For(box.GearColour);
            switch (style)
            {
                case 0: // Spark shower
                    for (var i = 0; i < columns * rows / 3; i++)
                    {
                        var x = (i * 7 + t * 3) % columns;
                        var y = (i * 5 + t * 2) % rows;
                        Set(leds, columns, rows, x, y, (i % 2 == 0) ? theme.Top : theme.Bottom);
                    }
                    break;
                case 1: // Fill up
                    {
                        var filled = Math.Min(rows, t / 4 % (rows + 1));
                        for (var y = rows - filled; y < rows; y++)
                            for (var x = 0; x < columns; x++) Set(leds, columns, rows, x, y, theme.Middle);
                        break;
                    }
                case 2: // From the centre
                    {
                        var rad = t / 3 % (Math.Max(columns, rows) + 1);
                        for (var y = 0; y < rows; y++)
                            for (var x = 0; x < columns; x++)
                            {
                                var dx = x - (columns - 1) / 2.0;
                                var dy = y - (rows - 1) / 2.0;
                                if (Math.Sqrt(dx * dx + dy * dy) <= rad) Set(leds, columns, rows, x, y, theme.Top);
                            }
                        break;
                    }
                case 3: // Pulse
                    {
                        var on = (t / 6) % 2 == 0;
                        if (on) Solid(leds, theme.Middle);
                        break;
                    }
                case 4: // Icon
                    GlyphCentered(leds, columns, rows, EngineStartArt, "#FF4500");
                    break;
                default: // Pulse
                    {
                        var on = (t / 6) % 2 == 0;
                        if (on) Solid(leds, theme.Middle);
                        break;
                    }
            }
        }

        private static void PitLimiter(string[] leds, int columns, int rows, PanelInput input, FlagBoxSlot box, bool phase)
        {
            var style = box != null ? box.PitLimiterStyle : 0;
            const string blue = "#0000FF";
            switch (style)
            {
                case 0: // Alternating bands
                    for (var y = 0; y < rows; y++)
                        for (var x = 0; x < columns; x++)
                            if ((y % 2 == 0) == phase) Set(leds, columns, rows, x, y, blue);
                    break;
                case 1: // Walking light
                    Border(leds, columns, rows, "#001040");
                    var step = (int)((input.NowMs / 120) % (2 * columns + 2 * rows - 4));
                    var (wx, wy) = BorderCell(step, columns, rows);
                    Set(leds, columns, rows, wx, wy, blue);
                    break;
                case 2: // Flash together
                    if (!phase) Solid(leds, blue);
                    break;
                case 3: // Checker
                    for (var y = 0; y < rows; y++)
                        for (var x = 0; x < columns; x++)
                            if ((x + y) % 2 == 0) Set(leds, columns, rows, x, y, blue);
                    break;
                default: // Bounce
                    {
                        var span = 2 * columns - 2;
                        var p = (int)((input.NowMs / 120) % span);
                        var bx = p < columns ? p : span - p;
                        for (var x = 0; x < columns; x++)
                            if (x == bx) for (var y = 0; y < rows; y++) Set(leds, columns, rows, x, y, blue);
                        break;
                    }
            }
            if (box == null || box.PitCountdown)
            {
                var filled = Math.Min(columns, (int)Math.Max(0, input.PitLimiterSeconds));
                for (var x = 0; x < filled; x++) Set(leds, columns, rows, x, 0, "#2FD1FF");
            }
        }

        // Bepaalt de primaire (hoogste prioriteit) vlag, kleur, tweede kleur, standaardpatroon en glyph.
        private static void Primary(RaceFlags f, out int index, out string colour, out string colour2, out int defPattern, out string glyph)
        {
            colour2 = "#000000";
            glyph = "";
            if (Has(f, RaceFlags.Red)) { index = FlagSlotIndex.Red; colour = "#FF0000"; defPattern = 0; return; }
            if (Has(f, RaceFlags.Black)) { index = FlagSlotIndex.Black; colour = "#808080"; defPattern = 1; return; }
            if (Has(f, RaceFlags.SafetyCar) || Has(f, RaceFlags.VirtualSafetyCar) || Has(f, RaceFlags.FullCourseYellow)) { index = FlagSlotIndex.SafetyCar; colour = "#FFFF00"; defPattern = 0; glyph = "SC"; return; }
            if (Has(f, RaceFlags.DoubleYellow)) { index = FlagSlotIndex.DoubleYellow; colour = "#FFFF00"; defPattern = 0; return; }
            if (Has(f, RaceFlags.Yellow)) { index = FlagSlotIndex.Yellow; colour = "#FFFF00"; defPattern = 0; return; }
            if (Has(f, RaceFlags.White) || Has(f, RaceFlags.WhiteSlow) || Has(f, RaceFlags.WhiteFinal))
            {
                index = FlagSlotIndex.White; colour = "#FFFFFF"; defPattern = 0;
                glyph = Has(f, RaceFlags.WhiteFinal) ? "FL" : "SC";
                return;
            }
            if (Has(f, RaceFlags.Orange)) { index = FlagSlotIndex.Orange; colour = "#FF8C00"; defPattern = 0; return; }
            if (Has(f, RaceFlags.Debris)) { index = FlagSlotIndex.Debris; colour = "#FF0000"; colour2 = "#FFFF00"; defPattern = 0; glyph = "DEBRIS"; return; }
            if (Has(f, RaceFlags.Blue)) { index = FlagSlotIndex.Blue; colour = "#0000FF"; defPattern = 0; return; }
            if (Has(f, RaceFlags.Green)) { index = FlagSlotIndex.Green; colour = "#00FF00"; defPattern = 0; return; }
            if (Has(f, RaceFlags.Checkered)) { index = FlagSlotIndex.Checkered; colour = "#FFFFFF"; defPattern = 1; return; }
            index = -1; colour = "#000000"; defPattern = 0;
        }

        private static void PaintStyled(string[] leds, int columns, int rows, string colour, string colour2, int pattern, bool blink, bool ph, string glyph, bool glyphPage)
        {
            var c1 = Lift(colour);
            var c2 = Lift(colour2);
            if (glyph == "DEBRIS") { Solid(leds, Lift("#FFFF00")); if (glyphPage) GlyphCentered(leds, columns, rows, DebrisStripes, "#FF0000"); return; }
            if (pattern == 0) Solid(leds, blink && !ph ? "#000000" : c1);
            else if (pattern == 1) Checker2(leds, columns, rows, c1, c2, blink ? ph : true);
            else Rows2(leds, columns, rows, c1, c2, blink ? ph : true);
            if (glyphPage && glyph == "SC") GlyphCentered(leds, columns, rows, LettersSC, "#101010");
            else if (glyphPage && glyph == "FL") GlyphCentered(leds, columns, rows, LettersFL, "#101010");
        }

        private static int Idx(int columns, int x, int y) { return y * columns + x; }
        private static bool Has(RaceFlags f, RaceFlags bit) { return (f & bit) == bit; }

        private static void Solid(string[] leds, string colour)
        {
            for (var i = 0; i < leds.Length; i++) leds[i] = colour;
        }

        private static void Checker2(string[] leds, int columns, int rows, string a, string b, bool phase)
        {
            var c1 = phase ? a : b;
            var c2 = phase ? b : a;
            for (var y = 0; y < rows; y++)
                for (var x = 0; x < columns; x++)
                    leds[Idx(columns, x, y)] = ((x + y) % 2 == 0) ? c1 : c2;
        }

        private static void Rows2(string[] leds, int columns, int rows, string a, string b, bool phase)
        {
            var c1 = phase ? a : b;
            var c2 = phase ? b : a;
            for (var y = 0; y < rows; y++)
                for (var x = 0; x < columns; x++)
                    leds[Idx(columns, x, y)] = (y % 2 == 0) ? c1 : c2;
        }

        private static void Set(string[] leds, int columns, int rows, int x, int y, string colour)
        {
            if (x >= 0 && x < columns && y >= 0 && y < rows) leds[Idx(columns, x, y)] = colour;
        }

        private static void Border(string[] leds, int columns, int rows, string colour)
        {
            for (var x = 0; x < columns; x++) { Set(leds, columns, rows, x, 0, colour); Set(leds, columns, rows, x, rows - 1, colour); }
            for (var y = 0; y < rows; y++) { Set(leds, columns, rows, 0, y, colour); Set(leds, columns, rows, columns - 1, y, colour); }
        }

        // DNR-spotter: pijl in #FF1493. Links = naar links, Rechts = gespiegeld, Beide = dubbelpijl.
        private static readonly string[] ArrowLeft = { ".....", "..#..", ".#...", "#####", ".#...", "..#..", "....." };
        private static readonly string[] ArrowBoth = { ".....", "..#..", ".#.#.", "#####", ".#.#.", "..#..", "....." };
        private static readonly string[] LettersSC = { ".....", "##.##", "#..#.", "##.#.", ".#.#.", "##.##", "....." };
        private static readonly string[] LettersFL = { ".....", "##.#.", "#..#.", "##.#.", "#..#.", "#..##", "....." };
        private static readonly string[] DebrisStripes = { "#..#.", "..#..", ".#..#", "#..#.", "..#..", ".#..#", "#..#." };
        private static readonly string[] LowFuelArt = { "####.", "#..##", "#..##", "####.", "####.", "####.", "####." };
        private static readonly string[] TempArt = { "..##.", "..#..", "..##.", "..#..", ".###.", "#####", ".###." };
        private static readonly string[] EngineStartArt = { "...##", "..##.", ".##..", "####.", "..##.", ".##..", "##..." };

        private static void GlyphCentered(string[] leds, int columns, int rows, string[] art, string colour)
        {
            var w = 0;
            foreach (var line in art) if (line.Length > w) w = line.Length;
            GlyphAt(leds, columns, rows, art, colour, (columns - w) / 2);
        }

        // Tillen: niet-zwarte kleuren krijgen een piek >= 0.8*255 (levendige LED's).
        private static string Lift(string colour)
        {
            int r, g, b;
            if (!TryRgb(colour, out r, out g, out b)) return colour;
            var peak = Math.Max(r, Math.Max(g, b));
            if (peak <= 0) return colour;
            var p = peak / 255.0;
            var scale = (0.8 + p * 0.2) / p;
            return ToHex((int)Math.Min(255, Math.Round(r * scale)), (int)Math.Min(255, Math.Round(g * scale)), (int)Math.Min(255, Math.Round(b * scale)));
        }

        private static string[] Mirror(string[] art)
        {
            var result = new string[art.Length];
            for (var i = 0; i < art.Length; i++)
            {
                var chars = art[i].ToCharArray();
                Array.Reverse(chars);
                result[i] = new string(chars);
            }
            return result;
        }

        private static void DrawSpotter(string[] leds, int columns, int rows, int side, bool leftTrig, bool rightTrig, bool animate, long nowMs, string colour)
        {
            var toRight = side == 3 ? true : side == 2 ? false : (rightTrig && !leftTrig);
            string[] art;
            if (!animate && side == 1) art = ArrowBoth;
            else art = toRight ? Mirror(ArrowLeft) : ArrowLeft;
            const int gw = 5;
            var span = Math.Max(0, columns - gw);
            int x;
            if (!animate) x = side == 2 ? 0 : side == 3 ? span : span / 2;
            else
            {
                const double period = 900.0;
                var frac = (nowMs % (long)period) / period;
                x = (int)Math.Round((toRight ? frac : 1 - frac) * span);
            }
            GlyphAt(leds, columns, rows, art, Lift(string.IsNullOrEmpty(colour) ? "#FF1493" : colour), x);
        }

        private static void GlyphAt(string[] leds, int columns, int rows, string[] art, string colour, int x)
        {
            var h = art.Length;
            var oy = (rows - h) / 2;
            if (oy < 0) oy = 0;
            for (var y = 0; y < h; y++)
                for (var i = 0; i < art[y].Length; i++)
                    if (art[y][i] == '#') Set(leds, columns, rows, x + i, oy + y, colour);
        }

        private static void DrawGear(string[] leds, int columns, int rows, PanelInput input, FlagBoxSlot box, FlagSettings global, bool phase, int avoid)
        {
            if (BlinkOff(box, input, global, phase)) return;
            string top, mid, bot; bool blend;
            Palette(box, input, global, out top, out mid, out bot, out blend);
            var inverted = box != null && box.GearInverted;
            var style = box != null ? box.GearStyle : 0;
            var location = box != null ? box.GearLocation : 1;
            var big = box != null && !box.ShowRedline;      // geen rev-balk -> groter gecentreerd cijfer
            var ch = string.IsNullOrEmpty(input.Gear) ? '-' : input.Gear[0];
            var font = big ? Font4x6 : style == 1 ? Font2x5 : Font3x5;
            string[] glyph;
            if (!font.TryGetValue(ch, out glyph)) return;
            if (inverted) Solid(leds, RowColour(top, mid, bot, blend, 0.5));
            var gh = glyph.Length;
            var gw = glyph[0].Length;
            var oy = (rows - gh) / 2;
            if (oy < 0) oy = 0;

            // Wijk voor de spotterpijl: schuif de gear naar de andere kant.
            int loc;
            if (big) loc = avoid == 2 ? 1 : avoid == 3 ? 2 : 0;
            else
            {
                loc = location;
                if (avoid == 2 && loc == 2) loc = 1;
                else if (avoid == 3 && loc == 1) loc = 2;
            }

            var offsets = new List<int>();
            if (loc == 0) offsets.Add((columns - gw) / 2);
            else
            {
                if (loc == 2 || loc == 3) offsets.Add(0);
                if (loc == 1 || loc == 3) offsets.Add(columns - gw);
                if (offsets.Count == 0) offsets.Add((columns - gw) / 2);
            }

            var digitInk = inverted ? "#000000" : RowColour(top, mid, bot, blend, input.RpmsPercent / 100.0);
            foreach (var ox in offsets)
                for (var y = 0; y < gh; y++)
                {
                    var ink = digitInk;
                    for (var x = 0; x < gw; x++)
                        if (glyph[y][x] == '1')
                        {
                            Set(leds, columns, rows, ox + x, oy + y, ink);
                            if (style == 2 && !big) Set(leds, columns, rows, ox + x + 1, oy + y, ink);
                        }
                }
        }

        private static double Clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

        private static void ApplyBrightness(string[] leds, double factor)
        {
            if (factor >= 0.999) return;
            for (var i = 0; i < leds.Length; i++)
            {
                int r, g, b;
                if (TryRgb(leds[i], out r, out g, out b)) leds[i] = ToHex((int)Math.Round(r * factor), (int)Math.Round(g * factor), (int)Math.Round(b * factor));
            }
        }

        private static string ToHex(int r, int g, int b)
        {
            return "#" + Math.Max(0, Math.Min(255, r)).ToString("X2") + Math.Max(0, Math.Min(255, g)).ToString("X2") + Math.Max(0, Math.Min(255, b)).ToString("X2");
        }
    }

    // Parser/tekenaar voor de MatrixIdleImage-payload (DNR-formaat):
    //   optioneel "WxH;", dan frames gescheiden door '|', elk "durms:c0,c1,...,cN".
    public sealed class MatrixArt
    {
        public int Columns = 8;
        public int Rows = 8;
        public List<string[]> Frames = new List<string[]>();
        public List<int> Durations = new List<int>();

        public static MatrixArt Parse(string payload)
        {
            if (string.IsNullOrWhiteSpace(payload)) return null;
            try
            {
                var text = payload.Trim();
                var art = new MatrixArt();
                var semi = text.IndexOf(';');
                if (semi > 0)
                {
                    var dims = text.Substring(0, semi).Split('x');
                    int c, r;
                    if (dims.Length == 2 && int.TryParse(dims[0], out c) && int.TryParse(dims[1], out r) && c > 0 && r > 0 && c <= 64 && r <= 64)
                    { art.Columns = c; art.Rows = r; }
                    text = text.Substring(semi + 1);
                }
                var cells = art.Columns * art.Rows;
                foreach (var frame in text.Split('|'))
                {
                    if (string.IsNullOrWhiteSpace(frame)) continue;
                    var colon = frame.IndexOf(':');
                    if (colon <= 0) return null;
                    int dur;
                    if (!int.TryParse(frame.Substring(0, colon).Trim(), out dur)) return null;
                    var parts = frame.Substring(colon + 1).Split(',');
                    if (parts.Length != cells) return null;
                    var arr = new string[cells];
                    for (var i = 0; i < cells; i++) arr[i] = Normalise(parts[i]);
                    art.Frames.Add(arr);
                    art.Durations.Add(Math.Max(50, Math.Min(5000, dur)));
                    if (art.Frames.Count >= 16) break;
                }
                return art.Frames.Count > 0 ? art : null;
            }
            catch { return null; }
        }

        private static string Normalise(string cell)
        {
            if (string.IsNullOrWhiteSpace(cell)) return null;
            var t = cell.Trim();
            if (t[0] != '#') return null;
            if (t.Length == 9) t = "#" + t.Substring(3); // #AARRGGBB -> #RRGGBB
            if (t.Length != 7) return null;
            return t.ToUpperInvariant();
        }

        public static void Draw(string[] leds, int columns, int rows, MatrixArt art, long nowMs)
        {
            var total = 0;
            for (var i = 0; i < art.Durations.Count; i++) total += art.Durations[i];
            if (total <= 0) { DrawFrame(leds, columns, rows, art, 0); return; }
            var t = (int)(nowMs % total);
            var idx = 0;
            for (var i = 0; i < art.Durations.Count; i++)
            {
                if (t < art.Durations[i]) { idx = i; break; }
                t -= art.Durations[i];
            }
            DrawFrame(leds, columns, rows, art, idx);
        }

        public static void DrawFrame(string[] leds, int columns, int rows, MatrixArt art, int frameIndex)
        {
            if (art == null || art.Frames.Count == 0) return;
            var frame = art.Frames[Math.Min(Math.Max(0, frameIndex), art.Frames.Count - 1)];
            for (var y = 0; y < rows && y < art.Rows; y++)
                for (var x = 0; x < columns && x < art.Columns; x++)
                {
                    var c = frame[y * art.Columns + x];
                    leds[y * columns + x] = string.IsNullOrEmpty(c) ? "#000000" : c;
                }
        }

        // Bouw een enkel-frame payload uit een celarray (voor de pixel-editor).
        public static string FormatSingle(string[] cells, int columns, int rows)
        {
            var sb = new StringBuilder();
            if (!(columns == 8 && rows == 8)) sb.Append(columns).Append('x').Append(rows).Append(';');
            sb.Append("100:");
            for (var i = 0; i < columns * rows; i++)
            {
                if (i > 0) sb.Append(',');
                var c = cells != null && i < cells.Length ? cells[i] : null;
                sb.Append(string.IsNullOrEmpty(c) ? "" : Normalise(c) ?? "");
            }
            return sb.ToString();
        }
    }
}
