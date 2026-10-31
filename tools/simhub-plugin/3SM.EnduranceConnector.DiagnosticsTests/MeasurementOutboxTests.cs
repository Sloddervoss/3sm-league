using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using ThreeSM.EnduranceConnector;

// De outbox zelf: ACK per rij, herstart, overloop, backoff. Eén rij mag pas weg als de
// server hem per bericht heeft bevestigd; een 202 of een opgeslagen:false is dat niet.
internal static class MeasurementOutboxTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 14, 0, 0, DateTimeKind.Utc);

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "3sm-outbox-" + Guid.NewGuid().ToString("N"));
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

    private static MeasurementLapSummaryRecord Lap(MeasurementIdFactory ids, int lapNumber)
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
        return aggregate.ToSummary(ids.NewSummaryUid(), ids.NextSummaryLabel(lapNumber), "sessie-1");
    }

    private static string Ack(string eventsJson, string lapsJson)
    {
        return "{\"accepted\":true,\"receivedAt\":\"2026-10-31T14:00:01.000Z\",\"measurements\":{\"events\":"
            + eventsJson + ",\"laps\":" + lapsJson + "}}";
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

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var ids = new MeasurementIdFactory();

        // --------------------------------------------------------------- ACK
        var ackOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var first = Event(ids, "wear_value_changed", 91);
        var second = Event(ids, "wear_value_changed", 92);
        ackOutbox.Enqueue(first, out string _);
        ackOutbox.Enqueue(second, out string _);
        var ackReport = MeasurementAckParser.Parse(Ack(
            Series(true, accepted: Id(first.EventUid, 1), duplicates: Id(second.EventUid, 1), received: 2),
            EmptySeries()), ackOutbox.Due(T0, 20, 3));
        var ackOutcome = ackOutbox.ApplyAck(ackReport, T0);
        Check("O01", ackOutcome.ConfirmedEvents == 1 && ackOutcome.DuplicateEvents == 1 && ackOutbox.EventCount == 0,
            "accepted en duplicates ruimen de rij op; een duplicaat is ook bevestigd");
        Check("O02", ackReport.Events.Stored && ackOutcome.Stored, "stored:true met rijbevestigingen is leveringsbewijs");

        var again = ackOutbox.ApplyAck(ackReport, T0);
        Check("O03", again.ConfirmedEvents == 0 && again.DuplicateEvents == 0 && ackOutbox.EventCount == 0,
            "een tweede keer hetzelfde ACK telt niets dubbel");

        // stored:false: niets opruimen, reden bewaren.
        ackOutbox.Enqueue(first, out string _);
        var notStored = MeasurementAckParser.Parse(Ack(
            Series(false, blockError: "\"payload_too_large\"", received: 1), EmptySeries()), ackOutbox.Due(T0, 20, 3));
        var notStoredOutcome = ackOutbox.ApplyAck(notStored, T0);
        Check("O04", ackOutbox.EventCount == 1 && !notStoredOutcome.Stored
            && ackOutbox.LastBlockError == "payload_too_large",
            "stored:false laat de rij staan en bewaart de reden");

        // 202 zonder bevestiging per rij.
        var bareOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        bareOutbox.Enqueue(Event(ids, "wear_value_changed", 93), out string _);
        var bareReport = MeasurementAckParser.Parse("{\"accepted\":true}", bareOutbox.Due(T0, 20, 3));
        var bareOutcome = bareOutbox.ApplyAck(bareReport, T0);
        Check("O05", bareOutbox.EventCount == 1 && !bareOutcome.Stored
            && bareOutbox.LastBlockError == "ack_without_measurements",
            "een frame-ACK zonder rijbevestiging ruimt niets op");

        // Afgekeurde rij: weg, met reden en indexvertaling.
        var rejectOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var keep = Event(ids, "wear_value_changed", 94);
        var drop = Event(ids, "wear_value_changed", 95);
        rejectOutbox.Enqueue(keep, out string _);
        rejectOutbox.Enqueue(drop, out string _);
        var rejectReport = MeasurementAckParser.Parse(Ack(
            Series(true, accepted: Id(keep.EventUid, 1),
                rejected: "{\"id\":null,\"index\":1,\"reason\":\"wear_after_contract\",\"stage\":\"parser\"}", received: 2),
            EmptySeries()), rejectOutbox.Due(T0, 20, 3));
        var rejectOutcome = rejectOutbox.ApplyAck(rejectReport, T0);
        Check("O06", rejectOutcome.RejectedEvents == 1 && rejectOutcome.LastRejectionReason == "wear_after_contract"
            && rejectOutbox.EventCount == 0 && rejectOutbox.RejectedEvents == 1,
            "een afgekeurde rij wordt met reden verwijderd en geteld, index 1 hoort bij de tweede rij");

        // Bevestiging van een oudere revisie: de nieuwere inhoud blijft staan.
        var reviseOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var revised = Event(ids, "wear_value_changed", 96);
        revised.RecordRevision = 2;
        reviseOutbox.Enqueue(revised, out string _);
        var reviseReport = MeasurementAckParser.Parse(Ack(
            Series(true, accepted: Id(revised.EventUid, 1), received: 1), EmptySeries()), reviseOutbox.Due(T0, 20, 3));
        var reviseOutcome = reviseOutbox.ApplyAck(reviseReport, T0);
        Check("O07", reviseOutbox.EventCount == 1 && reviseOutcome.KeptForNewerRevision == 1,
            "een bevestiging van revisie 1 laat onze revisie 2 staan");

        // ----------------------------------------------------------- herstart
        var restartPath = Path.Combine(NewDirectory(), "outbox.json");
        var beforeRestart = new MeasurementOutbox(restartPath);
        var keptEvent = Event(ids, "wear_refresh_confirmed", 97);
        var keptLap = Lap(ids, 12);
        beforeRestart.Enqueue(keptEvent, out string _);
        beforeRestart.EnqueueLap(keptLap, out string _);
        var afterRestart = new MeasurementOutbox(restartPath);
        afterRestart.Load();
        var dueAfterRestart = afterRestart.Due(T0, 20, 3);
        Check("O08", afterRestart.EventCount == 1 && afterRestart.LapCount == 1
            && dueAfterRestart.Events[0].Uid == keptEvent.EventUid
            && dueAfterRestart.Laps[0].Uid == keptLap.SummaryUid,
            "na een herstart staan dezelfde UUID's weer in de wachtrij");
        var restartAck = MeasurementAckParser.Parse(Ack(
            Series(true, accepted: Id(keptEvent.EventUid, 1)),
            Series(true, accepted: Id(keptLap.SummaryUid, 1))), dueAfterRestart);
        afterRestart.ApplyAck(restartAck, T0);
        var afterAckRestart = new MeasurementOutbox(restartPath);
        afterAckRestart.Load();
        Check("O09", afterRestart.EventCount == 0 && afterRestart.LapCount == 0
            && afterAckRestart.EventCount == 0 && afterAckRestart.LapCount == 0,
            "wat bevestigd is, is ook na een tweede herstart weg");

        // Oude outbox na reconnect: de eerste levering houdt de oorspronkelijke sessie.
        var staleOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var stale = Event(ids, "wear_value_changed", 89);
        stale.ObservedSessionId = "sessie-oud";
        staleOutbox.Enqueue(stale, out string _);
        var reloaded = new MeasurementOutbox(staleOutbox.Path);
        reloaded.Load();
        var staleRow = reloaded.Due(T0, 20, 3).Events[0].RowJson;
        Check("O10", staleRow.Contains("\"observedSessionId\":\"sessie-oud\""),
            "een oude waarneming houdt haar eigen sessie en krijgt niet de afleversessie");

        // ------------------------------------------------------------ overloop
        var smallOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"),
            new OutboxLimits { MaxEvents = 3, MaxLaps = 1 });
        var enqueued = new List<string>();
        for (var index = 0; index < 5; index++)
        {
            var record = Event(ids, "wear_value_changed", 70 + index);
            enqueued.Add(record.EventUid);
            smallOutbox.Enqueue(record, out string _);
        }
        Check("O11", smallOutbox.EventCount == 3 && smallOutbox.DroppedEvents == 2,
            "overloop is expliciet verlies: 2 van 5 vervallen en worden geteld");
        Check("O12", !string.IsNullOrEmpty(smallOutbox.LastDropReason)
            && smallOutbox.LastDropReason.StartsWith("outbox_full:events:", StringComparison.Ordinal),
            "het verlies heeft een reden met de UUID erbij");
        var remaining = smallOutbox.Due(T0, 20, 3).Events;
        Check("O13", remaining.Count == 3 && remaining[0].Uid == enqueued[2],
            "de oudste rijen vervallen; de nieuwste blijven");
        var reloadedSmall = new MeasurementOutbox(smallOutbox.Path);
        reloadedSmall.Load();
        Check("O14", reloadedSmall.DroppedEvents == 2, "het gemelde verlies overleeft een herstart");

        // Dezelfde UUID twee keer aanbieden is geen tweede rij.
        var duplicateOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var once = Lap(ids, 3);
        string reason;
        duplicateOutbox.EnqueueLap(once, out reason);
        var twice = duplicateOutbox.EnqueueLap(once, out reason);
        Check("O15", !twice && reason == "duplicate_uid" && duplicateOutbox.LapCount == 1,
            "dezelfde summaryUid wordt niet twee keer opgeslagen");

        // Een rij die het contract schendt komt er niet in, met reden.
        var invalidOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var invalid = Event(ids, "wear_value_changed", 99);
        invalid.Evidence = null;
        invalid.Confidence = null;
        var acceptedInvalid = invalidOutbox.Enqueue(invalid, out reason);
        Check("O16", !acceptedInvalid && reason == "evidence_missing" && invalidOutbox.EventCount == 0,
            "wear zonder bewijs wordt al lokaal geweigerd (" + reason + ")");

        // Corrupt bestand: geen exception, apart gezet, lege wachtrij.
        var corruptDirectory = NewDirectory();
        var corruptPath = Path.Combine(corruptDirectory, "outbox.json");
        File.WriteAllText(corruptPath, "{dit is geen json");
        var corruptOutbox = new MeasurementOutbox(corruptPath);
        corruptOutbox.Load();
        var quarantined = Directory.GetFiles(corruptDirectory, "outbox.json.corrupt-*");
        Check("O17", corruptOutbox.EventCount == 0 && quarantined.Length == 1
            && !string.IsNullOrEmpty(corruptOutbox.LastPersistenceError),
            "een onleesbaar bestand wordt apart gezet en levert geen exception");

        // ------------------------------------------------------------- backoff
        var schedule = new List<double>();
        var scheduleOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        for (var attempt = 1; attempt <= 7; attempt++) schedule.Add(scheduleOutbox.BackoffSeconds(attempt));
        Check("O18", schedule.SequenceEqual(new double[] { 2, 4, 8, 16, 32, 60, 60 }),
            "backoff loopt 2, 4, 8, 16, 32 en stopt bij 60 s (" + string.Join(",", schedule) + ")");

        var attemptOutbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var attemptEvent = Event(ids, "wear_value_changed", 88);
        attemptOutbox.Enqueue(attemptEvent, out string _);
        var due = attemptOutbox.Due(T0, 20, 3);
        attemptOutbox.MarkAttempt(due.Events, T0, true);
        Check("O19", attemptOutbox.Due(T0, 20, 3).Events.Count == 0
            && attemptOutbox.Due(T0.AddSeconds(2), 20, 3).Events.Count == 1,
            "na een mislukte poging duurt het 2 s voor de rij weer aan de beurt is");
        attemptOutbox.MarkAttempt(attemptOutbox.Due(T0.AddSeconds(2), 20, 3).Events, T0.AddSeconds(2), false);
        Check("O20", attemptOutbox.Due(T0.AddSeconds(2), 20, 3).Events.Count == 1
            && attemptOutbox.Due(T0.AddSeconds(2), 20, 3).Events[0].Attempts == 0,
            "een geslaagde poging zet de teller terug en laat de rij staan tot het ACK");

        return count;
    }
}
