using GameReaderCommon;
using SimHub.Plugins;
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace ThreeSM.EnduranceConnector
{
    [PluginDescription("Stuurt laagfrequente iRacing-telemetry adviserend via de beveiligde 3SM-relay; lokale fallback blijft beschikbaar.")]
    [PluginAuthor("3Stripe Motorsport")]
    [PluginName("3SM Endurance Connector")]
    public sealed class EnduranceConnectorPlugin : IPlugin, IDataPlugin, IWPFSettingsV2, INotifyPropertyChanged
    {
        private const string ProductionRelayBaseUrl = "https://api.3stripemotorsport.cc/functions/v1";
        private readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(4) };
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly object _sendGate = new object();
        private readonly object _settingsGate = new object();
        private readonly Stopwatch _sendClock = Stopwatch.StartNew();
        private readonly Stopwatch _stintClock = new Stopwatch();
        private long _sequence = -1;
        private long _lastQueuedMilliseconds;
        private int _sendBusy;
        private int _ending;
        private Task _activeSend = Task.FromResult(0);
        private Task<bool> _activePairing = Task.FromResult(false);
        private int _pairingBusy;
        private string _deviceToken = string.Empty;
        private bool _gameWasRunning;
        private string _sessionId;
        private string _status = "Nog niet gestart";

        public PluginManager PluginManager { get; set; }
        public ConnectorSettings Settings { get; internal set; }
        public ImageSource PictureIcon { get { return null; } }
        public string LeftMenuTitle { get { return "3SM Endurance"; } }
        public string Status { get { return _status; } private set { SetStatus(value); } }
        public bool IsPaired { get { lock (_settingsGate) return !string.IsNullOrWhiteSpace(_deviceToken) && !string.IsNullOrWhiteSpace(Settings.BoundRaceId) && !string.IsNullOrWhiteSpace(Settings.BoundTeamId); } }
        public event PropertyChangedEventHandler PropertyChanged;

        public void Init(PluginManager pluginManager)
        {
            PluginManager = pluginManager;
            Settings = this.ReadCommonSettings<ConnectorSettings>("ConnectorSettings", () => new ConnectorSettings());
            if (Settings.SchemaVersion < 2)
            {
                Settings.UseCentralRelay = false;
                Settings.SchemaVersion = 2;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            _deviceToken = UnprotectToken(Settings.DeviceTokenProtected);
            if (!string.IsNullOrWhiteSpace(Settings.DeviceTokenProtected) && string.IsNullOrWhiteSpace(_deviceToken))
            {
                SimHub.Logging.Current.Warn("3SM Endurance: opgeslagen DPAPI-device-token is onleesbaar en wordt lokaal verwijderd.");
                Settings.DeviceTokenProtected = string.Empty;
                Settings.DeviceId = string.Empty;
                Settings.BoundRaceId = string.Empty;
                Settings.BoundTeamId = string.Empty;
                Settings.BoundOwnerUserId = string.Empty;
                Settings.UseCentralRelay = false;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            _sessionId = "simhub-" + Guid.NewGuid().ToString("N");
            Status = Settings.UseCentralRelay
                ? (IsPaired ? "Gekoppeld · wacht op iRacing" : "Niet gekoppeld · maak een code op de 3SM-site")
                : "Lokale fallback · wacht op iRacing";
            SimHub.Logging.Current.Info("3SM Endurance Connector gestart");
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            try
            {
                if (Volatile.Read(ref _ending) != 0) return;
                var isIRacing = string.Equals(data.GameName, "IRacing", StringComparison.OrdinalIgnoreCase);
                var running = isIRacing && data.GameRunning;
                if (running && !_gameWasRunning)
                {
                    _stintClock.Restart();
                    _sessionId = "simhub-" + Guid.NewGuid().ToString("N");
                    Interlocked.Exchange(ref _sequence, -1);
                }
                if (!running && _gameWasRunning) _stintClock.Stop();
                _gameWasRunning = running;
                if (!running)
                {
                    Status = isIRacing ? "iRacing gestart · wacht op telemetry" : "Wacht op iRacing";
                    return;
                }
                Uri endpoint;
                string token;
                TelemetryEnvelope envelope;
                lock (_settingsGate)
                {
                    var central = Settings.UseCentralRelay;
                    if (central && !IsPaired)
                    {
                        Status = "Niet gekoppeld · voer een 3SM-code in";
                        return;
                    }
                    var interval = Math.Max(500, Settings.SendIntervalMilliseconds);
                    var now = _sendClock.ElapsedMilliseconds;
                    if (now - _lastQueuedMilliseconds < interval || Interlocked.CompareExchange(ref _sendBusy, 1, 0) != 0) return;
                    _lastQueuedMilliseconds = now;
                    if (central)
                    {
                        endpoint = BuildRelayEndpoint("simhub-ingest");
                        token = _deviceToken;
                    }
                    else
                    {
                        Uri baseUri;
                        if (!Uri.TryCreate(Settings.BridgeUrl, UriKind.Absolute, out baseUri) || baseUri.Scheme != Uri.UriSchemeHttp || !baseUri.IsLoopback) throw new InvalidOperationException("lokale bridge moet loopback gebruiken");
                        endpoint = new Uri(baseUri, "/v1/telemetry");
                        token = Settings.PairingToken;
                        if (string.IsNullOrWhiteSpace(token) || token.Length < 12) throw new InvalidOperationException("lokaal pairingtoken is te kort");
                    }
                    envelope = Capture(pluginManager, central);
                }
                lock (_sendGate)
                {
                    if (Volatile.Read(ref _ending) != 0)
                    {
                        Volatile.Write(ref _sendBusy, 0);
                        return;
                    }
                    _activeSend = Task.Run(async () => await SendAsync(envelope, endpoint, token, _shutdown.Token).ConfigureAwait(false));
                }
            }
            catch (Exception error)
            {
                Volatile.Write(ref _sendBusy, 0);
                Status = "Capturefout · " + error.Message;
                SimHub.Logging.Current.Warn("3SM Endurance capturefout: " + error);
            }
        }

        public void End(PluginManager pluginManager)
        {
            Task activeSend;
            Task activePairing;
            lock (_sendGate)
            {
                Interlocked.Exchange(ref _ending, 1);
                _shutdown.Cancel();
                activeSend = _activeSend;
                activePairing = _activePairing;
            }
            try { Task.WaitAll(new[] { activeSend, activePairing }, TimeSpan.FromSeconds(5)); } catch { }
            lock (_settingsGate)
            {
                this.SaveCommonSettings("ConnectorSettings", Settings);
                _deviceToken = string.Empty;
            }
            if (activeSend.IsCompleted && activePairing.IsCompleted)
            {
                _http.Dispose();
                _shutdown.Dispose();
            }
            else SimHub.Logging.Current.Warn("3SM Endurance: shutdowntaak liep na vijf seconden nog; resources worden niet voortijdig disposed.");
            Status = "Gestopt";
        }

        public Control GetWPFSettingsControl(PluginManager pluginManager) { return new SettingsControl(this); }

        internal void UpdateSettings(Action<ConnectorSettings> update)
        {
            if (update == null) return;
            lock (_settingsGate) update(Settings);
        }

        public Task<bool> PairAsync(string code)
        {
            lock (_sendGate)
            {
                if (Volatile.Read(ref _ending) != 0 || Interlocked.CompareExchange(ref _pairingBusy, 1, 0) != 0) return Task.FromResult(false);
                _activePairing = Task.Run(async () => await PairCoreAsync(code, _shutdown.Token).ConfigureAwait(false));
                return _activePairing;
            }
        }

        private async Task<bool> PairCoreAsync(string code, CancellationToken cancellationToken)
        {
            try
            {
                var normalized = (code ?? string.Empty).ToUpperInvariant().Replace("-", string.Empty).Replace(" ", string.Empty);
                if (normalized.Length != 8) throw new InvalidOperationException("pairingcode moet 8 tekens bevatten");
                var endpoint = BuildRelayEndpoint("simhub-pair");
                string connectorId;
                lock (_settingsGate) connectorId = NonEmpty(Settings.ConnectorId, Environment.MachineName);
                var payload = new PairingRequest
                {
                    Action = "exchange",
                    Code = normalized,
                    ConnectorId = connectorId,
                    DeviceName = Environment.MachineName,
                };
                var body = Serialize(payload, typeof(PairingRequest));
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                    {
                        var contentType = response.Content.Headers.ContentType;
                        if (contentType == null || !string.Equals(contentType.MediaType, "application/json", StringComparison.OrdinalIgnoreCase)) throw new HttpRequestException("pairingresponse is geen JSON");
                        if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value > 16384) throw new HttpRequestException("pairingresponse is te groot");
                        var responseBody = await ReadBoundedResponseAsync(response.Content, 16384, cancellationToken).ConfigureAwait(false);
                        cancellationToken.ThrowIfCancellationRequested();
                        var result = Deserialize<PairingResponse>(responseBody);
                        if (!response.IsSuccessStatusCode || result == null || !result.Paired
                            || !IsDeviceToken(result.DeviceToken)
                            || !IsGuid(result.DeviceId) || !IsGuid(result.RaceId) || !IsGuid(result.TeamId) || !IsGuid(result.OwnerUserId))
                        {
                            throw new HttpRequestException(result != null && !string.IsNullOrWhiteSpace(result.Error) ? result.Error : "pairing HTTP " + (int)response.StatusCode);
                        }
                        lock (_settingsGate)
                        {
                            cancellationToken.ThrowIfCancellationRequested();
                            if (Volatile.Read(ref _ending) != 0) throw new OperationCanceledException(cancellationToken);
                            var oldProtected = Settings.DeviceTokenProtected;
                            var oldDeviceId = Settings.DeviceId;
                            var oldRaceId = Settings.BoundRaceId;
                            var oldTeamId = Settings.BoundTeamId;
                            var oldOwnerId = Settings.BoundOwnerUserId;
                            var oldCentral = Settings.UseCentralRelay;
                            var oldToken = _deviceToken;
                            try
                            {
                                Settings.DeviceTokenProtected = ProtectToken(result.DeviceToken);
                                Settings.DeviceId = result.DeviceId;
                                Settings.BoundRaceId = result.RaceId;
                                Settings.BoundTeamId = result.TeamId;
                                Settings.BoundOwnerUserId = result.OwnerUserId;
                                Settings.UseCentralRelay = true;
                                this.SaveCommonSettings("ConnectorSettings", Settings);
                                _deviceToken = result.DeviceToken;
                            }
                            catch
                            {
                                Settings.DeviceTokenProtected = oldProtected;
                                Settings.DeviceId = oldDeviceId;
                                Settings.BoundRaceId = oldRaceId;
                                Settings.BoundTeamId = oldTeamId;
                                Settings.BoundOwnerUserId = oldOwnerId;
                                Settings.UseCentralRelay = oldCentral;
                                _deviceToken = oldToken;
                                try { this.SaveCommonSettings("ConnectorSettings", Settings); }
                                catch (Exception rollbackError) { SimHub.Logging.Current.Warn("3SM Endurance pairingrollback kon niet worden opgeslagen: " + rollbackError); }
                                throw;
                            }
                        }
                    }
                }
                _sessionId = "simhub-" + Guid.NewGuid().ToString("N");
                Interlocked.Exchange(ref _sequence, -1);
                Status = "Gekoppeld · wacht op iRacing";
                OnPropertyChanged("IsPaired");
                return true;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return false;
            }
            catch (Exception error)
            {
                Status = "Pairing mislukt · " + error.Message;
                return false;
            }
            finally
            {
                Volatile.Write(ref _pairingBusy, 0);
            }
        }

        public void Unpair()
        {
            if (Volatile.Read(ref _pairingBusy) != 0) { Status = "Pairing is nog bezig"; return; }
            lock (_settingsGate)
            {
                var oldToken = _deviceToken;
                var oldProtected = Settings.DeviceTokenProtected;
                var oldDeviceId = Settings.DeviceId;
                var oldRaceId = Settings.BoundRaceId;
                var oldTeamId = Settings.BoundTeamId;
                var oldOwnerId = Settings.BoundOwnerUserId;
                try
                {
                    _deviceToken = string.Empty;
                    Settings.DeviceTokenProtected = string.Empty;
                    Settings.DeviceId = string.Empty;
                    Settings.BoundRaceId = string.Empty;
                    Settings.BoundTeamId = string.Empty;
                    Settings.BoundOwnerUserId = string.Empty;
                    this.SaveCommonSettings("ConnectorSettings", Settings);
                }
                catch (Exception error)
                {
                    _deviceToken = oldToken;
                    Settings.DeviceTokenProtected = oldProtected;
                    Settings.DeviceId = oldDeviceId;
                    Settings.BoundRaceId = oldRaceId;
                    Settings.BoundTeamId = oldTeamId;
                    Settings.BoundOwnerUserId = oldOwnerId;
                    try { this.SaveCommonSettings("ConnectorSettings", Settings); }
                    catch (Exception rollbackError) { SimHub.Logging.Current.Warn("3SM Endurance unpairrollback kon niet worden opgeslagen: " + rollbackError); }
                    Status = "Lokaal vergeten mislukt · " + error.Message;
                    return;
                }
            }
            Status = "Lokaal vergeten · trek het device ook op de 3SM-site in";
            OnPropertyChanged("IsPaired");
        }

        private TelemetryEnvelope Capture(PluginManager manager, bool central)
        {
            var fuel = Math.Max(0, GetDouble(manager, Settings.FuelProperty, 0));
            var fuelPerLap = GetNullableDouble(manager, Settings.FuelPerLapProperty, true);
            var estimatedLaps = GetNullableDouble(manager, Settings.EstimatedLapsProperty, false);
            if (!estimatedLaps.HasValue && fuelPerLap.HasValue && fuelPerLap.Value > 0) estimatedLaps = fuel / fuelPerLap.Value;
            return new TelemetryEnvelope
            {
                ProtocolVersion = 1,
                Sequence = Interlocked.Increment(ref _sequence),
                CapturedAt = DateTime.UtcNow.ToString("o"),
                Source = new TelemetrySource { ConnectorId = NonEmpty(Settings.ConnectorId, Environment.MachineName), SimHubVersion = typeof(PluginManager).Assembly.GetName().Version.ToString(), Game = "IRacing" },
                Race = new RaceIdentity
                {
                    EventId = central ? Settings.BoundRaceId : Settings.EventId,
                    TeamId = central ? Settings.BoundTeamId : Settings.TeamId,
                    SessionId = _sessionId,
                    DriverId = central ? null : (string.IsNullOrWhiteSpace(Settings.DriverId) ? null : Settings.DriverId),
                },
                Telemetry = new TelemetryValues
                {
                    Connected = true,
                    SessionTimeSeconds = Math.Max(0, GetDouble(manager, Settings.SessionTimeProperty, 0)),
                    Lap = Math.Max(0, GetInt(manager, Settings.LapProperty, 0)),
                    CompletedLaps = Math.Max(0, GetInt(manager, Settings.CompletedLapsProperty, 0)),
                    LapTimeSeconds = GetNullableSeconds(manager, Settings.LapTimeProperty),
                    Position = PositiveOrNull(GetInt(manager, Settings.PositionProperty, 0)),
                    ClassPosition = PositiveOrNull(GetInt(manager, Settings.ClassPositionProperty, 0)),
                    SpeedKph = Clamp(GetDouble(manager, Settings.SpeedProperty, 0), 0, 500),
                    FuelLitres = Clamp(fuel, 0, 250),
                    FuelPerLapLitres = fuelPerLap,
                    EstimatedLapsRemaining = estimatedLaps,
                    InPitLane = GetBool(manager, Settings.PitLaneProperty, false),
                    PitLimiter = GetBool(manager, Settings.PitLimiterProperty, false),
                    StintElapsedSeconds = _stintClock.Elapsed.TotalSeconds,
                    Incidents = NonNegativeOrNull(GetNullableInt(manager, Settings.IncidentsProperty)),
                    Flag = NormalizeFlag(GetRaw(manager, Settings.FlagProperty)),
                }
            };
        }

        private async Task SendAsync(TelemetryEnvelope envelope, Uri endpoint, string token, CancellationToken cancellationToken)
        {
            try
            {
                var body = Serialize(envelope, typeof(TelemetryEnvelope));
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode) throw new HttpRequestException("relay HTTP " + (int)response.StatusCode);
                    }
                }
                if (Volatile.Read(ref _ending) == 0) Status = "Live · sequence " + envelope.Sequence;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Normale plugin-shutdown; End bepaalt de eindstatus.
            }
            catch (Exception error)
            {
                if (Volatile.Read(ref _ending) == 0) Status = "Relayfout · " + error.Message;
            }
            finally
            {
                Volatile.Write(ref _sendBusy, 0);
            }
        }

        private static Uri BuildRelayEndpoint(string functionName)
        {
            var baseUri = new Uri(ProductionRelayBaseUrl, UriKind.Absolute);
            return new Uri(baseUri.ToString().TrimEnd('/') + "/" + functionName);
        }

        private static string UnprotectToken(string protectedToken)
        {
            if (string.IsNullOrWhiteSpace(protectedToken)) return string.Empty;
            try
            {
                var encrypted = Convert.FromBase64String(protectedToken);
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser));
            }
            catch { return string.Empty; }
        }

        private static string ProtectToken(string token)
        {
            var encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(encrypted);
        }

        private static async Task<string> ReadBoundedResponseAsync(HttpContent content, int maxBytes, CancellationToken cancellationToken)
        {
            using (var input = await content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var output = new MemoryStream())
            {
                var buffer = new byte[4096];
                while (true)
                {
                    var read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false);
                    if (read == 0) break;
                    if (output.Length + read > maxBytes) throw new HttpRequestException("pairingresponse is te groot");
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

        private static T Deserialize<T>(string body) where T : class
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(body))) return serializer.ReadObject(stream) as T;
        }

        private static object GetRaw(PluginManager manager, string property) { if (manager == null || string.IsNullOrWhiteSpace(property)) return null; try { return manager.GetPropertyValue(property); } catch { return null; } }
        private static double GetDouble(PluginManager manager, string property, double fallback) { var value = GetRaw(manager, property); if (value is TimeSpan) return ((TimeSpan)value).TotalSeconds; double parsed; return value != null && double.TryParse(value.ToString(), out parsed) && !double.IsNaN(parsed) && !double.IsInfinity(parsed) ? parsed : fallback; }
        private static double? GetNullableDouble(PluginManager manager, string property, bool positive) { var value = GetRaw(manager, property); double parsed; if (value == null || !double.TryParse(value.ToString(), out parsed) || double.IsNaN(parsed) || double.IsInfinity(parsed) || (positive && parsed <= 0) || (!positive && parsed < 0)) return null; return parsed; }
        private static double? GetNullableSeconds(PluginManager manager, string property) { var value = GetRaw(manager, property); if (value is TimeSpan) { var seconds = ((TimeSpan)value).TotalSeconds; return seconds > 0 ? (double?)seconds : null; } return GetNullableDouble(manager, property, true); }
        private static int GetInt(PluginManager manager, string property, int fallback) { var value = GetRaw(manager, property); int parsed; return value != null && int.TryParse(value.ToString(), out parsed) ? parsed : fallback; }
        private static int? GetNullableInt(PluginManager manager, string property) { var value = GetRaw(manager, property); int parsed; return value != null && int.TryParse(value.ToString(), out parsed) ? (int?)parsed : null; }
        private static bool GetBool(PluginManager manager, string property, bool fallback) { var value = GetRaw(manager, property); if (value is bool) return (bool)value; bool parsed; if (value != null && bool.TryParse(value.ToString(), out parsed)) return parsed; int integer; return value != null && int.TryParse(value.ToString(), out integer) ? integer != 0 : fallback; }
        private static int? PositiveOrNull(int value) { return value > 0 ? (int?)value : null; }
        private static int? NonNegativeOrNull(int? value) { return value.HasValue && value.Value >= 0 ? value : null; }
        private static string NonEmpty(string value, string fallback) { return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim(); }
        private static bool IsGuid(string value) { Guid parsed; return !string.IsNullOrWhiteSpace(value) && Guid.TryParseExact(value, "D", out parsed); }
        private static bool IsDeviceToken(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length != 43) return false;
            foreach (var character in value)
            {
                var asciiLetter = (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
                var asciiDigit = character >= '0' && character <= '9';
                if (!(asciiLetter || asciiDigit || character == '-' || character == '_')) return false;
            }
            return true;
        }
        private static double Clamp(double value, double min, double max) { return value < min ? min : value > max ? max : value; }
        private static string NormalizeFlag(object value) { var text = value == null ? "unknown" : value.ToString().ToLowerInvariant(); foreach (var flag in new[] { "green", "yellow", "red", "white", "checkered" }) if (text.Contains(flag)) return flag; return "unknown"; }
        private void SetStatus(string value)
        {
            if (Volatile.Read(ref _ending) != 0 && !string.Equals(value, "Gestopt", StringComparison.Ordinal)) return;
            var application = Application.Current;
            if (application == null) { _status = value; return; }
            if (application != null && !application.Dispatcher.CheckAccess())
            {
                try { application.Dispatcher.BeginInvoke(new Action(() => SetStatus(value))); } catch (InvalidOperationException) { }
                return;
            }
            if (_status == value) return;
            _status = value;
            OnPropertyChanged("Status");
        }
        private void OnPropertyChanged([CallerMemberName] string name = null)
        {
            var application = Application.Current;
            if (application == null) return;
            if (application != null && !application.Dispatcher.CheckAccess())
            {
                try { application.Dispatcher.BeginInvoke(new Action(() => OnPropertyChanged(name))); } catch (InvalidOperationException) { }
                return;
            }
            var handler = PropertyChanged;
            if (handler != null) handler(this, new PropertyChangedEventArgs(name));
        }
    }
}
