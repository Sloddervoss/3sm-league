using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Instellingen van de sampler. De bovengrens van 20 Hz is een bewuste keuze:
    /// de bron levert 60 Hz, maar een integraal op 60 Hz suggereert een precisie die
    /// de meting niet heeft en kost drie keer zoveel CPU in SimHub's update-thread.
    /// </summary>
    public sealed class SamplerOptions
    {
        public const double DefaultMaxSampleHz = 20.0;

        public double MaxSampleHz = DefaultMaxSampleHz;
        public double MaxIntegrationGapSeconds = CoverageRules.MaxGapSeconds;

        /// <summary>
        /// Een terugwaartse sprong in sessietijd groter dan dit is geen klokruis maar
        /// een reset/replay: de lopende ronde wordt afgebroken in plaats van doorgeteld.
        /// </summary>
        public double SessionTimeBackwardsToleranceSeconds = 5.0;

        /// <summary>Twee monsters met dezelfde sessietijd (zonder tick) zijn hetzelfde monster.</summary>
        public double DuplicateSessionTimeEpsilonSeconds = 0.0005;

        public double MinIntervalSeconds
        {
            get
            {
                var hertz = MaxSampleHz;
                if (double.IsNaN(hertz) || hertz <= 0) hertz = DefaultMaxSampleHz;
                if (hertz > 50) hertz = 50;
                return 1.0 / hertz;
            }
        }

        public LapAccumulatorOptions ToLapOptions()
        {
            return new LapAccumulatorOptions { MaxIntegrationGapSeconds = MaxIntegrationGapSeconds };
        }
    }

    /// <summary>Wat er met één aangeboden tick gebeurde, en waarom.</summary>
    public sealed class SamplerOutcome
    {
        public bool Accepted { get; set; }
        /// <summary>Null als de tick is geaccepteerd; anders een stabiele redencode.</summary>
        public string Reason { get; set; }
        public int CompletedLaps { get; set; }

        public static SamplerOutcome Skip(string reason)
        {
            return new SamplerOutcome { Accepted = false, Reason = reason };
        }
    }

    /// <summary>
    /// De sampler: bepaalt WELKE ticks meetellen, onafhankelijk van HTTP, pairing en
    /// het verzendinterval van het frame.
    ///
    /// Drie regels die hier worden afgedwongen:
    ///   1. Dezelfde SDK-tick telt nooit twee keer. SimHub's DataUpdate kan met
    ///      ongewijzigde ruwe data opnieuw vuren; dat is geen nieuwe meting.
    ///   2. De frequentie is begrensd (standaard 20 Hz). Tussenliggende ticks worden
    ///      overgeslagen, maar het tijdsinterval van de volgende geaccepteerde tick
    ///      blijft het ECHTE interval.
    ///   3. Een gat groter dan de drempel wordt niet geïnterpoleerd: de accumulator
    ///      telt het als dekkingstekort en laat de integraal staan.
    ///
    /// Geen SimHub-referentie en geen netwerk: puur, dus testbaar zonder sim.
    /// </summary>
    public sealed class TelemetrySampler
    {
        /// <summary>Marge op de frequentiebegrenzing; zie de uitleg bij het gebruik.</summary>
        internal const double RateToleranceSeconds = 0.001;

        private readonly SamplerOptions _options;
        private readonly LapAccumulatorOptions _lapOptions;
        private readonly List<LapAggregate> _completed = new List<LapAggregate>();

        private LapAccumulator _current;
        private int? _currentLapNumber;
        private string _segmentId;
        private string _observedSessionId;
        private DateTime? _lastAcceptedUtc;
        private long? _lastAcceptedTick;
        private double? _lastSessionTime;
        private string _lastSkipReason;

        public TelemetrySampler() : this(new SamplerOptions()) { }

        public TelemetrySampler(SamplerOptions options)
        {
            _options = options ?? new SamplerOptions();
            _lapOptions = _options.ToLapOptions();
        }

        public long AcceptedCount { get; private set; }
        public long DuplicateTickCount { get; private set; }
        public long ThrottledCount { get; private set; }
        public long RejectedCount { get; private set; }
        public string LastSkipReason { get { return _lastSkipReason; } }
        public LapAccumulator Current { get { return _current; } }
        public string SegmentId { get { return _segmentId; } }
        public string ObservedSessionId { get { return _observedSessionId; } }

        /// <summary>
        /// Biedt één tick aan. De uitkomst zegt of hij meetelt; de afgeronde rondes
        /// (bij een rondewissel of sessiewissel) staan daarna in <see cref="Drain"/>.
        /// </summary>
        public SamplerOutcome Offer(TelemetrySample sample)
        {
            if (sample == null) return Reject("sample_null");
            if (sample.ObservedAtUtc == default(DateTime)) return Reject("observed_at_missing");
            var at = sample.ObservedAtUtc;
            if (at.Kind != DateTimeKind.Utc) at = at.ToUniversalTime();
            sample.ObservedAtUtc = at;

            if (IsDuplicate(sample))
            {
                DuplicateTickCount++;
                Skipped("duplicate_tick");
                return SamplerOutcome.Skip("duplicate_tick");
            }

            if (_lastAcceptedUtc.HasValue)
            {
                var since = (at - _lastAcceptedUtc.Value).TotalSeconds;
                // 1 ms marge: DateTime heeft 100 ns-resolutie, dus twee ticks die "precies"
                // 50 ms uit elkaar liggen verschillen in de praktijk een paar µs. Zonder deze
                // marge zou de begrenzing af en toe een geldige tick alsnog weggooien.
                if (since >= 0 && since < _options.MinIntervalSeconds - RateToleranceSeconds)
                {
                    ThrottledCount++;
                    Skipped("rate_limited");
                    return SamplerOutcome.Skip("rate_limited");
                }
            }

            var completedBefore = _completed.Count;

            // Sessie- of segmentwissel: de lopende ronde is niet af te maken.
            if (_current != null)
            {
                if (SessionChanged(sample))
                {
                    CloseCurrent(_lastAcceptedUtc ?? _current.StartedAtUtc, new[] { "session_changed" });
                }
                else if (SessionTimeWentBackwards(sample))
                {
                    CloseCurrent(_lastAcceptedUtc ?? _current.StartedAtUtc, new[] { "session_time_reset" });
                }
                else if (LapChanged(sample, out var gap))
                {
                    var reasons = gap ? new[] { "lap_boundary_gap" } : null;
                    CloseCurrent(at, reasons);
                }
            }

            if (_current == null) StartLap(sample);

            _current.Add(sample);
            _segmentId = sample.SegmentId ?? _segmentId;
            _observedSessionId = sample.ObservedSessionId ?? _observedSessionId;
            _lastAcceptedUtc = at;
            _lastAcceptedTick = sample.SdkTick;
            _lastSessionTime = sample.SessionTimeSeconds ?? _lastSessionTime;
            _currentLapNumber = sample.LapNumber ?? _currentLapNumber;
            AcceptedCount++;
            _lastSkipReason = null;

            return new SamplerOutcome
            {
                Accepted = true,
                Reason = null,
                CompletedLaps = _completed.Count - completedBefore
            };
        }

        /// <summary>De afgeronde rondes sinds de vorige keer; de lijst wordt geleegd.</summary>
        public IList<LapAggregate> Drain()
        {
            if (_completed.Count == 0) return new LapAggregate[0];
            var copy = _completed.ToArray();
            _completed.Clear();
            return copy;
        }

        /// <summary>
        /// Sluit de lopende ronde met een reden (sessie-einde, plugin-shutdown). De reden
        /// komt in <c>invalidReasons</c> en de ronde wordt nooit "compleet" verklaard.
        /// </summary>
        public IList<LapAggregate> Close(string reason)
        {
            if (_current == null) return new LapAggregate[0];
            var code = string.IsNullOrEmpty(reason) ? "lap_closed" : reason;
            CloseCurrent(_lastAcceptedUtc ?? _current.StartedAtUtc, new[] { code });
            return Drain();
        }

        /// <summary>Gooit de lopende ronde weg zonder hem te publiceren (bijv. bij een full reset).</summary>
        public void Reset()
        {
            _current = null;
            _currentLapNumber = null;
            _segmentId = null;
            _observedSessionId = null;
            _lastAcceptedUtc = null;
            _lastAcceptedTick = null;
            _lastSessionTime = null;
            _completed.Clear();
        }

        /// <summary>Nieuwe sessie: de teller voor de dekking begint opnieuw.</summary>
        public void BeginSession(string segmentId, string observedSessionId)
        {
            Reset();
            _segmentId = segmentId;
            _observedSessionId = observedSessionId;
        }

        private bool IsDuplicate(TelemetrySample sample)
        {
            if (sample.SdkTick.HasValue && _lastAcceptedTick.HasValue && sample.SdkTick.Value == _lastAcceptedTick.Value)
                return true;
            if (!sample.SdkTick.HasValue && !_lastAcceptedTick.HasValue
                && sample.SessionTimeSeconds.HasValue && _lastSessionTime.HasValue
                && Math.Abs(sample.SessionTimeSeconds.Value - _lastSessionTime.Value) <= _options.DuplicateSessionTimeEpsilonSeconds)
            {
                return true;
            }
            return false;
        }

        private bool SessionChanged(TelemetrySample sample)
        {
            if (!string.IsNullOrEmpty(sample.SegmentId) && !string.IsNullOrEmpty(_segmentId)
                && !string.Equals(sample.SegmentId, _segmentId, StringComparison.Ordinal)) return true;
            if (!string.IsNullOrEmpty(sample.ObservedSessionId) && !string.IsNullOrEmpty(_observedSessionId)
                && !string.Equals(sample.ObservedSessionId, _observedSessionId, StringComparison.Ordinal)) return true;
            return false;
        }

        private bool SessionTimeWentBackwards(TelemetrySample sample)
        {
            if (!sample.SessionTimeSeconds.HasValue || !_lastSessionTime.HasValue) return false;
            return sample.SessionTimeSeconds.Value < _lastSessionTime.Value - _options.SessionTimeBackwardsToleranceSeconds;
        }

        private bool LapChanged(TelemetrySample sample, out bool gap)
        {
            gap = false;
            if (!sample.LapNumber.HasValue || !_currentLapNumber.HasValue) return false;
            if (sample.LapNumber.Value == _currentLapNumber.Value) return false;
            gap = sample.LapNumber.Value > _currentLapNumber.Value + 1;
            return true;
        }

        private void StartLap(TelemetrySample sample)
        {
            _currentLapNumber = sample.LapNumber ?? 0;
            _current = new LapAccumulator(_currentLapNumber.Value, sample.ObservedAtUtc,
                sample.SegmentId ?? _segmentId, sample.CurrentDriverName, _lapOptions);
            if (!string.IsNullOrEmpty(sample.SegmentId)) _segmentId = sample.SegmentId;
            if (!string.IsNullOrEmpty(sample.ObservedSessionId)) _observedSessionId = sample.ObservedSessionId;
        }

        private void CloseCurrent(DateTime endedAtUtc, string[] reasons)
        {
            if (_current == null) return;
            // Een ronde zonder één meetbare tick is geen aggregaat maar een leegte.
            if (_current.HasSamples) _completed.Add(_current.Close(endedAtUtc, reasons));
            _current = null;
        }

        private SamplerOutcome Reject(string reason)
        {
            RejectedCount++;
            Skipped(reason);
            return SamplerOutcome.Skip(reason);
        }

        private void Skipped(string reason)
        {
            _lastSkipReason = reason;
        }
    }
}
