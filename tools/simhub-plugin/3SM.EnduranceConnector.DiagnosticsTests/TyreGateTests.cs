using System;
using ThreeSM.EnduranceConnector;

// 0.7.1: het bandenhek en de vingerafdruk zijn pure logica (geen SimHub-referentie),
// dus ze zijn hier los te testen. Zelfde stijl als FaseDTests: elke regel is één
// PASS/FAIL met bewijs, geen testframework.
internal static class TyreGateTests
{
    public static void Run(Action<string, bool, string> check)
    {
        const int interval = 30000;
        var gate = new TyrePublishGate();
        var a = Sample("2026-10-27T10:00:00.000Z", 95.81, 31.0);
        var b = Sample("2026-10-27T10:00:00.000Z", 95.81, 31.0);
        var c = Sample("2026-10-27T10:05:00.000Z", 61.2, 33.5);

        check("G01", gate.ShouldPublish(TyreSignature.Of(a), 1000, interval), "eerste blok gaat mee");
        check("G02", !gate.ShouldPublish(TyreSignature.Of(b), 2000, interval), "identiek blok binnen 30 s gaat niet mee");
        check("G03", !gate.ShouldPublish(TyreSignature.Of(b), 30999, interval), "identiek blok op 29,999 s gaat niet mee");
        check("G04", gate.ShouldPublish(TyreSignature.Of(b), 31000, interval), "hartslag op 30 s gaat mee");
        check("G05", gate.ShouldPublish(TyreSignature.Of(c), 32000, interval), "gewijzigd blok gaat direct mee");
        check("G06", TyreSignature.Of(a) == TyreSignature.Of(b), "zelfde inhoud = zelfde signatuur");
        check("G07", TyreSignature.Of(a) != TyreSignature.Of(c), "andere wear = andere signatuur");

        gate.Reset();
        check("G08", gate.ShouldPublish(TyreSignature.Of(b), 32001, interval), "reset dwingt opnieuw verzenden af");
        check("G09", !gate.ShouldPublish(null, 32002, interval), "geen meting = nooit verzenden");

        var zero = new TyrePublishGate();
        check("G10",
            zero.ShouldPublish("x", 0, 0) && !zero.ShouldPublish("x", 29999, 0) && zero.ShouldPublish("x", 30000, 0),
            "interval 0 valt terug op 30 s");

        var pit = new TyrePublishGate();
        var signature = TyreSignature.Of(a);
        check("G11",
            pit.ShouldPublish(signature, 1000, interval) && pit.ShouldPublish(signature, 2000, interval, true)
            && !pit.ShouldPublish(signature, 2500, interval),
            "pitstraat dwingt verzenden af, daarna weer gedempt");
    }

    private static V3Tyres Sample(string observedAt, double frontLeftWear, double airTempC)
    {
        return new V3Tyres
        {
            ObservedAt = observedAt,
            SessionTimeSeconds = 1850.5,
            Lap = 42,
            Trigger = "sim_refresh",
            CompoundId = 1,
            WearPercent = new V3TyreZones
            {
                FrontLeft = new double?[] { frontLeftWear, 96.0, 95.0 },
                FrontRight = new double?[] { 95.0, 96.0, 95.5 },
                RearLeft = new double?[] { 92.0, 93.0, 92.5 },
                RearRight = new double?[] { 92.5, 93.5, 93.0 },
            },
            CarcassTempC = new V3TyreZones
            {
                FrontLeft = new double?[] { 78.0, 80.0, 82.0 },
                FrontRight = new double?[] { 79.0, 81.0, 83.0 },
                RearLeft = new double?[] { 74.0, 76.0, 78.0 },
                RearRight = new double?[] { 75.0, 77.0, 79.0 },
            },
            Sets = new V3TyreSets { Used = 3, Available = 5 },
            Environment = new V3TyreEnvironment
            {
                TrackTempC = 31.0,
                AirTempC = airTempC,
                RubberState = "moderate usage",
            },
        };
    }
}
