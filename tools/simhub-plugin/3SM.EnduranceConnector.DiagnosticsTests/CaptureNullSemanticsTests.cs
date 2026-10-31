using System;
using System.Collections.Generic;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

// FASE 2: eerlijke nullen. Tot 0.7.1.2 waren drie gevallen niet te onderscheiden:
//
//   - ontbrekende brandstof werd 0                  (CaptureV3: Math.Max(0, GetDouble(..., 0)))
//   - ontbrekende pitstraatstatus werd false        (GetBool(..., false))
//   - wearfractie 0 werd weggefilterd als "geen meting" (ReadTyreZones)
//
// Deze test legt per geval vast wat "onbekend", "nul" en "SDK-sentinel" nu betekenen:
// onbekend = null, nul = nul, sentinel = null. En hij legt vast wat er dan in de payload
// staat, zodat de server ziet wat hij kan verwachten.
internal static class CaptureNullSemanticsTests
{
    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // ---- brandstof ----
        Check("N01", CaptureValueRules.FuelLitres(null) == null, "ontbrekende brandstof = null (was 0)");
        Check("N02", CaptureValueRules.FuelLitres(0.0) == 0.0, "gemeten 0 L blijft 0, niet null");
        Check("N03", CaptureValueRules.FuelLitres(48.75) == 48.75, "gewone meting blijft staan");
        Check("N04", CaptureValueRules.FuelLitres(-1.0) == null, "sentinel -1 is geen meting");
        Check("N05", CaptureValueRules.FuelLitres(300.0) == null, "onmogelijke tankinhoud is geen meting");
        Check("N06", CaptureValueRules.FuelLitres(double.NaN) == null, "NaN is geen meting");

        Check("N07", CaptureValueRules.FuelPercent(null, 90.0) == null, "onbekende liters geven geen brandstofpercentage");
        Check("N08", CaptureValueRules.FuelPercent(0.0, 90.0) == 0.0, "0 L in een bekende tank is 0 %, geen null");
        Check("N09", CaptureValueRules.FuelPercent(45.0, null) == null, "zonder tankinhoud geen percentage");
        Check("N10", CaptureValueRules.FuelPercent(45.0, 0.0) == null, "tankinhoud 0 is geen geldige deler");

        Check("N11", CaptureValueRules.LapsRemaining(null, 3.4, 12.0) == 12.0, "zonder liters blijft de schatting van de sim staan");
        Check("N12", CaptureValueRules.LapsRemaining(null, 3.4, null) == null, "zonder liters en zonder schatting: null, geen 0");
        Check("N13", CaptureValueRules.LapsRemaining(0.0, 3.4, 5.0) == 5.0, "0 L levert geen deling door nul op");
        Check("N14", CaptureValueRules.LapsRemaining(34.0, 3.4, null) == 10.0, "gewone berekening blijft gelijk");

        // ---- pitstraat ----
        Check("N15", CaptureValueRules.OnPitRoad(null, null) == null, "geen enkele pitstraatbron = null (was false)");
        Check("N16", CaptureValueRules.OnPitRoad(true, false) == true, "ruwe SDK-kanaal wint van de property");
        Check("N17", CaptureValueRules.OnPitRoad(false, true) == false, "SDK zegt 'niet in de pitstraat' geldt, ook als de property iets anders zegt");
        Check("N18", CaptureValueRules.OnPitRoad(null, true) == true, "zonder SDK-kanaal is de property het vangnet");
        Check("N19", CaptureValueRules.OnPitRoad(null, false) == false, "property false is een echte waarneming");

        // ---- pitService ----
        Check("N20", CaptureValueRules.PitServiceFlags(null) == null, "ontbrekend PitSvFlags = null");
        Check("N21", CaptureValueRules.PitServiceFlags(-1) == null, "sentinel -1 in PitSvFlags = null");
        Check("N22", CaptureValueRules.PitServiceFlags(0) == 0, "0 betekent 'niets aangevinkt' en blijft 0");
        Check("N23", CaptureValueRules.PitServiceFlags(48) == 48, "bitmasker blijft ongewijzigd");

        Check("N24", CaptureValueRules.RepairSeconds(null) == null, "ontbrekende reparatietijd = null");
        Check("N25", CaptureValueRules.RepairSeconds(-1.0) == null, "sentinel -1 in de reparatietijd = null");
        Check("N26", CaptureValueRules.RepairSeconds(0.0) == 0.0, "0 s betekent 'niets open' en blijft 0");
        Check("N27", CaptureValueRules.RepairSeconds(12.34) == 12.3, "reparatietijd op één decimaal");
        Check("N28", CaptureValueRules.RepairSeconds(90000.0) == null, "boven 24 uur is geen meting");

        // ---- wear: 0 is een meting ----
        var missing = ReadTyres(new Dictionary<string, object>());
        Check("N29", missing.WearPercent[0][0] == null, "ontbrekend wear-kanaal = null");
        Check("N30", missing.CarcassTempC[0][0] == null, "ontbrekend karkaskanaal = null");

        var fresh = ReadTyres(WearMap(0.0));
        Check("N31", fresh.WearPercent[0][0] == 0.0, "wearfractie 0 = 0,00 % (nieuwe band), niet null");
        Check("N32", fresh.HasWear, "een verse set telt als wear-meting, ook al is elke zone 0");

