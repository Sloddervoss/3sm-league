using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Momentopname van de wachtrijtellers (thread-safe gelezen).</summary>
    public sealed class ResearchQueueCounters
    {
        public long Accepted;
        public long Written;
        public long Dropped;
        public long AuxiliaryDropped;
        public long BytesWritten;
        public int Pending;
        public string LastError;
    }

    /// <summary>
    /// Begrensde wachtrij + eigen schrijfthread voor JSONL. De telemetrythread doet alleen
    /// <see cref="TryWrite"/>: dat is een niet-blokkerende TryAdd. Is de wachtrij vol, dan
    /// telt de sample als drop en gaat de tick gewoon verder — de telemetrythread wacht
    /// nooit op schijf-I/O.
    ///
    /// Flushbeleid: na N records of T milliseconden (wat eerst komt) gaat de buffer naar het
    /// OS; bij het sluiten volgt Flush(true) zodat de laatste regels op schijf staan.
    /// </summary>
    public sealed class ResearchJsonlSink : IDisposable
    {
        public const int DefaultCapacity = 2048;
        public const int DefaultFlushEveryRecords = 64;
        public const int DefaultFlushEveryMs = 1000;
        public const int DefaultCloseTimeoutMs = 3000;

        private readonly BlockingCollection<string> _queue;
        private readonly Thread _thread;
        private readonly FileStream _stream;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly int _flushEveryRecords;
        private readonly int _flushEveryMs;
        private readonly Action<Exception> _onError;
        private readonly object _gate = new object();

        private long _accepted;
        private long _written;
        private long _dropped;
        private long _auxDropped;
        private long _bytes;
        private long _lastFlushMs;
        private int _recordsSinceFlush;
        private volatile string _lastError;
        private string _finalLine;
        private bool _closing;
        private bool _disposed;
        private volatile bool _threadFinished;

        public ResearchJsonlSink(string path, int capacity, int flushEveryRecords, int flushEveryMs, Action<Exception> onError)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("pad ontbreekt", "path");
            if (capacity <= 0) capacity = DefaultCapacity;
            Path = path;
            _flushEveryRecords = flushEveryRecords > 0 ? flushEveryRecords : DefaultFlushEveryRecords;
            _flushEveryMs = flushEveryMs > 0 ? flushEveryMs : DefaultFlushEveryMs;
            _onError = onError;

            var directory = System.IO.Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            _stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
            _queue = new BlockingCollection<string>(new ConcurrentQueue<string>(), capacity);
            _lastFlushMs = _clock.ElapsedMilliseconds;
            _thread = new Thread(Pump) { IsBackground = true, Name = "3SM research jsonl writer" };
            _thread.Start();
        }

        public string Path { get; private set; }

        /// <summary>Niet-blokkerend. False = wachtrij vol, sample is geteld als drop.</summary>
        public bool TryWrite(string line)
        {
            if (line == null || _disposed) return false;
            if (!_queue.TryAdd(line))
            {
                Interlocked.Increment(ref _dropped);
                return false;
            }
            Interlocked.Increment(ref _accepted);
            return true;
        }

        /// <summary>
        /// Hulplijn (status/samenvatting): ook niet-blokkerend, maar een volle wachtrij telt
        /// hier niet als gedropte sample — het is geen meting die verdwijnt.
        /// </summary>
        public bool TryWriteAuxiliary(string line)
        {
            if (line == null || _disposed) return false;
            if (!_queue.TryAdd(line))
            {
                Interlocked.Increment(ref _auxDropped);
                return false;
            }
            Interlocked.Increment(ref _accepted);
            return true;
        }

        public ResearchQueueCounters Counters()
        {
            return new ResearchQueueCounters
            {
                Accepted = Interlocked.Read(ref _accepted),
                Written = Interlocked.Read(ref _written),
                Dropped = Interlocked.Read(ref _dropped),
                AuxiliaryDropped = Interlocked.Read(ref _auxDropped),
                BytesWritten = Interlocked.Read(ref _bytes),
                Pending = SafeCount(),
                LastError = _lastError,
            };
        }

        public long DroppedSamples { get { return Interlocked.Read(ref _dropped); } }

        /// <summary>
        /// Zet de afsluitregel (session_end) klaar; die wordt na de laatste gewone regel
        /// geschreven, ook als de wachtrij vol staat. Dit is de enige plek waar een schrijver
        /// voorrang krijgt, en hij draait op de schrijfthread — nooit op de telemetrythread.
        /// </summary>
        public void SetFinalLine(string line)
        {
            lock (_gate) _finalLine = line;
        }

        /// <summary>Stopt met accepteren, schrijft de rest en sluit het bestand.</summary>
        public bool Close(TimeSpan timeout)
        {
            if (!_closing)
            {
                _closing = true;
                try { _queue.CompleteAdding(); }
                catch (ObjectDisposedException) { }
            }
            var milliseconds = (int)Math.Max(0, timeout.TotalMilliseconds);
            try { _thread.Join(milliseconds); }
            catch (ThreadStateException) { }
            if (!_threadFinished) _lastError = "writer_thread_still_running";
            return _threadFinished;
        }

        private int SafeCount()
        {
            try { return _queue.Count; }
            catch (ObjectDisposedException) { return 0; }
        }

        private void Pump()
        {
            try
            {
                while (true)
                {
                    string line;
                    if (!_queue.TryTake(out line, 200))
                    {
                        FlushIfDue();
                        if (_queue.IsCompleted) break;
                        continue;
                    }
                    WriteLine(line);
                }
            }
            catch (Exception error)
            {
                Report(error);
            }
            finally
            {
                string final;
                lock (_gate) final = _finalLine;
                if (final != null)
                {
                    try { WriteLine(final); }
                    catch (Exception error) { Report(error); }
                }
                try { _stream.Flush(true); }
                catch (Exception error) { Report(error); }
                try { _stream.Dispose(); }
                catch (Exception error) { Report(error); }
                _threadFinished = true;
            }
        }

        private void WriteLine(string line)
        {
            var payload = Encoding.UTF8.GetBytes(line);
            _stream.Write(payload, 0, payload.Length);
            _stream.WriteByte((byte)'\n');
            Interlocked.Add(ref _bytes, payload.Length + 1);
            Interlocked.Increment(ref _written);
            _recordsSinceFlush++;
            if (_recordsSinceFlush >= _flushEveryRecords) Flush();
        }

        private void FlushIfDue()
        {
            if (_clock.ElapsedMilliseconds - _lastFlushMs < _flushEveryMs) return;
            Flush();
        }

        private void Flush()
        {
            try { _stream.Flush(); }
            catch (Exception error) { Report(error); }
            _lastFlushMs = _clock.ElapsedMilliseconds;
            _recordsSinceFlush = 0;
        }

        private void Report(Exception error)
        {
            if (error == null) return;
            _lastError = error.GetType().Name + ": " + error.Message;
            var handler = _onError;
            if (handler == null) return;
            try { handler(error); }
            catch { /* een fout in de foutafhandeling mag de writer niet stoppen */ }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Close(TimeSpan.FromMilliseconds(DefaultCloseTimeoutMs));
        }
    }

    /// <summary>
    /// Bestandsnaamgeving: één bestand per sessie, sorteerbaar op tijd, met de sessie-ID
    /// erin zodat een bestand altijd aan precies één sessie hangt.
    /// </summary>
    public static class ResearchSessionFile
    {
        public const string Extension = ".jsonl";

        public static string FileName(string sessionId)
        {
            var safe = Sanitize(sessionId);
            return safe + Extension;
        }

        /// <summary>Kandidaatpad voor poging N (0 = de kale naam, daarna -2, -3, ...).</summary>
        public static string Candidate(string directory, string sessionId, int attempt)
        {
            var baseName = Sanitize(sessionId);
            if (attempt > 0) baseName = baseName + "-" + (attempt + 1).ToString(CultureInfo.InvariantCulture);
            var name = baseName + Extension;
            if (string.IsNullOrEmpty(directory)) return name;
            return System.IO.Path.Combine(directory, name);
        }

        private static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value)) return "research-session";
            var builder = new StringBuilder(value.Length);
            foreach (var character in value)
            {
                var safe = (character >= 'a' && character <= 'z')
                    || (character >= 'A' && character <= 'Z')
                    || (character >= '0' && character <= '9')
                    || character == '-' || character == '_';
                builder.Append(safe ? character : '-');
            }
            return builder.ToString();
        }
    }
}
