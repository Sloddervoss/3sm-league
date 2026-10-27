using System;
using System.Collections.Generic;
using GameReaderCommon;

namespace ThreeSM.EnduranceConnector
{
    // Context per update: het spel, de SimHub-snapshot en een getter voor ruwe
    // game-properties (bv. iRacing GameRawData.Telemetry.SessionFlagsDetails.*).
    public sealed class FlagContext
    {
        public string Game { get; set; }
        public StatusDataBase Snapshot { get; set; }
        public Func<string, object> GetRaw { get; set; }
        public bool IsInCar { get; set; }
        public bool InPitLane { get; set; }
        // Fallback uit Settings.FlagProperty wanneer de snapshot geen vlag levert.
        public string FlagNameFallback { get; set; }
    }

    // Vertaalt ruwe game-data naar genormaliseerde vlaggen. Detect() doet dit één keer
    // per tick (incl. latch); Present() maskeert + presenteert per uitvoer (universeel
    // of één flagbox). iRacing-first; generieke fallback voor andere spellen.
    public sealed class FlagService
    {
        private readonly object _sync = new object();
        private readonly Dictionary<string, bool> _lastValue = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _latchedUntilMs = new Dictionary<string, long>(StringComparer.Ordinal);

        private FlagContext _ctx;
        private int _uYellowSectorMode = 1;
        private int _holdTicks = 3;
        private RaceFlags _publishedFlags;
        private RaceFlags _pendingFlags;
        private int _pendingTicks;

        // Detecteert ALLE vlaggen uit ruwe game-data (los van per-vlag-instellingen) en
        // past de latch toe. Exact één keer per tick aanroepen; daarna per uitvoer maskeren.
        public RaceFlags Detect(FlagContext context, FlagSettings timings)
        {
            if (context == null) return RaceFlags.None;
            var checkeredHoldMs = timings != null ? timings.CheckeredHoldMs : 20000;
            var whiteFinalLapMs = timings != null ? timings.WhiteFlagFinalLapDurationMs : 10000;
            var penaltyMs = timings != null ? (timings.PenaltyWarningDuration > 0 ? timings.PenaltyWarningDuration * 1000 : timings.PenaltyWarningDurationMs) : 3000;
            lock (_sync)
            {
                _ctx = context;
                _uYellowSectorMode = timings != null ? timings.FlagsVisibleYellowSector : 1;
                _holdTicks = timings != null ? timings.FlagHoldTicks : 3;
                try
                {
                    // DNR: spotter heeft voorrang; en vlaggen verbergen in de pitlane.
                    if (timings != null && timings.FlagsPriority == 2
                        && (P("SpotterCarLeft") || P("SpotterCarRight"))) return RaceFlags.None;
                    if (timings != null && timings.FlagsVisiblePits == 2 && D("IsInPitLane") != 0.0) return RaceFlags.None;

                    var flags = RaceFlags.None;
                    if (ShowRed()) flags |= RaceFlags.Red;
                    var penalty = ShowBlack() || D("PenaltyCount") > 0.0 || P("Penalty");
                    if (Latched("black", penalty, penaltyMs)) flags |= RaceFlags.Black;
                    if (ShowVirtualSafetyCar()) flags |= RaceFlags.VirtualSafetyCar;
                    if (ShowFullCourseYellow()) flags |= RaceFlags.FullCourseYellow;
                    if (ShowSafetyCar()) flags |= RaceFlags.SafetyCar;
                    if (ShowDoubleYellow()) flags |= RaceFlags.DoubleYellow;
                    if (ShowYellow()) flags |= RaceFlags.Yellow;

                    var whiteFlag = P("Flag_White");
                    var whiteSlowRaw = WhiteSlowCarRaw();
                    var whiteFinalRaw = WhiteFinalLapRaw();
                    if ((whiteFlag || whiteSlowRaw) && !whiteFinalRaw) flags |= RaceFlags.WhiteSlow;
                    if (Latched("whitefinal", whiteFinalRaw, whiteFinalLapMs)) flags |= RaceFlags.WhiteFinal;

                    if (Latched("checkered", RawCheckered(), checkeredHoldMs)) flags |= RaceFlags.Checkered;
                    if (ShowOrange()) flags |= RaceFlags.Orange;
                    if (ShowDebris()) flags |= RaceFlags.Debris;
                    if (ShowMeatball()) flags |= RaceFlags.Meatball;
                    if (ShowBlue()) flags |= RaceFlags.Blue;
                    if (ShowGreen()) flags |= RaceFlags.Green;
                    return Debounce(flags);
                }
                catch
                {
                    return RaceFlags.None;
                }
                finally
                {
                    _ctx = null;
                }
            }
        }

