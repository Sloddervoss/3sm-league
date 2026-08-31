// Dummy SimHubWPF.exe voor de 3SM updater E2E-harness.
// Simuleert het SimHub-proces dat de echte updater via pid/starttime/pad identificeert.
// Gebruik:
//   SimHubWPF.exe                  -> blijf draaien tot gedood (test WAITING_FOR_RESTART / timeout)
//   SimHubWPF.exe --exit-after 3000 -> sluit na 3000 ms (test normale shutdown -> install)
//   SimHubWPF.exe --pidfile <f>    -> schrijf PID+starttime-ticks naar bestand (voor de runner)
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

public static class DummySimHub
{
    public static int Main(string[] args)
    {
        string pidfile = null;
        int exitAfter = -1;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--pidfile" && i + 1 < args.Length) pidfile = args[i + 1];
            if (args[i] == "--exit-after" && i + 1 < args.Length) int.TryParse(args[i + 1], out exitAfter);
        }
        var p = Process.GetCurrentProcess();
        // Kleine stabilisatie zodat StartTime stabiel is voordat de runner het leest.
        if (pidfile != null)
        {
            try { File.WriteAllText(pidfile, p.Id + "\n" + p.StartTime.ToUniversalTime().Ticks + "\n" + Process.GetCurrentProcess().MainModule.FileName); } catch { }
        }
        if (exitAfter >= 0)
        {
            Thread.Sleep(exitAfter);
            return 0;
        }
        // Blijf draaien tot gedood.
        Thread.Sleep(Timeout.Infinite);
        return 0;
    }
}