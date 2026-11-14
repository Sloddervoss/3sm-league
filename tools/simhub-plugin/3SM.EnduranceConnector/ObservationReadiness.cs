using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Bounded local reason codes for the memory-only readiness cache. These are
    /// local categories; they are never wire values and never carry payload,
    /// token or IO text.
    /// </summary>
    public static class ObservationReadinessReasons
    {
        public const string Ready = "ready";
        public const string NotObserved = "not_observed";
        public const string IdentityChanged = "identity_changed";
        public const string HostStopped = "host_stopped";
        public const string ResponseEmpty = "response_empty";
        public const string ResponseTooLarge = "response_too_large";
        public const string ResponseMalformed = "response_malformed";
        public const string ObservationAbsent = "observation_absent";
        public const string ReceiverDisabled = "receiver_disabled";
        public const string ReceiverModeOff = "receiver_mode_off";
        public const string ReceiverUnavailable = "receiver_unavailable";
        public const string PolicyAbsent = "policy_absent";
        public const string PolicyDenied = "policy_denied";
        public const string PolicyVersionUnsupported = "policy_version_unsupported";
        public const string RequestUntrusted = "request_untrusted";
        public const string RequestNotSent = "request_not_sent";
        public const string HttpNonSuccess = "http_non_success";
        public const string TransportFailure = "transport_failure";
        public const string ClockInvalid = "clock_invalid";
        public const string ClockBackwards = "clock_backwards";
        public const string Expired = "expired";
    }

    /// <summary>
    /// Alleen-lezen antwoordvorm die de geaccepteerde Edge V3-202 al heeft:
    /// <c>observation:{enabled,mode,available}</c>. Dit is receiver-ability,
    /// geen accounttoestemming. De optionele <c>policy</c>-substructuur is een
    /// identity-scoped serverfeit uit het bestaande authenticated ingest-resultaat.
    /// De optionele identity-metadata bevestigt alleen de same-request snapshot.
    /// </summary>
    public static class ObservationReadinessReader
    {
        /// <summary>Bovengrens op het antwoord dat deze lezer bekijkt.</summary>
        public const int MaxResponseCharacters = 16384;

        /// <summary>De enige ondersteunde policy-versie in dit lokale ontwerp.</summary>
        public const long SupportedPolicyVersion = 1;

        public static bool AllowsProspectiveUpgrade(string json, ObservationPairingBinding binding)
        {
            long version; string reason;
            if (binding == null || !TryRead(json, out version, out reason)) return false;
            try
            {
                var root = MeasurementJson.DeserializeDictionary(json);
                object accepted;
                if (!root.TryGetValue("accepted", out accepted) || !(accepted is bool) || !(bool)accepted) return false;
                var observation = root["observation"] as Dictionary<string, object>;
                object raw;
                if (!observation.TryGetValue("identity", out raw)) return false;
                var identity = raw as Dictionary<string, object>;
                return identity != null && identity.ContainsKey("deviceId") && identity.ContainsKey("ownerUserId")
                    && string.Equals(identity["deviceId"] as string, binding.CaptureDeviceId, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(identity["ownerUserId"] as string, binding.CaptureOwnerUserId, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception) { return false; }
        }

        public static bool SupportsV2(string json)
        {
            long version; string reason;
            if (!TryRead(json, out version, out reason)) return false;
            try
            {
                var observation = MeasurementJson.DeserializeDictionary(json)["observation"] as Dictionary<string, object>;
                object raw;
                if (!observation.TryGetValue("observationSchemas", out raw)) return false;
                var schemas = raw as List<object>;
                if (schemas == null) return false;
                foreach (var schema in schemas) if (schema is double && (double)schema == 2) return true;
            }
            catch (Exception) { }
            return false;
        }

        public static bool TryRead(string json, out long policyVersion, out string reasonCode)
        {
            policyVersion = 0;
            if (string.IsNullOrWhiteSpace(json))
            {
                reasonCode = ObservationReadinessReasons.ResponseEmpty;
                return false;
            }
            // Bound BEFORE parsing: an oversized answer is not a readiness fact.
            if (json.Length > MaxResponseCharacters)
            {
                reasonCode = ObservationReadinessReasons.ResponseTooLarge;
                return false;
            }

            Dictionary<string, object> root;
            try { root = MeasurementJson.DeserializeDictionary(json); }
            catch (Exception)
            {
                reasonCode = ObservationReadinessReasons.ResponseMalformed;
                return false;
            }

            object observationValue;
            if (!root.TryGetValue("observation", out observationValue))
            {
                reasonCode = ObservationReadinessReasons.ObservationAbsent;
                return false;
            }
            var observation = observationValue as Dictionary<string, object>;
            if (observation == null)
            {
                reasonCode = ObservationReadinessReasons.ObservationAbsent;
                return false;
            }

            bool enabled;
            if (!StrictBool(observation, "enabled", out enabled) || !enabled)
            {
                reasonCode = ObservationReadinessReasons.ReceiverDisabled;
                return false;
            }

            object modeValue;
            if (!observation.TryGetValue("mode", out modeValue)
                || !(modeValue is string)
                || !string.Equals((string)modeValue, "on", StringComparison.Ordinal))
            {
                reasonCode = ObservationReadinessReasons.ReceiverModeOff;
                return false;
            }

            bool available;
            if (!StrictBool(observation, "available", out available) || !available)
            {
                reasonCode = ObservationReadinessReasons.ReceiverUnavailable;
                return false;
            }

            // The existing three-field answer ends here and can never arm.
            object policyValue;
            if (!observation.TryGetValue("policy", out policyValue) || policyValue == null)
            {
                reasonCode = ObservationReadinessReasons.PolicyAbsent;
                return false;
            }
            var policy = policyValue as Dictionary<string, object>;
            if (policy == null)
            {
                reasonCode = ObservationReadinessReasons.PolicyAbsent;
                return false;
            }

            bool captureAllowed;
            if (!StrictBool(policy, "captureAllowed", out captureAllowed) || !captureAllowed)
            {
                reasonCode = ObservationReadinessReasons.PolicyDenied;
                return false;
            }

            object versionValue;
            long version;
            if (!policy.TryGetValue("policyVersion", out versionValue)
                || !IntegralVersion(versionValue, out version)
                || version != SupportedPolicyVersion)
            {
                reasonCode = ObservationReadinessReasons.PolicyVersionUnsupported;
                return false;
            }

            policyVersion = version;
            reasonCode = ObservationReadinessReasons.Ready;
            return true;
        }

        private static bool StrictBool(Dictionary<string, object> source, string key, out bool value)
        {
            value = false;
            object raw;
            if (!source.TryGetValue(key, out raw) || !(raw is bool)) return false;
            value = (bool)raw;
            return true;
        }

        /// <summary>Alleen een exacte integere JSON-number; strings en breuken tellen niet.</summary>
        private static bool IntegralVersion(object raw, out long value)
        {
            value = 0;
            if (!(raw is double)) return false;
            var number = (double)raw;
            if (double.IsNaN(number) || double.IsInfinity(number)) return false;
            if (Math.Floor(number) != number) return false;
            if (number < long.MinValue || number > long.MaxValue) return false;
            value = (long)number;
            return true;
        }
    }

    /// <summary>
    /// Eén bevroren aanvraagstempel: epoch (host-lifetime), monotonische
    /// aanvraagvolgorde, de bij die aanvraag werkelijk vastgelegde identiteit en
    /// of die identiteit geautoriseerd was. Een antwoord wordt nooit aan de dan
    /// geldende identiteit gekoppeld.
    /// </summary>
    public sealed class ObservationReadinessRequest
    {
        internal ObservationReadinessRequest(long epoch, long sequence,
            ObservationPairingBinding binding, bool authorized)
        {
            Epoch = epoch;
            Sequence = sequence;
            Binding = binding;
            Authorized = authorized;
        }

        internal long Epoch { get; private set; }
        internal long Sequence { get; private set; }
        internal ObservationPairingBinding Binding { get; private set; }
        internal bool Authorized { get; private set; }

        internal bool Trusted
        {
            get { return Authorized && Binding != null
                && ObservationRules.IsUuid(Binding.CaptureDeviceId)
                && ObservationRules.IsUuid(Binding.CaptureOwnerUserId); }
        }
    }

    /// <summary>Onveranderlijke momentopname van de laatst gepubliceerde toestand.</summary>
    public sealed class ObservationReadinessState
    {
        internal ObservationReadinessState(bool ready, string reasonCode, long acquiredAtMilliseconds,
            ObservationPairingBinding binding, bool schemaV2 = false)
        {
            Ready = ready;
            SchemaV2 = schemaV2;
            ReasonCode = reasonCode;
            AcquiredAtMilliseconds = acquiredAtMilliseconds;
            Binding = binding;
        }

        public bool Ready { get; private set; }
        public bool SchemaV2 { get; private set; }
        public string ReasonCode { get; private set; }
        public long AcquiredAtMilliseconds { get; private set; }
        internal ObservationPairingBinding Binding { get; private set; }
    }

    /// <summary>
    /// Memory-only readiness-cache. Geen disk, geen netwerk, geen extra POST.
    /// De lokale monotone klok wordt geïnjecteerd; TTL, de optionele
    /// policy-substructuur en de versie-eis horen bij het ingest readiness-contract.
    ///
    /// Publicatie is atomair en alleen geldig voor de nieuwste aanvraag in
    /// dezelfde host-lifetime en voor exact de huidige identiteit. Een oudere,
    /// late of oude-binding-respons kan een nieuwere geldige toestand niet
    /// herstellen en niet wissen.
    /// </summary>
    public sealed class ObservationReadinessCache
    {
        /// <summary>Lokale DRAFT-TTL in milliseconden; leeftijd is geldig in [0, TTL).</summary>
        public const long TtlMilliseconds = 60000;

        private readonly object _gate = new object();
        private readonly Func<long> _clock;
        private long _epoch;
        private long _sequence;
        private long _latestRequest;
        private ObservationReadinessState _published;
        private ObservationPairingBinding _current;
        private bool _currentAuthorized;

        public ObservationReadinessCache(Func<long> clock)
        {
            if (clock == null) throw new ArgumentNullException("clock");
            _clock = clock;
            _published = Denied(ObservationReadinessReasons.NotObserved, 0, null);
        }

        /// <summary>De host levert zijn actuele identiteit; elke wijziging vervalt de oude toestand.</summary>
        public void SetCurrentIdentity(ObservationPairingBinding binding, bool authorized, string reasonCode)
        {
            lock (_gate)
            {
                _epoch++;
                _sequence++;
                _latestRequest = _sequence;
                _current = binding;
                _currentAuthorized = authorized;
                _published = Denied(reasonCode ?? ObservationReadinessReasons.IdentityChanged, 0, binding);
            }
        }

        /// <summary>Stop/End: vervalt de lifetime zodat late callbacks niets publiceren.</summary>
        public void InvalidateLifetime(string reasonCode)
        {
            lock (_gate)
            {
                _epoch++;
                _sequence++;
                _latestRequest = _sequence;
                _current = null;
                _currentAuthorized = false;
                _published = Denied(reasonCode ?? ObservationReadinessReasons.HostStopped, 0, null);
            }
        }

        public ObservationReadinessRequest BeginRequest(ObservationProducerIdentity identity)
        {
            if (identity == null) return BeginRequest(null, false);
            return BeginRequest(identity.Binding, identity.HasAuthorization);
        }

        /// <summary>Legt vóór de HTTP-aanroep de identiteit van DEZE aanvraag vast.</summary>
        public ObservationReadinessRequest BeginRequest(ObservationPairingBinding binding, bool authorized)
        {
            lock (_gate)
            {
                var sequence = ++_sequence;
                _latestRequest = sequence;
                return new ObservationReadinessRequest(_epoch, sequence, binding, authorized);
            }
        }

        /// <summary>Verwerkt een antwoord; alleen de nieuwste aanvraag van deze lifetime telt.</summary>
        public void Publish(ObservationReadinessRequest request, int httpStatus, string body)
        {
            if (request == null) return;
            lock (_gate)
            {
                if (!IsCurrent(request)) return;
                _published = Evaluate(request, httpStatus, body);
            }
        }

        /// <summary>Een mislukte/afgebroken aanvraag van deze lifetime vervalt de toestand.</summary>
        public void Fail(ObservationReadinessRequest request, string reasonCode)
        {
            if (request == null) return;
            lock (_gate)
            {
                if (!IsCurrent(request)) return;
                _published = Denied(reasonCode ?? ObservationReadinessReasons.TransportFailure, 0, request.Binding);
            }
        }

        /// <summary>Predicaat voor de host: alleen voor exact deze identiteit, vers en geautoriseerd.</summary>
        public bool IsReadyFor(ObservationPairingBinding binding, bool authorized)
        {
            if (!authorized || binding == null) return false;
            ObservationReadinessState state;
            ObservationPairingBinding current;
            bool currentAuthorized;
            lock (_gate)
            {
                state = _published;
                current = _current;
                currentAuthorized = _currentAuthorized;
            }
            if (!state.Ready) return false;
            if (!currentAuthorized
                || !SameRequestBinding(current, binding)
                || !SameRequestBinding(state.Binding, binding))
                return false;
            long now;
            if (!TryNow(out now)) return false;
            var age = now - state.AcquiredAtMilliseconds;
            return age >= 0 && age < TtlMilliseconds;
        }

        public ObservationReadinessState Snapshot()
        {
            ObservationReadinessState state;
            lock (_gate) { state = _published; }
            if (!state.Ready) return state;
            long now;
            if (!TryNow(out now))
                return Denied(ObservationReadinessReasons.ClockInvalid, state.AcquiredAtMilliseconds, state.Binding);
            var age = now - state.AcquiredAtMilliseconds;
            if (age < 0)
                return Denied(ObservationReadinessReasons.ClockBackwards, state.AcquiredAtMilliseconds, state.Binding);
            if (age >= TtlMilliseconds)
                return Denied(ObservationReadinessReasons.Expired, state.AcquiredAtMilliseconds, state.Binding);
            return state;
        }

        private bool IsCurrent(ObservationReadinessRequest request)
        {
            return request.Epoch == _epoch && request.Sequence == _latestRequest;
        }

        internal bool IsLatest(ObservationReadinessRequest request)
        {
            lock (_gate) return request != null && IsCurrent(request);
        }

        private static bool SameRequestBinding(ObservationPairingBinding left, ObservationPairingBinding right)
        {
            // Incomplete epochs require the very same in-memory request snapshot.
            return object.ReferenceEquals(left, right) || ObservationBindingFence.SameBinding(left, right);
        }

        private ObservationReadinessState Evaluate(ObservationReadinessRequest request, int httpStatus, string body)
        {
            long now;
            if (!TryNow(out now))
                return Denied(ObservationReadinessReasons.ClockInvalid, 0, request.Binding);
            if (httpStatus < 200 || httpStatus >= 300)
                return Denied(ObservationReadinessReasons.HttpNonSuccess, now, request.Binding);
            if (!request.Trusted
                || !_currentAuthorized
                || !SameRequestBinding(request.Binding, _current))
                return Denied(ObservationReadinessReasons.RequestUntrusted, now, request.Binding);

            long policyVersion;
            string reasonCode;
            if (!ObservationReadinessReader.TryRead(body, out policyVersion, out reasonCode))
                return Denied(reasonCode, now, request.Binding);
            return new ObservationReadinessState(true, ObservationReadinessReasons.Ready, now, request.Binding,
                ObservationReadinessReader.SupportsV2(body));
        }

        private bool TryNow(out long now)
        {
            now = 0;
            try { now = _clock(); }
            catch (Exception) { return false; }
            return true;
        }

        private static ObservationReadinessState Denied(string reasonCode, long acquiredAtMilliseconds,
            ObservationPairingBinding binding)
        {
            return new ObservationReadinessState(false, reasonCode, acquiredAtMilliseconds, binding);
        }
    }

    /// <summary>
    /// Minimale decorator rond de bestaande observatietransport. Hij voegt geen
    /// POST, retry, timer of opslag toe: hij legt alleen de aanvraagidentiteit
    /// vast en geeft het bestaande antwoord/exception ongewijzigd door. Elke
    /// fout in de observer wordt ingeslikt zodat ACK, status, replay, retries,
    /// leases, disposal en RowJson onaangetast blijven.
    /// </summary>
    public sealed class ObservationReadinessTransportObserver : IObservationSendTransport
    {
        private readonly IObservationSendTransport _inner;
        private readonly ObservationReadinessCache _readiness;

        public ObservationReadinessTransportObserver(IObservationSendTransport inner,
            ObservationReadinessCache readiness)
        {
            if (inner == null) throw new ArgumentNullException("inner");
            if (readiness == null) throw new ArgumentNullException("readiness");
            _inner = inner;
            _readiness = readiness;
        }

        public async System.Threading.Tasks.Task<ObservationTransportResponse> SendAsync(
            SendEnvelope envelope, Func<bool> bindingGuard,
            System.Threading.CancellationToken cancellationToken)
        {
            ObservationReadinessRequest request = null;
            try
            {
                if (envelope != null)
                    request = _readiness.BeginRequest(envelope.Binding,
                        !string.IsNullOrEmpty(envelope.Token));
            }
            catch (Exception)
            {
                request = null;
            }

            ObservationTransportResponse response;
            try
            {
                response = await _inner.SendAsync(envelope, bindingGuard, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception)
            {
                TryFail(request, ObservationReadinessReasons.TransportFailure);
                throw;
            }

            try
            {
                if (response == null)
                    _readiness.Fail(request, ObservationReadinessReasons.TransportFailure);
                else if (response.Status == ObservationTransportStatus.BindingChanged)
                    _readiness.Fail(request, ObservationReadinessReasons.RequestNotSent);
                else
                    _readiness.Publish(request, response.HttpStatus, response.Body);
            }
            catch (Exception)
            {
                // A readiness observer may never alter the existing transport outcome.
            }
            return response;
        }

        private void TryFail(ObservationReadinessRequest request, string reasonCode)
        {
            try { _readiness.Fail(request, reasonCode); }
            catch (Exception) { }
        }
    }
}
