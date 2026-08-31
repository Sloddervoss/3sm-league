// Dummy SimHubWPF.exe voor de 3SM updater E2E-harness.
// Backward-compatibel met bestaande tests:
//   SimHubWPF.exe --pidfile <f> [--exit-after ms]        (legacy: sleep daarna exit)
//   SimHubWPF.exe --started-event <n> --allow-exit-event <n> --pidfile <f>  (deterministic)
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
        int exitAfter = -1;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--pidfile" && i + 1 < args.Length) pidfile = args[i + 1];
            if (args[i] == "--started-event" && i + 1 < args.Length) startedEvent = args[i + 1];
            if (args[i] == "--allow-exit-event" && i + 1 < args.Length) allowExitEvent = args[i + 1];
            if (args[i] == "--exit-after" && i + 1 < args.Length) int.TryParse(args[i + 1], out exitAfter);
        }

        var p = System.Diagnostics.Process.GetCurrentProcess();
        if (pidfile != null)
        {
            try { File.WriteAllText(pidfile, p.Id + "\n" + p.StartTime.ToUniversalTime().Ticks + "\n" + System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName); } catch { }
        }

        // Deterministic handshake (events).
        if (startedEvent != null && allowExitEvent != null)
        {
            try { using (var s = EventWaitHandle.OpenExisting(startedEvent)) s.Set(); } catch { }
            try { using (var allow = EventWaitHandle.OpenExisting(allowExitEvent)) allow.WaitOne(TimeSpan.FromMinutes(5)); } catch { }
            return 0;
        }

        // Legacy: exit na N ms.
        if (exitAfter >= 0) { Thread.Sleep(exitAfter); return 0; }

        // Anders: blijf draaien tot gedood.
        Thread.Sleep(Timeout.Infinite);
        return 0;
    }
}