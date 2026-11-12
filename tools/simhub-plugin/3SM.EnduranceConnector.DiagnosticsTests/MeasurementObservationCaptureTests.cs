using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Text;
using ThreeSM.EnduranceConnector;

// T13-S2A — pure observation-builder, DTO-serialisatie en lokale contracten.
// Alle fixtures zijn synthetisch: geen SimHub, iRacing, klok, netwerk of DB.
internal static class MeasurementObservationCaptureTests
{
    private const string Device = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string OtherDevice = "99999999-8888-4777-8666-555555555555";
    private static readonly DateTime T0 = new DateTime(2026, 9, 27, 10, 0, 0, DateTimeKind.Utc);

    private static DateTime At(long milliseconds)
    {
        return T0.AddTicks(milliseconds * TimeSpan.TicksPerMillisecond);
    }

    private static ObservationPairingBinding Binding()
    {
        return new ObservationPairingBinding(Device, Owner, 7, true);
    }

    private static ObservationLapContext Context()
    {
        return new ObservationLapContext("car-1", 123, "Testbaan", "Grand Prix", 42, 3);
    }

    private static ObservationSample Sample(long milliseconds, bool? pit = null, double? fuel = null,
        string name = null, string contextKey = "ctx-a")
    {
        return new ObservationSample(At(milliseconds), pit, fuel, name, contextKey);
    }

    private static Dictionary<string, object> Parse(string json)
    {
        return MeasurementJson.DeserializeDictionary(json);
    }

    private static Dictionary<string, object> Nested(Dictionary<string, object> value, string key)
    {
        return (Dictionary<string, object>)value[key];
    }

    private static double Number(Dictionary<string, object> value, string key)
    {
        return Convert.ToDouble(value[key], CultureInfo.InvariantCulture);
    }

    private static int Integer(Dictionary<string, object> value, string key)
    {
        return Convert.ToInt32(value[key], CultureInfo.InvariantCulture);
    }

    private static Dictionary<string, object> Interval(ObservationCaptureResult result)
    {
        return result.HasObservation ? Nested(Parse(result.ToJson()), "interval") : null;
    }

