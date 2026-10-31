using GameReaderCommon;
using SimHub.Plugins;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
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
        private const string V3IngestFunction = "simhub-ingest-v3";
        // Release channel for the version check. TEST/canary builds append "?channel=canary"
        // so designated testers receive TEST manifest releases; STABLE builds leave this
        // empty (plain GET, stable manifest). Set per release branch — never user-facing.
        private const string ReleaseChannelQuery = "";
        // 0.4.1: hard cap on opponents per snapshot (bounded payload; proven grid headroom).
        private const int MaxOpponentsPerSnapshot = 40;
        // 0.7.0: harde payloadgrens voor één frame. Het bandenblok duwt een vol veld richting
        // de 24.576-grens van de relay, dus boven deze drempel snoeien we in vaste volgorde
        // (zie SerializeWithinBudget). Server en plugin delen dezelfde marge.
        private const int MaxPayloadBytes = 24000;
        private const long MaxUpdateBytes = 5 * 1024 * 1024;
        private const string ReleasePublicKeyXml = "<RSAKeyValue><Modulus>623ziGDiaH7x+n1WwVv4lp+CswGiM4b/+h410wt1IBXZc+xeIoJbS2GnSU+wCgsUD1Ek4Eup0XKumuyuEvkZYUJ7zzLuIV5qBj9jk1lSnZmp4ibMyanmhJOIxsuSzylpNV9ru2QAuJQLpK9Jahk8vbOjSaNaaO1ZxKP0U0Xxy79N/9vutjdO6dW9r2MzQUP5KNGCTBlgHwm5Kn3KujtyV3EB5jeFbwl0L1G5R2taan6wzrcSLtNKrJACbm/bLvOijAvUAjpVH7+ThUPY/w9womXuxtWCPFT0cp7wq9rBieOEFjWxFLSkr9uZ/Z+gWyuBINrGJ7gLGuONvNq3TbqkwRmnPu91hstTQR5EfLDduohdfsRW6g+BHUNgZFo9cheM/NpJx6vpZ61Rzjw46Bu8QVCInRW7W43u4e/Xb9CjlPEf6ou8jnEeUY9ZgDOKhs7oHbDg3072GIPTc/8HJjATN6YlnTU0tqB43zElN2BrWc/aFqqTdrXce9vEEqPclWVT</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
        private readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(4) };
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly object _sendGate = new object();
        private readonly object _settingsGate = new object();
        private readonly Stopwatch _sendClock = Stopwatch.StartNew();
        private readonly Stopwatch _stintClock = new Stopwatch();
        private readonly SessionTelemetryReader _sessionTime = new SessionTelemetryReader();
        // 0.7.0: onthoudt de laatst gezien wear/karkas en bevriest die op de pit-entry-flank.
        private readonly TyreSnapshotTracker _tyreTracker = new TyreSnapshotTracker();
        private long _sequence = -1;
        private long _lastQueuedMilliseconds;
        private int _sendBusy;
        private int _ending;
        private Task _activeSend = Task.FromResult(0);
        private Task<bool> _activePairing = Task.FromResult(false);
        private int _pairingBusy;
        private int _updateCheckBusy;
        private int _updateInstallBusy;
        private int _updateStageBusy;
        private long _lastGameSeenUtcTicks;
        private long _lastAutoApplyCheckUnixMs;
        private long _autoApplyBlockedUntilUtcTicks;
        private string _deviceToken = string.Empty;
        private bool _gameWasRunning;
        private string _sessionId;
        private string _status = "Nog niet gestart";
        private string _lastTelemetrySummary = "Nog geen succesvolle telemetryverzending.";
        private string _updateStatus = "Updatecontrole nog niet gestart.";
        private bool _updateAvailable;
        private UpdaterStateStore _updaterStateStore;
        private UpdaterState _updaterState;
        private readonly object _diagnosticsGate = new object();
        private DiagnosticsClient _diagnostics;
        private OverlayPropertyPublisher _overlayPublisher;
        private OverlayClient _overlayClient;
        // Laatst opgeloste vlaggen (wire-namen) voor session.flags. Alleen gebruikt om
        // wijzigingen te loggen; de payload wordt per tick opnieuw bepaald.
        private string[] _lastFlagNames;
        // 0.7.1: hek voor het bandenblok (wijziging of één keer per interval).
        private readonly TyrePublishGate _tyreGate = new TyrePublishGate();
        // 0.7.2.0: directe lezer van de iRacing-shared-memory, read-only. Lazy: zonder
        // iRacing bestaat de map niet en blijft elke waarde null; de plugin werkt door.
        private IrSdkMemoryReader _irSdk;
        private long _pitLimiterSinceMs;
        // Meetlaag (0.7.2.0). Vier velden, één keer gevuld in Init. Blijft het geheel null
        // (bijvoorbeeld omdat de map niet beschrijfbaar is), dan loopt de gewone telemetrie
        // gewoon door: meten is een toevoeging, geen voorwaarde.
        private MeasurementOutbox _measurementOutbox;
        private MeasurementPipeline _measurementPipeline;
        private MeasurementSender _measurementSender;
        private ConnectorControlClient _controlClient;

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
        public string InstalledVersion { get { return LocalVersion.ToString(); } }
        // De geladen assemblyversie: het ijkpunt voor de updatevergelijking.
        private Version LocalVersion { get { return GetType().Assembly.GetName().Version; } }
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
            if (Settings.SchemaVersion < 4)
            {
                if (Settings.SchemaVersion < 2) Settings.UseCentralRelay = false;
                if (Settings.SchemaVersion < 4) Settings.DiagnosticsEnabled = true;
                Settings.SchemaVersion = 4;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            if (Settings.SchemaVersion < 8)
            {
                // 0.7.2.0: de vlaggenmodule (panelen, presets, LED-boxen) en de research-opname
                // zijn vervallen. De oude trappen 5, 6 en 7 pasten alleen instellingen aan
                // die niet meer bestaan; het schemanummer gaat daarom in één keer naar 8.
                // Een bestaande configuratie houdt alles wat er nog toe doet.
                Settings.SchemaVersion = 8;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            InitUpdaterStateStore();
            _deviceToken = UnprotectToken(Settings.DeviceTokenProtected);

            // Overlay: properties publiceren en het Dash Studio-template installeren.
            _overlayPublisher = new OverlayPropertyPublisher(pluginManager, GetType(), "THREESM.Overlay");
            var overlayPropertiesRegistered = _overlayPublisher.Register();
            SimHub.Logging.Current.Info("3SM overlay: properties=" + overlayPropertiesRegistered);
            InstallOverlayTemplate(pluginManager);
            try
            {
                _overlayClient = new OverlayClient(
                    BuildRelayEndpoint("simhub-overlay"),
                    Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "3SM", "endurance-overlay.json"));
                _overlayClient.SetToken(_deviceToken);
            }
            catch (Exception overlayError)
            {
                _overlayClient = null;
                SimHub.Logging.Current.Warn("3SM overlay: client kon niet worden gestart: " + overlayError.Message);
            }
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
            ApplyDiagnosticsSettings();
            _sessionId = "simhub-" + Guid.NewGuid().ToString("N");
            _tyreTracker.Reset();
            _tyreGate.Reset();
            _irSdk = new IrSdkMemoryReader();
            InitMeasurementLayer();
            // Handshake met de server: beleid, geen voorwaarde. Lukt het niet, dan blijft het
            // vaste V3-profiel gelden en merkt de rest van de plugin er niets van.
            RefreshControlPolicy();
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
            // Auto-update (startmoment): staat er al een gedownloade update klaar, dan
            // passen we die kort na het opstarten toe — nooit tijdens een game en met
            // een herstart-budget van 24 uur.
            try
            {
                Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(15), _shutdown.Token).ConfigureAwait(false);
                        TryAutoApplyUpdate(false, true);
                    }
                    catch (OperationCanceledException) { }
                    catch (Exception ex) { try { SimHub.Logging.Current.Warn("3SM Endurance: auto-update bij starten mislukt: " + ex.Message); } catch { } }
                });
            }
            catch { }
        }

        public Task CheckForUpdateNowAsync()
        {
            return CheckForUpdateAsync(_shutdown.Token, true);
        }

        public async Task InstallAvailableUpdateAsync()
        {
            if (Interlocked.CompareExchange(ref _updateInstallBusy, 1, 0) != 0)
            {
                SetUpdateStatus("Update-installatie loopt al.");
                return;
            }

            try
            {
                string versionText;
                string expectedHash;
                long expectedLength;
                string expectedFileName;
                string expectedSignature;
                lock (_settingsGate)
                {
                    versionText = Settings.LastKnownRemoteVersion;
                    expectedHash = Settings.LastKnownRemoteSha256;
                    expectedLength = Settings.LastKnownRemoteByteLength;
                    expectedFileName = Settings.LastKnownRemoteFileName;
                    expectedSignature = Settings.LastKnownRemoteSignature;
                }

                // Zelfde regel als altijd (UpdateVersionPolicy): leesbaar én strikt nieuwer.
                Version remoteVersion;
                if (!UpdateVersionPolicy.TryParseNewer(versionText, LocalVersion, out remoteVersion))
                    throw new InvalidOperationException("Er staat geen nieuwere update klaar.");

                // RSA-verificatie van de opgeslagen releasemetadata vóór enige download/staging.
                expectedHash = NormalizeSha256(expectedHash);
                var downloadUri = BuildPluginDownloadUri(remoteVersion);
                var manifest = new VersionResponse
                {
                    Version = versionText,
                    DllUrl = downloadUri.AbsoluteUri,
                    Sha256 = expectedHash,
                    ByteLength = expectedLength,
                    FileName = expectedFileName,
                    Signature = expectedSignature,
                };
                if (!ValidateReleaseManifest(manifest, remoteVersion))
                    throw new InvalidDataException("De ondertekende releasemetadata is ongeldig.");

                var confirmation = MessageBox.Show(
                    "3SM " + remoteVersion + " wordt gecontroleerd gedownload en geïnstalleerd.\n\n" +
                    "SimHub sluit daarna af en start automatisch opnieuw. Doorgaan?",
                    "3SM-plugin bijwerken",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question);
                if (confirmation != MessageBoxResult.Yes) return;

                var stagedDll = await StageUpdateAsync(remoteVersion).ConfigureAwait(true);

                string launchMessage;
                Exception launchFailure;
                if (!LaunchUpdaterAndExit(remoteVersion, stagedDll, out launchMessage, out launchFailure))
                {
                    // Originele fout opnieuw gooien: de catch-blokken hieronder regelen de
                    // UAC-annulering en de annulering bij afsluiten exact zoals voorheen.
                    if (launchFailure != null) throw launchFailure;
                    throw new InvalidOperationException(launchMessage);
                }

                SetUpdateStatus("Updater gestart · SimHub wordt afgesloten en opnieuw gestart.");
            }
            catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
            {
                SetUpdaterState(new UpdaterState { state = "IDLE" });
                SetUpdateStatus("Update geannuleerd door afsluiten van SimHub.");
            }
            catch (Win32Exception error) when (error.NativeErrorCode == 1223)
            {
                SetUpdaterState(new UpdaterState { state = "FAILED", lastUpdateErrorCode = "UPDATE_UAC_CANCELLED" });
                SetUpdateStatus("Update geannuleerd bij de Windows-bevestiging.");
            }
            catch (Exception error)
            {
                SetUpdaterState(new UpdaterState { state = "FAILED", lastUpdateErrorCode = "UPDATE_INSTALL_FAILED", lastUpdateResult = "failure:install" });
                SetUpdateStatus("Update-installatie mislukt · " + error.Message);
                SimHub.Logging.Current.Error("3SM Endurance: update-installatie mislukt: " + error);
            }
            finally
            {
                Volatile.Write(ref _updateInstallBusy, 0);
            }
        }

        // Start de externe updater (elevated) met de ready-handshake en sluit SimHub zodat
        // de DLL vervangen kan worden. Herbruikt door de handmatige én de automatische route.
        // Bij een mislukking geeft failure de originele fout terug, zodat de handmatige route
        // zijn bestaande UAC- en annuleringsafhandeling houdt.
        private bool LaunchUpdaterAndExit(Version remoteVersion, string stagedDll, out string message, out Exception failure)
        {
            message = null;
            failure = null;
            string expectedHash, expectedSignature; long expectedLength;
            lock (_settingsGate)
            {
                expectedHash = NormalizeSha256(Settings.LastKnownRemoteSha256);
                expectedLength = Settings.LastKnownRemoteByteLength;
                expectedSignature = Settings.LastKnownRemoteSignature;
            }
            try
            {
                var stagingDirectory = Path.GetDirectoryName(stagedDll);
                var updaterExe = Path.Combine(stagingDirectory, "3SM.EnduranceConnector.Updater.exe");
                ExtractUpdater(updaterExe);
                var currentProcess = Process.GetCurrentProcess();
                var simHubPath = Path.GetFullPath(currentProcess.MainModule.FileName);
                if (!string.Equals(Path.GetFileName(simHubPath), "SimHubWPF.exe", StringComparison.OrdinalIgnoreCase))
                { message = "Het actieve SimHub-proces kon niet veilig worden vastgesteld."; return false; }

                var targetDll = Path.GetFullPath(this.GetType().Assembly.Location);
                var expectedTarget = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(simHubPath), "3SM.EnduranceConnector.dll"));
                if (!string.Equals(targetDll, expectedTarget, StringComparison.OrdinalIgnoreCase))
                { message = "De geladen plugin staat niet op het verwachte SimHub-pad; gebruik handmatige installatie."; return false; }
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

                // Houd de geëxtraheerde helper vast (read-share houdt write/delete-lock af) zodat
                // niemand de helper tussentijds kan vervangen, via dezelfde ready-before-shutdown
                // handshake als de geharde updater verwacht.
                using (var updaterLock = new FileStream(updaterExe, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var readyEvent = new System.Threading.EventWaitHandle(false, EventResetMode.ManualReset, readyEventName))
                {
                    var updaterProcess = Process.Start(new ProcessStartInfo
                    {
                        FileName = updaterExe,
                        Arguments = arguments,
                        WorkingDirectory = stagingDirectory,
                        UseShellExecute = true,
                        Verb = "runas",
                    });
                    if (updaterProcess == null) { message = "De externe updater kon niet worden gestart."; return false; }
                    if (!readyEvent.WaitOne(TimeSpan.FromSeconds(15)))
                    { message = "De externe updater bevestigde zijn proceshandle niet op tijd."; return false; }
                }

                if (Application.Current != null && Application.Current.MainWindow != null)
                {
                    _ = Application.Current.Dispatcher.BeginInvoke(new Action(() => Application.Current.MainWindow.Close()));
                }
                return true;
            }
            catch (Exception ex)
            {
                failure = ex;
                message = (ex.InnerException ?? ex).Message;
                return false;
            }
        }

        // Download + verifieer de update naar de staging-map (geen installatie).
        // Gooit een exception met een leesbare melding wanneer iets niet klopt.
        // Het stage-slot zit hier (niet bij de aanroeper), zodat de achtergrond-download
        // en de handmatige knop nooit tegelijk hetzelfde bestand schrijven.
        private async Task<string> StageUpdateAsync(Version remoteVersion)
        {
            if (Interlocked.CompareExchange(ref _updateStageBusy, 1, 0) != 0)
                throw new UpdateStageBusyException();
            try
            {
                return await StageUpdateCoreAsync(remoteVersion).ConfigureAwait(false);
            }
            finally { Volatile.Write(ref _updateStageBusy, 0); }
        }

        private async Task<string> StageUpdateCoreAsync(Version remoteVersion)
        {
            string expectedHash, expectedFileName, expectedSignature; long expectedLength;
            lock (_settingsGate)
            {
                expectedHash = Settings.LastKnownRemoteSha256;
                expectedLength = Settings.LastKnownRemoteByteLength;
                expectedFileName = Settings.LastKnownRemoteFileName;
                expectedSignature = Settings.LastKnownRemoteSignature;
            }
            expectedHash = NormalizeSha256(expectedHash);
            var downloadUri = BuildPluginDownloadUri(remoteVersion);
            var manifest = new VersionResponse
            {
                Version = remoteVersion.ToString(),
                DllUrl = downloadUri.AbsoluteUri,
                Sha256 = expectedHash,
                ByteLength = expectedLength,
                FileName = expectedFileName,
                Signature = expectedSignature,
            };
            if (!ValidateReleaseManifest(manifest, remoteVersion))
                throw new InvalidDataException("De ondertekende releasemetadata is ongeldig.");

            SetUpdateStatus("Update " + remoteVersion + " downloaden…");
            var stagingDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "3SM", "EnduranceConnector", "Updates", remoteVersion.ToString());
            Directory.CreateDirectory(stagingDirectory);
            var file = Path.Combine(stagingDirectory, "3SM.EnduranceConnector.dll");

            // FSM: download bezig.
            SetUpdaterState(new UpdaterState { state = "DOWNLOADING", pendingUpdateVersion = remoteVersion.ToString(), pendingStagedDll = file });

            var downloadCap = expectedLength > 0 && expectedLength <= int.MaxValue ? (int)expectedLength : 5 * 1024 * 1024;
            await DownloadUpdateAsync(downloadUri, file, downloadCap, _shutdown.Token).ConfigureAwait(false);
            if (!FixedTimeEquals(ComputeSha256(file), expectedHash))
                throw new InvalidDataException("SHA-256-controle van de update is mislukt.");

            Version payloadVersion;
            if (!Version.TryParse(FileVersionInfo.GetVersionInfo(file).FileVersion, out payloadVersion) || payloadVersion != remoteVersion)
                throw new InvalidDataException("De gedownloade DLL heeft niet de aangekondigde versie.");
            if (System.Reflection.AssemblyName.GetAssemblyName(file).Version != remoteVersion)
                throw new InvalidDataException("De managed assemblyversie komt niet overeen met de aangekondigde versie.");

            // FSM: download verify OK -> STAGED.
            SetUpdaterState(new UpdaterState { state = "STAGED", pendingUpdateVersion = remoteVersion.ToString(), pendingStagedDll = file });
            return file;
        }

        private bool AutoUpdateOn()
        {
            lock (_settingsGate) return Settings != null && Settings.AutoUpdateEnabled;
        }

        private bool TryGetPendingRemoteVersion(out Version remote)
        {
            remote = null;
            string text;
            lock (_settingsGate) text = Settings == null ? null : Settings.LastKnownRemoteVersion;
            Version parsed;
            if (!UpdateVersionPolicy.TryParseNewer(text, LocalVersion, out parsed)) return false;
            remote = parsed;
            return true;
        }

        private static string StagedDllFor(Version remote)
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "3SM", "EnduranceConnector", "Updates", remote.ToString(), "3SM.EnduranceConnector.dll");
        }

        // Achtergrond-download zodra een nieuwe versie beschikbaar is (stil, geen dialoog).
        private async Task StageUpdateAutoAsync(Version remote)
        {
            try
            {
                var state = _updaterState;
                if (state != null && string.Equals(state.state, "STAGED", StringComparison.Ordinal)
                    && string.Equals(state.pendingUpdateVersion, remote.ToString(), StringComparison.Ordinal)) return;
                var staged = await StageUpdateAsync(remote).ConfigureAwait(false);
                SetUpdateStatus("Update " + remote + " gedownload · wordt op een veilig moment geïnstalleerd.");
                SimHub.Logging.Current.Info("3SM Endurance: update " + remote + " op de achtergrond gedownload (" + staged + ").");
            }
            catch (UpdateStageBusyException)
            {
                // Er loopt al een andere download; die zet de FSM/STAGED zelf.
            }
            catch (Exception ex)
            {
                // Terug naar "beschikbaar" zodat de FSM niet in DOWNLOADING blijft hangen.
                SetUpdaterState(new UpdaterState { state = "UPDATE_AVAILABLE", pendingUpdateVersion = remote.ToString() });
                try { SimHub.Logging.Current.Warn("3SM Endurance: achtergrond-download niet gelukt: " + (ex.InnerException ?? ex).Message); } catch { }
            }
        }

        // Veilig moment: nooit tijdens een game; bij starten pas na het herstart-budget
        // (24 uur), bij idle pas na 30 minuten zonder game. Maximaal één herstart per 24 uur.
        private void TryAutoApplyUpdate(bool gameIsAround, bool launchMoment)
        {
            try
            {
                if (Volatile.Read(ref _ending) != 0) return;
                if (!AutoUpdateOn() || gameIsAround) return;
                var state = _updaterState;
                if (state == null || !string.Equals(state.state, "STAGED", StringComparison.Ordinal)) return;
                if (Volatile.Read(ref _updateInstallBusy) != 0) return;

                var now = DateTime.UtcNow;
                if (now.Ticks < Interlocked.Read(ref _autoApplyBlockedUntilUtcTicks)) return;
                long lastTicks;
                lock (_settingsGate) lastTicks = Settings.LastAutoUpdateRestartUtcTicks;
                if (lastTicks > 0 && now - new DateTime(lastTicks, DateTimeKind.Utc) < TimeSpan.FromHours(24)) return;

                if (!launchMoment)
                {
                    var lastSeen = Interlocked.Read(ref _lastGameSeenUtcTicks);
                    if (lastSeen > 0 && now - new DateTime(lastSeen, DateTimeKind.Utc) < TimeSpan.FromMinutes(30)) return;
                }

                Version remote;
                if (!TryGetPendingRemoteVersion(out remote)) return;
                // De FSM-state moet bij de aangekondigde versie horen; zo installeren we nooit
                // per ongeluk een halve of verouderde staging.
                if (!string.IsNullOrWhiteSpace(state.pendingUpdateVersion)
                    && !string.Equals(state.pendingUpdateVersion, remote.ToString(), StringComparison.Ordinal)) return;
                var staged = string.IsNullOrWhiteSpace(state.pendingStagedDll) ? StagedDllFor(remote) : state.pendingStagedDll;
                if (!File.Exists(staged)) return;
                if (Interlocked.CompareExchange(ref _updateInstallBusy, 1, 0) != 0) return;
                try
                {
                    string message;
                    Exception failure;
                    if (LaunchUpdaterAndExit(remote, staged, out message, out failure))
                    {
                        lock (_settingsGate) { Settings.LastAutoUpdateRestartUtcTicks = now.Ticks; this.SaveCommonSettings("ConnectorSettings", Settings); }
                        SetUpdateStatus("Auto-update " + remote + " wordt geïnstalleerd · SimHub start opnieuw.");
                        SimHub.Logging.Current.Info("3SM Endurance: auto-update " + remote + " toegepast (" + (launchMoment ? "bij starten" : "bij idle") + ").");
                    }
                    else
                    {
                        // Niet blijven hangen in een UAC-lus: 30 minuten rust na een mislukte poging.
                        Interlocked.Exchange(ref _autoApplyBlockedUntilUtcTicks, now.AddMinutes(30).Ticks);
                        var uacCancelled = failure is Win32Exception && ((Win32Exception)failure).NativeErrorCode == 1223;
                        SimHub.Logging.Current.Warn(uacCancelled
                            ? "3SM Endurance: auto-update wacht · bevestiging bij Windows is weggeklikt."
                            : "3SM Endurance: auto-update niet toegepast: " + message);
                    }
                }
                finally { Volatile.Write(ref _updateInstallBusy, 0); }
            }
            catch (Exception ex) { try { SimHub.Logging.Current.Warn("3SM Endurance: auto-update mislukt: " + ex.Message); } catch { } }
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
                // De automatische check gebruikt maximaal 1x per 24 uur (6 uur zodra
                // auto-update aanstaat, zodat langere sessies nieuwe versies oppikken);
                // de UI-knop mag bewust forceren.
                DateTime? lastCheck;
                var autoUpdateOn = AutoUpdateOn();
                lock (_settingsGate) lastCheck = Settings.LastVersionCheckUtc;
                if (!force && lastCheck.HasValue && DateTime.UtcNow - lastCheck.Value < TimeSpan.FromHours(autoUpdateOn ? 6 : 24)) return;
                if (force) SetUpdateStatus("Controleren op updates…");
                SetUpdaterState(new UpdaterState { state = "CHECKING" });

                var localVersion = LocalVersion;
                // TEST/canary builds append their release channel so the version check selects
                // the correct manifest; STABLE builds stay a plain GET (unchanged behavior).
                var endpoint = new Uri(BuildRelayEndpoint("simhub-version").AbsoluteUri + ReleaseChannelQuery);
                using (var request = new HttpRequestMessage(HttpMethod.Get, endpoint))
                using (var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw new HttpRequestException("versie-endpoint HTTP " + (int)response.StatusCode);
                    var body = await ReadBoundedResponseAsync(response.Content, 8192, cancellationToken).ConfigureAwait(false);
                    var info = Deserialize<VersionResponse>(body);
                    if (info == null || string.IsNullOrWhiteSpace(info.Version)) throw new HttpRequestException("versie-endpoint gaf geen versie terug");
                    var remote = Version.TryParse(info.Version.Trim(), out var parsed) ? parsed : null;
                    if (remote == null) throw new HttpRequestException("serverversie is ongeldig: " + info.Version.Trim());
                    if (UpdateVersionPolicy.IsNewer(remote, localVersion))
                    {
                        var metadataValid = ValidateReleaseManifest(info, remote);
                        lock (_settingsGate)
                        {
                            Settings.LastKnownRemoteVersion = info.Version.Trim();
                            Settings.LastKnownRemoteDllUrl = metadataValid ? BuildPluginDownloadUri(remote).AbsoluteUri : string.Empty;
                            Settings.LastKnownRemoteSha256 = metadataValid ? NormalizeSha256(info.Sha256) : string.Empty;
                            Settings.LastKnownRemoteByteLength = metadataValid ? info.ByteLength : 0;
                            Settings.LastKnownRemoteFileName = metadataValid ? (info.FileName ?? string.Empty).Trim() : string.Empty;
                            Settings.LastKnownRemoteSignature = metadataValid ? (info.Signature ?? string.Empty).Trim() : string.Empty;
                            Settings.LastVersionCheckUtc = DateTime.UtcNow;
                            this.SaveCommonSettings("ConnectorSettings", Settings);
                        }
                        SetUpdateAvailable(metadataValid);
                        if (metadataValid)
                        {
                            SetUpdaterState(new UpdaterState { state = "UPDATE_AVAILABLE", pendingUpdateVersion = remote.ToString() });
                            SetUpdateStatus("Nieuwe versie " + remote + " beschikbaar · klaar voor éénklik-installatie.");
                            // Auto-update: download alvast stil op de achtergrond; toepassen
                            // gebeurt later op een veilig moment (nooit tijdens een game).
                            if (AutoUpdateOn())
                            {
                                _ = Task.Run(async () => await StageUpdateAutoAsync(remote).ConfigureAwait(false));
                            }
                        }
                        else
                        {
                            SetUpdaterState(new UpdaterState { state = "IDLE" });
                            SetUpdateStatus("Nieuwe versie " + remote + " beschikbaar, maar veilige installatiemetadata ontbreekt.");
                        }
                        if (Volatile.Read(ref _ending) == 0) Status = metadataValid
                            ? "Nieuwe versie beschikbaar · klaar voor installatie"
                            : "Nieuwe versie beschikbaar · metadata ongeldig";
                    }
                    else
                    {
                        lock (_settingsGate)
                        {
                            Settings.LastKnownRemoteVersion = info.Version.Trim();
                            Settings.LastKnownRemoteDllUrl = string.Empty;
                            Settings.LastKnownRemoteSha256 = string.Empty;
                            Settings.LastKnownRemoteByteLength = 0;
                            Settings.LastKnownRemoteFileName = string.Empty;
                            Settings.LastKnownRemoteSignature = string.Empty;
                            Settings.LastVersionCheckUtc = DateTime.UtcNow;
                            this.SaveCommonSettings("ConnectorSettings", Settings);
                        }
                        SetUpdateAvailable(false);
                        SetUpdaterState(new UpdaterState { state = "IDLE" });
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
                    _tyreTracker.Reset();
                    _tyreGate.Reset();
                    Interlocked.Exchange(ref _sequence, -1);
                }
                if (!running && _gameWasRunning)
                {
                    _stintClock.Stop();
                    // Einde van de sessie: open pitbezoek, lopende ronde en de laatste ankers
                    // gaan er met een expliciete reden uit in plaats van te blijven hangen.
                    EndMeasurementSession("session_end");
                }
                _gameWasRunning = running;
                // Meetlaag: elke tick een monster, vóór de pairing- en intervalpoort. Of er
                // gemeten wordt hangt niet van IsPaired of _sendBusy af; dat was precies de
                // fout waardoor de bandentracker pas na de poorten werd bijgewerkt.
                ObserveMeasurements(pluginManager, data, running, isInCar);
                // Vlaggen elke tick oplossen/publiceren (los van het verzendinterval),
                // zodat een flagbox/overlay direct reageert.
                PublishFlags(pluginManager);
                PublishOverlay(running, isInCar);
                // Auto-update op een veilig moment: nooit tijdens een game en bij idle
                // pas na 30 minuten zonder game (verder max. één herstart per 24 uur).
                if (running || data.GameRunning || data.GameInMenu)
                    Interlocked.Exchange(ref _lastGameSeenUtcTicks, DateTime.UtcNow.Ticks);
                var nowUnixMs = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
                if (nowUnixMs - Interlocked.Read(ref _lastAutoApplyCheckUnixMs) >= 60000)
                {
                    Interlocked.Exchange(ref _lastAutoApplyCheckUnixMs, nowUnixMs);
                    TryAutoApplyUpdate(running || data.GameInMenu, false);
                    // Houd de versie fris tijdens langere sessies (de check zelf is
                    // afgeknepen op 6 uur wanneer auto-update aanstaat).
                    bool centralRelay;
                    DateTime? lastCheck;
                    lock (_settingsGate)
                    {
                        centralRelay = Settings != null && Settings.UseCentralRelay;
                        lastCheck = Settings == null ? null : Settings.LastVersionCheckUtc;
                    }
                    if (centralRelay && AutoUpdateOn()
                        && (!lastCheck.HasValue || DateTime.UtcNow - lastCheck.Value >= TimeSpan.FromHours(6)))
                    {
                        _ = Task.Run(async () => await CheckForUpdateAsync(_shutdown.Token, false).ConfigureAwait(false));
                    }
                }
                if (!running || data.NewData == null)
                {
                    ObserveDiagnostics(new DiagnosticsObservation
                    {
                        GameConnected = running,
                        RawDataAvailable = data.NewData != null,
                        RawTelemetryAvailable = false,
                        SessionTimeReadOk = false,
                        SessionTimeSeconds = null,
                        Sequence = Interlocked.Read(ref _sequence)
                    });
                    Status = isIRacing ? "iRacing gestart · wacht op telemetry" : "Wacht op iRacing";
                    return;
                }
                Uri endpoint;
                string token;
                TelemetryEnvelopeV3 envelope;
                TelemetryEnvelope localEnvelope = null;
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
                        endpoint = BuildRelayEndpoint(V3IngestFunction);
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
                    DiagnosticsObservation observation;
                    envelope = null;
                    if (central) envelope = CaptureV3(pluginManager, data, isInCar, out observation);
                    else localEnvelope = Capture(pluginManager, data, false, isInCar, out observation);
                    ObserveDiagnostics(observation);
                }
                lock (_sendGate)
                {
                    if (Volatile.Read(ref _ending) != 0)
                    {
                        Volatile.Write(ref _sendBusy, 0);
                        return;
                    }
                    _activeSend = envelope != null
                        ? Task.Run(async () => await SendV3Async(envelope, endpoint, token, _shutdown.Token).ConfigureAwait(false))
                        : Task.Run(async () => await SendAsync(localEnvelope, endpoint, token, _shutdown.Token).ConfigureAwait(false));
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
            DisposeDiagnostics();
            // Meetlaag eerst afsluiten: de laatste ronde en een open pitbezoek worden nog
            // bewaard in de outbox voordat de HTTP-client verdwijnt.
            EndMeasurementSession("plugin_stop");
            // Directe SDK-lezer: alleen de eigen read-only handle vrijgeven. Nooit een
            // exception laten ontsnappen tijdens SimHub-shutdown.
            try
            {
                var irSdk = _irSdk;
                _irSdk = null;
                if (irSdk != null) irSdk.Dispose();
            }
            catch (Exception irSdkError) { SimHub.Logging.Current.Warn("3SM iRacing-SDK: sluiten mislukt: " + irSdkError.Message); }
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

        // ------------------------------------------------------------------- meetlaag 0.7.2.0
        //
        // De meetlaag is SimHub-vrij en volledig getest in 3SM.EnduranceConnector.DiagnosticsTests.
        // Hier staat alleen de bedrading: één keer starten, per tick een monster aanbieden, bij
        // het einde van de sessie afsluiten, en de meetserie meeschuiven in het frame.

        /// <summary>
        /// Start de meetlaag één keer. Lukt dat niet, dan blijft de gewone telemetrie werken:
        /// één regel in het log, geen exception in SimHub's init.
        /// </summary>
        private void InitMeasurementLayer()
        {
            try
            {
                var dataDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "3SM Endurance Connector");
                _measurementOutbox = new MeasurementOutbox(Path.Combine(dataDirectory, "measurement-outbox.json"));
                _measurementOutbox.Load();                       // herstel na een herstart
                _measurementPipeline = new MeasurementPipeline(_measurementOutbox, new MeasurementIdFactory());
                _measurementSender = new MeasurementSender(_measurementOutbox, _http,
                    () => ConnectorCapabilities.Implemented().ToJson(), MeasurementLimits.Default());
                _controlClient = new ConnectorControlClient(new Uri(ProductionRelayBaseUrl), _http, string.Empty,
                    () => DateTime.UtcNow);
                _controlClient.LoadCache(Path.Combine(dataDirectory, "connector-control.json"));
            }
            catch (Exception error)
            {
                _measurementOutbox = null;
                _measurementPipeline = null;
                _measurementSender = null;
                _controlClient = null;
                SimHub.Logging.Current.Warn("3SM meetlaag: niet gestart, telemetrie loopt door: " + error.Message);
            }
        }

        /// <summary>
        /// Biedt deze tick aan de meetlaag aan. Alleen als er echt gereden wordt: zonder
        /// in-car data is er niets te meten en zou een rij nullen een meting suggereren.
        /// </summary>
        private void ObserveMeasurements(PluginManager manager, GameData data, bool running, bool isInCar)
        {
            if (_measurementPipeline == null || !running || !isInCar || data.NewData == null) return;
            try
            {
                var sample = BuildMeasurementSample(manager, data);
                if (sample != null) _measurementPipeline.Observe(sample);
            }
            catch (Exception error)
            {
                // Eén onleesbaar kanaal mag de tick niet kosten: dit monster valt weg, de
                // rest van de plugin merkt er niets van.
                SimHub.Logging.Current.Warn("3SM meetlaag: monster overgeslagen: " + error.Message);
            }
        }

        /// <summary>Sluit de meetsessie af met een expliciete reden; nooit stilzwijgend laten hangen.</summary>
        private void EndMeasurementSession(string reason)
        {
            if (_measurementPipeline == null) return;
            try { _measurementPipeline.End(reason); }
            catch (Exception error) { SimHub.Logging.Current.Warn("3SM meetlaag: afsluiten mislukt: " + error.Message); }
        }

        /// <summary>
        /// Haalt het beleid van <c>GET /simhub-control</c> op de achtergrond op, één keer per
        /// start. De client faalt nooit hard en heeft een eigen korte timeout, dus dit blokkeert
        /// niets; de cache uit de vorige keer geldt tot dit antwoord binnen is.
        /// </summary>
        private void RefreshControlPolicy()
        {
            if (_controlClient == null) return;
            try
            {
                Task.Run(async () =>
                {
                    var state = await _controlClient.RefreshAsync(_shutdown.Token).ConfigureAwait(false);
                    if (Volatile.Read(ref _ending) == 0)
                    {
                        SimHub.Logging.Current.Info("3SM beleid: " + state.Mode + " · interval " + state.SendIntervalMs
                            + " ms · schema " + state.SchemaRevision + (string.IsNullOrEmpty(state.Reason) ? string.Empty : " · " + state.Reason));
                    }
                });
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM beleid: handshake niet gestart: " + error.Message);
            }
        }

        /// <summary>
        /// Eén meetmonster uit dezelfde tick, met dezelfde lezers als het frame: de directe
        /// iRacing-SDK voor de kanalen die SimHub niet doorgeeft en de ruwe-kanalenlezer voor
        /// de rest. Ontbreekt een kanaal, dan blijft het veld null — 0 is een meting, null is
        /// "de sim zei niets".
        /// </summary>
        private TelemetrySample BuildMeasurementSample(PluginManager manager, GameData data)
        {
            var snapshot = data.NewData;
            if (snapshot == null) return null;
            var channels = new RawChannelReader(snapshot, property => GetRaw(manager, property));
            var sdk = ReadDirectSdk();
            var player = snapshot.Opponents == null
                ? null
                : snapshot.Opponents.FirstOrDefault(opponent => opponent != null && opponent.IsPlayer);

            var trackTemp = RoundTyreValue(channels.ReadNumber("TrackTempCrew", MinAmbientTempC, MaxAmbientTempC), 1);
            if (!trackTemp.HasValue) trackTemp = RoundTyreValue(channels.ReadNumber("TrackTemp", MinAmbientTempC, MaxAmbientTempC), 1);

            return new TelemetrySample
            {
                ObservedAtUtc = DateTime.UtcNow,
                // De SDK-tick is de harde ontdubbeling: SimHub's DataUpdate kan met ongewijzigde
                // ruwe data opnieuw vuren en dat is geen tweede meting.
                SdkTick = sdk == null || !sdk.Connected ? (long?)null : sdk.TickCount,
                SessionTimeSeconds = _sessionTime.Read(snapshot),
                // De huidige ronde is het aantal afgeronde rondes plus één; de grens valt dus
                // precies op de finishlijn en niet op SimHub's eigen teller.
                LapNumber = Math.Max(0, GetInt(manager, Settings.CompletedLapsProperty, 0)) + 1,
                CurrentDriverName = FirstNonEmpty(snapshot.PlayerName,
                    player == null ? null : player.Name,
                    GetNullableString(manager, Settings.CurrentDriverNameProperty)),
                ObservedSessionId = BuildObservedSessionId(manager, channels),
                LatAccelG = DirectSdkNumber(sdk, IrSdkChannels.LatAccel, 1.0 / IrSdkUnits.StandardGravity, -10, 10, 3),
                LongAccelG = DirectSdkNumber(sdk, IrSdkChannels.LongAccel, 1.0 / IrSdkUnits.StandardGravity, -10, 10, 3),
                // Intentie van de rijder, geen uitkomst; -1 (geen waarde) wordt null.
                PitServiceFlagsRaw = CaptureValueRules.PitServiceFlags(DirectSdkInt(sdk, "PitSvFlags", int.MinValue, int.MaxValue)),
                RequestedFuelLitres = DirectSdkNumber(sdk, "PitSvFuel", 1, 0, 300, 2),
                TyreSetsUsed = DirectSdkInt(sdk, "TireSetsUsed", 0, 255) ?? channels.ReadInt("TireSetsUsed", 0, 255),
                // Pitstraat: het ruwe SDK-kanaal, zonder SimHub-fallback naar false.
                OnPitRoad = channels.ReadBool("OnPitRoad"),
                InPitStall = channels.ReadBool("PlayerCarInPitStall"),
                TrackTempC = trackTemp,
                AirTempC = RoundTyreValue(channels.ReadNumber("AirTemp", MinAmbientTempC, MaxAmbientTempC), 1),
                FuelLitres = CaptureValueRules.FuelLitres(GetNullableDouble(manager, Settings.FuelProperty, false)),
                Wear = ReadMeasurementWear(channels),
            };
        }

        /// <summary>
        /// De sessie waarin gemeten wordt — niet de transportsessie. iRacing's SessionUniqueID
        /// plus het sessienummer verandert bij practice → qualify → race, en dan begint de
        /// meetlaag een nieuw segment zonder dat de plugin herstart.
        /// </summary>
        private static string BuildObservedSessionId(PluginManager manager, RawChannelReader channels)
        {
            var uniqueId = GetNullableInt(manager, "DataCorePlugin.GameRawData.SessionData.WeekendInfo.SessionUniqueID");
            var sessionNumber = channels.ReadInt("SessionNum", 0, 1000);
            if (!uniqueId.HasValue && !sessionNumber.HasValue) return null;
            var text = "sim"
                + (uniqueId.HasValue ? "-" + uniqueId.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : string.Empty)
                + (sessionNumber.HasValue ? "-s" + sessionNumber.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : string.Empty);
            return text;
        }

        /// <summary>
        /// De wear-lezing als één waarde per hoek: de laagste van de drie zones, in procenten
        /// rest. Ontbreekt voor één hoek elk kanaal, dan is er geen lezing — geen halve wear
        /// met een verzonnen 0.
        /// </summary>
        private static WearReading ReadMeasurementWear(RawChannelReader channels)
        {
            var reading = TyreZoneReader.Read(channels);
            var corners = new double[4];
            for (var corner = 0; corner < 4; corner++)
            {
                double? worst = null;
                for (var zone = 0; zone < 3; zone++)
                {
                    var value = reading.WearPercent[corner][zone];
                    if (!value.HasValue) continue;
                    if (!worst.HasValue || value.Value < worst.Value) worst = value;
                }
                if (!worst.HasValue) return null;
                corners[corner] = worst.Value;
            }
            return new WearReading(corners[0], corners[1], corners[2], corners[3]);
        }

        /// <summary>
        /// Eén integer SDK-kanaal binnen [minimum, maximum]; onleesbaar of buiten de grens is
        /// null. Dezelfde nullable-discipline als <see cref="DirectSdkNumber"/>.
        /// </summary>
        private static int? DirectSdkInt(IrSdkImage image, string channel, int minimum, int maximum)
        {
            if (image == null || string.IsNullOrEmpty(channel)) return null;
            var value = image.ReadNumber(channel);
            if (!value.HasValue || double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return null;
            if (value.Value < int.MinValue || value.Value > int.MaxValue) return null;
            var rounded = (int)Math.Round(value.Value, MidpointRounding.AwayFromZero);
            if (rounded < minimum || rounded > maximum) return null;
            return rounded;
        }

        public Control GetWPFSettingsControl(PluginManager pluginManager) { return new SettingsControl(this); }

        internal void InitUpdaterStateStore()
        {
            try
            {
                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "3SM", "EnduranceConnector", "Updater");
                _updaterStateStore = new UpdaterStateStore(dir);
                _updaterState = _updaterStateStore.Load();
                // Fallback B: NO automatic install/resume on startup. WAITING state is
                // merely surfaced to the user; install resumes only on an explicit trigger.
                if (_updaterState != null && _updaterState.state == "WAITING_FOR_RESTART")
                {
                    SetUpdateStatus("Er staat een update klaar die wacht op installeren · open Update-installatie opnieuw.");
                }
            }
            catch
            {
                _updaterStateStore = null;
                _updaterState = null;
            }
        }

        internal void SetUpdaterState(UpdaterState next)
        {
            if (_updaterStateStore == null) { _updaterState = next; return; }
            try
            {
                if (_updaterStateStore.TryUpdate(cur => CopyInto(cur, next))) _updaterState = _updaterStateStore.Load();
            }
            catch { _updaterState = next; }
        }

        private static void CopyInto(UpdaterState target, UpdaterState source)
        {
            if (target == null || source == null) return;
            target.schemaVersion = source.schemaVersion;
            target.state = source.state;
            target.stateChangedUtc = source.stateChangedUtc;
            target.pendingUpdateVersion = source.pendingUpdateVersion;
            target.pendingStagedDll = source.pendingStagedDll;
            target.pendingSimHubPid = source.pendingSimHubPid;
            target.lastUpdateResult = source.lastUpdateResult;
            target.lastUpdateUtc = source.lastUpdateUtc;
            target.lastUpdateErrorCode = source.lastUpdateErrorCode;
        }

        internal void UpdateSettings(Action<ConnectorSettings> update)
        {
            if (update == null) return;
            lock (_settingsGate) update(Settings);
        }

        internal void ApplyDiagnosticsSettings()
        {
            bool enabled;
            string token;
            string deviceId;
            lock (_settingsGate)
            {
                enabled = Settings != null && Settings.DiagnosticsEnabled && Settings.UseCentralRelay &&
                          !string.IsNullOrWhiteSpace(_deviceToken) && !string.IsNullOrWhiteSpace(Settings.DeviceId) &&
                          !string.IsNullOrWhiteSpace(Settings.BoundOwnerUserId);
                token = _deviceToken;
                deviceId = Settings == null ? null : Settings.DeviceId;
            }

            // The diagnostics gate only protects the reference. Dispose can wait for an
            // in-flight diagnostics request, so it must never hold up telemetry's brief read.
            DiagnosticsClient stopped = null;
            lock (_diagnosticsGate)
            {
                if (!enabled || Volatile.Read(ref _ending) != 0)
                {
                    stopped = _diagnostics;
                    _diagnostics = null;
                }
                else if (_diagnostics == null)
                {
                    DiagnosticsClient diagnostics = null;
                    try
                    {
                        var endpoint = BuildRelayEndpoint("simhub-diagnostic");
                        var store = _updaterStateStore;
                        diagnostics = new DiagnosticsClient(endpoint,
                            () => store == null ? UpdaterState.SafeDefaults() : store.LoadReadOnly());
                        diagnostics.Start(token, deviceId, InstalledVersion, typeof(PluginManager).Assembly.GetName().Version.ToString());
                        _diagnostics = diagnostics;
                    }
                    catch
                    {
                        // Diagnostics is optional. A failed init must not affect plugin load or telemetry.
                        stopped = diagnostics;
                        SimHub.Logging.Current.Warn("3SM Endurance diagnostics kon niet veilig starten; diagnostics blijft uit.");
                    }
                }
            }
            if (stopped != null) stopped.Dispose();
        }

        private void ObserveDiagnostics(DiagnosticsObservation observation)
        {
            DiagnosticsClient diagnostics;
            lock (_diagnosticsGate) diagnostics = _diagnostics;
            if (diagnostics != null) diagnostics.Observe(observation);
        }

        private void DisposeDiagnostics()
        {
            DiagnosticsClient diagnostics;
            lock (_diagnosticsGate) { diagnostics = _diagnostics; _diagnostics = null; }
            if (diagnostics != null) diagnostics.Dispose();
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
                _tyreTracker.Reset();
                // Nieuw device = nieuw team: het oude plan en de oude cache zijn ongeldig.
                SyncOverlayAuth(true);
                Status = "Gekoppeld · wacht op iRacing";
                OnPropertyChanged("IsPaired");
                ApplyDiagnosticsSettings();
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
            ApplyDiagnosticsSettings();
            // Token is nu leeg: stop het pollen en wis het plan van dit device, anders
            // blijft het dashboard de oude stint tonen.
            SyncOverlayAuth(true);
            Status = "Lokaal vergeten · trek het device ook op de 3SM-site in";
            OnPropertyChanged("IsPaired");
        }

        // De overlay-client wordt één keer in Init gemaakt; pair/unpair wijzigen alleen
        // _deviceToken. Zonder deze sync blijft de overlay met het oude token (of zonder
        // token) pollen: na pair komt er nooit data, na unpair blijft het plan van het
        // vorige device staan. Lockorde: _settingsGate -> OverlayClient._gate (nooit omgekeerd).
        private void SyncOverlayAuth(bool resetPlanning)
        {
            var client = _overlayClient;
            if (client == null) return;
            string token;
            lock (_settingsGate) token = _deviceToken;
            try
            {
                if (resetPlanning) client.Clear();
                client.SetToken(token);
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM overlay: token kon niet worden bijgewerkt: " + error.Message);
            }
        }

        private TelemetryEnvelope Capture(PluginManager manager, GameData data, bool central, bool isInCar, out DiagnosticsObservation diagnosticObservation)
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
            bool rawTelemetryAvailable;
            var sessionTimeSeconds = _sessionTime.ReadWithHealth(snapshot, out rawTelemetryAvailable);
            var nextSequence = Interlocked.Increment(ref _sequence);
            diagnosticObservation = new DiagnosticsObservation
            {
                GameConnected = true,
                RawDataAvailable = snapshot != null,
                RawTelemetryAvailable = rawTelemetryAvailable,
                SessionTimeReadOk = sessionTimeSeconds.HasValue,
                SessionTimeSeconds = sessionTimeSeconds,
                Sequence = nextSequence
            };
            return new TelemetryEnvelope
            {
                ProtocolVersion = 2,
                Sequence = nextSequence,
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
                    SessionTimeSeconds = sessionTimeSeconds,
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

        // Stint-berekening: brandstof per ronde (gladgestreken) + resterende ronden.
        private int _fuelTrackLap = -1;
        private double _fuelAtLapStart;
        private double _fuelPerLap;

        private void UpdateFuelStint(double fuelLitres, int completedLaps)
        {
            if (completedLaps <= 0 || fuelLitres <= 0) return;
            if (_fuelTrackLap >= 0 && completedLaps < _fuelTrackLap) { _fuelTrackLap = -1; _fuelPerLap = 0; }
            if (_fuelTrackLap < 0) { _fuelTrackLap = completedLaps; _fuelAtLapStart = fuelLitres; return; }
            if (completedLaps > _fuelTrackLap)
            {
                var laps = completedLaps - _fuelTrackLap;
                var used = _fuelAtLapStart - fuelLitres;
                if (used > 0.05 && used < 300)
                {
                    var perLap = used / laps;
                    _fuelPerLap = _fuelPerLap <= 0 ? perLap : (_fuelPerLap * 0.7 + perLap * 0.3);
                }
                _fuelTrackLap = completedLaps;
                _fuelAtLapStart = fuelLitres;
            }
        }

        // Genormaliseerde sessiefase (iRacing SessionState / LMU GamePhase).
        private string SessionPhaseText(PluginManager manager)
        {
            var state = GetDouble(manager, "DataCorePlugin.GameRawData.SessionData.SessionState", -1);
            if (state >= 0)
            {
                switch ((int)state)
                {
                    case 1: return "garage";
                    case 2: return "gridding";
                    case 3: return "formation";
                    case 4: return "racing";
                    case 5: return "checkered";
                    case 6: return "ended";
                }
            }
            var phase = GetDouble(manager, "DataCorePlugin.GameRawData.GamePhase", -1);
            if (phase >= 0)
            {
                switch ((int)phase)
                {
                    case 0: return "garage";
                    case 1: case 2: return "gridding";
                    case 3: return "formation";
                    case 4: return "countdown";
                    case 5: return "racing";
                    case 6: return "fullcourseyellow";
                    case 7: return "racing";
                    case 8: return "ended";
                }
            }
            return "unknown";
        }

        private void StartLightsFor(PluginManager manager, out int? startLights, out bool isStartSequence)
        {
            startLights = null;
            isStartSequence = false;
            var bf = (uint)GetDouble(manager, "DataCorePlugin.GameRawData.Telemetry.SessionFlags", 0);
            if (bf == 0u) return;
            if ((bf & 0x80000000u) != 0u) { startLights = 0; isStartSequence = true; }
            else if ((bf & 0x40000000u) != 0u) { startLights = 2; isStartSequence = true; }
            else if ((bf & 0x20000000u) != 0u) { startLights = 1; isStartSequence = true; }
        }

        internal TelemetryEnvelopeV3 CaptureV3(PluginManager manager, GameData data, bool isInCar, out DiagnosticsObservation diagnosticObservation)
        {
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
            // Vlaggen komen uit de per-tick resolutie in DataUpdate (PublishFlags).
            var flagNames = _lastFlagNames;
            var completedLaps = Math.Max(0, GetInt(manager, Settings.CompletedLapsProperty, 0));
            var lapTimeSeconds = GetNullableSeconds(manager, Settings.LastLapTimeProperty);
            // Eerst de ingestelde property; die blijkt leeg (F2Time is een rondetijd, geen achterstand).
            // Valt terug op de spelersrij uit de tegenstanderlijst: dezelfde bron die bij de rest werkt.
            var gapToLeader = GetNullableSeconds(manager, Settings.GapToLeaderProperty)
                ?? (player == null ? null : SignedSeconds(player.GaptoLeader));
            // V3/0.4.0: populatie van bestaande nullable eigen-auto velden (NULL-tolerant).
            var sessionTimeRemaining = GetNullableSeconds(manager, Settings.SessionTimeRemainingProperty);
            var sessionLapsRemaining = GetNullableInt(manager, Settings.SessionLapsRemainingProperty);
            var currentLapElapsed = GetNullableSeconds(manager, Settings.CurrentLapElapsedProperty)
                ?? GetNullableSeconds(manager, "DataCorePlugin.GameData.NewData.CurrentLapTime");
            var bestLapTime = GetNullableSeconds(manager, Settings.BestLapTimeProperty);
            var lapDistancePct = GetNullableDouble(manager, Settings.LapDistancePctProperty, false)
                ?? (player == null ? null : Clamp01(NullableSeconds(player.TrackPositionPercent)));
            // Ontbrekende brandstof is null, geen 0. 0 is een echte meting (lege tank in
            // de garage) en blijft 0. Zie CaptureValueRules en CaptureNullSemanticsTests.
            var fuel = CaptureValueRules.FuelLitres(GetNullableDouble(manager, Settings.FuelProperty, false));
            var fuelCapacity = ResolveFuelCapacity(manager);
            if (fuel.HasValue) UpdateFuelStint(fuel.Value, completedLaps);
            var incidents = NonNegativeOrNull(GetNullableInt(manager, Settings.IncidentsProperty));
            // Pitstraat: één nullable waarneming, ruwe SDK eerst. Zonder bron null, niet false.
            var inPitLaneProperty = GetNullableBool(manager, Settings.PitLaneProperty);
            var nextSequence = Interlocked.Increment(ref _sequence);

            bool rawTelemetryAvailable;
            var sessionTimeSeconds = _sessionTime.ReadWithHealth(snapshot, out rawTelemetryAvailable);
            diagnosticObservation = new DiagnosticsObservation
            {
                GameConnected = true,
                RawDataAvailable = snapshot != null,
                RawTelemetryAvailable = rawTelemetryAvailable,
                SessionTimeReadOk = sessionTimeSeconds.HasValue,
                SessionTimeSeconds = sessionTimeSeconds,
                Sequence = nextSequence
            };

            var flags = flagNames == null ? null : new List<string>(flagNames);

            int? startLights; bool isStartSequence;
            StartLightsFor(manager, out startLights, out isStartSequence);
            var sessionPhase = SessionPhaseText(manager);
            bool? pitLaneOpen = null;
            var pitsOpen = GetNullableDouble(manager, "DataCorePlugin.GameRawData.Telemetry.PitsOpen", false);
            if (pitsOpen.HasValue) pitLaneOpen = pitsOpen.Value != 0;

            // 0.7.0: één lezer voor alle ruwe iRacing-kanalen (property-pad, dan reflectie).
            // Wordt pas gebruikt als het bijbehorende blok aan staat; de lezer doet zelf niets.
            var rawChannels = new RawChannelReader(snapshot, property => GetRaw(manager, property));
            var onPitRoad = CaptureValueRules.OnPitRoad(rawChannels.ReadBool("OnPitRoad"), inPitLaneProperty);

            return new TelemetryEnvelopeV3
            {
                ProtocolVersion = 3,
                Sequence = nextSequence,
                CapturedAt = DateTime.UtcNow.ToString("o"),
                TransportSessionId = _sessionId,
                // 0.7.2.0 additief: het frame meldt zijn schemarevisie en wat deze connector
                // kan. protocolVersion blijft 3. De meetsleutels zelf (measurementEvents,
                // lapSummaries) komen uit de outbox bij het verzenden.
                SchemaRevision = MeasurementContract.SchemaRevision,
                Capabilities = V3Capabilities.From(ConnectorCapabilities.Implemented()),
                // Herkomst: SimHub-versie en plug-inversie zijn twee verschillende dingen.
                // Null als er niets te melden is; EmitDefaultValue=false laat de sleutel
                // dan weg en houdt een 0.7.x-frame byte-identiek.
                Source = BuildV3Source(),
                Identity = new V3Identity
                {
                    // Officiële iRacing-track-id voor de Pitwall-kaartkoppeling (op main sinds 8913ba3).
                    TrackId = TrackIdentityReader.Read(snapshot),
                    CurrentDriverId = currentDriverId,
                    CurrentDriverName = currentDriverName,
                    CarId = carId,
                    CarName = carName,
                    TrackName = trackName,
                    TrackConfig = trackConfig,
                },
                Session = new V3Session
                {
                    IsInCar = isInCar,
                    SessionTimeSeconds = sessionTimeSeconds,
                    SessionTimeRemainingSeconds = NormalizeTimeRemaining(sessionTimeRemaining),
                    SessionLapsRemaining = NormalizeRemainingLaps(sessionLapsRemaining),
                    Flags = flags == null || flags.Count == 0 ? null : flags.ToArray(),
                    SessionState = sessionPhase,
                    StartLights = startLights,
                    PitLaneOpen = pitLaneOpen,
                    IsStartSequence = isStartSequence,
                },
                Timing = new V3Timing
                {
                    CurrentLapElapsedSeconds = NormalizeTiming(currentLapElapsed),
                    LastLapTimeSeconds = lapTimeSeconds,
                    BestLapTimeSeconds = NormalizeTiming(bestLapTime),
                    CompletedLaps = completedLaps,
                },
                Position = new V3Position
                {
                    Position = position,
                    ClassPosition = classPosition,
                    GapToLeaderSeconds = gapToLeader,
                },
                Track = new V3Track
                {
                    LapDistancePct = NormalizeLapDist(lapDistancePct),
                    TrackSurface = "unknown",
                    OnPitRoad = onPitRoad,
                },
                Fuel = new V3Fuel
                {
                    // Zonder meting blijft dit null: een verzonnen 0 L is erger dan "onbekend".
                    FuelLitres = fuel,
                    FuelPct = CaptureValueRules.FuelPercent(fuel, fuelCapacity),
                    FuelPerLapLitres = _fuelPerLap > 0 ? (double?)Math.Round(_fuelPerLap, 3) : null,
                    LapsRemaining = CaptureValueRules.LapsRemaining(fuel, _fuelPerLap, snapshot != null ? snapshot.EstimatedFuelRemaingLaps : null),
                    FuelCapacityLitres = fuelCapacity,
                },
                RaceState = new V3RaceState
                {
                    Incidents = incidents,
                    IncidentLimit = NonNegativeOrNull(GetNullableInt(manager, "DataCorePlugin.GameRawData.SessionData.WeekendInfo.WeekendOptions.IncidentLimit")),
                },
                PitService = new V3PitService
                {
                    // 0.7.0: het ruwe bitfield stond in het contract maar werd hard op null gezet.
                    // Het is de INTENTIE van de rijder (wat hij aanvinkte), niet de uitkomst; de
                    // plugin interpreteert geen bits. Ontbreekt het kanaal, dan blijft het null.
                    PitServiceFlagsRaw = CaptureValueRules.PitServiceFlags(rawChannels.ReadInt("PitSvFlags", int.MinValue, int.MaxValue)),
                    // 0.7.1: de resterende reparatietijd stond óók in het contract en werd
                    // genegeerd. iRacing publiceert hem per kanaal (seconden). 0 is een echte
                    // meting ("niets open"); ontbreekt het kanaal, dan blijft het null en
                    // verzint de plugin niets.
                    RequiredRepairSeconds = ReadRepairSeconds(rawChannels, "PitRepairLeft"),
                    OptionalRepairSeconds = ReadRepairSeconds(rawChannels, "PitOptRepairLeft"),
                },
                Opponents = BuildOpponentSnapshot(snapshot),
                Vehicle = CaptureVehicle(manager, ReadDirectSdk()),  // altijd: de vier SDK-velden zijn de reden dat we direct lezen
                // 0.7.0: optioneel root-blok, alleen gevuld als de instelling aan staat (de
                // server moet het blok kennen; een oude receiver geeft 422 op een nieuwe key).
                // 0.7.1: niet meer elk frame — zie PublishTyres (wijziging of 30 s-hartslag).
                Tyres = Settings.TyreTelemetryEnabled
                    ? PublishTyres(CaptureTyres(rawChannels, sessionTimeSeconds, completedLaps, inPitLaneProperty), Settings.TyreSnapshotIntervalMilliseconds, onPitRoad == true)
                    : null,
            };
        }

        private static double? VehicleNumber(PluginManager manager, string name, double maximum, bool positive = false)
        {
            var value = GetNullableDouble(manager, "DataCorePlugin.GameData.NewData." + name, positive);
            return value.HasValue && value.Value <= maximum ? value : null;
        }

        // Tankinhoud: iRacing publiceert DriverCarFuelMaxLtr in de sessiegegevens.
        // SimHub's generieke laag noemt het per game anders, dus we proberen de
        // bekende paden in volgorde en nemen de eerste plausibele waarde.
        private static double? ResolveFuelCapacity(PluginManager manager)
        {
            var paths = new[]
            {
                "DataCorePlugin.GameRawData.SessionData.DriverInfo.DriverCarFuelMaxLtr",
                "DataCorePlugin.GameData.NewData.FuelCapacity",
                "DataCorePlugin.GameData.NewData.FuelMax",
            };
            foreach (var path in paths)
            {
                var value = GetNullableDouble(manager, path, true);
                if (value.HasValue && value.Value > 0 && value.Value <= 300)
                    return (double?)Math.Round(value.Value, 2);
            }
            return null;
        }

        // Resterende reparatietijd (seconden) uit één ruw kanaal. De validator accepteert
        // 0..86400 en gebruikt -1 als "onbekend"; alles daarbuiten of onleesbaar wordt null.
        // Eén decimaal: het kanaal is een float en de ruwe waarde schrijft anders 17 cijfers uit.
        // 0 blijft 0 — dat is "er staat niets meer open", geen ontbrekende meting.
        private static double? ReadRepairSeconds(RawChannelReader channels, string channel)
        {
            // De regels doen de bereik- en sentinelcontrole (-1 = onbekend, 0 = "niets open").
            return CaptureValueRules.RepairSeconds(channels.ReadNumber(channel, double.MinValue, double.MaxValue));
        }

        /// <summary>
        /// 0.7.1: het bandenblok hoeft niet elk frame mee. De tracker wordt elke tick
        /// bijgewerkt (daar zit de detectie van een nieuwe set en van de pit-entry), maar
        /// het blok gaat alleen de deur uit als de inhoud verandert of als het interval
        /// (standaard 30 s) verstreken is. Tussen die momenten blijft het veld weg
        /// (EmitDefaultValue=false) en is het frame dus kleiner. Het hek onthoudt de
        /// laatst verzonden stand, zodat de hartslag altijd dezelfde volledige meting
        /// stuurt in plaats van een half gevuld blok.
        ///
        /// In de pitstraat gaat het blok altijd mee: daar schrijft de server bij pit-exit
        /// het banden-anker (de wear van de set die eraf ging). Een gedempt frame op precies
        /// die flank zou dat anker stil laten vallen.
        /// </summary>
        private V3Tyres PublishTyres(V3Tyres fresh, int intervalMilliseconds, bool inPitLane)
        {
            if (fresh == null) return null;
            var now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
            return _tyreGate.ShouldPublish(TyreSignature.Of(fresh), now, intervalMilliseconds, inPitLane) ? fresh : null;
        }

        private static V3Tyre CaptureTyre(PluginManager manager, string corner)
        {
            var pressure = VehicleNumber(manager, "TyrePressure" + corner, 2000, true);
            var temperature = VehicleNumber(manager, "TyreTemperature" + corner, 1000, true);
            var wear = VehicleNumber(manager, "TyreWear" + corner, 100, true);
            // All-zero SDK defaults are not evidence of a measured/depleted tyre.
            if (!pressure.HasValue && !temperature.HasValue && (!wear.HasValue || wear.Value == 0)) return null;
            return new V3Tyre { Pressure = pressure, Temperature = temperature, WearPercent = wear };
        }

        private static V3Vehicle CaptureVehicle(PluginManager manager, IrSdkImage directSdk)
        {
            const string prefix = "DataCorePlugin.GameData.NewData.";
            var pressureUnit = GetNullableString(manager, prefix + "TyrePressureUnit");
            if (pressureUnit != "psi" && pressureUnit != "kPa" && pressureUnit != "bar") pressureUnit = null;
            var temperatureUnit = GetNullableString(manager, prefix + "TemperatureUnit");
            if (temperatureUnit == "°C") temperatureUnit = "C";
            if (temperatureUnit == "°F") temperatureUnit = "F";
            if (temperatureUnit != "C" && temperatureUnit != "F") temperatureUnit = null;
            var gear = GetNullableString(manager, prefix + "Gear");
            int gearNumber;
            if (gear != "R" && gear != "N" && (!int.TryParse(gear, out gearNumber) || gearNumber < 0 || gearNumber > 99)) gear = null;
            return new V3Vehicle {
                SpeedKph = VehicleNumber(manager, "SpeedKmh", 600),
                ThrottlePct = VehicleNumber(manager, "Throttle", 100),
                BrakePct = VehicleNumber(manager, "Brake", 100),
                Rpm = VehicleNumber(manager, "Rpms", 30000), Gear = gear,
                Sector1Seconds = NormalizeTiming(GetNullableSeconds(manager, prefix + "Sector1LastLapTime")),
                Sector2Seconds = NormalizeTiming(GetNullableSeconds(manager, prefix + "Sector2LastLapTime")),
                Sector3Seconds = NormalizeTiming(GetNullableSeconds(manager, prefix + "Sector3LastLapTime")),
                TyreDataMode = "last_available", PressureUnit = pressureUnit, TemperatureUnit = temperatureUnit,
                FrontLeft = CaptureTyre(manager, "FrontLeft"), FrontRight = CaptureTyre(manager, "FrontRight"),
                RearLeft = CaptureTyre(manager, "RearLeft"), RearRight = CaptureTyre(manager, "RearRight"),
                // 0.7.2.0: alleen uit de directe SDK-lezer. Zonder lezer, zonder iRacing of
                // met de instelling uit blijven deze velden null en valt het blok volledig
                // weg (EmitDefaultValue=false) — de payload blijft dan byte-identiek.
                // De SDK levert rad en m/s²; de wire-contracten zijn graden en g.
                // Geen wielsnelheid: iRacing heeft geen snelheidskanaal per wiel.
                BrakeLinePressureBar = CaptureWheelValues(directSdk, IrSdkChannels.BrakeLinePressure, 1, 0, 250, 1),
                SteeringWheelAngleDeg = DirectSdkNumber(directSdk, IrSdkChannels.SteeringWheelAngle, IrSdkUnits.RadiansToDegrees, -900, 900, 1),
                LatAccelG = DirectSdkNumber(directSdk, IrSdkChannels.LatAccel, 1.0 / IrSdkUnits.StandardGravity, -10, 10, 3),
                LongAccelG = DirectSdkNumber(directSdk, IrSdkChannels.LongAccel, 1.0 / IrSdkUnits.StandardGravity, -10, 10, 3)
            };
        }

        /// <summary>
        /// Snapshot van de iRacing-shared-memory voor deze tick, of null. Eén snapshot per
        /// aanroep; de instelling staat standaard aan (ontbrekende sleutel = aan). Elke
        /// fout (map weg, sim uit, geen rechten) wordt hier afgevangen: nooit een exception
        /// in het verzendpad.
        /// </summary>
        private IrSdkImage ReadDirectSdk()
        {
            var reader = _irSdk;
            if (reader == null) return null;
            try
            {
                bool enabled;
                lock (_settingsGate) enabled = Settings == null || Settings.IrSdkDirectRead;
                if (!enabled) return null;
                return reader.Snapshot();
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM iRacing-SDK: lezing mislukt (niet-blokkerend): " + error.Message);
                return null;
            }
        }

        /// <summary>
        /// Eén numeriek SDK-kanaal, omgerekend naar de wire-eenheid en binnen
        /// [minimum, maximum] van die eenheid. Buiten de grens of onleesbaar = null;
        /// 0 blijft een echte meting (stilstaand wiel, geen remdruk).
        /// </summary>
        private static double? DirectSdkNumber(IrSdkImage image, string channel, double factor, double minimum, double maximum, int decimals)
        {
            if (image == null || string.IsNullOrEmpty(channel)) return null;
            var value = image.ReadNumber(channel);
            if (!value.HasValue) return null;
            var converted = value.Value * factor;
            if (double.IsNaN(converted) || double.IsInfinity(converted)) return null;
            if (converted < minimum || converted > maximum) return null;
            return RoundTyreValue(converted, decimals);
        }

        /// <summary>Vier hoeken uit vier kanalen; null als geen enkele hoek een meting had.</summary>
        private static V3WheelValues CaptureWheelValues(IrSdkImage image, string[] channels, double factor, double minimum, double maximum, int decimals)
        {
            if (image == null || channels == null || channels.Length < 4) return null;
            var values = new V3WheelValues
            {
                FrontLeft = DirectSdkNumber(image, channels[0], factor, minimum, maximum, decimals),
                FrontRight = DirectSdkNumber(image, channels[1], factor, minimum, maximum, decimals),
                RearLeft = DirectSdkNumber(image, channels[2], factor, minimum, maximum, decimals),
                RearRight = DirectSdkNumber(image, channels[3], factor, minimum, maximum, decimals),
            };
            if (!values.FrontLeft.HasValue && !values.FrontRight.HasValue && !values.RearLeft.HasValue && !values.RearRight.HasValue) return null;
            return values;
        }

        private const double MinAmbientTempC = -40.0;
        private const double MaxAmbientTempC = 100.0;

        /// <summary>
        /// Bouwt het optionele bandenblok. Geeft null terug als er niets te melden is: een
        /// leeg blok is duurder dan geen blok (EmitDefaultValue=false doet de rest).
        /// </summary>
        private V3Tyres CaptureTyres(RawChannelReader channels, double? sessionTimeSeconds, int? lap, bool? inPitLaneProperty)
        {
            var reading = TyreZoneReader.Read(channels);
            var setsUsed = channels.ReadInt("TireSetsUsed", 0, 255);
            // Dezelfde waarneming als track.onPitRoad: ruwe OnPitRoad eerst, de
            // pitlane-property als vangnet. De tracker krijgt "onbekend" als false, want
            // zonder waarneming is er geen pit-flank; dat raakt de payload niet.
            var onPitRoad = CaptureValueRules.OnPitRoad(channels.ReadBool("OnPitRoad"), inPitLaneProperty);
            _tyreTracker.Update(reading, sessionTimeSeconds, lap, setsUsed, onPitRoad == true, DateTime.UtcNow);

            var last = _tyreTracker.Last;
            var wear = ToTyreZones(last == null ? null : last.WearPercent, 2);
            var carcass = ToTyreZones(last == null ? null : last.CarcassTempC, 1);

            var sets = new V3TyreSets
            {
                Used = setsUsed,
                // 255 = onbeperkt volgens de SDK; de plugin interpreteert dat niet.
                Available = channels.ReadInt("TireSetsAvailable", 0, 255),
                FrontLeft = channels.ReadInt("LFTiresUsed", 0, 255),
                FrontRight = channels.ReadInt("RFTiresUsed", 0, 255),
                RearLeft = channels.ReadInt("LRTiresUsed", 0, 255),
                RearRight = channels.ReadInt("RRTiresUsed", 0, 255),
            };
            if (!sets.Used.HasValue && !sets.Available.HasValue && !sets.FrontLeft.HasValue
                && !sets.FrontRight.HasValue && !sets.RearLeft.HasValue && !sets.RearRight.HasValue) sets = null;

            // TrackTempCrew is de bron; TrackTemp is de gedeprecieerde naam met dezelfde waarde.
            var trackTemp = RoundTyreValue(channels.ReadNumber("TrackTempCrew", MinAmbientTempC, MaxAmbientTempC), 1);
            if (!trackTemp.HasValue) trackTemp = RoundTyreValue(channels.ReadNumber("TrackTemp", MinAmbientTempC, MaxAmbientTempC), 1);
            var airTemp = RoundTyreValue(channels.ReadNumber("AirTemp", MinAmbientTempC, MaxAmbientTempC), 1);
            var rubberState = ReadRubberState(channels);
            V3TyreEnvironment environment = null;
            if (trackTemp.HasValue || airTemp.HasValue || rubberState != null)
                environment = new V3TyreEnvironment { TrackTempC = trackTemp, AirTempC = airTemp, RubberState = rubberState };

            var compoundId = channels.ReadInt("PlayerTireCompound", 0, 255);
            var pitEntry = BuildTyrePitEntry(_tyreTracker.PitEntry);

            if (wear == null && carcass == null && sets == null && environment == null && compoundId == null && pitEntry == null) return null;
            return new V3Tyres
            {
                ObservedAt = last != null ? last.ObservedAt : TyreSnapshotTracker.UtcText(DateTime.UtcNow),
                SessionTimeSeconds = last != null ? last.SessionTimeSeconds : sessionTimeSeconds,
                Lap = last != null ? last.Lap : lap,
                Trigger = last != null ? last.Trigger : "session_start",
                WearPercent = wear,
                CarcassTempC = carcass,
                Sets = sets,
                CompoundId = compoundId,
                Environment = environment,
                PitEntry = pitEntry,
            };
        }

        /// <summary>
        /// Rubber state komt uit de sessie-YAML, niet uit de telemetrie: property-pad met
        /// SessionNum als index, dan reflectie op dezelfde lijst.
        /// </summary>
        private static string ReadRubberState(RawChannelReader channels)
        {
            var sessionIndex = channels.ReadInt("SessionNum", 0, 1000);
            if (!sessionIndex.HasValue) sessionIndex = 0;
            // Route A gebeurt in de lezer zelf niet voor dit pad (het is geen kanaal), dus
            // hier bewust via ReadSessionText (route B) en dat is de bewezen route voor YAML.
            return NormalizeRubberState(channels.ReadSessionText(sessionIndex.Value, "SessionTrackRubberState"));
        }

        /// <summary>
        /// De validator accepteert 1–24 tekens uit [A-Za-z ] en geen vaste lijst: een
        /// verkeerde enum zou het hele frame laten vallen. We toetsen dus de vorm.
        /// </summary>
        private static string NormalizeRubberState(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var text = value.Trim();
            if (text.Length < 1 || text.Length > 24) return null;
            foreach (var character in text)
            {
                var letter = (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
                if (!letter && character != ' ') return null;
            }
            return text;
        }

        private static V3TyrePitEntry BuildTyrePitEntry(TyreSnapshot snapshot)
        {
            if (snapshot == null) return null;
            var wear = ToTyreZones(snapshot.WearPercent, 2);
            var carcass = ToTyreZones(snapshot.CarcassTempC, 1);
            if (wear == null && carcass == null) return null;
            return new V3TyrePitEntry
            {
                ObservedAt = snapshot.ObservedAt,
                SessionTimeSeconds = snapshot.SessionTimeSeconds,
                Lap = snapshot.Lap,
                SetsUsed = snapshot.SetsUsed,
                WearPercent = wear,
                CarcassTempC = carcass,
            };
        }

        /// <summary>
        /// Vier hoeken naar de draadvorm. Een hoek zonder enkele waarde vervalt (EmitDefaultValue),
        /// een zone zonder waarde blijft null; de array is altijd lengte 3.
        /// </summary>
        private static V3TyreZones ToTyreZones(double?[][] zones, int decimals)
        {
            if (zones == null) return null;
            var frontLeft = RoundTyreZone(zones, 0, decimals);
            var frontRight = RoundTyreZone(zones, 1, decimals);
            var rearLeft = RoundTyreZone(zones, 2, decimals);
            var rearRight = RoundTyreZone(zones, 3, decimals);
            if (frontLeft == null && frontRight == null && rearLeft == null && rearRight == null) return null;
            return new V3TyreZones { FrontLeft = frontLeft, FrontRight = frontRight, RearLeft = rearLeft, RearRight = rearRight };
        }

        private static double?[] RoundTyreZone(double?[][] zones, int corner, int decimals)
        {
            if (zones == null || corner >= zones.Length || zones[corner] == null) return null;
            var source = zones[corner];
            var result = new double?[3];
            var any = false;
            for (var zone = 0; zone < 3; zone++)
            {
                if (zone >= source.Length || !source[zone].HasValue) continue;
                result[zone] = RoundTyreValue(source[zone], decimals);
                any = any || result[zone].HasValue;
            }
            return any ? result : null;
        }

        /// <summary>
        /// Afronden op decimalen, maar via decimal: Math.Round(double, 2) levert doubles die
        /// de serializer als 95.80999999999999 uitschrijft (17 significante cijfers), en dat
        /// kost 130 B per frame plus onvoorspelbare delta's. Via decimal is de waarde exact
        /// 95.81 en blijft de payload klein en stabiel.
        /// </summary>
        private static double? RoundTyreValue(double? value, int decimals)
        {
            if (!value.HasValue) return null;
            if (double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return null;
            try { return (double?)Math.Round((decimal)value.Value, decimals); }
            catch (OverflowException) { return null; }
        }

        /// <summary>
        /// Het optionele herkomstblok van het V3-frame. SimHub zelf (de assembly waar
        /// PluginManager in zit) en deze plug-in zijn twee losse producten met eigen
        /// versienummers; ze door elkaar halen is precies de fout die de server tot
        /// 2026-10-31 maakte. AssemblyInformationalVersion is de versie die we
        /// publiceren; heeft een klassieke AssemblyInfo dat attribuut niet, dan valt
        /// het terug op de assemblyversie in plaats van leeg te blijven.
        /// </summary>
        private static V3Source BuildV3Source()
        {
            var source = new V3Source
            {
                SimHubVersion = VersionText(typeof(PluginManager).Assembly, 60),
                ConnectorVersion = VersionText(typeof(EnduranceConnectorPlugin).Assembly, 60),
            };
            return source.HasValues ? source : null;
        }

        /// <summary>
        /// Versie als tekst binnen de grens die de kolom eist (1-60 tekens). Een
        /// "+&lt;commit&gt;"-achtervoegsel hoort niet in een versiekolom; te lang of leeg
        /// wordt null, want "onbekend" mag nooit een verzonnen versie worden.
        /// </summary>
        private static string VersionText(Assembly assembly, int maxLength)
        {
            if (assembly == null) return null;
            string text = null;
            var informational = Attribute.GetCustomAttribute(assembly, typeof(AssemblyInformationalVersionAttribute)) as AssemblyInformationalVersionAttribute;
            if (informational != null) text = informational.InformationalVersion;
            if (string.IsNullOrWhiteSpace(text))
            {
                var version = assembly.GetName().Version;
                text = version == null ? null : version.ToString();
            }
            if (string.IsNullOrWhiteSpace(text)) return null;
            var build = text.IndexOf('+');
            if (build > 0) text = text.Substring(0, build);
            text = text.Trim();
            return text.Length == 0 || text.Length > maxLength ? null : text;
        }

        /// <summary>Build a bounded, null-tolerant opponent snapshot from SimHub Opponents.</summary>
        internal static V3Opponent[] BuildOpponentSnapshot(GameReaderCommon.StatusDataBase snapshot)
        {
            if (snapshot?.Opponents == null) return null;
            var result = new List<V3Opponent>(MaxOpponentsPerSnapshot);
            foreach (var opponent in snapshot.Opponents)
            {
                if (opponent == null) continue;
                if (string.IsNullOrWhiteSpace(opponent.Id)) continue; // stable identity key required
                if (!opponent.IsConnected && !opponent.IsPlayer) continue; // skip stale/disconnected non-players
                var item = new V3Opponent
                {
                    Id = opponent.Id,
                    CarNumber = opponent.CarNumber,
                    DriverName = opponent.Name,
                    TeamName = opponent.TeamName,
                    CarClass = opponent.CarClass,
                    CarClassId = opponent.CarClassID,
                    Position = opponent.Position > 0 ? (int?)opponent.Position : null,
                    ClassPosition = opponent.PositionInClass > 0 ? (int?)opponent.PositionInClass : null,
                    Lap = opponent.CurrentLap.HasValue && opponent.CurrentLap.Value > 0 ? (int?)opponent.CurrentLap.Value : null,
                    LapDistancePct = Clamp01(NullableSeconds(opponent.TrackPositionPercent)),
                    // Het gat naar de speler is negatief zodra die auto voor ons zit.
                    // Niet naar nul knijpen: dan verdwijnt precies de helft van het veld.
                    GapToPlayerSeconds = SignedSeconds(opponent.GaptoPlayer),
                    // 0.7.1: het gat naar de leider stond in het contract maar bleef null.
                    // Sinds 2026-10-31 is het contract signed (-86400..86400, geen sentinel):
                    // een auto die een ronde voorligt levert een negatief getal, en de oude
                    // ClampNonNegative maakte dat null. De server accepteert het teken nu.
                    GapToLeaderSeconds = SignedSeconds(opponent.GaptoLeader),
                    LastLapSeconds = PositiveSeconds(opponent.LastLapTime),
                    BestLapSeconds = PositiveSeconds(opponent.BestLapTime),
                    InPit = opponent.IsCarInPitLane || opponent.IsCarInPit,
                    SpeedKph = PositiveNullable(opponent.Speed),
                    Connected = opponent.IsConnected,
                    IsPlayer = opponent.IsPlayer,
                };
                result.Add(item);
                if (result.Count >= MaxOpponentsPerSnapshot) break;
            }
            // Stable order by overall position (player first when tied), compact deterministic payload.
            return result
                .OrderBy(o => o.IsPlayer ? 0 : (o.Position ?? int.MaxValue))
                .ThenBy(o => o.Id, StringComparer.Ordinal)
                .Take(MaxOpponentsPerSnapshot)
                .ToArray();
        }

        private static double? Clamp01(double? value) { return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value) ? (double?)Math.Max(0, Math.Min(1, value.Value)) : null; }
        private static double? SignedSeconds(double? value) { return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value) ? value : null; }

        private static double? PositiveSeconds(TimeSpan value) { return value > TimeSpan.Zero ? (double?)value.TotalSeconds : null; }
        private static double? PositiveNullable(double? value) { return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value) && value.Value > 0 ? (double?)value.Value : null; }
        private static double? NullableSeconds(double? value) { return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value) ? (double?)value.Value : null; }

        private async Task SendAsync(TelemetryEnvelope envelope, Uri endpoint, string token, CancellationToken cancellationToken)
        {
            var attemptUtc = DateTime.UtcNow;
            var ingestResultRecorded = false;
            DiagnosticsClient diagnosticsAtAttempt;
            lock (_diagnosticsGate) diagnosticsAtAttempt = _diagnostics;
            if (diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestAttempt(attemptUtc);
            try
            {
                var body = Serialize(envelope, typeof(TelemetryEnvelope));
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                    {
                        if (diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestResult(attemptUtc, (int)response.StatusCode, response.IsSuccessStatusCode);
                        ingestResultRecorded = true;
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
                if (!ingestResultRecorded && diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestResult(attemptUtc, 0, false);
                if (Volatile.Read(ref _ending) == 0) Status = "Relayfout · " + error.Message;
            }
            finally
            {
                Volatile.Write(ref _sendBusy, 0);
            }
        }

        private async Task SendV3Async(TelemetryEnvelopeV3 envelope, Uri endpoint, string token, CancellationToken cancellationToken)
        {
            var attemptUtc = DateTime.UtcNow;
            var ingestResultRecorded = false;
            DiagnosticsClient diagnosticsAtAttempt;
            lock (_diagnosticsGate) diagnosticsAtAttempt = _diagnostics;
            if (diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestAttempt(attemptUtc);
            MeasurementBatchPlan measurementPlan = null;
            try
            {
                var coreBody = SerializeWithinBudget(envelope);
                var coreBytes = Encoding.UTF8.GetByteCount(coreBody);
                var body = coreBody;
                if (_measurementSender != null)
                {
                    // De meetserie gaat MEE in ditzelfde frame: één POST, één rate-limit. Wat
                    // niet in de batch past blijft in de outbox staan voor het volgende frame.
                    var withMeasurements = _measurementSender.BuildBody(coreBody, coreBytes, attemptUtc, out measurementPlan);
                    if (withMeasurements != null) body = withMeasurements;
                }
                string responseBody = null;
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                    {
                        if (diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestResult(attemptUtc, (int)response.StatusCode, response.IsSuccessStatusCode);
                        ingestResultRecorded = true;
                        if (!response.IsSuccessStatusCode) throw new HttpRequestException("relay HTTP " + (int)response.StatusCode);
                        // Alleen een echt gelezen antwoord kan een bevestiging per rij bevatten.
                        responseBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    }
                }
                if (Volatile.Read(ref _ending) == 0) Status = "V3 " + envelope.TransportSessionId.Substring(0, Math.Min(8, envelope.TransportSessionId.Length)) + " · seq " + envelope.Sequence;
                AcknowledgeMeasurements(measurementPlan, responseBody);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
            catch (Exception error)
            {
                if (!ingestResultRecorded && diagnosticsAtAttempt != null) diagnosticsAtAttempt.RecordIngestResult(attemptUtc, 0, false);
                MarkMeasurementAttempt(measurementPlan);
                if (Volatile.Read(ref _ending) == 0) Status = "Relayfout · " + error.Message;
            }
            finally
            {
                Volatile.Write(ref _sendBusy, 0);
            }
        }

        /// <summary>
        /// Verwerkt het ACK per rij. Alleen een geslaagde response MÉT gelezen body komt hier;
        /// nooit opruimen op de statuscode alleen — een 202 is geen leveringsbewijs. Een fout
        /// in de boekhouding mag een geslaagde POST niet als mislukt laten gelden.
        /// </summary>
        private void AcknowledgeMeasurements(MeasurementBatchPlan plan, string responseBody)
        {
            if (plan == null || !plan.HasMeasurements || string.IsNullOrEmpty(responseBody) || _measurementOutbox == null) return;
            try
            {
                var now = DateTime.UtcNow;
                var ack = MeasurementAckParser.Parse(responseBody, plan.Batch);
                var outcome = _measurementOutbox.ApplyAck(ack, now);
                // Zelfde regel als MeasurementSender.SendAsync: wat niet per rij bevestigd is,
                // blijft staan en gaat met backoff opnieuw. "stored:true" terwijl er rijen uit
                // deze batch blijven staan is geen levering.
                var remaining = new List<OutboxEntry>(plan.Batch.Events.Count + plan.Batch.Laps.Count);
                foreach (var entry in plan.Batch.Events)
                    if (_measurementOutbox.Contains(entry.Uid)) remaining.Add(entry);
                foreach (var entry in plan.Batch.Laps)
                    if (_measurementOutbox.Contains(entry.Uid)) remaining.Add(entry);
                var stored = outcome.Stored && remaining.Count == 0;
                _measurementOutbox.MarkAttempt(remaining, now, !stored);
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM meetlaag: ACK niet verwerkt, rijen blijven staan: " + error.Message);
            }
        }

        /// <summary>
        /// Mislukte POST: de rijen blijven staan en gaan met backoff opnieuw. Zonder deze
        /// stap zou dezelfde batch elk interval opnieuw de deur uit gaan.
        /// </summary>
        private void MarkMeasurementAttempt(MeasurementBatchPlan plan)
        {
            if (plan == null || !plan.HasMeasurements || _measurementOutbox == null) return;
            try
            {
                var sent = new List<OutboxEntry>(plan.Batch.Events.Count + plan.Batch.Laps.Count);
                sent.AddRange(plan.Batch.Events);
                sent.AddRange(plan.Batch.Laps);
                _measurementOutbox.MarkAttempt(sent, DateTime.UtcNow, true);
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM meetlaag: poging niet vastgelegd: " + error.Message);
            }
        }

        // Budgetcheck (0.7.0). Het bandenblok duwt een vol veld richting de 24.576-grens van
        // de relay, dus we meten het echte frame en snoeien in vaste volgorde: eerst karkas
        // (ook in pitEntry), dan het pitEntry-anker. Wat weg is blijft weg in dit frame; de
        // volgende tick begint weer met een verse capture, dus dit is geen blijvende schade.
        private static string SerializeWithinBudget(TelemetryEnvelopeV3 envelope)
        {
            var body = Serialize(envelope, typeof(TelemetryEnvelopeV3));
            var bytes = Encoding.UTF8.GetByteCount(body);
            if (bytes <= MaxPayloadBytes) return body;

            var trimmed = false;
            if (envelope.Tyres != null && (envelope.Tyres.CarcassTempC != null
                || (envelope.Tyres.PitEntry != null && envelope.Tyres.PitEntry.CarcassTempC != null)))
            {
                envelope.Tyres.CarcassTempC = null;
                if (envelope.Tyres.PitEntry != null) envelope.Tyres.PitEntry.CarcassTempC = null;
                body = Serialize(envelope, typeof(TelemetryEnvelopeV3));
                trimmed = true;
                if (Encoding.UTF8.GetByteCount(body) <= MaxPayloadBytes)
                {
                    LogBudgetTrim(bytes, Encoding.UTF8.GetByteCount(body), "karkas");
                    return body;
                }
            }
            if (envelope.Tyres != null && envelope.Tyres.PitEntry != null)
            {
                envelope.Tyres.PitEntry = null;
                body = Serialize(envelope, typeof(TelemetryEnvelopeV3));
                LogBudgetTrim(bytes, Encoding.UTF8.GetByteCount(body), trimmed ? "karkas+pitEntry" : "pitEntry");
            }
            return body;
        }

        private static void LogBudgetTrim(int before, int after, string stage)
        {
            try
            {
                SimHub.Logging.Current.Info("3SM payloadbudget: " + before + " B > " + MaxPayloadBytes + " B, gesnoeid (" + stage + ") naar " + after + " B");
            }
            catch { }
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

        private static async Task DownloadUpdateAsync(Uri downloadUri, string destination, int maxBytes, CancellationToken cancellationToken)
        {
            try
            {
                using (var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(45) })
                using (var request = new HttpRequestMessage(HttpMethod.Get, downloadUri))
                using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) throw new HttpRequestException("download HTTP " + (int)response.StatusCode);
                    if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value > maxBytes)
                        throw new HttpRequestException("updatebestand is te groot");

                    using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        var buffer = new byte[81920];
                        var total = 0;
                        while (true)
                        {
                            var read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false);
                            if (read == 0) break;
                            total += read;
                            if (total > maxBytes) throw new HttpRequestException("updatebestand is te groot");
                            await output.WriteAsync(buffer, 0, read, cancellationToken).ConfigureAwait(false);
                        }
                        if (total == 0) throw new HttpRequestException("updatebestand is leeg");
                        await output.FlushAsync(cancellationToken).ConfigureAwait(false);
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

        // Test-seam-friendly sleutelbron: productiebuild retourneert ALTIJD de echte public key,
        // ongeacht welke definities er zijn. Alleen een test-only define (RSA_TEST_KEY) laat een
        // test-RSA-key toe en die define wordt NOOIT in een Release-build actief gezet.
        private static string GetReleasePublicKeyXml()
        {
#if RSA_TEST_KEY
            // TEST-ONLY: deze define wordt uitsluitend in test-builds gezet (niet in Release).
            return @"<RSAKeyValue><Modulus>lhXlfzwFlm1RkUvcn0gNPDOS9X1B+k599ZvUgVuLsslkEuaWJWTkRx369mMM761dFhC2oagIwASuD5vUJRtFwA/BZBAmsrs+1ld3uBFjgrOnW+aXxTncCKj61yJN38fWFIipYgCQCPjblC4FeV9rfTk9JoPnSvgykH0EP4bYiWzAN4rF95V9Ki84wBLa3U38Eo0lpENE52p3/X9mTZlv/vQnS0vyYDK/N5xR8XYSu01beIoZtB5cAOGXbpcTIcy9ToKgD+wF+LsTD4pF37mqz4WXkeaJ83S/1UVLGft64w+ImfiiHmN53sF5ONMMMZK68sHJU2X+gxMFTEbFz3y1Mw==</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
#else
            return ReleasePublicKeyXml;
#endif
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
                    rsa.FromXmlString(GetReleasePublicKeyXml());
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
            using (var algorithm = SHA256.Create())
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                var bytes = algorithm.ComputeHash(stream);
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var item in bytes) builder.Append(item.ToString("x2"));
                return builder.ToString();
            }
        }

        private static bool FixedTimeEquals(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            var difference = 0;
            for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }

        private static void ExtractUpdater(string destination)
        {
            const string resourceName = "ThreeSM.EnduranceConnector.Assets.3SM.EnduranceConnector.Updater.exe";
            using (var input = typeof(EnduranceConnectorPlugin).Assembly.GetManifestResourceStream(resourceName))
            {
                if (input == null) throw new InvalidOperationException("De embedded 3SM-updater ontbreekt.");
                using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None)) input.CopyTo(output);
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
        private static bool? GetNullableBool(PluginManager manager, string property) { return NullableBool(GetRaw(manager, property)); }
        private static bool GetBool(PluginManager manager, string property, bool fallback) { var value = GetRaw(manager, property); if (value is bool) return (bool)value; bool parsed; if (value != null && bool.TryParse(value.ToString(), out parsed)) return parsed; int integer; return value != null && int.TryParse(value.ToString(), out integer) ? integer != 0 : fallback; }
        private static int? PositiveOrNull(int value) { return value > 0 ? (int?)value : null; }
        private static int? NonNegativeOrNull(int? value) { return value.HasValue && value.Value >= 0 ? value : null; }
        // V3/0.4.0 sentinel normalization: convert iRacing sentinel values to null so the
        // emitted v3 payload always satisfies the schema (never a fake number).
        private static double? NormalizeTimeRemaining(double? value) { if (!value.HasValue) return null; if (value.Value >= 604800.0 || value.Value < 0) return null; return value; }
        private static int? NormalizeRemainingLaps(int? value) { if (!value.HasValue) return null; if (value.Value >= 32767 || value.Value < 0) return null; return value; }
        private static double? NormalizeTiming(double? value) { if (!value.HasValue) return null; return value.Value > 0 ? value : null; }
        private static double? NormalizeLapDist(double? value) { if (!value.HasValue) return null; return (value.Value >= 0 && value.Value <= 1) ? value : null; }
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

        private void InstallOverlayTemplate(PluginManager manager)
        {
            try
            {
                var simHubDirectory = AppDomain.CurrentDomain.BaseDirectory;
                if (string.IsNullOrWhiteSpace(simHubDirectory))
                    simHubDirectory = Path.GetDirectoryName(typeof(EnduranceConnectorPlugin).Assembly.Location);
                bool installed;
                var dashboardPath = OverlayTemplateInstaller.Install(simHubDirectory, out installed);
                if (string.IsNullOrWhiteSpace(dashboardPath)) return;
                SimHub.Logging.Current.Info("3SM overlay: template " + (installed ? "geinstalleerd" : "aanwezig") + " (" + dashboardPath + ")");
                if (installed && manager != null)
                {
                    try { manager.ReloadDashboardFromPath(dashboardPath); }
                    catch { /* de dashboardlijst ververst zichzelf bij de volgende start */ }
                }
            }
            catch (Exception error)
            {
                SimHub.Logging.Current.Warn("3SM overlay: template kon niet worden geinstalleerd: " + error.Message);
            }
        }

        private void PublishOverlay(bool iRacingRunning, bool isInCar)
        {
            try
            {
                var client = _overlayClient;
                if (client == null) return;
                client.Tick(iRacingRunning, isInCar);
                var publisher = _overlayPublisher;
                if (publisher != null)
                    publisher.Publish(client.Snapshot, client.PlanAgeSeconds, client.LastError);
            }
            catch
            {
                // De overlay mag de telemetry/DataUpdate nooit onderbreken.
            }
        }
        // Leest de vlaggen van deze tick voor `session.flags`. Eén toestandloze lezer
        // (SessionFlagReader): geen panelen, geen kleuren, geen presets en geen masker op
        // displayvoorkeuren. De vlag gaat mee met de meting, niet met de weergave.
        private void PublishFlags(PluginManager manager)
        {
            try
            {
                var names = SessionFlagReader.Read(BuildFlagInput(manager));
                var previous = SessionFlagReader.Describe(_lastFlagNames);
                var current = SessionFlagReader.Describe(names);
                _lastFlagNames = names;
                if (!string.Equals(previous, current, StringComparison.Ordinal))
                    SimHub.Logging.Current.Info("3SM flags: " + current);
            }
            catch { /* vlagdetectie mag de telemetry nooit breken */ }
        }

        // Ruwe SDK-toestand -> lezer. Null betekent "bron ontbreekt" en blijft null; we
        // verzinnen geen "vlag uit".
        private static SessionFlagInput BuildFlagInput(PluginManager manager)
        {
            return new SessionFlagInput
            {
                SessionFlags = ReadSessionFlagsBitmask(manager),
                WhiteFlag = NullableBool(GetRaw(manager, "Flag_White")),
                CheckeredFlag = NullableBool(GetRaw(manager, "Flag_Checkered")),
                GreenFlag = NullableBool(GetRaw(manager, "Flag_Green")),
                DetailRed = NullableBool(GetRaw(manager, "DataCorePlugin.GameRawData.Telemetry.SessionFlagsDetails.Isred")),
                DetailYellow = NullableBool(GetRaw(manager, "DataCorePlugin.GameRawData.Telemetry.SessionFlagsDetails.Isyellow")),
                DetailService = NullableBool(GetRaw(manager, "DataCorePlugin.GameRawData.Telemetry.SessionFlagsDetails.Isservicible")),
                SlowCarAhead = NullableBool(GetRaw(manager, "IRacingExtraProperties.iRacing_SlowCarAhead")),
                SessionTypeName = GetNullableString(manager, "SessionTypeName"),
            };
        }

        // Het iRacing-bitmasker is één unsigned getal. Buiten 0..uint.MaxValue is het geen
        // meting; dan valt de lezer terug op de losse vlag-properties.
        private static uint? ReadSessionFlagsBitmask(PluginManager manager)
        {
            var value = GetNullableDouble(manager, "DataCorePlugin.GameRawData.Telemetry.SessionFlags", false);
            if (!value.HasValue || value.Value > uint.MaxValue) return null;
            return (uint)value.Value;
        }

        private static bool? NullableBool(object value)
        {
            if (value == null) return null;
            if (value is bool) return (bool)value;
            bool parsed;
            if (bool.TryParse(value.ToString(), out parsed)) return parsed;
            double number;
            if (double.TryParse(value.ToString(), out number) && !double.IsNaN(number) && !double.IsInfinity(number)) return number != 0.0;
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

        // Interne signaalfout: er loopt al een download, dus de aanroeper hoeft de FSM
        // niet terug te zetten (de andere download rondt die zelf af).
        private sealed class UpdateStageBusyException : InvalidOperationException
        {
            public UpdateStageBusyException()
                : base("Er loopt al een download van een update.")
            {
            }
        }
    }
}
