using System;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén waarneming van het bandenblok, zoals de bestaande capture (0.7.0) die al
    /// berekent. Geen verwijzing naar SimHub of naar de V3-contracten: de plugin vertaalt
    /// het al bestaande <c>V3Tyres</c>-blok hiernaartoe, zodat deze logica ook zonder
    /// SimHub-DLL's te compileren en te testen is.
    ///
    /// <see cref="ObservedAtUtc"/> is het moment waarop de connector de waarde voor het
    /// eerst zag (dus de laatste echte meting), <see cref="FrozenAtUtc"/> het moment waarop
    /// een pit-entry-anker werd bevroren. Die twee zijn bewust apart: een bevroren snapshot
    /// is nooit een meting op het sample-tijdstip.
    /// </summary>
    public sealed class ResearchTyreObservation
    {
        public bool HasWear;
        public bool HasCarcass;
        public bool HasSets;
        public bool HasCompound;
        public bool HasEnvironment;

        /// <summary>Index 0..3 = FL, FR, RL, RR; binnen een hoek 0..2 = left, middle, right.</summary>
        public double?[][] WearPercent;
        public double?[][] CarcassTempC;

        public int? SetsUsed;
        public int? CompoundId;
        public double? TrackTempC;
        public double? AirTempC;
        public string RubberState;

        /// <summary>session_start, sim_refresh of pit_entry (de waarden uit de tracker).</summary>
        public string Trigger;

        /// <summary>Laatste echte meting van deze waarden.</summary>
        public DateTime? ObservedAtUtc;

        /// <summary>Alleen gevuld als dit het bevroren pit-entry-anker is.</summary>
        public DateTime? FrozenAtUtc;

        /// <summary>True zodra dit een bevroren pit-snapshot is: die is nooit Measured.</summary>
        public bool Frozen;

        public bool IsEmpty
        {
            get { return !HasWear && !HasCarcass && !HasSets && !HasCompound && !HasEnvironment && RubberState == null; }
        }

        public static ResearchTyreObservation None()
        {
            return new ResearchTyreObservation();
        }
    }

    /// <summary>
    /// Classificeert elk bandengegeven apart. De kernregel: een bevroren pit-snapshot is
    /// <see cref="ResearchProvenance.LastKnown"/> met het tijdstip van de laatste echte
    /// meting, nooit <see cref="ResearchProvenance.Measured"/>.
    /// </summary>
    public sealed class ResearchTyreClassifier
    {
        /// <summary>Hoeveel seconden na de meting een niet-bevroren waarde nog als Measured telt.</summary>
        public const double DefaultFreshToleranceSeconds = 2.5;

        private readonly ResearchTyreObservation _observation;
        private readonly DateTime _sampleAtUtc;
        private readonly double _freshToleranceSeconds;

        public ResearchTyreClassifier(ResearchTyreObservation observation, DateTime sampleAtUtc, double freshToleranceSeconds)
        {
            _observation = observation ?? ResearchTyreObservation.None();
            _sampleAtUtc = sampleAtUtc;
            _freshToleranceSeconds = freshToleranceSeconds > 0 ? freshToleranceSeconds : DefaultFreshToleranceSeconds;
        }

        public ResearchTyreObservation Observation { get { return _observation; } }

        /// <summary>De herkomst die voor dit hele blok geldt (per veld kan Invalid/Unavailable afwijken).</summary>
        public ResearchProvenance BlockProvenance { get { return Provenance(out _); } }

        public ResearchField Wear(int corner, int zone)
        {
            return ZoneValue(_observation.WearPercent, corner, zone, ResearchLimits.WearPercentMin, ResearchLimits.WearPercentMax, "no_wear");
        }

        public ResearchField Carcass(int corner, int zone)
        {
            return ZoneValue(_observation.CarcassTempC, corner, zone, ResearchLimits.CarcassTempCMin, ResearchLimits.CarcassTempCMax, "no_carcass");
        }

        public ResearchField SetsUsed()
        {
            string reason;
            var provenance = Provenance(out reason);
            if (!_observation.HasSets || !_observation.SetsUsed.HasValue) return ResearchField.Unavailable("no_sets");
            var value = (double)_observation.SetsUsed.Value;
            if (value < 0 || value > 255) return ResearchField.Invalid("out_of_range");
            return ResearchField.Numeric(_observation.SetsUsed.Value, provenance, _observation.ObservedAtUtc, ResearchRates.OnSimRefresh, reason);
        }

        public ResearchField CompoundId()
        {
            string reason;
            var provenance = Provenance(out reason);
            if (!_observation.HasCompound || !_observation.CompoundId.HasValue) return ResearchField.Unavailable("no_compound");
            var value = (double)_observation.CompoundId.Value;
            if (value < 0 || value > 255) return ResearchField.Invalid("out_of_range");
            return ResearchField.Numeric(_observation.CompoundId.Value, provenance, _observation.ObservedAtUtc, ResearchRates.OnSimRefresh, reason);
        }

        public ResearchField TrackTempC()
        {
            string reason;
            var provenance = Provenance(out reason);
            if (!_observation.TrackTempC.HasValue) return ResearchField.Unavailable("no_environment");
            return ResearchField.Ranged(_observation.TrackTempC, ResearchLimits.TemperatureCMin, ResearchLimits.TemperatureCMax,
                provenance, _observation.ObservedAtUtc, ResearchRates.OnSimRefresh, reason, "out_of_range");
        }

        public ResearchField AirTempC()
        {
            string reason;
            var provenance = Provenance(out reason);
            if (!_observation.AirTempC.HasValue) return ResearchField.Unavailable("no_environment");
            return ResearchField.Ranged(_observation.AirTempC, ResearchLimits.TemperatureCMin, ResearchLimits.TemperatureCMax,
                provenance, _observation.ObservedAtUtc, ResearchRates.OnSimRefresh, reason, "out_of_range");
        }

        public ResearchField RubberState()
        {
            string reason;
            var provenance = Provenance(out reason);
            if (string.IsNullOrEmpty(_observation.RubberState)) return ResearchField.Unavailable("no_environment");
            return ResearchField.TextValue(_observation.RubberState, provenance, _observation.ObservedAtUtc, ResearchRates.OnSimRefresh, reason);
        }

        /// <summary>Tijdstip waarop een bevroren snapshot werd vastgelegd (null als niet bevroren).</summary>
        public DateTime? FrozenAtUtc { get { return _observation.Frozen ? _observation.FrozenAtUtc : null; } }

        private ResearchField ZoneValue(double?[][] zones, int corner, int zone, double minimum, double maximum, string missingReason)
        {
            string reason;
            var provenance = Provenance(out reason);
            if (!HasAny(zones))
            {
                // Het hele blok ontbreekt: dat is geen gok, maar "de sim leverde het niet".
                return ResearchField.Unavailable(missingReason);
            }
            var value = ReadZone(zones, corner, zone);
            if (!value.HasValue) return ResearchField.Unavailable(missingReason);
            return ResearchField.Ranged(value, minimum, maximum, provenance, _observation.ObservedAtUtc,
                ResearchRates.OnSimRefresh, reason, "out_of_range");
        }

        private ResearchProvenance Provenance(out string reason)
        {
            reason = null;
            if (_observation.Frozen || string.Equals(_observation.Trigger, "pit_entry", StringComparison.Ordinal))
            {
                // Bevroren anker: de waarden komen uit een eerdere tick en zijn per definitie
                // niet op dit sample gemeten. Altijd LastKnown, nooit Measured.
                reason = "frozen_pit_snapshot";
                return ResearchProvenance.LastKnown;
            }
            if (!_observation.ObservedAtUtc.HasValue)
            {
                reason = "no_observation_time";
                return ResearchProvenance.LastKnown;
            }
            var ageSeconds = (_sampleAtUtc.ToUniversalTime() - _observation.ObservedAtUtc.Value.ToUniversalTime()).TotalSeconds;
            if (ageSeconds < 0) ageSeconds = 0;
            if (ageSeconds <= _freshToleranceSeconds) return ResearchProvenance.Measured;
            reason = "stale_snapshot";
            return ResearchProvenance.LastKnown;
        }

        internal static bool HasAny(double?[][] zones)
        {
            if (zones == null) return false;
            for (var corner = 0; corner < zones.Length; corner++)
            {
                if (zones[corner] == null) continue;
                for (var zone = 0; zone < zones[corner].Length; zone++)
                    if (zones[corner][zone].HasValue) return true;
            }
            return false;
        }

        internal static double? ReadZone(double?[][] zones, int corner, int zone)
        {
            if (zones == null || corner < 0 || corner >= zones.Length || zones[corner] == null) return null;
            if (zone < 0 || zone >= zones[corner].Length) return null;
            return zones[corner][zone];
        }
    }

    /// <summary>
    /// Wat de bestaande capture in deze tick al had. De research-laag leest niets opnieuw
    /// uit de SDK wat hierin staat; velden die de capture niet levert worden apart gemarkeerd.
    /// </summary>
    public sealed class ResearchCaptureView
    {
        public bool Present;
        public DateTime CapturedAtUtc;
        public long Sequence;
        public double? SessionTimeSeconds;

        /// <summary>True als het optionele vehicle-blok (gas/rem/snelheid/toerental) meeging.</summary>
        public bool HasVehicle;
        public double? ThrottlePct;
        public double? BrakePct;
        public double? SpeedKph;
        public double? Rpm;
        public string Gear;

        public double? FuelLitres;
        public double? FuelPerLapLitres;
        public double? LapsRemaining;

        public double? LastLapSeconds;
        public double? BestLapSeconds;
        public double? CurrentLapElapsedSeconds;
        public double? LapDistancePct;
        public int? CompletedLaps;
        public int? Position;
        public int? ClassPosition;
        public int? Incidents;
        public bool? OnPitRoad;

        /// <summary>Genormaliseerde sessiefase uit de capture (garage/racing/...), indien beschikbaar.</summary>
        public string SessionPhase;

        public ResearchTyreObservation Tyres = ResearchTyreObservation.None();

        /// <summary>
        /// Het bevroren pit-entry-anker uit de bestaande capture (de set die eraf ging).
        /// Altijd Frozen: de researchlaag classificeert die waarden nooit als Measured.
        /// </summary>
        public ResearchTyreObservation PitEntryTyres;

        public static ResearchCaptureView None()
        {
            return new ResearchCaptureView();
        }
    }

    /// <summary>
    /// Classificeert de velden die uit de capture komen. De capture draait op het
    /// verzendinterval; valt die stil (geen koppeling, geen iRacing), dan wordt de waarde
    /// LastKnown met het oorspronkelijke capture-tijdstip — niet Measured.
    /// </summary>
    public sealed class ResearchCaptureClassifier
    {
        private readonly ResearchCaptureView _view;
        private readonly DateTime _sampleAtUtc;
        private readonly int _captureRateMs;
        private readonly double _staleAfterSeconds;

        public ResearchCaptureClassifier(ResearchCaptureView view, DateTime sampleAtUtc, int captureRateMs, double staleAfterSeconds)
        {
            _view = view ?? ResearchCaptureView.None();
            _sampleAtUtc = sampleAtUtc;
            _captureRateMs = captureRateMs;
            _staleAfterSeconds = staleAfterSeconds > 0 ? staleAfterSeconds : 3.0;
        }

        public ResearchCaptureView View { get { return _view; } }

        public bool IsFresh
        {
            get
            {
                if (!_view.Present) return false;
                var age = (_sampleAtUtc.ToUniversalTime() - _view.CapturedAtUtc.ToUniversalTime()).TotalSeconds;
                return age <= _staleAfterSeconds;
            }
        }

        /// <summary>Herkomst voor capture-velden; null-reason als de waarde vers is.</summary>
        public ResearchProvenance Provenance(out string reason)
        {
            reason = null;
            if (!_view.Present) return ResearchProvenance.Unavailable;
            if (IsFresh) return ResearchProvenance.Measured;
            reason = "stale_capture";
            return ResearchProvenance.LastKnown;
        }

        public ResearchField Number(double? value, double minimum, double maximum, string missingReason)
        {
            string reason;
            var provenance = Provenance(out reason);
            if (provenance == ResearchProvenance.Unavailable) return ResearchField.Unavailable(missingReason ?? "no_capture");
            if (!value.HasValue) return ResearchField.Unavailable(missingReason ?? "no_value");
            return ResearchField.Ranged(value, minimum, maximum, provenance, _view.CapturedAtUtc, _captureRateMs, reason, "out_of_range");
        }

        public ResearchField Integer(int? value, int minimum, int maximum, string missingReason)
        {
            if (!value.HasValue) return Number(null, minimum, maximum, missingReason);
            return Number((double)value.Value, minimum, maximum, missingReason);
        }

        public ResearchField Flag(bool? value, string missingReason)
        {
            string reason;
            var provenance = Provenance(out reason);
            if (provenance == ResearchProvenance.Unavailable) return ResearchField.Unavailable(missingReason ?? "no_capture");
            if (!value.HasValue) return ResearchField.Unavailable(missingReason ?? "no_value");
            return ResearchField.FlagValue(value, provenance, _view.CapturedAtUtc, _captureRateMs, reason);
        }

        public ResearchField TextValue(string value, string missingReason)
        {
            string reason;
            var provenance = Provenance(out reason);
            if (provenance == ResearchProvenance.Unavailable) return ResearchField.Unavailable(missingReason ?? "no_capture");
            if (string.IsNullOrEmpty(value)) return ResearchField.Unavailable(missingReason ?? "no_value");
            return ResearchField.TextValue(value, provenance, _view.CapturedAtUtc, _captureRateMs, reason);
        }
    }

    /// <summary>
    /// Eén tick gezien door de research-laag. Alles wat de capture al had komt hierin mee,
    /// zodat de gebeurtenisdetectie niets extra uit de SDK hoeft te lezen.
    /// </summary>
    public sealed class ResearchTick
    {
        public DateTime AtUtc;
        public bool GameRunning;
        public bool IsInCar;
        public string SessionPhase;
        public bool? OnPitRoad;
        public double? SpeedKph;
        public int? CompletedLaps;
        public int? SetsUsed;
        public double? SessionTimeSeconds;
        public long Sequence;
    }
}
