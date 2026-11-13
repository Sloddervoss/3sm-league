using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// T13-S2C2b — bounded async observation-send lifecycle.
// Every transport test uses the real HttpObservationSendTransport with an injected
// HttpMessageHandler. The token is a synthetic sentinel; no real network, SDK,
// APPDATA, database or production caller is involved.
internal static class MeasurementObservationSendTests
{
    private const string Device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string OtherDevice = "99999999-8888-4777-8666-555555555555";
    private const string Sentinel = "synthetic-sentinel-token-not-real-0001";
    private const string OtherToken = "synthetic-sentinel-token-not-real-0002";
    private const string Caps = "{\"revision\":1,\"supported\":{\"measurementEvents\":true}}";
    private const string Core = "{\"protocolVersion\":3,\"transportSessionId\":\"s2c2b\",\"sequence\":7}";
    private static readonly DateTime T0 = new DateTime(2026, 11, 13, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Uri Endpoint = new Uri("https://relay.invalid/v1/telemetry");
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private static ObservationPairingBinding Binding(long generation = 7,
        string device = Device)
    {
        return new ObservationPairingBinding(device, Owner, generation, true);
    }

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(),
            "3sm-observation-send-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static string Uid(int value)
    {
        return "00000000-0000-4000-8000-" + value.ToString("D12", CultureInfo.InvariantCulture);
    }

    private static MeasurementLapSummaryRecord Row(string uid, bool observation = true,
        int revision = 1, string driver = "Test Driver", string session = "session-a",
        string device = Device, string car = "car-1", int track = 123)
    {
        var context = new ObservationLapContext(car, track, "Test Track", "Grand Prix", 42, 3);
        var samples = new List<ObservationSample>
        {
            new ObservationSample(T0, true, 50.0, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(500), false, 49.5, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(1000), false, 49.0, driver, "ctx-a"),
            new ObservationSample(T0.AddMilliseconds(1500), true, 48.5, driver, "ctx-a")
        };
        var built = ObservationCapture.Build(Binding(device: device), context, samples,
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

    private static ObservationLedgerStore Store(string directory,
        ObservationBindingFence fence = null, ObservationLedgerOptions options = null,
        IObservationLedgerFaults faults = null)
    {
        if (options == null) options = new ObservationLedgerOptions();
        if (options.Clock == null) options.Clock = delegate { return T0.AddMinutes(2); };
        return new ObservationLedgerStore(Path.Combine(directory, "observation-ledger-v1.json"),
            fence ?? new ObservationBindingFence(Binding()), options,
            new ObservationLedgerFileSystem(), faults ?? new NoObservationLedgerFaults());
    }

    private static MeasurementOutbox Outbox(string directory)
    {
        return new MeasurementOutbox(Path.Combine(directory, "measurement-outbox.json"));
    }

    private static string Capture(ObservationLedgerStore store, MeasurementLapSummaryRecord row,
        ObservationPairingBinding binding = null)
    {
        var result = store.Capture(Candidate(row, binding));
        if (!result.Captured)
            throw new InvalidOperationException("capture: " + result.Status + ":" + result.Diagnostic);
        return row.ToJson();
    }

    private static ObservationSendOptions Enabled(int timeoutMs = 2000)
    {
        return new ObservationSendOptions
        {
            Enabled = true,
            LeaseWaitMilliseconds = 500,
            RequestTimeoutMilliseconds = timeoutMs,
            PairTransitionTimeoutMilliseconds = timeoutMs
        };
    }

    private static ObservationSendCoordinator Coordinator(ObservationLedgerStore store,
        MeasurementOutbox outbox, IObservationSendTransport transport, Func<string> token,
        ObservationSendOptions options = null, MeasurementLimits limits = null)
    {
        return new ObservationSendCoordinator(store, outbox, transport,
            token ?? delegate { return Sentinel; }, delegate { return Caps; },
            options ?? Enabled(), limits);
    }

    private static ObservationSendCoordinator Coordinator(ObservationLedgerStore store,
        MeasurementOutbox outbox, CapturingHandler handler, Func<string> token,
        ObservationSendOptions options = null, MeasurementLimits limits = null)
    {
        var http = new HttpClient(handler, false);
        return Coordinator(store, outbox,
            new HttpObservationSendTransport(http, 65536), token, options, limits);
    }

    private static ObservationSendAttemptResult Send(ObservationSendCoordinator coordinator,
        string core = Core, DateTime? now = null, CancellationToken? cancellation = null)
    {
        return coordinator.SendOnceAsync(core, Endpoint, now ?? T0.AddMinutes(3),
            cancellation ?? CancellationToken.None).GetAwaiter().GetResult();
    }

    // ------------------------------------------------------------- ACK helpers
    private static string Id(string uid, int revision)
    {
        return "{\"id\":\"" + uid + "\",\"record_revision\":"
            + revision.ToString(CultureInfo.InvariantCulture) + "}";
    }

    private static string Rejection(string uid, int? index, string reason)
    {
        var id = uid == null ? "null" : "\"" + uid + "\"";
        var position = index.HasValue
            ? index.Value.ToString(CultureInfo.InvariantCulture) : "null";
        return "{\"id\":" + id + ",\"index\":" + position
            + ",\"reason\":\"" + reason + "\",\"stage\":\"parser\"}";
    }

    private static string Series(bool stored, int received, string accepted,
        string duplicates, string superseded, string rejected, string blockError)
    {
        return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
            + ",\"accepted\":" + accepted
            + ",\"duplicates\":" + duplicates
            + ",\"superseded\":" + superseded
            + ",\"rejected\":" + rejected
            + ",\"block_error\":" + (blockError == null ? "null" : "\"" + blockError + "\"")
            + ",\"stored\":" + (stored ? "true" : "false") + "}";
    }

    private static string LapAck(bool stored, int received, string accepted,
        string duplicates, string superseded, string rejected, string blockError)
    {
        var empty = Series(true, 0, "[]", "[]", "[]", "[]", null);
        return "{\"measurements\":{\"events\":" + empty + ",\"laps\":"
            + Series(stored, received, accepted, duplicates, superseded, rejected, blockError)
            + "}}";
    }

    private static string AcceptedLap(string uid, int revision, int received = 1)
    {
        return LapAck(true, received, "[" + Id(uid, revision) + "]", "[]", "[]", "[]", null);
    }

    private static Dictionary<string, object> Json(string path)
    {
        return MeasurementJson.DeserializeDictionary(File.ReadAllText(path, Utf8));
    }

    private static int EntryArrayCount(string body, string member)
    {
        var root = MeasurementJson.DeserializeDictionary(body);
        var values = root.ContainsKey(member) ? root[member] as List<object> : null;
        return values == null ? -1 : values.Count;
    }

    private static string LedgerText(ObservationLedgerStore store)
    {
        return File.ReadAllText(store.Path, Utf8);
    }

    private static bool ContainsSentinel(string text)
    {
        return text != null && text.IndexOf(Sentinel, StringComparison.Ordinal) >= 0;
    }

    private static bool WaitUntil(Func<bool> condition, int milliseconds = 3000)
    {
        return SpinWait.SpinUntil(condition, milliseconds);
    }

    private static TaskCompletionSource<bool> Gate()
    {
        return new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private static MeasurementEventRecord Event(MeasurementIdFactory ids, int index)
    {
        return new MeasurementEventRecord
        {
            EventUid = ids.NewEventUid(),
            EventId = ids.NextEventLabel(),
            Kind = "wear",
            SegmentId = "seg-a",
            PitVisitId = "pit-a",
            ObservedSessionId = "session-a",
            ObservedAtUtc = T0,
            SessionTimeSeconds = 100 + index,
            SdkTick = 42 + index,
            WearBefore = new WearReading(80, 80, 80, 80),
            WearAfter = new WearReading(70, 70, 80, 80),
            WearBeforeObservedAtUtc = T0.AddSeconds(-10),
            WearAfterObservedAtUtc = T0,
            SetGeneration = new SetGenerationReading(),
            Evidence = new TyreEvidence("wear_channels", new[] { "wear_percent" }, "s2c2b"),
            Confidence = 0.4,
            RecordRevision = 1
        };
    }

    // ------------------------------------------------------------ HTTP capture
    internal sealed class CapturedRequest
    {
        public string Method;
        public Uri Uri;
        public string Authorization;
        public string ContentType;
        public string Body;
        public byte[] Bytes;
    }

    internal sealed class CapturingHandler : HttpMessageHandler
    {
        private readonly object _gate = new object();
        private readonly List<CapturedRequest> _requests = new List<CapturedRequest>();
        public Func<int, CapturedRequest, CancellationToken, Task<HttpResponseMessage>> Respond;
        public readonly ManualResetEventSlim FirstEntered = new ManualResetEventSlim(false);
        public int Active;
        public int MaxActive;

        public int RequestCount { get { lock (_gate) return _requests.Count; } }
        public CapturedRequest RequestAt(int index) { lock (_gate) return _requests[index]; }
        public IList<CapturedRequest> Requests { get { lock (_gate) return new List<CapturedRequest>(_requests); } }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var captured = new CapturedRequest();
            captured.Method = request.Method.Method;
            captured.Uri = request.RequestUri;
            captured.Authorization = request.Headers.Authorization == null ? null
                : request.Headers.Authorization.Scheme + " "
                    + request.Headers.Authorization.Parameter;
            captured.ContentType = request.Content == null || request.Content.Headers.ContentType == null
                ? null : request.Content.Headers.ContentType.ToString();
            captured.Body = request.Content == null ? null
                : await request.Content.ReadAsStringAsync().ConfigureAwait(false);
            captured.Bytes = request.Content == null ? new byte[0]
                : await request.Content.ReadAsByteArrayAsync().ConfigureAwait(false);

            int position;
            lock (_gate)
            {
                _requests.Add(captured);
                position = _requests.Count - 1;
                Active++;
                if (Active > MaxActive) MaxActive = Active;
            }
            FirstEntered.Set();
            try
            {
                return await Respond(position, captured, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                lock (_gate) Active--;
            }
        }
    }

    private static HttpResponseMessage JsonResponse(int status, string body)
    {
        return new HttpResponseMessage((HttpStatusCode)status)
        {
            Content = new StringContent(body ?? string.Empty, Utf8, "application/json")
        };
    }

    private static HttpResponseMessage Accepted(string uid, int revision, int status = 200)
    {
        return JsonResponse(status, AcceptedLap(uid, revision));
    }

    // --------------------------------------------------------- fault injection
    private sealed class Faults : IObservationLedgerFaults
    {
        public bool ThrowBeforeSwitch;
        public bool ThrowAfterSwitch;
        public int BeforeCalls;
        public int AfterCalls;
        public void BeforePreserve() { }
        public void BeforeSwitch()
        {
            BeforeCalls++;
            if (ThrowBeforeSwitch) throw new IOException("injected-before-switch");
        }
        public void AfterSwitch()
        {
            AfterCalls++;
            if (ThrowAfterSwitch) throw new IOException("injected-after-switch");
        }
    }

    /// <summary>Fails the N-th snapshot switch after <see cref="Arm"/>. Captures run
    /// before arming, so each plan-time bulk quarantine gets its own counted call.</summary>
    private sealed class PlanBulkFaults : IObservationLedgerFaults
    {
        private int _failAt;
        private int _armedCalls;
        public string Message = "synthetic plan-switch failure";
        public void Arm(int failAt) { _failAt = failAt; _armedCalls = 0; }
        public void Disarm() { _failAt = 0; }
        public void BeforePreserve() { }
        public void BeforeSwitch()
        {
            if (_failAt == 0) return;
            _armedCalls++;
            if (_armedCalls == _failAt) throw new IOException(Message);
        }
        public void AfterSwitch() { }
    }

    /// <summary>Rebinds the fence after the coordinator's pre-send check but before the
    /// transport creates its HttpRequestMessage. Proves the final guard.</summary>
    private sealed class RebindingTransport : IObservationSendTransport
    {
        private readonly ObservationBindingFence _fence;
        private readonly IObservationSendTransport _inner;
        public RebindingTransport(ObservationBindingFence fence, IObservationSendTransport inner)
        {
            _fence = fence;
            _inner = inner;
        }
        public Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope,
            Func<bool> bindingGuard, CancellationToken cancellationToken)
        {
            _fence.Rebind(Binding(8));
            return _inner.SendAsync(envelope, bindingGuard, cancellationToken);
        }
    }

    /// <summary>Synchronous transport invocation failure: no send task is handed back,
    /// so no HTTP handler can have been entered by this call.</summary>
    private sealed class SyncThrowTransport : IObservationSendTransport
    {
        public int Calls;
        public Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope,
            Func<bool> bindingGuard, CancellationToken cancellationToken)
        {
            Calls++;
            throw new InvalidOperationException("synthetic synchronous transport throw");
        }
    }

    /// <summary>A transport that returns no task at all; also a proven no-start.</summary>
    private sealed class NullTaskTransport : IObservationSendTransport
    {
        public int Calls;
        public Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope,
            Func<bool> bindingGuard, CancellationToken cancellationToken)
        {
            Calls++;
            return null;
        }
    }

    private static ObservationLedgerEntry WithBinding(ObservationLedgerEntry entry,
        ObservationPairingBinding binding)
    {
        return new ObservationLedgerEntry(entry.Uid, entry.RecordRevision, entry.State,
            entry.RowJson, entry.Reason, binding.CaptureDeviceId, binding.CaptureOwnerUserId,
            binding.PairingGeneration, binding.PairingGenerationKnown,
            entry.EnqueuedAtUtc, entry.Attempts, entry.NextAttemptUtc);
    }

    private static ObservationOfferedRow Offered(ObservationLedgerEntry entry)
    {
        string diagnostic;
        var row = ObservationOfferedRow.TryCreate(entry.Uid, entry.RecordRevision,
            entry.RowJson, ObservationAckLane.Observation, entry.Binding, out diagnostic);
        if (row == null) throw new InvalidOperationException("offered: " + diagnostic);
        return row;
    }

    // -------------------------------------------------------------------- tests
    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // OS01 — default off: no read, no POST, no mutation.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var row = Row(Uid(1));
            Capture(store, row);
            string reason;
            if (!outbox.EnqueueLap(Row(Uid(2), false), out reason))
                throw new InvalidOperationException("legacy enqueue: " + reason);
            var before = LedgerText(store);
            var outboxBefore = File.ReadAllBytes(outbox.Path);
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(row.SummaryUid, 1)); }
            };
            var options = Enabled();
            options.Enabled = false;
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var result = Send(coordinator);
            Check("OS01 default-off doet geen POST en muteert ledger of legacy-outbox niet",
                result.Status == ObservationSendStatus.Disabled
                && !result.Posted && handler.RequestCount == 0
                && store.EntryCount == 1 && store.Find(row.SummaryUid, 1) != null
                && LedgerText(store) == before
                && outbox.LapCount == 1
                && Convert.ToBase64String(File.ReadAllBytes(outbox.Path))
                    == Convert.ToBase64String(outboxBefore),
                "status=" + result.Status + " posts=" + handler.RequestCount
                + " ledger=" + store.EntryCount + " laps=" + outbox.LapCount);
        }

        // OS02 — valid mixed sender delivery: exact request, ledger cleanup, legacy cleanup.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(10));
            var frozen = Capture(store, obs);
            var legacyLap = Row(Uid(11), false);
            string reason;
            if (!outbox.EnqueueLap(legacyLap, out reason)) throw new InvalidOperationException(reason);
            var ids = new MeasurementIdFactory();
            var legacyEvent = Event(ids, 0);
            if (!outbox.Enqueue(legacyEvent, out reason)) throw new InvalidOperationException(reason);

            var handler = new CapturingHandler();
            handler.Respond = delegate(int position, CapturedRequest request, CancellationToken token)
            {
                var events = Series(true, 1, "[" + Id(legacyEvent.EventUid, 1) + "]",
                    "[]", "[]", "[]", null);
                var laps = Series(true, 2,
                    "[" + Id(obs.SummaryUid, 1) + "," + Id(legacyLap.SummaryUid, 1) + "]",
                    "[]", "[]", "[]", null);
                return Task.FromResult(JsonResponse(200,
                    "{\"measurements\":{\"events\":" + events + ",\"laps\":" + laps + "}}"));
            };
            var http = new HttpClient(handler, false);
            var coordinator = Coordinator(store, outbox,
                new HttpObservationSendTransport(http, 65536), null);
            var result = Send(coordinator);

            var request0 = handler.RequestAt(0);
            var obsIndex = request0.Body.IndexOf(frozen, StringComparison.Ordinal);
            var legacyIndex = request0.Body.IndexOf(legacyLap.ToJson(), StringComparison.Ordinal);
            Check("OS02 geldige mixed send levert OBS en legacy per rij, met exacte requestbytes",
                result.Status == ObservationSendStatus.Delivered
                && result.Posted && result.HttpStatus == 200
                && handler.RequestCount == 1
                && request0.Method == "POST" && request0.Uri == Endpoint
                && request0.Authorization == "Bearer " + Sentinel
                && request0.ContentType == "application/json; charset=utf-8"
                && request0.Body == Encoding.UTF8.GetString(request0.Bytes)
                && request0.Bytes.Length == result.BodyBytes
                && request0.Bytes.Length == Encoding.UTF8.GetByteCount(request0.Body)
                && obsIndex > legacyIndex
                && store.EntryCount == 0 && store.DeliveredTotal == 1
                && result.ObservationDelivered == 1 && result.ObservationStored
                && result.LegacyCleanupApplied && result.LegacyAck != null
                && result.LegacyAck.Stored && result.LegacyAck.Removed == 2
                && outbox.LapCount == 0 && outbox.EventCount == 0
                && http.DefaultRequestHeaders.Authorization == null
                && !ContainsSentinel(LedgerText(store)) && !ContainsSentinel(result.ToString()),
                "status=" + result.Status + " rows=" + request0.Bytes.Length
                + " obsIndex=" + obsIndex + " legacyIndex=" + legacyIndex
                + " ledger=" + store.EntryCount + " laps=" + outbox.LapCount
                + " events=" + outbox.EventCount);
        }

        // OS03 — legacy-first 3 laps / 20 events: a full legacy lap set defers OBS.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(20));
            var frozen = Capture(store, obs);
            var ids = new MeasurementIdFactory();
            var legacyLaps = new List<MeasurementLapSummaryRecord>();
            string reason;
            for (var index = 0; index < 4; index++)
            {
                var lap = Row(Uid(21 + index), false, driver: "Legacy " + index);
                legacyLaps.Add(lap);
                if (!outbox.EnqueueLap(lap, out reason)) throw new InvalidOperationException(reason);
            }
            var events = new List<MeasurementEventRecord>();
            for (var index = 0; index < 21; index++)
            {
                var item = Event(ids, index);
                events.Add(item);
                if (!outbox.Enqueue(item, out reason)) throw new InvalidOperationException(reason);
            }

            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(JsonResponse(202, string.Empty)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var body = handler.RequestAt(0).Body;
            var laps = EntryArrayCount(body, "lapSummaries");
            var sentEvents = EntryArrayCount(body, "measurementEvents");
            Check("OS03 legacy vult eerst 3 laps en 20 events; OBS verdringt geen legacy en blijft staan",
                result.Posted && handler.RequestCount == 1
                && laps == 3 && sentEvents == 20
                && body.IndexOf(frozen, StringComparison.Ordinal) < 0
                && store.EntryCount == 1 && store.Find(obs.SummaryUid, 1) != null
                && store.Find(obs.SummaryUid, 1).Attempts == 0
                && result.ObservationDelivered == 0,
                "laps=" + laps + " events=" + sentEvents + " obsEntry=" + store.EntryCount
                + " status=" + result.Status);
        }

        // OS04 — exact UTF-8 boundary and hard-limit clamping.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(30), driver: "Bram éèü");
            Capture(store, obs);
            var legacy = Row(Uid(31), false, driver: "Légaçy");
            string reason;
            if (!outbox.EnqueueLap(legacy, out reason)) throw new InvalidOperationException(reason);

            var limits = new MeasurementLimits
            {
                MaxLapsPerFrame = 99,
                MaxEventsPerFrame = 99,
                MaxMeasurementBatchBytes = 900,
                MaxFrameBodyBytes = 999999
            };
            var due = outbox.Due(T0.AddMinutes(3), int.MaxValue, int.MaxValue);
            var plan = ObservationSendPlanner.Plan(due, store.Entries, Binding(), Caps,
                "{\"protocolVersion\":3,\"note\":\"éé\",\"sequence\":7}",
                Encoding.UTF8.GetByteCount("{\"protocolVersion\":3,\"note\":\"éé\",\"sequence\":7}"),
                limits, T0.AddMinutes(3));
            var bodyBytes = plan.Body == null ? 0 : Encoding.UTF8.GetByteCount(plan.Body);
            Check("OS04 planner rekent exacte UTF-8 maten, kan harde grenzen niet verhogen en defert OBS niet stil",
                plan.MeasurementBytes <= 900 && bodyBytes <= 24576
                && plan.LegacyBatch.Laps.Count <= 3 && plan.LegacyBatch.Events.Count <= 20
                && plan.Body.IndexOf("Légaçy", StringComparison.Ordinal) >= 0
                && plan.DeferredObservation >= 1
                && plan.Offered != null && plan.Offered.ObservationCount == 0,
                "measurement=" + plan.MeasurementBytes + " body=" + bodyBytes
                + " laps=" + plan.LegacyBatch.Laps.Count + " deferredObs=" + plan.DeferredObservation);
        }

        // OS05 — plan-time binding change quarantines exact old rows, never POSTs.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var obs = Row(Uid(40));
            var frozen = Capture(store, obs);
            fence.Rebind(Binding(8));
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var entry = store.Find(obs.SummaryUid, 1);
            Check("OS05 plan-time epochwissel quarantineert de exacte rij als capture_binding_changed zonder POST",
                result.Status == ObservationSendStatus.BindingChanged
                && !result.Posted && handler.RequestCount == 0
                && entry != null && entry.State == ObservationLedgerState.Quarantine
                && entry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && entry.RowJson == frozen && store.DeliveredTotal == 0
                && store.QuarantineTotal == 1,
                "status=" + result.Status + " posts=" + handler.RequestCount
                + " state=" + (entry == null ? "missing" : entry.State.ToString())
                + " reason=" + (entry == null ? null : entry.ReasonCode));
        }

        // OS06 — guard immediately before HttpRequestMessage refuses a late rebind.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var obs = Row(Uid(41));
            Capture(store, obs);
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var http = new HttpClient(handler, false);
            var transport = new RebindingTransport(fence,
                new HttpObservationSendTransport(http, 65536));
            var coordinator = Coordinator(store, outbox, transport, null);
            var result = Send(coordinator);
            var entry = store.Find(obs.SummaryUid, 1);
            Check("OS06 guard direct vóór de HttpRequestMessage weigert een late epochwissel; geen request",
                result.Status == ObservationSendStatus.BindingChanged
                && handler.RequestCount == 0
                && entry != null && entry.State == ObservationLedgerState.Quarantine
                && entry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged,
                "status=" + result.Status + " requests=" + handler.RequestCount
                + " state=" + (entry == null ? "missing" : entry.State.ToString()));
        }

        // OS07 — token is frozen at envelope build; a boundary mutation cannot mix snapshots.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(50));
            var frozen = Capture(store, obs);
            var token = Sentinel;
            var release = Gate();
            var entered = new ManualResetEventSlim(false);
            var handler = new CapturingHandler();
            handler.Respond = async delegate(int position, CapturedRequest request, CancellationToken ct)
            {
                entered.Set();
                await release.Task;
                return Accepted(obs.SummaryUid, 1);
            };
            var coordinator = Coordinator(store, outbox, handler, delegate { return token; }, Enabled(10000));
            var task = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            token = OtherToken;
            release.TrySetResult(true);
            var result = task.GetAwaiter().GetResult();
            var request0 = handler.RequestAt(0);
            Check("OS07 token/rows zijn één bevroren snapshot: request draagt de originele token en rij",
                result.Status == ObservationSendStatus.Delivered
                && request0.Authorization == "Bearer " + Sentinel
                && request0.Body.IndexOf(frozen, StringComparison.Ordinal) >= 0
                && store.EntryCount == 0 && store.DeliveredTotal == 1
                && !ContainsSentinel(result.ToString())
                && !ContainsSentinel(LedgerText(store)),
                "auth=" + request0.Authorization + " status=" + result.Status
                + " sentinelInLedger=" + ContainsSentinel(LedgerText(store)));
        }

        // OS08 — epoch change in flight: ACK must not commit under the new fence.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var obs = Row(Uid(51));
            var frozen = Capture(store, obs);
            var entered = new ManualResetEventSlim(false);
            var release = Gate();
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                entered.Set();
                await release.Task;
                return Accepted(obs.SummaryUid, 1);
            };
            var coordinator = Coordinator(store, outbox, handler, null, Enabled(10000));
            var task = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            fence.Rebind(Binding(8));
            var currentAtRelease = fence.IsCurrent(Binding());
            release.TrySetResult(true);
            var result = task.GetAwaiter().GetResult();
            var entry = store.Find(obs.SummaryUid, 1);
            Check("OS08 epochwissel tijdens de request levert geen ACK-cleanup en geen teller",
                result.Status == ObservationSendStatus.NotDelivered
                && result.Posted && entry != null
                && entry.RowJson == frozen && store.DeliveredTotal == 0
                && store.EntryCount == 1,
                "status=" + result.Status + " entries=" + store.EntryCount
                + " deliveredTotal=" + store.DeliveredTotal
                + " gen=" + store.BindingFence.Current.PairingGeneration
                + " sameFence=" + object.ReferenceEquals(fence, store.BindingFence)
                + " apply=" + (result.LedgerApply == null ? "null" : result.LedgerApply.Status.ToString())
                + " expected=" + (result.Ack == null ? "null" : result.Ack.ExpectedBinding.PairingGeneration.ToString())
                + " currentAtRelease=" + currentAtRelease);
        }

        // OS09 — descriptive context changes are not a fence.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var first = Row(Uid(60), session: "session-one", car: "car-a", track: 10);
            var second = Row(Uid(61), session: "session-two", car: "car-b", track: 20);
            Capture(store, first);
            Capture(store, second);
            var handler = new CapturingHandler();
            handler.Respond = delegate
            {
                return Task.FromResult(JsonResponse(200,
                    LapAck(true, 2,
                        "[" + Id(first.SummaryUid, 1) + "," + Id(second.SummaryUid, 1) + "]",
                        "[]", "[]", "[]", null)));
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            Check("OS09 sessie-/car-/trackverschil is beschrijvende context en quarantineert niet",
                result.Status == ObservationSendStatus.Delivered
                && handler.RequestCount == 1
                && handler.RequestAt(0).Body.IndexOf(first.ToJson(), StringComparison.Ordinal) >= 0
                && handler.RequestAt(0).Body.IndexOf(second.ToJson(), StringComparison.Ordinal) >= 0
                && store.EntryCount == 0 && store.QuarantineTotal == 0,
                "status=" + result.Status + " requests=" + handler.RequestCount
                + " delivered=" + store.DeliveredTotal);
        }

        // OS10 — a held lease prevents the pairing callback's first side effect.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(70));
            Capture(store, obs);
            var entered = new ManualResetEventSlim(false);
            var release = Gate();
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                entered.Set();
                await release.Task;
                return Accepted(obs.SummaryUid, 1);
            };
            var coordinator = Coordinator(store, outbox, handler, null, Enabled(10000));
            var sendTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            var heldAfterStart = coordinator.LeaseHeld;
            var sendStatusAfterStart = sendTask.Status.ToString();
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            var callbackInvoked = false;
            var heldBeforePair = coordinator.LeaseHeld;
            var pairTask = coordinator.PairAsync(delegate
            {
                callbackInvoked = true;
                return Task.FromResult(ObservationPairCommit.CommittedWith(Binding(8)));
            }, CancellationToken.None);
            var waiting = WaitUntil(() => coordinator.PendingLeaseWaiters == 1, 3000);
            var blocked = !callbackInvoked && !pairTask.IsCompleted;
            release.TrySetResult(true);
            var sendResult = sendTask.GetAwaiter().GetResult();
            var pairResult = pairTask.GetAwaiter().GetResult();
            Check("OS10 sendlease houdt de pairingcallback tegen vóór zijn eerste neveneffect",
                waiting && blocked && callbackInvoked && pairResult.Committed
                && pairResult.PublishedBinding.PairingGeneration == 8
                && sendResult.Status == ObservationSendStatus.Delivered
                && !coordinator.LeaseHeld,
                "waiting=" + waiting + " blocked=" + blocked + " send=" + sendResult.Status
                + " pair=" + pairResult.Status + " heldBeforePair=" + heldBeforePair
                + " heldAfterStart=" + heldAfterStart + " sendStatus=" + sendStatusAfterStart
                + " pending=" + coordinator.PendingLeaseWaiters);
        }

        // OS11 — a pairing callback holds the sender.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(71));
            Capture(store, obs);
            var callbackEntered = new ManualResetEventSlim(false);
            var releaseCallback = Gate();
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null, Enabled(10000));
            var pairTask = coordinator.PairAsync(async delegate
            {
                callbackEntered.Set();
                await releaseCallback.Task;
                return ObservationPairCommit.CommittedWith(Binding());
            }, CancellationToken.None);
            if (!WaitUntil(() => callbackEntered.IsSet, 3000))
                throw new InvalidOperationException("callback not entered");
            var sendTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            var waiting = WaitUntil(() => coordinator.PendingLeaseWaiters == 1, 3000);
            var noRequest = handler.RequestCount == 0 && !sendTask.IsCompleted;
            releaseCallback.TrySetResult(true);
            var pairResult = pairTask.GetAwaiter().GetResult();
            var sendResult = sendTask.GetAwaiter().GetResult();
            Check("OS11 pairingcallback houdt de sender tegen; na publicatie loopt de send door",
                waiting && noRequest && pairResult.Committed
                && sendResult.Status == ObservationSendStatus.Delivered
                && handler.RequestCount == 1,
                "waiting=" + waiting + " noRequest=" + noRequest + " pair=" + pairResult.Status
                + " send=" + sendResult.Status);
        }

        // OS12 — lease timeout is deferred and legacy bypass stays available.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(80));
            Capture(store, obs);
            string reason;
            var legacy = Row(Uid(81), false);
            if (!outbox.EnqueueLap(legacy, out reason)) throw new InvalidOperationException(reason);
            var entered = new ManualResetEventSlim(false);
            var release = Gate();
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                entered.Set();
                await release.Task;
                return Accepted(obs.SummaryUid, 1);
            };
            var options = Enabled(10000);
            options.LeaseWaitMilliseconds = 60;
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var sendTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            var second = Send(coordinator);
            MeasurementBatchPlan bypassPlan;
            var bypassBody = ObservationLegacyBypass.BuildBody(Core, outbox, T0.AddMinutes(3),
                Caps, Encoding.UTF8.GetByteCount(Core), null, out bypassPlan);
            var bypassOk = bypassBody != null && bypassPlan.HasMeasurements
                && bypassPlan.Batch.Laps.Count == 1
                && handler.RequestCount == 1;
            var stateBeforeRelease = store.Find(obs.SummaryUid, 1);
            release.TrySetResult(true);
            var first = sendTask.GetAwaiter().GetResult();
            Check("OS12 lease-timeout is Deferred zonder quarantine; legacy-only bypass blijft direct bruikbaar",
                second.Status == ObservationSendStatus.LeaseTimeout
                && !second.Posted && bypassOk
                && stateBeforeRelease != null
                && stateBeforeRelease.State != ObservationLedgerState.Quarantine
                && first.Status == ObservationSendStatus.Delivered,
                "second=" + second.Status + " bypass=" + bypassOk
                + " bypassLaps=" + (bypassPlan == null ? -1 : bypassPlan.Batch.Laps.Count)
                + " body=" + (bypassBody == null ? "null" : "ok")
                + " first=" + first.Status + " requests=" + handler.RequestCount);
        }

        // OS13 — 2xx bodies without per-row proof never remove OBS; legacy is not dropped either.
        {
            var bodies = new[]
            {
                new object[] { 202, string.Empty, "empty-202" },
                new object[] { 200, LapAck(false, 1, "[]", "[]", "[]", "[]", null), "stored-false" },
                new object[] { 200, "{not json", "malformed" },
                new object[] { 200, "{\"measurements\":{\"laps\":{\"received\":1,\"accepted\":[],\"duplicates\":[],\"superseded\":[],\"rejected\":[],\"block_error\":17,\"stored\":true}}}", "numeric-block" },
                new object[] { 200, LapAck(true, 1, "[" + "]" , "[]", "[]", "[]", null), "missing-id" }
            };
            var allOk = true;
            var detail = new StringBuilder();
            foreach (var item in bodies)
            {
                var dir = NewDirectory();
                var store = Store(dir);
                var outbox = Outbox(dir);
                var obs = Row(Uid(90));
                var frozen = Capture(store, obs);
                string legacyReason;
                if (!outbox.EnqueueLap(Row(Uid(89), false), out legacyReason))
                    throw new InvalidOperationException(legacyReason);
                var status = (int)item[0];
                var body = (string)item[1];
                var label = (string)item[2];
                var handler = new CapturingHandler
                {
                    Respond = delegate { return Task.FromResult(JsonResponse(status, body)); }
                };
                var result = Send(Coordinator(store, outbox, handler, null));
                var entry = store.Find(obs.SummaryUid, 1);
                var ok = result.Status == ObservationSendStatus.NotDelivered
                    && entry != null && entry.RowJson == frozen
                    && store.DeliveredTotal == 0 && store.QuarantineTotal == 0
                    && outbox.LapCount == 1;
                if (!ok) { allOk = false; detail.Append(label + "=" + result.Status + ";"); }
            }
            Check("OS13 HTTP202/leeg/stored:false/malformed/numerieke block_error/geen id verwijderen niets",
                allOk, allOk ? "vijf vormen retainen exact" : detail.ToString());
        }

        // OS14 — duplicate delivery decisions for one UID are ambiguous, never a vote.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(91));
            var frozen = Capture(store, obs);
            var handler = new CapturingHandler
            {
                Respond = delegate
                {
                    return Task.FromResult(JsonResponse(200, LapAck(true, 1,
                        "[" + Id(obs.SummaryUid, 1) + "]",
                        "[" + Id(obs.SummaryUid, 1) + "]", "[]", "[]", null)));
                }
            };
            var result = Send(Coordinator(store, outbox, handler, null));
            var entry = store.Find(obs.SummaryUid, 1);
            Check("OS14 dubbele leveringsbesluiten voor dezelfde UID zijn NotDelivered en verwijderen niets",
                result.Status == ObservationSendStatus.NotDelivered
                && entry != null && entry.RowJson == frozen
                && store.DeliveredTotal == 0
                && result.Ack != null && result.Ack.Diagnostics.Contains("ack_duplicate_delivery"),
                "status=" + result.Status + " diagnostics="
                + (result.Ack == null ? "none" : string.Join(",", result.Ack.Diagnostics)));
        }

        // OS15 — temporary, permanent and unknown rejections map to the accepted union.
        {
            var cases = new[]
            {
                new object[] { "observation_unavailable", ObservationLedgerState.Deferred,
                    ObservationLedgerReasons.ObservationUnavailable, "temporary" },
                new object[] { "payload.lapSummaries[0].observation is invalid: observation_invalid_number",
                    ObservationLedgerState.Quarantine,
                    ObservationLedgerReasons.ObservationInvalidNumber, "permanent" },
                new object[] { "some_new_server_code", ObservationLedgerState.Quarantine,
                    ObservationLedgerReasons.ServerRejectedUnknown, "unknown" }
            };
            var allOk = true;
            var detail = new StringBuilder();
            foreach (var item in cases)
            {
                var dir = NewDirectory();
                var store = Store(dir);
                var outbox = Outbox(dir);
                var obs = Row(Uid(92));
                var frozen = Capture(store, obs);
                var handler = new CapturingHandler
                {
                    Respond = delegate
                    {
                        return Task.FromResult(JsonResponse(200, LapAck(true, 1, "[]", "[]", "[]",
                            "[" + Rejection(obs.SummaryUid, 0, (string)item[0]) + "]", null)));
                    }
                };
                var result = Send(Coordinator(store, outbox, handler, null));
                var entry = store.Find(obs.SummaryUid, 1);
                var ok = entry != null && entry.State == (ObservationLedgerState)item[1]
                    && entry.ReasonCode == (string)item[2]
                    && entry.RowJson == frozen && store.DeliveredTotal == 0
                    && result.ObservationDelivered == 0;
                if (ok && entry.State == ObservationLedgerState.Deferred)
                    ok = entry.Attempts == 1 && entry.NextAttemptUtc.HasValue
                        && entry.NextAttemptUtc.Value > T0.AddMinutes(3);
                if (!ok) { allOk = false; detail.Append(item[3] + "=" + (entry == null ? "missing" : entry.State + "/" + entry.ReasonCode) + ";"); }
            }
            Check("OS15 tijdelijke/permanente/onbekende afwijzing volgt de geaccepteerde per-rij-union",
                allOk, allOk ? "drie klassen correct" : detail.ToString());
        }

        // OS16 — full mixed offer [OBS, legacy, OBS]: an id/index conflict touches neither row.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var first = Row(Uid(100));
            var second = Row(Uid(101));
            var frozenFirst = Capture(store, first);
            var frozenSecond = Capture(store, second);
            var legacy = Row(Uid(102), false);
            string diagnostic;
            var batch = ObservationOfferedBatch.TryCreate(new[]
            {
                ObservationOfferedRow.TryCreate(first.SummaryUid, 1, frozenFirst,
                    ObservationAckLane.Observation, Binding(), out diagnostic),
                ObservationOfferedRow.TryCreate(legacy.SummaryUid, 1, legacy.ToJson(),
                    ObservationAckLane.Legacy, null, out diagnostic),
                ObservationOfferedRow.TryCreate(second.SummaryUid, 1, frozenSecond,
                    ObservationAckLane.Observation, Binding(), out diagnostic)
            }, out diagnostic);
            var ack = LapAck(true, 3, "[]", "[]", "[]",
                "[" + Rejection(first.SummaryUid, 1, "observation_invalid_number") + "]", null);
            var resolution = ObservationAckResolver.Resolve(ack, batch, Binding());
            var applied = store.ApplyAck(resolution, T0.AddMinutes(3));
            var entryFirst = store.Find(first.SummaryUid, 1);
            var entrySecond = store.Find(second.SummaryUid, 1);
            Check("OS16 mixed index0/1/2 id/indexconflict raakt beide betrokken rijen niet en quarantineert niet",
                batch != null && resolution.Rows[0].Outcome == ObservationAckClass.NotDelivered
                && resolution.Rows[2].Outcome == ObservationAckClass.NotDelivered
                && resolution.Rows[0].Diagnostic == "ack_index_id_conflict"
                && resolution.Rows[1].Diagnostic == "ack_index_id_conflict"
                && applied.Status == ObservationAckApplyStatus.NoChanges
                && entryFirst != null && entrySecond != null
                && entryFirst.RowJson == frozenFirst && entrySecond.RowJson == frozenSecond
                && store.QuarantineTotal == 0 && store.DeliveredTotal == 0,
                "batch=" + (batch == null ? "null" : batch.Count.ToString())
                + " diag0=" + resolution.Rows[0].Diagnostic
                + " diag1=" + resolution.Rows[1].Diagnostic
                + " diag2=" + resolution.Rows[2].Diagnostic
                + " entries=" + store.EntryCount);
        }

        // OS17 — timeout after a synthetic server accept: same identity, duplicate retry removes once.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(110));
            var frozen = Capture(store, obs);
            var handler = new CapturingHandler();
            handler.Respond = async delegate(int position, CapturedRequest request, CancellationToken ct)
            {
                if (position == 0)
                {
                    await Task.Delay(400);
                    return Accepted(obs.SummaryUid, 1);
                }
                return JsonResponse(200, LapAck(true, 1,
                    "[]", "[" + Id(obs.SummaryUid, 1) + "]", "[]", "[]", null));
            };
            var options = Enabled(120);
            options.LeaseWaitMilliseconds = 1000;
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var first = Send(coordinator);
            var afterTimeout = store.Find(obs.SummaryUid, 1);
            var totalAfterTimeout = store.DeliveredTotal;
            var second = Send(coordinator, now: T0.AddMinutes(4));
            var request0 = handler.RequestAt(0);
            var request1 = handler.RequestAt(1);
            Check("OS17 timeout na serveraccept retryt met dezelfde UID/rev/RowJson en duplicate ruimt één keer op",
                first.Status == ObservationSendStatus.TimedOut
                && afterTimeout != null && afterTimeout.RowJson == frozen
                && afterTimeout.Attempts == 1 && totalAfterTimeout == 0
                && handler.RequestCount == 2
                && request0.Authorization == request1.Authorization
                && request0.Body.IndexOf(frozen, StringComparison.Ordinal) >= 0
                && request1.Body.IndexOf(frozen, StringComparison.Ordinal) >= 0
                && second.Status == ObservationSendStatus.Delivered
                && store.EntryCount == 0 && store.DeliveredTotal == 1,
                "first=" + first.Status + " second=" + second.Status
                + " attempts=" + (afterTimeout == null ? -1 : afterTimeout.Attempts)
                + " requests=" + handler.RequestCount + " total=" + store.DeliveredTotal);
        }

        // OS18 — a late response from the timed-out attempt never runs a second commit.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(111));
            var frozen = Capture(store, obs);
            var lateDone = new ManualResetEventSlim(false);
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                await Task.Delay(350);
                lateDone.Set();
                return Accepted(obs.SummaryUid, 1);
            };
            var options = Enabled(100);
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var first = Send(coordinator);
            var lateObserved = WaitUntil(() => lateDone.IsSet, 3000);
            Thread.Sleep(50); // bounded: the abandoned task has published its completion
            var entry = store.Find(obs.SummaryUid, 1);
            Check("OS18 een late response na timeout schrijft geen tweede ACK-commit en geen teller",
                first.Status == ObservationSendStatus.TimedOut && lateObserved
                && entry != null && entry.RowJson == frozen
                && store.DeliveredTotal == 0 && store.EntryCount == 1,
                "first=" + first.Status + " late=" + lateObserved
                + " total=" + store.DeliveredTotal + " entries=" + store.EntryCount);
        }

        // OS19 — caller cancellation is Deferred/NotDelivered, releases the lease, no quarantine.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(112));
            var frozen = Capture(store, obs);
            var entered = new ManualResetEventSlim(false);
            var handler = new CapturingHandler();
            handler.Respond = async delegate(int position, CapturedRequest request, CancellationToken ct)
            {
                if (position == 0)
                {
                    entered.Set();
                    await Task.Delay(1000);
                    return Accepted(obs.SummaryUid, 1);
                }
                return Accepted(obs.SummaryUid, 1);
            };
            var coordinator = Coordinator(store, outbox, handler, null, Enabled(10000));
            var source = new CancellationTokenSource();
            var task = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), source.Token);
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            source.Cancel();
            var canceled = task.GetAwaiter().GetResult();
            var entry = store.Find(obs.SummaryUid, 1);
            var leaseReleased = WaitUntil(() => !coordinator.LeaseHeld, 1000);
            var retry = Send(coordinator, now: T0.AddMinutes(4));
            Check("OS19 cancel tijdens transport is Canceled/Deferred, quarantineert niet en laat de lease niet achter",
                canceled.Status == ObservationSendStatus.Canceled
                && entry != null && entry.RowJson == frozen
                && entry.State != ObservationLedgerState.Quarantine
                && leaseReleased && retry.Status == ObservationSendStatus.Delivered
                && store.DeliveredTotal == 1,
                "cancel=" + canceled.Status + " leaseReleased=" + leaseReleased
                + " retry=" + retry.Status + " total=" + store.DeliveredTotal);
        }

        // OS20 — failed pairing callback releases the lease and never publishes a new epoch.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(120));
            Capture(store, obs);
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var before = coordinator.CurrentBinding;
            var failed = coordinator.PairAsync(delegate
            {
                throw new InvalidOperationException("synthetic callback failure");
            }, CancellationToken.None).GetAwaiter().GetResult();
            var after = coordinator.CurrentBinding;
            var send = Send(coordinator);
            Check("OS20 mislukte pairingcallback publiceert geen epoch en laat geen lock achter",
                failed.Status == ObservationPairTransitionStatus.CallbackFailed
                && failed.CallbackInvoked && !failed.Committed
                && ObservationBindingFence.SameBinding(before, after)
                && after.PairingGeneration == 7
                && send.Status == ObservationSendStatus.Delivered,
                "pair=" + failed.Status + " before=" + before.PairingGeneration
                + " after=" + after.PairingGeneration + " send=" + send.Status);
        }

        // OS21 — lease expiry for a pairing transition does not execute its callback.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(121));
            Capture(store, obs);
            var entered = new ManualResetEventSlim(false);
            var release = Gate();
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                entered.Set();
                await release.Task;
                return Accepted(obs.SummaryUid, 1);
            };
            var options = Enabled(10000);
            options.LeaseWaitMilliseconds = 60;
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var sendTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3), CancellationToken.None);
            if (!WaitUntil(() => entered.IsSet, 3000)) throw new InvalidOperationException("no request");
            var invoked = false;
            var pair = coordinator.PairAsync(delegate
            {
                invoked = true;
                return Task.FromResult(ObservationPairCommit.CommittedWith(Binding(9)));
            }, CancellationToken.None).GetAwaiter().GetResult();
            release.TrySetResult(true);
            sendTask.GetAwaiter().GetResult();
            Check("OS21 lease-timeout vóór een pairingtransition voert de callback niet uit",
                pair.Status == ObservationPairTransitionStatus.LeaseTimeout
                && !pair.CallbackInvoked && !invoked
                && coordinator.CurrentBinding.PairingGeneration == 7,
                "pair=" + pair.Status + " invoked=" + invoked
                + " generation=" + coordinator.CurrentBinding.PairingGeneration);
        }

        // OS22 — restart keeps the exact frozen row after a failed attempt.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(130));
            var frozen = Capture(store, obs);
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(JsonResponse(503, string.Empty)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var failed = Send(coordinator);
            var restarted = Store(dir);
            var entry = restarted.Find(obs.SummaryUid, 1);
            var entryOk = entry != null && entry.RowJson == frozen
                && entry.RecordRevision == 1 && entry.Attempts == 1;
            var retryHandler = new CapturingHandler
            {
                Respond = delegate
                {
                    return Task.FromResult(JsonResponse(200, LapAck(true, 1,
                        "[]", "[" + Id(obs.SummaryUid, 1) + "]", "[]", "[]", null)));
                }
            };
            var retryCoordinator = Coordinator(restarted, outbox, retryHandler, null);
            var retry = Send(retryCoordinator, now: T0.AddMinutes(4));
            Check("OS22 na HTTP503 en restart blijven UID/revisie/RowJson exact; retry levert één keer",
                failed.Status == ObservationSendStatus.Deferred && entryOk
                && retry.Status == ObservationSendStatus.Delivered
                && restarted.EntryCount == 0 && restarted.DeliveredTotal == 1,
                "failed=" + failed.Status + " entryOk=" + entryOk
                + " retry=" + retry.Status + " total=" + restarted.DeliveredTotal);
        }

        // OS23 — envelope is immutable/redacted and freezes the exact row bytes.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(140), driver: "Originele Coureur");
            var frozen = Capture(store, obs);
            // Mutate the source object after capture: the frozen ledger row and body
            // must not change.
            obs.Observation = null;
            obs.CurrentDriverName = "Mutated Driver";
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            string diagnostic;
            var offered = ObservationOfferedRow.TryCreate(obs.SummaryUid, 1, frozen,
                ObservationAckLane.Observation, Binding(), out diagnostic);
            var batch = ObservationOfferedBatch.TryCreate(new[] { offered }, out diagnostic);
            var envelope = SendEnvelope.Create(Sentinel, Endpoint, Binding(), batch, Core, 1);
            var readonlyRows = false;
            try { envelope.Rows.Add(offered); }
            catch (NotSupportedException) { readonlyRows = true; }
            var toStringSafe = !ContainsSentinel(envelope.ToString())
                && !ContainsSentinel(result.ToString())
                && envelope.ToString().IndexOf("Originele", StringComparison.Ordinal) < 0;
            Check("OS23 envelope is onveranderlijk en geredigeerd; bronmutatie verandert de verzonden rij niet",
                result.Status == ObservationSendStatus.Delivered
                && handler.RequestAt(0).Body.IndexOf(frozen, StringComparison.Ordinal) >= 0
                && handler.RequestAt(0).Body.IndexOf("Mutated Driver", StringComparison.Ordinal) < 0
                && readonlyRows && toStringSafe
                && envelope.Token == Sentinel
                && envelope.Body == Core,
                "readonly=" + readonlyRows + " toStringSafe=" + toStringSafe
                + " status=" + result.Status);
        }

        // OS24 — before-switch IO failure keeps the row; a later retry delivers once.
        {
            var dir = NewDirectory();
            var faults = new Faults();
            var store = Store(dir, null, null, faults);
            var outbox = Outbox(dir);
            var obs = Row(Uid(150));
            var frozen = Capture(store, obs);
            faults.ThrowBeforeSwitch = true;
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var failed = Send(coordinator);
            var entry = store.Find(obs.SummaryUid, 1);
            var beforeOk = entry != null && entry.RowJson == frozen
                && store.DeliveredTotal == 0 && faults.BeforeCalls > 0;
            faults.ThrowBeforeSwitch = false;
            var retry = Send(coordinator, now: T0.AddMinutes(4));
            Check("OS24 IO-fout vóór de switch laat de rij exact staan; een latere retry levert één keer",
                failed.Status == ObservationSendStatus.NotDelivered && beforeOk
                && retry.Status == ObservationSendStatus.Delivered
                && store.EntryCount == 0 && store.DeliveredTotal == 1,
                "failed=" + failed.Status + " beforeOk=" + beforeOk
                + " retry=" + retry.Status + " total=" + store.DeliveredTotal);
        }

        // OS25 — after-switch uncertainty reconciles the full snapshot truthfully.
        {
            var dir = NewDirectory();
            var faults = new Faults();
            var store = Store(dir, null, null, faults);
            var outbox = Outbox(dir);
            var obs = Row(Uid(151));
            var frozen = Capture(store, obs);
            faults.ThrowAfterSwitch = true;
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(obs.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var reloaded = Store(dir);
            Check("OS25 after-switch onzekerheid verzoent de volledige snapshot en telt niet dubbel",
                faults.AfterCalls > 0
                && store.DeliveredTotal == 1 && store.EntryCount == 0
                && reloaded.DeliveredTotal == 1 && reloaded.EntryCount == 0
                && (result.Status == ObservationSendStatus.Delivered
                    || result.Status == ObservationSendStatus.Uncertain
                    || result.Status == ObservationSendStatus.NotDelivered),
                "afterCalls=" + faults.AfterCalls + " status=" + result.Status
                + " total=" + store.DeliveredTotal + " entries=" + store.EntryCount);
        }

        // OS26 — a full sidecar does not block the legacy drain.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var ids = new MeasurementIdFactory();
            for (var index = 0; index < 64; index++)
            {
                var row = Row(Uid(200 + index), driver: "Full " + index);
                var captured = store.Capture(Candidate(row));
                if (!captured.Captured)
                    throw new InvalidOperationException("fill: " + captured.Diagnostic);
            }
            string reason;
            var legacy = Row(Uid(300), false);
            if (!outbox.EnqueueLap(legacy, out reason)) throw new InvalidOperationException(reason);
            var eventRow = Event(ids, 0);
            if (!outbox.Enqueue(eventRow, out reason)) throw new InvalidOperationException(reason);
            MeasurementBatchPlan plan;
            var body = ObservationLegacyBypass.BuildBody(Core, outbox, T0.AddMinutes(3),
                Caps, Encoding.UTF8.GetByteCount(Core), null, out plan);
            var handler = new CapturingHandler();
            handler.Respond = delegate
            {
                var events = Series(true, 1, "[" + Id(eventRow.EventUid, 1) + "]",
                    "[]", "[]", "[]", null);
                var laps = Series(true, 1, "[" + Id(legacy.SummaryUid, 1) + "]",
                    "[]", "[]", "[]", null);
                return Task.FromResult(JsonResponse(200,
                    "{\"measurements\":{\"events\":" + events + ",\"laps\":" + laps + "}}"));
            };
            var sender = new MeasurementSender(outbox, new HttpClient(handler, false),
                delegate { return Caps; }, MeasurementLimits.Default());
            var sent = sender.SendAsync(Endpoint, Sentinel, Core, T0.AddMinutes(3),
                CancellationToken.None).GetAwaiter().GetResult();
            Check("OS26 een volle 64-rij-sidecar blokkeert de gewone legacy-drain niet",
                body != null && plan.Batch.Laps.Count == 1
                && sent.Sent && sent.Stored && sent.EventsSent == 1 && sent.LapsSent == 1
                && store.EntryCount == 64 && handler.RequestCount == 1
                && outbox.LapCount == 0 && outbox.EventCount == 0,
                "body=" + (body == null ? "null" : "ok") + " sent=" + sent.Sent
                + " stored=" + sent.Stored + " entries=" + store.EntryCount);
        }

        // OS27 — unrelated deferred/quarantine rows are not touched by a delivery.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var target = Row(Uid(400));
            var other = Row(Uid(401));
            var quarantined = Row(Uid(402));
            Capture(store, target);
            Capture(store, other);
            Capture(store, quarantined);
            var quarantineResult = store.Quarantine(quarantined.SummaryUid, 1,
                ObservationLedgerReasons.ObservationInvalidNumber);
            if (!quarantineResult.Committed) throw new InvalidOperationException("quarantine fixture");
            var frozenOther = store.Find(other.SummaryUid, 1).RowJson;
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(target.SummaryUid, 1)); }
            };
            var result = Send(Coordinator(store, outbox, handler, null));
            var otherEntry = store.Find(other.SummaryUid, 1);
            var quarantineEntry = store.Find(quarantined.SummaryUid, 1);
            Check("OS27 een levering raakt geen andere deferred/quarantine-rij en verhoogt de teller één keer",
                result.Status == ObservationSendStatus.PartiallyDelivered
                && result.ObservationDelivered == 1
                && otherEntry != null && otherEntry.State == ObservationLedgerState.Pending
                && otherEntry.RowJson == frozenOther
                && quarantineEntry.State == ObservationLedgerState.Quarantine
                && store.EntryCount == 2 && store.DeliveredTotal == 1
                && store.QuarantineTotal == 1,
                "status=" + result.Status + " entries=" + store.EntryCount
                + " delivered=" + store.DeliveredTotal + " quarantine=" + store.QuarantineTotal);
        }


        // OS28 — a rejected OBS row does not roll back an accepted legacy sibling.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(500));
            Capture(store, obs);
            var legacy = Row(Uid(501), false);
            string reason;
            if (!outbox.EnqueueLap(legacy, out reason)) throw new InvalidOperationException(reason);
            var handler = new CapturingHandler
            {
                Respond = delegate
                {
                    return Task.FromResult(JsonResponse(200, LapAck(true, 2,
                        "[" + Id(legacy.SummaryUid, 1) + "]", "[]", "[]",
                        "[" + Rejection(obs.SummaryUid, null, "observation_invalid_number") + "]",
                        null)));
                }
            };
            var result = Send(Coordinator(store, outbox, handler, null));
            var obsEntry = store.Find(obs.SummaryUid, 1);
            Check("OS28 een afgekeurde OBS-rij draait een geaccepteerde legacy-buur niet terug",
                result.Status == ObservationSendStatus.PartiallyDelivered
                && result.LegacyCleanupApplied && result.LegacyAck != null
                && result.LegacyAck.Stored && result.LegacyAck.Removed == 1
                && outbox.LapCount == 0
                && obsEntry != null && obsEntry.State == ObservationLedgerState.Quarantine
                && obsEntry.ReasonCode == ObservationLedgerReasons.ObservationInvalidNumber
                && store.DeliveredTotal == 0,
                "status=" + result.Status + " legacyRemoved="
                + (result.LegacyAck == null ? -1 : result.LegacyAck.Removed)
                + " obs=" + (obsEntry == null ? "missing" : obsEntry.State.ToString())
                + " laps=" + outbox.LapCount);
        }

        // OS29 — the mixed body builder is byte-identical to the legacy sender when no OBS is due.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var ids = new MeasurementIdFactory();
            string reason;
            var lapA = Row(Uid(510), false, driver: "Lap A");
            var lapB = Row(Uid(511), false, driver: "Lap B");
            if (!outbox.EnqueueLap(lapA, out reason)) throw new InvalidOperationException(reason);
            if (!outbox.EnqueueLap(lapB, out reason)) throw new InvalidOperationException(reason);
            var eventA = Event(ids, 0);
            var eventB = Event(ids, 1);
            if (!outbox.Enqueue(eventA, out reason)) throw new InvalidOperationException(reason);
            if (!outbox.Enqueue(eventB, out reason)) throw new InvalidOperationException(reason);
            var now = T0.AddMinutes(3);
            var due = outbox.Due(now, int.MaxValue, int.MaxValue);
            var plan = ObservationSendPlanner.Plan(due, new List<ObservationLedgerEntry>(),
                Binding(), Caps, Core, Encoding.UTF8.GetByteCount(Core), null, now);
            var sender = new MeasurementSender(outbox,
                new HttpClient(new CapturingHandler
                {
                    Respond = delegate { return Task.FromResult(JsonResponse(200, "")); }
                }, false), delegate { return Caps; }, MeasurementLimits.Default());
            MeasurementBatchPlan legacyPlan;
            var legacyBody = sender.BuildBody(Core, Encoding.UTF8.GetByteCount(Core), now,
                out legacyPlan);
            var schemaCount = CountOccurrences(plan.Body, "\"schemaRevision\"");
            var capsCount = CountOccurrences(plan.Body, "\"capabilities\"");
            var coreCaps = "{\"protocolVersion\":3,\"capabilities\":{\"revision\":1},\"sequence\":7}";
            var capsPlan = ObservationSendPlanner.Plan(due, new List<ObservationLedgerEntry>(),
                Binding(), Caps, coreCaps, Encoding.UTF8.GetByteCount(coreCaps), null, now);
            var capsOnlySchema = CountOccurrences(capsPlan.Body, "\"schemaRevision\"");
            var capsOnlyCaps = CountOccurrences(capsPlan.Body, "\"capabilities\"");
            Check("OS29 zonder OBS is de mixed body bytegelijk aan de geaccepteerde legacy-sender",
                plan.Body == legacyBody
                && plan.LegacyBatch.Laps.Count == 2 && plan.LegacyBatch.Events.Count == 2
                && plan.Offered.Count == 2 && plan.ObservationRows == 0
                && schemaCount == 1 && capsCount == 1
                && capsOnlySchema == 1 && capsOnlyCaps == 1,
                "equal=" + (plan.Body == legacyBody) + " laps=" + plan.LegacyBatch.Laps.Count
                + " events=" + plan.LegacyBatch.Events.Count
                + " schemaKeys=" + schemaCount + " capsKeys=" + capsCount
                + " capsOnly=" + capsOnlySchema + "/" + capsOnlyCaps);
        }

        // OS30 — an event-only frame is a valid empty offered-lap batch.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var ids = new MeasurementIdFactory();
            string reason;
            var item = Event(ids, 0);
            if (!outbox.Enqueue(item, out reason)) throw new InvalidOperationException(reason);
            var handler = new CapturingHandler
            {
                Respond = delegate
                {
                    var events = Series(true, 1, "[" + Id(item.EventUid, 1) + "]",
                        "[]", "[]", "[]", null);
                    var laps = Series(true, 0, "[]", "[]", "[]", "[]", null);
                    return Task.FromResult(JsonResponse(200,
                        "{\"measurements\":{\"events\":" + events + ",\"laps\":" + laps + "}}"));
                }
            };
            var result = Send(Coordinator(store, outbox, handler, null));
            Check("OS30 een event-only frame met lege lapSummaries is geldig en levert legacy",
                result.Status == ObservationSendStatus.Delivered
                && result.Offered != null && result.Offered.Count == 0
                && result.LegacyAck != null && result.LegacyAck.Removed == 1
                && EntryArrayCount(handler.RequestAt(0).Body, "lapSummaries") == 0
                && EntryArrayCount(handler.RequestAt(0).Body, "measurementEvents") == 1
                && outbox.EventCount == 0,
                "status=" + result.Status + " offered="
                + (result.Offered == null ? -1 : result.Offered.Count)
                + " events=" + outbox.EventCount);
        }

        // OS31 — B1: a live pairing callback that outlives the bounded pair wait
        // keeps the one-owner lease until it reaches a terminal state. No OBS POST
        // or new pair callback can start while that commit gate is closed; a late
        // committed generation is published before the lease becomes usable.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var obs = Row(Uid(300));
            var frozen = Capture(store, obs);
            var obs8 = Row(Uid(302));
            var bypassDirectory = NewDirectory();
            var bypassOutbox = Outbox(bypassDirectory);
            string bypassReason;
            if (!bypassOutbox.EnqueueLap(Row(Uid(301), false), out bypassReason))
                throw new InvalidOperationException(bypassReason);

            var handler = new CapturingHandler();
            handler.Respond = delegate(int position, CapturedRequest request, CancellationToken ct)
            {
                return Task.FromResult(Accepted(request.Body.IndexOf(obs8.SummaryUid,
                    StringComparison.Ordinal) >= 0 ? obs8.SummaryUid : obs.SummaryUid, 1));
            };
            var options = Enabled(10000);
            options.LeaseWaitMilliseconds = 200;
            options.PairTransitionTimeoutMilliseconds = 120;
            var coordinator = Coordinator(store, outbox, handler, null, options);

            var callbackEntered = new ManualResetEventSlim(false);
            var callbackGate = Gate();
            var callbackCommitDone = false;
            var pairTask = coordinator.PairAsync(async delegate
            {
                callbackEntered.Set();
                await callbackGate.Task.ConfigureAwait(false);
                callbackCommitDone = true;
                return ObservationPairCommit.CommittedWith(Binding(8));
            }, CancellationToken.None);
            if (!WaitUntil(() => callbackEntered.IsSet, 3000))
                throw new InvalidOperationException("pair callback not entered");

            var pair = pairTask.GetAwaiter().GetResult();
            var leaseHeldAfterTimeout = coordinator.LeaseHeld;
            var sendWhile = Send(coordinator);
            var noRequestWhileGateClosed = handler.RequestCount == 0;
            var entryWhile = store.Find(obs.SummaryUid, 1);
            var ledgerBeforeSettlement = LedgerText(store);
            var freshPairInvoked = false;
            var freshPair = coordinator.PairAsync(delegate
            {
                freshPairInvoked = true;
                return Task.FromResult(ObservationPairCommit.CommittedWith(Binding(9)));
            }, CancellationToken.None).GetAwaiter().GetResult();
            MeasurementBatchPlan bypassPlan;
            var bypassBody = ObservationLegacyBypass.BuildBody(Core, bypassOutbox,
                T0.AddMinutes(3), Caps, Encoding.UTF8.GetByteCount(Core), null, out bypassPlan);
            var bypassOk = bypassBody != null && bypassPlan.HasMeasurements
                && bypassPlan.Batch.Laps.Count == 1;
            var ledgerAfterGateClosed = LedgerText(store);

            callbackGate.TrySetResult(true);
            var settled = WaitUntil(() => !coordinator.LeaseHeld, 3000);
            var publishedGeneration = coordinator.CurrentBinding.PairingGeneration;

            var afterSettlement = Send(coordinator, now: T0.AddMinutes(4));
            var oldRowAfter = store.Find(obs.SummaryUid, 1);
            var noStalePost = handler.RequestCount == 0;
            ObservationSendAttemptResult gen8Send = null;
            if (publishedGeneration == 8)
            {
                Capture(store, obs8, Binding(8));
                gen8Send = Send(coordinator, now: T0.AddMinutes(5));
            }

            Check("OS31 late pairingcommit houdt de lease, publiceert gen8 vóór een nieuwe send en post nooit onder gen7",
                pair.Status == ObservationPairTransitionStatus.TimedOut
                && pair.CallbackInvoked && !pair.Committed
                && leaseHeldAfterTimeout
                && sendWhile.Status == ObservationSendStatus.LeaseTimeout
                && !sendWhile.Posted && noRequestWhileGateClosed
                && entryWhile != null && entryWhile.RowJson == frozen
                && entryWhile.State != ObservationLedgerState.Quarantine
                && ledgerAfterGateClosed == ledgerBeforeSettlement
                && freshPair.Status == ObservationPairTransitionStatus.LeaseTimeout
                && !freshPair.CallbackInvoked && !freshPairInvoked
                && bypassOk && callbackCommitDone
                && settled && publishedGeneration == 8
                && afterSettlement.Status == ObservationSendStatus.BindingChanged
                && afterSettlement.ObservationQuarantined == 1
                && oldRowAfter != null
                && oldRowAfter.State == ObservationLedgerState.Quarantine
                && noStalePost
                && gen8Send != null
                && gen8Send.Status == ObservationSendStatus.Delivered
                && handler.RequestCount == 1
                && store.DeliveredTotal == 1,
                "pair=" + pair.Status + " held=" + leaseHeldAfterTimeout
                + " send=" + sendWhile.Status + " req=" + handler.RequestCount
                + " noReqClosed=" + noRequestWhileGateClosed
                + " entryJson=" + (entryWhile != null && entryWhile.RowJson == frozen)
                + " entryState=" + (entryWhile == null ? "null" : entryWhile.State.ToString())
                + " ledgerSame=" + (ledgerAfterGateClosed == ledgerBeforeSettlement)
                + " freshPair=" + freshPair.Status + " invoked=" + freshPairInvoked
                + " bypass=" + bypassOk + " commitDone=" + callbackCommitDone
                + " settled=" + settled + " gen=" + publishedGeneration
                + " after=" + afterSettlement.Status + " quarantined="
                + afterSettlement.ObservationQuarantined + " oldQuar="
                + (oldRowAfter == null ? "null" : oldRowAfter.State.ToString())
                + " noStalePost=" + noStalePost + " gen8Send="
                + (gen8Send == null ? "null" : gen8Send.Status.ToString())
                + " total=" + store.DeliveredTotal);
        }

        // OS32 — B2: normalized options are an immutable snapshot. Mutating the
        // constructor input or a returned copy can never change request/pair/lease
        // bounds or switch a default-off coordinator on.
        {
            // Configured 100 ms request timeout against a 400 ms handler still times out.
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(310));
            Capture(store, obs);
            var handler = new CapturingHandler();
            handler.Respond = async delegate
            {
                await Task.Delay(400).ConfigureAwait(false);
                return Accepted(obs.SummaryUid, 1);
            };
            var options = Enabled(100);
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var control = Send(coordinator);
            var controlTimedOut = control.Status == ObservationSendStatus.TimedOut;

            // Constructor input mutation after construction is inert.
            options.RequestTimeoutMilliseconds = -1;
            options.LeaseWaitMilliseconds = int.MaxValue;
            options.PairTransitionTimeoutMilliseconds = -1;
            options.Enabled = true;
            var constructorMutation = Send(coordinator, now: T0.AddMinutes(5));

            // Returned snapshot mutation is inert too: -1 / int.MaxValue may not
            // become an infinite request or lease wait.
            var exposed = coordinator.Options;
            exposed.RequestTimeoutMilliseconds = -1;
            exposed.LeaseWaitMilliseconds = int.MaxValue;
            exposed.PairTransitionTimeoutMilliseconds = -1;
            var exposedMutation = Send(coordinator, now: T0.AddMinutes(6));
            var entryAfter = store.Find(obs.SummaryUid, 1);

            // Returned lease-wait mutation cannot make a held lease wait unbounded.
            var leaseDir = NewDirectory();
            var leaseStore = Store(leaseDir);
            var leaseOutbox = Outbox(leaseDir);
            var leaseObs = Row(Uid(311));
            Capture(leaseStore, leaseObs);
            var leaseHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(leaseObs.SummaryUid, 1)); }
            };
            var leaseOptions = Enabled(10000);
            leaseOptions.LeaseWaitMilliseconds = 80;
            var leaseCoordinator = Coordinator(leaseStore, leaseOutbox, leaseHandler, null,
                leaseOptions);
            var leaseEntered = new ManualResetEventSlim(false);
            var leaseGate = Gate();
            var leasePairTask = leaseCoordinator.PairAsync(async delegate
            {
                leaseEntered.Set();
                await leaseGate.Task.ConfigureAwait(false);
                return ObservationPairCommit.CommittedWith(Binding(8));
            }, CancellationToken.None);
            if (!WaitUntil(() => leaseEntered.IsSet, 3000))
                throw new InvalidOperationException("lease callback not entered");
            leaseCoordinator.Options.LeaseWaitMilliseconds = int.MaxValue;
            var leaseSendTask = leaseCoordinator.SendOnceAsync(Core, Endpoint,
                T0.AddMinutes(3), CancellationToken.None);
            var leaseBounded = leaseSendTask.Wait(1500);
            var leaseSend = leaseBounded ? leaseSendTask.GetAwaiter().GetResult() : null;
            leaseGate.TrySetResult(true);
            var leasePair = leasePairTask.GetAwaiter().GetResult();
            if (!leaseBounded) leaseSendTask.GetAwaiter().GetResult();

            // Returned pair-timeout mutation cannot make the caller's pair wait unbounded.
            var pairDir = NewDirectory();
            var pairStore = Store(pairDir);
            var pairOutbox = Outbox(pairDir);
            var pairHandler = new CapturingHandler();
            var pairOptions = Enabled(10000);
            pairOptions.PairTransitionTimeoutMilliseconds = 150;
            var pairCoordinator = Coordinator(pairStore, pairOutbox, pairHandler, null,
                pairOptions);
            pairCoordinator.Options.PairTransitionTimeoutMilliseconds = -1;
            var pairEntered = new ManualResetEventSlim(false);
            var pairGate = Gate();
            var pairTask = pairCoordinator.PairAsync(async delegate
            {
                pairEntered.Set();
                await pairGate.Task.ConfigureAwait(false);
                return ObservationPairCommit.CommittedWith(Binding(8));
            }, CancellationToken.None);
            if (!WaitUntil(() => pairEntered.IsSet, 3000))
                throw new InvalidOperationException("pair callback not entered");
            var pairBounded = pairTask.Wait(1500);
            var pairResult = pairBounded ? pairTask.GetAwaiter().GetResult() : null;
            pairGate.TrySetResult(true);
            if (!pairBounded) pairTask.GetAwaiter().GetResult();
            WaitUntil(() => !pairCoordinator.LeaseHeld, 3000);

            // Default-off stays off and reads no token after both copies are mutated.
            var offDir = NewDirectory();
            var offStore = Store(offDir);
            var offOutbox = Outbox(offDir);
            var offObs = Row(Uid(312));
            Capture(offStore, offObs);
            var offHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(offObs.SummaryUid, 1)); }
            };
            var offOptions = Enabled();
            offOptions.Enabled = false;
            var tokenCalls = 0;
            var offCoordinator = Coordinator(offStore, offOutbox, offHandler,
                delegate { tokenCalls++; return Sentinel; }, offOptions);
            offOptions.Enabled = true;
            offCoordinator.Options.Enabled = true;
            var offText = LedgerText(offStore);
            var offSend = Send(offCoordinator);

            Check("OS32 options zijn een onveranderlijke snapshot; -1/intMax/Enabled-mutatie verandert timeouts, lease en default-off niet",
                controlTimedOut
                && constructorMutation.Status == ObservationSendStatus.TimedOut
                && exposedMutation.Status == ObservationSendStatus.TimedOut
                && !exposedMutation.ObservationStored
                && entryAfter != null && store.DeliveredTotal == 0
                && leaseBounded && leaseSend != null
                && leaseSend.Status == ObservationSendStatus.LeaseTimeout
                && !leaseSend.Posted && leaseHandler.RequestCount == 0
                && leasePair.Committed
                && pairBounded && pairResult != null
                && pairResult.Status == ObservationPairTransitionStatus.TimedOut
                && !pairResult.Committed
                && offSend.Status == ObservationSendStatus.Disabled
                && !offSend.Posted && offHandler.RequestCount == 0 && tokenCalls == 0
                && LedgerText(offStore) == offText,
                "control=" + control.Status + "/" + controlTimedOut
                + " ctor=" + constructorMutation.Status
                + " exposed=" + exposedMutation.Status + " stored="
                + exposedMutation.ObservationStored + " total=" + store.DeliveredTotal
                + " leaseBounded=" + leaseBounded + " leaseSend="
                + (leaseSend == null ? "null" : leaseSend.Status.ToString())
                + " leaseReq=" + leaseHandler.RequestCount + " pairBounded=" + pairBounded
                + " pair=" + (pairResult == null ? "null" : pairResult.Status.ToString())
                + " off=" + offSend.Status + " offReq=" + offHandler.RequestCount
                + " tokenCalls=" + tokenCalls);
        }

        // OS33 — B3: QuarantineMany applies the same exact PairingBinding identity
        // guard as DeferMany. Different generation, owner, device or unknown binding
        // with identical UID/revision/RowJson refuses the whole batch without a disk,
        // row or counter mutation; an exact row binding (not the active binding) and
        // a case-insensitive UUID match remain quarantinable.
        {
            var dirA = NewDirectory();
            var storeA = Store(dirA, new ObservationBindingFence(Binding()));
            var row = Row(Uid(320));
            Capture(storeA, row);
            var entryA = storeA.Find(row.SummaryUid, 1);

            var dirB = NewDirectory();
            var storeB = Store(dirB, new ObservationBindingFence(Binding(8)));
            Capture(storeB, row, Binding(8));
            var entryB = storeB.Find(row.SummaryUid, 1);
            var rowSame = entryA != null && entryB != null
                && entryA.Uid == entryB.Uid
                && entryA.RecordRevision == entryB.RecordRevision
                && string.Equals(entryA.RowJson, entryB.RowJson, StringComparison.Ordinal);
            var bindingsSame = entryA != null && entryB != null
                && ObservationBindingFence.SameBinding(entryA.Binding, entryB.Binding);

            var deferControl = storeB.DeferMany(new[] { Offered(entryA) },
                ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(1));
            var diskBefore = LedgerText(storeB);
            var totalBefore = storeB.DeliveredTotal;
            var quarantineControl = storeB.QuarantineMany(new[] { entryA },
                ObservationLedgerReasons.CaptureBindingChanged);
            var stateAfterGeneration = storeB.Find(row.SummaryUid, 1).State;
            var diskAfterGeneration = LedgerText(storeB);

            var ownerVariant = WithBinding(entryB, new ObservationPairingBinding(Device,
                OtherDevice, 8, true));
            var deviceVariant = WithBinding(entryB, new ObservationPairingBinding(OtherDevice,
                Owner, 8, true));
            var unknownVariant = WithBinding(entryB, new ObservationPairingBinding(Device,
                Owner, 8, false));
            var ownerResult = storeB.QuarantineMany(new[] { ownerVariant },
                ObservationLedgerReasons.CaptureBindingChanged);
            var deviceResult = storeB.QuarantineMany(new[] { deviceVariant },
                ObservationLedgerReasons.CaptureBindingChanged);
            var unknownResult = storeB.QuarantineMany(new[] { unknownVariant },
                ObservationLedgerReasons.CaptureBindingChanged);
            var unchangedAfterVariants = LedgerText(storeB) == diskAfterGeneration
                && storeB.Find(row.SummaryUid, 1).State == ObservationLedgerState.Pending
                && storeB.QuarantineTotal == 0;
            var diskAfterNegatives = LedgerText(storeB);

            // Case-insensitive UUIDs are the same binding, and the offered row's own
            // binding is authoritative even when it differs from the active fence.
            var caseBinding = new ObservationPairingBinding(Device.ToUpperInvariant(),
                Owner.ToUpperInvariant(), 8, true);
            var caseEntry = WithBinding(entryB, caseBinding);
            var caseSame = ObservationBindingFence.SameBinding(caseEntry.Binding,
                entryB.Binding);
            var caseResult = storeB.QuarantineMany(new[] { caseEntry },
                ObservationLedgerReasons.CaptureBindingChanged);
            var reloaded = Store(dirB, new ObservationBindingFence(Binding(8)));
            var caseState = reloaded.Find(row.SummaryUid, 1);

            var dirC = NewDirectory();
            var storeC = Store(dirC, new ObservationBindingFence(Binding()));
            Capture(storeC, row, Binding(7));
            storeC.BindingFence.Rebind(Binding(8));
            var foreignEntry = storeC.Find(row.SummaryUid, 1);
            var foreignBinding = foreignEntry.Binding.PairingGeneration == 7
                && !ObservationBindingFence.SameBinding(foreignEntry.Binding,
                    storeC.BindingFence.Current);
            var foreignResult = storeC.QuarantineMany(new[] { foreignEntry },
                ObservationLedgerReasons.CaptureBindingChanged);

            Check("OS33 QuarantineMany weigert elke afwijkende PairingBinding atomisch en quarantineert alleen de exacte rijbinding",
                rowSame && !bindingsSame
                && deferControl.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
                && deferControl.Diagnostic == "bulk_identity_conflict"
                && !quarantineControl.Committed
                && quarantineControl.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
                && quarantineControl.Diagnostic == "bulk_identity_conflict"
                && quarantineControl.ChangedCount == 0
                && diskAfterNegatives == diskBefore
                && storeB.DeliveredTotal == totalBefore
                && stateAfterGeneration == ObservationLedgerState.Pending
                && diskAfterGeneration == diskBefore
                && !ownerResult.Committed && !deviceResult.Committed && !unknownResult.Committed
                && ownerResult.Diagnostic == "bulk_identity_conflict"
                && deviceResult.Diagnostic == "bulk_identity_conflict"
                && unknownResult.Diagnostic == "bulk_identity_conflict"
                && unchangedAfterVariants
                && caseSame && caseResult.Committed && caseResult.ChangedCount == 1
                && caseState != null && caseState.State == ObservationLedgerState.Quarantine
                && reloaded.QuarantineTotal == 1
                && foreignBinding && foreignResult.Committed
                && foreignResult.ChangedCount == 1,
                "rowSame=" + rowSame + " bindingsSame=" + bindingsSame
                + " defer=" + deferControl.Status + "/" + deferControl.Diagnostic
                + " quarantine=" + quarantineControl.Status + "/"
                + quarantineControl.Diagnostic + " changed="
                + quarantineControl.ChangedCount + " state=" + stateAfterGeneration
                + " diskSame=" + (diskAfterNegatives == diskBefore)
                + " owner=" + ownerResult.Status + " device=" + deviceResult.Status
                + " unknown=" + unknownResult.Status
                + " variantsSame=" + unchangedAfterVariants
                + " case=" + caseResult.Status + "/" + caseResult.ChangedCount
                + " caseState=" + (caseState == null ? "null" : caseState.State.ToString())
                + " foreign=" + foreignResult.Status + "/" + foreignResult.ChangedCount);
        }

        // OS34 — exact UTF-8 body boundary and the bulk helper's terminal/identity
        // guards. These are the reviewer-added discriminating checks: OS04 checks
        // the clamps but not an OBS body exactly at this fixture's 2088-byte full
        // boundary (2088 includes the OBS row, 2087 defers it), under the separate
        // 24576-byte configured upper cap; no padded 24576-byte body is built.
        // OS33 only offers single-row bulk batches.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(600), driver: "Bram éèü");
            var frozen = Capture(store, obs);
            var legacy = Row(Uid(601), false, driver: "Légaçy");
            string boundaryReason;
            if (!outbox.EnqueueLap(legacy, out boundaryReason))
                throw new InvalidOperationException(boundaryReason);
            var due = outbox.Due(T0.AddMinutes(3), int.MaxValue, int.MaxValue);
            var limits = new MeasurementLimits
            {
                MaxLapsPerFrame = 3,
                MaxEventsPerFrame = 20,
                MaxMeasurementBatchBytes = 16384,
                MaxFrameBodyBytes = 24576
            };
            var full = ObservationSendPlanner.Plan(due, store.Entries, Binding(), Caps, Core,
                Encoding.UTF8.GetByteCount(Core), limits, T0.AddMinutes(3));
            var fullBytes = full.Body == null ? -1 : Encoding.UTF8.GetByteCount(full.Body);
            var exact = ObservationSendPlanner.Plan(due, store.Entries, Binding(), Caps, Core,
                Encoding.UTF8.GetByteCount(Core), new MeasurementLimits
                {
                    MaxLapsPerFrame = 3,
                    MaxEventsPerFrame = 20,
                    MaxMeasurementBatchBytes = 16384,
                    MaxFrameBodyBytes = fullBytes
                }, T0.AddMinutes(3));
            var under = ObservationSendPlanner.Plan(due, store.Entries, Binding(), Caps, Core,
                Encoding.UTF8.GetByteCount(Core), new MeasurementLimits
                {
                    MaxLapsPerFrame = 3,
                    MaxEventsPerFrame = 20,
                    MaxMeasurementBatchBytes = 16384,
                    MaxFrameBodyBytes = fullBytes - 1
                }, T0.AddMinutes(3));
            var boundaryOk = full.Offered != null && full.Offered.ObservationCount == 1
                && full.Body.IndexOf("Bram éèü", StringComparison.Ordinal) >= 0
                && fullBytes > 0
                && exact.Offered != null && exact.Offered.ObservationCount == 1
                && exact.Body == full.Body
                && under.Offered != null && under.Offered.ObservationCount == 0
                && under.DeferredObservation == 1
                && under.Body != null && under.Body.IndexOf(frozen, StringComparison.Ordinal) < 0;

            var bulkDir = NewDirectory();
            var bulkStore = Store(bulkDir);
            var first = Row(Uid(602));
            var second = Row(Uid(603));
            Capture(bulkStore, first);
            Capture(bulkStore, second);
            var entryFirst = bulkStore.Find(first.SummaryUid, 1);
            var entrySecond = bulkStore.Find(second.SummaryUid, 1);
            var diskBefore = LedgerText(bulkStore);
            var atomic = bulkStore.QuarantineMany(
                new[] { entryFirst, WithBinding(entrySecond, Binding(8)) },
                ObservationLedgerReasons.CaptureBindingChanged);
            var atomicOk = atomic.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
                && atomic.Diagnostic == "bulk_identity_conflict" && atomic.ChangedCount == 0
                && bulkStore.Find(first.SummaryUid, 1).State == ObservationLedgerState.Pending
                && LedgerText(bulkStore) == diskBefore
                && bulkStore.QuarantineTotal == 0;

            // The same all-or-nothing rule for a multi-row defer batch.
            var third = Row(Uid(604));
            var fourth = Row(Uid(605));
            Capture(bulkStore, third);
            Capture(bulkStore, fourth);
            var deferAtomic = bulkStore.DeferMany(new[]
            {
                Offered(bulkStore.Find(third.SummaryUid, 1)),
                Offered(WithBinding(bulkStore.Find(fourth.SummaryUid, 1), Binding(8)))
            }, ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(2));
            var deferAtomicOk = deferAtomic.Status
                    == ObservationLedgerTransitionStatus.RefusedInvalidReason
                && deferAtomic.Diagnostic == "bulk_identity_conflict"
                && deferAtomic.ChangedCount == 0
                && bulkStore.Find(third.SummaryUid, 1).State == ObservationLedgerState.Pending
                && bulkStore.Find(third.SummaryUid, 1).Attempts == 0;

            var quarantine = bulkStore.QuarantineMany(
                new[] { bulkStore.Find(first.SummaryUid, 1) },
                ObservationLedgerReasons.CaptureBindingChanged);
            var repeat = bulkStore.QuarantineMany(
                new[] { bulkStore.Find(first.SummaryUid, 1) },
                ObservationLedgerReasons.CaptureBindingChanged);
            var revive = bulkStore.DeferMany(
                new[] { Offered(bulkStore.Find(first.SummaryUid, 1)) },
                ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(2));
            var terminalOk = quarantine.Committed && quarantine.ChangedCount == 1
                && repeat.Committed && repeat.ChangedCount == 0
                && revive.ChangedCount == 0
                && bulkStore.Find(first.SummaryUid, 1).State == ObservationLedgerState.Quarantine
                && bulkStore.QuarantineTotal == 1;

            var wrongJson = WithBinding(entrySecond, entrySecond.Binding);
            wrongJson = new ObservationLedgerEntry(wrongJson.Uid, wrongJson.RecordRevision,
                wrongJson.State, wrongJson.RowJson + " ", wrongJson.Reason,
                wrongJson.CaptureDeviceId, wrongJson.CaptureOwnerUserId,
                wrongJson.PairingGeneration, wrongJson.PairingGenerationKnown,
                wrongJson.EnqueuedAtUtc, wrongJson.Attempts, wrongJson.NextAttemptUtc);
            var mismatch = bulkStore.DeferMany(new[] { Offered(wrongJson) },
                ObservationLedgerReasons.ObservationUnavailable, T0.AddMinutes(2));
            var identityOk = mismatch.Status == ObservationLedgerTransitionStatus.RefusedInvalidReason
                && mismatch.Diagnostic == "bulk_identity_conflict"
                && bulkStore.Find(second.SummaryUid, 1).State == ObservationLedgerState.Pending
                && bulkStore.Find(second.SummaryUid, 1).Attempts == 0;

            Check("OS34 exacte UTF-8 bodygrens en bulk-terminale/identiteitsguards",
                boundaryOk && atomicOk && deferAtomicOk && terminalOk && identityOk,
                "boundary=" + boundaryOk + "/" + fullBytes + " atomic=" + atomicOk
                + " deferAtomic=" + deferAtomicOk
                + " terminal=" + terminalOk + "/" + repeat.ChangedCount + "/"
                + revive.ChangedCount + "/" + bulkStore.QuarantineTotal
                + " identity=" + identityOk + "/" + mismatch.Status);
        }

        // OS35 — H1: Dispose during an active send must keep the durable terminal
        // result and must not fault the caller from _lease.Release() in finally.
        // New sends/pairs are refused, a bounded waiter that started before the
        // Dispose settles without a POST, and a repeated Dispose is harmless.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var obs = Row(Uid(700));
            var frozen = Capture(store, obs);
            var gate = Gate();
            var handler = new CapturingHandler
            {
                Respond = async delegate(int position, CapturedRequest request, CancellationToken token)
                {
                    await gate.Task.ConfigureAwait(false);
                    return Accepted(obs.SummaryUid, 1);
                }
            };
            var options = Enabled(5000);
            options.LeaseWaitMilliseconds = 2000;
            var coordinator = Coordinator(store, outbox, handler, null, options);
            var activeTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(3),
                CancellationToken.None);
            if (!WaitUntil(() => handler.FirstEntered.IsSet, 3000))
                throw new InvalidOperationException("active send not entered");
            var waitingTask = coordinator.SendOnceAsync(Core, Endpoint, T0.AddMinutes(4),
                CancellationToken.None);
            var waiterPending = WaitUntil(() => coordinator.PendingLeaseWaiters == 1, 3000);
            var heldBeforeDispose = coordinator.LeaseHeld;
            coordinator.Dispose();
            coordinator.Dispose();
            var heldAfterDispose = coordinator.LeaseHeld;

            Exception newSendError = null;
            try { Send(coordinator, now: T0.AddMinutes(5)); }
            catch (Exception error) { newSendError = error; }
            var newPairInvoked = false;
            Exception newPairError = null;
            try
            {
                coordinator.PairAsync(delegate
                {
                    newPairInvoked = true;
                    return Task.FromResult(ObservationPairCommit.CommittedWith(Binding(8)));
                }, CancellationToken.None).GetAwaiter().GetResult();
            }
            catch (Exception error) { newPairError = error; }

            gate.TrySetResult(true);
            var activeFinished = Task.WhenAny(activeTask, Task.Delay(3000))
                .GetAwaiter().GetResult() == activeTask;
            Exception activeError = null;
            ObservationSendAttemptResult active = null;
            if (activeFinished)
            {
                try { active = activeTask.GetAwaiter().GetResult(); }
                catch (Exception error) { activeError = error; }
            }
            var waitingFinished = Task.WhenAny(waitingTask, Task.Delay(3000))
                .GetAwaiter().GetResult() == waitingTask;
            Exception waitingError = null;
            ObservationSendAttemptResult waiting = null;
            if (waitingFinished)
            {
                try { waiting = waitingTask.GetAwaiter().GetResult(); }
                catch (Exception error) { waitingError = error; }
            }
            coordinator.Dispose();

            var controlDir = NewDirectory();
            var controlStore = Store(controlDir);
            var controlOutbox = Outbox(controlDir);
            var controlRow = Row(Uid(701));
            Capture(controlStore, controlRow);
            var controlHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(controlRow.SummaryUid, 1)); }
            };
            var normal = Send(Coordinator(controlStore, controlOutbox, controlHandler, null));

            Check("OS35 Dispose tijdens actieve send bewaart het commit-resultaat; nieuwe send/pair geweigerd; bounded waiter zonder POST geweigerd",
                activeFinished && waitingFinished
                && activeError == null && active != null
                && active.Status == ObservationSendStatus.Delivered
                && active.Posted && active.Offered != null
                && active.Offered.Rows.Count == 1
                && active.Offered.Rows[0].RowJson == frozen
                && waiterPending && heldBeforeDispose && heldAfterDispose
                && waitingError == null && waiting != null
                && waiting.Status == ObservationSendStatus.Refused
                && waiting.Diagnostic == "disposed" && !waiting.Posted
                && newSendError is ObjectDisposedException
                && newPairError is ObjectDisposedException && !newPairInvoked
                && handler.RequestCount == 1
                && store.DeliveredTotal == 1 && store.EntryCount == 0
                && normal.Status == ObservationSendStatus.Delivered
                && controlHandler.RequestCount == 1,
                "active=" + (active == null ? "null" : active.Status.ToString())
                + "/err=" + (activeError == null ? "none" : activeError.GetType().Name)
                + " waiting=" + (waiting == null ? "null" : waiting.Status.ToString())
                + "/" + (waiting == null ? null : waiting.Diagnostic)
                + "/err=" + (waitingError == null ? "none" : waitingError.GetType().Name)
                + " waiterPending=" + waiterPending
                + " held=" + heldBeforeDispose + "/" + heldAfterDispose
                + " newSend=" + (newSendError == null ? "none" : newSendError.GetType().Name)
                + " newPair=" + (newPairError == null ? "none" : newPairError.GetType().Name)
                + " invoked=" + newPairInvoked
                + " req=" + handler.RequestCount + " total=" + store.DeliveredTotal
                + " control=" + normal.Status + "/" + controlHandler.RequestCount);
        }

        // OS36 — H1/B1: Dispose during an in-flight pair keeps the committed
        // publication; Dispose while a timed-out callback still owns the lease
        // must not release that lease early. The late committed generation is
        // still published before the lease finally settles, and no new work runs.
        {
            var dir = NewDirectory();
            var store = Store(dir);
            var outbox = Outbox(dir);
            var gate = Gate();
            var entered = new ManualResetEventSlim(false);
            var coordinator = Coordinator(store, outbox, new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(JsonResponse(200, "{}")); }
            }, null, Enabled(5000));
            var pairTask = coordinator.PairAsync(async delegate
            {
                entered.Set();
                await gate.Task.ConfigureAwait(false);
                return ObservationPairCommit.CommittedWith(Binding(8));
            }, CancellationToken.None);
            if (!WaitUntil(() => entered.IsSet, 3000))
                throw new InvalidOperationException("pair callback not entered");
            coordinator.Dispose();
            coordinator.Dispose();
            var pairLeaseHeld = coordinator.LeaseHeld;
            gate.TrySetResult(true);
            Exception pairError = null;
            ObservationPairTransitionResult pair = null;
            try { pair = pairTask.GetAwaiter().GetResult(); }
            catch (Exception error) { pairError = error; }
            var pairGeneration = coordinator.CurrentBinding == null ? -1
                : coordinator.CurrentBinding.PairingGeneration;

            // Normal pair control on a fresh coordinator.
            var controlDir = NewDirectory();
            var controlStore = Store(controlDir);
            var controlOutbox = Outbox(controlDir);
            var control = Coordinator(controlStore, controlOutbox, new CapturingHandler(), null)
                .PairAsync(delegate
                {
                    return Task.FromResult(ObservationPairCommit.CommittedWith(Binding(9)));
                }, CancellationToken.None).GetAwaiter().GetResult();

            // Late callback owner: the bounded pair call returns TimedOut while the
            // callback still owns the lease. Dispose must not free it early.
            var lateDir = NewDirectory();
            var lateFence = new ObservationBindingFence(Binding());
            var lateStore = Store(lateDir, lateFence);
            var lateOutbox = Outbox(lateDir);
            var lateObs = Row(Uid(702));
            var lateFrozen = Capture(lateStore, lateObs);
            var lateHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(lateObs.SummaryUid, 1)); }
            };
            var lateOptions = Enabled(5000);
            lateOptions.PairTransitionTimeoutMilliseconds = 80;
            lateOptions.LeaseWaitMilliseconds = 200;
            var lateCoordinator = Coordinator(lateStore, lateOutbox, lateHandler, null,
                lateOptions);
            var lateEntered = new ManualResetEventSlim(false);
            var lateGate = Gate();
            var lateDone = false;
            var lateTask = lateCoordinator.PairAsync(async delegate
            {
                lateEntered.Set();
                await lateGate.Task.ConfigureAwait(false);
                lateDone = true;
                return ObservationPairCommit.CommittedWith(Binding(8));
            }, CancellationToken.None);
            if (!WaitUntil(() => lateEntered.IsSet, 3000))
                throw new InvalidOperationException("late pair callback not entered");
            var latePair = lateTask.GetAwaiter().GetResult();
            var heldAtTimeout = lateCoordinator.LeaseHeld;
            lateCoordinator.Dispose();
            lateCoordinator.Dispose();
            var heldAfterDispose = lateCoordinator.LeaseHeld;
            var generationAfterDispose = lateCoordinator.CurrentBinding.PairingGeneration;
            Exception newSendError = null;
            try { Send(lateCoordinator); }
            catch (Exception error) { newSendError = error; }
            lateGate.TrySetResult(true);
            var released = WaitUntil(() => !lateCoordinator.LeaseHeld, 3000);
            var publishedGeneration = lateCoordinator.CurrentBinding.PairingGeneration;
            var lateEntry = lateStore.Find(lateObs.SummaryUid, 1);
            var noRequest = lateHandler.RequestCount == 0;
            Exception afterSettleError = null;
            try { Send(lateCoordinator, now: T0.AddMinutes(5)); }
            catch (Exception error) { afterSettleError = error; }

            Check("OS36 Dispose tijdens pair en tijdens late pair-eigenaar bewaart respectievelijk publiceert de commit en geeft de lease pas na settlement vrij",
                pairError == null && pair != null && pair.Committed
                && pairGeneration == 8 && pairLeaseHeld
                && control.Status == ObservationPairTransitionStatus.Committed
                && control.PublishedBinding != null
                && control.PublishedBinding.PairingGeneration == 9
                && latePair.Status == ObservationPairTransitionStatus.TimedOut
                && !latePair.Committed && heldAtTimeout && heldAfterDispose
                && generationAfterDispose == 7 && lateDone
                && newSendError is ObjectDisposedException
                && released && publishedGeneration == 8
                && lateEntry != null && lateEntry.RowJson == lateFrozen
                && lateEntry.State != ObservationLedgerState.Quarantine
                && noRequest && afterSettleError is ObjectDisposedException,
                "pair=" + (pair == null ? "null" : pair.Status.ToString())
                + "/err=" + (pairError == null ? "none" : pairError.GetType().Name)
                + " gen=" + pairGeneration + " held=" + pairLeaseHeld
                + " control=" + control.Status + "/" + control.PublishedBinding.PairingGeneration
                + " late=" + latePair.Status + " heldAtTimeout=" + heldAtTimeout
                + " heldAfterDispose=" + heldAfterDispose
                + " genAfterDispose=" + generationAfterDispose + " lateDone=" + lateDone
                + " released=" + released + " published=" + publishedGeneration
                + " entry=" + (lateEntry == null ? "null" : lateEntry.State.ToString())
                + " req=" + lateHandler.RequestCount
                + " afterSettle=" + (afterSettleError == null ? "none"
                    : afterSettleError.GetType().Name));
        }

        // OS37 — H2: plan-time quarantine is real durable state even when the same
        // attempt posts and cleans up a legacy sibling. The reported count must be
        // the actual transition count, survive restart, and not be counted again
        // by a repeated attempt.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var obs = Row(Uid(710));
            var frozen = Capture(store, obs);
            var legacy = Row(Uid(711), false);
            string reason;
            if (!outbox.EnqueueLap(legacy, out reason))
                throw new InvalidOperationException(reason);
            fence.Rebind(Binding(8));
            var handler = new CapturingHandler
            {
                Respond = delegate
                {
                    return Task.FromResult(Accepted(legacy.SummaryUid, 1));
                }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var entry = store.Find(obs.SummaryUid, 1);
            var reloaded = Store(dir, new ObservationBindingFence(Binding(8)));
            var reloadedEntry = reloaded.Find(obs.SummaryUid, 1);
            var repeat = Send(coordinator, now: T0.AddMinutes(4));
            var body = handler.RequestCount == 0 ? null : handler.RequestAt(0).Body;

            Check("OS37 plan-time quarantaine naast legacy-levering telt één keer, overleeft restart en telt niet opnieuw",
                result.Status == ObservationSendStatus.Delivered
                && result.Posted && result.HttpStatus == 200
                && result.ObservationQuarantined == 1
                && result.OfferedObservationRows == 0
                && entry != null && entry.State == ObservationLedgerState.Quarantine
                && entry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && entry.RowJson == frozen
                && reloaded.QuarantineTotal == 1 && reloaded.DeliveredTotal == 0
                && reloadedEntry != null
                && reloadedEntry.State == ObservationLedgerState.Quarantine
                && reloadedEntry.RowJson == frozen
                && outbox.LapCount == 0 && handler.RequestCount == 1
                && body != null && body.IndexOf(obs.SummaryUid, StringComparison.Ordinal) < 0
                && repeat.Status == ObservationSendStatus.NothingDue
                && repeat.ObservationQuarantined == 0
                && store.QuarantineTotal == 1,
                "status=" + result.Status + " reported=" + result.ObservationQuarantined
                + " state=" + (entry == null ? "null" : entry.State.ToString())
                + " reload=" + reloaded.QuarantineTotal + "/" + reloaded.DeliveredTotal
                + " laps=" + outbox.LapCount + " req=" + handler.RequestCount
                + " repeat=" + repeat.Status + "/" + repeat.ObservationQuarantined);
        }

        // OS38 — H2: one attempt can both quarantine a stale row at plan time and
        // quarantine another OBS row through the accepted ACK. Both are real store
        // transitions and are reported together, exactly once, with legacy cleanup.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var store = Store(dir, fence);
            var outbox = Outbox(dir);
            var stale = Row(Uid(720));
            var staleFrozen = Capture(store, stale);
            var legacy = Row(Uid(721), false);
            string reason;
            if (!outbox.EnqueueLap(legacy, out reason))
                throw new InvalidOperationException(reason);
            fence.Rebind(Binding(8));
            var offered = Row(Uid(722));
            var offeredFrozen = Capture(store, offered, Binding(8));
            var handler = new CapturingHandler
            {
                Respond = delegate
                {
                    return Task.FromResult(JsonResponse(200, LapAck(true, 2,
                        "[" + Id(legacy.SummaryUid, 1) + "]", "[]", "[]",
                        "[" + Rejection(offered.SummaryUid, null,
                            ObservationLedgerReasons.ObservationInvalidNumber) + "]", null)));
                }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var staleEntry = store.Find(stale.SummaryUid, 1);
            var offeredEntry = store.Find(offered.SummaryUid, 1);
            var reloaded = Store(dir, new ObservationBindingFence(Binding(8)));
            var body = handler.RequestAt(0).Body;
            var repeat = Send(coordinator, now: T0.AddMinutes(4));

            Check("OS38 plan- én ACK-quarantaine in één poging worden samen exact gerapporteerd en duurzaam bewaard",
                result.Status == ObservationSendStatus.PartiallyDelivered
                && result.Posted && result.HttpStatus == 200
                && result.ObservationQuarantined == 2
                && result.ObservationDelivered == 0
                && result.LedgerApply != null
                && result.LedgerApply.QuarantinedCount == 1
                && result.LedgerApply.DeliveredCount == 0
                && staleEntry != null
                && staleEntry.State == ObservationLedgerState.Quarantine
                && staleEntry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && staleEntry.RowJson == staleFrozen
                && offeredEntry != null
                && offeredEntry.State == ObservationLedgerState.Quarantine
                && offeredEntry.ReasonCode == ObservationLedgerReasons.ObservationInvalidNumber
                && offeredEntry.RowJson == offeredFrozen
                && store.QuarantineTotal == 2 && store.DeliveredTotal == 0
                && store.EntryCount == 2 && outbox.LapCount == 0
                && reloaded.QuarantineTotal == 2 && reloaded.DeliveredTotal == 0
                && reloaded.Find(stale.SummaryUid, 1) != null
                && reloaded.Find(offered.SummaryUid, 1) != null
                && body.IndexOf(stale.SummaryUid, StringComparison.Ordinal) < 0
                && body.IndexOf(offered.SummaryUid, StringComparison.Ordinal) >= 0
                && body.IndexOf(legacy.SummaryUid, StringComparison.Ordinal) >= 0
                && repeat.Status == ObservationSendStatus.NothingDue
                && repeat.ObservationQuarantined == 0
                && store.QuarantineTotal == 2,
                "status=" + result.Status + " reported=" + result.ObservationQuarantined
                + " apply=" + (result.LedgerApply == null ? "null"
                    : result.LedgerApply.QuarantinedCount + "/" + result.LedgerApply.DeliveredCount)
                + " store=" + store.QuarantineTotal + "/" + store.DeliveredTotal
                + " entries=" + store.EntryCount + " laps=" + outbox.LapCount
                + " reload=" + reloaded.QuarantineTotal + " repeat="
                + repeat.Status + "/" + repeat.ObservationQuarantined);
        }

        // OS39 — H2 truthfulness on non-delivery paths after a real plan-time
        // quarantine: a malformed ACK and a canceled in-flight attempt keep the
        // row and its reason durable while still reporting the quarantine count.
        {
            var malformedDir = NewDirectory();
            var malformedFence = new ObservationBindingFence(Binding());
            var malformedStore = Store(malformedDir, malformedFence);
            var malformedOutbox = Outbox(malformedDir);
            var malformedObs = Row(Uid(730));
            var malformedFrozen = Capture(malformedStore, malformedObs);
            var malformedLegacy = Row(Uid(731), false);
            string malformedReason;
            if (!malformedOutbox.EnqueueLap(malformedLegacy, out malformedReason))
                throw new InvalidOperationException(malformedReason);
            malformedFence.Rebind(Binding(8));
            var malformedHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(JsonResponse(200, "not-an-ack")); }
            };
            var malformed = Send(Coordinator(malformedStore, malformedOutbox,
                malformedHandler, null));
            var malformedEntry = malformedStore.Find(malformedObs.SummaryUid, 1);
            var malformedOk = malformed.Status == ObservationSendStatus.NotDelivered
                && malformed.Posted
                && malformed.ObservationQuarantined == 1
                && malformedEntry != null
                && malformedEntry.State == ObservationLedgerState.Quarantine
                && malformedEntry.RowJson == malformedFrozen
                && malformedStore.DeliveredTotal == 0
                && malformedOutbox.LapCount == 1
                && malformedHandler.RequestCount == 1;

            var cancelDir = NewDirectory();
            var cancelFence = new ObservationBindingFence(Binding());
            var cancelStore = Store(cancelDir, cancelFence);
            var cancelOutbox = Outbox(cancelDir);
            var cancelObs = Row(Uid(732));
            var cancelFrozen = Capture(cancelStore, cancelObs);
            var cancelLegacy = Row(Uid(733), false);
            string cancelReason;
            if (!cancelOutbox.EnqueueLap(cancelLegacy, out cancelReason))
                throw new InvalidOperationException(cancelReason);
            cancelFence.Rebind(Binding(8));
            var cancelGate = Gate();
            var cancelHandler = new CapturingHandler
            {
                Respond = async delegate(int position, CapturedRequest request, CancellationToken token)
                {
                    await cancelGate.Task.ConfigureAwait(false);
                    return Accepted(cancelLegacy.SummaryUid, 1);
                }
            };
            var cancelCoordinator = Coordinator(cancelStore, cancelOutbox, cancelHandler, null,
                Enabled(5000));
            var source = new CancellationTokenSource();
            var cancelTask = cancelCoordinator.SendOnceAsync(Core, Endpoint,
                T0.AddMinutes(3), source.Token);
            if (!WaitUntil(() => cancelHandler.FirstEntered.IsSet, 3000))
                throw new InvalidOperationException("cancel send not entered");
            source.Cancel();
            var canceled = cancelTask.GetAwaiter().GetResult();
            cancelGate.TrySetResult(true);
            WaitUntil(() => cancelHandler.Active == 0, 3000);
            var cancelEntry = cancelStore.Find(cancelObs.SummaryUid, 1);
            var cancelOk = canceled.Status == ObservationSendStatus.Canceled
                && canceled.Posted
                && canceled.ObservationQuarantined == 1
                && cancelEntry != null
                && cancelEntry.State == ObservationLedgerState.Quarantine
                && cancelEntry.RowJson == cancelFrozen
                && cancelStore.DeliveredTotal == 0
                && cancelStore.EntryCount == 1
                && cancelHandler.RequestCount == 1;

            Check("OS39 na plan-time quarantaine blijven malformed-ACK en cancel de rij en teller waarheidsgetrouw rapporteren",
                malformedOk && cancelOk,
                "malformed=" + malformedOk + "/" + malformed.Status + "/"
                + malformed.ObservationQuarantined + " cancel=" + cancelOk + "/"
                + canceled.Status + "/" + canceled.ObservationQuarantined
                + "/req=" + cancelHandler.RequestCount + " laps=" + cancelOutbox.LapCount);
        }

        // OS40 — H3: a synchronous transport invocation failure before a send task
        // exists is not "posted"; a real handler visit that fails asynchronously
        // still is. The false flag is diagnostic only: the exact row, identity and
        // durable counters stay untouched.
        {
            var syncDir = NewDirectory();
            var syncFence = new ObservationBindingFence(Binding());
            var syncStore = Store(syncDir, syncFence);
            var syncOutbox = Outbox(syncDir);
            var syncObs = Row(Uid(740));
            var syncFrozen = Capture(syncStore, syncObs);
            var syncLegacy = Row(Uid(741), false);
            string syncReason;
            if (!syncOutbox.EnqueueLap(syncLegacy, out syncReason))
                throw new InvalidOperationException(syncReason);
            syncFence.Rebind(Binding(8));
            var syncTransport = new SyncThrowTransport();
            var sync = Send(Coordinator(syncStore, syncOutbox, syncTransport, null));
            var syncEntry = syncStore.Find(syncObs.SummaryUid, 1);

            var nullDir = NewDirectory();
            var nullStore = Store(nullDir);
            var nullOutbox = Outbox(nullDir);
            var nullObs = Row(Uid(742));
            var nullFrozen = Capture(nullStore, nullObs);
            var nullLegacy = Row(Uid(743), false);
            string nullReason;
            if (!nullOutbox.EnqueueLap(nullLegacy, out nullReason))
                throw new InvalidOperationException(nullReason);
            var nullTransport = new NullTaskTransport();
            var nullResult = Send(Coordinator(nullStore, nullOutbox, nullTransport, null));
            var nullEntry = nullStore.Find(nullObs.SummaryUid, 1);

            var asyncDir = NewDirectory();
            var asyncStore = Store(asyncDir);
            var asyncOutbox = Outbox(asyncDir);
            var asyncObs = Row(Uid(744));
            var asyncFrozen = Capture(asyncStore, asyncObs);
            var asyncHandler = new CapturingHandler
            {
                Respond = async delegate
                {
                    await Task.Yield();
                    throw new IOException("synthetic async handler failure");
                }
            };
            var asyncResult = Send(Coordinator(asyncStore, asyncOutbox, asyncHandler, null));
            var asyncEntry = asyncStore.Find(asyncObs.SummaryUid, 1);
            var asyncRequest = asyncHandler.RequestCount == 1 ? asyncHandler.RequestAt(0) : null;

            Check("OS40 synchrone transportthrow vóór een sendtask meldt Posted=false; een echt bezochte handler met asyncfout blijft Posted=true",
                sync.Status == ObservationSendStatus.TransportFailed
                && !sync.Posted && syncTransport.Calls == 1
                && sync.ObservationQuarantined == 1
                && syncEntry != null
                && syncEntry.State == ObservationLedgerState.Quarantine
                && syncEntry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && syncEntry.RowJson == syncFrozen
                && syncStore.DeliveredTotal == 0 && syncStore.QuarantineTotal == 1
                && nullResult.Status == ObservationSendStatus.TransportFailed
                && !nullResult.Posted && nullTransport.Calls == 1
                && nullEntry != null
                && nullEntry.State == ObservationLedgerState.Deferred
                && nullEntry.RowJson == nullFrozen && nullEntry.Attempts == 1
                && nullStore.DeliveredTotal == 0 && nullStore.QuarantineTotal == 0
                && asyncResult.Status == ObservationSendStatus.TransportFailed
                && asyncResult.Posted && asyncResult.HttpStatus == 0
                && asyncResult.OfferedObservationRows == 1
                && asyncHandler.RequestCount == 1
                && asyncRequest != null
                && asyncRequest.Body != null
                && asyncRequest.Body.IndexOf(asyncFrozen, StringComparison.Ordinal) >= 0
                && asyncRequest.Authorization == "Bearer " + Sentinel
                && asyncEntry != null
                && asyncEntry.State == ObservationLedgerState.Deferred
                && asyncEntry.RowJson == asyncFrozen && asyncEntry.Attempts == 1
                && asyncStore.DeliveredTotal == 0 && asyncStore.QuarantineTotal == 0,
                "sync=" + sync.Status + "/posted=" + sync.Posted + "/calls="
                + syncTransport.Calls + "/q=" + sync.ObservationQuarantined
                + " null=" + nullResult.Status + "/posted=" + nullResult.Posted
                + "/calls=" + nullTransport.Calls + "/state="
                + (nullEntry == null ? "null" : nullEntry.State.ToString())
                + " async=" + asyncResult.Status + "/posted=" + asyncResult.Posted
                + "/req=" + asyncHandler.RequestCount + "/state="
                + (asyncEntry == null ? "null" : asyncEntry.State.ToString())
                + "/attempts=" + (asyncEntry == null ? -1 : asyncEntry.Attempts));
        }

        // OS41 — H2-F1: the first plan-time bulk quarantine (binding change) commits,
        // then the second (legal duplicate-lane build refusal) fails before its
        // switch. The durable first transition must still be reported, and a retry
        // from that real partial state must count only the newly committed row.
        // Controls cover both writes committing and failure of the first write.
        {
            var dir = NewDirectory();
            var fence = new ObservationBindingFence(Binding());
            var faults = new PlanBulkFaults { Message = "synthetic second plan-switch failure" };
            var store = Store(dir, fence, null, faults);
            var outbox = Outbox(dir);
            var stale = Row(Uid(750));
            var staleFrozen = Capture(store, stale);
            fence.Rebind(Binding(8));
            var refused = Row(Uid(751));
            var refusedFrozen = Capture(store, refused, Binding(8));
            var legacy = Row(Uid(751), false);
            string reason;
            if (!outbox.EnqueueLap(legacy, out reason))
                throw new InvalidOperationException(reason);

            faults.Arm(2); // captures already ran; only the two plan bulk writes remain
            var handler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(legacy.SummaryUid, 1)); }
            };
            var coordinator = Coordinator(store, outbox, handler, null);
            var result = Send(coordinator);
            var staleEntry = store.Find(stale.SummaryUid, 1);
            var refusedEntry = store.Find(refused.SummaryUid, 1);
            var leaseFree = WaitUntil(() => !coordinator.LeaseHeld, 1000);
            var reloaded = Store(dir, new ObservationBindingFence(Binding(8)));
            var reloadedStale = reloaded.Find(stale.SummaryUid, 1);
            var reloadedRefused = reloaded.Find(refused.SummaryUid, 1);
            var mainTotal = store.QuarantineTotal;
            var mainDelivered = store.DeliveredTotal;
            var mainEntries = store.EntryCount;
            var mainLaps = outbox.LapCount;
            var mainRequests = handler.RequestCount;

            faults.Disarm();
            var retry = Send(coordinator, now: T0.AddMinutes(4));
            var retryStale = store.Find(stale.SummaryUid, 1);
            var retryRefused = store.Find(refused.SummaryUid, 1);
            var retryReload = Store(dir, new ObservationBindingFence(Binding(8)));
            var retryBody = handler.RequestCount == 0 ? null : handler.RequestAt(0).Body;

            // Positive control: the same two plan writes commit when no fault is armed
            // and the legacy ACK still owns only the legacy lap.
            var okDir = NewDirectory();
            var okFence = new ObservationBindingFence(Binding());
            var okStore = Store(okDir, okFence);
            var okOutbox = Outbox(okDir);
            var okStale = Row(Uid(750));
            var okStaleFrozen = Capture(okStore, okStale);
            okFence.Rebind(Binding(8));
            var okRefused = Row(Uid(751));
            var okRefusedFrozen = Capture(okStore, okRefused, Binding(8));
            var okLegacy = Row(Uid(751), false);
            string okReason;
            if (!okOutbox.EnqueueLap(okLegacy, out okReason))
                throw new InvalidOperationException(okReason);
            var okHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(okLegacy.SummaryUid, 1)); }
            };
            var okResult = Send(Coordinator(okStore, okOutbox, okHandler, null));
            var okStaleEntry = okStore.Find(okStale.SummaryUid, 1);
            var okRefusedEntry = okStore.Find(okRefused.SummaryUid, 1);
            var okBody = okHandler.RequestCount == 0 ? null : okHandler.RequestAt(0).Body;

            // Control: failure of the first write reports zero and commits nothing.
            var firstDir = NewDirectory();
            var firstFence = new ObservationBindingFence(Binding());
            var firstFaults = new PlanBulkFaults { Message = "synthetic first plan-switch failure" };
            var firstStore = Store(firstDir, firstFence, null, firstFaults);
            var firstOutbox = Outbox(firstDir);
            var firstStale = Row(Uid(750));
            var firstStaleFrozen = Capture(firstStore, firstStale);
            firstFence.Rebind(Binding(8));
            var firstRefused = Row(Uid(751));
            var firstRefusedFrozen = Capture(firstStore, firstRefused, Binding(8));
            var firstLegacy = Row(Uid(751), false);
            string firstReason;
            if (!firstOutbox.EnqueueLap(firstLegacy, out firstReason))
                throw new InvalidOperationException(firstReason);
            firstFaults.Arm(1);
            var firstHandler = new CapturingHandler
            {
                Respond = delegate { return Task.FromResult(Accepted(firstLegacy.SummaryUid, 1)); }
            };
            var firstCoordinator = Coordinator(firstStore, firstOutbox, firstHandler, null);
            var firstResult = Send(firstCoordinator);
            var firstStaleEntry = firstStore.Find(firstStale.SummaryUid, 1);
            var firstRefusedEntry = firstStore.Find(firstRefused.SummaryUid, 1);
            var firstLeaseFree = WaitUntil(() => !firstCoordinator.LeaseHeld, 1000);

            Check("OS41 mislukte tweede plan-bulkwrite behoudt de al gecommitte quarantainetelling; retry telt alleen de nieuwe rij",
                result.Status == ObservationSendStatus.Refused
                && !result.Posted
                && result.Diagnostic == "build_quarantine_precommit_io:IOException:synthetic second plan-switch failure"
                && result.ObservationQuarantined == 1
                && result.ObservationDelivered == 0
                && mainTotal == 1 && mainDelivered == 0 && mainEntries == 2
                && mainLaps == 1 && mainRequests == 0 && leaseFree
                && staleEntry != null && staleEntry.State == ObservationLedgerState.Quarantine
                && staleEntry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && staleEntry.RowJson == staleFrozen
                && ObservationBindingFence.SameBinding(staleEntry.Binding, Binding())
                && refusedEntry != null && refusedEntry.State == ObservationLedgerState.Pending
                && refusedEntry.RowJson == refusedFrozen
                && ObservationBindingFence.SameBinding(refusedEntry.Binding, Binding(8))
                && reloaded.QuarantineTotal == 1 && reloaded.DeliveredTotal == 0
                && reloadedStale != null && reloadedStale.State == ObservationLedgerState.Quarantine
                && reloadedStale.RowJson == staleFrozen
                && ObservationBindingFence.SameBinding(reloadedStale.Binding, Binding())
                && reloadedRefused != null && reloadedRefused.State == ObservationLedgerState.Pending
                && reloadedRefused.RowJson == refusedFrozen
                && ObservationBindingFence.SameBinding(reloadedRefused.Binding, Binding(8))
                && retry.Status == ObservationSendStatus.Delivered
                && retry.Posted && retry.HttpStatus == 200
                && retry.ObservationQuarantined == 1
                && store.QuarantineTotal == 2 && store.DeliveredTotal == 0
                && store.EntryCount == 2 && outbox.LapCount == 0
                && retryStale != null && retryStale.State == ObservationLedgerState.Quarantine
                && retryStale.RowJson == staleFrozen
                && ObservationBindingFence.SameBinding(retryStale.Binding, Binding())
                && retryRefused != null && retryRefused.State == ObservationLedgerState.Quarantine
                && retryRefused.ReasonCode == ObservationLedgerReasons.ObservationBuildRefused
                && retryRefused.RowJson == refusedFrozen
                && ObservationBindingFence.SameBinding(retryRefused.Binding, Binding(8))
                && handler.RequestCount == 1
                && retryBody != null
                && retryBody.IndexOf(legacy.SummaryUid, StringComparison.Ordinal) >= 0
                && retryBody.IndexOf(stale.SummaryUid, StringComparison.Ordinal) < 0
                && retryReload.QuarantineTotal == 2 && retryReload.DeliveredTotal == 0
                && okResult.Status == ObservationSendStatus.Delivered
                && okResult.ObservationQuarantined == 2
                && okResult.LegacyAck != null && okResult.LegacyAck.Stored
                && okResult.LegacyAck.ConfirmedLaps == 1
                && okStore.QuarantineTotal == 2 && okStore.DeliveredTotal == 0
                && okStaleEntry != null && okStaleEntry.State == ObservationLedgerState.Quarantine
                && okStaleEntry.ReasonCode == ObservationLedgerReasons.CaptureBindingChanged
                && okStaleEntry.RowJson == okStaleFrozen
                && ObservationBindingFence.SameBinding(okStaleEntry.Binding, Binding())
                && okRefusedEntry != null && okRefusedEntry.State == ObservationLedgerState.Quarantine
                && okRefusedEntry.ReasonCode == ObservationLedgerReasons.ObservationBuildRefused
                && okRefusedEntry.RowJson == okRefusedFrozen
                && ObservationBindingFence.SameBinding(okRefusedEntry.Binding, Binding(8))
                && okOutbox.LapCount == 0 && okHandler.RequestCount == 1
                && okBody != null
                && okBody.IndexOf(okLegacy.SummaryUid, StringComparison.Ordinal) >= 0
                && okBody.IndexOf(okStale.SummaryUid, StringComparison.Ordinal) < 0
                && firstResult.Status == ObservationSendStatus.Refused
                && firstResult.Diagnostic == "binding_quarantine_precommit_io:IOException:synthetic first plan-switch failure"
                && firstResult.ObservationQuarantined == 0
                && firstStore.QuarantineTotal == 0 && firstStore.DeliveredTotal == 0
                && firstStore.EntryCount == 2
                && firstStaleEntry != null && firstStaleEntry.State == ObservationLedgerState.Pending
                && firstStaleEntry.RowJson == firstStaleFrozen
                && firstRefusedEntry != null && firstRefusedEntry.State == ObservationLedgerState.Pending
                && firstRefusedEntry.RowJson == firstRefusedFrozen
                && firstOutbox.LapCount == 1 && firstHandler.RequestCount == 0
                && firstLeaseFree,
                "main=" + result.Status + "/posted=" + result.Posted + "/diag=" + result.Diagnostic
                + "/q=" + result.ObservationQuarantined + "/store=" + mainTotal
                + "/" + mainDelivered + "/entries=" + mainEntries + "/laps=" + mainLaps
                + "/req=" + mainRequests + "/leaseFree=" + leaseFree
                + " retry=" + retry.Status + "/q=" + retry.ObservationQuarantined
                + "/store=" + store.QuarantineTotal + "/" + store.DeliveredTotal
                + "/entries=" + store.EntryCount + "/req=" + handler.RequestCount
                + " ok=" + okResult.Status + "/q=" + okResult.ObservationQuarantined
                + "/ack=" + (okResult.LegacyAck == null ? "null"
                    : okResult.LegacyAck.ConfirmedLaps.ToString(CultureInfo.InvariantCulture))
                + "/store=" + okStore.QuarantineTotal + "/req=" + okHandler.RequestCount
                + " first=" + firstResult.Status + "/q=" + firstResult.ObservationQuarantined
                + "/diag=" + firstResult.Diagnostic + "/store=" + firstStore.QuarantineTotal
                + "/req=" + firstHandler.RequestCount);
        }

        return count;
    }

    private static int CountOccurrences(string text, string value)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(value)) return 0;
        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }
        return count;
    }
}
