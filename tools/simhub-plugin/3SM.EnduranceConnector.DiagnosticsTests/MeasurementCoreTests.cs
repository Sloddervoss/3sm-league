using System;
using System.Collections.Generic;
using System.Linq;
using ThreeSM.EnduranceConnector;

// Identiteit, sampler en rondeaggregatie. Alles synthetisch: geen SimHub, geen
// iRacing, geen netwerk. De klok is echt (DateTime) zodat "tijdsinterval" ook echt
// een tijdsinterval is en een gat van vier seconden niet per ongeluk verdwijnt.
internal static class MeasurementCoreTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc);

    private static TelemetrySample Sample(double seconds, int lap, long tick)
    {
        return new TelemetrySample
        {
            ObservedAtUtc = T0.AddSeconds(seconds),
            SdkTick = tick,
            SessionTimeSeconds = 1000 + seconds,
            LapNumber = lap,
            SegmentId = "seg-test",
            ObservedSessionId = "sessie-1",
            CurrentDriverName = "Vincent de Vos"
        };
    }

    private static TelemetrySample Full(double seconds, int lap, long tick, double fuel, double lat, double lon)
    {
        var sample = Sample(seconds, lap, tick);
        sample.TrackTempC = 30;
        sample.AirTempC = 20;
        sample.FuelLitres = fuel;
        sample.LatAccelG = lat;
        sample.LongAccelG = lon;
        return sample;
    }

    // Een ronde van 3 s op 20 Hz met constante kanalen.
    private static IList<LapAggregate> DriveLap(TelemetrySampler sampler, int lap, double startSeconds, int samples,
        double fuel = 60, double lat = 1.5, double lon = -0.4, double track = 30, double air = 20)
    {
        for (var index = 0; index < samples; index++)
        {
            var sample = Full(startSeconds + index * 0.05, lap, 1000 + (long)(startSeconds * 20) + index, fuel, lat, lon);
            sample.TrackTempC = track;
            sample.AirTempC = air;
            sampler.Offer(sample);
        }
        return sampler.Drain();
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // ---------------------------------------------------------------- ID's
        var sequence = 0;
        var factory = new MeasurementIdFactory(() => new Guid(sequence++ + 1, 0, 0, new byte[8]));
        var uidA = factory.NewEventUid();
        var uidB = factory.NewEventUid();
        Check("M01", MeasurementIds.IsUid(uidA) && MeasurementIds.IsUid(uidB), "eventUid is een UUID");
        Check("M02", uidA != uidB, "twee gebeurtenissen krijgen twee UUID's");
        Check("M03", uidA == uidA.ToLowerInvariant(), "UUID gaat in kleine letters over de draad");
        Check("M04", factory.NextEventLabel() == "evt-1" && factory.NextEventLabel() == "evt-2",
            "het label telt op maar is geen sleutel");
        Check("M05", factory.NextSummaryLabel(17) == "lap-17-1", "samenvattinglabel bevat het rondenummer");
        Check("M06", !MeasurementIds.IsUid("evt-1") && !MeasurementIds.IsUid("") && !MeasurementIds.IsUid(null),
            "een label is geen UUID");
        Check("M07", MeasurementIds.IsLocalId("evt-1") && MeasurementIds.IsLocalId("seg-a:b_c.d-1")
            && !MeasurementIds.IsLocalId("met spatie") && !MeasurementIds.IsLocalId(new string('x', 65)),
            "lokale ID's volgen de tekenlijst en de lengte van het contract");
        Check("M08", MeasurementIds.SanitizeLocalId("pit bezoek #2", "pit-0") == "pit-bezoek--2",
            "sanitiseren maakt van ongeldige tekens een streepje");
        Check("M09", MeasurementIds.SanitizeLocalId("", "seg-0") == "seg-0", "leeg blijft nooit leeg");
        Check("M10", MeasurementIds.SanitizeObservedSessionId("  ") == null, "geen verzonnen sessie-ID");
        var stamp = MeasurementTime.Format(new DateTime(2026, 10, 31, 12, 0, 0, 123, DateTimeKind.Utc));
        Check("M11", stamp == "2026-10-31T12:00:00.123Z", "tijd op de draad heeft drie decimalen en een zone");
        Check("M12", MeasurementTime.Parse(stamp).HasValue, "de eigen notatie is terug te lezen");
        Check("M13", MeasurementTime.Format(new DateTime(2026, 10, 31, 12, 0, 0, 0, DateTimeKind.Utc))
            .EndsWith("12:00:00.000Z", StringComparison.Ordinal), "geen zeven decimalen die de Edge weigert");

        // De UUID moet een herstart overleven: dezelfde fabriekswaarde levert dezelfde
        // uid, en de outbox gebruikt die, niet het label.
        var restart = new MeasurementIdFactory(() => new Guid(1, 0, 0, new byte[8]));
        Check("M14", restart.NextEventLabel() == "evt-1" && restart.NewEventUid() == uidA,
            "na een herstart telt het label opnieuw, maar de bewaarde UUID blijft de identiteit");

        // ------------------------------------------------------------- sampler
        var sampler = new TelemetrySampler();
        sampler.Offer(Full(0.0, 1, 500, 60, 1.0, 0.0));
        var duplicate = sampler.Offer(Full(0.0, 1, 500, 60, 1.0, 0.0));
        Check("S01", !duplicate.Accepted && duplicate.Reason == "duplicate_tick",
            "dezelfde SDK-tick telt niet twee keer");
        var tooSoon = sampler.Offer(Full(0.01, 1, 501, 60, 1.0, 0.0));
        Check("S02", !tooSoon.Accepted && tooSoon.Reason == "rate_limited",
            "10 ms na de vorige tick is boven 20 Hz en telt niet mee");
        var nextTick = sampler.Offer(Full(0.05, 1, 502, 60, 1.0, 0.0));
        Check("S03", nextTick.Accepted, "50 ms later is precies 20 Hz en telt mee");
        Check("S04", sampler.DuplicateTickCount == 1 && sampler.ThrottledCount == 1,
            "dubbele ticks en begrensde ticks worden apart geteld");

        // Rondewissel sluit de ronde en begint een nieuwe.
        sampler = new TelemetrySampler();
        var closed = DriveLap(sampler, 4, 0, 60);
        Check("S05", closed.Count == 0, "binnen één ronde sluit niets");
        var changed = sampler.Offer(Full(3.0, 5, 2000, 60, 1.5, -0.4));
        var lapOne = sampler.Drain();
        Check("S06", changed.Accepted && changed.CompletedLaps == 1 && lapOne.Count == 1,
            "een nieuwe rondeteller levert precies één afgerond aggregaat");
        Check("S07", lapOne[0].LapNumber == 4, "het aggregaat hoort bij de ronde die eindigde");

        // Echte tijdsintervallen: 60 samples op 20 Hz = 2,95 s meetduur in een venster
        // van 3,0 s. Een integraal van constante 1,5 g over 2,95 s is 4,425.
        var lap = lapOne[0];
        Check("S08", lap.AbsLatAccelIntegralGSeconds.HasValue && Math.Abs(lap.AbsLatAccelIntegralGSeconds.Value - 4.425) < 0.01,
            "de integraal gebruikt de echte intervallen (4,425 g·s)");
        Check("S09", lap.LatAccelSquaredIntegralG2Seconds.HasValue && Math.Abs(lap.LatAccelSquaredIntegralG2Seconds.Value - 6.6375) < 0.02,
            "a_y² integraal = 1,5² × 2,95 = 6,6375");
        Check("S10", lap.AbsLongAccelIntegralGSeconds.HasValue && Math.Abs(lap.AbsLongAccelIntegralGSeconds.Value - 1.18) < 0.01,
            "|a_x| integraal = 0,4 × 2,95 = 1,18");
        Check("S11", lap.MaxAbsLatAccelG.HasValue && Math.Abs(lap.MaxAbsLatAccelG.Value - 1.5) < 1e-9,
            "max |a_y| komt uit een waarneming");
        Check("S12", lap.FuelStartLitres == 60 && lap.FuelEndLitres == 60, "brandstof start en eind zijn de waargenomen waarden");
        Check("S13", lap.FuelLevelIntegralLitreSeconds.HasValue && Math.Abs(lap.FuelLevelIntegralLitreSeconds.Value - 177.0) < 0.1,
            "niveau-integraal = 60 L × 2,95 s = 177 L·s");
        Check("S14", lap.TrackTempCMin == 30 && lap.TrackTempCMax == 30 && Math.Abs(lap.TrackTempCMean.Value - 30) < 1e-9,
            "temperatuur mean/min/max uit dezelfde reeks");
        var counts = lap.Coverage == null ? "-" : lap.Coverage.Temperature.SampleCount + "/"
            + lap.Coverage.Fuel.SampleCount + "/" + lap.Coverage.Load.SampleCount;
        Check("S15", lap.Coverage != null && lap.Coverage.Temperature.SampleCount == 60
            && lap.Coverage.Fuel.SampleCount == 60 && lap.Coverage.Load.SampleCount == 60,
            "sampleCount is een geheel getal per groep (" + counts + ")");
        Check("S16", lap.Coverage.Temperature.ValidDurationSeconds > 2.9 && lap.Coverage.Temperature.ValidDurationSeconds < 3.0,
            "meetduur is 2,95 s en niet het hele venster");
        Check("S17", lap.Complete && lap.InvalidReasons == null, "drie groepen met 60 samples en 2,95/3,0 s dekking is compleet");
        Check("S18", lap.SampleCount == 180 && Math.Abs(lap.MaxGapSeconds.Value - 0.05) < 1e-6,
            "de vlakke kolommen zijn afgeleiden: som=" + lap.SampleCount + " maxGap=" + lap.MaxGapSeconds);

        // Groot gat: niet interpoleren, wel als dekkingstekort zichtbaar maken.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 60; index++) sampler.Offer(Full(index * 0.05, 9, 3000 + index, 60, 1, 0));
        // Vier seconden stilte en dan weer verder, zonder van ronde te wisselen.
        for (var index = 0; index < 40; index++) sampler.Offer(Full(3.0 + 4.0 + index * 0.05, 9, 4000 + index, 60, 1, 0));
        var gapped = sampler.Close("test");
        Check("S19", gapped.Count == 1 && gapped[0].Coverage.Load.MaxGapSeconds >= 4.0,
            "een gat van 4 s staat als maxGapSeconds in de dekking, niet als interpolatie");
        Check("S20", Math.Abs(gapped[0].AbsLatAccelIntegralGSeconds.Value - (2.95 + 1.95)) < 0.02,
            "over het gat wordt niets geïntegreerd (" + gapped[0].AbsLatAccelIntegralGSeconds + " g·s, verwacht 4,90)");
        Check("S21", !gapped[0].Complete && gapped[0].InvalidReasons.Any(r => r.StartsWith("coverage_gap:", StringComparison.Ordinal)),
            "een gat groter dan 2 s maakt de ronde onvolledig met een reden per groep");

        // Ontbrekende groep: geen brandstof = geen brandstofwaarden, geen verzonnen nul.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 60; index++)
        {
            var sample = Sample(index * 0.05, 2, 5000 + index);
            sample.TrackTempC = 25;
            sample.AirTempC = 18;
            sample.LatAccelG = 0.5;
            sample.LongAccelG = 0.1;
            sampler.Offer(sample);
        }
        var noFuel = sampler.Close("test")[0];
        Check("S22", noFuel.FuelStartLitres == null && noFuel.FuelLevelIntegralLitreSeconds == null && noFuel.Coverage.Fuel == null,
            "zonder brandstofkanaal is er geen brandstofwaarde en geen dekking");
        Check("S23", !noFuel.Complete && noFuel.InvalidReasons.Any(r => r == "coverage_missing:fuel"),
            "ontbrekende groep staat met naam in invalidReasons");
        Check("S24", noFuel.ToSummary("33333333-3333-3333-3333-333333333333", "lap-2-1", "sessie-1").Validate().Count == 0,
            "een ronde zonder brandstof is nog steeds een geldige rij");

        // Sessiewissel zonder procesherstart.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 30; index++) sampler.Offer(Full(index * 0.05, 7, 6000 + index, 40, 1, 0));
        var switched = Full(1.6, 0, 7000, 20, 0, 0);
        switched.ObservedSessionId = "sessie-2";
        switched.SegmentId = "seg-test-2";
        var outcome = sampler.Offer(switched);
        var sessionLaps = sampler.Drain();
        Check("S25", outcome.Accepted && sessionLaps.Count == 1 && sessionLaps[0].LapNumber == 7,
            "een sessiewissel sluit de lopende ronde in plaats van hem door te tellen");
        Check("S26", sessionLaps[0].InvalidReasons != null && sessionLaps[0].InvalidReasons.Contains("session_changed")
            && !sessionLaps[0].Complete, "de afgebroken ronde is expliciet onvolledig");
        Check("S27", sampler.SegmentId == "seg-test-2", "de sampler volgt het nieuwe segment");

        // Tijdterugsprong (replay/reset) is ook een grens, geen doorlopende meting.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 30; index++) sampler.Offer(Full(index * 0.05, 3, 8000 + index, 40, 1, 0));
        var reset = Sample(1.5, 3, 9000);
        reset.SessionTimeSeconds = 200;
        sampler.Offer(reset);
        var resetLaps = sampler.Drain();
        Check("S28", resetLaps.Count == 1 && resetLaps[0].InvalidReasons.Contains("session_time_reset"),
            "een sprong terug in sessietijd breekt de ronde af");

        // Rijderwissel binnen de ronde: geen naam mee, wel de vlag.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 30; index++) sampler.Offer(Full(index * 0.05, 12, 10000 + index, 40, 1, 0));
        var other = Full(1.5, 12, 10030, 40, 1, 0);
        other.CurrentDriverName = "Ander Persoon";
        sampler.Offer(other);
        var driverLap = sampler.Close("test")[0];
        var driverSummary = driverLap.ToSummary(
            "11111111-1111-1111-1111-111111111111", "lap-12-1", "sessie-1");
        Check("S29", driverLap.DriverChanged == true && driverSummary.ToDto().CurrentDriverName == null,
            "een wissel laat geen enkele naam als 'de' rijder staan");
        Check("S30", driverSummary.Validate().Count == 0, "de wisselrij is geldig zonder naam");

        // Pitlap en pitbezoek op de finishlijn: de waargenomen brandstoftoevoer hoort
        // bij het bezoek, niet als verbruik in de integraal.
        sampler = new TelemetrySampler();
        for (var index = 0; index < 40; index++)
        {
            var sample = Full(index * 0.05, 20, 11000 + index, 30, 0.5, 0);
            sample.OnPitRoad = index > 25;
            sampler.Offer(sample);
        }
        var pitLap = sampler.Close("lap_change")[0];
        pitLap.ToSummary("22222222-2222-2222-2222-222222222222", "lap-20-1", "sessie-1");
        Check("S31", pitLap.PitLap == true, "een ronde met pitroad-tijd is een pitlap");
        var before = pitLap.FuelLevelIntegralLitreSeconds;
        pitLap.ToSummary("22222222-2222-2222-2222-222222222222", "lap-20-1", "sessie-1");
        Check("S32", before.HasValue && Math.Abs(before.Value - 30 * 1.95) < 0.1,
            "de niveau-integraal blijft de niveaumeting en wordt niet 'verbruik'");

        // Geen enkele tick: geen leeg aggregaat de deur uit.
        sampler = new TelemetrySampler();
        var nothing = sampler.Close("test");
        Check("S33", nothing.Count == 0, "zonder metingen levert sluiten geen ronde op");

        return count;
    }
}
