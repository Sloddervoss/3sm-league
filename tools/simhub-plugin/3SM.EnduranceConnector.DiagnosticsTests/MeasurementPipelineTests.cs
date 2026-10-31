using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using ThreeSM.EnduranceConnector;

// De hele keten zoals de plugin hem per tick aanroept: sampler, pitdetectie,
// ankerdetectie en outbox. Geen SimHub, geen HTTP.
internal static class MeasurementPipelineTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 16, 0, 0, DateTimeKind.Utc);

    private static string NewDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "3sm-pipeline-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static MeasurementPipeline Pipeline(out MeasurementOutbox outbox, string sessionId = "sessie-1")
    {
        outbox = new MeasurementOutbox(Path.Combine(NewDirectory(), "outbox.json"));
        var sequence = 1;
        var ids = new MeasurementIdFactory(() => new Guid(sequence++, 0, 0, new byte[8]));
        var pipeline = new MeasurementPipeline(outbox, ids);
        pipeline.BeginSession(sessionId);
        return pipeline;
    }

    private static void Emit(MeasurementPipeline pipeline, double seconds, int lap, double fuel, bool onPitRoad,
        int? flags = null, double? wearFl = null, double? wearFr = null, double? wearRl = null, double? wearRr = null,
        int? setsUsed = null, string sessionId = null, long? tick = null)
    {
        var sample = new TelemetrySample
        {
            ObservedAtUtc = T0.AddSeconds(seconds),
            SdkTick = tick ?? (long)(seconds * 20),
            SessionTimeSeconds = 1000 + seconds,
            LapNumber = lap,
            ObservedSessionId = sessionId ?? "sessie-1",
            CurrentDriverName = "Vincent de Vos",
            OnPitRoad = onPitRoad,
            FuelLitres = fuel,
            PitServiceFlagsRaw = flags,
            TrackTempC = 30,
            AirTempC = 20,
            LatAccelG = 1.2,
            LongAccelG = -0.3,
            TyreSetsUsed = setsUsed
        };
        if (wearFl.HasValue)
        {
            sample.Wear = new WearReading(wearFl.Value, wearFr ?? wearFl.Value, wearRl ?? wearFl.Value, wearRr ?? wearFl.Value);
        }
        pipeline.Observe(sample);
    }

    private static MeasurementLapSummaryDto Summary(OutboxEntry entry)
    {
        return MeasurementJson.Deserialize<MeasurementLapSummaryDto>(entry.RowJson);
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // Één ronde van 3 s, daarna een rondewissel.
        var pipeline = Pipeline(out var outbox);
        for (var index = 0; index < 60; index++) Emit(pipeline, index * 0.05, 1, 50, false, wearFl: 95, setsUsed: 1);
        for (var index = 0; index < 5; index++) Emit(pipeline, 3.0 + index * 0.05, 2, 48, false, wearFl: 95, setsUsed: 1);
        var laps = outbox.Due(T0.AddSeconds(10), 20, 5).Laps;
        Check("L01", laps.Count == 1, "één afgeronde ronde staat in de outbox (" + laps.Count + ")");
        var round = laps.Count > 0 ? Summary(laps[0]) : null;
        Check("L02", round != null && round.LapNumber == 1 && round.Complete == true
            && round.SampleCount.HasValue && round.SampleCount.Value >= 30,
            "de ronde is compleet en heeft dekking per groep (" + (round == null ? "-" : round.SampleCount.ToString()) + ")");
        Check("L03", round != null && round.Coverage != null && round.Coverage.Temperature != null
            && round.Coverage.Temperature.SampleCount > 0 && round.Coverage.Temperature.MaxGapSeconds <= 0.06,
            "temperatuurdekking staat per groep in de payload");
        Check("L04", round != null && round.TrackTempCMean.HasValue && Math.Abs(round.TrackTempCMean.Value - 30) < 0.001
            && round.AirTempCMean.HasValue && Math.Abs(round.AirTempCMean.Value - 20) < 0.001,
            "track- en airtemperatuur zijn gemiddelden van de echte samples");
        Check("L05", round != null && round.FuelStartLitres == 50 && round.FuelEndLitres == 50
            && round.FuelLevelIntegralLitreSeconds.HasValue,
            "brandstof start/eind en niveau-integraal zijn gevuld");
        Check("L06", round != null && !string.IsNullOrEmpty(round.SummaryUid)
            && MeasurementIds.IsUid(round.SummaryUid) && round.RecordRevision == 1,
            "de ronde heeft een UUID en begint op revisie 1");
        Check("L07", round != null && round.CurrentDriverName == "Vincent de Vos" && round.DriverChanged == null,
            "de rijder staat als SimHub-naam op de ronde, zonder client-ID");

        var events = outbox.Due(T0.AddSeconds(10), 20, 5).Events;
        var sessionStart = events.Select(e => e.RowJson).FirstOrDefault(json => json.Contains("session_start"));
        Check("L08", sessionStart != null && sessionStart.Contains("remaining_percent"),
            "de eerste wear-lezing is als session_start-event in de outbox gezet");
        Check("L09", round != null && round.WearObservationIds != null && round.WearObservationIds.Length == 1,
            "de ronde verwijst naar de wear-waarneming die erin is gedaan");

        // ------------------------------------------------- tanken op de finishlijn
        pipeline = Pipeline(out var pitOutbox);
        for (var index = 0; index < 40; index++) Emit(pipeline, index * 0.05, 5, 50, false, wearFl: 90, setsUsed: 1);
        // De pitstraat in op ronde 5.
        for (var index = 0; index < 4; index++)
            Emit(pipeline, 2.0 + index * 0.05, 5, 50, true,
                PitServiceFlags.FuelFill | PitServiceFlags.FrontLeftTyre,
                wearFl: 60, wearFr: 90, wearRl: 90, wearRr: 90, setsUsed: 1);
        // De finishlijn wordt gepasseerd terwijl de auto nog in de pitbox staat.
        for (var index = 0; index < 4; index++)
            Emit(pipeline, 2.2 + index * 0.05, 6, 75, true,
                PitServiceFlags.FuelFill | PitServiceFlags.FrontLeftTyre,
                wearFl: 60, wearFr: 90, wearRl: 90, wearRr: 90, setsUsed: 1);
        // En eruit, met een nieuwe linkervoorband.
        Emit(pipeline, 2.4, 6, 75, false, wearFl: 100, wearFr: 90, wearRl: 90, wearRr: 90, setsUsed: 2);
        for (var index = 0; index < 40; index++)
            Emit(pipeline, 2.45 + index * 0.05, 6, 75, false,
                wearFl: 100, wearFr: 90, wearRl: 90, wearRr: 90, setsUsed: 2);
        pipeline.End("test");

        var pitLaps = pitOutbox.Due(T0.AddSeconds(20), 20, 5).Laps.Select(Summary).ToList();
        var lapFive = pitLaps.FirstOrDefault(lap => lap.LapNumber == 5);
        var lapSix = pitLaps.FirstOrDefault(lap => lap.LapNumber == 6);
        Check("L10", lapFive != null && lapSix != null, "beide rondes zijn afgerond en bewaard");
        Check("L11", lapFive != null && lapFive.PitLap == true && lapFive.PitVisitIds != null && lapFive.PitVisitIds.Length == 1,
            "de ronde waarin de pitstraat in werd gereden is een pitlap met het bezoek erbij");
        Check("L12", lapSix != null && lapSix.PitLap == true && lapSix.PitVisitIds != null && lapSix.PitVisitIds.Length == 1,
            "hetzelfde bezoek staat ook bij de ronde waarin het eindigde");
        Check("L13", lapFive != null && lapFive.FuelAddedLitresObserved == null && lapSix != null
            && lapSix.FuelAddedLitresObserved.HasValue && Math.Abs(lapSix.FuelAddedLitresObserved.Value - 25) < 0.01,
            "de 25 L is één keer geteld, op de ronde waarin de delta is waargenomen ("
            + (lapSix == null ? "-" : lapSix.FuelAddedLitresObserved.ToString()) + ")");
        Check("L14", lapFive != null && lapSix != null && lapFive.PitVisitIds[0] == lapSix.PitVisitIds[0],
            "beide rondes verwijzen naar hetzelfde pitVisitId");
        var wearEvent = pitOutbox.Due(T0.AddSeconds(20), 20, 5).Events
            .Select(e => e.RowJson).FirstOrDefault(json => json.Contains("wear_refresh_confirmed"));
        Check("L15", wearEvent != null && wearEvent.Contains("\"fl\":1") && wearEvent.Contains("\"fr\":0"),
            "de nieuwe linkervoorband is bevestigd en de setgeneratie telt alleen FL");
        Check("L16", lapSix != null && lapSix.WearObservationIds != null
            && lapSix.WearObservationIds.Any(uid => wearEvent != null && wearEvent.Contains(uid)),
            "de ronde verwijst naar die wear-waarneming");

        // -------------------------------------------------- sessiewissel zonder restart
        pipeline = Pipeline(out var switchOutbox);
        for (var index = 0; index < 40; index++) Emit(pipeline, index * 0.05, 3, 40, false, wearFl: 95, setsUsed: 1);
        var segmentBefore = pipeline.SegmentId;
        for (var index = 0; index < 40; index++)
            Emit(pipeline, 2.0 + index * 0.05, 0, 30, false, wearFl: 95, setsUsed: 1, sessionId: "sessie-2");
        var switchedLaps = switchOutbox.Due(T0.AddSeconds(20), 20, 5).Laps.Select(Summary).ToList();
        Check("L17", pipeline.SegmentId != segmentBefore, "een sessiewissel levert een nieuw segment");
        Check("L18", switchedLaps.Count >= 1 && switchedLaps[0].ObservedSessionId == "sessie-1"
            && switchedLaps[0].InvalidReasons != null && switchedLaps[0].InvalidReasons.Contains("session_changed")
            && switchedLaps[0].Complete == false,
            "de oude ronde wordt met reden afgesloten, niet doorgeteld");
        Check("L19", switchedLaps.Any(lap => lap.ObservedSessionId == "sessie-2") == false,
            "de nieuwe sessie levert nog geen afgeronde ronde op (die loopt nog)");
        var startEvents = switchOutbox.Due(T0.AddSeconds(20), 20, 5).Events
            .Count(entry => entry.RowJson.Contains("session_start"));
        Check("L20", startEvents == 2, "elke sessie begint met een eigen session_start-anker (" + startEvents + ")");

        // ------------------------------------------------------- dubbbele ticks
        pipeline = Pipeline(out var duplicateOutbox);
        for (var index = 0; index < 60; index++) Emit(pipeline, index * 0.05, 1, 50, false, wearFl: 95, setsUsed: 1, tick: 100 + index);
        // Dezelfde tick tien keer opnieuw: geen extra samples, geen extra dekking.
        for (var index = 0; index < 10; index++) Emit(pipeline, 3.0, 2, 50, false, wearFl: 95, setsUsed: 1, tick: 159);
        // Pas een echt nieuwe tick sluit de ronde af.
        Emit(pipeline, 3.05, 2, 50, false, wearFl: 95, setsUsed: 1, tick: 160);
        var duplicateLaps = duplicateOutbox.Due(T0.AddSeconds(10), 20, 5).Laps.Select(Summary).ToList();
        var measured = duplicateLaps.FirstOrDefault(lap => lap.LapNumber == 1);
        Check("L21", measured != null && measured.Coverage != null
            && measured.Coverage.Temperature.SampleCount == 60,
            "tien keer dezelfde SDK-tick telt niet als tien samples ("
            + (measured == null || measured.Coverage == null ? "-" : measured.Coverage.Temperature.SampleCount.ToString()) + ")");

        // ------------------------------------------------------------- afsluiten
        pipeline = Pipeline(out var endOutbox);
        for (var index = 0; index < 40; index++) Emit(pipeline, index * 0.05, 9, 45, false, wearFl: 88, setsUsed: 1);
        Emit(pipeline, 2.0, 9, 45, true, PitServiceFlags.FuelFill);
        pipeline.End("plugin_shutdown");
        var endLaps = endOutbox.Due(T0.AddSeconds(10), 20, 5).Laps.Select(Summary).ToList();
        var endVisits = endOutbox.EventCount + endOutbox.LapCount;
        Check("L22", endLaps.Count == 1 && endLaps[0].InvalidReasons != null
            && endLaps[0].InvalidReasons.Contains("plugin_shutdown") && endLaps[0].Complete == false,
            "afsluiten levert een expliciet onvolledige ronde op in plaats van verlies");
        Check("L23", pipeline.Status().PitVisits == 1 && endOutbox.EventCount >= 1,
            "het open pitbezoek is gesloten en de ankers zijn bewaard");

        // ------------------------------------------------------------ statusregel
        var status = pipeline.Status();
        Check("L24", status.AcceptedSamples == 41 && status.QueuedEvents + status.QueuedLaps == endVisits
            && status.Summary.Contains("samples=41"),
            "de statusregel telt wat er echt is waargenomen en bewaard (" + status.Summary + ")");

        return count;
    }
}
