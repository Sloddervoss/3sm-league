using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// Het frame en de verzending: aantallen, bytebudget, injectie van de meetsleutels,
// herverzending na een fout en een ACK dat per rij wordt verwerkt.
internal static class MeasurementTransportTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 14, 0, 0, DateTimeKind.Utc);
    private const string Core = "{\"protocolVersion\":3,\"sequence\":7}";

    private sealed class FakeRelay : HttpMessageHandler
    {
        public readonly List<string> Bodies = new List<string>();
        public HttpStatusCode Status = HttpStatusCode.OK;
        public string ResponseBody = "{\"accepted\":true}";
        public int Calls;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Bodies.Add(await request.Content.ReadAsStringAsync());
            return new HttpResponseMessage(Status) { Content = new StringContent(ResponseBody) };
        }
    }

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "3sm-frame-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static MeasurementEventRecord Event(MeasurementIdFactory ids, string kind, double wearAfter, string note = null)
    {
        return new MeasurementEventRecord
        {
            EventUid = ids.NewEventUid(),
            EventId = ids.NextEventLabel(),
            Kind = kind,
            SegmentId = "seg-test",
            PitVisitId = "pit-test-1",
            ObservedSessionId = "sessie-1",
            ObservedAtUtc = T0,
            SessionTimeSeconds = 100,
            SdkTick = 42,
            WearBefore = new WearReading(80, 80, 80, 80),
            WearAfter = new WearReading(wearAfter, wearAfter, 80, 80),
            WearBeforeObservedAtUtc = T0.AddSeconds(-10),
            WearAfterObservedAtUtc = T0,
            SetGeneration = new SetGenerationReading(),
            Evidence = new TyreEvidence("wear_channels", new[] { "wear_percent" }, note),
            Confidence = 0.4,
            RecordRevision = 1
        };
    }

    private static MeasurementLapSummaryRecord Lap(MeasurementIdFactory ids, int lapNumber, int pitVisitIds = 0)
    {
        var aggregate = new LapAggregate
        {
            LapNumber = lapNumber,
            StartedAtUtc = T0,
            EndedAtUtc = T0.AddSeconds(90),
            SegmentId = "seg-test",
            DriverName = "Vincent de Vos",
            Complete = true,
            Coverage = new MeasurementLapCoverageDto
            {
                Temperature = new MeasurementCoverageGroupDto { SampleCount = 1800, ValidDurationSeconds = 89.9, MaxGapSeconds = 0.05 },
                Fuel = new MeasurementCoverageGroupDto { SampleCount = 1800, ValidDurationSeconds = 89.9, MaxGapSeconds = 0.05 },
                Load = new MeasurementCoverageGroupDto { SampleCount = 1800, ValidDurationSeconds = 89.9, MaxGapSeconds = 0.05 }
            },
            TrackTempCMean = 31.2,
            TrackTempCMin = 30.8,
            TrackTempCMax = 31.6,
            AirTempCMean = 21.0,
            FuelStartLitres = 60,
            FuelEndLitres = 57.2,
            FuelLevelIntegralLitreSeconds = 5280.5,
            AbsLatAccelIntegralGSeconds = 812.4,
            LatAccelSquaredIntegralG2Seconds = 1204.9,
            MaxAbsLatAccelG = 2.31,
            AbsLongAccelIntegralGSeconds = 210.2,
            SampleCount = 5400,
            MaxGapSeconds = 0.05,
            ValidDurationSeconds = 89.9
        };
        if (pitVisitIds > 0)
        {
            var visits = new List<string>();
            for (var index = 0; index < pitVisitIds; index++)
                visits.Add("pit-seg-test-1-visit-" + index.ToString(System.Globalization.CultureInfo.InvariantCulture));
            aggregate.PitVisitIds = visits.ToArray();
        }
        return aggregate.ToSummary(ids.NewSummaryUid(), ids.NextSummaryLabel(lapNumber), "sessie-1");
    }

    private static string Series(bool stored, string accepted = "", string duplicates = "", string superseded = "",
        string rejected = "", string blockError = "null", int received = 1)
    {
        return "{\"received\":" + received + ",\"accepted\":[" + accepted + "],\"duplicates\":[" + duplicates
            + "],\"superseded\":[" + superseded + "],\"rejected\":[" + rejected + "],\"block_error\":"
            + blockError + ",\"stored\":" + (stored ? "true" : "false") + "}";
    }

    private static string EmptySeries()
    {
        return Series(true, received: 0);
    }

    private static string Id(string uid, int revision)
    {
        return "{\"id\":\"" + uid + "\",\"record_revision\":" + revision + "}";
    }

    private static string Ack(string eventsJson, string lapsJson)
    {
        return "{\"accepted\":true,\"receivedAt\":\"2026-10-31T14:00:01.000Z\",\"measurements\":{\"events\":"
            + eventsJson + ",\"laps\":" + lapsJson + "}}";
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var ids = new MeasurementIdFactory();
        var limits = MeasurementLimits.Default();
        var outbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var sender = new MeasurementSender(outbox, new HttpClient(new FakeRelay()),
            () => "{\"revision\":1,\"supported\":{\"lapSummary\":1,\"measurementEvents\":1}}", limits);

        // -------------------------------------------------------------- budget
        for (var index = 0; index < 30; index++) outbox.Enqueue(Event(ids, "wear_value_changed", 90), out string _);
        for (var index = 0; index < 6; index++) outbox.EnqueueLap(Lap(ids, index + 1), out string _);
        var plan = sender.Plan(Encoding.UTF8.GetByteCount(Core), T0);
        Check("F01", plan.Batch.Events.Count == 20 && plan.Batch.Laps.Count == 3,
            "maximaal 20 gebeurtenissen en 3 rondes per frame (" + plan.Batch.Events.Count + "/" + plan.Batch.Laps.Count + ")");
        Check("F02", plan.DeferredEvents == 10 && plan.DeferredLaps == 3 && plan.Reason == "deferred_by_budget",
            "wat niet past blijft staan en wordt als uitgesteld gemeld ("
            + plan.DeferredEvents + "/" + plan.DeferredLaps + ")");
        var body = MeasurementJson.InjectIntoFrame(Core, plan.MembersJson);
        Check("F03", Encoding.UTF8.GetByteCount(body) <= 24576,
            "de hele body blijft onder 24.576 bytes (" + Encoding.UTF8.GetByteCount(body) + ")");
        Check("F04", plan.MeasurementBytes <= 16384,
            "de twee reeksen samen blijven onder 16.384 bytes (" + plan.MeasurementBytes + ")");
        var parsedBody = MeasurementJson.DeserializeDictionary(body);
        Check("F05", parsedBody.ContainsKey("protocolVersion") && parsedBody.ContainsKey("measurementEvents")
            && parsedBody.ContainsKey("lapSummaries") && parsedBody.ContainsKey("capabilities")
            && parsedBody.ContainsKey("schemaRevision"),
            "het frame houdt de kern en krijgt schemaRevision, capabilities en de twee reeksen");
        var capabilities = parsedBody["capabilities"] as Dictionary<string, object>;
        Check("F06", capabilities != null && Convert.ToInt32(parsedBody["schemaRevision"]) == 1
            && capabilities.ContainsKey("revision") && capabilities.ContainsKey("supported"),
            "capabilities staan als blok in het frame, met de geversioneerde features");
        Check("F07", outbox.EventCount == 30 && outbox.LapCount == 6, "plannen verwijdert niets uit de wachtrij");

        // Grote rijen: uitstellen, niet afkappen en niet opblazen.
        var bigOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        for (var index = 0; index < 3; index++) bigOutbox.EnqueueLap(Lap(ids, index + 1, 32), out string _);
        for (var index = 0; index < 20; index++)
            bigOutbox.Enqueue(Event(ids, "wear_value_changed", 90, new string('n', 200) + index), out string _);
        var bigSender = new MeasurementSender(bigOutbox, new HttpClient(new FakeRelay()), () => null, limits);
        var bigPlan = bigSender.Plan(Encoding.UTF8.GetByteCount(Core), T0);
        var bigBody = MeasurementJson.InjectIntoFrame(Core, bigPlan.MembersJson);
        Check("F08", Encoding.UTF8.GetByteCount(bigBody) <= 24576 && bigPlan.MeasurementBytes <= 16384
            && bigPlan.Batch.Laps.Count + bigPlan.Batch.Events.Count < 23
            && bigPlan.DeferredEvents + bigPlan.DeferredLaps > 0,
            "grote rijen worden uitgesteld in plaats van de body op te blazen ("
            + bigPlan.Batch.Laps.Count + "+" + bigPlan.Batch.Events.Count + " van 23, "
            + bigPlan.MeasurementBytes + " B reeks, " + Encoding.UTF8.GetByteCount(bigBody) + " B body)");

        // ------------------------------------------------------------- zenden
        var sendOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var relay = new FakeRelay();
        var sendSender = new MeasurementSender(sendOutbox, new HttpClient(relay),
            () => "{\"revision\":1,\"supported\":{\"measurementEvents\":1}}", limits);
        var toSend = Event(ids, "wear_value_changed", 77);
        sendOutbox.Enqueue(toSend, out string _);
        relay.ResponseBody = Ack(Series(true, accepted: Id(toSend.EventUid, 1)), EmptySeries());
        var sendResult = sendSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0, CancellationToken.None)
            .GetAwaiter().GetResult();
        Check("F09", sendResult.Sent && sendResult.Stored && sendResult.EventsSent == 1 && sendOutbox.EventCount == 0,
            "een bevestigde levering ruimt de rij op en meldt het aantal");
        Check("F10", relay.Calls == 1 && relay.Bodies[0].Contains(toSend.EventUid)
            && relay.Bodies[0].Contains("\"schemaRevision\""),
            "één POST met de meetserie in het frame");

        var idle = sendSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0, CancellationToken.None)
            .GetAwaiter().GetResult();
        Check("F11", !idle.Sent && idle.Error == "nothing_due" && relay.Calls == 1,
            "zonder meetrijen gaat er geen extra POST uit");

        sendOutbox.Enqueue(Event(ids, "wear_value_changed", 78), out string _);
        relay.Status = HttpStatusCode.BadGateway;
        var broken = sendSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0.AddSeconds(30), CancellationToken.None)
            .GetAwaiter().GetResult();
        Check("F12", broken.StatusCode == 502 && sendOutbox.EventCount == 1
            && sendOutbox.Due(T0.AddSeconds(31), 20, 3).Events.Count == 0,
            "een mislukte POST laat de rij staan en zet hem in de wacht");

        // 202 zonder bevestiging: de POST is gelukt, de rij blijft.
        relay.Status = HttpStatusCode.Accepted;
        relay.ResponseBody = "{\"accepted\":true}";
        var noAck = sendSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0.AddSeconds(120), CancellationToken.None)
            .GetAwaiter().GetResult();
        Check("F13", noAck.Sent && !noAck.Stored && sendOutbox.EventCount == 1
            && sendOutbox.LastBlockError == "ack_without_measurements",
            "HTTP 202 zonder rijbevestiging is geen leveringsbewijs");

        // ------------------------------------------------------------ reconnect
        var reconnectPath = Path.Combine(NewDirectory(), "outbox.json");
        var reconnectOutbox = new MeasurementOutbox(reconnectPath);
        var relay2 = new FakeRelay { Status = HttpStatusCode.InternalServerError, ResponseBody = "{}" };
        var reconnectSender = new MeasurementSender(reconnectOutbox, new HttpClient(relay2), () => null, limits);
        var reconnected = Event(ids, "wear_value_changed", 98);
        reconnectOutbox.Enqueue(reconnected, out string _);
        reconnectSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0, CancellationToken.None)
            .GetAwaiter().GetResult();

        var afterRestart = new MeasurementOutbox(reconnectPath);
        afterRestart.Load();
        Check("F14", afterRestart.EventCount == 1
            && afterRestart.Due(T0.AddSeconds(5), 20, 3).Events[0].Uid == reconnected.EventUid,
            "na een mislukte POST en een herstart staat dezelfde UUID nog in de wachtrij");

        relay2.Status = HttpStatusCode.OK;
        relay2.ResponseBody = Ack(Series(true, duplicates: Id(reconnected.EventUid, 1)), EmptySeries());
        var resent = reconnectSender.SendAsync(new Uri("https://example.test/ingest"), "token", Core, T0.AddSeconds(5), CancellationToken.None)
            .GetAwaiter().GetResult();
        Check("F15", resent.Stored && reconnectOutbox.EventCount == 0,
            "de herverzending met dezelfde UUID levert een duplicaat en ruimt de rij op");
        Check("F16", relay2.Bodies.Count == 2 && relay2.Bodies[1].Contains(reconnected.EventUid),
            "de tweede POST bevat exact dezelfde UUID als de eerste");

        // Een reeks zonder 'stored' (oud frame) houdt de rij vast; een lege reeks zegt niets.
        var legacyReport = MeasurementAckParser.Parse(
            "{\"accepted\":true,\"measurements\":{\"events\":{\"received\":1},\"laps\":{\"received\":0}}}",
            sendOutbox.Due(T0, 20, 3));
        Check("F17", !legacyReport.Events.Stored && legacyReport.Laps.Stored,
            "een reeks zonder 'stored' geldt als niet opgeslagen; een lege reeks zegt niets");

        return count;
    }
}
