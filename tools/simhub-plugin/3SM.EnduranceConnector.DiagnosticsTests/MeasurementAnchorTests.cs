using System;
using System.Linq;
using ThreeSM.EnduranceConnector;

// Wear-ankers: wat we zagen, waarmee en hoe zeker. Geen bevestiging zonder
// refreshsignaal van de sim, geen setgeneratie zonder bewezen nieuwe set.
internal static class MeasurementAnchorTests
{
    private static readonly DateTime T0 = new DateTime(2026, 10, 31, 13, 0, 0, DateTimeKind.Utc);

    private static WearReading Wear(double fl, double fr, double rl, double rr)
    {
        return new WearReading(fl, fr, rl, rr);
    }

    private static TelemetrySample WearSample(double seconds, WearReading wear, int? setsUsed, double? trackTemp = 30)
    {
        return new TelemetrySample
        {
            ObservedAtUtc = T0.AddSeconds(seconds),
            SdkTick = (long)(seconds * 60),
            SessionTimeSeconds = 500 + seconds,
            LapNumber = 30,
            SegmentId = "seg-tyre",
            ObservedSessionId = "sessie-9",
            CurrentDriverName = "Vincent de Vos",
            OnPitRoad = false,
            FuelLitres = 40,
            Wear = wear,
            TyreSetsUsed = setsUsed,
            TrackTempC = trackTemp
        };
    }

