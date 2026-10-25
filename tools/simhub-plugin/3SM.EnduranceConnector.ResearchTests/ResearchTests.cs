using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

using ThreeSM.EnduranceConnector;

// Pure-logica tests voor de ResearchRecorder. Geen SimHub-DLL, geen iRacing: alleen de
// bestanden uit de pluginmap die niets van SimHub afhangen. Draaien met `dotnet run`.
internal static class ResearchTests
{
    private static int _passed;
    private static int _failed;

    public static int Main(string[] args)
    {
        if (args != null && args.Length == 2 && string.Equals(args[0], "--sample", StringComparison.Ordinal))
        {
            // Genereert de voorbeeld-sessie in docs/research uit de echte recorder.
            try
            {
                SampleSession(args[1]);
                Console.WriteLine("SAMPLE written to " + args[1]);
                return 0;
            }
            catch (Exception error)
            {
                Console.WriteLine("SAMPLE failed: " + error);
                return 1;
            }
        }
        try
        {
            Provenance();
            CaptureFields();
            Sampler();
            Jsonl();
            Queue();
            CrashRecovery();
            Events();
            Identity();
            Recorder();
        }
        catch (Exception error)
        {
            _failed++;
            Console.WriteLine("HARNESS_EXCEPTION " + error.GetType().FullName + ": " + error.Message);
            Console.WriteLine(error.StackTrace);
        }
        Console.WriteLine("SUMMARY PASS=" + _passed + " FAIL=" + _failed);
        return _failed == 0 ? 0 : 1;
    }

    // ---------------------------------------------------------------- helpers

    private static void Check(string id, bool ok, string detail)
    {
        if (ok) _passed++;
        else _failed++;
        Console.WriteLine((ok ? "PASS " : "FAIL ") + id + (string.IsNullOrEmpty(detail) ? string.Empty : " · " + detail));
    }

    private static double?[][] Grid(double? value)
    {
        var grid = new double?[4][];
        for (var corner = 0; corner < 4; corner++)
        {
            grid[corner] = new double?[3];
            for (var zone = 0; zone < 3; zone++) grid[corner][zone] = value;
        }
        return grid;
    }

    private static ResearchTyreObservation Tyres(double? wear, double? carcass, DateTime? observedAt, string trigger, bool frozen)
    {
        return new ResearchTyreObservation
        {
            HasWear = wear.HasValue,
            HasCarcass = carcass.HasValue,
            HasSets = true,
            SetsUsed = 2,
            HasEnvironment = true,
            TrackTempC = 32.5,
            AirTempC = 21.0,
            RubberState = "moderate usage",
            HasCompound = true,
            CompoundId = 3,
            WearPercent = Grid(wear),
            CarcassTempC = Grid(carcass),
            Trigger = trigger,
            ObservedAtUtc = observedAt,
            Frozen = frozen,
            FrozenAtUtc = frozen ? observedAt : null,
        };
    }

    private static readonly DateTime Base = new DateTime(2026, 10, 25, 12, 0, 0, DateTimeKind.Utc);

    private static void Advance(ResearchRecorderOptions options)
    {
        if (options == null) return;
    }

    private sealed class FakeChannels : IResearchChannelReader
    {
        public readonly Dictionary<string, double> Values = new Dictionary<string, double>(StringComparer.Ordinal);
        public readonly List<string> Reads = new List<string>();

        public void Set(string channel, double value) { Values[channel] = value; }

        public readonly Dictionary<string, double> Properties = new Dictionary<string, double>(StringComparer.Ordinal);
        public readonly List<string> PropertyReads = new List<string>();

        public void SetProperty(string property, double value) { Properties[property] = value; }

        public double? ReadNumber(string channel, double minimum, double maximum)
        {
            Reads.Add(channel);
            double value;
            if (!Values.TryGetValue(channel, out value)) return null;
            if (value < minimum || value > maximum) return null;
            return value;
        }

        public double? ReadProperty(string property, double minimum, double maximum)
        {
            PropertyReads.Add(property);
            double value;
            if (!Properties.TryGetValue(property, out value)) return null;
            if (value < minimum || value > maximum) return null;
            return value;
        }

        public int ReadsFor(string channel)
        {
            var count = 0;
            foreach (var read in Reads) if (string.Equals(read, channel, StringComparison.Ordinal)) count++;
            return count;
        }
    }

    private sealed class TempDir : IDisposable
    {
        public readonly string Path;
        public TempDir()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "3sm-research-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }
        public void Dispose() { try { Directory.Delete(Path, true); } catch { } }
    }

    private static ResearchCaptureView View(DateTime capturedAt, bool vehicle, double throttle, double brake)
    {
        return new ResearchCaptureView
        {
            Present = true,
            CapturedAtUtc = capturedAt,
            Sequence = 42,
            SessionTimeSeconds = 1234.5,
            HasVehicle = vehicle,
            ThrottlePct = vehicle ? throttle : (double?)null,
            BrakePct = vehicle ? brake : (double?)null,
            SpeedKph = 187.4,
            Gear = "5",
            Rpm = 7100,
            FuelLitres = 42.5,
            FuelPerLapLitres = 3.1,
            LapsRemaining = 13.7,
            LastLapSeconds = 102.3,
            BestLapSeconds = 101.9,
            CurrentLapElapsedSeconds = 41.2,
            LapDistancePct = 0.42,
            CompletedLaps = 7,
            Position = 3,
            ClassPosition = 2,
            Incidents = 4,
            OnPitRoad = false,
            SessionPhase = "racing",
            Tyres = Tyres(12.34, 81.5, capturedAt, "session_start", false),
        };
    }

    private static ResearchField Find(IList<KeyValuePair<string, ResearchField>> fields, string key)
    {
        foreach (var field in fields) if (string.Equals(field.Key, key, StringComparison.Ordinal)) return field.Value;
        return null;
    }

    private static Dictionary<string, object> ParseLine(string line)
    {
        Dictionary<string, object> parsed;
        if (!ResearchJsonParser.TryParse(line, out parsed)) return null;
        return parsed;
    }

    private static Dictionary<string, object> Object(Dictionary<string, object> parent, string key)
    {
        if (parent == null || !parent.ContainsKey(key)) return null;
        return parent[key] as Dictionary<string, object>;
    }

    private static string String(Dictionary<string, object> parent, string key)
    {
        if (parent == null || !parent.ContainsKey(key)) return null;
        var value = parent[key];
        return value as string;
    }

    private static double? Number(Dictionary<string, object> parent, string key)
    {
        if (parent == null || !parent.ContainsKey(key)) return null;
        var value = parent[key];
        if (value is double) return (double)value;
        return null;
    }

    // ---------------------------------------------------------------- provenance

