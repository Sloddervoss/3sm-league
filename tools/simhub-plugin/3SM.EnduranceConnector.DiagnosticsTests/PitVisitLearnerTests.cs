using System;
using ThreeSM.EnduranceConnector;

/// <summary>
/// Gedragstests voor het leren van pitbezoeken: entry/exit-detectie, stilstaan,
/// tow-verwerping, poorten en de stretch. Alles met vaste tijdstippen, zodat een
/// fout in de logica meteen zichtbaar is en niet van een echte sessie afhangt.
/// </summary>
internal static class PitVisitLearnerTests
{
    private const double GreenStep = 1.0 / 120.0;

    public static int Run(Action<string, bool, string> check)
    {
        var passed = 0;
        Action<string, bool, string> c = (id, condition, evidence) =>
        {
            if (condition) passed++;
            check(id, condition, evidence);
        };

        Try(c, "pitvisit_round_trip", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            double t = 0, pct = 0;
            Lap(learner, ref t, ref pct, 0.10);

            var evidence = Visit(learner, ref t, ref pct, 40.0, 5.0, 55.0);
            c("pitvisit_round_trip/1", evidence != null, "bezoek eindigt");
            if (evidence == null) return;
            c("pitvisit_round_trip/2", evidence.Accepted, "eerste bezoek is een geldige meting");
            c("pitvisit_round_trip/3", Math.Abs(evidence.LaneSeconds - 46.0) < 0.001, "pitstraattijd 46 s");
            c("pitvisit_round_trip/4", Math.Abs(evidence.StandingSeconds - 40.0) < 0.001, "40 s stilstaan");
            c("pitvisit_round_trip/5", evidence.StretchSeconds == null, "stretch bestaat pas na 3 metingen");
            c("pitvisit_round_trip/6", learner.Visits == 1, "bezoek is bewaard");
        });

