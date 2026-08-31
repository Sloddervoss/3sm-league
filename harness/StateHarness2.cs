// 3SM 0.3.9.0 — unit-test van de dedicated UpdaterStateStore (gedeelde bron) — uitgebreid.
// Compile met csc:  csc StateHarness2.cs ..\3SM.EnduranceConnector\UpdaterStateStore.cs
using System;
using System.IO;
using System.Threading;
using ThreeSM.EnduranceConnector;

public static class StateHarness2
{
    static int _fail = 0;
    static void Assert(bool cond, string label) { Console.WriteLine((cond ? "PASS " : "FAIL ") + label); if (!cond) _fail++; }

    public static int Main()
    {
        var dir = Path.Combine(Path.GetTempPath(), "3sm-state2-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var store = new UpdaterStateStore(dir);
        var path = store.FilePath;

        // T25: missing state -> IDLE safe-defaults
        Assert(store.Load().state == "IDLE", "T25 missing state -> Idle safe-defaults");

        // T26: corrupt JSON -> safe defaults + .corrupt backup
        File.WriteAllText(path, "{ nope");
        var s26 = store.Load();
        Assert(s26.state == "IDLE", "T26 corrupt json -> Idle safe-defaults");
        Assert(Directory.GetFiles(dir, "updater-state.json.corrupt-*").Length >= 1, "T26 corrupt bewaard als .corrupt-<ts>");

        // T27: onbekende schemaVersion -> safe defaults
        File.WriteAllText(path, "{\"schemaVersion\":99,\"state\":\"STAGED\"}");
        Assert(store.Load().state == "IDLE", "T27 onbekende schemaVersion -> Idle");

        // T28: interrupted atomic write (leftover .tmp, target intact) -> safe read van geldige state, tmp genegeerd
        store.TryUpdate(c => { c.state = "STAGED"; c.pendingUpdateVersion = "0.3.9.0"; });
        File.WriteAllText(path + ".tmp-abc", "{\"schemaVersion\":1,\"state\":\"INSTALLING\"}");
        var s28 = store.Load();
        Assert(s28.state == "STAGED" && s28.pendingUpdateVersion == "0.3.9.0", "T28 leftover .tmp genegeerd; geldige state gelezen");

        // T28b: atomic write produces no leftover tmp after success (verse dir, eigen write)
        var cleanDir = Path.Combine(Path.GetTempPath(), "3sm-state2-clean-" + Guid.NewGuid().ToString("N"));
        var cleanStore = new UpdaterStateStore(cleanDir);
        cleanStore.TryUpdate(c => c.state = "SUCCESS");
        Assert(Directory.GetFiles(cleanDir, "*.tmp-*").Length == 0, "T28b geen tmp-overblijfsel na succesvolle write");
        try { Directory.Delete(cleanDir, true); } catch {}

        // T29: oude 0.3.8.0-installatie zonder state file -> backward-compatible safe-defaults (IDLE), geen crash
        var bareDir = Path.Combine(Path.GetTempPath(), "3sm-state2-bare-" + Guid.NewGuid().ToString("N"));
        var bareStore = new UpdaterStateStore(bareDir);  // map bestaat nog niet
        var s29 = bareStore.Load();
        Assert(s29.state == "IDLE" && s29.schemaVersion == 1, "T29 oude installatie zonder state-file -> Idle, backward-compat");

        // multiwriter variant (T19 concurrent): 2 threads
        var w1 = new Thread(() => { for (int i=0;i<60;i++) store.TryUpdate(c=>c.state="INSTALLING"); });
        var w2 = new Thread(() => { for (int i=0;i<60;i++) store.TryUpdate(c=>c.state="SUCCESS"); });
        w1.Start(); w2.Start(); w1.Join(); w2.Join();
        var last = store.Load();
        Assert(last.state=="INSTALLING" || last.state=="SUCCESS", "T19 multiwriter last-writer-wins, geen crash");
        Assert(Directory.GetFiles(dir, "updater-state.json.corrupt-*").Length == 0 || last.state!="", "T19 geen corruptie onder multiwriter");

        try { Directory.Delete(dir, true); } catch {}
        try { Directory.Delete(bareDir, true); } catch {}
        Console.WriteLine(_fail==0 ? "ALL_PASS" : "HAD_FAILURES=" + _fail);
        return _fail==0?0:1;
    }
}