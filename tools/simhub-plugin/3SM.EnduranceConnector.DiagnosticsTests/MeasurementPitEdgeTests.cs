using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

// Expliciete pit_in/pit_out-flanken: bron-tijdstempel, monotone volgorde,
// continuïteit en duurzame outbox. Geen SimHub, iRacing, netwerk of database.
internal static class MeasurementPitEdgeTests
{
    private static readonly DateTime T0 = new DateTime(2026, 11, 21, 14, 0, 0, DateTimeKind.Utc);

    private static TelemetrySample Sample(double seconds, bool? pit, bool? resetOrTow = false,
        string segment = "seg-edge", string session = "sim-42-s1")
    {
        return new TelemetrySample
        {
            ObservedAtUtc = T0.AddSeconds(seconds),
            SdkTick = 100000 + (long)(seconds * 60),
            SessionTimeSeconds = 1000 + seconds,
            LapNumber = 12,
            SegmentId = segment,
            ObservedSessionId = session,
            OnPitRoad = pit,
            ResetOrTow = resetOrTow
        };
    }


    /// <summary>
    /// Echte serializeroutput voor de cross-language parser-/opslagtest.
    /// Dezelfde pipeline en dezelfde wire-DTO als productie.
    /// </summary>
    public static string ExportJson()
    {
        var directory = Path.Combine(Path.GetTempPath(), "3sm-pit-edge-export-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var outbox = new MeasurementOutbox(Path.Combine(directory, "outbox.json"));
        var pipeline = new MeasurementPipeline(outbox, new MeasurementIdFactory());
        pipeline.BeginSession("sim-fixture-1");
        var t = new DateTime(2026, 11, 21, 12, 0, 0, DateTimeKind.Utc);
        TelemetrySample At(double seconds, bool pit) => new TelemetrySample
        {
            ObservedAtUtc = t.AddSeconds(seconds),
            SdkTick = 200000 + (long)(seconds * 60),
            SessionTimeSeconds = 1000 + seconds,
            LapNumber = 12,
            SegmentId = "seg-fixture",
            ObservedSessionId = "sim-fixture-1",
            OnPitRoad = pit,
            ResetOrTow = false
        };
        pipeline.Observe(At(0, false));
        pipeline.Observe(At(1, true));
        for (var second = 2; second <= 40; second++) pipeline.Observe(At(second, true));
        pipeline.Observe(At(41, false));
        var rows = outbox.Due(DateTime.UtcNow, 10, 10).Events;
        var parts = new List<string>();
        foreach (var row in rows) parts.Add(row.RowJson);
        try { Directory.Delete(directory, true); } catch { }
        return "[" + string.Join(",", parts) + "]";
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        for (var second = 2; second <= 40; second++) tracker.Update(Sample(second, true));
        tracker.Update(Sample(41, false));
        var edges = tracker.DrainEdges();
        Check("PE01", edges.Count == 2 && edges[0].Kind == "pit_in" && edges[1].Kind == "pit_out",
            "een expliciete false->true en true->false leveren precies twee bronflanken");
        Check("PE02", edges[0].Valid && edges[1].Valid
            && Math.Abs(edges[0].SessionTimeSeconds.Value - 1001) < 1e-9
            && Math.Abs(edges[1].SessionTimeSeconds.Value - 1041) < 1e-9,
            "beide flanken dragen hun eigen sessietijd (1001 -> 1041)");
        Check("PE03", edges[0].PitVisitId == edges[1].PitVisitId
            && edges[0].ObservedSessionId == "sim-42-s1" && edges[1].ObservedSessionId == "sim-42-s1",
            "dezelfde pitVisitId en observed-sessie verbinden alleen deze twee flanken");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        tracker.Update(Sample(3, null));
        tracker.Update(Sample(20, false));
        edges = tracker.DrainEdges();
        Check("PE04", edges.Count == 2 && edges[1].Problems.Contains("pit_flag_unknown"),
            "een onbekende OnPitRoad midden in het bezoek wordt expliciet afgekeurd");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        tracker.Update(Sample(10, true));
        tracker.Update(Sample(30, false));
        edges = tracker.DrainEdges();
        Check("PE05", edges[1].Problems.Contains("telemetry_gap"),
            "een gat van 20 s in de flankreeks is geen continue meting");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        tracker.Update(Sample(20, true, resetOrTow: true));
        tracker.Update(Sample(40, false));
        edges = tracker.DrainEdges();
        Check("PE06", edges[1].Problems.Contains("reset_or_tow"),
            "een reset/tow tijdens het bezoek keurt de flank af");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        tracker.Update(Sample(20, true, resetOrTow: null));
        tracker.Update(Sample(40, false, resetOrTow: null));
        edges = tracker.DrainEdges();
        Check("PE07", edges[1].Problems.Contains("tow_unknown"),
            "onbekende tow-reset is onbekend, niet stilzwijgend false");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, true));
        tracker.Update(Sample(40, false));
        edges = tracker.DrainEdges();
        Check("PE08", edges.Count == 1 && edges[0].Kind == "pit_out" && edges[0].Problems.Contains("entry_not_observed"),
            "een bezoek dat al in de pit begon heeft geen entryflank en levert geen bruikbare duur");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        var changed = Sample(20, true, segment: "seg-edge-2");
        tracker.Update(changed);
        edges = tracker.DrainEdges();
        Check("PE09", edges.Count == 1 && edges[0].Kind == "pit_in" && tracker.Current == null,
            "een sessiewissel sluit zonder verzonnen pit_out; alleen de entry blijft als orphan");

        tracker = new PitServiceTracker("seg-edge");
        tracker.Update(Sample(0, false));
        tracker.Update(Sample(1, true));
        tracker.Update(Sample(3, false));
        edges = tracker.DrainEdges();
        Check("PE10", edges[1].Problems.Contains("duration_out_of_bounds"),
            "een pitduur onder 5 s wordt als onbruikbare flank gemarkeerd");

        // De outbox is de duurzame grens: de wirevorm moet confidence en de
        // bron-tijdstempels bevatten, anders kan de database nooit paren.
        var directory = Path.Combine(Path.GetTempPath(), "3sm-pit-edge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var outbox = new MeasurementOutbox(Path.Combine(directory, "outbox.json"));
        var ids = new MeasurementIdFactory();
        var pipeline = new MeasurementPipeline(outbox, ids);
        pipeline.BeginSession("sim-42-s1");
        pipeline.Observe(Sample(0, false));
        pipeline.Observe(Sample(1, true));
        pipeline.Observe(Sample(40, false));
        var rows = outbox.Due(DateTime.UtcNow, 10, 10).Events;
        var eventRows = new List<JsonElement>();
        foreach (var row in rows) eventRows.Add(JsonDocument.Parse(row.RowJson).RootElement);
        Check("PE11", eventRows.Count == 2
            && eventRows[0].GetProperty("kind").GetString() == "pit_in"
            && eventRows[1].GetProperty("kind").GetString() == "pit_out",
            "de pipeline zet beide expliciete flanken in de duurzame outbox");
        Check("PE12", eventRows[0].GetProperty("confidence").GetDouble() == 1
            && eventRows[0].GetProperty("sessionTimeSeconds").GetDouble() == 1001
            && eventRows[0].GetProperty("sdkTick").GetInt64() > 0,
            "de wirevorm bewaart confidence, sessietijd en SDK-tick per flank");
        try { Directory.Delete(directory, true); } catch { }

        return count;
    }
}
