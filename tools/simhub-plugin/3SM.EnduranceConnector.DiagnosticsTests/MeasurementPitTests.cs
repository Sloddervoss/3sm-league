using System;
using ThreeSM.EnduranceConnector;

// Pitbezoeken: waarnemen wat er gevraagd is en wat er feitelijk gebeurde, zonder die
// twee door elkaar te halen. Geen SimHub, geen iRacing.
internal static class MeasurementPitTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 13, 0, 0, DateTimeKind.Utc);

    private static TelemetrySample Pit(double seconds, int lap, bool? onPitRoad, double? fuel,
        int? flags, double? requestedFuel = null, bool? inStall = null)
    {
        return new TelemetrySample
        {
            ObservedAtUtc = T0.AddSeconds(seconds),
            SdkTick = (long)(seconds * 60),
            SessionTimeSeconds = 500 + seconds,
            LapNumber = lap,
            SegmentId = "seg-pit",
            ObservedSessionId = "sessie-9",
            CurrentDriverName = "Vincent de Vos",
            OnPitRoad = onPitRoad,
            FuelLitres = fuel,
            PitServiceFlagsRaw = flags,
            RequestedFuelLitres = requestedFuel,
            InPitStall = inStall
        };
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 10, false, 30, null));
        tracker.Update(Pit(0.5, 10, null, 30, null));
        Check("P01", tracker.Current == null, "onbekende OnPitRoad opent geen bezoek (null is niet false)");

        tracker.Update(Pit(1.0, 10, true, 30, PitServiceFlags.FrontLeftTyre | PitServiceFlags.FrontRightTyre | PitServiceFlags.FuelFill, 25, true));
        var opened = tracker.Current;
        Check("P02", opened != null && opened.EnterLap == 10 && opened.Result.InPitStall == true,
            "de flank false->true opent een bezoek met de ruwe SDK-waarde");
        tracker.Update(Pit(2.0, 10, true, 31, PitServiceFlags.FrontLeftTyre | PitServiceFlags.FrontRightTyre | PitServiceFlags.FuelFill, 25, true));
        tracker.Update(Pit(20.0, 10, true, 55, PitServiceFlags.FrontLeftTyre | PitServiceFlags.FrontRightTyre | PitServiceFlags.FuelFill, 25, true));
        tracker.Update(Pit(25.0, 11, false, 55, null));
        var visits = tracker.DrainCompleted();
        var visit = visits.Count == 1 ? visits[0] : null;
        Check("P03", visit != null && visit.Completed, "de flank true->false sluit het bezoek");
        Check("P04", visit.Intent.RequestedFuelLitres == 25 && visit.Intent.FuelRequested
            && string.Join(",", visit.Intent.RequestedTyreNames()) == "fl,fr",
            "de intentie staat apart: 25 L gevraagd en FL+FR aangevinkt");
        Check("P05", visit.Result.FuelAddedLitresObserved.HasValue && Math.Abs(visit.Result.FuelAddedLitresObserved.Value - 25) < 1e-6,
            "het resultaat is de waargenomen niveau-delta (55 - 30 = 25 L)");
        Check("P06", visit.CrossedLapBoundary && visit.EnterLap == 10 && visit.ExitLap == 11,
            "een bezoek over de finishlijn heen houdt beide ronde nummers");
        Check("P07", MeasurementIds.IsLocalId(visit.PitVisitId), "pitVisitId is een geldig lokaal context-ID");
        Check("P08", visit.Intent.PitServiceFlagsRaw.HasValue, "het ruwe servicemasker blijft bewaard");

        // Verzoek zonder resultaat: vier banden gevraagd, niets getankt.
        tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 4, false, 40, null));
        tracker.Update(Pit(1.0, 4, true, 40, 0x0F, null));
        tracker.Update(Pit(10.0, 4, false, 40, null));
        visit = tracker.DrainCompleted()[0];
        Check("P09", visit.Intent.AnyTyreRequested && visit.Result.FuelAddedLitresObserved == 0,
            "vier banden gevraagd is geen vier banden gewisseld; 0 L getankt is wel gemeten");
        Check("P10", visit.Result.InPitStall == null, "zonder pitstall-kanaal geen verzonnen true of false");

        // Niveau daalt tijdens het bezoek: dan is er geen betrouwbare delta.
        tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 5, false, 40, null));
        tracker.Update(Pit(1.0, 5, true, 40, PitServiceFlags.FuelFill, 20));
        tracker.Update(Pit(4.0, 5, true, 38, PitServiceFlags.FuelFill, 20));
        tracker.Update(Pit(6.0, 5, false, 38, null));
        visit = tracker.DrainCompleted()[0];
        Check("P11", visit.Result.FuelAddedLitresObserved == null && visit.Problems.Contains("fuel_decreased_on_pit_road"),
            "een daling levert geen 'getankt' op, maar een expliciet probleem");

        // Geen brandstofkanaal: geen delta en niet 0.
        tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 6, false, null, null));
        tracker.Update(Pit(1.0, 6, true, null, PitServiceFlags.FuelFill, 30));
        tracker.Update(Pit(8.0, 6, false, null, null));
        visit = tracker.DrainCompleted()[0];
        Check("P12", visit.Result.FuelAddedLitresObserved == null && visit.Problems.Contains("fuel_delta_unobserved"),
            "zonder twee waarnemingen bestaat er geen brandstofdelta");

        // Sessiewissel midden in een bezoek.
        tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 7, false, 40, null));
        tracker.Update(Pit(1.0, 7, true, 40, PitServiceFlags.FuelFill, 10));
        var switched = Pit(3.0, 0, true, 40, PitServiceFlags.FuelFill, 10);
        switched.SegmentId = "seg-pit-2";
        tracker.Update(switched);
        var closedBySession = tracker.DrainCompleted();
        Check("P13", closedBySession.Count == 1 && closedBySession[0].Problems.Contains("session_changed"),
            "een sessiewissel sluit het open bezoek met de reden erbij");

        // Twee bezoeken krijgen twee ID's; shutdown sluit wat open is.
        tracker = new PitServiceTracker("seg-pit");
        tracker.Update(Pit(0.0, 8, false, 40, null));
        tracker.Update(Pit(1.0, 8, true, 40, null));
        tracker.Update(Pit(5.0, 8, false, 40, null));
        tracker.Update(Pit(60.0, 9, true, 40, null));
        var firstId = tracker.DrainCompleted()[0].PitVisitId;
        var shutdown = tracker.Close("plugin_shutdown");
        Check("P14", shutdown.Count == 1 && firstId != shutdown[0].PitVisitId
            && shutdown[0].Problems.Contains("plugin_shutdown"),
            "elk bezoek heeft een eigen ID en shutdown sluit het open bezoek expliciet");

        return count;
    }
}
