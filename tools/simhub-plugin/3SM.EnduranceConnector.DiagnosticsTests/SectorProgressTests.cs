using System;
using ThreeSM.EnduranceConnector;

internal static class SectorProgressTests
{
    public static int Run(Action<string, bool, string> check)
    {
        var passed = 0;
        Action<string, bool> test = (id, ok) => { if (ok) passed++; check("sector_clock/" + id, ok, "production-shaped telemetry"); };
        var m = new SectorProgressMonitor();
        m.BeginContext("imola|gp", "race-1");
        var layout = RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: 0\n - SectorNum: 1\n   SectorStartPct: 0.30\n - SectorNum: 2\n   SectorStartPct: 0.70\n");
        m.PublishBoundaries(layout);
        test("real_layout", m.HasPublishedLayout);
        test("joining_mid_sector", !m.Update(113.7, .995, 3, 3, false, 1).HasValue);
        var finish = m.Update(.4, .005, 1, null, false, 2);
        test("finish_wrap", finish.HasValue && finish.Value.ElapsedSeconds == .4 && finish.Value.Count == 3);
        var progress = m.Update(2, .10, 1, null, false, 2);
        test("correct_first_boundary", progress.HasValue && Math.Abs(progress.Value.ProgressPct - 100.0 / 3) < .001);
        test("jump_aborts", !m.Update(25, .28, 1, 3, false, 2).HasValue);
        var entered = m.Update(26, .32, 2, 3, false, 2);
        test("interpolates_entry", entered.HasValue && Math.Abs(entered.Value.ElapsedSeconds - .5) < .001);
        test("pit_aborts", !m.Update(27, .34, 2, 3, true, 2).HasValue);
        test("no_clock_after_pits", !m.Update(28, .36, 2, 3, false, 2).HasValue);
        test("unknown_pit_clears", !m.Update(29, .38, 2, 3, null, 2).HasValue);
        test("missing_lap_clears", !m.Update(30, .39, 2, 3, false, null).HasValue);
        m.BeginContext("imola|gp", "race-2");
        test("session_resets_anchors", !m.Update(5, .4, 2, 3, false, 2).HasValue);
        test("new_layout_retried", !m.HasPublishedLayout);
        m.Update(10, .28, 1, 3, false, 3);
        var learned = m.Update(11, .31, 2, 3, false, 3);
        test("fallback_clock_no_guess_bar", learned.HasValue && !learned.Value.Learned);
        m.Update(40, .69, 2, 3, false, 3);
        var last = m.Update(41, .71, 3, 3, false, 3);
        test("fallback_reliable_after_boundary", last.HasValue && last.Value.Learned);
        test("backwards_time", !m.Update(3, .73, 3, 3, false, 3).HasValue);
        test("nan", !m.Update(double.NaN, .73, 3, 3, false, 3).HasValue);
        return passed;
    }
}
