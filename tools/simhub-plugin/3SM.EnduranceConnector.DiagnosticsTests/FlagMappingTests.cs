using System;
using System.Collections.Generic;
using ThreeSM.EnduranceConnector;

// Bewijst dat de nieuwe SessionFlagReader exact dezelfde wire-waarden oplevert als de
// oude FlagService (0.7.1.2) voor dezelfde SDK-toestand.
//
// De meetlat is LegacyFlagOracle: een vastgelegde kopie van de oude iRacing-mapping. Dat
// die referentie klopt is in fase 1 bewezen door hem combinatie voor combinatie tegen de
// ECHTE FlagService.cs te leggen (12.288 + 864 vergelijkingen, nul afwijkingen). Vanaf
// fase 2 is FlagService weg en vergelijkt dezelfde test de lezer met diezelfde referentie.
internal static class FlagMappingTests
{
    // Bits die het wire-resultaat kunnen raken, plus twee die dat juist niet mogen doen
    // (0x2 en 0x40000000) als controle.
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

        // Vasteijkpunten in de wire-vocabulaire.
        Check("F03", SameAs(SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x1u }), "checkered"), "bit 0x1 = checkered");
        Check("F04", SameAs(SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x108u }), "yellow"), "bit 0x108 = yellow");
        Check("F05", SameAs(SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x40000u }), "meatball"), "bit 0x40000 = meatball");
        Check("F06", SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0u }) == null, "geen vlag = null, niet een lege lijst");
        Check("F07", SameAs(SessionFlagReader.Read(new SessionFlagInput
            {
                SessionFlags = 0x1u | 0x10u | 0x100u | 0x4u | 0x40000u,
                WhiteFlag = true,
            }), "checkered", "red", "yellow", "white", "green", "meatball"), "volgorde van de wire-namen blijft gelijk");
        Check("F08", SameAs(SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x8u }), "yellow"),
            "alleen YellowWaving is ook yellow");
        Check("F09", SameAs(SessionFlagReader.Read(new SessionFlagInput { SlowCarAhead = true, SessionTypeName = "Race" }), "white"),
            "slow car ahead zonder Lone Qualify = white");
        Check("F10", SessionFlagReader.Read(new SessionFlagInput { SlowCarAhead = true, SessionTypeName = "Lone Qualify" }) == null,
            "slow car ahead in Lone Qualify = geen vlag");
        Check("F11", SessionFlagReader.Primary(new[] { "red", "yellow" }) == "red" && SessionFlagReader.Primary(null) == null,
            "primaire naam is de eerste volgens de vaste volgorde");

        // Geen latch: de oude laag hield checkered tot 10 s vast (CheckeredHoldMs) en
        // vertraagde een daling met FlagHoldTicks. Dat was presentatie, geen meting.
        var stillFlagged = SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x1u });
        var cleared = SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0u });
        Check("F12", SameAs(stillFlagged, "checkered") && cleared == null,
            "vlag valt direct weg als de SDK hem niet meer meldt (geen latch, geen hold)");

        // De oude laag maskeerde de vlaggen met de displaykeuze (MaskOf). Dat is er nu
        // bewust niet meer: een uitgezet icoontje in een dashboard mag de server niet
        // laten denken dat er geen gele vlag was.
        var masked = LegacyFlagOracle.Names(new LegacyFlagInput { SessionFlags = 0x100u, ShowYellow = false });
        Check("F13", masked == null && SameAs(SessionFlagReader.Read(new SessionFlagInput { SessionFlags = 0x100u }), "yellow"),
            "displaymasker is weg: oude laag gaf niets, de lezer geeft yellow");

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
                        // De losse Flag_*-properties zijn alleen fallback als het bitmasker
                        // ontbreekt; in het bitmaskerpad zijn ze per definitie ongebruikt.
                        foreach (var flagCheckered in withBitmask ? new double?[] { null } : new double?[] { null, 0.0, 1.0 })
                        {
                            foreach (var flagGreen in withBitmask ? new double?[] { null } : new double?[] { null, 0.0, 1.0 })
                            {
                                // De SessionFlagsDetails-fallbacks doen alleen iets zonder
                                // bitmasker; meenemen in het bitmaskerpad is 8x dezelfde meting.
                                foreach (var detail in DetailCombinations(withBitmask))
                                {
                                    var legacy = new LegacyFlagInput
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
                                    var expected = LegacyFlagOracle.Names(legacy);
                                    var actual = SessionFlagReader.Read(Convert(legacy));
                                    counts.cases++;
                                    if (!Same(expected, actual))
                                    {
                                        counts.mismatches++;
                                        if (counts.first == null)
                                            counts.first = Describe(legacy) + " oud=[" + Join(expected) + "] nieuw=[" + Join(actual) + "]";
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

    // Dezelfde SDK-toestand, uitgedrukt in de invoer van de nieuwe lezer.
    private static SessionFlagInput Convert(LegacyFlagInput legacy)
    {
        return new SessionFlagInput
        {
            SessionFlags = legacy.SessionFlags,
            WhiteFlag = legacy.FlagWhite.HasValue ? legacy.FlagWhite.Value == 1.0 : (bool?)null,
            CheckeredFlag = legacy.FlagCheckered.HasValue ? legacy.FlagCheckered.Value == 1.0 : (bool?)null,
            GreenFlag = legacy.FlagGreen.HasValue ? legacy.FlagGreen.Value == 1.0 : (bool?)null,
            DetailRed = legacy.DetailRed,
            DetailYellow = legacy.DetailYellow,
            DetailService = legacy.DetailService,
            SlowCarAhead = legacy.SlowCarAhead,
            SessionTypeName = legacy.SessionTypeName,
        };
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

    private static string Describe(LegacyFlagInput input)
    {
        return "flags=" + (input.SessionFlags.HasValue ? "0x" + input.SessionFlags.Value.ToString("X") : "afwezig")
            + " white=" + (input.FlagWhite.HasValue ? input.FlagWhite.Value.ToString("0") : "afwezig")
            + " checkered=" + (input.FlagCheckered.HasValue ? input.FlagCheckered.Value.ToString("0") : "afwezig")
            + " green=" + (input.FlagGreen.HasValue ? input.FlagGreen.Value.ToString("0") : "afwezig")
            + " slow=" + input.SlowCarAhead
            + " type=" + input.SessionTypeName;
    }

    private static string Join(string[] values) { return values == null ? "null" : string.Join("|", values); }

    private static bool SameAs(string[] actual, params string[] expected) { return Same(expected, actual); }

    private static bool Same(string[] left, string[] right)
    {
        if (left == null || right == null) return left == null && right == null;
        if (left.Length != right.Length) return false;
        for (var i = 0; i < left.Length; i++)
            if (!string.Equals(left[i], right[i], StringComparison.Ordinal)) return false;
        return true;
    }
}
