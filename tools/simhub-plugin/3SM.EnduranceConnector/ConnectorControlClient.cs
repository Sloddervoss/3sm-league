using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeSM.EnduranceConnector
{
    [DataContract]
    internal sealed class ControlCacheDto
    {
        [DataMember(Name = "version", Order = 1)] public int Version { get; set; }
        [DataMember(Name = "configRevision", Order = 2)] public int ConfigRevision { get; set; }
        [DataMember(Name = "schemaRevision", Order = 3)] public int SchemaRevision { get; set; }
        [DataMember(Name = "sendIntervalMs", Order = 4)] public int SendIntervalMs { get; set; }
        [DataMember(Name = "sampleHz", Order = 5)] public int SampleHz { get; set; }
        [DataMember(Name = "payloadBudgetBytes", Order = 6)] public int PayloadBudgetBytes { get; set; }
        /// <summary>Features als "naam=0|1", gescheiden door puntkomma's: geen woordenboek op de draad.</summary>
        [DataMember(Name = "features", Order = 7)] public string Features { get; set; }
        [DataMember(Name = "expiresAt", Order = 8, EmitDefaultValue = false)] public string ExpiresAt { get; set; }
        [DataMember(Name = "fetchedAt", Order = 9)] public string FetchedAt { get; set; }
        [DataMember(Name = "recommendedMinVersion", Order = 10, EmitDefaultValue = false)] public string RecommendedMinVersion { get; set; }
        [DataMember(Name = "updateChannel", Order = 11, EmitDefaultValue = false)] public string UpdateChannel { get; set; }
    }

    /// <summary>
    /// De configuratieclient: haalt het beleid van <c>GET /simhub-control</c> op en valt
    /// bij ELK falen terug op het vaste V3-basisprofiel met lokale defaults.
    ///
    /// Twee eisen uit de brief die hier hard zijn:
    ///   1. Een ontbrekend of kapot endpoint blokkeert de verzending niet. Daarom gooit
    ///      <see cref="RefreshAsync"/> nooit, heeft de aanroep een eigen korte timeout en
    ///      is <see cref="Current"/> altijd bruikbaar (defaults vanaf de constructie).
    ///   2. Er komt geen uitvoerbare formule, SDK-kanaalnaam of downloadpad uit dit
    ///      endpoint. Wat hier binnenkomt is beleid: frequenties, budget, features.
    ///
    /// De laatst geldende configuratie wordt bewaard, zodat een korte storing de
    /// intervallen midden in een race niet terugzet naar de defaults. Bij het laden
    /// geldt opnieuw de vervaldatum.
    /// </summary>
    public sealed class ConnectorControlClient
    {
        public const string ControlPath = "simhub-control";
        public const int CacheVersion = 1;
        private const int RequestTimeoutSeconds = 3;
        public const int RefreshIntervalSeconds = 900;
        public const int RetryAfterFailureSeconds = 60;

        private readonly object _gate = new object();
        private readonly Uri _endpoint;
        private readonly HttpClient _http;
        private readonly string _token;
        private readonly Func<DateTime> _clock;
        private ConnectorControlState _current;
        private DateTime? _lastAttemptUtc;
        private DateTime? _nextRefreshUtc;

        public ConnectorControlClient(Uri functionsBaseUri, HttpClient http, string token, Func<DateTime> clock)
        {
            if (functionsBaseUri == null) throw new ArgumentNullException("functionsBaseUri");
            _endpoint = new Uri(functionsBaseUri.ToString().TrimEnd('/') + "/" + ControlPath);
            _http = http;
            _token = token;
            _clock = clock ?? (() => DateTime.UtcNow);
            _current = ConnectorControlState.Default();
        }

        public Uri Endpoint { get { return _endpoint; } }

        /// <summary>Het beleid dat nu geldt. Nooit null, ook voor de eerste ophaalpoging.</summary>
        public ConnectorControlState Current
        {
            get { lock (_gate) return _current; }
        }

        public DateTime? LastAttemptUtc { get { lock (_gate) return _lastAttemptUtc; } }

        /// <summary>
        /// Haalt het beleid op. Faalt nooit: bij een fout, time-out, niet-200 of onleesbare
        /// body komt er een <c>compat</c>-toestand terug met de reden erbij.
        /// </summary>
        public async Task<ConnectorControlState> RefreshAsync(CancellationToken cancellationToken)
        {
            var now = _clock();
            ConnectorControlState state;
            lock (_gate) _lastAttemptUtc = now;

            if (_http == null)
            {
                state = ConnectorControlState.Compat("control_no_client");
            }
            else
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(RequestTimeoutSeconds));
                    try
                    {
                        state = await FetchAsync(timeout.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        state = ConnectorControlState.Compat(cancellationToken.IsCancellationRequested
                            ? "control_cancelled"
                            : "control_timeout");
                    }
                    catch (Exception error)
                    {
                        state = ConnectorControlState.Compat("control_" + error.GetType().Name);
                    }
                }
            }

            lock (_gate)
            {
                _current = state;
                _nextRefreshUtc = _clock().AddSeconds(state.Negotiated ? RefreshIntervalSeconds : RetryAfterFailureSeconds);
            }
            return state;
        }

        private async Task<ConnectorControlState> FetchAsync(CancellationToken cancellationToken)
        {
            using (var request = new HttpRequestMessage(HttpMethod.Get, _endpoint))
            {
                if (!string.IsNullOrEmpty(_token))
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                        return ConnectorControlState.Compat("control_http_" + (int)response.StatusCode);
                    var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    return ConnectorControlState.Parse(body, _clock());
                }
            }
        }

        /// <summary>Is een nieuwe ophaalpoging aan de orde? Nooit vaker dan het interval.</summary>
        public bool ShouldRefresh(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_nextRefreshUtc.HasValue) return true;
                return nowUtc >= _nextRefreshUtc.Value;
            }
        }

        // ---------------------------------------------------------------- cache

        /// <summary>
        /// Bewaart het laatst geldende beleid. Alleen een onderhandelde toestand wordt
        /// bewaard: een compat-toestand is "geen beleid" en hoeft niet op schijf.
        /// </summary>
        public void SaveCache(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            var state = Current;
            if (!state.Negotiated) return;
            try
            {
                var directory = System.IO.Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory)) Directory.CreateDirectory(directory);
                var features = new StringBuilder();
                foreach (var pair in state.Features)
                {
                    if (features.Length > 0) features.Append(';');
                    features.Append(pair.Key).Append('=').Append(pair.Value ? '1' : '0');
                }
                var dto = new ControlCacheDto
                {
                    Version = CacheVersion,
                    ConfigRevision = state.ConfigRevision,
                    SchemaRevision = state.SchemaRevision,
                    SendIntervalMs = state.SendIntervalMs,
                    SampleHz = state.SampleHz,
                    PayloadBudgetBytes = state.PayloadBudgetBytes,
                    Features = features.ToString(),
                    ExpiresAt = MeasurementTime.Format(state.ExpiresAtUtc),
                    FetchedAt = MeasurementTime.Format(state.FetchedAtUtc ?? _clock()),
                    RecommendedMinVersion = state.RecommendedMinVersion,
                    UpdateChannel = state.UpdateChannel
                };
                var temporary = path + ".tmp";
                File.WriteAllText(temporary, MeasurementJson.Serialize(dto));
                if (File.Exists(path))
                {
                    try { File.Replace(temporary, path, path + ".bak", true); }
                    catch (Exception) { File.Copy(temporary, path, true); File.Delete(temporary); }
                }
                else
                {
                    File.Move(temporary, path);
                }
            }
            catch (Exception)
            {
                // Een cache die niet geschreven kan worden is geen storing.
            }
        }

        /// <summary>
        /// Leest de bewaarde configuratie. Is hij verlopen, dan blijft het compat-profiel
        /// gelden: een oude configuratie mag niet alsnog als beleid doorgaan.
        /// </summary>
        public void LoadCache(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
            ControlCacheDto dto;
            try
            {
                dto = MeasurementJson.Deserialize<ControlCacheDto>(File.ReadAllText(path));
            }
            catch (Exception)
            {
                return;
            }
            if (dto == null || dto.Version != CacheVersion || dto.ConfigRevision < 1) return;

            var expiresAt = MeasurementTime.Parse(dto.ExpiresAt);
            var now = _clock();
            if (expiresAt.HasValue && expiresAt.Value <= now) return;

            var state = new ConnectorControlState
            {
                Mode = ConnectorControlState.ModeNegotiated,
                Reason = "control_cache",
                ConfigRevision = dto.ConfigRevision,
                SchemaRevision = ConnectorControlState.Clamp(dto.SchemaRevision, 1, MeasurementContract.SchemaRevision),
                SendIntervalMs = ConnectorControlState.Clamp(dto.SendIntervalMs,
                    ConnectorControlState.LocalMinSendIntervalMs, ConnectorControlState.LocalMaxSendIntervalMs),
                SampleHz = ConnectorControlState.Clamp(dto.SampleHz,
                    ConnectorControlState.LocalMinSampleHz, ConnectorControlState.LocalMaxSampleHz),
                PayloadBudgetBytes = ConnectorControlState.Clamp(dto.PayloadBudgetBytes,
                    ConnectorControlState.LocalMinPayloadBudgetBytes, ConnectorControlState.LocalMaxPayloadBudgetBytes),
                RecommendedMinVersion = dto.RecommendedMinVersion,
                UpdateChannel = dto.UpdateChannel,
                ExpiresAtUtc = expiresAt,
                FetchedAtUtc = MeasurementTime.Parse(dto.FetchedAt)
            };
            if (!string.IsNullOrEmpty(dto.Features))
            {
                foreach (var entry in dto.Features.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var parts = entry.Split('=');
                    if (parts.Length != 2) continue;
                    var name = parts[0];
                    if (Array.IndexOf(ConnectorControlState.KnownFeatures, name) < 0) continue;
                    state.Features[name] = parts[1] == "1";
                }
            }
            lock (_gate) _current = state;
        }
    }
}