    private static TyreAnchorTracker Tracker(out MeasurementIdFactory ids, int seed)
    {
        var sequence = seed;
        ids = new MeasurementIdFactory(() => new Guid(sequence++, 0, 0, new byte[8]));
        return new TyreAnchorTracker(ids, "seg-tyre");
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var anchors = Tracker(out _, 1000);
        anchors.Observe(WearSample(0.0, Wear(80, 80, 50, 50), 1), null, false);
        var start = anchors.Drain();
        Check("A01", start.Count == 1 && start[0].Kind == TyreAnchorTracker.KindSessionStart,
            "de eerste wear-lezing is een session_start-anker");
        Check("A02", start[0].WearBefore == null && start[0].WearAfter != null && !start[0].Confirmed
            && Math.Abs(start[0].Confidence - 0.9) < 1e-9,
            "session_start is een waargenomen waarde, geen bevestigde verversing");
        Check("A03", MeasurementIds.IsUid(start[0].AnchorId) && start[0].ObservationId == start[0].AnchorId,
            "het anker heeft een UUID en de waarnemings-ID is diezelfde UUID");
        Check("A04", start[0].Record.Validate().Count == 0, "het session_start-event is een geldige rij");

        // Alleen temperatuur verandert: dat is GEEN anker (de fout van de oude tracker).
        anchors.Observe(WearSample(1.0, Wear(80, 80, 50, 50), 1, 45), null, false);
        Check("A05", anchors.Drain().Count == 0, "een temperatuurverandering alleen levert geen wear-anker");

        // Twee banden vervangen met een opgehoogde set-teller: bevestigd, per hoek.
        anchors.Observe(WearSample(20.0, Wear(100, 100, 50, 50), 2), "pit-seg-tyre-1", true);
        var twoTyres = anchors.Drain();
        var anchor = twoTyres.Count == 1 ? twoTyres[0] : null;
        Check("A06", anchor != null && anchor.Kind == TyreAnchorTracker.KindWearRefreshConfirmed && anchor.Confirmed,
            "wear omhoog plus TireSetsUsed omhoog is een bevestigde verversing");
        Check("A07", anchor.SetGeneration.Corner(0) == 1 && anchor.SetGeneration.Corner(1) == 1
            && anchor.SetGeneration.Corner(2) == 0 && anchor.SetGeneration.Corner(3) == 0,
            "setgeneratie telt alleen de twee hoeken die echt veranderden");
        Check("A08", anchor.Evidence.Channels.Contains("tire_sets_used") && anchor.Evidence.Channels.Contains("wear_percent")
            && anchor.Evidence.Source == "tire_sets_used",
            "het bewijs noemt de gebruikte kanalen, niet alleen 'er was bewijs'");
        Check("A09", anchor.Record.Validate().Count == 0, "het bevestigde anker is een geldige rij");
        var json = anchor.Record.ToJson();
        Check("A10", json.Contains("\"scale\":\"remaining_percent\"") && json.Contains("\"version\":1")
            && json.Contains("\"wearBefore\"") && json.Contains("\"wearAfter\""),
            "wear_v1 gaat met versie en schaal over de draad");
        Check("A11", anchor.Record.Evidence.Note.Contains("wear_before_age="),
            "de ouderdom van de bevroren stand staat als feit in de noot");
        Check("A12", anchor.Record.Evidence.Note.Length <= 200, "de noot blijft binnen het contractmaximum");

        // Wear verandert zonder dat de sim een set-teller levert: kandidaat, geen bevestiging.
        anchors = Tracker(out _, 2000);
        anchors.Observe(WearSample(0.0, Wear(90, 90, 90, 90), null), null, false);
        anchors.Drain();
        anchors.Observe(WearSample(30.0, Wear(100, 100, 90, 90), null), "pit-2", true);
        var unconfirmed = anchors.Drain();
        Check("A13", unconfirmed.Count == 1 && unconfirmed[0].Kind == TyreAnchorTracker.KindWearValueChanged
            && !unconfirmed[0].Confirmed && Math.Abs(unconfirmed[0].Confidence - 0.4) < 1e-9,
            "zonder refreshsignaal blijft het een kandidaat met confidence 0,4");
        Check("A14", unconfirmed[0].SetGeneration.Corner(0) == 0,
            "een niet-bevestigde verandering verzint geen setgeneratie");

        // Pitservice afgerond, wear ongewijzigd: expliciet onbewezen.
        anchors = Tracker(out _, 3000);
        anchors.Observe(WearSample(0.0, Wear(80, 80, 80, 80), 3), null, false);
        anchors.Drain();
        anchors.Observe(WearSample(40.0, Wear(80, 80, 80, 80), 3), "pit-3", true);
        var completed = anchors.Drain();
        Check("A15", completed.Count == 1 && completed[0].Kind == TyreAnchorTracker.KindPitServiceCompleted
            && !completed[0].Confirmed && completed[0].Confidence < 0.5,
            "een afgeronde pitservice zonder wearwijziging is geen bewijs van verversing");

        // Wear daalt (bijgewerkte waarde): geen verversing, geen generatie.
        anchors = Tracker(out _, 4000);
        anchors.Observe(WearSample(0.0, Wear(70, 70, 70, 70), 4), null, false);
        anchors.Drain();
        anchors.Observe(WearSample(50.0, Wear(65, 70, 70, 70), 4), null, false);
        var decreased = anchors.Drain();
        Check("A16", decreased.Count == 1 && decreased[0].Kind == TyreAnchorTracker.KindWearValueChanged
            && !decreased[0].Confirmed && decreased[0].SetGeneration.Corner(0) == 0,
            "een daling is een bijgewerkte wearwaarde, geen nieuwe set");

        // Elke UUID blijft uniek en het record wordt niet opnieuw gemaakt.
        anchors = Tracker(out _, 5000);
        anchors.Observe(WearSample(0.0, Wear(60, 60, 60, 60), 5), null, false);
        anchors.Observe(WearSample(1.0, Wear(60, 60, 60, 60), 5), "pit-4", true);
        var two = anchors.Drain();
        Check("A17", two.Count == 2 && two[0].AnchorId != two[1].AnchorId,
            "twee ankers krijgen twee UUID's");
        Check("A18", anchors.Drain().Count == 0, "drainen levert elk anker één keer");
        Check("A19", two[0].Record.EventUid == two[0].AnchorId && two[0].Record.RecordRevision == 1,
            "de gebeurtenis houdt zijn UUID en begint op revisie 1");

        return count;
    }
}
