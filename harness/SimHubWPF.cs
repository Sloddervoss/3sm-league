// Dummy SimHubWPF.exe voor de 3SM updater E2E-harness.
// Deterministic lifecycle via named events (g�en timing-sleeps):
//   SimHubWPF.exe --started-event <name> --allow-exit-event <name> --pidfile <f>
//     1. start, schrijf PID+starttijd+exepath naar pidfile
//     2. set het started-event
//     3. wacht tot het allow-exit-event geset wordt (ManualReset) -> pas dan exit 0
//   SimHubWPF.exe --pidfile <f>
//     start, schrijf pidfile, blijf draaien tot gedood (voor WAITING/timeout tests)
using System;
using System.IO;
using System.Threading;

public static class DummySimHub
{
    public static int Main(string[] args)
    {
        string pidfile = null;
        string startedEvent = null;
        string allowExitEvent = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--pidfile" && i + 1 < args.Length) pidfile = args[i + 1];
            if (args[i] == "--started-event" && i + 1 < args.Length) startedEvent = args[i + 1];
            if (args[i] == "--allow-exit-event" && i + 1 < args.Length) allowExitEvent = args[i + 1];
        }

        var p = System.Diagnostics.Process.GetCurrentProcess();
        if (pidfile != null)
        {
            try { File.WriteAllText(pidfile, p.Id + "\n" + p.StartTime.ToUniversalTime().Ticks + "\n" + System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName); } catch { }
        }

        // Deterministic handshake.
        if (startedEvent != null && allowExitEvent != null)
        {
            // 1. signaler dat de dummy is gestart en de pidfile is geschreven
            try
            {
                using (var s = EventWaitHandle.OpenExisting(startedEvent)) s.Set();
            }
            catch { }
            // 2. wacht tot de harness expliciet toestaat dat de dummy afsluit
            try
            {
                using (var allow = EventWaitHandle.OpenExisting(allowExitEvent))
                {
                    allow.WaitOne(TimeSpan.FromMinutes(5));
                }
            }
            catch { }
            return 0;
        }

        // Anders: blijf draaien tot gedood (WAITING/timeout-test).
        Thread.Sleep(Timeout.Infinite);
        return 0;
    }
}