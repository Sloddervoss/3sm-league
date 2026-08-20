using GameReaderCommon;
using SimHub.Plugins;
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
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
        private const long MaxUpdateBytes = 5 * 1024 * 1024;
        private const string ReleasePublicKeyXml = "<RSAKeyValue><Modulus>3UZ5n5YfSLd9TVF6tXEMW6NLIq1t9wq3xtx3SZ7peA3ZSf0YRMrauKYau4qJ3zjEooP4Jd390B+7zXiRLMOvXcuZ9RphurFqr4K/8pQPjNfCX+UHG7n1ljw5HBNU6vAjXegALRkMrRqeIlVsM7nFyxEmMhkC6oKfDNfjmk6QLwhvkSdXdjnEF5TW4/dREoNB4zOg8RxrZNEoabait5ddNdqLbHrCIfovoCxpei1AcDgOIcLPAaDvgTixMQgPbb98e8cnINSChj9t8+yWtbW3BM38bHYS5Us4+03JSyVNawjd+8xaOb8Os42tyg9vlLfiTlhYNMpmIMuvqu41/LZd3w==</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
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
        private Task _activeUpdateInstall = Task.FromResult(0);
        private int _pairingBusy;
        private int _updateCheckBusy;
        private int _updateInstallBusy;
        private string _deviceToken = string.Empty;
        private bool _gameWasRunning;
        private string _sessionId;
        private string _status = "Nog niet gestart";
        private string _lastTelemetrySummary = "Nog geen succesvolle telemetryverzending.";
        private string _updateStatus = "Updatecontrole nog niet gestart.";
        private bool _updateAvailable;

        public PluginManager PluginManager { get; set; }
        public ConnectorSettings Settings { get; internal set; }
        private ImageSource _pictureIcon;
        public ImageSource PictureIcon
        {
            get
            {
                if (_pictureIcon == null) _pictureIcon = LoadIconResource("Assets.plugin-icon.png");
                return _pictureIcon;
            }
        }
        public string LeftMenuTitle { get { return "3SM"; } }
        public string InstalledVersion { get { return this.GetType().Assembly.GetName().Version.ToString(); } }
        public string Status { get { return _status; } private set { SetStatus(value); } }
        public string LastTelemetrySummary { get { return _lastTelemetrySummary; } }
        public string UpdateStatus { get { return _updateStatus; } }
        public bool UpdateAvailable { get { return _updateAvailable; } }
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
            var cachedRemoteVersion = string.IsNullOrWhiteSpace(Settings.LastKnownRemoteVersion) ? "nog niet bekend" : Settings.LastKnownRemoteVersion;
            SetUpdateStatus("Geïnstalleerd " + InstalledVersion + " · serverversie " + cachedRemoteVersion);
            SimHub.Logging.Current.Info("3SM Endurance Connector gestart");
            // Veilige, laagfrequente versie-check (max 1x per 24u); faalt stil.
            if (Settings.UseCentralRelay && !Volatile.Read(ref _ending).Equals(1))
            {
                try { Task.Run(async () => await CheckForUpdateAsync(_shutdown.Token, false).ConfigureAwait(false)); }
                catch { /* fire-and-forget; versie-check mag de plugin nooit breken */ }
            }
        }

        public Task CheckForUpdateNowAsync()
        {
            return CheckForUpdateAsync(_shutdown.Token, true);
        }

        public Task InstallAvailableUpdateAsync()
        {
            lock (_sendGate)
            {
                if (Volatile.Read(ref _ending) != 0) return Task.FromResult(0);
                if (Interlocked.CompareExchange(ref _updateInstallBusy, 1, 0) != 0)
                {
                    SetUpdateStatus("Update-installatie loopt al.");
                    return _activeUpdateInstall;
                }
                _activeUpdateInstall = InstallAvailableUpdateCoreAsync();
                return _activeUpdateInstall;
            }
        }

        private async Task InstallAvailableUpdateCoreAsync()
        {
            try
            {
                string versionText;
                string expectedHash;
                long expectedLength;
                string fileName;
                string signature;
                lock (_settingsGate)
                {
                    versionText = Settings.LastKnownRemoteVersion;
                    expectedHash = Settings.LastKnownRemoteSha256;
                    expectedLength = Settings.LastKnownRemoteByteLength;
                    fileName = Settings.LastKnownRemoteFileName;
                    signature = Settings.LastKnownRemoteSignature;
                }

                Version remoteVersion;
                if (!Version.TryParse(versionText, out remoteVersion) || remoteVersion <= this.GetType().Assembly.GetName().Version)
                    throw new InvalidOperationException("Er staat geen nieuwere update klaar.");

                var downloadUri = BuildPluginDownloadUri(remoteVersion);
                var manifest = new VersionResponse
                {
                    Version = versionText,
                    DllUrl = downloadUri.AbsoluteUri,
                    Sha256 = expectedHash,
                    ByteLength = expectedLength,
                    FileName = fileName,
                    Signature = signature,
                };
                if (!ValidateReleaseManifest(manifest, remoteVersion))
                    throw new InvalidDataException("De ondertekende releasemetadata is ongeldig.");
                expectedHash = NormalizeSha256(expectedHash);

                var confirmation = MessageBox.Show(
                    "3SM " + remoteVersion + " wordt gecontroleerd gedownload en geïnstalleerd.\n\n" +
                    "SimHub sluit daarna af en start automatisch opnieuw. Doorgaan?",
                    "3SM-plugin bijwerken",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question);
                if (confirmation != MessageBoxResult.Yes) return;

                SetUpdateStatus("Update " + remoteVersion + " downloaden…");
                var stagingDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "3SM", "EnduranceConnector", "Updates", remoteVersion + "-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(stagingDirectory);
                var stagedDll = Path.Combine(stagingDirectory, "3SM.EnduranceConnector.dll");
                var updaterExe = Path.Combine(stagingDirectory, "3SM.EnduranceConnector.Updater.exe");

                await DownloadUpdateAsync(downloadUri, stagedDll, expectedLength, _shutdown.Token).ConfigureAwait(false);
                if (!FixedTimeEquals(ComputeSha256(stagedDll), expectedHash))
                    throw new InvalidDataException("SHA-256-controle van de update is mislukt.");

                Version payloadVersion;
                if (!Version.TryParse(FileVersionInfo.GetVersionInfo(stagedDll).FileVersion, out payloadVersion) || payloadVersion != remoteVersion)
                    throw new InvalidDataException("De gedownloade DLL heeft niet de aangekondigde versie.");
                if (System.Reflection.AssemblyName.GetAssemblyName(stagedDll).Version != remoteVersion)
                    throw new InvalidDataException("De managed assemblyversie komt niet overeen met de aankondiging.");

                var embeddedUpdaterHash = ExtractUpdater(updaterExe);
                var currentProcess = Process.GetCurrentProcess();
                var simHubPath = currentProcess.MainModule.FileName;
                if (!string.Equals(Path.GetFileName(simHubPath), "SimHubWPF.exe", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Het actieve SimHub-proces kon niet veilig worden vastgesteld.");

                simHubPath = Path.GetFullPath(simHubPath);
                var targetDll = Path.GetFullPath(this.GetType().Assembly.Location);
                var expectedTarget = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(simHubPath), "3SM.EnduranceConnector.dll"));
                if (!string.Equals(targetDll, expectedTarget, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("De geladen plugin staat niet op het verwachte SimHub-pad; gebruik handmatige installatie.");
                var installedHash = ComputeSha256(targetDll);
                var readyEventName = "Local\\3SM.EnduranceConnector.Updater.Ready." + Guid.NewGuid().ToString("N");
                var arguments =
                    "--pid " + QuoteArgument(currentProcess.Id.ToString()) +
                    " --started-utc-ticks " + QuoteArgument(currentProcess.StartTime.ToUniversalTime().Ticks.ToString()) +
                    " --target " + QuoteArgument(targetDll) +
                    " --staged " + QuoteArgument(stagedDll) +
                    " --sha256 " + QuoteArgument(expectedHash) +
                    " --installed-sha256 " + QuoteArgument(installedHash) +
                    " --length " + QuoteArgument(expectedLength.ToString()) +
                    " --version " + QuoteArgument(remoteVersion.ToString()) +
                    " --simhub " + QuoteArgument(simHubPath) +
                    " --ready-event " + QuoteArgument(readyEventName);

                using (var readyEvent = new EventWaitHandle(false, EventResetMode.ManualReset, readyEventName))
                using (var updaterLock = new FileStream(updaterExe, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (!FixedTimeEquals(ComputeSha256(updaterLock), embeddedUpdaterHash))
                        throw new InvalidDataException("De geëxtraheerde updater wijkt af van de embedded helper.");
                    var updaterProcess = Process.Start(new ProcessStartInfo
                    {
                        FileName = updaterExe,
                        Arguments = arguments,
                        WorkingDirectory = stagingDirectory,
                        UseShellExecute = true,
                        Verb = "runas",
                    });
                    if (updaterProcess == null) throw new InvalidOperationException("De externe updater kon niet worden gestart.");
                    if (!readyEvent.WaitOne(TimeSpan.FromSeconds(15)))
                        throw new TimeoutException("De externe updater bevestigde zijn proceshandle niet op tijd.");
                }

                SetUpdateStatus("Updater gestart · SimHub wordt afgesloten en opnieuw gestart.");
                if (PluginManager == null)
                    throw new InvalidOperationException("SimHub PluginManager is niet beschikbaar voor gecontroleerd afsluiten.");
                var application = Application.Current;
                if (application == null || application.Dispatcher == null)
                    throw new InvalidOperationException("SimHub UI-thread is niet beschikbaar voor gecontroleerd afsluiten.");
                _ = application.Dispatcher.BeginInvoke(new Action(() => PluginManager.RequestApplicationExit(false)));
            }
            catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
            {
                SetUpdateStatus("Update geannuleerd door afsluiten van SimHub.");
            }
            catch (Win32Exception error) when (error.NativeErrorCode == 1223)
            {
                SetUpdateStatus("Update geannuleerd bij de Windows-bevestiging.");
            }
            catch (Exception error)
            {
                SetUpdateStatus("Update-installatie mislukt · " + error.Message);
                SimHub.Logging.Current.Error("3SM Endurance: update-installatie mislukt: " + error);
            }
            finally
            {
                Volatile.Write(ref _updateInstallBusy, 0);
            }
        }

        private async Task CheckForUpdateAsync(CancellationToken cancellationToken, bool force)
        {
            if (Interlocked.CompareExchange(ref _updateCheckBusy, 1, 0) != 0)
            {
                if (force) SetUpdateStatus("Updatecontrole loopt al.");
                return;
            }
            try
            {
                // De automatische check gebruikt maximaal 1x per 24 uur; de UI-knop mag bewust forceren.
                DateTime? lastCheck;
                lock (_settingsGate) lastCheck = Settings.LastVersionCheckUtc;
                if (!force && lastCheck.HasValue && DateTime.UtcNow - lastCheck.Value < TimeSpan.FromHours(24)) return;
                if (force) SetUpdateStatus("Controleren op updates…");

                var localVersion = this.GetType().Assembly.GetName().Version;
                var endpoint = BuildRelayEndpoint("simhub-version");
                using (var request = new HttpRequestMessage(HttpMethod.Get, endpoint))
                using (var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw new HttpRequestException("versie-endpoint HTTP " + (int)response.StatusCode);
                    var body = await ReadBoundedResponseAsync(response.Content, 8192, cancellationToken).ConfigureAwait(false);
                    var info = Deserialize<VersionResponse>(body);
                    if (info == null || string.IsNullOrWhiteSpace(info.Version)) throw new HttpRequestException("versie-endpoint gaf geen versie terug");
                    var remote = Version.TryParse(info.Version.Trim(), out var parsed) ? parsed : null;
                    if (remote == null) throw new HttpRequestException("serverversie is ongeldig: " + info.Version.Trim());
                    var metadataValid = ValidateReleaseManifest(info, remote);
                    lock (_settingsGate)
                    {
                        Settings.LastKnownRemoteVersion = info.Version.Trim();
                        Settings.LastKnownRemoteDllUrl = metadataValid ? BuildPluginDownloadUri(remote).AbsoluteUri : string.Empty;
                        Settings.LastKnownRemoteSha256 = metadataValid ? NormalizeSha256(info.Sha256) : string.Empty;
                        Settings.LastKnownRemoteByteLength = metadataValid ? info.ByteLength : 0;
                        Settings.LastKnownRemoteFileName = metadataValid ? info.FileName.Trim() : string.Empty;
                        Settings.LastKnownRemoteSignature = metadataValid ? info.Signature.Trim() : string.Empty;
                        Settings.LastVersionCheckUtc = DateTime.UtcNow;
                        this.SaveCommonSettings("ConnectorSettings", Settings);
                    }
                    if (remote > localVersion)
                    {
                        SetUpdateAvailable(metadataValid);
                        SetUpdateStatus(metadataValid
                            ? "Nieuwe versie " + remote + " beschikbaar · klaar voor éénklik-installatie."
                            : "Nieuwe versie " + remote + " beschikbaar, maar veilige installatiemetadata ontbreekt.");
                        if (Volatile.Read(ref _ending) == 0) Status = metadataValid
                            ? "Nieuwe versie beschikbaar · klaar voor installatie"
                            : "Nieuwe versie beschikbaar · metadata ongeldig";
                    }
                    else
                    {
                        SetUpdateAvailable(false);
                        SetUpdateStatus("Actueel · geïnstalleerd " + localVersion + " · server " + remote + " · gecontroleerd " + DateTime.Now.ToString("HH:mm:ss"));
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Normale shutdown; versie-check wordt gestaakt.
            }
            catch (Exception error)
            {
                if (force) SetUpdateStatus("Updatecontrole mislukt · " + error.Message);
                SimHub.Logging.Current.Warn("3SM Endurance: versie-check mislukt (niet-blokkerend): " + error.Message);
            }
            finally
            {
                Volatile.Write(ref _updateCheckBusy, 0);
            }
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            try
            {
                if (Volatile.Read(ref _ending) != 0) return;
                var isIRacing = string.Equals(data.GameName, "IRacing", StringComparison.OrdinalIgnoreCase);
                var running = isIRacing && data.GameRunning;
                var isInCar = running && data.NewData != null && !data.NewData.Spectating && !data.GameInMenu && !data.GameReplay;
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
                    envelope = Capture(pluginManager, data, central, isInCar);
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
            Task activeUpdateInstall;
            lock (_sendGate)
            {
                Interlocked.Exchange(ref _ending, 1);
                _shutdown.Cancel();
                activeSend = _activeSend;
                activePairing = _activePairing;
                activeUpdateInstall = _activeUpdateInstall;
            }
            try { Task.WaitAll(new[] { activeSend, activePairing, activeUpdateInstall }, TimeSpan.FromSeconds(5)); } catch { }
            lock (_settingsGate)
            {
                this.SaveCommonSettings("ConnectorSettings", Settings);
                _deviceToken = string.Empty;
            }
            if (activeSend.IsCompleted && activePairing.IsCompleted && activeUpdateInstall.IsCompleted)
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

        private TelemetryEnvelope Capture(PluginManager manager, GameData data, bool central, bool isInCar)
        {
            var fuel = Math.Max(0, GetDouble(manager, Settings.FuelProperty, 0));
            var fuelPerLap = GetNullableDouble(manager, Settings.FuelPerLapProperty, true);
            var estimatedLaps = GetNullableDouble(manager, Settings.EstimatedLapsProperty, false);
            if (!estimatedLaps.HasValue && fuelPerLap.HasValue && fuelPerLap.Value > 0) estimatedLaps = fuel / fuelPerLap.Value;
            var snapshot = data.NewData;
            var player = snapshot.Opponents == null ? null : snapshot.Opponents.FirstOrDefault(opponent => opponent != null && opponent.IsPlayer);
            var currentDriverId = FirstNonEmpty(player == null ? null : player.Id, GetNullableString(manager, Settings.CurrentDriverIdProperty));
            var currentDriverName = FirstNonEmpty(snapshot.PlayerName, player == null ? null : player.Name, GetNullableString(manager, Settings.CurrentDriverNameProperty));
            var carId = FirstNonEmpty(snapshot.CarId, GetNullableString(manager, Settings.CarIdProperty));
            var carName = FirstNonEmpty(snapshot.CarModel, player == null ? null : player.CarName, GetNullableString(manager, Settings.CarNameProperty));
            var trackName = FirstNonEmpty(snapshot.TrackName, GetNullableString(manager, Settings.TrackNameProperty));
            var trackConfig = FirstNonEmpty(snapshot.TrackConfig, GetNullableString(manager, Settings.TrackConfigProperty));
            var position = PositiveOrNull(snapshot.Position) ?? PositiveOrNull(GetInt(manager, Settings.PositionProperty, 0));
            var classPosition = PositiveOrNull(player == null ? 0 : player.PositionInClass) ?? PositiveOrNull(GetInt(manager, Settings.ClassPositionProperty, 0));
            var flag = ResolveFlag(snapshot, GetRaw(manager, Settings.FlagProperty));
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
                    CurrentDriverId = currentDriverId,
                    CurrentDriverName = currentDriverName,
                    CarId = carId,
                    CarName = carName,
                    TrackName = trackName,
                    TrackConfig = trackConfig,
                },
                Telemetry = new TelemetryValues
                {
                    Connected = true,
                    SessionTimeSeconds = Math.Max(0, GetDouble(manager, Settings.SessionTimeProperty, 0)),
                    Lap = Math.Max(0, GetInt(manager, Settings.LapProperty, 0)),
                    CompletedLaps = Math.Max(0, GetInt(manager, Settings.CompletedLapsProperty, 0)),
                    LapTimeSeconds = GetNullableSeconds(manager, Settings.LapTimeProperty),
                    Position = position,
                    ClassPosition = classPosition,
                    SpeedKph = Clamp(GetDouble(manager, Settings.SpeedProperty, 0), 0, 500),
                    FuelLitres = Clamp(fuel, 0, 250),
                    FuelPerLapLitres = fuelPerLap,
                    EstimatedLapsRemaining = estimatedLaps,
                    InPitLane = GetBool(manager, Settings.PitLaneProperty, false),
                    PitLimiter = GetBool(manager, Settings.PitLimiterProperty, false),
                    StintElapsedSeconds = _stintClock.Elapsed.TotalSeconds,
                    Incidents = NonNegativeOrNull(GetNullableInt(manager, Settings.IncidentsProperty)),
                    Flag = flag,
                    IsInCar = isInCar,
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
                SetLastTelemetrySummary(envelope);
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
                    if (output.Length + read > maxBytes) throw new HttpRequestException("response is te groot");
                    output.Write(buffer, 0, read);
                }
                return Encoding.UTF8.GetString(output.ToArray());
            }
        }

        private static async Task DownloadUpdateAsync(Uri downloadUri, string destination, long expectedBytes, CancellationToken cancellationToken)
        {
            if (expectedBytes <= 0 || expectedBytes > MaxUpdateBytes) throw new InvalidDataException("Ongeldige aangekondigde bestandsgrootte.");
            try
            {
                using (var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(45) })
                using (var request = new HttpRequestMessage(HttpMethod.Get, downloadUri))
                using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw new HttpRequestException("download HTTP " + (int)response.StatusCode);
                    if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != expectedBytes)
                        throw new HttpRequestException("bestandsgrootte wijkt af van het ondertekende manifest");

                    using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        var buffer = new byte[81920];
                        long total = 0;
                        while (true)
                        {
                            var read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false);
                            if (read == 0) break;
                            total += read;
                            if (total > expectedBytes) throw new HttpRequestException("updatebestand is groter dan aangekondigd");
                            await output.WriteAsync(buffer, 0, read, cancellationToken).ConfigureAwait(false);
                        }
                        if (total != expectedBytes) throw new HttpRequestException("updatebestand heeft niet de aangekondigde grootte");
                        await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                        output.Flush(true);
                    }
                }
            }
            catch
            {
                try { if (File.Exists(destination)) File.Delete(destination); } catch { }
                throw;
            }
        }

        private static Uri BuildPluginDownloadUri(Version version)
        {
            if (version == null) throw new ArgumentNullException("version");
            return new Uri("https://3stripemotorsport.cc/downloads/3SM.EnduranceConnector-" + version + ".dll", UriKind.Absolute);
        }

        private static bool ValidateReleaseManifest(VersionResponse info, Version version)
        {
            if (info == null || version == null || !IsSha256(info.Sha256)) return false;
            if (!string.Equals(info.Version, version.ToString(), StringComparison.Ordinal)) return false;
            if (!string.Equals(info.Sha256, info.Sha256.ToLowerInvariant(), StringComparison.Ordinal)) return false;
            if (info.ByteLength <= 0 || info.ByteLength > MaxUpdateBytes) return false;
            var expectedFileName = "3SM.EnduranceConnector-" + version + ".dll";
            if (!string.Equals(info.FileName, expectedFileName, StringComparison.Ordinal)) return false;
            var expectedUri = BuildPluginDownloadUri(version);
            Uri announcedUri;
            if (!Uri.TryCreate(info.DllUrl, UriKind.Absolute, out announcedUri) || !IsAllowedPluginDownload(announcedUri, version)) return false;
            if (!string.Equals(announcedUri.AbsoluteUri, expectedUri.AbsoluteUri, StringComparison.Ordinal)) return false;
            byte[] signature;
            if (string.IsNullOrWhiteSpace(info.Signature) || info.Signature != info.Signature.Trim()) return false;
            try { signature = Convert.FromBase64String(info.Signature); }
            catch (FormatException) { return false; }
            if (signature.Length == 0) return false;
            var payload = BuildManifestPayload(version.ToString(), expectedUri.AbsoluteUri, NormalizeSha256(info.Sha256), info.ByteLength, expectedFileName);
            try
            {
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(ReleasePublicKeyXml);
                    return rsa.VerifyData(Encoding.UTF8.GetBytes(payload), CryptoConfig.MapNameToOID("SHA256"), signature);
                }
            }
            catch (CryptographicException) { return false; }
        }

        private static string BuildManifestPayload(string version, string dllUrl, string sha256, long byteLength, string fileName)
        {
            return version + "\n" + dllUrl + "\n" + sha256 + "\n" + byteLength.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\n" + fileName;
        }

        private static bool IsAllowedPluginDownload(Uri uri, Version version)
        {
            if (uri == null || version == null || !uri.IsAbsoluteUri) return false;
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
            if (!string.Equals(uri.Host, "3stripemotorsport.cc", StringComparison.OrdinalIgnoreCase)) return false;
            if (!uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
            var expectedPath = "/downloads/3SM.EnduranceConnector-" + version + ".dll";
            return string.Equals(uri.AbsolutePath, expectedPath, StringComparison.Ordinal);
        }

        private static bool IsSha256(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim().Length != 64) return false;
            foreach (var character in value.Trim())
            {
                var hexadecimal = (character >= '0' && character <= '9') ||
                                  (character >= 'a' && character <= 'f') ||
                                  (character >= 'A' && character <= 'F');
                if (!hexadecimal) return false;
            }
            return true;
        }

        private static string NormalizeSha256(string value)
        {
            if (!IsSha256(value)) throw new InvalidDataException("De update-SHA-256 is ongeldig.");
            return value.Trim().ToLowerInvariant();
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                return ComputeSha256(stream);
            }
        }

        private static string ComputeSha256(Stream stream)
        {
            if (stream == null) throw new ArgumentNullException("stream");
            if (stream.CanSeek) stream.Position = 0;
            using (var algorithm = SHA256.Create()) return ToLowerHex(algorithm.ComputeHash(stream));
        }

        private static string ToLowerHex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (var item in bytes) builder.Append(item.ToString("x2"));
            return builder.ToString();
        }

        private static bool FixedTimeEquals(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            var difference = 0;
            for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }

        private static string ExtractUpdater(string destination)
        {
            const string resourceName = "ThreeSM.EnduranceConnector.Assets.3SM.EnduranceConnector.Updater.exe";
            using (var input = typeof(EnduranceConnectorPlugin).Assembly.GetManifestResourceStream(resourceName))
            {
                if (input == null) throw new InvalidOperationException("De embedded 3SM-updater ontbreekt.");
                using (var algorithm = SHA256.Create())
                using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    var buffer = new byte[81920];
                    int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        algorithm.TransformBlock(buffer, 0, read, buffer, 0);
                    }
                    algorithm.TransformFinalBlock(new byte[0], 0, 0);
                    output.Flush(true);
                    return ToLowerHex(algorithm.Hash);
                }
            }
        }

        private static string QuoteArgument(string value)
        {
            value = value ?? string.Empty;
            if (value.IndexOf('\"') >= 0) throw new ArgumentException("Ongeldig aanhalingsteken in updaterargument.");
            return "\"" + value + "\"";
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

        // Laad een embedded PNG als WPF-beeldbron (wordt gebruikt voor icon + branding).
        internal static ImageSource LoadImageResource(string resourceName)
        {
            try
            {
                var assembly = typeof(EnduranceConnectorPlugin).Assembly;
                var qualifiedName = resourceName.StartsWith(typeof(EnduranceConnectorPlugin).Namespace + ".", StringComparison.Ordinal)
                    ? resourceName
                    : typeof(EnduranceConnectorPlugin).Namespace + "." + resourceName;
                using (var stream = assembly.GetManifestResourceStream(qualifiedName))
                {
                    if (stream == null) return null;
                    var decoder = new System.Windows.Media.Imaging.PngBitmapDecoder(stream, System.Windows.Media.Imaging.BitmapCreateOptions.None, System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);
                    return decoder.Frames[0];
                }
            }
            catch { return null; }
        }
        private static ImageSource LoadIconResource(string resourceName) { return LoadImageResource(resourceName); }
        private static string FirstNonEmpty(params string[] values)
        {
            if (values == null) return null;
            foreach (var value in values)
                if (!string.IsNullOrWhiteSpace(value) && !string.Equals(value.Trim(), "unknown", StringComparison.OrdinalIgnoreCase)) return value.Trim();
            return null;
        }

        private static string ResolveFlag(StatusDataBase snapshot, object fallback)
        {
            var normalized = NormalizeFlag(snapshot == null ? null : snapshot.Flag_Name);
            if (normalized != "unknown") return normalized;
            if (snapshot != null)
            {
                if (snapshot.Flag_Checkered != 0) return "checkered";
                if (snapshot.Flag_Yellow != 0) return "yellow";
                if (snapshot.Flag_White != 0) return "white";
                if (snapshot.Flag_Green != 0) return "green";
            }
            return NormalizeFlag(fallback);
        }

        private static string NormalizeFlag(object value)
        {
            var text = value == null ? "unknown" : value.ToString().ToLowerInvariant();
            if (text.Contains("checkered") || text.Contains("chequered")) return "checkered";
            foreach (var flag in new[] { "green", "yellow", "red", "white" }) if (text.Contains(flag)) return flag;
            return "unknown";
        }
        private static string DisplayText(string value) { return string.IsNullOrWhiteSpace(value) ? "Onbekend" : value.Trim(); }
        private static string DisplayNumber(double? value, string suffix) { return value.HasValue ? value.Value.ToString("0.0") + suffix : "Onbekend"; }
        private static string DisplayPosition(int? value) { return value.HasValue ? value.Value.ToString() : "Onbekend"; }

        private void SetLastTelemetrySummary(TelemetryEnvelope envelope)
        {
            if (envelope == null || envelope.Telemetry == null || envelope.Race == null || Volatile.Read(ref _ending) != 0) return;
            var application = Application.Current;
            if (application != null && !application.Dispatcher.CheckAccess())
            {
                try { application.Dispatcher.BeginInvoke(new Action(() => SetLastTelemetrySummary(envelope))); } catch (InvalidOperationException) { }
                return;
            }
            var telemetry = envelope.Telemetry;
            var race = envelope.Race;
            _lastTelemetrySummary =
                "Laatste succesvolle verzending: " + DateTime.Now.ToString("HH:mm:ss") + "\n" +
                "Sequence: " + envelope.Sequence + " · In auto: " + (telemetry.IsInCar ? "JA" : "NEE") + "\n" +
                "Coureur: " + DisplayText(race.CurrentDriverName) + "\n" +
                "Auto: " + DisplayText(race.CarName) + "\n" +
                "Circuit: " + DisplayText(race.TrackName) + (string.IsNullOrWhiteSpace(race.TrackConfig) ? string.Empty : " · " + race.TrackConfig.Trim()) + "\n" +
                "Ronde: " + telemetry.Lap + " · voltooid: " + telemetry.CompletedLaps + " · rondetijd: " + DisplayNumber(telemetry.LapTimeSeconds, " s") + "\n" +
                "Positie: " + DisplayPosition(telemetry.Position) + " · klasse: " + DisplayPosition(telemetry.ClassPosition) + "\n" +
                "Snelheid: " + telemetry.SpeedKph.ToString("0") + " km/u · brandstof: " + telemetry.FuelLitres.ToString("0.0") + " L\n" +
                "Pitlane: " + (telemetry.InPitLane ? "JA" : "NEE") + " · limiter: " + (telemetry.PitLimiter ? "AAN" : "UIT") + " · vlag: " + DisplayText(telemetry.Flag);
            OnPropertyChanged("LastTelemetrySummary");
        }

        private void SetUpdateAvailable(bool value)
        {
            if (Volatile.Read(ref _ending) != 0) return;
            var application = Application.Current;
            if (application != null && !application.Dispatcher.CheckAccess())
            {
                try { application.Dispatcher.BeginInvoke(new Action(() => SetUpdateAvailable(value))); } catch (InvalidOperationException) { }
                return;
            }
            if (_updateAvailable == value) return;
            _updateAvailable = value;
            OnPropertyChanged("UpdateAvailable");
        }

        private void SetUpdateStatus(string value)
        {
            if (Volatile.Read(ref _ending) != 0) return;
            var application = Application.Current;
            if (application != null && !application.Dispatcher.CheckAccess())
            {
                try { application.Dispatcher.BeginInvoke(new Action(() => SetUpdateStatus(value))); } catch (InvalidOperationException) { }
                return;
            }
            if (_updateStatus == value) return;
            _updateStatus = value;
            OnPropertyChanged("UpdateStatus");
        }

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
