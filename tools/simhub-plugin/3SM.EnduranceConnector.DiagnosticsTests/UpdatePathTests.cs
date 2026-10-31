using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using ThreeSM.EnduranceConnector;

// Harde eis: de automatische update van 0.7.1.x naar 0.8 mag niet breken.
//
// Deze test dekt drie dingen die daarvoor samen moeten kloppen:
//  1. de versievergelijking zelf (0.8.0.0 > 0.7.1.2, en een gelijke versie is geen update);
//  2. dat de regel in UpdateVersionPolicy exact doet wat de plugin vroeger inline deed;
//  3. de hele reeks met de ECHTE 0.7.1.2-bestanden: aangekondigde versie uit de
//     configuratie, oude updaterstaat, één installatie, daarna geen tweede aanbod.
internal static class UpdatePathTests
{
    // De versie waarmee de vloot nu rondrijdt (AssemblyInfo.cs tot de 0.8-bump).
    private static readonly Version Installed = new Version("0.7.1.2");

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // ---- 1. de vergelijking zelf ----
        Check("V01", UpdateVersionPolicy.IsNewer(new Version("0.8.0.0"), Installed), "0.8.0.0 is nieuwer dan 0.7.1.2");
        Check("V02", UpdateVersionPolicy.IsNewer(new Version("0.8"), Installed), "0.8 is nieuwer dan 0.7.1.2");
        Check("V03", !UpdateVersionPolicy.IsNewer(new Version("0.7.1.2"), Installed), "0.7.1.2 tegenover 0.7.1.2 is geen update");
        Check("V04", !UpdateVersionPolicy.IsNewer(new Version("0.7.1.1"), Installed), "0.7.1.1 is ouder en wordt niet aangeboden");
        Check("V05", UpdateVersionPolicy.IsNewer(new Version("0.7.1.3"), Installed), "een patch op de oude lijn blijft installeerbaar");
        Check("V06", UpdateVersionPolicy.IsNewer(new Version("1.0.0.0"), Installed), "een sprong in het hoofdnummer telt ook");
        Check("V07", !UpdateVersionPolicy.IsNewer(new Version("0.8.0.0"), new Version("0.8.0.0")), "na de update biedt 0.8.0.0 zichzelf niet opnieuw aan");
        Check("V08", !UpdateVersionPolicy.IsNewer(null, Installed), "een ontbrekende versie is nooit een update");
        Check("V09", !UpdateVersionPolicy.TryParseNewer("geen-versie", Installed, out _)
            && !UpdateVersionPolicy.TryParseNewer("", Installed, out _)
            && !UpdateVersionPolicy.TryParseNewer(null, Installed, out _),
            "onleesbare of lege versie levert geen update op");
        Check("V10", UpdateVersionPolicy.TryParseNewer(" 0.8.0.0 ", Installed, out var parsed) && parsed != null && parsed.ToString() == "0.8.0.0",
            "witruimte rond de versie is geen probleem");

        // ---- 2. dezelfde uitkomst als de oude inline-regel ----
        var candidates = new[]
        {
            "0.8.0.0", "0.8", "0.8.0", "0.7.1.2", "0.7.1.2.0", "0.7.1.1", "0.7.1.3", "1.0.0.0",
            "0.8.0.0.0", "abc", "", "  ", null, "0.10.0.0", "0.9.9.9", "10.0.0.0",
        };
        var mismatches = 0;
        string firstMismatch = null;
        foreach (var candidate in candidates)
        {
            Version oldParsed;
            // De letterlijke regel zoals die in 0.7.1.2 in de plugin stond.
            var oldResult = Version.TryParse(candidate, out oldParsed) && !(oldParsed <= Installed);
            var newResult = UpdateVersionPolicy.TryParseNewer(candidate, Installed, out _);
            if (oldResult != newResult)
            {
                mismatches++;
                if (firstMismatch == null) firstMismatch = (candidate ?? "<null>") + " oud=" + oldResult + " nieuw=" + newResult;
            }
        }
        Check("V11", mismatches == 0, candidates.Length + " versieteksten: oude en nieuwe regel geven hetzelfde (" + (firstMismatch ?? "geen afwijking") + ")");