    private static string EdgeEvidence(ObservationCaptureResult result)
    {
        var interval = Interval(result);
        if (interval == null) return "code=" + result.Code + " (geen observation)";
        return "code=" + result.Code
            + " edgeBefore=" + Number(interval, "edgeBeforeSeconds").ToString(CultureInfo.InvariantCulture)
            + " edgeAfter=" + Number(interval, "edgeAfterSeconds").ToString(CultureInfo.InvariantCulture)
            + " unknown=" + Number(interval, "unknownSeconds").ToString(CultureInfo.InvariantCulture);
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // OB01 — één sample zonder feiten levert geen observation.
        var ob01 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0) }, At(0), At(0));
        Check("OB01", !ob01.HasObservation && ob01.Code == ObservationCaptureCodes.NoFact,
            "no-fact code=" + ob01.Code);

        // OB02 — één sample met pitRoad true: first==last, maxGap 0.
        var ob02 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var ob02j = ob02.HasObservation ? Parse(ob02.ToJson()) : null;
        var ob02i = ob02.HasObservation ? Nested(ob02j, "interval") : null;
        var ob02p = ob02.HasObservation ? Nested(ob02j, "pitRoad") : null;
        Check("OB02", ob02.HasObservation
            && Integer(ob02i, "samples") == 1
            && Number(ob02i, "maxGapSeconds") == 0
            && (string)ob02i["firstSampleAt"] == (string)ob02i["lastSampleAt"]
            && (string)ob02p["firstAt"] == (string)ob02i["firstSampleAt"]
            && (bool)ob02p["value"],
            "samples=1 maxGap=0 first=last pit.firstAt=first");

        // OB03 — twee samples 50 ms, rij eindigt 90 s na de start. Dit is de
        // goedgekeurde matrixvorm; de edge is een echt tijdsverschil, geen cap.
        var ob03 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(50, pit: true) }, At(0), At(90000));
        var ob03i = Interval(ob03);
        Check("OB03", ob03.HasObservation && ob03.Code == ObservationCaptureCodes.Accepted
            && Number(ob03i, "maxGapSeconds") == 0.05
            && Number(ob03i, "edgeBeforeSeconds") == 0
            && Number(ob03i, "edgeAfterSeconds") == 89.95
            && Number(ob03i, "unknownSeconds") == 89.95,
            "twee 50ms-samples, rij 0..90s: " + EdgeEvidence(ob03));

        // OB04 — interne gap 1,2 s telt volledig in unknown.
        var ob04 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(1200, pit: true) }, At(0), At(1200));
        var ob04i = Nested(Parse(ob04.ToJson()), "interval");
        Check("OB04", Number(ob04i, "maxGapSeconds") == 1.2
            && Number(ob04i, "unknownSeconds") == 1.2,
            "maxGap=1.2 unknown=1.2");

        // OB05 — exact 1,0 s is niet boven de strikte drempel.
        var ob05 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(1000, pit: true) }, At(0), At(1000));
        var ob05i = Nested(Parse(ob05.ToJson()), "interval");
        Check("OB05", Number(ob05i, "maxGapSeconds") == 1.0
            && Number(ob05i, "unknownSeconds") == 0,
            "maxGap=1.0 unknown=0 (strict >1.0)");

        // OB06 — null breekt de fuelketen; geen verzonnen 2 L.
        var ob06 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: null, name: "A"), Sample(2000, fuel: 62, name: "A")
        }, At(0), At(2000));
        Check("OB06", ob06.HasObservation && !Parse(ob06.ToJson()).ContainsKey("refuel"),
            "geen refuel over null");

        // OB07 — daling is geen negatieve stap.
        var ob07 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 59, name: "A")
        }, At(0), At(1000));
        Check("OB07", ob07.HasObservation && !Parse(ob07.ToJson()).ContainsKey("refuel"),
            "geen refuel bij daling");

        // OB08 — één positieve stap in pit.
        var ob08 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: false, fuel: 60, name: "A"), Sample(1000, pit: true, fuel: 62.4, name: "A")
        }, At(0), At(1000));
        var ob08r = Nested(Parse(ob08.ToJson()), "refuel");
        Check("OB08", Number(ob08r, "observedAddedLitres") == 2.4
            && Integer(ob08r, "positiveSteps") == 1
            && (string)ob08r["firstAt"] == "2026-09-27T10:00:01.000Z"
            && !ob08r.ContainsKey("maxUndetectedLitres"),
            "added=2.4 steps=1 firstAt=step; onbekende bound weggelaten");

        // OB09 — twee stappen, geen netto totaal.
        var ob09 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 61, name: "A"), Sample(2000, fuel: 62.4, name: "A")
        }, At(0), At(2000));
        var ob09r = Nested(Parse(ob09.ToJson()), "refuel");
        Check("OB09", Number(ob09r, "observedAddedLitres") == 2.4
            && Integer(ob09r, "positiveSteps") == 2,
            "added=2.4 steps=2");

        // OB10 — contextwissel breekt de keten.
        var ob10 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A", contextKey: "ctx-a"),
            Sample(1000, fuel: 62.4, name: "A", contextKey: "ctx-b")
        }, At(0), At(1000));
        Check("OB10", ob10.HasObservation && !Parse(ob10.ToJson()).ContainsKey("refuel"),
            "geen step over contextwissel");

        // OB11 — OnPitRoad onbekend is geen false.
        var ob11 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: null, name: "A") }, At(0), At(0));
        Check("OB11", ob11.HasObservation && !Parse(ob11.ToJson()).ContainsKey("pitRoad"),
            "geen pitRoad bij null");

        // OB12 — eerste true-sample bepaalt firstAt.
        var ob12 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: null, name: "A"), Sample(500, pit: true, name: "A"), Sample(1000, pit: true, name: "A")
        }, At(0), At(1000));
        var ob12p = Nested(Parse(ob12.ToJson()), "pitRoad");
        Check("OB12", (bool)ob12p["value"] && (string)ob12p["firstAt"] == "2026-09-27T10:00:00.500Z",
            "pit firstAt=eerste true");

        // OB13/OB14/OB15 — naamcontinuïteit.
        var ob13 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, name: "A"), Sample(1000, name: "A"), Sample(2000, name: "A")
        }, At(0), At(2000));
        var ob13n = Nested(Parse(ob13.ToJson()), "driverNameContinuity");
        Check("OB13", (string)ob13n["value"] == "unchanged", "A,A,A unchanged");

        var ob14 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true, name: "A"), Sample(1000, pit: true, name: ""), Sample(2000, pit: true, name: "A")
        }, At(0), At(2000));
        Check("OB14", ob14.HasObservation && !Parse(ob14.ToJson()).ContainsKey("driverNameContinuity")
            && Parse(ob14.ToJson()).ContainsKey("pitRoad"),
            "lege naam omits groep, pit blijft");

        var ob15 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, name: "A"), Sample(1000, name: "B"), Sample(2000, name: "A")
        }, At(0), At(2000));
        Check("OB15", (string)Nested(Parse(ob15.ToJson()), "driverNameContinuity")["value"] == "changed",
            "A,B,A changed");

        // OB16 — onvolledige context vervalt, andere feiten blijven.
        var incomplete = new ObservationLapContext("car-1", null, "Testbaan", "GP", null, null);
        var ob16 = ObservationCapture.Build(Binding(), incomplete,
            new[] { Sample(0, pit: true, name: "A") }, At(0), At(0));
        var ob16j = Parse(ob16.ToJson());
        Check("OB16", ob16.HasObservation && !ob16j.ContainsKey("context") && ob16j.ContainsKey("pitRoad"),
            "context omitted, pit blijft");

        // OB17/OB18 — volledige context en optionele nulwaarden.
        var fullContext = new ObservationLapContext("car-1", 123, "Testbaan", "Grand Prix", 0, 0);
        var ob17 = ObservationCapture.Build(Binding(), fullContext,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var ob17c = Nested(Parse(ob17.ToJson()), "context");
        Check("OB17", (string)ob17c["carId"] == "car-1" && Integer(ob17c, "trackId") == 123
            && ob17c.ContainsKey("sessionUniqueId") && ob17c.ContainsKey("sessionNumber")
            && Integer(ob17c, "sessionUniqueId") == 0 && Integer(ob17c, "sessionNumber") == 0,
            "volledige context; 0 is een geldige optionele waarde");

        var ob18 = ObservationCapture.Build(Binding(),
            new ObservationLapContext("car-1", 123, "Testbaan", "GP", null, null),
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var ob18c = Nested(Parse(ob18.ToJson()), "context");
        Check("OB18", !ob18c.ContainsKey("sessionUniqueId") && !ob18c.ContainsKey("sessionNumber"),
            "onbekende sessievelden weggelaten, nooit 0 verzonnen");

        // OB19 — UTF-8-bytecaps, multibyte en de 2048-byte wiregrens.
        var car64 = new string('é', 32); // 64 UTF-8 bytes
        var carTooBig = new string('é', 33);
        var ob19a = ObservationCapture.Build(Binding(),
            new ObservationLapContext(car64, 1, "baan", "cfg", null, null),
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var ob19b = ObservationCapture.Build(Binding(),
            new ObservationLapContext(carTooBig, 1, "baan", "cfg", null, null),
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var ob19c = Nested(Parse(ob19a.ToJson()), "context");
        Check("OB19", ob19a.HasObservation && (string)ob19c["carId"] == car64
            && ob19b.HasObservation && !Parse(ob19b.ToJson()).ContainsKey("context")
            && Encoding.UTF8.GetByteCount(ob19a.ToJson()) <= ObservationContract.MaxWireBytes,
            "64 bytes accepted, 66 bytes context omitted, wire=" + Encoding.UTF8.GetByteCount(ob19a.ToJson()));

        var oversized = new MeasurementObservationV1Dto(1,
            new MeasurementObservationCaptureV1Dto(Device),
            new MeasurementObservationIntervalV1Dto("2026-09-27T10:00:00.000Z", "2026-09-27T10:00:00.000Z",
                1, 0, 0, 0, 0), null, null, null,
            new MeasurementObservationContextV1Dto("car", 1, new string('漢', 700), "cfg", null, null));
        Check("OB19b", !ObservationWireBudget.Fits(oversized)
            && ObservationWireBudget.Utf8Bytes(MeasurementJson.Serialize(oversized)) > ObservationContract.MaxWireBytes,
            "synthetische oversized DTO >2048 bytes wordt geweigerd");

        // OB20 — 100 ns-ruis quantiseert naar exact .fff.
        DateTime noisyFirst = T0.AddTicks(9999999); // 0.9999999 s
        DateTime noisyLast = T0.AddTicks(10000000); // 1.0000000 s
        var ob20 = ObservationCapture.Build(Binding(), null, new[]
        {
            new ObservationSample(noisyFirst, true, null, "A", "ctx-a"),
            new ObservationSample(noisyLast, true, null, "A", "ctx-a")
        }, noisyFirst, noisyLast);
        var ob20i = Nested(Parse(ob20.ToJson()), "interval");
        Check("OB20", (string)ob20i["firstSampleAt"] == "2026-09-27T10:00:00.999Z"
            && (string)ob20i["lastSampleAt"] == "2026-09-27T10:00:01.000Z"
            && Number(ob20i, "maxGapSeconds") == 0.001,
            "100ns -> .999/.000, gap 0.001");

        // OB21 — een sample buiten het rijvenster wordt geweigerd, niet geclampt.
        var ob21 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(2000, pit: true) }, At(0), At(1000));
        Check("OB21", !ob21.HasObservation && ob21.Code == ObservationCaptureCodes.SampleOutsideWindow,
            "buiten venster -> " + ob21.Code);

        // OB22 — geen samples en tijdorder.
        var ob22a = ObservationCapture.Build(Binding(), null, new ObservationSample[0], At(0), At(0));
        var ob22b = ObservationCapture.Build(Binding(), null,
            new[] { Sample(1000, pit: true), Sample(0, pit: true) }, At(0), At(1000));
        Check("OB22", ob22a.Code == ObservationCaptureCodes.NoSamples
            && ob22b.Code == ObservationCaptureCodes.TimeOrder,
            "0 samples / first>last geweigerd");

        // OB23 — +0,0004 L is onder de gedeclareerde korrel.
        var ob23 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 60.0004, name: "A")
        }, At(0), At(1000));
        Check("OB23", ob23.HasObservation && !Parse(ob23.ToJson()).ContainsKey("refuel"),
            "geen step onder 0.001 L");

        // OB23-AT/ABOVE — de wirekorrel is 0.001 L met AwayFromZero. Dit is
        // bestaand geaccepteerd producergedrag (§3.4), geen sensormeting en
        // geen nieuw negatief feit: de echte C#-runtimewaarden zijn leidend.
        var ob23At = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 60.0005, name: "A")
        }, At(0), At(1000));
        var ob23AtR = ob23At.HasObservation && Parse(ob23At.ToJson()).ContainsKey("refuel")
            ? Nested(Parse(ob23At.ToJson()), "refuel") : null;
        Check("OB23-AT", ob23At.HasObservation && ob23AtR != null
            && Number(ob23AtR, "observedAddedLitres") == 0.001
            && Integer(ob23AtR, "positiveSteps") == 1
            && Number(ob23AtR, "resolutionLitres") == 0.001,
            "60 -> 60.0005: step=" + (ob23AtR == null ? "none" : Number(ob23AtR, "observedAddedLitres").ToString(CultureInfo.InvariantCulture)));

        var ob23Above = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 60.0006, name: "A")
        }, At(0), At(1000));
        var ob23AboveR = ob23Above.HasObservation ? Nested(Parse(ob23Above.ToJson()), "refuel") : null;
        Check("OB23-ABOVE", ob23Above.HasObservation && ob23AboveR != null
            && Number(ob23AboveR, "observedAddedLitres") == 0.001
            && Integer(ob23AboveR, "positiveSteps") == 1,
            "60 -> 60.0006: step=" + (ob23AboveR == null ? "none" : Number(ob23AboveR, "observedAddedLitres").ToString(CultureInfo.InvariantCulture)));

        // OB24 — eerste naam leeg, daarna bekend: geen claim.
        var ob24 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true, name: ""), Sample(1000, pit: true, name: "A"), Sample(2000, pit: true, name: "B")
        }, At(0), At(2000));
        Check("OB24", ob24.HasObservation && !Parse(ob24.ToJson()).ContainsKey("driverNameContinuity"),
            "eerste naam leeg -> groep weg");

        // OB25 — fuelstappen zonder OnPitRoad zijn refuel, geen pitRoad.
        var ob25 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: null, fuel: 60, name: "A"), Sample(1000, pit: null, fuel: 61, name: "A")
        }, At(0), At(1000));
        var ob25j = Parse(ob25.ToJson());
        Check("OB25", ob25j.ContainsKey("refuel") && !ob25j.ContainsKey("pitRoad"),
            "fuel-only levert refuel, nooit pitRoad");

        // OB26 — keten breekt op contextwissel en start daarna opnieuw.
        var ob26 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A", contextKey: "ctx-a"),
            Sample(1000, fuel: 62, name: "A", contextKey: "ctx-b"),
            Sample(2000, fuel: 63, name: "A", contextKey: "ctx-b")
        }, At(0), At(2000));
        var ob26r = Nested(Parse(ob26.ToJson()), "refuel");
        Check("OB26", Number(ob26r, "observedAddedLitres") == 1.0
            && Integer(ob26r, "positiveSteps") == 1,
            "geen 2L over wissel; daarna +1L");

        // Extra: een tijdsgat boven 1 s is geen betrouwbare fuelketen.
        var gapFuel = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1500, fuel: 62, name: "A")
        }, At(0), At(1500));
        Check("OBS-GAP-FUEL", gapFuel.HasObservation && !Parse(gapFuel.ToJson()).ContainsKey("refuel"),
            "fuelstap over 1,5 s gap wordt niet gebrugd");

        // OB27 — samples>1 met gelijke gequantiseerde tijd wordt lokaal geweigerd.
        var ob27 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true), Sample(0, pit: true)
        }, At(0), At(0));
        Check("OB27", !ob27.HasObservation && ob27.Code == ObservationCaptureCodes.BoundsInconsistent,
            "same-ms samples>1 -> " + ob27.Code);

        // OB28 — 100 ns vóór de grens valt buiten het venster (geen clamp).
        var ob28 = ObservationCapture.Build(Binding(), null,
            new[] { new ObservationSample(T0.AddTicks(9999999), true, null, "A", "ctx-a") },
            T0.AddSeconds(1), T0.AddSeconds(2));
        Check("OB28", !ob28.HasObservation && ob28.Code == ObservationCaptureCodes.SampleOutsideWindow,
            "100ns vóór rijstart -> geweigerd, geen EPS");

        // OBS-EDGE-AFTER-50 — normale 20 Hz-lap: laatste sample 50 ms vóór
        // rowEnd. De edge is een waar tijdsverschil; 50 ms is geen fout.
        var edgeAfter50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(1000, pit: true), Sample(2000, pit: true) },
            At(0), At(2050));
        var edgeAfter50i = Interval(edgeAfter50);
        Check("OBS-EDGE-AFTER-50", edgeAfter50.HasObservation
            && edgeAfter50.Code == ObservationCaptureCodes.Accepted
            && edgeAfter50.Observation.Interval.EdgeAfterSeconds == 0.05
            && edgeAfter50i != null
            && Number(edgeAfter50i, "edgeBeforeSeconds") == 0
            && Number(edgeAfter50i, "edgeAfterSeconds") == 0.05
            && Number(edgeAfter50i, "unknownSeconds") == 0.05,
            "samples 0/1000/2000, row 0..2050: " + EdgeEvidence(edgeAfter50));

        // OBS-EDGE-BEFORE-50 — eerste sample 50 ms na rowStart.
        var edgeBefore50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(50, pit: true), Sample(1050, pit: true) }, At(0), At(1050));
        var edgeBefore50i = Interval(edgeBefore50);
        Check("OBS-EDGE-BEFORE-50", edgeBefore50.HasObservation
            && edgeBefore50.Code == ObservationCaptureCodes.Accepted
            && edgeBefore50.Observation.Interval.EdgeBeforeSeconds == 0.05
            && edgeBefore50i != null
            && Number(edgeBefore50i, "edgeBeforeSeconds") == 0.05
            && Number(edgeBefore50i, "edgeAfterSeconds") == 0
            && Number(edgeBefore50i, "unknownSeconds") == 0.05,
            "samples 50/1050, row 0..1050: " + EdgeEvidence(edgeBefore50));

        // OBS-EDGE-BOTH-50 — beide randen zijn accurate 50 ms.
        var edgeBoth50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(50, pit: true), Sample(1050, pit: true), Sample(2050, pit: true) },
            At(0), At(2100));
        var edgeBoth50i = Interval(edgeBoth50);
        Check("OBS-EDGE-BOTH-50", edgeBoth50.HasObservation
            && edgeBoth50.Code == ObservationCaptureCodes.Accepted
            && edgeBoth50.Observation.Interval.EdgeBeforeSeconds == 0.05
            && edgeBoth50.Observation.Interval.EdgeAfterSeconds == 0.05
            && edgeBoth50i != null
            && Number(edgeBoth50i, "unknownSeconds") == 0.1,
            "samples 50/1050/2050, row 0..2100: " + EdgeEvidence(edgeBoth50));

        // OBS-EDGE-20HZ — de echte TelemetrySampler-vorm: de volgende tick
        // sluit de vorige lap, dus de laatste geaccepteerde sample ligt 50 ms
        // vóór rowEnd. Dit is niet als nul-edge weg te redeneren.
        var edge20Hz = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(89950, pit: true) }, At(0), At(90000));
        var edge20Hzi = Interval(edge20Hz);
        Check("OBS-EDGE-20HZ", edge20Hz.HasObservation
            && edge20Hz.Code == ObservationCaptureCodes.Accepted
            && edge20Hz.Observation.Interval.EdgeAfterSeconds == 0.05
            && edge20Hzi != null
            && Number(edge20Hzi, "maxGapSeconds") == 89.95
            && Number(edge20Hzi, "edgeBeforeSeconds") == 0
            && Number(edge20Hzi, "edgeAfterSeconds") == 0.05
            && Number(edge20Hzi, "unknownSeconds") == 90.0,
            "samples 0/89950, row 0..90000 (next tick): " + EdgeEvidence(edge20Hz));

        // OBS-CAP-EDGE/UNKNOWN — de 86 400 s-grenzen zijn inclusief en gelden
        // per veld én voor de onbekende som; geen clamp en geen EPS.
        var edgeCapInclusive = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) }, At(0), At(86400000));
        var edgeCapOver = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) }, At(0), At(86400001));
        var unknownCapInclusive = ObservationCapture.Build(Binding(), null,
            new[] { Sample(43200000, pit: true) }, At(0), At(86400000));
        var unknownCapOver = ObservationCapture.Build(Binding(), null,
            new[] { Sample(43200000, pit: true) }, At(0), At(86400001));
        Check("OBS-CAP-EDGE-86400", edgeCapInclusive.HasObservation
            && Number(Interval(edgeCapInclusive), "edgeAfterSeconds") == 86400
            && Number(Interval(edgeCapInclusive), "unknownSeconds") == 86400,
            "edgeAfter=86400 inclusief: " + EdgeEvidence(edgeCapInclusive));
        Check("OBS-CAP-EDGE-86400-001", edgeCapOver.Code == ObservationCaptureCodes.InvalidNumber,
            "edgeAfter=86400.001 -> " + edgeCapOver.Code);
        Check("OBS-CAP-UNKNOWN-86400", unknownCapInclusive.HasObservation
            && Number(Interval(unknownCapInclusive), "edgeBeforeSeconds") == 43200
            && Number(Interval(unknownCapInclusive), "edgeAfterSeconds") == 43200
            && Number(Interval(unknownCapInclusive), "unknownSeconds") == 86400,
            "before+after=86400 inclusief: " + EdgeEvidence(unknownCapInclusive));
        Check("OBS-CAP-UNKNOWN-86400-001", unknownCapOver.Code == ObservationCaptureCodes.InvalidNumber,
            "before+after=86400.001 (elk veld <= cap) -> " + unknownCapOver.Code);

        // OBS-UNKNOWN-EDGES — edges en maxGap>1 s tellen exact op, zonder
        // clamp naar het venster of naar een kleinere waarde.
        var unknownEdges = ObservationCapture.Build(Binding(), null,
            new[] { Sample(50, pit: true), Sample(1250, pit: true) }, At(0), At(1300));
        var unknownEdgesi = Interval(unknownEdges);
        Check("OBS-UNKNOWN-EDGES", unknownEdges.HasObservation
            && Number(unknownEdgesi, "maxGapSeconds") == 1.2
            && Number(unknownEdgesi, "edgeBeforeSeconds") == 0.05
            && Number(unknownEdgesi, "edgeAfterSeconds") == 0.05
            && Number(unknownEdgesi, "unknownSeconds") == 1.3,
            "edges .05+.05 + maxGap 1.2: " + EdgeEvidence(unknownEdges));

        // OBS-BOUNDS-REVERSE / OBS-UTC — ongeldige grenzen en niet-UTC blijven
        // een harde lokale weigering.
        var reverse = ObservationCapture.Build(Binding(), null,
            new[] { Sample(1500, pit: true) }, At(2000), At(1000));
        Check("OBS-BOUNDS-REVERSE", !reverse.HasObservation
            && reverse.Code == ObservationCaptureCodes.BoundsInconsistent,
            "rowEnd vóór rowStart -> " + reverse.Code);

        var localSample = ObservationCapture.Build(Binding(), null,
            new[] { new ObservationSample(DateTime.SpecifyKind(T0, DateTimeKind.Local), true, null, "A", "ctx-a") },
            T0, At(0));
        var unspecifiedRow = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) },
            DateTime.SpecifyKind(T0, DateTimeKind.Unspecified), At(0));
        Check("OBS-UTC", localSample.Code == ObservationCaptureCodes.InvalidTimestamp
            && unspecifiedRow.Code == ObservationCaptureCodes.InvalidTimestamp,
            "local sample=" + localSample.Code + ", unspecified row=" + unspecifiedRow.Code);

        // OB29 — trim/ordinal is gelijk aan de legacy-normalisatie.
        var ob29 = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, name: "A"), Sample(1000, name: "A "), Sample(2000, name: " A")
        }, At(0), At(2000));
        Check("OB29", (string)Nested(Parse(ob29.ToJson()), "driverNameContinuity")["value"] == "unchanged",
            "A/A  -> unchanged");

        // Extra: duplicaten tellen mee in samples en verdwijnen niet.
        var dup = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true), Sample(0, pit: true), Sample(1000, pit: true)
        }, At(0), At(1000));
        var dupi = Nested(Parse(dup.ToJson()), "interval");
        Check("OBS-DUP", Integer(dupi, "samples") == 3 && Number(dupi, "maxGapSeconds") == 1.0,
            "drie punten, maxGap 1.0");

        // Extra: incomplete binding weigert de hele observation.
        var incompleteBinding = new ObservationPairingBinding(Device, Owner, 7, false);
        var badPair = ObservationCapture.Build(incompleteBinding, null,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        Check("OBS-PAIR", !badPair.HasObservation && badPair.Code == ObservationCaptureCodes.PairingIncomplete,
            "generation onbekend -> geen observation");

        // Extra: NaN/Infinity-brandstof breekt de keten zonder throw.
        var nonFinite = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: double.NaN, name: "A"),
            Sample(2000, fuel: 62, name: "A"), Sample(3000, fuel: double.PositiveInfinity, name: "A")
        }, At(0), At(3000));
        Check("OBS-NUM", nonFinite.HasObservation && !Parse(nonFinite.ToJson()).ContainsKey("refuel"),
            "NaN/Infinity geen step, geen exception");

        // Extra: ongeldige optionele contextgetallen vervallen, groep blijft.
        var rangeContext = new ObservationLapContext("car-1", 123, "Testbaan", "GP", -1, 1001);
        var range = ObservationCapture.Build(Binding(), rangeContext,
            new[] { Sample(0, name: "A"), Sample(1000, fuel: -1, name: "A"), Sample(2000, fuel: 62, name: "A") },
            At(0), At(2000));
        var rangeJson = Parse(range.ToJson());
        var rangeCtx = Nested(rangeJson, "context");
        Check("OBS-RANGE", range.HasObservation && rangeCtx.ContainsKey("carId")
            && !rangeCtx.ContainsKey("sessionUniqueId") && !rangeCtx.ContainsKey("sessionNumber")
            && !rangeJson.ContainsKey("refuel"),
            "negatief fuel en buiten-bereik sessievelden -> geen feit/geen crash");

        // Extra: een som boven 300 L laat de refuelgroep vallen, niet afkappen.
        var refuelCap = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 0, name: "A"), Sample(1000, fuel: 300, name: "A"), Sample(2000, fuel: 300.5, name: "A")
        }, At(0), At(2000));
        Check("OBS-REFUEL-CAP", refuelCap.HasObservation
            && !Parse(refuelCap.ToJson()).ContainsKey("refuel")
            && refuelCap.OmittedGroups.Contains("refuel"),
            "som >300 L -> groep weg, geen afgekapt totaal");

        // Extra: ongeldige UUID en casing/behoud.
        var invalidBinding = new ObservationPairingBinding("not-a-uuid", Owner, 1, true);
        var invalid = ObservationCapture.Build(invalidBinding, null,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var uppercase = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        var capture = Nested(Parse(uppercase.ToJson()), "capture");
        Check("OBS-UUID", invalid.Code == ObservationCaptureCodes.PairingIncomplete
            && (string)capture["deviceId"] == Device,
            "ongeldige UUID weigert; uppercase blijft behouden");

        // Extra: 1.000.001 punten is een expliciete weigering, geen overflow.
        var many = new ObservationCapture(Binding(), null);
        for (var index = 0; index < ObservationContract.MaxSamples + 1; index++)
        {
            many.AddSample(Sample(index, pit: true));
        }
        var over = many.Build(At(0), At(ObservationContract.MaxSamples));
        Check("OBS-CAP", over.Code == ObservationCaptureCodes.TooManySamples,
            "1.000.001 punten -> " + over.Code);

        // DTO-serialisatie: optioneel observation-lid, echte bytes.
        var row = Row(uppercase, At(0), At(0));
        var rowJson = row.ToJson();
        var rowParsed = Parse(rowJson);
        var rowObs = Nested(rowParsed, "observation");
        Check("DTO-01", rowParsed.ContainsKey("observation")
            && Integer(Nested(rowObs, "interval"), "samples") == 1
            && (string)Nested(rowObs, "capture")["deviceId"] == Device,
            "record.ToDto/ToJson draagt observation");

        var legacy = new MeasurementLapSummaryRecord
        {
            SummaryUid = "22222222-2222-4222-8222-222222222222",
            SummaryId = "summary-1",
            SegmentId = "segment-1",
            ObservedSessionId = "sim-s0",
            LapNumber = 12,
            StartedAtUtc = new DateTime(2026, 9, 27, 10, 0, 0, 123, DateTimeKind.Utc),
            EndedAtUtc = new DateTime(2026, 9, 27, 10, 1, 31, 456, DateTimeKind.Utc),
            CurrentDriverName = "Naam",
            AggregationVersion = 1,
            RecordRevision = 1,
            Complete = true,
            PitLap = false,
            DriverChanged = false,
            FuelStartLitres = 60.0,
            FuelEndLitres = 42.5,
            FuelAddedLitresObserved = 0.0,
            SampleCount = 1820,
            MaxGapSeconds = 0.05,
            ValidDurationSeconds = 91.333,
            Coverage = new MeasurementLapCoverageDto
            {
                Fuel = new MeasurementCoverageGroupDto
                {
                    ValidDurationSeconds = 91.0,
                    SampleCount = 1820,
                    MaxGapSeconds = 0.05
                }
            },
            PitVisitIds = new string[0]
        };
        var legacyJson = legacy.ToJson();
        var goldenPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "measurement-legacy-before-observation.json");
        var golden = File.Exists(goldenPath) ? File.ReadAllText(goldenPath) : null;
        Check("DTO-02", legacyJson == golden && !legacyJson.Contains("observation"),
            "legacy-JSON bytegelijk aan vóór de wijziging, geen observation-sleutel");

        // Caller-mutatie: de DTO-API is get-only en de vastgelegde JSON verandert niet.
        var before = uppercase.ToJson();
        var writable = typeof(MeasurementObservationV1Dto).GetProperties()
            .Any(property => property.CanWrite);
        var writableInterval = typeof(MeasurementObservationIntervalV1Dto).GetProperties()
            .Any(property => property.CanWrite);
        var recordA = Row(uppercase, At(0), At(0));
        var jsonA = recordA.ToJson();
        recordA.Observation = null;
        Check("DTO-03", !writable && !writableInterval && uppercase.ToJson() == before
            && jsonA != recordA.ToJson(),
            "DTO get-only; eerder teruggegeven JSON blijft bevroren");

        // Omit-regels: onvolledige context laat identiteitsfence ongemoeid.
        var contextChange = ObservationCapture.Build(Binding(),
            new ObservationLapContext("car-2", 123, "Testbaan", "GP", 99, 4),
            new[] { Sample(0, pit: true) }, At(0), At(0));
        Check("DTO-04", contextChange.HasObservation
            && (string)Nested(Parse(contextChange.ToJson()), "capture")["deviceId"] == Device,
            "contextwissel verandert de pairing-device niet");

        return count;
    }

    private static MeasurementLapSummaryRecord Row(ObservationCaptureResult result, DateTime started, DateTime ended,
        string summaryUid = "33333333-3333-4333-8333-333333333333", string summaryId = "summary-obs-1")
    {
        return new MeasurementLapSummaryRecord
        {
            SummaryUid = summaryUid,
            SummaryId = summaryId,
            SegmentId = "segment-obs-1",
            ObservedSessionId = "sim-s0",
            LapNumber = 4,
            StartedAtUtc = started,
            EndedAtUtc = ended,
            CurrentDriverName = "Naam",
            AggregationVersion = 1,
            RecordRevision = 1,
            Complete = true,
            Observation = result.Observation
        };
    }

    // ------------------------------------------------------------------
    // Fixture-export: uitsluitend de echte C#-serializerbytes van de
    // builder/record. De meta-regels zijn een klein C#-DTO, geen hand-JSON
    // dat als serializeroutput wordt gepresenteerd.
    // ------------------------------------------------------------------

    [DataContract]
    private sealed class FixtureMeta
    {
        [DataMember(Name = "case", Order = 1)] public string Case { get; set; }
        [DataMember(Name = "kind", Order = 2)] public string Kind { get; set; }
        [DataMember(Name = "expect", Order = 3)] public string Expect { get; set; }
        [DataMember(Name = "code", Order = 4, EmitDefaultValue = false)] public string Code { get; set; }
        [DataMember(Name = "observationFile", Order = 5, EmitDefaultValue = false)] public string ObservationFile { get; set; }
        [DataMember(Name = "rowFile", Order = 6, EmitDefaultValue = false)] public string RowFile { get; set; }
        [DataMember(Name = "startedAt", Order = 7, EmitDefaultValue = false)] public string StartedAt { get; set; }
        [DataMember(Name = "endedAt", Order = 8, EmitDefaultValue = false)] public string EndedAt { get; set; }
        [DataMember(Name = "authenticatedDeviceId", Order = 9, EmitDefaultValue = false)] public string AuthenticatedDeviceId { get; set; }
        [DataMember(Name = "note", Order = 10, EmitDefaultValue = false)] public string Note { get; set; }
    }

    private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

    private static ObservationCaptureResult FullCase()
    {
        var context = new ObservationLapContext("car-é-1", 123, "Baan 漢字", "Grand Prix", 42, 3);
        return ObservationCapture.Build(Binding(), context, new[]
        {
            Sample(0, pit: false, fuel: 60.0, name: "A"),
            Sample(500, pit: true, fuel: 60.5, name: "A"),
            Sample(1000, pit: true, fuel: 62.9, name: "A "),
            Sample(1500, pit: null, fuel: 62.9, name: "A")
        }, T0, At(1500));
    }

    public static void ExportFixtures(string directory)
    {
        Directory.CreateDirectory(directory);
        var full = FullCase();
        WriteObservation(directory, "full-context", full, T0, At(1500), "accept", null);

        var partial = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true) }, At(0), At(0));
        WriteObservation(directory, "single-pit", partial, At(0), At(0), "accept", null);

        // Echte builder-output voor normale 20 Hz-randen. De positieve fixtures
        // komen uit Build; alleen de aparte foutcontrole hieronder gebruikt
        // synthetische rowmetadata.
        var edgeAfter50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(1000, pit: true), Sample(2000, pit: true) },
            At(0), At(2050));
        WriteObservation(directory, "edge-after-50", edgeAfter50, At(0), At(2050), "accept", "observation_accepted");
        Write(directory, "edge-after-50.row.json",
            Row(edgeAfter50, At(0), At(2050), "44444444-4444-4444-8444-444444444444", "summary-edge-after-50").ToJson());

        var edgeBefore50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(50, pit: true), Sample(1050, pit: true) }, At(0), At(1050));
        WriteObservation(directory, "edge-before-50", edgeBefore50, At(0), At(1050), "accept", "observation_accepted");
        Write(directory, "edge-before-50.row.json",
            Row(edgeBefore50, At(0), At(1050), "55555555-5555-4555-8555-555555555555", "summary-edge-before-50").ToJson());

        var edgeBoth50 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(50, pit: true), Sample(1050, pit: true), Sample(2050, pit: true) },
            At(0), At(2100));
        WriteObservation(directory, "edge-both-50", edgeBoth50, At(0), At(2100), "accept", "observation_accepted");

        var edgeAfter90 = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(50, pit: true) }, At(0), At(90000));
        WriteObservation(directory, "edge-after-90s", edgeAfter90, At(0), At(90000), "accept", "observation_accepted");
        Write(directory, "edge-after-90s.row.json",
            Row(edgeAfter90, At(0), At(90000), "66666666-6666-4666-8666-666666666666", "summary-edge-after-90s").ToJson());

        var edge20Hz = ObservationCapture.Build(Binding(), null,
            new[] { Sample(0, pit: true), Sample(89950, pit: true) }, At(0), At(90000));
        WriteObservation(directory, "edge-20hz", edge20Hz, At(0), At(90000), "accept", "observation_accepted");
        Write(directory, "edge-20hz.row.json",
            Row(edge20Hz, At(0), At(90000), "77777777-7777-4777-8777-777777777777", "summary-edge-20hz").ToJson());

        // Synthetische foutcontrole: de echte builderbytes van edge-after-50
        // krijgen opzettelijk een 2 ms te wijde row. Het verschil tussen
        // declared .05 en actual .052 is 2 ms > 1 ms tolerantie; de grootte
        // .05 zelf is geldig. Dit is geen builderoutput en geen magnitude-cap.
        WriteMeta(directory, new FixtureMeta
        {
            Case = "edge-error-2ms",
            Kind = "observation",
            Expect = "reject",
            Code = "observation_edge_mismatch",
            ObservationFile = "edge-after-50.observation.json",
            StartedAt = "2026-09-27T10:00:00.000Z",
            EndedAt = "2026-09-27T10:00:02.052Z",
            AuthenticatedDeviceId = Device,
            Note = "synthetische rowmetadata rond echte builderbytes; error 2 ms > 1 ms, edge .05 is legaal"
        });

        var gap = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true), Sample(1200, pit: true)
        }, At(0), At(1200));
        WriteObservation(directory, "gap-1-2", gap, At(0), At(1200), "accept", null);

        var contextOnly = ObservationCapture.Build(Binding(), Context(),
            new[] { Sample(0) }, At(0), At(0));
        WriteObservation(directory, "context-only", contextOnly, At(0), At(0), "accept", null);

        var refuelOnly = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, fuel: 60, name: "A"), Sample(1000, fuel: 61.25, name: "A")
        }, At(0), At(1000));
        WriteObservation(directory, "refuel-positive", refuelOnly, At(0), At(1000), "accept", null);

        // Device-mismatch: geldige observation, ander geauthentiseerd device.
        WriteMeta(directory, new FixtureMeta
        {
            Case = "device-mismatch",
            Kind = "observation",
            Expect = "quarantine",
            Code = "observation_device_mismatch",
            ObservationFile = "device-mismatch.observation.json",
            StartedAt = "2026-09-27T10:00:00.000Z",
            EndedAt = "2026-09-27T10:00:01.500Z",
            AuthenticatedDeviceId = OtherDevice,
            Note = "zelfde C#-bytes, ander auth-device"
        });
        Write(directory, "device-mismatch.observation.json", full.ToJson());

        // Row/edge-mismatch: geldige observation, gemanipuleerde rijgrenzen.
        WriteMeta(directory, new FixtureMeta
        {
            Case = "edge-mismatch",
            Kind = "observation",
            Expect = "reject",
            Code = "observation_edge_mismatch",
            ObservationFile = "edge-mismatch.observation.json",
            StartedAt = "2026-09-27T09:59:59.998Z",
            EndedAt = "2026-09-27T10:00:01.502Z",
            AuthenticatedDeviceId = Device,
            Note = "row 2 ms wijder; edges kloppen niet"
        });
        Write(directory, "edge-mismatch.observation.json", full.ToJson());

        WriteMeta(directory, new FixtureMeta
        {
            Case = "row-window",
            Kind = "observation",
            Expect = "reject",
            Code = "observation_interval_outside_row",
            ObservationFile = "row-window.observation.json",
            StartedAt = "2026-09-27T10:00:00.002Z",
            EndedAt = "2026-09-27T10:00:01.500Z",
            AuthenticatedDeviceId = Device,
            Note = "row start 2 ms later dan firstSampleAt"
        });
        Write(directory, "row-window.observation.json", full.ToJson());

        // Same-ms: builder weigert lokaal; dit is een echte, synthetische
        // serializer-output van de ongeldige grens om de serverafwijzing te bewijzen.
        var sameMs = ObservationCapture.Build(Binding(), null, new[]
        {
            Sample(0, pit: true), Sample(0, pit: true)
        }, At(0), At(0));
        var invalidDto = new MeasurementObservationV1Dto(1,
            new MeasurementObservationCaptureV1Dto(Device),
            new MeasurementObservationIntervalV1Dto("2026-09-27T10:00:00.000Z", "2026-09-27T10:00:00.000Z",
                2, 0, 0, 0, 0), null, null,
            new MeasurementObservationDriverNameContinuityV1Dto("unchanged"), null);
        WriteMeta(directory, new FixtureMeta
        {
            Case = "same-ms-refusal",
            Kind = "observation",
            Expect = "reject",
            Code = "observation_bounds_inconsistent",
            ObservationFile = "same-ms-refusal.observation.json",
            StartedAt = "2026-09-27T10:00:00.000Z",
            EndedAt = "2026-09-27T10:00:00.000Z",
            AuthenticatedDeviceId = Device,
            Note = "bouwer: " + sameMs.Code + "; bestand is synthetische ongeldige DTO"
        });
        Write(directory, "same-ms-refusal.observation.json", MeasurementJson.Serialize(invalidDto));

        // Lokale weigering zonder observationbestand.
        var noFact = ObservationCapture.Build(Binding(), null, new[] { Sample(0) }, At(0), At(0));
        WriteMeta(directory, new FixtureMeta
        {
            Case = "no-fact",
            Kind = "refused",
            Expect = "refused_local",
            Code = noFact.Code,
            Note = "geen observationbestand"
        });

        // Legacy-omissie: exact de recordbytes zonder observation.
        var legacy = new MeasurementLapSummaryRecord
        {
            SummaryUid = "22222222-2222-4222-8222-222222222222",
            SummaryId = "summary-1",
            SegmentId = "segment-1",
            ObservedSessionId = "sim-s0",
            LapNumber = 12,
            StartedAtUtc = new DateTime(2026, 9, 27, 10, 0, 0, 123, DateTimeKind.Utc),
            EndedAtUtc = new DateTime(2026, 9, 27, 10, 1, 31, 456, DateTimeKind.Utc),
            CurrentDriverName = "Naam",
            AggregationVersion = 1,
            RecordRevision = 1,
            Complete = true,
            PitLap = false,
            DriverChanged = false,
            FuelStartLitres = 60.0,
            FuelEndLitres = 42.5,
            FuelAddedLitresObserved = 0.0,
            SampleCount = 1820,
            MaxGapSeconds = 0.05,
            ValidDurationSeconds = 91.333,
            Coverage = new MeasurementLapCoverageDto
            {
                Fuel = new MeasurementCoverageGroupDto
                {
                    ValidDurationSeconds = 91.0,
                    SampleCount = 1820,
                    MaxGapSeconds = 0.05
                }
            },
            PitVisitIds = new string[0]
        };
        Write(directory, "legacy-omission.row.json", legacy.ToJson());
        WriteMeta(directory, new FixtureMeta
        {
            Case = "legacy-omission",
            Kind = "legacy",
            Expect = "legacy",
            Code = "observation_absent",
            RowFile = "legacy-omission.row.json"
        });

        // Echte recordbytes met observation, voor de bestaande envelope-parser.
        var observedRow = Row(full, T0, At(1500));
        Write(directory, "envelope-observed.row.json", observedRow.ToJson());
        Write(directory, "envelope-legacy.row.json", legacy.ToJson());
        WriteMeta(directory, new FixtureMeta
        {
            Case = "envelope-on",
            Kind = "envelope",
            Expect = "accept",
            Code = "observation_accepted",
            RowFile = "envelope-observed.row.json",
            AuthenticatedDeviceId = Device,
            Note = "parseLapSummariesReport opt-in met legacy+observed"
        });
    }

    private static void WriteObservation(string directory, string name, ObservationCaptureResult result,
        DateTime started, DateTime ended, string expect, string code)
    {
        if (!result.HasObservation)
        {
            WriteMeta(directory, new FixtureMeta
            {
                Case = name, Kind = "refused", Expect = "refused_local", Code = result.Code
            });
            return;
        }
        var observationFile = name + ".observation.json";
        Write(directory, observationFile, result.ToJson());
        WriteMeta(directory, new FixtureMeta
        {
            Case = name,
            Kind = "observation",
            Expect = expect,
            Code = code,
            ObservationFile = observationFile,
            StartedAt = MeasurementTime.Format(started),
            EndedAt = MeasurementTime.Format(ended),
            AuthenticatedDeviceId = Device
        });
    }

    private static void WriteMeta(string directory, FixtureMeta meta)
    {
        Write(directory, meta.Case + ".meta.json", MeasurementJson.Serialize(meta));
    }

    private static void Write(string directory, string name, string text)
    {
        File.WriteAllText(Path.Combine(directory, name), text, Utf8NoBom);
    }
}