        var worn = ReadTyres(WearMap(0.0525));
        Check("N33", worn.WearPercent[0][0] == 5.25, "wearfractie 0,0525 = 5,25 %");
        Check("N34", worn.WearPercent[3][2] == 5.25, "alle twaalf zones worden gelezen");

        var outOfRange = ReadTyres(WearMap(1.5));
        Check("N35", outOfRange.WearPercent[0][0] == null, "boven 1,001 is geen wearfractie en wordt null");

        var coldTyre = ReadTyres(new Dictionary<string, object> { { "LFtempCL", 0.0 } });
        Check("N36", coldTyre.CarcassTempC[0][0] == 0.0, "0 °C karkas is een meting, geen ontbrekend kanaal");
        Check("N37", ReadTyres(new Dictionary<string, object> { { "LFtempCL", -100.0 } }).CarcassTempC[0][0] == null,
            "-100 °C valt buiten de range en is geen meting");

        // ---- wat de server nu in de payload ziet ----
        var json = V3PayloadFixtureTests.Serialize(FrameWithoutMeasurements());
        using (var document = JsonDocument.Parse(json))
        {
            var root = document.RootElement;
            var fuel = root.GetProperty("fuel");
            Check("N38", fuel.GetProperty("fuelLitres").ValueKind == JsonValueKind.Null, "payload: fuel.fuelLitres = null");
            Check("N39", fuel.TryGetProperty("fuelPct", out var pct) && pct.ValueKind == JsonValueKind.Null, "payload: fuel.fuelPct = null");
            Check("N40", !fuel.TryGetProperty("lapsRemaining", out _), "payload: fuel.lapsRemaining valt weg zonder meting");
            Check("N41", root.GetProperty("track").GetProperty("onPitRoad").ValueKind == JsonValueKind.Null, "payload: track.onPitRoad = null");
            Check("N42", root.GetProperty("tyres").GetProperty("wearPercent").GetProperty("frontLeft").GetRawText() == "[0,0,0]",
                "payload: een verse set staat er als [0,0,0], niet als ontbrekend blok");
            Check("N43", root.GetProperty("pitService").GetProperty("requiredRepairSeconds").ValueKind == JsonValueKind.Null,
                "payload: pitService.requiredRepairSeconds = null");
            Check("N44", root.GetProperty("pitService").GetProperty("optionalRepairSeconds").GetRawText() == "0",
                "payload: optionalRepairSeconds = 0 is een echte meting");
            Check("N45", root.GetProperty("pitService").GetProperty("pitServiceFlagsRaw").ValueKind == JsonValueKind.Null,
                "payload: pitService.pitServiceFlagsRaw = null bij een sentinel");
        }
        return count;
    }

    private static Dictionary<string, object> WearMap(double fraction)
    {
        var map = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var channel in TyreZoneReader.WearChannels) map[channel] = fraction;
        return map;
    }

    private static TyreZoneReading ReadTyres(Dictionary<string, object> values)
    {
        // Zelfde route als in de plugin: RawChannelReader met het property-pad.
        var channels = new RawChannelReader(null, property =>
        {
            const string prefix = RawChannelReader.TelemetryPropertyPrefix;
            var name = property != null && property.StartsWith(prefix, StringComparison.Ordinal)
                ? property.Substring(prefix.Length)
                : property;
            object value;
            return name != null && values.TryGetValue(name, out value) ? value : null;
        });
        return TyreZoneReader.Read(channels);
    }

    // Een frame zoals de plugin het zou maken als de sim niets levert: brandstof onbekend,
    // pitstraat onbekend, een verse set banden (wear 0), reparatie onbekend en een
    // PitSvFlags-sentinel.
    private static TelemetryEnvelopeV3 FrameWithoutMeasurements()
    {
        var zones = new V3TyreZones
        {
            FrontLeft = new double?[] { 0.0, 0.0, 0.0 },
            FrontRight = new double?[] { 0.0, 0.0, 0.0 },
            RearLeft = new double?[] { 0.0, 0.0, 0.0 },
            RearRight = new double?[] { 0.0, 0.0, 0.0 },
        };
        return new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3,
            Sequence = 7,
            CapturedAt = "2026-10-31T09:20:00.0000000Z",
            TransportSessionId = "simhub-fedcba9876543210fedcba9876543210",
            Session = new V3Session { IsInCar = true, Flags = null },
            Timing = new V3Timing(),
            Position = new V3Position(),
            Track = new V3Track { TrackSurface = "unknown", OnPitRoad = null },
            Fuel = new V3Fuel
            {
                FuelLitres = CaptureValueRules.FuelLitres(null),
                FuelPct = CaptureValueRules.FuelPercent(null, 90.0),
                LapsRemaining = CaptureValueRules.LapsRemaining(null, 0.0, null),
                FuelCapacityLitres = 90.0,
            },
            RaceState = new V3RaceState(),
            PitService = new V3PitService
            {
                PitServiceFlagsRaw = CaptureValueRules.PitServiceFlags(-1),
                RequiredRepairSeconds = CaptureValueRules.RepairSeconds(-1.0),
                OptionalRepairSeconds = CaptureValueRules.RepairSeconds(0.0),
            },
            Tyres = new V3Tyres
            {
                ObservedAt = "2026-10-31T09:19:58.0000000Z",
                Trigger = "session_start",
                WearPercent = zones,
            },
        };
    }
}
