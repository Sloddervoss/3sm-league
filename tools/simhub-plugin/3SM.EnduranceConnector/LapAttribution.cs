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
    /// (mediaan 0,52 s). Wie op het overgangssample schrijft, schrijft dus de vorige ronde onder
    /// het nieuwe nummer.
    ///
    /// Twee regels houden de toeschrijving eerlijk:
    ///  1. het overgangssample opent alleen een ronde; er wordt geschreven op het moment dat de
    ///     tijd verandert, zolang die ronde nog open staat;
    ///  2. een tijd wordt alleen aangenomen als de ronde ervoor ook een tijd had. Is er een gat,
    ///     dan geldt de eerstvolgende tijd als ijkpunt en wordt hij niet geschreven — verlies in
    ///     plaats van een verkeerde koppeling.
    /// </summary>
    public sealed class LapAttributionEngine
    {
        /// <summary>Gemeten maximum was 1,07 s; 2,0 s geeft ruimte zonder een oude tijd te accepteren.</summary>
        public const double DefaultTimeoutSeconds = 2.0;

        private const double TimeEpsilon = 0.000001;

        private sealed class CarState
        {
            public int Lap;
            public double? LastTime;
            public int OpenLap = -1;
            public double Deadline;
            /// <summary>Laatste ronde waarvoor we een tijd hebben gezien (ook als hij niet is geschreven).</summary>
            public int LastTimeLap = -1;
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
        /// meestal geen. Nooit een tijd zonder open ronde, nooit een tijd na een gat.
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
                // Nieuwe sessie: nieuwe generatie, geen enkele oude open ronde mag doorlopen.
                Reset();
                session = sessionKey;
                Generation++;
            }

            CarState state;
            if (!cars.TryGetValue(carId, out state))
            {
                // BASELINE: eerste waarneming van deze auto in deze sessie. Niets schrijven.
                state = new CarState { Lap = completedLaps, OpenLap = -1, LastTimeLap = completedLaps };
                state.LastTime = timeUsable ? lastLapSeconds : null;
                cars[carId] = state;
                return produced;
            }

            if (completedLaps < state.Lap)
            {
                // Teller loopt terug: reset binnen de sessie. Oude open ronde vervalt.
                state.Lap = completedLaps;
                state.OpenLap = -1;
                state.LastTimeLap = completedLaps;
                if (timeUsable) state.LastTime = lastLapSeconds;
                return produced;
            }

            var incremented = completedLaps > state.Lap;
            // Een ontbrekende waarde is geen wijziging: hij mag de vorige tijd niet wissen,
            // anders wordt dezelfde oude tijd bij terugkomst als nieuw gezien.
            var timeChanged = timeUsable && state.LastTime.HasValue
                && Math.Abs(lastLapSeconds.Value - state.LastTime.Value) > TimeEpsilon;

            // Een tijd die in hetzelfde sample binnenkomt als de tellersprong is niet eenduidig.
            if (!incremented && timeChanged && state.OpenLap >= 0 && completedLaps == state.OpenLap && sessionTime < state.Deadline)
            {
                if (state.LastTimeLap == state.OpenLap - 1)
                {
                    produced.Add(new LapTimeRecord
                    {
                        SessionKey = session,
                        Generation = Generation,
                        CarId = carId,
                        Lap = state.OpenLap,
                        Seconds = lastLapSeconds.Value,
                        Source = "sdk"
                    });
                    state.LastTimeLap = state.OpenLap;
                }
                else
                {
                    // De ronde ervoor had geen tijd: deze waarde kan van die ronde komen.
                    // Niet schrijven; wel als ijkpunt gebruiken zodat de volgende ronde weer telt.
                    state.LastTimeLap = state.OpenLap;
                }
                state.OpenLap = -1;
            }

            if (incremented)
            {
                if (completedLaps - state.Lap > 1)
                {
                    // Sprong: geen bewijs welke ronde bij een latere tijd hoort.
                    state.OpenLap = -1;
                }
                else
                {
                    state.OpenLap = completedLaps;
                    state.Deadline = sessionTime + timeout;
                }
                state.Lap = completedLaps;
            }

            // Verlopen open ronde: definitief laten vallen, geen inhaalslag.
            if (state.OpenLap >= 0 && sessionTime >= state.Deadline) state.OpenLap = -1;

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
