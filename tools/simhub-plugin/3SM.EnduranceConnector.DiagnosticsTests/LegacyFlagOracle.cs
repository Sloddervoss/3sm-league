using System;
using System.Collections.Generic;

// Vastgelegde kopie van de iRacing-vlagmapping zoals die in 0.7.1.2 in productie zat
// (FlagService.Detect iRacing-takken + FlagService.ToLegacyNames + MaskOf(defaults)).
//
// Doel: een onafhankelijke, tijdonafhankelijke referentie voor `session.flags`.
//  - Fase 1 (baseline): FlagBaselineTests bewijst dat deze referentie exact gelijk is
//    aan wat de ECHTE FlagService.cs oplevert voor elke vlagcombinatie.
//  - Fase 2: SessionFlagReaderTests vergelijkt de nieuwe lezer met dezelfde referentie.
// Zo is "zelfde wire-waarden" een test en geen bewering.
//
// Wat hier bewust NIET in zit (dat was presentatie, geen meting): kleuren, thema's,
// boxes, animaties, latch-vensters en de debounce-teller. Die beinvloeden het resultaat
// van een enkele Detect()-aanroep niet; ze werken alleen over de tijd. Zie
// FlagsBehaviorDeltaTests voor wat er daardoor verandert.
internal sealed class LegacyFlagInput
{
    // DataCorePlugin.GameRawData.Telemetry.SessionFlags; null = kanaal ontbreekt.
    public uint? SessionFlags;

    // Losse SimHub-properties; null = property ontbreekt (AsDbl(null) == 0 in 0.7.1.2).
    public double? FlagWhite;
    public double? FlagCheckered;
    public double? FlagGreen;

    // Fallbacks als het bitmasker ontbreekt (SessionFlagsDetails.*).
    public bool DetailRed;
    public bool DetailYellow;
    public bool DetailService;

    // IRacingExtraProperties.iRacing_SlowCarAhead + SessionTypeName.
    public bool SlowCarAhead;
    public string SessionTypeName = "Race";

    // Masker uit FlagSettings (standaard alle vlaggen aan).
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
    public bool ShowMeatball = true;
    public bool ShowSafetyCar = true;
    public bool ShowVirtualSafetyCar = true;
    public bool ShowFullCourseYellow = true;
    public bool ShowWhiteSlowCar = true;
    public bool ShowWhiteFinalLap = true;
}

internal static class LegacyFlagOracle
{
    private const uint CheckeredBit = 0x1u;
    private const uint GreenBit = 0x4u;
    private const uint YellowWavingBit = 0x8u;
    private const uint RedBit = 0x10u;
    private const uint YellowBit = 0x100u;
    private const uint ServiceBit = 0x40000u;

    /// <summary>De wire-namen die 0.7.1.2 in session.flags zette, of null als er geen vlag was.</summary>
    public static string[] Names(LegacyFlagInput input)
    {
        if (input == null) return null;
        var checkered = input.SessionFlags.HasValue
            ? (input.SessionFlags.Value & CheckeredBit) != 0u
            : Truthy(input.FlagCheckered);
        var red = input.SessionFlags.HasValue
            ? (input.SessionFlags.Value & RedBit) != 0u
            : input.DetailRed;
        var yellow = input.SessionFlags.HasValue
            ? (input.SessionFlags.Value & (YellowBit | YellowWavingBit)) != 0u
            : input.DetailYellow;
        var green = input.SessionFlags.HasValue
            ? (input.SessionFlags.Value & GreenBit) != 0u
            : Truthy(input.FlagGreen);
        var meatball = input.SessionFlags.HasValue
            ? (input.SessionFlags.Value & ServiceBit) != 0u
            : input.DetailService;
        // Wit: Flag_White wint; anders "slow car ahead" buiten Lone Qualify.
        // Let op: 0.7.1.2 zette nooit het generieke White-bit, alleen WhiteSlow/WhiteFinal.
        // Het masker werkt daarom via ShowWhiteFinalLap (Flag_White) resp. ShowWhiteSlowCar.
        var whiteFinal = Truthy(input.FlagWhite);
        var whiteSlowRaw = !string.Equals(input.SessionTypeName, "Lone Qualify", StringComparison.Ordinal) && input.SlowCarAhead;
        var whiteSlow = (whiteFinal || whiteSlowRaw) && !whiteFinal;
        var white = (whiteFinal && input.ShowWhiteFinalLap) || (whiteSlow && input.ShowWhiteSlowCar);

        var names = new List<string>();
        if (checkered && input.ShowCheckered) names.Add("checkered");
        if (red && input.ShowRed) names.Add("red");
        if (yellow && input.ShowYellow) names.Add("yellow");
        if (white) names.Add("white");
        if (green && input.ShowGreen) names.Add("green");
        if (meatball && input.ShowMeatball) names.Add("meatball");
        return names.Count == 0 ? null : names.ToArray();
    }

    private static bool Truthy(double? value) { return value.HasValue && value.Value == 1.0; }

    /// <summary>De ruwe property-waarden zoals de plugin ze in 0.7.1.2 aan FlagService gaf.</summary>
    public static Dictionary<string, object> RawProperties(LegacyFlagInput input)
    {
        var map = new Dictionary<string, object>(StringComparer.Ordinal);
        if (input.SessionFlags.HasValue) map["GameRawData.Telemetry.SessionFlags"] = (double)input.SessionFlags.Value;
        if (input.FlagWhite.HasValue) map["Flag_White"] = input.FlagWhite.Value;
        if (input.FlagCheckered.HasValue) map["Flag_Checkered"] = input.FlagCheckered.Value;
        if (input.FlagGreen.HasValue) map["Flag_Green"] = input.FlagGreen.Value;
        map["GameRawData.Telemetry.SessionFlagsDetails.Isred"] = input.DetailRed;
        map["GameRawData.Telemetry.SessionFlagsDetails.Isyellow"] = input.DetailYellow;
        map["GameRawData.Telemetry.SessionFlagsDetails.Isservicible"] = input.DetailService;
        map["IRacingExtraProperties.iRacing_SlowCarAhead"] = input.SlowCarAhead;
        map["SessionTypeName"] = input.SessionTypeName;
        return map;
    }
}
