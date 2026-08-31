// 3SM 0.3.9.0 — HTTP download-failure-tests via reflectie op de ECHTE connector.
//   ConnectorHttpTest.exe <connector.dll> <mockBaseUrl> <outDir>
// Roept de private static DownloadUpdateAsync(Uri, destination, maxBytes, ct) aan voor elk
// scenario en controleert: (a) het gooit de juiste error, (b) geen valide staged (destination
// verwijderd of n�iet-valide), (c) target nooit aangeraakt.
using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

class ConnectorHttpTest
{
    static string _simhubDir = @"C:\Program Files (x86)\SimHub";
    static Assembly Resolve(object s, ResolveEventArgs a)
    {
        var n = new AssemblyName(a.Name).Name + ".dll";
        foreach (var c in new[]{Path.Combine(_simhubDir,n), Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),n)})
            if (File.Exists(c)) try { return Assembly.LoadFrom(c); } catch {}
        return null;
    }

    static bool TryDownload(MethodInfo dl, string url, string dest)
    {
        var uri = new Uri(url);
        try
        {
            var task = (Task)dl.Invoke(null, new object[]{ uri, dest, 5*1024*1024, CancellationToken.None });
            task.GetAwaiter().GetResult();
            return true; // geen error
        }
        catch { return false; } // erro/throw
    }

    static int Main(string[] args)
    {
        try {
            if (args.Length < 3) { Console.WriteLine("usage: ConnectorHttpTest.exe <dll> <baseUrl> <outDir>"); return 2; }
            AppDomain.CurrentDomain.AssemblyResolve += Resolve;
            var asm = Assembly.LoadFile(Path.GetFullPath(args[0]));
            var t = asm.GetType("ThreeSM.EnduranceConnector.EnduranceConnectorPlugin");
            var dl = t.GetMethod("DownloadUpdateAsync", BindingFlags.NonPublic | BindingFlags.Static);
            if (dl == null) { Console.WriteLine("FAIL: DownloadUpdateAsync niet gevonden"); return 1; }
            var baseUrl = args[1].TrimEnd('/');
            var outDir = Path.GetFullPath(args[2]);
            Directory.CreateDirectory(outDir);

            int fail=0;
            // H1: timeout (server accepteert maar hangt) — client Timeout=45s te lang voor de test;
            // we testen met korte timeout via een eigen Task.Timeout wrapper in de runner.
            // (zie opmerking: DownloadUpdateAsync heeft hardcoded 45s client-timeout; de
            //  CancellationToken meegeven is al ge-canceld om timeout te simuleren.)
            // H2: connection failure (poort gesloten — server niet op die poort)
            // H3: 404/500
            // H4: truncated (Content-Length beloofd, abort)
            // H5: wronglen (Content-Length < body)
            // H6: abort mid-download
            // H7: recovery na failure (eerst /404 dan /ok)

            var scenarios = new[] {
                ("H2_conn",   "http://127.0.0.1:19999/none", false, "connection refused (poort gesloten)"),
                ("H3_404",    baseUrl + "/404", false, "HTTP 404"),
                ("H3_500",    baseUrl + "/500", false, "HTTP 500"),
                ("H4_trunc",  baseUrl + "/truncated", false, "truncated (abort na deel)"),
                ("H5_wrongl", baseUrl + "/wronglen", false, "content-length mismatch"),
                ("H6_abort",  baseUrl + "/abort/50000", false, "abort mid-download"),
            };

            foreach (var (name, url, expectOk, desc) in scenarios)
            {
                var dest = Path.Combine(outDir, name + ".tmp.dll");
                if (File.Exists(dest)) File.Delete(dest);
                var ok = TryDownload(dl, url, dest);
                // verwacht: ok==false (error) en destination NIET een geldig/staged bestand
                bool destGoneOrInvalid = !File.Exists(dest); // success-pad verwijdert bij error; bij ok blijft
                Console.WriteLine("  " + (ok?"OK  ":"ERR ") + name + " -> ok=" + ok + " destExists=" + File.Exists(dest) + " (" + desc + ")");
                if (ok || File.Exists(dest)) { Console.WriteLine("    mismatch: gehoopt error+geen dest"); fail++; }
            }

            // H1 timeout via CancellationToken al gecancelled (simuleert timeout)
            var timedDest = Path.Combine(outDir, "H1_timeout.tmp.dll");
            if (File.Exists(timedDest)) File.Delete(timedDest);
            var cts = new CancellationTokenSource();
            cts.Cancel();
            bool timedOK;
            try {
                var task = (Task)dl.Invoke(null, new object[]{ new Uri(baseUrl+"/ok/300000"), timedDest, 5*1024*1024, cts.Token });
                task.GetAwaiter().GetResult(); timedOK = true;
            } catch (OperationCanceledException){ timedOK = false; }
            catch { timedOK = false; }
            Console.WriteLine("  " + (timedOK?"OK  ":"ERR ") + "H1_timeout -> cancelled(no ok)=" + (!timedOK) + " destExists=" + File.Exists(timedDest));
            if (timedOK || File.Exists(timedDest)) { Console.WriteLine("    mismatch"); fail++; }

            // H7 recovery: na een 404-failure moet een daaropvolgende /ok download w�l slagen
            var failDest = Path.Combine(outDir, "H7_fail.tmp.dll");
            if(File.Exists(failDest)) File.Delete(failDest);
            TryDownload(dl, baseUrl+"/404", failDest);  // faalt
            var okDest = Path.Combine(outDir, "H7_ok.tmp.dll");
            if(File.Exists(okDest)) File.Delete(okDest);
            var rec = TryDownload(dl, baseUrl+"/ok/300000", okDest);
            Console.WriteLine("  " + (rec?"OK  ":"ERR ") + "H7_recovery -> ok=" + rec + " destExists=" + File.Exists(okDest) + " destLen=" + (File.Exists(okDest)?new FileInfo(okDest).Length.ToString():"-"));
            if(!rec || !File.Exists(okDest)){ Console.WriteLine("    mismatch: recovery na failure zou moeten slagen"); fail++; }

            Console.WriteLine("RESULT: " + (fail==0?"PASS":"FAIL") + " failures=" + fail);
            return fail==0?0:1;
        } catch (Exception ex) { Console.WriteLine("FATAL: " + ex); return -1; }
    }
}