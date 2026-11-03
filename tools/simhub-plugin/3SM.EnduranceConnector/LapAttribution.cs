using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Wijst een rondetijd toe aan de ronde waar hij bij hoort.
    ///
    /// Gemeten op 1 november 2026 (19 auto's, 17.796 samples op ~10 Hz, Suzuka): de tijd volgt de
    /// teller met ongeveer een halve seconde. In 280 van 294 overgangen stond de tijd op het
    /// overgangssample nog op de vorige ronde; de nieuwe waarde kwam 0,10 s tot 1,07 s later
    /// (mediaan 0,52 s).
    ///
    /// De toeschrijving gaat daarom op **volgorde**, niet op een gok: elke tellerstap zet de
    /// afgesloten ronde in een wachtrij, en elke tijdswijziging haalt de oudste wachtende ronde op.
    /// Zo blijft de koppeling in de pas, ook als er één tijd ontbreekt of een meting uitvalt.
    /// Een wachtende ronde die niet binnen 2,0 s (gemeten maximum 1,07 s) een tijd krijgt, vervalt:
    /// verlies in plaats van een verkeerde koppeling.
    /// </summary>
    public sealed class LapAttributionEngine
    {
        /// <summary>Gemeten maximum was 1,07 s; 2,0 s geeft ruimte zonder een oude tijd te accepteren.</summary>
        public const double DefaultTimeoutSeconds = 2.0;


        private const double TimeEpsilon = 0.000001;

        private struct Waiting
        {
            public int Lap;
            public double Deadline;
        }

        private sealed class CarState
        {
            public int Lap;
            public double? LastTime;
            public bool SawGap;
            public readonly Queue<Waiting> Pending = new Queue<Waiting>();
        }

        private readonly double timeout;
        private readonly Dictionary<string, CarState> cars = new Dictionary<string, CarState>(StringComparer.Ordinal);
        private string session;

        public LapAttributionEngine() : this(DefaultTimeoutSeconds) { }

        public LapAttributionEngine(double timeoutSeconds)
        {
            if (timeoutSeconds <= 0 || double.IsNaN(timeoutSeconds) || double.IsInfinity(timeoutSeconds))
                throw new ArgumentOutOfRangeException("timeoutSeconds");
            timeout = timeoutSeconds;
        }

        /// <summary>Verhoogt bij elke nieuwe sessie; een lezer kan hiermee oude rijen uitsluiten.</summary>
        public long Generation { get; private set; }

        public string SessionKey { get { return session; } }

        public void Reset()
        {
            cars.Clear();
            session = null;
        }

        /// <summary>
        /// Eén waarneming. Levert de rondetijden op die op grond van deze waarneming bewezen zijn;
        /// meestal geen. Nooit een tijd zonder wachtende ronde, nooit een tijd na een gat.
        /// </summary>
        public IList<LapTimeRecord> Observe(string sessionKey, string carId, int completedLaps, double? lastLapSeconds, double sessionTime)
        {
            var produced = new List<LapTimeRecord>();

            if (string.IsNullOrEmpty(sessionKey) || string.IsNullOrEmpty(carId)) { Reset(); return produced; }
            if (double.IsNaN(sessionTime) || double.IsInfinity(sessionTime) || sessionTime < 0) return produced;

            var timeUsable = lastLapSeconds.HasValue
                && !double.IsNaN(lastLapSeconds.Value) && !double.IsInfinity(lastLapSeconds.Value)
                && lastLapSeconds.Value > 0 && lastLapSeconds.Value <= 86400;

            if (!string.Equals(session, sessionKey, StringComparison.Ordinal))
            {
                // Nieuwe sessie: nieuwe generatie, geen enkele oude wachtende ronde mag doorlopen.
                Reset();
                session = sessionKey;
                Generation++;
            }

            CarState state;
            if (!cars.TryGetValue(carId, out state))
            {
                // BASELINE: eerste waarneming van deze auto in deze sessie. Niets schrijven en
                // niets in de wachtrij: de eerste tijd krijgt pas een betekenis bij de eerste
                // tellerstap daarna.
                state = new CarState { Lap = completedLaps };
                state.LastTime = timeUsable ? lastLapSeconds : null;
                state.SawGap = !timeUsable;
                cars[carId] = state;
                return produced;
            }

            if (completedLaps < state.Lap)
            {
                // Teller loopt terug: reset binnen de sessie.
                state.Lap = completedLaps;
                state.Pending.Clear();
                if (timeUsable) { state.LastTime = lastLapSeconds; state.SawGap = false; } else state.SawGap = true;
                return produced;
            }

            if (!timeUsable)
            {
                // Een ontbrekende waarde betekent dat er in die tijd iets gepubliceerd kan zijn
                // dat we niet gezien hebben. De eerstvolgende waarde is dan geen bewijs.
                state.SawGap = true;
            }
            else if (state.SawGap)
            {
                // Herstel na een onderbreking: ijkpunt, geen toeschrijving.
                state.SawGap = false;
                state.Pending.Clear();
                state.LastTime = lastLapSeconds;
                state.Lap = completedLaps;
                return produced;
            }

            var incremented = completedLaps > state.Lap;
            // Een ontbrekende waarde is geen wijziging: hij mag de vorige tijd niet wissen,
            // anders wordt dezelfde oude tijd bij terugkomst als nieuw gezien.
            var timeChanged = timeUsable && state.LastTime.HasValue
                && Math.Abs(lastLapSeconds.Value - state.LastTime.Value) > TimeEpsilon;

            if (incremented)
            {
                if (completedLaps - state.Lap > 1)
                {
                    // Sprong: geen bewijs welke ronde bij een latere tijd hoort.
                    state.Pending.Clear();
                    state.SawGap = true;
                }
                else
                {
                    state.Pending.Enqueue(new Waiting { Lap = completedLaps, Deadline = sessionTime + timeout });
                }
                state.Lap = completedLaps;
            }
            else if (timeChanged && state.Pending.Count > 0)
            {
                // De oudste wachtende ronde krijgt deze tijd. Zo blijft de volgorde kloppen,
                // ook als er een tijd ontbrak of een frame uitviel.
                var next = state.Pending.Dequeue();
                if (sessionTime < next.Deadline)
                {
                    produced.Add(new LapTimeRecord
                    {
                        SessionKey = session,
                        Generation = Generation,
                        CarId = carId,
                        Lap = next.Lap,
                        Seconds = lastLapSeconds.Value,
                        Source = "sdk"
                    });
                }
            }

            // Verlopen wachtenden: definitief laten vallen, geen inhaalslag.
            while (state.Pending.Count > 0 && sessionTime >= state.Pending.Peek().Deadline) state.Pending.Dequeue();

            if (timeUsable) state.LastTime = lastLapSeconds;
            return produced;
        }
    }

    public sealed class LapTimeRecord
    {
        public string SessionKey { get; set; }
        public long Generation { get; set; }
        public string CarId { get; set; }
        public int Lap { get; set; }
        public double Seconds { get; set; }
        public string Source { get; set; }
    }
}
