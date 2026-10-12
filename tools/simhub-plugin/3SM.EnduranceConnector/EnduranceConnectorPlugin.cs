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
        private const long MaxUpdateBytes = 5 * 1024 * 1024;
        private const string ReleasePublicKeyXml = "<RSAKeyValue><Modulus>623ziGDiaH7x+n1WwVv4lp+CswGiM4b/+h410wt1IBXZc+xeIoJbS2GnSU+wCgsUD1Ek4Eup0XKumuyuEvkZYUJ7zzLuIV5qBj9jk1lSnZmp4ibMyanmhJOIxsuSzylpNV9ru2QAuJQLpK9Jahk8vbOjSaNaaO1ZxKP0U0Xxy79N/9vutjdO6dW9r2MzQUP5KNGCTBlgHwm5Kn3KujtyV3EB5jeFbwl0L1G5R2taan6wzrcSLtNKrJACbm/bLvOijAvUAjpVH7+ThUPY/w9womXuxtWCPFT0cp7wq9rBieOEFjWxFLSkr9uZ/Z+gWyuBINrGJ7gLGuONvNq3TbqkwRmnPu91hstTQR5EfLDduohdfsRW6g+BHUNgZFo9cheM/NpJx6vpZ61Rzjw46Bu8QVCInRW7W43u4e/Xb9CjlPEf6ou8jnEeUY9ZgDOKhs7oHbDg3072GIPTc/8HJjATN6YlnTU0tqB43zElN2BrWc/aFqqTdrXce9vEEqPclWVT</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
        private readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(4) };
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly object _sendGate = new object();
        private readonly object _settingsGate = new object();
        private readonly Stopwatch _sendClock = Stopwatch.StartNew();
        private readonly Stopwatch _stintClock = new Stopwatch();
        private readonly SessionTelemetryReader _sessionTime = new SessionTelemetryReader();
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
        private readonly FlagService _flagService = new FlagService();
        private FlagPropertyPublisher _flagPublisher;
        private FlagState _lastFlagState = FlagState.Empty();
        private RaceFlags _publishedFlags = RaceFlags.None;
        private readonly RaceFlags[] _publishedBoxFlags = new RaceFlags[4];
        private long _lastFlagPublishMs;
        private string _lastLoggedFlagPrimary;
        private RaceFlags _lastDetectedFlags;
        private long _pitLimiterSinceMs;

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
            if (Settings.SchemaVersion < 4)
            {
                if (Settings.SchemaVersion < 2) Settings.UseCentralRelay = false;
                if (Settings.SchemaVersion < 4) Settings.DiagnosticsEnabled = true;
                Settings.SchemaVersion = 4;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            if (Settings.SchemaVersion < 5)
            {
                // 0.5.0: vlag-module + SimHub-property publicatie voor flagboxes/overlays.
                if (Settings.Flags == null) Settings.Flags = new FlagSettings();
                if (Settings.Flags.Boxes == null || Settings.Flags.Boxes.Length < 4)
                    Settings.Flags.Boxes = new FlagBoxSlot[] { new FlagBoxSlot(), new FlagBoxSlot(), new FlagBoxSlot(), new FlagBoxSlot() };
                Settings.SchemaVersion = 5;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            if (Settings.SchemaVersion < 6)
            {
                // 1.0.5: racige standaard-rev (groen/geel/rood) + 8 box-slots.
                var fs = Settings.Flags ?? (Settings.Flags = new FlagSettings());
                for (var i = 0; i < 8; i++)
                {
                    var b = fs.Box(i);
                    if (b.GearColour == 10 && b.CustomGearColour1 == "#FFFFFF" && b.CustomGearColour2 == "#FFFFFF")
                    {
                        b.GearColour = 2; // Racing
                        b.CustomGearColour1 = "#00E676";
                        b.CustomGearColour2 = "#FFD400";
                        b.CustomGearColour3 = "#FF1744";
                    }
                }
                Settings.SchemaVersion = 6;
                this.SaveCommonSettings("ConnectorSettings", Settings);
            }
            // Vlag-properties aanmelden zodat SimHub LED-profielen erop kunnen binden.
            _flagPublisher = new FlagPropertyPublisher(pluginManager, GetType(), Settings.Flags.PropertyPrefix);
            var flagPropertiesRegistered = _flagPublisher.Register();
            SimHub.Logging.Current.Info("3SM flags: enabled=" + Settings.Flags.Enabled + ", properties=" + flagPropertiesRegistered);
            InitUpdaterStateStore();
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
            ApplyDiagnosticsSettings();
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

                Version remoteVersion;
                if (!Version.TryParse(versionText, out remoteVersion) || remoteVersion <= this.GetType().Assembly.GetName().Version)
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
            if (!Version.TryParse(text, out parsed) || parsed <= this.GetType().Assembly.GetName().Version) return false;
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

                var localVersion = this.GetType().Assembly.GetName().Version;
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
                    if (remote > localVersion)
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
                    Interlocked.Exchange(ref _sequence, -1);
                }
                if (!running && _gameWasRunning) _stintClock.Stop();
                _gameWasRunning = running;
                // Vlaggen elke tick oplossen/publiceren (los van het verzendinterval),
                // zodat een flagbox/overlay direct reageert.
                PublishFlags(pluginManager, data, isInCar);
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
            Status = "Lokaal vergeten · trek het device ook op de 3SM-site in";
            OnPropertyChanged("IsPaired");
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
            // Vlag komt uit de per-tick resolutie in DataUpdate (PublishFlags -> _lastFlagState).
            var flagState = _lastFlagState ?? FlagState.Empty();
            var sendFlagFields = Settings.Flags != null && Settings.Flags.SendFlagFields;
            var completedLaps = Math.Max(0, GetInt(manager, Settings.CompletedLapsProperty, 0));
            var lapTimeSeconds = GetNullableSeconds(manager, Settings.LastLapTimeProperty);
            var gapToLeader = GetNullableSeconds(manager, Settings.GapToLeaderProperty);
            // V3/0.4.0: populatie van bestaande nullable eigen-auto velden (NULL-tolerant).
            var sessionTimeRemaining = GetNullableSeconds(manager, Settings.SessionTimeRemainingProperty);
            var sessionLapsRemaining = GetNullableInt(manager, Settings.SessionLapsRemainingProperty);
            var currentLapElapsed = GetNullableSeconds(manager, Settings.CurrentLapElapsedProperty)
                ?? GetNullableSeconds(manager, "DataCorePlugin.GameData.NewData.CurrentLapTime");
            var bestLapTime = GetNullableSeconds(manager, Settings.BestLapTimeProperty);
            var lapDistancePct = GetNullableDouble(manager, Settings.LapDistancePctProperty, false)
                ?? (player == null ? null : Clamp01(NullableSeconds(player.TrackPositionPercent)));
            var fuel = Math.Max(0, GetDouble(manager, Settings.FuelProperty, 0));
            UpdateFuelStint(fuel, completedLaps);
            var incidents = NonNegativeOrNull(GetNullableInt(manager, Settings.IncidentsProperty));
            var inPitLane = GetBool(manager, Settings.PitLaneProperty, false);
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

            var flags = new List<string>();
            var legacyFlagNames = FlagService.ToLegacyNames(flagState);
            if (legacyFlagNames != null) foreach (var legacyFlagName in legacyFlagNames) flags.Add(legacyFlagName);

            int? startLights; bool isStartSequence;
            StartLightsFor(manager, out startLights, out isStartSequence);
            var sessionPhase = SessionPhaseText(manager);
            bool? pitLaneOpen = null;
            var pitsOpen = GetNullableDouble(manager, "DataCorePlugin.GameRawData.Telemetry.PitsOpen", false);
            if (pitsOpen.HasValue) pitLaneOpen = pitsOpen.Value != 0;

            return new TelemetryEnvelopeV3
            {
                ProtocolVersion = 3,
                Sequence = nextSequence,
                CapturedAt = DateTime.UtcNow.ToString("o"),
                TransportSessionId = _sessionId,
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
                    Flags = flags.Count == 0 ? null : flags.ToArray(),
                    SessionState = sessionPhase,
                    PrimaryFlag = sendFlagFields && flagState.Active ? flagState.Primary : null,
                    FlagColour = sendFlagFields && flagState.Active ? flagState.ColourHex : null,
                    FlagSeverity = sendFlagFields && flagState.Active ? (int)flagState.Severity : 0,
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
                    OnPitRoad = inPitLane,
                },
                Fuel = new V3Fuel
                {
                    FuelLitres = fuel,
                    FuelPct = null,
                    FuelPerLapLitres = _fuelPerLap > 0 ? (double?)Math.Round(_fuelPerLap, 3) : null,
                    LapsRemaining = _fuelPerLap > 0 && fuel > 0
                        ? (double?)Math.Round(fuel / _fuelPerLap, 1)
                        : (snapshot != null ? snapshot.EstimatedFuelRemaingLaps : null),
                },
                RaceState = new V3RaceState
                {
                    Incidents = incidents,
                    IncidentLimit = NonNegativeOrNull(GetNullableInt(manager, "DataCorePlugin.GameRawData.SessionData.WeekendInfo.WeekendOptions.IncidentLimit")),
                },
                PitService = new V3PitService
                {
                    PitServiceFlagsRaw = null,
                    RequiredRepairSeconds = null,
                    OptionalRepairSeconds = null,
                },
                Opponents = BuildOpponentSnapshot(snapshot),
                Vehicle = Settings.ExtendedPitwallTelemetryEnabled ? CaptureVehicle(manager) : null,
            };
        }

        private static double? VehicleNumber(PluginManager manager, string name, double maximum, bool positive = false)
        {
            var value = GetNullableDouble(manager, "DataCorePlugin.GameData.NewData." + name, positive);
            return value.HasValue && value.Value <= maximum ? value : null;
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

        private static V3Vehicle CaptureVehicle(PluginManager manager)
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
                RearLeft = CaptureTyre(manager, "RearLeft"), RearRight = CaptureTyre(manager, "RearRight")
            };
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
                    GapToPlayerSeconds = ClampNonNegative(opponent.GaptoPlayer),
                    GapToLeaderSeconds = ClampNonNegative(opponent.GaptoLeader),
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
        private static double? ClampNonNegative(double? value) { return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value) && value.Value >= 0 ? (double?)value.Value : null; }
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
            try
            {
                var body = Serialize(envelope, typeof(TelemetryEnvelopeV3));
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
                if (Volatile.Read(ref _ending) == 0) Status = "V3 " + envelope.TransportSessionId.Substring(0, Math.Min(8, envelope.TransportSessionId.Length)) + " · seq " + envelope.Sequence;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
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

        // Detecteert de vlag één keer en publiceert (getthrottled) universeel + per flagbox.
        private void PublishFlags(PluginManager manager, GameData data, bool isInCar)
        {
            try
            {
                var settings = Settings;
                var flagSettings = settings == null ? null : settings.Flags;
                var enabled = flagSettings != null && flagSettings.Enabled && _flagService != null;

                FlagState universal;
                var boxes = new FlagState[4];
                var detected = RaceFlags.None;
                if (enabled)
                {
                    var context = BuildFlagContext(manager, settings, data, isInCar);
                    detected = _flagService.Detect(context, flagSettings);
                    universal = FlagService.Present(detected, FlagService.MaskOf(flagSettings));
                    var count = Math.Max(0, Math.Min(boxes.Length, flagSettings.BoxCount));
                    for (var i = 0; i < boxes.Length; i++)
                    {
                        if (i >= count) { boxes[i] = FlagState.Empty(); continue; }
                        var slot = flagSettings.Boxes != null && i < flagSettings.Boxes.Length ? flagSettings.Boxes[i] : null;
                        var mask = slot == null || slot.FollowUniversal ? FlagService.MaskOf(flagSettings) : FlagService.MaskOf(slot);
                        boxes[i] = FlagService.Present(detected, mask);
                    }
                }
                else
                {
                    universal = FlagState.Empty();
                    for (var i = 0; i < boxes.Length; i++) boxes[i] = FlagState.Empty();
                }

                // De V3-payload leest de universele vlag (CaptureV3 -> _lastFlagState).
                _lastFlagState = universal;
                _lastDetectedFlags = detected;
                if (!string.Equals(universal.Primary, _lastLoggedFlagPrimary, StringComparison.Ordinal))
                {
                    _lastLoggedFlagPrimary = universal.Primary;
                    SimHub.Logging.Current.Info("3SM flags: " + universal.Primary);
                }

                FlagProfileWatch(manager);

                if (flagSettings == null || !flagSettings.PublishProperties || _flagPublisher == null) return;

                var now = _sendClock.ElapsedMilliseconds;
                var changed = universal.Flags != _publishedFlags;
                for (var i = 0; i < boxes.Length && !changed; i++) if (boxes[i].Flags != _publishedBoxFlags[i]) changed = true;
                if (!changed && now - _lastFlagPublishMs < 250) return;

                _publishedFlags = universal.Flags;
                for (var i = 0; i < boxes.Length; i++) _publishedBoxFlags[i] = boxes[i].Flags;
                _lastFlagPublishMs = now;
                var deviceNames = new string[boxes.Length];
                for (var i = 0; i < boxes.Length; i++)
                {
                    var slot = flagSettings.Boxes != null && i < flagSettings.Boxes.Length ? flagSettings.Boxes[i] : null;
                    deviceNames[i] = slot == null ? string.Empty : (slot.EffectiveDevice() ?? string.Empty);
                }
                _flagPublisher.PublishSettings(flagSettings);
                _flagPublisher.Publish(universal, boxes, deviceNames,
                    FlagText(universal),
                    BlueText(data, flagSettings, universal),
                    flagSettings != null ? flagSettings.BlueFlagStyle : 0,
                    flagSettings != null ? flagSettings.OverlayTheme : 0,
                    flagSettings == null || flagSettings.OverlayDarkMode,
                    flagSettings == null || flagSettings.OverlayShowAnimation);
            }
            catch { /* vlag-publicatie mag de telemetry nooit breken */ }
        }

        // Leesbare vlagtekst voor overlays.
        private static string FlagText(FlagState s)
        {
            if (s == null || !s.Active) return string.Empty;
            switch (s.Primary)
            {
                case "red": return "Rode vlag";
                case "black": return "Zwarte vlag";
                case "safetycar": return "Safety Car";
                case "vsc": return "Virtual Safety Car";
                case "fcy": return "Full Course Yellow";
                case "doubleyellow": return "Dubbelgeel";
                case "yellow": return "Gele vlag";
                case "white": return "Witte vlag";
                case "whitefinal": return "Laatste ronde";
                case "orange": return "Oranje vlag";
                case "debris": return "Debris";
                case "blue": return "Blauwe vlag";
                case "green": return "Groene vlag";
                case "checkered": return "Geruit";
                default: return s.Primary ?? string.Empty;
            }
        }

        // Blauwe-vlag tekst per stijl: klassiek / met klasse / met klasse+positie.
        private static string BlueText(GameData data, FlagSettings flags, FlagState universal)
        {
            if (universal == null || !universal.Active || !string.Equals(universal.Primary, "blue", StringComparison.Ordinal)) return string.Empty;
            var style = flags != null ? flags.BlueFlagStyle : 0;
            if (style <= 0) return "Blauwe vlag";
            var snapshot = data == null ? null : data.NewData;
            var carClass = snapshot == null ? null : snapshot.CarClass;
            var position = 0;
            if (snapshot != null && snapshot.Opponents != null)
            {
                var player = snapshot.Opponents.FirstOrDefault(o => o != null && o.IsPlayer);
                if (player != null) position = player.PositionInClass;
            }
            var text = string.IsNullOrEmpty(carClass) ? "Blauwe vlag" : ("Blauwe vlag · " + carClass);
            if (style >= 2 && position > 0) text += " · P" + position;
            return text;
        }

        // Watch: houdt het LED-profiel up-to-date (elke ~5 s) als het al bestaat.
        private string _flagWatchSignature;
        private long _flagWatchLastMs;

        private void FlagProfileWatch(PluginManager manager)
        {
            try
            {
                var flags = Settings == null ? null : Settings.Flags;
                if (flags == null || !flags.Enabled || !flags.AutoUpdateProfile) return;
                var now = _sendClock.ElapsedMilliseconds;
                if (now - _flagWatchLastMs < 5000) return;
                _flagWatchLastMs = now;

                var box = Math.Max(1, Math.Min(8, flags.ProfileBoxIndex));
                var slot = flags.Box(box - 1);
                var device = slot.EffectiveDevice();
                var kind = string.IsNullOrEmpty(flags.ProfileKind) ? "matrix" : flags.ProfileKind;
                var file = FlagProfileInstaller.SettingsFileFor(kind);
                // Alleen bijwerken als ons profiel al bestaat (nooit ongevraagd aanmaken).
                if (!SimHubLedProfileHost.HasProfile(manager, device, FlagProfileInstaller.ProfileName) && !FileHasProfile(file, FlagProfileInstaller.ProfileName)) return;

                // Een gewijzigde prefix werkt pas na een SimHub-herstart (de properties worden
                // bij het starten aangemeld). Zolang de instelling en de aangemelde prefix
                // verschillen, laten we het bestaande profiel met rust — anders zou de box
                // property-namen lezen die nog niet bestaan.
                var registeredPrefix = _flagPublisher == null ? flags.PropertyPrefix : _flagPublisher.Prefix;
                if (!string.Equals(registeredPrefix ?? string.Empty, flags.PropertyPrefix ?? string.Empty, StringComparison.Ordinal)) return;

                var signature = InstalledVersion + "|" + kind + "|" + flags.BoxCount + "|" + flags.MldCount + "|" + flags.ProfileLedCount + "|" + registeredPrefix;
                for (var i = 0; i < 8; i++)
                {
                    var b = flags.Box(i);
                    signature += "|" + (b.TargetKey ?? string.Empty) + ":" + b.MatrixPosition;
                }
                if (string.Equals(signature, _flagWatchSignature, StringComparison.Ordinal)) return;
                _flagWatchSignature = signature;

                var profile = FlagProfileInstaller.BuildProfile(flags, kind, box);
                string message;
                if (!SimHubLedProfileHost.InstallForDevice(manager, device, profile, out message))
                    FlagProfileInstaller.InstallProfile(file, profile, out message);
                SimHub.Logging.Current.Info("3SM flags: profiel automatisch bijgewerkt");
            }
            catch { /* de watch mag nooit de plugin breken */ }
        }

        private static bool FileHasProfile(string path, string name)
        {
            try
            {
                return !string.IsNullOrEmpty(path) && System.IO.File.Exists(path)
                    && System.IO.File.ReadAllText(path).IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch { return false; }
        }

        // Rev-percentage t.o.v. de echte auto-redline (RPM) uit de sim.
        private double RevPercent(PluginManager manager, FlagSettings flags)
        {
            var percent = GetDouble(manager, "DataCorePlugin.GameData.NewData.RpmsPercent", 0);
            if (percent <= 1) percent *= 100;
            if (flags != null && flags.UseGameRedline)
            {
                var redline = GetNullableDouble(manager, "DataCorePlugin.GameData.CarSettings_RedLineRPM", false) ?? 0;
                var rpm = GetDouble(manager, "DataCorePlugin.GameData.Rpms", 0);
                if (redline > 0 && rpm > 0) return Math.Max(0, Math.Min(120, rpm / redline * 100.0));
            }
            return percent;
        }

        // Live preview voor de instellingen-UI: matrix of strip, voor de gekozen box.
        internal string[] BuildFlagPreview(out int columns, out int rows)
        {
            return BuildFlagPreview(0, out columns, out rows);
        }

        internal string[] BuildFlagPreview(int boxIndex, out int columns, out int rows)
        {
            columns = 8; rows = 8;
            try
            {
                var flags = Settings != null ? Settings.Flags : null;
                var kind = flags != null && !string.IsNullOrEmpty(flags.ProfileKind) ? flags.ProfileKind : "matrix";
                var box = boxIndex > 0 ? Math.Max(1, Math.Min(8, boxIndex)) : (flags != null ? Math.Max(1, Math.Min(8, flags.ProfileBoxIndex)) : 1);
                var slot = flags != null && flags.Boxes != null && box - 1 < flags.Boxes.Length ? flags.Boxes[box - 1] : null;
                var mask = flags == null ? RaceFlags.None : (slot == null || slot.FollowUniversal ? FlagService.MaskOf(flags) : FlagService.MaskOf(slot));
                var state = FlagService.Present(_lastDetectedFlags, mask);
                var manager = PluginManager;
                var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var pct = RevPercent(manager, flags);
                var pitOn = GetBool(manager, "DataCorePlugin.GameData.NewData.PitLimiterOn", false);
                if (pitOn) { if (_pitLimiterSinceMs == 0) _pitLimiterSinceMs = nowMs; } else _pitLimiterSinceMs = 0;
                var fuelPct = GetNullableDouble(manager, "DataCorePlugin.GameData.NewData.FuelPercent", false) ?? -1;
                if (fuelPct >= 0 && fuelPct <= 1) fuelPct *= 100;
                var maxGears = GetDouble(manager, "DataCorePlugin.GameData.CarSettings_MaxGears", 0);
                int gearNum;
                var isLastGear = int.TryParse(Convert.ToString(GetRaw(manager, "DataCorePlugin.GameData.NewData.Gear")), out gearNum) && maxGears > 0 && gearNum >= (int)maxGears;
                var input = new FlagPanelRenderer.PanelInput
                {
                    Flags = state.Flags,
                    InGame = _gameWasRunning,
                    Gear = Convert.ToString(GetRaw(manager, "DataCorePlugin.GameData.NewData.Gear")),
                    RpmsPercent = pct,
                    PitLimiter = pitOn,
                    PitLimiterSeconds = _pitLimiterSinceMs == 0 ? 0 : (nowMs - _pitLimiterSinceMs) / 1000.0,
                    SpotterLeft = GetBool(manager, "DataCorePlugin.GameData.NewData.SpotterCarLeft", false),
                    SpotterRight = GetBool(manager, "DataCorePlugin.GameData.NewData.SpotterCarRight", false),
                    Warn = GetBool(manager, "DataCorePlugin.GameData.NewData.LowFuelAlert", false),
                    FuelPercent = fuelPct,
                    WaterTemp = GetNullableDouble(manager, "DataCorePlugin.GameData.NewData.WaterTemperature", false) ?? 0,
                    OilTemp = GetNullableDouble(manager, "DataCorePlugin.GameData.NewData.OilTemperature", false) ?? 0,
                    EngineOff = _gameWasRunning && pct <= 0.5,
                    IsLastGear = isLastGear,
                    NowMs = nowMs,
                };

                if (string.Equals(kind, "matrix", StringComparison.OrdinalIgnoreCase))
                {
                    columns = 8; rows = 8;
                    return FlagPanelRenderer.Frame(columns, rows, input, slot ?? (flags != null ? flags.Box(box - 1) : null), flags);
                }

                var count = flags != null ? Math.Max(1, flags.ProfileLedCount) : 8;
                columns = Math.Min(count, 24);
                rows = (count + columns - 1) / columns;
                var strip = FlagPanelRenderer.FrameStrip(count, input, slot ?? (flags != null ? flags.Box(box - 1) : null), flags);
                var padded = new string[columns * rows];
                for (var i = 0; i < padded.Length; i++) padded[i] = i < strip.Length ? strip[i] : "#000000";
                return padded;
            }
            catch { return null; }
        }

        private FlagContext BuildFlagContext(PluginManager manager, ConnectorSettings settings, GameData data, bool isInCar)
        {
            return new FlagContext
            {
                Game = data == null ? null : data.GameName,
                Snapshot = data == null ? null : data.NewData,
                GetRaw = property => GetRaw(manager, property),
                IsInCar = isInCar,
                InPitLane = GetBool(manager, settings.PitLaneProperty, false),
                FlagNameFallback = Convert.ToString(GetRaw(manager, settings.FlagProperty))
            };
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
