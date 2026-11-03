using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;
using ThreeSM.EnduranceConnector;

internal static class LapAttributionTests
{
    /// <summary>
    /// Bootst de plugin na: meerdere waarnemingen per seconde, een tellerstap bij de overgang en
    /// een tijd die pas even later verandert.
    /// </summary>
    private sealed class Rig
    {
        private readonly LapAttributionEngine engine = new LapAttributionEngine();
        private double t;
        private int lap;
        private double? time;
        private string session = "S";
        private readonly List<LapTimeRecord> written = new List<LapTimeRecord>();
        public Rig(int startLap, double? startTime) { lap = startLap; time = startTime; t = 100.0; Pump(); }
        public LapAttributionEngine Engine { get { return engine; } }
        public int Count { get { return written.Count; } }
        public LapTimeRecord Last { get { return written.Count == 0 ? null : written[written.Count - 1]; } }
        public List<LapTimeRecord> All { get { return written; } }
        private void Pump() { foreach (var r in engine.Observe(session, "car", lap, time, t)) written.Add(r); }
        public void Advance(double seconds)
        {
            var end = t + seconds;
            while (t + 1.0 <= end) { t += 1.0; Pump(); }
            t = end; Pump();
        }
        public void At(int newLap, double? newTime) { lap = newLap; time = newTime; Pump(); }
        public void Session(string key) { session = key; Pump(); }
    }

