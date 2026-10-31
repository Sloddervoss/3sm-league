using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// De bits van iRacing's <c>PitSvFlags</c>. Ze staan hier bij elkaar omdat een
    /// verkeerd bit een verkeerde intentie oplevert: "de rijder wilde vier banden"
    /// is iets anders dan "er zijn vier banden gewisseld".
    /// </summary>
    public static class PitServiceFlags
    {
        public const int FrontLeftTyre = 0x01;
        public const int FrontRightTyre = 0x02;
        public const int RearLeftTyre = 0x04;
        public const int RearRightTyre = 0x08;
        public const int FuelFill = 0x10;
        public const int WindshieldTearoff = 0x20;
        public const int FastRepair = 0x40;

        public static readonly int[] TyreBits = { FrontLeftTyre, FrontRightTyre, RearLeftTyre, RearRightTyre };

        /// <summary>Gevraagde bandenwissel per hoek, in de volgorde [FL, FR, RL, RR].</summary>
        public static bool[] RequestedTyres(int? raw)
        {
            var requested = new bool[4];
            if (!raw.HasValue) return requested;
            for (var corner = 0; corner < 4; corner++)
                requested[corner] = (raw.Value & TyreBits[corner]) != 0;
            return requested;
        }

        public static bool FuelRequested(int? raw)
        {
            return raw.HasValue && (raw.Value & FuelFill) != 0;
        }

        public static bool AnyTyreRequested(int? raw)
        {
            if (!raw.HasValue) return false;
            return (raw.Value & (FrontLeftTyre | FrontRightTyre | RearLeftTyre | RearRightTyre)) != 0;
        }

        public static bool WindshieldRequested(int? raw)
        {
            return raw.HasValue && (raw.Value & WindshieldTearoff) != 0;
        }

        public static bool FastRepairRequested(int? raw)
        {
            return raw.HasValue && (raw.Value & FastRepair) != 0;
        }
    }

    /// <summary>
    /// Wat de rijder (of het team) vroeg. Dit is een intentie: een aangevinkte
    /// bandenwissel is geen uitgevoerde bandenwissel en een gevraagde liters zijn
    /// geen geleverde liters.
    /// </summary>
    public sealed class PitIntent
    {
        public int? PitServiceFlagsRaw { get; set; }
        public double? RequestedFuelLitres { get; set; }
        /// <summary>Per hoek [FL, FR, RL, RR]; null = geen enkel verzoek gezien.</summary>
        public bool[] RequestedTyres { get; set; }
        public bool FuelRequested { get; set; }
        public bool AnyTyreRequested { get; set; }
        public bool WindshieldTearoff { get; set; }
        public bool FastRepair { get; set; }

        public string[] RequestedTyreNames()
        {
            if (RequestedTyres == null) return null;
            var names = new List<string>(4);
            var names4 = new[] { "fl", "fr", "rl", "rr" };
            for (var corner = 0; corner < 4 && corner < RequestedTyres.Length; corner++)
                if (RequestedTyres[corner]) names.Add(names4[corner]);
            return names.Count == 0 ? null : names.ToArray();
        }
    }

    /// <summary>
    /// Wat er feitelijk is waargenomen. Brandstof is een gemeten niveauverschil,
    /// geen liters uit een verzoek en geen schatting uit een verbruiksmodel.
    /// </summary>
    public sealed class PitResult
    {
        public double? FuelBeforeLitres { get; set; }
        public double? FuelAfterLitres { get; set; }
        /// <summary>Waargenomen toename; 0 = wel gemeten en niets bijgetankt.</summary>
        public double? FuelAddedLitresObserved { get; set; }
        public bool? InPitStall { get; set; }
        public bool? ServiceFlagsSeen { get; set; }
    }

    /// <summary>
    /// Eén pitbezoek. <see cref="PitVisitId"/> is context (het verbindt waarnemingen),
    /// geen identiteit: het contract zegt expliciet dat twee waarnemingen in hetzelfde
    /// bezoek twee rijen zijn.
    /// </summary>
    public sealed class PitVisit
    {
        public string PitVisitId { get; set; }
        public string SegmentId { get; set; }
        public int? EnterLap { get; set; }
        public int? ExitLap { get; set; }
        public DateTime EnteredAtUtc { get; set; }
        public DateTime? ExitedAtUtc { get; set; }
        public double? EnterSessionTimeSeconds { get; set; }
        public double? ExitSessionTimeSeconds { get; set; }
        public long? EnterSdkTick { get; set; }
        public long? ExitSdkTick { get; set; }
        public PitIntent Intent { get; set; }
        public PitResult Result { get; set; }
        public List<string> Problems { get; private set; }

        public PitVisit()
        {
            Intent = new PitIntent();
            Result = new PitResult();
            Problems = new List<string>();
        }

        public bool Completed { get { return ExitedAtUtc.HasValue; } }

        /// <summary>Heeft dit bezoek de finishlijn gekruist?</summary>
        public bool CrossedLapBoundary
        {
            get { return EnterLap.HasValue && ExitLap.HasValue && EnterLap.Value != ExitLap.Value; }
        }
    }

    /// <summary>
    /// Volgt pitbezoeken op basis van de RUWE SDK <c>OnPitRoad</c>.
    ///
    /// Waarom ruw eerst: de plugin gebruikte op sommige plekken een SimHub-property met
    /// <c>false</c> als terugval. Dan is "niet op de pitstraat" niet te onderscheiden
    /// van "de property ontbreekt", en verdwijnt een bezoek zonder spoor. Hier is
    /// <c>null</c> gewoon onbekend en verandert er niets.
    ///
    /// Intentie en resultaat staan los: de aanvraag (flags, liters) wordt vastgelegd
    /// zoals hij binnenkwam, het resultaat (niveauverschil, pitstall) wordt apart
    /// waargenomen en kan leeg blijven.
    /// </summary>
    public sealed class PitServiceTracker
    {
        /// <summary>Onder deze marge is een niveauverschil geen tanking maar ruis.</summary>
        public const double FuelDeltaToleranceLitres = 0.01;

        private readonly List<PitVisit> _completed = new List<PitVisit>();
        private readonly string _segmentToken;
        private PitVisit _current;
        private int _visitCounter;
        private bool _onPitRoad;
        private string _segmentId;
        private TelemetrySample _lastSample;

        public PitServiceTracker(string segmentToken)
        {
            _segmentToken = MeasurementIds.SanitizeLocalId(segmentToken, "seg");
        }

        public PitVisit Current { get { return _current; } }
        public int VisitCount { get { return _visitCounter; } }

        /// <summary>Eén tick. De flank van de ruwe <c>OnPitRoad</c> opent en sluit een bezoek.</summary>
        public void Update(TelemetrySample sample)
        {
            if (sample == null || sample.ObservedAtUtc == default(DateTime)) return;
            _lastSample = sample;

            if (DifferentSession(sample))
            {
                CloseCurrent(_lastSample.ObservedAtUtc, "session_changed");
                _segmentId = sample.SegmentId;
            }

            if (!sample.OnPitRoad.HasValue) return;
            var onPitRoad = sample.OnPitRoad.Value;

            if (onPitRoad && !_onPitRoad) Open(sample);
            else if (!onPitRoad && _onPitRoad)
            {
                // De tick waarin de auto de pitstraat verlaat hoort nog bij het bezoek:
                // daar staan de uitgangsronde, het uittijdstip en de laatste brandstof in.
                Observe(sample);
                CloseCurrent(sample.ObservedAtUtc, null);
            }
            _onPitRoad = onPitRoad;

            if (_current != null) Observe(sample);
        }

        /// <summary>De afgeronde bezoeken; de lijst wordt geleegd.</summary>
        public IList<PitVisit> DrainCompleted()
        {
            if (_completed.Count == 0) return new PitVisit[0];
            var copy = _completed.ToArray();
            _completed.Clear();
            return copy;
        }

        /// <summary>Sluit een open bezoek bij sessie-einde of plugin-shutdown.</summary>
        public IList<PitVisit> Close(string reason)
        {
            if (_current != null) CloseCurrent(_lastSample == null ? DateTime.UtcNow : _lastSample.ObservedAtUtc, reason);
            return DrainCompleted();
        }

        public void Reset()
        {
            _current = null;
            _completed.Clear();
            _onPitRoad = false;
            _lastSample = null;
            _segmentId = null;
        }

        private bool DifferentSession(TelemetrySample sample)
        {
            if (_current == null) return false;
            if (!string.IsNullOrEmpty(sample.SegmentId) && !string.IsNullOrEmpty(_segmentId)
                && !string.Equals(sample.SegmentId, _segmentId, StringComparison.Ordinal)) return true;
            return false;
        }

        private void Open(TelemetrySample sample)
        {
            _visitCounter++;
            _segmentId = sample.SegmentId;
            var visit = new PitVisit
            {
                PitVisitId = "pit-" + _segmentToken + "-" + _visitCounter,
                SegmentId = MeasurementIds.IsLocalId(sample.SegmentId) ? sample.SegmentId : _segmentId,
                EnterLap = sample.LapNumber,
                EnteredAtUtc = sample.ObservedAtUtc,
                EnterSessionTimeSeconds = sample.SessionTimeSeconds,
                EnterSdkTick = sample.SdkTick
            };
            visit.Result.FuelBeforeLitres = sample.FuelLitres;
            _current = visit;
            Observe(sample);
        }

        private void Observe(TelemetrySample sample)
        {
            var visit = _current;
            if (visit == null) return;

            if (sample.PitServiceFlagsRaw.HasValue)
            {
                var raw = sample.PitServiceFlagsRaw;
                visit.Intent.PitServiceFlagsRaw = raw;
                visit.Intent.RequestedTyres = PitServiceFlags.RequestedTyres(raw);
                visit.Intent.FuelRequested = PitServiceFlags.FuelRequested(raw);
                visit.Intent.AnyTyreRequested = PitServiceFlags.AnyTyreRequested(raw);
                visit.Intent.WindshieldTearoff = PitServiceFlags.WindshieldRequested(raw);
                visit.Intent.FastRepair = PitServiceFlags.FastRepairRequested(raw);
                visit.Result.ServiceFlagsSeen = true;
            }
            if (sample.RequestedFuelLitres.HasValue)
            {
                var requested = sample.RequestedFuelLitres.Value;
                if (!double.IsNaN(requested) && !double.IsInfinity(requested) && requested >= 0 && requested <= 300)
                    visit.Intent.RequestedFuelLitres = requested;
            }
            if (sample.InPitStall.HasValue)
            {
                visit.Result.InPitStall = sample.InPitStall.Value || visit.Result.InPitStall == true;
            }
            if (sample.FuelLitres.HasValue && !double.IsNaN(sample.FuelLitres.Value) && !double.IsInfinity(sample.FuelLitres.Value))
            {
                visit.Result.FuelAfterLitres = sample.FuelLitres.Value;
            }
            if (sample.LapNumber.HasValue) visit.ExitLap = sample.LapNumber;
            visit.ExitSessionTimeSeconds = sample.SessionTimeSeconds ?? visit.ExitSessionTimeSeconds;
            visit.ExitSdkTick = sample.SdkTick ?? visit.ExitSdkTick;
        }

        private void CloseCurrent(DateTime atUtc, string reason)
        {
            var visit = _current;
            if (visit == null) return;
            visit.ExitedAtUtc = atUtc < visit.EnteredAtUtc ? visit.EnteredAtUtc : atUtc;
            if (!string.IsNullOrEmpty(reason)) visit.Problems.Add(reason);
            ComputeFuelDelta(visit);
            if (visit.ExitLap.HasValue && visit.EnterLap.HasValue && visit.ExitLap.Value < visit.EnterLap.Value)
                visit.Problems.Add("lap_number_reset_in_visit");
            _completed.Add(visit);
            _current = null;
        }

        private static void ComputeFuelDelta(PitVisit visit)
        {
            var before = visit.Result.FuelBeforeLitres;
            var after = visit.Result.FuelAfterLitres;
            if (!before.HasValue || !after.HasValue)
            {
                // Geen twee waarnemingen = geen delta. Niet 0, want 0 is een meting.
                visit.Result.FuelAddedLitresObserved = null;
                visit.Problems.Add("fuel_delta_unobserved");
                return;
            }
            var delta = after.Value - before.Value;
            if (delta < -FuelDeltaToleranceLitres)
            {
                // Niveau daalde tijdens het bezoek: dan is "after" niet het resultaat
                // van tanken (bijv. een verbruiksmeter of een sessiewissel).
                visit.Result.FuelAddedLitresObserved = null;
                visit.Problems.Add("fuel_decreased_on_pit_road");
                return;
            }
            visit.Result.FuelAddedLitresObserved = delta <= FuelDeltaToleranceLitres
                ? 0.0
                : Math.Round(delta, 3, MidpointRounding.AwayFromZero);
        }
    }
}
