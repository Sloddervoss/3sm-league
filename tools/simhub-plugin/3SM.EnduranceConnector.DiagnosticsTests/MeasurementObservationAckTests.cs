using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using ThreeSM.EnduranceConnector;

// T13-S2C2a — observation ACK classification and durable per-row application.
// Every durable test writes a real ledger file under an isolated temporary
// directory. ACK bodies are synthetic fixtures in the exact Edge/DB wire shape;
// there is no HTTP, token, APPDATA, SDK or production database use here.
internal static class MeasurementObservationAckTests
{
    private const string Device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string OtherDevice = "99999999-8888-4777-8666-555555555555";
    private static readonly DateTime T0 = new DateTime(2026, 11, 12, 12, 0, 0, DateTimeKind.Utc);
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private static ObservationPairingBinding Binding(string device = Device, long generation = 7)
    {
        return new ObservationPairingBinding(device, Owner, generation, true);
    }

    private static string Uid(int value)
    {
        return "00000000-0000-4000-8000-" + value.ToString("D12", CultureInfo.InvariantCulture);
    }

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(),
            "3sm-observation-ack-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static MeasurementLapSummaryRecord Row(string uid, bool observation = true,
        int revision = 1, string driver = "Test Driver", string session = "session-a",
        string device = Device)
    {
        var context = new ObservationLapContext("car-1", 123, "Test Track", "Grand Prix", 42, 3);
        var samples = new List<ObservationSample>
        {
            new ObservationSample(T0, true, 50.0, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(500), false, 49.5, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(1000), false, 49.0, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(1500), true, 48.5, driver, "ctx-a")
        };
        var built = ObservationCapture.Build(Binding(device), context, samples,
            T0, T0.AddMilliseconds(2000));
        if (observation && !built.HasObservation)
            throw new InvalidOperationException("testfixture bouwde geen observation: " + built.Code);
        return new MeasurementLapSummaryRecord
        {
            SummaryUid = uid,
            SummaryId = "summary-" + uid.Substring(0, 8),
            SegmentId = "seg-a",
            ObservedSessionId = session,
            LapNumber = 1,
            StartedAtUtc = T0,
            EndedAtUtc = T0.AddSeconds(2),
            CurrentDriverName = driver,
            Complete = false,
            PitLap = true,
            RecordRevision = revision,
            Observation = observation ? built.Observation : null,
            Coverage = new MeasurementLapCoverageDto
            {
                Temperature = new MeasurementCoverageGroupDto { SampleCount = 4, ValidDurationSeconds = 2, MaxGapSeconds = 0.5 },
                Fuel = new MeasurementCoverageGroupDto { SampleCount = 4, ValidDurationSeconds = 2, MaxGapSeconds = 0.5 },
                Load = new MeasurementCoverageGroupDto { SampleCount = 4, ValidDurationSeconds = 2, MaxGapSeconds = 0.5 }
            },
            SampleCount = 4,
            MaxGapSeconds = 0.5,
            ValidDurationSeconds = 2,
            TrackTempCMean = 25,
            FuelStartLitres = 50,
            FuelEndLitres = 48.5
        };
    }

    private static ObservationLedgerCandidate Candidate(MeasurementLapSummaryRecord row,
        ObservationPairingBinding binding = null)
    {
        string diagnostic;
        var candidate = ObservationLedgerCandidate.TryCreate(row, binding ?? Binding(),
            T0.AddMinutes(1), out diagnostic);
        if (candidate == null) throw new InvalidOperationException("candidate: " + diagnostic);
        return candidate;
    }

    private static ObservationOfferedRow Obs(MeasurementLapSummaryRecord row,
        ObservationPairingBinding binding = null)
    {
        string diagnostic;
        var offered = ObservationOfferedRow.TryCreate(row.SummaryUid, row.RecordRevision,
            row.ToJson(), ObservationAckLane.Observation, binding ?? Binding(), out diagnostic);
        if (offered == null) throw new InvalidOperationException("offered obs: " + diagnostic);
        return offered;
    }

    private static ObservationOfferedRow Legacy(MeasurementLapSummaryRecord row)
    {
        string diagnostic;
        var offered = ObservationOfferedRow.TryCreate(row.SummaryUid, row.RecordRevision,
            row.ToJson(), ObservationAckLane.Legacy, null, out diagnostic);
        if (offered == null) throw new InvalidOperationException("offered legacy: " + diagnostic);
        return offered;
    }

    private static ObservationOfferedBatch Batch(params ObservationOfferedRow[] rows)
    {
        string diagnostic;
        var batch = ObservationOfferedBatch.TryCreate(rows, out diagnostic);
        if (batch == null) throw new InvalidOperationException("batch: " + diagnostic);
        return batch;
    }

    private static ObservationLedgerStore Store(string directory, ObservationBindingFence fence = null,
        ObservationLedgerOptions options = null, IObservationLedgerFileSystem files = null,
        IObservationLedgerFaults faults = null)
    {
        if (options == null) options = new ObservationLedgerOptions();
        options.Clock = delegate { return T0.AddMinutes(2); };
        return new ObservationLedgerStore(Path.Combine(directory, "observation-ledger-v1.json"),
            fence ?? new ObservationBindingFence(Binding()), options,
            files ?? new ObservationLedgerFileSystem(), faults ?? new NoObservationLedgerFaults());
    }

    private static string Ack(string laps, string events = null)
    {
        if (events == null)
            events = Series(true, 0, "[]", "[]", "[]", "[]", null);
        return "{\"measurements\":{\"events\":" + events + ",\"laps\":" + laps + "}}";
    }

    private static string Series(bool stored, int received, string accepted, string duplicates,
        string superseded, string rejected, string blockError)
    {
        return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
            + ",\"accepted\":" + accepted
            + ",\"duplicates\":" + duplicates
            + ",\"superseded\":" + superseded
            + ",\"rejected\":" + rejected
            + ",\"block_error\":" + (blockError == null ? "null" : "\"" + blockError + "\"")
            + ",\"stored\":" + (stored ? "true" : "false") + "}";
    }

    private static string Id(string uid, int revision)
    {
        return "{\"id\":\"" + uid + "\",\"record_revision\":" + revision.ToString(CultureInfo.InvariantCulture) + "}";
    }

    private static string Rejection(string uid, int? index, string reason)
    {
        var idJson = uid == null ? "null" : "\"" + uid + "\"";
        var indexJson = index.HasValue ? index.Value.ToString(CultureInfo.InvariantCulture) : "null";
        return "{\"id\":" + idJson + ",\"index\":" + indexJson
            + ",\"reason\":\"" + reason + "\",\"stage\":\"parser\"}";
    }

    private static Dictionary<string, object> Json(string path)
    {
        return MeasurementJson.DeserializeDictionary(File.ReadAllText(path, Utf8));
    }

    private static List<object> LedgerEntries(ObservationLedgerStore store)
    {
        return (List<object>)Json(store.Path)["entries"];
    }

    private static Dictionary<string, object> LedgerEntry(ObservationLedgerStore store, string uid)
    {
        foreach (var item in LedgerEntries(store))
        {
            var row = (Dictionary<string, object>)item;
            if (string.Equals((string)row["uid"], uid, StringComparison.OrdinalIgnoreCase)) return row;
        }
        return null;
    }

    private static double Counter(ObservationLedgerStore store, string name)
    {
        var counters = (Dictionary<string, object>)Json(store.Path)["counters"];
        return (double)counters[name];
    }

    private sealed class Faults : IObservationLedgerFaults
    {
        public int BeforeSwitchFailures;
        public int AfterSwitchFailures;
        public Action OnBeforeSwitch;

        public void BeforePreserve() { }

        public void BeforeSwitch()
        {
            if (OnBeforeSwitch != null) OnBeforeSwitch();
            if (BeforeSwitchFailures > 0) { BeforeSwitchFailures--; throw new IOException("switch injected"); }
        }

        public void AfterSwitch()
        {
            if (AfterSwitchFailures > 0) { AfterSwitchFailures--; throw new IOException("after switch injected"); }
        }
    }

    /// <summary>Na een geslaagde replace zet deze seam de oude targetbytes terug,
    /// zodat de na-switch-verzoening een geldige maar afwijkende snapshot ziet.</summary>
    private sealed class RollbackAfterSwitchFileSystem : IObservationLedgerFileSystem
    {
        private readonly IObservationLedgerFileSystem _inner;
        public RollbackAfterSwitchFileSystem(IObservationLedgerFileSystem inner) { _inner = inner; }
        public bool Exists(string path) { return _inner.Exists(path); }
        public long Length(string path) { return _inner.Length(path); }
        public byte[] ReadAllBytes(string path) { return _inner.ReadAllBytes(path); }
        public void WriteTemporary(string path, byte[] bytes) { _inner.WriteTemporary(path, bytes); }
        public void Delete(string path) { _inner.Delete(path); }
        public void Preserve(string source, string destination) { _inner.Preserve(source, destination); }
        public void Move(string temp, string target) { _inner.Move(temp, target); }
        public void Replace(string temp, string target, string backup)
        {
            var old = File.Exists(target) ? File.ReadAllBytes(target) : null;
            _inner.Replace(temp, target, backup);
            if (old != null) File.WriteAllBytes(target, old);
        }
    }

    private static bool AllRows(ObservationAckResolution resolution, ObservationAckClass outcome,
        string reasonCode = null)
    {
        foreach (var row in resolution.Rows)
        {
            if (row.Lane != ObservationAckLane.Observation) continue;
            if (row.Outcome != outcome) return false;
            if (reasonCode != null && !string.Equals(row.ReasonCode, reasonCode, StringComparison.Ordinal))
                return false;
        }
        return true;
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // --------------------------------------------------- accepted/replay
        var dir = NewDirectory();
        var store = Store(dir);
        var rowA = Row(Uid(1));
        var frozenA = rowA.ToJson();
        store.Capture(Candidate(rowA));
        var batchA = Batch(Obs(rowA));
        var acceptedA = Ack(Series(true, 1, "[" + Id(rowA.SummaryUid, 1) + "]", "[]", "[]", "[]", null));
        var resolutionA = ObservationAckResolver.Resolve(acceptedA, batchA, Binding());
        var appliedA = store.ApplyAck(resolutionA, T0.AddMinutes(3));
        var diskA = Json(store.Path);
        var diskAEntries = (List<object>)diskA["entries"];
        var diskACounters = (Dictionary<string, object>)diskA["counters"];
        var diskARootKeys = string.Join(",", diskA.Keys.OrderBy(x => x, StringComparer.Ordinal));
        Check("OA01 accepted met gelijke revisie is per rij Delivered en wordt in één snapshot verwijderd",
            resolutionA.HasMeasurements && resolutionA.SeriesStored
            && resolutionA.Rows.Count == 1
            && resolutionA.Rows[0].Outcome == ObservationAckClass.Accepted
            && resolutionA.Rows[0].Delivered && resolutionA.AllObservationsDelivered
            && appliedA.Status == ObservationAckApplyStatus.Applied
            && appliedA.DeliveredCount == 1 && appliedA.Stored && appliedA.DeliveredTotal == 1
            && store.EntryCount == 0 && diskAEntries.Count == 0
            && (double)diskACounters["deliveredTotal"] == 1
            && diskARootKeys == "counters,entries,savedAtUtc,version",
            "accepted=1 delivered=1 stored=" + appliedA.Stored + " total=" + appliedA.DeliveredTotal
            + " entries=" + store.EntryCount);

        var replayA = store.ApplyAck(resolutionA, T0.AddMinutes(4));
        Check("OA02 identieke replay is idempotent: geen teller, geen hercreatie en Stored nooit uit een lege lijst",
            replayA.Status == ObservationAckApplyStatus.NoChanges
            && replayA.DeliveredCount == 0 && !replayA.Stored
            && replayA.DeliveredTotal == 1 && store.EntryCount == 0
            && store.DeliveredTotal == 1
            && replayA.Rows.Count == 1
            && replayA.Rows[0].Durable == ObservationAckDurableOutcome.UnknownUid,
            "replay status=" + replayA.Status + " durable=" + replayA.Rows[0].Durable
            + " stored=" + replayA.Stored + " total=" + replayA.DeliveredTotal);

        // --------------------------------------- duplicate/superseded/revision
        var dirB = NewDirectory();
        var storeB = Store(dirB);
        var rowD = Row(Uid(2));
        storeB.Capture(Candidate(rowD));
        var dupRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[]", "[" + Id(rowD.SummaryUid, 1) + "]", "[]", "[]", null)),
            Batch(Obs(rowD)), Binding());
        var dupApply = storeB.ApplyAck(dupRes, T0.AddMinutes(3));
        Check("OA03 duplicate met gelijke revisie is Delivered en telt één keer",
            dupRes.Rows[0].Outcome == ObservationAckClass.Duplicate
            && dupApply.Status == ObservationAckApplyStatus.Applied && dupApply.Stored
            && dupApply.DeliveredCount == 1 && storeB.EntryCount == 0
            && storeB.DeliveredTotal == 1,
            "duplicate delivered=" + dupApply.DeliveredCount + " total=" + storeB.DeliveredTotal);

        var rowE = Row(Uid(3), revision: 2);
        storeB.Capture(Candidate(rowE));
        string duplicateDiagnostic;
        var duplicateBatch = ObservationOfferedBatch.TryCreate(
            new[] { Obs(rowE), Obs(rowE) }, out duplicateDiagnostic);
        Check("OA04 een dubbele UID in de aangeboden batch faalt gesloten vóór enige resolutie",
            duplicateBatch == null && duplicateDiagnostic == "duplicate_batch_uid",
            "batch=" + (duplicateBatch == null ? "null" : "gebouwd")
            + " diag=" + duplicateDiagnostic);

        var highResolution = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[]", "[]", "[" + Id(rowE.SummaryUid, 3) + "]", "[]", null)),
            Batch(Obs(rowE)), Binding());
        var highApply = storeB.ApplyAck(highResolution, T0.AddMinutes(3));
        Check("OA05 superseded met hogere revisie is Delivered",
            highResolution.Rows[0].Outcome == ObservationAckClass.Superseded
            && highResolution.Rows[0].AcknowledgedRevision == 3
            && highApply.Status == ObservationAckApplyStatus.Applied && highApply.Stored
            && storeB.EntryCount == 0 && storeB.DeliveredTotal == 2,
            "superseded rev=" + highResolution.Rows[0].AcknowledgedRevision
            + " total=" + storeB.DeliveredTotal);

        var rowE1 = Row(Uid(35), revision: 2);
        var storeE1 = Store(NewDirectory());
        storeE1.Capture(Candidate(rowE1));
        var equalSuperRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[]", "[]", "[" + Id(rowE1.SummaryUid, 2) + "]", "[]", null)),
            Batch(Obs(rowE1)), Binding());
        var equalSuperApply = storeE1.ApplyAck(equalSuperRes, T0.AddMinutes(3));
        Check("OA05b superseded met exact gelijke revisie is ook Delivered",
            equalSuperRes.Rows[0].Outcome == ObservationAckClass.Superseded
            && equalSuperRes.Rows[0].AcknowledgedRevision == 2
            && equalSuperApply.Status == ObservationAckApplyStatus.Applied
            && equalSuperApply.Stored && storeE1.EntryCount == 0
            && storeE1.DeliveredTotal == 1,
            "rev=" + equalSuperRes.Rows[0].AcknowledgedRevision
            + " total=" + storeE1.DeliveredTotal);

        var rowEdge = Row(Uid(36));
        var storeEdge = Store(NewDirectory());
        storeEdge.Capture(Candidate(rowEdge));
        var camelAck = "{\"id\":\"" + rowEdge.SummaryUid + "\",\"recordRevision\":1}";
        var edgeRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + camelAck + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowEdge)), Binding());
        var edgeApply = storeEdge.ApplyAck(edgeRes, T0.AddMinutes(3));
        var conflictAck = "{\"id\":\"" + rowEdge.SummaryUid
            + "\",\"record_revision\":1,\"recordRevision\":2}";
        var conflictRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + conflictAck + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowEdge)), Binding());
        Check("OA05c de echte Edge-camel `recordRevision` wordt gelezen; een conflicterende dubbele vorm blijft onbewezen",
            edgeRes.Rows[0].Outcome == ObservationAckClass.Accepted
            && edgeApply.Status == ObservationAckApplyStatus.Applied
            && edgeApply.Stored && storeEdge.EntryCount == 0
            && conflictRes.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && conflictRes.Rows[0].Diagnostic == "ack_revision_missing",
            "edge=" + edgeRes.Rows[0].Outcome + " conflict=" + conflictRes.Rows[0].Diagnostic);

        var rowF = Row(Uid(4), revision: 2);
        storeB.Capture(Candidate(rowF));
        var lowRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowF.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowF)), Binding());
        var lowApply = storeB.ApplyAck(lowRes, T0.AddMinutes(3));
        Check("OA06 lagere bevestigde revisie is NotDelivered en laat de nieuwere rij exact staan",
            lowRes.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && lowRes.Rows[0].Diagnostic == "ack_revision_lower"
            && lowApply.Status == ObservationAckApplyStatus.NoChanges && !lowApply.Stored
            && storeB.Find(rowF.SummaryUid, 2) != null
            && storeB.Find(rowF.SummaryUid, 2).RowJson == rowF.ToJson()
            && storeB.DeliveredTotal == 2,
            "lower diag=" + lowRes.Rows[0].Diagnostic + " total=" + storeB.DeliveredTotal);

        var rowG = Row(Uid(5));
        storeB.Capture(Candidate(rowG));
        var missingRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[\"" + rowG.SummaryUid + "\"]", "[]", "[]", "[]", null)),
            Batch(Obs(rowG)), Binding());
        var missingRevRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[{\"id\":\"" + rowG.SummaryUid + "\"}]", "[]", "[]", "[]", null)),
            Batch(Obs(rowG)), Binding());
        Check("OA07 ontbrekende record_revision (kale UID of object zonder veld) wordt nooit als succes gelezen",
            missingRes.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && missingRes.Rows[0].Diagnostic == "ack_revision_missing"
            && missingRevRes.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && missingRevRes.Rows[0].Diagnostic == "ack_revision_missing"
            && storeB.ApplyAck(missingRes, T0.AddMinutes(3)).Status == ObservationAckApplyStatus.NoChanges,
            "bare=" + missingRes.Rows[0].Diagnostic + " object=" + missingRevRes.Rows[0].Diagnostic);

        var badRevisionValues = new[] { "\"1\"", "1.5", "-1", "0", "100001", "1e20" };
        var badRevisionOk = true;
        foreach (var value in badRevisionValues)
        {
            var json = Ack(Series(true, 1,
                "[{\"id\":\"" + rowG.SummaryUid + "\",\"record_revision\":" + value + "}]",
                "[]", "[]", "[]", null));
            var result = ObservationAckResolver.Resolve(json, Batch(Obs(rowG)), Binding());
            if (result.Rows[0].Outcome != ObservationAckClass.NotDelivered
                || result.Rows[0].Diagnostic != "ack_revision_missing")
                badRevisionOk = false;
        }
        Check("OA08 fractionele, negatieve, nul-, overflow- en stringrevisies worden niet gecoerceerd",
            badRevisionOk && storeB.Find(rowG.SummaryUid, 1) != null && storeB.DeliveredTotal == 2,
            "zes ongeldige revisievormen blijven onbewezen; entry staat nog");

        // ------------------------------------------------- stored:false etc.
        var rowJ = Row(Uid(6));
        var storeC = Store(NewDirectory());
        storeC.Capture(Candidate(rowJ));
        var notStoredJson = Ack(Series(false, 1, "[" + Id(rowJ.SummaryUid, 1) + "]", "[]", "[]", "[]", "payload_too_large"));
        var notStored = ObservationAckResolver.Resolve(notStoredJson, Batch(Obs(rowJ)), Binding());
        var notStoredApply = storeC.ApplyAck(notStored, T0.AddMinutes(3));
        Check("OA09 stored:false is geen leveringsbewijs, ook niet met een accepted-lijst erbij",
            notStored.HasMeasurements && !notStored.SeriesStored
            && notStored.Diagnostic == "ack_not_stored"
            && AllRows(notStored, ObservationAckClass.NotDelivered)
            && notStoredApply.Status == ObservationAckApplyStatus.NoChanges
            && !notStoredApply.Stored && storeC.EntryCount == 1
            && storeC.DeliveredTotal == 0
            && notStoredApply.BlockErrorCode == "payload_too_large",
            "stored=false diag=" + notStored.Diagnostic + " block=" + notStoredApply.BlockErrorCode);

        var noLaps = ObservationAckResolver.Resolve("{\"measurements\":{}}", Batch(Obs(rowJ)), Binding());
        var badJson = ObservationAckResolver.Resolve("{not json", Batch(Obs(rowJ)), Binding());
        var noMeasurements = ObservationAckResolver.Resolve("{\"measurements\":null}", Batch(Obs(rowJ)), Binding());
        Check("OA10 geen laps-reeks, geen measurements en onparseerbare body leveren niets op",
            noLaps.Diagnostic == "ack_without_measurements"
            && badJson.Diagnostic == "ack_invalid"
            && noMeasurements.Diagnostic == "ack_without_measurements"
            && AllRows(noLaps, ObservationAckClass.NotDelivered)
            && AllRows(badJson, ObservationAckClass.NotDelivered)
            && storeC.EntryCount == 1 && storeC.DeliveredTotal == 0,
            "noLaps=" + noLaps.Diagnostic + " bad=" + badJson.Diagnostic);

        var hugeBlock = Ack(Series(false, 1, "[]", "[]", "[]", "[]",
            "SECRET_RAW_BODY_" + new string('x', 90) + "\\n"));
        var hugeResolution = ObservationAckResolver.Resolve(hugeBlock, Batch(Obs(rowJ)), Binding());
        var hugeApply = storeC.ApplyAck(hugeResolution, T0.AddMinutes(3));
        var ledgerText = File.ReadAllText(storeC.Path, Utf8);
        Check("OA11 een onbegrensde/onveilige block_error wordt één vaste korte code en belandt nooit in de ledger",
            hugeApply.BlockErrorCode == "ack_blocked"
            && ledgerText.IndexOf("SECRET_RAW_BODY", StringComparison.Ordinal) < 0
            && storeC.EntryCount == 1 && storeC.DeliveredTotal == 0,
            "block=" + hugeApply.BlockErrorCode + " ledgerBevatRaw=" + ledgerText.Contains("SECRET_RAW_BODY"));

        // -------------------------------------------------- mixed id/index
        var dirMix = NewDirectory();
        var storeMix = Store(dirMix);
        var rowMA = Row(Uid(11));
        var rowMB = Row(Uid(12), observation: false);
        var rowMC = Row(Uid(13));
        storeMix.Capture(Candidate(rowMA));
        storeMix.Capture(Candidate(rowMC));
        var legacyPath = Path.Combine(dirMix, "measurement-outbox.json");
        var legacyOutbox = new MeasurementOutbox(legacyPath);
        string reason;
        if (!legacyOutbox.EnqueueLap(rowMB, out reason))
            throw new InvalidOperationException("legacy enqueue: " + reason);
        var mixedBatch = Batch(Obs(rowMA), Legacy(rowMB), Obs(rowMC));
        var mixJson = Ack(Series(true, 3,
            "[" + Id(rowMA.SummaryUid, 1) + "," + Id(rowMC.SummaryUid, 1) + "]",
            "[]", "[]", "[" + Rejection(null, 1, "wear_after_contract") + "]", null));
        var mixResolution = ObservationAckResolver.Resolve(mixJson, mixedBatch, Binding());
        var mixApply = storeMix.ApplyAck(mixResolution, T0.AddMinutes(3));

        var fullOutboxBatch = new OutboxBatch();
        foreach (var offered in mixedBatch.Rows)
        {
            fullOutboxBatch.Laps.Add(new OutboxEntry
            {
                Uid = offered.Uid,
                Series = OutboxSeries.Laps,
                RecordRevision = offered.RecordRevision,
                RowJson = offered.RowJson,
                EnqueuedAtUtc = T0
            });
        }
        var legacyAck = MeasurementAckParser.Parse(mixJson, fullOutboxBatch);
        var legacyOutcome = legacyOutbox.ApplyAck(legacyAck, T0.AddMinutes(3));
        Check("OA12 mixed [OBS,legacy,OBS]: index 1 raakt alleen de legacy-rij en de twee OBS-rijen worden apart afgeleverd",
            mixResolution.Rows.Count == 3
            && mixResolution.Rows[0].Outcome == ObservationAckClass.Accepted
            && mixResolution.Rows[1].Lane == ObservationAckLane.Legacy
            && mixResolution.Rows[1].LegacyOutcome == ObservationLegacyAckClass.Rejected
            && mixResolution.Rows[2].Outcome == ObservationAckClass.Accepted
            && mixApply.Status == ObservationAckApplyStatus.Applied
            && mixApply.DeliveredCount == 2 && mixApply.Stored
            && storeMix.EntryCount == 0 && storeMix.DeliveredTotal == 2
            && !legacyOutbox.Contains(rowMB.SummaryUid)
            && legacyOutcome.RejectedLaps == 1 && legacyOutcome.ConfirmedLaps == 0,
            "obsDelivered=" + mixApply.DeliveredCount + " legacyRejected=" + legacyOutcome.RejectedLaps
            + " obsEntries=" + storeMix.EntryCount);

        // index 0 rejected observation, healthy legacy sibling is still applied.
        var dirMix2 = NewDirectory();
        var storeMix2 = Store(dirMix2);
        var rowNA = Row(Uid(21));
        var rowNB = Row(Uid(22), observation: false);
        var rowNC = Row(Uid(23));
        storeMix2.Capture(Candidate(rowNA));
        storeMix2.Capture(Candidate(rowNC));
        var outbox2 = new MeasurementOutbox(Path.Combine(dirMix2, "measurement-outbox.json"));
        if (!outbox2.EnqueueLap(rowNB, out reason))
            throw new InvalidOperationException("legacy enqueue2: " + reason);
        var batch2 = Batch(Obs(rowNA), Legacy(rowNB), Obs(rowNC));
        var json2 = Ack(Series(true, 3,
            "[" + Id(rowNB.SummaryUid, 1) + "," + Id(rowNC.SummaryUid, 1) + "]",
            "[]", "[]", "[" + Rejection(null, 0, "observation_invalid_timestamp") + "]", null));
        var res2 = ObservationAckResolver.Resolve(json2, batch2, Binding());
        var apply2 = storeMix2.ApplyAck(res2, T0.AddMinutes(3));
        var quarantinedA = storeMix2.Find(rowNA.SummaryUid, 1);
        var legacyBatch2 = new OutboxBatch();
        foreach (var offered in batch2.Rows)
        {
            legacyBatch2.Laps.Add(new OutboxEntry
            {
                Uid = offered.Uid, Series = OutboxSeries.Laps, RecordRevision = offered.RecordRevision,
                RowJson = offered.RowJson, EnqueuedAtUtc = T0
            });
        }
        var legacyOutcome2 = outbox2.ApplyAck(MeasurementAckParser.Parse(json2, legacyBatch2),
            T0.AddMinutes(3));
        Check("OA13 afwijzing op index 0 quarantineert alleen OBS_A; OBS_C en de gezonde legacy-rij gaan door",
            res2.Rows[0].Outcome == ObservationAckClass.Quarantined
            && res2.Rows[0].ReasonCode == "observation_invalid_timestamp"
            && res2.Rows[2].Outcome == ObservationAckClass.Accepted
            && apply2.Status == ObservationAckApplyStatus.Applied
            && apply2.DeliveredCount == 1 && !apply2.Stored
            && quarantinedA != null && quarantinedA.State == ObservationLedgerState.Quarantine
            && quarantinedA.Reason == ObservationLedgerReason.ObservationInvalidTimestamp
            && quarantinedA.RowJson == res2.Rows[0].Offered.RowJson
            && storeMix2.Find(rowNC.SummaryUid, 1) == null
            && storeMix2.DeliveredTotal == 1 && storeMix2.QuarantineTotal == 1
            && !outbox2.Contains(rowNB.SummaryUid) && legacyOutcome2.ConfirmedLaps == 1,
            "obsA=" + quarantinedA.State + " obsCwég=" + (storeMix2.Find(rowNC.SummaryUid, 1) == null)
            + " legacyConfirmed=" + legacyOutcome2.ConfirmedLaps + " stored=" + apply2.Stored);

        // index 2 rejected temporary observation with the real Edge path prefix.
        var rowPA = Row(Uid(31));
        var rowPB = Row(Uid(32), observation: false);
        var rowPC = Row(Uid(33));
        var storeMix3 = Store(NewDirectory());
        storeMix3.Capture(Candidate(rowPA));
        storeMix3.Capture(Candidate(rowPC));
        var batch3 = Batch(Obs(rowPA), Legacy(rowPB), Obs(rowPC));
        var json3 = Ack(Series(true, 3, "[" + Id(rowPA.SummaryUid, 1) + "]",
            "[]", "[]",
            "[" + Rejection(null, 2,
                "payload.lapSummaries[2].observation is unavailable") + "]", null));
        var res3 = ObservationAckResolver.Resolve(json3, batch3, Binding());
        var apply3 = storeMix3.ApplyAck(res3, T0.AddMinutes(3));
        var deferredC = storeMix3.Find(rowPC.SummaryUid, 1);
        var restarted3 = Store(Path.GetDirectoryName(storeMix3.Path));
        var resumedC = restarted3.Find(rowPC.SummaryUid, 1);
        Check("OA14 prefixreden op index 2 is Deferred met bounded backoff; restart behoudt poging en retrytijd",
            res3.Rows[2].Outcome == ObservationAckClass.Deferred
            && res3.Rows[2].ReasonCode == "observation_unavailable"
            && apply3.Status == ObservationAckApplyStatus.Applied
            && apply3.DeliveredCount == 1 && !apply3.Stored
            && deferredC != null && deferredC.State == ObservationLedgerState.Deferred
            && deferredC.Attempts == 1 && deferredC.NextAttemptUtc.HasValue
            && deferredC.NextAttemptUtc.Value > T0.AddMinutes(3)
            && deferredC.NextAttemptUtc.Value <= T0.AddMinutes(4)
            && deferredC.RowJson == res3.Rows[2].Offered.RowJson
            && resumedC != null && resumedC.State == ObservationLedgerState.Pending
            && resumedC.Attempts == 1
            && resumedC.NextAttemptUtc == deferredC.NextAttemptUtc,
            "deferred=" + deferredC.State + " attempts=" + deferredC.Attempts
            + " next=" + deferredC.NextAttemptUtc + " resumed=" + resumedC.State);

        // id/index conflict marks both rows ambiguous and touches neither.
        var rowQA = Row(Uid(41));
        var rowQB = Row(Uid(42), observation: false);
        var rowQC = Row(Uid(43));
        var storeMix4 = Store(NewDirectory());
        storeMix4.Capture(Candidate(rowQA));
        storeMix4.Capture(Candidate(rowQC));
        var batch4 = Batch(Obs(rowQA), Legacy(rowQB), Obs(rowQC));
        var json4 = Ack(Series(true, 3, "[" + Id(rowQA.SummaryUid, 1) + "," + Id(rowQC.SummaryUid, 1) + "]",
            "[]", "[]",
            "[" + Rejection(rowQC.SummaryUid, 0, "observation_null") + "]", null));
        var res4 = ObservationAckResolver.Resolve(json4, batch4, Binding());
        var apply4 = storeMix4.ApplyAck(res4, T0.AddMinutes(3));
        Check("OA15 id/index-conflict faalt gesloten voor beide betrokken rijen en raakt geen enkele entry",
            res4.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && res4.Rows[0].Diagnostic == "ack_index_id_conflict"
            && res4.Rows[2].Outcome == ObservationAckClass.NotDelivered
            && res4.Rows[2].Diagnostic == "ack_index_id_conflict"
            && apply4.Status == ObservationAckApplyStatus.NoChanges
            && storeMix4.EntryCount == 2 && storeMix4.DeliveredTotal == 0
            && storeMix4.QuarantineTotal == 0,
            "A=" + res4.Rows[0].Diagnostic + " C=" + res4.Rows[2].Diagnostic
            + " entries=" + storeMix4.EntryCount);

        // accepted + rejected for the same row is ambiguous, not a delivery.
        var rowRA = Row(Uid(51));
        var rowRC = Row(Uid(52));
        var storeMix5 = Store(NewDirectory());
        storeMix5.Capture(Candidate(rowRA));
        storeMix5.Capture(Candidate(rowRC));
        var batch5 = Batch(Obs(rowRA), Obs(rowRC));
        var json5 = Ack(Series(true, 2, "[" + Id(rowRA.SummaryUid, 1) + "," + Id(rowRC.SummaryUid, 1) + "]",
            "[]", "[]", "[" + Rejection(rowRA.SummaryUid, 0, "observation_null") + "]", null));
        var res5 = ObservationAckResolver.Resolve(json5, batch5, Binding());
        var apply5 = storeMix5.ApplyAck(res5, T0.AddMinutes(3));
        Check("OA16 tegenstrijdige ACK-besluiten (accepted én rejected) leveren geen cleanup en geen quarantaine",
            res5.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && res5.Rows[0].Diagnostic == "ack_conflicting_decisions"
            && res5.Rows[1].Outcome == ObservationAckClass.Accepted
            && apply5.DeliveredCount == 1 && !apply5.Stored
            && storeMix5.Find(rowRA.SummaryUid, 1) != null
            && storeMix5.Find(rowRC.SummaryUid, 1) == null
            && storeMix5.DeliveredTotal == 1 && storeMix5.QuarantineTotal == 0,
            "A=" + res5.Rows[0].Diagnostic + " deliveredC=" + apply5.DeliveredCount);

        // extra unknown IDs and out-of-range indexes cannot fabricate rows/counters.
        var rowSA = Row(Uid(61));
        var storeMix6 = Store(NewDirectory());
        storeMix6.Capture(Candidate(rowSA));
        var json6 = Ack(Series(true, 1,
            "[" + Id(rowSA.SummaryUid, 1) + "," + Id(Uid(62), 1) + "]",
            "[]", "[]",
            "[" + Rejection(Uid(63), 9, "observation_null") + "]", null));
        var res6 = ObservationAckResolver.Resolve(json6, Batch(Obs(rowSA)), Binding());
        var apply6 = storeMix6.ApplyAck(res6, T0.AddMinutes(3));
        Check("OA17 extra onbekende UID's en buiten-bereik-indexen geven alleen diagnose, nooit een entry of teller",
            res6.UnknownUids.Count == 2
            && res6.Diagnostics.Contains("ack_unknown_uid")
            && res6.Diagnostics.Contains("ack_index_out_of_range")
            && apply6.Status == ObservationAckApplyStatus.Applied
            && apply6.DeliveredCount == 1 && apply6.UnknownUidCount == 0
            && storeMix6.EntryCount == 0 && storeMix6.DeliveredTotal == 1,
            "unknown=" + res6.UnknownUids.Count + " total=" + storeMix6.DeliveredTotal);

        // ----------------------------------------------------- reason table
        var permanentCodes = new[]
        {
            "observation_device_mismatch", "observation_device_invalid", "auth_device_invalid",
            "observation_null", "observation_invalid", "row_invalid", "revision_conflict",
            "stale_revision", "observation_absent", "observation_invalid_version",
            "observation_invalid_type", "observation_invalid_integer",
            "observation_invalid_number", "observation_invalid_timestamp",
            "observation_invalid_uuid", "observation_invalid_text",
            "observation_invalid_control", "observation_invalid_enum"
        };
        var expectedTokens = new[]
        {
            "observation_device_mismatch", "observation_device_invalid", "auth_device_invalid",
            "observation_null", "observation_invalid", "row_invalid", "revision_conflict",
            "stale_revision", "observation_absent", "observation_invalid_version",
            "observation_invalid_type", "observation_invalid_integer",
            "observation_invalid_number", "observation_invalid_timestamp",
            "observation_invalid_uuid", "observation_invalid_text",
            "observation_invalid_control", "observation_invalid_enum"
        };
        var permanentRows = new List<MeasurementLapSummaryRecord>();
        var permanentBatchRows = new List<ObservationOfferedRow>();
        var rejections = new List<string>();
        for (var index = 0; index < permanentCodes.Length; index++)
        {
            var row = Row(Uid(100 + index));
            permanentRows.Add(row);
            permanentBatchRows.Add(Obs(row));
            rejections.Add(Rejection(row.SummaryUid, index, permanentCodes[index]));
        }
        var permanentJson = Ack(Series(true, permanentRows.Count, "[]", "[]", "[]",
            "[" + string.Join(",", rejections) + "]", null));
        var permanentRes = ObservationAckResolver.Resolve(permanentJson,
            Batch(permanentBatchRows.ToArray()), Binding());
        var permanentStore = Store(NewDirectory());
        foreach (var row in permanentRows) permanentStore.Capture(Candidate(row));
        var permanentApply = permanentStore.ApplyAck(permanentRes, T0.AddMinutes(3));
        var permanentTokensOk = true;
        for (var index = 0; index < permanentRes.Rows.Count; index++)
        {
            if (permanentRes.Rows[index].Outcome != ObservationAckClass.Quarantined
                || permanentRes.Rows[index].ReasonCode != expectedTokens[index])
                permanentTokensOk = false;
        }
        Check("OA18 alle vaste permanente codes worden Quarantined met de juiste lokale reden",
            permanentTokensOk && permanentApply.Status == ObservationAckApplyStatus.Applied
            && permanentApply.QuarantinedCount == permanentRows.Count
            && permanentApply.DeliveredCount == 0 && !permanentApply.Stored
            && permanentStore.EntryCount == permanentRows.Count
            && permanentStore.QuarantineTotal == permanentRows.Count
            && permanentStore.DeliveredTotal == 0,
            "tokensOk=" + permanentTokensOk + " quarantined=" + permanentApply.QuarantinedCount);

        var tempRows = new List<MeasurementLapSummaryRecord>();
        var tempRowsOffered = new List<ObservationOfferedRow>();
        var tempReasons = new[]
        {
            "observation_unavailable",
            "payload.lapSummaries[1].observation is unavailable",
            "lapSummaries[2].observation contains unknown fields"
        };
        var tempExpected = new[]
        {
            "observation_unavailable", "observation_unavailable", "contains_unknown_fields"
        };
        var tempRejections = new List<string>();
        for (var index = 0; index < tempReasons.Length; index++)
        {
            var row = Row(Uid(130 + index));
            tempRows.Add(row);
            tempRowsOffered.Add(Obs(row));
            tempRejections.Add(Rejection(row.SummaryUid, index, tempReasons[index]));
        }
        var tempRes = ObservationAckResolver.Resolve(
            Ack(Series(true, tempRows.Count, "[]", "[]", "[]",
                "[" + string.Join(",", tempRejections) + "]", null)),
            Batch(tempRowsOffered.ToArray()), Binding());
        var tempStore = Store(NewDirectory());
        foreach (var row in tempRows) tempStore.Capture(Candidate(row));
        var tempApply = tempStore.ApplyAck(tempRes, T0.AddMinutes(3));
        var tempTokensOk = true;
        for (var index = 0; index < tempRes.Rows.Count; index++)
        {
            if (tempRes.Rows[index].Outcome != ObservationAckClass.Deferred
                || tempRes.Rows[index].ReasonCode != tempExpected[index])
                tempTokensOk = false;
        }
        Check("OA19 tijdelijke redenen, ook met echt lapSummaries-padprefix, worden Deferred met lokale code",
            tempTokensOk && tempApply.DeferredCount == 3 && !tempApply.Stored
            && tempStore.EntryCount == 3 && tempStore.QuarantineTotal == 0
            && tempStore.Entries.All(x => x.State == ObservationLedgerState.Deferred),
            "deferred=" + tempApply.DeferredCount + " tokensOk=" + tempTokensOk);

        var unknownRows = new List<MeasurementLapSummaryRecord>();
        var unknownOffered = new List<ObservationOfferedRow>();
        var unknownReasons = new[] { "observation_invalid_bogus", "weird_new_code" };
        var unknownRejections = new List<string>();
        for (var index = 0; index < unknownReasons.Length; index++)
        {
            var row = Row(Uid(140 + index));
            unknownRows.Add(row);
            unknownOffered.Add(Obs(row));
            unknownRejections.Add(Rejection(row.SummaryUid, index, unknownReasons[index]));
        }
        var unknownRes = ObservationAckResolver.Resolve(
            Ack(Series(true, unknownRows.Count, "[]", "[]", "[]",
                "[" + string.Join(",", unknownRejections) + "]", null)),
            Batch(unknownOffered.ToArray()), Binding());
        var unknownStore = Store(NewDirectory());
        foreach (var row in unknownRows) unknownStore.Capture(Candidate(row));
        var unknownApply = unknownStore.ApplyAck(unknownRes, T0.AddMinutes(3));
        Check("OA20 onbekende en onbekende observation_invalid_*-suffixen worden één vaste Quarantine-code",
            AllRows(unknownRes, ObservationAckClass.Quarantined, "server_rejected_unknown")
            && unknownApply.QuarantinedCount == 2
            && unknownStore.QuarantineTotal == 2
            && unknownStore.Entries.All(x =>
                x.State == ObservationLedgerState.Quarantine
                && x.Reason == ObservationLedgerReason.ServerRejectedUnknown),
            "quarantined=" + unknownApply.QuarantinedCount);

        // ------------------------------------------------ binding/epoch fences
        var dirFence = NewDirectory();
        var fence = new ObservationBindingFence(Binding());
        var fenceStore = Store(dirFence, fence);
        var rowT = Row(Uid(71));
        fenceStore.Capture(Candidate(rowT));
        var batchT = Batch(Obs(rowT));
        var acceptTJson = Ack(Series(true, 1, "[" + Id(rowT.SummaryUid, 1) + "]", "[]", "[]", "[]", null));
        var acceptT = ObservationAckResolver.Resolve(acceptTJson, batchT, Binding());
        fence.Rebind(Binding(generation: 8));
        var staleApply = fenceStore.ApplyAck(acceptT, T0.AddMinutes(3));
        Check("OA21 een gewijzigde lokale binding vóór de ACK-commit weigert de hele toepassing zonder cleanup of teller",
            staleApply.Status == ObservationAckApplyStatus.RefusedStaleEpoch
            && staleApply.DeliveredCount == 0 && !staleApply.Stored
            && fenceStore.EntryCount == 1 && fenceStore.DeliveredTotal == 0
            && fenceStore.Find(rowT.SummaryUid, 1) != null
            && staleApply.Rows[0].Durable == ObservationAckDurableOutcome.NotDelivered,
            "status=" + staleApply.Status + " entries=" + fenceStore.EntryCount);

        var staleRestart = Store(dirFence, new ObservationBindingFence(Binding(generation: 8)));
        Check("OA21b herstart na een epochwissel laat de OBS-rij pending, bytegelijk en zonder teller",
            staleRestart.EntryCount == 1 && staleRestart.DeliveredTotal == 0
            && staleRestart.Find(rowT.SummaryUid, 1) != null
            && staleRestart.Find(rowT.SummaryUid, 1).State == ObservationLedgerState.Pending
            && staleRestart.Find(rowT.SummaryUid, 1).RowJson == rowT.ToJson(),
            "restartEntries=" + staleRestart.EntryCount
            + " total=" + staleRestart.DeliveredTotal);

        // Een epochwissel blokkeert alleen observation; de legacy-rij uit dezelfde
        // aangeboden batch houdt zijn eigen, bestaande pad.
        var dirLegacyEpoch = NewDirectory();
        var epochFence = new ObservationBindingFence(Binding());
        var epochStore = Store(dirLegacyEpoch, epochFence);
        var epochObs = Row(Uid(74));
        var epochLegacy = Row(Uid(75), observation: false);
        epochStore.Capture(Candidate(epochObs));
        var epochOutbox = new MeasurementOutbox(Path.Combine(dirLegacyEpoch, "measurement-outbox.json"));
        string epochReason;
        if (!epochOutbox.EnqueueLap(epochLegacy, out epochReason))
            throw new InvalidOperationException("legacy epoch enqueue: " + epochReason);
        var epochBatch = Batch(Obs(epochObs), Legacy(epochLegacy));
        var epochJson = Ack(Series(true, 2,
            "[" + Id(epochLegacy.SummaryUid, 1) + "]", "[]", "[]", "[]", null));
        var epochRes = ObservationAckResolver.Resolve(epochJson, epochBatch, Binding());
        epochFence.Rebind(Binding(generation: 8));
        var epochApply = epochStore.ApplyAck(epochRes, T0.AddMinutes(3));
        var epochOutboxBatch = new OutboxBatch();
        epochOutboxBatch.Laps.Add(new OutboxEntry
        {
            Uid = epochLegacy.SummaryUid, Series = OutboxSeries.Laps,
            RecordRevision = 1, RowJson = epochLegacy.ToJson(), EnqueuedAtUtc = T0
        });
        var epochLegacyApply = epochOutbox.ApplyAck(
            MeasurementAckParser.Parse(epochJson, epochOutboxBatch), T0.AddMinutes(3));
        Check("OA21c een epochwissel blokkeert OBS maar niet de gezonde legacy-rij uit dezelfde batch",
            epochApply.Status == ObservationAckApplyStatus.RefusedStaleEpoch
            && epochStore.EntryCount == 1 && epochStore.DeliveredTotal == 0
            && epochRes.Rows[1].LegacyOutcome == ObservationLegacyAckClass.Accepted
            && !epochOutbox.Contains(epochLegacy.SummaryUid)
            && epochLegacyApply.ConfirmedLaps == 1,
            "obs=" + epochApply.Status + " legacyConfirmed=" + epochLegacyApply.ConfirmedLaps);

        fence.Rebind(Binding());
        var sameContextApply = fenceStore.ApplyAck(acceptT, T0.AddMinutes(3));
        Check("OA22 een context-only wissel (zelfde binding, andere sessie-string) blokkeert de ACK niet",
            sameContextApply.Status == ObservationAckApplyStatus.Applied
            && sameContextApply.Stored && fenceStore.EntryCount == 0
            && fenceStore.DeliveredTotal == 1,
            "status=" + sameContextApply.Status);

        var rowU = Row(Uid(72));
        var staleOfferStore = Store(NewDirectory(), new ObservationBindingFence(Binding(generation: 8)));
        staleOfferStore.Capture(Candidate(rowU, Binding(generation: 8)));
        var staleOfferRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowU.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowU, Binding(generation: 7))), Binding(generation: 8));
        Check("OA23 een ACK voor een oudere aangeboden binding wordt per rij NotDelivered ondanks geldige serverlijst",
            staleOfferRes.Rows[0].Outcome == ObservationAckClass.NotDelivered
            && staleOfferRes.Rows[0].Diagnostic == "ack_stale_offer_binding"
            && !staleOfferRes.AllObservationsDelivered,
            "diag=" + staleOfferRes.Rows[0].Diagnostic);

        var incompleteRes = ObservationAckResolver.Resolve(acceptTJson, batchT,
            new ObservationPairingBinding(Device, Owner, 0, false));
        var incompleteStore = Store(NewDirectory(), new ObservationBindingFence(Binding()));
        var incompleteRow = Row(Uid(73));
        incompleteStore.Capture(Candidate(incompleteRow));
        var incompleteApply = incompleteStore.ApplyAck(incompleteRes, T0.AddMinutes(3));
        Check("OA24 een onvolledige/onbekende epoch is geen stille toestemming",
            incompleteRes.Diagnostic == "ack_binding_incomplete"
            && incompleteApply.Status == ObservationAckApplyStatus.RefusedStaleEpoch
            && incompleteStore.EntryCount == 1 && incompleteStore.DeliveredTotal == 0,
            "res=" + incompleteRes.Diagnostic + " apply=" + incompleteApply.Status);

        // ----------------------------------------------------- fault injection
        var dirFault = NewDirectory();
        var faults = new Faults();
        var faultStore = Store(dirFault, null, null, null, faults);
        var rowV = Row(Uid(81));
        faultStore.Capture(Candidate(rowV));
        var faultWait = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowV.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowV)), Binding());
        faults.BeforeSwitchFailures = 1;
        var beforeApply = faultStore.ApplyAck(faultWait, T0.AddMinutes(3));
        var beforeDisk = Counter(faultStore, "deliveredTotal");
        var beforeEntries = faultStore.EntryCount;
        var beforeTotal = faultStore.DeliveredTotal;
        var retryApply = faultStore.ApplyAck(faultWait, T0.AddMinutes(4));
        var restartedFault = Store(dirFault);
        Check("OA25 faal vóór de switch: schijf en geheugen blijven oud, daarna lukt dezelfde ACK en restart telt één",
            beforeApply.Status == ObservationAckApplyStatus.NotCommitted
            && beforeApply.DeliveredCount == 0 && beforeDisk == 0
            && beforeEntries == 1 && beforeTotal == 0
            && retryApply.Status == ObservationAckApplyStatus.Applied && retryApply.Stored
            && restartedFault.EntryCount == 0 && restartedFault.DeliveredTotal == 1,
            "before=" + beforeApply.Status + " delivered=" + beforeApply.DeliveredCount
            + " disk=" + beforeDisk + " entries=" + beforeEntries
            + " total=" + beforeTotal + " retry=" + retryApply.Status
            + " retryStored=" + retryApply.Stored + " restartEntries=" + restartedFault.EntryCount
            + " restartTotal=" + restartedFault.DeliveredTotal);

        var dirFault2 = NewDirectory();
        var faults2 = new Faults();
        var faultStore2 = Store(dirFault2, null, null, null, faults2);
        var rowW = Row(Uid(82));
        faultStore2.Capture(Candidate(rowW));
        var faultWait2 = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowW.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowW)), Binding());
        faults2.AfterSwitchFailures = 1;
        var afterApply = faultStore2.ApplyAck(faultWait2, T0.AddMinutes(3));
        var restartedFault2 = Store(dirFault2);
        Check("OA26 faal ná de switch: volledige snapshotverzoening bevestigt de levering en telt exact één keer",
            afterApply.Status == ObservationAckApplyStatus.Applied && afterApply.Stored
            && afterApply.DeliveredCount == 1
            && restartedFault2.EntryCount == 0 && restartedFault2.DeliveredTotal == 1,
            "after=" + afterApply.Status + " restartTotal=" + restartedFault2.DeliveredTotal);

        var dirFault3 = NewDirectory();
        var faults3 = new Faults();
        var rollbackFiles = new RollbackAfterSwitchFileSystem(new ObservationLedgerFileSystem());
        var faultStore3 = Store(dirFault3, null, null, rollbackFiles, faults3);
        var rowX = Row(Uid(83));
        faultStore3.Capture(Candidate(rowX));
        var faultWait3 = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowX.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowX)), Binding());
        faults3.AfterSwitchFailures = 1;
        var mismatchApply = faultStore3.ApplyAck(faultWait3, T0.AddMinutes(3));
        var restartedFault3 = Store(dirFault3);
        Check("OA27 onverzoenbare na-switch-toestand faalt gesloten/non-definitief zonder tweede fallback",
            mismatchApply.Status == ObservationAckApplyStatus.Uncertain
            && !mismatchApply.Stored && mismatchApply.DeliveredCount == 0
            && faultStore3.IsFailedClosed
            && restartedFault3.EntryCount == 1 && restartedFault3.DeliveredTotal == 0,
            "status=" + mismatchApply.Status + " failedClosed=" + faultStore3.IsFailedClosed
            + " restartEntries=" + restartedFault3.EntryCount);

        var dirRace = NewDirectory();
        var raceFence = new ObservationBindingFence(Binding());
        var raceFaults = new Faults();
        var raceStore = Store(dirRace, raceFence, null, null, raceFaults);
        var rowY = Row(Uid(84));
        raceStore.Capture(Candidate(rowY));
        var raceRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowY.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowY)), Binding());
        raceFaults.OnBeforeSwitch = delegate { raceFence.Rebind(Binding(generation: 9)); };
        var raceApply = raceStore.ApplyAck(raceRes, T0.AddMinutes(3));
        Check("OA28 een rebind precies vóór de switch wordt door de laatste fence-check tegengehouden",
            raceApply.Status == ObservationAckApplyStatus.RefusedStaleEpoch
            && raceStore.EntryCount == 1 && raceStore.DeliveredTotal == 0
            && Counter(raceStore, "deliveredTotal") == 0,
            "race=" + raceApply.Status + " entries=" + raceStore.EntryCount);

        // ------------------------------------------------------- quota/counters
        var dirQuota = NewDirectory();
        var quotaStore = Store(dirQuota);
        var quotaRows = new List<MeasurementLapSummaryRecord>();
        for (var index = 0; index < 64; index++)
        {
            var row = Row(Uid(200 + index));
            quotaRows.Add(row);
            var captured = quotaStore.Capture(Candidate(row));
            if (!captured.Captured) throw new InvalidOperationException("quota fixture capture faalde");
        }
        for (var index = 0; index < 5; index++)
        {
            var entry = quotaStore.Entries[index];
            quotaStore.Quarantine(entry.Uid, entry.RecordRevision,
                ObservationLedgerReasons.ObservationInvalidTimestamp);
        }
        var deferredEntry = quotaStore.Entries[5];
        quotaStore.Defer(deferredEntry.Uid, deferredEntry.RecordRevision,
            ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(1), T0.AddMinutes(2));
        deferredEntry = quotaStore.Find(deferredEntry.Uid, deferredEntry.RecordRevision);
        var batchDeliver = Batch(Obs(quotaRows[10]), Obs(quotaRows[11]));
        var ackDeliver = Ack(Series(true, 2,
            "[" + Id(quotaRows[10].SummaryUid, 1) + "," + Id(quotaRows[11].SummaryUid, 1) + "]",
            "[]", "[]", "[]", null));
        var quotaResolution = ObservationAckResolver.Resolve(ackDeliver, batchDeliver, Binding());
        var quotaApply = quotaStore.ApplyAck(quotaResolution, T0.AddMinutes(3));
        var deferredAfter = quotaStore.Find(deferredEntry.Uid, deferredEntry.RecordRevision);
        Check("OA29 een batchverwijdering raakt geen andere quarantaine/deferred-state en houdt de quota-grens",
            quotaApply.Status == ObservationAckApplyStatus.Applied
            && quotaApply.DeliveredCount == 2 && quotaApply.Stored
            && quotaStore.EntryCount == 62 && quotaStore.DeliveredTotal == 2
            && quotaStore.QuarantineTotal == 5
            && deferredAfter != null && deferredAfter.State == ObservationLedgerState.Deferred
            && deferredAfter.Attempts == deferredEntry.Attempts
            && deferredAfter.NextAttemptUtc == deferredEntry.NextAttemptUtc,
            "entries=" + quotaStore.EntryCount + " delivered=" + quotaStore.DeliveredTotal
            + " quarantine=" + quotaStore.QuarantineTotal);

        var deferredTarget = quotaStore.Find(deferredEntry.Uid, deferredEntry.RecordRevision);
        var quarantineDeferred = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[]", "[]", "[]",
                "[" + Rejection(deferredTarget.Uid, null, "observation_null") + "]", null)),
            Batch(Obs(quotaRows[5])), Binding());
        var quotaQuarantineApply = quotaStore.ApplyAck(quarantineDeferred, T0.AddMinutes(3));
        Check("OA30 full-quota Deferred→Quarantine blijft binnen 64 en maakt geen ruimte vrij",
            quotaQuarantineApply.Status == ObservationAckApplyStatus.Applied
            && quotaQuarantineApply.QuarantinedCount == 1
            && quotaStore.EntryCount == 62 && quotaStore.QuarantineTotal == 6
            && quotaStore.Find(deferredTarget.Uid, deferredTarget.RecordRevision).State
                == ObservationLedgerState.Quarantine,
            "quarantined=" + quotaQuarantineApply.QuarantinedCount
            + " entries=" + quotaStore.EntryCount);

        // first fill the two freed slots, then prove the 65th is still refused.
        var afterQuotaCapture = quotaStore.Capture(Candidate(Row(Uid(300))));
        if (!afterQuotaCapture.Captured) throw new InvalidOperationException("vrije quotum-slot niet bruikbaar");
        quotaStore.Capture(Candidate(Row(Uid(301))));
        var overflowRow = Row(Uid(302));
        var overflowCapture = quotaStore.Capture(Candidate(overflowRow));
        Check("OA31 na de ACK-verwijdering blijft de harde 64-grens gelden (geen 65e entry)",
            overflowCapture.Status == ObservationLedgerCaptureStatus.RefusedQuota
            && quotaStore.EntryCount == 64,
            "capture=" + overflowCapture.Status + " entries=" + quotaStore.EntryCount);

        var dirCounter = NewDirectory();
        var counterStore = Store(dirCounter);
        var counterRow = Row(Uid(400));
        counterStore.Capture(Candidate(counterRow));
        var deliveredField = typeof(ObservationLedgerStore).GetField("_deliveredTotal",
            BindingFlags.NonPublic | BindingFlags.Instance);
        deliveredField.SetValue(counterStore, int.MaxValue);
        var overflowResolution = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(counterRow.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(counterRow)), Binding());
        var counterOverflow = counterStore.ApplyAck(overflowResolution, T0.AddMinutes(3));
        Check("OA32 een verzadigde deliveredTotal weigert de verwijdering in plaats van ongecount af te leveren",
            counterOverflow.Status == ObservationAckApplyStatus.RefusedCounterOverflow
            && counterStore.EntryCount == 1
            && counterOverflow.DeliveredTotal == int.MaxValue,
            "status=" + counterOverflow.Status + " total=" + counterOverflow.DeliveredTotal);

        // ------------------------------------------- stale original offer/revision
        var dirStale = NewDirectory();
        var staleStore = Store(dirStale);
        var rowZ2 = Row(Uid(500), revision: 2);
        staleStore.Capture(Candidate(rowZ2));
        var rowZ1 = Row(Uid(500), revision: 1);
        var oldBatch = Batch(Obs(rowZ1));
        var oldAck = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowZ1.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            oldBatch, Binding());
        var oldApply = staleStore.ApplyAck(oldAck, T0.AddMinutes(3));
        Check("OA33 een vertraagd ACK van de oude offer-revisie raakt de nieuwere lokale revisie niet",
            oldApply.Status == ObservationAckApplyStatus.NoChanges
            && oldApply.Rows[0].Durable == ObservationAckDurableOutcome.UnknownUid
            && staleStore.EntryCount == 1 && staleStore.DeliveredTotal == 0
            && staleStore.Find(rowZ2.SummaryUid, 2).RowJson == rowZ2.ToJson(),
            "status=" + oldApply.Status + " durable=" + oldApply.Rows[0].Durable);

        var correctAck = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(rowZ2.SummaryUid, 2) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(rowZ2)), Binding());
        var correctApply = staleStore.ApplyAck(correctAck, T0.AddMinutes(3));
        Check("OA34 de juiste revisie verwijdert alleen die ene entry en telt één keer",
            correctApply.Status == ObservationAckApplyStatus.Applied && correctApply.Stored
            && staleStore.EntryCount == 0 && staleStore.DeliveredTotal == 1,
            "total=" + staleStore.DeliveredTotal);

        var dirPayload = NewDirectory();
        var payloadStore = Store(dirPayload);
        var payloadRow = Row(Uid(501), driver: "Origineel");
        payloadStore.Capture(Candidate(payloadRow));
        var payloadVariant = Row(Uid(501), driver: "Andere Coureur");
        var payloadResolution = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(payloadRow.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(payloadVariant)), Binding());
        var payloadApply = payloadStore.ApplyAck(payloadResolution, T0.AddMinutes(3));
        Check("OA35 dezelfde UID/revisie met andere RowJson-bytes wordt IdentityConflict en verwijdert niets",
            payloadApply.Status == ObservationAckApplyStatus.NoChanges
            && payloadApply.Rows[0].Durable == ObservationAckDurableOutcome.IdentityConflict
            && payloadStore.EntryCount == 1
            && payloadStore.Find(payloadRow.SummaryUid, 1).RowJson == payloadRow.ToJson()
            && payloadStore.DeliveredTotal == 0,
            "durable=" + payloadApply.Rows[0].Durable);

        var dirTwoRev = NewDirectory();
        var twoRevStore = Store(dirTwoRev);
        var twoRev1 = Row(Uid(502), revision: 1);
        var twoRev2 = Row(Uid(502), revision: 2);
        twoRevStore.Capture(Candidate(twoRev1));
        twoRevStore.Capture(Candidate(twoRev2));
        var twoRevAck = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(twoRev1.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(twoRev1)), Binding());
        var twoRevApply = twoRevStore.ApplyAck(twoRevAck, T0.AddMinutes(3));
        Check("OA36 bij twee lokale revisies verdwijnt alleen de bevestigde revisie; de andere blijft bytegelijk",
            twoRevApply.Status == ObservationAckApplyStatus.Applied
            && twoRevStore.Find(twoRev1.SummaryUid, 1) == null
            && twoRevStore.Find(twoRev1.SummaryUid, 2) != null
            && twoRevStore.Find(twoRev1.SummaryUid, 2).RowJson == twoRev2.ToJson()
            && twoRevStore.DeliveredTotal == 1,
            "entries=" + twoRevStore.EntryCount + " total=" + twoRevStore.DeliveredTotal);

        // ------------------------------------------------- per-row Stored union
        var dirUnion = NewDirectory();
        var unionStore = Store(dirUnion);
        var unionA = Row(Uid(601));
        var unionB = Row(Uid(602));
        unionStore.Capture(Candidate(unionA));
        unionStore.Capture(Candidate(unionB));
        var unionBatch = Batch(Obs(unionA), Obs(unionB));
        var partialAck = ObservationAckResolver.Resolve(
            Ack(Series(true, 2, "[" + Id(unionA.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            unionBatch, Binding());
        var partialApply = unionStore.ApplyAck(partialAck, T0.AddMinutes(3));
        Check("OA37 Stored is per rij: één geleverde en één niet-genoemde OBS-rij maakt Stored false",
            partialAck.Rows[1].Outcome == ObservationAckClass.NotDelivered
            && partialAck.Rows[1].Diagnostic == "ack_row_not_mentioned"
            && partialApply.Status == ObservationAckApplyStatus.Applied
            && partialApply.DeliveredCount == 1 && !partialApply.Stored
            && unionStore.EntryCount == 1 && unionStore.DeliveredTotal == 1,
            "stored=" + partialApply.Stored + " delivered=" + partialApply.DeliveredCount
            + " entries=" + unionStore.EntryCount);

        var completeAck = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(unionB.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(unionB)), Binding());
        var completeApply = unionStore.ApplyAck(completeAck, T0.AddMinutes(3));
        Check("OA38 de resterende rij levert daarna alsnog Stored true zonder dubbel te tellen",
            completeApply.Status == ObservationAckApplyStatus.Applied && completeApply.Stored
            && unionStore.EntryCount == 0 && unionStore.DeliveredTotal == 2,
            "total=" + unionStore.DeliveredTotal);

        var legacyOnlyRow = Row(Uid(603), observation: false);
        var legacyOnlyBatch = Batch(Legacy(legacyOnlyRow));
        var legacyOnlyRes = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(legacyOnlyRow.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            legacyOnlyBatch, Binding());
        Check("OA39 een batch zonder OBS-rijen claimt nooit Observation-Stored",
            legacyOnlyRes.HasObservationRows == false
            && legacyOnlyRes.AllObservationsDelivered == false
            && !legacyOnlyRes.Rows[0].Delivered,
            "hasObs=" + legacyOnlyRes.HasObservationRows);

        // ------------------------------------------------ quarantine terminal
        var dirTerm = NewDirectory();
        var termStore = Store(dirTerm);
        var termRow = Row(Uid(701));
        termStore.Capture(Candidate(termRow));
        var termQuarantine = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[]", "[]", "[]",
                "[" + Rejection(termRow.SummaryUid, null, "observation_null") + "]", null)),
            Batch(Obs(termRow)), Binding());
        termStore.ApplyAck(termQuarantine, T0.AddMinutes(3));
        var termAfter = termStore.Find(termRow.SummaryUid, 1);
        var termAccept = ObservationAckResolver.Resolve(
            Ack(Series(true, 1, "[" + Id(termRow.SummaryUid, 1) + "]", "[]", "[]", "[]", null)),
            Batch(Obs(termRow)), Binding());
        var termApply = termStore.ApplyAck(termAccept, T0.AddMinutes(4));
        Check("OA40 quarantaine is terminaal: een later accepted-ACK verwijdert hem niet en telt niet",
            termAfter != null && termAfter.State == ObservationLedgerState.Quarantine
            && termApply.Status == ObservationAckApplyStatus.NoChanges
            && termApply.Rows[0].Durable == ObservationAckDurableOutcome.QuarantineTerminal
            && termStore.EntryCount == 1 && termStore.DeliveredTotal == 0
            && termStore.QuarantineTotal == 1
            && termStore.Find(termRow.SummaryUid, 1).RowJson == termRow.ToJson(),
            "durable=" + termApply.Rows[0].Durable + " entries=" + termStore.EntryCount);

        var termRestart = Store(dirTerm);
        Check("OA40b herstart behoudt quarantaine, reden, teller en exacte rowJson",
            termRestart.EntryCount == 1 && termRestart.QuarantineTotal == 1
            && termRestart.DeliveredTotal == 0
            && termRestart.Find(termRow.SummaryUid, 1) != null
            && termRestart.Find(termRow.SummaryUid, 1).State == ObservationLedgerState.Quarantine
            && termRestart.Find(termRow.SummaryUid, 1).Reason
                == ObservationLedgerReason.ObservationNull
            && termRestart.Find(termRow.SummaryUid, 1).RowJson == termRow.ToJson(),
            "restartQuarantine=" + termRestart.QuarantineTotal
            + " entries=" + termRestart.EntryCount);

        // ------------------------------------------------------- API shape/proof
        var publicMethods = typeof(ObservationLedgerStore).GetMethods(BindingFlags.Public
            | BindingFlags.Instance | BindingFlags.DeclaredOnly);
        var hasDeleteShortcut = publicMethods.Any(method =>
            method.Name.IndexOf("Delete", StringComparison.OrdinalIgnoreCase) >= 0
            || method.Name.IndexOf("MarkDelivered", StringComparison.OrdinalIgnoreCase) >= 0);
        var applyMethod = typeof(ObservationLedgerStore).GetMethod("ApplyAck",
            new[] { typeof(ObservationAckResolution), typeof(DateTime) });
        var resolutionCtor = typeof(ObservationAckResolution).GetConstructors(
            BindingFlags.Public | BindingFlags.Instance);
        Check("OA41 de publieke API eist een opgeloste batch/epoch en heeft geen generieke delete/markDelivered-shortcut",
            !hasDeleteShortcut && applyMethod != null
            && resolutionCtor.Length == 0,
            "deleteShortcut=" + hasDeleteShortcut + " applyMethod=" + (applyMethod != null)
            + " publicResolutionCtors=" + resolutionCtor.Length);

        var dirToken = NewDirectory();
        var tokenStore = Store(dirToken);
        var tokenRow = Row(Uid(801));
        tokenStore.Capture(Candidate(tokenRow));
        var tokenAck = Ack(Series(true, 1, "[" + Id(tokenRow.SummaryUid, 1) + "]", "[]", "[]", "[]", null));
        var tokenJson = tokenAck.Substring(0, tokenAck.Length - 1)
            + ",\"token\":\"SECRET_TOKEN_NEVER_PERSISTED\"}";
        var tokenRes = ObservationAckResolver.Resolve(tokenJson, Batch(Obs(tokenRow)), Binding());
        tokenStore.ApplyAck(tokenRes, T0.AddMinutes(3));
        var tokenLedger = File.ReadAllText(tokenStore.Path, Utf8);
        Check("OA42 een token/credential in de ACK-body belandt nooit in ledger, log of RowJson",
            tokenLedger.IndexOf("SECRET_TOKEN_NEVER_PERSISTED", StringComparison.Ordinal) < 0,
            "ledgerBevatToken=" + tokenLedger.Contains("SECRET_TOKEN_NEVER_PERSISTED"));

        return count;
    }
}
