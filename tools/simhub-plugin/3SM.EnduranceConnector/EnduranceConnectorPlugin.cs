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
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Media;

namespace ThreeSM.EnduranceConnector
{
    [PluginDescription("Stuurt laagfrequente iRacing-telemetry adviserend naar de lokale 3SM Endurance bridge.")]
    [PluginAuthor("3Stripe Motorsport")]
    [PluginName("3SM Endurance Connector")]
    public sealed class EnduranceConnectorPlugin : IPlugin, IDataPlugin, IWPFSettingsV2, INotifyPropertyChanged
    {
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        private readonly Stopwatch _sendClock = Stopwatch.StartNew();
        private readonly Stopwatch _stintClock = new Stopwatch();
        private long _sequence = -1;
        private long _lastQueuedMilliseconds;
        private int _sendBusy;
        private bool _gameWasRunning;
        private string _sessionId;
        private string _status = "Nog niet gestart";

        public PluginManager PluginManager { get; set; }
        public ConnectorSettings Settings { get; internal set; }
        public ImageSource PictureIcon { get { return null; } }
        public string LeftMenuTitle { get { return "3SM Endurance"; } }
        public string Status { get { return _status; } private set { if (_status == value) return; _status = value; OnPropertyChanged(); } }
        public event PropertyChangedEventHandler PropertyChanged;

        public void Init(PluginManager pluginManager)
        {
            PluginManager = pluginManager;
            Settings = this.ReadCommonSettings<ConnectorSettings>("ConnectorSettings", () => new ConnectorSettings());
            _sessionId = "simhub-" + Guid.NewGuid().ToString("N");
            Status = "Gereed · wacht op iRacing";
            SimHub.Logging.Current.Info("3SM Endurance Connector gestart");
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            try
            {
                var isIRacing = string.Equals(data.GameName, "IRacing", StringComparison.OrdinalIgnoreCase);
                var running = isIRacing && data.GameRunning;
                if (running && !_gameWasRunning) { _stintClock.Restart(); _sessionId = "simhub-" + Guid.NewGuid().ToString("N"); }
                if (!running && _gameWasRunning) _stintClock.Stop();
                _gameWasRunning = running;
                if (!running) { Status = isIRacing ? "iRacing gestart · wacht op telemetry" : "Wacht op iRacing"; return; }

                var interval = Math.Max(500, Settings.SendIntervalMilliseconds);
                var now = _sendClock.ElapsedMilliseconds;
                if (now - _lastQueuedMilliseconds < interval || Interlocked.CompareExchange(ref _sendBusy, 1, 0) != 0) return;
                _lastQueuedMilliseconds = now;
                var envelope = Capture(pluginManager);
                Task.Run(async () => await SendAsync(envelope).ConfigureAwait(false));
            }
            catch (Exception error)
            {
                Status = "Capturefout · " + error.Message;
                SimHub.Logging.Current.Warn("3SM Endurance capturefout: " + error);
            }
        }

        public void End(PluginManager pluginManager)
        {
            this.SaveCommonSettings("ConnectorSettings", Settings);
            _http.Dispose();
            Status = "Gestopt";
        }

        public Control GetWPFSettingsControl(PluginManager pluginManager) { return new SettingsControl(this); }

        private TelemetryEnvelope Capture(PluginManager manager)
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
                Race = new RaceIdentity { EventId = Settings.EventId, TeamId = Settings.TeamId, SessionId = _sessionId, DriverId = string.IsNullOrWhiteSpace(Settings.DriverId) ? null : Settings.DriverId },
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

        private async Task SendAsync(TelemetryEnvelope envelope)
        {
            try
            {
                Uri baseUri;
                if (!Uri.TryCreate(Settings.BridgeUrl, UriKind.Absolute, out baseUri) || baseUri.Scheme != Uri.UriSchemeHttp || !baseUri.IsLoopback) throw new InvalidOperationException("bridge moet http://127.0.0.1 of localhost zijn");
                if (string.IsNullOrWhiteSpace(Settings.PairingToken) || Settings.PairingToken.Length < 12) throw new InvalidOperationException("pairingtoken is te kort");
                if (string.IsNullOrWhiteSpace(Settings.EventId) || string.IsNullOrWhiteSpace(Settings.TeamId)) throw new InvalidOperationException("event-ID en team-ID zijn verplicht");
                var serializer = new DataContractJsonSerializer(typeof(TelemetryEnvelope));
                string body;
                using (var stream = new MemoryStream()) { serializer.WriteObject(stream, envelope); body = Encoding.UTF8.GetString(stream.ToArray()); }
                using (var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "/v1/telemetry")))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Settings.PairingToken);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode) throw new HttpRequestException("bridge HTTP " + (int)response.StatusCode);
                    }
                }
                Status = "Live · sequence " + envelope.Sequence;
            }
            catch (Exception error)
            {
                Status = "Bridgefout · " + error.Message;
            }
            finally
            {
                Volatile.Write(ref _sendBusy, 0);
            }
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
        private static double Clamp(double value, double min, double max) { return value < min ? min : value > max ? max : value; }
        private static string NormalizeFlag(object value) { var text = value == null ? "unknown" : value.ToString().ToLowerInvariant(); foreach (var flag in new[] { "green", "yellow", "red", "white", "checkered" }) if (text.Contains(flag)) return flag; return "unknown"; }
        private void OnPropertyChanged([CallerMemberName] string name = null) { var handler = PropertyChanged; if (handler != null) handler(this, new PropertyChangedEventArgs(name)); }
    }
}
