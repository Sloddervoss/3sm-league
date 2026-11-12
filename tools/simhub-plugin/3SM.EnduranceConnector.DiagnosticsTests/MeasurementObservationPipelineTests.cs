using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.Serialization;
using System.Text;
using ThreeSM.EnduranceConnector;

// T13-S2B — echte sampler/accumulator-aansluiting, StartLap-freeze en opt-in.
// Alle samples, bindingen en contexten zijn synthetisch: geen SimHub, iRacing,
// klok, netwerk of database.
internal static class MeasurementObservationPipelineTests
{
    private const string Device = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string OtherDevice = "99999999-8888-4777-8666-555555555555";
    private const string OtherOwner = "22222222-3333-4444-8555-666666666666";
    private const string SessionA = "sim-a";
    private const string SessionB = "sim-b";
    private const string Segment = "seg-observatietest";
    private static readonly DateTime T0 = new DateTime(2026, 9, 27, 10, 0, 0, DateTimeKind.Utc);

    private static DateTime At(long milliseconds)
    {
        return T0.AddTicks(milliseconds * TimeSpan.TicksPerMillisecond);
    }

    private static ObservationPairingBinding Binding(string device = Device, string owner = Owner,
        long generation = 7, bool generationKnown = true)
    {
        return new ObservationPairingBinding(device, owner, generation, generationKnown);
    }

    private static ObservationLapContext Context(string car = "car-1", int? trackId = 123,
        string trackName = "Testbaan", string trackConfig = "Grand Prix",
        int? sessionUniqueId = 42, int? sessionNumber = 3)
    {
        return new ObservationLapContext(car, trackId, trackName, trackConfig, sessionUniqueId, sessionNumber);
    }

    private static TelemetrySample Sample(long milliseconds, int lap, double? fuel, bool? pit,
        string name = "Synthetische Rijder", string session = SessionA, string segment = Segment,
        ObservationPairingBinding binding = null, ObservationLapContext context = null,
        long? tick = null, DateTimeKind kind = DateTimeKind.Utc)
    {
        var at = T0.AddMilliseconds(milliseconds);
        if (kind != DateTimeKind.Utc) at = DateTime.SpecifyKind(at, kind);
        return new TelemetrySample
        {
            ObservedAtUtc = at,
            SdkTick = tick ?? milliseconds,
            SessionTimeSeconds = 1000 + milliseconds / 1000.0,
            LapNumber = lap,
            ObservedSessionId = session,
            SegmentId = segment,
            CurrentDriverName = name,
            OnPitRoad = pit,
            FuelLitres = fuel,
            TrackTempC = 30,
            AirTempC = 20,
            LatAccelG = 1.2,
            LongAccelG = -0.3,
            ObservationPairingBinding = binding ?? Binding(),
            ObservationLapContext = context ?? Context()
        };
    }

    private static TelemetrySampler Sampler(bool enabled = true, string session = SessionA,
        string segment = Segment)
    {
        var sampler = new TelemetrySampler(new SamplerOptions { ObservationCaptureEnabled = enabled });
        sampler.BeginSession(segment, session);
        return sampler;
    }

    private static LapAggregate CloseByNextLap(TelemetrySampler sampler, long milliseconds, int nextLap = 2,
        string session = SessionA, string segment = Segment, ObservationPairingBinding binding = null,
        ObservationLapContext context = null)
    {
        sampler.Offer(Sample(milliseconds, nextLap, 50, false, "Synthetische Rijder", session, segment,
            binding, context));
        var laps = sampler.Drain();
        return laps.Count == 0 ? null : laps[0];
    }

    private static LapAggregate CloseSampler(TelemetrySampler sampler, string reason = "test_end")
    {
        var laps = sampler.Close(reason);
        return laps.Count == 0 ? null : laps[0];
    }

    private static Dictionary<string, object> Facts(LapAggregate aggregate)
    {
        if (aggregate == null || aggregate.ObservationResult == null || !aggregate.ObservationResult.HasObservation)
            return null;
        return MeasurementJson.DeserializeDictionary(aggregate.ObservationResult.ToJson());
    }

    private static Dictionary<string, object> Nested(Dictionary<string, object> value, string key)
    {
        return value != null && value.ContainsKey(key) ? (Dictionary<string, object>)value[key] : null;
    }

    private static double Number(Dictionary<string, object> value, string key)
    {
        return Convert.ToDouble(value[key], CultureInfo.InvariantCulture);
    }

    private static int Integer(Dictionary<string, object> value, string key)
    {
        return Convert.ToInt32(value[key], CultureInfo.InvariantCulture);
    }

    private static string Code(LapAggregate aggregate)
    {
        return aggregate == null || aggregate.ObservationResult == null
            ? "no-result" : aggregate.ObservationResult.Code;
    }

