namespace ThreeSM.EnduranceConnector
{
    using System;
    using System.Collections.Generic;

    /// <summary>
    /// Leert per circuit waar de pitstraat begint en eindigt, en hoe lang dat stuk
    /// baan op racetempo duurt (de "stretch"). Daarmee kan de server het echte
    /// pitverlies uitrekenen — pitstraattijd plus stilstaan min stretch — in plaats
    /// van een vaste aanname te doen.
    ///
    /// Zuiver rekenwerk: geen SimHub- of iRacing-types, geen tijd, geen I/O. De
    /// plugin voert per meetlus één <see cref="Update"/> uit en verstuurt het
    /// bewijsstuk zodra een bezoek eindigt. Alles wat het niet zeker weet laat het
    /// leeg of verwerpt het; er wordt nooit een waarde verzonnen.
    /// </summary>
    public sealed class PitVisitLearner
    {
        /// <summary>Aantal bewaarde metingen per lijst; oudere vallen weg.</summary>
        public const int MaxSamples = 50;

        /// <summary>Onder dit aantal metingen is een geleerd pitpunt of stretch niet bruikbaar.</summary>
        public const int MinSamples = 3;

        /// <summary>Aantal positiestempels per ronde voor de stretch-meting.</summary>
        public const int Marks = 200;

        /// <summary>Een pitovergang die langer duurde dan dit is geen vloeiende overgang (tow/reset).</summary>
        public const double MaxJumpSeconds = 2.0;

        /// <summary>Een sprong in baanpositie groter dan dit betekent dat de auto niet reed.</summary>
        public const double MaxJumpPct = 0.02;

        /// <summary>Onder deze snelheid staat de auto stil (pitbox).</summary>
        public const double StillSpeedKph = 2.0;

        public const double MinLaneSeconds = 3.0;
        public const double MaxLaneSeconds = 300.0;
        public const double MaxStandingSeconds = 180.0;
        public const double MaxSlowFactor = 1.3;

        private const double PitPointTolerance = 0.01;
        private const double MaxMarkGapSeconds = 10.0;

        private sealed class Visit
        {
            public double EntryPct;
            public double StartSeconds;
            public double StillSeconds;
            public bool Jumped;
        }

        private sealed class CarState
        {
            public bool InLane;
            public bool Valid;
            public double PositionPct;
            public double SessionSeconds;
            public Visit Visit;
            public double[] Marks;
        }

        private readonly List<double> _entries = new List<double>();
        private readonly List<double> _exits = new List<double>();
        private readonly List<double> _stretches = new List<double>();
        private readonly List<double> _laneMoving = new List<double>();
        private CarState _car = new CarState();
        private string _trackKey;
        private double? _entry;
        private double? _exit;

        /// <summary>Laatst geleerde stretch in seconden, of null als er nog te weinig metingen zijn.</summary>
        public double? StretchSeconds
        {
            get { return _stretches.Count >= MinSamples ? (double?)Median(_stretches) : null; }
        }

        /// <summary>Geleerd aantal pitbezoeken (met en zonder stilstaan) op dit circuit.</summary>
        public int Visits
        {
            get { return _entries.Count; }
        }

        /// <summary>Wisselt van circuit: alle geleerde punten van het vorige circuit verlaten het geheugen.</summary>
        public void BeginTrack(string trackKey)
        {
            if (string.Equals(trackKey, _trackKey, StringComparison.Ordinal)) return;
            _trackKey = trackKey;
            _entries.Clear();
            _exits.Clear();
            _stretches.Clear();
            _laneMoving.Clear();
            _car = new CarState();
            _entry = null;
            _exit = null;
        }