        // Maskeer de gedetecteerde vlaggen met de toegestane set en bepaal de presentatie
        // (prioriteit/kleur/layout/ernst) voor deze uitvoer.
        public static FlagState Present(RaceFlags detected, RaceFlags allowed)
        {
            var flags = detected & allowed;
            var state = FlagState.Empty();
            state.Flags = flags;
            if (flags == RaceFlags.None) return state;

            if (Has(flags, RaceFlags.Red)) Set(state, "red", "#FF0000", "solid", FlagSeverity.Critical);
            else if (Has(flags, RaceFlags.Black)) Set(state, "black", "#808080", "checker", FlagSeverity.Critical);
            else if (Has(flags, RaceFlags.SafetyCar)) Set(state, "safetycar", "#FFFF00", "checker", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.VirtualSafetyCar)) Set(state, "vsc", "#FFFF00", "checker", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.FullCourseYellow)) Set(state, "fcy", "#FFFF00", "checker", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.DoubleYellow)) Set(state, "doubleyellow", "#FFFF00", "solid", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.Yellow)) Set(state, "yellow", "#FFFF00", "solid", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.White)) Set(state, "white", "#FFFFFF", "solid", FlagSeverity.Info);
            else if (Has(flags, RaceFlags.WhiteSlow)) Set(state, "white", "#FFFFFF", "solid", FlagSeverity.Info);
            else if (Has(flags, RaceFlags.WhiteFinal)) Set(state, "whitefinal", "#FFFFFF", "solid", FlagSeverity.Info);
            else if (Has(flags, RaceFlags.Orange)) Set(state, "orange", "#FF8C00", "solid", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.Meatball)) Set(state, "meatball", "#FF8C00", "solid", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.Debris)) Set(state, "debris", "#FF0000", "rows", FlagSeverity.Caution);
            else if (Has(flags, RaceFlags.Blue)) Set(state, "blue", "#0000FF", "solid", FlagSeverity.Info);
            else if (Has(flags, RaceFlags.Green)) Set(state, "green", "#00FF00", "solid", FlagSeverity.Info);
            else if (Has(flags, RaceFlags.Checkered)) Set(state, "checkered", "#FFFFFF", "checker", FlagSeverity.Info);
            return state;
        }

        // Toegestane vlaggen volgens de universele instellingen.
        public static RaceFlags MaskOf(FlagSettings s)
        {
            if (s == null) return RaceFlags.None;
            var m = RaceFlags.None;
            if (s.ShowGreen) m |= RaceFlags.Green;
            if (s.ShowYellow) m |= RaceFlags.Yellow;
            if (s.ShowDoubleYellow) m |= RaceFlags.DoubleYellow;
            if (s.ShowRed) m |= RaceFlags.Red;
            if (s.ShowBlue) m |= RaceFlags.Blue;
            if (s.ShowWhite) m |= RaceFlags.White;
            if (s.ShowCheckered) m |= RaceFlags.Checkered;
            if (s.ShowBlack) m |= RaceFlags.Black;
            if (s.ShowOrange) m |= RaceFlags.Orange;
            if (s.ShowDebris) m |= RaceFlags.Debris;
            if (s.ShowMeatball) m |= RaceFlags.Meatball;
            if (s.ShowSafetyCar) m |= RaceFlags.SafetyCar;
            if (s.ShowVirtualSafetyCar) m |= RaceFlags.VirtualSafetyCar;
            if (s.ShowFullCourseYellow) m |= RaceFlags.FullCourseYellow;
            if (s.ShowWhiteSlowCar) m |= RaceFlags.WhiteSlow;
            if (s.ShowWhiteFinalLap) m |= RaceFlags.WhiteFinal;
            return m;
        }

        // Toegestane vlaggen volgens één flagbox-slot.
        public static RaceFlags MaskOf(FlagBoxSlot slot)
        {
            if (slot == null) return RaceFlags.None;
            var m = RaceFlags.None;
            if (slot.ShowGreen) m |= RaceFlags.Green;
            if (slot.ShowYellow) m |= RaceFlags.Yellow;
            if (slot.ShowDoubleYellow) m |= RaceFlags.DoubleYellow;
            if (slot.ShowRed) m |= RaceFlags.Red;
            if (slot.ShowBlue) m |= RaceFlags.Blue;
            if (slot.ShowWhite) m |= RaceFlags.White;
            if (slot.ShowCheckered) m |= RaceFlags.Checkered;
            if (slot.ShowBlack) m |= RaceFlags.Black;
            if (slot.ShowOrange) m |= RaceFlags.Orange;
            if (slot.ShowDebris) m |= RaceFlags.Debris;
            if (slot.ShowMeatball) m |= RaceFlags.Meatball;
            if (slot.ShowSafetyCar) m |= RaceFlags.SafetyCar;
            if (slot.ShowVirtualSafetyCar) m |= RaceFlags.VirtualSafetyCar;
            if (slot.ShowFullCourseYellow) m |= RaceFlags.FullCourseYellow;
            if (slot.ShowWhiteSlowCar) m |= RaceFlags.WhiteSlow;
            if (slot.ShowWhiteFinalLap) m |= RaceFlags.WhiteFinal;
            return m;
        }

        // Gemaksroute voor één uitvoer (universeel): detecteren + maskeren in één keer.
        public FlagState Resolve(FlagContext context, FlagSettings settings)
        {
            if (context == null || settings == null || !settings.Enabled) return FlagState.Empty();
            return Present(Detect(context, settings), MaskOf(settings));
        }

        // Alleen de vlaggen die de bestaande V3 `flags`-vocabulaire kent — de rijkere set gaat
        // via de aparte kolommen naar de server. 0.7.1: meatball toegevoegd; hij stond wel in
        // de detectie maar niet in deze lijst, dus de server zag hem nooit. Achteraan
        // toegevoegd zodat de indexen van de bestaande namen niet verschuiven.
        public static string[] ToLegacyNames(FlagState state)
        {
            if (state == null || !state.Active) return null;
            var names = new List<string>();
            if ((state.Flags & RaceFlags.Checkered) != 0) names.Add("checkered");
            if ((state.Flags & RaceFlags.Red) != 0) names.Add("red");
            if ((state.Flags & RaceFlags.Yellow) != 0) names.Add("yellow");
            if ((state.Flags & RaceFlags.White) != 0 || (state.Flags & RaceFlags.WhiteSlow) != 0 || (state.Flags & RaceFlags.WhiteFinal) != 0) names.Add("white");
            if ((state.Flags & RaceFlags.Green) != 0) names.Add("green");
            if ((state.Flags & RaceFlags.Meatball) != 0) names.Add("meatball");
            return names.Count == 0 ? null : names.ToArray();
        }

        // ---- per-vlag detectie (exact DNR-model: spel-specifieke ruwe paden) ----

        private static readonly HashSet<string> F1Games = new HashSet<string>(StringComparer.Ordinal)
        { "F12030", "F12029", "F12028", "F12027", "F12026", "F12025", "F12024", "F12023", "F12022", "F12021" };

        private bool ShowRed()
        {
            var g = Game();
            uint bf;
            if (g == "IRacing" && SessionFlags(out bf)) return (bf & 0x10u) != 0u;
            if (g == "IRacing") return B("GameRawData.Telemetry.SessionFlagsDetails.Isred");
            if (F1Games.Contains(g)) return B("DataCorePlugin.GameRawData.RedFlagShown");
            if (g == "Automobilista2") return Eq("DataCorePlugin.GameRawData.mHighestFlagColour", 5.0);
            return false;
        }

        // iRacing levert één SessionFlags-bitmasker; dat is rijker dan de losse booleans.
        private bool SessionFlags(out uint flags)
        {
            flags = 0u;
            var value = Get("GameRawData.Telemetry.SessionFlags");
            if (value == null) return false;
            flags = (uint)AsDbl(value);
            return true;
        }

        private bool ShowFullCourseYellow()
        {
            var g = Game();
            uint bf;
            if (g == "IRacing" && SessionFlags(out bf)) return (bf & 0xC000u) != 0u; // Caution | CautionWaving
            return false;
        }

        private bool ShowBlack() { return P("Flag_Black"); }

        private bool ShowVirtualSafetyCar()
        {
            return F1Games.Contains(Game()) && Eq("DataCorePlugin.GameRawData.PacketSessionData.m_safetyCarStatus", 2.0);
        }

        private bool ShowSafetyCar()
        {
            var g = Game();
            if (F1Games.Contains(g) && Eq("DataCorePlugin.GameRawData.PacketSessionData.m_safetyCarStatus", 1.0)) return true;
            if (g == "LMU") return D("GameRawData.rules.mTrackRules.mSafetyCarActive") != 0.0;
            return false;
        }

        private bool ShowDoubleYellow()
        {
            var g = Game();
            if (g == "Automobilista2" && P("Flag_Yellow")) return true;
            if (g == "AssettoCorsaCompetizione") return Eq("DataCorePlugin.GameRawData.Graphics.FlagsDetails.IsACC_YELLOW_FLAG", 1.0);
            return false;
        }

        private bool ShowYellow()
        {
            var g = Game();
            if (g == "AssettoCorsaCompetizione" && Eq("DataCorePlugin.GameRawData.Graphics.Flag", 2.0)) return true;
            if (g == "LMU" || g == "AssettoCorsaCompetizione")
            {
                if (_uYellowSectorMode != 2)
                {
                    for (var i = 1; i <= 3; i++) if (YellowSector(i)) return true;
                    return false;
                }
                return YellowSector((int)D("CurrentSectorIndex"));
            }
            if (P("Flag_Yellow")) return true;
            if (g == "Automobilista2" && Eq("DataCorePlugin.GameRawData.mHighestFlagColour", 6.0)) return true;
            if (g == "IRacing")
            {
                uint bf;
                if (SessionFlags(out bf)) return (bf & 0x108u) != 0u; // Yellow | YellowWaving
                return B("GameRawData.Telemetry.SessionFlagsDetails.Isyellow");
            }
            return false;
        }

        private bool YellowSector(int sector)
        {
            if (_uYellowSectorMode == 2 && sector != (int)D("CurrentSectorIndex")) return false;
            var g = Game();
            if (g == "AssettoCorsaCompetizione") return Eq("GameRawData.Graphics.globalYellow" + sector, 1.0);
            if (g == "LMU") return Eq("GameRawData.Data.mSectorFlag" + (sector - 1).ToString("D2"), 1.0);
            return false;
        }

        private bool WhiteSlowCarRaw()
        {
            var g = Game();
            if (g == "IRacing") return S("SessionTypeName") != "Lone Qualify" && B("IRacingExtraProperties.iRacing_SlowCarAhead");
            if (g == "AssettoCorsaCompetizione") return B("GameRawData.Graphics.FlagsDetails.IsACC_WHITE_FLAG");
            if (g == "Automobilista2") return Eq("DataCorePlugin.GameRawData.mHighestFlagColour", 3.0);
            return false;
        }

        private bool WhiteFinalLapRaw()
        {
            var g = Game();
            var other = g != "IRacing" && g != "AssettoCorsaCompetizione" && g != "Automobilista2" && g != "EAWRC23";
            if (g == "IRacing" && P("Flag_White")) return true;
            if (g == "AssettoCorsaCompetizione" && Eq("GameRawData.Graphics.globalWhite", 1.0)) return true;
            if (g == "Automobilista2" && Eq("DataCorePlugin.GameRawData.mHighestFlagColour", 4.0)) return true;
            if (other) return Eq("RemainingLaps", 1.0);
            return false;
        }

        private bool RawCheckered()
        {
            uint bf;
            if (Game() == "IRacing" && SessionFlags(out bf)) return (bf & 1u) != 0u;
            return P("Flag_Checkered");
        }

        private bool ShowOrange()
        {
            if (P("Flag_Orange")) return true;
            if (Game() == "IRacing") return B("GameRawData.Telemetry.SessionFlagsDetails.Isrepair");
            return false;
        }

        private bool ShowBlue()
        {
            return P("Flag_Blue") && !P("SpotterCarLeft") && !P("SpotterCarRight");
        }

        private bool ShowDebris()
        {
            return Game() == "IRacing" && B("GameRawData.Telemetry.SessionFlagsDetails.Isdebris");
        }

        // Meatball (zwart/oranje): iRacing zet SessionFlags.servicible (0x40000) als de auto
        // schade heeft die in de pits gerepareerd moet worden. De losse boolean is het vangnet
        // voor SimHub-builds die het bitmasker niet doorgeven.
        private bool ShowMeatball()
        {
            if (Game() != "IRacing") return false;
            uint bf;
            if (SessionFlags(out bf)) return (bf & 0x40000u) != 0u;
            return B("GameRawData.Telemetry.SessionFlagsDetails.Isservicible");
        }

        private bool ShowGreen()
        {
            uint bf;
            if (Game() == "IRacing" && SessionFlags(out bf)) return (bf & 4u) != 0u;
            return P("Flag_Green");
        }

        private static bool Has(RaceFlags flags, RaceFlags bit) { return (flags & bit) == bit; }

        private static void Set(FlagState state, string primary, string colour, string layout, FlagSeverity severity)
        {
            state.Primary = primary;
            state.ColourHex = colour;
            state.Layout = layout;
            state.Severity = severity;
        }

        // Anti-flikker: houdt een daling van de vlag-prioriteit vast voor FlagHoldTicks
        // tikken (DNR-model). Stijgingen gaan direct door.
        private RaceFlags Debounce(RaceFlags incoming)
        {
            var hold = _holdTicks;
            if (hold <= 0) { _publishedFlags = incoming; return incoming; }
            if (Priority(incoming) >= Priority(_publishedFlags)) { _publishedFlags = incoming; _pendingTicks = 0; return incoming; }
            if (incoming == _pendingFlags) _pendingTicks++;
            else { _pendingFlags = incoming; _pendingTicks = 1; }
            if (_pendingTicks >= hold) { _publishedFlags = incoming; _pendingTicks = 0; }
            return _publishedFlags;
        }

        private static int Priority(RaceFlags f)
        {
            if (Has(f, RaceFlags.Red)) return 12;
            if (Has(f, RaceFlags.Black)) return 11;
            if (Has(f, RaceFlags.SafetyCar)) return 10;
            if (Has(f, RaceFlags.VirtualSafetyCar)) return 9;
            if (Has(f, RaceFlags.FullCourseYellow)) return 8;
            if (Has(f, RaceFlags.DoubleYellow)) return 7;
            if (Has(f, RaceFlags.Yellow)) return 6;
            if (Has(f, RaceFlags.White) || Has(f, RaceFlags.WhiteSlow) || Has(f, RaceFlags.WhiteFinal)) return 5;
            if (Has(f, RaceFlags.Orange)) return 4;
            if (Has(f, RaceFlags.Meatball)) return 4;
            if (Has(f, RaceFlags.Debris)) return 3;
            if (Has(f, RaceFlags.Blue)) return 2;
            if (Has(f, RaceFlags.Green)) return 1;
            return 0;
        }

        private bool Latched(string key, bool value, int holdMs)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            bool last;
            _lastValue.TryGetValue(key, out last);
            if (value && !last) _latchedUntilMs[key] = now + Math.Max(0, holdMs);
            _lastValue[key] = value;
            if (value) return true;
            long until;
            return _latchedUntilMs.TryGetValue(key, out until) && now <= until;
        }

        // ---- ruwe waarden lezen (met DataCorePlugin-prefix-fallback) ----

        private bool IsGame(string game) { return string.Equals(_ctx.Game, game, StringComparison.OrdinalIgnoreCase); }

        private string Game() { return _ctx == null ? string.Empty : (_ctx.Game ?? string.Empty); }

        private string S(string name)
        {
            var value = Get(name);
            return value == null ? null : Convert.ToString(value);
        }

        private bool IsF1()
        {
            var game = _ctx.Game;
            return !string.IsNullOrEmpty(game) && game.StartsWith("F1", StringComparison.OrdinalIgnoreCase);
        }

        private bool SnapshotFlag(string which)
        {
            var snapshot = _ctx.Snapshot;
            if (snapshot != null)
            {
                try
                {
                    switch (which)
                    {
                        case "checkered": if (snapshot.Flag_Checkered != 0) return true; break;
                        case "yellow": if (snapshot.Flag_Yellow != 0) return true; break;
                        case "white": if (snapshot.Flag_White != 0) return true; break;
                        case "green": if (snapshot.Flag_Green != 0) return true; break;
                    }
                }
                catch { }
            }
            // Fallback: lees dezelfde vlag als SimHub-property (dekt gevallen zonder bruikbare snapshot).
            return P("Flag_" + PropertySuffix(which));
        }

        private static string PropertySuffix(string which)
        {
            switch (which)
            {
                case "checkered": return "Checkered";
                case "yellow": return "Yellow";
                case "white": return "White";
                case "green": return "Green";
                default: return which;
            }
        }

        private string FlagNameText()
        {
            var snapshot = _ctx.Snapshot;
            if (snapshot != null && !string.IsNullOrEmpty(snapshot.Flag_Name)) return snapshot.Flag_Name.ToLowerInvariant();
            return string.IsNullOrEmpty(_ctx.FlagNameFallback) ? string.Empty : _ctx.FlagNameFallback.ToLowerInvariant();
        }

        private bool NameContains(string token) { return FlagNameText().IndexOf(token, StringComparison.Ordinal) >= 0; }

        private object Get(string name)
        {
            var getRaw = _ctx.GetRaw;
            if (getRaw == null || string.IsNullOrEmpty(name)) return null;
            var value = getRaw(name);
            if (value != null) return value;
            if (!name.StartsWith("DataCorePlugin.", StringComparison.Ordinal))
            {
                value = getRaw("DataCorePlugin." + name);
                if (value != null) return value;
                value = getRaw("DataCorePlugin.GameData." + name);
                if (value != null) return value;
            }
            return null;
        }

        private bool P(string name) { return AsDbl(Get(name)) == 1.0; }
        private bool B(string name) { return AsDbl(Get(name)) != 0.0; }
        private double D(string name) { return AsDbl(Get(name)); }
        private bool Eq(string name, double expected) { return AsDbl(Get(name)) == expected; }

        private static double AsDbl(object value)
        {
            if (value == null) return 0.0;
            if (value is bool) return ((bool)value) ? 1.0 : 0.0;
            if (value is double) return (double)value;
            if (value is float) return (float)value;
            if (value is decimal) return (double)(decimal)value;
            if (value is int) return (int)value;
            if (value is long) return (long)value;
            if (value is uint) return (uint)value;
            if (value is short) return (short)value;
            if (value is byte) return (byte)value;
            double parsed;
            return double.TryParse(value.ToString(), out parsed) ? parsed : 0.0;
        }
    }
}