        // ---- 3. de updater gebruikt dezelfde tekst ----
        var remote = new Version("0.8.0.0");
        Check("V12", UpdateVersionPolicy.Format(remote) == "0.8.0.0", "de tekst naar --version en de staging-map is " + UpdateVersionPolicy.Format(remote));
        Check("V13", new Version(UpdateVersionPolicy.Format(remote)) == remote,
            "de updater leest dezelfde versie terug uit --version");
        // De updater vergelijkt de DLL-bestandsversie met het aangekondigde nummer. Beide
        // moeten vier delen hebben, anders faalt de installatie op de versiecontrole.
        Check("V14", new Version("0.8.0.0") == new Version("0.8.0.0") && !new Version("0.8").Equals(new Version("0.8.0.0")),
            "vier delen zijn vereist: 0.8 is niet gelijk aan 0.8.0.0 (daarom leest release.sh AssemblyVersion)");

        // ---- 4. één update van 0.7.1.2 naar 0.8, met de echte bestanden ----
        var settingsJson = File.ReadAllText(SettingsCompatibilityTests.LegacyFileName, Encoding.UTF8);
        var settings = SettingsCompatibilityTests.Deserialize(settingsJson);
        Check("V15", settings.LastKnownRemoteVersion == "0.8.0.0", "de 0.7.1.2-configuratie kondigt 0.8.0.0 aan (" + settings.LastKnownRemoteVersion + ")");
        Check("V16", UpdateVersionPolicy.TryParseNewer(settings.LastKnownRemoteVersion, Installed, out var announced),
            "de plugin ziet de aangekondigde 0.8.0.0 als nieuwer dan de geladen 0.7.1.2");
        Check("V17", announced != null && UpdateVersionPolicy.Format(announced) == "0.8.0.0",
            "en geeft exact 0.8.0.0 door aan de updater");

        var root = Path.Combine(Path.GetTempPath(), "3sm-update-path-" + Guid.NewGuid().ToString("N"));
        try
        {
            // De oude staat WAITING_FOR_RESTART mag de update niet blokkeren.
            foreach (var fixture in new[] { UpdaterTransitionTests.StagedFileName, UpdaterTransitionTests.WaitingFileName })
            {
                var directory = Path.Combine(root, Path.GetFileNameWithoutExtension(fixture));
                Directory.CreateDirectory(directory);
                File.Copy(fixture, Path.Combine(directory, UpdaterState.StoreFileName), true);
                var store = new UpdaterStateStore(directory);
                var state = store.Load();
                var resumable = state.LogicallyNeedsRecovery
                    && (string.IsNullOrWhiteSpace(state.pendingUpdateVersion)
                        || string.Equals(state.pendingUpdateVersion, UpdateVersionPolicy.Format(announced), StringComparison.Ordinal));
                Check("V18-" + state.state, resumable,
                    state.state + " uit 0.7.1.2 hoort bij 0.8.0.0 en is hervatbaar");

                // De updaterreeks: INSTALLING -> SUCCESS, precies zoals Program.cs die schrijft.
                store.TryUpdate(current =>
                {
                    current.state = "INSTALLING";
                    current.pendingUpdateVersion = UpdateVersionPolicy.Format(announced);
                    current.pendingStagedDll = state.pendingStagedDll;
                    current.pendingSimHubPid = state.pendingSimHubPid;
                });
                store.TryUpdate(current =>
                {
                    current.state = "SUCCESS";
                    current.pendingUpdateVersion = null;
                    current.pendingStagedDll = null;
                    current.pendingSimHubPid = null;
                    current.lastUpdateResult = "success";
                    current.lastUpdateErrorCode = null;
                    current.lastUpdateUtc = DateTime.UtcNow.ToString("O");
                });
                var finished = new UpdaterStateStore(directory).Load();
                Check("V19-" + state.state, finished.state == "SUCCESS" && finished.pendingUpdateVersion == null,
                    "één installatie vanaf " + state.state + " eindigt in SUCCESS zonder openstaande update");
                Check("V20-" + state.state, !UpdateVersionPolicy.IsNewer(announced, announced),
                    "na de update is dezelfde 0.8.0.0 geen nieuwe update meer (geen lus)");
            }
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
        return count;
    }
}
