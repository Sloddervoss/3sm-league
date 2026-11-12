using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
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

        // =============================================== B1/B2/B3/B4 repair
        // B1: a reserved identity may only be retried with the exact original
        // candidate. A different payload with the same budget must refuse.
        var b1Dir = NewDirectory();
        var b1Store = Store(b1Dir);
        var b1Uid = Uid();
        var b1Original = Candidate(Row(b1Uid, "AAAA"));
        var b1Replacement = Candidate(Row(b1Uid, "BBBB"));
        var b1OriginalBudget = ObservationLedgerBudget.EntryWorstBytes(b1Original.Uid,
            b1Original.RecordRevision, b1Original.RowJson, b1Original.Binding,
            b1Original.EnqueuedAtUtc);
        var b1ReplacementBudget = ObservationLedgerBudget.EntryWorstBytes(b1Replacement.Uid,
            b1Replacement.RecordRevision, b1Replacement.RowJson, b1Replacement.Binding,
            b1Replacement.EnqueuedAtUtc);
        ObservationLedgerCaptureResult b1First;
        Chmod(b1Dir, "0555");
        try { b1First = b1Store.Capture(b1Original); }
        finally { Chmod(b1Dir, "0755"); }
        var b1Substitution = b1Store.Capture(b1Replacement);
        var b1ReservationsAfterSubstitution = b1Store.ReservationCount;
        var b1EntryAfterSubstitution = b1Store.Find(b1Uid, 1);
        var b1RetryOriginal = b1Store.Capture(b1Original);
        var b1Reload = Store(b1Dir);
        Check("OL34", b1First.Status == ObservationLedgerCaptureStatus.NotCommitted
            && b1ReservationsAfterSubstitution == 1
            && b1Original.RowJson != b1Replacement.RowJson
            && b1OriginalBudget == b1ReplacementBudget
            && b1Substitution.Status == ObservationLedgerCaptureStatus.RefusedConflict
            && b1Substitution.Diagnostic == "identity_payload_conflict"
            && b1EntryAfterSubstitution == null
            && b1ReservationsAfterSubstitution == 1
            && b1RetryOriginal.Captured && b1Store.ReservationCount == 0
            && b1Store.Find(b1Uid, 1).RowJson == b1Original.RowJson
            && b1Reload.Find(b1Uid, 1).RowJson == b1Original.RowJson,
            "gereserveerde identiteit weigert een andere payload met hetzelfde budget; het origineel blijft retrybaar"
            + "; first=" + b1First.Status + " second=" + b1Substitution.Status
            + " resAfterSub=" + b1ReservationsAfterSubstitution
            + " retry=" + b1RetryOriginal.Status
            + " resNow=" + b1Store.ReservationCount
            + " budgets=" + b1OriginalBudget + "/" + b1ReplacementBudget);

        var b1ControlStore = Store(NewDirectory());
        var b1ControlFirst = b1ControlStore.Capture(b1Original);
        var b1ControlSecond = b1ControlStore.Capture(b1Replacement);
        Check("OL34b", b1ControlFirst.Captured
            && b1ControlSecond.Status == ObservationLedgerCaptureStatus.RefusedConflict
            && b1ControlSecond.Diagnostic == "identity_payload_conflict"
            && b1ControlStore.Find(b1Uid, 1).RowJson == b1Original.RowJson,
            "positieve controle: normaal gecommitte rij weigert dezelfde identiteit met andere payload");

        // B2: a definite binding-change refusal releases the unused reservation,
        // so all 64 slots remain available; the old UID never reaches disk.
        var b2Dir = NewDirectory();
        var b2Fence = new ObservationBindingFence(Binding());
        var b2Store = Store(b2Dir, b2Fence);
        var b2Uid = Uid();
        var b2Old = Candidate(Row(b2Uid));
        ObservationLedgerCaptureResult b2First;
        Chmod(b2Dir, "0555");
        try { b2First = b2Store.Capture(b2Old); }
        finally { Chmod(b2Dir, "0755"); }
        var b2ReservedBefore = b2Store.ReservationCount;
        b2Fence.Rebind(Binding(OtherDevice, 8));
        var b2Refusal = b2Store.Capture(b2Old);
        var b2ReservationsAfterRefusal = b2Store.ReservationCount;
        var b2Accepted = 0;
        for (var index = 0; index < 64; index++)
        {
            var acceptedResult = b2Store.Capture(Candidate(Row(Uid(), device: OtherDevice),
                Binding(OtherDevice, 8)));
            if (acceptedResult.Status == ObservationLedgerCaptureStatus.Captured) b2Accepted++;
        }
        var b2Overflow = b2Store.Capture(Candidate(Row(Uid(), device: OtherDevice),
            Binding(OtherDevice, 8)));
        var b2Reload = Store(b2Dir, new ObservationBindingFence(Binding(OtherDevice, 8)));
        Check("OL35", b2First.Status == ObservationLedgerCaptureStatus.NotCommitted
            && b2ReservedBefore == 1
            && b2Refusal.Status == ObservationLedgerCaptureStatus.RefusedBindingChanged
            && b2Refusal.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
            && b2ReservationsAfterRefusal == 0
            && b2Accepted == 64 && b2Store.EntryCount == 64
            && b2Store.ReservationCount == 0
            && b2Overflow.Status == ObservationLedgerCaptureStatus.RefusedQuota
            && b2Reload.Find(b2Uid, 1) == null,
            "definitieve bindingweigering geeft de reservering vrij: 64 nieuwe rijen passen en de oude UID staat niet op schijf"
            + "; first=" + b2First.Status + " refusal=" + b2Refusal.Status
            + " reservations=" + b2ReservationsAfterRefusal + " accepted=" + b2Accepted
            + " overflow=" + b2Overflow.Status);

        var b2ControlStore = Store(NewDirectory(), new ObservationBindingFence(Binding(OtherDevice, 8)));
        var b2ControlAccepted = 0;
        for (var index = 0; index < 64; index++)
        {
            var result = b2ControlStore.Capture(Candidate(Row(Uid(), device: OtherDevice),
                Binding(OtherDevice, 8)));
            if (result.Status == ObservationLedgerCaptureStatus.Captured) b2ControlAccepted++;
        }
        Check("OL35b", b2ControlAccepted == 64 && b2ControlStore.EntryCount == 64
            && b2ControlStore.ReservationCount == 0,
            "positieve controle: zonder stale reservering worden 64 nieuwe bindingrijen geaccepteerd");

        // A readback first proves absence. If a previous uncertain switch already
        // published the identity, it is adopted instead of blanket-released.
        var b2cDir = NewDirectory();
        var b2cFence = new ObservationBindingFence(Binding());
        var b2cStore = Store(b2cDir, b2cFence);
        var b2cCandidate = Candidate(Row(Uid()));
        ObservationLedgerCaptureResult b2cFirst;
        Chmod(b2cDir, "0555");
        try { b2cFirst = b2cStore.Capture(b2cCandidate); }
        finally { Chmod(b2cDir, "0755"); }
        var b2cWitness = Store(NewDirectory());
        var b2cWitnessCapture = b2cWitness.Capture(b2cCandidate);
        File.Copy(b2cWitness.Path, b2cStore.Path, true);
        b2cFence.Rebind(Binding(OtherDevice, 8));
        var b2cAdoption = b2cStore.Capture(b2cCandidate);
        Check("OL35c", b2cFirst.Status == ObservationLedgerCaptureStatus.NotCommitted
            && b2cWitnessCapture.Captured
            && b2cAdoption.Status == ObservationLedgerCaptureStatus.AlreadyCaptured
            && b2cStore.EntryCount == 1 && b2cStore.ReservationCount == 0
            && b2cStore.Find(b2cCandidate.Uid, 1).RowJson == b2cCandidate.RowJson,
            "mogelijk-gecommitte identiteit wordt bij vrijgave eerst teruggelezen en geadopteerd, niet blind vrijgegeven"
            + "; first=" + b2cFirst.Status + " adoption=" + b2cAdoption.Status
            + " entries=" + b2cStore.EntryCount + " res=" + b2cStore.ReservationCount);

        // B3: after-switch uncertainty must reconcile the authoritative full
        // snapshot; the durable quarantine is adopted and stays terminal.
        var b3Dir = NewDirectory();
        var b3Faults = new Faults();
        var b3Store = Store(b3Dir, null, null, null, b3Faults);
        var b3Candidate = Candidate(Row(Uid()));
        var b3Capture = b3Store.Capture(b3Candidate);
        b3Faults.AfterSwitchFailures = 1;
        var b3Quarantine = b3Store.Quarantine(b3Candidate.Uid, 1,
            ObservationLedgerReasons.ObservationInvalidTimestamp);
        var b3Entry = b3Store.Find(b3Candidate.Uid, 1);
        var b3Defer = b3Store.Defer(b3Candidate.Uid, 1,
            ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(3), T0.AddMinutes(4));
        var b3Reload = Store(b3Dir);
        var b3ReloadEntry = b3Reload.Find(b3Candidate.Uid, 1);
        Check("OL36", b3Capture.Captured
            && b3Quarantine.Status == ObservationLedgerTransitionStatus.Committed
            && b3Quarantine.Diagnostic == null
            && b3Entry.State == ObservationLedgerState.Quarantine
            && b3Entry.ReasonCode == ObservationLedgerReasons.ObservationInvalidTimestamp
            && b3Store.QuarantineTotal == 1
            && b3Defer.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
            && b3Defer.Diagnostic == "quarantine_is_terminal"
            && b3Store.QuarantineTotal == 1
            && b3ReloadEntry.State == ObservationLedgerState.Quarantine
            && b3ReloadEntry.ReasonCode == ObservationLedgerReasons.ObservationInvalidTimestamp
            && b3ReloadEntry.RowJson == b3Candidate.RowJson
            && b3Reload.QuarantineTotal == 1,
            "na-switch onzekerheid leest de volledige snapshot terug, adopteert quarantaine en blokkeert Defer"
            + "; q=" + b3Quarantine.Status + "/" + b3Quarantine.Diagnostic
            + " memory=" + b3Entry.State + " total=" + b3Store.QuarantineTotal
            + " defer=" + b3Defer.Status + "/" + b3Defer.Diagnostic
            + " reload=" + b3ReloadEntry.State + "/" + b3Reload.QuarantineTotal);

        var b3bDir = NewDirectory();
        var b3bFaults = new Faults();
        var b3bStore = Store(b3bDir, null, null, null, b3bFaults);
        var b3bCandidate = Candidate(Row(Uid()));
        b3bStore.Capture(b3bCandidate);
        b3bFaults.BeforeSwitchFailures = 1;
        var b3bQuarantine = b3bStore.Quarantine(b3bCandidate.Uid, 1,
            ObservationLedgerReasons.ObservationInvalidTimestamp);
        var b3bMemory = b3bStore.Find(b3bCandidate.Uid, 1);
        var b3bMemoryTotal = b3bStore.QuarantineTotal;
        var b3bDisk = Store(b3bDir);
        var b3bRetry = b3bStore.Quarantine(b3bCandidate.Uid, 1,
            ObservationLedgerReasons.ObservationInvalidTimestamp);
        var b3bReload = Store(b3bDir);
        Check("OL36b", b3bQuarantine.Status == ObservationLedgerTransitionStatus.NotCommitted
            && b3bMemory.State == ObservationLedgerState.Pending
            && b3bMemoryTotal == 0
            && b3bDisk.Find(b3bCandidate.Uid, 1).State == ObservationLedgerState.Pending
            && b3bDisk.QuarantineTotal == 0
            && b3bRetry.Status == ObservationLedgerTransitionStatus.Committed
            && b3bReload.Find(b3bCandidate.Uid, 1).State == ObservationLedgerState.Quarantine
            && b3bReload.QuarantineTotal == 1,
            "pre-switch transitiefout laat oude schijf-/geheugenstatus intact en een legitieme retry toe"
            + "; q=" + b3bQuarantine.Status + " memory=" + b3bMemory.State
            + " total=" + b3bMemoryTotal
            + " disk=" + b3bDisk.Find(b3bCandidate.Uid, 1).State
            + "/" + b3bDisk.QuarantineTotal
            + " retry=" + b3bRetry.Status + "/" + b3bRetry.Diagnostic
            + " reload=" + b3bReload.Find(b3bCandidate.Uid, 1).State
            + "/" + b3bReload.QuarantineTotal);

        var b3cDir = NewDirectory();
        var b3cFaults = new Faults();
        var b3cStore = Store(b3cDir, null, null, null, b3cFaults);
        var b3cCandidate = Candidate(Row(Uid()));
        b3cStore.Capture(b3cCandidate);
        b3cFaults.AfterSwitchFailures = 1;
        var b3cDefer = b3cStore.Defer(b3cCandidate.Uid, 1,
            ObservationLedgerReasons.ContainsUnknownFields, T0.AddMinutes(3), T0.AddMinutes(4));
        var b3cReload = Store(b3cDir);
        var b3cResumed = b3cReload.Find(b3cCandidate.Uid, 1);
        Check("OL36c", b3cDefer.Status == ObservationLedgerTransitionStatus.Committed
            && b3cStore.Find(b3cCandidate.Uid, 1).State == ObservationLedgerState.Deferred
            && b3cResumed.State == ObservationLedgerState.Pending
            && b3cResumed.Attempts == 1 && b3cResumed.NextAttemptUtc.HasValue
            && b3cResumed.RowJson == b3cCandidate.RowJson,
            "na-switch onzekere Defer wordt teruggelezen als committed en houdt attempts/nextAttempt over herstart"
            + "; defer=" + b3cDefer.Status + "/" + b3cDefer.Diagnostic
            + " memory=" + b3cStore.Find(b3cCandidate.Uid, 1).State
            + " reload=" + b3cResumed.State + "/" + b3cResumed.Attempts);

        // B4: a real child process is SIGKILLed during the streamed preserve.
        // The partial staging slot is never final evidence; restart redoes the
        // whole file atomically.
        const long b4Bytes = 128L * 1024 * 1024;
        var b4Dir = NewDirectory();
        var b4Store = Store(b4Dir);
        var b4Candidate = Candidate(Row(Uid()));
        b4Store.Capture(b4Candidate);
        var b4Path = b4Store.Path;
        var b4Preserved = b4Store.PreservePath;
        var b4Staging = b4Preserved + ".tmp";
        File.Copy(b4Path, b4Path + ".bak", true);
        File.Delete(b4Preserved);
        if (File.Exists(b4Staging)) File.Delete(b4Staging);
        WriteFilledFile(b4Path, b4Bytes, (byte)'x');
        var b4OriginalHash = Sha256(b4Path);

        var b4Start = Stopwatch.StartNew();
        var b4SawStaging = false;
        var b4FinalAtKill = false;
        var b4Killed = false;
        var b4StagingAtKill = -1L;
        var b4FinalAtKillLength = -1L;
        using (var child = Process.Start(ChildStartInfo(b4Path)))
        {
            while (b4Start.Elapsed < TimeSpan.FromSeconds(30))
            {
                if (File.Exists(b4Staging))
                {
                    var stagedLength = new FileInfo(b4Staging).Length;
                    if (stagedLength >= 65536 && stagedLength < b4Bytes)
                    {
                        b4SawStaging = true;
                        break;
                    }
                }
                if (File.Exists(b4Preserved))
                {
                    var finalLength = new FileInfo(b4Preserved).Length;
                    if (finalLength >= 65536)
                    {
                        b4FinalAtKill = true;
                        break;
                    }
                }
                if (child.HasExited) break;
                Thread.Sleep(1);
            }
            if (!child.HasExited && (b4SawStaging || b4FinalAtKill))
            {
                child.Kill();
                b4Killed = true;
            }
            child.WaitForExit(10000);
            if (File.Exists(b4Staging)) b4StagingAtKill = new FileInfo(b4Staging).Length;
            if (File.Exists(b4Preserved)) b4FinalAtKillLength = new FileInfo(b4Preserved).Length;
            try { child.StandardOutput.ReadToEnd(); } catch (Exception) { }
        }
        var b4Reload = Store(b4Dir);
        var b4PreservedLength = File.Exists(b4Reload.PreservePath)
            ? new FileInfo(b4Reload.PreservePath).Length : -1L;
        var b4PreservedHash = File.Exists(b4Reload.PreservePath) ? Sha256(b4Reload.PreservePath) : null;
        var b4Restored = b4Reload.Find(b4Candidate.Uid, 1);
        Check("OL37", b4SawStaging && b4Killed && !b4FinalAtKill
            && b4FinalAtKillLength == -1
            && b4StagingAtKill >= 65536 && b4StagingAtKill < b4Bytes
            && !b4Reload.IsFailedClosed && b4Reload.EntryCount == 1
            && b4Restored != null && b4Restored.RowJson == b4Candidate.RowJson
            && b4PreservedLength == b4Bytes
            && string.Equals(b4PreservedHash, b4OriginalHash, StringComparison.Ordinal)
            && !File.Exists(b4Staging),
            "SIGKILL tijdens streamen laat alleen een onvolledige staging achter; herstart bewaart het hele 128 MiB-bestand atomisch"
            + "; sawStaging=" + b4SawStaging + " killed=" + b4Killed
            + " finalAtKill=" + b4FinalAtKill + "/" + b4FinalAtKillLength
            + " stagingAtKill=" + b4StagingAtKill
            + " preserved=" + b4PreservedLength + " hashEqual=" + string.Equals(b4PreservedHash,
                b4OriginalHash, StringComparison.Ordinal)
            + " entries=" + b4Reload.EntryCount + " closed=" + b4Reload.IsFailedClosed);

        var b4bDir = NewDirectory();
        var b4bStore = Store(b4bDir);
        var b4bCandidate = Candidate(Row(Uid()));
        b4bStore.Capture(b4bCandidate);
        File.Copy(b4bStore.Path, b4bStore.Path + ".bak", true);
        File.Delete(b4bStore.PreservePath);
        const long b4bBytes = 2L * 1024 * 1024;
        WriteFilledFile(b4bStore.Path, b4bBytes, (byte)'y');
        var b4bHash = Sha256(b4bStore.Path);
        var b4bReload = Store(b4bDir);
        var b4bPreservedLength = File.Exists(b4bReload.PreservePath)
            ? new FileInfo(b4bReload.PreservePath).Length : -1L;
        Check("OL37b", !b4bReload.IsFailedClosed && b4bReload.EntryCount == 1
            && b4bPreservedLength == b4bBytes
            && string.Equals(Sha256(b4bReload.PreservePath), b4bHash, StringComparison.Ordinal)
            && !File.Exists(b4bReload.PreservePath + ".tmp")
            && b4bReload.Find(b4bCandidate.Uid, 1).RowJson == b4bCandidate.RowJson,
            "positieve controle zonder crash: 2 MiB wordt in één keer volledig bewaard en de bak herstelt"
            + "; preserved=" + b4bPreservedLength + " entries=" + b4bReload.EntryCount);

        try { Directory.Delete(b4Dir, true); } catch (Exception) { }

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

    private static void Chmod(string path, string mode)
    {
        var info = new ProcessStartInfo
        {
            FileName = "/bin/chmod",
            UseShellExecute = false
        };
        info.ArgumentList.Add(mode);
        info.ArgumentList.Add(path);
        using (var process = Process.Start(info))
        {
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new IOException("chmod " + mode + " failed with exit " + process.ExitCode);
        }
    }

    private static void WriteFilledFile(string path, long bytes, byte value)
    {
        using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.None, 1024 * 1024))
        {
            var buffer = new byte[64 * 1024];
            for (var index = 0; index < buffer.Length; index++) buffer[index] = value;
            var remaining = bytes;
            while (remaining > 0)
            {
                var count = (int)Math.Min(buffer.Length, remaining);
                stream.Write(buffer, 0, count);
                remaining -= count;
            }
            stream.Flush(true);
        }
    }

    private static string Sha256(string path)
    {
        using (var sha = SHA256.Create())
        using (var stream = File.OpenRead(path))
        {
            var hash = sha.ComputeHash(stream);
            var text = new StringBuilder(hash.Length * 2);
            for (var index = 0; index < hash.Length; index++)
                text.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
            return text.ToString();
        }
    }

    private static ProcessStartInfo ChildStartInfo(string ledgerPath)
    {
        var info = new ProcessStartInfo
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        var processPath = Environment.ProcessPath;
        var assemblyPath = Assembly.GetEntryAssembly() == null
            ? null : Assembly.GetEntryAssembly().Location;
        if (!string.IsNullOrEmpty(processPath)
            && !string.Equals(Path.GetFileNameWithoutExtension(processPath), "dotnet",
                StringComparison.OrdinalIgnoreCase))
        {
            info.FileName = processPath;
        }
        else
        {
            info.FileName = string.IsNullOrEmpty(processPath) ? "dotnet" : processPath;
            if (!string.IsNullOrEmpty(assemblyPath)) info.ArgumentList.Add(assemblyPath);
        }
        info.ArgumentList.Add("--ledger-preserve-child");
        info.ArgumentList.Add(ledgerPath);
        return info;
    }
}
