using System;
using System.Collections.Generic;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    // Genormaliseerde racevlaggen als bitmasker. Spel-onafhankelijk; FlagService
    // vertaalt ruwe game-properties (o.a. iRacing GameRawData) naar deze set.
    [Flags]
    public enum RaceFlags : uint
    {
        None = 0,
        Green = 1u << 0,
        Yellow = 1u << 1,
        DoubleYellow = 1u << 2,
        Red = 1u << 3,
        Blue = 1u << 4,
        White = 1u << 5,
        Checkered = 1u << 6,
        Black = 1u << 7,
        Orange = 1u << 8,
        Debris = 1u << 9,
        SafetyCar = 1u << 10,
        VirtualSafetyCar = 1u << 11,
        FullCourseYellow = 1u << 12,
        WhiteSlow = 1u << 13,
        WhiteFinal = 1u << 14
    }

    public enum FlagSeverity
    {
        None = 0,
        Info = 1,
        Caution = 2,
        Critical = 3
    }

    // Uitkomst van FlagService: de volledige bitmasker plus een "primaire" vlag
    // voor weergave (kleur/layout/ernst). Active == false als er geen vlag is.
    public sealed class FlagState
    {
        public RaceFlags Flags { get; set; }
        public string Primary { get; set; }
        public string ColourHex { get; set; }
        public string Layout { get; set; }
        public FlagSeverity Severity { get; set; }

        public bool Active { get { return Flags != RaceFlags.None; } }

        public static FlagState Empty()
        {
            return new FlagState
            {
                Flags = RaceFlags.None,
                Primary = "none",
                ColourHex = "#000000",
                Layout = "solid",
                Severity = FlagSeverity.None
            };
        }
    }

    // Thema-regel voor gear-kleuren (DNR ThemeCatalogue): Top/Midden/Bottom.
    public sealed class FlagTheme
    {
        public int Id;
        public string Name;
        public string Top;
        public string Middle;
        public string Bottom;
        public bool Blend;
        public FlagTheme(int id, string name, string top, string middle, string bottom, bool blend = false)
        { Id = id; Name = name; Top = top; Middle = middle; Bottom = bottom; Blend = blend; }
    }

    // De 31 gear-thema's van DNR (id's en kleuren 1-op-1 overgenomen; eigen code).
    public static class FlagThemes
    {
        public const int Custom = 0;
        public static readonly FlagTheme[] All = new FlagTheme[]
        {
            new FlagTheme(0, "Custom", "#FFFFFF", "#FFFFFF", "#FFFFFF"),
            new FlagTheme(1, "3SM", "#FF6B1A", "#FFA169", "#F2F4F8"),
            new FlagTheme(2, "Racing", "#00E676", "#FFD400", "#FF1744"),
            new FlagTheme(3, "Red", "#FF0000", "#B00000", "#5A0000"),
            new FlagTheme(4, "Blue", "#0000FF", "#0044CC", "#0088FF"),
            new FlagTheme(5, "Green", "#00FF00", "#00B000", "#006600"),
            new FlagTheme(6, "Yellow", "#FFFF00", "#FFC000", "#B08000"),
            new FlagTheme(7, "Orange", "#FF8C00", "#FF5A00", "#B00000"),
            new FlagTheme(8, "Purple", "#B000FF", "#8000CC", "#500080"),
            new FlagTheme(9, "Pink", "#FF69B4", "#FF2D95", "#B00060"),
            new FlagTheme(10, "White", "#FFFFFF", "#FFFFFF", "#FFFFFF"),
            new FlagTheme(11, "Arctic", "#E0FFFF", "#87CEEB", "#4682B4"),
            new FlagTheme(12, "Sunset", "#FFD700", "#FF8C00", "#FF4500"),
            new FlagTheme(13, "Rainbow", "#FF0000", "#FFFF00", "#0000FF", true),
            new FlagTheme(14, "Citrus", "#AEEA00", "#FFD600", "#FF6D00"),
            new FlagTheme(15, "Tokyo", "#FF00A0", "#B000FF", "#00E5FF"),
            new FlagTheme(16, "Gulf Oil", "#FF8C00", "#FFFFFF", "#00A6CE"),
            new FlagTheme(17, "Heritage", "#FF8C00", "#FF0000", "#00AFFF"),
            new FlagTheme(18, "Bubblegum", "#FF4FA3", "#FFAA70", "#FFE600"),
            new FlagTheme(19, "Neon", "#39FF14", "#FF00FF", "#00FFFF"),
            new FlagTheme(20, "Retro", "#2EC4B6", "#FFE66D", "#FF6B6B"),
            new FlagTheme(21, "Octane", "#FFB000", "#FFFFFF", "#B80000"),
            new FlagTheme(22, "Aurora", "#00FF7F", "#00CED1", "#8A2BE2"),
            new FlagTheme(23, "Nebula", "#6A00FF", "#FF2D95", "#FFC400"),
            new FlagTheme(24, "Peacock", "#4A00C8", "#00D6B4", "#FFC400"),
            new FlagTheme(25, "Candycane", "#FF0000", "#FFFFFF", "#FF69B4"),
            new FlagTheme(26, "Solstice", "#FFD700", "#FFFFFF", "#1E90FF"),
            new FlagTheme(27, "Tricolore", "#00A550", "#FFFFFF", "#E30012"),
            new FlagTheme(28, "Sakura", "#FF3D8F", "#FFFFFF", "#2FBF4A"),
            new FlagTheme(29, "Cyber", "#F5FF00", "#00F0FF", "#FF00A0"),
            new FlagTheme(30, "Velvet", "#8B0034", "#6B2A8C", "#E8A0A0")
        };

        public static FlagTheme For(int id)
        {
            for (var i = 0; i < All.Length; i++) if (All[i].Id == id) return All[i];
            return All[0];
        }
    }

    // Per-vlag uiterlijk (per box): patroon, knipperen en tempo.
    [Serializable]
    public sealed class FlagStyle
    {
        public int Pattern = -1;   // -1=standaard, 0=effen, 1=checker, 2=rijen
        public int Blink = -1;     // -1=standaard, 0=uit, 1=aan (knipperen)
        public int BlinkMs = 0;    // 0 = globale patroon-timing
        public FlagStyle Clone() { return new FlagStyle { Pattern = Pattern, Blink = Blink, BlinkMs = BlinkMs }; }
    }

    // Index van de primaire vlag (voor FlagStyle).
    public static class FlagSlotIndex
    {
        public const int Red = 0, Black = 1, SafetyCar = 2, DoubleYellow = 3, Yellow = 4, White = 5,
                         Orange = 6, Debris = 7, Blue = 8, Green = 9, Checkered = 10;
        public const int Count = 11;
    }

    // Eén box (4× FlagBox + 4× MLD). Alles wat DNR per box instelt staat hier.
    [Serializable]
    public sealed class FlagBoxSlot
    {
        // SimHub-device-naam die deze box aanstuurt (leeg = niet toegewezen).
        public string DeviceName = string.Empty;

        // ---- vlagbron ----
        public bool FollowUniversal = true;
        public bool ShowGreen = true;
        public bool ShowYellow = true;
        public bool ShowDoubleYellow = true;
        public bool ShowRed = true;
        public bool ShowBlue = true;
        public bool ShowWhite = true;
        public bool ShowCheckered = true;
        public bool ShowBlack = true;
        public bool ShowOrange = true;
        public bool ShowDebris = true;
        public bool ShowSafetyCar = true;
        public bool ShowVirtualSafetyCar = true;
        public bool ShowFullCourseYellow = true;
        public bool ShowWhiteSlowCar = true;
        public bool ShowWhiteFinalLap = true;

        // ---- weergave ----
        public int Brightness = 100;              // 0..100
        public int IdleScreen = 2;                // 0=Off, 1=Static, 2=Animated, 3=Custom
        public int IdleAnimationColour = 1;       // thema-id
        public string IdleCustom = string.Empty;  // MatrixIdleImage-payload
        public int IdleDesign = 0;                // 0=3SM-merk, 1=Nederlandse vlag, 2=strepen (thema)
        public bool CriticalFlags = true;         // rood/zwart knipperen

        // ---- gear ----
        public bool Gears = true;
        public int GearColour = 2;                // thema-id (2 = Racing, racig groen/geel/rood)
        public int GearStyle = 0;                 // 0=As shipped, 1=Slim, 2=Bold
        public bool GearInverted = false;
        public int GearLocation = 1;              // 1=Rechts, 2=Links, 3=Beide
        public int RedlineBehaviour = 2;          // 1=Static, 2=Flashing
        public string RedlineColour = "#FF0000";  // kleur bij redline (voor thema's)
        public string CustomGearColour1 = "#00E676";
        public string CustomGearColour2 = "#FFD400";
        public string CustomGearColour3 = "#FF1744";
        public string CustomGearRedlineColour1 = "#FF0000";
        public string CustomGearRedlineColour2 = "#FF0000";
        public string CustomGearRedlineColour3 = "#FF0000";
        public int CustomGearNumColours = 1;      // 1 = 3 banden, 2 = 2 banden
        public int CustomGearNumRedlineColours = 1;
        public bool ShowRedline = true;           // rev-balk
        public int RedlineMidPct = 80;
        public int RedlineHighPct = 95;
        public int RedlineBarStartPct = 0;

        // ---- spotter / pit / waarschuwingen ----
        public bool Spotters = true;
        public int SpotterSide = 1;               // 1=beide, 2=links, 3=rechts
        public int SpotterMode = 2;               // 0=vervangt gear, 1=over de gear, 2=wisselt met gear (knipperend)
        public bool SpotterShiftsGear = true;     // gear naar de andere kant als de pijl aan een kant staat
        public int SpotterAnimation = 1;          // 0=statisch, 1=glijdt (links<->rechts per kant)
        public bool SpotterBlink = true;          // pijl knippert
        public bool Pit = true;
        public bool PitCountdown = true;
        public int PitLimiterStyle = 0;           // 0..4
        public bool IgnitionEngineStartupAnimation = true;
        public int EngineStartStyle = 0;          // 0..3
        public bool TemperatureWarning = true;
        public bool LowFuel = true;

        // ---- slot-metadata ----
        public bool IsMld = false;
        public int MatrixPosition = 0;            // 0 = automatisch (box-index), anders vaste matrixpositie
        public string TargetKey = string.Empty;   // "device:naam" of "arduino:1..4" (leeg = niet toegewezen)

        public string EffectiveDevice()
        {
            if (!string.IsNullOrEmpty(TargetKey))
            {
                if (TargetKey.StartsWith("device:", StringComparison.Ordinal)) return TargetKey.Substring(7);
                if (TargetKey.StartsWith("arduino:", StringComparison.Ordinal)) return "Arduino RGB Matrix";
            }
            return DeviceName ?? string.Empty;
        }

        public int EffectivePosition()
        {
            if (!string.IsNullOrEmpty(TargetKey) && TargetKey.StartsWith("arduino:", StringComparison.Ordinal))
            {
                int p;
                if (int.TryParse(TargetKey.Substring(8), out p)) return p;
            }
            return MatrixPosition > 0 ? MatrixPosition : 0;
        }

        // Kopieert alle weergave-/vlaginstellingen (niet de device-identiteit).
        public void CopyDisplayFrom(FlagBoxSlot o)
        {
            if (o == null) return;
            FollowUniversal = o.FollowUniversal;
            ShowGreen = o.ShowGreen; ShowYellow = o.ShowYellow; ShowDoubleYellow = o.ShowDoubleYellow; ShowRed = o.ShowRed;
            ShowBlue = o.ShowBlue; ShowWhite = o.ShowWhite; ShowCheckered = o.ShowCheckered; ShowBlack = o.ShowBlack;
            ShowOrange = o.ShowOrange; ShowDebris = o.ShowDebris; ShowSafetyCar = o.ShowSafetyCar;
            ShowVirtualSafetyCar = o.ShowVirtualSafetyCar; ShowFullCourseYellow = o.ShowFullCourseYellow;
            ShowWhiteSlowCar = o.ShowWhiteSlowCar; ShowWhiteFinalLap = o.ShowWhiteFinalLap;
            Brightness = o.Brightness; IdleScreen = o.IdleScreen; IdleAnimationColour = o.IdleAnimationColour;
            IdleCustom = o.IdleCustom; IdleDesign = o.IdleDesign; CriticalFlags = o.CriticalFlags;
            Gears = o.Gears; GearColour = o.GearColour; GearStyle = o.GearStyle; GearInverted = o.GearInverted;
            GearLocation = o.GearLocation; RedlineBehaviour = o.RedlineBehaviour; RedlineColour = o.RedlineColour;
            CustomGearColour1 = o.CustomGearColour1; CustomGearColour2 = o.CustomGearColour2; CustomGearColour3 = o.CustomGearColour3;
            CustomGearRedlineColour1 = o.CustomGearRedlineColour1; CustomGearRedlineColour2 = o.CustomGearRedlineColour2; CustomGearRedlineColour3 = o.CustomGearRedlineColour3;
            CustomGearNumColours = o.CustomGearNumColours; CustomGearNumRedlineColours = o.CustomGearNumRedlineColours;
            ShowRedline = o.ShowRedline; RedlineMidPct = o.RedlineMidPct; RedlineHighPct = o.RedlineHighPct; RedlineBarStartPct = o.RedlineBarStartPct;
            Spotters = o.Spotters; SpotterSide = o.SpotterSide; SpotterMode = o.SpotterMode;
            SpotterShiftsGear = o.SpotterShiftsGear; SpotterAnimation = o.SpotterAnimation; SpotterBlink = o.SpotterBlink;
            Pit = o.Pit; PitCountdown = o.PitCountdown; PitLimiterStyle = o.PitLimiterStyle;
            IgnitionEngineStartupAnimation = o.IgnitionEngineStartupAnimation; EngineStartStyle = o.EngineStartStyle;
            TemperatureWarning = o.TemperatureWarning; LowFuel = o.LowFuel;
            if (o.FlagStyles != null)
            {
                FlagStyles = new FlagStyle[o.FlagStyles.Length];
                for (var i = 0; i < o.FlagStyles.Length; i++) FlagStyles[i] = o.FlagStyles[i] == null ? null : o.FlagStyles[i].Clone();
            }
        }

        // ---- per-vlag uiterlijk (patroon/knipperen/tempo) ----
        public FlagStyle[] FlagStyles = NewFlagStyles();

        private static FlagStyle[] NewFlagStyles()
        {
            var a = new FlagStyle[FlagSlotIndex.Count];
            for (var i = 0; i < a.Length; i++) a[i] = new FlagStyle();
            return a;
        }

        public FlagStyle StyleOf(int index)
        {
            if (index < 0 || index >= FlagSlotIndex.Count) return new FlagStyle();
            if (FlagStyles == null || FlagStyles.Length < FlagSlotIndex.Count)
            {
                var old = FlagStyles;
                FlagStyles = NewFlagStyles();
                if (old != null) for (var i = 0; i < old.Length && i < FlagStyles.Length; i++) if (old[i] != null) FlagStyles[i] = old[i];
            }
            if (FlagStyles[index] == null) FlagStyles[index] = new FlagStyle();
            return FlagStyles[index];
        }

        public FlagBoxSlot Clone()
        {
            var c = (FlagBoxSlot)MemberwiseClone();
            if (FlagStyles != null)
            {
                c.FlagStyles = new FlagStyle[FlagStyles.Length];
                for (var i = 0; i < FlagStyles.Length; i++) c.FlagStyles[i] = FlagStyles[i] == null ? null : FlagStyles[i].Clone();
            }
            return c;
        }
    }

    // Eigen 3SM-idle-kunst (geen DNR-logo). Een drie-strepen-motief dat past bij
    // "3-stripe", in de huisstijlkleuren; op MLD het woordmerk "3SM".
    public static class FlagIdleArt
    {
        public const string Brand = "#FF6B1A";       // 3SM oranje
        public const string BrandSoft = "#F2F4F8";   // licht

        public static string Effective(FlagBoxSlot box, int mode, string colour)
        {
            if (mode == 3 && box != null && !string.IsNullOrEmpty(box.IdleCustom)) return box.IdleCustom;
            if (string.IsNullOrEmpty(colour)) colour = Brand;
            var mld = box != null && box.IsMld;
            if ((box != null ? box.IdleDesign : 0) == 1) return DutchFlag(mld);
            return mld ? MldMark(colour) : Mark8(colour);
        }

        // Nederlandse vlag met oranje 3SM-bies rondom. De drie strepen verdelen over
        // het binnengebied (tussen de bies): rood/wit krijgen floor(n/3), blauw de rest
        // (8x8 -> 2/2/2, MLD -> 1/1/2). De bies fadet in/uit; Static = frame 0.
        public static string DutchFlag(bool mld)
        {
            const string red = "#E8000D", white = "#FFFFFF", blue = "#21468B";
            var w = mld ? 25 : 8;
            var h = mld ? 6 : 8;
            var inner = h - 2;
            var redRows = inner / 3;
            var whiteRows = inner / 3;
            var shades = new[] { 1.0, 0.7, 0.45, 0.25, 0.45, 0.7 };
            var sb = new StringBuilder();
            if (!(w == 8 && h == 8)) sb.Append(w).Append('x').Append(h).Append(';');
            for (var f = 0; f < shades.Length; f++)
            {
                if (f > 0) sb.Append('|');
                sb.Append(220).Append(':');
                for (var y = 0; y < h; y++)
                    for (var x = 0; x < w; x++)
                    {
                        if (x + y > 0) sb.Append(',');
                        var border = x == 0 || y == 0 || x == w - 1 || y == h - 1;
                        if (border) { sb.Append(Shade(Brand, shades[f])); continue; }
                        var i = y - 1;
                        sb.Append(i < redRows ? red : i < redRows + whiteRows ? white : blue);
                    }
            }
            return sb.ToString();
        }

        public static string Default(bool mld, string colour)
        {
            if (string.IsNullOrEmpty(colour)) colour = Brand;
            return mld ? MldMark(colour) : Mark8(colour);
        }

        private static readonly string[] Glyph3 = { "11110", "00001", "01110", "00001", "11110" };

        // 8x8: rustig "3"-merkteken dat zachtjes ademt, in de gekozen themakleur.
        public static string Mark8(string colour)
        {
            const int w = 8;
            var shades = new[] { 1.0, 0.72, 0.5, 0.72 };
            var ox = (w - 5) / 2;
            var oy = (w - 5) / 2;
            var sb = new StringBuilder();
            for (var f = 0; f < shades.Length; f++)
            {
                if (f > 0) sb.Append('|');
                sb.Append(360).Append(':');
                for (var y = 0; y < w; y++)
                    for (var x = 0; x < w; x++)
                    {
                        if (x + y > 0) sb.Append(',');
                        var gx = x - ox; var gy = y - oy;
                        var on = gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && Glyph3[gy][gx] == '1';
                        sb.Append(on ? Shade(colour, shades[f]) : "");
                    }
            }
            return sb.ToString();
        }

        private static string Shade(string hex, double factor)
        {
            int r, g, b;
            TryRgb(hex, out r, out g, out b);
            return "#" + Clamp((int)Math.Round(r * factor)).ToString("X2")
                       + Clamp((int)Math.Round(g * factor)).ToString("X2")
                       + Clamp((int)Math.Round(b * factor)).ToString("X2");
        }

        private static int Clamp(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

        private static bool TryRgb(string hex, out int r, out int g, out int b)
        {
            r = g = b = 0;
            if (string.IsNullOrEmpty(hex) || hex[0] != '#') return false;
            var t = hex.Substring(1);
            if (t.Length == 8) t = t.Substring(2);
            if (t.Length != 6) return false;
            r = Convert.ToInt32(t.Substring(0, 2), 16);
            g = Convert.ToInt32(t.Substring(2, 2), 16);
            b = Convert.ToInt32(t.Substring(4, 2), 16);
            return true;
        }

        // 25x6 MLD: het woordmerk "3SM" in de gekozen themakleur.
        public static string MldMark(string colour)
        {
            if (string.IsNullOrEmpty(colour)) colour = Brand;
            const int w = 25, h = 6;
            var glyphs = new[]
            {
                new[] { "11110", "00001", "01110", "00001", "11110" }, // 3
                new[] { "01111", "10000", "01110", "00001", "11110" }, // S
                new[] { "10001", "11011", "10101", "10001", "10001" }, // M
            };
            var colours = new[] { colour, Shade(colour, 0.6), colour };
            var cells = new string[w * h];
            var totalW = glyphs.Length * 5 + (glyphs.Length - 1) * 2;
            var ox = (w - totalW) / 2;
            var cx = ox;
            for (var g = 0; g < glyphs.Length; g++)
            {
                for (var y = 0; y < 5; y++)
                    for (var x = 0; x < 5; x++)
                        if (glyphs[g][y][x] == '1') cells[y * w + cx + x] = colours[g];
                cx += 7;
            }
            var sb = new StringBuilder();
            sb.Append(w).Append('x').Append(h).Append(";100:");
            for (var i = 0; i < cells.Length; i++) { if (i > 0) sb.Append(','); sb.Append(cells[i] ?? ""); }
            return sb.ToString();
        }
    }

    // Een benoemd idle-ontwerp (bibliotheek-item).
    [Serializable]
    public sealed class FlagIdleDesign
    {
        public string Name = string.Empty;
        public string Image = string.Empty;
        public FlagIdleDesign Clone() { return new FlagIdleDesign { Name = Name, Image = Image }; }
    }

    // Een opgeslagen vlaggen/paneel-configuratie.
    [Serializable]
    public sealed class FlagPreset
    {
        public string Name = string.Empty;
        public bool IsFavorite = false;
        public string Game = string.Empty;     // leeg = elke game
        public FlagSettings Settings = new FlagSettings();
    }

    // Instelbaar per installatie. Universele vlagkeuze + tot 8 boxen (4 FlagBox + 4 MLD).
    [Serializable]
    public sealed class FlagSettings
    {
        public bool Enabled = true;

        // Universele vlagkeuze (de basis-set die alle "volgt universeel"-boxen tonen).
        public bool ShowGreen = true;
        public bool ShowYellow = true;
        public bool ShowDoubleYellow = true;
        public bool ShowRed = true;
        public bool ShowBlue = true;
        public bool ShowWhite = true;
        public bool ShowCheckered = true;
        public bool ShowBlack = true;
        public bool ShowOrange = true;
        public bool ShowDebris = true;
        public bool ShowSafetyCar = true;
        public bool ShowVirtualSafetyCar = true;
        public bool ShowFullCourseYellow = true;
        public bool ShowWhiteSlowCar = true;
        public bool ShowWhiteFinalLap = true;

        // Vlaggen met een vast venster blijven zichtbaar nadat de ruwe waarde wegvalt.
        public int CheckeredHoldMs = 10000;
        public int WhiteFlagFinalLapDurationMs = 10000;

        // Universele vlagopties (DNR-gelijk).
        public int FlagsPriority = 1;            // 2 = spotter heeft voorrang (verbergt vlaggen)
        public int FlagsVisiblePits = 1;         // 2 = verberg vlaggen in de pitlane
        public int FlagsVisibleYellowSector = 1; // 2 = alleen de huidige sector

        // Patroon-timing: checker/rijen wisselen tussen frames (milliseconden).
        public int FlagPhaseMs = 300;

        // Anti-flikker: houd een vlag-downgrade vast voor N tikken (0 = uit). DNR-model.
        public int FlagHoldTicks = 3;

        // Rev: gebruik de echte auto-redline uit de sim (RPM) i.p.v. een vast percentage.
        public bool UseGameRedline = true;

        // Globaal (DNR): temperatuur-drempels + penalty-duur.
        public int TempWarnWater = 110;
        public int TempWarnOil = 120;
        public int PenaltyWarningDurationMs = 10000;
        public int PenaltyWarningDuration = 10;    // seconden (DNR: 1-60)
        public int LowFuelPercent = 15;

        // Universeel (over alle boxen/devices)
        public string SpotterColour = "#FF1493";    // spotter-pijl kleur
        public bool LastGearRedlineOnly = false;    // redline alleen knipperen in de hoogste versnelling
        public bool UniversalTheme = false;         // één gear-thema over alle boxen forceren
        public int UniversalThemeId = 2;            // (2 = Racing)

        // Overlay (voor SimHub-dashboards/overlays die op onze properties binden)
        public int BlueFlagStyle = 0;               // 0=klassiek, 1=met klasse, 2=met klasse+positie
        public int OverlayTheme = 0;                // vrije waarde voor de overlay
        public bool OverlayDarkMode = true;
        public bool OverlayShowAnimation = true;

        // Profielgenerator + SimHub-publicatie
        public int ProfileBoxIndex = 1;
        public string ProfileKind = "matrix";
        public int ProfileLedCount = 8;
        public bool PublishProperties = true;
        public string PropertyPrefix = "THREESM.Flags";
        public bool SendFlagFields = false;

        // Idle-ontwerp bibliotheek (machine-breed) + gekozen ontwerp (per preset).
        public List<FlagIdleDesign> IdleDesigns = new List<FlagIdleDesign>();
        public string IdleDesignName = string.Empty;
        public int IdleDesignsVersion = 0;
        // Naam van de laatst toegepaste preset (voor game-auto-select).
        public string ActivePresetName = string.Empty;

        public List<FlagIdleDesign> EnsureIdleDesigns()
        {
            if (IdleDesigns == null) IdleDesigns = new List<FlagIdleDesign>();
            if (IdleDesigns.Count == 0 || IdleDesignsVersion < 2)
            {
                UpsertDesign("3SM-merk", FlagIdleArt.Default(false, FlagIdleArt.Brand));
                UpsertDesign("3SM-merk groen", FlagIdleArt.Default(false, "#00E676"));
                UpsertDesign("Nederlandse vlag", FlagIdleArt.DutchFlag(false));
                UpsertDesign("Nederlandse vlag (MLD)", FlagIdleArt.DutchFlag(true));
                IdleDesignsVersion = 2;
            }
            return IdleDesigns;
        }

        private void UpsertDesign(string name, string image)
        {
            var existing = IdleDesigns.Find(d => d != null && string.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase));
            if (existing == null) IdleDesigns.Add(new FlagIdleDesign { Name = name, Image = image });
            else existing.Image = image;
        }

        // Boxen: 4 FlagBox-slots (0..3) + 4 MLD-slots (4..7).
        public int BoxCount = 1;
        public int MldCount = 0;
        public int ConfigurationMode = 0;         // 0 = gegroepeerd (alle boxen samen), 1 = per box
        public FlagBoxSlot[] Boxes = NewBoxes();

        private static FlagBoxSlot[] NewBoxes()
        {
            var boxes = new FlagBoxSlot[8];
            for (var i = 0; i < 8; i++) boxes[i] = new FlagBoxSlot { IsMld = i >= 4 };
            return boxes;
        }

        // Zorg dat Boxes altijd 8 geldige slots heeft en geef het gevraagde slot.
        public FlagBoxSlot Box(int index)
        {
            if (index < 0) index = 0;
            if (index > 7) index = 7;
            if (Boxes == null || Boxes.Length < 8)
            {
                var old = Boxes;
                Boxes = NewBoxes();
                if (old != null) for (var i = 0; i < old.Length && i < 8; i++) if (old[i] != null) Boxes[i] = old[i];
            }
            if (Boxes[index] == null) Boxes[index] = new FlagBoxSlot { IsMld = index >= 4 };
            Boxes[index].IsMld = index >= 4;
            return Boxes[index];
        }

        public FlagSettings Clone()
        {
            var copy = (FlagSettings)MemberwiseClone();
            if (Boxes != null)
            {
                copy.Boxes = new FlagBoxSlot[Boxes.Length];
                for (var i = 0; i < Boxes.Length; i++) copy.Boxes[i] = Boxes[i] == null ? null : Boxes[i].Clone();
            }
            return copy;
        }
    }
}
