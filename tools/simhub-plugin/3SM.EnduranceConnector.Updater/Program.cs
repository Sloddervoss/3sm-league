using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
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
        private static readonly string LogDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3SM", "EnduranceConnector", "Updater");
        private static readonly string LogPath = Path.Combine(LogDirectory, "updater.log");

        [STAThread]
        private static int Main(string[] args)
        {
            var options = ParseArguments(args);
            var silent = options.ContainsKey("silent");
            try
            {
                Directory.CreateDirectory(LogDirectory);
                Log("Updater gestart.");

                var pid = ParsePid(Required(options, "pid"));
                var target = FullPath(Required(options, "target"));
                var staged = FullPath(Required(options, "staged"));
                var expectedHash = NormalizeHash(Required(options, "sha256"));
                var expectedVersion = ParseVersion(Required(options, "version"));
                var noRestart = options.ContainsKey("no-restart");
                var simulateFailure = options.ContainsKey("simulate-failure");
                var simHubPath = noRestart ? null : FullPath(Required(options, "simhub"));

                ValidatePaths(target, staged, simHubPath, noRestart);
                ValidatePayload(staged, expectedHash, expectedVersion);
                WaitForSimHubExit(pid, TimeSpan.FromMinutes(2));

                Install(target, staged, expectedHash, simulateFailure);
                Log("Update succesvol geïnstalleerd: " + expectedVersion);

                if (!noRestart) RestartSimHub(simHubPath);
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
        }

        private static void Install(string target, string staged, string expectedHash, bool simulateFailure)
        {
            var targetDirectory = Path.GetDirectoryName(target);
            var incoming = Path.Combine(targetDirectory, PluginFileName + ".3sm-new-" + Guid.NewGuid().ToString("N"));
            var backup = target + ".3sm-backup";
            var replaced = false;

            try
            {
                File.Copy(staged, incoming, false);
                if (!FixedTimeEquals(Sha256(incoming), expectedHash))
                    throw new InvalidDataException("De naar de SimHub-map gekopieerde update heeft een onjuiste SHA-256.");

                File.Replace(incoming, target, backup, true);
                replaced = true;

                if (simulateFailure)
                    throw new IOException("Gesimuleerde fout na vervanging.");

                if (!FixedTimeEquals(Sha256(target), expectedHash))
                    throw new InvalidDataException("De geïnstalleerde DLL heeft na vervanging een onjuiste SHA-256.");

                TryDelete(staged);
            }
            catch
            {
                if (replaced && File.Exists(backup))
                {
                    Log("Installatiefout; vorige DLL wordt teruggezet.");
                    File.Copy(backup, target, true);
                }
                throw;
            }
            finally
            {
                TryDelete(incoming);
            }
        }

        private static void ValidatePayload(string staged, string expectedHash, Version expectedVersion)
        {
            if (!File.Exists(staged)) throw new FileNotFoundException("Het staged updatebestand ontbreekt.", staged);
            if (!FixedTimeEquals(Sha256(staged), expectedHash))
                throw new InvalidDataException("De gedownloade update heeft een onjuiste SHA-256.");

            var fileVersionText = FileVersionInfo.GetVersionInfo(staged).FileVersion;
            Version fileVersion;
            if (!Version.TryParse(fileVersionText, out fileVersion) || fileVersion != expectedVersion)
                throw new InvalidDataException("De DLL-versie komt niet overeen met de aangekondigde versie.");
        }

        private static void ValidatePaths(string target, string staged, string simHubPath, bool noRestart)
        {
            if (!string.Equals(Path.GetFileName(target), PluginFileName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ongeldige doel-DLL.");
            if (!string.Equals(Path.GetFileName(staged), PluginFileName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ongeldig staged updatebestand.");
            if (string.Equals(target, staged, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Staging- en doelbestand mogen niet hetzelfde zijn.");
            if (!File.Exists(target)) throw new FileNotFoundException("De bestaande plugin-DLL ontbreekt.", target);
            if (string.IsNullOrWhiteSpace(Path.GetDirectoryName(target)) || !Directory.Exists(Path.GetDirectoryName(target)))
                throw new DirectoryNotFoundException("De SimHub-pluginmap bestaat niet.");
            if (!noRestart)
            {
                if (!string.Equals(Path.GetFileName(simHubPath), "SimHubWPF.exe", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Ongeldig SimHub-startbestand.");
                if (!File.Exists(simHubPath)) throw new FileNotFoundException("SimHubWPF.exe ontbreekt.", simHubPath);
            }
        }

        private static void WaitForSimHubExit(int pid, TimeSpan timeout)
        {
            if (pid <= 0) return;
            Process process;
            try { process = Process.GetProcessById(pid); }
            catch (ArgumentException) { return; }

            using (process)
            {
                Log("Wachten tot SimHub afsluit (PID " + pid.ToString(CultureInfo.InvariantCulture) + ").");
                if (!process.WaitForExit((int)timeout.TotalMilliseconds))
                    throw new TimeoutException("SimHub is niet binnen twee minuten afgesloten; update geannuleerd.");
            }
        }

        private static void RestartSimHub(string simHubPath)
        {
            Log("SimHub wordt opnieuw gestart.");
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = Quote(simHubPath),
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(simHubPath),
            });
        }

        private static Dictionary<string, string> ParseArguments(string[] args)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < args.Length; index++)
            {
                var key = args[index];
                if (!key.StartsWith("--", StringComparison.Ordinal))
                    throw new ArgumentException("Ongeldig updaterargument.");
                key = key.Substring(2);
                if (key == "silent" || key == "no-restart" || key == "simulate-failure")
                {
                    result[key] = "true";
                    continue;
                }
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

        private static int ParsePid(string value)
        {
            int parsed;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed < 0)
                throw new ArgumentException("Ongeldig SimHub-proces-ID.");
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

        private static string FullPath(string value)
        {
            return Path.GetFullPath(value);
        }

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
            return "\"" + (value ?? string.Empty).Replace("\"", "\\\"") + "\"";
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