        /// <summary>
        /// Voert één meetlus uit. Retourneert het bewijsstuk van een zojuist
        /// afgerond pitbezoek, of null als er niets afgerond is.
        /// </summary>
        public PitVisitEvidence Update(double sessionTimeSeconds, double lapDistancePct, double speedKph, bool onPitRoad)
        {
            if (double.IsNaN(sessionTimeSeconds) || double.IsInfinity(sessionTimeSeconds)) return null;
            if (double.IsNaN(lapDistancePct) || lapDistancePct < 0.0 || lapDistancePct > 1.0) return null;
            if (double.IsNaN(speedKph) || speedKph < 0.0) return null;

            var car = _car;
            if (!car.Valid)
            {
                car.InLane = onPitRoad;
                car.Valid = true;
                car.PositionPct = lapDistancePct;
                car.SessionSeconds = sessionTimeSeconds;
                return null;
            }

            var elapsed = sessionTimeSeconds - car.SessionSeconds;
            PitVisitEvidence finished = null;

            if (!car.InLane && onPitRoad)
            {
                // Naar binnen: een vloeiende overgang is kort en raakt de baan
                // ongeveer waar we hem zagen. Anders is het een tow of reset.
                var continuous = elapsed <= MaxJumpSeconds && DistancePct(lapDistancePct, car.PositionPct) <= MaxJumpPct;
                car.Visit = new Visit
                {
                    EntryPct = lapDistancePct,
                    StartSeconds = sessionTimeSeconds,
                    Jumped = !continuous
                };
            }
            else if (car.InLane && onPitRoad && car.Visit != null)
            {
                if (speedKph < StillSpeedKph) car.Visit.StillSeconds += elapsed;
                if (DistancePct(lapDistancePct, car.PositionPct) > MaxJumpPct) car.Visit.Jumped = true;
            }
            else if (car.InLane && !onPitRoad && car.Visit != null)
            {
                finished = Finish(car.Visit, sessionTimeSeconds, lapDistancePct);
                car.Visit = null;
            }

            if (!onPitRoad && !car.InLane) Track(car, lapDistancePct, sessionTimeSeconds);

            car.InLane = onPitRoad;
            car.PositionPct = lapDistancePct;
            car.SessionSeconds = sessionTimeSeconds;
            return finished;
        }

        private PitVisitEvidence Finish(Visit visit, double exitSeconds, double exitPct)
        {
            var evidence = new PitVisitEvidence
            {
                EntryPct = Round(visit.EntryPct, 5),
                ExitPct = Round(exitPct, 5),
                LaneSeconds = Round(exitSeconds - visit.StartSeconds, 3),
                StandingSeconds = Round(visit.StillSeconds, 3),
                StretchSeconds = StretchSeconds.HasValue ? (double?)Round(StretchSeconds.Value, 3) : null,
                Jumped = visit.Jumped
            };

            if (evidence.LaneSeconds < MinLaneSeconds || evidence.LaneSeconds > MaxLaneSeconds)
            {
                evidence.Skipped = "lane_time";
                return evidence;
            }
            if (evidence.StandingSeconds > MaxStandingSeconds)
            {
                evidence.Skipped = "standing_time";
                return evidence;
            }
            if (visit.Jumped)
            {
                evidence.Skipped = "jumped";
                return evidence;
            }
            if (_entry.HasValue && _exit.HasValue
                && (DistancePct(visit.EntryPct, _entry.Value) > PitPointTolerance
                    || DistancePct(exitPct, _exit.Value) > PitPointTolerance))
            {
                evidence.Skipped = "pit_lane_ends";
                return evidence;
            }
            var moving = evidence.LaneSeconds - evidence.StandingSeconds;
            var usual = Median(_laneMoving);
            if (_laneMoving.Count >= MinSamples && moving > usual * MaxSlowFactor)
            {
                evidence.Skipped = "slow_in_lane";
                return evidence;
            }

            Add(_entries, Round(visit.EntryPct, 5));
            Add(_exits, Round(exitPct, 5));
            Add(_laneMoving, evidence.StandingSeconds > 1.0 ? moving : evidence.LaneSeconds);
            LearnPitPoints();
            return evidence;
        }

