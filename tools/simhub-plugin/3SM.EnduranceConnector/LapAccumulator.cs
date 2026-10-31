using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén waarneming uit één SDK-tick, zoals de meetlaag hem nodig heeft.
    ///
    /// Alles is nullable en <c>null</c> betekent "deze tick leverde dit kanaal niet".
    /// Nooit 0 als vervanging: 0 is een meting (nul brandstof, nul versnelling) en
    /// een verzonnen 0 verpest later elk gemiddelde.
    ///
    /// Deze klasse heeft geen SimHub-referentie; de plugin vult hem uit
    /// <c>GameData</c> en de ruwe SDK-lezer, de tests vullen hem synthetisch.
    /// </summary>
    public sealed class TelemetrySample
    {
        /// <summary>Moment van de waarneming (UTC). Bepaalt de echte tijdsintervallen.</summary>
        public DateTime ObservedAtUtc { get; set; }

        /// <summary>SDK-tick uit de iRacing-header. Twee keer dezelfde tick = één meting.</summary>
        public long? SdkTick { get; set; }

        /// <summary>iRacing-sessietijd in seconden. Alleen voor grenzen, nooit voor intervallen.</summary>
        public double? SessionTimeSeconds { get; set; }

        public int? LapNumber { get; set; }

        public double? TrackTempC { get; set; }
        public double? AirTempC { get; set; }
        public double? FuelLitres { get; set; }
        public double? LatAccelG { get; set; }
        public double? LongAccelG { get; set; }

        /// <summary>Sessie waarin de waarneming is gedaan; nooit de afleversessie.</summary>
        public string ObservedSessionId { get; set; }

        /// <summary>Lokaal segmentsignaal (sessiewissel binnen dezelfde run).</summary>
        public string SegmentId { get; set; }

        public string CurrentDriverName { get; set; }

        /// <summary>Ruwe SDK <c>OnPitRoad</c>, geen SimHub-fallback naar false.</summary>
        public bool? OnPitRoad { get; set; }

        public bool? InPitStall { get; set; }

        /// <summary>Ruwe <c>PitSvFlags</c>-bitmasker; interpretatie gebeurt in PitServiceTracker.</summary>
        public int? PitServiceFlagsRaw { get; set; }

        /// <summary>Gevraagde brandstof in liters (<c>PitSvFuel</c>).</summary>
        public double? RequestedFuelLitres { get; set; }

        /// <summary>Aantal gebruikte bandensets (<c>TireSetsUsed</c>), als de sim het levert.</summary>
        public int? TyreSetsUsed { get; set; }

        /// <summary>Wear-lezing in procenten rest, of null als de sim niets gaf.</summary>
        public WearReading Wear { get; set; }

        /// <summary>Kopie met een ander tijdstip; handig in tests.</summary>
        public TelemetrySample At(DateTime utc)
        {
            var copy = (TelemetrySample)MemberwiseClone();
            copy.ObservedAtUtc = utc;
            return copy;
        }
    }

    /// <summary>Instellingen van de accumulator. De waarden zijn contractgrenzen.</summary>
    public sealed class LapAccumulatorOptions
    {
        /// <summary>
        /// Groter gat dan dit wordt niet geïnterpoleerd: het telt als dekkingstekort
        /// in <c>maxGapSeconds</c> en de meetduur blijft staan. Gelijk aan
        /// <see cref="CoverageRules.MaxGapSeconds"/>, zodat "complete" haalbaar blijft.
        /// </summary>
        public double MaxIntegrationGapSeconds = CoverageRules.MaxGapSeconds;

        public static LapAccumulatorOptions Default()
        {
            return new LapAccumulatorOptions();
        }
    }

    /// <summary>
    /// Dekking en statistiek van één metriekgroep binnen één ronde.
    ///
    /// <c>validDurationSeconds</c> is de som van de ECHTE intervallen waarin de groep
    /// meetbaar was; een gat groter dan de drempel draagt niets bij, maar verhoogt wel
    /// <c>maxGapSeconds</c>. Zo is "120 s gemeten in een ronde van 180 s" zichtbaar
    /// als dekking en niet als volledigheid.
    /// </summary>
    internal sealed class CoverageTracker
    {
        private int _sampleCount;
        private double _validDurationSeconds;
        private double _maxGapSeconds;
        private DateTime? _lastPresentUtc;

        public void Mark(bool present, DateTime atUtc, double dtSeconds, bool integrate)
        {
            if (!present) return;
            _sampleCount++;
            if (_lastPresentUtc.HasValue)
            {
                var gap = (atUtc - _lastPresentUtc.Value).TotalSeconds;
                if (gap > _maxGapSeconds) _maxGapSeconds = Clamp(gap);
            }
            _lastPresentUtc = atUtc;
            if (integrate && dtSeconds > 0) _validDurationSeconds = Clamp(_validDurationSeconds + dtSeconds);
        }

        public bool HasSamples { get { return _sampleCount > 0; } }

        public MeasurementCoverageGroupDto ToDto()
        {
            if (_sampleCount == 0) return null;
            return new MeasurementCoverageGroupDto
            {
                ValidDurationSeconds = Math.Round(Clamp(_validDurationSeconds), 3, MidpointRounding.AwayFromZero),
                SampleCount = _sampleCount,
                MaxGapSeconds = Math.Round(_maxGapSeconds, 3, MidpointRounding.AwayFromZero)
            };
        }

        private static double Clamp(double value)
        {
            if (value < 0 || double.IsNaN(value)) return 0;
            return value > CoverageRules.MaxCoverageSeconds ? CoverageRules.MaxCoverageSeconds : value;
        }
    }

    /// <summary>
    /// Min/max en een tijdsgewogen gemiddelde van één kanaal. Het gemiddelde weegt
    /// met de echte intervallen; zijn er (nog) geen intervallen, dan is het het
    /// ongewogen gemiddelde van de waargenomen waarden. Min en max komen altijd
    /// rechtstreeks uit een waarneming en zijn nooit geïnterpoleerd.
    /// </summary>
    internal sealed class ChannelStatistics
    {
        private int _count;
        private double _min;
        private double _max;
        private double _sum;
        private double _weightedSum;
        private double _weight;

        public void Add(double value, double dtSeconds)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return;
            if (_count == 0)
            {
                _min = value;
                _max = value;
            }
            else
            {
                if (value < _min) _min = value;
                if (value > _max) _max = value;
            }
            _count++;
            _sum += value;
            if (dtSeconds > 0)
            {
                _weightedSum += value * dtSeconds;
                _weight += dtSeconds;
            }
        }

        public int Count { get { return _count; } }
        public double? Min { get { return _count == 0 ? (double?)null : _min; } }
        public double? Max { get { return _count == 0 ? (double?)null : _max; } }

        public double? Mean
        {
            get
            {
                if (_count == 0) return null;
                if (_weight > 0) return _weightedSum / _weight;
                // Geen enkel interval: het gemiddelde van de losse waarnemingen, geen gok.
                return _sum / _count;
            }
        }
    }

    /// <summary>
    /// Accumulator voor één ronde. De ronde begint bij de eerste geaccepteerde tick en
    /// eindigt bij de grenstik (rondewissel) of bij een sessiewissel/reset.
    ///
    /// Wat hier bewust NIET gebeurt: interpoleren over een gat, brandstofverbruik
    /// afleiden uit een integraal waarin getankt is, of een gemiddelde publiceren
    /// zonder dekking van de eigen groep.
    /// </summary>
    public sealed class LapAccumulator
    {
        private readonly LapAccumulatorOptions _options;
        private readonly int _lapNumber;
        private readonly DateTime _startedAtUtc;
        private readonly string _segmentId;
        private readonly string _firstDriverName;
        private readonly List<string> _pitVisitIds = new List<string>();
        private readonly List<string> _wearObservationIds = new List<string>();
        private readonly CoverageTracker _temperature = new CoverageTracker();
        private readonly CoverageTracker _fuel = new CoverageTracker();
        private readonly CoverageTracker _load = new CoverageTracker();
        private readonly ChannelStatistics _trackTemp = new ChannelStatistics();
        private readonly ChannelStatistics _airTemp = new ChannelStatistics();

        private TelemetrySample _previous;
        private DateTime _lastAtUtc;
        private bool _driverChanged;
        private bool _pitLap;
        private double? _fuelStart;
        private double? _fuelEnd;
        private double _fuelIntegral;
        private double _absLatIntegral;
        private double _latSquaredIntegral;
        private double _absLongIntegral;
        private double? _maxAbsLat;
        private double? _fuelAddedObserved;
        private int _fuelIntervals;
        private int _latIntervals;
        private int _longIntervals;

        public LapAccumulator(int lapNumber, DateTime startedAtUtc, string segmentId, string driverName,
            LapAccumulatorOptions options)
        {
            _lapNumber = lapNumber;
            _startedAtUtc = startedAtUtc;
            _lastAtUtc = startedAtUtc;
            _segmentId = segmentId;
            _firstDriverName = driverName;
            _options = options ?? LapAccumulatorOptions.Default();
        }

        public int LapNumber { get { return _lapNumber; } }
        public DateTime StartedAtUtc { get { return _startedAtUtc; } }
        public DateTime LastSampleUtc { get { return _lastAtUtc; } }
        public string SegmentId { get { return _segmentId; } }
        public string FirstDriverName { get { return _firstDriverName; } }
        public bool DriverChanged { get { return _driverChanged; } }
        public bool PitLap { get { return _pitLap; } }

        /// <summary>
        /// Verwerkt één geaccepteerde tick. <paramref name="dtSeconds"/> is het echte
        /// interval sinds de vorige geaccepteerde tick; het wordt hier niet herberekend
        /// uit sessietijd, want sessietijd staat stil in de pit en in pauzes.
        /// </summary>
        public void Add(TelemetrySample sample)
        {
            if (sample == null) return;
            var dt = _previous == null ? 0.0 : (sample.ObservedAtUtc - _lastAtUtc).TotalSeconds;
            if (double.IsNaN(dt) || dt < 0) dt = 0;
            var usable = _previous != null && dt > 0 && dt <= _options.MaxIntegrationGapSeconds;

            var hasTemperature = sample.TrackTempC.HasValue || sample.AirTempC.HasValue;
            _temperature.Mark(hasTemperature, sample.ObservedAtUtc, dt, usable && hasTemperature);
            if (sample.TrackTempC.HasValue) _trackTemp.Add(sample.TrackTempC.Value, usable ? dt : 0);
            if (sample.AirTempC.HasValue) _airTemp.Add(sample.AirTempC.Value, usable ? dt : 0);

            var hasFuel = sample.FuelLitres.HasValue;
            _fuel.Mark(hasFuel, sample.ObservedAtUtc, dt, usable && hasFuel);
            if (hasFuel)
            {
                if (!_fuelStart.HasValue) _fuelStart = sample.FuelLitres.Value;
                _fuelEnd = sample.FuelLitres.Value;
                if (usable && _previous != null && _previous.FuelLitres.HasValue)
                {
                    // Trapezium over het niveau; dit is de niveau-integraal, niet het verbruik.
                    _fuelIntegral += (_previous.FuelLitres.Value + sample.FuelLitres.Value) / 2.0 * dt;
                    _fuelIntervals++;
                }
            }

            var hasLoad = sample.LatAccelG.HasValue || sample.LongAccelG.HasValue;
            _load.Mark(hasLoad, sample.ObservedAtUtc, dt, usable && hasLoad);
            if (sample.LatAccelG.HasValue)
            {
                var lateral = Math.Abs(sample.LatAccelG.Value);
                if (!_maxAbsLat.HasValue || lateral > _maxAbsLat.Value) _maxAbsLat = lateral;
                if (usable && _previous != null && _previous.LatAccelG.HasValue)
                {
                    var previousLateral = Math.Abs(_previous.LatAccelG.Value);
                    _absLatIntegral += (previousLateral + lateral) / 2.0 * dt;
                    var currentSquared = sample.LatAccelG.Value * sample.LatAccelG.Value;
                    var previousSquared = _previous.LatAccelG.Value * _previous.LatAccelG.Value;
                    _latSquaredIntegral += (previousSquared + currentSquared) / 2.0 * dt;
                    _latIntervals++;
                }
            }
            if (sample.LongAccelG.HasValue && usable && _previous != null && _previous.LongAccelG.HasValue)
            {
                _absLongIntegral += (Math.Abs(_previous.LongAccelG.Value) + Math.Abs(sample.LongAccelG.Value)) / 2.0 * dt;
                _longIntervals++;
            }

            if (sample.OnPitRoad == true) _pitLap = true;
            if (!_driverChanged && !string.IsNullOrWhiteSpace(_firstDriverName)
                && !string.IsNullOrWhiteSpace(sample.CurrentDriverName)
                && !string.Equals(_firstDriverName.Trim(), sample.CurrentDriverName.Trim(), StringComparison.Ordinal))
            {
                _driverChanged = true;
            }

            _previous = sample;
            _lastAtUtc = sample.ObservedAtUtc;
        }

        /// <summary>Een pitbezoek dat deze ronde raakt (context, geen identiteit).</summary>
        public void NotePitVisit(string pitVisitId, double? fuelAddedLitresObserved)
        {
            if (MeasurementIds.IsLocalId(pitVisitId) && !_pitVisitIds.Contains(pitVisitId)) _pitVisitIds.Add(pitVisitId);
            if (fuelAddedLitresObserved.HasValue && fuelAddedLitresObserved.Value > 0)
            {
                _pitLap = true;
                _fuelAddedObserved = (_fuelAddedObserved ?? 0) + fuelAddedLitresObserved.Value;
            }
        }

        /// <summary>Een wear-waarneming die binnen deze ronde is gedaan.</summary>
        public void NoteWearObservation(string eventUid)
        {
            if (MeasurementIds.IsUid(eventUid) && !_wearObservationIds.Contains(eventUid)) _wearObservationIds.Add(eventUid);
        }

        public bool HasSamples { get { return _previous != null; } }

        /// <summary>
        /// Sluit de ronde. <paramref name="extraReasons"/> zijn redenen die de
        /// volledigheid aantoonbaar ondermijnen (sessiewissel, reset, ontbrekende
        /// ronde). Ze komen in <c>invalidReasons</c> en zetten <c>complete</c> op false.
        /// </summary>
        public LapAggregate Close(DateTime endedAtUtc, string[] extraReasons)
        {
            var ended = endedAtUtc < _startedAtUtc ? _startedAtUtc : endedAtUtc;
            var coverage = new MeasurementLapCoverageDto
            {
                Temperature = _temperature.ToDto(),
                Fuel = _fuel.ToDto(),
                Load = _load.ToDto()
            };
            if (coverage.Temperature == null && coverage.Fuel == null && coverage.Load == null) coverage = null;

            var verdict = CoverageRules.Evaluate(coverage, _startedAtUtc, ended);
            var reasons = new List<string>(verdict.Reasons);
            if (extraReasons != null)
            {
                foreach (var reason in extraReasons)
                {
                    if (!string.IsNullOrEmpty(reason) && !reasons.Contains(reason)) reasons.Add(reason);
                }
            }
            if (reasons.Count > MeasurementContract.MaxInvalidReasons)
                reasons.RemoveRange(MeasurementContract.MaxInvalidReasons, reasons.Count - MeasurementContract.MaxInvalidReasons);

            var aggregate = new LapAggregate
            {
                LapNumber = _lapNumber,
                StartedAtUtc = _startedAtUtc,
                EndedAtUtc = ended,
                SegmentId = _segmentId,
                DriverName = _driverChanged ? null : _firstDriverName,
                DriverChanged = _driverChanged ? true : (bool?)null,
                PitLap = _pitLap ? true : (bool?)null,
                Coverage = coverage,
                Complete = reasons.Count == 0,
                InvalidReasons = reasons.Count == 0 ? null : reasons.ToArray(),
                TrackTempCMean = _trackTemp.Mean,
                TrackTempCMin = _trackTemp.Min,
                TrackTempCMax = _trackTemp.Max,
                AirTempCMean = _airTemp.Mean,
                FuelStartLitres = _fuelStart,
                FuelEndLitres = _fuelEnd,
                FuelLevelIntegralLitreSeconds = _fuelIntervals > 0 ? (double?)_fuelIntegral : null,
                FuelAddedLitresObserved = _fuelAddedObserved,
                AbsLatAccelIntegralGSeconds = _latIntervals > 0 ? (double?)_absLatIntegral : null,
                LatAccelSquaredIntegralG2Seconds = _latIntervals > 0 ? (double?)_latSquaredIntegral : null,
                MaxAbsLatAccelG = _maxAbsLat,
                AbsLongAccelIntegralGSeconds = _longIntervals > 0 ? (double?)_absLongIntegral : null,
                SampleCount = coverage == null ? (int?)null : CoverageRules.TotalSamples(coverage),
                MaxGapSeconds = coverage == null ? (double?)null : CoverageRules.MaxGap(coverage),
                ValidDurationSeconds = coverage == null ? (double?)null : CoverageRules.MaxDuration(coverage),
                PitVisitIds = _pitVisitIds.Count == 0 ? null : _pitVisitIds.ToArray(),
                WearObservationIds = _wearObservationIds.Count == 0 ? null : _wearObservationIds.ToArray()
            };
            return aggregate;
        }
    }

    /// <summary>
    /// Uitkomst van één gesloten ronde, klaar om een duurzame identiteit te krijgen.
    /// Geen <c>summaryUid</c> hier: die maakt de outbox/pipeline één keer, zodat een
    /// herverzending dezelfde ronde niet opnieuw identificeert.
    /// </summary>
    public sealed class LapAggregate
    {
        public int LapNumber { get; set; }
        public DateTime? StartedAtUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }
        public string SegmentId { get; set; }
        public string DriverName { get; set; }
        public bool? DriverChanged { get; set; }
        public bool? PitLap { get; set; }
        public MeasurementLapCoverageDto Coverage { get; set; }
        public bool Complete { get; set; }
        public string[] InvalidReasons { get; set; }
        public double? TrackTempCMean { get; set; }
        public double? TrackTempCMin { get; set; }
        public double? TrackTempCMax { get; set; }
        public double? AirTempCMean { get; set; }
        public double? FuelStartLitres { get; set; }
        public double? FuelEndLitres { get; set; }
        public double? FuelLevelIntegralLitreSeconds { get; set; }
        public double? FuelAddedLitresObserved { get; set; }
        public double? AbsLatAccelIntegralGSeconds { get; set; }
        public double? LatAccelSquaredIntegralG2Seconds { get; set; }
        public double? MaxAbsLatAccelG { get; set; }
        public double? AbsLongAccelIntegralGSeconds { get; set; }
        public int? SampleCount { get; set; }
        public double? MaxGapSeconds { get; set; }
        public double? ValidDurationSeconds { get; set; }
        public string[] PitVisitIds { get; set; }
        public string[] WearObservationIds { get; set; }

        /// <summary>
        /// Koppelt een pitbezoek aan deze ronde. Het bezoek-ID is context; de
        /// waargenomen brandstoftoevoer telt maar op één ronde (de ronde waarin de
        /// delta is waargenomen), ook als het bezoek zelf over de finishlijn liep.
        /// </summary>
        public void NotePitVisit(string pitVisitId, double? fuelAddedLitresObserved)
        {
            if (MeasurementIds.IsLocalId(pitVisitId))
            {
                PitLap = true;
                var current = PitVisitIds ?? new string[0];
                var list = new List<string>(current);
                if (!list.Contains(pitVisitId)) list.Add(pitVisitId);
                PitVisitIds = list.ToArray();
            }
            if (fuelAddedLitresObserved.HasValue && fuelAddedLitresObserved.Value > 0)
            {
                PitLap = true;
                FuelAddedLitresObserved = (FuelAddedLitresObserved ?? 0) + fuelAddedLitresObserved.Value;
            }
        }

        /// <summary>Voegt de wear-waarneming van een anker toe aan deze ronde.</summary>
        public void NoteWearObservation(string eventUid)
        {
            if (!MeasurementIds.IsUid(eventUid)) return;
            var current = WearObservationIds ?? new string[0];
            var list = new List<string>(current);
            if (!list.Contains(eventUid)) list.Add(eventUid);
            WearObservationIds = list.ToArray();
        }

        public MeasurementLapSummaryRecord ToSummary(string summaryUid, string summaryId, string observedSessionId)
        {
            return new MeasurementLapSummaryRecord
            {
                SummaryUid = summaryUid,
                SummaryId = summaryId,
                SegmentId = SegmentId,
                ObservedSessionId = observedSessionId,
                LapNumber = LapNumber,
                StartedAtUtc = StartedAtUtc,
                EndedAtUtc = EndedAtUtc,
                CurrentDriverName = DriverName,
                DriverChanged = DriverChanged,
                PitLap = PitLap,
                Complete = Complete,
                InvalidReasons = InvalidReasons,
                TrackTempCMean = TrackTempCMean,
                TrackTempCMin = TrackTempCMin,
                TrackTempCMax = TrackTempCMax,
                AirTempCMean = AirTempCMean,
                FuelStartLitres = FuelStartLitres,
                FuelEndLitres = FuelEndLitres,
                FuelLevelIntegralLitreSeconds = FuelLevelIntegralLitreSeconds,
                FuelAddedLitresObserved = FuelAddedLitresObserved,
                AbsLatAccelIntegralGSeconds = AbsLatAccelIntegralGSeconds,
                LatAccelSquaredIntegralG2Seconds = LatAccelSquaredIntegralG2Seconds,
                MaxAbsLatAccelG = MaxAbsLatAccelG,
                AbsLongAccelIntegralGSeconds = AbsLongAccelIntegralGSeconds,
                Coverage = Coverage,
                SampleCount = SampleCount,
                MaxGapSeconds = MaxGapSeconds,
                ValidDurationSeconds = ValidDurationSeconds,
                PitVisitIds = PitVisitIds,
                WearObservationIds = WearObservationIds
            };
        }
    }
}
