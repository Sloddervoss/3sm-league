using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// S2E1 local draft: memory-only readiness reader/cache and BOTH real response
// ingress seams (legacy 202 read site and mixed observation transport).
// Synthetic JSON/HTTP/clock inputs only. No network, SDK, server or DB is used.
internal static class MeasurementObservationReadinessTests
{
    private const string Device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string Token = "synthetic-token";
    private static readonly Uri Endpoint = new Uri("https://synthetic.invalid/no-network");
    private static readonly DateTime T0 = new DateTime(2026, 11, 14, 9, 0, 0, DateTimeKind.Utc);

    // The accepted Edge V3 202 literal shape: accepted/receivedAt/measurements/
    // aggregates/observation. The three-field observation block is the CURRENT
    // server output; no policy subobject exists there.
    private const string ThreeField = "{\"enabled\":true,\"mode\":\"on\",\"available\":true}";

    private const string FuturePolicy = "{\"enabled\":true,\"mode\":\"on\",\"available\":true,"
        + "\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}";

    private const string Measurements =
        "{\"events\":{\"received\":0,\"accepted\":[],\"duplicates\":[],\"superseded\":[],"
        + "\"rejected\":[],\"block_error\":null,\"stored\":true},"
        + "\"laps\":{\"received\":1,\"accepted\":[\"lap-1\"],\"duplicates\":[],\"superseded\":[],"
        + "\"rejected\":[],\"block_error\":null,\"stored\":true}}";

    private sealed class Clock
    {
        public long Value;
        public Clock(long value) { Value = value; }
        public long Now() { return Value; }
    }

    private sealed class ThrowingClock
    {
        public long Now() { throw new InvalidOperationException("synthetic clock failure"); }
    }