    private static string Serialize(TelemetryEnvelopeV3 envelope)
    {
        var serializer = new DataContractJsonSerializer(typeof(TelemetryEnvelopeV3));
        using (var stream = new MemoryStream())
        {
            serializer.WriteObject(stream, envelope);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    public static int Run(Action<string, bool, string> check)
    {
        int n = 0; void Check(string id, bool ok, string detail) { check("LAP-" + id, ok, detail); n++; }

        // 01: de eerste waarneming is een basislijn. Er wordt niets geschreven.
        var r = new Rig(5, 120.0);
        Check("01", r.Count == 0, "basislijn schrijft niets");

        // 02: gemeten gedrag — teller springt, tijd komt ~0,5 s later. Die tijd hoort bij ronde 6.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        Check("02a", r.Count == 0, "overgangssample schrijft niet");
        r.Advance(0.5); r.At(6, 121.5);
        Check("02b", r.Count == 1 && r.Last.Lap == 6 && Math.Abs(r.Last.Seconds - 121.5) < 1e-9,
            "tijd landt op ronde 6: " + (r.Last == null ? "geen" : r.Last.Lap + "/" + r.Last.Seconds));

        // 03: tijd verandert zonder dat er een ronde wacht. Niets schrijven.
        r = new Rig(5, 120.0);
        r.At(5, 121.0);
        Check("03", r.Count == 0, "tijd zonder wachtende ronde wordt niet toegeschreven");

        // 04: teller en tijd in hetzelfde sample. Niet eenduidig, dus niet schrijven.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 121.0);
        Check("04", r.Count == 0, "overgang met tijdswijziging in hetzelfde sample blijft leeg");

        // 05: de tijd komt te laat. De ronde vervalt, geen inhaalslag.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        r.Advance(3.5); r.At(6, 122.0);
        Check("05", r.Count == 0, "tijd na de grens wordt niet alsnog geplakt");

        // 06: sprong groter dan één. Geen bewijs, dus niets schrijven.
        r = new Rig(5, 120.0);
        r.Advance(240); r.At(8, 120.0);
        r.Advance(0.5); r.At(8, 123.0);
        Check("06", r.Count == 0, "na een sprong wordt niets geschreven");

        // 07: sessiewissel met een achtergebleven tijd. De oude waarde telt niet mee.
        r = new Rig(13, 120.0);
        var gen = r.Engine.Generation;
        r.Session("B");
        Check("07a", r.Count == 0, "nieuwe sessie: basislijn");
        Check("07b", r.Engine.Generation > gen, "generatie loopt op bij een sessiewissel");
        r.Advance(120); r.At(14, 120.0);
        r.Advance(0.5); r.At(14, 120.0);
        Check("07c", r.Count == 0, "achtergebleven tijd schrijft niet");

        // 08: twee rondes met exact dezelfde tijd. De tweede levert geen nieuwe waarneming op:
        //     één ronde ontbreekt, er komt geen verkeerde koppeling.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        r.Advance(0.5); r.At(6, 121.0);
        r.Advance(120); r.At(7, 121.0);
        r.Advance(3);
        Check("08", r.Count == 1 && r.Last.Lap == 6, "gelijke tijd: ronde 6 geschreven, ronde 7 overgeslagen");

        // 09: teller loopt terug. Alles vervalt, niets schrijven.
        r = new Rig(10, 120.0);
        r.Advance(120); r.At(11, 120.0);
        r.Advance(1); r.At(3, 119.0);
        Check("09a", r.Count == 0, "tellerreset schrijft niets");
        r.Advance(120); r.At(4, 118.0);
        Check("09b", r.Count == 0, "na reset eerst weer basislijn");

        // 10: meerdere auto's hebben eigen toestand; geen kruisbesmetting.
        var multi = new LapAttributionEngine();
        var got = new List<LapTimeRecord>();
        Action<string, int, double?, double> feed = (car, l, tm, st) => { foreach (var rec in multi.Observe("S", car, l, tm, st)) got.Add(rec); };
        for (var st = 100.0; st <= 220.0; st += 1.0) { feed("a", 5, 120.0, st); feed("b", 9, 118.0, st); }
        feed("a", 6, 120.0, 220.0); feed("b", 10, 118.0, 220.0);
        feed("a", 6, 121.0, 220.5); feed("b", 10, 117.5, 220.5);
        Check("10", got.Count == 2 && got[0].CarId == "a" && got[0].Lap == 6 && got[1].CarId == "b" && got[1].Lap == 10,
            "twee auto's elk hun eigen ronde");

        // 11: de gemeten vertraging nagespeeld (0,1 / 0,5 / 1,0 s) over drie rondes.
        r = new Rig(1, 100.0);
        var nextLap = 1;
        var nextTime = 100.0;
        foreach (var delay in new[] { 0.1, 0.5, 1.0 })
        {
            r.Advance(120);
            nextLap++; nextTime += 0.5;
            r.At(nextLap, nextTime - 0.5);      // overgang: tijd nog oud
            r.Advance(delay);
            r.At(nextLap, nextTime);            // tijd verschijnt
        }
        Check("11", r.Count == 3 && r.All[0].Lap == 2 && r.All[1].Lap == 3 && r.All[2].Lap == 4,
            "drie rondes met gemeten vertraging: " + string.Join(",", r.All.ConvertAll(x => x.Lap.ToString()).ToArray()));

        // 12: één ronde zonder tijd. De volgende tijd landt weer op de juiste ronde.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);         // ronde 6 opent, tijd komt niet
        r.Advance(120); r.At(7, 120.0);         // ronde 6 vervalt, ronde 7 opent
        r.Advance(0.5); r.At(7, 122.0);
        Check("12", r.Count == 1 && r.Last.Lap == 7, "na een gemiste ronde landt de tijd weer goed");

        // 14: een ontbrekende tijd is geen wijziging. Komt dezelfde waarde terug, dan is hij
        //     niet opnieuw nieuw.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        r.Advance(0.2); r.At(6, null);
        r.Advance(0.2); r.At(6, 120.0);
        Check("14", r.Count == 0, "null wist de vorige tijd niet");

        // 15: een tijd buiten de gemeten grens wordt niet aan een oude ronde geplakt.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        r.Advance(3); r.At(6, 122.0);
        r.Advance(120); r.At(7, 122.0);
        r.Advance(0.5); r.At(7, 121.0);
        Check("15", r.Count == 1 && r.Last.Lap == 7, "late tijd vervalt; de volgende ronde telt weer");

        // 16: na een onderbreking in de waarneming is de eerste terugkomende waarde een ijkpunt.
        r = new Rig(5, 119.0);
        r.Advance(120); r.At(6, null);
        r.Advance(1.5); r.At(6, null);
        r.Advance(120); r.At(7, null);
        r.Advance(0.1); r.At(7, 120.0);         // herstel: ijkpunt
        r.Advance(0.4); r.At(7, 122.0);         // echte tijd van ronde 7, maar geen wachtrij
        Check("16", r.Count == 0, "na een onderbreking wordt niets toegeschreven");

        // 18: een bronwissel is geen tijdswijziging. De tijd die na de wissel binnenkomt is
        //     een ijkpunt; pas de ronde daarna telt weer.
        var eng = new LapAttributionEngine();
        var got18 = new List<LapTimeRecord>();
        for (var st = 100.0; st <= 220.0; st += 1.0) got18.AddRange(eng.Observe("S", "car", 5, 120.0, st, "sdk"));
        got18.AddRange(eng.Observe("S", "car", 6, 120.0, 220.0, "sdk"));
        got18.AddRange(eng.Observe("S", "car", 6, 121.0, 220.5, "simhub"));
        Check("18a", got18.Count == 0, "tijd van een andere bron wordt niet toegeschreven");
        for (var st = 221.0; st <= 340.0; st += 1.0) got18.AddRange(eng.Observe("S", "car", 6, 121.0, st, "simhub"));
        got18.AddRange(eng.Observe("S", "car", 7, 121.0, 340.0, "simhub"));
        got18.AddRange(eng.Observe("S", "car", 7, 122.0, 340.5, "simhub"));
        Check("18b", got18.Count == 1 && got18[0].Lap == 7, "daarna telt de volgende ronde weer");

        // 19: de bronwissel direct na de basislijn. Zonder vastgelegde beginsbron zou de
        //     tweede waarneming als gewone tijdswijziging gelden (Astra's tegenvoorbeeld).
        var eng19 = new LapAttributionEngine();
        var got19 = new List<LapTimeRecord>();
        got19.AddRange(eng19.Observe("S", "car", 1, 90.0, 0.0, "A"));
        got19.AddRange(eng19.Observe("S", "car", 2, 91.0, 0.1, "B"));
        got19.AddRange(eng19.Observe("S", "car", 2, 92.0, 0.2, "B"));
        Check("19", got19.Count == 0, "bronwissel direct na de basislijn schrijft niets");

        // 17: het frame draagt de paren onder de afgesproken naam, en laat het blok weg als er
        //     niets bewezen is. Zo verandert een frame zonder rondetijden niet van vorm.
        var withTimes = new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3, Sequence = 1, CapturedAt = "2026-11-03T20:00:00.000Z", TransportSessionId = "t-1",
            Identity = new V3Identity(), Session = new V3Session(), Timing = new V3Timing(), Position = new V3Position(),
            Track = new V3Track(), Fuel = new V3Fuel(), RaceState = new V3RaceState(), PitService = new V3PitService(),
            LapTimes = new List<LapTimeDto> { new LapTimeDto { CarId = "Jaimy Peters", SessionKey = "t-1:sim-7-s0", Lap = 7, Seconds = 121.456, Source = "sdk" } },
        };
        var json = Serialize(withTimes);
        Check("17a", json.Contains("\"lapTimes\"") && json.Contains("\"carId\":\"Jaimy Peters\"") && json.Contains("\"lap\":7") && json.Contains("\"source\":\"sdk\""),
            "frame draagt lapTimes met carId, lap en bron");
        var withoutTimes = new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3, Sequence = 2, CapturedAt = "2026-11-03T20:00:01.000Z", TransportSessionId = "t-1",
            Identity = new V3Identity(), Session = new V3Session(), Timing = new V3Timing(), Position = new V3Position(),
            Track = new V3Track(), Fuel = new V3Fuel(), RaceState = new V3RaceState(), PitService = new V3PitService(),
        };
        Check("17b", !Serialize(withoutTimes).Contains("lapTimes"), "zonder bewijs geen lapTimes in het frame");

        // 13: een lege of onbruikbare sessiesleutel zet de motor terug; niets blijft hangen.
        r = new Rig(5, 120.0);
        r.Advance(120); r.At(6, 120.0);
        var empty = r.Engine.Observe(null, "car", 6, 121.0, 300.0);
        Check("13a", empty.Count == 0, "zonder sessiesleutel niets");
        Check("13b", r.Engine.SessionKey == null, "sessie gewist");

        return n;
    }
}
