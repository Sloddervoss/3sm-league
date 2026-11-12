using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// T13-S2C1 — durable observation ledger. Every successful path writes a real file
// under an isolated temporary directory; there is no APPDATA, network or SDK use.
internal static class MeasurementObservationLedgerTests
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

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(),
            "3sm-observation-ledger-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static MeasurementLapSummaryRecord Row(string uid, string driverName = "Test Driver",
        string session = "session-a", string device = Device, int revision = 1, string contextKey = "ctx-a")
    {
        var context = new ObservationLapContext("car-1", 123, "Test Track", "Grand Prix", 42, 3);
        var samples = new List<ObservationSample>
        {
            new ObservationSample(T0, true, 50.0, driverName, contextKey),
            new ObservationSample(T0.AddMilliseconds(500), false, 49.5, driverName, contextKey),
            new ObservationSample(T0.AddMilliseconds(1000), false, 49.0, driverName, contextKey),
            new ObservationSample(T0.AddMilliseconds(1500), true, 48.5, driverName, contextKey)
        };
        var observation = ObservationCapture.Build(Binding(device), context, samples,
            T0, T0.AddMilliseconds(2000));
        if (!observation.HasObservation) throw new InvalidOperationException(
            "testfixture bouwde geen observation: " + observation.Code);
        return new MeasurementLapSummaryRecord
        {
            SummaryUid = uid,
            SummaryId = "summary-" + uid.Substring(0, 8),
            SegmentId = "seg-a",
            ObservedSessionId = session,
            LapNumber = 1,
            StartedAtUtc = T0,
            EndedAtUtc = T0.AddSeconds(2),
            CurrentDriverName = driverName,
            Complete = false,
            PitLap = true,
            RecordRevision = revision,
            Observation = observation.Observation,
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

    private sealed class Faults : IObservationLedgerFaults
    {
        public int PreserveFailures;
        public int BeforeSwitchFailures;
        public int AfterSwitchFailures;
        public Action OnBeforeSwitch;

        public void BeforePreserve()
        {
            if (PreserveFailures > 0) { PreserveFailures--; throw new IOException("preserve injected"); }
        }

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

    private sealed class WrappedFileSystem : IObservationLedgerFileSystem
    {
        private readonly IObservationLedgerFileSystem _inner;
        public bool ThrowBeforeReplace;
        public WrappedFileSystem(IObservationLedgerFileSystem inner) { _inner = inner; }
        public bool Exists(string path) { return _inner.Exists(path); }
        public long Length(string path) { return _inner.Length(path); }
        public byte[] ReadAllBytes(string path) { return _inner.ReadAllBytes(path); }
        public void WriteTemporary(string path, byte[] bytes) { _inner.WriteTemporary(path, bytes); }
        public void Delete(string path) { _inner.Delete(path); }
        public void Preserve(string source, string destination)
        {
            _inner.Preserve(source, destination);
        }
        public void Move(string temp, string target)
        {
            if (ThrowBeforeReplace) throw new IOException("move before switch");
            _inner.Move(temp, target);
        }
        public void Replace(string temp, string target, string backup)
        {
            if (ThrowBeforeReplace) throw new IOException("replace before switch");
            _inner.Replace(temp, target, backup);
        }
    }

    private static Dictionary<string, object> Json(string path)
    {
        return MeasurementJson.DeserializeDictionary(File.ReadAllText(path, Utf8));
    }

    private static string Uid()
    {
        return Guid.NewGuid().ToString("D");
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // ------------------------------------------------------ real capture/file
        var dir = NewDirectory();
        var store = Store(dir);
        var row = Row(Uid());
        var frozen = row.ToJson();
        var candidate = Candidate(row);
        var capture = store.Capture(candidate);
        var ledgerPath = store.Path;
        var onDisk = Json(ledgerPath);
        var onDiskEntries = (List<object>)onDisk["entries"];
        var onDiskEntry = (Dictionary<string, object>)onDiskEntries[0];
        Check("OL01", capture.Status == ObservationLedgerCaptureStatus.Captured && capture.Captured
            && store.EntryCount == 1 && File.Exists(ledgerPath)
            && (string)onDiskEntry["rowJson"] == frozen
            && (string)onDiskEntry["state"] == "pending"
            && (string)onDiskEntry["uid"] == candidate.Uid
            && (double)onDiskEntry["recordRevision"] == 1
            && (string)onDiskEntry["captureDeviceId"] == Device
            && (string)onDiskEntry["captureOwnerUserId"] == Owner
            && (double)onDiskEntry["pairingGeneration"] == 7
            && onDiskEntry["reason"] == null,
            "echte file bevat exact de eenmalige serializerbytes en de bevroren binding");

        var idempotent = store.Capture(candidate);
        Check("OL02", idempotent.Status == ObservationLedgerCaptureStatus.AlreadyCaptured
            && store.EntryCount == 1 && store.ReservationCount == 0
            && store.ActualBytes == capture.ActualBytes && store.ReservedBytes == capture.ReservedBytes,
            "zelfde identiteit en payload is idempotent zonder dubbel budget");

        var conflicting = Candidate(Row(candidate.Uid, "Andere Coureur"));
        var conflict = store.Capture(conflicting);
        Check("OL03", conflict.Status == ObservationLedgerCaptureStatus.RefusedConflict
            && store.EntryCount == 1
            && store.Find(candidate.Uid, 1).RowJson == frozen
            && Json(ledgerPath) != null,
            "zelfde identiteit met andere payload wordt geweigerd en overschrijft niets");

        // Mutable source row after candidate: candidate owns a frozen string.
        var mutableRow = Row(Uid());
        var mutableCandidate = Candidate(mutableRow);
        var mutableFrozen = mutableCandidate.RowJson;
        mutableRow.SummaryUid = Uid();
        mutableRow.RecordRevision = 9;
        mutableRow.CurrentDriverName = "Gewijzigd";
        mutableRow.Observation = null;
        Check("OL04", mutableCandidate.RowJson == mutableFrozen
            && store.Capture(mutableCandidate).Captured
            && store.Find(mutableCandidate.Uid, 1).RowJson == mutableFrozen,
            "candidate is een defensieve freeze; een mutatie van de bronrij lekt niet door");

        string diagnostic;
        var mismatch = ObservationLedgerCandidate.TryCreate(Row(Uid()), Binding(OtherDevice),
            T0, out diagnostic);
        Check("OL05", mismatch == null && diagnostic == "observation_device_mismatch",
            "typed factory weigert een device dat niet bij de echte row hoort (" + diagnostic + ")");

        var noObservation = Row(Uid());
        noObservation.Observation = null;
        var missing = ObservationLedgerCandidate.TryCreate(noObservation, Binding(), T0,
            out diagnostic);
        var badRevision = Row(Uid());
        badRevision.RecordRevision = 0;
        var zero = ObservationLedgerCandidate.TryCreate(badRevision, Binding(), T0,
            out diagnostic);
        var unknownGeneration = ObservationLedgerCandidate.TryCreate(Row(Uid()),
            new ObservationPairingBinding(Device, Owner, 0, false), T0, out diagnostic);
        Check("OL05b", missing == null && zero == null && unknownGeneration == null,
            "factory weigert een rij zonder observation, een ongeldige revisie en een onbekende generatie");

        // Positive control: a second distinct row is visibly captured.
        var second = store.Capture(Candidate(Row(Uid())));
        Check("OL06", second.Captured && store.EntryCount == 3
            && store.Entries.Count(x => x.State == ObservationLedgerState.Pending) == 3,
            "twee verschillende rijen staan zichtbaar naast elkaar (geen weiger-alles-store); status="
            + second.Status + " diag=" + second.Diagnostic + " count=" + store.EntryCount);

        // ------------------------------------------------------------ restart
        var restarted = Store(dir);
        var restartedEntry = restarted.Find(candidate.Uid, 1);
        Check("OL07", restarted.EntryCount == 3 && restartedEntry != null
            && restartedEntry.RowJson == frozen
            && restartedEntry.CaptureDeviceId == Device
            && restarted.DeliveredTotal == 0,
            "herstart leest dezelfde UID/revisie/rowJson/binding; delivered blijft nul");

        // ---------------------------------------------------------- 64 entries
        var quotaDir = NewDirectory();
        var quotaStore = Store(quotaDir);
        var accepted = 0;
        ObservationLedgerCaptureResult last = null;
        var acceptedUids = new List<string>();
        for (var index = 0; index < 64; index++)
        {
            var quotaRow = Row(Uid());
            acceptedUids.Add(quotaRow.SummaryUid.ToLowerInvariant());
            last = quotaStore.Capture(Candidate(quotaRow));
            if (last.Captured && last.Status == ObservationLedgerCaptureStatus.Captured) accepted++;
        }
        var refusedRow = Row(Uid());
        var refused = quotaStore.Capture(Candidate(refusedRow));
        var quotaReload = Store(quotaDir);
        Check("OL08", accepted == 64 && quotaStore.EntryCount == 64
            && refused.Status == ObservationLedgerCaptureStatus.RefusedQuota
            && refused.ReasonCode == ObservationLedgerReasons.ObservationCaptureRefused
            && refused.CounterPersisted
            && quotaReload.EntryCount == 64 && quotaReload.CaptureRefused == 1
            && quotaReload.Find(refusedRow.SummaryUid, 1) == null,
            "64 geaccepteerd, 65e zichtbaar geweigerd en de teller overleeft herstart");

        // Mixed states share the same 64/1 MiB budget.
        for (var index = 0; index < 20; index++)
        {
            var entry = quotaStore.Entries[index];
            var transition = quotaStore.Defer(entry.Uid, entry.RecordRevision,
                ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(3), T0.AddMinutes(4));
            if (!transition.Committed) accepted = -1000;
        }
        for (var index = 20; index < 40; index++)
        {
            var entry = quotaStore.Entries[index];
            var transition = quotaStore.Quarantine(entry.Uid, entry.RecordRevision,
                ObservationLedgerReasons.ObservationInvalidTimestamp);
            if (!transition.Committed) accepted = -1000;
        }
        var mixed65 = quotaStore.Capture(Candidate(Row(Uid())));
        var mixedReload = Store(quotaDir);
        Check("OL09", accepted == 64 && mixed65.Status == ObservationLedgerCaptureStatus.RefusedQuota
            && mixedReload.EntryCount == 64
            && mixedReload.QuarantineTotal == 20
            && mixedReload.Entries.Count(x => x.State == ObservationLedgerState.Quarantine) == 20,
            "pending+deferred+quarantine delen dezelfde 64-grens; de 65e wordt geweigerd");

        // ----------------------------------------------------- budget boundary
        var boundaryDir = NewDirectory();
        var probeStore = Store(boundaryDir);
        var probe = probeStore.Capture(Candidate(Row(Uid(), "e")));
        var reserved = probe.ReservedBytes;
        var actual = probe.ActualBytes;

        var exactDir = NewDirectory();
        var exactOptions = new ObservationLedgerOptions { MaxSnapshotBytes = (int)reserved };
        var exactStore = Store(exactDir, null, exactOptions);
        var exact = exactStore.Capture(Candidate(Row(Uid(), "e")));
        Check("OL10", probe.Captured && exact.Captured && exact.ReservedBytes == reserved
            && exact.ActualBytes <= exact.ReservedBytes,
            "exact gereserveerd budget wordt geaccepteerd (actual=" + exact.ActualBytes
            + " reserved=" + exact.ReservedBytes + ")");

        var oneLessDir = NewDirectory();
        var oneLessOptions = new ObservationLedgerOptions { MaxSnapshotBytes = (int)reserved - 1 };
        var oneLessStore = Store(oneLessDir, null, oneLessOptions);
        var oneLess = oneLessStore.Capture(Candidate(Row(Uid(), "e")));
        Check("OL11", oneLess.Status == ObservationLedgerCaptureStatus.RefusedQuota
            && oneLessStore.EntryCount == 0,
            "een budget van reserved-1 byte wordt zichtbaar geweigerd");

        var multiDir = NewDirectory();
        var multiOptions = new ObservationLedgerOptions { MaxSnapshotBytes = (int)reserved };
        var multiStore = Store(multiDir, null, multiOptions);
        var multiRow = Row(Uid(), "é");
        var multiCandidate = Candidate(multiRow);
        var multiBudget = ObservationLedgerBudget.EntryWorstBytes(multiCandidate.Uid,
            multiCandidate.RecordRevision, multiCandidate.RowJson, multiCandidate.Binding,
            multiCandidate.EnqueuedAtUtc);
        var asciiBudget = ObservationLedgerBudget.EntryWorstBytes(probe.Uid, 1,
            probeStore.Find(probe.Uid, 1).RowJson, Binding(), T0.AddMinutes(1));
        var multi = multiStore.Capture(multiCandidate);
        Check("OL12", multiBudget == asciiBudget + 1
            && multi.Status == ObservationLedgerCaptureStatus.RefusedQuota,
            "multibyte '+' 1 byte groeit over de exacte grens (entryBudget " + multiBudget
            + " vs " + asciiBudget + "); geen truncatie");

        // ------------------------------------------------- deferred/quarantine
        var stateDir = NewDirectory();
        var stateStore = Store(stateDir);
        var stateCandidate = Candidate(Row(Uid()));
        var stateCapture = stateStore.Capture(stateCandidate);
        var pendingBytes = stateStore.ActualBytes;
        var reservedState = stateStore.ReservedBytes;
        var fr = stateStore.Defer(stateCandidate.Uid, 1,
            ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(3), T0.AddMinutes(4));
        var deferredBytes = stateStore.ActualBytes;
        var deferred = stateStore.Find(stateCandidate.Uid, 1);
        var qr = stateStore.Quarantine(stateCandidate.Uid, 1,
            ObservationLedgerReasons.ObservationInvalidTimestamp);
        var quarantinedBytes = stateStore.ActualBytes;
        var quarantined = stateStore.Find(stateCandidate.Uid, 1);
        var stateReload = Store(stateDir);
        var reloadedQuarantine = stateReload.Find(stateCandidate.Uid, 1);
        Check("OL13", fr.Committed && qr.Committed
            && deferred.State == ObservationLedgerState.Deferred
            && deferred.Attempts == 1 && deferred.NextAttemptUtc.HasValue
            && quarantined.State == ObservationLedgerState.Quarantine
            && quarantined.ReasonCode == ObservationLedgerReasons.ObservationInvalidTimestamp
            && pendingBytes <= deferredBytes && pendingBytes <= quarantinedBytes
            && deferredBytes <= reservedState && quarantinedBytes <= reservedState
            && reservedState <= 1024 * 1024
            && reloadedQuarantine.RowJson == stateCandidate.RowJson
            && stateReload.QuarantineTotal == 1 && stateReload.DeliveredTotal == 0,
            "pending->deferred->quarantine groeit binnen hetzelfde worst-statebudget; rowJson blijft exact"
            + "; pending=" + pendingBytes + " deferred=" + deferredBytes + " quarantine=" + quarantinedBytes
            + " reserved=" + reservedState + " fr=" + fr.Status + " qr=" + qr.Status
            + " dstate=" + deferred.State + " attempts=" + deferred.Attempts
            + " qstate=" + quarantined.State + " qreason=" + quarantined.ReasonCode
            + " reload=" + (reloadedQuarantine == null ? "null" : reloadedQuarantine.State.ToString()));

        var deferAfterQuarantine = stateStore.Defer(stateCandidate.Uid, 1,
            ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(3), T0.AddMinutes(4));
        var unknownReason = Store(NewDirectory());
        var unknownCandidate = Candidate(Row(Uid()));
        unknownReason.Capture(unknownCandidate);
        var unknown = unknownReason.Quarantine(unknownCandidate.Uid, 1,
            "raw HTTP body with token=secret");
        var unknownEntry = unknownReason.Find(unknownCandidate.Uid, 1);
        Check("OL14", deferAfterQuarantine.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
            && unknown.Committed && unknownEntry.ReasonCode == ObservationLedgerReasons.ServerRejectedUnknown
            && unknownReason.DeliveredTotal == 0,
            "quarantine is terminaal; een onbekende afwijzing wordt één vaste lokale code");

        // Deferred writes attempts/nextAttempt and resumes pending on restart.
        var deferDir = NewDirectory();
        var deferStore = Store(deferDir);
        var deferCandidate = Candidate(Row(Uid()));
        deferStore.Capture(deferCandidate);
        deferStore.Defer(deferCandidate.Uid, 1, ObservationLedgerReasons.ContainsUnknownFields,
            T0.AddMinutes(3), T0.AddMinutes(4));
        var deferReload = Store(deferDir);
        var resumed = deferReload.Find(deferCandidate.Uid, 1);
        Check("OL15", resumed.State == ObservationLedgerState.Pending
            && resumed.Attempts == 1 && resumed.NextAttemptUtc.HasValue
            && resumed.RowJson == deferCandidate.RowJson,
            "deferred hervat als pending met behouden attempts/nextAttempt en dezelfde bytes");

        // ------------------------------------------------------- atomic faults
        var failDir = NewDirectory();
        var failFaults = new Faults { BeforeSwitchFailures = 1 };
        var failStore = Store(failDir, null, null, null, failFaults);
        var failCandidate = Candidate(Row(Uid()));
        var failed = failStore.Capture(failCandidate);
        var failedCount = failStore.EntryCount;
        var failedReservations = failStore.ReservationCount;
        var retry = failStore.Capture(failCandidate);
        var failReload = Store(failDir);
        Check("OL16", failed.Status == ObservationLedgerCaptureStatus.NotCommitted
            && !failed.Captured && failedCount == 0
            && failedReservations == 1
            && retry.Status == ObservationLedgerCaptureStatus.Captured
            && failStore.EntryCount == 1 && failStore.ReservationCount == 0
            && failReload.EntryCount == 1 && failReload.Find(failCandidate.Uid, 1).RowJson == failCandidate.RowJson,
            "definitieve pre-switch IO-fout is niet captured; dezelfde UID wordt retrybaar gecommit"
            + "; failed=" + failed.Status + "/" + failed.Diagnostic + " retry=" + retry.Status
            + "/" + retry.Diagnostic + " count=" + failStore.EntryCount
            + " res=" + failStore.ReservationCount + " reload=" + failReload.EntryCount);

        var skipDir = NewDirectory();
        var skipFs = new WrappedFileSystem(new ObservationLedgerFileSystem());
        var skipStore = Store(skipDir, null, null, skipFs);
        var firstOk = skipStore.Capture(Candidate(Row(Uid())));
        var skipCandidate = Candidate(Row(Uid()));
        skipFs.ThrowBeforeReplace = true;
        var skipped = skipStore.Capture(skipCandidate);
        var skipMemoryCount = skipStore.EntryCount;
        var skipReservations = skipStore.ReservationCount;
        skipFs.ThrowBeforeReplace = false;
        var skipRetry = skipStore.Capture(skipCandidate);
        Check("OL17", firstOk.Captured
            && skipped.Status == ObservationLedgerCaptureStatus.NotCommitted
            && skipMemoryCount == 1 && skipReservations == 1
            && skipRetry.Captured && skipStore.EntryCount == 2
            && Store(skipDir).EntryCount == 2,
            "mislukte replace laat de oude snapshot staan; dezelfde candidate blijft gereserveerd en retrybaar");

        var skipBindingCandidate = ObservationLedgerCandidate.TryCreate(
            Row(skipCandidate.Uid, device: OtherDevice),
            Binding(OtherDevice), T0.AddMinutes(1), out diagnostic);
        var skipBinding = skipStore.Capture(skipBindingCandidate);
        Check("OL17b", skipBinding.Status == ObservationLedgerCaptureStatus.RefusedConflict
            && skipStore.EntryCount == 2,
            "een onopgeloste reservering houdt ook haar binding vast; een andere binding is conflict");

        var afterDir = NewDirectory();
        var afterFaults = new Faults { AfterSwitchFailures = 1 };
        var afterStore = Store(afterDir, null, null, null, afterFaults);
        var afterCandidate = Candidate(Row(Uid()));
        var after = afterStore.Capture(afterCandidate);
        var afterReload = Store(afterDir);
        Check("OL18", after.Status == ObservationLedgerCaptureStatus.Captured
            && afterStore.EntryCount == 1 && afterStore.ReservationCount == 0
            && afterReload.EntryCount == 1
            && afterReload.Find(afterCandidate.Uid, 1).RowJson == afterCandidate.RowJson,
            "onzekere switch leest de target terug, adopteert de commit en maakt geen tweede entry");

        // --------------------------------------------------- binding fence
        var fenceDir = NewDirectory();
        var fenceA = new ObservationBindingFence(Binding());
        var fenceStore = Store(fenceDir, fenceA);
        var fenceCandidate = Candidate(Row(Uid()));
        var fenceFaults = new Faults();
        var rebind = (Task)null;
        var blockedDuringSwitch = false;
        fenceFaults.OnBeforeSwitch = delegate
        {
            rebind = Task.Run(delegate { fenceA.Rebind(Binding(OtherDevice, 8)); });
            Thread.Sleep(200);
            blockedDuringSwitch = rebind != null && !rebind.IsCompleted;
        };
        var fenceStoreWithFaults = Store(NewDirectory(), fenceA, null, null, fenceFaults);
        var fenceCapture = fenceStoreWithFaults.Capture(fenceCandidate);
        if (rebind != null) rebind.Wait(2000);
        Check("OL19", fenceCapture.Captured && blockedDuringSwitch
            && ObservationBindingFence.SameBinding(fenceA.Current, Binding(OtherDevice, 8))
            && fenceStoreWithFaults.Find(fenceCandidate.Uid, 1).CaptureDeviceId == Device,
            "lokale rebind blokkeert tijdens de laatste check+switch en kan er niet tussen schuiven");

        var afterRebind = Store(NewDirectory(), new ObservationBindingFence(Binding(OtherDevice, 8)));
        // Candidate was frozen under the old binding; the store fence is now new.
        var staleCandidate = Candidate(Row(Uid()));
        var staleResult = afterRebind.Capture(staleCandidate);
        Check("OL20", staleResult.Status == ObservationLedgerCaptureStatus.RefusedBindingChanged
            && staleResult.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
            && afterRebind.EntryCount == 0,
            "bindingwissel vóór de commit wordt zichtbaar geweigerd, niet gecommit");

        var contextStore = Store(NewDirectory());
        var contextRow = Row(Uid(), "Test Driver", "session-new", Device, 1, "ctx-new");
        var contextCapture = contextStore.Capture(Candidate(contextRow, Binding()));
        Check("OL21", contextCapture.Captured && contextStore.EntryCount == 1,
            "alleen een sessie-/contextwissel is geen pairingwissel en blijft captureerbaar");

        // -------------------------------------------------- concurrency/quota
        var concDir = NewDirectory();
        var concOptions = new ObservationLedgerOptions { MaxEntries = 5 };
        var concStore = Store(concDir, null, concOptions);
        var results = new ObservationLedgerCaptureResult[12];
        Parallel.For(0, 12, delegate (int index)
        {
            results[index] = concStore.Capture(Candidate(Row(Uid())));
        });
        var capturedCount = results.Count(x => x.Captured);
        var refusedCount = results.Count(x => x.Status == ObservationLedgerCaptureStatus.RefusedQuota);
        var concReload = Store(concDir, null, new ObservationLedgerOptions { MaxEntries = 5 });
        Check("OL22", capturedCount == 5 && refusedCount == 7
            && concStore.EntryCount == 5 && concStore.CaptureRefused == 7
            && concReload.EntryCount == 5
            && concReload.Entries.Select(x => x.Uid + "|" + x.RecordRevision).Distinct().Count() == 5,
            "gelijktijdige reserve/commit meet tegen de laatste snapshot: 5 winnen, 7 zien het quotum");

        // -------------------------------------------------------- recovery
        var tmpDir = NewDirectory();
        var tmpStore = Store(tmpDir);
        var tmpCandidate = Candidate(Row(Uid()));
        tmpStore.Capture(tmpCandidate);
        File.WriteAllText(tmpStore.Path + ".tmp", "{\"version\":999}", Utf8);
        var tmpReload = Store(tmpDir);
        Check("OL23", tmpReload.EntryCount == 1
            && tmpReload.Find(tmpCandidate.Uid, 1).RowJson == tmpCandidate.RowJson
            && !File.Exists(tmpStore.Path + ".tmp"),
            "een achtergebleven tmp is nooit gezaghebbend en wordt opgeruimd");

        var bakDir = NewDirectory();
        var bakStore = Store(bakDir);
        var bakCandidate = Candidate(Row(Uid()));
        bakStore.Capture(bakCandidate);
        File.Copy(bakStore.Path, bakStore.Path + ".bak", true);
        var bakBytes = File.ReadAllBytes(bakStore.Path);
        File.WriteAllText(bakStore.Path, "{corrupt target", Utf8);
        var bakReload = Store(bakDir);
        var preserved = File.ReadAllBytes(bakReload.PreservePath);
        var restoredBytes = File.ReadAllBytes(bakReload.Path);
        Check("OL24", bakReload.EntryCount == 1
            && bakReload.Find(bakCandidate.Uid, 1).RowJson == bakCandidate.RowJson
            && Encoding.UTF8.GetString(preserved) == "{corrupt target"
            && !EqualsBytes(restoredBytes, preserved)
            && Json(bakReload.Path) != null,
            "corrupte target wordt één keer bewaard; een volledig geldige bak wordt atomair hersteld");

        var unknownDir = NewDirectory();
        var unknownPath = Path.Combine(unknownDir, "observation-ledger-v1.json");
        var unknownBytes = Utf8.GetBytes("{\"version\":2,\"savedAtUtc\":\"2026-11-12T12:00:00.000Z\",\"counters\":{},\"entries\":[]}");
        File.WriteAllBytes(unknownPath, unknownBytes);
        var unknownStore = Store(unknownDir);
        var preserve1 = File.ReadAllBytes(unknownStore.PreservePath);
        var captureWhileClosed = unknownStore.Capture(Candidate(Row(Uid())));
        var secondBytes = Utf8.GetBytes("{\"version\":3,\"ander\":true}");
        File.WriteAllBytes(unknownPath, secondBytes);
        unknownStore.Load();
        var preserve2 = File.ReadAllBytes(unknownStore.PreservePath);
        Check("OL25", unknownStore.IsFailedClosed && captureWhileClosed.Status ==
            ObservationLedgerCaptureStatus.RefusedStoreFailedClosed
            && EqualsBytes(preserve1, unknownBytes) && EqualsBytes(preserve2, unknownBytes)
            && EqualsBytes(File.ReadAllBytes(unknownPath), secondBytes),
            "onbekende versie faalt gesloten; de eerste preserve-slot wordt nooit overschreven");

        var failPreserveDir = NewDirectory();
        var failPreservePath = Path.Combine(failPreserveDir, "observation-ledger-v1.json");
        File.WriteAllText(failPreservePath, "{corrupt", Utf8);
        var failPreserveFaults = new Faults { PreserveFailures = 2 };
        var failPreserveStore = Store(failPreserveDir, null, null, null, failPreserveFaults);
        var failPreserveFirst = failPreserveStore.IsFailedClosed;
        var failPreserveReload = Store(failPreserveDir, null, null, null, failPreserveFaults);
        Check("OL26", failPreserveFirst && failPreserveReload.IsFailedClosed
            && !File.Exists(failPreserveStore.PreservePath)
            && !string.IsNullOrEmpty(failPreserveReload.PersistenceError)
            && File.ReadAllText(failPreservePath, Utf8) == "{corrupt",
            "twee opeenvolgende preserve-fouten blijven fail closed zonder de target te nullen");

        var oversizeDir = NewDirectory();
        var oversizePath = Path.Combine(oversizeDir, "observation-ledger-v1.json");
        var oversizeBytes = new byte[1024 * 1024 + 1];
        for (var index = 0; index < oversizeBytes.Length; index++) oversizeBytes[index] = (byte)'x';
        File.WriteAllBytes(oversizePath, oversizeBytes);
        var oversizeStore = Store(oversizeDir);
        Check("OL27", oversizeStore.IsFailedClosed
            && new FileInfo(oversizeStore.PreservePath).Length == oversizeBytes.Length
            && !oversizeStore.Capture(Candidate(Row(Uid()))).Captured,
            "groottelimiet vóór deserialisatie; het hele bestand wordt stroommatig bewaard");

        var tamperDir = NewDirectory();
        var tamperStore = Store(tamperDir);
        var tamperCandidate = Candidate(Row(Uid()));
        tamperStore.Capture(tamperCandidate);
        var tamperText = File.ReadAllText(tamperStore.Path, Utf8);
        var otherUid = Uid();
        var firstUid = tamperText.IndexOf(tamperCandidate.Uid, StringComparison.Ordinal);
        tamperText = tamperText.Substring(0, firstUid) + otherUid
            + tamperText.Substring(firstUid + tamperCandidate.Uid.Length);
        File.WriteAllText(tamperStore.Path, tamperText, Utf8);
        var tamperReload = Store(tamperDir);
        Check("OL28", tamperReload.IsFailedClosed
            && File.Exists(tamperReload.PreservePath)
            && !tamperReload.Capture(Candidate(Row(Uid()))).Captured,
            "entry-UID die niet bij rowJson past maakt de snapshot ongeldig en fail closed");

        // ------------------------------------------------ legacy rollback proof
        var legacyDir = NewDirectory();
        var legacyLedger = Store(legacyDir);
        var legacyCandidate = Candidate(Row(Uid()));
        legacyLedger.Capture(legacyCandidate);
        var legacyLedgerPath = legacyLedger.Path;
        var legacySidecarBytes = File.ReadAllBytes(legacyLedgerPath);
        var legacyRow = Row(Uid());
        var outbox = new MeasurementOutbox(Path.Combine(legacyDir, "measurement-outbox.json"));
        string reason;
        var enqueued = outbox.EnqueueLap(legacyRow, out reason);
        var oldOutbox = new MeasurementOutbox(Path.Combine(legacyDir, "measurement-outbox.json"));
        oldOutbox.Load();
        var sidecarAfterOldLoad = File.ReadAllBytes(legacyLedgerPath);
        Check("OL29", enqueued && oldOutbox.LapCount == 1
            && EqualsBytes(legacySidecarBytes, sidecarAfterOldLoad)
            && Directory.GetFiles(legacyDir, "observation-ledger*.corrupt*").Length == 0,
            "de oude MeasurementOutbox leest alleen de gewone queue en laat de sidecar bytegelijk staan"
            + "; enqueued=" + enqueued + " reason=" + reason + " laps=" + oldOutbox.LapCount);

        // A corrupt sidecar does not block the ordinary queue either.
        var rollbackDir = NewDirectory();
        var rollbackPath = Path.Combine(rollbackDir, "observation-ledger-v1.json");
        File.WriteAllText(rollbackPath, "{corrupt sidecar", Utf8);
        var rollbackOutbox = new MeasurementOutbox(Path.Combine(rollbackDir, "measurement-outbox.json"));
        var rollbackRow = Row(Uid());
        rollbackOutbox.EnqueueLap(rollbackRow, out reason);
        var rollbackLoad = new MeasurementOutbox(Path.Combine(rollbackDir, "measurement-outbox.json"));
        rollbackLoad.Load();
        var rollbackStore = Store(rollbackDir);
        Check("OL30", rollbackLoad.LapCount == 1 && rollbackStore.IsFailedClosed
            && File.ReadAllText(rollbackPath, Utf8) == "{corrupt sidecar",
            "een corrupte sidecar blokkeert de gewone queue niet en blijft als bewijs staan"
            + "; laps=" + rollbackLoad.LapCount + " closed=" + rollbackStore.IsFailedClosed
            + " reason=" + reason);

        // ------------------------------------------------- option bounds
        var bounds = new ObservationLedgerOptions { MaxEntries = 1000, MaxSnapshotBytes = 10 * 1024 * 1024 };
        var boundsStore = Store(NewDirectory(), null, bounds);
        Check("OL31", boundsStore.EffectiveMaxEntries == 64
            && boundsStore.EffectiveMaxBytes == 1024 * 1024,
            "opties kunnen de harde 64/1 MiB-grens niet verhogen");

        var orphanDir = NewDirectory();
        var orphanPath = Path.Combine(orphanDir, "observation-ledger-v1.json");
        File.WriteAllText(orphanPath + ".tmp", "{\"version\":1}", Utf8);
        var orphanStore = Store(orphanDir);
        Check("OL32", orphanStore.IsFailedClosed
            && File.Exists(orphanPath + ".tmp")
            && !orphanStore.Capture(Candidate(Row(Uid()))).Captured
            && orphanStore.PersistenceError == "orphan_tmp_without_target",
            "een tmp zonder target/bak is niet gezaghebbend maar wordt ook niet als leeg succes verloren");

        var badBakDir = NewDirectory();
        var badBakPath = Path.Combine(badBakDir, "observation-ledger-v1.json");
        File.WriteAllText(badBakPath + ".bak", "{kapot", Utf8);
        var badBakStore = Store(badBakDir);
        Check("OL33", badBakStore.IsFailedClosed && !File.Exists(badBakPath)
            && !badBakStore.Capture(Candidate(Row(Uid()))).Captured,
            "ontbrekende target met ongeldige bak start niet als verse lege ledger");

        return count;
    }

    private static bool EqualsBytes(byte[] left, byte[] right)
    {
        if (left == null || right == null) return left == right;
        if (left.Length != right.Length) return false;
        for (var index = 0; index < left.Length; index++)
        {
            if (left[index] != right[index]) return false;
        }
        return true;
    }
}