    private sealed class Handler : HttpMessageHandler
    {
        public int Calls;
        public string Body;
        public string Authorization;
        public Func<int, string> Reply = position => Accepted202(FuturePolicy);
        public Func<int, Exception> Throw = position => null;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var position = Interlocked.Increment(ref Calls) - 1;
            Body = await request.Content.ReadAsStringAsync().ConfigureAwait(false);
            Authorization = request.Headers.Authorization == null
                ? null : request.Headers.Authorization.Scheme + " " + request.Headers.Authorization.Parameter;
            var failure = Throw(position);
            if (failure != null) throw failure;
            return new HttpResponseMessage((HttpStatusCode)202)
            {
                Content = new StringContent(Reply(position), Encoding.UTF8, "application/json")
            };
        }
    }

    private static string EdgeBody(string observation)
    {
        return "{\"accepted\":true,\"receivedAt\":\"2026-11-14T09:00:00.000Z\","
            + "\"measurements\":" + Measurements + ",\"aggregates\":{},"
            + "\"observation\":" + observation + "}";
    }

    private static string Accepted202(string observation)
    {
        return EdgeBody(observation);
    }

    private static ObservationProducerIdentity Identity(long generation = 7,
        string device = Device, string owner = Owner, bool generationKnown = true, string token = Token)
    {
        return new ObservationProducerIdentity(token,
            new ObservationPairingBinding(device, owner, generation, generationKnown));
    }

    private static ObservationReadinessCache Armed(Clock clock, long generation = 7)
    {
        var cache = new ObservationReadinessCache(clock.Now);
        var identity = Identity(generation);
        cache.SetCurrentIdentity(identity.Binding, identity.HasAuthorization, "test_bound");
        return cache;
    }

    private static bool Publish(ObservationReadinessCache cache, string body, int status = 202,
        ObservationProducerIdentity requestIdentity = null)
    {
        var identity = requestIdentity ?? Identity();
        var request = cache.BeginRequest(identity);
        cache.Publish(request, status, body);
        return cache.IsReadyFor(identity.Binding, identity.HasAuthorization);
    }

    private static SendEnvelope Envelope(string body = "{\"core\":\"{}\"}")
    {
        string diagnostic;
        var batch = ObservationOfferedBatch.TryCreate(new List<ObservationOfferedRow>(), out diagnostic);
        if (batch == null) throw new InvalidOperationException(diagnostic);
        return SendEnvelope.Create(Token, Endpoint,
            new ObservationPairingBinding(Device, Owner, 7, true), batch, body, 1);
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        Action<string, bool, string> counted = (name, ok, evidence) => { count++; check(name, ok, evidence); };
        Reader(counted);
        StrictTypes(counted);
        Ttl(counted);
        Trust(counted);
        Ordering(counted);
        Seams(counted).GetAwaiter().GetResult();
        HostIntegration(counted).GetAwaiter().GetResult();
        CapturePositives(counted).GetAwaiter().GetResult();
        AckParity(counted);
        return count;
    }

    // ------------------------------------------------ strict reader contract
    private static void Reader(Action<string, bool, string> check)
    {
        long version;
        string reason;

        var ok = ObservationReadinessReader.TryRead(EdgeBody(FuturePolicy), out version, out reason);
        check("R01-future-policy-fixture", ok && version == 1 && reason == "ready",
            "optional draft policy subobject + strict three fields yields ready on the accepted 202 shape");

        ok = ObservationReadinessReader.TryRead(EdgeBody(ThreeField), out version, out reason);
        check("R02-current-three-field-denies", !ok && reason == ObservationReadinessReasons.PolicyAbsent,
            "the CURRENT server three-field observation block can never arm observation: " + reason);

        ok = ObservationReadinessReader.TryRead(
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,"
                + "\"policy\":{\"captureAllowed\":false,\"policyVersion\":1}}"), out version, out reason);
        check("R03-capture-not-allowed", !ok && reason == ObservationReadinessReasons.PolicyDenied,
            "captureAllowed false denies: " + reason);

        ok = ObservationReadinessReader.TryRead(
            EdgeBody("{\"enabled\":false,\"mode\":\"on\",\"available\":true,"
                + "\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}"), out version, out reason);
        var disabled = !ok && reason == ObservationReadinessReasons.ReceiverDisabled;
        ok = ObservationReadinessReader.TryRead(
            EdgeBody("{\"enabled\":true,\"mode\":\"off\",\"available\":true,"
                + "\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}"), out version, out reason);
        var modeOff = !ok && reason == ObservationReadinessReasons.ReceiverModeOff;
        ok = ObservationReadinessReader.TryRead(
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":false,"
                + "\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}"), out version, out reason);
        var unavailable = !ok && reason == ObservationReadinessReasons.ReceiverUnavailable;
        check("R04-receiver-ability-required", disabled && modeOff && unavailable,
            "enabled/mode:on/available:true are each required receiver-ability facts");

        ok = ObservationReadinessReader.TryRead(
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,"
                + "\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}"), out version, out reason);
        check("R05-version-one-exact", ok && version == 1,
            "supported policyVersion is exactly integer 1");

        var unsupported = true;
        foreach (var body in new[]
        {
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":2}}"),
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":0}}"),
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":-1}}"),
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1.5}}"),
            EdgeBody("{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true}}")
        })
        {
            long otherVersion;
            string otherReason;
            if (ObservationReadinessReader.TryRead(body, out otherVersion, out otherReason)
                || otherReason != ObservationReadinessReasons.PolicyVersionUnsupported) unsupported = false;
        }
        check("R06-unsupported-version-denies", unsupported,
            "unknown/absent/non-integral versions deny with policy_version_unsupported");

        var malformed = true;
        foreach (var body in new[]
        {
            string.Empty, "null", "{", "[]", "{\"accepted\":true}",
            EdgeBody(ThreeField) + "trailing",
            "{\"accepted\":true,\"measurements\":{},\"observation\":\"on\"}",
            "{\"accepted\":true,\"measurements\":{},\"observation\":[1,2]}",
            "{\"accepted\":true,\"measurements\":{},\"observation\":null}"
        })
        {
            long otherVersion;
            string otherReason;
            if (ObservationReadinessReader.TryRead(body, out otherVersion, out otherReason)) malformed = false;
        }
        check("R07-malformed-absent-deny", malformed,
            "empty/non-object/trailing/array/string/null observation never reads as ready");

        var oversized = EdgeBody(ThreeField);
        oversized = oversized + new string(' ', ObservationReadinessReader.MaxResponseCharacters) + "}";
        long tooLargeVersion;
        string tooLargeReason;
        var bounded = !ObservationReadinessReader.TryRead(oversized, out tooLargeVersion, out tooLargeReason)
            && tooLargeReason == ObservationReadinessReasons.ResponseTooLarge;
        check("R08-bounded-input", bounded,
            "response larger than the local " + ObservationReadinessReader.MaxResponseCharacters
            + " character bound is rejected before parsing: " + tooLargeReason);
    }

    private static void StrictTypes(Action<string, bool, string> check)
    {
        var strict = true;
        var evidence = string.Empty;
        var cases = new[]
        {
            "{\"enabled\":\"true\",\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":1,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":true,\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":1,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":\"true\",\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":1,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":\"1\"}}",
            "{\"enabled\":null,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":null,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1}}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":null}",
            "{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":null,\"policyVersion\":1}}"
        };
        foreach (var block in cases)
        {
            long version;
            string reason;
            if (ObservationReadinessReader.TryRead(EdgeBody(block), out version, out reason))
            {
                strict = false;
                evidence = block;
                break;
            }
        }
        check("R09-strict-json-types", strict,
            "no string/number-to-bool or string-to-number coercion; null never means enabled"
            + (evidence.Length == 0 ? string.Empty : " (coerced: " + evidence + ")"));
    }

    private static void Ttl(Action<string, bool, string> check)
    {
        var clock = new Clock(1000);
        var cache = Armed(clock);
        Publish(cache, Accepted202(FuturePolicy));
        var fresh = cache.IsReadyFor(Identity().Binding, true);

        clock.Value = 1000 + ObservationReadinessCache.TtlMilliseconds - 1;
        var lastValid = cache.IsReadyFor(Identity().Binding, true);

        clock.Value = 1000 + ObservationReadinessCache.TtlMilliseconds;
        var exact = cache.Snapshot();

        clock.Value = 1000 + ObservationReadinessCache.TtlMilliseconds + 1;
        var late = cache.IsReadyFor(Identity().Binding, true);
        check("R10-ttl-boundary", fresh && lastValid && !exact.Ready && exact.ReasonCode == ObservationReadinessReasons.Expired
            && !late, "age 59999 ready, exactly 60000 and beyond denied by the local draft TTL");

        var backwards = new Clock(5000);
        var backCache = Armed(backwards);
        AssertPublish(backCache, Accepted202(FuturePolicy));
        backwards.Value = 4999;
        check("R11-backward-clock", backCache.Snapshot().ReasonCode == ObservationReadinessReasons.ClockBackwards
            && !backCache.IsReadyFor(Identity().Binding, true),
            "negative age is invalid rather than infinitely fresh");

        var throwing = new ObservationReadinessCache(new ThrowingClock().Now);
        throwing.SetCurrentIdentity(Identity().Binding, true, "test_bound");
        var request = throwing.BeginRequest(Identity());
        throwing.Publish(request, 202, Accepted202(FuturePolicy));
        check("R12-clock-failure-fails-closed", !throwing.IsReadyFor(Identity().Binding, true)
            && throwing.Snapshot().ReasonCode == ObservationReadinessReasons.ClockInvalid,
            "a broken injected monotonic clock denies instead of arming");
    }

    private static void Trust(Action<string, bool, string> check)
    {
        var wrong = true;
        var evidence = string.Empty;
        foreach (var identity in new[]
        {
            Identity(device: "cccccccc-dddd-4eee-8fff-000000000000"),
            Identity(owner: "99999999-8888-4777-8666-555555555555"),
            Identity(generation: 8),
            Identity(generationKnown: false),
            Identity(token: string.Empty)
        })
        {
            var clock = new Clock(1000);
            var cache = Armed(clock);
            var ready = Publish(cache, Accepted202(FuturePolicy), 202, identity);
            if (ready || cache.Snapshot().Ready)
            {
                wrong = false;
                evidence = "trusted a request binding that differs from the current identity";
                break;
            }
        }
        check("R13-request-binding-equality", wrong,
            "wrong device/owner/generation/unknown generation/missing authorization all deny" + evidence);

        var lateClock = new Clock(1000);
        var lateCache = Armed(lateClock);
        var request = lateCache.BeginRequest(Identity());
        lateCache.SetCurrentIdentity(Identity(generation: 8).Binding, true, "identity_changed");
        lateCache.Publish(request, 202, Accepted202(FuturePolicy));
        check("R14-old-binding-cannot-arm", !lateCache.IsReadyFor(Identity(generation: 8).Binding, true)
            && !lateCache.IsReadyFor(Identity().Binding, true)
            && !lateCache.Snapshot().Ready,
            "a response captured under the previous binding cannot arm the new identity");

        var authCache = Armed(new Clock(1000));
        var unauth = new ObservationProducerIdentity(string.Empty,
            new ObservationPairingBinding(Device, Owner, 7, true));
        check("R15-host-predicate-requires-auth", !authCache.IsReadyFor(Identity().Binding, false)
            && !authCache.IsReadyFor(null, true),
            "the binding-aware host predicate also requires authorization and a binding");
    }

    private static void Ordering(Action<string, bool, string> check)
    {
        var clock = new Clock(1000);
        var cache = Armed(clock);
        var older = cache.BeginRequest(Identity());
        var newer = cache.BeginRequest(Identity());
        cache.Publish(older, 202, Accepted202(FuturePolicy));
        var afterOlder = cache.IsReadyFor(Identity().Binding, true);
        cache.Publish(newer, 202, Accepted202(FuturePolicy));
        var afterNewer = cache.IsReadyFor(Identity().Binding, true);
        var acquired = cache.Snapshot().AcquiredAtMilliseconds;
        clock.Value = 2000;
        cache.Publish(older, 202, Accepted202(FuturePolicy));
        check("R16-out-of-order", !afterOlder && afterNewer
            && cache.Snapshot().AcquiredAtMilliseconds == acquired,
            "an older in-flight response neither arms nor refreshes a newer request's state");

        var clearClock = new Clock(1000);
        var clearCache = Armed(clearClock);
        var first = clearCache.BeginRequest(Identity());
        var second = clearCache.BeginRequest(Identity());
        clearCache.Publish(second, 202, Accepted202(FuturePolicy));
        clearCache.Publish(first, 500, null);
        check("R17-older-response-cannot-clear", clearCache.IsReadyFor(Identity().Binding, true),
            "an older non-2xx cannot clear a newer request's valid state");

        var denyClock = new Clock(1000);
        var denyCache = Armed(denyClock);
        Publish(denyCache, Accepted202(FuturePolicy));
        var wasReady = denyCache.IsReadyFor(Identity().Binding, true);
        Publish(denyCache, null, 500);
        var nonSuccess = denyCache.Snapshot();
        Publish(denyCache, Accepted202(FuturePolicy));
        Publish(denyCache, "{not json", 202);
        var malformed = denyCache.Snapshot();
        var failRequest = denyCache.BeginRequest(Identity());
        denyCache.Fail(failRequest, ObservationReadinessReasons.TransportFailure);
        var failed = denyCache.Snapshot();
        check("R18-current-request-failure-invalidates",
            wasReady && !nonSuccess.Ready && nonSuccess.ReasonCode == ObservationReadinessReasons.HttpNonSuccess
            && !malformed.Ready && malformed.ReasonCode == ObservationReadinessReasons.ResponseMalformed
            && !failed.Ready && failed.ReasonCode == ObservationReadinessReasons.TransportFailure,
            "current non-2xx, malformed and transport failure all invalidate the latest state");

        var stopClock = new Clock(1000);
        var stopCache = Armed(stopClock);
        Publish(stopCache, Accepted202(FuturePolicy));
        var beforeStop = stopCache.IsReadyFor(Identity().Binding, true);
        var inFlight = stopCache.BeginRequest(Identity());
        stopCache.InvalidateLifetime(ObservationReadinessReasons.HostStopped);
        stopCache.Publish(inFlight, 202, Accepted202(FuturePolicy));
        check("R19-lifetime-invalidation", beforeStop
            && !stopCache.IsReadyFor(Identity().Binding, true)
            && stopCache.Snapshot().ReasonCode == ObservationReadinessReasons.HostStopped,
            "Stop/lifetime invalidation denies immediately and rejects a late response from the old lifetime");

        var defaultCache = new ObservationReadinessCache(new Clock(1000).Now);
        check("R20-not-observed-default-off", !defaultCache.Snapshot().Ready
            && defaultCache.Snapshot().ReasonCode == ObservationReadinessReasons.NotObserved,
            "an untouched cache is explicitly not_observed, never optimistically ready");
    }

    private static void AssertPublish(ObservationReadinessCache cache, string body)
    {
        var request = cache.BeginRequest(Identity());
        cache.Publish(request, 202, body);
    }

    // ------------------------------------------------------- response seams
    private static async Task Seams(Action<string, bool, string> check)
    {
        var clock = new Clock(1000);
        var cache = Armed(clock);
        var handler = new Handler();
        using (var http = new HttpClient(handler, false))
        {
            var transport = new ObservationReadinessTransportObserver(
                new HttpObservationSendTransport(http, 16384), cache);
            var envelope = Envelope();
            var response = await transport.SendAsync(envelope, () => true, CancellationToken.None);
            check("R21-mixed-transport-arms-same-cache",
                response != null && response.HttpStatus == 202
                && cache.IsReadyFor(Identity().Binding, true)
                && handler.Calls == 1 && handler.Body == envelope.Body
                && handler.Authorization == "Bearer " + Token,
                "real HttpObservationSendTransport + decorator publishes the 202 into the same cache unchanged");

            handler.Reply = position => EdgeBody(ThreeField);
            var denied = await transport.SendAsync(envelope, () => true, CancellationToken.None);
            check("R22-mixed-current-response-denies", denied != null && denied.HttpStatus == 202
                && !cache.IsReadyFor(Identity().Binding, true)
                && cache.Snapshot().ReasonCode == ObservationReadinessReasons.PolicyAbsent,
                "the accepted current three-field 202 over the mixed seam invalidates instead of arming");

            handler.Reply = position => Accepted202(FuturePolicy);
            handler.Throw = position => new HttpRequestException("synthetic transport failure");
            var thrown = false;
            try { await transport.SendAsync(envelope, () => true, CancellationToken.None); }
            catch (HttpRequestException) { thrown = true; }
            check("R23-mixed-failure-propagates-and-denies", thrown
                && !cache.IsReadyFor(Identity().Binding, true),
                "the existing transport exception still flows to core; readiness only denies");

            handler.Throw = position => null;
            var calls = handler.Calls;
            var changed = await transport.SendAsync(envelope, () => false, CancellationToken.None);
            check("R24-guard-denied-no-post", changed != null
                && changed.Status == ObservationTransportStatus.BindingChanged
                && handler.Calls == calls && !cache.IsReadyFor(Identity().Binding, true),
                "a binding-guard refusal creates no POST and denies readiness");
        }

        // Both seams, one cache: legacy identity overload, then mixed, then legacy.
        var shared = Armed(new Clock(1000));
        var legacyRequest = shared.BeginRequest(Identity());
        shared.Publish(legacyRequest, 202, Accepted202(FuturePolicy));
        var afterLegacy = shared.IsReadyFor(Identity().Binding, true);
        var sharedHandler = new Handler();
        using (var http = new HttpClient(sharedHandler, false))
        {
            var transport = new ObservationReadinessTransportObserver(
                new HttpObservationSendTransport(http, 16384), shared);
            var mixed = await transport.SendAsync(Envelope(), () => true, CancellationToken.None);
            var afterMixed = shared.IsReadyFor(Identity().Binding, true);
            var legacyAgain = shared.BeginRequest(Identity());
            shared.Publish(legacyAgain, 202, Accepted202(FuturePolicy));
            check("R25-both-seams-share-cache", afterLegacy && mixed != null && afterMixed
                && shared.IsReadyFor(Identity().Binding, true),
                "legacy 202 observer and mixed transport decorator feed the same cache instance");
        }
    }

    // ------------------------------------------------ host provider wiring
    private static async Task HostIntegration(Action<string, bool, string> check)
    {
        var root = DirectoryFor("readiness-host");
        var clock = new Clock(1000);
        var cache = new ObservationReadinessCache(clock.Now);
        var handler = new Handler();
        using (var http = new HttpClient(handler, false))
        using (var host = new ObservationProducerHost(
            new MeasurementOutbox(Path.Combine(root, "legacy.json")), new MeasurementIdFactory(),
            Identity(), () => true, () => false,
            fence => new ObservationLedgerStore(Path.Combine(root, "ledger.json"), fence),
            new ObservationReadinessTransportObserver(new HttpObservationSendTransport(http, 16384), cache),
            () => "{}", null, () => T0, null, cache))
        {
            var before = Sample();
            host.BindSample(before, Context());
            var unarmed = before.ObservationPairingBinding;

            var legacy = cache.BeginRequest(Identity());
            cache.Publish(legacy, 202, Accepted202(FuturePolicy));
            var after = Sample();
            host.BindSample(after, Context());
            check("R26-host-provider-follows-cache", unarmed == null
                && after.ObservationPairingBinding != null
                && ObservationBindingFence.SameBinding(after.ObservationPairingBinding, Identity().Binding),
                "the host's constant-false receiver provider is replaced by the binding-aware cache predicate");

            var duringTransition = true;
            var result = await host.TransitionAsync(cancel =>
            {
                duringTransition = cache.IsReadyFor(Identity().Binding, true);
                return Task.FromResult<ObservationProducerIdentity>(null);
            }, CancellationToken.None);
            var boundAfter = Sample();
            host.BindSample(boundAfter, Context());
            check("R27-pair-transition-invalidates-before-http", !duringTransition
                && boundAfter.ObservationPairingBinding == null,
                "a Pair/Unpair transition invalidates readiness before any next HTTP and publishes no authority");

            cache.BeginRequest(Identity());
            cache.Publish(cache.BeginRequest(Identity()), 202, Accepted202(FuturePolicy));
            // Re-arm against the host's current identity is impossible after transition;
            // commit a new identity through the real callback instead.
            var committed = await host.TransitionAsync(cancel =>
                Task.FromResult(Identity(generation: 9)), CancellationToken.None);
            var request = cache.BeginRequest(Identity(generation: 9));
            cache.Publish(request, 202, Accepted202(FuturePolicy));
            var armedAgain = Sample();
            host.BindSample(armedAgain, Context());
            check("R28-new-identity-can-arm-again", committed.Committed
                && armedAgain.ObservationPairingBinding != null,
                "after a committed new identity the cache can arm only for that exact binding");

            host.Stop();
            await Bounded(host.Settlement);
            check("R29-stop-invalidates", !cache.IsReadyFor(Identity(generation: 9).Binding, true)
                && cache.Snapshot().ReasonCode == ObservationReadinessReasons.HostStopped,
                "Stop invalidates by lifetime without waiting for a next HTTP request");
        }

        var brokenRoot = DirectoryFor("readiness-broken-clock");
        var broken = new ObservationReadinessCache(new ThrowingClock().Now);
        using (var http = new HttpClient(new Handler(), false))
        using (var host = new ObservationProducerHost(
            new MeasurementOutbox(Path.Combine(brokenRoot, "legacy.json")), new MeasurementIdFactory(),
            Identity(), () => true, () => false,
            fence => new ObservationLedgerStore(Path.Combine(brokenRoot, "ledger.json"), fence),
            new ObservationReadinessTransportObserver(new HttpObservationSendTransport(http, 16384), broken),
            () => "{}", null, () => T0, null, broken))
        {
            var sample = Sample();
            var threw = false;
            try { host.BindSample(sample, Context()); }
            catch (Exception) { threw = true; }
            check("R30-observer-failure-isolated", !threw && sample.ObservationPairingBinding == null,
                "a throwing readiness clock never alters binding/sampling or escapes into the tick");
        }
    }

    private static TelemetrySample Sample()
    {
        return new TelemetrySample
        {
            ObservedAtUtc = T0, SdkTick = 0, SessionTimeSeconds = 0,
            LapNumber = 1, ObservedSessionId = "sim-42-s3",
            CurrentDriverName = "Synthetisch Een", OnPitRoad = true, FuelLitres = 50
        };
    }

    private static ObservationLapContext Context()
    {
        return new ObservationLapContext("car-a", 123, "Track", "GP", 42, 3);
    }

    private static string DirectoryFor(string name)
    {
        var root = Environment.GetEnvironmentVariable("S2D_ARTIFACT_ROOT") ?? Path.GetTempPath();
        var path = Path.Combine(root, "readiness-" + name + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static async Task Bounded(Task task)
    {
        if (await Task.WhenAny(task, Task.Delay(5000)) != task) throw new TimeoutException("synthetic settlement timeout");
        await task;
    }

    private static void Tick(ObservationProducerHost host, int tick, int lap)
    {
        host.Observe(() =>
        {
            var sample = new TelemetrySample
            {
                ObservedAtUtc = T0.AddMilliseconds(tick * 500), SdkTick = tick,
                SessionTimeSeconds = tick * 0.5, LapNumber = lap, ObservedSessionId = "sim-42-s3",
                CurrentDriverName = "Synthetisch Een", OnPitRoad = true, FuelLitres = 50 - tick * 0.1
            };
            host.BindSample(sample, new ObservationLapContext("car-a", 123, "Track", "GP", 42, 3));
            return sample;
        });
    }

    // ------------- positive controls: real capture only after a fresh lap
    private static async Task CapturePositives(Action<string, bool, string> check)
    {
        var root = DirectoryFor("readiness-capture");
        var clock = new Clock(1000);
        var cache = new ObservationReadinessCache(clock.Now);
        var handler = new Handler { Reply = position => Accepted202(FuturePolicy) };
        var legacy = new MeasurementOutbox(Path.Combine(root, "legacy.json"));
        ObservationLedgerStore store = null;
        using (var http = new HttpClient(handler, false))
        using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(),
            Identity(), () => true, () => false,
            fence => { store = new ObservationLedgerStore(Path.Combine(root, "ledger.json"), fence); return store; },
            new ObservationReadinessTransportObserver(new HttpObservationSendTransport(http, 16384), cache),
            () => "{}", null, () => T0, null, cache))
        {
            Tick(host, 0, 1);
            Tick(host, 1, 1);
            Tick(host, 2, 1);
            Tick(host, 3, 2); // closes unarmed lap 1 as a normal legacy row
            var legacyBefore = legacy.LapCount;
            var oldRow = legacy.Due(T0.AddHours(1), 16, 16).Laps[0];
            var oldUid = oldRow.Uid;
            var oldJson = oldRow.RowJson;
            var earlyEntries = store == null ? 0 : store.EntryCount;

            // Arm mid-lap through the legacy response seam: lap 2 started unarmed.
            var request = cache.BeginRequest(Identity());
            cache.Publish(request, 202, Accepted202(FuturePolicy));

            Tick(host, 4, 2);
            Tick(host, 5, 3); // closes lap 2: started before the arm, never backfilled
            var afterUnarmedLap = store == null ? 0 : store.EntryCount;
            Tick(host, 6, 3);
            Tick(host, 7, 4); // closes lap 3: started after the arm, captured
            var captured = store == null ? 0 : store.EntryCount;

            var rowStill = legacy.Due(T0.AddHours(1), 16, 16).Laps;
            var preserved = false;
            foreach (var entry in rowStill)
                if (entry.Uid == oldUid && entry.RowJson == oldJson) preserved = true;

            check("R31-fresh-lap-only-captured", earlyEntries == 0 && afterUnarmedLap == 0 && captured == 1
                && legacy.LapCount == legacyBefore + 1 && preserved,
                "armed cache captures only the lap that started after arming; the older queued legacy row is byte-identical");
            host.Stop();
            await Bounded(host.Settlement);
        }
    }

    // ------------------------------------------- existing ACK parser parity
    private static void AckParity(Action<string, bool, string> check)
    {
        var binding = new ObservationPairingBinding(Device, Owner, 7, true);
        string diagnostic;
        var batch = ObservationOfferedBatch.TryCreate(new List<ObservationOfferedRow>(), out diagnostic);
        var withPolicy = Accepted202(EdgeBody(FuturePolicy).Substring(0, 0) + FuturePolicy);
        var withoutPolicy = Accepted202(ThreeField);
        var baseOnly = "{\"accepted\":true,\"receivedAt\":\"2026-11-14T09:00:00.000Z\","
            + "\"measurements\":" + Measurements + ",\"aggregates\":{}}";

        var parsedPolicy = MeasurementAckParser.Parse(withPolicy, null);
        var parsedWithout = MeasurementAckParser.Parse(withoutPolicy, null);
        var parsedBase = MeasurementAckParser.Parse(baseOnly, null);
        var same = parsedPolicy.Laps.Stored == parsedWithout.Laps.Stored
            && parsedWithout.Laps.Stored == parsedBase.Laps.Stored
            && parsedPolicy.Laps.Received == parsedWithout.Laps.Received
            && parsedPolicy.Laps.Accepted.Count == parsedWithout.Laps.Accepted.Count
            && parsedPolicy.Events.BlockError == parsedWithout.Events.BlockError
            && parsedPolicy.Laps.BlockError == null && parsedWithout.Laps.BlockError == null;

        var resolvedPolicy = ObservationAckResolver.Resolve(withPolicy, batch, binding);
        var resolvedWithout = ObservationAckResolver.Resolve(withoutPolicy, batch, binding);
        var resolvedBase = ObservationAckResolver.Resolve(baseOnly, batch, binding);
        same = same && resolvedPolicy.SeriesStored == resolvedWithout.SeriesStored
            && resolvedWithout.SeriesStored == resolvedBase.SeriesStored
            && resolvedPolicy.BlockErrorCode == resolvedWithout.BlockErrorCode
            && resolvedPolicy.Rows.Count == resolvedWithout.Rows.Count;

        check("R32-ack-parser-parity", same,
            "existing legacy + mixed ACK parsers classify a 202 identically with, without and before the proposed policy block");
    }
}
