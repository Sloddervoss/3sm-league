using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace ThreeSM.EnduranceConnector.Updater
{
    internal static class Program
    {
        private const string PluginFileName = "3SM.EnduranceConnector.dll";
        private const string SimHubFileName = "SimHubWPF.exe";
        private const string MutexName = @"Global\3SM.EnduranceConnector.Updater";
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private static readonly string LogDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3SM", "EnduranceConnector", "Updater");
        private static readonly string LogPath = Path.Combine(LogDirectory, "updater.log");

        [STAThread]
        private static int Main(string[] args)
        {
            var silent = Array.Exists(args ?? new string[0], item => string.Equals(item, "--silent", StringComparison.OrdinalIgnoreCase));
            Mutex mutex = null;
            Process simHubProcess = null;
            var ownsMutex = false;
            try
            {
                Directory.CreateDirectory(LogDirectory);
                mutex = new Mutex(false, MutexName);
                try { ownsMutex = mutex.WaitOne(0, false); }
                catch (AbandonedMutexException) { ownsMutex = true; }
                if (!ownsMutex) throw new InvalidOperationException("Er draait al een 3SM-updater.");

                var options = ParseArguments(args);
                Log("Updater gestart.");
                var pid = ParseNonNegativeInt(Required(options, "pid"), "SimHub-proces-ID");
                var startedUtcTicks = ParseNonNegativeLong(Required(options, "started-utc-ticks"), "SimHub-starttijd");
                var target = FullPath(Required(options, "target"));
                var staged = FullPath(Required(options, "staged"));
                var expectedHash = NormalizeHash(Required(options, "sha256"));
                var installedHash = NormalizeHash(Required(options, "installed-sha256"));
                var expectedLength = ParsePositiveLong(Required(options, "length"), "bestandsgrootte");
                var expectedVersion = ParseVersion(Required(options, "version"));
                var simHubPath = FullPath(Required(options, "simhub"));
                var noRestart = options.ContainsKey("no-restart");
                var simulateFailure = options.ContainsKey("simulate-failure");
                string readyEventName;
                options.TryGetValue("ready-event", out readyEventName);

                ValidatePaths(target, staged, simHubPath);
                ValidatePayload(staged, expectedHash, expectedVersion, expectedLength);
                simHubProcess = AcquireSimHubProcess(pid, startedUtcTicks, simHubPath, noRestart);
                SignalReady(readyEventName, pid);
                WaitForSimHubExit(simHubProcess, noRestart, TimeSpan.FromMinutes(2));
                ValidatePaths(target, staged, simHubPath);
                ValidatePayload(staged, expectedHash, expectedVersion, expectedLength);
                RecoverPreviousTransaction(target, installedHash);
                if (!FixedTimeEquals(Sha256(target), installedHash))
                    throw new InvalidDataException("De geïnstalleerde DLL is gewijzigd nadat de update werd gestart.");

                Install(target, staged, installedHash, expectedHash, expectedVersion, expectedLength, simulateFailure);
                Log("Update succesvol geïnstalleerd: " + expectedVersion);

                if (!noRestart)
                {
                    try { RestartSimHub(simHubPath); }
                    catch (Exception restartError)
                    {
                        Log("Update geïnstalleerd, maar SimHub kon niet automatisch herstarten: " + restartError);
                        if (!silent)
                        {
                            MessageBox.Show(
                                "De 3SM-update is correct geïnstalleerd en de vorige DLL is als back-up behouden, maar SimHub kon niet automatisch worden gestart. Start SimHub handmatig.\n\nLog: " + LogPath,
                                "3SM-update geïnstalleerd",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Warning);
                        }
                    }
                }
                return 0;
            }
            catch (Exception error)
            {
                Log("FOUT: " + error);
                if (!silent)
                {
                    MessageBox.Show(
                        "De 3SM-update is niet geïnstalleerd. De vorige pluginversie is behouden of hersteld.\n\n" +
                        error.Message + "\n\nLog: " + LogPath,
                        "3SM-update mislukt",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                return 1;
            }
            finally
            {
                if (simHubProcess != null) simHubProcess.Dispose();
                if (ownsMutex && mutex != null)
                {
                    try { mutex.ReleaseMutex(); } catch { }
                }
                if (mutex != null) mutex.Dispose();
            }
        }

        private static void Install(string target, string staged, string installedHash, string expectedHash, Version expectedVersion, long expectedLength, bool simulateFailure)
        {
            var targetDirectory = Path.GetDirectoryName(target);
            var incoming = Path.Combine(targetDirectory, PluginFileName + ".3sm-new-" + Guid.NewGuid().ToString("N"));
            var backup = target + ".3sm-backup";
            var journal = target + ".3sm-journal";
            var replaced = false;

            try
            {
                CopyAndFlush(staged, incoming, false);
                ValidatePayload(incoming, expectedHash, expectedVersion, expectedLength);
                WriteJournal(journal, target, backup, installedHash, expectedHash);

                File.Replace(incoming, target, backup, true);
                replaced = true;

                if (simulateFailure) throw new IOException("Gesimuleerde fout na vervanging.");
                ValidatePayload(target, expectedHash, expectedVersion, expectedLength);
                if (!File.Exists(backup) || !FixedTimeEquals(Sha256(backup), installedHash))
                    throw new InvalidDataException("De vorige DLL is niet correct geback-upt.");

                TryDelete(staged);
                TryDelete(journal);
            }
            catch
            {
                if (replaced && File.Exists(backup))
                {
                    Log("Installatiefout; vorige DLL wordt atomair teruggezet.");
                    RestoreBackupAtomic(backup, target, installedHash);
                    TryDelete(journal);
                }
                throw;
            }
            finally
            {
                TryDelete(incoming);
            }
        }

        private static void RecoverPreviousTransaction(string target, string currentInstalledHash)
        {
            var journal = target + ".3sm-journal";
            if (!File.Exists(journal)) return;
            try
            {
                var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in File.ReadAllLines(journal, Encoding.UTF8))
                {
                    var separator = line.IndexOf('=');
                    if (separator <= 0) continue;
                    values[line.Substring(0, separator)] = line.Substring(separator + 1);
                }
                var journalTarget = FullPath(Required(values, "target"));
                var backup = FullPath(Required(values, "backup"));
                var oldHash = NormalizeHash(Required(values, "oldSha256"));
                var newHash = NormalizeHash(Required(values, "newSha256"));
                if (!string.Equals(journalTarget, target, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Transactiejournal hoort bij een ander doelbestand.");
                if (!string.Equals(backup, target + ".3sm-backup", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Transactiejournal verwijst naar een ongeldige back-up.");
                if (File.Exists(target) && FixedTimeEquals(Sha256(target), newHash))
                {
                    Log("Vorige update was al correct geplaatst; achtergebleven journal wordt opgeruimd.");
                    TryDelete(journal);
                    return;
                }
                if (File.Exists(target) && FixedTimeEquals(Sha256(target), oldHash))
                {
                    Log("Vorige update was nog niet geplaatst; achtergebleven journal wordt opgeruimd.");
                    TryDelete(journal);
                    return;
                }
                if (!File.Exists(backup) || !FixedTimeEquals(Sha256(backup), oldHash))
                    throw new InvalidDataException("Vorige update is onderbroken en de bekende goede back-up ontbreekt.");
                Log("Onderbroken update gevonden; bekende goede back-up wordt hersteld.");
                RestoreBackupAtomic(backup, target, oldHash);
                TryDelete(journal);
            }
            catch (Exception error)
            {
                if (File.Exists(target) && FixedTimeEquals(Sha256(target), currentInstalledHash))
                {
                    Log("Beschadigd journal gevonden terwijl de bekende geïnstalleerde DLL intact is; journal wordt opgeruimd.");
                    TryDelete(journal);
                    return;
                }
                throw new InvalidDataException("Het transactiejournal is beschadigd en veilig herstel kon niet worden bewezen.", error);
            }
        }

        private static void WriteJournal(string journal, string target, string backup, string oldHash, string newHash)
        {
            var content = "target=" + target + Environment.NewLine +
                          "backup=" + backup + Environment.NewLine +
                          "oldSha256=" + oldHash + Environment.NewLine +
                          "newSha256=" + newHash + Environment.NewLine;
            var temporaryJournal = journal + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                using (var stream = new FileStream(temporaryJournal, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                {
                    writer.Write(content);
                    writer.Flush();
                    stream.Flush(true);
                }
                if (File.Exists(journal)) File.Replace(temporaryJournal, journal, null, true);
                else File.Move(temporaryJournal, journal);
            }
            finally { TryDelete(temporaryJournal); }
        }

        private static void RestoreBackupAtomic(string backup, string target, string expectedHash)
        {
            if (!FixedTimeEquals(Sha256(backup), expectedHash))
                throw new InvalidDataException("De rollbackback-up heeft een onjuiste SHA-256.");
            var rollback = target + ".3sm-rollback-" + Guid.NewGuid().ToString("N");
            try
            {
                CopyAndFlush(backup, rollback, false);
                if (!FixedTimeEquals(Sha256(rollback), expectedHash))
                    throw new InvalidDataException("De tijdelijke rollback-DLL heeft een onjuiste SHA-256.");
                if (File.Exists(target)) File.Replace(rollback, target, null, true);
                else File.Move(rollback, target);
                if (!FixedTimeEquals(Sha256(target), expectedHash))
                    throw new InvalidDataException("Rollbackverificatie is mislukt.");
            }
            finally { TryDelete(rollback); }
        }

        private static void CopyAndFlush(string source, string destination, bool overwrite)
        {
            var mode = overwrite ? FileMode.Create : FileMode.CreateNew;
            using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(destination, mode, FileAccess.Write, FileShare.None))
            {
                input.CopyTo(output);
                output.Flush(true);
            }
        }

        private static void ValidatePayload(string staged, string expectedHash, Version expectedVersion, long expectedLength)
        {
            if (!File.Exists(staged)) throw new FileNotFoundException("Het staged updatebestand ontbreekt.", staged);
            var info = new FileInfo(staged);
            if (info.Length != expectedLength) throw new InvalidDataException("De DLL-grootte komt niet overeen met het manifest.");
            if (!FixedTimeEquals(Sha256(staged), expectedHash))
                throw new InvalidDataException("De update heeft een onjuiste SHA-256.");

            Version fileVersion;
            if (!Version.TryParse(FileVersionInfo.GetVersionInfo(staged).FileVersion, out fileVersion) || fileVersion != expectedVersion)
                throw new InvalidDataException("De DLL-bestandsversie komt niet overeen met de aangekondigde versie.");
            if (AssemblyName.GetAssemblyName(staged).Version != expectedVersion)
                throw new InvalidDataException("De managed assemblyversie komt niet overeen met de aangekondigde versie.");
        }

        private static void ValidatePaths(string target, string staged, string simHubPath)
        {
            RejectUnsafePath(target, "doel-DLL");
            RejectUnsafePath(staged, "staged updatebestand");
            RejectUnsafePath(simHubPath, "SimHub-startbestand");
            if (!string.Equals(Path.GetFileName(target), PluginFileName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ongeldige doel-DLL.");
            if (!string.Equals(Path.GetFileName(staged), PluginFileName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ongeldig staged updatebestand.");
            if (!string.Equals(Path.GetFileName(simHubPath), SimHubFileName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ongeldig SimHub-startbestand.");
            if (string.Equals(target, staged, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Staging- en doelbestand mogen niet hetzelfde zijn.");
            if (!File.Exists(target)) throw new FileNotFoundException("De bestaande plugin-DLL ontbreekt.", target);
            if (!File.Exists(simHubPath)) throw new FileNotFoundException("SimHubWPF.exe ontbreekt.", simHubPath);
            var simHubDirectory = FullPath(Path.GetDirectoryName(simHubPath));
            var expectedTarget = FullPath(Path.Combine(simHubDirectory, PluginFileName));
            if (!string.Equals(target, expectedTarget, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("De doel-DLL staat niet in de actieve SimHub-map.");
            RejectReparseChain(target);
            RejectReparseChain(staged);
            RejectReparseChain(simHubPath);
        }

        private static void RejectUnsafePath(string path, string label)
        {
            if (string.IsNullOrWhiteSpace(path) || path.StartsWith(@"\\", StringComparison.Ordinal))
                throw new InvalidDataException("UNC-pad niet toegestaan voor " + label + ".");
            if (path.IndexOf('"') >= 0 || path.IndexOf('\r') >= 0 || path.IndexOf('\n') >= 0)
                throw new InvalidDataException("Ongeldige tekens in " + label + ".");
        }

        private static void RejectReparseChain(string path)
        {
            var current = FullPath(path);
            while (!string.IsNullOrEmpty(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) &&
                    (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Reparse point niet toegestaan in updaterpad: " + current);
                var parent = Directory.GetParent(current);
                if (parent == null) break;
                current = parent.FullName;
            }
        }

        private static Process AcquireSimHubProcess(int pid, long startedUtcTicks, string expectedPath, bool noRestart)
        {
            if (pid <= 0)
            {
                if (noRestart) return null;
                throw new InvalidDataException("SimHub-proces-ID ontbreekt.");
            }
            Process process;
            try { process = Process.GetProcessById(pid); }
            catch (ArgumentException) { throw new InvalidOperationException("Het oorspronkelijke SimHub-proces bestaat niet meer."); }
            try
            {
                var actualStartedTicks = process.StartTime.ToUniversalTime().Ticks;
                if (actualStartedTicks != startedUtcTicks) throw new InvalidDataException("SimHub-procesidentiteit komt niet overeen.");
                var actualPath = FullPath(GetProcessImagePath(pid));
                if (!string.Equals(actualPath, expectedPath, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("SimHub-procespad komt niet overeen.");
                return process;
            }
            catch
            {
                process.Dispose();
                throw;
            }
        }

        private static void SignalReady(string readyEventName, int pid)
        {
            if (pid <= 0 && string.IsNullOrWhiteSpace(readyEventName)) return;
            if (string.IsNullOrWhiteSpace(readyEventName) ||
                !Regex.IsMatch(readyEventName, @"^Local\\3SM\.EnduranceConnector\.Updater\.Ready\.[0-9a-f]{32}$", RegexOptions.CultureInvariant))
                throw new InvalidDataException("Ongeldige updater ready-eventnaam.");
            using (var readyEvent = EventWaitHandle.OpenExisting(readyEventName))
            {
                readyEvent.Set();
            }
            Log("Procesidentiteit bevestigd; plugin mag SimHub nu afsluiten.");
        }

        private static void WaitForSimHubExit(Process process, bool noRestart, TimeSpan timeout)
        {
            if (process == null)
            {
                if (noRestart) return;
                throw new InvalidOperationException("SimHub-proceshandle ontbreekt.");
            }
            Log("Wachten tot SimHub afsluit (PID " + process.Id.ToString(CultureInfo.InvariantCulture) + ").");
            if (!process.WaitForExit((int)timeout.TotalMilliseconds))
                throw new TimeoutException("SimHub is niet binnen twee minuten afgesloten; update geannuleerd.");
        }

        private static string GetProcessImagePath(int pid)
        {
            var handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SimHub-procespad kon niet worden geopend.");
            try
            {
                var capacity = 32768;
                var path = new StringBuilder(capacity);
                if (!QueryFullProcessImageName(handle, 0, path, ref capacity))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SimHub-procespad kon niet worden gelezen.");
                return path.ToString();
            }
            finally { CloseHandle(handle); }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder executableName, ref int size);

        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        private static void RestartSimHub(string simHubPath)
        {
            Log("SimHub wordt opnieuw gestart via de Explorer-shell.");
            var requestedAt = DateTime.UtcNow.AddSeconds(-2);
            var launcher = Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = Quote(simHubPath),
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(simHubPath),
            });
            if (launcher == null) throw new InvalidOperationException("Explorer kon SimHub niet starten.");
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while (DateTime.UtcNow < deadline)
            {
                foreach (var candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(SimHubFileName)))
                {
                    using (candidate)
                    {
                        try
                        {
                            if (candidate.StartTime.ToUniversalTime() >= requestedAt &&
                                string.Equals(FullPath(GetProcessImagePath(candidate.Id)), simHubPath, StringComparison.OrdinalIgnoreCase))
                            {
                                Log("SimHub-herstart bevestigd (PID " + candidate.Id.ToString(CultureInfo.InvariantCulture) + ").");
                                return;
                            }
                        }
                        catch (InvalidOperationException) { }
                        catch (System.ComponentModel.Win32Exception) { }
                    }
                }
                Thread.Sleep(250);
            }
            throw new TimeoutException("Explorer accepteerde de startopdracht, maar binnen twintig seconden verscheen geen nieuw SimHub-proces.");
        }

        private static Dictionary<string, string> ParseArguments(string[] args)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < (args == null ? 0 : args.Length); index++)
            {
                var key = args[index];
                if (!key.StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Ongeldig updaterargument.");
                key = key.Substring(2);
                if (key == "silent" || key == "no-restart" || key == "simulate-failure")
                {
                    if (result.ContainsKey(key)) throw new ArgumentException("Dubbel updaterargument: --" + key + ".");
                    result[key] = "true";
                    continue;
                }
                if (result.ContainsKey(key)) throw new ArgumentException("Dubbel updaterargument: --" + key + ".");
                if (++index >= args.Length) throw new ArgumentException("Waarde ontbreekt voor --" + key + ".");
                result[key] = args[index];
            }
            return result;
        }

        private static string Required(Dictionary<string, string> options, string key)
        {
            string value;
            if (!options.TryGetValue(key, out value) || string.IsNullOrWhiteSpace(value))
                throw new ArgumentException("Verplicht updaterargument ontbreekt: --" + key + ".");
            return value;
        }

        private static int ParseNonNegativeInt(string value, string label)
        {
            int parsed;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed < 0)
                throw new ArgumentException("Ongeldige " + label + ".");
            return parsed;
        }

        private static long ParseNonNegativeLong(string value, string label)
        {
            long parsed;
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed < 0)
                throw new ArgumentException("Ongeldige " + label + ".");
            return parsed;
        }

        private static long ParsePositiveLong(string value, string label)
        {
            var parsed = ParseNonNegativeLong(value, label);
            if (parsed == 0 || parsed > 5 * 1024 * 1024) throw new ArgumentException("Ongeldige " + label + ".");
            return parsed;
        }

        private static Version ParseVersion(string value)
        {
            Version version;
            if (!Version.TryParse(value, out version)) throw new ArgumentException("Ongeldige updateversie.");
            return version;
        }

        private static string NormalizeHash(string value)
        {
            var normalized = value.Trim().ToLowerInvariant();
            if (!Regex.IsMatch(normalized, "^[a-f0-9]{64}$")) throw new ArgumentException("Ongeldige SHA-256.");
            return normalized;
        }

        private static string FullPath(string value) { return Path.GetFullPath(value); }

        private static string Sha256(string path)
        {
            using (var algorithm = SHA256.Create())
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                var bytes = algorithm.ComputeHash(stream);
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var item in bytes) builder.Append(item.ToString("x2", CultureInfo.InvariantCulture));
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

        private static void TryDelete(string path)
        {
            try { if (!string.IsNullOrWhiteSpace(path) && File.Exists(path)) File.Delete(path); }
            catch (Exception error) { Log("Kon tijdelijk bestand niet verwijderen: " + error.Message); }
        }

        private static string Quote(string value)
        {
            if (value != null && value.IndexOf('"') >= 0) throw new ArgumentException("Ongeldig aanhalingsteken in startpad.");
            return "\"" + (value ?? string.Empty) + "\"";
        }

        private static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(LogDirectory);
                File.AppendAllText(LogPath, DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }
}
