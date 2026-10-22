using System;
using System.Globalization;
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
    /// <summary>
    /// Haalt de stintmomentopname op en bewaart de laatste goede snapshot op schijf.
    /// Alle netwerk- en schijffouten blijven binnen deze klasse: DataUpdate mag nooit
    /// een exception van de overlay zien. Het device-token wordt nooit gecached.
    /// </summary>
    internal sealed class OverlayClient : IDisposable
    {
        private const int MaxResponseBytes = 64 * 1024;
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);

        private readonly object _gate = new object();
        private readonly HttpClient _http;
        private readonly Uri _endpoint;
        private readonly string _cachePath;
        private readonly Func<DateTime> _utcNow;
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();

        private OverlaySnapshot _cached;
        private DateTime _cachedAtUtc = DateTime.MinValue;
        private DateTime _nextPollUtc = DateTime.MinValue;
        private string _token = string.Empty;
        private string _lastError = string.Empty;
        private Task _activeRequest = Task.FromResult(0);
        private int _busy;
        private int _disposed;

        [DataContract]
        private sealed class OverlayCacheFile
        {
            [DataMember(Name = "cachedAtUtc", Order = 1)] public string CachedAtUtc { get; set; }
            [DataMember(Name = "snapshot", Order = 2)] public OverlaySnapshot Snapshot { get; set; }
        }

        internal OverlayClient(Uri endpoint, string cachePath)
            : this(endpoint, cachePath, null, () => DateTime.UtcNow)
        {
        }

        internal OverlayClient(Uri endpoint, string cachePath, HttpMessageHandler handler, Func<DateTime> utcNow)
        {
            if (endpoint == null || !endpoint.IsAbsoluteUri || endpoint.Scheme != Uri.UriSchemeHttps)
                throw new ArgumentException("overlay endpoint must be an absolute https URI", "endpoint");
            _endpoint = endpoint;
            _cachePath = cachePath ?? string.Empty;
            _utcNow = utcNow ?? (() => DateTime.UtcNow);
            _http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false }, true)
            {
                Timeout = RequestTimeout
            };
            LoadCache();
        }

        internal OverlaySnapshot Snapshot
        {
            get { lock (_gate) return _cached; }
        }

        internal int PlanAgeSeconds
        {
            get
            {
                lock (_gate)
                {
                    if (_cached == null) return -1;
                    return (int)Math.Max(0, (_utcNow() - _cachedAtUtc).TotalSeconds);
                }
            }
        }

        internal string LastError
        {
            get { lock (_gate) return _lastError ?? string.Empty; }
        }

        internal void SetToken(string token)
        {
            lock (_gate)
            {
                _token = token ?? string.Empty;
                _lastError = string.Empty;
                _nextPollUtc = DateTime.MinValue;
            }
        }

        /// <summary>Wist de oude planning bij unpair of een nieuwe koppeling.</summary>
        internal void Clear()
        {
            lock (_gate)
            {
                _cached = null;
                _cachedAtUtc = DateTime.MinValue;
                _lastError = string.Empty;
            }
            try
            {
                if (!string.IsNullOrWhiteSpace(_cachePath) && File.Exists(_cachePath))
                    File.Delete(_cachePath);
            }
            catch
            {
                // Cache verwijderen is best-effort.
            }
        }

        /// <summary>
        /// Plant maximaal één request per interval. In de auto elke 5 seconden
        /// (voor de wisselmarkering), in een sessie 15 seconden en daarbuiten 60.
        /// </summary>
        internal void Tick(bool iRacingRunning, bool isInCar)
        {
            try
            {
                if (Volatile.Read(ref _disposed) != 0) return;

                string token;
                lock (_gate)
                {
                    token = _token;
                    if (string.IsNullOrWhiteSpace(token)) return;
                    var now = _utcNow();
                    if (now < _nextPollUtc) return;
                    _nextPollUtc = now.AddSeconds(isInCar ? 5 : (iRacingRunning ? 15 : 60));
                }

                if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
                var cancellationToken = _shutdown.Token;
                var request = Task.Run(() => FetchAsync(token, cancellationToken));
                lock (_gate) _activeRequest = request;
            }
            catch
            {
                // De overlay mag DataUpdate nooit onderbreken.
            }
        }

        private async Task FetchAsync(string token, CancellationToken cancellationToken)
        {
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, _endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

                    using (var response = await _http.SendAsync(
                        request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                    {
                        var body = await ReadBoundedAsync(response.Content, MaxResponseBytes, cancellationToken).ConfigureAwait(false);

                        if (!response.IsSuccessStatusCode)
                        {
                            SetError(ReadErrorCode(body, (int)response.StatusCode));
                            return;
                        }

                        var snapshot = Deserialize<OverlaySnapshot>(body);
                        if (snapshot == null ||
                            !string.Equals(snapshot.Contract, "3sm-overlay.v1", StringComparison.Ordinal))
                        {
                            SetError("invalid_contract");
                            return;
                        }

                        var now = _utcNow();
                        lock (_gate)
                        {
                            _cached = snapshot;
                            _cachedAtUtc = now;
                            _lastError = string.Empty;
                        }
                        SaveCache(snapshot, now);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown of HttpClient-timeout: de vorige snapshot blijft staan.
            }
            catch
            {
                SetError("network_error");
            }
            finally
            {
                Volatile.Write(ref _busy, 0);
            }
        }

        private void SetError(string code)
        {
            lock (_gate) _lastError = string.IsNullOrWhiteSpace(code) ? "overlay_error" : code;
        }

        private static string ReadErrorCode(string body, int statusCode)
        {
            if (!string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    var error = Deserialize<OverlayErrorResponse>(body);
                    if (error != null && !string.IsNullOrWhiteSpace(error.Error))
                        return error.Error.Trim();
                }
                catch
                {
                    // Geen JSON: val terug op de HTTP-status.
                }
            }
            return "http_" + statusCode.ToString(CultureInfo.InvariantCulture);
        }

        [DataContract]
        private sealed class OverlayErrorResponse
        {
            [DataMember(Name = "error", Order = 1)] public string Error { get; set; }
        }

        private void LoadCache()
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_cachePath) || !File.Exists(_cachePath)) return;
                var info = new FileInfo(_cachePath);
                if (info.Length <= 0 || info.Length > MaxResponseBytes) return;

                var cache = Deserialize<OverlayCacheFile>(File.ReadAllText(_cachePath, Encoding.UTF8));
                if (cache == null || cache.Snapshot == null) return;

                DateTime cachedAtUtc;
                if (!DateTime.TryParse(cache.CachedAtUtc, CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out cachedAtUtc))
                    cachedAtUtc = info.LastWriteTimeUtc;
                else
                    cachedAtUtc = cachedAtUtc.ToUniversalTime();

                lock (_gate)
                {
                    _cached = cache.Snapshot;
                    _cachedAtUtc = cachedAtUtc;
                }
            }
            catch
            {
                // Een beschadigde cache mag de plugin niet tegenhouden.
            }
        }

        private void SaveCache(OverlaySnapshot snapshot, DateTime cachedAtUtc)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_cachePath)) return;
                var directory = Path.GetDirectoryName(_cachePath);
                if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);

                var cache = new OverlayCacheFile
                {
                    CachedAtUtc = cachedAtUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
                    Snapshot = snapshot
                };
                var body = Serialize(cache, typeof(OverlayCacheFile));
                var temporaryPath = _cachePath + ".tmp";
                File.WriteAllText(temporaryPath, body, Encoding.UTF8);
                if (File.Exists(_cachePath)) File.Delete(_cachePath);
                File.Move(temporaryPath, _cachePath);
            }
            catch
            {
                // Cache is een optimalisatie, geen voorwaarde.
            }
        }

        private static async Task<string> ReadBoundedAsync(
            HttpContent content, int maxBytes, CancellationToken cancellationToken)
        {
            if (content == null) return string.Empty;
            if (content.Headers.ContentLength.HasValue && content.Headers.ContentLength.Value > maxBytes)
                throw new InvalidDataException("overlay response is too large");

            using (var input = await content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var output = new MemoryStream())
            {
                var buffer = new byte[8192];
                while (true)
                {
                    var read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false);
                    if (read == 0) break;
                    if (output.Length + read > maxBytes)
                        throw new InvalidDataException("overlay response is too large");
                    output.Write(buffer, 0, read);
                }
                return Encoding.UTF8.GetString(output.ToArray());
            }
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

        private static T Deserialize<T>(string json) where T : class
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                return serializer.ReadObject(stream) as T;
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _shutdown.Cancel();

            Task active;
            lock (_gate) active = _activeRequest;
            try { active.Wait(TimeSpan.FromSeconds(6)); } catch { }

            if (active.IsCompleted) _http.Dispose();
            _shutdown.Dispose();
        }
    }
}
