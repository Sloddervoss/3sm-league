using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// Synthetic inputs; actual host, settings-save, sampler, ledger, serializer and HTTP seams.
internal static class NormalObservationUpgradeTests
{
    private const string Device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private const string Token = "synthetic-only-token";
    private static readonly DateTime T0 = new DateTime(2026, 11, 14, 12, 0, 0, DateTimeKind.Utc);
    private static readonly ObservationLapContext Context = new ObservationLapContext("car", 42, "track", "config", 123, 0);
    internal const string Response = "{\"accepted\":true,\"observation\":{\"enabled\":true,\"mode\":\"on\",\"available\":true,\"policy\":{\"captureAllowed\":true,\"policyVersion\":1},\"identity\":{\"deviceId\":\"" + Device + "\",\"ownerUserId\":\"" + Owner + "\"},\"observationSchemas\":[1,2]}}";

    private sealed class Handler : HttpMessageHandler
    {
        public string Body = Response;
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
        {
            Calls++;
            if (request.Headers.Authorization.Parameter != Token) throw new Exception("wrong snapshot token");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted) { Content = new StringContent(Body) });
        }
    }

    private static ConnectorSettings Settings()
    { return new ConnectorSettings { DeviceId = Device, BoundOwnerUserId = Owner, DeviceTokenProtected = "synthetic-protected", UseCentralRelay = true }; }

    private static ObservationProducerHost Host(ConnectorSettings settings, string path, ObservationReadinessCache cache, HttpClient http)
    {
        return new ObservationProducerHost(new MeasurementOutbox(path + ".legacy"), new MeasurementIdFactory(),
            new ObservationProducerIdentity(Token, settings.ObservationBinding()), () => settings.ObservationOptIn,
            () => false, fence => new ObservationLedgerStore(path, fence),
            new ObservationReadinessTransportObserver(new HttpObservationSendTransport(http, 16384), cache),
            () => "{}", null, () => T0, new ObservationSendOptions { LeaseWaitMilliseconds = 30 }, cache);
    }

    private static ObservationProducerIdentity Upgrade(ConnectorSettings settings, string path, Action save)
    {
        settings.CommitProspectiveObservation(save, ConnectorSettings.PristineObservationLedger(path));
        return new ObservationProducerIdentity(Token, settings.ObservationBinding());
    }

    private static async Task Ingest(ObservationProducerHost host, ObservationReadinessCache cache, HttpClient http,
        string body, Func<ObservationProducerIdentity, ObservationProducerIdentity> upgrade)
    {
        var identity = host.Snapshot();
        var stamp = cache.BeginRequest(identity);
        await host.SendAsync(() => "{}", new Uri("https://synthetic.invalid/ingest"), identity, T0, null,
            async () =>
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, "https://synthetic.invalid/ingest"))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", identity.Token);
                    request.Content = new StringContent("{}");
                    using (var response = await http.SendAsync(request))
                    {
                        var actual = await response.Content.ReadAsStringAsync();
                        await host.ObserveIngestAsync(identity, stamp, (int)response.StatusCode, actual, upgrade, CancellationToken.None);
                    }
                }
            }, CancellationToken.None);
    }

    public static int Run(Action<string, bool, string> check)
    {
        return RunAsync(check).GetAwaiter().GetResult();
    }

    private static async Task<int> RunAsync(Action<string, bool, string> check)
    {
        var count = 0;
        Action<string, bool> ok = (name, pass) => { count++; check("NU-" + name, pass, "real producer seam"); };
        var root = Path.Combine(Path.GetTempPath(), "normal-observation-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, "observation-ledger-v1.json");
        var options = new System.Text.Json.JsonSerializerOptions { IncludeFields = true };
        var absent = System.Text.Json.JsonSerializer.Deserialize<ConnectorSettings>("{}", options);
        var legacy = System.Text.Json.JsonSerializer.Deserialize<ConnectorSettings>("{\"ObservationEnabled\":false}", options);
        var explicitOff = System.Text.Json.JsonSerializer.Deserialize<ConnectorSettings>("{\"ObservationPreference\":false}", options);
        ok("fresh-and-missing-fields-default", absent.ObservationOptIn && legacy.ObservationOptIn && !explicitOff.ObservationOptIn
            && !absent.ObservationPairingGeneration.HasValue && !legacy.ObservationPairingGeneration.HasValue);
        var settings = Settings();
        var cache = new ObservationReadinessCache(() => 1000);
        var handler = new Handler();
        using (var http = new HttpClient(handler))
        {
            using (var host = Host(settings, path, cache, http))
            {
                var saves = 0;
                ok("default-existing-implicit-false", !settings.ObservationEnabled && settings.ObservationOptIn && !host.Snapshot().Binding.IsComplete);
                await Ingest(host, cache, http, Response, _ => Upgrade(settings, path, () => { saves++; File.WriteAllText(path + ".settings", MeasurementJson.Serialize(settings)); }));
                ok("authenticated-durable-upgrade", saves == 1 && settings.ObservationPairingGeneration == 1 && host.Snapshot().Binding.IsComplete && handler.Calls == 1);
                ok("token-pairing-intact", host.Snapshot().Token == Token && settings.DeviceTokenProtected == "synthetic-protected" && settings.UseCentralRelay);
                var sample = new TelemetrySample(); host.BindSample(sample, Context);
                ok("v2-negotiated", sample.ObservationSchemaVersion == 2 && sample.ObservationPairingBinding != null);
                // Actual sampler -> capture -> durable ledger -> exact serializer bytes.
                for (var i = 0; i < 4; i++) host.Observe(() =>
                {
                    var tick = new TelemetrySample { ObservedAtUtc = T0.AddMilliseconds(i * 500), SdkTick = i,
                        SessionTimeSeconds = i * 0.5, LapNumber = i < 3 ? 1 : 2, ObservedSessionId = "session",
                        CurrentDriverName = "Driver", CurrentDriverId = "sim-driver-42", OnPitRoad = false, FuelLitres = 50 - i * 0.1 };
                    host.BindSample(tick, Context); return tick;
                });
                var disk = new ObservationLedgerStore(path); disk.Load();
                ok("actual-pipeline-v2-ledger", disk.EntryCount == 1 && disk.Entries[0].RowJson.Contains("\"version\":2") && disk.Entries[0].RowJson.Contains("\"pitRoad\":false"));
                if (disk.EntryCount == 1) File.WriteAllText(Path.Combine(root, "pipeline.row.json"), disk.Entries[0].RowJson);
                var before = settings.ObservationPairingGeneration;
                await Ingest(host, cache, http, Response, _ => { throw new Exception("known epoch must not change"); });
                ok("known-generation-unchanged", settings.ObservationPairingGeneration == before);
                var stale = host.Snapshot(); var stamp = cache.BeginRequest(stale);
                await host.TransitionAsync(_ => Task.FromResult(new ObservationProducerIdentity("rebound-token", new ObservationPairingBinding(Device, Owner, 3, true))), CancellationToken.None);
                await host.ObserveIngestAsync(stale, stamp, 202, Response, _ => { saves++; return stale; }, CancellationToken.None);
                ok("rebind-stale-response", saves == 1 && host.Snapshot().Token == "rebound-token");
            }
            foreach (var body in new[] { "{}", Response.Replace("\"captureAllowed\":true", "\"captureAllowed\":false"), Response.Replace("\"available\":true", "\"available\":false"), Response.Replace(Owner, Device), Response.Replace("\"accepted\":true", "\"accepted\":false") })
            {
                var s = Settings(); var c = new ObservationReadinessCache(() => 1000); handler.Body = body;
                using (var h = Host(s, path + Guid.NewGuid(), c, http))
                {
                    var invoked = false;
                    await Ingest(h, c, http, body, _ => { invoked = true; return Upgrade(s, path + "absent", () => { }); });
                    ok("denied-unavailable-forged", !invoked && !s.ObservationPairingGeneration.HasValue);
                }
            }
            handler.Body = Response;
            var off = Settings(); off.ObservationPreference = false;
            var offCache = new ObservationReadinessCache(() => 1000);
            using (var h = Host(off, path + "off", offCache, http))
            {
                // Explicit privacy preference remains off, even under a valid response.
                var invoked = false;
                await Ingest(h, offCache, http, Response, _ => { invoked = true; return Upgrade(off, path + "off", () => { }); });
                ok("explicit-off", !invoked && !off.ObservationOptIn && !off.ObservationPairingGeneration.HasValue
                    && !off.CommitProspectiveObservation(() => { throw new Exception(); }, true));
            }
            var fail = Settings(); var failCache = new ObservationReadinessCache(() => 1000);
            using (var h = Host(fail, path + "fail", failCache, http))
            {
                var n = 0;
                await Ingest(h, failCache, http, Response, _ => Upgrade(fail, path + "fail", () => { if (++n == 1) throw new IOException(); File.WriteAllText(path + ".failure-settings", MeasurementJson.Serialize(fail)); }));
                ok("save-failure-blocked", !h.Snapshot().Binding.IsComplete && h.Snapshot().HasAuthorization && fail.ObservationPairingGenerationPoisoned);
                var restart = new System.Runtime.Serialization.Json.DataContractJsonSerializer(typeof(ConnectorSettings));
                using (var stream = File.OpenRead(path + ".failure-settings"))
                {
                    var loaded = (ConnectorSettings)restart.ReadObject(stream);
                    ok("failed-save-restart-poison", !loaded.CommitProspectiveObservation(() => { throw new Exception(); }, true) && loaded.ObservationPairingGeneration == 1);
                }
            }
            foreach (var suffix in new[] { "", ".bak", ".tmp", ".preserved", ".preserved.tmp" })
            {
                var unknown = path + "unknown"; File.WriteAllText(unknown + suffix, "unknown old pending bytes");
                var s = Settings();
                ok("unknown-history-closed", !s.CommitProspectiveObservation(() => { throw new Exception(); }, ConnectorSettings.PristineObservationLedger(unknown)));
                File.Delete(unknown + suffix);
            }
            foreach (var s in new[] {
                new ConnectorSettings { ObservationPairingGeneration = 7 },
                new ConnectorSettings { ObservationPairingGenerationKnown = true },
                new ConnectorSettings { ObservationPairingGenerationPoisoned = true },
                new ConnectorSettings { ObservationPairingGenerationRecoverable = true },
                new ConnectorSettings { ObservationPairingGeneration = 9007199254740991, ObservationPairingGenerationKnown = false } })
                ok("no-epoch-repair", !s.CommitProspectiveObservation(() => { throw new Exception(); }, true));
        }
        CaptureCases(ok, root);
        await LeaseAndLifetime(ok, root);
        var export = Environment.GetEnvironmentVariable("NORMAL_OBSERVATION_FIXTURES");
        if (!string.IsNullOrEmpty(export))
        {
            Directory.CreateDirectory(export);
            foreach (var file in Directory.GetFiles(root, "*.json")) File.Copy(file, Path.Combine(export, Path.GetFileName(file)), true);
        }
        return count;
    }

    private static async Task LeaseAndLifetime(Action<string, bool> ok, string root)
    {
        var s = Settings(); var cache = new ObservationReadinessCache(() => 1000);
        using (var http = new HttpClient(new Handler()))
        {
            var host = Host(s, Path.Combine(root, "lease.json"), cache, http);
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var identity = host.Snapshot();
            var holder = host.Coordinator.TransitionAsync(async _ =>
            {
                entered.TrySetResult(true); await release.Task;
                return ObservationPairCommit.CommittedWith(identity.Binding);
            }, CancellationToken.None);
            await entered.Task;
            var calls = 0;
            var stamp = cache.BeginRequest(identity);
            await host.ObserveIngestAsync(identity, stamp, 202, Response, _ => { calls++; return Upgrade(s, Path.Combine(root, "lease.json"), () => { }); }, CancellationToken.None);
            ok("upgrade-respects-shared-lease", calls == 0 && !s.ObservationPairingGeneration.HasValue);
            // Disposal while a second upgrade waits must not allocate a generation later.
            var pending = host.ObserveIngestAsync(identity, cache.BeginRequest(identity), 202, Response,
                _ => { calls++; return identity; }, CancellationToken.None);
            host.Stop(); release.TrySetResult(true);
            await pending; await holder; await host.Settlement;
            ok("disposal-settles-no-late-bootstrap", calls == 0 && host.Settlement.IsCompleted && !s.ObservationPairingGeneration.HasValue);
        }
        var forgedSettings = Settings(); var forgedCache = new ObservationReadinessCache(() => 1000);
        using (var http = new HttpClient(new Handler()))
        using (var host = Host(forgedSettings, Path.Combine(root, "forged.json"), forgedCache, http))
        {
            var expected = host.Snapshot();
            var forged = new ObservationProducerIdentity("different-token", expected.Binding);
            var called = false;
            await host.ObserveIngestAsync(forged, forgedCache.BeginRequest(forged), 202, Response,
                _ => { called = true; return expected; }, CancellationToken.None);
            ok("forged-request-token-snapshot", !called && !forgedSettings.ObservationPairingGeneration.HasValue);
            var old = forgedCache.BeginRequest(expected);
            forgedCache.BeginRequest(expected); // superseded, even within the same identity
            await host.ObserveIngestAsync(expected, old, 202, Response,
                _ => { called = true; return expected; }, CancellationToken.None);
            ok("superseded-response-no-allocation", !called);
            await host.ObserveIngestAsync(expected, forgedCache.BeginRequest(expected), 401, Response,
                _ => { called = true; return expected; }, CancellationToken.None);
            ok("revoked-http-no-allocation", !called);
            var noSchemas = Response.Replace(",\"observationSchemas\":[1,2]", "");
            forgedCache.Publish(forgedCache.BeginRequest(expected), 202, noSchemas);
            var tick = new TelemetrySample(); host.BindSample(tick, Context);
            ok("old-receiver-never-v2", tick.ObservationSchemaVersion == 1);
        }
    }

    private static void CaptureCases(Action<string, bool> ok, string root)
    {
        foreach (var mode in new[] { "clean", "null", "gap", "driver", "context", "fuel-null", "v1" })
        {
            var cap = new ObservationCapture(new ObservationPairingBinding(Device, Owner, 1, true), Context);
            var end = T0;
            for (var i = 0; i < 3; i++)
            {
                end = T0.AddMilliseconds(i * (mode == "gap" ? 1500 : 500));
                cap.AddSample(new ObservationSample(end, mode == "null" && i == 1 ? (bool?)null : false,
                    mode == "fuel-null" && i == 1 ? (double?)null : 50 - i * 0.1, "Driver",
                    mode == "context" && i == 1 ? "other" : "context", mode == "driver" && i == 1 ? "other" : "sim-driver-42", mode == "v1" ? 1 : 2));
            }
            var result = cap.Build(T0, end);
            ok("capture-" + mode, result.HasObservation);
            if (!result.HasObservation) continue;
            File.WriteAllText(Path.Combine(root, mode + ".observation.json"), result.ToJson());
            var q = result.Observation.FuelQuality;
            if (mode == "v1") ok("v1-unchanged", q == null && result.Observation.Version == 1);
            else
            {
                ok("unsupported-reset-null-" + mode, q.ResetOrTow == null);
                if (mode == "clean") ok("observed-false", q.PitRoad == false && q.Refuel == false && q.DriverChanged == false && q.DriverId == "sim-driver-42");
                if (mode == "null") ok("missing-not-false", q.PitRoad == null);
                if (mode == "gap" || mode == "context") ok("coverage-not-false", q.PitRoad == null && q.Refuel == null && q.DriverChanged == null && q.DriverId == null);
                if (mode == "driver") ok("driver-change-reset", q.DriverChanged == true && q.DriverId == null && q.Refuel == null);
                if (mode == "fuel-null") ok("fuel-missing-not-false", q.Refuel == null);
            }
        }
    }
}
