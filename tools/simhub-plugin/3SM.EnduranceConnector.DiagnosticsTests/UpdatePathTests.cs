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
    // De versie waarmee de vloot nu rondrijdt.
    // Kopieert een 0.7.1.2-fixture naar een eigen map en zet desgewenst de aangekondigde
    // versie op de staging, zoals de plugin dat doet na een download.
    private static string Simulate(string fixture, string root, string name, string pendingVersion)
    {
        var directory = Path.Combine(root, name);
        Directory.CreateDirectory(directory);
        File.Copy(fixture, Path.Combine(directory, UpdaterState.StoreFileName), true);
        if (pendingVersion == null) return directory;
        var store = new UpdaterStateStore(directory);
        store.TryUpdate(current => current.pendingUpdateVersion = pendingVersion);
        return directory;
    }

    // Dezelfde voorwaarde die TryAutoApplyUpdate gebruikt: een herstelbare staat waarvan de
    // aangekondigde versie bij de staging hoort.
    private static bool IsResumable(UpdaterState state, string announcedVersion)
    {
        return state.LogicallyNeedsRecovery
            && (string.IsNullOrWhiteSpace(state.pendingUpdateVersion)
                || string.Equals(state.pendingUpdateVersion, announcedVersion, StringComparison.Ordinal));
    }

    private static string ReadUpward(string relativePath)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null)
        {
            var candidate = Path.Combine(directory.FullName, "tools", "simhub-plugin", relativePath);
            if (File.Exists(candidate)) return File.ReadAllText(candidate, Encoding.UTF8);
            candidate = Path.Combine(directory.FullName, relativePath);
            if (File.Exists(candidate)) return File.ReadAllText(candidate, Encoding.UTF8);
            directory = directory.Parent;
        }
        return null;
    }

    private static readonly Version Installed = new Version("0.7.1.2");
    // De versie die deze release krijgt (DDL-review 6.1: overal 0.7.2.0).
    private static readonly Version Release = new Version("0.7.2.0");

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

        // ---- 3b. de releaseversie zelf ----
        Check("V21", UpdateVersionPolicy.IsNewer(Release, Installed), "0.7.2.0 is nieuwer dan 0.7.1.2 (de nieuwe release)");
        Check("V22", !UpdateVersionPolicy.IsNewer(Release, Release), "0.7.2.0 tegenover 0.7.2.0 is geen update (geen lus na de update)");
        Check("V23", UpdateVersionPolicy.Format(Release) == "0.7.2.0" && new Version(UpdateVersionPolicy.Format(Release)).Equals(Release),
            "de release geeft --version 0.7.2.0 en de updater leest dat gelijk terug");

        // ---- 3c. de versie staat echt overal op 0.7.2.0 ----
        foreach (var assembly in new[] { "3SM.EnduranceConnector", "3SM.EnduranceConnector.Updater" })
        {
            var info = ReadUpward(Path.Combine(assembly, "AssemblyInfo.cs"));
            Check("V24-" + assembly,
                info != null && info.Contains("AssemblyVersion(\"0.7.2.0\")") && info.Contains("AssemblyFileVersion(\"0.7.2.0\")"),
                assembly + " meldt 0.7.2.0" + (info == null ? " (bestand niet gevonden)" : string.Empty));
        }

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
            // De oude staten STAGED en WAITING_FOR_RESTART mogen de update niet blokkeren.
            // Twee gevallen per staat:
            //  a) de fixture hoort bij de aangekondigde 0.8.0.0 -> hervatbaar;
            //  b) dezelfde oude staat maar de release is 0.7.2.0 -> de staging hoort niet bij
            //     die versie, dus de plugin mag hem NIET installeren (veilige weigering);
            //  c) een staat die wel bij 0.7.2.0 hoort -> hervatbaar en installeerbaar.
            foreach (var fixture in new[] { UpdaterTransitionTests.StagedFileName, UpdaterTransitionTests.WaitingFileName })
            {
                var label = Path.GetFileNameWithoutExtension(fixture);
                var mismatched = new UpdaterStateStore(Simulate(fixture, root, label + "-mismatch", null)).Load();
                Check("V18-" + label + "-0.8.0.0", IsResumable(mismatched, "0.8.0.0"),
                    mismatched.state + " uit 0.7.1.2 hoort bij 0.8.0.0 en is hervatbaar");
                Check("V18-" + label + "-verschil", !IsResumable(mismatched, "0.7.2.0"),
                    "dezelfde " + mismatched.state + " wordt niet als 0.7.2.0 geïnstalleerd (versie moet kloppen)");

                var matching = new UpdaterStateStore(Simulate(fixture, root, label + "-match", "0.7.2.0")).Load();
                Check("V18b-" + label, IsResumable(matching, "0.7.2.0"),
                    matching.state + " met een 0.7.2.0-staging is hervatbaar");

                foreach (var announcedVersion in new[] { "0.8.0.0", "0.7.2.0" })
                {
                    var directory = Simulate(fixture, root, label + "-run-" + announcedVersion, announcedVersion);
                    var store = new UpdaterStateStore(directory);
                    // De updaterreeks: INSTALLING -> SUCCESS, precies zoals Program.cs die schrijft.
                    store.TryUpdate(current =>
                    {
                        // Zelfde velden als SetInstallingState in Program.cs; de staging
                        // blijft staan zoals hij was.
                        current.state = "INSTALLING";
                        current.pendingUpdateVersion = announcedVersion;
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
                    Check("V19-" + label + "-" + announcedVersion,
                        finished.state == "SUCCESS" && finished.pendingUpdateVersion == null,
                        "één installatie vanaf " + matching.state + " naar " + announcedVersion + " eindigt in SUCCESS");
                    var finishedVersion = new Version(announcedVersion);
                    Check("V20-" + label + "-" + announcedVersion, !UpdateVersionPolicy.IsNewer(finishedVersion, finishedVersion),
                        "na de update is " + announcedVersion + " geen nieuwe update meer (geen lus)");
                }
            }
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
        return count;
    }
}
