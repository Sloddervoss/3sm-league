using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Runtime.Serialization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Durable state of one observation-ledger entry.</summary>
    public enum ObservationLedgerState
    {
        Pending = 0,
        Deferred = 1,
        Quarantine = 2
    }

    /// <summary>
    /// Bounded local reason codes. A raw HTTP body, exception text or unbounded
    /// server string is never a member of this set.
    /// </summary>
    public enum ObservationLedgerReason
    {
        CaptureBindingChanged = 0,
        ObservationCaptureRefused = 1,
        ObservationBuildRefused = 2,
        ObservationUnavailable = 3,
        ContainsUnknownFields = 4,
        ObservationDeviceMismatch = 5,
        ObservationDeviceInvalid = 6,
        AuthDeviceInvalid = 7,
        ObservationNull = 8,
        ObservationInvalid = 9,
        RowInvalid = 10,
        RevisionConflict = 11,
        StaleRevision = 12,
        ObservationAbsent = 13,
        ObservationInvalidVersion = 14,
        ObservationInvalidType = 15,
        ObservationInvalidInteger = 16,
        ObservationInvalidNumber = 17,
        ObservationInvalidTimestamp = 18,
        ObservationInvalidUuid = 19,
        ObservationInvalidText = 20,
        ObservationInvalidControl = 21,
        ObservationInvalidEnum = 22,
        ServerRejectedUnknown = 23
    }

    /// <summary>Wire tokens and classification for <see cref="ObservationLedgerReason"/>.</summary>
    public static class ObservationLedgerReasons
    {
        public const string CaptureBindingChanged = "capture_binding_changed";
        public const string ObservationCaptureRefused = "observation_capture_refused";
        public const string ObservationBuildRefused = "observation_build_refused";
        public const string ObservationUnavailable = "observation_unavailable";
        public const string ContainsUnknownFields = "contains_unknown_fields";
        public const string ObservationDeviceMismatch = "observation_device_mismatch";
        public const string ObservationDeviceInvalid = "observation_device_invalid";
        public const string AuthDeviceInvalid = "auth_device_invalid";
        public const string ObservationNull = "observation_null";
        public const string ObservationInvalid = "observation_invalid";
        public const string RowInvalid = "row_invalid";
        public const string RevisionConflict = "revision_conflict";
        public const string StaleRevision = "stale_revision";
        public const string ObservationAbsent = "observation_absent";
        public const string ObservationInvalidVersion = "observation_invalid_version";
        public const string ObservationInvalidType = "observation_invalid_type";
        public const string ObservationInvalidInteger = "observation_invalid_integer";
        public const string ObservationInvalidNumber = "observation_invalid_number";
        public const string ObservationInvalidTimestamp = "observation_invalid_timestamp";
        public const string ObservationInvalidUuid = "observation_invalid_uuid";
        public const string ObservationInvalidText = "observation_invalid_text";
        public const string ObservationInvalidControl = "observation_invalid_control";
        public const string ObservationInvalidEnum = "observation_invalid_enum";
        public const string ServerRejectedUnknown = "server_rejected_unknown";

        private static readonly ObservationLedgerReason[] All =
        {
            ObservationLedgerReason.CaptureBindingChanged,
            ObservationLedgerReason.ObservationCaptureRefused,
            ObservationLedgerReason.ObservationBuildRefused,
            ObservationLedgerReason.ObservationUnavailable,
            ObservationLedgerReason.ContainsUnknownFields,
            ObservationLedgerReason.ObservationDeviceMismatch,
            ObservationLedgerReason.ObservationDeviceInvalid,
            ObservationLedgerReason.AuthDeviceInvalid,
            ObservationLedgerReason.ObservationNull,
            ObservationLedgerReason.ObservationInvalid,
            ObservationLedgerReason.RowInvalid,
            ObservationLedgerReason.RevisionConflict,
            ObservationLedgerReason.StaleRevision,
            ObservationLedgerReason.ObservationAbsent,
            ObservationLedgerReason.ObservationInvalidVersion,
            ObservationLedgerReason.ObservationInvalidType,
            ObservationLedgerReason.ObservationInvalidInteger,
            ObservationLedgerReason.ObservationInvalidNumber,
            ObservationLedgerReason.ObservationInvalidTimestamp,
            ObservationLedgerReason.ObservationInvalidUuid,
            ObservationLedgerReason.ObservationInvalidText,
            ObservationLedgerReason.ObservationInvalidControl,
            ObservationLedgerReason.ObservationInvalidEnum,
            ObservationLedgerReason.ServerRejectedUnknown
        };

        public static string ToToken(ObservationLedgerReason reason)
        {
            switch (reason)
            {
                case ObservationLedgerReason.CaptureBindingChanged: return CaptureBindingChanged;
                case ObservationLedgerReason.ObservationCaptureRefused: return ObservationCaptureRefused;
                case ObservationLedgerReason.ObservationBuildRefused: return ObservationBuildRefused;
                case ObservationLedgerReason.ObservationUnavailable: return ObservationUnavailable;
                case ObservationLedgerReason.ContainsUnknownFields: return ContainsUnknownFields;
                case ObservationLedgerReason.ObservationDeviceMismatch: return ObservationDeviceMismatch;
                case ObservationLedgerReason.ObservationDeviceInvalid: return ObservationDeviceInvalid;
                case ObservationLedgerReason.AuthDeviceInvalid: return AuthDeviceInvalid;
                case ObservationLedgerReason.ObservationNull: return ObservationNull;
                case ObservationLedgerReason.ObservationInvalid: return ObservationInvalid;
                case ObservationLedgerReason.RowInvalid: return RowInvalid;
                case ObservationLedgerReason.RevisionConflict: return RevisionConflict;
                case ObservationLedgerReason.StaleRevision: return StaleRevision;
                case ObservationLedgerReason.ObservationAbsent: return ObservationAbsent;
                case ObservationLedgerReason.ObservationInvalidVersion: return ObservationInvalidVersion;
                case ObservationLedgerReason.ObservationInvalidType: return ObservationInvalidType;
                case ObservationLedgerReason.ObservationInvalidInteger: return ObservationInvalidInteger;
                case ObservationLedgerReason.ObservationInvalidNumber: return ObservationInvalidNumber;
                case ObservationLedgerReason.ObservationInvalidTimestamp: return ObservationInvalidTimestamp;
                case ObservationLedgerReason.ObservationInvalidUuid: return ObservationInvalidUuid;
                case ObservationLedgerReason.ObservationInvalidText: return ObservationInvalidText;
                case ObservationLedgerReason.ObservationInvalidControl: return ObservationInvalidControl;
                case ObservationLedgerReason.ObservationInvalidEnum: return ObservationInvalidEnum;
                case ObservationLedgerReason.ServerRejectedUnknown: return ServerRejectedUnknown;
                default: return ServerRejectedUnknown;
            }
        }

        public static bool TryParse(string token, out ObservationLedgerReason reason)
        {
            reason = ObservationLedgerReason.ServerRejectedUnknown;
            if (token == null) return false;
            for (var index = 0; index < All.Length; index++)
            {
                if (string.Equals(ToToken(All[index]), token, StringComparison.Ordinal))
                {
                    reason = All[index];
                    return true;
                }
            }
            return false;
        }

        /// <summary>Temporary rejection: retry with the same frozen identity.</summary>
        public static bool IsDeferred(ObservationLedgerReason reason)
        {
            return reason == ObservationLedgerReason.ObservationUnavailable
                || reason == ObservationLedgerReason.ContainsUnknownFields;
        }

        /// <summary>Permanent rejection: no retry, exact rowJson retained.</summary>
        public static bool IsQuarantine(ObservationLedgerReason reason)
        {
            return !IsDeferred(reason);
        }

        /// <summary>Longest accepted token, used by the worst-state reservation.</summary>
        internal static string LongestToken()
        {
            var longest = string.Empty;
            for (var index = 0; index < All.Length; index++)
            {
                var token = ToToken(All[index]);
                if (token.Length > longest.Length) longest = token;
            }
            return longest;
        }
    }

    /// <summary>
    /// One frozen observation row. <see cref="RowJson"/> is the exact serializer
    /// output produced once at candidate creation; it is never rewritten.
    /// </summary>
    public sealed class ObservationLedgerEntry
    {
        private readonly string _uid;
        private readonly int _recordRevision;
        private readonly ObservationLedgerState _state;
        private readonly string _rowJson;
        private readonly ObservationLedgerReason? _reason;
        private readonly string _captureDeviceId;
        private readonly string _captureOwnerUserId;
        private readonly long _pairingGeneration;
        private readonly bool _pairingGenerationKnown;
        private readonly DateTime _enqueuedAtUtc;
        private readonly int _attempts;
        private readonly DateTime? _nextAttemptUtc;

        internal ObservationLedgerEntry(string uid, int recordRevision, ObservationLedgerState state,
            string rowJson, ObservationLedgerReason? reason, string captureDeviceId,
            string captureOwnerUserId, long pairingGeneration, bool pairingGenerationKnown,
            DateTime enqueuedAtUtc, int attempts, DateTime? nextAttemptUtc)
        {
            _uid = uid;
            _recordRevision = recordRevision;
            _state = state;
            _rowJson = rowJson;
            _reason = reason;
            _captureDeviceId = captureDeviceId;
            _captureOwnerUserId = captureOwnerUserId;
            _pairingGeneration = pairingGeneration;
            _pairingGenerationKnown = pairingGenerationKnown;
            _enqueuedAtUtc = enqueuedAtUtc;
            _attempts = attempts;
            _nextAttemptUtc = nextAttemptUtc;
        }

        public string Uid { get { return _uid; } }
        public int RecordRevision { get { return _recordRevision; } }
        public ObservationLedgerState State { get { return _state; } }
        public string RowJson { get { return _rowJson; } }
        public ObservationLedgerReason? Reason { get { return _reason; } }
        public string ReasonCode { get { return _reason.HasValue ? ObservationLedgerReasons.ToToken(_reason.Value) : null; } }
        public string CaptureDeviceId { get { return _captureDeviceId; } }
        public string CaptureOwnerUserId { get { return _captureOwnerUserId; } }
        public long PairingGeneration { get { return _pairingGeneration; } }
        public bool PairingGenerationKnown { get { return _pairingGenerationKnown; } }
        public DateTime EnqueuedAtUtc { get { return _enqueuedAtUtc; } }
        public int Attempts { get { return _attempts; } }
        public DateTime? NextAttemptUtc { get { return _nextAttemptUtc; } }

        public ObservationPairingBinding Binding
        {
            get
            {
                return new ObservationPairingBinding(_captureDeviceId, _captureOwnerUserId,
                    _pairingGeneration, _pairingGenerationKnown);
            }
        }

        internal ObservationLedgerEntry WithState(ObservationLedgerState state, ObservationLedgerReason? reason,
            int attempts, DateTime? nextAttemptUtc)
        {
            return new ObservationLedgerEntry(_uid, _recordRevision, state, _rowJson, reason,
                _captureDeviceId, _captureOwnerUserId, _pairingGeneration, _pairingGenerationKnown,
                _enqueuedAtUtc, attempts, nextAttemptUtc);
        }
    }

    /// <summary>
    /// A provisional row candidate: built and serialized exactly once, before any
    /// reservation or durable commit. The factory only accepts a real
    /// <see cref="MeasurementLapSummaryRecord"/> plus a complete pairing binding, so a
    /// caller cannot supply a mismatched UID, revision or device.
    /// </summary>
    public sealed class ObservationLedgerCandidate
    {
        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

        private readonly string _uid;
        private readonly int _recordRevision;
        private readonly string _rowJson;
        private readonly ObservationPairingBinding _binding;
        private readonly DateTime _enqueuedAtUtc;

        private ObservationLedgerCandidate(string uid, int recordRevision, string rowJson,
            ObservationPairingBinding binding, DateTime enqueuedAtUtc)
        {
            _uid = uid;
            _recordRevision = recordRevision;
            _rowJson = rowJson;
            _binding = binding;
            _enqueuedAtUtc = enqueuedAtUtc;
        }

        public string Uid { get { return _uid; } }
        public int RecordRevision { get { return _recordRevision; } }
        public string RowJson { get { return _rowJson; } }
        public ObservationPairingBinding Binding { get { return _binding; } }
        public DateTime EnqueuedAtUtc { get { return _enqueuedAtUtc; } }
        public long Utf8Bytes { get { return StrictUtf8.GetByteCount(_rowJson); } }

        /// <summary>
        /// Freezes a row without aliasing the mutable record. Returns null with a bounded
        /// diagnostic when the row, binding or serialized identity is inconsistent.
        /// </summary>
        public static ObservationLedgerCandidate TryCreate(MeasurementLapSummaryRecord row,
            ObservationPairingBinding binding, DateTime enqueuedAtUtc, out string diagnostic)
        {
            diagnostic = null;
            if (row == null) { diagnostic = "row_missing"; return null; }
            if (binding == null || !binding.IsComplete)
            {
                diagnostic = "binding_incomplete";
                return null;
            }
            if (binding.PairingGeneration > 9007199254740991L)
            {
                diagnostic = "pairing_generation_out_of_range";
                return null;
            }
            if (!MeasurementIds.IsUid(row.SummaryUid))
            {
                diagnostic = "summary_uid_invalid";
                return null;
            }
            if (row.RecordRevision < 1 || row.RecordRevision > MeasurementContract.MaxRecordRevision)
            {
                diagnostic = "record_revision_invalid";
                return null;
            }
            if (row.Observation == null || row.Observation.Capture == null
                || string.IsNullOrEmpty(row.Observation.Capture.DeviceId))
            {
                diagnostic = "observation_missing";
                return null;
            }
            if (!string.Equals(row.Observation.Capture.DeviceId, binding.CaptureDeviceId,
                    StringComparison.OrdinalIgnoreCase))
            {
                diagnostic = "observation_device_mismatch";
                return null;
            }
            if (enqueuedAtUtc.Kind != DateTimeKind.Utc)
            {
                diagnostic = "enqueued_at_not_utc";
                return null;
            }

            var uid = MeasurementIds.Format(Guid.Parse(row.SummaryUid));
            string json;
            try
            {
                // Exactly once. The candidate never holds the mutable record afterwards.
                json = row.ToJson();
                StrictUtf8.GetByteCount(json);
            }
            catch (Exception)
            {
                diagnostic = "row_serialize_failed";
                return null;
            }

            Dictionary<string, object> parsed;
            try
            {
                parsed = MeasurementJson.DeserializeDictionary(json);
            }
            catch (Exception)
            {
                diagnostic = "row_json_unreadable";
                return null;
            }

            string serializedUid;
            if (!TryString(parsed, "summaryUid", out serializedUid)
                || !string.Equals(serializedUid, uid, StringComparison.Ordinal))
            {
                diagnostic = "row_uid_mismatch";
                return null;
            }
            double serializedRevision;
            if (!TryNumber(parsed, "recordRevision", out serializedRevision)
                || serializedRevision != row.RecordRevision)
            {
                diagnostic = "row_revision_mismatch";
                return null;
            }

            object observationObject;
            Dictionary<string, object> observation;
            if (!parsed.TryGetValue("observation", out observationObject)
                || (observation = observationObject as Dictionary<string, object>) == null)
            {
                diagnostic = "row_observation_missing";
                return null;
            }
            double version;
            if (!TryNumber(observation, "version", out version) || version != 1)
            {
                diagnostic = "row_observation_version_invalid";
                return null;
            }
            object captureObject;
            Dictionary<string, object> capture;
            string deviceId;
            if (!observation.TryGetValue("capture", out captureObject)
                || (capture = captureObject as Dictionary<string, object>) == null
                || !TryString(capture, "deviceId", out deviceId)
                || !string.Equals(deviceId, binding.CaptureDeviceId, StringComparison.OrdinalIgnoreCase))
            {
                diagnostic = "row_observation_device_mismatch";
                return null;
            }

            var enqueued = TruncateToMilliseconds(enqueuedAtUtc);
            return new ObservationLedgerCandidate(uid, row.RecordRevision, json, binding, enqueued);
        }

        internal static DateTime TruncateToMilliseconds(DateTime value)
        {
            var ticks = value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond);
            return new DateTime(ticks, DateTimeKind.Utc);
        }

        internal static bool TryString(Dictionary<string, object> value, string key, out string result)
        {
            result = null;
            object raw;
            if (!value.TryGetValue(key, out raw)) return false;
            result = raw as string;
            return result != null;
        }

        internal static bool TryNumber(Dictionary<string, object> value, string key, out double result)
        {
            result = 0;
            object raw;
            if (!value.TryGetValue(key, out raw)) return false;
            if (raw is double)
            {
                result = (double)raw;
                return true;
            }
            if (raw is int)
            {
                result = (int)raw;
                return true;
            }
            if (raw is long)
            {
                result = (long)raw;
                return true;
            }
            return false;
        }
    }

    public enum ObservationLedgerCaptureStatus
    {
        Captured = 0,
        AlreadyCaptured = 1,
        RefusedQuota = 2,
        RefusedBindingChanged = 3,
        RefusedConflict = 4,
        RefusedStoreFailedClosed = 5,
        NotCommitted = 6,
        Uncertain = 7
    }

    public sealed class ObservationLedgerCaptureResult
    {
        internal ObservationLedgerCaptureResult(ObservationLedgerCaptureStatus status, string uid,
            int recordRevision, string reasonCode, string diagnostic, int entryCount,
            int reservationCount, long actualBytes, long reservedBytes, bool counterPersisted)
        {
            Status = status;
            Uid = uid;
            RecordRevision = recordRevision;
            ReasonCode = reasonCode;
            Diagnostic = diagnostic;
            EntryCount = entryCount;
            ReservationCount = reservationCount;
            ActualBytes = actualBytes;
            ReservedBytes = reservedBytes;
            CounterPersisted = counterPersisted;
        }

        public ObservationLedgerCaptureStatus Status { get; private set; }
        public bool Captured
        {
            get
            {
                return Status == ObservationLedgerCaptureStatus.Captured
                    || Status == ObservationLedgerCaptureStatus.AlreadyCaptured;
            }
        }
        public string Uid { get; private set; }
        public int RecordRevision { get; private set; }
        public string ReasonCode { get; private set; }
        public string Diagnostic { get; private set; }
        public int EntryCount { get; private set; }
        public int ReservationCount { get; private set; }
        public long ActualBytes { get; private set; }
        public long ReservedBytes { get; private set; }
        public bool CounterPersisted { get; private set; }
    }

    public enum ObservationLedgerTransitionStatus
    {
        Committed = 0,
        NotFound = 1,
        RefusedInvalidReason = 2,
        RefusedQuota = 3,
        NotCommitted = 4,
        RefusedStoreFailedClosed = 5
    }

    public sealed class ObservationLedgerTransitionResult
    {
        internal ObservationLedgerTransitionResult(ObservationLedgerTransitionStatus status,
            string reasonCode, string diagnostic, long actualBytes, long reservedBytes)
        {
            Status = status;
            ReasonCode = reasonCode;
            Diagnostic = diagnostic;
            ActualBytes = actualBytes;
            ReservedBytes = reservedBytes;
        }

        public ObservationLedgerTransitionStatus Status { get; private set; }
        public bool Committed { get { return Status == ObservationLedgerTransitionStatus.Committed; } }
        public string ReasonCode { get; private set; }
        public string Diagnostic { get; private set; }
        public long ActualBytes { get; private set; }
        public long ReservedBytes { get; private set; }
    }

    /// <summary>
    /// One synchronized local view of the host-provided pairing binding. A rebind
    /// blocks while a capture performs its final check and the atomic switch, so a
    /// local rebind cannot slip between those two steps.
    /// </summary>
    public sealed class ObservationBindingFence
    {
        private readonly object _gate = new object();
        private ObservationPairingBinding _current;

        public ObservationBindingFence(ObservationPairingBinding initial)
        {
            _current = initial;
        }

        public ObservationPairingBinding Current
        {
            get { lock (_gate) { return _current; } }
        }

        public void Rebind(ObservationPairingBinding next)
        {
            lock (_gate) { _current = next; }
        }

        internal bool TryExecuteIfCurrent(ObservationPairingBinding expected, Action action)
        {
            lock (_gate)
            {
                if (!SameBinding(_current, expected)) return false;
                action();
                return true;
            }
        }

        internal static bool SameBinding(ObservationPairingBinding left, ObservationPairingBinding right)
        {
            if (left == null || right == null) return left == right;
            return string.Equals(left.CaptureDeviceId, right.CaptureDeviceId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(left.CaptureOwnerUserId, right.CaptureOwnerUserId, StringComparison.OrdinalIgnoreCase)
                && left.PairingGeneration == right.PairingGeneration
                && left.PairingGenerationKnown == right.PairingGenerationKnown;
        }
    }

    /// <summary>Bounded schema arithmetic; no string.Length estimates.</summary>
    internal static class ObservationLedgerBudget
    {
        internal static long Utf8(string value)
        {
            return new UTF8Encoding(false, true).GetByteCount(value);
        }

        /// <summary>Exact worst-state bytes of one entry, including JSON escaping.</summary>
        internal static long EntryWorstBytes(string uid, int recordRevision, string rowJson,
            ObservationPairingBinding binding, DateTime enqueuedAtUtc)
        {
            var dto = new ObservationLedgerEntryDto(uid, recordRevision, ObservationLedgerState.Quarantine,
                rowJson, ObservationLedgerReasons.LongestToken(), binding.CaptureDeviceId,
                binding.CaptureOwnerUserId, long.MaxValue, true, enqueuedAtUtc, int.MaxValue,
                new DateTime(9999, 12, 31, 23, 59, 59, 999, DateTimeKind.Utc));
            return Utf8(MeasurementJson.Serialize(dto));
        }

        internal static long RootWorstBytes()
        {
            var dto = new ObservationLedgerSnapshotDto(ObservationLedgerSnapshotDto.CurrentVersion,
                new DateTime(9999, 12, 31, 23, 59, 59, 999, DateTimeKind.Utc),
                new ObservationLedgerCountersDto(int.MaxValue, int.MaxValue, int.MaxValue),
                new List<ObservationLedgerEntryDto>());
            return Utf8(MeasurementJson.Serialize(dto));
        }

        internal static long SnapshotWorstBytes(IList<ObservationLedgerEntry> entries)
        {
            var total = RootWorstBytes();
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                total += EntryWorstBytes(entry.Uid, entry.RecordRevision, entry.RowJson,
                    entry.Binding, entry.EnqueuedAtUtc);
                if (index > 0) total += 1;
            }
            return total;
        }
    }

    /// <summary>Compact DTOs for the single version-1 snapshot file.</summary>
    [DataContract]
    internal sealed class ObservationLedgerSnapshotDto
    {
        public const int CurrentVersion = 1;

        [DataMember(Name = "version", Order = 1)] private readonly int _version;
        [DataMember(Name = "savedAtUtc", Order = 2)] private readonly string _savedAtUtc;
        [DataMember(Name = "counters", Order = 3)] private readonly ObservationLedgerCountersDto _counters;
        [DataMember(Name = "entries", Order = 4)] private readonly List<ObservationLedgerEntryDto> _entries;

        public ObservationLedgerSnapshotDto(int version, DateTime savedAtUtc,
            ObservationLedgerCountersDto counters, List<ObservationLedgerEntryDto> entries)
        {
            _version = version;
            _savedAtUtc = MeasurementTime.Format(savedAtUtc);
            _counters = counters;
            _entries = entries;
        }

        public int Version { get { return _version; } }
        public string SavedAtUtc { get { return _savedAtUtc; } }
        public ObservationLedgerCountersDto Counters { get { return _counters; } }
        public List<ObservationLedgerEntryDto> Entries { get { return _entries; } }
    }

    [DataContract]
    internal sealed class ObservationLedgerCountersDto
    {
        [DataMember(Name = "captureRefused", Order = 1)] private readonly int _captureRefused;
        [DataMember(Name = "quarantineTotal", Order = 2)] private readonly int _quarantineTotal;
        [DataMember(Name = "deliveredTotal", Order = 3)] private readonly int _deliveredTotal;

        public ObservationLedgerCountersDto(int captureRefused, int quarantineTotal, int deliveredTotal)
        {
            _captureRefused = captureRefused;
            _quarantineTotal = quarantineTotal;
            _deliveredTotal = deliveredTotal;
        }

        public int CaptureRefused { get { return _captureRefused; } }
        public int QuarantineTotal { get { return _quarantineTotal; } }
        public int DeliveredTotal { get { return _deliveredTotal; } }
    }

    [DataContract]
    internal sealed class ObservationLedgerEntryDto
    {
        [DataMember(Name = "uid", Order = 1)] private readonly string _uid;
        [DataMember(Name = "recordRevision", Order = 2)] private readonly int _recordRevision;
        [DataMember(Name = "state", Order = 3)] private readonly string _state;
        [DataMember(Name = "rowJson", Order = 4)] private readonly string _rowJson;
        [DataMember(Name = "reason", Order = 5)] private readonly string _reason;
        [DataMember(Name = "captureDeviceId", Order = 6)] private readonly string _captureDeviceId;
        [DataMember(Name = "captureOwnerUserId", Order = 7)] private readonly string _captureOwnerUserId;
        [DataMember(Name = "pairingGeneration", Order = 8)] private readonly long _pairingGeneration;
        [DataMember(Name = "pairingGenerationKnown", Order = 9)] private readonly bool _pairingGenerationKnown;
        [DataMember(Name = "enqueuedAtUtc", Order = 10)] private readonly string _enqueuedAtUtc;
        [DataMember(Name = "attempts", Order = 11)] private readonly int _attempts;
        [DataMember(Name = "nextAttemptUtc", Order = 12)] private readonly string _nextAttemptUtc;

        public ObservationLedgerEntryDto(string uid, int recordRevision, ObservationLedgerState state,
            string rowJson, string reason, string captureDeviceId, string captureOwnerUserId,
            long pairingGeneration, bool pairingGenerationKnown, DateTime enqueuedAtUtc,
            int attempts, DateTime? nextAttemptUtc)
        {
            _uid = uid;
            _recordRevision = recordRevision;
            _state = StateToken(state);
            _rowJson = rowJson;
            _reason = reason;
            _captureDeviceId = captureDeviceId;
            _captureOwnerUserId = captureOwnerUserId;
            _pairingGeneration = pairingGeneration;
            _pairingGenerationKnown = pairingGenerationKnown;
            _enqueuedAtUtc = MeasurementTime.Format(enqueuedAtUtc);
            _attempts = attempts;
            _nextAttemptUtc = MeasurementTime.Format(nextAttemptUtc);
        }

        internal static string StateToken(ObservationLedgerState state)
        {
            switch (state)
            {
                case ObservationLedgerState.Pending: return "pending";
                case ObservationLedgerState.Deferred: return "deferred";
                case ObservationLedgerState.Quarantine: return "quarantine";
                default: return "invalid";
            }
        }

        internal static bool TryParseState(string token, out ObservationLedgerState state)
        {
            state = ObservationLedgerState.Pending;
            if (token == "pending") return true;
            if (token == "deferred") { state = ObservationLedgerState.Deferred; return true; }
            if (token == "quarantine") { state = ObservationLedgerState.Quarantine; return true; }
            return false;
        }
    }

    internal static class ObservationLedgerSnapshotCodec
    {
        internal static string Serialize(IList<ObservationLedgerEntry> entries, int captureRefused,
            int quarantineTotal, int deliveredTotal, DateTime savedAtUtc)
        {
            var dtos = new List<ObservationLedgerEntryDto>(entries.Count);
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                dtos.Add(new ObservationLedgerEntryDto(entry.Uid, entry.RecordRevision, entry.State,
                    entry.RowJson, entry.ReasonCode, entry.CaptureDeviceId, entry.CaptureOwnerUserId,
                    entry.PairingGeneration, entry.PairingGenerationKnown, entry.EnqueuedAtUtc,
                    entry.Attempts, entry.NextAttemptUtc));
            }
            return MeasurementJson.Serialize(new ObservationLedgerSnapshotDto(
                ObservationLedgerSnapshotDto.CurrentVersion, savedAtUtc,
                new ObservationLedgerCountersDto(captureRefused, quarantineTotal, deliveredTotal), dtos));
        }
    }

    /// <summary>Read-only view helpers used by diagnostics and tests.</summary>
    internal static class ObservationLedgerView
    {
        internal static ReadOnlyCollection<ObservationLedgerEntry> Copy(IList<ObservationLedgerEntry> entries)
        {
            return new ReadOnlyCollection<ObservationLedgerEntry>(new List<ObservationLedgerEntry>(entries));
        }
    }
}
