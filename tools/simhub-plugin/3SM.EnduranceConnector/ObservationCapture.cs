using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Runtime.Serialization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Vaste getallen van het geaccepteerde observation-contract v1. Dit zijn
    /// wire-grenzen, geen bewijs van een SDK-eigenschap of volledigheid.
    /// </summary>
    public static class ObservationContract
    {
        public const int Version = 1;
        public const int MaxSamples = 1000000;
        public const int MaxSeconds = 86400;
        public const int MaxWireBytes = 2048;
        public const int MaxPositiveSteps = 10000;
        public const double MaxAddedLitres = 300.0;
        public const double FuelResolutionLitres = 0.001;
        public const int MaxCarIdBytes = 64;
        public const int MaxTrackTextBytes = 128;
        public const int MaxSessionNumber = 1000;
    }

    /// <summary>
    /// Stabiele lokale uitslagen. Waar de server dezelfde regel kent, is de
    /// code gelijk; de extra lokale codes betekenen "geen observation gebouwd".
    /// </summary>
    public static class ObservationCaptureCodes
    {
        public const string Accepted = "observation_accepted";
        public const string PairingIncomplete = "observation_pairing_incomplete";
        public const string NoSamples = "observation_no_samples";
        public const string NoFact = "observation_no_fact";
        public const string BoundsInconsistent = "observation_bounds_inconsistent";
        public const string TimeOrder = "observation_time_order";
        public const string SampleOutsideWindow = "observation_interval_outside_row";
        public const string EdgeMismatch = "observation_edge_mismatch";
        public const string TooManySamples = "observation_too_many_samples";
        public const string TooLarge = "observation_too_large";
        public const string InvalidTimestamp = "observation_invalid_timestamp";
        public const string InvalidNumber = "observation_invalid_number";
    }

    /// <summary>
    /// De capture-time identiteitsfence. Alleen dit record bepaalt of een
    /// observation mag worden gebouwd; beschrijvende car/sessiecontext hoort
    /// hier bewust niet bij. Owner en generatie gaan niet over de draad.
    /// </summary>
    public sealed class ObservationPairingBinding
    {
        private readonly string _captureDeviceId;
        private readonly string _captureOwnerUserId;
        private readonly long _pairingGeneration;
        private readonly bool _pairingGenerationKnown;

        public ObservationPairingBinding(string captureDeviceId, string captureOwnerUserId,
            long pairingGeneration, bool pairingGenerationKnown)
        {
            _captureDeviceId = captureDeviceId;
            _captureOwnerUserId = captureOwnerUserId;
            _pairingGeneration = pairingGeneration;
            _pairingGenerationKnown = pairingGenerationKnown;
        }

        public string CaptureDeviceId { get { return _captureDeviceId; } }
        public string CaptureOwnerUserId { get { return _captureOwnerUserId; } }
        public long PairingGeneration { get { return _pairingGeneration; } }
        public bool PairingGenerationKnown { get { return _pairingGenerationKnown; } }

        public bool IsComplete
        {
            get
            {
                return _pairingGenerationKnown
                    && _pairingGeneration >= 0
                    && ObservationRules.IsUuid(_captureDeviceId)
                    && ObservationRules.IsUuid(_captureOwnerUserId);
            }
        }
    }

    /// <summary>
    /// Bevroren StartLap-context. Ontbreekt of is dit onvolledig, dan vervalt
    /// alleen de contextgroep; het is nooit een identiteitsfence en nooit een
    /// reden om geldige pit-/refuel-/naamfeiten weg te gooien.
    /// </summary>
    public sealed class ObservationLapContext
    {
        private readonly string _carId;
        private readonly int? _trackId;
        private readonly string _trackName;
        private readonly string _trackConfig;
        private readonly int? _sessionUniqueId;
        private readonly int? _sessionNumber;

        public ObservationLapContext(string carId, int? trackId, string trackName, string trackConfig,
            int? sessionUniqueId, int? sessionNumber)
        {
            _carId = carId;
            _trackId = trackId;
            _trackName = trackName;
            _trackConfig = trackConfig;
            _sessionUniqueId = sessionUniqueId;
            _sessionNumber = sessionNumber;
        }

        public string CarId { get { return _carId; } }
        public int? TrackId { get { return _trackId; } }
        public string TrackName { get { return _trackName; } }
        public string TrackConfig { get { return _trackConfig; } }
        public int? SessionUniqueId { get { return _sessionUniqueId; } }
        public int? SessionNumber { get { return _sessionNumber; } }
    }

    /// <summary>
    /// Eén geaccepteerd meetpunt. <see cref="ContextKey"/> is een ondoorzichtige
    /// car-/sessie-/segmentidentiteit: een wissel breekt de fuelstapketen, maar
    /// verwijdert geen eerdere positieve stappen. Null betekent onbekend en
    /// ketent dus niet.
    /// </summary>
    public sealed class ObservationSample
    {
        private readonly DateTime _observedAtUtc;
        private readonly bool? _onPitRoad;
        private readonly double? _fuelLitres;
        private readonly string _driverName;
        private readonly string _contextKey;

        public ObservationSample(DateTime observedAtUtc, bool? onPitRoad, double? fuelLitres,
            string driverName, string contextKey)
        {
            _observedAtUtc = observedAtUtc;
            _onPitRoad = onPitRoad;
            _fuelLitres = fuelLitres;
            _driverName = driverName;
            _contextKey = contextKey;
        }

        public DateTime ObservedAtUtc { get { return _observedAtUtc; } }
        public bool? OnPitRoad { get { return _onPitRoad; } }
        public double? FuelLitres { get { return _fuelLitres; } }
        public string DriverName { get { return _driverName; } }
        public string ContextKey { get { return _contextKey; } }
    }

    /// <summary>
    /// Onveranderlijk resultaat. De DTO heeft alleen getters; <see cref="ToJson"/>
    /// geeft de bytes die bij het bouwen zijn vastgelegd, zodat een caller het
    /// resultaat niet kan muteren en de groottecontrole dezelfde bytes meet als
    /// later worden verstuurd.
    /// </summary>
    public sealed class ObservationCaptureResult
    {
        private readonly MeasurementObservationV1Dto _observation;
        private readonly string _json;
        private readonly string _code;
        private readonly string _detail;
        private readonly ReadOnlyCollection<string> _omittedGroups;

        internal ObservationCaptureResult(MeasurementObservationV1Dto observation, string json,
            string code, string detail, IList<string> omittedGroups)
        {
            _observation = observation;
            _json = json;
            _code = code;
            _detail = detail;
            _omittedGroups = new ReadOnlyCollection<string>(
                omittedGroups == null ? new List<string>() : new List<string>(omittedGroups));
        }

        public bool HasObservation { get { return _observation != null; } }
        public MeasurementObservationV1Dto Observation { get { return _observation; } }
        public string Code { get { return _code; } }
        public string Detail { get { return _detail; } }
        public IReadOnlyList<string> OmittedGroups { get { return _omittedGroups; } }

        public string ToJson()
        {
            return _json;
        }

        internal static ObservationCaptureResult Refused(string code, string detail, IList<string> omittedGroups)
        {
            return new ObservationCaptureResult(null, null, code, detail, omittedGroups);
        }
    }

    /// <summary>
    /// Pure observation-builder. De accumulator houdt alleen constante staat
    /// bij: aantal, eerste/laatste gequantiseerde tijd, maximale interne gap,
    /// eerste pitroad-tijd, fuelketenstaat en naamcontinuïteit. Er wordt geen
    /// ticklijst bewaard en er is geen klok, SDK, bestand of netwerk in dit pad.
    ///
    /// Tijden worden uitsluitend op exacte UTC-milliseconden gerekend. De
    /// conversie naar seconden gebeurt pas bij het schrijven van de DTO; er is
    /// geen epsilon, clamping of kunstmatige tick.
    /// </summary>
    public sealed class ObservationCapture
    {
        private readonly ObservationPairingBinding _binding;
        private readonly ObservationLapContext _context;

        private int _sampleCount;
        private bool _tooManySamples;
        private bool _invalidInput;
        private bool _outOfOrder;
        private DateTime _firstAt;
        private DateTime _lastAt;
        private long _firstAtMs;
        private long _lastAtMs;
        private long _maxGapMs;

        private DateTime? _firstPitRoadAt;
        private double? _previousFuel;
        private long? _previousFuelAtMs;
        private string _previousContextKey;
        private DateTime? _firstRefuelAt;
        private int _positiveSteps;
        private double _addedLitres;

        private bool _namesKnown = true;
        private string _firstName;
        private bool _namesDiffer;

        public ObservationCapture(ObservationPairingBinding binding, ObservationLapContext context)
        {
            _binding = binding;
            _context = context;
        }

        /// <summary>Voegt één geaccepteerd meetpunt toe; gooit niet voor ongeldige waarden.</summary>
        public void AddSample(ObservationSample sample)
        {
            if (sample == null)
            {
                _invalidInput = true;
                return;
            }

            DateTime quantized;
            long atMs;
            if (!ObservationRules.TryQuantize(sample.ObservedAtUtc, out quantized, out atMs))
            {
                _invalidInput = true;
                return;
            }

            if (_sampleCount >= ObservationContract.MaxSamples)
            {
                _tooManySamples = true;
                return;
            }

            if (_sampleCount == 0)
            {
                _firstAt = quantized;
                _firstAtMs = atMs;
            }
            else
            {
                if (atMs < _lastAtMs) _outOfOrder = true;
                var gap = atMs - _lastAtMs;
                if (gap > _maxGapMs) _maxGapMs = gap;
            }

            _lastAt = quantized;
            _lastAtMs = atMs;
            _sampleCount++;

            if (sample.OnPitRoad == true && !_firstPitRoadAt.HasValue)
            {
                _firstPitRoadAt = quantized;
            }

            if (sample.DriverName != null && ObservationRules.IsWellFormed(sample.DriverName))
            {
                var normalized = sample.DriverName.Trim();
                if (normalized.Length == 0)
                {
                    _namesKnown = false;
                }
                else if (_firstName == null)
                {
                    _firstName = normalized;
                }
                else if (!string.Equals(_firstName, normalized, StringComparison.Ordinal))
                {
                    _namesDiffer = true;
                }
            }
            else
            {
                _namesKnown = false;
            }

            var fuel = sample.FuelLitres;
            if (!fuel.HasValue || !ObservationRules.IsFinite(fuel.Value) || fuel.Value < 0)
            {
                // Onbekend/ongeldig niveau breekt de keten; er wordt geen 0 of
                // negatieve brandstof als feit verzonnen.
                _previousFuel = null;
                _previousFuelAtMs = null;
                _previousContextKey = null;
            }
            else
            {
                var contextKey = string.IsNullOrEmpty(sample.ContextKey) ? null : sample.ContextKey;
                if (_previousFuel.HasValue
                    && _previousFuelAtMs.HasValue
                    && atMs - _previousFuelAtMs.Value <= 1000L
                    && _previousContextKey != null
                    && contextKey != null
                    && string.Equals(_previousContextKey, contextKey, StringComparison.Ordinal))
                {
                    var step = Math.Round(fuel.Value - _previousFuel.Value, 3, MidpointRounding.AwayFromZero);
                    if (step >= ObservationContract.FuelResolutionLitres)
                    {
                        _positiveSteps++;
                        _addedLitres = Math.Round(_addedLitres + step, 3, MidpointRounding.AwayFromZero);
                        if (!_firstRefuelAt.HasValue) _firstRefuelAt = quantized;
                    }
                }
                _previousFuel = fuel;
                _previousFuelAtMs = atMs;
                _previousContextKey = contextKey;
            }
        }

        /// <summary>
        /// Bouwt met expliciete rijgrenzen. De grenzen moeten bekende UTC zijn;
        /// een onbekende zone, MinValue of een negatieve edge wordt geweigerd.
        /// </summary>
        public ObservationCaptureResult Build(DateTime rowStartedAtUtc, DateTime rowEndedAtUtc)
        {
            if (_binding == null || !_binding.IsComplete)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.PairingIncomplete,
                    "device/owner UUID of generation ontbreekt", null);
            }
            if (_invalidInput)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.InvalidTimestamp,
                    "sample of rijgrens is geen bekende UTC-tijd", null);
            }

            DateTime rowStart;
            DateTime rowEnd;
            long rowStartMs;
            long rowEndMs;
            if (!ObservationRules.TryQuantize(rowStartedAtUtc, out rowStart, out rowStartMs)
                || !ObservationRules.TryQuantize(rowEndedAtUtc, out rowEnd, out rowEndMs))
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.InvalidTimestamp,
                    "rijgrens is geen bekende UTC-tijd", null);
            }
            if (rowEndMs < rowStartMs)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.BoundsInconsistent,
                    "endedAt ligt voor startedAt", null);
            }
            if (_tooManySamples)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.TooManySamples,
                    "meer dan " + ObservationContract.MaxSamples + " geaccepteerde punten", null);
            }
            if (_sampleCount == 0)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.NoSamples,
                    "geen geaccepteerde punten", null);
            }
            if (_outOfOrder)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.TimeOrder,
                    "geaccepteerde punten staan niet in tijdorde", null);
            }
            if (_firstAtMs < rowStartMs || _lastAtMs > rowEndMs)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.SampleOutsideWindow,
                    "sample valt buiten de rijgrenzen", null);
            }
            if (_sampleCount > 1 && _firstAtMs == _lastAtMs)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.BoundsInconsistent,
                    "samples>1 maar gequantiseerde first==last", null);
            }
            if (_maxGapMs > ObservationContract.MaxSeconds * 1000L)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.InvalidNumber,
                    "maxGap boven wire-maximum", null);
            }

            var edgeBeforeMs = _firstAtMs - rowStartMs;
            var edgeAfterMs = rowEndMs - _lastAtMs;
            if (edgeBeforeMs < 0 || edgeAfterMs < 0)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.BoundsInconsistent,
                    "negatieve edge", null);
            }
            var unknownMs = edgeBeforeMs + edgeAfterMs;
            if (_maxGapMs > 1000L) unknownMs += _maxGapMs;
            if (edgeBeforeMs > ObservationContract.MaxSeconds * 1000L
                || edgeAfterMs > ObservationContract.MaxSeconds * 1000L
                || unknownMs > ObservationContract.MaxSeconds * 1000L)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.InvalidNumber,
                    "intervalstat boven wire-maximum", null);
            }

            var omitted = new List<string>();

            var capture = new MeasurementObservationCaptureV1Dto(_binding.CaptureDeviceId);
            var interval = new MeasurementObservationIntervalV1Dto(
                MeasurementTime.Format(_firstAt),
                MeasurementTime.Format(_lastAt),
                _sampleCount,
                ObservationRules.Seconds(_maxGapMs),
                ObservationRules.Seconds(unknownMs),
                ObservationRules.Seconds(edgeBeforeMs),
                ObservationRules.Seconds(edgeAfterMs));

            MeasurementObservationPitRoadV1Dto pitRoad = null;
            if (_firstPitRoadAt.HasValue)
            {
                pitRoad = new MeasurementObservationPitRoadV1Dto(true, MeasurementTime.Format(_firstPitRoadAt.Value));
            }

            MeasurementObservationRefuelV1Dto refuel = null;
            if (_positiveSteps > 0 && _firstRefuelAt.HasValue)
            {
                if (_positiveSteps <= ObservationContract.MaxPositiveSteps
                    && _addedLitres > 0
                    && _addedLitres <= ObservationContract.MaxAddedLitres)
                {
                    refuel = new MeasurementObservationRefuelV1Dto(
                        _addedLitres,
                        MeasurementTime.Format(_firstRefuelAt.Value),
                        _positiveSteps,
                        ObservationContract.FuelResolutionLitres,
                        null);
                }
                else
                {
                    // De som/stapreeks past niet op de draad. Er wordt geen
                    // afgekapt of verzonnen totaal geëmit; de groep vervalt.
                    omitted.Add("refuel");
                }
            }

            MeasurementObservationDriverNameContinuityV1Dto continuity = null;
            if (_namesKnown && _firstName != null)
            {
                continuity = new MeasurementObservationDriverNameContinuityV1Dto(
                    _namesDiffer ? "changed" : "unchanged");
            }
            else
            {
                omitted.Add("driverNameContinuity");
            }

            var context = BuildContext();
            if (context == null) omitted.Add("context");

            if (capture == null || interval == null || (pitRoad == null && refuel == null && continuity == null && context == null))
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.NoFact,
                    "geen geldige feitgroep over", omitted);
            }

            var dto = new MeasurementObservationV1Dto(
                ObservationContract.Version, capture, interval, pitRoad, refuel, continuity, context);
            var json = MeasurementJson.Serialize(dto);
            if (ObservationWireBudget.Utf8Bytes(json) > ObservationContract.MaxWireBytes)
            {
                return ObservationCaptureResult.Refused(ObservationCaptureCodes.TooLarge,
                    "observation boven 2048 UTF-8-bytes", omitted);
            }
            return new ObservationCaptureResult(dto, json, ObservationCaptureCodes.Accepted, null, omitted);
        }

        /// <summary>Praktische one-shot-API met expliciete grenzen en snapshots.</summary>
        public static ObservationCaptureResult Build(ObservationPairingBinding binding,
            ObservationLapContext context, IEnumerable<ObservationSample> samples,
            DateTime rowStartedAtUtc, DateTime rowEndedAtUtc)
        {
            var capture = new ObservationCapture(binding, context);
            if (samples != null)
            {
                foreach (var sample in samples) capture.AddSample(sample);
            }
            return capture.Build(rowStartedAtUtc, rowEndedAtUtc);
        }

        private MeasurementObservationContextV1Dto BuildContext()
        {
            if (_context == null) return null;
            if (!ObservationRules.IsText(_context.CarId, ObservationContract.MaxCarIdBytes)) return null;
            if (!_context.TrackId.HasValue
                || _context.TrackId.Value < 1) return null;
            if (!ObservationRules.IsText(_context.TrackName, ObservationContract.MaxTrackTextBytes)) return null;
            if (!ObservationRules.IsText(_context.TrackConfig, ObservationContract.MaxTrackTextBytes)) return null;

            int? sessionUniqueId = null;
            if (_context.SessionUniqueId.HasValue
                && _context.SessionUniqueId.Value >= 0)
            {
                sessionUniqueId = _context.SessionUniqueId;
            }
            int? sessionNumber = null;
            if (_context.SessionNumber.HasValue
                && _context.SessionNumber.Value >= 0
                && _context.SessionNumber.Value <= ObservationContract.MaxSessionNumber)
            {
                sessionNumber = _context.SessionNumber;
            }

            return new MeasurementObservationContextV1Dto(
                _context.CarId,
                _context.TrackId.Value,
                _context.TrackName,
                _context.TrackConfig,
                sessionUniqueId,
                sessionNumber);
        }
    }

    /// <summary>UTF-8-maat en de 2048-byte wire-grens.</summary>
    public static class ObservationWireBudget
    {
        public static int Utf8Bytes(string json)
        {
            return string.IsNullOrEmpty(json) ? 0 : Encoding.UTF8.GetByteCount(json);
        }

        public static bool Fits(MeasurementObservationV1Dto observation)
        {
            if (observation == null) return false;
            return Utf8Bytes(MeasurementJson.Serialize(observation)) <= ObservationContract.MaxWireBytes;
        }
    }

    internal static class ObservationRules
    {
        public static bool TryQuantize(DateTime value, out DateTime quantized, out long milliseconds)
        {
            quantized = default(DateTime);
            milliseconds = 0;
            if (value.Kind != DateTimeKind.Utc) return false;
            if (value.Year < 1970 || value.Year > 9999) return false;
            milliseconds = value.Ticks / TimeSpan.TicksPerMillisecond;
            quantized = new DateTime(milliseconds * TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
            return true;
        }

        public static double Seconds(long milliseconds)
        {
            return milliseconds / 1000.0;
        }

        public static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        public static bool IsWellFormed(string value)
        {
            if (value == null) return false;
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                if (char.IsHighSurrogate(character))
                {
                    if (index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1])) return false;
                    index++;
                }
                else if (char.IsLowSurrogate(character))
                {
                    return false;
                }
            }
            return true;
        }

        public static bool IsText(string value, int maxBytes)
        {
            if (string.IsNullOrEmpty(value)) return false;
            if (!IsWellFormed(value)) return false;
            var bytes = Encoding.UTF8.GetByteCount(value);
            if (bytes < 1 || bytes > maxBytes) return false;
            for (var index = 0; index < value.Length; index++)
            {
                if (char.IsControl(value[index])) return false;
            }
            return true;
        }

        public static bool IsUuid(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length != 36) return false;
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                if (index == 8 || index == 13 || index == 18 || index == 23)
                {
                    if (character != '-') return false;
                    continue;
                }
                var hex = (character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f')
                    || (character >= 'A' && character <= 'F');
                if (!hex) return false;
            }
            var version = value[14];
            if (version < '1' || version > '5') return false;
            var variant = char.ToLowerInvariant(value[19]);
            return variant == '8' || variant == '9' || variant == 'a' || variant == 'b';
        }
    }

    // ------------------------------------------------------------------
    // Typed wire-DTO's. Alleen [DataMember]-velden, geen rekenlogica.
    // Velden zijn readonly en de publieke API is get-only, zodat een
    // resultaat niet door een caller kan worden aangepast.
    // ------------------------------------------------------------------

    [DataContract]
    public sealed class MeasurementObservationV1Dto
    {
        [DataMember(Name = "version", Order = 1)] private readonly int _version;
        [DataMember(Name = "capture", Order = 2)] private readonly MeasurementObservationCaptureV1Dto _capture;
        [DataMember(Name = "interval", Order = 3)] private readonly MeasurementObservationIntervalV1Dto _interval;
        [DataMember(Name = "pitRoad", Order = 4, EmitDefaultValue = false)] private readonly MeasurementObservationPitRoadV1Dto _pitRoad;
        [DataMember(Name = "refuel", Order = 5, EmitDefaultValue = false)] private readonly MeasurementObservationRefuelV1Dto _refuel;
        [DataMember(Name = "driverNameContinuity", Order = 6, EmitDefaultValue = false)] private readonly MeasurementObservationDriverNameContinuityV1Dto _continuity;
        [DataMember(Name = "context", Order = 7, EmitDefaultValue = false)] private readonly MeasurementObservationContextV1Dto _context;

        public MeasurementObservationV1Dto(int version,
            MeasurementObservationCaptureV1Dto capture,
            MeasurementObservationIntervalV1Dto interval,
            MeasurementObservationPitRoadV1Dto pitRoad,
            MeasurementObservationRefuelV1Dto refuel,
            MeasurementObservationDriverNameContinuityV1Dto continuity,
            MeasurementObservationContextV1Dto context)
        {
            _version = version;
            _capture = capture;
            _interval = interval;
            _pitRoad = pitRoad;
            _refuel = refuel;
            _continuity = continuity;
            _context = context;
        }

        public int Version { get { return _version; } }
        public MeasurementObservationCaptureV1Dto Capture { get { return _capture; } }
        public MeasurementObservationIntervalV1Dto Interval { get { return _interval; } }
        public MeasurementObservationPitRoadV1Dto PitRoad { get { return _pitRoad; } }
        public MeasurementObservationRefuelV1Dto Refuel { get { return _refuel; } }
        public MeasurementObservationDriverNameContinuityV1Dto DriverNameContinuity { get { return _continuity; } }
        public MeasurementObservationContextV1Dto Context { get { return _context; } }
    }

    [DataContract]
    public sealed class MeasurementObservationCaptureV1Dto
    {
        [DataMember(Name = "deviceId", Order = 1)] private readonly string _deviceId;

        public MeasurementObservationCaptureV1Dto(string deviceId)
        {
            _deviceId = deviceId;
        }

        public string DeviceId { get { return _deviceId; } }
    }

    [DataContract]
    public sealed class MeasurementObservationIntervalV1Dto
    {
        [DataMember(Name = "firstSampleAt", Order = 1)] private readonly string _firstSampleAt;
        [DataMember(Name = "lastSampleAt", Order = 2)] private readonly string _lastSampleAt;
        [DataMember(Name = "samples", Order = 3)] private readonly int _samples;
        [DataMember(Name = "maxGapSeconds", Order = 4)] private readonly double _maxGapSeconds;
        [DataMember(Name = "unknownSeconds", Order = 5)] private readonly double _unknownSeconds;
        [DataMember(Name = "edgeBeforeSeconds", Order = 6)] private readonly double _edgeBeforeSeconds;
        [DataMember(Name = "edgeAfterSeconds", Order = 7)] private readonly double _edgeAfterSeconds;

        public MeasurementObservationIntervalV1Dto(string firstSampleAt, string lastSampleAt, int samples,
            double maxGapSeconds, double unknownSeconds, double edgeBeforeSeconds, double edgeAfterSeconds)
        {
            _firstSampleAt = firstSampleAt;
            _lastSampleAt = lastSampleAt;
            _samples = samples;
            _maxGapSeconds = maxGapSeconds;
            _unknownSeconds = unknownSeconds;
            _edgeBeforeSeconds = edgeBeforeSeconds;
            _edgeAfterSeconds = edgeAfterSeconds;
        }

        public string FirstSampleAt { get { return _firstSampleAt; } }
        public string LastSampleAt { get { return _lastSampleAt; } }
        public int Samples { get { return _samples; } }
        public double MaxGapSeconds { get { return _maxGapSeconds; } }
        public double UnknownSeconds { get { return _unknownSeconds; } }
        public double EdgeBeforeSeconds { get { return _edgeBeforeSeconds; } }
        public double EdgeAfterSeconds { get { return _edgeAfterSeconds; } }
    }

    [DataContract]
    public sealed class MeasurementObservationPitRoadV1Dto
    {
        [DataMember(Name = "value", Order = 1)] private readonly bool _value;
        [DataMember(Name = "firstAt", Order = 2)] private readonly string _firstAt;

        public MeasurementObservationPitRoadV1Dto(bool value, string firstAt)
        {
            _value = value;
            _firstAt = firstAt;
        }

        public bool Value { get { return _value; } }
        public string FirstAt { get { return _firstAt; } }
    }

    [DataContract]
    public sealed class MeasurementObservationRefuelV1Dto
    {
        [DataMember(Name = "observedAddedLitres", Order = 1)] private readonly double _observedAddedLitres;
        [DataMember(Name = "firstAt", Order = 2)] private readonly string _firstAt;
        [DataMember(Name = "positiveSteps", Order = 3)] private readonly int _positiveSteps;
        [DataMember(Name = "resolutionLitres", Order = 4)] private readonly double _resolutionLitres;
        [DataMember(Name = "maxUndetectedLitres", Order = 5, EmitDefaultValue = false)] private readonly double? _maxUndetectedLitres;

        public MeasurementObservationRefuelV1Dto(double observedAddedLitres, string firstAt, int positiveSteps,
            double resolutionLitres, double? maxUndetectedLitres)
        {
            _observedAddedLitres = observedAddedLitres;
            _firstAt = firstAt;
            _positiveSteps = positiveSteps;
            _resolutionLitres = resolutionLitres;
            _maxUndetectedLitres = maxUndetectedLitres;
        }

        public double ObservedAddedLitres { get { return _observedAddedLitres; } }
        public string FirstAt { get { return _firstAt; } }
        public int PositiveSteps { get { return _positiveSteps; } }
        public double ResolutionLitres { get { return _resolutionLitres; } }
        public double? MaxUndetectedLitres { get { return _maxUndetectedLitres; } }
    }

    [DataContract]
    public sealed class MeasurementObservationDriverNameContinuityV1Dto
    {
        [DataMember(Name = "value", Order = 1)] private readonly string _value;

        public MeasurementObservationDriverNameContinuityV1Dto(string value)
        {
            _value = value;
        }

        public string Value { get { return _value; } }
    }

    [DataContract]
    public sealed class MeasurementObservationContextV1Dto
    {
        [DataMember(Name = "carId", Order = 1)] private readonly string _carId;
        [DataMember(Name = "trackId", Order = 2)] private readonly int _trackId;
        [DataMember(Name = "trackName", Order = 3)] private readonly string _trackName;
        [DataMember(Name = "trackConfig", Order = 4)] private readonly string _trackConfig;
        [DataMember(Name = "sessionUniqueId", Order = 5, EmitDefaultValue = false)] private readonly int? _sessionUniqueId;
        [DataMember(Name = "sessionNumber", Order = 6, EmitDefaultValue = false)] private readonly int? _sessionNumber;

        public MeasurementObservationContextV1Dto(string carId, int trackId, string trackName, string trackConfig,
            int? sessionUniqueId, int? sessionNumber)
        {
            _carId = carId;
            _trackId = trackId;
            _trackName = trackName;
            _trackConfig = trackConfig;
            _sessionUniqueId = sessionUniqueId;
            _sessionNumber = sessionNumber;
        }

        public string CarId { get { return _carId; } }
        public int TrackId { get { return _trackId; } }
        public string TrackName { get { return _trackName; } }
        public string TrackConfig { get { return _trackConfig; } }
        public int? SessionUniqueId { get { return _sessionUniqueId; } }
        public int? SessionNumber { get { return _sessionNumber; } }
    }
}
