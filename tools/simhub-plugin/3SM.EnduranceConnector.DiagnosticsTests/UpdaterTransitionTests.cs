using System;
using System.IO;
using System.Text;
using ThreeSM.EnduranceConnector;

// FASE 1 (baseline) + harde eis van Vincent: een installatie die nu op 0.7.1.2 staat
// moet met één update naar 0.8 gaan, zonder handmatige stap, en de oude staat
// WAITING_FOR_RESTART mag dat niet blokkeren.
//
// De fixtures zijn echte 0.7.1.2-state-bestanden (updater-state.json). De test leest ze
// met dezelfde UpdaterStateStore als plugin en updater gebruiken en loopt daarna de
// transitiereeks die de updater schrijft.
internal static class UpdaterTransitionTests
{
    internal static string StagedFileName { get { return Path.Combine(AppContext.BaseDirectory, "Fixtures", "updater-state-0.7.1.2-staged.json"); } }
    internal static string WaitingFileName { get { return Path.Combine(AppContext.BaseDirectory, "Fixtures", "updater-state-0.7.1.2-waiting.json"); } }

    private const string RemoteVersion = "0.8.0.0";
    private const string InstalledVersion = "0.7.1.2";

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var root = Path.Combine(Path.GetTempPath(), "3sm-updater-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            // --- 0.7.1.2 met een gedownloade maar nog niet toegepaste update ---
            var stagedDir = CopyFixture(StagedFileName, root, "staged");
            var stagedStore = new UpdaterStateStore(stagedDir);
            var staged = stagedStore.Load();
            Check("U01", staged.state == "STAGED" && staged.schemaVersion == UpdaterState.CurrentSchemaVersion,
                "0.7.1.2-state leest als STAGED (schema " + staged.schemaVersion + ")");
            Check("U02", staged.pendingUpdateVersion == RemoteVersion, "aangekondigde versie = " + staged.pendingUpdateVersion);
            Check("U03", staged.LogicallyNeedsRecovery, "STAGED vraagt om herstelcontrole van het journal");
            Check("U04", Directory.GetFiles(stagedDir, UpdaterState.StoreFileName + ".corrupt-*").Length == 0,
                "geldige state wordt niet als corrupt gekopieerd");

            // --- 0.7.1.2 die bleef wachten op een schone SimHub-exit ---
            var waitingDir = CopyFixture(WaitingFileName, root, "waiting");
            var waitingStore = new UpdaterStateStore(waitingDir);
            var waiting = waitingStore.Load();
            Check("U05", waiting.state == "WAITING_FOR_RESTART" && waiting.LogicallyNeedsRecovery,
                "oude WAITING_FOR_RESTART leest en vraagt om herstelcontrole");
            Check("U06", waiting.pendingUpdateVersion == RemoteVersion && waiting.lastUpdateErrorCode == "UPDATE_WAITING",
                "wachttende update wijst nog naar " + waiting.pendingUpdateVersion);
            Check("U07", waiting.pendingSimHubPid.HasValue && waiting.pendingSimHubPid.Value > 0,
                "het oude SimHub-proces-ID staat er nog (" + (waiting.pendingSimHubPid.HasValue ? waiting.pendingSimHubPid.Value.ToString() : "-") + ")");

            // --- versievergelijking: 0.8.0.0 is nieuwer dan 0.7.1.2, en 0.7.1.2 niet ---
            var installed = new Version(InstalledVersion);
            var remote = new Version(RemoteVersion);
            Check("U08", remote > installed, RemoteVersion + " > " + InstalledVersion);
            Check("U09", !(installed > remote), InstalledVersion + " is niet nieuwer dan " + RemoteVersion);
            Check("U10", new Version("0.8") > installed, "korte notatie 0.8 telt ook als nieuwer dan " + InstalledVersion);
            Check("U11", !(new Version("0.7.1.2") > installed), "gelijke versie levert geen update op");
            Check("U12", new Version("0.7.1.3") > installed, "een patch op de oude lijn blijft ook installeerbaar");
            Check("U13", new Version(RemoteVersion) == new Version("0.8.0.0"), "versienotatie met vier delen vergelijkt gelijk");

            // --- de updaterreeks die de externe updater schrijft, op de oude staat ---
            var resumed = waitingStore.Load();
            waitingStore.TryUpdate(cur =>
            {
                cur.state = "INSTALLING";
                cur.pendingUpdateVersion = RemoteVersion;
            });
            Check("U14", waitingStore.Load().state == "INSTALLING", "WAITING_FOR_RESTART -> INSTALLING lukt zonder handmatige reset");
            waitingStore.TryUpdate(cur =>
            {
                cur.state = "SUCCESS";
                cur.pendingUpdateVersion = null;
                cur.pendingStagedDll = null;
                cur.pendingSimHubPid = null;
                cur.lastUpdateResult = "success";
                cur.lastUpdateErrorCode = null;
                cur.lastUpdateUtc = DateTime.UtcNow.ToString("O");
            });
            var afterUpgrade = new UpdaterStateStore(waitingDir).Load();
            Check("U15", afterUpgrade.state == "SUCCESS", "na de update staat de staat op SUCCESS");
            Check("U16", afterUpgrade.pendingUpdateVersion == null && afterUpgrade.pendingStagedDll == null && afterUpgrade.pendingSimHubPid == null,
                "de wachtende update is opgeruimd");
            Check("U17", afterUpgrade.lastUpdateResult == "success" && afterUpgrade.lastUpdateErrorCode == null,
                "resultaat = success zonder foutcode");
            Check("U18", !afterUpgrade.LogicallyNeedsRecovery, "SUCCESS vraagt geen herstelcontrole meer");

            // --- precies één update: na 0.8 biedt dezelfde remote niets meer aan ---
            var nowInstalled = new Version("0.8.0.0");
            Check("U19", !(new Version(RemoteVersion) > nowInstalled), "0.8.0.0 tegenover 0.8.0.0 levert geen tweede update op");
            Check("U20", File.Exists(new UpdaterStateStore(waitingDir).FilePath), "de state blijft persistent op schijf staan");

            // --- robuustheid van de bestaande store (mag nooit gooien) ---
            var corruptDir = Path.Combine(root, "corrupt");
            Directory.CreateDirectory(corruptDir);
            File.WriteAllText(Path.Combine(corruptDir, UpdaterState.StoreFileName), "{ dit is geen json");
            var corrupt = new UpdaterStateStore(corruptDir).Load();
            Check("U21", corrupt.state == "IDLE" && corrupt.lastUpdateResult == "none", "corrupte state valt terug op veilige default");
            var corruptCopies = Directory.GetFiles(corruptDir, UpdaterState.StoreFileName + ".corrupt-*");
            Check("U22", corruptCopies.Length == 1, "corrupt bestand wordt bewaard voor onderzoek (kopieën=" + corruptCopies.Length + ")");

            var futureDir = Path.Combine(root, "future");
            Directory.CreateDirectory(futureDir);
            File.WriteAllText(Path.Combine(futureDir, UpdaterState.StoreFileName),
                "{\"schemaVersion\":2,\"state\":\"SUCCESS\",\"pendingUpdateVersion\":\"9.9.9.9\"}");
            var future = new UpdaterStateStore(futureDir).Load();
            Check("U23", future.state == "IDLE", "state uit een toekomstig schema wordt niet geïnterpreteerd");

            var extraDir = Path.Combine(root, "extra");
            Directory.CreateDirectory(extraDir);
            File.WriteAllText(Path.Combine(extraDir, UpdaterState.StoreFileName),
                "{\"schemaVersion\":1,\"state\":\"STAGED\",\"pendingUpdateVersion\":\"0.8.0.0\",\"unknownFutureKey\":123}");
            var extra = new UpdaterStateStore(extraDir).Load();
            Check("U24", extra.state == "STAGED" && extra.pendingUpdateVersion == "0.8.0.0", "een onbekende extra sleutel blokkeert de state niet");

            var tmpLeftovers = Directory.GetFiles(waitingDir, "*.tmp-*");
            Check("U25", tmpLeftovers.Length == 0, "atomair schrijven laat geen tijdelijke bestanden achter (" + tmpLeftovers.Length + ")");
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
        return count;
    }

    private static string CopyFixture(string source, string root, string name)
    {
        var directory = Path.Combine(root, name);
        Directory.CreateDirectory(directory);
        if (!File.Exists(source))
            throw new FileNotFoundException("updater-fixture ontbreekt: " + source);
        File.Copy(source, Path.Combine(directory, UpdaterState.StoreFileName), true);
        return directory;
    }
}
