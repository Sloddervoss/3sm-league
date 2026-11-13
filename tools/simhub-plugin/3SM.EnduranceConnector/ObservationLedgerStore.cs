using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Limits for the version-1 observation ledger. Never raised above 64/1 MiB.</summary>
    public sealed class ObservationLedgerOptions
    {
        public int MaxEntries = 64;
        public int MaxSnapshotBytes = 1024 * 1024;
        /// <summary>Bounded backoff for a temporary observation rejection.</summary>
        public double BackoffBaseSeconds = 2.0;
        public double BackoffMaxSeconds = 60.0;
        internal Func<DateTime> Clock = delegate { return DateTime.UtcNow; };
    }

    /// <summary>
    /// Narrow filesystem seam. The production implementation performs a real
    /// same-directory temp write, Flush(true), close and File.Replace/Move.
    /// </summary>
    public interface IObservationLedgerFileSystem
    {
        bool Exists(string path);
        long Length(string path);
        byte[] ReadAllBytes(string path);
        void WriteTemporary(string path, byte[] bytes);
        void Replace(string tempPath, string targetPath, string backupPath);
        void Move(string tempPath, string targetPath);
        void Delete(string path);
        void Preserve(string sourcePath, string destinationPath);
    }

    /// <summary>Narrow fault seam around the atomic switch and the preserve slot.</summary>
    public interface IObservationLedgerFaults
    {
        void BeforePreserve();
        void BeforeSwitch();
        void AfterSwitch();
    }

    internal sealed class ObservationLedgerFileSystem : IObservationLedgerFileSystem
    {
        public bool Exists(string path) { return File.Exists(path); }
        public long Length(string path) { return new FileInfo(path).Length; }
        public byte[] ReadAllBytes(string path) { return File.ReadAllBytes(path); }
        public void Delete(string path) { if (File.Exists(path)) File.Delete(path); }

        public void WriteTemporary(string path, byte[] bytes)
        {
            using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None,
                64 * 1024, FileOptions.WriteThrough))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
        }

        public void Replace(string tempPath, string targetPath, string backupPath)
        {
            File.Replace(tempPath, targetPath, backupPath, true);
        }

        public void Move(string tempPath, string targetPath)
        {
            File.Move(tempPath, targetPath);
        }

        public void Preserve(string sourcePath, string destinationPath)
        {
            if (File.Exists(destinationPath)) return;
            // Stream into one fixed staging slot, flush it durably, then publish
            // with a same-volume rename. A process killed mid-copy can therefore
            // only leave staging, never a partial authoritative .preserved.
            var stagingPath = destinationPath + ".tmp";
            try
            {
                using (var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read,
                    FileShare.Read, 64 * 1024, FileOptions.SequentialScan))
                using (var destination = new FileStream(stagingPath, FileMode.Create,
                    FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
                {
                    var buffer = new byte[64 * 1024];
                    int read;
                    while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        destination.Write(buffer, 0, read);
                    }
                    destination.Flush(true);
                }
                if (File.Exists(destinationPath))
                {
                    File.Delete(stagingPath);
                    return;
                }
                File.Move(stagingPath, destinationPath);
            }
            catch
            {
                try { if (File.Exists(stagingPath)) File.Delete(stagingPath); }
                catch (Exception) { }
                throw;
            }
        }
    }

    internal sealed class NoObservationLedgerFaults : IObservationLedgerFaults
    {
        public void BeforePreserve() { }
        public void BeforeSwitch() { }
        public void AfterSwitch() { }
    }

    /// <summary>
    /// Outcome of a bounded bulk state transition. It exists so a plan-time
    /// quarantine or a transport-time deferral is one durable snapshot, not one
    /// commit per row. Only exact existing identities (UID/revision/RowJson) are
    /// eligible; a conflict refuses the whole batch instead of mutating a subset.
    /// </summary>
    public sealed class ObservationLedgerBulkResult
    {
        internal ObservationLedgerBulkResult(ObservationLedgerTransitionStatus status,
            int changedCount, int notFoundCount, string diagnostic, long actualBytes,
            long reservedBytes, int entryCount)
        {
            Status = status;
            ChangedCount = changedCount;
            NotFoundCount = notFoundCount;
            Diagnostic = diagnostic;
            ActualBytes = actualBytes;
            ReservedBytes = reservedBytes;
            EntryCount = entryCount;
        }

        public ObservationLedgerTransitionStatus Status { get; private set; }
        public bool Committed { get { return Status == ObservationLedgerTransitionStatus.Committed; } }
        public int ChangedCount { get; private set; }
        public int NotFoundCount { get; private set; }
        public string Diagnostic { get; private set; }
        public long ActualBytes { get; private set; }
        public long ReservedBytes { get; private set; }
        public int EntryCount { get; private set; }
    }

    /// <summary>
    /// Durable version-1 observation sidecar. One full snapshot, one atomic switch,
    /// no second payload copy and no delivery shortcut.
    /// </summary>
    public sealed class ObservationLedgerStore
    {
        private const int HardMaxEntries = 64;
        private const int HardMaxBytes = 1024 * 1024;
        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

        private readonly object _gate = new object();
        private readonly string _path;
        private readonly string _tempPath;
        private readonly string _backupPath;
        private readonly string _preservePath;
        private readonly string _preserveTempPath;
        private readonly ObservationLedgerOptions _options;
        private readonly IObservationLedgerFileSystem _files;
        private readonly IObservationLedgerFaults _faults;
        private readonly Dictionary<string, Reservation> _reservations =
            new Dictionary<string, Reservation>(StringComparer.Ordinal);

        private List<ObservationLedgerEntry> _entries = new List<ObservationLedgerEntry>();
        private int _captureRefused;
        private int _quarantineTotal;
        private int _deliveredTotal;
        private long _actualBytes;
        private long _reservedBytes;
        private bool _failedClosed;
        private string _persistenceError;

        private sealed class Reservation
        {
            public long Budget;
            public ObservationPairingBinding Binding;
            // Immutable exact original payload. A reservation is not a budget
            // placeholder: a retry must present these same bytes.
            public string RowJson;
        }

        private enum SwitchOutcome
        {
            Committed,
            FailedBeforeSwitch,
            Uncertain
        }

        private enum ReservationReleaseOutcome
        {
            Released,
            Adopted,
            Conflict,
            Unresolved
        }

        public ObservationLedgerStore(string path)
            : this(path, new ObservationBindingFence(null), new ObservationLedgerOptions(),
                new ObservationLedgerFileSystem(), new NoObservationLedgerFaults())
        {
        }

        public ObservationLedgerStore(string path, ObservationBindingFence bindingFence)
            : this(path, bindingFence, new ObservationLedgerOptions(),
                new ObservationLedgerFileSystem(), new NoObservationLedgerFaults())
        {
        }

        internal ObservationLedgerStore(string path, ObservationBindingFence bindingFence,
            ObservationLedgerOptions options, IObservationLedgerFileSystem files,
            IObservationLedgerFaults faults)
        {
            if (path == null) throw new ArgumentNullException("path");
            _path = path;
            _tempPath = path + ".tmp";
            _backupPath = path + ".bak";
            _preservePath = path + ".preserved";
            _preserveTempPath = _preservePath + ".tmp";
            BindingFence = bindingFence ?? new ObservationBindingFence(null);
            _options = options ?? new ObservationLedgerOptions();
            _files = files ?? new ObservationLedgerFileSystem();
            _faults = faults ?? new NoObservationLedgerFaults();
            Load();
        }

        public string Path { get { return _path; } }
        public string PreservePath { get { return _preservePath; } }
        public ObservationBindingFence BindingFence { get; private set; }
        public int EntryCount { get { lock (_gate) { return _entries.Count; } } }
        public int ReservationCount { get { lock (_gate) { return _reservations.Count; } } }
        public int CaptureRefused { get { lock (_gate) { return _captureRefused; } } }
        public int QuarantineTotal { get { lock (_gate) { return _quarantineTotal; } } }
        /// <summary>Cumulative confirmed observation deliveries; never derived from an empty queue.</summary>
        public int DeliveredTotal { get { lock (_gate) { return _deliveredTotal; } } }
        public long ActualBytes { get { lock (_gate) { return _actualBytes; } } }
        public long ReservedBytes { get { lock (_gate) { return _reservedBytes; } } }
        public bool IsFailedClosed { get { lock (_gate) { return _failedClosed; } } }
        public string PersistenceError { get { lock (_gate) { return _persistenceError; } } }

        internal int EffectiveMaxEntries
        {
            get { return Math.Max(1, Math.Min(_options.MaxEntries, HardMaxEntries)); }
        }

        internal int EffectiveMaxBytes
        {
            get { return Math.Max(1, Math.Min(_options.MaxSnapshotBytes, HardMaxBytes)); }
        }

        public IList<ObservationLedgerEntry> Entries
        {
            get { lock (_gate) { return ObservationLedgerView.Copy(_entries); } }
        }

        public ObservationLedgerEntry Find(string uid, int recordRevision)
        {
            lock (_gate)
            {
                var key = IdentityKey(uid, recordRevision);
                for (var index = 0; index < _entries.Count; index++)
                {
                    if (IdentityKey(_entries[index].Uid, _entries[index].RecordRevision) == key)
                        return _entries[index];
                }
                return null;
            }
        }

        /// <summary>Reload from disk; an existing fail-closed state is re-evaluated.</summary>
        public void Load()
        {
            lock (_gate)
            {
                _entries = new List<ObservationLedgerEntry>();
                _reservations.Clear();
                _captureRefused = 0;
                _quarantineTotal = 0;
                _deliveredTotal = 0;
                _actualBytes = 0;
                _reservedBytes = ObservationLedgerBudget.RootWorstBytes();
                _failedClosed = false;
                _persistenceError = null;

                bool targetExists;
                bool backupExists;
                bool tempExists;
                try
                {
                    targetExists = _files.Exists(_path);
                    backupExists = _files.Exists(_backupPath);
                    tempExists = _files.Exists(_tempPath);
                }
                catch (Exception exception)
                {
                    // An unreadable directory is not a fresh install.
                    _failedClosed = true;
                    _persistenceError = "exists_failed:" + exception.GetType().Name;
                    return;
                }

                var orphanTemp = !targetExists && !backupExists && tempExists;
                if (!targetExists && !orphanTemp)
                {
                    byte[] backupBytes;
                    if (backupExists)
                    {
                        if (TryLoadFile(_backupPath, out backupBytes))
                        {
                            if (!Restore(backupBytes, "target_missing_restored_from_backup"))
                            {
                                _failedClosed = true;
                            }
                            return;
                        }
                        // A present but unusable backup is evidence of an earlier store;
                        // do not pretend this is a fresh install.
                        _failedClosed = true;
                        if (string.IsNullOrEmpty(_persistenceError))
                            _persistenceError = "backup_invalid";
                        return;
                    }
                    // A fresh install has no target and no backup; that is the only
                    // legitimate empty start.
                    _reservedBytes = ObservationLedgerBudget.RootWorstBytes();
                    return;
                }
                if (orphanTemp)
                {
                    // A temporary file without target or backup is the only evidence of
                    // an interrupted first commit. It is not authoritative, but starting
                    // empty would silently lose it.
                    _failedClosed = true;
                    _persistenceError = "orphan_tmp_without_target";
                    return;
                }

                try { _files.Delete(_tempPath); }
                catch (Exception) { /* tmp is never authoritative; cleanup is best effort */ }

                if (TryLoadFile(_path, out byte[] _))
                {
                    return;
                }

                // Preserve the complete corrupt/unknown target once, then try a fully
                // valid backup. The corrupt file is evidence, never silently nulled.
                string preserveError;
                PreserveTarget(out preserveError);
                if (preserveError != null)
                {
                    _persistenceError = "preserve_failed:" + preserveError;
                    _failedClosed = true;
                    return;
                }

                byte[] validBackup;
                if (backupExists && TryLoadFile(_backupPath, out validBackup))
                {
                    if (!Restore(validBackup, "target_invalid_restored_from_backup"))
                    {
                        _failedClosed = true;
                    }
                    return;
                }

                _failedClosed = true;
            }
        }

        public ObservationLedgerCaptureResult Capture(ObservationLedgerCandidate candidate)
        {
            if (candidate == null) throw new ArgumentNullException("candidate");
            lock (_gate)
            {
                if (_failedClosed)
                {
                    return CaptureResult(ObservationLedgerCaptureStatus.RefusedStoreFailedClosed,
                        candidate, null, "ledger_failed_closed", false);
                }

                var key = IdentityKey(candidate.Uid, candidate.RecordRevision);
                ObservationLedgerEntry existing = null;
                for (var index = 0; index < _entries.Count; index++)
                {
                    if (IdentityKey(_entries[index].Uid, _entries[index].RecordRevision) == key)
                    {
                        existing = _entries[index];
                        break;
                    }
                }
                if (existing != null)
                {
                    // A committed entry is authoritative; any stale alias reservation
                    // must not keep counting a second time.
                    _reservations.Remove(key);
                    if (string.Equals(existing.RowJson, candidate.RowJson, StringComparison.Ordinal)
                        && ObservationBindingFence.SameBinding(existing.Binding, candidate.Binding))
                    {
                        return CaptureResult(ObservationLedgerCaptureStatus.AlreadyCaptured,
                            candidate, null, "already_captured", false);
                    }
                    return CaptureResult(ObservationLedgerCaptureStatus.RefusedConflict,
                        candidate, null, "identity_payload_conflict", false);
                }

                var newEntry = new ObservationLedgerEntry(candidate.Uid, candidate.RecordRevision,
                    ObservationLedgerState.Pending, candidate.RowJson, null,
                    candidate.Binding.CaptureDeviceId, candidate.Binding.CaptureOwnerUserId,
                    candidate.Binding.PairingGeneration, candidate.Binding.PairingGenerationKnown,
                    candidate.EnqueuedAtUtc, 0, null);

                var entriesToCommit = new List<ObservationLedgerEntry>(_entries);
                entriesToCommit.Add(newEntry);

                var reservationExists = _reservations.ContainsKey(key);
                if (reservationExists)
                {
                    var reservation = _reservations[key];
                    var sameBudget = reservation.Budget == EntryBudget(newEntry);
                    var sameBinding = ObservationBindingFence.SameBinding(reservation.Binding,
                        candidate.Binding);
                    var samePayload = string.Equals(reservation.RowJson, candidate.RowJson,
                        StringComparison.Ordinal);
                    if (!sameBudget || !sameBinding || !samePayload)
                    {
                        return CaptureResult(ObservationLedgerCaptureStatus.RefusedConflict,
                            candidate, null, "identity_payload_conflict", false);
                    }
                }
                else
                {
                    var budget = EntryBudget(newEntry);
                    _reservations[key] = new Reservation
                    {
                        Budget = budget,
                        Binding = candidate.Binding,
                        RowJson = candidate.RowJson
                    };
                }

                int effectiveCount;
                var reservedTotal = EffectiveWorst(entriesToCommit, out effectiveCount);
                if (effectiveCount > EffectiveMaxEntries || reservedTotal > EffectiveMaxBytes)
                {
                    if (!reservationExists) _reservations.Remove(key);
                    return Refuse(candidate, ObservationLedgerReasons.ObservationCaptureRefused,
                        "quota_exceeded");
                }

                var status = ObservationLedgerCaptureStatus.NotCommitted;
                var diagnostic = "not_attempted";
                var quotaRefusal = false;
                var committed = false;
                var uncertain = false;

                var fenceRan = BindingFence.TryExecuteIfCurrent(candidate.Binding, delegate
                {
                    // Final check against the last committed snapshot, under the same
                    // fence that a local rebind must acquire.
                    int finalCount;
                    var finalReserved = EffectiveWorst(entriesToCommit, out finalCount);
                    if (finalCount > EffectiveMaxEntries || finalReserved > EffectiveMaxBytes)
                    {
                        quotaRefusal = true;
                        return;
                    }

                    var savedAt = ClockNow();
                    string json;
                    long actualBytes;
                    try
                    {
                        json = ObservationLedgerSnapshotCodec.Serialize(entriesToCommit,
                            _captureRefused, _quarantineTotal, _deliveredTotal, savedAt);
                        actualBytes = ObservationLedgerBudget.Utf8(json);
                    }
                    catch (Exception error)
                    {
                        status = ObservationLedgerCaptureStatus.NotCommitted;
                        diagnostic = "snapshot_serialize_failed:" + error.GetType().Name;
                        return;
                    }

                    if (actualBytes > finalReserved || finalReserved > EffectiveMaxBytes)
                    {
                        quotaRefusal = true;
                        return;
                    }

                    bool switched = false;
                    bool ok = false;
                    string writeError = null;
                    try
                    {
                        _files.WriteTemporary(_tempPath, StrictUtf8.GetBytes(json));
                        _faults.BeforeSwitch();
                        switched = true;
                        if (SafeExists(_path)) _files.Replace(_tempPath, _path, _backupPath);
                        else _files.Move(_tempPath, _path);
                        _faults.AfterSwitch();
                        ok = true;
                    }
                    catch (Exception error)
                    {
                        writeError = error.GetType().Name + ":" + error.Message;
                        if (!switched)
                        {
                            ok = false;
                        }
                        else
                        {
                            uncertain = true;
                        }
                    }

                    if (ok)
                    {
                        _entries = entriesToCommit;
                        _reservations.Remove(key);
                        _actualBytes = actualBytes;
                        _reservedBytes = finalReserved;
                        committed = true;
                        status = ObservationLedgerCaptureStatus.Captured;
                        diagnostic = null;
                    }
                    else if (uncertain)
                    {
                        status = ObservationLedgerCaptureStatus.Uncertain;
                        diagnostic = "uncertain_switch:" + writeError;
                    }
                    else
                    {
                        status = ObservationLedgerCaptureStatus.NotCommitted;
                        diagnostic = "precommit_io:" + writeError;
                    }
                });

                if (!fenceRan)
                {
                    return RefusalAfterReleaseReadback(candidate, key,
                        ObservationLedgerReasons.CaptureBindingChanged,
                        "binding_changed_before_commit");
                }
                if (quotaRefusal)
                {
                    return RefusalAfterReleaseReadback(candidate, key,
                        ObservationLedgerReasons.ObservationCaptureRefused,
                        "quota_exceeded_before_switch");
                }
                if (committed)
                {
                    return CaptureResult(ObservationLedgerCaptureStatus.Captured, candidate,
                        null, null, false);
                }
                if (uncertain)
                {
                    return RecoverUncertain(candidate, status, diagnostic);
                }
                return CaptureResult(ObservationLedgerCaptureStatus.NotCommitted, candidate,
                    null, diagnostic, false);
            }
        }

        public ObservationLedgerTransitionResult Defer(string uid, int recordRevision,
            string reasonCode, DateTime nowUtc, DateTime nextAttemptUtc)
        {
            ObservationLedgerReason reason;
            if (!ObservationLedgerReasons.TryParse(reasonCode, out reason)
                || !ObservationLedgerReasons.IsDeferred(reason))
            {
                return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                    "invalid_deferred_reason", null);
            }
            if (nowUtc.Kind != DateTimeKind.Utc || nextAttemptUtc.Kind != DateTimeKind.Utc
                || nextAttemptUtc <= nowUtc)
            {
                return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                    "invalid_defer_time", null);
            }

            lock (_gate)
            {
                if (_failedClosed)
                    return Transition(ObservationLedgerTransitionStatus.RefusedStoreFailedClosed,
                        null, "ledger_failed_closed");
                var index = IndexOf(uid, recordRevision);
                if (index < 0) return Transition(ObservationLedgerTransitionStatus.NotFound,
                    reasonCode, "entry_not_found");
                var entry = _entries[index];
                if (entry.State == ObservationLedgerState.Quarantine)
                    return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                        reasonCode, "quarantine_is_terminal");
                if (entry.Attempts == int.MaxValue)
                    return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                        reasonCode, "attempts_overflow");
                return TransitionCommit(index,
                    entry.WithState(ObservationLedgerState.Deferred, reason,
                        entry.Attempts + 1, ObservationLedgerCandidate.TruncateToMilliseconds(nextAttemptUtc)),
                    false, reasonCode);
            }
        }

        public ObservationLedgerTransitionResult Quarantine(string uid, int recordRevision,
            string reasonCode)
        {
            ObservationLedgerReason reason;
            if (!ObservationLedgerReasons.TryParse(reasonCode, out reason))
            {
                // Unknown server rejection is stored as one fixed local code.
                reason = ObservationLedgerReason.ServerRejectedUnknown;
            }
            if (!ObservationLedgerReasons.IsQuarantine(reason))
            {
                return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                    reasonCode, "deferred_reason_not_permanent");
            }

            lock (_gate)
            {
                if (_failedClosed)
                    return Transition(ObservationLedgerTransitionStatus.RefusedStoreFailedClosed,
                        null, "ledger_failed_closed");
                var index = IndexOf(uid, recordRevision);
                if (index < 0) return Transition(ObservationLedgerTransitionStatus.NotFound,
                    ObservationLedgerReasons.ToToken(reason), "entry_not_found");
                var entry = _entries[index];
                if (entry.State == ObservationLedgerState.Quarantine)
                {
                    // Quarantine is terminal; a repeated identical reason is a no-op,
                    // a different reason may not rewrite the frozen evidence.
                    if (entry.Reason == reason)
                    {
                        return Transition(ObservationLedgerTransitionStatus.Committed,
                            ObservationLedgerReasons.ToToken(reason), "already_quarantined");
                    }
                    return Transition(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                        ObservationLedgerReasons.ToToken(reason), "quarantine_is_terminal");
                }
                return TransitionCommit(index,
                    entry.WithState(ObservationLedgerState.Quarantine, reason, entry.Attempts, null),
                    true, ObservationLedgerReasons.ToToken(reason));
            }
        }

        /// <summary>
        /// Quarantines several exact existing rows in one durable snapshot. Used by
        /// the plan-time binding fence; a missing row is skipped, an identity
        /// conflict refuses the whole batch.
        /// </summary>
        public ObservationLedgerBulkResult QuarantineMany(
            IList<ObservationLedgerEntry> expected, string reasonCode)
        {
            if (expected == null || expected.Count == 0)
                return BulkResult(ObservationLedgerTransitionStatus.Committed, 0, 0,
                    "no_rows");
            ObservationLedgerReason reason;
            if (!ObservationLedgerReasons.TryParse(reasonCode, out reason))
                reason = ObservationLedgerReason.ServerRejectedUnknown;
            if (!ObservationLedgerReasons.IsQuarantine(reason))
                return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason, 0, 0,
                    "deferred_reason_not_permanent");

            lock (_gate)
            {
                if (_failedClosed)
                    return BulkResult(ObservationLedgerTransitionStatus.RefusedStoreFailedClosed,
                        0, 0, "ledger_failed_closed");

                var replacements = new Dictionary<int, ObservationLedgerEntry>();
                var notFound = 0;
                for (var index = 0; index < expected.Count; index++)
                {
                    var wanted = expected[index];
                    if (wanted == null) continue;
                    var entryIndex = IndexOf(wanted.Uid, wanted.RecordRevision);
                    if (entryIndex < 0) { notFound++; continue; }
                    var entry = _entries[entryIndex];
                    if (!string.Equals(entry.RowJson, wanted.RowJson, StringComparison.Ordinal))
                    {
                        return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                            0, notFound, "bulk_identity_conflict");
                    }
                    if (entry.State == ObservationLedgerState.Quarantine) continue;
                    if (replacements.ContainsKey(entryIndex)) continue;
                    replacements[entryIndex] = entry.WithState(ObservationLedgerState.Quarantine,
                        reason, entry.Attempts, null);
                }

                if (replacements.Count == 0)
                    return BulkResult(ObservationLedgerTransitionStatus.Committed, 0, notFound,
                        "no_changes");
                return BulkCommit(replacements, true, ObservationLedgerReasons.ToToken(reason),
                    notFound);
            }
        }

        /// <summary>
        /// Defers several exactly offered observation rows in one durable snapshot,
        /// with the accepted bounded backoff. Used after a transport failure; the UID,
        /// revision and RowJson never change.
        /// </summary>
        public ObservationLedgerBulkResult DeferMany(IList<ObservationOfferedRow> rows,
            string reasonCode, DateTime nowUtc)
        {
            if (rows == null || rows.Count == 0)
                return BulkResult(ObservationLedgerTransitionStatus.Committed, 0, 0,
                    "no_rows");
            ObservationLedgerReason reason;
            if (!ObservationLedgerReasons.TryParse(reasonCode, out reason)
                || !ObservationLedgerReasons.IsDeferred(reason))
                return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason, 0, 0,
                    "invalid_deferred_reason");
            if (nowUtc.Kind != DateTimeKind.Utc)
                return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason, 0, 0,
                    "invalid_defer_time");

            lock (_gate)
            {
                if (_failedClosed)
                    return BulkResult(ObservationLedgerTransitionStatus.RefusedStoreFailedClosed,
                        0, 0, "ledger_failed_closed");

                var replacements = new Dictionary<int, ObservationLedgerEntry>();
                var notFound = 0;
                for (var index = 0; index < rows.Count; index++)
                {
                    var offered = rows[index];
                    if (offered == null || offered.Lane != ObservationAckLane.Observation)
                    {
                        notFound++;
                        continue;
                    }
                    var entryIndex = IndexOf(offered.Uid, offered.RecordRevision);
                    if (entryIndex < 0) { notFound++; continue; }
                    var entry = _entries[entryIndex];
                    if (!string.Equals(entry.RowJson, offered.RowJson, StringComparison.Ordinal)
                        || !ObservationBindingFence.SameBinding(entry.Binding, offered.Binding))
                    {
                        return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason,
                            0, notFound, "bulk_identity_conflict");
                    }
                    if (entry.State == ObservationLedgerState.Quarantine) continue;
                    if (entry.Attempts == int.MaxValue) { notFound++; continue; }
                    if (replacements.ContainsKey(entryIndex)) continue;
                    var attempts = entry.Attempts + 1;
                    var next = ObservationLedgerCandidate.TruncateToMilliseconds(
                        nowUtc.AddSeconds(BackoffSeconds(attempts)));
                    replacements[entryIndex] = entry.WithState(ObservationLedgerState.Deferred,
                        reason, attempts, next);
                }

                if (replacements.Count == 0)
                    return BulkResult(ObservationLedgerTransitionStatus.Committed, 0, notFound,
                        "no_changes");
                return BulkCommit(replacements, false, ObservationLedgerReasons.ToToken(reason),
                    notFound);
            }
        }

        private ObservationLedgerBulkResult BulkCommit(
            Dictionary<int, ObservationLedgerEntry> replacements, bool quarantined,
            string reasonCode, int notFound)
        {
            var entries = new List<ObservationLedgerEntry>(_entries);
            foreach (var pair in replacements) entries[pair.Key] = pair.Value;

            int count;
            var reserved = EffectiveWorst(entries, out count);
            if (count > EffectiveMaxEntries || reserved > EffectiveMaxBytes)
                return BulkResult(ObservationLedgerTransitionStatus.RefusedQuota, 0, notFound,
                    "transition_budget_exceeded");

            var changed = replacements.Count;
            if (quarantined && _quarantineTotal > int.MaxValue - changed)
                return BulkResult(ObservationLedgerTransitionStatus.RefusedInvalidReason, 0,
                    notFound, "quarantine_total_overflow");
            var nextQuarantine = _quarantineTotal + (quarantined ? changed : 0);

            string json;
            long actual;
            try
            {
                json = ObservationLedgerSnapshotCodec.Serialize(entries, _captureRefused,
                    nextQuarantine, _deliveredTotal, ClockNow());
                actual = ObservationLedgerBudget.Utf8(json);
            }
            catch (Exception error)
            {
                return BulkResult(ObservationLedgerTransitionStatus.NotCommitted, 0, notFound,
                    "snapshot_serialize_failed:" + error.GetType().Name);
            }
            if (actual > reserved || reserved > EffectiveMaxBytes)
                return BulkResult(ObservationLedgerTransitionStatus.RefusedQuota, 0, notFound,
                    "transition_budget_exceeded");

            string writeError;
            var outcome = TryWriteSnapshot(json, out writeError);
            if (outcome == SwitchOutcome.FailedBeforeSwitch)
                return BulkResult(ObservationLedgerTransitionStatus.NotCommitted, 0, notFound,
                    "precommit_io:" + writeError);
            if (outcome == SwitchOutcome.Uncertain)
            {
                string reconcile;
                if (ReconcileFullSnapshot(entries, _captureRefused, nextQuarantine,
                        _deliveredTotal, out reconcile))
                    return BulkResult(ObservationLedgerTransitionStatus.Committed, changed,
                        notFound, reasonCode);
                return BulkResult(ObservationLedgerTransitionStatus.NotCommitted, 0, notFound,
                    "uncertain_switch:" + writeError + ";" + reconcile);
            }

            _entries = entries;
            _quarantineTotal = nextQuarantine;
            _actualBytes = actual;
            _reservedBytes = reserved;
            return BulkResult(ObservationLedgerTransitionStatus.Committed, changed, notFound,
                reasonCode);
        }

        private ObservationLedgerBulkResult BulkResult(ObservationLedgerTransitionStatus status,
            int changed, int notFound, string diagnostic)
        {
            lock (_gate)
            {
                return new ObservationLedgerBulkResult(status, changed, notFound, diagnostic,
                    _actualBytes, _reservedBytes, _entries.Count);
            }
        }

        private ObservationLedgerTransitionResult TransitionCommit(int index,
            ObservationLedgerEntry replacement, bool quarantined, string reasonCode)
        {
            var entries = new List<ObservationLedgerEntry>(_entries);
            entries[index] = replacement;
            int count;
            var reserved = EffectiveWorst(entries, out count);
            if (count > EffectiveMaxEntries || reserved > EffectiveMaxBytes)
            {
                return Transition(ObservationLedgerTransitionStatus.RefusedQuota,
                    reasonCode, "transition_budget_exceeded");
            }

            var nextQuarantine = _quarantineTotal == int.MaxValue
                ? int.MaxValue
                : _quarantineTotal + (quarantined ? 1 : 0);
            string json;
            long actual;
            try
            {
                json = ObservationLedgerSnapshotCodec.Serialize(entries, _captureRefused,
                    nextQuarantine, _deliveredTotal, ClockNow());
                actual = ObservationLedgerBudget.Utf8(json);
            }
            catch (Exception error)
            {
                return Transition(ObservationLedgerTransitionStatus.NotCommitted, reasonCode,
                    "snapshot_serialize_failed:" + error.GetType().Name);
            }
            if (actual > reserved || reserved > EffectiveMaxBytes)
            {
                return Transition(ObservationLedgerTransitionStatus.RefusedQuota,
                    reasonCode, "transition_budget_exceeded");
            }

            string writeError;
            var outcome = TryWriteSnapshot(json, out writeError);
            if (outcome == SwitchOutcome.FailedBeforeSwitch)
            {
                return Transition(ObservationLedgerTransitionStatus.NotCommitted,
                    reasonCode, "precommit_io:" + writeError);
            }
            if (outcome == SwitchOutcome.Uncertain)
            {
                string reconcile;
                if (ReconcileFullSnapshot(entries, _captureRefused, nextQuarantine,
                        _deliveredTotal, out reconcile))
                {
                    return Transition(ObservationLedgerTransitionStatus.Committed,
                        reasonCode, null);
                }
                return Transition(ObservationLedgerTransitionStatus.NotCommitted,
                    reasonCode, "uncertain_switch:" + writeError + ";" + reconcile);
            }

            _entries = entries;
            _quarantineTotal = nextQuarantine;
            _actualBytes = actual;
            _reservedBytes = reserved;
            return Transition(ObservationLedgerTransitionStatus.Committed, reasonCode, null);
        }

        private ObservationLedgerCaptureResult RecoverUncertain(ObservationLedgerCandidate candidate,
            ObservationLedgerCaptureStatus fallbackStatus, string fallbackDiagnostic)
        {
            var key = IdentityKey(candidate.Uid, candidate.RecordRevision);
            List<ObservationLedgerEntry> recoveredEntries;
            int captureRefused;
            int quarantineTotal;
            int deliveredTotal;
            long actual;
            long reserved;
            string error;
            // Exact durable adoption: an uncertain capture must not resume unrelated
            // deferred rows. A real Load restart keeps the accepted Resume behavior.
            if (!TryReadSnapshot(_path, false, out recoveredEntries, out captureRefused,
                    out quarantineTotal, out deliveredTotal, out actual, out reserved, out error))
            {
                _failedClosed = true;
                _persistenceError = "uncertain_switch_unreadable:" + error;
                return CaptureResult(ObservationLedgerCaptureStatus.Uncertain, candidate,
                    null, fallbackDiagnostic + ";target_unreadable", false);
            }

            for (var index = 0; index < recoveredEntries.Count; index++)
            {
                if (IdentityKey(recoveredEntries[index].Uid, recoveredEntries[index].RecordRevision) != key)
                    continue;
                if (!string.Equals(recoveredEntries[index].RowJson, candidate.RowJson,
                        StringComparison.Ordinal)
                    || !ObservationBindingFence.SameBinding(recoveredEntries[index].Binding,
                        candidate.Binding))
                {
                    _failedClosed = true;
                    _persistenceError = "uncertain_switch_identity_conflict";
                    return CaptureResult(ObservationLedgerCaptureStatus.Uncertain, candidate,
                        null, "uncertain_switch_identity_conflict", false);
                }

                _entries = recoveredEntries;
                _captureRefused = captureRefused;
                _quarantineTotal = quarantineTotal;
                _deliveredTotal = deliveredTotal;
                _actualBytes = actual;
                _reservations.Remove(key);
                RecomputeReserved();
                return CaptureResult(ObservationLedgerCaptureStatus.Captured, candidate,
                    null, "adopted_committed_entry", false);
            }

            // A fully valid target without this identity proves the switch did not
            // publish it. The reservation and exact candidate stay retryable.
            _entries = recoveredEntries;
            _captureRefused = captureRefused;
            _quarantineTotal = quarantineTotal;
            _deliveredTotal = deliveredTotal;
            _actualBytes = actual;
            RecomputeReserved();
            return CaptureResult(ObservationLedgerCaptureStatus.NotCommitted, candidate,
                null, "target_unchanged_after_uncertain_switch", false);
        }

        /// <summary>
        /// A definite pre-switch refusal may drop an unpublished claim, but only
        /// after the authoritative target proves that the identity is absent. A
        /// previous uncertain switch may have published it; then the full durable
        /// snapshot is adopted instead of being overwritten or forgotten.
        /// </summary>
        private ReservationReleaseOutcome ReleaseReservationForDefiniteRefusal(string key)
        {
            Reservation reservation;
            if (!_reservations.TryGetValue(key, out reservation))
                return ReservationReleaseOutcome.Released;

            if (!SafeExists(_path))
            {
                _reservations.Remove(key);
                return ReservationReleaseOutcome.Released;
            }

            List<ObservationLedgerEntry> diskEntries;
            int diskCaptureRefused;
            int diskQuarantineTotal;
            int diskDeliveredTotal;
            long diskActual;
            long diskReserved;
            string readError;
            if (!TryReadSnapshot(_path, false, out diskEntries, out diskCaptureRefused,
                    out diskQuarantineTotal, out diskDeliveredTotal, out diskActual,
                    out diskReserved, out readError))
            {
                // Absence cannot be proven: keep the claim and stop mutating.
                _failedClosed = true;
                _persistenceError = "reservation_release_readback_failed:" + readError;
                return ReservationReleaseOutcome.Unresolved;
            }

            ObservationLedgerEntry durable = null;
            for (var index = 0; index < diskEntries.Count; index++)
            {
                if (IdentityKey(diskEntries[index].Uid, diskEntries[index].RecordRevision) == key)
                {
                    durable = diskEntries[index];
                    break;
                }
            }

            if (durable != null)
            {
                if (!string.Equals(durable.RowJson, reservation.RowJson, StringComparison.Ordinal)
                    || !ObservationBindingFence.SameBinding(durable.Binding, reservation.Binding))
                {
                    _failedClosed = true;
                    _persistenceError = "reservation_release_identity_conflict";
                    return ReservationReleaseOutcome.Conflict;
                }
                AdoptSnapshot(diskEntries, diskCaptureRefused, diskQuarantineTotal,
                    diskDeliveredTotal, diskActual);
                _reservations.Remove(key);
                RecomputeReserved();
                return ReservationReleaseOutcome.Adopted;
            }

            AdoptSnapshot(diskEntries, diskCaptureRefused, diskQuarantineTotal,
                diskDeliveredTotal, diskActual);
            _reservations.Remove(key);
            RecomputeReserved();
            return ReservationReleaseOutcome.Released;
        }

        /// <summary>
        /// Maps the definitive-refusal readback to one result policy for both the
        /// binding and quota branches. Only a successful readback that proves the
        /// identity absent may produce a definite refusal. An unresolved readback
        /// leaves the reservation and failed-closed state intact and returns a
        /// non-definitive status, so no caller can turn it into a fresh legacy row.
        /// </summary>
        private ObservationLedgerCaptureResult RefusalAfterReleaseReadback(
            ObservationLedgerCandidate candidate, string key, string reasonCode, string diagnostic)
        {
            var release = ReleaseReservationForDefiniteRefusal(key);
            if (release == ReservationReleaseOutcome.Adopted)
            {
                return CaptureResult(ObservationLedgerCaptureStatus.AlreadyCaptured,
                    candidate, null, "adopted_committed_entry", false);
            }
            if (release == ReservationReleaseOutcome.Conflict)
            {
                return CaptureResult(ObservationLedgerCaptureStatus.RefusedConflict,
                    candidate, null, "identity_payload_conflict", false);
            }
            if (release == ReservationReleaseOutcome.Unresolved)
            {
                // No proof that nothing was committed: do not call Refuse and do
                // not increment/persist captureRefused. The reservation stays.
                return CaptureResult(ObservationLedgerCaptureStatus.Uncertain, candidate,
                    null, "reservation_release_unresolved:" + diagnostic, false);
            }
            return Refuse(candidate, reasonCode, diagnostic);
        }

        /// <summary>
        /// Reconciles the whole durable snapshot after an uncertain switch. The
        /// expected snapshot is compared field by field (savedAtUtc is not part of
        /// identity). Whatever is on disk is authoritative for memory.
        /// </summary>
        private bool ReconcileFullSnapshot(IList<ObservationLedgerEntry> expectedEntries,
            int expectedCaptureRefused, int expectedQuarantineTotal, int expectedDeliveredTotal,
            out string diagnostic)
        {
            diagnostic = null;
            List<ObservationLedgerEntry> diskEntries;
            int diskCaptureRefused;
            int diskQuarantineTotal;
            int diskDeliveredTotal;
            long diskActual;
            long diskReserved;
            string readError;
            if (!TryReadSnapshot(_path, false, out diskEntries, out diskCaptureRefused,
                    out diskQuarantineTotal, out diskDeliveredTotal, out diskActual,
                    out diskReserved, out readError))
            {
                _failedClosed = true;
                _persistenceError = "uncertain_switch_unreadable:" + readError;
                diagnostic = "target_unreadable";
                return false;
            }

            var matches = SnapshotEquals(expectedEntries, expectedCaptureRefused,
                expectedQuarantineTotal, expectedDeliveredTotal, diskEntries,
                diskCaptureRefused, diskQuarantineTotal, diskDeliveredTotal);
            AdoptSnapshot(diskEntries, diskCaptureRefused, diskQuarantineTotal,
                diskDeliveredTotal, diskActual);
            if (!matches) diagnostic = "target_snapshot_mismatch";
            return matches;
        }

        private static bool SnapshotEquals(IList<ObservationLedgerEntry> left,
            int leftCaptureRefused, int leftQuarantineTotal, int leftDeliveredTotal,
            IList<ObservationLedgerEntry> right, int rightCaptureRefused,
            int rightQuarantineTotal, int rightDeliveredTotal)
        {
            if (leftCaptureRefused != rightCaptureRefused
                || leftQuarantineTotal != rightQuarantineTotal
                || leftDeliveredTotal != rightDeliveredTotal
                || left.Count != right.Count)
                return false;
            for (var index = 0; index < left.Count; index++)
            {
                if (!SameEntry(left[index], right[index])) return false;
            }
            return true;
        }

        private static bool SameEntry(ObservationLedgerEntry left, ObservationLedgerEntry right)
        {
            return string.Equals(left.Uid, right.Uid, StringComparison.Ordinal)
                && left.RecordRevision == right.RecordRevision
                && left.State == right.State
                && string.Equals(left.RowJson, right.RowJson, StringComparison.Ordinal)
                && left.Reason == right.Reason
                && string.Equals(left.CaptureDeviceId, right.CaptureDeviceId,
                    StringComparison.OrdinalIgnoreCase)
                && string.Equals(left.CaptureOwnerUserId, right.CaptureOwnerUserId,
                    StringComparison.OrdinalIgnoreCase)
                && left.PairingGeneration == right.PairingGeneration
                && left.PairingGenerationKnown == right.PairingGenerationKnown
                && left.EnqueuedAtUtc == right.EnqueuedAtUtc
                && left.Attempts == right.Attempts
                && left.NextAttemptUtc == right.NextAttemptUtc;
        }

        private void AdoptSnapshot(List<ObservationLedgerEntry> entries, int captureRefused,
            int quarantineTotal, int deliveredTotal, long actual)
        {
            _entries = entries;
            _captureRefused = captureRefused;
            _quarantineTotal = quarantineTotal;
            _deliveredTotal = deliveredTotal;
            _actualBytes = actual;
            // De schijf-snapshot kent alleen duurzame rijen. Een onopgeloste
            // reservering is nog een echte claim op het budget en moet in het
            // gerapporteerde worst-state blijven meetellen, zonder dubbeltelling
            // van een UID/revisie die inmiddels duurzaam bestaat.
            RecomputeReserved();
        }

        /// <summary>
        /// Herberekent het gerapporteerde worst-case budget uit de gezaghebbende
        /// duurzame rijen plus alle nog onopgeloste, niet-aliasing reserveringen.
        /// </summary>
        private void RecomputeReserved()
        {
            int count;
            _reservedBytes = EffectiveWorst(_entries, out count);
        }

        private ObservationLedgerCaptureResult Refuse(ObservationLedgerCandidate candidate,
            string reasonCode, string diagnostic)
        {
            if (_captureRefused < int.MaxValue) _captureRefused++;
            int count;
            var reserved = EffectiveWorst(_entries, out count);
            var persisted = false;
            if (!_failedClosed)
            {
                string json;
                long actual;
                try
                {
                    json = ObservationLedgerSnapshotCodec.Serialize(_entries, _captureRefused,
                        _quarantineTotal, _deliveredTotal, ClockNow());
                    actual = ObservationLedgerBudget.Utf8(json);
                }
                catch (Exception)
                {
                    if (_captureRefused > 0) _captureRefused--;
                    return CaptureResult(ObservationLedgerCaptureStatus.RefusedQuota,
                        candidate, reasonCode, diagnostic + ";counter_not_persisted", false);
                }

                string writeError;
                if (actual > reserved || reserved > EffectiveMaxBytes)
                {
                    if (_captureRefused > 0) _captureRefused--;
                }
                else
                {
                    var outcome = TryWriteSnapshot(json, out writeError);
                    if (outcome == SwitchOutcome.Committed)
                    {
                        _actualBytes = actual;
                        _reservedBytes = reserved;
                        persisted = true;
                    }
                    else if (outcome == SwitchOutcome.Uncertain)
                    {
                        string reconcile;
                        if (ReconcileFullSnapshot(_entries, _captureRefused, _quarantineTotal,
                                _deliveredTotal, out reconcile))
                        {
                            persisted = true;
                        }
                    }
                    else
                    {
                        if (_captureRefused > 0) _captureRefused--;
                    }
                }
            }
            var status = reasonCode == ObservationLedgerReasons.CaptureBindingChanged
                ? ObservationLedgerCaptureStatus.RefusedBindingChanged
                : ObservationLedgerCaptureStatus.RefusedQuota;
            return CaptureResult(status, candidate, reasonCode, diagnostic, persisted);
        }

        private ObservationLedgerCaptureResult CaptureResult(ObservationLedgerCaptureStatus status,
            ObservationLedgerCandidate candidate, string reasonCode, string diagnostic,
            bool counterPersisted)
        {
            return new ObservationLedgerCaptureResult(status, candidate.Uid,
                candidate.RecordRevision, reasonCode, diagnostic, _entries.Count,
                _reservations.Count, _actualBytes, _reservedBytes, counterPersisted);
        }

        /// <summary>
        /// Past één geclassificeerd ACK atomair toe. De methode accepteert geen
        /// caller-boolean en geen losse UID: alleen een echte
        /// <see cref="ObservationAckResolution"/> met de volledige aangeboden
        /// batch en de pairing-epoch waaronder die is aangeboden.
        /// </summary>
        public ObservationAckApplyResult ApplyAck(ObservationAckResolution resolution, DateTime nowUtc)
        {
            if (resolution == null) throw new ArgumentNullException("resolution");
            if (resolution.Batch == null) throw new ArgumentException("ack_batch_missing", "resolution");
            if (nowUtc.Kind != DateTimeKind.Utc)
                return AckNoChange(ObservationAckApplyStatus.RefusedInvalid, resolution,
                    "apply_time_not_utc");

            var expected = resolution.ExpectedBinding;
            lock (_gate)
            {
                if (_failedClosed)
                    return AckNoChange(ObservationAckApplyStatus.RefusedStoreFailedClosed,
                        resolution, "ledger_failed_closed");
                if (expected == null || !expected.IsComplete)
                    return AckNoChange(ObservationAckApplyStatus.RefusedStaleEpoch,
                        resolution, "ack_binding_incomplete");
                if (!BindingFence.IsCurrent(expected))
                    return AckNoChange(ObservationAckApplyStatus.RefusedStaleEpoch,
                        resolution, "ack_stale_epoch");
                if (!resolution.HasMeasurements || !resolution.SeriesStored)
                {
                    // stored:false, geen measurements of een onparseerbaar ACK is
                    // geen leveringsbewijs: niets verwijderen, niets tellen.
                    return AckNoChange(ObservationAckApplyStatus.NoChanges, resolution,
                        resolution.Diagnostic ?? "ack_not_stored");
                }

                ObservationAckApplyResult applied = null;
                var ran = BindingFence.TryExecuteIfCurrent(expected, delegate
                {
                    applied = ApplyAckLocked(resolution, nowUtc, expected);
                });
                if (!ran)
                {
                    return AckNoChange(ObservationAckApplyStatus.RefusedStaleEpoch,
                        resolution, "ack_stale_epoch");
                }
                return applied;
            }
        }

        private ObservationAckApplyResult ApplyAckLocked(ObservationAckResolution resolution,
            DateTime nowUtc, ObservationPairingBinding expected)
        {
            var plan = new AckPlan[resolution.Rows.Count];
            var entries = new List<ObservationLedgerEntry>(_entries);
            var removed = new bool[entries.Count];
            var replacements = new Dictionary<int, ObservationLedgerEntry>();
            var deliveredIndexes = new List<int>();
            var delivered = new List<DeliveredAckRow>();
            var indexByIdentity = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var index = 0; index < entries.Count; index++)
            {
                indexByIdentity[IdentityKey(entries[index].Uid, entries[index].RecordRevision)] = index;
            }

            for (var rowIndex = 0; rowIndex < resolution.Rows.Count; rowIndex++)
            {
                var row = resolution.Rows[rowIndex];
                if (row.Lane != ObservationAckLane.Observation)
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered, null);
                    continue;
                }
                if (!ObservationBindingFence.SameBinding(row.Offered.Binding, expected))
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.StaleEpoch,
                        "ack_stale_offer_binding");
                    continue;
                }
                if (row.Outcome == ObservationAckClass.NotDelivered)
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                        row.Diagnostic);
                    continue;
                }

                int entryIndex;
                if (!indexByIdentity.TryGetValue(
                        IdentityKey(row.Uid, row.RecordRevision), out entryIndex))
                {
                    // Geen tombstone en geen geschiedenis: een replay of een
                    // onbekende UID levert alleen een diagnose, nooit een teller
                    // of een nieuwe entry.
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.UnknownUid,
                        "ack_unknown_uid");
                    continue;
                }

                var entry = entries[entryIndex];
                if (!ObservationBindingFence.SameBinding(entry.Binding, expected))
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.StaleEpoch,
                        "ack_stale_epoch");
                    continue;
                }
                if (removed[entryIndex] || replacements.ContainsKey(entryIndex))
                {
                    return AckNoChange(ObservationAckApplyStatus.RefusedInvalid, resolution,
                        "ack_duplicate_row_plan");
                }

                // De aangeboden identiteit is pas bewijs als ook de exacte
                // bytes en de binding nog de duurzame rij zijn. Deze fence staat
                // vóór élke muterende branch (delivery, deferred, quarantaine).
                if (!string.Equals(entry.RowJson, row.Offered.RowJson, StringComparison.Ordinal))
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.IdentityConflict,
                        "ack_row_json_conflict");
                    continue;
                }

                if (row.Outcome == ObservationAckClass.Accepted
                    || row.Outcome == ObservationAckClass.Duplicate
                    || row.Outcome == ObservationAckClass.Superseded)
                {
                    if (entry.State == ObservationLedgerState.Quarantine)
                    {
                        // Quarantaine is terminaal. Een later ACK maakt daar geen
                        // stille deliverable van; alleen een expliciete operatoractie mag dat.
                        plan[rowIndex] = new AckPlan(
                            ObservationAckDurableOutcome.QuarantineTerminal,
                            "quarantine_is_terminal");
                        continue;
                    }
                    removed[entryIndex] = true;
                    deliveredIndexes.Add(entryIndex);
                    delivered.Add(new DeliveredAckRow(entry, entryIndex));
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.DeliveredRemoved, null);
                    continue;
                }

                ObservationLedgerReason reason;
                if (!ObservationLedgerReasons.TryParse(row.ReasonCode, out reason))
                {
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                        "ack_reason_invalid");
                    continue;
                }

                if (row.Outcome == ObservationAckClass.Deferred)
                {
                    if (!ObservationLedgerReasons.IsDeferred(reason))
                    {
                        plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                            "ack_reason_not_deferred");
                        continue;
                    }
                    if (entry.State == ObservationLedgerState.Quarantine)
                    {
                        // Quarantaine is terminaal; een later tijdelijk ACK
                        // haalt hem niet terug alsof hij nog pending was.
                        plan[rowIndex] = new AckPlan(
                            ObservationAckDurableOutcome.QuarantineTerminal,
                            "quarantine_is_terminal");
                        continue;
                    }
                    if (entry.Attempts == int.MaxValue)
                    {
                        plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                            "attempts_overflow");
                        continue;
                    }
                    var attempts = entry.Attempts + 1;
                    var next = ObservationLedgerCandidate.TruncateToMilliseconds(
                        nowUtc.AddSeconds(BackoffSeconds(attempts)));
                    replacements[entryIndex] = entry.WithState(ObservationLedgerState.Deferred,
                        reason, attempts, next);
                    plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.DeferredPersisted,
                        null);
                    continue;
                }

                if (row.Outcome == ObservationAckClass.Quarantined)
                {
                    if (!ObservationLedgerReasons.IsQuarantine(reason))
                    {
                        plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                            "ack_reason_not_permanent");
                        continue;
                    }
                    if (entry.State == ObservationLedgerState.Quarantine)
                    {
                        plan[rowIndex] = new AckPlan(
                            ObservationAckDurableOutcome.QuarantineTerminal,
                            "quarantine_is_terminal");
                        continue;
                    }
                    replacements[entryIndex] = entry.WithState(ObservationLedgerState.Quarantine,
                        reason, entry.Attempts, null);
                    plan[rowIndex] = new AckPlan(
                        ObservationAckDurableOutcome.QuarantinedPersisted, null);
                    continue;
                }

                plan[rowIndex] = new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                    "ack_outcome_unsupported");
            }

            var deliveredAdded = delivered.Count;
            var quarantineAdded = 0;
            foreach (var pair in replacements)
            {
                if (pair.Value.State == ObservationLedgerState.Quarantine
                    && entries[pair.Key].State != ObservationLedgerState.Quarantine)
                {
                    quarantineAdded++;
                }
            }

            if (deliveredAdded == 0 && replacements.Count == 0)
            {
                return AckResult(ObservationAckApplyStatus.NoChanges, resolution, plan,
                    0, 0, 0, "no_durable_changes");
            }
            if (_deliveredTotal > int.MaxValue - deliveredAdded)
            {
                return AckNoChange(ObservationAckApplyStatus.RefusedCounterOverflow,
                    resolution, "delivered_total_overflow");
            }
            if (_quarantineTotal > int.MaxValue - quarantineAdded)
            {
                return AckNoChange(ObservationAckApplyStatus.RefusedCounterOverflow,
                    resolution, "quarantine_total_overflow");
            }

            var nextEntries = new List<ObservationLedgerEntry>(
                entries.Count - deliveredIndexes.Count + replacements.Count);
            for (var index = 0; index < entries.Count; index++)
            {
                if (removed[index]) continue;
                ObservationLedgerEntry replacement;
                if (replacements.TryGetValue(index, out replacement)) nextEntries.Add(replacement);
                else nextEntries.Add(entries[index]);
            }

            int effectiveCount;
            var reserved = EffectiveWorst(nextEntries, out effectiveCount);
            if (effectiveCount > EffectiveMaxEntries || reserved > EffectiveMaxBytes)
            {
                return AckNoChange(ObservationAckApplyStatus.RefusedQuota, resolution,
                    "ack_transition_budget_exceeded");
            }

            var nextDelivered = _deliveredTotal + deliveredAdded;
            var nextQuarantine = _quarantineTotal + quarantineAdded;
            var savedAt = ClockNow();
            string json;
            long actual;
            try
            {
                json = ObservationLedgerSnapshotCodec.Serialize(nextEntries, _captureRefused,
                    nextQuarantine, nextDelivered, savedAt);
                actual = ObservationLedgerBudget.Utf8(json);
            }
            catch (Exception error)
            {
                return AckNoChange(ObservationAckApplyStatus.NotCommitted, resolution,
                    "snapshot_serialize_failed:" + error.GetType().Name);
            }
            if (actual > reserved || reserved > EffectiveMaxBytes)
            {
                return AckNoChange(ObservationAckApplyStatus.RefusedQuota, resolution,
                    "ack_transition_budget_exceeded");
            }

            var guard = new Func<bool>(delegate
            {
                // Onder de fence, onmiddellijk vóór de switch: epoch én de
                // exacte UID/revisie/RowJson van elke te verwijderen rij.
                if (!BindingFence.IsCurrent(expected)) return false;
                return VerifyAckPlan(entries, nextEntries, delivered);
            });

            string writeError;
            var outcome = TryWriteSnapshot(json, guard, out writeError);
            if (outcome == SwitchOutcome.FailedBeforeSwitch)
            {
                if (!BindingFence.IsCurrent(expected))
                {
                    return AckNoChange(ObservationAckApplyStatus.RefusedStaleEpoch, resolution,
                        "ack_stale_epoch_before_switch");
                }
                return AckNoChange(ObservationAckApplyStatus.NotCommitted, resolution,
                    "precommit_io:" + writeError);
            }
            if (outcome == SwitchOutcome.Uncertain)
            {
                string reconcile;
                if (ReconcileFullSnapshot(nextEntries, _captureRefused, nextQuarantine,
                        nextDelivered, out reconcile))
                {
                    ReleaseDeliveredReservations(delivered);
                    return AckResult(ObservationAckApplyStatus.Applied, resolution, plan,
                        deliveredAdded, CountDeferred(plan), quarantineAdded, null);
                }
                // De volledige snapshot op schijf is niet de verwachte. Er is
                // geen tweede legacy-fallback en geen gok: fail closed.
                _failedClosed = true;
                _persistenceError = "ack_uncertain_switch_mismatch:" + reconcile;
                return AckUncertain(resolution, plan, "ack_uncertain_switch_mismatch");
            }

            _entries = nextEntries;
            _quarantineTotal = nextQuarantine;
            _deliveredTotal = nextDelivered;
            _actualBytes = actual;
            _reservedBytes = reserved;
            ReleaseDeliveredReservations(delivered);
            return AckResult(ObservationAckApplyStatus.Applied, resolution, plan,
                deliveredAdded, CountDeferred(plan), quarantineAdded, null);
        }

        private bool VerifyAckPlan(IList<ObservationLedgerEntry> before,
            IList<ObservationLedgerEntry> after, IList<DeliveredAckRow> delivered)
        {
            for (var index = 0; index < delivered.Count; index++)
            {
                var item = delivered[index];
                if (item.Index < 0 || item.Index >= before.Count) return false;
                var source = before[item.Index];
                if (!string.Equals(source.Uid, item.Entry.Uid, StringComparison.OrdinalIgnoreCase)
                    || source.RecordRevision != item.Entry.RecordRevision
                    || !string.Equals(source.RowJson, item.Entry.RowJson, StringComparison.Ordinal)
                    || !ObservationBindingFence.SameBinding(source.Binding, item.Entry.Binding))
                {
                    return false;
                }
                var key = IdentityKey(item.Entry.Uid, item.Entry.RecordRevision);
                for (var other = 0; other < after.Count; other++)
                {
                    if (IdentityKey(after[other].Uid, after[other].RecordRevision) == key)
                        return false;
                }
            }
            return true;
        }

        private void ReleaseDeliveredReservations(IList<DeliveredAckRow> delivered)
        {
            for (var index = 0; index < delivered.Count; index++)
            {
                _reservations.Remove(IdentityKey(delivered[index].Entry.Uid,
                    delivered[index].Entry.RecordRevision));
            }
            // Na een onzekere verzoening kan AdoptSnapshot de nog niet
            // vrijgegeven alias hebben meegeteld; dit is het gezaghebbende moment.
            RecomputeReserved();
        }

        private int CountDeferred(AckPlan[] plan)
        {
            var count = 0;
            for (var index = 0; index < plan.Length; index++)
                if (plan[index] != null
                    && plan[index].Durable == ObservationAckDurableOutcome.DeferredPersisted)
                    count++;
            return count;
        }

        private double BackoffSeconds(int attempts)
        {
            var max = _options.BackoffMaxSeconds;
            if (double.IsNaN(max) || double.IsInfinity(max) || max <= 0) max = 60.0;
            if (max > 86400.0) max = 86400.0;
            var baseSeconds = _options.BackoffBaseSeconds;
            if (double.IsNaN(baseSeconds) || double.IsInfinity(baseSeconds) || baseSeconds <= 0)
                baseSeconds = 2.0;
            var exponent = Math.Max(0, attempts - 1);
            var seconds = baseSeconds * Math.Pow(2, exponent);
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return max;
            return Math.Min(seconds, max);
        }

        private ObservationAckApplyResult AckNoChange(ObservationAckApplyStatus status,
            ObservationAckResolution resolution, string diagnostic)
        {
            var rows = new List<ObservationAckApplyRowResult>(resolution.Rows.Count);
            for (var index = 0; index < resolution.Rows.Count; index++)
            {
                var row = resolution.Rows[index];
                rows.Add(new ObservationAckApplyRowResult(row,
                    ObservationAckDurableOutcome.NotDelivered,
                    row.Diagnostic ?? diagnostic));
            }
            return new ObservationAckApplyResult(status, rows, 0, 0, 0, 0, false,
                diagnostic, _actualBytes, _reservedBytes, _entries.Count, _deliveredTotal,
                _quarantineTotal, resolution.BlockErrorCode);
        }

        private ObservationAckApplyResult AckUncertain(ObservationAckResolution resolution,
            AckPlan[] plan, string diagnostic)
        {
            var rows = new List<ObservationAckApplyRowResult>(resolution.Rows.Count);
            for (var index = 0; index < resolution.Rows.Count; index++)
            {
                var row = resolution.Rows[index];
                var durable = row.Lane == ObservationAckLane.Observation
                    ? ObservationAckDurableOutcome.Uncertain
                    : ObservationAckDurableOutcome.NotDelivered;
                rows.Add(new ObservationAckApplyRowResult(row, durable, diagnostic));
            }
            return new ObservationAckApplyResult(ObservationAckApplyStatus.Uncertain, rows,
                0, 0, 0, 0, false, diagnostic, _actualBytes, _reservedBytes, _entries.Count,
                _deliveredTotal, _quarantineTotal, resolution.BlockErrorCode);
        }

        private ObservationAckApplyResult AckResult(ObservationAckApplyStatus status,
            ObservationAckResolution resolution, AckPlan[] plan, int deliveredCount,
            int deferredCount, int quarantinedCount, string diagnostic)
        {
            var rows = new List<ObservationAckApplyRowResult>(resolution.Rows.Count);
            var observationCount = 0;
            var deliveredRows = 0;
            var allDelivered = true;
            var unknown = 0;
            for (var index = 0; index < resolution.Rows.Count; index++)
            {
                var row = resolution.Rows[index];
                var item = plan[index] ?? new AckPlan(ObservationAckDurableOutcome.NotDelivered,
                    row.Diagnostic ?? diagnostic);
                rows.Add(new ObservationAckApplyRowResult(row, item.Durable,
                    item.Diagnostic ?? row.Diagnostic));
                if (row.Lane != ObservationAckLane.Observation) continue;
                observationCount++;
                if (item.Durable == ObservationAckDurableOutcome.DeliveredRemoved)
                    deliveredRows++;
                else allDelivered = false;
                if (item.Durable == ObservationAckDurableOutcome.UnknownUid) unknown++;
            }
            var stored = status == ObservationAckApplyStatus.Applied
                && observationCount > 0
                && allDelivered
                && deliveredRows == observationCount
                && resolution.AllObservationsDelivered;
            return new ObservationAckApplyResult(status, rows, deliveredCount, deferredCount,
                quarantinedCount, unknown, stored, diagnostic, _actualBytes, _reservedBytes,
                _entries.Count, _deliveredTotal, _quarantineTotal, resolution.BlockErrorCode);
        }

        private sealed class AckPlan
        {
            public AckPlan(ObservationAckDurableOutcome durable, string diagnostic)
            {
                Durable = durable;
                Diagnostic = diagnostic;
            }

            public ObservationAckDurableOutcome Durable { get; private set; }
            public string Diagnostic { get; private set; }
        }

        private sealed class DeliveredAckRow
        {
            public DeliveredAckRow(ObservationLedgerEntry entry, int index)
            {
                Entry = entry;
                Index = index;
            }

            public ObservationLedgerEntry Entry { get; private set; }
            public int Index { get; private set; }
        }

        private ObservationLedgerTransitionResult Transition(ObservationLedgerTransitionStatus status,
            string reasonCode, string diagnostic)
        {
            return new ObservationLedgerTransitionResult(status, reasonCode, diagnostic,
                _actualBytes, _reservedBytes);
        }

        private int IndexOf(string uid, int recordRevision)
        {
            if (string.IsNullOrEmpty(uid)) return -1;
            var key = IdentityKey(uid, recordRevision);
            for (var index = 0; index < _entries.Count; index++)
            {
                if (IdentityKey(_entries[index].Uid, _entries[index].RecordRevision) == key)
                    return index;
            }
            return -1;
        }

        private long EntryBudget(ObservationLedgerEntry entry)
        {
            return ObservationLedgerBudget.EntryWorstBytes(entry.Uid, entry.RecordRevision,
                entry.RowJson, entry.Binding, entry.EnqueuedAtUtc);
        }

        private long EffectiveWorst(IList<ObservationLedgerEntry> entries, out int effectiveCount)
        {
            var budgets = new List<long>(entries.Count + _reservations.Count);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                budgets.Add(EntryBudget(entry));
                seen.Add(IdentityKey(entry.Uid, entry.RecordRevision));
            }
            foreach (var pair in _reservations)
            {
                if (seen.Contains(pair.Key)) continue;
                budgets.Add(pair.Value.Budget);
            }
            effectiveCount = budgets.Count;
            var total = ObservationLedgerBudget.RootWorstBytes();
            for (var index = 0; index < budgets.Count; index++)
            {
                total += budgets[index];
                if (index > 0) total += 1;
            }
            return total;
        }

        private DateTime ClockNow()
        {
            var now = _options.Clock == null ? DateTime.UtcNow : _options.Clock();
            if (now.Kind != DateTimeKind.Utc) now = now.ToUniversalTime();
            return ObservationLedgerCandidate.TruncateToMilliseconds(now);
        }

        private static string IdentityKey(string uid, int revision)
        {
            return (uid ?? string.Empty).ToLowerInvariant() + "|" + revision.ToString(CultureInfo.InvariantCulture);
        }

        private bool SafeExists(string path)
        {
            try { return _files.Exists(path); }
            catch (Exception) { return false; }
        }

        private void PreserveTarget(out string error)
        {
            error = null;
            try
            {
                _faults.BeforePreserve();
                RecoverInterruptedPreserve();
                if (SafeExists(_preservePath)) return;
                _files.Preserve(_path, _preservePath);
            }
            catch (Exception exception)
            {
                error = exception.GetType().Name + ":" + exception.Message;
            }
        }

        /// <summary>
        /// A staged copy is never authoritative, whether or not a complete final
        /// preserve already exists. The source target is still intact at this
        /// point, so recovery restarts the whole-file copy deterministically.
        /// </summary>
        private void RecoverInterruptedPreserve()
        {
            if (!SafeExists(_preserveTempPath)) return;
            try { _files.Delete(_preserveTempPath); }
            catch (Exception) { /* Preserve truncates staging and only publishes atomically. */ }
        }

        private bool Restore(byte[] bytes, string reason)
        {
            string writeError;
            var outcome = TryWriteBytes(bytes, null, out writeError);
            if (outcome == SwitchOutcome.FailedBeforeSwitch)
            {
                _persistenceError = reason + "_failed:" + writeError;
                return false;
            }
            // Committed or uncertain: the re-read below is the authority. An
            // uncertain switch that did publish the valid backup is accepted
            // instead of being reported as a failed restore.
            // Re-read the just-restored target through the normal validator.
            List<ObservationLedgerEntry> entries;
            int captureRefused;
            int quarantineTotal;
            int deliveredTotal;
            long actual;
            long reserved;
            string error;
            if (!TryReadSnapshot(_path, false, out entries, out captureRefused, out quarantineTotal,
                    out deliveredTotal, out actual, out reserved, out error))
            {
                _persistenceError = reason + "_invalid:" + error;
                return false;
            }
            _entries = Resume(entries);
            _captureRefused = captureRefused;
            _quarantineTotal = quarantineTotal;
            _deliveredTotal = deliveredTotal;
            _actualBytes = actual;
            _reservedBytes = reserved;
            _persistenceError = null;
            return true;
        }

        private SwitchOutcome TryWriteSnapshot(string json, out string error)
        {
            return TryWriteBytes(StrictUtf8.GetBytes(json), null, out error);
        }

        private SwitchOutcome TryWriteSnapshot(string json, Func<bool> guard, out string error)
        {
            return TryWriteBytes(StrictUtf8.GetBytes(json), guard, out error);
        }

        private SwitchOutcome TryWriteBytes(byte[] bytes, Func<bool> guard, out string error)
        {
            error = null;
            var switched = false;
            try
            {
                _files.WriteTemporary(_tempPath, bytes);
                _faults.BeforeSwitch();
                // De laatste identiteits-/epochcontrole gebeurt onder dezelfde
                // fence en vlak vóór de publicerende switch. Een geweigerde
                // guard laat target en geheugen ongemoeid.
                if (guard != null && !guard())
                {
                    error = "guard_rejected_before_switch";
                    return SwitchOutcome.FailedBeforeSwitch;
                }
                switched = true;
                if (SafeExists(_path)) _files.Replace(_tempPath, _path, _backupPath);
                else _files.Move(_tempPath, _path);
                _faults.AfterSwitch();
                return SwitchOutcome.Committed;
            }
            catch (Exception exception)
            {
                error = exception.GetType().Name + ":" + exception.Message;
                return switched ? SwitchOutcome.Uncertain : SwitchOutcome.FailedBeforeSwitch;
            }
        }

        private bool TryLoadFile(string path, out byte[] bytes)
        {
            bytes = null;
            try
            {
                // Size is checked before any unbounded allocation or deserialization.
                if (_files.Length(path) > EffectiveMaxBytes)
                {
                    _persistenceError = "invalid_snapshot:file_too_large";
                    return false;
                }
                bytes = _files.ReadAllBytes(path);
            }
            catch (Exception exception)
            {
                _persistenceError = "read_failed:" + exception.GetType().Name;
                return false;
            }

            List<ObservationLedgerEntry> entries;
            int captureRefused;
            int quarantineTotal;
            int deliveredTotal;
            long actual;
            long reserved;
            string error;
            if (!TryValidate(bytes, out entries, out captureRefused, out quarantineTotal,
                    out deliveredTotal, out actual, out reserved, out error))
            {
                _persistenceError = "invalid_snapshot:" + error;
                return false;
            }

            _entries = Resume(entries);
            _captureRefused = captureRefused;
            _quarantineTotal = quarantineTotal;
            _deliveredTotal = deliveredTotal;
            _actualBytes = actual;
            _reservedBytes = reserved;
            _persistenceError = null;
            return true;
        }

        private bool TryReadSnapshot(string path, bool resume, out List<ObservationLedgerEntry> entries,
            out int captureRefused, out int quarantineTotal, out int deliveredTotal,
            out long actual, out long reserved, out string error)
        {
            entries = null;
            captureRefused = 0;
            quarantineTotal = 0;
            deliveredTotal = 0;
            actual = 0;
            reserved = 0;
            byte[] bytes;
            try
            {
                if (_files.Length(path) > EffectiveMaxBytes)
                {
                    error = "file_too_large";
                    return false;
                }
                bytes = _files.ReadAllBytes(path);
            }
            catch (Exception exception)
            {
                error = "read_failed:" + exception.GetType().Name;
                return false;
            }
            if (!TryValidate(bytes, out entries, out captureRefused, out quarantineTotal,
                    out deliveredTotal, out actual, out reserved, out error))
                return false;
            if (resume) entries = Resume(entries);
            return true;
        }

        private static List<ObservationLedgerEntry> Resume(List<ObservationLedgerEntry> entries)
        {
            var resumed = new List<ObservationLedgerEntry>(entries.Count);
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                // Deferred resumes as pending, retaining attempts and nextAttemptUtc.
                if (entry.State == ObservationLedgerState.Deferred)
                {
                    entry = entry.WithState(ObservationLedgerState.Pending, null,
                        entry.Attempts, entry.NextAttemptUtc);
                }
                resumed.Add(entry);
            }
            return resumed;
        }

        private bool TryValidate(byte[] bytes, out List<ObservationLedgerEntry> entries,
            out int captureRefused, out int quarantineTotal, out int deliveredTotal,
            out long actual, out long reserved, out string error)
        {
            entries = null;
            captureRefused = 0;
            quarantineTotal = 0;
            deliveredTotal = 0;
            actual = 0;
            reserved = 0;
            error = null;

            if (bytes == null || bytes.Length == 0)
            {
                error = "empty_file";
                return false;
            }
            if (bytes.Length > EffectiveMaxBytes)
            {
                error = "file_too_large:" + bytes.Length;
                return false;
            }

            string text;
            try { text = StrictUtf8.GetString(bytes); }
            catch (Exception) { error = "invalid_utf8"; return false; }

            Dictionary<string, object> root;
            try { root = MeasurementJson.DeserializeDictionary(text); }
            catch (Exception) { error = "invalid_json"; return false; }

            if (!ExactKeys(root, new[] { "version", "savedAtUtc", "counters", "entries" }))
            {
                error = "root_schema";
                return false;
            }
            long version;
            if (!Integer(root["version"], 1, 1, out version)) { error = "version"; return false; }

            string savedAtText;
            DateTime savedAt;
            if (!ObservationLedgerCandidate.TryString(root, "savedAtUtc", out savedAtText)
                || !TryParseUtc(savedAtText, out savedAt))
            {
                error = "savedAtUtc";
                return false;
            }

            var counters = root["counters"] as Dictionary<string, object>;
            if (counters == null
                || !ExactKeys(counters, new[] { "captureRefused", "quarantineTotal", "deliveredTotal" }))
            {
                error = "counters_schema";
                return false;
            }
            long refused;
            long quarantined;
            long delivered;
            if (!Integer(counters["captureRefused"], 0, int.MaxValue, out refused)
                || !Integer(counters["quarantineTotal"], 0, int.MaxValue, out quarantined)
                || !Integer(counters["deliveredTotal"], 0, int.MaxValue, out delivered))
            {
                error = "counters_value";
                return false;
            }
            captureRefused = (int)refused;
            quarantineTotal = (int)quarantined;
            deliveredTotal = (int)delivered;

            var entryValues = root["entries"] as List<object>;
            if (entryValues == null) { error = "entries_schema"; return false; }
            if (entryValues.Count > EffectiveMaxEntries) { error = "entries_over_64"; return false; }

            var list = new List<ObservationLedgerEntry>(entryValues.Count);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var quarantineEntries = 0;
            for (var index = 0; index < entryValues.Count; index++)
            {
                var value = entryValues[index] as Dictionary<string, object>;
                if (value == null) { error = "entry_" + index + "_not_object"; return false; }
                ObservationLedgerEntry entry;
                if (!TryEntry(value, index, out entry, out error)) return false;
                var key = IdentityKey(entry.Uid, entry.RecordRevision);
                if (!seen.Add(key)) { error = "entry_" + index + "_duplicate"; return false; }
                if (entry.State == ObservationLedgerState.Quarantine) quarantineEntries++;
                list.Add(entry);
            }
            if (quarantineEntries > quarantineTotal)
            {
                error = "quarantine_counter_below_entries";
                return false;
            }

            // Canonical bytes prove that rowJson was not silently rewritten.
            string canonical;
            long worst;
            byte[] canonicalBytes;
            try
            {
                canonical = ObservationLedgerSnapshotCodec.Serialize(list, captureRefused,
                    quarantineTotal, deliveredTotal, savedAt);
                canonicalBytes = StrictUtf8.GetBytes(canonical);
                worst = ObservationLedgerBudget.SnapshotWorstBytes(list);
            }
            catch (Exception exception)
            {
                error = "snapshot_encode_failed:" + exception.GetType().Name;
                return false;
            }
            if (!BytesEqual(canonicalBytes, bytes))
            {
                error = "non_canonical_snapshot";
                return false;
            }

            if (bytes.Length > worst)
            {
                error = "actual_over_reserved:" + bytes.Length + ">" + worst;
                return false;
            }
            if (worst > EffectiveMaxBytes)
            {
                error = "reserved_over_limit:" + worst;
                return false;
            }

            entries = list;
            actual = bytes.Length;
            reserved = worst;
            return true;
        }

        private bool TryEntry(Dictionary<string, object> value, int index,
            out ObservationLedgerEntry entry, out string error)
        {
            entry = null;
            error = "entry_" + index + "_schema";
            if (!ExactKeys(value, new[]
                {
                    "uid", "recordRevision", "state", "rowJson", "reason", "captureDeviceId",
                    "captureOwnerUserId", "pairingGeneration", "pairingGenerationKnown",
                    "enqueuedAtUtc", "attempts", "nextAttemptUtc"
                }))
            {
                return false;
            }

            string uid;
            if (!ObservationLedgerCandidate.TryString(value, "uid", out uid)
                || !MeasurementIds.IsUid(uid)
                || !string.Equals(uid, uid.ToLowerInvariant(), StringComparison.Ordinal))
            {
                error = "entry_" + index + "_uid";
                return false;
            }
            long revision;
            if (!Integer(value["recordRevision"], 1, MeasurementContract.MaxRecordRevision, out revision))
            {
                error = "entry_" + index + "_revision";
                return false;
            }
            string stateText;
            ObservationLedgerState state;
            if (!ObservationLedgerCandidate.TryString(value, "state", out stateText)
                || !ObservationLedgerEntryDto.TryParseState(stateText, out state))
            {
                error = "entry_" + index + "_state";
                return false;
            }
            string rowJson;
            if (!ObservationLedgerCandidate.TryString(value, "rowJson", out rowJson))
            {
                error = "entry_" + index + "_rowJson";
                return false;
            }

            string reasonText = null;
            var reasonObject = value["reason"];
            if (reasonObject != null)
            {
                reasonText = reasonObject as string;
                if (reasonText == null)
                {
                    error = "entry_" + index + "_reason_type";
                    return false;
                }
            }
            ObservationLedgerReason? reason = null;
            if (state == ObservationLedgerState.Pending)
            {
                if (reasonText != null) { error = "entry_" + index + "_pending_reason"; return false; }
            }
            else if (state == ObservationLedgerState.Deferred)
            {
                ObservationLedgerReason parsed;
                if (!ObservationLedgerReasons.TryParse(reasonText, out parsed)
                    || !ObservationLedgerReasons.IsDeferred(parsed))
                {
                    error = "entry_" + index + "_deferred_reason";
                    return false;
                }
                reason = parsed;
            }
            else
            {
                ObservationLedgerReason parsed;
                if (!ObservationLedgerReasons.TryParse(reasonText, out parsed)
                    || !ObservationLedgerReasons.IsQuarantine(parsed))
                {
                    error = "entry_" + index + "_quarantine_reason";
                    return false;
                }
                reason = parsed;
            }

            string device;
            string owner;
            if (!ObservationLedgerCandidate.TryString(value, "captureDeviceId", out device)
                || !ObservationRules.IsUuid(device)
                || !ObservationLedgerCandidate.TryString(value, "captureOwnerUserId", out owner)
                || !ObservationRules.IsUuid(owner))
            {
                error = "entry_" + index + "_binding";
                return false;
            }
            long generation;
            if (!Integer(value["pairingGeneration"], 0, 9007199254740991L, out generation))
            {
                error = "entry_" + index + "_generation";
                return false;
            }
            if (!(value["pairingGenerationKnown"] is bool) || !(bool)value["pairingGenerationKnown"])
            {
                error = "entry_" + index + "_generation_known";
                return false;
            }

            string enqueuedText;
            DateTime enqueuedAt;
            if (!ObservationLedgerCandidate.TryString(value, "enqueuedAtUtc", out enqueuedText)
                || !TryParseUtc(enqueuedText, out enqueuedAt))
            {
                error = "entry_" + index + "_enqueuedAtUtc";
                return false;
            }
            long attempts;
            if (!Integer(value["attempts"], 0, int.MaxValue, out attempts))
            {
                error = "entry_" + index + "_attempts";
                return false;
            }
            DateTime? nextAttempt = null;
            var nextObject = value["nextAttemptUtc"];
            if (nextObject != null)
            {
                var nextText = nextObject as string;
                DateTime parsedNext;
                if (nextText == null || !TryParseUtc(nextText, out parsedNext))
                {
                    error = "entry_" + index + "_nextAttemptUtc";
                    return false;
                }
                nextAttempt = parsedNext;
            }
            if (state == ObservationLedgerState.Deferred)
            {
                // A deferred row is only meaningful with a retry attempt and a
                // next-attempt timestamp; the store itself always writes both.
                if (attempts < 1)
                {
                    error = "entry_" + index + "_deferred_attempts";
                    return false;
                }
                if (!nextAttempt.HasValue)
                {
                    error = "entry_" + index + "_deferred_next_attempt";
                    return false;
                }
            }
            if (state == ObservationLedgerState.Quarantine && nextAttempt.HasValue)
            {
                error = "entry_" + index + "_quarantine_next_attempt";
                return false;
            }

            var binding = new ObservationPairingBinding(device, owner, generation, true);
            if (!binding.IsComplete)
            {
                error = "entry_" + index + "_binding_incomplete";
                return false;
            }
            if (!RowMatches(rowJson, uid, (int)revision, device, out error))
            {
                error = "entry_" + index + "_" + error;
                return false;
            }

            entry = new ObservationLedgerEntry(uid, (int)revision, state, rowJson, reason,
                device, owner, generation, true, enqueuedAt, (int)attempts, nextAttempt);
            error = null;
            return true;
        }

        private static bool RowMatches(string rowJson, string uid, int revision, string device,
            out string error)
        {
            error = null;
            Dictionary<string, object> row;
            try { row = MeasurementJson.DeserializeDictionary(rowJson); }
            catch (Exception) { error = "row_json_invalid"; return false; }

            string rowUid;
            double rowRevision;
            if (!ObservationLedgerCandidate.TryString(row, "summaryUid", out rowUid)
                || !string.Equals(rowUid, uid, StringComparison.Ordinal)
                || !ObservationLedgerCandidate.TryNumber(row, "recordRevision", out rowRevision)
                || rowRevision != revision)
            {
                error = "row_identity_mismatch";
                return false;
            }
            object observationObject;
            Dictionary<string, object> observation;
            if (!row.TryGetValue("observation", out observationObject)
                || (observation = observationObject as Dictionary<string, object>) == null)
            {
                error = "row_observation_missing";
                return false;
            }
            double version;
            if (!ObservationLedgerCandidate.TryNumber(observation, "version", out version) || version != 1)
            {
                error = "row_observation_version";
                return false;
            }
            object captureObject;
            Dictionary<string, object> capture;
            string rowDevice;
            if (!observation.TryGetValue("capture", out captureObject)
                || (capture = captureObject as Dictionary<string, object>) == null
                || !ObservationLedgerCandidate.TryString(capture, "deviceId", out rowDevice)
                || !string.Equals(rowDevice, device, StringComparison.OrdinalIgnoreCase))
            {
                error = "row_device_mismatch";
                return false;
            }
            return true;
        }

        private static bool TryParseUtc(string text, out DateTime value)
        {
            value = default(DateTime);
            if (text == null) return false;
            if (!DateTime.TryParseExact(text, MeasurementTime.WireFormat, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out value))
                return false;
            value = DateTime.SpecifyKind(value, DateTimeKind.Utc);
            return true;
        }

        private static bool Integer(object raw, long minimum, long maximum, out long value)
        {
            value = 0;
            double number;
            if (raw is double) number = (double)raw;
            else if (raw is int) number = (int)raw;
            else if (raw is long) number = (long)raw;
            else return false;
            if (double.IsNaN(number) || double.IsInfinity(number)) return false;
            if (Math.Floor(number) != number) return false;
            if (number < minimum || number > maximum) return false;
            value = (long)number;
            return true;
        }

        private static bool ExactKeys(Dictionary<string, object> value, string[] keys)
        {
            if (value.Count != keys.Length) return false;
            for (var index = 0; index < keys.Length; index++)
            {
                if (!value.ContainsKey(keys[index])) return false;
            }
            return true;
        }

        private static bool BytesEqual(byte[] left, byte[] right)
        {
            if (left.Length != right.Length) return false;
            for (var index = 0; index < left.Length; index++)
            {
                if (left[index] != right[index]) return false;
            }
            return true;
        }
    }
}
