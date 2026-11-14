using System;
using System.Globalization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Lokale codes die alleen de aansluitlaag gebruikt. De geaccepteerde
    /// observation-core kent ze niet en wordt hier niet gewijzigd.
    /// </summary>
    public static class ObservationSamplingCodes
    {
        public const string BindingChanged = "observation_capture_binding_changed";
        public const string TimestampNotUtc = "observation_capture_timestamp_not_utc";
    }

    /// <summary>
    /// Vergelijkt de capture-time identiteitsfence. Alleen device/owner/generatie
    /// doen mee; car, sessie en segment zijn beschrijvende context en kunnen nooit
    /// een gezonde oude ronde ongeldig maken.
    /// </summary>
    public static class ObservationBindingRules
    {
        /// <summary>
        /// UUID's zijn case-insensitive nadat beide tokens streng als UUID zijn
        /// gevalideerd. Het oorspronkelijke wire-token wordt nooit genormaliseerd.
        /// </summary>
        public static bool SamePairing(ObservationPairingBinding left, ObservationPairingBinding right)
        {
            if (left == null || right == null) return false;
            if (!left.IsComplete || !right.IsComplete) return false;
            if (left.PairingGeneration != right.PairingGeneration) return false;
            return string.Equals(left.CaptureDeviceId, right.CaptureDeviceId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(left.CaptureOwnerUserId, right.CaptureOwnerUserId, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Canonieke, ondubbelzinnige contextidentiteit voor de fuelstapketen.
    /// Elk veld wordt lengte-geprefixeerd, zodat geen delimiter- of
    /// samenvoegbotsing ontstaat. Null betekent onbekend en ketent niet.
    /// </summary>
    public static class ObservationContextKey
    {
        public static string Build(ObservationLapContext frozen, ObservationLapContext current,
            string observedSessionId, string segmentId)
        {
            // Zonder een bij StartLap bevroren context is er geen identiteit om
            // op te bouwen. Een latere context mag die leemte niet vullen.
            if (frozen == null || current == null) return null;
            if (string.IsNullOrEmpty(observedSessionId) || string.IsNullOrEmpty(segmentId)) return null;
            if (!ObservationRules.IsText(frozen.CarId, ObservationContract.MaxCarIdBytes)) return null;
            if (!ObservationRules.IsText(current.CarId, ObservationContract.MaxCarIdBytes)) return null;

            var builder = new StringBuilder(192);
            Append(builder, "car", current.CarId);
            Append(builder, "session", observedSessionId);
            Append(builder, "segment", segmentId);
            // De sterke numerieke SDK-sessievelden horen bij de ketencontinuïteit.
            // Ze zijn geen pairingfence en veranderen de bevroren StartLap-context
            // of het observationresultaat niet; alleen de fuelstapketen breekt.
            AppendOptional(builder, "sessionUniqueId", current.SessionUniqueId.HasValue
                ? current.SessionUniqueId.Value.ToString(CultureInfo.InvariantCulture)
                : null);
            AppendOptional(builder, "sessionNumber", current.SessionNumber.HasValue
                ? current.SessionNumber.Value.ToString(CultureInfo.InvariantCulture)
                : null);
            AppendOptional(builder, "trackId", current.TrackId.HasValue
                ? current.TrackId.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)
                : null);
            AppendOptional(builder, "trackConfig", current.TrackConfig);
            return builder.ToString();
        }

        private static void Append(StringBuilder builder, string name, string value)
        {
            builder.Append(name).Append('=').Append(value.Length).Append(':').Append(value).Append(';');
        }

        private static void AppendOptional(StringBuilder builder, string name, string value)
        {
            if (value == null)
            {
                builder.Append(name).Append("=null;");
                return;
            }
            Append(builder, name, value);
        }
    }

    /// <summary>
    /// De lokale brug tussen de echte sampler/accumulator en de geaccepteerde
    /// pure observation-core. Deze klasse bezit alleen de StartLap-snapshots en
    /// de fencebeslissing; alle wiskunde blijft in <see cref="ObservationCapture"/>.
    /// </summary>
    internal sealed class ObservationLapCapture
    {
        private readonly bool _enabled;
        private readonly ObservationPairingBinding _binding;
        private readonly ObservationLapContext _context;
        private readonly string _observedSessionId;
        private readonly string _segmentId;
        private readonly ObservationCapture _capture;
        private readonly string _startRefusal;
        private bool _bindingChanged;
        private bool _timestampNotUtc;

        public ObservationLapCapture(bool enabled, ObservationPairingBinding binding,
            ObservationLapContext context, string observedSessionId, string segmentId)
        {
            _enabled = enabled;
            _binding = binding;
            _context = context;
            _observedSessionId = observedSessionId;
            _segmentId = segmentId;
            if (!enabled) return;
            if (binding == null || !binding.IsComplete)
            {
                // Een onvolledige binding bij StartLap is definitief voor deze
                // ronde: er wordt niet later alsnog een observation gestart.
                _startRefusal = ObservationCaptureCodes.PairingIncomplete;
                return;
            }
            _capture = new ObservationCapture(binding, context);
        }

        public bool Enabled { get { return _enabled; } }
        public ObservationPairingBinding PairingBinding { get { return _binding; } }
        public ObservationLapContext LapContext { get { return _context; } }

        /// <summary>
        /// Wordt voor ELKE aangeboden tick aangeroepen, ook als die tick duplicate
        /// of rate-limited is. Zo kan een pairingwissel niet aan de fence ontsnappen
        /// zonder één geaccepteerd punt of één verzonnen feit toe te voegen.
        /// </summary>
        public void ObservePairing(ObservationPairingBinding current)
        {
            if (!_enabled || _bindingChanged) return;
            if (!ObservationBindingRules.SamePairing(_binding, current)) _bindingChanged = true;
        }

        public void AddAccepted(TelemetrySample sample, bool timestampUtcKnown)
        {
            if (_capture == null) return;
            if (!timestampUtcKnown)
            {
                // De legacy-sampler heeft de tijd al genormaliseerd. Die
                // normalisatie mag nooit als bewezen UTC-feit doorgaan.
                _timestampNotUtc = true;
                return;
            }
            var key = ObservationContextKey.Build(_context, sample.ObservationLapContext,
                _observedSessionId, _segmentId);
            _capture.AddSample(new ObservationSample(sample.ObservedAtUtc, sample.OnPitRoad,
                sample.FuelLitres, sample.CurrentDriverName, key,
                sample.CurrentDriverId, sample.ObservationSchemaVersion, sample.ResetOrTow,
                sample.ResetSourceTime, sample.ResetSourceLap, sample.SdkTick));
        }

        public ObservationCaptureResult Close(DateTime startedAtUtc, DateTime endedAtUtc, string[] reasons)
        {
            if (!_enabled) return null;
            if (_startRefusal != null)
            {
                return ObservationCaptureResult.Refused(_startRefusal,
                    "StartLap-binding ontbreekt of is onvolledig", null);
            }
            if (_bindingChanged)
            {
                return ObservationCaptureResult.Refused(ObservationSamplingCodes.BindingChanged,
                    "pairingbinding is sinds StartLap gewijzigd", null);
            }
            if (_timestampNotUtc)
            {
                return ObservationCaptureResult.Refused(ObservationSamplingCodes.TimestampNotUtc,
                    "een geaccepteerd punt had geen oorspronkelijk UTC-tijd", null);
            }
            var discontinuity = false;
            if (reasons != null)
                foreach (var reason in reasons)
                    if (reason == "session_time_reset" || reason == "lap_counter_reset"
                        || reason == "lap_boundary_gap" || reason == "session_changed") discontinuity = true;
            return _capture.Build(startedAtUtc, endedAtUtc, discontinuity);
        }
    }
}
