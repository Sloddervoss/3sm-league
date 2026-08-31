using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Dedicated, persistent updater-FSM state store. Shared source between the
    /// SimHub plugin connector (reads/own pre-install transitions) and the external
    /// updater process (owns install transitions), so the two processes NEVER mutate
    /// the same multi-writer ConnectorSettings.
    ///
    /// File: %LOCALAPPDATA%\3SM\EnduranceConnector\Updater\updater-state.json
    ///
    /// Hard rules:
    ///  - atomic write via a temp file + File.Replace/Move (never in-place);
    ///  - explicit schemaVersion field;
    ///  - NEVER crashes the caller on missing/corrupt data; safe defaults instead;
    ///    a corrupt file is preserved as updater-state.json.corrupt-<ts> (best-effort);
    ///  - a named mutex serializes writes from multiple processes;
    ///  - this store is ONLY the logical FSM. Physical install/recovery authority
    ///    stays in the updater journal (.3sm-journal) + last-known-good backup.
    /// </summary>
    [DataContract]
    public sealed class UpdaterState
    {
        public const int CurrentSchemaVersion = 1;
        public const string StoreFileName = "updater-state.json";

        public static readonly string[] ValidStates = new[]
        {
            "IDLE", "CHECKING", "UPDATE_AVAILABLE", "DOWNLOADING", "VERIFYING",
            "STAGED", "WAITING_FOR_RESTART", "INSTALLING", "SUCCESS", "FAILED"
        };

        [DataMember(Order = 1)] public int schemaVersion = CurrentSchemaVersion;
        [DataMember(Order = 2)] public string state = "IDLE";
        [DataMember(Order = 3)] public string stateChangedUtc; // null until first change
        [DataMember(Order = 4)] public string pendingUpdateVersion;
        [DataMember(Order = 5)] public string pendingStagedDll;
        [DataMember(Order = 6)] public int? pendingSimHubPid;
        [DataMember(Order = 7)] public string lastUpdateResult = "none"; // none|success|failure:<code>
        [DataMember(Order = 8)] public string lastUpdateUtc;
        [DataMember(Order = 9)] public string lastUpdateErrorCode;

        public static UpdaterState SafeDefaults()
        {
            return new UpdaterState { schemaVersion = CurrentSchemaVersion, state = "IDLE", lastUpdateResult = "none" };
        }

        public bool IsValid()
        {
            if (schemaVersion != CurrentSchemaVersion) return false;
            for (var i = 0; i < ValidStates.Length; i++)
                if (ValidStates[i] == state) return true;
            return false;
        }

        /// <summary>Indicates an earlier transaction may need recovery. Derived from
        /// (journal may exist) + FSM, NOT a stored duplicate flag. Caller still checks
        /// the actual journal file as authority.</summary>
        public bool LogicallyNeedsRecovery
        {
            get
            {
                return state == "INSTALLING" || state == "WAITING_FOR_RESTART" || state == "STAGED";
            }
        }
    }

    /// <summary>Thread- and process-safe store wrapper around UpdaterState.</summary>
    public sealed class UpdaterStateStore
    {
        private const string MutexName = @"Local\3SM.EnduranceConnector.UpdaterState";
        private static readonly object _localSync = new object();
        private static Mutex _mutex;

        private readonly string _directory;
        private readonly string _filePath;

        public UpdaterStateStore(string directory)
        {
            _directory = directory;
            _filePath = Path.Combine(directory, UpdaterState.StoreFileName);
        }

        public string FilePath { get { return _filePath; } }

        private static Mutex EnsureMutex()
        {
            if (_mutex != null) return _mutex;
            lock (_localSync)
            {
                if (_mutex == null)
                {
                    bool createdNew;
                    _mutex = new Mutex(false, MutexName, out createdNew);
                }
                return _mutex;
            }
        }

        /// <summary>Load state with safe defaults. NEVER throws; NEVER crashes the caller.
        /// Corrupt/unreadable file is preserved aside as ...corrupt-<ts> (best-effort).</summary>
        public UpdaterState Load()
        {
            string content = null;
            try
            {
                if (File.Exists(_filePath))
                    content = File.ReadAllText(_filePath, new UTF8Encoding(false));
            }
            catch
            {
                content = null; // unreadable -> safe defaults
            }

            if (string.IsNullOrWhiteSpace(content))
                return UpdaterState.SafeDefaults();

            UpdaterState parsed = null;
            Exception parseError = null;
            try
            {
                parsed = FromJson(content);
            }
            catch (Exception e) { parseError = e; }

            if (parsed == null || !parsed.IsValid())
            {
                // Preserve the corrupt file for forensic analysis, never delete silently.
                try
                {
                    var stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff");
                    File.Copy(_filePath, _filePath + ".corrupt-" + stamp, false);
                }
                catch { /* best-effort */ }
                return UpdaterState.SafeDefaults();
            }
            return parsed;
        }

        /// <summary>Atomic, mutex-guarded write. Returns true on success.</summary>
        public bool Save(UpdaterState state)
        {
            if (state == null) state = UpdaterState.SafeDefaults();
            try
            {
                Directory.CreateDirectory(_directory);
                var json = ToJson(state);
                var tmp = _filePath + ".tmp-" + Guid.NewGuid().ToString("N");
                try
                {
                    using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                    {
                        writer.Write(json);
                        writer.Flush();
                        stream.Flush(true);
                    }
                    if (File.Exists(_filePath)) File.Replace(tmp, _filePath, null, true);
                    else File.Move(tmp, _filePath);
                    return true;
                }
                finally
                {
                    try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                }
            }
            catch
            {
                return false; // never throw; safe-default on next read
            }
        }

        public bool TryUpdate(Action<UpdaterState> mutate)
        {
            Mutex mutex = EnsureMutex();
            var acquired = false;
            try
            {
                acquired = mutex.WaitOne(TimeSpan.FromSeconds(5));
                if (!acquired) return false;
                var current = Load();
                if (mutate != null) mutate(current);
                current.schemaVersion = UpdaterState.CurrentSchemaVersion;
                current.stateChangedUtc = DateTime.UtcNow.ToString("O");
                return Save(current);
            }
            catch
            {
                return false;
            }
            finally
            {
                if (acquired)
                {
                    try { mutex.ReleaseMutex(); } catch { }
                }
            }
        }

        public static string ToJson(UpdaterState state)
        {
            var serializer = new DataContractJsonSerializer(typeof(UpdaterState));
            using (var ms = new MemoryStream())
            {
                serializer.WriteObject(ms, state);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        public static UpdaterState FromJson(string json)
        {
            var serializer = new DataContractJsonSerializer(typeof(UpdaterState));
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                return (UpdaterState)serializer.ReadObject(ms);
            }
        }
    }
}