using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// S2C2b — bounded asynchronous observation-send lifecycle.
    ///
    /// This component is deliberately standalone: no plugin/settings/Pair-Unpair
    /// caller is wired here. It exposes a real async pairing-transition seam and a
    /// real sender seam. Every HTTP test uses an injected <see cref="HttpMessageHandler"/>
    /// and a synthetic token; no real network, SDK, APPDATA or production action occurs.
    /// </summary>
    public enum ObservationSendStatus
    {
        Disabled = 0,
        NothingDue = 1,
        LeaseTimeout = 2,
        Canceled = 3,
        TimedOut = 4,
        TransportFailed = 5,
        BindingChanged = 6,
        Refused = 7,
        Delivered = 8,
        PartiallyDelivered = 9,
        Deferred = 10,
        NotDelivered = 11,
        Uncertain = 12
    }

    /// <summary>
    /// Bounded try-once switches. The frame limits themselves stay hard-coded in the
    /// planner; these options cannot raise them. Default is off.
    /// </summary>
    public sealed class ObservationSendOptions
    {
        public bool Enabled;
        public int LeaseWaitMilliseconds = 2000;
        public int RequestTimeoutMilliseconds = 15000;
        public int PairTransitionTimeoutMilliseconds = 15000;

        internal ObservationSendOptions Normalized()
        {
            var copy = new ObservationSendOptions();
            copy.Enabled = Enabled;
            copy.LeaseWaitMilliseconds = Clamp(LeaseWaitMilliseconds, 1, 60000);
            copy.RequestTimeoutMilliseconds = Clamp(RequestTimeoutMilliseconds, 1, 120000);
            copy.PairTransitionTimeoutMilliseconds = Clamp(PairTransitionTimeoutMilliseconds, 1, 120000);
            return copy;
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            if (value < minimum) return minimum;
            if (value > maximum) return maximum;
            return value;
        }
    }

    /// <summary>The result of the caller's local Pair/Unpair/DPAPI commit.</summary>
    public sealed class ObservationPairCommit
    {
        private ObservationPairCommit(bool committed, ObservationPairingBinding binding,
            string errorCode)
        {
            Committed = committed;
            Binding = binding;
            ErrorCode = errorCode;
        }

        public bool Committed { get; private set; }
        /// <summary>
        /// The binding to publish after a committed transition. An incomplete binding
        /// (known=false) is valid here: it closes observation instead of claiming an
        /// old or invented generation.
        /// </summary>
        public ObservationPairingBinding Binding { get; private set; }
        public string ErrorCode { get; private set; }

        public static ObservationPairCommit CommittedWith(ObservationPairingBinding binding)
        {
            return new ObservationPairCommit(true, binding, null);
        }

        public static ObservationPairCommit Failed(string errorCode)
        {
            return new ObservationPairCommit(false, null, Bound(errorCode));
        }

        private static string Bound(string value)
        {
            if (string.IsNullOrEmpty(value)) return "pair_commit_failed";
            return value.Length <= 48 ? value : value.Substring(0, 48);
        }
    }

    public delegate Task<ObservationPairCommit> ObservationPairCommitHandler(
        CancellationToken cancellationToken);

    public enum ObservationPairTransitionStatus
    {
        Committed = 0,
        CallbackFailed = 1,
        Canceled = 2,
        LeaseTimeout = 3,
        TimedOut = 4,
        Refused = 5
    }

    public sealed class ObservationPairTransitionResult
    {
        internal ObservationPairTransitionResult(ObservationPairTransitionStatus status,
            bool callbackInvoked, ObservationPairingBinding publishedBinding, string errorCode)
        {
            Status = status;
            CallbackInvoked = callbackInvoked;
            PublishedBinding = publishedBinding;
            ErrorCode = errorCode;
        }

        public ObservationPairTransitionStatus Status { get; private set; }
        public bool CallbackInvoked { get; private set; }
        /// <summary>The fence value that was published; null when nothing was published.</summary>
        public ObservationPairingBinding PublishedBinding { get; private set; }
        public string ErrorCode { get; private set; }
        public bool Committed { get { return Status == ObservationPairTransitionStatus.Committed; } }

        public override string ToString()
        {
            return "pair-transition " + Status + " callback=" + CallbackInvoked
                + (string.IsNullOrEmpty(ErrorCode) ? string.Empty : " code=" + ErrorCode);
        }
    }

    /// <summary>
    /// Immutable in-memory envelope. The token is internal-only and never appears in
    /// <see cref="ToString"/>, the ledger, logs, diagnostics, RowJson or an error body.
    /// </summary>
    public sealed class SendEnvelope
    {
        private readonly string _token;
        private readonly ReadOnlyCollection<ObservationOfferedRow> _rows;

        private SendEnvelope(string token, Uri endpoint, ObservationPairingBinding binding,
            ObservationOfferedBatch batch, string body, int bodyBytes, long attemptId)
        {
            _token = token;
            Endpoint = endpoint;
            Binding = binding;
            Batch = batch;
            Body = body;
            BodyBytes = bodyBytes;
            AttemptId = attemptId;
            _rows = new ReadOnlyCollection<ObservationOfferedRow>(
                new List<ObservationOfferedRow>(batch.Rows));
        }

        internal static SendEnvelope Create(string token, Uri endpoint,
            ObservationPairingBinding binding, ObservationOfferedBatch batch, string body,
            long attemptId)
        {
            if (string.IsNullOrEmpty(token)) throw new ArgumentException("token", "token");
            if (endpoint == null) throw new ArgumentNullException("endpoint");
            if (binding == null || !binding.IsComplete)
                throw new ArgumentException("binding_incomplete", "binding");
            if (batch == null) throw new ArgumentNullException("batch");
            if (string.IsNullOrEmpty(body)) throw new ArgumentException("body", "body");
            var bytes = Encoding.UTF8.GetByteCount(body);
            return new SendEnvelope(token, endpoint, binding, batch, body, bytes, attemptId);
        }

        public Uri Endpoint { get; private set; }
        public ObservationPairingBinding Binding { get; private set; }
        public ObservationOfferedBatch Batch { get; private set; }
        /// <summary>The exact UTF-8 body that is posted once.</summary>
        public string Body { get; private set; }
        public int BodyBytes { get; private set; }
        public long AttemptId { get; private set; }
        public string ContentType { get { return "application/json; charset=utf-8"; } }
        public string AuthorizationScheme { get { return "Bearer"; } }
        public IList<ObservationOfferedRow> Rows { get { return _rows; } }

        internal string Token { get { return _token; } }

        public override string ToString()
        {
            return "send-envelope attempt=" + AttemptId.ToString(CultureInfo.InvariantCulture)
                + " rows=" + Batch.Count.ToString(CultureInfo.InvariantCulture)
                + " observations=" + Batch.ObservationCount.ToString(CultureInfo.InvariantCulture)
                + " bytes=" + BodyBytes.ToString(CultureInfo.InvariantCulture)
                + " generation=" + Binding.PairingGeneration.ToString(CultureInfo.InvariantCulture);
        }
    }

    public enum ObservationTransportStatus
    {
        Response = 0,
        BindingChanged = 1
    }

    /// <summary>One transport result. A non-2xx response carries no body by design.</summary>
    public sealed class ObservationTransportResponse
    {
        private ObservationTransportResponse(ObservationTransportStatus status, int httpStatus,
            string body, bool bodyTruncated, string diagnostic)
        {
            Status = status;
            HttpStatus = httpStatus;
            Body = body;
            BodyTruncated = bodyTruncated;
            Diagnostic = diagnostic;
        }

        public ObservationTransportStatus Status { get; private set; }
        public int HttpStatus { get; private set; }
        public string Body { get; private set; }
        public bool BodyTruncated { get; private set; }
        public string Diagnostic { get; private set; }

        internal static ObservationTransportResponse Response(int status, string body)
        {
            return new ObservationTransportResponse(ObservationTransportStatus.Response,
                status, body, false, null);
        }

        internal static ObservationTransportResponse TooLarge(int status)
        {
            return new ObservationTransportResponse(ObservationTransportStatus.Response,
                status, null, true, "response_too_large");
        }

        internal static ObservationTransportResponse BindingChanged()
        {
            return new ObservationTransportResponse(ObservationTransportStatus.BindingChanged,
                0, null, false, "capture_binding_changed");
        }
    }

    /// <summary>
    /// The only transport seam. The guard is evaluated immediately before the actual
    /// <see cref="HttpRequestMessage"/> is created; a false guard produces
    /// <see cref="ObservationTransportStatus.BindingChanged"/> and no request.
    /// </summary>
    public interface IObservationSendTransport
    {
        Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope,
            Func<bool> bindingGuard, CancellationToken cancellationToken);
    }

    /// <summary>
    /// Production-shaped transport over an injected <see cref="HttpClient"/>. It reads
    /// at most the configured response bound and never logs the token or body.
    /// </summary>
    public sealed class HttpObservationSendTransport : IObservationSendTransport
    {
        private readonly HttpClient _http;
        private readonly int _maxResponseBytes;

        public HttpObservationSendTransport(HttpClient http, int maxResponseBytes)
        {
            if (http == null) throw new ArgumentNullException("http");
            _http = http;
            _maxResponseBytes = maxResponseBytes < 1024 ? 1024
                : maxResponseBytes > 262144 ? 262144 : maxResponseBytes;
        }

        public async Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope,
            Func<bool> bindingGuard, CancellationToken cancellationToken)
        {
            if (envelope == null) throw new ArgumentNullException("envelope");
            if (bindingGuard != null && !bindingGuard())
                return ObservationTransportResponse.BindingChanged();

            using (var request = new HttpRequestMessage(HttpMethod.Post, envelope.Endpoint))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue(
                    envelope.AuthorizationScheme, envelope.Token);
                request.Content = new StringContent(envelope.Body, Encoding.UTF8,
                    "application/json");

                using (var response = await _http.SendAsync(request,
                        HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                    .ConfigureAwait(false))
                {
                    var status = (int)response.StatusCode;
                    if (!response.IsSuccessStatusCode)
                        return ObservationTransportResponse.Response(status, null);

                    var body = await ReadBoundedAsync(response.Content, _maxResponseBytes,
                        cancellationToken).ConfigureAwait(false);
                    if (body == null) return ObservationTransportResponse.TooLarge(status);
                    return ObservationTransportResponse.Response(status, body);
                }
            }
        }

        private static async Task<string> ReadBoundedAsync(HttpContent content, int maximum,
            CancellationToken cancellationToken)
        {
            if (content == null) return string.Empty;
            if (content.Headers.ContentLength.HasValue
                && content.Headers.ContentLength.Value > maximum)
                return null;

            using (var stream = await content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var buffer = new MemoryStream())
            {
                var chunk = new byte[8192];
                while (true)
                {
                    var read = await stream.ReadAsync(chunk, 0, chunk.Length, cancellationToken)
                        .ConfigureAwait(false);
                    if (read <= 0) break;
                    if (buffer.Length + read > maximum) return null;
                    buffer.Write(chunk, 0, read);
                }
                return Encoding.UTF8.GetString(buffer.ToArray());
            }
        }
    }

    /// <summary>A planner-refused observation row and its bounded local diagnostic.</summary>
    public sealed class ObservationSendRefusedRow
    {
        internal ObservationSendRefusedRow(ObservationLedgerEntry entry, string diagnostic)
        {
            Entry = entry;
            Diagnostic = diagnostic;
        }

        public ObservationLedgerEntry Entry { get; private set; }
        public string Diagnostic { get; private set; }
    }

    /// <summary>
    /// One bounded, immutable plan: legacy rows are selected first by the accepted
    /// planner limits; observation rows may only use the remaining lap slots and
    /// exact UTF-8 byte budget.
    /// </summary>
    public sealed class ObservationSendPlan
    {
        private readonly ReadOnlyCollection<ObservationLedgerEntry> _bindingChanged;
        private readonly ReadOnlyCollection<ObservationSendRefusedRow> _refused;
        private readonly ReadOnlyCollection<ObservationOfferedRow> _offered;

        internal ObservationSendPlan(MeasurementBatchPlan legacyPlan,
            IList<ObservationLedgerEntry> bindingChanged, IList<ObservationSendRefusedRow> refused,
            ObservationOfferedBatch offered, string body, int measurementBytes,
            int deferredObservation, string errorCode)
        {
            LegacyPlan = legacyPlan;
            _bindingChanged = new ReadOnlyCollection<ObservationLedgerEntry>(
                new List<ObservationLedgerEntry>(bindingChanged));
            _refused = new ReadOnlyCollection<ObservationSendRefusedRow>(
                new List<ObservationSendRefusedRow>(refused));
            _offered = new ReadOnlyCollection<ObservationOfferedRow>(
                new List<ObservationOfferedRow>(offered == null
                    ? new ObservationOfferedRow[0] : ToArray(offered.Rows)));
            Offered = offered;
            Body = body;
            MeasurementBytes = measurementBytes;
            DeferredObservation = deferredObservation;
            ErrorCode = errorCode;
        }

        private static ObservationOfferedRow[] ToArray(IList<ObservationOfferedRow> rows)
        {
            var copy = new ObservationOfferedRow[rows.Count];
            for (var index = 0; index < rows.Count; index++) copy[index] = rows[index];
            return copy;
        }

        public MeasurementBatchPlan LegacyPlan { get; private set; }
        public OutboxBatch LegacyBatch { get { return LegacyPlan == null ? null : LegacyPlan.Batch; } }
        public ObservationOfferedBatch Offered { get; private set; }
        public IList<ObservationOfferedRow> OfferedRows { get { return _offered; } }
        public IList<ObservationLedgerEntry> BindingChangedEntries { get { return _bindingChanged; } }
        public IList<ObservationSendRefusedRow> RefusedObservationRows { get { return _refused; } }
        public string Body { get; private set; }
        public int MeasurementBytes { get; private set; }
        public int DeferredObservation { get; private set; }
        public string ErrorCode { get; private set; }
        public bool HasRows
        {
            get
            {
                return LegacyRows > 0 || ObservationRows > 0;
            }
        }
        public int ObservationRows { get { return Offered == null ? 0 : Offered.ObservationCount; } }
        public int LegacyRows
        {
            get
            {
                return LegacyBatch == null ? 0 : LegacyBatch.Events.Count + LegacyBatch.Laps.Count;
            }
        }
    }

    /// <summary>
    /// Legacy-first bounded mixed planner. It consumes the accepted
    /// <see cref="MeasurementFramePlanner"/> for the legacy selection and then fits
    /// observation rows only into the remaining exact byte/lap budget. No global
    /// setting is read after planning.
    /// </summary>
    public static class ObservationSendPlanner
    {
        private const int HardMaxLaps = 3;
        private const int HardMaxEvents = 20;
        private const int HardMaxMeasurementBytes = 16384;
        private const int HardMaxBodyBytes = 24576;

        public static MeasurementLimits ClampLimits(MeasurementLimits limits)
        {
            var source = limits ?? MeasurementLimits.Default();
            var clamped = new MeasurementLimits();
            clamped.MaxLapsPerFrame = Math.Max(0, Math.Min(source.MaxLapsPerFrame, HardMaxLaps));
            clamped.MaxEventsPerFrame = Math.Max(0, Math.Min(source.MaxEventsPerFrame, HardMaxEvents));
            clamped.MaxMeasurementBatchBytes = Math.Max(0,
                Math.Min(source.MaxMeasurementBatchBytes, HardMaxMeasurementBytes));
            clamped.MaxFrameBodyBytes = Math.Max(0,
                Math.Min(source.MaxFrameBodyBytes, HardMaxBodyBytes));
            return clamped;
        }

        public static ObservationSendPlan Plan(OutboxBatch legacyDue,
            IList<ObservationLedgerEntry> observationDue, ObservationPairingBinding current,
            string capabilitiesJson, string coreBodyJson, int coreBodyBytes,
            MeasurementLimits limits, DateTime nowUtc)
        {
            if (legacyDue == null) legacyDue = new OutboxBatch();
            var clamped = ClampLimits(limits);
            var legacyPlan = MeasurementFramePlanner.Plan(legacyDue, capabilitiesJson,
                coreBodyBytes, clamped);

            var bindingChanged = new List<ObservationLedgerEntry>();
            var refused = new List<ObservationSendRefusedRow>();
            var deferred = 0;

            var eventRows = new List<string>();
            for (var index = 0; index < legacyPlan.Batch.Events.Count; index++)
            {
                var entry = legacyPlan.Batch.Events[index];
                if (entry == null || string.IsNullOrEmpty(entry.RowJson)) continue;
                eventRows.Add(entry.RowJson);
            }

            var lapRows = new List<string>();
            var lapIdentities = new List<OutboxEntry>();
            for (var index = 0; index < legacyPlan.Batch.Laps.Count; index++)
            {
                var entry = legacyPlan.Batch.Laps[index];
                if (entry == null || string.IsNullOrEmpty(entry.RowJson)) continue;
                lapRows.Add(entry.RowJson);
                lapIdentities.Add(entry);
            }

            var offered = new List<ObservationOfferedRow>();
            var legacyOfferFailed = false;
            for (var index = 0; index < lapIdentities.Count; index++)
            {
                var entry = lapIdentities[index];
                string diagnostic;
                var row = ObservationOfferedRow.TryCreate(entry.Uid, entry.RecordRevision,
                    entry.RowJson, ObservationAckLane.Legacy, null, out diagnostic);
                if (row == null)
                {
                    legacyOfferFailed = true;
                    break;
                }
                offered.Add(row);
            }

            if (legacyOfferFailed)
            {
                return new ObservationSendPlan(legacyPlan, bindingChanged, refused, null,
                    null, 0, 0, "legacy_offer_invalid");
            }

            var maxLaps = clamped.MaxLapsPerFrame;
            var maxBatch = Math.Min(clamped.MaxMeasurementBatchBytes, HardMaxMeasurementBytes);
            var maxBody = Math.Min(clamped.MaxFrameBodyBytes, HardMaxBodyBytes);
            var uids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < offered.Count; index++) uids.Add(offered[index].Uid);

            var baseMeasurement = MeasurementJson.Batch(eventRows, lapRows);
            var baseBody = BuildBody(coreBodyJson, eventRows, lapRows, capabilitiesJson);
            if (MeasurementJson.Bytes(baseMeasurement) > maxBatch
                || MeasurementJson.Bytes(baseBody) > maxBody)
            {
                return new ObservationSendPlan(legacyPlan, bindingChanged, refused, null,
                    null, MeasurementJson.Bytes(baseMeasurement), 0, "frame_budget_exhausted");
            }

            if (observationDue != null)
            {
                for (var index = 0; index < observationDue.Count; index++)
                {
                    var entry = observationDue[index];
                    if (entry == null) continue;
                    if (entry.State == ObservationLedgerState.Quarantine) continue;
                    if (entry.NextAttemptUtc.HasValue && entry.NextAttemptUtc.Value > nowUtc)
                        continue;
                    if (current == null || !current.IsComplete
                        || !ObservationBindingFence.SameBinding(entry.Binding, current))
                    {
                        bindingChanged.Add(entry);
                        continue;
                    }

                    string diagnostic;
                    var row = ObservationOfferedRow.TryCreate(entry.Uid, entry.RecordRevision,
                        entry.RowJson, ObservationAckLane.Observation, current, out diagnostic);
                    if (row == null)
                    {
                        refused.Add(new ObservationSendRefusedRow(entry, diagnostic));
                        continue;
                    }
                    if (uids.Contains(row.Uid))
                    {
                        refused.Add(new ObservationSendRefusedRow(entry,
                            "duplicate_lane_identity"));
                        continue;
                    }
                    if (lapRows.Count >= maxLaps)
                    {
                        deferred++;
                        break;
                    }

                    lapRows.Add(row.RowJson);
                    var measurement = MeasurementJson.Batch(eventRows, lapRows);
                    var body = BuildBody(coreBodyJson, eventRows, lapRows, capabilitiesJson);
                    if (MeasurementJson.Bytes(measurement) > maxBatch
                        || MeasurementJson.Bytes(body) > maxBody)
                    {
                        lapRows.RemoveAt(lapRows.Count - 1);
                        deferred++;
                        break;
                    }

                    offered.Add(row);
                    uids.Add(row.Uid);
                }
            }

            var finalMeasurement = MeasurementJson.Batch(eventRows, lapRows);
            var finalBody = BuildBody(coreBodyJson, eventRows, lapRows, capabilitiesJson);
            ObservationOfferedBatch batch = null;
            if (offered.Count > 0)
            {
                string batchDiagnostic;
                batch = ObservationOfferedBatch.TryCreate(offered, out batchDiagnostic);
                if (batch == null)
                {
                    return new ObservationSendPlan(legacyPlan, bindingChanged, refused, null,
                        null, MeasurementJson.Bytes(finalMeasurement), deferred,
                        "offer_batch_invalid");
                }
            }
            else
            {
                string batchDiagnostic;
                batch = ObservationOfferedBatch.TryCreate(new ObservationOfferedRow[0],
                    out batchDiagnostic);
            }

            if (batch.Count == 0 && eventRows.Count == 0)
            {
                return new ObservationSendPlan(legacyPlan, bindingChanged, refused, null,
                    null, 0, deferred, null);
            }

            return new ObservationSendPlan(legacyPlan, bindingChanged, refused, batch,
                finalBody, MeasurementJson.Bytes(finalMeasurement), deferred, null);
        }

        private static string BuildBody(string coreBodyJson, IList<string> eventRows,
            IList<string> lapRows, string capabilitiesJson)
        {
            var builder = new StringBuilder(1024);
            builder.Append("\"measurementEvents\":[");
            AppendRows(builder, eventRows);
            builder.Append("],\"lapSummaries\":[");
            AppendRows(builder, lapRows);
            builder.Append("]");
            var series = builder.ToString();
            var head = new StringBuilder();
            if (!MeasurementJson.FrameDeclaresMember(coreBodyJson, "schemaRevision"))
                head.Append("\"schemaRevision\":")
                    .Append(MeasurementContract.SchemaRevision.ToString(CultureInfo.InvariantCulture));
            if (!MeasurementJson.FrameDeclaresMember(coreBodyJson, "capabilities"))
            {
                if (head.Length > 0) head.Append(',');
                head.Append("\"capabilities\":").Append(Capabilities(capabilitiesJson));
            }
            var members = head.Length == 0 ? series : head.Append(',').Append(series).ToString();
            return MeasurementJson.InjectIntoFrame(coreBodyJson, members);
        }

        private static string Capabilities(string capabilitiesJson)
        {
            return string.IsNullOrEmpty(capabilitiesJson)
                ? "{\"revision\":1,\"supported\":{}}" : capabilitiesJson;
        }

        private static void AppendRows(StringBuilder builder, IList<string> rows)
        {
            if (rows == null) return;
            for (var index = 0; index < rows.Count; index++)
            {
                if (index > 0) builder.Append(',');
                builder.Append(rows[index]);
            }
        }
    }

    /// <summary>
    /// The documented legacy-only bypass. It never touches the ledger, the lease or an
    /// observation row. It exists so a caller can keep draining legacy rows while an
    /// OBS attempt waits, times out or its sidecar is full.
    /// </summary>
    public static class ObservationLegacyBypass
    {
        public static MeasurementBatchPlan Plan(MeasurementOutbox outbox, DateTime nowUtc,
            string capabilitiesJson, int coreBodyBytes, MeasurementLimits limits)
        {
            if (outbox == null) throw new ArgumentNullException("outbox");
            var due = outbox.Due(nowUtc, int.MaxValue, int.MaxValue);
            return MeasurementFramePlanner.Plan(due, capabilitiesJson, coreBodyBytes,
                ObservationSendPlanner.ClampLimits(limits));
        }

        public static string BuildBody(string coreBodyJson, MeasurementOutbox outbox,
            DateTime nowUtc, string capabilitiesJson, int coreBodyBytes,
            MeasurementLimits limits, out MeasurementBatchPlan plan)
        {
            plan = Plan(outbox, nowUtc, capabilitiesJson, coreBodyBytes, limits);
            if (!plan.HasMeasurements) return null;
            var members = MeasurementJson.FrameDeclaresMember(coreBodyJson, "schemaRevision")
                ? plan.SeriesJson : plan.MembersJson;
            return MeasurementJson.InjectIntoFrame(coreBodyJson, members);
        }
    }

    /// <summary>One sender attempt, with only safe non-secret outcome data.</summary>
    public sealed class ObservationSendAttemptResult
    {
        internal ObservationSendAttemptResult(ObservationSendStatus status, long attemptId,
            string diagnostic)
        {
            Status = status;
            AttemptId = attemptId;
            Diagnostic = diagnostic;
        }

        public ObservationSendStatus Status { get; internal set; }
        public long AttemptId { get; private set; }
        public string Diagnostic { get; private set; }
        public bool Posted { get; internal set; }
        public int HttpStatus { get; internal set; }
        public int BodyBytes { get; internal set; }
        public ObservationPairingBinding Binding { get; internal set; }
        public ObservationOfferedBatch Offered { get; internal set; }
        public ObservationAckResolution Ack { get; internal set; }
        public ObservationAckApplyResult LedgerApply { get; internal set; }
        public AckOutcome LegacyAck { get; internal set; }
        public bool LegacyCleanupApplied { get; internal set; }
        public int OfferedObservationRows { get; internal set; }
        public int ObservationDelivered { get; internal set; }
        public int ObservationQuarantined { get; internal set; }
        public int ObservationRetained { get; internal set; }
        public int ObservationDeferredPersisted { get; internal set; }
        public string DeferDiagnostic { get; internal set; }

        public bool ObservationStored
        {
            get { return LedgerApply != null && LedgerApply.Stored; }
        }

        public override string ToString()
        {
            return "observation-send " + Status
                + " attempt=" + AttemptId.ToString(CultureInfo.InvariantCulture)
                + " posted=" + (Posted ? "yes" : "no")
                + " http=" + HttpStatus.ToString(CultureInfo.InvariantCulture)
                + " obs=" + OfferedObservationRows.ToString(CultureInfo.InvariantCulture)
                + " delivered=" + ObservationDelivered.ToString(CultureInfo.InvariantCulture)
                + (string.IsNullOrEmpty(Diagnostic) ? string.Empty : " diag=" + Diagnostic);
        }
    }

    internal enum TransportCompletion
    {
        Completed,
        TimedOut,
        Canceled,
        Failed
    }

    internal sealed class TransportOutcome
    {
        public TransportCompletion Completion;
        public ObservationTransportResponse Response;
        public string Diagnostic;
    }

    /// <summary>
    /// One shared async SemaphoreSlim(1,1) lease. It covers one OBS attempt
    /// (plan → envelope → guarded POST → ACK commit) and a local pairing transition
    /// (callback → binding publication). No Monitor/UI lock is held across an await.
    /// </summary>
    public sealed class ObservationSendCoordinator : IDisposable
    {
        private readonly SemaphoreSlim _lease = new SemaphoreSlim(1, 1);
        private readonly ObservationLedgerStore _ledger;
        private readonly MeasurementOutbox _legacy;
        private readonly IObservationSendTransport _transport;
        private readonly Func<string> _tokenProvider;
        private readonly Func<string> _capabilitiesJson;
        // Normalized limits are immutable for the coordinator's lifetime. Options
        // returns a defensive snapshot; no caller can mutate the live bounds.
        private readonly bool _enabled;
        private readonly int _leaseWaitMilliseconds;
        private readonly int _requestTimeoutMilliseconds;
        private readonly int _pairTransitionTimeoutMilliseconds;
        private readonly MeasurementLimits _limits;
        private readonly object _gate = new object();

        private long _attemptSequence;
        private long _activeAttempt;
        private int _pendingLeaseWaiters;
        private bool _disposed;

        public ObservationSendCoordinator(ObservationLedgerStore ledger, MeasurementOutbox legacy,
            IObservationSendTransport transport, Func<string> tokenProvider,
            Func<string> capabilitiesJson, ObservationSendOptions options,
            MeasurementLimits limits)
        {
            if (ledger == null) throw new ArgumentNullException("ledger");
            if (legacy == null) throw new ArgumentNullException("legacy");
            if (transport == null) throw new ArgumentNullException("transport");
            _ledger = ledger;
            _legacy = legacy;
            _transport = transport;
            _tokenProvider = tokenProvider;
            _capabilitiesJson = capabilitiesJson;
            var normalized = (options ?? new ObservationSendOptions()).Normalized();
            _enabled = normalized.Enabled;
            _leaseWaitMilliseconds = normalized.LeaseWaitMilliseconds;
            _requestTimeoutMilliseconds = normalized.RequestTimeoutMilliseconds;
            _pairTransitionTimeoutMilliseconds = normalized.PairTransitionTimeoutMilliseconds;
            _limits = ObservationSendPlanner.ClampLimits(limits);
        }

        /// <summary>
        /// A defensive snapshot of the normalized configuration. Mutating it can never
        /// change the live lease or request bounds.
        /// </summary>
        public ObservationSendOptions Options
        {
            get
            {
                return new ObservationSendOptions
                {
                    Enabled = _enabled,
                    LeaseWaitMilliseconds = _leaseWaitMilliseconds,
                    RequestTimeoutMilliseconds = _requestTimeoutMilliseconds,
                    PairTransitionTimeoutMilliseconds = _pairTransitionTimeoutMilliseconds
                };
            }
        }
        public bool LeaseHeld { get { return _lease.CurrentCount == 0; } }
        public int PendingLeaseWaiters { get { return Volatile.Read(ref _pendingLeaseWaiters); } }
        public ObservationPairingBinding CurrentBinding
        {
            get { return _ledger.BindingFence.Current; }
        }

        /// <summary>
        /// Local pair/unpair transition. The lease is acquired before the caller's first
        /// side effect; the fence is published only after a committed callback result.
        /// </summary>
        public Task<ObservationPairTransitionResult> PairAsync(
            ObservationPairCommitHandler commit, CancellationToken cancellationToken)
        {
            return TransitionAsync(commit, cancellationToken);
        }

        public Task<ObservationPairTransitionResult> UnpairAsync(
            ObservationPairCommitHandler commit, CancellationToken cancellationToken)
        {
            return TransitionAsync(commit, cancellationToken);
        }

        public async Task<ObservationPairTransitionResult> TransitionAsync(
            ObservationPairCommitHandler commit, CancellationToken cancellationToken)
        {
            if (_disposed) throw new ObjectDisposedException("ObservationSendCoordinator");
            if (commit == null)
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.Refused, false, null, "commit_missing");
            if (cancellationToken.IsCancellationRequested)
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.Canceled, false, null, "canceled");

            bool acquired;
            Interlocked.Increment(ref _pendingLeaseWaiters);
            try
            {
                acquired = await _lease.WaitAsync(_leaseWaitMilliseconds,
                    cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.Canceled, false, null, "canceled");
            }
            catch (ObjectDisposedException)
            {
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.Refused, false, null, "disposed");
            }
            finally
            {
                Interlocked.Decrement(ref _pendingLeaseWaiters);
            }

            if (!acquired)
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.LeaseTimeout, false, null, "lease_timeout");

            var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(_pairTransitionTimeoutMilliseconds);
            var ownershipHandedOff = false;
            try
            {
                Task<ObservationPairCommit> task;
                try
                {
                    task = commit(linked.Token);
                }
                catch (OperationCanceledException)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.Canceled, true, null, "canceled");
                }
                catch (Exception error)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.CallbackFailed, true, null,
                        "callback_" + error.GetType().Name);
                }

                if (task == null)
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.CallbackFailed, true, null,
                        "callback_null");

                var delay = Task.Delay(Timeout.Infinite, linked.Token);
                var winner = await Task.WhenAny(task, delay).ConfigureAwait(false);
                if (winner != task)
                {
                    // The caller's wait is bounded, but the lease is not: the callback
                    // may still be committing a real local pairing/server change. Hand
                    // ownership to its terminal continuation, which publishes a late
                    // committed binding under this same lease and releases it once.
                    // A callback that never settles keeps future OBS attempts bounded
                    // on the lease (LeaseTimeout), never inside this transition.
                    linked.Cancel();
                    ownershipHandedOff = true;
                    try
                    {
                        CompleteTransitionAfterTimeout(task, linked);
                    }
                    catch (Exception)
                    {
                        ownershipHandedOff = false;
                        throw;
                    }
                    var canceled = cancellationToken.IsCancellationRequested;
                    return new ObservationPairTransitionResult(
                        canceled ? ObservationPairTransitionStatus.Canceled
                            : ObservationPairTransitionStatus.TimedOut,
                        true, null, canceled ? "canceled" : "pair_timeout");
                }

                ObservationPairCommit result;
                try
                {
                    result = await task.ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.Canceled, true, null, "canceled");
                }
                catch (Exception error)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.CallbackFailed, true, null,
                        "callback_" + error.GetType().Name);
                }

                if (result == null || !result.Committed)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.CallbackFailed, true, null,
                        result == null ? "commit_null" : result.ErrorCode);
                }
                if (result.Binding == null)
                {
                    return new ObservationPairTransitionResult(
                        ObservationPairTransitionStatus.CallbackFailed, true, null,
                        "binding_missing");
                }

                // Publication happens under the same lease, after the callback result.
                _ledger.BindingFence.Rebind(result.Binding);
                return new ObservationPairTransitionResult(
                    ObservationPairTransitionStatus.Committed, true, result.Binding, null);
            }
            finally
            {
                if (!ownershipHandedOff)
                {
                    linked.Dispose();
                    _lease.Release();
                }
            }
        }

        /// <summary>
        /// Terminal owner for a pairing callback that outlived the caller's bounded
        /// wait. It publishes a committed binding while the lease is still held and
        /// releases the lease exactly once, after the callback has settled.
        /// </summary>
        private void CompleteTransitionAfterTimeout(Task<ObservationPairCommit> task,
            CancellationTokenSource linked)
        {
            task.ContinueWith(delegate(Task<ObservationPairCommit> completed)
            {
                try
                {
                    if (completed.Status == TaskStatus.RanToCompletion)
                    {
                        var result = completed.Result;
                        if (result != null && result.Committed && result.Binding != null)
                            _ledger.BindingFence.Rebind(result.Binding);
                    }
                    else if (completed.IsFaulted)
                    {
                        // Observe the terminal fault; the caller already got a bounded
                        // non-confirmed result and no exception escapes this continuation.
                        var ignored = completed.Exception;
                    }
                }
                catch (Exception)
                {
                    // A terminal callback outcome may never fault the completion owner.
                }
                finally
                {
                    try { linked.Dispose(); }
                    catch (ObjectDisposedException) { }
                    try { _lease.Release(); }
                    catch (ObjectDisposedException) { }
                }
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }

        /// <summary>
        /// One bounded OBS attempt. Default-off: when <see cref="ObservationSendOptions.Enabled"/>
        /// is false nothing is read, posted or mutated.
        /// </summary>
        public async Task<ObservationSendAttemptResult> SendOnceAsync(string coreBodyJson,
            Uri endpoint, DateTime nowUtc, CancellationToken cancellationToken)
        {
            if (_disposed) throw new ObjectDisposedException("ObservationSendCoordinator");
            if (!_enabled)
                return new ObservationSendAttemptResult(ObservationSendStatus.Disabled, 0,
                    "observation_send_disabled");
            if (string.IsNullOrEmpty(coreBodyJson) || endpoint == null)
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, 0,
                    "invalid_request");
            if (nowUtc.Kind != DateTimeKind.Utc)
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, 0,
                    "now_not_utc");
            if (cancellationToken.IsCancellationRequested)
                return new ObservationSendAttemptResult(ObservationSendStatus.Canceled, 0,
                    "canceled");

            int coreBytes;
            try
            {
                coreBytes = Encoding.UTF8.GetByteCount(coreBodyJson);
            }
            catch (Exception error)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, 0,
                    "encode_" + error.GetType().Name);
            }

            bool acquired;
            Interlocked.Increment(ref _pendingLeaseWaiters);
            try
            {
                acquired = await _lease.WaitAsync(_leaseWaitMilliseconds,
                    cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Canceled, 0,
                    "canceled");
            }
            catch (ObjectDisposedException)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, 0,
                    "disposed");
            }
            finally
            {
                Interlocked.Decrement(ref _pendingLeaseWaiters);
            }
            if (!acquired)
            {
                // A bounded lease wait is a deferred attempt, never a quarantine.
                return new ObservationSendAttemptResult(ObservationSendStatus.LeaseTimeout, 0,
                    "lease_timeout");
            }

            var attemptId = Interlocked.Increment(ref _attemptSequence);
            Interlocked.Exchange(ref _activeAttempt, attemptId);
            try
            {
                return await SendUnderLeaseAsync(coreBodyJson, coreBytes, endpoint, nowUtc,
                    attemptId, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                // No transport, store or clock exception may escape the owned attempt
                // as an unobserved task fault; the caller gets a bounded local code.
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused,
                    attemptId, "unhandled_" + error.GetType().Name);
            }
            finally
            {
                Interlocked.Exchange(ref _activeAttempt, 0);
                _lease.Release();
            }
        }

        private async Task<ObservationSendAttemptResult> SendUnderLeaseAsync(
            string coreBodyJson, int coreBodyBytes, Uri endpoint, DateTime nowUtc,
            long attemptId, CancellationToken cancellationToken)
        {
            var current = _ledger.BindingFence.Current;
            var legacyDue = _legacy.Due(nowUtc, int.MaxValue, int.MaxValue);
            var observationDue = DueObservation(nowUtc);

            ObservationSendPlan plan;
            try
            {
                plan = ObservationSendPlanner.Plan(legacyDue, observationDue, current,
                    SafeCapabilities(), coreBodyJson, coreBodyBytes, _limits, nowUtc);
            }
            catch (Exception error)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, attemptId,
                    "plan_" + error.GetType().Name);
            }

            var quarantined = 0;
            if (plan.BindingChangedEntries.Count > 0)
            {
                var bulk = _ledger.QuarantineMany(plan.BindingChangedEntries,
                    ObservationLedgerReasons.CaptureBindingChanged);
                if (!bulk.Committed)
                {
                    return new ObservationSendAttemptResult(ObservationSendStatus.Refused,
                        attemptId, "binding_quarantine_" + bulk.Diagnostic) { Posted = false };
                }
                quarantined += bulk.ChangedCount;
            }
            if (plan.RefusedObservationRows.Count > 0)
            {
                var entries = new List<ObservationLedgerEntry>();
                for (var index = 0; index < plan.RefusedObservationRows.Count; index++)
                    entries.Add(plan.RefusedObservationRows[index].Entry);
                var bulk = _ledger.QuarantineMany(entries,
                    ObservationLedgerReasons.ObservationBuildRefused);
                if (!bulk.Committed)
                {
                    return new ObservationSendAttemptResult(ObservationSendStatus.Refused,
                        attemptId, "build_quarantine_" + bulk.Diagnostic) { Posted = false };
                }
                quarantined += bulk.ChangedCount;
            }

            if (!string.IsNullOrEmpty(plan.ErrorCode))
            {
                var refusedPlan = new ObservationSendAttemptResult(ObservationSendStatus.Refused,
                    attemptId, plan.ErrorCode);
                refusedPlan.Offered = plan.Offered;
                refusedPlan.Binding = current;
                refusedPlan.ObservationQuarantined = quarantined;
                return refusedPlan;
            }
            if (!plan.HasRows)
            {
                var empty = new ObservationSendAttemptResult(
                    quarantined > 0 ? ObservationSendStatus.BindingChanged
                        : ObservationSendStatus.NothingDue, attemptId, null);
                empty.Offered = plan.Offered;
                empty.Binding = current;
                empty.ObservationQuarantined = quarantined;
                return empty;
            }

            string token;
            try
            {
                token = _tokenProvider == null ? null : _tokenProvider();
            }
            catch (Exception error)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, attemptId,
                    "token_" + error.GetType().Name) { Offered = plan.Offered, Binding = current };
            }
            if (string.IsNullOrEmpty(token))
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, attemptId,
                    "token_missing") { Offered = plan.Offered, Binding = current };
            }

            SendEnvelope envelope;
            try
            {
                envelope = SendEnvelope.Create(token, endpoint, current, plan.Offered, plan.Body,
                    attemptId);
            }
            catch (Exception error)
            {
                return new ObservationSendAttemptResult(ObservationSendStatus.Refused, attemptId,
                    "envelope_" + error.GetType().Name) { Offered = plan.Offered, Binding = current };
            }

            // Send-time fence: a local rebind that bypassed the lease still cannot post
            // rows under the old binding.
            if (!_ledger.BindingFence.IsCurrent(envelope.Binding))
            {
                var rows = ObservationRows(envelope);
                var quarantinedNow = 0;
                if (rows.Count > 0)
                {
                    var bulk = _ledger.QuarantineMany(EntriesFor(rows),
                        ObservationLedgerReasons.CaptureBindingChanged);
                    quarantinedNow = bulk.ChangedCount;
                }
                var changed = new ObservationSendAttemptResult(ObservationSendStatus.BindingChanged,
                    attemptId, "capture_binding_changed");
                changed.Offered = envelope.Batch;
                changed.Binding = current;
                changed.BodyBytes = envelope.BodyBytes;
                changed.OfferedObservationRows = envelope.Batch.ObservationCount;
                changed.ObservationRetained = envelope.Batch.ObservationCount - quarantinedNow;
                changed.ObservationQuarantined = quarantinedNow;
                return changed;
            }

            var outcome = await SendBoundedAsync(envelope, cancellationToken).ConfigureAwait(false);
            if (outcome.Completion == TransportCompletion.Canceled
                || outcome.Completion == TransportCompletion.TimedOut)
            {
                var defer = DeferOffered(envelope, nowUtc);
                var result = new ObservationSendAttemptResult(
                    outcome.Completion == TransportCompletion.Canceled
                        ? ObservationSendStatus.Canceled : ObservationSendStatus.TimedOut,
                    attemptId, outcome.Diagnostic);
                result.Posted = true;
                result.Offered = envelope.Batch;
                result.Binding = envelope.Binding;
                result.BodyBytes = envelope.BodyBytes;
                result.OfferedObservationRows = envelope.Batch.ObservationCount;
                result.ObservationRetained = envelope.Batch.ObservationCount;
                result.DeferDiagnostic = defer == null ? null : defer.Diagnostic;
                result.ObservationDeferredPersisted = defer == null ? 0 : defer.ChangedCount;
                return result;
            }
            if (outcome.Completion == TransportCompletion.Failed)
            {
                var defer = DeferOffered(envelope, nowUtc);
                MarkLegacyFailed(plan, nowUtc);
                var failed = new ObservationSendAttemptResult(ObservationSendStatus.TransportFailed,
                    attemptId, outcome.Diagnostic);
                failed.Posted = true;
                failed.Offered = envelope.Batch;
                failed.Binding = envelope.Binding;
                failed.BodyBytes = envelope.BodyBytes;
                failed.OfferedObservationRows = envelope.Batch.ObservationCount;
                failed.ObservationRetained = envelope.Batch.ObservationCount;
                failed.DeferDiagnostic = defer == null ? null : defer.Diagnostic;
                failed.ObservationDeferredPersisted = defer == null ? 0 : defer.ChangedCount;
                return failed;
            }

            var response = outcome.Response;
            if (response.Status == ObservationTransportStatus.BindingChanged)
            {
                var rows = ObservationRows(envelope);
                var quarantinedNow = 0;
                if (rows.Count > 0)
                {
                    var bulk = _ledger.QuarantineMany(EntriesFor(rows),
                        ObservationLedgerReasons.CaptureBindingChanged);
                    quarantinedNow = bulk.ChangedCount;
                }
                var changed = new ObservationSendAttemptResult(ObservationSendStatus.BindingChanged,
                    attemptId, "capture_binding_changed");
                changed.Offered = envelope.Batch;
                changed.Binding = envelope.Binding;
                changed.BodyBytes = envelope.BodyBytes;
                changed.OfferedObservationRows = envelope.Batch.ObservationCount;
                changed.ObservationRetained = envelope.Batch.ObservationCount - quarantinedNow;
                changed.ObservationQuarantined = quarantinedNow;
                return changed;
            }

            if (response.HttpStatus < 200 || response.HttpStatus >= 300)
            {
                var defer = DeferOffered(envelope, nowUtc);
                MarkLegacyFailed(plan, nowUtc);
                var http = new ObservationSendAttemptResult(ObservationSendStatus.Deferred,
                    attemptId, "http_" + response.HttpStatus.ToString(CultureInfo.InvariantCulture));
                http.Posted = true;
                http.HttpStatus = response.HttpStatus;
                http.Offered = envelope.Batch;
                http.Binding = envelope.Binding;
                http.BodyBytes = envelope.BodyBytes;
                http.OfferedObservationRows = envelope.Batch.ObservationCount;
                http.ObservationRetained = envelope.Batch.ObservationCount;
                http.DeferDiagnostic = defer == null ? null : defer.Diagnostic;
                http.ObservationDeferredPersisted = defer == null ? 0 : defer.ChangedCount;
                return http;
            }

            // From here only the accepted resolver + durable ledger can establish
            // observation delivery. A 2xx alone is not a delivery.
            if (Interlocked.Read(ref _activeAttempt) != attemptId)
            {
                var late = new ObservationSendAttemptResult(ObservationSendStatus.TimedOut,
                    attemptId, "late_response_ignored");
                late.Offered = envelope.Batch;
                late.Binding = envelope.Binding;
                return late;
            }

            return ApplyAckAndLegacy(envelope, plan, response, nowUtc, attemptId);
        }

        private ObservationSendAttemptResult ApplyAckAndLegacy(SendEnvelope envelope,
            ObservationSendPlan plan, ObservationTransportResponse response, DateTime nowUtc,
            long attemptId)
        {
            ObservationAckResolution resolution = null;
            ObservationAckApplyResult applied = null;
            var diagnostic = response.BodyTruncated ? "response_too_large" : null;

            if (envelope.Batch.Count > 0)
            {
                try
                {
                    resolution = ObservationAckResolver.Resolve(response.Body,
                        envelope.Batch, envelope.Binding);
                }
                catch (Exception error)
                {
                    resolution = null;
                    diagnostic = "ack_" + error.GetType().Name;
                }
            }

            if (resolution != null && envelope.Batch.ObservationCount > 0)
            {
                try
                {
                    applied = _ledger.ApplyAck(resolution, nowUtc);
                }
                catch (Exception error)
                {
                    diagnostic = "ledger_" + error.GetType().Name;
                }
            }

            AckOutcome legacyOutcome = null;
            var legacyApplied = false;
            if (plan.LegacyRows > 0)
            {
                try
                {
                    legacyOutcome = ApplyLegacyAck(plan, resolution, response.Body, nowUtc);
                    legacyApplied = true;
                }
                catch (Exception error)
                {
                    diagnostic = (diagnostic == null ? string.Empty : diagnostic + ";")
                        + "legacy_" + error.GetType().Name;
                }
            }

            var result = new ObservationSendAttemptResult(
                ObservationSendStatus.NotDelivered, attemptId, diagnostic);
            result.Posted = true;
            result.HttpStatus = response.HttpStatus;
            result.Offered = envelope.Batch;
            result.Binding = envelope.Binding;
            result.BodyBytes = envelope.BodyBytes;
            result.OfferedObservationRows = envelope.Batch.ObservationCount;
            result.Ack = resolution;
            result.LedgerApply = applied;
            result.LegacyAck = legacyOutcome;
            result.LegacyCleanupApplied = legacyApplied;

            if (applied != null)
            {
                result.ObservationDelivered = applied.DeliveredCount;
                result.ObservationQuarantined = applied.QuarantinedCount;
                result.ObservationRetained = envelope.Batch.ObservationCount
                    - applied.DeliveredCount;
                if (applied.Status == ObservationAckApplyStatus.Uncertain)
                {
                    result.Status = ObservationSendStatus.Uncertain;
                    return result;
                }
                if (applied.Stored)
                {
                    result.Status = ObservationSendStatus.Delivered;
                    return result;
                }
                if (applied.DeliveredCount > 0)
                {
                    result.Status = ObservationSendStatus.PartiallyDelivered;
                    return result;
                }
                if (applied.DeferredCount > 0)
                {
                    result.Status = ObservationSendStatus.Deferred;
                    return result;
                }
            }
            else if (envelope.Batch.ObservationCount > 0)
            {
                result.ObservationRetained = envelope.Batch.ObservationCount;
            }

            if (envelope.Batch.ObservationCount == 0 && legacyApplied
                && legacyOutcome != null && legacyOutcome.Stored
                && legacyOutcome.Removed == plan.LegacyRows)
            {
                result.Status = ObservationSendStatus.Delivered;
                return result;
            }
            if (legacyApplied && legacyOutcome != null && legacyOutcome.Removed > 0)
            {
                result.Status = ObservationSendStatus.PartiallyDelivered;
                return result;
            }
            return result;
        }

        private AckOutcome ApplyLegacyAck(ObservationSendPlan plan,
            ObservationAckResolution resolution, string responseBody, DateTime nowUtc)
        {
            MeasurementAckReport report;
            if (resolution != null && plan.Offered != null && plan.Offered.ObservationCount > 0)
            {
                var parsed = MeasurementAckParser.Parse(responseBody, plan.LegacyBatch);
                var laps = BuildLegacyLapReport(resolution, plan.Offered);
                report = new MeasurementAckReport();
                report.Events = parsed.Events;
                report.Laps = laps;
                report.Batch = plan.LegacyBatch;
            }
            else
            {
                report = MeasurementAckParser.Parse(responseBody, plan.LegacyBatch);
            }

            var outcome = _legacy.ApplyAck(report, nowUtc);
            var remaining = new List<OutboxEntry>();
            for (var index = 0; index < plan.LegacyBatch.Events.Count; index++)
            {
                var entry = plan.LegacyBatch.Events[index];
                if (entry != null && _legacy.Contains(entry.Uid)) remaining.Add(entry);
            }
            for (var index = 0; index < plan.LegacyBatch.Laps.Count; index++)
            {
                var entry = plan.LegacyBatch.Laps[index];
                if (entry != null && _legacy.Contains(entry.Uid)) remaining.Add(entry);
            }
            var stored = outcome.Stored && remaining.Count == 0;
            _legacy.MarkAttempt(remaining, nowUtc, !stored);
            return outcome;
        }

        private static AckSeriesReport BuildLegacyLapReport(ObservationAckResolution resolution,
            ObservationOfferedBatch batch)
        {
            var report = new AckSeriesReport();
            report.Received = batch.Count;
            report.Stored = resolution.HasMeasurements && resolution.SeriesStored;
            report.BlockError = resolution.BlockErrorCode;
            if (!report.Stored) return report;

            for (var index = 0; index < resolution.Rows.Count; index++)
            {
                var row = resolution.Rows[index];
                if (row.Lane != ObservationAckLane.Legacy) continue;
                var id = new AckId { Uid = row.Uid, RecordRevision = row.RecordRevision };
                if (row.LegacyOutcome == ObservationLegacyAckClass.Accepted)
                    report.Accepted.Add(id);
                else if (row.LegacyOutcome == ObservationLegacyAckClass.Duplicate)
                    report.Duplicates.Add(id);
                else if (row.LegacyOutcome == ObservationLegacyAckClass.Superseded)
                    report.Superseded.Add(id);
                else if (row.LegacyOutcome == ObservationLegacyAckClass.Rejected)
                {
                    report.Rejected.Add(new AckRejection
                    {
                        Uid = row.Uid,
                        Reason = string.IsNullOrEmpty(row.ReasonCode) ? "unknown" : row.ReasonCode
                    });
                }
            }
            return report;
        }

        private async Task<TransportOutcome> SendBoundedAsync(SendEnvelope envelope,
            CancellationToken cancellationToken)
        {
            var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(_requestTimeoutMilliseconds);

            Task<ObservationTransportResponse> task;
            try
            {
                task = _transport.SendAsync(envelope, delegate
                {
                    return _ledger.BindingFence.IsCurrent(envelope.Binding);
                }, linked.Token);
            }
            catch (Exception error)
            {
                linked.Dispose();
                return new TransportOutcome
                {
                    Completion = TransportCompletion.Failed,
                    Diagnostic = "transport_" + error.GetType().Name
                };
            }
            if (task == null)
            {
                linked.Dispose();
                return new TransportOutcome
                {
                    Completion = TransportCompletion.Failed,
                    Diagnostic = "transport_null"
                };
            }

            var delay = Task.Delay(Timeout.Infinite, linked.Token);
            var winner = await Task.WhenAny(task, delay).ConfigureAwait(false);
            if (winner != task)
            {
                var canceled = cancellationToken.IsCancellationRequested;
                linked.Cancel();
                // The transport task may still observe its token; dispose the source
                // only when that task has reached a terminal state.
                DisposeAfterSettlement(task, linked);
                return new TransportOutcome
                {
                    Completion = canceled ? TransportCompletion.Canceled
                        : TransportCompletion.TimedOut,
                    Diagnostic = canceled ? "canceled" : "request_timeout"
                };
            }

            try
            {
                var response = await task.ConfigureAwait(false);
                return new TransportOutcome
                {
                    Completion = TransportCompletion.Completed,
                    Response = response
                };
            }
            catch (OperationCanceledException)
            {
                return new TransportOutcome
                {
                    Completion = cancellationToken.IsCancellationRequested
                        ? TransportCompletion.Canceled : TransportCompletion.TimedOut,
                    Diagnostic = cancellationToken.IsCancellationRequested
                        ? "canceled" : "request_timeout"
                };
            }
            catch (Exception error)
            {
                return new TransportOutcome
                {
                    Completion = TransportCompletion.Failed,
                    Diagnostic = "transport_" + error.GetType().Name
                };
            }
            finally
            {
                linked.Dispose();
            }
        }

        private ObservationLedgerBulkResult DeferOffered(SendEnvelope envelope, DateTime nowUtc)
        {
            var rows = ObservationRows(envelope);
            if (rows.Count == 0) return null;
            return _ledger.DeferMany(rows, ObservationLedgerReasons.ObservationUnavailable, nowUtc);
        }

        private void MarkLegacyFailed(ObservationSendPlan plan, DateTime nowUtc)
        {
            if (plan == null || plan.LegacyBatch == null) return;
            var remaining = new List<OutboxEntry>();
            for (var index = 0; index < plan.LegacyBatch.Events.Count; index++)
            {
                var entry = plan.LegacyBatch.Events[index];
                if (entry != null && _legacy.Contains(entry.Uid)) remaining.Add(entry);
            }
            for (var index = 0; index < plan.LegacyBatch.Laps.Count; index++)
            {
                var entry = plan.LegacyBatch.Laps[index];
                if (entry != null && _legacy.Contains(entry.Uid)) remaining.Add(entry);
            }
            _legacy.MarkAttempt(remaining, nowUtc, true);
        }

        private List<ObservationLedgerEntry> DueObservation(DateTime nowUtc)
        {
            var due = new List<ObservationLedgerEntry>();
            var entries = _ledger.Entries;
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                if (entry.State == ObservationLedgerState.Quarantine) continue;
                if (entry.NextAttemptUtc.HasValue && entry.NextAttemptUtc.Value > nowUtc) continue;
                due.Add(entry);
            }
            return due;
        }

        private static List<ObservationOfferedRow> ObservationRows(SendEnvelope envelope)
        {
            var rows = new List<ObservationOfferedRow>();
            for (var index = 0; index < envelope.Batch.Rows.Count; index++)
            {
                var row = envelope.Batch.Rows[index];
                if (row.Lane == ObservationAckLane.Observation) rows.Add(row);
            }
            return rows;
        }

        private List<ObservationLedgerEntry> EntriesFor(IList<ObservationOfferedRow> rows)
        {
            var entries = new List<ObservationLedgerEntry>();
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                var entry = _ledger.Find(row.Uid, row.RecordRevision);
                if (entry == null) continue;
                if (!string.Equals(entry.RowJson, row.RowJson, StringComparison.Ordinal)) continue;
                entries.Add(entry);
            }
            return entries;
        }

        private string SafeCapabilities()
        {
            try
            {
                return _capabilitiesJson == null ? null : _capabilitiesJson();
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static void DisposeAfterSettlement(Task task, CancellationTokenSource linked)
        {
            if (task == null)
            {
                linked.Dispose();
                return;
            }
            task.ContinueWith(delegate(Task completed)
            {
                // Observe a terminal fault and release the owned source only now.
                var ignored = completed.Exception;
                try { linked.Dispose(); }
                catch (ObjectDisposedException) { }
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }

        public void Dispose()
        {
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
            }
            _lease.Dispose();
        }
    }
}