    private static MeasurementLapSummaryDto ReadRow(OutboxEntry entry)
    {
        return MeasurementJson.Deserialize<MeasurementLapSummaryDto>(entry.RowJson);
    }

    private static MeasurementPipeline Pipeline(SamplerOptions options, out MeasurementOutbox outbox,
        string sessionId = SessionA)
    {
        var directory = Path.Combine(Path.GetTempPath(), "3sm-obs-pipeline-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        outbox = new MeasurementOutbox(Path.Combine(directory, "outbox.json"));
        var sequence = 1;
        var ids = new MeasurementIdFactory(() => new Guid(sequence++, 0, 0, new byte[8]));
        var pipeline = new MeasurementPipeline(outbox, ids, options);
        pipeline.BeginSession(sessionId);
        return pipeline;
    }

    private static void Emit(MeasurementPipeline pipeline, long milliseconds, int lap, double fuel,
        bool pit, string session = SessionA, ObservationPairingBinding binding = null,
        ObservationLapContext context = null, DateTimeKind kind = DateTimeKind.Utc)
    {
        pipeline.Observe(Sample(milliseconds, lap, fuel, pit, "Synthetische Rijder", session, Segment,
            binding, context, null, kind));
    }

    private static void RunSixty(MeasurementPipeline pipeline, int lap, double fuel, string session)
    {
        for (var index = 0; index < 60; index++)
        {
            Emit(pipeline, lap == 1 ? index * 50 : 3000 + index * 50, lap, fuel, false, session);
        }
    }

    // Dezelfde representatieve reeks als de vóór S2B vastgelegde golden.
    private static string GoldenPipelineJson(bool observationEnabled)
    {
        var options = new SamplerOptions { ObservationCaptureEnabled = observationEnabled };
        MeasurementOutbox outbox;
        var pipeline = Pipeline(options, out outbox, "sim-s9");
        var t0 = new DateTime(2026, 11, 12, 9, 0, 0, DateTimeKind.Utc);
        long tick = 0;
        for (var index = 0; index < 60; index++)
        {
            pipeline.Observe(new TelemetrySample
            {
                ObservedAtUtc = t0.AddMilliseconds(index * 50),
                SdkTick = tick++,
                SessionTimeSeconds = 1000 + index * 0.05,
                LapNumber = 1,
                ObservedSessionId = "sim-s9",
                SegmentId = Segment,
                CurrentDriverName = "Synthetische Rijder",
                OnPitRoad = false,
                FuelLitres = 50.0,
                TrackTempC = 30,
                AirTempC = 20,
                LatAccelG = 1.2,
                LongAccelG = -0.3,
                ObservationPairingBinding = Binding(),
                ObservationLapContext = Context()
            });
        }
        for (var index = 0; index < 20; index++)
        {
            pipeline.Observe(new TelemetrySample
            {
                ObservedAtUtc = t0.AddMilliseconds(3000 + index * 50),
                SdkTick = tick++,
                SessionTimeSeconds = 1003 + index * 0.05,
                LapNumber = 2,
                ObservedSessionId = "sim-s9",
                SegmentId = Segment,
                CurrentDriverName = "Synthetische Rijder",
                OnPitRoad = false,
                FuelLitres = 49.5,
                TrackTempC = 31,
                AirTempC = 21,
                LatAccelG = 1.1,
                LongAccelG = -0.2,
                ObservationPairingBinding = Binding(),
                ObservationLapContext = Context()
            });
        }
        pipeline.End("synthetic_fixture");
        var laps = outbox.Due(t0.AddSeconds(30), 20, 5).Laps;
        return laps.Count > 0 ? laps[0].RowJson : null;
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var goldenPath = Path.Combine(AppContext.BaseDirectory, "Fixtures",
            "measurement-legacy-pipeline-before-observation.json");
        var golden = File.Exists(goldenPath) ? File.ReadAllText(goldenPath) : null;

        // OP01 — opt-out is bytegelijk aan de vóór S2B vastgelegde echte
        // pipeline-uitvoer; er is geen observation-sleutel.
        var optOut = GoldenPipelineJson(false);
        Check("OP01", golden != null && optOut == golden && optOut.IndexOf("observation", StringComparison.Ordinal) < 0,
            "opt-out rij bytegelijk aan golden, geen observation-sleutel");

        // OP02 — met de interne opt-in aan gaat de gewone outbox nog steeds
        // bytegelijk door en bevat nooit een observation.
        var optIn = GoldenPipelineJson(true);
        Check("OP02", golden != null && optIn == golden && optIn.IndexOf("observation", StringComparison.Ordinal) < 0,
            "opt-in: gewone outbox bytegelijk en observation-vrij");

        // OP03 — echte 20 Hz-reeks: volgende tick sluit de ronde met .05 edge
        // en de core levert de werkelijke pit-, refuel- en naamfeiten.
        var sampler = Sampler();
        for (var index = 0; index < 21; index++)
        {
            var ms = index * 50L;
            var fuel = 60.0 + (ms >= 500 ? (ms - 500) / 50.0 * 0.1 : 0.0);
            sampler.Offer(Sample(ms, 1, fuel, ms >= 500 && ms <= 550));
        }
        var op03 = CloseByNextLap(sampler, 1050);
        var op03f = Facts(op03);
        var op03i = Nested(op03f, "interval");
        var op03p = Nested(op03f, "pitRoad");
        var op03r = Nested(op03f, "refuel");
        var op03n = Nested(op03f, "driverNameContinuity");
        var op03c = Nested(op03f, "context");
        Check("OP03", op03f != null && Integer(op03i, "samples") == 21
            && Number(op03i, "maxGapSeconds") == 0.05
            && Number(op03i, "edgeBeforeSeconds") == 0
            && Number(op03i, "edgeAfterSeconds") == 0.05
            && Number(op03i, "unknownSeconds") == 0.05
            && op03p != null && (bool)op03p["value"] && (string)op03p["firstAt"] == "2026-09-27T10:00:00.500Z"
            && op03r != null && Number(op03r, "observedAddedLitres") == 1.0
            && Integer(op03r, "positiveSteps") == 10
            && op03n != null && (string)op03n["value"] == "unchanged"
            && op03c != null && (string)op03c["carId"] == "car-1"
            && (string)Nested(op03f, "capture")["deviceId"] == Device,
            "samples=21 edge=0/.05 maxGap=.05 pit@.5s refuel=1.0/10 context=StartLap"
                + " code=" + Code(op03));

        // OP04 — duplicate en rate-limited ticks tellen niet en maken geen
        // pit/fuel-feit; de fence ziet ze wel.
        sampler = Sampler();
        for (var index = 0; index < 11; index++) sampler.Offer(Sample(index * 50L, 1, 60, false));
        var acceptedBefore = sampler.AcceptedCount;
        var duplicate = Sample(500, 1, 70, true);
        sampler.Offer(duplicate);
        var throttled = Sample(510, 1, 80, true, tick: 510);
        sampler.Offer(throttled);
        var acceptedAfterSkips = sampler.AcceptedCount;
        var op04 = CloseByNextLap(sampler, 1050);
        var op04f = Facts(op04);
        var op04i = Nested(op04f, "interval");
        Check("OP04", acceptedBefore == 11 && acceptedAfterSkips == 11
            && sampler.DuplicateTickCount == 1 && sampler.ThrottledCount == 1
            && op04f != null && Integer(op04i, "samples") == 11
            && !op04f.ContainsKey("pitRoad") && !op04f.ContainsKey("refuel")
            && sampler.AcceptedCount == 12,
            "accepted=11 duplicate=1 throttled=1 samples=11 geen pit/refuel; totaal accepted=12");

        // OP05 — een pairingwissel op een duplicate/rate-limited tick weigert
        // de observation, zonder het aantal samples op te blazen.
        var changes = new[]
        {
            new ObservationPairingBinding(OtherDevice, Owner, 7, true),
            new ObservationPairingBinding(Device, OtherOwner, 7, true),
            new ObservationPairingBinding(Device, Owner, 8, true),
            null
        };
        var changeLabels = new[] { "device", "owner", "generation", "null" };
        for (var index = 0; index < changes.Length; index++)
        {
            sampler = Sampler();
            for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, false));
            var changed = Sample(200, 1, 60, false);
            changed.ObservationPairingBinding = changes[index];
            sampler.Offer(changed);
            var closed = CloseByNextLap(sampler, 250);
            Check("OP05-" + changeLabels[index], closed != null
                && closed.ObservationResult != null && !closed.ObservationResult.HasObservation
                && closed.ObservationResult.Code == ObservationSamplingCodes.BindingChanged
                && sampler.AcceptedCount == 6 && sampler.DuplicateTickCount == 1,
                changeLabels[index] + " op duplicate tick: code=" + Code(closed)
                    + " accepted=" + sampler.AcceptedCount + " duplicate=" + sampler.DuplicateTickCount);
        }