        /// <summary>
        /// Houdt per 1/200 van de ronde een tijdstempel bij. Zodra de auto de
        /// geleerde exitpositie passeert, is het verschil met de entrypositie de
        /// tijd die dat stuk baan op racetempo kostte.
        /// </summary>
        private void Track(CarState car, double positionPct, double sessionSeconds)
        {
            var moved = positionPct - car.PositionPct;
            if (moved < -0.5) moved += 1.0;
            if (moved <= 0.0 || moved > 0.1 || sessionSeconds <= car.SessionSeconds) return;

            if (car.Marks == null)
            {
                car.Marks = new double[Marks];
                for (var i = 0; i < Marks; i++) car.Marks[i] = double.NaN;
            }

            var target = car.PositionPct + moved;
            for (var i = (int)Math.Floor(car.PositionPct * Marks) + 1; (double)i / Marks <= target; i++)
            {
                car.Marks[i % Marks] = car.SessionSeconds
                    + (sessionSeconds - car.SessionSeconds) * (((double)i / Marks - car.PositionPct) / moved);
            }

            if (!_entry.HasValue || !_exit.HasValue) return;

            var exitTime = Crossing(car.PositionPct, moved, _exit.Value, car.SessionSeconds, sessionSeconds);
            if (!exitTime.HasValue) return;
            var entryTime = MarkTime(car.Marks, exitTime.Value, _entry.Value, _exit.Value);
            if (!entryTime.HasValue) return;

            var stretch = exitTime.Value - entryTime.Value;
            if (stretch <= 0.0 || stretch > MaxLaneSeconds) return;
            Add(_stretches, Round(stretch, 3));
        }

        /// <summary>Tijdstip waarop de auto de entrypositie passeerde, vóór de exitpassage.</summary>
        private static double? MarkTime(double[] marks, double exitTime, double entryPct, double exitPct)
        {
            var from = (int)Math.Floor(entryPct * Marks);
            var to = (int)Math.Floor(exitPct * Marks);
            if (to < from) to += Marks;

            var last = double.NaN;
            for (var i = from; i <= to; i++)
            {
                var mark = marks[i % Marks];
                if (double.IsNaN(mark) || mark > exitTime || exitTime - mark > MaxLaneSeconds) return null;
                if (!double.IsNaN(last) && (mark <= last || mark - last > MaxMarkGapSeconds)) return null;
                last = mark;
            }
            if (double.IsNaN(last) || exitTime - last > MaxMarkGapSeconds) return null;

            var first = marks[from % Marks];
            var next = marks[(from + 1) % Marks];
            if (double.IsNaN(first) || double.IsNaN(next)) return null;
            return first + (next - first) * (entryPct * Marks - from);
        }

        /// <summary>Moment waarop de auto een punt op de baan passeerde, binnen deze meetlus.</summary>
        private static double? Crossing(double from, double moved, double point, double startSeconds, double endSeconds)
        {
            var offset = point - from;
            if (offset < 0.0) offset += 1.0;
            if (offset > moved) return null;
            return startSeconds + (endSeconds - startSeconds) * (offset / moved);
        }

        private void LearnPitPoints()
        {
            _entry = _entries.Count >= MinSamples ? (double?)CircularMedian(_entries) : null;
            _exit = _exits.Count >= MinSamples ? (double?)CircularMedian(_exits) : null;
        }

        private static void Add(List<double> values, double value)
        {
            values.Add(value);
            if (values.Count > MaxSamples) values.RemoveAt(0);
        }

        /// <summary>Kortste afstand over de rondeteller heen (0,99 en 0,01 liggen naast elkaar).</summary>
        private static double DistancePct(double a, double b)
        {
            var delta = Math.Abs(a - b);
            return Math.Min(delta, 1.0 - delta);
        }

        private static double CircularMedian(List<double> values)
        {
            var reference = values[0];
            var offsets = new List<double>(values.Count);
            foreach (var value in values)
            {
                var offset = (value - reference + 1.5) % 1.0 - 0.5;
                offsets.Add(offset);
            }
            var median = Median(offsets);
            return ((reference + median) % 1.0 + 1.0) % 1.0;
        }

        private static double Median(List<double> values)
        {
            if (values == null || values.Count == 0) return 0.0;
            var sorted = new List<double>(values);
            sorted.Sort();
            var middle = sorted.Count / 2;
            return sorted.Count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2.0;
        }

        private static double Round(double value, int digits)
        {
            return Math.Round(value, digits, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>
    /// Bewijsstuk van één pitbezoek. <see cref="Skipped"/> is gevuld als het
    /// bezoek niet als meting mag tellen; de server bewaart het dan niet.
    /// </summary>
    public sealed class PitVisitEvidence
    {
        public double EntryPct { get; set; }
        public double ExitPct { get; set; }
        public double LaneSeconds { get; set; }
        public double StandingSeconds { get; set; }
        public double? StretchSeconds { get; set; }
        public bool Jumped { get; set; }
        public string Skipped { get; set; }

        public bool Accepted
        {
            get { return Skipped == null; }
        }
    }
}
