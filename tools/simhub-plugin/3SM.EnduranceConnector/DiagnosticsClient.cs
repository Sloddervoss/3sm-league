using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeSM.EnduranceConnector
{
    internal sealed class DiagnosticsObservation
    {
        public bool GameConnected;
        public bool TelemetryAvailable;
        public bool RawDataAvailable;
        public bool RawTelemetryAvailable;
        public bool SessionTimeReadOk;
        public double? SessionTimeSeconds;
        public long Sequence;
        public DateTime? LastTelemetryAttemptUtc;
        public DateTime? LastSuccessfulIngestUtc;
        public int? LastIngestHttpStatus;
    }

    [DataContract]
    internal sealed class DiagnosticHeartbeat
    {
        [DataMember(Name = "type", Order = 1)] public string Type = "heartbeat";
        [DataMember(Name = "deviceId", Order = 2)] public string DeviceId;
        [DataMember(Name = "connectorVersion", Order = 3)] public string ConnectorVersion;
        [DataMember(Name = "simHubVersion", Order = 4)] public string SimHubVersion;
        [DataMember(Name = "gameConnected", Order = 5)] public bool GameConnected;
        [DataMember(Name = "telemetryAvailable", Order = 6)] public bool TelemetryAvailable;
        [DataMember(Name = "rawDataAvailable", Order = 7)] public bool RawDataAvailable;
        [DataMember(Name = "rawTelemetryAvailable", Order = 8)] public bool RawTelemetryAvailable;
        [DataMember(Name = "sessionTimeReadOk", Order = 9)] public bool SessionTimeReadOk;
        [DataMember(Name = "sessionTimeSeconds", Order = 10)] public double? SessionTimeSeconds;
        [DataMember(Name = "sessionTimeReader", Order = 11)] public string SessionTimeReader = "RawDataReflection";
        [DataMember(Name = "sequence", Order = 12)] public long Sequence;
        [DataMember(Name = "lastTelemetryAttemptUtc", Order = 13)] public string LastTelemetryAttemptUtc;
        [DataMember(Name = "lastSuccessfulIngestUtc", Order = 14)] public string LastSuccessfulIngestUtc;
        [DataMember(Name = "lastIngestHttpStatus", Order = 15)] public int? LastIngestHttpStatus;
        [DataMember(Name = "diagnosticCode", Order = 16)] public string DiagnosticCode;
        [DataMember(Name = "updaterState", Order = 17)] public string UpdaterState;
        [DataMember(Name = "updaterCurrentVersion", Order = 18)] public string UpdaterCurrentVersion;
        [DataMember(Name = "updaterTargetVersion", Order = 19)] public string UpdaterTargetVersion;
        [DataMember(Name = "lastUpdateResult", Order = 20)] public string LastUpdateResult;
        [DataMember(Name = "lastUpdateUtc", Order = 21)] public string LastUpdateUtc;
        [DataMember(Name = "clientReportedAtUtc", Order = 22)] public string ClientReportedAtUtc;
    }

    [DataContract]
    internal sealed class DiagnosticEvent
    {
        [DataMember(Name = "type", Order = 1)] public string Type = "event";
        [DataMember(Name = "deviceId", Order = 2)] public string DeviceId;
        [DataMember(Name = "code", Order = 3)] public string Code;
        [DataMember(Name = "atUtc", Order = 4)] public string AtUtc;
        [DataMember(Name = "exceptionType", Order = 5)] public string ExceptionType;
        [DataMember(Name = "detail", Order = 6)] public string Detail;
        [DataMember(Name = "occurredAfter", Order = 7)] public string OccurredAfter;
    }

    /// <summary>
    /// Isolated, latest-state-only diagnostics sender. It owns its HTTP client, timer,
    /// cancellation and in-flight gate and never shares telemetry scheduling or sequence state.
    /// Failures are intentionally swallowed: the next opportunity is the normal cadence.
    /// </summary>
    internal sealed class DiagnosticsClient : IDisposable
    {
        internal static readonly string[] AllowedCodes = new[]
        {
            "OK", "RAW_DATA_UNAVAILABLE", "RAW_TELEMETRY_UNAVAILABLE",
            "SESSION_TIME_READ_FAILED", "TELEMETRY_STALE",
            "INGEST_401", "INGEST_403", "INGEST_429", "INGEST_500",
            "DEVICE_UNBOUND", "DEVICE_REVOKED",
            "UPDATE_CHECK_FAILED", "UPDATE_DOWNLOAD_FAILED", "UPDATE_HASH_FAILED",
            "UPDATE_SIGNATURE_FAILED", "UPDATE_INSTALL_FAILED",
            "UPDATE_DLL_LOCKED", "UPDATE_ROLLBACK_USED"
        };

        private static readonly IDictionary<string, string> Details = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "OK", "diagnostic state recovered" },
            { "RAW_DATA_UNAVAILABLE", "raw game data unavailable" },
            { "RAW_TELEMETRY_UNAVAILABLE", "raw telemetry unavailable" },
            { "SESSION_TIME_READ_FAILED", "session time member unavailable" },
            { "TELEMETRY_STALE", "telemetry ingest is stale" },
            { "INGEST_401", "telemetry ingest returned 401" },
            { "INGEST_403", "telemetry ingest returned 403" },
            { "INGEST_429", "telemetry ingest returned 429" },
            { "INGEST_500", "telemetry ingest returned server error" },
            { "DEVICE_UNBOUND", "device is not bound" },
            { "DEVICE_REVOKED", "device authorization rejected" },
            { "UPDATE_CHECK_FAILED", "update check failed" },
            { "UPDATE_DOWNLOAD_FAILED", "update download failed" },
            { "UPDATE_HASH_FAILED", "update hash verification failed" },
            { "UPDATE_SIGNATURE_FAILED", "update signature verification failed" },
            { "UPDATE_INSTALL_FAILED", "update installation failed" },
            { "UPDATE_DLL_LOCKED", "connector file is locked" },
            { "UPDATE_ROLLBACK_USED", "updater rollback was used" }
        };

        private readonly object _gate = new object();
        private readonly HttpClient _http;
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly Func<DateTime> _utcNow;
        private readonly Func<UpdaterState> _readUpdaterState;
        private readonly TimeSpan _heartbeatInterval;
        private readonly TimeSpan _eventCooldown;
        private readonly TimeSpan _tickInterval;
        private readonly bool _useTimer;
        private Timer _timer;
        private Task _activeRequest = Task.FromResult(0);
        private int _busy;
        private int _disposed;
        private Uri _endpoint;
        private string _token;
        private string _deviceId;
        private string _connectorVersion;
        private string _simHubVersion;
        private DiagnosticsObservation _observation = new DiagnosticsObservation { Sequence = -1 };
        private DateTime? _lastHeartbeatAttemptUtc;
        private DateTime? _lastEventAttemptUtc;
        private string _currentCode = "OK";
        private PendingEvent _pendingEvent;

        private sealed class PendingEvent
        {
            public string Code;
            public string Previous;
            public DateTime AtUtc;
        }

        internal DiagnosticsClient(Uri endpoint, Func<UpdaterState> readUpdaterState)
            : this(endpoint, readUpdaterState, null, () => DateTime.UtcNow,
                  TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(1), true)
        {
        }

        internal DiagnosticsClient(Uri endpoint, Func<UpdaterState> readUpdaterState,
            HttpMessageHandler handler, Func<DateTime> utcNow, TimeSpan heartbeatInterval,
            TimeSpan eventCooldown, TimeSpan tickInterval, bool useTimer)
        {
            if (endpoint == null) throw new ArgumentNullException("endpoint");
            if (!endpoint.IsAbsoluteUri || endpoint.Scheme != Uri.UriSchemeHttps ||
                !string.Equals(endpoint.Host, "api.3stripemotorsport.cc", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(endpoint.AbsolutePath, "/functions/v1/simhub-diagnostic", StringComparison.Ordinal) ||
                !endpoint.IsDefaultPort || !string.IsNullOrEmpty(endpoint.UserInfo) ||
                !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
                throw new ArgumentException("diagnostics endpoint is not the pinned 3SM endpoint", "endpoint");
            _endpoint = endpoint;
            _readUpdaterState = readUpdaterState ?? (() => UpdaterState.SafeDefaults());
            _utcNow = utcNow ?? (() => DateTime.UtcNow);
            _heartbeatInterval = heartbeatInterval;
            _eventCooldown = eventCooldown;
            _tickInterval = tickInterval;
            _useTimer = useTimer;
            var actualHandler = handler ?? new HttpClientHandler { AllowAutoRedirect = false };
            _http = new HttpClient(actualHandler, true) { Timeout = TimeSpan.FromSeconds(5) };
        }

        internal void Start(string token, string deviceId, string connectorVersion, string simHubVersion)
        {
            if (Volatile.Read(ref _disposed) != 0) return;
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(deviceId)) return;
            lock (_gate)
            {
                _token = token;
                _deviceId = deviceId;
                _connectorVersion = connectorVersion ?? string.Empty;
                _simHubVersion = simHubVersion ?? string.Empty;
                _lastHeartbeatAttemptUtc = null;
                if (_useTimer && _timer == null)
                    _timer = new Timer(TimerTick, null, TimeSpan.Zero, _tickInterval);
            }
        }

        internal void Observe(DiagnosticsObservation value)
        {
            if (value == null || Volatile.Read(ref _disposed) != 0) return;
            lock (_gate)
            {
                var merged = CopyObservation(value);
                merged.TelemetryAvailable = value.TelemetryAvailable || _observation.TelemetryAvailable;
                merged.LastTelemetryAttemptUtc = value.LastTelemetryAttemptUtc ?? _observation.LastTelemetryAttemptUtc;
                merged.LastSuccessfulIngestUtc = value.LastSuccessfulIngestUtc ?? _observation.LastSuccessfulIngestUtc;
                merged.LastIngestHttpStatus = value.LastIngestHttpStatus ?? _observation.LastIngestHttpStatus;
                _observation = merged;
                SetCodeLocked(ResolveCode(merged, ReadUpdaterStateSafe()), _utcNow());
            }
        }

        internal void RecordIngestAttempt(DateTime attemptUtc)
        {
            lock (_gate)
            {
                var copy = CopyObservation(_observation);
                copy.TelemetryAvailable = true;
                copy.LastTelemetryAttemptUtc = attemptUtc;
                _observation = copy;
            }
        }

        internal void RecordIngestResult(DateTime attemptUtc, int httpStatus, bool success)
        {
            lock (_gate)
            {
                var copy = CopyObservation(_observation);
                copy.TelemetryAvailable = true;
                copy.LastTelemetryAttemptUtc = attemptUtc;
                copy.LastIngestHttpStatus = httpStatus;
                if (success) copy.LastSuccessfulIngestUtc = _utcNow();
                _observation = copy;
                SetCodeLocked(ResolveCode(copy, ReadUpdaterStateSafe()), _utcNow());
            }
        }

        internal Task TriggerAsync()
        {
            if (Volatile.Read(ref _disposed) != 0 || Interlocked.CompareExchange(ref _busy, 1, 0) != 0)
                return Task.FromResult(0);
            Task task;
            lock (_gate)
            {
                if (string.IsNullOrWhiteSpace(_token) || string.IsNullOrWhiteSpace(_deviceId))
                {
                    Volatile.Write(ref _busy, 0);
                    return Task.FromResult(0);
                }
                task = SendOpportunityAsync(_shutdown.Token);
                _activeRequest = task;
            }
            return task;
        }

        private void TimerTick(object state)
        {
            try { TriggerAsync(); } catch { }
        }

        private async Task SendOpportunityAsync(CancellationToken cancellationToken)
        {
            try
            {
                object payload = null;
                Type payloadType = null;
                string token;
                var now = _utcNow();
                lock (_gate)
                {
                    token = _token;
                    if (_pendingEvent != null &&
                        (!_lastEventAttemptUtc.HasValue || now - _lastEventAttemptUtc.Value >= _eventCooldown))
                    {
                        var pending = _pendingEvent;
                        _pendingEvent = null; // one attempt only; no backlog reconstruction
                        _lastEventAttemptUtc = now;
                        payload = new DiagnosticEvent
                        {
                            DeviceId = _deviceId,
                            Code = pending.Code,
                            AtUtc = FormatUtc(pending.AtUtc),
                            ExceptionType = null,
                            Detail = Details[pending.Code],
                            OccurredAfter = pending.Previous
                        };
                        payloadType = typeof(DiagnosticEvent);
                    }
                    else if (!_lastHeartbeatAttemptUtc.HasValue || now - _lastHeartbeatAttemptUtc.Value >= _heartbeatInterval)
                    {
                        _lastHeartbeatAttemptUtc = now; // attempt cadence, not success cadence
                        payload = BuildHeartbeatLocked(now);
                        payloadType = typeof(DiagnosticHeartbeat);
                    }
                }
                if (payload == null) return;
                var body = Serialize(payload, payloadType);
                if (Encoding.UTF8.GetByteCount(body) > 4096) return;
                using (var request = new HttpRequestMessage(HttpMethod.Post, _endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                    {
                        // Status is intentionally not retried and response content is never logged/read.
                        var ignored = (int)response.StatusCode;
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (HttpRequestException) { }
            catch (IOException) { }
            catch (Exception) { }
            finally { Volatile.Write(ref _busy, 0); }
        }

        private DiagnosticHeartbeat BuildHeartbeatLocked(DateTime now)
        {
            var observation = CopyObservation(_observation);
            var updater = ReadUpdaterStateSafe();
            var code = ResolveCode(observation, updater);
            _currentCode = code;
            return new DiagnosticHeartbeat
            {
                DeviceId = _deviceId,
                ConnectorVersion = _connectorVersion,
                SimHubVersion = _simHubVersion,
                GameConnected = observation.GameConnected,
                TelemetryAvailable = observation.TelemetryAvailable,
                RawDataAvailable = observation.RawDataAvailable,
                RawTelemetryAvailable = observation.RawTelemetryAvailable,
                SessionTimeReadOk = observation.SessionTimeReadOk,
                SessionTimeSeconds = observation.SessionTimeSeconds,
                Sequence = observation.Sequence,
                LastTelemetryAttemptUtc = FormatNullableUtc(observation.LastTelemetryAttemptUtc),
                LastSuccessfulIngestUtc = FormatNullableUtc(observation.LastSuccessfulIngestUtc),
                LastIngestHttpStatus = observation.LastIngestHttpStatus,
                DiagnosticCode = code,
                UpdaterState = updater.state ?? "IDLE",
                UpdaterCurrentVersion = _connectorVersion,
                UpdaterTargetVersion = updater.pendingUpdateVersion,
                LastUpdateResult = updater.lastUpdateResult ?? "none",
                LastUpdateUtc = NormalizeUtcString(updater.lastUpdateUtc),
                ClientReportedAtUtc = FormatUtc(now)
            };
        }

        private void SetCodeLocked(string next, DateTime atUtc)
        {
            if (!IsAllowedCode(next)) next = "OK";
            if (string.Equals(next, _currentCode, StringComparison.Ordinal)) return;
            var previous = _currentCode;
            _currentCode = next;
            _pendingEvent = new PendingEvent { Code = next, Previous = previous, AtUtc = atUtc };
        }

        private static string ResolveCode(DiagnosticsObservation observation, UpdaterState updater)
        {
            var updaterCode = MapUpdaterCode(updater);
            if (updaterCode != null) return updaterCode;
            if (observation.LastIngestHttpStatus == 401) return "INGEST_401";
            if (observation.LastIngestHttpStatus == 403) return "INGEST_403";
            if (observation.LastIngestHttpStatus == 429) return "INGEST_429";
            if (observation.LastIngestHttpStatus >= 500) return "INGEST_500";
            if (observation.GameConnected && !observation.RawDataAvailable) return "RAW_DATA_UNAVAILABLE";
            if (observation.GameConnected && !observation.RawTelemetryAvailable) return "RAW_TELEMETRY_UNAVAILABLE";
            if (observation.GameConnected && !observation.SessionTimeReadOk) return "SESSION_TIME_READ_FAILED";
            return "OK";
        }

        private static string MapUpdaterCode(UpdaterState updater)
        {
            if (updater == null) return null;
            var value = (updater.lastUpdateErrorCode ?? string.Empty).ToUpperInvariant();
            if (value.Contains("SIGNATURE")) return "UPDATE_SIGNATURE_FAILED";
            if (value.Contains("HASH")) return "UPDATE_HASH_FAILED";
            if (value.Contains("DOWNLOAD")) return "UPDATE_DOWNLOAD_FAILED";
            if (value.Contains("LOCK")) return "UPDATE_DLL_LOCKED";
            if (value.Contains("ROLLBACK")) return "UPDATE_ROLLBACK_USED";
            if (value.Contains("CHECK")) return "UPDATE_CHECK_FAILED";
            if (string.Equals(updater.state, "FAILED", StringComparison.Ordinal)) return "UPDATE_INSTALL_FAILED";
            return null;
        }

        private UpdaterState ReadUpdaterStateSafe()
        {
            try
            {
                var state = _readUpdaterState();
                return state != null && state.IsValid() ? state : UpdaterState.SafeDefaults();
            }
            catch { return UpdaterState.SafeDefaults(); }
        }

        internal static bool IsAllowedCode(string value)
        {
            for (var index = 0; index < AllowedCodes.Length; index++)
                if (string.Equals(AllowedCodes[index], value, StringComparison.Ordinal)) return true;
            return false;
        }

        private static DiagnosticsObservation CopyObservation(DiagnosticsObservation value)
        {
            return new DiagnosticsObservation
            {
                GameConnected = value.GameConnected,
                TelemetryAvailable = value.TelemetryAvailable,
                RawDataAvailable = value.RawDataAvailable,
                RawTelemetryAvailable = value.RawTelemetryAvailable,
                SessionTimeReadOk = value.SessionTimeReadOk,
                SessionTimeSeconds = value.SessionTimeSeconds,
                Sequence = value.Sequence,
                LastTelemetryAttemptUtc = value.LastTelemetryAttemptUtc,
                LastSuccessfulIngestUtc = value.LastSuccessfulIngestUtc,
                LastIngestHttpStatus = value.LastIngestHttpStatus
            };
        }

        private static string Serialize(object value, Type type)
        {
            var serializer = new DataContractJsonSerializer(type);
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        private static string FormatUtc(DateTime value) { return value.ToUniversalTime().ToString("o"); }
        private static string FormatNullableUtc(DateTime? value) { return value.HasValue ? FormatUtc(value.Value) : null; }
        private static string NormalizeUtcString(string value)
        {
            DateTime parsed;
            return !string.IsNullOrWhiteSpace(value) && DateTime.TryParse(value, null,
                System.Globalization.DateTimeStyles.RoundtripKind, out parsed) ? FormatUtc(parsed) : null;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _shutdown.Cancel();
            var timer = Interlocked.Exchange(ref _timer, null);
            if (timer != null) timer.Dispose();
            Task active;
            lock (_gate)
            {
                active = _activeRequest;
                _token = null;
                _deviceId = null;
                _pendingEvent = null;
            }
            try { active.Wait(TimeSpan.FromSeconds(6)); } catch { }
            if (active.IsCompleted) _http.Dispose();
            _shutdown.Dispose();
        }
    }
}
