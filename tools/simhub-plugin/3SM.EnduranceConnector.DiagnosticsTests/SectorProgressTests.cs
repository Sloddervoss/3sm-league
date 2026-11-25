using System;
using ThreeSM.EnduranceConnector;

/// <summary>
/// Gedragstests voor de live sectorklok: grenzen uit de sessiedata, leren uit een
/// sprong van precies één sector, de poorten (pitstraat, ongeldige index, geen
/// positie) en de terugval op gelijke delen. Alles met vaste waarden, zodat een
/// fout in de rekenregel meteen zichtbaar is.
/// </summary>
internal static class SectorProgressTests
{
    public static int Run(Action<string, bool, string> check)
    {
        var passed = 0;
        Action<string, bool, string> c = (id, condition, evidence) =>
        {
            if (condition) passed++;
            check(id, condition, evidence);
        };

        Try(c, "sector_published_boundaries", () =>
        {
            var monitor = new SectorProgressMonitor();
            monitor.PublishBoundaries("imola|", new[] { 0.30, 0.70 }, 3);

            var start = monitor.Update("imola|", 12.0, 0.10, 1, 3, false, 4);
            c("sector_published_boundaries/1", start.HasValue, "sector 1 geeft een meting");
            if (!start.HasValue) return;
            c("sector_published_boundaries/2", start.Value.ElapsedSeconds == 12.0, "klok telt vanaf de start van de ronde");
            c("sector_published_boundaries/3", Math.Abs(start.Value.ProgressPct - 33.3) < 0.2, "progress binnen sector 1");

            var entered = monitor.Update("imola|", 25.0, 0.32, 2, 3, false, 4);
            c("sector_published_boundaries/4", entered.HasValue && entered.Value.Index == 2, "sector 2 herkend");
            if (!entered.HasValue) return;
            c("sector_published_boundaries/5", entered.Value.ElapsedSeconds < 0.001, "sectorklok start op het moment van binnenkomen");

            var second = monitor.Update("imola|", 38.0, 0.50, 2, 3, false, 4);
            c("sector_published_boundaries/6", second.HasValue && Math.Abs(second.Value.ElapsedSeconds - 13.0) < 0.001, "13 s in sector 2");
            c("sector_published_boundaries/7", second.HasValue && Math.Abs(second.Value.ProgressPct - 50.0) < 0.2, "halverwege sector 2");
            c("sector_published_boundaries/8", second.HasValue && second.Value.Learned, "beide grenzen bekend");
        });

        Try(c, "sector_learns_boundary_from_index_jump", () =>
        {
            var monitor = new SectorProgressMonitor();
            // Twee sectoren: de laatste sector heeft maar één grens nodig.
            monitor.Update("sebring|", 10.0, 0.20, 1, 2, false, 2);
            monitor.Update("sebring|", 22.5, 0.50, 2, 2, false, 2);

            var nextTick = monitor.Update("sebring|", 24.0, 0.60, 2, 2, false, 2);
            c("sector_learns_boundary_from_index_jump/1", nextTick.HasValue, "meting blijft doorlopen");
            if (!nextTick.HasValue) return;
            c("sector_learns_boundary_from_index_jump/2", nextTick.Value.Learned, "grens is geleerd en de balk is betrouwbaar");
            c("sector_learns_boundary_from_index_jump/3", Math.Abs(nextTick.Value.ProgressPct - 20.0) < 1.0, "progress met geleerde grens");
        });

        Try(c, "sector_learns_nothing_on_skip", () =>
        {
            var monitor = new SectorProgressMonitor();
            monitor.Update("sebring|", 10.0, 0.20, 1, 3, false, 2);
            // Sprong van 1 naar 3 (reset/tow): geen grens leren.
            var skipped = monitor.Update("sebring|", 20.0, 0.60, 3, 3, false, 2);
            c("sector_learns_nothing_on_skip/1", skipped.HasValue, "meting met geldige index blijft bestaan");
            c("sector_learns_nothing_on_skip/2", !skipped.Value.Learned, "zonder geleerde grens blijft de balk op gelijke delen");
        });

        Try(c, "sector_gates", () =>
        {
            var monitor = new SectorProgressMonitor();
            c("sector_gates/1", !monitor.Update("sebring|", 10.0, 0.5, 2, 3, true, 1).HasValue, "pitstraat geeft geen meting");
            c("sector_gates/2", !monitor.Update("sebring|", 10.0, 0.5, 4, 3, false, 1).HasValue, "index boven aantal is ongeldig");
            c("sector_gates/3", !monitor.Update("sebring|", 10.0, null, 2, 3, false, 1).HasValue, "zonder positie geen meting");
            c("sector_gates/4", !monitor.Update("sebring|", null, 0.5, 2, 3, false, 1).HasValue, "zonder laptijd geen meting");
            c("sector_gates/5", !monitor.Update("sebring|", 10.0, 1.4, 2, 3, false, 1).HasValue, "positie buiten 0..1 is ongeldig");
            c("sector_gates/6", !monitor.Update("", 10.0, 0.5, 2, 3, false, 1).HasValue, "zonder baan geen meting");
        });

        Try(c, "sector_equal_parts_fallback", () =>
        {
            var monitor = new SectorProgressMonitor();
            var tick = monitor.Update("monza|", 30.0, 0.55, 2, 3, false, 5);
            c("sector_equal_parts_fallback/1", tick.HasValue, "meting zonder grenzen");
            if (!tick.HasValue) return;
            // Zonder grenzen: sector 2 loopt van 1/3 tot 2/3 → 0,55 zit op 65 %.
            c("sector_equal_parts_fallback/2", Math.Abs(tick.Value.ProgressPct - 65.0) < 1.0, "gelijke delen als terugval");
            c("sector_equal_parts_fallback/3", !tick.Value.Learned, "zonder grenzen heet de balk niet geleerd");
        });

        return passed;
    }

    private static void Try(Action<string, bool, string> check, string id, Action body)
    {
        try { body(); }
        catch (Exception error) { check(id + "/exception", false, error.Message); }
    }
}
