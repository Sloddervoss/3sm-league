using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Instellingen van de recorder; alles met een veilige default.</summary>
    public sealed class ResearchRecorderOptions
    {
        public int QueueCapacity = ResearchJsonlSink.DefaultCapacity;
        public int FlushEveryRecords = ResearchJsonlSink.DefaultFlushEveryRecords;
        public int FlushEveryMs = ResearchJsonlSink.DefaultFlushEveryMs;
        public int SamplingIntervalMs = ResearchContextSampler.DefaultIntervalMs;
        public int StatusEverySamples = 30;
        public double CaptureStaleAfterSeconds = ResearchContextSampler.DefaultCaptureStaleAfterSeconds;
        public double TyreFreshToleranceSeconds = ResearchTyreClassifier.DefaultFreshToleranceSeconds;
        /// <summary>Ouder dan dit en de capture-state is te oud voor flankdetectie (geen gok-events).</summary>
        public double EventStaleAfterSeconds = 5.0;
        /// <summary>SimHub-property voor snelheid als de capture ze niet levert (vehicle-blok uit).</summary>
        public string SpeedPropertyPath = ResearchPropertyPaths.SpeedProperty;
    }

    /// <summary>Wat de UI en de plugin willen weten over de lopende opname.</summary>
    public sealed class ResearchRecorderStatus
    {
        public bool Enabled;
        public bool Paused;
        public bool Recording;
        public string Path;
        public string SessionId;
        public long Samples;
        public long Events;
        public long Dropped;
        public long Bytes;
        public int Pending;
        public DateTime? StartedAtUtc;
        public string LastError;

        /// <summary>Eén regel voor het statuspaneel: opgenomen samples, wachtrij, drops, pad.</summary>
        public string Describe()
        {
            if (!Recording)
            {
                return Enabled && Paused ? "Research gepauzeerd · geen opname" : "Research staat uit · er wordt niets opgenomen";
            }
            var text = "Research loopt" + (Paused ? " (gepauzeerd)" : string.Empty)
                + " · samples " + Samples.ToString(CultureInfo.InvariantCulture)
                + " · events " + Events.ToString(CultureInfo.InvariantCulture)
                + " · wachtrij " + Pending.ToString(CultureInfo.InvariantCulture)
                + " · drops " + Dropped.ToString(CultureInfo.InvariantCulture)
                + " · " + Bytes.ToString(CultureInfo.InvariantCulture) + " B"
                + "\n" + (Path ?? "nog geen bestand");
            if (!string.IsNullOrEmpty(LastError)) text += "\nLaatste fout: " + LastError;
            return text;
        }
    }

    /// <summary>Alles wat de plugin bij de start van een sessie aanlevert (zonder namen).</summary>
    public sealed class ResearchSessionStart
    {
        public string PluginVersion;
        public string SimHubVersion;
        public string Simulator;
        public string SimulatorVersion;
        public string TrackName;
        public string TrackConfig;
        public int? TrackId;
        public string CarId;
        public string CarName;
        public string TransportSessionId;
        /// <summary>Ruwe rijders-ID (bv. iRacing cust_id). Wordt alleen gehasht, nooit opgeslagen.</summary>
        public string DriverId;
        public int CaptureIntervalMs;
    }

    /// <summary>
    /// De ResearchRecorder: een dunne laag bovenop de bestaande capture. Hij leest zelf niets
    /// wat de capture al heeft, schrijft JSONL via een begrensde wachtrij op een eigen thread
    /// en houdt per veld de herkomst bij. Staat hij uit, dan doet hij niets: geen bestand,
    /// geen property-read, geen verandering aan de bestaande capture of het verzenden.
    /// </summary>
    public sealed class ResearchRecorder : IDisposable
    {
        public const string DefaultFolderName = "research";

        private readonly object _gate = new object();
        private readonly ResearchRecorderOptions _options;
        private readonly Action<Exception> _onError;
        private readonly Func<DateTime> _clock;
        private readonly ResearchContextSampler _sampler;
        private readonly ResearchEventDetector _detector = new ResearchEventDetector();

        private ResearchJsonlSink _sink;
        private ResearchCaptureView _capture = ResearchCaptureView.None();
        private ResearchSessionStart _start;
        private string _salt;
        private string _sessionId;
        private DateTime _startedAtUtc;
        private long _samples;
        private long _events;
        private long _samplesSinceStatus;
        private bool _paused;
        private bool _enabled;
        private int _captureIntervalMs = 1000;
        private string _lastError;

        public ResearchRecorder(string rootDirectory, ResearchRecorderOptions options, Action<Exception> onError, Func<DateTime> clock)
        {
            RootDirectory = string.IsNullOrEmpty(rootDirectory) ? DefaultRootDirectory() : rootDirectory;
            _options = options ?? new ResearchRecorderOptions();
            _onError = onError;
            _clock = clock ?? (() => DateTime.UtcNow);
            _sampler = new ResearchContextSampler(_options.SamplingIntervalMs, _options.SpeedPropertyPath);
        }

        public static string DefaultRootDirectory()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "3SM", "EnduranceConnector", DefaultFolderName);
        }

        public string RootDirectory { get; private set; }

        public bool Enabled { get { lock (_gate) return _enabled; } }

        public bool Paused { get { lock (_gate) return _paused; } }

        public bool IsRecording { get { lock (_gate) return _sink != null; } }

        public string CurrentFilePath { get { lock (_gate) return _sink == null ? null : _sink.Path; } }

        public string CurrentSessionId { get { lock (_gate) return _sessionId; } }

        /// <summary>
        /// Start een nieuwe sessie (nieuw bestand, nieuwe kopregel). False + error bij een
        /// onbruikbare map of bestand; de recorder blijft dan uit en de plugin werkt door.
        /// </summary>
        public bool Enable(ResearchSessionStart start, out string error)
        {
            error = null;
            lock (_gate)
            {
                if (_sink != null) return true;
                _start = start ?? new ResearchSessionStart();
                try
                {
                    Directory.CreateDirectory(RootDirectory);
                    _salt = LoadOrCreateSalt();
                    _startedAtUtc = _clock().ToUniversalTime();
                    _sessionId = ResearchIdentity.NewSessionId(_startedAtUtc);

                    var header = new ResearchSessionHeader
                    {
                        PluginVersion = _start.PluginVersion,
                        SimHubVersion = _start.SimHubVersion,
                        Simulator = _start.Simulator,
                        SimulatorVersion = _start.SimulatorVersion,
                        TrackName = _start.TrackName,
                        TrackConfig = _start.TrackConfig,
                        TrackId = _start.TrackId,
                        CarId = _start.CarId,
                        CarName = _start.CarName,
                        SessionId = _sessionId,
                        TransportSessionId = _start.TransportSessionId,
                        StartedAtUtc = _startedAtUtc,
                        SamplingIntervalMs = _sampler.IntervalMs,
                        CaptureIntervalMs = _start.CaptureIntervalMs,
                        DriverPseudoId = ResearchIdentity.Pseudonym(_start.DriverId, _salt),
                        QueueCapacity = _options.QueueCapacity,
                    };

                    _sink = OpenSink(_sessionId);
                    _samples = 0;
                    _events = 0;
                    _samplesSinceStatus = 0;
                    _paused = false;
                    _enabled = true;
                    _captureIntervalMs = _start.CaptureIntervalMs > 0 ? _start.CaptureIntervalMs : 1000;
                    _detector.Reset();
                    _sampler.Reset();
                    _capture = ResearchCaptureView.None();

                    // De kopregel gaat als eerste door dezelfde wachtrij, zodat de volgorde
                    // in het bestand gegarandeerd is.
                    if (!_sink.TryWrite(ResearchJsonl.Header(header)))
                    {
                        // Kan alleen als de wachtrij direct vol zit (capacity <= 0); dan is er
                        // geen bestand zonder kop en stoppen we netjes.
                        var broken = _sink;
                        _sink = null;
                        _enabled = false;
                        broken.Dispose();
                        error = "kopregel kon niet in de wachtrij";
                        return false;
                    }
                    return true;
                }
                catch (Exception failure)
                {
                    _sink = null;
                    _enabled = false;
                    error = failure.Message;
                    Report(failure);
                    return false;
                }
            }
        }

        /// <summary>Handmatig uit: schrijft de afsluitregel en sluit het bestand.</summary>
        public void Disable(string reason)
        {
            lock (_gate)
            {
                CloseSessionLocked(reason ?? "user_disabled");
                _enabled = false;
            }
        }

        public void Pause()
        {
            lock (_gate)
            {
                if (_sink == null) return;
                _paused = true;
                WriteStatusLocked();
            }
        }

        public void Resume()
        {
            lock (_gate)
            {
                if (_sink == null) return;
                _paused = false;
                WriteStatusLocked();
            }
        }

        /// <summary>Bewaart wat de bestaande capture in deze tick opleverde. Leest niets.</summary>
        public void ObserveCapture(ResearchCaptureView view)
        {
            if (view == null) return;
            lock (_gate)
            {
                if (_sink == null) return;
                _capture = view;
            }
        }

        /// <summary>
        /// Eén tick: markers detecteren en (max. 1 Hz) een sample schrijven. Geeft true als er
        /// een sample is aangeboden aan de wachtrij (ook als die als drop eindigde).
        /// </summary>
        public bool OnTick(DateTime utcNow, bool gameRunning, bool isInCar,
            IResearchChannelReader channels, out bool dropped)
        {
            dropped = false;
            lock (_gate)
            {
                if (_sink == null) return false;
                var view = _capture;
                var now = utcNow.ToUniversalTime();

                // Flankdetectie mag nooit op oude state gokken: zonder verse capture is er
                // geen betrouwbare onPitRoad/snelheid en dus geen marker.
                var viewFresh = view.Present
                    && (now - view.CapturedAtUtc.ToUniversalTime()).TotalSeconds <= _options.EventStaleAfterSeconds;
                if (gameRunning && viewFresh)
                {
                    var tick = new ResearchTick
                    {
                        AtUtc = now,
                        GameRunning = true,
                        IsInCar = isInCar,
                        SessionPhase = view.SessionPhase,
                        OnPitRoad = view.OnPitRoad,
                        SpeedKph = view.SpeedKph,
                        CompletedLaps = view.CompletedLaps,
                        SetsUsed = view.Tyres == null ? null : view.Tyres.SetsUsed,
                        SessionTimeSeconds = view.SessionTimeSeconds,
                        Sequence = view.Sequence,
                    };
                    var markers = _detector.Observe(tick);
                    if (!_paused)
                    {
                        for (var index = 0; index < markers.Count; index++) WriteEventLocked(markers[index]);
                    }
                }

                if (_paused) return false;

                if (!_sampler.ShouldSample(now))
                {
                    WriteStatusIfDueLocked();
                    return false;
                }

                ResearchTyreClassifier tyres;
                var fields = _sampler.BuildFields(now, view, _captureIntervalMs,
                    channels, _options.CaptureStaleAfterSeconds, _options.TyreFreshToleranceSeconds, out tyres);
                var line = ResearchJsonl.Sample(now, view.Present ? view.SessionTimeSeconds : null,
                    view.Present ? view.Sequence : 0, fields, _sampler.IntervalMs);

                if (!_sink.TryWrite(line))
                {
                    dropped = true;
                    _samplesSinceStatus++;
                    WriteStatusIfDueLocked();
                    return true;
                }
                _samples++;
                _samplesSinceStatus++;
                WriteStatusIfDueLocked();
                return true;
            }
        }

        /// <summary>Handmatige, herhaalbare marker vanuit de UI.</summary>
        public bool Mark(ResearchEventKind kind, string note)
        {
            lock (_gate)
            {
                if (_sink == null) return false;
                var view = _capture;
                var tick = new ResearchTick
                {
                    AtUtc = _clock().ToUniversalTime(),
                    GameRunning = true,
                    OnPitRoad = view.OnPitRoad,
                    SpeedKph = view.SpeedKph,
                    SessionTimeSeconds = view.SessionTimeSeconds,
                    Sequence = view.Sequence,
                };
                var marker = ResearchEventDetector.Manual(kind, note, tick);
                WriteEventLocked(marker);
                return true;
            }
        }

        /// <summary>iRacing stopt of SimHub sluit: marker + nette afsluiting, nieuw bestand volgende sessie.</summary>
        public void EndSession(string reason)
        {
            lock (_gate)
            {
                if (_sink == null) return;
                var view = _capture;
                WriteEventLocked(new ResearchEventMarker
                {
                    Kind = ResearchEventKind.SessionEnd,
                    Source = ResearchEventNames.SourceAuto,
                    AtUtc = _clock().ToUniversalTime(),
                    SessionTimeSeconds = view.SessionTimeSeconds,
                    Sequence = view.Sequence,
                }.Add("reason", reason ?? "session_end"));
                CloseSessionLocked(reason ?? "session_end");
            }
        }

        public ResearchRecorderStatus Status()
        {
            lock (_gate) return StatusLocked();
        }

        /// <summary>
        /// Verwijdert alle lokale researchdata (naam van de map blijft staan tot hij leeg is).
        /// Alleen op een expliciete gebruikersactie; de recorder stopt eerst.
        /// </summary>
        public int DeleteLocalData(out string error)
        {
            error = null;
            lock (_gate)
            {
                CloseSessionLocked("user_delete");
                _enabled = false;
                var deleted = 0;
                try
                {
                    if (Directory.Exists(RootDirectory))
                    {
                        foreach (var file in Directory.GetFiles(RootDirectory, "*" + ResearchSessionFile.Extension))
                        {
                            File.Delete(file);
                            deleted++;
                        }
                        var saltPath = Path.Combine(RootDirectory, ResearchIdentity.SaltFileName);
                        if (File.Exists(saltPath))
                        {
                            File.Delete(saltPath);
                            deleted++;
                        }
                        if (Directory.GetFiles(RootDirectory).Length == 0 && Directory.GetDirectories(RootDirectory).Length == 0)
                        {
                            Directory.Delete(RootDirectory, false);
                        }
                    }
                    _salt = null;
                    _sessionId = null;
                }
                catch (Exception failure)
                {
                    error = failure.Message;
                    Report(failure);
                }
                return deleted;
            }
        }

        /// <summary>
        /// Kopieert één sessiebestand naar een door de gebruiker gekozen pad. Expliciete actie:
        /// de recorder exporteert nooit vanzelf. Het bestand bevat alleen de pseudonieme
        /// rijders-ID; de salt blijft lokaal.
        /// </summary>
        public bool Export(string destinationFile, out string error, out string exportedFrom)
        {
            error = null;
            exportedFrom = null;
            lock (_gate)
            {
                var source = _sink == null ? LatestSessionFileLocked() : _sink.Path;
                if (string.IsNullOrEmpty(source) || !File.Exists(source))
                {
                    error = "geen opgenomen sessie gevonden";
                    return false;
                }
                try
                {
                    var directory = Path.GetDirectoryName(destinationFile);
                    if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                    // FileShare.Read: de recorder mag ondertussen doorschrijven (bestand blijft leesbaar).
                    using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    using (var output = new FileStream(destinationFile, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        input.CopyTo(output);
                    }
                    exportedFrom = source;
                    return true;
                }
                catch (Exception failure)
                {
                    error = failure.Message;
                    Report(failure);
                    return false;
                }
            }
        }

        public string LatestSessionFile()
        {
            lock (_gate) return _sink == null ? LatestSessionFileLocked() : _sink.Path;
        }

        public IList<string> ListSessionFiles()
        {
            lock (_gate) return ListSessionFilesLocked();
        }

        public void Dispose()
        {
            lock (_gate)
            {
                if (_sink != null) CloseSessionLocked("plugin_shutdown");
            }
        }

        // ---------- intern ----------

        private ResearchJsonlSink OpenSink(string sessionId)
        {
            Exception last = null;
            for (var attempt = 0; attempt < 16; attempt++)
            {
                var path = ResearchSessionFile.Candidate(RootDirectory, sessionId, attempt);
                try
                {
                    return new ResearchJsonlSink(path, _options.QueueCapacity, _options.FlushEveryRecords,
                        _options.FlushEveryMs, Report);
                }
                catch (IOException failure)
                {
                    last = failure;
                }
            }
            throw last ?? new IOException("kon geen researchbestand aanmaken");
        }

        private string LoadOrCreateSalt()
        {
            var path = Path.Combine(RootDirectory, ResearchIdentity.SaltFileName);
            try
            {
                if (File.Exists(path))
                {
                    var existing = File.ReadAllText(path).Trim();
                    if (existing.Length >= 16) return existing;
                }
                var salt = ResearchIdentity.NewSalt();
                File.WriteAllText(path, salt, new UTF8Encoding(false));
                return salt;
            }
            catch (Exception failure)
            {
                // Zonder salt geen pseudoniem: dan liever niet opnemen dan een ID met naam.
                Report(failure);
                throw;
            }
        }

        private void WriteEventLocked(ResearchEventMarker marker)
        {
            if (_sink == null || marker == null) return;
            var line = ResearchJsonl.Event(marker.AtUtc, marker.SessionTimeSeconds, marker.Sequence,
                ResearchEventNames.ToWire(marker.Kind), marker.Source, marker.Data);
            if (_sink.TryWrite(line)) _events++;
        }

        private void WriteStatusIfDueLocked()
        {
            if (_options.StatusEverySamples <= 0) return;
            if (_samplesSinceStatus < _options.StatusEverySamples) return;
            WriteStatusLocked();
        }

        private void WriteStatusLocked()
        {
            if (_sink == null) return;
            _samplesSinceStatus = 0;
            var counters = _sink.Counters();
            var line = ResearchJsonl.Status(_clock().ToUniversalTime(), counters.Written, counters.Pending,
                counters.Dropped, _paused);
            // Statusregels zijn hulpinformatie: als de wachtrij vol zit tellen ze niet als
            // gedropte sample en blokkeren ze de telemetrythread niet.
            _sink.TryWriteAuxiliary(line);
        }

        private void CloseSessionLocked(string reason)
        {
            var sink = _sink;
            if (sink == null) return;
            _sink = null;
            var counters = sink.Counters();
            var now = _clock().ToUniversalTime();
            var duration = (now - _startedAtUtc).TotalSeconds;
            if (duration < 0) duration = 0;
            sink.SetFinalLine(ResearchJsonl.SessionEnd(now, reason, _samples, _events, counters.Dropped,
                counters.BytesWritten, duration, true));
            if (!sink.Close(TimeSpan.FromMilliseconds(ResearchJsonlSink.DefaultCloseTimeoutMs)))
            {
                _lastError = "writer_thread_still_running";
                Report(new IOException("research writer stopte niet binnen de time-out"));
            }
            sink.Dispose();
            _paused = false;
        }

        private ResearchRecorderStatus StatusLocked()
        {
            var counters = _sink == null ? new ResearchQueueCounters() : _sink.Counters();
            return new ResearchRecorderStatus
            {
                Enabled = _enabled,
                Paused = _paused,
                Recording = _sink != null,
                Path = _sink == null ? null : _sink.Path,
                SessionId = _sessionId,
                Samples = _samples,
                Events = _events,
                Dropped = counters.Dropped,
                Bytes = counters.BytesWritten,
                Pending = counters.Pending,
                StartedAtUtc = _sink == null ? (DateTime?)null : _startedAtUtc,
                LastError = _lastError ?? counters.LastError,
            };
        }

        private string LatestSessionFileLocked()
        {
            var files = ListSessionFilesLocked();
            return files.Count == 0 ? null : files[files.Count - 1];
        }

        private IList<string> ListSessionFilesLocked()
        {
            var result = new List<string>();
            try
            {
                if (!Directory.Exists(RootDirectory)) return result;
                var files = Directory.GetFiles(RootDirectory, "*" + ResearchSessionFile.Extension);
                Array.Sort(files, StringComparer.Ordinal);
                foreach (var file in files) result.Add(file);
            }
            catch (Exception failure)
            {
                Report(failure);
            }
            return result;
        }

        private void Report(Exception error)
        {
            if (error == null) return;
            _lastError = error.GetType().Name + ": " + error.Message;
            var handler = _onError;
            if (handler == null) return;
            try { handler(error); }
            catch { }
        }
    }
}