        // OP05b — dezelfde wissel op een throttled tick.
        sampler = Sampler();
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, false));
        var throttledChange = Sample(210, 1, 60, false, tick: 210, binding: Binding(OtherDevice));
        sampler.Offer(throttledChange);
        var op05b = CloseByNextLap(sampler, 260);
        Check("OP05b", op05b != null && op05b.ObservationResult.Code == ObservationSamplingCodes.BindingChanged
            && sampler.AcceptedCount == 6 && sampler.ThrottledCount == 1,
            "devicewissel op throttled tick: code=" + Code(op05b) + " accepted=" + sampler.AcceptedCount);

        // OP06 — UUIDs zijn case-insensitive na validatie; het StartLap-token
        // blijft ongewijzigd op de draad.
        sampler = Sampler();
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, false));
        var lower = Sample(200, 1, 60, false);
        lower.ObservationPairingBinding = Binding(Device.ToLowerInvariant(), Owner.ToLowerInvariant());
        sampler.Offer(lower);
        var op06 = CloseByNextLap(sampler, 250);
        var op06f = Facts(op06);
        Check("OP06", op06f != null
            && (string)Nested(op06f, "capture")["deviceId"] == Device
            && ObservationBindingRules.SamePairing(Binding(), Binding(Device.ToLowerInvariant(),
                Owner.ToLowerInvariant())),
            "lowercase duplicate is dezelfde fence; deviceId blijft " + Device);

        // OP07 — onvolledige/onbekende binding bij StartLap is definitief; een
        // latere complete binding redt de ronde niet.
        sampler = Sampler();
        var incomplete = Sample(0, 1, 60, true);
        incomplete.ObservationPairingBinding = Binding(Device, Owner, 0, false);
        sampler.Offer(incomplete);
        for (var tick = 1; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, true));
        var lateComplete = Sample(200, 1, 60, true);
        lateComplete.ObservationPairingBinding = Binding();
        sampler.Offer(lateComplete);
        var op07 = CloseByNextLap(sampler, 250);
        Check("OP07", op07 != null && op07.ObservationResult != null
            && !op07.ObservationResult.HasObservation
            && op07.ObservationResult.Code == ObservationCaptureCodes.PairingIncomplete
            && op07.ToObservationSummary("88888888-8888-4888-8888-888888888888", "summary-op07") == null
            && op07.HasFrozenObservedSession && op07.SampleCount.HasValue,
            "onbekende generatie bij start: code=" + Code(op07) + " legacy-aggregaat blijft");

        // OP08 — sessie onbekend bij StartLap wordt later niet aangevuld.
        sampler = Sampler(true, null);
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, false, session: null));
        for (var tick = 5; tick < 10; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 61, false, session: SessionB));
        var op08 = CloseSampler(sampler);
        var op08row = op08.ToSummary("88888888-8888-4888-8888-888888888888", "summary-op08", SessionB);
        var op08obs = op08.ToObservationSummary("88888888-8888-4888-8888-888888888888", "summary-op08");
        Check("OP08", op08.HasFrozenObservedSession && op08.FrozenObservedSessionId == null
            && op08row.ObservedSessionId == null
            && op08row.ToJson().IndexOf("observedSessionId", StringComparison.Ordinal) < 0
            && op08obs != null && op08obs.ObservedSessionId == null,
            "start onbekend blijft null; geen late sim-b backfill");

        // OP08b — een onvolledige StartLap-context wordt niet uit latere
        // samples aangevuld; pit/naam blijven, de fuelketen start niet.
        sampler = Sampler();
        var noContext = Sample(0, 1, 60, true);
        noContext.ObservationLapContext = null;
        sampler.Offer(noContext);
        for (var tick = 1; tick < 6; tick++) sampler.Offer(Sample(tick * 50L, 1, 61, true));
        var op08b = CloseByNextLap(sampler, 300);
        var op08bFacts = Facts(op08b);
        Check("OP08b", op08bFacts != null && !op08bFacts.ContainsKey("context")
            && !op08bFacts.ContainsKey("refuel") && op08bFacts.ContainsKey("pitRoad")
            && op08b.ObservationContext == null,
            "context ontbreekt bij start: geen backfill, geen refuel, pit blijft");

        // OP09 — sessiewissel bewaart de oude rij met de bij StartLap
        // bevroren sessie en context; de nieuwe sessie krijgt zijn eigen ronde.
        sampler = Sampler();
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, false));
        sampler.Offer(Sample(250, 1, 60, false, session: SessionB));
        var op09 = sampler.Drain()[0];
        var op09row = op09.ToSummary("88888888-8888-4888-8888-888888888888", "summary-op09", SessionB);
        var op09f = Facts(op09);
        Check("OP09", op09row.ObservedSessionId == SessionA && op09.SegmentId == Segment
            && op09.FrozenObservedSessionId == SessionA
            && op09f != null && (string)Nested(op09f, "context")["carId"] == "car-1"
            && sampler.ObservedSessionId == SessionB,
            "oude rij sessie=A segment=" + Segment + "; actuele sampler=B");

        // OP10 — segmentwissel bewaart het oude segment.
        sampler = Sampler(true, SessionA, "seg-one");
        for (var tick = 0; tick < 5; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60, false, segment: "seg-one"));
        sampler.Offer(Sample(250, 1, 60, false, segment: "seg-two"));
        var op10 = sampler.Drain()[0];
        Check("OP10", op10.SegmentId == "seg-one" && op10.FrozenObservedSessionId == SessionA
            && op10.ToSummary("88888888-8888-4888-8888-888888888888", "summary-op10",
                SessionA).SegmentId == "seg-one"
            && sampler.Current != null && sampler.Current.SegmentId == "seg-two",
            "oude rij segment=seg-one; nieuwe ronde segment=seg-two");

        // OP11 — car/layout-wissel midden in de ronde: StartLap-context blijft,
        // eerdere stappen blijven, de keten begint opnieuw na de wissel.
        sampler = Sampler();
        for (var tick = 0; tick < 10; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60, false, context: Context()));
        for (var tick = 10; tick < 14; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60.5 + (tick - 10) * 0.5, false,
                context: Context("car-2", 124, "Testbaan", "National")));
        var op11 = CloseByNextLap(sampler, 750);
        var op11f = Facts(op11);
        var op11r = Nested(op11f, "refuel");
        var op11c = Nested(op11f, "context");
        Check("OP11", op11f != null && op11c != null && (string)op11c["carId"] == "car-1"
            && (string)op11c["trackConfig"] == "Grand Prix"
            && op11r != null && Number(op11r, "observedAddedLitres") == 1.5
            && Integer(op11r, "positiveSteps") == 3
            && op11f != null,
            "context blijft car-1/GP; refuel=1.5 over 3 stappen na wissel; code=" + Code(op11));

        // OP12 — trackId ontbreekt bij StartLap: contextgroep vervalt, maar
        // pit/refuel/naam blijven geldige feiten.
        sampler = Sampler();
        for (var tick = 0; tick < 12; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60.0 + (tick >= 5 ? (tick - 4) * 0.1 : 0),
                tick >= 5 && tick <= 6, context: Context(trackId: null)));
        var op12 = CloseByNextLap(sampler, 650);
        var op12f = Facts(op12);
        var op12r = Nested(op12f, "refuel");
        Check("OP12", op12f != null && !op12f.ContainsKey("context")
            && op12f.ContainsKey("pitRoad") && op12r != null
            && Integer(op12r, "positiveSteps") > 0
            && op12.SegmentId == Segment,
            "geen context zonder trackId; pit/refuel blijven (steps="
                + (op12r == null ? "-" : op12r["positiveSteps"].ToString()) + ")");

        // OP13 — fuel-only NotePitVisit draagt geen observation-pitRoad; de
        // legacy-rij houdt zijn eigen pitLap-aggregaat.
        sampler = Sampler();
        for (var tick = 0; tick < 10; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60 - tick * 0.1, null));
        sampler.Current.NotePitVisit("pit-observatietest", 25);
        var op13 = CloseSampler(sampler);
        var op13f = Facts(op13);
        var op13row = op13.ToSummary("88888888-8888-4888-8888-888888888888", "summary-op13", SessionA);
        Check("OP13", op13f != null && !op13f.ContainsKey("pitRoad") && !op13f.ContainsKey("refuel")
            && op13.PitLap == true && op13row.PitLap == true
            && op13.FuelAddedLitresObserved == 25,
            "NotePitVisit-fuel: observation zonder pitRoad; legacy pitLap=true");

        // OP14 — alleen een geaccepteerde OnPitRoad==true telt; null wordt nooit
        // false en levert alleen bij true een firstAt.
        sampler = Sampler();
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, null));
        sampler.Offer(Sample(250, 1, 60, true));
        sampler.Offer(Sample(300, 1, 60, null));
        var op14 = CloseByNextLap(sampler, 350);
        var op14p = Nested(Facts(op14), "pitRoad");
        Check("OP14", op14p != null && (bool)op14p["value"]
            && (string)op14p["firstAt"] == "2026-09-27T10:00:00.250Z",
            "OnPitRoad null blijft onbekend; firstAt=eerste true @.25s");

        // OP15 — null fuel breekt de keten binnen <=1 s; de volgende bekende
        // waarde start opnieuw zonder verzonnen stap.
        sampler = Sampler();
        sampler.Offer(Sample(0, 1, 60, false));
        sampler.Offer(Sample(50, 1, null, false));
        sampler.Offer(Sample(100, 1, 62, false));
        sampler.Offer(Sample(150, 1, 64, false));
        sampler.Offer(Sample(200, 1, null, false));
        sampler.Offer(Sample(250, 1, 66, false));
        sampler.Offer(Sample(300, 1, 68, false));
        var op15 = CloseSampler(sampler);
        var op15f = Facts(op15);
        var op15r = Nested(op15f, "refuel");
        Check("OP15", op15f != null && Integer(Nested(op15f, "interval"), "samples") == 7
            && op15r != null && Number(op15r, "observedAddedLitres") == 4.0
            && Integer(op15r, "positiveSteps") == 2,
            "null breekt keten: 4.0 L over 2 stappen, geen stap over de null");

        // OP16 — naamcontinuïteit: leeg en null laten de groep weg; trim/ordinal
        // en een echte wissel blijven gelijk aan de legacy-normalisatie.
        Func<string[], LapAggregate> byName = names =>
        {
            var local = Sampler();
            for (var tick = 0; tick < names.Length; tick++)
                local.Offer(Sample(tick * 50L, 1, 60, tick == 0, names[tick]));
            return CloseByNextLap(local, names.Length * 50L + 50);
        };
        var sameNames = Facts(byName(new[] { "A", "A ", "A" }));
        var emptyName = Facts(byName(new[] { "A", "", "A" }));
        var nullName = Facts(byName(new[] { "A", null, "A" }));
        var changedName = Facts(byName(new[] { "A", "B", "A" }));
        Check("OP16", sameNames != null && (string)Nested(sameNames, "driverNameContinuity")["value"] == "unchanged"
            && emptyName != null && !emptyName.ContainsKey("driverNameContinuity")
            && nullName != null && !nullName.ContainsKey("driverNameContinuity")
            && changedName != null && (string)Nested(changedName, "driverNameContinuity")["value"] == "changed",
            "trim/ordinal unchanged; leeg en null weglaten; A/B changed");

        // OP17 — Local/Unspecified worden door de legacy-sampler genormaliseerd,
        // maar mogen nooit als observationfeit doorgaan.
        foreach (var kind in new[] { DateTimeKind.Local, DateTimeKind.Unspecified })
        {
            sampler = Sampler();
            for (var tick = 0; tick < 5; tick++)
                sampler.Offer(Sample(tick * 50L, 1, 60, true, kind: kind));
            var closed = CloseByNextLap(sampler, 300);
            Check("OP17-" + kind, closed != null && closed.ObservationResult != null
                && !closed.ObservationResult.HasObservation
                && closed.ObservationResult.Code == ObservationSamplingCodes.TimestampNotUtc
                && sampler.AcceptedCount == 6 && closed.SampleCount.HasValue,
                kind + ": accepted, observation geweigerd met " + Code(closed) + "; legacy blijft");
        }

        // OP17b — één Local tick tussen UTC-ticks is genoeg om de hele
        // observation te weigeren; legacy blijft ongewijzigd.
        sampler = Sampler();
        sampler.Offer(Sample(0, 1, 60, true));
        sampler.Offer(Sample(50, 1, 60, true, kind: DateTimeKind.Local));
        sampler.Offer(Sample(100, 1, 60, true));
        var op17b = CloseByNextLap(sampler, 150);
        Check("OP17b", op17b.ObservationResult != null
            && op17b.ObservationResult.Code == ObservationSamplingCodes.TimestampNotUtc
            && op17b.SampleCount.HasValue,
            "gemengde provenance: code=" + Code(op17b));

        // OP18 — de pipeline houdt een eligible observation op het aggregaat,
        // maar publiceert hem nooit in de gewone outbox; End geeft het
        // aggregaat terug voor een latere, expliciete compositie.
        MeasurementOutbox leakOutbox;
        var leakPipeline = Pipeline(new SamplerOptions { ObservationCaptureEnabled = true }, out leakOutbox);
        RunSixty(leakPipeline, 1, 50, SessionA);
        var closedLaps = leakPipeline.End("synthetic_end");
        var leakRows = leakOutbox.Due(At(10000), 20, 5).Laps;
        var leakRow = leakRows.Count > 0 ? ReadRow(leakRows[0]) : null;
        var composed = closedLaps.Count > 0
            ? closedLaps[0].ToObservationSummary("88888888-8888-4888-8888-888888888888", "summary-observed")
            : null;
        Check("OP18", closedLaps.Count == 1 && closedLaps[0].ObservationResult != null
            && closedLaps[0].ObservationResult.HasObservation
            && leakRows.Count == 1 && leakRow != null && leakRow.Observation == null
            && leakRows[0].RowJson.IndexOf("observation", StringComparison.Ordinal) < 0
            && composed != null && composed.Observation != null
            && composed.ObservedSessionId == SessionA,
            "pipeline-aggregaat observation=ja; gewone outbox observation=nee; compositie expliciet");

        // OP19 — een latere sessie draint de oude rij met de oude sessie; de
        // pipeline-globale sessie verandert wel, de rij niet.
        MeasurementOutbox sessionOutbox;
        var sessionPipeline = Pipeline(new SamplerOptions(), out sessionOutbox);
        for (var tick = 0; tick < 10; tick++) Emit(sessionPipeline, tick * 50L, 1, 50, false, SessionA);
        sessionPipeline.BeginSession(SessionB);
        for (var tick = 0; tick < 10; tick++)
            Emit(sessionPipeline, 1000 + tick * 50L, 2, 49, false, SessionB);
        sessionPipeline.End("synthetic_end");
        var sessionRows = sessionOutbox.Due(At(10000), 20, 5).Laps;
        var rowA = sessionRows.Count > 0 ? ReadRow(sessionRows[0]) : null;
        var rowB = sessionRows.Count > 1 ? ReadRow(sessionRows[1]) : null;
        Check("OP19", rowA != null && rowA.ObservedSessionId == SessionA
            && rowB != null && rowB.ObservedSessionId == SessionB
            && sessionPipeline.ObservedSessionId == SessionB,
            "rij A=" + (rowA == null ? "-" : rowA.ObservedSessionId)
                + " rij B=" + (rowB == null ? "-" : rowB.ObservedSessionId));

        // OP20 — één sample: first==last, maxGap=0 en de echte .05 edge bij
        // een volgende tick; geen kunstmatige nul-tick.
        sampler = Sampler();
        sampler.Offer(Sample(0, 1, 60, true));
        var op20 = CloseByNextLap(sampler, 50);
        var op20f = Facts(op20);
        var op20i = Nested(op20f, "interval");
        var op20p = Nested(op20f, "pitRoad");
        Check("OP20", op20f != null && Integer(op20i, "samples") == 1
            && Number(op20i, "maxGapSeconds") == 0
            && (string)op20i["firstSampleAt"] == (string)op20i["lastSampleAt"]
            && Number(op20i, "edgeAfterSeconds") == 0.05
            && op20p != null && (string)op20p["firstAt"] == (string)op20i["firstSampleAt"],
            "samples=1 maxGap=0 first=last edgeAfter=.05");

        // OP21 — optionele SDK-waarden onbekend blijven onbekend; sim-s0 wordt
        // nooit een numeriek sessie-ID en er wordt geen 0 ingevuld.
        sampler = Sampler();
        for (var tick = 0; tick < 5; tick++)
            sampler.Offer(Sample(tick * 50L, 1, 60, true,
                context: Context(sessionUniqueId: null, sessionNumber: null)));
        var op21 = CloseSampler(sampler);
        var op21f = Facts(op21);
        var op21c = Nested(op21f, "context");
        Check("OP21", op21c != null && !op21c.ContainsKey("sessionUniqueId")
            && !op21c.ContainsKey("sessionNumber") && (string)op21c["carId"] == "car-1",
            "optionele sessievelden ontbreken; geen 0 of sim-s0-parse");

        // OP22 — handmatige legacy-fixture houdt zijn oude ToSummary-gedrag;
        // een echt sampler-aggregaat met onbekende sessie blijft null.
        var legacyAggregate = new LapAggregate
        {
            LapNumber = 3,
            StartedAtUtc = At(0),
            EndedAtUtc = At(1000),
            SegmentId = "seg-legacy",
            DriverName = "Naam"
        };
        var legacyRow = legacyAggregate.ToSummary("88888888-8888-4888-8888-888888888888",
            "summary-legacy", "sim-later");
        Check("OP22", !legacyAggregate.HasFrozenObservedSession
            && legacyRow.ObservedSessionId == "sim-later"
            && legacyAggregate.ToObservationSummary("88888888-8888-4888-8888-888888888888",
                "summary-legacy") == null,
            "handmatige fixture valt terug op aangeleverde sessie; geen observation");

        // OP23 — opt-out bouwt helemaal geen observation-state op; de
        // SamplerOptions-default is expliciet false.
        Check("OP23-default", !new SamplerOptions().ObservationCaptureEnabled,
            "SamplerOptions.ObservationCaptureEnabled default=false");
        sampler = Sampler(false);
        for (var tick = 0; tick < 5; tick++) sampler.Offer(Sample(tick * 50L, 1, 60, true));
        var op23 = CloseSampler(sampler);
        Check("OP23", op23.ObservationResult == null && op23.ObservationPairingBinding == null
            && op23.ObservationContext == null && op23.HasFrozenObservedSession
            && op23.FrozenObservedSessionId == SessionA
            && op23.ToObservationSummary("88888888-8888-4888-8888-888888888888", "summary-op23") == null,
            "opt-out: geen resultaat/snapshots; sessie wel bevroren");

        // OP24 — ongeldige input wordt niet geaccepteerd en levert geen ronde
        // of observation; de core blijft de enige rekenregel.
        sampler = Sampler();
        var invalid = Sample(0, 1, 60, true);
        invalid.ObservedAtUtc = default(DateTime);
        var invalidOutcome = sampler.Offer(invalid);
        var emptyDrain = sampler.Drain();
        Check("OP24", !invalidOutcome.Accepted && invalidOutcome.Reason == "observed_at_missing"
            && emptyDrain.Count == 0 && sampler.Current == null && sampler.RejectedCount == 1,
            "default-tijd geweigerd zonder ronde/observation");

        return count;
    }

    // ------------------------------------------------------------------
    // Fixture-export: echte sampler->accumulator->composer->serializerbytes.
    // Alleen de meta-regels zijn een klein C#-DTO; de rijen en observation
    // zijn nooit handgeschreven JSON.
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

    private static void Write(string directory, string name, string content)
    {
        File.WriteAllText(Path.Combine(directory, name), content, Utf8NoBom);
    }

    private static void WriteMeta(string directory, FixtureMeta meta)
    {
        Write(directory, meta.Case + ".meta.json", MeasurementJson.Serialize(meta));
    }

    public static void ExportFixtures(string directory)
    {
        Directory.CreateDirectory(directory);

        // Echte normale pipeline-route: 60 geaccepteerde 20 Hz-ticks, daarna
        // sluit de volgende tick de ronde met .05 edge.
        var sampler = Sampler();
        for (var tick = 0; tick < 60; tick++)
        {
            var ms = tick * 50L;
            var fuel = 50.0 + (ms >= 1000 && ms <= 1500 ? (ms - 1000) / 50.0 * 0.05 : 0.0);
            sampler.Offer(Sample(ms, 1, fuel, ms >= 1000 && ms <= 1500));
        }
        sampler.Offer(Sample(3000, 2, 50, false));
        var aggregate = sampler.Drain()[0];
        var observation = aggregate.ObservationResult;
        var row = aggregate.ToObservationSummary("88888888-8888-4888-8888-888888888888",
            "summary-pipeline-observed");

        Write(directory, "pipeline-observed.observation.json", observation.ToJson());
        Write(directory, "pipeline-observed.row.json", row.ToJson());
        WriteMeta(directory, new FixtureMeta
        {
            Case = "pipeline-observed",
            Kind = "observation",
            Expect = "accept",
            Code = "observation_accepted",
            ObservationFile = "pipeline-observed.observation.json",
            RowFile = "pipeline-observed.row.json",
            StartedAt = MeasurementTime.Format(aggregate.StartedAtUtc),
            EndedAt = MeasurementTime.Format(aggregate.EndedAtUtc),
            AuthenticatedDeviceId = Device,
            Note = "synthetisch; echte sampler->accumulator->composer->serializerbytes"
        });

        // Negatieve identiteitscontrole op dezelfde echte bytes.
        WriteMeta(directory, new FixtureMeta
        {
            Case = "pipeline-device-mismatch",
            Kind = "observation",
            Expect = "quarantine",
            Code = "observation_device_mismatch",
            ObservationFile = "pipeline-observed.observation.json",
            RowFile = "pipeline-observed.row.json",
            StartedAt = MeasurementTime.Format(aggregate.StartedAtUtc),
            EndedAt = MeasurementTime.Format(aggregate.EndedAtUtc),
            AuthenticatedDeviceId = OtherDevice,
            Note = "synthetische auth-controle rond echte observationbytes"
        });

        // Negatieve venstercontrole: de rij eindigt vóór het laatste sample.
        WriteMeta(directory, new FixtureMeta
        {
            Case = "pipeline-window-mismatch",
            Kind = "observation",
            Expect = "reject",
            Code = "observation_interval_outside_row",
            ObservationFile = "pipeline-observed.observation.json",
            RowFile = "pipeline-observed.row.json",
            StartedAt = MeasurementTime.Format(aggregate.StartedAtUtc),
            EndedAt = MeasurementTime.Format(At(2900)),
            AuthenticatedDeviceId = Device,
            Note = "synthetisch te vroeg rij-einde rond echte observationbytes"
        });

        // De gewone outbox van dezelfde representatieve reeks blijft
        // observation-vrij en wordt als echte legacy-rij geclassificeerd.
        var goldenPath = Path.Combine(AppContext.BaseDirectory, "Fixtures",
            "measurement-legacy-pipeline-before-observation.json");
        var legacyRow = File.ReadAllText(goldenPath);
        Write(directory, "pipeline-legacy.row.json", legacyRow);
        WriteMeta(directory, new FixtureMeta
        {
            Case = "pipeline-legacy",
            Kind = "legacy",
            Expect = "legacy",
            RowFile = "pipeline-legacy.row.json",
            AuthenticatedDeviceId = Device,
            Note = "echte voor-S2B pipeline-outbox; observation-afwezig"
        });
    }
}