    private static void Provenance()
    {
        var sampleAt = Base.AddSeconds(10);

        // Een bevroren pit-snapshot is nooit Measured, hoe vers het sample ook is.
        var frozen = new ResearchTyreClassifier(Tyres(41.2, 78.0, sampleAt, "pit_entry", true), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        var frozenWear = frozen.Wear(0, 1);
        Check("PROV-01 frozen pit snapshot is never measured",
            frozenWear.Provenance == ResearchProvenance.LastKnown && frozenWear.Number.HasValue == true
            && string.Equals(frozenWear.Reason, "frozen_pit_snapshot", StringComparison.Ordinal),
            "prov=" + ResearchProvenanceNames.ToWire(frozenWear.Provenance) + " reason=" + frozenWear.Reason);

        // Ook zonder expliciete Frozen-vlag maar met trigger=pit_entry geldt dezelfde regel.
        var anchored = new ResearchTyreClassifier(Tyres(41.2, 78.0, sampleAt, "pit_entry", false), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-02 trigger=pit_entry is treated as a frozen anchor",
            anchored.Wear(3, 2).Provenance == ResearchProvenance.LastKnown,
            ResearchProvenanceNames.ToWire(anchored.Wear(3, 2).Provenance));

        // Laatste-echte-meting-tijdstip blijft het moment van de meting, niet het sample.
        var measurementAt = sampleAt.AddSeconds(-37.5);
        var older = new ResearchTyreClassifier(Tyres(41.2, 78.0, measurementAt, "pit_entry", true), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-03 frozen value keeps the original measurement timestamp",
            older.Wear(1, 0).MeasuredAtUtc.HasValue
            && older.Wear(1, 0).MeasuredAtUtc.Value == measurementAt
            && older.FrozenAtUtc.HasValue && older.FrozenAtUtc.Value == measurementAt,
            ResearchFormat.Timestamp(older.Wear(1, 0).MeasuredAtUtc));

        // Verse lezing zonder freeze = Measured.
        var fresh = new ResearchTyreClassifier(Tyres(12.0, 80.0, sampleAt, "sim_refresh", false), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-04 fresh tyre reading is measured",
            fresh.Wear(0, 0).Provenance == ResearchProvenance.Measured
            && fresh.Carcass(2, 2).Provenance == ResearchProvenance.Measured,
            ResearchProvenanceNames.ToWire(fresh.Wear(0, 0).Provenance));

        // Oude (niet-bevroren) lezing = LastKnown met het oude tijdstip.
        var stale = new ResearchTyreClassifier(Tyres(12.0, 80.0, sampleAt.AddSeconds(-30), "session_start", false), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-05 stale snapshot degrades to last_known",
            stale.Wear(0, 0).Provenance == ResearchProvenance.LastKnown
            && upstream(stale.Wear(0, 0), sampleAt),
            ResearchProvenanceNames.ToWire(stale.Wear(0, 0).Provenance) + " reason=" + stale.Wear(0, 0).Reason);

        // Buiten bereik = Invalid, waarde weg.
        var outOfRange = new ResearchTyreClassifier(Tyres(1500.0, 9999.0, sampleAt, "sim_refresh", false), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-06 out-of-range tyre value is invalid and carries no number",
            outOfRange.Wear(0, 0).Provenance == ResearchProvenance.Invalid && !outOfRange.Wear(0, 0).Number.HasValue
            && outOfRange.Carcass(0, 0).Provenance == ResearchProvenance.Invalid,
            ResearchProvenanceNames.ToWire(outOfRange.Wear(0, 0).Provenance) + " reason=" + outOfRange.Wear(0, 0).Reason);

        // Ontbrekend blok = Unavailable.
        var empty = new ResearchTyreClassifier(ResearchTyreObservation.None(), sampleAt,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds);
        Check("PROV-07 missing tyre block is unavailable",
            empty.Wear(0, 0).Provenance == ResearchProvenance.Unavailable
            && empty.Carcass(3, 1).Provenance == ResearchProvenance.Unavailable
            && empty.SetsUsed().Provenance == ResearchProvenance.Unavailable,
            ResearchProvenanceNames.ToWire(empty.Wear(0, 0).Provenance));

        // NaN/Infinity nooit als getal.
        var broken = ResearchField.Numeric(double.NaN, ResearchProvenance.Measured, sampleAt, 1000, null);
        var brokenToo = ResearchField.Numeric(double.PositiveInfinity, ResearchProvenance.Measured, sampleAt, 1000, null);
        Check("PROV-08 non-finite numbers are invalid",
            broken.Provenance == ResearchProvenance.Invalid && brokenToo.Provenance == ResearchProvenance.Invalid
            && !broken.Number.HasValue && !brokenToo.Number.HasValue,
            broken.Reason);
    }

    private static bool upstream(ResearchField field, DateTime sampleAt)
    {
        return field.MeasuredAtUtc.HasValue && field.MeasuredAtUtc.Value < sampleAt;
    }

    // ---------------------------------------------------------------- capture fields

    private static void CaptureFields()
    {
        var now = Base.AddSeconds(5);

        var freshView = View(now, true, 98.5, 0.0);
        var fresh = new ResearchCaptureClassifier(freshView, now, 1000, 3.0);
        var speed = fresh.Number(freshView.SpeedKph, 0, 600, "no_vehicle_block");
        Check("CAP-01 fresh capture is measured",
            speed.Provenance == ResearchProvenance.Measured && speed.MeasuredAtUtc.HasValue && speed.RateMs == 1000,
            ResearchProvenanceNames.ToWire(speed.Provenance));

        var oldView = View(now.AddSeconds(-9), true, 98.5, 0.0);
        var stale = new ResearchCaptureClassifier(oldView, now, 2000, 3.0);
        var staleSpeed = stale.Number(oldView.SpeedKph, 0, 600, "no_vehicle_block");
        Check("CAP-02 stale capture degrades to last_known with its own timestamp",
            staleSpeed.Provenance == ResearchProvenance.LastKnown
            && staleSpeed.MeasuredAtUtc.HasValue && staleSpeed.MeasuredAtUtc.Value == oldView.CapturedAtUtc
            && staleSpeed.RateMs == 2000,
            ResearchProvenanceNames.ToWire(staleSpeed.Provenance) + " at=" + ResearchFormat.Timestamp(staleSpeed.MeasuredAtUtc));

        var none = new ResearchCaptureClassifier(ResearchCaptureView.None(), now, 1000, 3.0);
        var missing = none.Number(null, 0, 600, "no_capture");
        Check("CAP-03 no capture at all is unavailable, never zero",
            missing.Provenance == ResearchProvenance.Unavailable && !missing.Number.HasValue,
            ResearchProvenanceNames.ToWire(missing.Provenance) + " reason=" + missing.Reason);
    }

    // ---------------------------------------------------------------- sampler

    private static void Sampler()
    {
        var sampler = new ResearchContextSampler(1000, null);
        var t0 = Base;
        var at0 = sampler.ShouldSample(t0);
        var at500 = sampler.ShouldSample(t0.AddMilliseconds(500));
        var at999 = sampler.ShouldSample(t0.AddMilliseconds(999));
        var at1000 = sampler.ShouldSample(t0.AddMilliseconds(1000));
        Check("SAMP-01 1 Hz gate",
            at0 && !at500 && !at999 && at1000,
            "t0=" + at0 + " t500=" + at500 + " t999=" + at999 + " t1000=" + at1000);

        var channels = new FakeChannels();
        channels.Set("SteeringWheelAngle", 0.42);
        channels.Set("LatAccel", 12.5);
        channels.Set("LongAccel", -3.5);
        channels.Set("Throttle", 0.75);
        channels.Set("Brake", 0.0);

        var view = View(Base.AddMilliseconds(-40), true, 98.5, 1.0);
        ResearchTyreClassifier tyres;
        var fields = new ResearchContextSampler(1000, null).BuildFields(Base, view, 1000, channels, 3.0,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds, out tyres);

        var steering = Find(fields, ResearchFieldKeys.SteeringRad);
        var lat = Find(fields, ResearchFieldKeys.LatAccelMps2);
        var lon = Find(fields, ResearchFieldKeys.LongAccelMps2);
        Check("SAMP-02 local 1 Hz context is present and measured",
            steering != null && steering.Provenance == ResearchProvenance.Measured
            && lat != null && lat.Number.HasValue && Math.Abs(lat.Number.Value - 12.5) < 1e-9
            && lon != null && lon.Number.HasValue && Math.Abs(lon.Number.Value + 3.5) < 1e-9,
            "steering=" + ResearchFormat.Number(steering == null ? null : steering.Number) + " lat=" + ResearchFormat.Number(lat == null ? null : lat.Number));

        // De capture had gas/rem al: dan leest de researchlaag het kanaal NIET opnieuw.
        var throttle = Find(fields, ResearchFieldKeys.ThrottlePct);
        var brake = Find(fields, ResearchFieldKeys.BrakePct);
        Check("SAMP-03 throttle/brake come from the capture, not from a second SDK read",
            throttle != null && Math.Abs(throttle.Number.Value - 98.5) < 1e-9
            && brake != null && Math.Abs(brake.Number.Value - 1.0) < 1e-9
            && channels.ReadsFor("Throttle") == 0 && channels.ReadsFor("Brake") == 0,
            "throttleReads=" + channels.ReadsFor("Throttle") + " brakeReads=" + channels.ReadsFor("Brake"));

        // Zonder vehicle-blok (uitgebreide telemetrie uit) valt gas/rem terug op het kanaal.
        var fallbackChannels = new FakeChannels();
        fallbackChannels.Set("SteeringWheelAngle", 0.0);
        fallbackChannels.Set("Throttle", 0.5);
        fallbackChannels.Set("Brake", 0.25);
        ResearchTyreClassifier unused;
        var fallback = new ResearchContextSampler(1000, null).BuildFields(Base, View(Base.AddMilliseconds(-40), false, 0, 0),
            1000, fallbackChannels, 3.0, ResearchTyreClassifier.DefaultFreshToleranceSeconds, out unused);
        var fallbackThrottle = Find(fallback, ResearchFieldKeys.ThrottlePct);
        var fallbackBrake = Find(fallback, ResearchFieldKeys.BrakePct);
        Check("SAMP-04 without a vehicle block, pedals fall back to the raw channel as percent",
            fallbackThrottle != null && Math.Abs(fallbackThrottle.Number.Value - 50.0) < 1e-9
            && fallbackBrake != null && Math.Abs(fallbackBrake.Number.Value - 25.0) < 1e-9
            && fallbackThrottle.RateMs == 1000,
            "throttle=" + ResearchFormat.Number(fallbackThrottle == null ? null : fallbackThrottle.Number));

        // Bandenvelden dragen rateMs=0: ze bestaan alleen bij een sim-refresh.
        var wear = Find(fields, ResearchFieldKeys.Wear(0, 0));
        var carcass = Find(fields, ResearchFieldKeys.Carcass(3, 2));
        Check("SAMP-05 tyre fields are marked with their own (refresh) frequency",
            wear != null && wear.RateMs == ResearchRates.OnSimRefresh
            && carcass != null && carcass.RateMs == ResearchRates.OnSimRefresh,
            "rateMs=" + (wear == null ? "n/a" : wear.RateMs.ToString(CultureInfo.InvariantCulture)));

        // Originele samplingtijdstippen: capturevelden houden het capture-moment.
        var speed = Find(fields, ResearchFieldKeys.SpeedKph);
        Check("SAMP-06 capture fields keep the original sampling timestamp",
            speed != null && speed.MeasuredAtUtc.HasValue && speed.MeasuredAtUtc.Value == view.CapturedAtUtc
            && speed.MeasuredAtUtc.Value != Base,
            ResearchFormat.Timestamp(speed == null ? null : speed.MeasuredAtUtc));

        // Sleutelvolgorde is stabiel (diffbaar), ook bij een tweede build.
        ResearchTyreClassifier tyres2;
        var fields2 = new ResearchContextSampler(1000, null).BuildFields(Base, view, 1000, new FakeChannels(), 3.0,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds, out tyres2);
        var sameOrder = fields.Count == fields2.Count;
        if (sameOrder)
        {
            for (var index = 0; index < fields.Count; index++)
            {
                if (!string.Equals(fields[index].Key, fields2[index].Key, StringComparison.Ordinal)) { sameOrder = false; break; }
            }
        }
        Check("SAMP-07 field order is stable", sameOrder, "count=" + fields.Count);

        // Het bevroren pit-entry-anker uit de capture staat als eigen blok in het sample en
        // is nooit Measured, ook al is het sample zelf vers.
        var viewWithAnchor = View(Base.AddMilliseconds(-40), true, 98.5, 1.0);
        viewWithAnchor.PitEntryTyres = Tyres(72.5, 91.0, Base.AddSeconds(-2), "pit_entry", true);
        ResearchTyreClassifier unusedTyres;
        var withAnchor = new ResearchContextSampler(1000, null).BuildFields(Base, viewWithAnchor, 1000, channels, 3.0,
            ResearchTyreClassifier.DefaultFreshToleranceSeconds, out unusedTyres);
        var anchorWear = Find(withAnchor, ResearchFieldKeys.PitEntryWear(2, 1));
        var anchorFrozenAt = Find(withAnchor, ResearchFieldKeys.PitEntryFrozenAt);
        Check("SAMP-08 a frozen pit entry block is recorded as last_known, never measured",
            anchorWear != null && anchorWear.Provenance == ResearchProvenance.LastKnown
            && anchorWear.Number.HasValue && Math.Abs(anchorWear.Number.Value - 72.5) < 1e-9
            && anchorFrozenAt != null && anchorFrozenAt.Text != null
            && Find(withAnchor, ResearchFieldKeys.PitEntryCarcass(3, 0)).Provenance == ResearchProvenance.LastKnown,
            "prov=" + ResearchProvenanceNames.ToWire(anchorWear == null ? ResearchProvenance.Unavailable : anchorWear.Provenance));

        // Zonder vehicle-blok valt snelheid terug op de bestaande SimHub-property.
        var speedChannels = new FakeChannels();
        speedChannels.SetProperty(ResearchPropertyPaths.SpeedProperty, 210.5);
        ResearchTyreClassifier unusedTyreClassifier;
        var noVehicle = new ResearchContextSampler(1000, null).BuildFields(Base, View(Base.AddMilliseconds(-40), false, 0, 0),
            1000, speedChannels, 3.0, ResearchTyreClassifier.DefaultFreshToleranceSeconds, out unusedTyreClassifier);
        var speedFallback = Find(noVehicle, ResearchFieldKeys.SpeedKph);
        Check("SAMP-09 speed falls back to the SimHub property when the capture has no vehicle block",
            speedFallback != null && speedFallback.Provenance == ResearchProvenance.Measured
            && speedFallback.Number.HasValue && Math.Abs(speedFallback.Number.Value - 210.5) < 1e-9
            && string.Equals(speedFallback.Reason, "property_fallback", StringComparison.Ordinal)
            && speedChannels.PropertyReads.Count == 1,
            "speed=" + ResearchFormat.Number(speedFallback == null ? null : speedFallback.Number));
    }

    // ---------------------------------------------------------------- jsonl

    private static void Jsonl()
    {
        var header = new ResearchSessionHeader
        {
            PluginVersion = "0.7.0.0",
            SimHubVersion = "8.2.0",
            Simulator = "iRacing",
            SimulatorVersion = "2026.10",
            TrackName = "Road America",
            TrackConfig = "Full",
            TrackId = 17,
            CarId = "ferrari488gt3",
            CarName = "Ferrari 488 GT3",
            SessionId = "research-20261025T120000Z-abcd1234",
            TransportSessionId = "simhub-0123456789abcdef",
            StartedAtUtc = Base,
            SamplingIntervalMs = 1000,
            CaptureIntervalMs = 1000,
            DriverPseudoId = "p-0123456789abcdef",
            QueueCapacity = 2048,
        };
        var headerLine = ResearchJsonl.Header(header);
        var parsed = ParseLine(headerLine);
        Check("JSON-01 header carries schema version, versions, units, track, car, session id and sampling",
            parsed != null
            && String(parsed, "type") == "session_header"
            && Number(parsed, "schemaVersion") == 1
            && String(parsed, "pluginVersion") == "0.7.0.0"
            && String(parsed, "simulatorVersion") == "2026.10"
            && Object(parsed, "units") != null && String(Object(parsed, "units"), "steering") == "rad"
            && Object(parsed, "track") != null && String(Object(parsed, "track"), "name") == "Road America"
            && Object(parsed, "car") != null && String(Object(parsed, "car"), "name") == "Ferrari 488 GT3"
            && String(parsed, "sessionId") == "research-20261025T120000Z-abcd1234"
            && Number(Object(parsed, "sampling"), "contextMs") == 1000,
            headerLine.Length + " bytes");

        var simpleFields = new List<KeyValuePair<string, ResearchField>>
        {
            new KeyValuePair<string, ResearchField>("steeringWheelRad",
                ResearchField.Numeric(0.12, ResearchProvenance.Measured, Base, 1000, null)),
            new KeyValuePair<string, ResearchField>("wearPercent.frontLeft.0",
                ResearchField.Numeric(41.23, ResearchProvenance.LastKnown, Base.AddSeconds(-30), 0, "frozen_pit_snapshot")),
            new KeyValuePair<string, ResearchField>("onPitRoad",
                ResearchField.FlagValue(true, ResearchProvenance.Measured, Base, 1000, null)),
            new KeyValuePair<string, ResearchField>("trackRubberState",
                ResearchField.TextValue("moderate usage", ResearchProvenance.Measured, Base.AddSeconds(-5), 0, null)),
            new KeyValuePair<string, ResearchField>("airTempC", ResearchField.Unavailable("no_environment")),
            new KeyValuePair<string, ResearchField>("lapsRemaining", ResearchField.Invalid("out_of_range")),
        };
        var sampleLine = ResearchJsonl.Sample(Base, 1234.5, 42, simpleFields, 1000);
        var sample = ParseLine(sampleLine);
        var fieldsNode = Object(sample, "fields");
        var steeringNode = Object(fieldsNode, "steeringWheelRad");
        var wearNode = Object(fieldsNode, "wearPercent.frontLeft.0");
        Check("JSON-02 sample line is valid JSON with per-field provenance",
            sample != null && String(sample, "type") == "sample" && Number(sample, "sequence") == 42
            && Number(sample, "sessionTimeSeconds") == 1234.5
            && fieldsNode != null && Number(steeringNode, "v") == 0.12
            && String(steeringNode, "p") == "measured"
            && String(wearNode, "p") == "last_known" && String(wearNode, "r") == "frozen_pit_snapshot"
            && Number(wearNode, "rateMs") == 0,
            sampleLine.Length + " bytes");

        // Meting-op-dit-sample krijgt geen "at"; een oudere meting wel; rateMs alleen bij afwijking.
        Check("JSON-03 timestamps only when they differ, rate only when it differs",
            !steeringNode.ContainsKey("at") && !steeringNode.ContainsKey("rateMs")
            && wearNode.ContainsKey("at") && Number(wearNode, "rateMs") == 0,
            "steering at/rate keys: " + string.Join(",", steeringNode.Keys.ToArray()));

        Check("JSON-04 unavailable/invalid carry no value",
            Object(fieldsNode, "airTempC")["v"] == null
            && String(Object(fieldsNode, "airTempC"), "p") == "unavailable"
            && Object(fieldsNode, "lapsRemaining")["v"] == null
            && String(Object(fieldsNode, "lapsRemaining"), "p") == "invalid",
            "unavailable=" + String(Object(fieldsNode, "airTempC"), "p") + " invalid=" + String(Object(fieldsNode, "lapsRemaining"), "p"));

        // Geen NaN/Infinity en geen exponent-tokens in het bestand.
        var raw = headerLine + "\n" + sampleLine;
        Check("JSON-05 file text contains no NaN/Infinity tokens",
            raw.IndexOf("NaN", StringComparison.Ordinal) < 0
            && raw.IndexOf("Infinity", StringComparison.Ordinal) < 0,
            raw.Length + " chars");

        var eventLine = ResearchJsonl.Event(Base, 1234.5, 42, "pit_entry", "manual",
            new List<KeyValuePair<string, object>>
            {
                new KeyValuePair<string, object>("speedKph", 40.2),
                new KeyValuePair<string, object>("note", "handmatig \"checkpoint\"\nregel 2"),
                new KeyValuePair<string, object>("onPitRoad", true),
            });
        var eventRecord = ParseLine(eventLine);
        var data = Object(eventRecord, "data");
        Check("JSON-06 escaping round-trips quotes and newlines",
            eventRecord != null && String(eventRecord, "kind") == "pit_entry" && String(eventRecord, "source") == "manual"
            && String(data, "note") == "handmatig \"checkpoint\"\nregel 2"
            && Number(data, "speedKph") == 40.2,
            "note=" + String(data, "note"));

        // Geen rijdersnaam, wel een pseudoniem: de recorder schrijft nooit namen.
        var leakCheck = headerLine.IndexOf("Jaimy", StringComparison.Ordinal) < 0
            && headerLine.IndexOf("jaimy", StringComparison.Ordinal) < 0;
        Check("JSON-07 header carries a pseudonym and no driver name",
            leakCheck && String(parsed, "driverPseudoId").StartsWith("p-", StringComparison.Ordinal),
            String(parsed, "driverPseudoId"));

        var statusLine = ResearchJsonl.Status(Base, 120, 3, 7, false);
        var status = ParseLine(statusLine);
        Check("JSON-08 status record exposes drops and queue depth",
            status != null && String(status, "type") == "status" && Number(status, "droppedSamples") == 7
            && Number(status, "queued") == 3,
            statusLine);

        var closeLine = ResearchJsonl.SessionEnd(Base, "game_stopped", 10, 2, 7, 4096, 61.25, true);
        var close = ParseLine(closeLine);
        Check("JSON-09 session close record summarises the file",
            close != null && String(close, "type") == "session_close" && Number(close, "samplesWritten") == 10
            && Number(close, "droppedSamples") == 7 && String(close, "closedCleanly") == null
            && (bool)close["closedCleanly"],
            closeLine);
    }

    // ---------------------------------------------------------------- queue

    private static void Queue()
    {
        using (var temp = new TempDir())
        {
            var path = System.IO.Path.Combine(temp.Path, "queue.jsonl");
            var errors = new List<Exception>();
            using (var sink = new ResearchJsonlSink(path, 4, 1, 50, errors.Add))
            {
                sink.TryWrite("{\"type\":\"a\"}");
                var stopwatch = Stopwatch.StartNew();
                var rejected = 0;
                var slowest = 0L;
                for (var index = 0; index < 20000; index++)
                {
                    var mark = stopwatch.ElapsedMilliseconds;
                    if (!sink.TryWrite("{\"type\":\"sample\",\"pad\":\"" + new string('x', 600) + "\"}")) rejected++;
                    var elapsed = stopwatch.ElapsedMilliseconds - mark;
                    if (elapsed > slowest) slowest = elapsed;
                }
                var counters = sink.Counters();
                Check("QUEUE-01 a full queue rejects instead of blocking the caller",
                    rejected > 0 && slowest < 100 && counters.Dropped == rejected,
                    "rejected=" + rejected + " dropped=" + counters.Dropped + " slowestCallMs=" + slowest);

                sink.SetFinalLine(ResearchJsonl.SessionEnd(Base, "test", 0, 0, counters.Dropped, counters.BytesWritten, 4.5, true));
            }
            var summary = ResearchJsonlReader.ReadFile(path);
            var lines = File.ReadAllLines(path);
            Check("QUEUE-02 writer drained in order and close record is last",
                lines.Length > 1 && lines[0] == "{\"type\":\"a\"}"
                && lines[lines.Length - 1].IndexOf("\"session_close\"", StringComparison.Ordinal) > 0
                && summary.SkippedLines == 0 && summary.HasTruncatedTail == false,
                "lines=" + lines.Length + " skipped=" + summary.SkippedLines);
            Check("QUEUE-03 counters and file agree on written records",
                summary.Records == lines.Length && summary.Records > 0,
                "records=" + summary.Records + " lines=" + lines.Length);
            Check("QUEUE-04 drops are visible in the close record",
                summary.DroppedSamples > 0,
                "dropped=" + summary.DroppedSamples);
        }
    }

    // ---------------------------------------------------------------- crash recovery

    private static void CrashRecovery()
    {
        var header = ResearchJsonl.Header(new ResearchSessionHeader
        {
            PluginVersion = "0.7.0.0",
            Simulator = "iRacing",
            SessionId = "research-test",
            StartedAtUtc = Base,
            SamplingIntervalMs = 1000,
            CaptureIntervalMs = 1000,
        });
        var sample = ResearchJsonl.Sample(Base, 1.0, 1,
            new List<KeyValuePair<string, ResearchField>>
            {
                new KeyValuePair<string, ResearchField>("steeringWheelRad",
                    ResearchField.Numeric(0.1, ResearchProvenance.Measured, Base, 1000, null)),
            }, 1000);

        // Precies het crash-geval: laatste regel is half geschreven.
        var truncated = header + "\n" + sample + "\n" + sample.Substring(0, sample.Length / 2);
        var result = ResearchJsonlReader.ReadText(truncated);
        Check("CRASH-01 a half-written last line is skipped, earlier records survive",
            result.Samples == 1 && result.SkippedLines == 1 && result.HasTruncatedTail && result.Problems.Count == 0,
            "samples=" + result.Samples + " skipped=" + result.SkippedLines + " tail=" + result.HasTruncatedTail);

        // Kapotte regel in het midden: melden, niet gooien, rest blijft leesbaar.
        var corrupt = header + "\nnot json at all\n" + sample + "\n" + sample + "\n";
        var result2 = ResearchJsonlReader.ReadText(corrupt);
        Check("CRASH-02 a corrupt middle line is reported but does not break the rest",
            result2.Samples == 2 && result2.SkippedLines == 1 && !result2.HasTruncatedTail
            && result2.Problems.Count == 1,
            "samples=" + result2.Samples + " problems=" + string.Join(",", result2.Problems.ToArray()));

        // Herstel leest de drop-teller uit status/close, ook na een crash midden in de sessie.
        var withStatus = header + "\n"
            + ResearchJsonl.Status(Base.AddSeconds(5), 120, 0, 3, false) + "\n"
            + ResearchJsonl.Status(Base.AddSeconds(9), 240, 0, 5, false) + "\n"
            + sample.Substring(0, 40);
        var result3 = ResearchJsonlReader.ReadText(withStatus);
        Check("CRASH-03 recovery reports the highest drop counter it can find",
            result3.DroppedSamples == 5 && result3.HasTruncatedTail && result3.Header != null,
            "dropped=" + result3.DroppedSamples);

        using (var temp = new TempDir())
        {
            var file = System.IO.Path.Combine(temp.Path, "crash.jsonl");
            File.WriteAllText(file, truncated, new UTF8Encoding(false));
            var fromFile = ResearchJsonlReader.ReadFile(file);
            var missing = ResearchJsonlReader.ReadFile(System.IO.Path.Combine(temp.Path, "does-not-exist.jsonl"));
            Check("CRASH-04 file-level recovery never throws",
                fromFile.Samples == 1 && missing.Records == 0 && missing.Problems.Count == 0,
                "fileSamples=" + fromFile.Samples);
        }
    }

    // ---------------------------------------------------------------- events

    private static ResearchTick Tick(double seconds, bool inCar, bool onPitRoad, double speed, int setsUsed, int laps, bool running)
    {
        return new ResearchTick
        {
            AtUtc = Base.AddSeconds(seconds),
            GameRunning = running,
            IsInCar = inCar,
            SessionPhase = "racing",
            OnPitRoad = onPitRoad,
            SpeedKph = speed,
            SetsUsed = setsUsed,
            CompletedLaps = laps,
            SessionTimeSeconds = 1000 + seconds,
            Sequence = (long)seconds,
        };
    }

    private static void Events()
    {
        var detector = new ResearchEventDetector();
        detector.Observe(Tick(0, true, false, 180, 2, 5, true));            // baseline
        var pitEntry = detector.Observe(Tick(1, true, true, 40, 2, 5, true));
        var pitBox = detector.Observe(Tick(2, true, true, 2, 3, 5, true));
        var stillInBox = detector.Observe(Tick(3, true, true, 0, 3, 5, true));
        var stint = detector.Observe(Tick(4, true, false, 90, 3, 5, true));

        Check("EVENT-01 pit entry, pit box and tyre change are detected on their flanks",
            Has(pitEntry, ResearchEventKind.PitEntry)
            && Has(pitBox, ResearchEventKind.PitBox) && Has(pitBox, ResearchEventKind.TyreChange),
            "pitEntry=" + pitEntry.Count + " pitBox=" + pitBox.Count);
        Check("EVENT-02 no duplicate pit box while the car stands still",
            !Has(stillInBox, ResearchEventKind.PitBox), "events=" + stillInBox.Count);
        Check("EVENT-03 leaving the pit road starts a new stint",
            Has(stint, ResearchEventKind.Stint), "events=" + stint.Count);

        // Herhaalbaar: tweede stop levert opnieuw dezelfde markers.
        var secondEntry = detector.Observe(Tick(5, true, true, 30, 3, 6, true));
        var secondBox = detector.Observe(Tick(6, true, true, 1, 4, 6, true));
        Check("EVENT-04 markers repeat for a second pit stop",
            Has(secondEntry, ResearchEventKind.PitEntry)
            && Has(secondBox, ResearchEventKind.PitBox) && Has(secondBox, ResearchEventKind.TyreChange),
            "entry=" + secondEntry.Count + " box=" + secondBox.Count);

        // Reset: sessietijd springt terug.
        var reset = detector.Observe(Tick(7, true, false, 120, 4, 5, true));
        Check("EVENT-05 a session-time jump back is a reset", Has(reset, ResearchEventKind.Reset), "events=" + reset.Count);

        // Garage en sessie-einde.
        var garage = detector.Observe(Tick(8, false, false, 0, 4, 5, true));
        var ended = detector.Observe(Tick(9, false, false, 0, 4, 5, false));
        Check("EVENT-06 garage and session end are detected",
            Has(garage, ResearchEventKind.Garage) && Has(ended, ResearchEventKind.SessionEnd),
            "garage=" + garage.Count + " ended=" + ended.Count);

        var manual = ResearchEventDetector.Manual(ResearchEventKind.TyreChange, "handmatig", Tick(10, true, false, 100, 4, 5, true));
        Check("EVENT-07 manual markers use the same shape and can repeat",
            manual.Source == ResearchEventNames.SourceManual && manual.Kind == ResearchEventKind.TyreChange
            && manual.Data.Count >= 1,
            "source=" + manual.Source);

        Check("EVENT-08 wire names cover all protocol markers",
            ResearchEventNames.All.Count() == 7
            && ResearchEventNames.ToWire(ResearchEventKind.TyreChange) == "tyre_change"
            && ResearchEventNames.ToWire(ResearchEventKind.PitBox) == "pit_box",
            string.Join(",", ResearchEventNames.All.ToArray()));
    }

    private static bool Has(IList<ResearchEventMarker> markers, ResearchEventKind kind)
    {
        foreach (var marker in markers) if (marker.Kind == kind) return true;
        return false;
    }

    // ---------------------------------------------------------------- identity

    private static void Identity()
    {
        var first = ResearchIdentity.Pseudonym("123456", "salt-a");
        var second = ResearchIdentity.Pseudonym("123456", "salt-a");
        var otherSalt = ResearchIdentity.Pseudonym("123456", "salt-b");
        var otherDriver = ResearchIdentity.Pseudonym("654321", "salt-a");
        var spaced = ResearchIdentity.Pseudonym(" 123456 ", "salt-a");
        Check("ID-01 pseudonym is stable, salted and free of the raw id",
            first == second && first != otherSalt && first != otherDriver && first == spaced
            && first.StartsWith("p-", StringComparison.Ordinal) && first.Length == 18
            && first.IndexOf("123456", StringComparison.Ordinal) < 0,
            first);

        Check("ID-02 empty driver id yields no pseudonym",
            ResearchIdentity.Pseudonym(null, "salt") == null && ResearchIdentity.Pseudonym("   ", "salt") == null,
            "null-safe");

        var idA = ResearchIdentity.NewSessionId(Base);
        var idB = ResearchIdentity.NewSessionId(Base);
        Check("ID-03 session ids are sortable, unique and filename-safe",
            idA.StartsWith("research-20261025T120000Z-", StringComparison.Ordinal) && idA != idB
            && ResearchSessionFile.FileName(idA) == idA + ".jsonl",
            idA);

        Check("ID-04 session file candidates stay inside the folder",
            ResearchSessionFile.Candidate("/tmp/x", idA, 0) == "/tmp/x/" + idA + ".jsonl"
            && ResearchSessionFile.Candidate("/tmp/x", idA, 1).EndsWith("-2.jsonl", StringComparison.Ordinal),
            ResearchSessionFile.Candidate("/tmp/x", idA, 1));
    }

    // ---------------------------------------------------------------- recorder end-to-end

    private sealed class MutableClock
    {
        public DateTime Utc = Base;
        public DateTime Now() { return Utc; }
        public void Advance(double seconds) { Utc = Utc.AddSeconds(seconds); }
    }

    private static void Recorder()
    {
        var clock = new MutableClock();
        using (var temp = new TempDir())
        {
            var root = System.IO.Path.Combine(temp.Path, "research");

            // 1. Uit = niets: geen map, geen bestand, geen kanaalread.
            var off = new ResearchRecorder(root, new ResearchRecorderOptions(), null, clock.Now);
            var offChannels = new FakeChannels();
            off.ObserveCapture(View(clock.Utc, true, 90, 1));
            bool dropped;
            off.OnTick(clock.Utc, true, true, offChannels, out dropped);
            off.Mark(ResearchEventKind.PitBox, "x");
            off.Dispose();
            Check("REC-01 disabled recorder writes nothing and reads nothing",
                !Directory.Exists(root) && offChannels.Reads.Count == 0 && !off.Enabled,
                "reads=" + offChannels.Reads.Count);

            // 2. Aan = kop + samples, status met pad en tellers.
            var recorder = new ResearchRecorder(root, new ResearchRecorderOptions
            {
                QueueCapacity = 256,
                FlushEveryRecords = 1,
                FlushEveryMs = 20,
                StatusEverySamples = 2,
            }, null, clock.Now);
            string error;
            var started = recorder.Enable(Start(clock), out error);
            var channelReader = new FakeChannels();
            channelReader.Set("SteeringWheelAngle", 0.5);
            channelReader.Set("LatAccel", 5.0);
            channelReader.Set("LongAccel", -1.0);
            for (var index = 0; index < 4; index++)
            {
                recorder.ObserveCapture(View(clock.Utc, true, 95, 0));
                recorder.OnTick(clock.Utc, true, true, channelReader, out dropped);
                clock.Advance(1.0);
            }
            var status = recorder.Status();
            Check("REC-02 enabled recorder writes a header and 1 Hz samples",
                started && status.Recording && status.Samples == 4 && status.Path != null
                && File.Exists(status.Path),
                "samples=" + status.Samples + " path=" + status.Path);

            // De schrijfthread loopt achter de teller aan: wacht kort tot het bestand bij is.
            var summary = WaitForSamples(status.Path, 4, 2000);
            var headerOk = summary.Header != null
                && String(summary.Header, "pluginVersion") == "0.7.0.0"
                && String(summary.Header, "sessionId") == recorder.CurrentSessionId;
            Check("REC-03 the file starts with a schema header and contains only valid JSONL",
                headerOk && summary.Samples == 4 && summary.SkippedLines == 0,
                "samples=" + summary.Samples + " skipped=" + summary.SkippedLines + " records=" + summary.Records);

            var firstSampleLine = File.ReadAllLines(status.Path).FirstOrDefault(line => line.IndexOf("\"sample\"", StringComparison.Ordinal) > 0);
            var firstSample = ParseLine(firstSampleLine);
            var sampleFields = Object(firstSample, "fields");
            Check("REC-04 samples carry provenance for every tyre zone",
                sampleFields != null && Object(sampleFields, "wearPercent.frontLeft.0") != null
                && String(Object(sampleFields, "wearPercent.frontLeft.0"), "p") == "measured"
                && Object(sampleFields, "carcassTempC.rearRight.2") != null
                && Object(sampleFields, "steeringWheelRad") != null,
                "fields=" + (sampleFields == null ? 0 : sampleFields.Count));

            // 3. Pauzeren: geen nieuwe samples, geen markers; hervatten werkt.
            recorder.Pause();
            var before = recorder.Status().Samples;
            recorder.ObserveCapture(View(clock.Utc, true, 95, 0));
            recorder.OnTick(clock.Utc, true, true, channelReader, out dropped);
            clock.Advance(1.0);
            var pausedSamples = recorder.Status().Samples;
            recorder.Resume();
            recorder.ObserveCapture(View(clock.Utc, true, 95, 0));
            recorder.OnTick(clock.Utc, true, true, channelReader, out dropped);
            clock.Advance(1.0);
            Check("REC-05 pause stops samples, resume continues",
                pausedSamples == before && recorder.Status().Samples == before + 1 && !recorder.Paused,
                "before=" + before + " paused=" + pausedSamples + " after=" + recorder.Status().Samples);

            // 4. Handmatige marker belandt als event in hetzelfde bestand.
            var marked = recorder.Mark(ResearchEventKind.PitBox, "handmatig");
            recorder.EndSession("game_stopped");
            var withEvent = ResearchJsonlReader.ReadFile(recorder.LatestSessionFile());
            Check("REC-06 a manual marker lands as an event in the same JSONL",
                marked && withEvent.Events >= 2 && withEvent.StatusRecords >= 1,
                "events=" + withEvent.Events + " status=" + withEvent.StatusRecords);

            // 5. Nieuwe sessie = nieuw bestand, oude blijft staan.
            clock.Advance(5);
            var startedAgain = recorder.Enable(Start(clock), out error);
            recorder.ObserveCapture(View(clock.Utc, true, 95, 0));
            recorder.OnTick(clock.Utc, true, true, channelReader, out dropped);
            recorder.Dispose();
            var files = recorder.ListSessionFiles();
            Check("REC-07 every session gets its own file",
                startedAgain && files.Count == 2 && recorder.Status().Recording == false,
                "files=" + files.Count);

            // 6. Pseudonym stabiel over sessies, salt hergebruikt, geen naam in het bestand.
            var headerOne = ResearchJsonlReader.ReadFile(files[0]).Header;
            var headerTwo = ResearchJsonlReader.ReadFile(files[1]).Header;
            var allText = new StringBuilder();
            foreach (var file in files) allText.Append(File.ReadAllText(file));
            Check("REC-08 pseudonym is stable across sessions and no name is written",
                String(headerOne, "driverPseudoId") == String(headerTwo, "driverPseudoId")
                && String(headerOne, "driverPseudoId").StartsWith("p-", StringComparison.Ordinal)
                && allText.ToString().IndexOf("Jaimy", StringComparison.Ordinal) < 0
                && File.Exists(System.IO.Path.Combine(root, ResearchIdentity.SaltFileName)),
                String(headerOne, "driverPseudoId"));

            // 7. Export alleen op verzoek; inhoud is hetzelfde bestand, zonder salt.
            var saltValue = File.ReadAllText(System.IO.Path.Combine(root, ResearchIdentity.SaltFileName)).Trim();
            var exportDir = System.IO.Path.Combine(temp.Path, "export");
            var exported = recorder.Export(System.IO.Path.Combine(exportDir, "sessie.jsonl"), out error, out var exportedFrom);
            var exportedText = exported ? File.ReadAllText(System.IO.Path.Combine(exportDir, "sessie.jsonl")) : string.Empty;
            Check("REC-09 export copies the session on explicit request only",
                exported && exportedText.Length > 0 && exportedFrom != null
                && saltValue.Length >= 16
                && exportedText.IndexOf(saltValue, StringComparison.Ordinal) < 0
                && !File.Exists(System.IO.Path.Combine(exportDir, ResearchIdentity.SaltFileName)),
                "exported=" + exportedText.Length + " bytes");

            // 8. Verwijderen haalt alles weg, inclusief salt.
            string deleteError;
            var deleted = recorder.DeleteLocalData(out deleteError);
            Check("REC-10 deleting local research data removes files and salt",
                deleted >= 3 && !Directory.Exists(root) && deleteError == null,
                "deleted=" + deleted + " error=" + deleteError);
        }
    }

    private static ResearchSessionSummary WaitForSamples(string path, int expected, int timeoutMs)
    {
        var stopwatch = Stopwatch.StartNew();
        ResearchSessionSummary summary = ResearchJsonlReader.ReadFile(path);
        while (summary.Samples < expected && stopwatch.ElapsedMilliseconds < timeoutMs)
        {
            System.Threading.Thread.Sleep(20);
            summary = ResearchJsonlReader.ReadFile(path);
        }
        return summary;
    }

    /// <summary>
    /// Genereert docs/research/voorbeeld-sessie.jsonl met de échte recorder: garage, stint,
    /// pit entry, pitbox, bandenwissel, reset en sessie-einde. Geen handwerk, dus het
    /// voorbeeld kan niet afwijken van wat de plugin schrijft.
    /// </summary>
    private static void SampleSession(string destination)
    {
        var clock = new MutableClock();
        clock.Utc = new DateTime(2026, 10, 25, 20, 0, 0, DateTimeKind.Utc);
        using (var temp = new TempDir())
        {
            var root = System.IO.Path.Combine(temp.Path, "research");
            Directory.CreateDirectory(root);
            // Vaste salt, zodat het voorbeeld reproduceerbaar is (normaal: random per install).
            File.WriteAllText(System.IO.Path.Combine(root, ResearchIdentity.SaltFileName), "3sm-research-voorbeeld-salt-0001");

            var recorder = new ResearchRecorder(root, new ResearchRecorderOptions
            {
                QueueCapacity = 256,
                FlushEveryRecords = 1,
                FlushEveryMs = 20,
                StatusEverySamples = 8,
            }, null, clock.Now);
            string error;
            if (!recorder.Enable(new ResearchSessionStart
            {
                PluginVersion = "0.7.0.0",
                SimHubVersion = "9.1.3",
                Simulator = "iRacing",
                SimulatorVersion = "2026.10.02.01",
                TrackName = "Road America",
                TrackConfig = "Full Course",
                TrackId = 17,
                CarId = "ferrari488gt3",
                CarName = "Ferrari 488 GT3",
                TransportSessionId = "simhub-2b7c1e0a9d4f4c1e8a3d5f60718293a4",
                DriverId = "123456",
                CaptureIntervalMs = 1000,
            }, out error)) throw new InvalidOperationException(error);

            var channels = new FakeChannels();
            channels.Set("SteeringWheelAngle", 0.0);
            channels.Set("LatAccel", 0.0);
            channels.Set("LongAccel", 0.0);

            var tyres = Tyres(4.8, 71.0, clock.Utc, "session_start", false);
            ResearchTyreObservation anchor = null;
            var sessionTime = 0.0;
            var laps = 0;

            Action<bool, bool, double, int, bool> tick = delegate (bool inCar, bool onPit, double speed, int sets, bool frozen)
            {
                channels.Set("SteeringWheelAngle", inCar ? 0.18 : 0.0);
                channels.Set("LatAccel", inCar ? 14.2 : 0.0);
                channels.Set("LongAccel", inCar ? -6.4 : 0.0);
                channels.SetProperty(ResearchPropertyPaths.SpeedProperty, speed);
                var view = new ResearchCaptureView
                {
                    Present = true,
                    CapturedAtUtc = clock.Utc,
                    Sequence = (long)sessionTime,
                    SessionTimeSeconds = sessionTime,
                    HasVehicle = true,
                    ThrottlePct = inCar ? 87.4 : 0.0,
                    BrakePct = inCar ? 0.0 : 12.5,
                    SpeedKph = speed,
                    Gear = inCar ? "5" : "N",
                    Rpm = inCar ? 7050 : 0,
                    FuelLitres = Math.Max(1.0, 54.0 - sessionTime * 0.012),
                    FuelPerLapLitres = 3.4,
                    LapsRemaining = Math.Max(0.5, 15.0 - sessionTime * 0.02),
                    LastLapSeconds = laps > 0 ? 118.7 : (double?)null,
                    BestLapSeconds = laps > 0 ? 117.9 : (double?)null,
                    CurrentLapElapsedSeconds = 40.5 + (sessionTime % 100),
                    LapDistancePct = (sessionTime % 118.0) / 118.0,
                    CompletedLaps = laps,
                    Position = 3,
                    ClassPosition = 2,
                    Incidents = 2,
                    OnPitRoad = onPit,
                    SessionPhase = inCar ? "racing" : "garage",
                    Tyres = tyres,
                    PitEntryTyres = frozen ? anchor : null,
                };
                recorder.ObserveCapture(view);
                bool dropped;
                recorder.OnTick(clock.Utc, true, inCar, channels, out dropped);
                clock.Advance(1.0);
                sessionTime += 1.0;
            };

            // garage
            tick(false, false, 0, 2, false);
            tick(false, false, 0, 2, false);
            // stint 1
            tick(true, false, 0, 2, false);
            for (var index = 0; index < 6; index++) tick(true, false, 205 + index, 2, false);
            laps = 1;
            tick(true, false, 210, 2, false);
            // pit entry + bevroren anker (de set die eraf gaat)
            anchor = Tyres(4.8, 71.0, clock.Utc, "pit_entry", true);
            tick(true, true, 44, 2, false);
            tick(true, true, 2, 2, false);
            tyres = Tyres(0.9, 88.0, clock.Utc.AddSeconds(1), "sim_refresh", false);
            tick(true, true, 0, 3, true);
            tick(true, true, 0, 3, true);
            // stint 2
            tick(true, false, 38, 3, false);
            for (var index = 0; index < 5; index++) tick(true, false, 198 + index, 3, false);
            laps = 2;
            // reset (auto terug naar de garage: sessietijd springt terug)
            sessionTime = 12.0;
            tick(true, false, 0, 3, false);
            tick(false, false, 0, 3, false);
            // sessie-einde
            var endView = View(clock.Utc, true, 0, 0);
            endView.OnPitRoad = false;
            recorder.ObserveCapture(endView);
            recorder.EndSession("game_stopped");
            recorder.Dispose();

            var produced = recorder.LatestSessionFile();
            if (produced == null || !File.Exists(produced)) throw new IOException("geen sessiebestand geproduceerd");
            var target = System.IO.Path.GetFullPath(destination);
            var directory = System.IO.Path.GetDirectoryName(target);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.Copy(produced, target, true);
        }
    }

    private static ResearchSessionStart Start(MutableClock clock)
    {
        return new ResearchSessionStart
        {
            PluginVersion = "0.7.0.0",
            SimHubVersion = "8.2.0",
            Simulator = "iRacing",
            SimulatorVersion = null,
            TrackName = "Road America",
            TrackConfig = "Full",
            TrackId = 17,
            CarId = "ferrari488gt3",
            CarName = "Ferrari 488 GT3",
            TransportSessionId = "simhub-test",
            DriverId = "123456",
            CaptureIntervalMs = 1000,
        };
    }
}
