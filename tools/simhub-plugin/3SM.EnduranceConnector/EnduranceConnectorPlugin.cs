using GameReaderCommon;
using SimHub.Plugins;
using System;
using System.Collections.Generic;
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
        public bool IsPaired { get { lock (_settingsGate) return !string.IsNullOrWhiteSpace(_deviceToken) && !string.IsNullOrWhiteSpace(Settings.DeviceId) && !string.IsNullOrWhiteSpace(Settings.BoundOwnerUserId); } }
        public event PropertyChangedEventHandler PropertyChanged;

        public void Init(PluginManager pluginManager)
        {
            PluginManager = pluginManager;
            Settings = this.ReadCommonSettings<ConnectorSettings>("ConnectorSettings", () => new ConnectorSettings());
            if (Settings.SchemaVersion < 3)
            {
                if (Settings.SchemaVersion < 2) Settings.UseCentralRelay = false;
                Settings.SchemaVersion = 3;
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
            // Veilige, laagfrequente versie-check (max 1x per 24u); faalt stil.
            if (Settings.UseCentralRelay && !Volatile.Read(ref _ending).Equals(1))
            {
                try { Task.Run(async () => await CheckForUpdateAsync(_shutdown.Token).ConfigureAwait(false)); }
                catch { /* fire-and-forget; versie-check mag de plugin nooit breken */ }
            }
        }

        private async Task CheckForUpdateAsync(CancellationToken cancellationToken)
        {
            try
            {
                // Niet vaker dan 1x per 24 uur naar de endpoint.
                DateTime? lastCheck;
                lock (_settingsGate) lastCheck = Settings.LastVersionCheckUtc;
                if (lastCheck.HasValue && DateTime.UtcNow - lastCheck.Value < TimeSpan.FromHours(24)) return;

                var localVersion = this.GetType().Assembly.GetName().Version;
                var endpoint = BuildRelayEndpoint("simhub-version");
                using (var request = new HttpRequestMessage(HttpMethod.Get, endpoint))
                using (var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) return;
                    var body = await ReadBoundedResponseAsync(response.Content, 8192, cancellationToken).ConfigureAwait(false);
                    var info = Deserialize<VersionResponse>(body);
                    if (info == null || string.IsNullOrWhiteSpace(info.Version)) return;
                    lock (_settingsGate)
                    {
                        Settings.LastKnownRemoteVersion = info.Version.Trim();
                        Settings.LastKnownRemoteDllUrl = info.DllUrl?.Trim() ?? string.Empty;
                        Settings.LastVersionCheckUtc = DateTime.UtcNow;
                        this.SaveCommonSettings("ConnectorSettings", Settings);
                    }
                    // Vergelijk alleen de assembly-versie; bump de DLL-assembly bij elke release.
                    var remote = Version.TryParse(info.Version.Trim(), out var parsed) ? parsed : null;
                    if (remote != null && localVersion != null && remote > localVersion)
                    {
                        if (Volatile.Read(ref _ending) == 0) Status = "Nieuwe versie beschikbaar · vervang de DLL en herstart";
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Normale shutdown; versie-check wordt gestaakt.
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM Endurance: versie-check mislukt (niet-blokkerend): " + error.Message);
            }
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
                            || !IsGuid(result.DeviceId) || !IsGuid(result.OwnerUserId))
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
                                Settings.BoundRaceId = string.Empty;
                                Settings.BoundTeamId = string.Empty;
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
                ProtocolVersion = 2,
                Sequence = Interlocked.Increment(ref _sequence),
                CapturedAt = DateTime.UtcNow.ToString("o"),
                Source = new TelemetrySource { ConnectorId = NonEmpty(Settings.ConnectorId, Environment.MachineName), SimHubVersion = typeof(PluginManager).Assembly.GetName().Version.ToString(), Game = "IRacing" },
                Race = new RaceIdentity
                {
                    EventId = central ? "connection-test" : Settings.EventId,
                    TeamId = central ? "unassigned" : Settings.TeamId,
                    SessionId = _sessionId,
                    DriverId = central ? null : (string.IsNullOrWhiteSpace(Settings.DriverId) ? null : Settings.DriverId),
                    CurrentDriverId = GetNullableString(manager, Settings.CurrentDriverIdProperty),
                    CurrentDriverName = GetNullableString(manager, Settings.CurrentDriverNameProperty),
                    CarId = GetNullableString(manager, Settings.CarIdProperty),
                    CarName = GetNullableString(manager, Settings.CarNameProperty),
                    TrackName = GetNullableString(manager, Settings.TrackNameProperty),
                    TrackConfig = GetNullableString(manager, Settings.TrackConfigProperty),
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
                    IsInCar = true,
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
        private static string GetNullableString(PluginManager manager, string property) { var value = GetRaw(manager, property); if (value == null) return null; var text = value.ToString().Trim(); return string.IsNullOrWhiteSpace(text) || string.Equals(text, "unknown", StringComparison.OrdinalIgnoreCase) ? null : text; }
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

        // =====================================================================
        // Telemetry V3 (Phase C) — connector-side capture model + immutable
        // snapshot mapping. V3 is a fully separate path from V2 (Capture() above
        // is untouched). Mapping of sessionState/trackSurface to the frozen enum
        // is deferred (always "unknown"). Sentinel normalization happens here so
        // the emitted JSON always satisfies the V3 schema.
        // =====================================================================
        private const string P_IsInCar = "__isInCar";
        private const string P_CurrentDriverId = "DataCorePlugin.GameData.NewData.DriverId";
        private const string P_CurrentDriverName = "DataCorePlugin.GameData.NewData.CurrentDriverName";
        private const string P_CarId = "DataCorePlugin.GameData.NewData.CarId";
        private const string P_CarName = "DataCorePlugin.GameData.NewData.CarName";
        private const string P_TrackName = "DataCorePlugin.GameData.NewData.TrackName";
        private const string P_TrackConfig = "DataCorePlugin.GameData.NewData.TrackConfig";
        private const string P_SessionTime = "DataCorePlugin.GameData.NewData.SessionTime";
        private const string P_SessionTimeRemaining = "DataCorePlugin.GameData.NewData.SessionTimeRemain";
        private const string P_SessionLapsRemaining = "DataCorePlugin.GameData.NewData.SessionLapsRemainEx";
        private const string P_Fuel = "DataCorePlugin.GameData.NewData.Fuel";
        private const string P_FuelPct = "DataCorePlugin.GameData.NewData.FuelLevelPct";
        private const string P_Incidents = "DataCorePlugin.GameData.NewData.PlayerCarDriverIncidentCount";
        private const string P_PitServiceFlags = "DataCorePlugin.GameData.NewData.PitSvFlags";
        private const string P_RequiredRepair = "DataCorePlugin.GameData.NewData.PitRepairLeft";
        private const string P_OptionalRepair = "DataCorePlugin.GameData.NewData.PitOptRepairLeft";
        private const string P_Flag = "DataCorePlugin.GameData.NewData.Flag";
        private const string P_CurrentLapElapsed = "DataCorePlugin.GameData.NewData.LapCurrentLapTime";
        private const string P_GapToLeader = "DataCorePlugin.GameData.NewData.F2Time";
        private const string P_LapDistance = "DataCorePlugin.GameData.NewData.LapDistPct";
        private const string P_IsInPitLane = "DataCorePlugin.GameData.NewData.IsInPitLane";
        private const string P_CarIdxLapDistPct = "DataCorePlugin.GameData.NewData.CarIdxLapDistPct";
        private const string P_CarIdxPosition = "DataCorePlugin.GameData.NewData.CarIdxPosition";
        private const string P_CarIdxClassPosition = "DataCorePlugin.GameData.NewData.CarIdxClassPosition";
        private const string P_CarIdxF2Time = "DataCorePlugin.GameData.NewData.CarIdxF2Time";
        private const string P_CarIdxLastLapTime = "DataCorePlugin.GameData.NewData.CarIdxLastLapTime";
        private const string P_CarIdxBestLapTime = "DataCorePlugin.GameData.NewData.CarIdxBestLapTime";
        private const string P_CarIdxCurrentLap = "DataCorePlugin.GameData.NewData.CarIdxLapCurrentLapTime";
        private const string P_CarIdxOnPitRoad = "DataCorePlugin.GameData.NewData.CarIdxOnPitRoad";
        private const string P_CompletedLaps = "DataCorePlugin.GameData.NewData.CompletedLaps";

        // V3 capture entry point. Reads the same SimHub properties through
        // PluginManager but maps them into the V3 structure. isInCar comes from
        // the same fail-closed running logic used by the V2 path (only invoked
        // while iRacing is running with telemetry).
        internal TelemetryEnvelopeV3 CaptureV3(PluginManager manager, bool isInCar)
        {
            var playerCarIdx = GetNullablePlayerCarIdx(manager, Settings.PlayerCarIdxProperty);
            var raw = new Dictionary<string, object>();
            raw[P_IsInCar] = isInCar;
            raw[P_CurrentDriverId] = GetRaw(manager, Settings.CurrentDriverIdProperty);
            raw[P_CurrentDriverName] = GetRaw(manager, Settings.CurrentDriverNameProperty);
            raw[P_CarId] = GetRaw(manager, Settings.CarIdProperty);
            raw[P_CarName] = GetRaw(manager, Settings.CarNameProperty);
            raw[P_TrackName] = GetRaw(manager, Settings.TrackNameProperty);
            raw[P_TrackConfig] = GetRaw(manager, Settings.TrackConfigProperty);
            raw[P_SessionTime] = GetRaw(manager, Settings.SessionTimeProperty);
            raw[P_SessionTimeRemaining] = GetRaw(manager, Settings.SessionTimeRemainingProperty);
            raw[P_SessionLapsRemaining] = GetRaw(manager, Settings.SessionLapsRemainingProperty);
            raw[P_Fuel] = GetRaw(manager, Settings.FuelProperty);
            raw[P_FuelPct] = GetRaw(manager, Settings.FuelPctProperty);
            raw[P_Incidents] = GetRaw(manager, Settings.PlayerCarDriverIncidentCountProperty);
            raw[P_PitServiceFlags] = GetRaw(manager, Settings.PitServiceFlagsProperty);
            raw[P_RequiredRepair] = GetRaw(manager, Settings.RequiredRepairProperty);
            raw[P_OptionalRepair] = GetRaw(manager, Settings.OptionalRepairProperty);
            raw[P_Flag] = GetRaw(manager, Settings.FlagProperty);
            raw[P_CurrentLapElapsed] = GetRaw(manager, Settings.CurrentLapElapsedProperty);
            raw[P_GapToLeader] = GetRaw(manager, Settings.GapToLeaderProperty);
            raw[P_LapDistance] = GetRaw(manager, Settings.LapDistanceProperty);
            raw[P_IsInPitLane] = GetRaw(manager, Settings.PitLaneProperty);
            // CarIdx-backed array members are always read at the playerCarIdx slot,
            // bounds-checked; we never assume index 0.
            raw[P_CarIdxLapDistPct] = GetNullableCarIdxDouble(manager, Settings.CarIdxLapDistPctProperty, playerCarIdx);
            raw[P_CarIdxPosition] = GetNullableCarIdxInt(manager, Settings.CarIdxPositionProperty, playerCarIdx);
            raw[P_CarIdxClassPosition] = GetNullableCarIdxInt(manager, Settings.CarIdxClassPositionProperty, playerCarIdx);
            raw[P_CarIdxF2Time] = GetNullableCarIdxDouble(manager, Settings.CarIdxF2TimeProperty, playerCarIdx);
            raw[P_CarIdxLastLapTime] = GetNullableCarIdxDouble(manager, Settings.CarIdxLastLapTimeProperty, playerCarIdx);
            raw[P_CarIdxBestLapTime] = GetNullableCarIdxDouble(manager, Settings.CarIdxBestLapTimeProperty, playerCarIdx);
            raw[P_CarIdxCurrentLap] = GetNullableCarIdxDouble(manager, Settings.CarIdxCurrentLapProperty, playerCarIdx);
            raw[P_CarIdxOnPitRoad] = GetNullableCarIdxBool(manager, Settings.CarIdxOnPitRoadProperty, playerCarIdx);

            var envelope = CreateFromRaw(raw, playerCarIdx);
            envelope.TransportSessionId = _sessionId;
            envelope.Sequence = Interlocked.Increment(ref _sequence);
            envelope.CapturedAt = DateTime.UtcNow.ToString("o");
            return envelope;
        }

        // Pure mapping over a property bag (simulates PluginManager.GetPropertyValue)
        // so it can be unit-tested without a live SimHub instance.
        internal static TelemetryEnvelopeV3 CreateFromRaw(Dictionary<string, object> raw, int? playerCarIdx)
        {
            var envelope = new TelemetryEnvelopeV3
            {
                ProtocolVersion = 3,
                Identity = new V3Identity
                {
                    CurrentDriverId = NullableText(raw, P_CurrentDriverId),
                    CurrentDriverName = NullableText(raw, P_CurrentDriverName),
                    CarId = NullableText(raw, P_CarId),
                    CarName = NullableText(raw, P_CarName),
                    TrackName = NullableText(raw, P_TrackName),
                    TrackConfig = NullableText(raw, P_TrackConfig),
                },
                Session = new V3Session
                {
                    IsInCar = raw != null && raw.TryGetValue(P_IsInCar, out var inCar) && inCar is bool carIn && carIn,
                    SessionTimeSeconds = NormalizeNonNegative(NullableDouble(raw, P_SessionTime)),
                    SessionTimeRemainingSeconds = NormalizeTimeRemaining(NullableDouble(raw, P_SessionTimeRemaining)),
                    SessionLapsRemaining = NormalizeLaps(NullableInt(raw, P_SessionLapsRemaining)),
                    Flags = ExtractFlags(Raw(raw, P_Flag)),
                    SessionState = "unknown",
                },
                Timing = new V3Timing
                {
                    CurrentLapElapsedSeconds = NormalizeTiming(GetCarIdxDoubleOr(raw, P_CarIdxCurrentLap, playerCarIdx, P_CurrentLapElapsed)),
                    LastLapTimeSeconds = NormalizeTiming(GetCarIdxDouble(raw, P_CarIdxLastLapTime, playerCarIdx)),
                    BestLapTimeSeconds = NormalizeTiming(GetCarIdxDouble(raw, P_CarIdxBestLapTime, playerCarIdx)),
                    CompletedLaps = NormalizeNonNegativeInt(NullableInt(raw, P_CompletedLaps)),
                },
                Position = new V3Position
                {
                    Position = NormalizePosition(GetCarIdxInt(raw, P_CarIdxPosition, playerCarIdx)),
                    ClassPosition = NormalizePosition(GetCarIdxInt(raw, P_CarIdxClassPosition, playerCarIdx)),
                    GapToLeaderSeconds = NormalizeNonNegative(GetCarIdxDoubleOr(raw, P_CarIdxF2Time, playerCarIdx, P_GapToLeader)),
                },
                Track = new V3Track
                {
                    LapDistancePct = NormalizeLapDist(GetCarIdxDoubleOr(raw, P_CarIdxLapDistPct, playerCarIdx, P_LapDistance)),
                    TrackSurface = "unknown",
                    OnPitRoad = GetCarIdxBoolOr(raw, P_CarIdxOnPitRoad, playerCarIdx, P_IsInPitLane),
                },
                Fuel = new V3Fuel
                {
                    FuelLitres = NormalizeNonNegative(NullableDouble(raw, P_Fuel)),
                    FuelPct = NormalizeFuelPct(NullableDouble(raw, P_FuelPct)),
                },
                RaceState = new V3RaceState
                {
                    Incidents = NormalizeNonNegativeInt(NullableInt(raw, P_Incidents)),
                },
                PitService = new V3PitService
                {
                    PitServiceFlagsRaw = NormalizeNonNegativeInt(NullableInt(raw, P_PitServiceFlags)),
                    RequiredRepairSeconds = NormalizeNonNegative(NullableDouble(raw, P_RequiredRepair)),
                    OptionalRepairSeconds = NormalizeNonNegative(NullableDouble(raw, P_OptionalRepair)),
                },
            };
            return envelope;
        }

        // PlayerCarIdx resolution: read the raw value, require a non-negative int.
        // Bounds checking against the CarIdx array length happens in GetCarIdxValue.
        private static int? GetNullablePlayerCarIdx(PluginManager manager, string property)
        {
            var value = GetRaw(manager, property);
            if (value == null) return null;
            int parsed;
            if (value is int playerIndex) parsed = playerIndex;
            else if (!int.TryParse(value.ToString(), out parsed)) return null;
            return parsed >= 0 ? (int?)parsed : null;
        }

        private static object GetCarIdxValue(PluginManager manager, string arrayProperty, int? playerCarIdx)
        {
            if (!playerCarIdx.HasValue || playerCarIdx.Value < 0) return null;
            var array = GetRaw(manager, arrayProperty) as Array;
            if (array == null) return null;
            if (playerCarIdx.Value >= array.Length) return null;
            return array.GetValue(playerCarIdx.Value);
        }

        private static double? GetNullableCarIdxDouble(PluginManager manager, string arrayProperty, int? playerCarIdx)
        {
            return ToDouble(GetCarIdxValue(manager, arrayProperty, playerCarIdx));
        }

        private static int? GetNullableCarIdxInt(PluginManager manager, string arrayProperty, int? playerCarIdx)
        {
            var value = GetCarIdxValue(manager, arrayProperty, playerCarIdx);
            if (value == null) return null;
            int parsed;
            return int.TryParse(value.ToString(), out parsed) ? (int?)parsed : null;
        }

        private static bool? GetNullableCarIdxBool(PluginManager manager, string arrayProperty, int? playerCarIdx)
        {
            var value = GetCarIdxValue(manager, arrayProperty, playerCarIdx);
            if (value == null) return null;
            if (value is bool flag) return flag;
            bool parsedBool;
            if (bool.TryParse(value.ToString(), out parsedBool)) return parsedBool;
            int parsedInt;
            return int.TryParse(value.ToString(), out parsedInt) ? (bool?)(parsedInt != 0) : null;
        }

        // --- raw property-bag accessors (Array-or-scalar aware) ---
        private static object Raw(Dictionary<string, object> raw, string key)
        {
            object value;
            return raw != null && raw.TryGetValue(key, out value) ? value : null;
        }

        private static object CarIdxValue(Dictionary<string, object> raw, string key, int? playerCarIdx)
        {
            var value = Raw(raw, key);
            if (value == null) return null;
            var array = value as Array;
            if (array == null) return value; // caller already extracted scalar slot
            if (!playerCarIdx.HasValue || playerCarIdx.Value < 0 || playerCarIdx.Value >= array.Length) return null;
            return array.GetValue(playerCarIdx.Value);
        }

        private static double? GetCarIdxDouble(Dictionary<string, object> raw, string key, int? playerCarIdx)
        {
            return ToDouble(CarIdxValue(raw, key, playerCarIdx));
        }

        private static double? GetCarIdxDoubleOr(Dictionary<string, object> raw, string key, int? playerCarIdx, string fallbackKey)
        {
            if (playerCarIdx.HasValue && playerCarIdx.Value >= 0) return GetCarIdxDouble(raw, key, playerCarIdx);
            return ToDouble(Raw(raw, fallbackKey));
        }

        private static int? GetCarIdxInt(Dictionary<string, object> raw, string key, int? playerCarIdx)
        {
            var value = CarIdxValue(raw, key, playerCarIdx);
            if (value == null) return null;
            int parsed;
            return int.TryParse(value.ToString(), out parsed) ? (int?)parsed : null;
        }

        private static bool? GetCarIdxBoolOr(Dictionary<string, object> raw, string key, int? playerCarIdx, string fallbackKey)
        {
            var value = CarIdxValue(raw, key, playerCarIdx);
            if (value != null)
            {
                if (value is bool boolVal) return boolVal;
                bool parsedBool;
                if (bool.TryParse(value.ToString(), out parsedBool)) return parsedBool;
                int parsedInt;
                if (int.TryParse(value.ToString(), out parsedInt)) return parsedInt != 0;
            }
            if (playerCarIdx.HasValue && playerCarIdx.Value >= 0) return null;
            var direct = Raw(raw, fallbackKey);
            if (direct == null) return null;
            if (direct is bool directBool) return directBool;
            bool directParsedBool;
            if (bool.TryParse(direct.ToString(), out directParsedBool)) return directParsedBool;
            int directParsedInt;
            return int.TryParse(direct.ToString(), out directParsedInt) ? (bool?)(directParsedInt != 0) : null;
        }

        private static double? NullableDouble(Dictionary<string, object> raw, string key)
        {
            return ToDouble(Raw(raw, key));
        }

        private static int? NullableInt(Dictionary<string, object> raw, string key)
        {
            var value = Raw(raw, key);
            if (value == null) return null;
            int parsed;
            return int.TryParse(value.ToString(), out parsed) ? (int?)parsed : null;
        }

        private static string NullableText(Dictionary<string, object> raw, string key)
        {
            var value = Raw(raw, key);
            if (value == null) return null;
            var text = value.ToString().Trim();
            return string.IsNullOrWhiteSpace(text) || string.Equals(text, "unknown", StringComparison.OrdinalIgnoreCase) ? null : text;
        }

        private static double? ToDouble(object value)
        {
            if (value == null) return null;
            if (value is TimeSpan timeSpan) return timeSpan.TotalSeconds;
            if (value is double d) return double.IsNaN(d) || double.IsInfinity(d) ? (double?)null : d;
            if (value is float f) { var fd = (double)f; return double.IsNaN(fd) || double.IsInfinity(fd) ? (double?)null : fd; }
            if (value is int i) return i;
            if (value is long l) return l;
            if (value is short s) return s;
            if (value is bool) return null;
            double parsed;
            if (double.TryParse(value.ToString(), out parsed) && !double.IsNaN(parsed) && !double.IsInfinity(parsed)) return parsed;
            return null;
        }

        // --- sentinel normalization (emitted JSON must satisfy the V3 schema) ---
        private static double? NormalizeNonNegative(double? value) { return value.HasValue && value.Value >= 0 ? value : null; }
        private static int? NormalizeNonNegativeInt(int? value) { return value.HasValue && value.Value >= 0 ? value : null; }
        private static double? NormalizeTimeRemaining(double? value) { if (!value.HasValue) return null; if (value.Value == 604800.0 || value.Value < 0) return null; return value; }
        private static int? NormalizeLaps(int? value) { if (!value.HasValue) return null; if (value.Value == 32767 || value.Value < 0) return null; return value; }
        private static double? NormalizeTiming(double? value) { if (!value.HasValue) return null; return value.Value > 0 ? value : null; }
        private static int? NormalizePosition(int? value) { if (!value.HasValue) return null; return value.Value > 0 ? value : null; }
        private static double? NormalizeLapDist(double? value) { if (!value.HasValue) return null; return (value.Value >= 0 && value.Value <= 1) ? value : null; }
        private static double? NormalizeFuelPct(double? value) { if (!value.HasValue) return null; return NormalizeLapDist(value); }

        // flags: build an ordered, allowlisted string[] from the raw flag value
        // (iRacing SessionFlags bitmask or comma/seperated names), deduplicated.
        private static string[] ExtractFlags(object rawFlag)
        {
            if (rawFlag == null) return null;
            var text = rawFlag.ToString().ToLowerInvariant();
            long bits = -1;
            if (rawFlag is byte byteVal) bits = byteVal;
            else if (rawFlag is short shortVal) bits = shortVal;
            else if (rawFlag is int intVal) bits = intVal;
            else if (rawFlag is long longVal) bits = longVal;
            else if (!long.TryParse(text, out bits)) bits = -1;

            var found = new List<string>();
            if (bits >= 0)
            {
                // iRacing SessionFlags bit mapping (green=0x2 yellow=0x4 red=0x8
                // checkered=0x1 blue=0x10 white=0x20 black=0x40 disqualify=0x80 meatball=0x100000).
                AddFlag(found, bits, 0x2L, "green");
                AddFlag(found, bits, 0x4L, "yellow");
                AddFlag(found, bits, 0x8L, "red");
                AddFlag(found, bits, 0x1L, "checkered");
                AddFlag(found, bits, 0x10L, "blue");
                AddFlag(found, bits, 0x20L, "white");
                AddFlag(found, bits, 0x40L, "black");
                AddFlag(found, bits, 0x80L, "disqualify");
                AddFlag(found, bits, 0x100000L, "meatball");
            }
            else
            {
                foreach (var name in new[] { "green", "yellow", "red", "white", "checkered", "blue", "black", "meatball", "disqualify" })
                {
                    if (text.Contains(name) && !found.Contains(name)) found.Add(name);
                }
            }
            return found.Count == 0 ? null : found.ToArray();
        }

        private static void AddFlag(List<string> found, long bits, long bit, string name)
        {
            if ((bits & bit) != 0) found.Add(name);
        }
    }
}
