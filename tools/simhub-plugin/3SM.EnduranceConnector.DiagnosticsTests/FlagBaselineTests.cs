using System;
using System.Collections.Generic;
using GameReaderCommon;
using ThreeSM.EnduranceConnector;

// FASE 1 (baseline): bewijst dat LegacyFlagOracle exact doet wat de echte FlagService.cs
// uit 0.7.1.2 doet, voor ALLE vlagcombinaties. Zonder dit bewijs is een latere
// vergelijking "oude mapping == nieuwe lezer" niets waard: dan vergelijken we de nieuwe
// code met een handmatige gok.
//
// Elke combinatie gebruikt een verse FlagService, zodat latch/anti-flikker-toestand
// (die over de tijd werkt) het resultaat van 1 aanroep niet beinvloedt.
internal static class FlagBaselineTests
{
    // Bits die het wire-resultaat kunnen raken, plus een paar bits die dat juist niet
    // mogen doen (0x2, 0x40000000) als controle.
    private static readonly uint[] MaskBits = { 0x1u, 0x2u, 0x4u, 0x8u, 0x10u, 0x100u, 0x4000u, 0x8000u, 0x40000u, 0x40000000u };

    private static readonly double?[] WhiteStates = { null, 0.0, 1.0 };

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }
        var withBitmask = CompareAll(true);
        var withoutBitmask = CompareAll(false);
        Check("F01", withBitmask.mismatches == 0,
            "bitmaskerpad: " + withBitmask.cases + " combinaties vergeleken, afwijkingen=" + withBitmask.mismatches + First(withBitmask));
        Check("F02", withoutBitmask.mismatches == 0,
            "fallbackpad (geen bitmasker): " + withoutBitmask.cases + " combinaties vergeleken, afwijkingen=" + withoutBitmask.mismatches + First(withoutBitmask));
        // Vasteijkpunten: dezelfde waarden als de plugin nu op de draad zet.
        Check("F03", Equals(LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x1u }), new[] { "checkered" }), "bit 0x1 = checkered");
        Check("F04", Equals(LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x108u }), new[] { "yellow" }), "bit 0x108 = yellow");
        Check("F05", Equals(LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x40000u }), new[] { "meatball" }), "bit 0x40000 = meatball");
        Check("F06", LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x0u }) == null, "geen vlag = null, niet een lege lijst");
        Check("F07", Equals(LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x1u | 0x10u | 0x100u | 0x4u | 0x40000u, FlagWhite = 1 }),
            new[] { "checkered", "red", "yellow", "white", "green", "meatball" }), "volgorde van de wire-namen blijft gelijk");
        return count;
    }

    private static string First(Counts counts)
    {
        return string.IsNullOrEmpty(counts.first) ? string.Empty : " · eerste: " + counts.first;
    }

    private sealed class Counts
    {
        public int cases;
        public int mismatches;
        public string first;
    }

    private static Counts CompareAll(bool withBitmask)
    {
        var counts = new Counts();
        var bitmaskCount = withBitmask ? (1 << MaskBits.Length) : 1;
        for (var mask = 0; mask < bitmaskCount; mask++)
        {
            uint? bitmask = null;
            if (withBitmask)
            {
                var value = 0u;
                for (var bit = 0; bit < MaskBits.Length; bit++)
                    if ((mask & (1 << bit)) != 0) value |= MaskBits[bit];
                bitmask = value;
            }
            foreach (var white in WhiteStates)
            {
                foreach (var slow in new[] { false, true })
                {
                    foreach (var sessionType in new[] { "Race", "Lone Qualify" })
                    {
                        // De losse Flag_*-properties zijn alleen de fallback als het bitmasker
                        // ontbreekt; in het bitmaskerpad zijn ze per definitie ongebruikt.
                        foreach (var flagCheckered in withBitmask ? new double?[] { null } : new double?[] { null, 0.0, 1.0 })
                        {
                            foreach (var flagGreen in withBitmask ? new double?[] { null } : new double?[] { null, 0.0, 1.0 })
                            {
                                // De SessionFlagsDetails-fallbacks doen alleen iets als het bitmasker
                                // ontbreekt; ze meenemen in het bitmaskerpad zou 8x dezelfde 0-meting zijn.
                                foreach (var detail in DetailCombinations(withBitmask))
                                {
                                    var input = new LegacyFlagInput
                                    {
                                        SessionFlags = bitmask,
                                        FlagWhite = white,
                                        FlagCheckered = flagCheckered,
                                        FlagGreen = flagGreen,
                                        SlowCarAhead = slow,
                                        SessionTypeName = sessionType,
                                        DetailRed = detail.red,
                                        DetailYellow = detail.yellow,
                                        DetailService = detail.service,
                                    };
                                    var expected = LegacyFlagOracle.Names(input);
                                    var actual = FromFlagService(input);
                                    counts.cases++;
                                    if (!Equals(expected, actual))
                                    {
                                        counts.mismatches++;
                                        if (counts.first == null)
                                            counts.first = Describe(input) + " oracle=[" + Join(expected) + "] flagservice=[" + Join(actual) + "]";
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return counts;
    }

    private static IEnumerable<(bool red, bool yellow, bool service)> DetailCombinations(bool withBitmask)
    {
        if (withBitmask)
        {
            yield return (false, false, false);
            yield break;
        }
        for (var i = 0; i < 8; i++)
            yield return ((i & 1) != 0, (i & 2) != 0, (i & 4) != 0);
    }

    // De ECHTE 0.7.1.2-route: FlagContext + FlagService.Detect + Present + ToLegacyNames,
    // met dezelfde instellingen die de plugin gebruikt.
    private static string[] FromFlagService(LegacyFlagInput input)
    {
        var raw = LegacyFlagOracle.RawProperties(input);
        var settings = new FlagSettings
        {
            ShowGreen = input.ShowGreen,
            ShowYellow = input.ShowYellow,
            ShowDoubleYellow = input.ShowDoubleYellow,
            ShowRed = input.ShowRed,
            ShowBlue = input.ShowBlue,
            ShowWhite = input.ShowWhite,
            ShowCheckered = input.ShowCheckered,
            ShowBlack = input.ShowBlack,
            ShowOrange = input.ShowOrange,
            ShowDebris = input.ShowDebris,
            ShowMeatball = input.ShowMeatball,
            ShowSafetyCar = input.ShowSafetyCar,
            ShowVirtualSafetyCar = input.ShowVirtualSafetyCar,
            ShowFullCourseYellow = input.ShowFullCourseYellow,
            ShowWhiteSlowCar = input.ShowWhiteSlowCar,
            ShowWhiteFinalLap = input.ShowWhiteFinalLap,
        };
        var context = new FlagContext
        {
            Game = "IRacing",
            Snapshot = new StatusDataBase(),
            GetRaw = name => raw.ContainsKey(name) ? raw[name] : null,
            IsInCar = true,
            InPitLane = false,
        };
        var service = new FlagService();
        var detected = service.Detect(context, settings);
        var state = FlagService.Present(detected, FlagService.MaskOf(settings));
        return FlagService.ToLegacyNames(state);
    }

    private static string Describe(LegacyFlagInput input)
    {
        return "flags=" + (input.SessionFlags.HasValue ? "0x" + input.SessionFlags.Value.ToString("X") : "afwezig")
            + " white=" + (input.FlagWhite.HasValue ? input.FlagWhite.Value.ToString("0") : "afwezig")
            + " slow=" + input.SlowCarAhead
            + " type=" + input.SessionTypeName;
    }

    private static string Join(string[] values) { return values == null ? "null" : string.Join("|", values); }

    private static bool Equals(string[] left, string[] right)
    {
        if (left == null || right == null) return left == null && right == null;
        if (left.Length != right.Length) return false;
        for (var i = 0; i < left.Length; i++)
            if (!string.Equals(left[i], right[i], StringComparison.Ordinal)) return false;
        return true;
    }
}