        Try(c, "pitvisit_tow_is_refused", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            learner.Update(0.0, 0.40, 180.0, false);
            // Zeven seconden geen waarneming en dan meteen in de pitstraat: een tow.
            learner.Update(7.0, 0.40, 60.0, true);
            learner.Update(8.0, 0.40, 0.0, true);
            learner.Update(9.0, 0.40, 0.0, true);
            var evidence = learner.Update(10.0, 0.4001, 70.0, false);
            c("pitvisit_tow_is_refused/1", evidence != null, "bezoek eindigt");
            if (evidence == null) return;
            c("pitvisit_tow_is_refused/2", evidence.Jumped, "sprong wordt herkend");
            c("pitvisit_tow_is_refused/3", evidence.Skipped == "jumped", "bezoek mag niet tellen");
            c("pitvisit_tow_is_refused/4", learner.Visits == 0, "bezoek wordt niet bewaard");
        });

        Try(c, "pitvisit_lane_time_gate", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            double t = 0, pct = 0;
            Lap(learner, ref t, ref pct, 0.30);
            var evidence = Visit(learner, ref t, ref pct, 0.0, 320.0, 50.0);
            c("pitvisit_lane_time_gate/1", evidence != null && evidence.Skipped == "lane_time",
                "te lang in de pitstraat telt niet");
        });

        Try(c, "pitvisit_standing_gate", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            double t = 0, pct = 0;
            Lap(learner, ref t, ref pct, 0.30);
            var evidence = Visit(learner, ref t, ref pct, 181.0, 2.0, 50.0);
            c("pitvisit_standing_gate/1", evidence != null && evidence.Skipped == "standing_time",
                "te lang stilstaan telt niet");
        });

        Try(c, "pitvisit_slow_lane_gate", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            double t = 0, pct = 0;
            for (var visit = 0; visit < 3; visit++)
            {
                Lap(learner, ref t, ref pct, 0.30);
                var normal = Visit(learner, ref t, ref pct, 0.0, 20.0, 55.0);
                c("pitvisit_slow_lane_gate/normal" + visit, normal != null && normal.Accepted, "normaal bezoek telt");
            }
            Lap(learner, ref t, ref pct, 0.30);
            var slow = Visit(learner, ref t, ref pct, 0.0, 60.0, 20.0);
            c("pitvisit_slow_lane_gate/slow", slow != null && slow.Skipped == "slow_in_lane",
                "traag door de pitstraat telt niet");
            c("pitvisit_slow_lane_gate/count", learner.Visits == 3, "alleen de drie normale bezoeken zijn bewaard");
        });

        Try(c, "pitvisit_missing_sample_invents_nothing", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            learner.Update(0.0, 0.40, 180.0, false);
            c("pitvisit_missing_sample_invents_nothing/1", learner.Update(1.0, double.NaN, 180.0, false) == null,
                "ongeldige positie levert niets op");
            learner.Update(2.0, 0.4008, 180.0, false);
            c("pitvisit_missing_sample_invents_nothing/2", learner.Visits == 0, "geen bezoek verzonnen");
        });

        Try(c, "pitvisit_new_track_resets", () =>
        {
            var learner = new PitVisitLearner();
            learner.BeginTrack("sebring|International");
            double t = 0, pct = 0;
            Lap(learner, ref t, ref pct, 0.30);
            Visit(learner, ref t, ref pct, 0.0, 20.0, 55.0);
            c("pitvisit_new_track_resets/1", learner.Visits == 1, "bezoek bewaard op circuit A");
            learner.BeginTrack("spa|Grand Prix");
            c("pitvisit_new_track_resets/2", learner.Visits == 0, "circuitwissel wist de punten");
            c("pitvisit_new_track_resets/3", learner.StretchSeconds == null, "stretch hoort bij het circuit");
        });

        return passed;
    }

    /// <summary>Rijdt een groene ronde vanaf de huidige positie tot de gewenste positie.</summary>
    private static void Lap(PitVisitLearner learner, ref double time, ref double pct, double targetPct)
    {
        var steps = 0;
        while (steps++ < 240)
        {
            var remaining = targetPct - pct;
            if (remaining < 0.0) remaining += 1.0;
            if (remaining <= GreenStep) break;
            time += 1.0;
            pct += GreenStep;
            if (pct >= 1.0) pct -= 1.0;
            learner.Update(time, pct, 180.0, false);
        }
        // Laatste stapje landt exact op de doelpositie, zodat elk bezoek op
        // hetzelfde pitpunt begint en de poort niet op ruis afgaat.
        time += 1.0;
        pct = targetPct;
        learner.Update(time, pct, 180.0, false);
    }

    /// <summary>Eén pitbezoek: entry, stilstaan, doorrijden en exit — met kleine positie­stappen.</summary>
    private static PitVisitEvidence Visit(PitVisitLearner learner, ref double time, ref double pct, double stillSeconds, double movingSeconds, double movingSpeed)
    {
        // Elk bezoek legt hetzelfde stuk pitstraat af; alleen de tijdsduur verschilt.
        // Zo meet de test de poorten en niet de toevallige lengte van het bezoek.
        const double PitStretch = 0.004;
        var entry = pct;
        var step = PitStretch / movingSeconds;
        learner.Update(time, entry, 60.0, true);
        for (var i = 0; i < (int)stillSeconds; i++)
        {
            time += 1.0;
            learner.Update(time, entry + step * 0.1, 0.0, true);
        }
        for (var i = 0; i < (int)movingSeconds; i++)
        {
            time += 1.0;
            pct = entry + step * (i + 1);
            learner.Update(time, pct, movingSpeed, true);
        }
        time += 1.0;
        pct = entry + step * (movingSeconds + 1);
        return learner.Update(time, pct, 70.0, false);
    }

    private static void Try(Action<string, bool, string> check, string name, Action body)
    {
        try
        {
            body();
        }
        catch (Exception error)
        {
            check(name + "/harness", false, "HARNESS_EXCEPTION " + error.GetType().Name + ": " + error.Message);
        }
    }
}
