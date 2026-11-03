using System;
using System.Collections.Generic;
using ThreeSM.EnduranceConnector;

internal static class LapAttributionTests
{
    public static int Run(Action<string, bool, string> check)
    {
        int n = 0; void Check(string id, bool ok, string detail) { check("LAP-" + id, ok, detail); n++; }

        // 01: de eerste waarneming is een basislijn. Er wordt niets geschreven.
        var e = new LapAttributionEngine();
        Check("01", e.Observe("S", "car", 5, 120.0, 100.0).Count == 0, "basislijn schrijft niets");

        // 02: gemeten gedrag — teller springt, tijd komt 0,5 s later. Die tijd hoort bij de nieuwe ronde.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        Check("02a", e.Observe("S", "car", 6, 120.0, 101.0).Count == 0, "overgangssample schrijft niet");
        var r = e.Observe("S", "car", 6, 121.5, 101.5);
        Check("02b", r.Count == 1 && r[0].Lap == 6 && Math.Abs(r[0].Seconds - 121.5) < 1e-9 && r[0].Source == "sdk",
            "tijd landt op ronde 6: " + (r.Count == 1 ? r[0].Lap + "/" + r[0].Seconds : "geen"));

        // 03: tijd verandert vóórdat de teller springt. Zonder open ronde wordt er niets geschreven.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        r = e.Observe("S", "car", 5, 121.0, 100.5);
        Check("03", r.Count == 0, "tijd zonder open ronde wordt niet toegeschreven");

        // 04: teller en tijd veranderen in hetzelfde sample. Niet eenduidig, dus niet schrijven.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        r = e.Observe("S", "car", 6, 121.0, 101.0);
        Check("04", r.Count == 0, "overgang met tijdswijziging in hetzelfde sample blijft leeg");

        // 05: de tijd komt te laat (voorbij de 2 s-grens). De ronde blijft leeg, geen inhaalslag.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        r = e.Observe("S", "car", 6, 122.0, 103.5);
        Check("05", r.Count == 0, "tijd na de grens wordt niet alsnog geplakt");

        // 06: sprong groter dan één. Geen bewijs, dus niets schrijven.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 8, 120.0, 101.0);
        r = e.Observe("S", "car", 8, 123.0, 101.5);
        Check("06", r.Count == 0, "na een sprong wordt niets geschreven");

        // 07: sessiewissel met een achtergebleven tijd. De oude waarde telt niet mee.
        e = new LapAttributionEngine();
        e.Observe("A", "car", 13, 120.0, 100.0);
        var g1 = e.Generation;
        Check("07a", e.Observe("B", "car", 13, 120.0, 500.0).Count == 0, "nieuwe sessie: basislijn");
        Check("07b", e.Generation > g1, "generatie loopt op bij een sessiewissel");
        Check("07c", e.Observe("B", "car", 14, 120.0, 501.0).Count == 0, "achtergebleven tijd schrijft niet");

        // 08: twee rondes met exact dezelfde tijd. De tweede levert geen nieuwe waarneming op:
        //     één ronde ontbreekt, er komt geen verkeerde koppeling.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        var a = e.Observe("S", "car", 6, 121.0, 101.5);
        e.Observe("S", "car", 7, 121.0, 200.0);
        var b = e.Observe("S", "car", 7, 121.0, 200.5);
        Check("08", a.Count == 1 && a[0].Lap == 6 && b.Count == 0,
            "gelijke tijd: ronde 6 geschreven, ronde 7 overgeslagen");

        // 09: teller loopt terug. Alles vervalt, niets schrijven.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 10, 120.0, 100.0);
        e.Observe("S", "car", 11, 120.0, 101.0);
        Check("09a", e.Observe("S", "car", 3, 119.0, 300.0).Count == 0, "tellerreset schrijft niets");
        Check("09b", e.Observe("S", "car", 4, 118.0, 301.0).Count == 0, "na reset eerst weer basislijn");

        // 10: meerdere auto's hebben eigen toestand; geen kruisbesmetting.
        e = new LapAttributionEngine();
        e.Observe("S", "a", 5, 120.0, 100.0);
        e.Observe("S", "b", 9, 118.0, 100.0);
        e.Observe("S", "a", 6, 120.0, 101.0);
        e.Observe("S", "b", 10, 118.0, 101.0);
        var ra = e.Observe("S", "a", 6, 121.0, 101.5);
        var rb = e.Observe("S", "b", 10, 117.5, 101.5);
        Check("10", ra.Count == 1 && ra[0].CarId == "a" && ra[0].Lap == 6 && rb.Count == 1 && rb[0].CarId == "b" && rb[0].Lap == 10,
            "twee auto's elk hun eigen ronde");

        // 11: de gemeten vertraging nagespeeld (0,1 / 0,5 / 1,0 s) over drie rondes.
        e = new LapAttributionEngine();
        double t = 0; int lap = 1; double time = 100.0;
        e.Observe("S", "car", lap, time, t);
        var got = new List<int>();
        foreach (var delay in new[] { 0.1, 0.5, 1.0 })
        {
            lap++; t += 120.0;
            e.Observe("S", "car", lap, time, t);            // overgang: tijd nog oud
            time += 0.5; t += delay;
            foreach (var rec in e.Observe("S", "car", lap, time, t)) got.Add(rec.Lap);
        }
        Check("11", got.Count == 3 && got[0] == 2 && got[1] == 3 && got[2] == 4,
            "drie rondes met gemeten vertraging: " + string.Join(",", got));

        // 12: twee tellerstappen voordat de tijd kwam. De tijd die dan binnenkomt kan bij de
        //     overgeslagen ronde horen: hij wordt niet geschreven maar dient als ijkpunt,
        //     waarna de volgende ronde weer gewoon telt.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        e.Observe("S", "car", 7, 120.0, 200.0);
        r = e.Observe("S", "car", 7, 122.0, 200.5);
        e.Observe("S", "car", 8, 122.0, 320.0);
        var r12b = e.Observe("S", "car", 8, 121.0, 320.5);
        Check("12", r.Count == 0 && r12b.Count == 1 && r12b[0].Lap == 8,
            "overgeslagen ronde wordt ijkpunt; de volgende ronde telt weer");

        // 14: een ontbrekende tijd is geen wijziging. Komt dezelfde oude waarde terug,
        //     dan mag hij niet als nieuw gelden (Astra's null-tussensample).
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        e.Observe("S", "car", 6, null, 101.1);
        r = e.Observe("S", "car", 6, 120.0, 101.2);
        Check("14", r.Count == 0, "null wist de vorige tijd niet");

        // 15: achtergebleven tijd van een overgeslagen ronde mag niet onder de volgende ronde
        //     belanden (Astra's tweede tegenvoorbeeld).
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        e.Observe("S", "car", 7, 120.0, 200.0);
        var r15a = e.Observe("S", "car", 7, 122.0, 200.5);   // ijkpunt, niet schrijven
        var r15b = e.Observe("S", "car", 8, 122.0, 320.0);   // nieuwe overgang
        var r15c = e.Observe("S", "car", 8, 120.5, 320.5);   // hoort bij 8
        Check("15", r15a.Count == 0 && r15b.Count == 0 && r15c.Count == 1 && r15c[0].Lap == 8,
            "ronde 6 opnieuw wordt niet onder 7 of 8 geschoven");


        // 13: een lege of onbruikbare sessiesleutel zet de motor terug; niets blijft hangen.
        e = new LapAttributionEngine();
        e.Observe("S", "car", 5, 120.0, 100.0);
        e.Observe("S", "car", 6, 120.0, 101.0);
        Check("13a", e.Observe(null, "car", 6, 121.0, 101.5).Count == 0, "zonder sessiesleutel niets");
        Check("13b", e.SessionKey == null, "sessie gewist");

        return n;
    }
}
