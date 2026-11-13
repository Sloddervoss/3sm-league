using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// Local synthetic inputs only. The same production coordinator/host sources are linked.
internal static class MeasurementObservationHostTests
{
    private const string Device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    private const string Owner = "11111111-2222-4333-8444-555555555555";
    private static readonly DateTime T0 = new DateTime(2026, 11, 13, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Uri Endpoint = new Uri("https://synthetic.invalid/no-network");

    private static string DirectoryFor(string name)
    {
        var root = Environment.GetEnvironmentVariable("S2D_ARTIFACT_ROOT") ?? Path.GetTempPath();
        var path = Path.Combine(root, "host-" + name + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private sealed class Handler : HttpMessageHandler
    {
        public int Calls;
        public string Body;
        public string Authorization;
        public string ContentType;
        public string Response = "{\"stored\":false}";
        public Func<string, string> Reply;
        public TaskCompletionSource<bool> Entered;
        public TaskCompletionSource<bool> Release;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
        {
            Calls++;
            Body = await request.Content.ReadAsStringAsync();
            Authorization = request.Headers.Authorization.ToString();
            ContentType = request.Content.Headers.ContentType.ToString();
            if (Entered != null) Entered.TrySetResult(true);
            if (Release != null) await Release.Task; // intentionally ignore cancellation: real late settlement test
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Reply == null ? Response : Reply(Body)) };
        }
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        Action<string, bool, string> counted = (name, ok, evidence) => { count++; check(name, ok, evidence); };
        QualityBoundaries(counted).GetAwaiter().GetResult();
        LazyLease(counted).GetAwaiter().GetResult();
        LazyFailures(counted).GetAwaiter().GetResult();
        DefaultOff(counted).GetAwaiter().GetResult();
        Vertical(counted).GetAwaiter().GetResult();
        Lifecycle(counted).GetAwaiter().GetResult();
        Concurrency(counted).GetAwaiter().GetResult();
        FinalBudgetAndKillRestart(counted).GetAwaiter().GetResult();
        StorageFaults(counted);
        GoldenOff(counted);
        Epochs(counted);
        PairMetadata(counted);
        FreshPair(counted).GetAwaiter().GetResult();
        PairFailures(counted).GetAwaiter().GetResult();
        LatePairCommit(counted).GetAwaiter().GetResult();
        PairStoredFences(counted).GetAwaiter().GetResult();
        PairRecovery(counted).GetAwaiter().GetResult();
        PairRecoveryFailures(counted).GetAwaiter().GetResult();
        PairRecoveryControls(counted);
        LostRecoveryEvidence(counted).GetAwaiter().GetResult();
        return count;
    }

    private static ObservationProducerIdentity Identity(long generation = 7, string token = "synthetic-token")
    {
        return new ObservationProducerIdentity(token, new ObservationPairingBinding(Device, Owner, generation, true));
    }

    private static TaskCompletionSource<bool> Barrier()
    {
        return new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private static async Task Bounded(Task task)
    {
        if (await Task.WhenAny(task, Task.Delay(5000)) != task) throw new TimeoutException("synthetic barrier timeout");
        await task;
    }

    private static void Tick(ObservationProducerHost host, int tick, int lap, string car = "car-a")
    {
        host.Observe(() =>
        {
            var sample = new TelemetrySample
            {
                ObservedAtUtc = T0.AddMilliseconds(tick * 500), SdkTick = tick,
                SessionTimeSeconds = tick * 0.5, LapNumber = lap, ObservedSessionId = "sim-42-s3",
                CurrentDriverName = "Synthetisch Één", OnPitRoad = true, FuelLitres = 50 - tick * 0.1
            };
            host.BindSample(sample, new ObservationLapContext(car, 123, "Track É", "GP", 42, 3));
            return sample;
        });
    }

    private static string AckAll(string body)
    {
        var json = MeasurementJson.DeserializeDictionary(body);
        Func<string, string> series = key =>
        {
            var ids = new System.Collections.Generic.List<string>();
            object value;
            if (json.TryGetValue(key, out value))
                foreach (var item in (System.Collections.IEnumerable)value)
                {
                    var row = (System.Collections.Generic.Dictionary<string, object>)item;
                    ids.Add("{\"id\":\"" + row[key == "lapSummaries" ? "summaryUid" : "eventUid"]
                        + "\",\"recordRevision\":" + row["recordRevision"] + "}");
                }
            return "{\"received\":" + ids.Count + ",\"accepted\":[" + string.Join(",", ids)
                + "],\"duplicates\":[],\"superseded\":[],\"rejected\":[],\"stored\":true}";
        };
        return "{\"measurements\":{\"events\":" + series("measurementEvents") + ",\"laps\":" + series("lapSummaries") + "}}";
    }

    private static async Task DefaultOff(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "off", "unready", "incomplete" })
        {
            var dir = DirectoryFor(mode);
            var path = Path.Combine(dir, "observation.json");
            File.WriteAllText(path, "synthetic corrupt evidence");
            File.WriteAllText(path + ".tmp", "synthetic temp evidence");
            File.WriteAllText(path + ".bak", "synthetic backup evidence");
            var calls = 0;
            var handler = new Handler();
            var outbox = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            using (var http = new HttpClient(handler))
            using (var host = new ObservationProducerHost(outbox, new MeasurementIdFactory(),
                mode == "incomplete" ? new ObservationProducerIdentity("synthetic-token", new ObservationPairingBinding(Device, Owner, 0, false)) : Identity(),
                () => mode != "off", () => mode != "unready", fence => { calls++; return new ObservationLedgerStore(path, fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                host.EndSession("session_end");
                var builds = 0;
                var oldCalls = 0;
                await host.SendAsync(() => { builds++; return "{}"; }, Endpoint, host.Snapshot(), T0.AddMinutes(2), null,
                    async () =>
                    {
                        oldCalls++;
                        using (var request = new HttpRequestMessage(HttpMethod.Post, Endpoint))
                        {
                            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "synthetic-token");
                            request.Content = new StringContent("{\"core\":\"É\",\"pace\":true}", Encoding.UTF8, "application/json");
                            using (await http.SendAsync(request)) { }
                        }
                    }, CancellationToken.None);
                check("OH10-" + mode, calls == 0 && builds == 0 && oldCalls == 1 && handler.Calls == 1
                    && handler.Authorization == "Bearer synthetic-token" && handler.ContentType == "application/json; charset=utf-8"
                    && outbox.LapCount > 0, "real ticks/end use legacy; no OBS provider/plan; exact synthetic old HTTP header/body");
                host.Stop();
                await Bounded(host.Settlement);
            }
            check("OH11-" + mode, calls == 0 && File.ReadAllText(path) == "synthetic corrupt evidence"
                && File.ReadAllText(path + ".tmp") == "synthetic temp evidence" && File.ReadAllText(path + ".bak") == "synthetic backup evidence"
                && !File.Exists(path + ".preserved"), "disabled/ineligible constructor/ticks/send/end/dispose preserve all file bytes");
        }
    }

    private static async Task Vertical(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("vertical");
        var path = Path.Combine(dir, "observation.json");
        var handler = new Handler { Reply = AckAll };
        var calls = 0;
        ObservationLedgerStore store = null;
        var legacy = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
        using (var http = new HttpClient(handler))
        {
            Func<ObservationBindingFence, ObservationLedgerStore> provider = fence =>
            { calls++; store = new ObservationLedgerStore(path, fence); return store; };
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(), Identity(), () => true, () => true,
                provider, new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 1); Tick(host, 3, 2);
                check("OH20", calls == 1 && store.EntryCount == 1 && legacy.LapCount == 0 && host.PendingCandidate == null,
                    "actual tick/lap pipeline consumes OBS once into the real store, not v1");
                Tick(host, 4, 2);
                host.EndSession("session_end");
                check("OH21", store.EntryCount == 2 && legacy.LapCount == 0 && store.ReservationCount == 0,
                    "session_end shares post-pit sink and durable capture");
            }
            var before = new ObservationLedgerStore(path, new ObservationBindingFence(Identity().Binding));
            var expectedRows = before.EntryCount;
            var oldPipeline = new MeasurementPipeline(legacy, new MeasurementIdFactory());
            oldPipeline.Observe(new TelemetrySample { ObservedAtUtc = T0, LapNumber = 1, SessionTimeSeconds = 0, OnPitRoad = true });
            oldPipeline.Observe(new TelemetrySample { ObservedAtUtc = T0.AddSeconds(1), LapNumber = 1, SessionTimeSeconds = 1, OnPitRoad = false });
            oldPipeline.End("session_end");
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(), Identity(), () => true, () => true,
                provider, new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(2)))
            {
                var bypass = 0;
                var result = await host.SendAsync(() => "{\"core\":\"É\"}", Endpoint, host.Snapshot(), T0.AddMinutes(3),
                    body => PaceCaptureBuffer.AppendWithinBudget(body, new PaceCaptureFrame { ObservedSessionId = "sim-42-s3", SegmentId = "synthetic-segment" }),
                    () => { bypass++; return Task.CompletedTask; }, CancellationToken.None);
                check("OH22", result != null && result.ObservationDelivered == expectedRows && result.LegacyCleanupApplied
                    && handler.Calls == 1 && bypass == 0 && calls == 2 && store.DeliveredTotal == expectedRows && store.EntryCount == 0,
                    "restart -> same lazy store/fence -> single mixed POST -> one ACK owner/counters");
                check("OH23", handler.Body.Contains("lapSummaries") && handler.Body.IndexOf("paceCapture", StringComparison.Ordinal)
                    > handler.Body.IndexOf("lapSummaries", StringComparison.Ordinal) && handler.Authorization == "Bearer synthetic-token"
                    && handler.ContentType == "application/json; charset=utf-8" && Encoding.UTF8.GetByteCount(handler.Body) <= 24576,
                    "UTF8 body, auth/contenttype, measurements-before-pace in final frozen envelope");
                var disk = new ObservationLedgerStore(path, new ObservationBindingFence(Identity().Binding));
                check("OH24", disk.DeliveredTotal == expectedRows && disk.EntryCount == 0, "ACK counters proven by disk readback");
                // Core-only remains on exactly one old callback rather than being lost to HasRows=false.
                await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(4), null,
                    async () =>
                    {
                        bypass++;
                        using (var request = new HttpRequestMessage(HttpMethod.Post, Endpoint))
                        {
                            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "synthetic-token");
                            request.Content = new StringContent("{\"coreOnly\":true,\"paceCapture\":{\"fixture\":true}}", Encoding.UTF8, "application/json");
                            using (await http.SendAsync(request)) { }
                        }
                    }, CancellationToken.None);
                check("OH25", bypass == 1 && handler.Calls == 2 && handler.Body == "{\"coreOnly\":true,\"paceCapture\":{\"fixture\":true}}",
                    "nothing-due launches exactly one actual independent core/pace POST, not a lost HasRows=false frame");
            }
        }
    }

    private static async Task Lifecycle(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("lifecycle");
        var providerCalls = 0;
        var handler = new Handler();
        var entered = Barrier(); var release = Barrier();
        using (var http = new HttpClient(handler))
        using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")), new MeasurementIdFactory(),
            Identity(), () => true, () => false, fence => { providerCalls++; return new ObservationLedgerStore(Path.Combine(dir, "obs.json"), fence); },
            new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0,
            new ObservationSendOptions { LeaseWaitMilliseconds = 50, PairTransitionTimeoutMilliseconds = 50 }))
        {
            var old = host.Snapshot();
            var pair = host.TransitionAsync(async cancel =>
            {
                check("OH30", host.Coordinator.LeaseHeld && providerCalls == 0, "lease before synthetic server/settings side effect, even with readiness false");
                entered.TrySetResult(true);
                await release.Task; // model a late committed callback ignoring cancellation
                return Identity(8, "synthetic-new-token");
            }, CancellationToken.None);
            await Bounded(entered.Task);
            await Bounded(pair);
            check("OH31", pair.Result.Status == ObservationPairTransitionStatus.TimedOut && host.Coordinator.LeaseHeld
                && !host.Snapshot().HasAuthorization, "bounded public timeout does not restore old auth or release callback lease");
            var legacyCalls = 0;
            await host.SendAsync(() => "{}", Endpoint, old, T0, null,
                () => { legacyCalls++; return Task.CompletedTask; }, CancellationToken.None);
            check("OH32", legacyCalls == 0 && handler.Calls == 0, "old queued identity blocked during unknown server commit");
            host.Stop();
            check("OH33", !host.Settlement.IsCompleted && host.Coordinator.LeaseHeld, "End retains actual late callback/resources");
            release.TrySetResult(true);
            await Bounded(host.Settlement);
            check("OH34", !host.Coordinator.LeaseHeld && host.Coordinator.CurrentBinding.PairingGeneration == 8 && providerCalls == 0,
                "actual callback settles and publishes under original fence before terminal resource release");
        }
        // Timeout after transport has begun never invokes an independent old POST.
        var sendDir = DirectoryFor("transport-timeout");
        var sendHandler = new Handler { Entered = Barrier(), Release = Barrier() };
        using (var http = new HttpClient(sendHandler))
        using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(sendDir, "legacy.json")), new MeasurementIdFactory(),
            Identity(), () => true, () => true, fence => new ObservationLedgerStore(Path.Combine(sendDir, "obs.json"), fence),
            new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1),
            new ObservationSendOptions { RequestTimeoutMilliseconds = 50 }))
        {
            Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
            var bypass = 0;
            var result = await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(2), null,
                () => { bypass++; return Task.CompletedTask; }, CancellationToken.None);
            check("OH35", result.Status == ObservationSendStatus.TimedOut && !result.SafeToBypass && sendHandler.Calls == 1 && bypass == 0,
                "transport-start timeout cannot authorize a second POST");
            host.Stop();
            check("OH36", !host.Settlement.IsCompleted, "actual HTTP task remains owned beyond timeout");
            sendHandler.Release.TrySetResult(true);
            await Bounded(host.Settlement);
        }
    }

    private static async Task LegacyRequest(HttpClient http, string token, string body)
    {
        using (var request = new HttpRequestMessage(HttpMethod.Post, Endpoint))
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            using (await http.SendAsync(request)) { }
        }
    }

    private static async Task Concurrency(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("concurrent-first-store");
        var path = Path.Combine(dir, "observation.json");
        var calls = 0;
        var entered = Barrier();
        ObservationLedgerStore store = null;
        using (var release = new ManualResetEventSlim(false))
        using (var http = new HttpClient(new Handler()))
        using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")), new MeasurementIdFactory(),
            Identity(), () => true, () => true, fence =>
            {
                Interlocked.Increment(ref calls);
                entered.TrySetResult(true);
                if (!release.Wait(5000)) throw new TimeoutException("synthetic first-load barrier");
                return store = new ObservationLedgerStore(path, fence);
            }, new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
        {
            var old = host.Snapshot();
            var capture = Task.Run(() => { Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2); });
            await Bounded(entered.Task);
            var send = Task.Run(() => host.SendAsync(() => "{\"epoch\":7}", Endpoint, old, T0.AddMinutes(2), null,
                () => LegacyRequest(http, "synthetic-token", "{\"epoch\":7}"), CancellationToken.None));
            var pair = Task.Run(() => host.TransitionAsync(cancel =>
            {
                check("OH70", host.Coordinator.LeaseHeld, "concurrent Pair still owns the existing lease before adapter side effects");
                return Task.FromResult(Identity(8, "synthetic-new-token"));
            }, CancellationToken.None));
            release.Set();
            await Bounded(Task.WhenAll(capture, send, pair));
            check("OH71", calls == 1 && store != null && host.Coordinator.CurrentBinding.PairingGeneration == 8
                && object.ReferenceEquals(store.BindingFence.Current, host.Coordinator.CurrentBinding),
                "first capture/first send/Pair converge on exactly one real store and the very same fence object");
            var blocked = 0;
            await host.SendAsync(() => "{\"epoch\":7}", Endpoint, old, T0.AddMinutes(3), null,
                () => { blocked++; return Task.CompletedTask; }, CancellationToken.None);
            check("OH72", blocked == 0, "queued old identity cannot use the newly committed authorization");
        }

        foreach (var mode in new[] { "save-failed", "unknown-result", "unpair" })
        {
            var local = DirectoryFor(mode);
            var handler = new Handler();
            using (var http = new HttpClient(handler))
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(local, "legacy.json")), new MeasurementIdFactory(),
                Identity(), () => false, () => false, fence => { throw new InvalidOperationException("disabled provider"); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0))
            {
                var old = host.Snapshot();
                var result = await host.TransitionAsync(cancel =>
                {
                    check("OH73-" + mode, host.Coordinator.LeaseHeld, "first fake DPAPI/save/clear action is below shared transition lease");
                    if (mode == "save-failed") throw new IOException("synthetic commit/save failed; local rollback is not server rollback");
                    return Task.FromResult(mode == "unpair" ? new ObservationProducerIdentity(null,
                        new ObservationPairingBinding(null, null, 7, false)) : null);
                }, CancellationToken.None);
                await host.SendAsync(() => "{}", Endpoint, old, T0, null,
                    () => LegacyRequest(http, "synthetic-token", "{\"old\":true}"), CancellationToken.None);
                await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0, null,
                    () => LegacyRequest(http, "synthetic-token", "{\"new\":true}"), CancellationToken.None);
                check("OH74-" + mode, !host.Snapshot().HasAuthorization && handler.Calls == 0
                    && (mode == "unpair" ? result.Committed : !result.Committed),
                    "unknown/save-failed/Unpair leaves no old auth or authless POST, with actual request count zero");
            }
        }
    }

    private static async Task FinalBudgetAndKillRestart(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("final-budget");
        var path = Path.Combine(dir, "observation.json");
        var handler = new Handler { Response = "{\"measurements\":{\"laps\":{\"received\":1,\"stored\":true,\"accepted\":[],\"duplicates\":[],\"superseded\":[],\"rejected\":[{\"index\":0,\"reason\":\"observation_unavailable\",\"stage\":\"parser\"}]}}}" };
        using (var http = new HttpClient(handler))
        {
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")), new MeasurementIdFactory(),
                Identity(), () => true, () => true, fence => new ObservationLedgerStore(path, fence),
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                var bypass = 0;
                var result = await host.SendAsync(() => "{\"core\":\"É\"}", Endpoint, host.Snapshot(), T0.AddMinutes(2),
                    body => body + new string(' ', 24576 - Encoding.UTF8.GetByteCount(body)),
                    () => { bypass++; return Task.CompletedTask; }, CancellationToken.None);
                check("OH80", result != null && !result.SafeToBypass && handler.Calls == 1 && bypass == 0
                    && result.BodyBytes == 24576 && Encoding.UTF8.GetByteCount(handler.Body) == 24576,
                    "nonASCII mixed body + prefreeze finalizer hits exact 24576 UTF8 bytes, one POST (synthetic whitespace padding)");
                var second = await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(4),
                    body => body + new string(' ', 24577 - Encoding.UTF8.GetByteCount(body)),
                    () => { bypass++; return LegacyRequest(http, "synthetic-token", "{\"legacyOnly\":true}"); }, CancellationToken.None);
                check("OH81", second == null && handler.Calls == 2 && bypass == 1 && handler.Body == "{\"legacyOnly\":true}",
                    "24577 refused before envelope/transport, exactly one independent legacy/core POST, never OBS downgrade");
            }
            // A real prior store now contains deferred/pending records plus a valid backup.
            File.WriteAllText(path + ".tmp", "synthetic leftover evidence");
            var target = File.ReadAllBytes(path);
            var backup = File.ReadAllBytes(path + ".bak");
            var provider = 0;
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "kill-legacy.json")), new MeasurementIdFactory(),
                Identity(), () => false, () => true, fence => { provider++; return new ObservationLedgerStore(path, fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0))
            {
                host.Stop();
                await Bounded(host.Settlement);
            }
            check("OH82", provider == 0 && Encoding.UTF8.GetString(target).Contains("\"state\":\"deferred\"")
                && Convert.ToBase64String(File.ReadAllBytes(path)) == Convert.ToBase64String(target)
                && Convert.ToBase64String(File.ReadAllBytes(path + ".bak")) == Convert.ToBase64String(backup)
                && File.ReadAllText(path + ".tmp") == "synthetic leftover evidence" && !File.Exists(path + ".preserved"),
                "kill over restart leaves actual deferred/backup/temp bytes untouched, with zero provider/filesystem calls");
        }
    }

    private sealed class Faults : IObservationLedgerFaults
    {
        public bool Before;
        public bool After;
        public bool ReadBlocked;
        public void BeforePreserve() { }
        public void BeforeSwitch() { if (Before) throw new IOException("synthetic before-switch"); }
        public void AfterSwitch()
        {
            if (!After) return;
            ReadBlocked = true;
            throw new IOException("synthetic uncertain switch");
        }
    }

    private sealed class Files : IObservationLedgerFileSystem
    {
        private readonly IObservationLedgerFileSystem _real = new ObservationLedgerFileSystem();
        private readonly Faults _faults;
        public Files(Faults faults) { _faults = faults; }
        public bool Exists(string path) { return _real.Exists(path); }
        public long Length(string path) { return _real.Length(path); }
        public byte[] ReadAllBytes(string path)
        { if (_faults.ReadBlocked) throw new IOException("synthetic unreadable readback"); return _real.ReadAllBytes(path); }
        public void WriteTemporary(string path, byte[] bytes) { _real.WriteTemporary(path, bytes); }
        public void Replace(string temp, string target, string backup) { _real.Replace(temp, target, backup); }
        public void Move(string temp, string target) { _real.Move(temp, target); }
        public void Delete(string path) { _real.Delete(path); }
        public void Preserve(string source, string target) { _real.Preserve(source, target); }
    }

    private static void StorageFaults(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "before", "uncertain", "corrupt", "quota" })
        {
            var dir = DirectoryFor(mode);
            var path = Path.Combine(dir, "observation.json");
            if (mode == "corrupt") File.WriteAllText(path, "synthetic corrupt target");
            var faults = new Faults { Before = mode == "before", After = mode == "uncertain" };
            var outbox = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            ObservationLedgerStore store = null;
            var enabled = true;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(outbox, new MeasurementIdFactory(), Identity(), () => enabled, () => true,
                fence => store = new ObservationLedgerStore(path, fence,
                    new ObservationLedgerOptions { MaxEntries = mode == "quota" ? 1 : 64 }, new Files(faults), faults),
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                var candidate = host.PendingCandidate;
                if (mode == "before")
                {
                    check("OH50", candidate != null && store.ReservationCount == 1 && outbox.LapCount == 0,
                        "NotCommitted keeps one exact reserved candidate; no dual publish");
                    var bytes = candidate.RowJson;
                    faults.Before = false;
                    Tick(host, 3, 2);
                    var entry = store.Find(candidate.Uid, candidate.RecordRevision);
                    check("OH51", host.PendingCandidate == null && entry != null && entry.RowJson == bytes && store.ReservationCount == 0 && outbox.LapCount == 0,
                        "actual retry adopts original UID/revision/RowJson; normal ID factory not called again");
                }
                else if (mode == "uncertain")
                {
                    var uid = candidate == null ? null : candidate.Uid;
                    var bytes = candidate == null ? null : candidate.RowJson;
                    Tick(host, 3, 3); Tick(host, 4, 4);
                    check("OH52", candidate != null && store.IsFailedClosed && object.ReferenceEquals(candidate, host.PendingCandidate)
                        && store.ReservationCount == 1 && outbox.LapCount == 0, "unreadable post-switch outcome blocks new OBS, bounded at one original candidate/reservation");
                    var disk = new ObservationLedgerStore(path, new ObservationBindingFence(Identity().Binding));
                    check("OH53", uid != null && disk.Find(uid, candidate.RecordRevision).RowJson == bytes,
                        "real committed disk bytes survive uncertain readback; no fabricated fallback identity");
                    enabled = false;
                    Tick(host, 5, 5); host.EndSession("session_end");
                    check("OH54", object.ReferenceEquals(candidate, host.PendingCandidate) && outbox.LapCount > 0,
                        "kill does not erase pending evidence; independent legacy pipeline still works");
                }
                else if (mode == "corrupt")
                {
                    check("OH55", store.IsFailedClosed && File.Exists(path + ".preserved") && host.PendingCandidate != null && outbox.LapCount == 0,
                        "eligible positive control initializes real store and preserves corruption normally, without fallback");
                }
                else
                {
                    Tick(host, 3, 2); Tick(host, 4, 3);
                    var due = outbox.Due(T0.AddMinutes(2), 20, 3);
                    check("OH56", store.EntryCount == 1 && store.ReservationCount == 0 && outbox.LapCount == 1 && host.PendingCandidate == null
                        && !due.Laps[0].RowJson.Contains("\"observation\"") && due.Laps[0].Uid != store.Entries[0].Uid,
                        "definitive quota refusal creates a fresh legacy row from source, never strips/reuses the captured OBS identity");
                }
            }
        }
    }

    private static void GoldenOff(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("golden-off");
        Func<MeasurementIdFactory> ids = () =>
        {
            var next = 0;
            return new MeasurementIdFactory(() => new Guid("00000000-0000-4000-8000-" + (++next).ToString("D12", System.Globalization.CultureInfo.InvariantCulture)));
        };
        var oldOutbox = new MeasurementOutbox(Path.Combine(dir, "old.json"));
        var newOutbox = new MeasurementOutbox(Path.Combine(dir, "new.json"));
        var oldPipeline = new MeasurementPipeline(oldOutbox, ids());
        using (var http = new HttpClient(new Handler()))
        using (var host = new ObservationProducerHost(newOutbox, ids(), Identity(), () => false, () => true,
            fence => { throw new InvalidOperationException("disabled golden must never initialize"); },
            new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0))
        {
            for (var tick = 0; tick < 4; tick++)
            {
                var sample = new TelemetrySample { ObservedAtUtc = T0.AddSeconds(tick), SdkTick = tick,
                    SessionTimeSeconds = tick, LapNumber = tick < 2 ? 1 : 2, OnPitRoad = tick == 1,
                    FuelLitres = 50 - tick, CurrentDriverName = "Één", ObservedSessionId = "sim-42-s3" };
                oldPipeline.Observe(sample);
                var current = new TelemetrySample { ObservedAtUtc = sample.ObservedAtUtc, SdkTick = sample.SdkTick,
                    SessionTimeSeconds = sample.SessionTimeSeconds, LapNumber = sample.LapNumber, OnPitRoad = sample.OnPitRoad,
                    FuelLitres = sample.FuelLitres, CurrentDriverName = sample.CurrentDriverName, ObservedSessionId = sample.ObservedSessionId };
                host.BindSample(current, null);
                host.Observe(current);
            }
            oldPipeline.End("session_end"); host.EndSession("session_end");
            var oldSender = new MeasurementSender(oldOutbox, http, () => "{}", null);
            var newSender = new MeasurementSender(newOutbox, http, () => "{}", null);
            MeasurementBatchPlan oldPlan, newPlan;
            var core = "{\"protocolVersion\":3,\"core\":\"É\"}";
            var oldBody = oldSender.BuildBody(core, Encoding.UTF8.GetByteCount(core), T0.AddMinutes(1), out oldPlan);
            var newBody = newSender.BuildBody(core, Encoding.UTF8.GetByteCount(core), T0.AddMinutes(1), out newPlan);
            var pace = new PaceCaptureFrame { ObservedSessionId = "sim-42-s3", SegmentId = "synthetic-segment" };
            oldBody = PaceCaptureBuffer.AppendWithinBudget(oldBody, pace);
            newBody = PaceCaptureBuffer.AppendWithinBudget(newBody, pace);
            check("OH60", oldBody == newBody && oldPlan.Batch.Laps.Count == newPlan.Batch.Laps.Count && !newBody.Contains("\"observation\""),
                "deterministic IDs/timestamps: old pipeline vs actual disabled host identical UTF8 legacy body");
            File.WriteAllText(Path.Combine(dir, "default-off-golden.json"), newBody, new UTF8Encoding(false));
            var oldAck = oldOutbox.ApplyAck(MeasurementAckParser.Parse(AckAll(oldBody), oldPlan.Batch), T0.AddMinutes(2));
            var newAck = newOutbox.ApplyAck(MeasurementAckParser.Parse(AckAll(newBody), newPlan.Batch), T0.AddMinutes(2));
            check("OH61", oldOutbox.LapCount == newOutbox.LapCount && oldAck.Stored == newAck.Stored,
                "unchanged legacy parser and ACK effect agree for deterministic old/new body");
        }
    }

    private static void Epochs(Action<string, bool, string> check)
    {
        var settings = new ConnectorSettings { DeviceId = Device, BoundOwnerUserId = Owner };
        check("OH40", !settings.ObservationEnabled && !settings.ObservationBinding().IsComplete && settings.NextObservationGeneration() == null,
            "default/missing generation is not known zero");
        settings.ObservationPairingGenerationKnown = true;
        check("OH41", !settings.ObservationBinding().IsComplete && settings.NextObservationGeneration() == null, "known bit without value is incomplete");
        settings.ObservationPairingGeneration = -1;
        check("OH42", !settings.ObservationBinding().IsComplete && settings.NextObservationGeneration() == null, "negative metadata failclosed");
        settings.ObservationPairingGeneration = 9007199254740991L;
        check("OH43", settings.NextObservationGeneration() == null, "overflow cannot wrap/reuse epoch");
        settings.ObservationPairingGeneration = 7;
        check("OH44", settings.NextObservationGeneration() == 8, "proven persisted high-watermark advances monotonically");
    }

    private const string NewDevice = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    private const string OtherDevice = "cccccccc-dddd-4eee-8fff-000000000000";
    private static readonly string OldPairToken = new string('a', 43);
    private static readonly string NewPairToken = new string('b', 43);

    private static ConnectorSettings PairedSettings()
    {
        return new ConnectorSettings { DeviceId = Device, BoundOwnerUserId = Owner,
            DeviceTokenProtected = "synthetic-protected-old", UseCentralRelay = true,
            BoundRaceId = "old-race", BoundTeamId = "old-team" };
    }

    private static ConnectorSettings Restart(ConnectorSettings settings)
    {
        return SettingsCompatibilityTests.Deserialize(SettingsCompatibilityTests.Serialize(settings));
    }

    private static void PairMetadata(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "absent", "zero", "known", "null-known", "present-unknown", "negative", "max", "overflow", "poison" })
        {
            var settings = PairedSettings();
            settings.ObservationPairingGeneration = mode == "zero" ? 0 : mode == "known" || mode == "present-unknown" ? 7
                : mode == "negative" ? -1 : mode == "max" ? 9007199254740991L : mode == "overflow" ? long.MaxValue : (long?)null;
            settings.ObservationPairingGenerationKnown = mode != "absent" && mode != "present-unknown" && mode != "poison";
            settings.ObservationPairingGenerationPoisoned = mode == "poison";
            var original = settings.ObservationPairingGeneration;
            var expected = mode == "absent" || mode == "zero" ? 1 : mode == "known" ? 8 : (long?)null;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0) settings = Restart(settings);
                var token = settings.CommitNewPair(attempt % 2 == 0 ? NewDevice : Device, Owner,
                    NewPairToken, OldPairToken, raw => "synthetic-protected", () => { }, error => { });
                check("PAIR-meta-" + mode + "-" + attempt, token == NewPairToken
                    && settings.ObservationPairingGenerationKnown == expected.HasValue
                    && settings.ObservationPairingGeneration == (expected ?? original)
                    && (mode != "null-known" || settings.ObservationPairingGenerationPoisoned),
                    "actual commit preserves refusal evidence across repeated Pair and serializer restart; legacy Pair succeeds independently");
                if (expected.HasValue) expected++;
            }
        }
        foreach (var mode in new[] { "same-device", "case-device", "same-token" })
        {
            var settings = PairedSettings();
            settings.CommitNewPair(mode == "same-device" ? Device : mode == "case-device" ? Device.ToUpperInvariant() : NewDevice,
                Owner, mode == "same-token" ? OldPairToken : NewPairToken, OldPairToken,
                raw => "synthetic-protected", () => { }, error => { });
            check("PAIR-not-fresh-" + mode, !settings.ObservationPairingGenerationKnown && !settings.ObservationPairingGeneration.HasValue,
                "syntactic success does not certify freshness; UUID comparison is case-insensitive and raw tokens exact");
        }
    }

    private static async Task FreshPair(Action<string, bool, string> check)
    {
        foreach (var changedOwner in new[] { false, true })
        {
            var dir = DirectoryFor("fresh-pair-" + changedOwner);
            var settings = PairedSettings();
            var memoryToken = OldPairToken;
            var path = Path.Combine(dir, "settings.json");
            var owner = changedOwner ? "22222222-3333-4444-8555-666666666666" : Owner;
            var calls = 0; var order = string.Empty;
            ObservationLedgerStore store = null;
            var legacy = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(),
                new ObservationProducerIdentity(memoryToken, settings.ObservationBinding()), () => true, () => true,
                fence => { calls++; return store = new ObservationLedgerStore(Path.Combine(dir, "obs.json"), fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1);
                check("PAIR-historical-" + changedOwner, calls == 0 && !Restart(settings).ObservationBinding().IsComplete
                    && !settings.ObservationEnabled && settings.NextObservationGeneration() == null,
                    "paired historical load/restart/decrypted memory token cannot adopt missing generation or access sidecar");
                var old = host.Snapshot();
                var result = await host.TransitionAsync(cancel =>
                {
                    memoryToken = settings.CommitNewPair(NewDevice, owner, NewPairToken, memoryToken, raw =>
                    {
                        order += "protect;";
                        check("PAIR-protect-order-" + changedOwner, host.Coordinator.LeaseHeld && !host.Snapshot().HasAuthorization
                            && memoryToken == OldPairToken && settings.DeviceId == Device && raw == NewPairToken,
                            "real commit protection is below lease, before settings/memory publication, and protects the NEW raw token");
                        return "synthetic-protected-new";
                    }, () =>
                    {
                        order += "save;";
                        check("PAIR-save-order-" + changedOwner, memoryToken == OldPairToken && !host.Snapshot().HasAuthorization
                            && settings.DeviceId == NewDevice && settings.BoundOwnerUserId == owner
                            && settings.DeviceTokenProtected == "synthetic-protected-new" && settings.UseCentralRelay
                            && settings.BoundRaceId == "" && settings.BoundTeamId == ""
                            && settings.ObservationPairingGeneration == 1 && settings.ObservationPairingGenerationKnown,
                            "combined real commit state saved before raw token/identity publication");
                        File.WriteAllText(path, SettingsCompatibilityTests.Serialize(settings));
                    }, error => { });
                    return Task.FromResult(new ObservationProducerIdentity(memoryToken, settings.ObservationBinding()));
                }, CancellationToken.None);
                var disk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
                check("PAIR-fresh-" + changedOwner, result.Committed && order == "protect;save;" && disk.ObservationBinding().IsComplete
                    && !disk.ObservationEnabled && !settings.ObservationEnabled
                    && disk.DeviceId == NewDevice && disk.BoundOwnerUserId == owner && memoryToken == NewPairToken
                    && host.Snapshot().Binding.PairingGeneration == 1, "durable new composite fence, same/new owner; local initialization only");
                var blocked = 0;
                await host.SendAsync(() => "{}", Endpoint, old, T0, null,
                    () => { blocked++; return Task.CompletedTask; }, CancellationToken.None);
                Tick(host, 2, 1); Tick(host, 3, 2);
                check("PAIR-unknown-start-" + changedOwner, blocked == 0 && calls == 0 && legacy.LapCount == 1,
                    "old identity queued work rejected; unknown-start lap not upgraded at close");
                Tick(host, 4, 2); Tick(host, 5, 3);
                check("PAIR-future-start-" + changedOwner, calls == 1 && store.EntryCount == 1 && legacy.LapCount == 1
                    && store.Entries[0].RowJson.Contains(NewDevice), "only future StartLap eligible with independent synthetic policy/readiness gates");
            }
        }
    }

    private static async Task PairFailures(Action<string, bool, string> check)
    {
        foreach (var history in new[] { "absent", "known", "null-known", "present-unknown", "negative", "max", "overflow" })
        foreach (var failure in new[] { "protect", "save", "rollback", "cancel" })
        {
            var settings = PairedSettings();
            settings.ObservationPairingGeneration = history == "known" || history == "present-unknown" ? 7
                : history == "negative" ? -1 : history == "max" ? 9007199254740991L : history == "overflow" ? long.MaxValue : (long?)null;
            settings.ObservationPairingGenerationKnown = history != "absent" && history != "present-unknown";
            var original = settings.ObservationPairingGeneration;
            var dir = DirectoryFor("pair-fail-" + history + "-" + failure);
            var file = Path.Combine(dir, "settings.json");
            var memoryToken = OldPairToken; var saves = 0; var rollbackFailures = 0;
            string lastSaveJson = null; var seamKnown = true; var seamDevice = (string)null; var seamProtected = (string)null;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")), new MeasurementIdFactory(),
                new ObservationProducerIdentity(memoryToken, settings.ObservationBinding()), () => false, () => false,
                fence => { throw new InvalidOperationException("disabled"); }, new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0))
            {
                var result = await host.TransitionAsync(cancel =>
                {
                    try
                    {
                        memoryToken = settings.CommitNewPair(NewDevice, Owner, NewPairToken, memoryToken,
                            raw => { if (failure == "protect") throw new IOException("synthetic protect"); return "synthetic-protected-new"; },
                            () =>
                            {
                                saves++;
                                lastSaveJson = SettingsCompatibilityTests.Serialize(settings);
                                if (failure == "cancel") throw new OperationCanceledException();
                                if (failure == "rollback" || (failure == "save" && saves == 1)) throw new IOException("synthetic save");
                                File.WriteAllText(file, SettingsCompatibilityTests.Serialize(settings));
                            }, error => { rollbackFailures++; });
                        return Task.FromResult(new ObservationProducerIdentity(memoryToken, settings.ObservationBinding()));
                    }
                    catch
                    {
                        seamKnown = settings.ObservationPairingGenerationKnown;
                        seamDevice = settings.DeviceId;
                        seamProtected = settings.DeviceTokenProtected;
                        // Same conservative invalidation used by PairCoreAsync's outer catch.
                        memoryToken = string.Empty;
                        settings.DeviceTokenProtected = settings.DeviceId = settings.BoundOwnerUserId = string.Empty;
                        settings.InvalidateObservationGeneration();
                        return Task.FromResult<ObservationProducerIdentity>(null);
                    }
                }, CancellationToken.None);
                var attempted = failure != "protect" && (history == "absent" || history == "known");
                var expectedRaw = attempted ? (history == "absent" ? 1 : 8) : original;
                var lastSave = lastSaveJson == null ? null : SettingsCompatibilityTests.Deserialize(lastSaveJson);
                check("PAIR-fail-" + history + "-" + failure, !result.Committed && !host.Snapshot().HasAuthorization
                    && memoryToken == "" && !settings.ObservationPairingGenerationKnown
                    && settings.ObservationPairingGeneration == expectedRaw
                    && (history != "null-known" || settings.ObservationPairingGenerationPoisoned)
                    && rollbackFailures == (failure == "rollback" || failure == "cancel" ? 1 : 0)
                    && !seamKnown && seamDevice == Device && seamProtected == "synthetic-protected-old"
                    && lastSave != null && lastSave.DeviceId == Device
                    && lastSave.DeviceTokenProtected == "synthetic-protected-old"
                    && !lastSave.ObservationPairingGenerationKnown
                    && lastSave.ObservationPairingGeneration == expectedRaw,
                    "actual protect/save/rollback-save/cancel failure preserves raw evidence and never publishes/restores OBS authority");
                settings = Restart(settings);
                settings.CommitNewPair(NewDevice, Owner, NewPairToken, memoryToken, raw => "synthetic-new", () => { }, error => { });
                // Former expectation: only the pristine protect failure could ever retry and
                // every refused/attempted history stayed permanently unknown. That lockout is
                // exactly the defect under repair: proven or genuinely attempted high-watermarks
                // now recover as a strict successor, invalid/lost-provenance history stays closed.
                var recovers = history == "absent" || history == "known";
                var recoveredRaw = history == "absent" ? (failure == "protect" ? 1 : 2)
                    : (failure == "protect" ? 8 : 9);
                check("PAIR-fail-repeat-" + history + "-" + failure,
                    recovers ? settings.ObservationPairingGenerationKnown
                        && settings.ObservationPairingGeneration == recoveredRaw
                        : !settings.ObservationPairingGenerationKnown
                        && settings.ObservationPairingGeneration == original,
                    "later genuine Pair recovers only proven/recoverable evidence by one strict successor; invalid/lost-provenance history stays closed");
            }
        }
    }

    private static async Task LatePairCommit(Action<string, bool, string> check)
    {
        foreach (var outcome in new[] { "committed", "unknown" })
        {
            var dir = DirectoryFor("late-real-pair-" + outcome);
            var settings = PairedSettings();
            var entered = Barrier(); var release = Barrier();
            var memory = OldPairToken; var saves = 0;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")), new MeasurementIdFactory(),
                new ObservationProducerIdentity(memory, settings.ObservationBinding()), () => false, () => false,
                fence => { throw new InvalidOperationException("disabled"); }, new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0,
                new ObservationSendOptions { PairTransitionTimeoutMilliseconds = 50 }))
            {
                var old = host.Snapshot();
                var pair = host.TransitionAsync(cancel =>
                {
                    try
                    {
                        memory = settings.CommitNewPair(NewDevice, Owner, NewPairToken, memory, raw => "synthetic-protected", () =>
                        {
                            saves++;
                            entered.TrySetResult(true);
                            if (!release.Task.Wait(5000)) throw new TimeoutException("synthetic delayed save");
                            // A switched file followed by an exception cannot certify commit.
                            if (saves == 1) File.WriteAllText(Path.Combine(dir, "settings.json"), SettingsCompatibilityTests.Serialize(settings));
                            if (outcome == "unknown") throw new IOException("synthetic unknown save and rollback outcome");
                        }, error => { });
                        return Task.FromResult(new ObservationProducerIdentity(memory, settings.ObservationBinding()));
                    }
                    catch
                    {
                        memory = string.Empty;
                        settings.InvalidateObservationGeneration();
                        return Task.FromResult<ObservationProducerIdentity>(null);
                    }
                }, CancellationToken.None);
                await Bounded(entered.Task); await Bounded(pair);
                check("PAIR-late-timeout-" + outcome, pair.Result.Status == ObservationPairTransitionStatus.TimedOut
                    && host.Coordinator.LeaseHeld && !host.Snapshot().HasAuthorization && memory == OldPairToken,
                    "actual production commit save is still running after public cancellation/timeout; no early publication");
                var sends = 0;
                await host.SendAsync(() => "{}", Endpoint, old, T0, null,
                    () => { sends++; return Task.CompletedTask; }, CancellationToken.None);
                host.Stop();
                check("PAIR-late-owned-" + outcome, sends == 0 && !host.Settlement.IsCompleted && host.Coordinator.LeaseHeld,
                    "actual unsettled save retains lease/lifetime; queued old object cannot send");
                release.TrySetResult(true); await Bounded(host.Settlement);
                check("PAIR-late-terminal-" + outcome, !host.Coordinator.LeaseHeld
                    && (outcome == "committed" ? host.Coordinator.CurrentBinding.PairingGeneration == 1
                        && host.Coordinator.CurrentBinding.PairingGenerationKnown && memory == NewPairToken
                        : !host.Snapshot().HasAuthorization && !settings.ObservationPairingGenerationKnown
                            && settings.ObservationPairingGeneration == 1 && memory == "" && saves == 2),
                    "only proven terminal durable commit publishes; unknown switched-file plus failed rollback never certifies authority");
                if (outcome == "unknown")
                {
                    settings.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
                        raw => "synthetic-protected-retry", () => { }, error => { });
                    check("PAIR-late-recover", settings.ObservationPairingGenerationKnown
                        && settings.ObservationPairingGeneration == 2 && settings.ObservationBinding().IsComplete,
                        "unknown terminal save plus failed rollback retains attempted high-watermark 1; only a later real Pair advances to 2");
                }
            }
        }
    }

    private static async Task PairStoredFences(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("pair-stored-fences");
        var path = Path.Combine(dir, "obs.json");
        ObservationLedgerEntry frozen;
        using (var http = new HttpClient(new Handler()))
        {
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy-a.json")), new MeasurementIdFactory(),
                Identity(1, OldPairToken), () => true, () => true, fence => new ObservationLedgerStore(path, fence),
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                frozen = new ObservationLedgerStore(path, new ObservationBindingFence(host.Snapshot().Binding)).Entries[0];
            }
            // Historical A settings have no generation; new B/1 must not adopt A/1 rows.
            var settings = PairedSettings(); var memory = OldPairToken;
            ObservationLedgerStore store = null;
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy-b.json")), new MeasurementIdFactory(),
                new ObservationProducerIdentity(memory, settings.ObservationBinding()), () => true, () => true,
                fence => store = new ObservationLedgerStore(path, fence), new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                var old = host.Snapshot();
                await host.TransitionAsync(cancel =>
                {
                    memory = settings.CommitNewPair(NewDevice, Owner, NewPairToken, memory, raw => "synthetic-protected", () => { }, error => { });
                    return Task.FromResult(new ObservationProducerIdentity(memory, settings.ObservationBinding()));
                }, CancellationToken.None);
                await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(2), null, () => Task.CompletedTask, CancellationToken.None);
                var retained = store.Find(frozen.Uid, frozen.RecordRevision);
                check("PAIR-old-stored-row", retained != null && retained.RowJson == frozen.RowJson
                    && retained.State == ObservationLedgerState.Quarantine && store.ReservationCount == 0,
                    "restart A/1 -> actual B/1 commit preserves exact UID/revision/RowJson and quarantines instead of relabel/send");
                await host.TransitionAsync(cancel =>
                {
                    memory = settings.CommitNewPair(Device, Owner, OldPairToken, memory, raw => "synthetic-old-reply", () => { }, error => { });
                    return Task.FromResult(new ObservationProducerIdentity(memory, settings.ObservationBinding()));
                }, CancellationToken.None);
                var sends = 0;
                await host.SendAsync(() => "{}", Endpoint, old, T0.AddMinutes(3), null,
                    () => { sends++; return Task.CompletedTask; }, CancellationToken.None);
                retained = store.Find(frozen.Uid, frozen.RecordRevision);
                check("PAIR-returned-old-identity", sends == 0 && settings.ObservationPairingGeneration == 2
                    && retained.State == ObservationLedgerState.Quarantine && retained.RowJson == frozen.RowJson,
                    "B -> attempted old A is prospective A/2, not global UUID history; old object and quarantined A/1 never resurrect");
            }
        }
    }

    private static string SettingsJson(ConnectorSettings settings)
    {
        return SettingsCompatibilityTests.Serialize(settings);
    }

    // Persisted provenance is part of the settings contract, so the assertion reads the
    // serialized bytes like an older/newer build would, not a private in-memory detail.
    private static bool HasRecoverableMarker(string json)
    {
        return json.Contains("\"ObservationPairingGenerationRecoverable\":true");
    }

    private static ConnectorSettings KnownGeneration(int generation)
    {
        return new ConnectorSettings
        {
            DeviceId = Device, BoundOwnerUserId = Owner, DeviceTokenProtected = "synthetic-protected-old",
            UseCentralRelay = true, ObservationPairingGeneration = generation,
            ObservationPairingGenerationKnown = true
        };
    }

    // Regression: a mistyped code / precommit Pair failure must not permanently disable the
    // local counter. Recovery is only the strict successor of proven, retained evidence on a
    // genuinely fresh durable Pair - never a reset to 1 and never a restored binding.
    private static async Task PairRecovery(Action<string, bool, string> check)
    {
        var dir = DirectoryFor("pair-recovery");
        var path = Path.Combine(dir, "settings.json");
        var ledger = Path.Combine(dir, "obs.json");
        var settings = KnownGeneration(1);
        File.WriteAllText(path, SettingsJson(settings));
        var handler = new Handler { Reply = AckAll };
        ObservationLedgerStore store = null;
        ObservationLedgerEntry frozen = null;
        var memory = OldPairToken;
        using (var http = new HttpClient(handler))
        {
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy-a.json")),
                new MeasurementIdFactory(), new ObservationProducerIdentity(memory, settings.ObservationBinding()),
                () => true, () => true, fence => store = new ObservationLedgerStore(ledger, fence),
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                frozen = store != null && store.Entries.Count == 1 ? store.Entries[0] : null;
                check("PAIR-recover-healthy", frozen != null && frozen.RowJson.Contains(Device)
                    && host.Snapshot().Binding.PairingGeneration == 1 && host.Snapshot().HasAuthorization,
                    "healthy known generation 1 captures one real row under the original authorization");
                var old = host.Snapshot();
                var invalidation = await host.TransitionAsync(cancel =>
                {
                    try
                    {
                        // Same seam as PairCoreAsync: validated exchange, then the real
                        // protect/combined-save commit under the shared lease.
                        memory = settings.CommitNewPair(NewDevice, Owner, NewPairToken, memory,
                            raw => { throw new IOException("synthetic mistyped-code/precommit failure"); },
                            () => File.WriteAllText(path, SettingsJson(settings)), error => { });
                        return Task.FromResult(new ObservationProducerIdentity(memory, settings.ObservationBinding()));
                    }
                    catch
                    {
                        // Same conservative invalidation as PairCoreAsync's ForgetUnprovenAuthorization.
                        memory = string.Empty;
                        settings.DeviceTokenProtected = settings.DeviceId = settings.BoundOwnerUserId = string.Empty;
                        settings.InvalidateObservationGeneration();
                        File.WriteAllText(path, SettingsJson(settings));
                        return Task.FromResult<ObservationProducerIdentity>(null);
                    }
                }, CancellationToken.None);
                var disk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
                check("PAIR-recover-invalidated", !invalidation.Committed && !host.Snapshot().HasAuthorization
                    && memory == string.Empty && disk.DeviceId == string.Empty && disk.DeviceTokenProtected == string.Empty
                    && !disk.ObservationPairingGenerationKnown && disk.ObservationPairingGeneration == 1
                    && HasRecoverableMarker(File.ReadAllText(path)),
                    "actual precommit failure caller clears authorization but durably retains raw 1 plus the recoverable provenance marker");
                var sends = 0;
                await host.SendAsync(() => "{}", Endpoint, old, T0.AddMinutes(2), null,
                    () => { sends++; return Task.CompletedTask; }, CancellationToken.None);
                check("PAIR-recover-old-auth", sends == 0 && handler.Calls == 0,
                    "old in-memory authorization can never POST after the failed Pair, whatever metadata remains");
                host.Stop();
                await Bounded(host.Settlement);
            }
            var restarted = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            ObservationLedgerStore store2 = null;
            var memory2 = string.Empty;
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy-b.json")),
                new MeasurementIdFactory(), new ObservationProducerIdentity(memory2, restarted.ObservationBinding()),
                () => true, () => true, fence => store2 = new ObservationLedgerStore(ledger, fence),
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(3)))
            {
                var closed = host.Snapshot();
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                check("PAIR-recover-restart-closed", store2 == null && !restarted.ObservationBinding().IsComplete
                    && restarted.NextObservationGeneration() == null && !closed.HasAuthorization,
                    "restart with retained raw 1 and no authorization grants nothing: no store, no capture, no generic next generation");
                var order = string.Empty;
                var result = await host.TransitionAsync(cancel =>
                {
                    memory2 = restarted.CommitNewPair(NewDevice, Owner, NewPairToken, memory2, raw =>
                    {
                        order += "protect;";
                        check("PAIR-recover-protect", host.Coordinator.LeaseHeld && !host.Snapshot().HasAuthorization
                            && memory2 == string.Empty && restarted.DeviceId == string.Empty && raw == NewPairToken,
                            "recovery protect runs below the lease before any memory or durable publication");
                        return "synthetic-protected-recovered";
                    }, () =>
                    {
                        order += "save;";
                        check("PAIR-recover-save", memory2 == string.Empty && !host.Snapshot().HasAuthorization
                            && restarted.DeviceId == NewDevice && restarted.ObservationPairingGeneration == 2
                            && restarted.ObservationPairingGenerationKnown
                            && restarted.DeviceTokenProtected == "synthetic-protected-recovered",
                            "combined durable save stores strict successor 2 with device/owner/token before publication");
                        File.WriteAllText(path, SettingsJson(restarted));
                    }, error => { });
                    return Task.FromResult(new ObservationProducerIdentity(memory2, restarted.ObservationBinding()));
                }, CancellationToken.None);
                var durable = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
                check("PAIR-recover-successor", result.Committed && order == "protect;save;" && memory2 == NewPairToken
                    && durable.DeviceId == NewDevice && durable.DeviceTokenProtected == "synthetic-protected-recovered"
                    && durable.ObservationPairingGeneration == 2 && durable.ObservationPairingGenerationKnown
                    && durable.ObservationBinding().IsComplete && !durable.ObservationEnabled
                    && host.Snapshot().Binding.PairingGeneration == 2,
                    "genuinely fresh Pair durably publishes strict successor 2 (never a new 1) only after the combined save");
                var stale = 0;
                await host.SendAsync(() => "{}", Endpoint, closed, T0.AddMinutes(4), null,
                    () => { stale++; return Task.CompletedTask; }, CancellationToken.None);
                check("PAIR-recover-stale-closed", stale == 0 && handler.Calls == 0,
                    "the pre-restart unauthenticated object stays unusable; recovery does not revive it");
                Tick(host, 10, 1); Tick(host, 11, 1); Tick(host, 12, 2);
                ObservationLedgerEntry fresh = null;
                if (store2 != null)
                    foreach (var entry in store2.Entries)
                        if (entry.RowJson.Contains(NewDevice)) fresh = entry;
                check("PAIR-recover-fresh-lap", fresh != null && host.Snapshot().Binding.PairingGeneration == 2,
                    "only after the recovered commit does a fresh later lap capture under the new device/binding");
                var bypass = 0;
                await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(5), null,
                    () => { bypass++; return Task.CompletedTask; }, CancellationToken.None);
                var retained = store2 == null || frozen == null ? null : store2.Find(frozen.Uid, frozen.RecordRevision);
                check("PAIR-recover-old-row", retained != null && retained.RowJson == frozen.RowJson
                    && retained.RecordRevision == frozen.RecordRevision && retained.Uid == frozen.Uid
                    && retained.State == ObservationLedgerState.Quarantine && bypass == 0,
                    "the old A/1 row cannot be sent or resurrected: exact UID/revision/RowJson quarantine under the replacement binding");
                host.Stop();
                await Bounded(host.Settlement);
            }
        }
    }

    // Every failure mode of the same commit seam must keep the evidence and recover only
    // through a later real Pair, with a monotone attempted high-watermark.
    private static async Task PairRecoveryFailures(Action<string, bool, string> check)
    {
        foreach (var failure in new[] { "protect", "save", "rollback", "cancel" })
        {
            var dir = DirectoryFor("pair-recover-fail-" + failure);
            var path = Path.Combine(dir, "settings.json");
            var settings = KnownGeneration(1);
            File.WriteAllText(path, SettingsJson(settings));
            var memory = OldPairToken;
            var handler = new Handler();
            var saves = 0; var rollbackFailures = 0; var lastSaveJson = (string)null;
            var attempted = failure == "protect" ? 1 : 2;
            using (var http = new HttpClient(handler))
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy.json")),
                new MeasurementIdFactory(), new ObservationProducerIdentity(memory, settings.ObservationBinding()),
                () => false, () => false, fence => { throw new InvalidOperationException("disabled"); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0))
            {
                var old = host.Snapshot();
                var result = await host.TransitionAsync(cancel =>
                {
                    try
                    {
                        memory = settings.CommitNewPair(NewDevice, Owner, NewPairToken, memory,
                            raw => { if (failure == "protect") throw new IOException("synthetic protect"); return "synthetic-protected-next"; },
                            () =>
                            {
                                saves++;
                                lastSaveJson = SettingsJson(settings);
                                if (failure == "cancel") throw new OperationCanceledException();
                                if (failure == "rollback" || (failure == "save" && saves == 1)) throw new IOException("synthetic save");
                                File.WriteAllText(path, SettingsJson(settings));
                            }, error => { rollbackFailures++; });
                        return Task.FromResult(new ObservationProducerIdentity(memory, settings.ObservationBinding()));
                    }
                    catch
                    {
                        memory = string.Empty;
                        settings.DeviceTokenProtected = settings.DeviceId = settings.BoundOwnerUserId = string.Empty;
                        settings.InvalidateObservationGeneration();
                        File.WriteAllText(path, SettingsJson(settings));
                        return Task.FromResult<ObservationProducerIdentity>(null);
                    }
                }, CancellationToken.None);
                var lastSave = lastSaveJson == null ? null : SettingsCompatibilityTests.Deserialize(lastSaveJson);
                check("PAIR-recover-fail-" + failure, !result.Committed && !host.Snapshot().HasAuthorization
                    && memory == string.Empty && !settings.ObservationPairingGenerationKnown
                    && settings.ObservationPairingGeneration == attempted
                    && lastSave != null && !lastSave.ObservationPairingGenerationKnown
                    && lastSave.ObservationPairingGeneration == attempted
                    && lastSave.DeviceId == Device && lastSave.DeviceTokenProtected == "synthetic-protected-old"
                    && rollbackFailures == (failure == "rollback" || failure == "cancel" ? 1 : 0)
                    && HasRecoverableMarker(File.ReadAllText(path)),
                    "protect/save/rollback-save/cancel retains the attempted high-watermark and durable proof, never publishing authority");
                var sends = 0;
                await host.SendAsync(() => "{}", Endpoint, old, T0, null,
                    () => { sends++; return Task.CompletedTask; }, CancellationToken.None);
                check("PAIR-recover-fail-post-" + failure, sends == 0 && handler.Calls == 0,
                    "no old identity POST after the failed Pair");
                host.Stop();
                await Bounded(host.Settlement);
            }
            var restarted = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            restarted.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty, raw => "synthetic-new", () => { }, error => { });
            check("PAIR-recover-fail-successor-" + failure, restarted.ObservationPairingGenerationKnown
                && restarted.ObservationPairingGeneration == attempted + 1,
                "only a later real Pair advances the retained attempted high-watermark by exactly one strict successor");
        }
    }

    // Contrasting controls: nothing but a genuinely fresh identity on top of persisted,
    // proven, safe, unpoisoned evidence may recover.
    private static void PairRecoveryControls(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "same-device", "case-device", "same-token" })
        {
            var settings = KnownGeneration(1);
            settings.InvalidateObservationGeneration();
            var device = mode == "same-device" ? Device : mode == "case-device" ? Device.ToUpperInvariant() : NewDevice;
            settings.CommitNewPair(device, Owner, mode == "same-token" ? OldPairToken : NewPairToken, OldPairToken,
                raw => "synthetic-protected", () => { }, error => { });
            var refused = !settings.ObservationPairingGenerationKnown
                && settings.ObservationPairingGeneration == 1;
            var restarted = Restart(settings);
            restarted.CommitNewPair(OtherDevice, Owner, NewPairToken, OldPairToken, raw => "synthetic-protected", () => { }, error => { });
            check("PAIR-recover-control-" + mode, refused && restarted.ObservationPairingGenerationKnown
                && restarted.ObservationPairingGeneration == 2,
                "same device/case/token cannot consume retained proof, and the refusal keeps it for a genuinely fresh Pair");
        }
        foreach (var mode in new[] { "unmarked", "marker-false" })
        {
            var json = "{\"SchemaVersion\":8,\"DeviceId\":\"" + Device + "\",\"BoundOwnerUserId\":\"" + Owner
                + "\",\"ObservationPairingGeneration\":7"
                + (mode == "marker-false" ? ",\"ObservationPairingGenerationRecoverable\":false" : string.Empty) + "}";
            var settings = SettingsCompatibilityTests.Deserialize(json);
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0) settings = Restart(settings);
                settings.CommitNewPair(attempt % 2 == 0 ? NewDevice : Device, Owner, NewPairToken, OldPairToken,
                    raw => "synthetic-protected", () => { }, error => { });
            }
            check("PAIR-recover-lost-provenance-" + mode, !settings.ObservationPairingGenerationKnown
                && settings.ObservationPairingGeneration == 7 && settings.NextObservationGeneration() == null,
                "present-unknown without persisted proof is indistinguishable from untrusted history and stays closed across restarts");
        }
        foreach (var mode in new[] { "poison", "null-known", "negative", "overflow", "max" })
        {
            var settings = new ConnectorSettings
            {
                DeviceId = Device, BoundOwnerUserId = Owner, DeviceTokenProtected = "synthetic-protected-old",
                UseCentralRelay = true
            };
            settings.ObservationPairingGeneration = mode == "poison" ? 7
                : mode == "negative" ? -1 : mode == "overflow" ? long.MaxValue
                : mode == "max" ? 9007199254740991L : (long?)null;
            settings.ObservationPairingGenerationKnown = mode == "null-known" || mode == "negative"
                || mode == "overflow" || mode == "max";
            settings.ObservationPairingGenerationPoisoned = mode == "poison";
            var original = settings.ObservationPairingGeneration;
            settings.InvalidateObservationGeneration();
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0) settings = Restart(settings);
                settings.CommitNewPair(attempt % 2 == 0 ? NewDevice : Device, Owner, NewPairToken, OldPairToken,
                    raw => "synthetic-protected", () => { }, error => { });
            }
            check("PAIR-recover-invalid-" + mode, !settings.ObservationPairingGenerationKnown
                && settings.ObservationPairingGeneration == original
                && (mode != "null-known" || settings.ObservationPairingGenerationPoisoned)
                && (mode != "poison" || settings.ObservationPairingGenerationPoisoned)
                && !settings.ObservationBinding().IsComplete && settings.NextObservationGeneration() == null,
                "null-known/negative/out-of-range/max/poisoned evidence stays closed without wrap, reset or capture authority");
        }
    }

    // SPEC-1: a persisted recoverable marker whose raw counter value is missing/NULL is
    // lost high-watermark evidence, not a pristine install. It must stay closed, must never
    // mint a fresh 1, and the invalid fact must survive invalidation, restart and refusal.
    private static string LostMarkerJson(string mode)
    {
        return "{\"SchemaVersion\":8,\"DeviceId\":\"" + Device + "\",\"BoundOwnerUserId\":\"" + Owner
            + "\",\"DeviceTokenProtected\":\"synthetic-old\",\"UseCentralRelay\":true"
            + (mode == "explicit-null" ? ",\"ObservationPairingGeneration\":null" : string.Empty)
            + ",\"ObservationPairingGenerationRecoverable\":true}";
    }

    private static async Task LostRecoveryEvidence(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "absent", "explicit-null" })
        {
            var dir = DirectoryFor("lost-recovery-" + mode);
            var path = Path.Combine(dir, "settings.json");

            // Loader control: the corrupt/partial document is loadable under the same lenient
            // POCO model the accepted compatibility tests adopt, yet grants nothing by itself.
            File.WriteAllText(path, LostMarkerJson(mode));
            var loaded = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-load-" + mode,
                loaded.ObservationPairingGenerationRecoverable && !loaded.ObservationPairingGeneration.HasValue
                && !loaded.ObservationPairingGenerationKnown && !loaded.ObservationPairingGenerationPoisoned
                && !loaded.ObservationBinding().IsComplete && loaded.NextObservationGeneration() == null,
                "marker=true + raw " + mode + " loads without authority and without any next generation");

            // Direct genuine new Pair through the real production commit seam, durable save.
            File.WriteAllText(path, LostMarkerJson(mode));
            var direct = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var directToken = direct.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
                raw => "synthetic-protected-lost", () => File.WriteAllText(path, SettingsJson(direct)), error => { });
            var directDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-direct-" + mode,
                directToken == NewPairToken
                && !direct.ObservationPairingGenerationKnown && !direct.ObservationPairingGeneration.HasValue
                && !direct.ObservationBinding().IsComplete && direct.NextObservationGeneration() == null
                && !directDisk.ObservationPairingGenerationKnown && !directDisk.ObservationPairingGeneration.HasValue
                && directDisk.ObservationPairingGenerationPoisoned && !directDisk.ObservationPairingGenerationRecoverable,
                "a direct fresh Pair neither mints 1 nor erases the proof: raw stays NULL, durable poison tombstone records the lost counter");

            // Restart on those durable bytes, then another genuinely fresh Pair.
            var restarted = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            restarted.CommitNewPair(OtherDevice, Owner, NewPairToken, string.Empty,
                raw => "synthetic-protected-next", () => File.WriteAllText(path, SettingsJson(restarted)), error => { });
            var restartedDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-restart-pair-" + mode,
                !restarted.ObservationPairingGenerationKnown && !restarted.ObservationPairingGeneration.HasValue
                && restarted.ObservationPairingGenerationPoisoned
                && !restartedDisk.ObservationPairingGenerationKnown && !restartedDisk.ObservationPairingGeneration.HasValue
                && restartedDisk.ObservationPairingGenerationPoisoned,
                "restart + genuinely fresh Pair stays closed and keeps the lost-proof tombstone durable");

            // An actual invalidation of the corrupt document (failed Pair / Forget path) must
            // not silently drop the evidence, and a later restart + fresh Pair must stay closed.
            File.WriteAllText(path, LostMarkerJson(mode));
            var invalidated = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            invalidated.InvalidateObservationGeneration();
            File.WriteAllText(path, SettingsJson(invalidated));
            var afterInvalidateRestart = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            afterInvalidateRestart.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
                raw => "synthetic-protected", () => File.WriteAllText(path, SettingsJson(afterInvalidateRestart)), error => { });
            var afterInvalidateDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-invalidate-" + mode,
                invalidated.ObservationPairingGenerationPoisoned && !invalidated.ObservationPairingGenerationRecoverable
                && !invalidated.ObservationPairingGeneration.HasValue && !invalidated.ObservationPairingGenerationKnown
                && !afterInvalidateRestart.ObservationPairingGenerationKnown
                && !afterInvalidateRestart.ObservationPairingGeneration.HasValue
                && !afterInvalidateDisk.ObservationPairingGenerationKnown
                && !afterInvalidateDisk.ObservationPairingGeneration.HasValue
                && afterInvalidateDisk.ObservationPairingGenerationPoisoned,
                "invalidation of marker-with-lost-raw keeps a durable invalid fact; restart + fresh Pair never gets 1");

            // Repeated invalidation/restart plus multiple fresh Pairs must not converge on pristine.
            File.WriteAllText(path, LostMarkerJson(mode));
            var repeated = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var devices = new[] { NewDevice, OtherDevice, "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb" };
            for (var attempt = 0; attempt < 4; attempt++)
            {
                if (attempt > 0) repeated = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
                repeated.InvalidateObservationGeneration();
                File.WriteAllText(path, SettingsJson(repeated));
                repeated.CommitNewPair(devices[attempt % devices.Length], Owner, NewPairToken, string.Empty,
                    raw => "synthetic-protected", () => File.WriteAllText(path, SettingsJson(repeated)), error => { });
            }
            var repeatedDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-repeat-" + mode,
                !repeatedDisk.ObservationPairingGenerationKnown && !repeatedDisk.ObservationPairingGeneration.HasValue
                && repeatedDisk.ObservationPairingGenerationPoisoned && !repeatedDisk.ObservationPairingGenerationRecoverable
                && repeatedDisk.NextObservationGeneration() == null,
                "repeated invalidation/restart/multiple fresh Pairs keep raw NULL and a sticky invalid fact, never a generation");

            // A failed protect must not erase the evidence on its way out.
            File.WriteAllText(path, LostMarkerJson(mode));
            var protectFailure = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var protectThrew = false;
            try
            {
                protectFailure.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
                    raw => { throw new IOException("synthetic protect"); },
                    () => File.WriteAllText(path, SettingsJson(protectFailure)), error => { });
            }
            catch (IOException) { protectThrew = true; }
            var protectDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var protectRestart = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            protectRestart.CommitNewPair(OtherDevice, Owner, NewPairToken, string.Empty,
                raw => "synthetic-protected", () => File.WriteAllText(path, SettingsJson(protectRestart)), error => { });
            var protectAfter = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-failed-protect-" + mode,
                protectThrew
                && !protectFailure.ObservationPairingGenerationKnown && !protectFailure.ObservationPairingGeneration.HasValue
                && protectFailure.ObservationPairingGenerationPoisoned
                && !protectDisk.ObservationPairingGenerationKnown && protectDisk.ObservationPairingGenerationPoisoned
                && !protectRestart.ObservationPairingGenerationKnown && !protectRestart.ObservationPairingGeneration.HasValue
                && !protectAfter.ObservationPairingGenerationKnown && !protectAfter.ObservationPairingGeneration.HasValue,
                "a failed protect preserves the lost-proof tombstone; a later fresh Pair still cannot mint 1");

            // A failed save writes nothing back, so the original lost-proof bytes stay intact;
            // the in-memory state must already be closed and stay closed after restart.
            File.WriteAllText(path, LostMarkerJson(mode));
            var saveFailure = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var saveThrew = false; var rollbackErrors = 0;
            try
            {
                saveFailure.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
                    raw => "synthetic-protected", () => { throw new IOException("synthetic save"); },
                    error => { rollbackErrors++; });
            }
            catch (IOException) { saveThrew = true; }
            var saveDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var saveRestart = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            saveRestart.CommitNewPair(OtherDevice, Owner, NewPairToken, string.Empty,
                raw => "synthetic-protected", () => File.WriteAllText(path, SettingsJson(saveRestart)), error => { });
            var saveAfter = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            check("PAIR-lost-raw-failed-save-" + mode,
                saveThrew && rollbackErrors == 1
                && !saveFailure.ObservationPairingGenerationKnown && !saveFailure.ObservationPairingGeneration.HasValue
                && saveFailure.ObservationPairingGenerationPoisoned
                && saveDisk.ObservationPairingGenerationRecoverable && !saveDisk.ObservationPairingGeneration.HasValue
                && !saveRestart.ObservationPairingGenerationKnown && !saveRestart.ObservationPairingGeneration.HasValue
                && !saveAfter.ObservationPairingGenerationKnown && !saveAfter.ObservationPairingGeneration.HasValue,
                "a failed save leaves the original lost-proof bytes intact; in-memory and restarted state stay closed");

            // Real host transition: the same corrupt document must publish no observation
            // authority and open no ledger even with independent policy/readiness injected true.
            File.WriteAllText(path, LostMarkerJson(mode));
            var hostSettings = SettingsCompatibilityTests.Deserialize(File.ReadAllText(path));
            var memory = string.Empty; var ledgerCalls = 0;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(new MeasurementOutbox(Path.Combine(dir, "legacy-host.json")),
                new MeasurementIdFactory(), new ObservationProducerIdentity(memory, hostSettings.ObservationBinding()),
                () => true, () => true,
                fence => { ledgerCalls++; return new ObservationLedgerStore(Path.Combine(dir, "obs-host.json"), fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                await host.TransitionAsync(cancel =>
                {
                    memory = hostSettings.CommitNewPair(NewDevice, Owner, NewPairToken, memory,
                        raw => "synthetic-protected-host", () => File.WriteAllText(path, SettingsJson(hostSettings)), error => { });
                    return Task.FromResult(new ObservationProducerIdentity(memory, hostSettings.ObservationBinding()));
                }, CancellationToken.None);
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2);
                check("PAIR-lost-raw-host-" + mode,
                    !host.Snapshot().Binding.IsComplete && !host.Snapshot().Binding.PairingGenerationKnown
                    && host.Snapshot().Binding.PairingGeneration != 1 && ledgerCalls == 0
                    && !hostSettings.ObservationPairingGenerationKnown
                    && !hostSettings.ObservationPairingGeneration.HasValue
                    && !SettingsCompatibilityTests.Deserialize(File.ReadAllText(path)).ObservationPairingGenerationKnown,
                    "a real host transition on the lost-proof document publishes no observation binding, opens no ledger and keeps raw NULL");
                host.Stop();
                await Bounded(host.Settlement);
            }
        }

        // Positive control: a genuinely pristine absent document (marker false) still receives
        // exactly the accepted fresh 1; the guard must not reject all legacy Pairs.
        var pristinePath = Path.Combine(DirectoryFor("lost-pristine-control"), "settings.json");
        File.WriteAllText(pristinePath, "{\"SchemaVersion\":8}");
        var pristine = SettingsCompatibilityTests.Deserialize(File.ReadAllText(pristinePath));
        pristine.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
            raw => "synthetic-protected", () => File.WriteAllText(pristinePath, SettingsJson(pristine)), error => { });
        var pristineDisk = SettingsCompatibilityTests.Deserialize(File.ReadAllText(pristinePath));
        check("PAIR-lost-pristine-control",
            pristine.ObservationPairingGenerationKnown && pristine.ObservationPairingGeneration == 1
            && pristineDisk.ObservationPairingGenerationKnown && pristineDisk.ObservationPairingGeneration == 1,
            "genuinely pristine absent settings (marker=false) still receive exactly fresh 1");

        // Positive control: safe proven evidence with its raw value present still recovers to
        // the strict successor after a real durable Pair.
        var healthyPath = Path.Combine(DirectoryFor("lost-healthy-control"), "settings.json");
        var healthy = KnownGeneration(1);
        healthy.InvalidateObservationGeneration();
        File.WriteAllText(healthyPath, SettingsJson(healthy));
        var healthyRestart = SettingsCompatibilityTests.Deserialize(File.ReadAllText(healthyPath));
        healthyRestart.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
            raw => "synthetic-protected", () => File.WriteAllText(healthyPath, SettingsJson(healthyRestart)), error => { });
        check("PAIR-lost-healthy-control",
            healthyRestart.ObservationPairingGenerationKnown && healthyRestart.ObservationPairingGeneration == 2
            && SettingsCompatibilityTests.Deserialize(File.ReadAllText(healthyPath)).ObservationPairingGeneration == 2,
            "a safe proven marker with raw 1 still recovers to exactly 2 after a real durable Pair");

        // Control: unsafe numeric markers keep their existing policy (raw retained, marker
        // cleared, closed) - the lost-raw tombstone must not widen poison to numeric evidence.
        var numeric = new ConnectorSettings { ObservationPairingGeneration = -1, ObservationPairingGenerationRecoverable = true };
        numeric.InvalidateObservationGeneration();
        numeric.CommitNewPair(NewDevice, Owner, NewPairToken, string.Empty,
            raw => "synthetic-protected", () => { }, error => { });
        check("PAIR-lost-numeric-marker-control",
            !numeric.ObservationPairingGenerationKnown && numeric.ObservationPairingGeneration == -1
            && !numeric.ObservationPairingGenerationPoisoned && !numeric.ObservationPairingGenerationRecoverable,
            "numeric invalid marker policy is unchanged: raw retained, marker cleared, closed, no new poison");
    }

    private static async Task LazyLease(Action<string, bool, string> check)
    {
        var path = Path.Combine(DirectoryFor("lazy"), "observation.json");
        File.WriteAllText(path, "synthetic corrupt target");
        File.WriteAllText(path + ".bak", "synthetic backup evidence");
        File.WriteAllText(path + ".tmp", "synthetic temporary evidence");
        var fence = new ObservationBindingFence(null);
        var calls = 0;
        var tokens = 0;
        var handler = new Handler();
        using (var http = new HttpClient(handler))
        using (var coordinator = ObservationSendCoordinator.CreateLazy(fence, () =>
        {
            calls++;
            return new ObservationLedgerStore(path, fence);
        }, new MeasurementOutbox(path + ".legacy"), new HttpObservationSendTransport(http, 16384),
            () => { tokens++; return "synthetic-token"; }, () => "{}", new ObservationSendOptions(), null))
        {
            var initial = coordinator.CurrentBinding;
            var send = await coordinator.SendOnceAsync("{}", Endpoint, T0, CancellationToken.None);
            check("OH01", send.Status == ObservationSendStatus.Disabled && calls == 0 && tokens == 0 && handler.Calls == 0,
                "disabled has no provider/token/HTTP");
            var pair = await coordinator.PairAsync(cancel =>
            {
                check("OH02", coordinator.LeaseHeld && calls == 0, "pair callback owns existing lease without storage");
                return Task.FromResult(ObservationPairCommit.CommittedWith(new ObservationPairingBinding(Device, Owner, 7, true)));
            }, CancellationToken.None);
            check("OH03", pair.Committed && coordinator.CurrentBinding.PairingGeneration == 7 && calls == 0,
                "same fence published without storage");
            await coordinator.UnpairAsync(cancel => Task.FromResult(ObservationPairCommit.CommittedWith(
                new ObservationPairingBinding(null, null, 7, false))), CancellationToken.None);
            check("OH04", !coordinator.CurrentBinding.IsComplete && calls == 0 &&
                File.ReadAllText(path) == "synthetic corrupt target" && File.ReadAllText(path + ".bak") == "synthetic backup evidence" &&
                File.ReadAllText(path + ".tmp") == "synthetic temporary evidence" && !File.Exists(path + ".preserved"),
                "unpair and disabled restart evidence untouched");
        }
        check("OH05", calls == 0, "dispose does not initialize store");
    }

    private static async Task LazyFailures(Action<string, bool, string> check)
    {
        foreach (var mode in new[] { "null", "mismatch", "exception" })
        {
            var path = Path.Combine(DirectoryFor(mode), "observation.json");
            var fence = new ObservationBindingFence(new ObservationPairingBinding(Device, Owner, 7, true));
            var calls = 0;
            var handler = new Handler();
            using (var http = new HttpClient(handler))
            using (var coordinator = ObservationSendCoordinator.CreateLazy(fence, () =>
            {
                calls++;
                if (mode == "exception") throw new IOException("synthetic");
                if (mode == "null") return null;
                return new ObservationLedgerStore(path, new ObservationBindingFence(fence.Current));
            }, new MeasurementOutbox(path + ".legacy"), new HttpObservationSendTransport(http, 16384),
                () => "synthetic-token", () => "{}", new ObservationSendOptions { Enabled = true }, null))
            {
                var result = await coordinator.SendOnceAsync("{}", Endpoint, T0, CancellationToken.None);
                await coordinator.SendOnceAsync("{}", Endpoint, T0, CancellationToken.None);
                check("OH06-" + mode, result.Status == ObservationSendStatus.Refused && handler.Calls == 0 && calls == 1,
                    "bad provider fails closed once; no POST or duplicate initialization");
            }
        }
    }
    private static async Task QualityBoundaries(Action<string, bool, string> check)
    {
        foreach (var enabled in new[] { false, true })
        {
            var dir = DirectoryFor("quality-stop-" + enabled);
            var path = Path.Combine(dir, "obs.json");
            var legacy = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            var providers = 0;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(), Identity(), () => enabled, () => true,
                fence => { providers++; return new ObservationLedgerStore(path, fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1);
                check("QSTOP-input-" + enabled, providers == 0 && legacy.LapCount == 0, "open aggregate, no completed lap/provider before Stop");
                host.Stop(); await Bounded(host.Settlement); host.Stop();
                var disk = enabled && File.Exists(path) ? new ObservationLedgerStore(path, new ObservationBindingFence(Identity().Binding)) : null;
                check("QSTOP-flush-" + enabled, enabled
                    ? disk != null && disk.EntryCount == 1 && disk.Entries[0].RowJson.Contains("plugin_stop") && legacy.LapCount == 0 && providers == 1
                    : legacy.LapCount == 1 && providers == 0 && !File.Exists(path),
                    "providers=" + providers + " legacy=" + legacy.LapCount + " disk=" + (disk == null ? "absent" : disk.EntryCount + "/" + disk.Entries[0].RowJson));
            }
        }
        foreach (var flag in new[] { "optin", "readiness" })
        {
            var dir = DirectoryFor("quality-dynamic-" + flag);
            var legacy = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            var active = true; var providers = 0;
            ObservationLedgerStore store = null;
            using (var http = new HttpClient(new Handler()))
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(), Identity(), () => flag != "optin" || active,
                () => flag != "readiness" || active, fence => { providers++; return store = new ObservationLedgerStore(Path.Combine(dir, "obs.json"), fence); },
                new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); active = false; host.EndSession("session_end");
                check("QDYNAMIC-off-" + flag, host.PendingCandidate == null && providers == 0 && legacy.LapCount == 1,
                    "pending=" + (host.PendingCandidate != null) + " providers=" + providers + " legacy=" + legacy.LapCount);
                active = true; Tick(host, 3, 2); Tick(host, 4, 3); Tick(host, 5, 3); Tick(host, 6, 4);
                check("QDYNAMIC-positive-" + flag, store != null && store.EntryCount > 0 && providers == 1,
                    "eligible fresh later lap reaches actual store, generation=7; entries=" + (store == null ? -1 : store.EntryCount));
            }
        }
        foreach (var conflict in new[] { false, true })
        {
            var dir = DirectoryFor("quality-mixed-" + conflict);
            var path = Path.Combine(dir, "obs.json");
            var legacy = new MeasurementOutbox(Path.Combine(dir, "legacy.json"));
            var old = new MeasurementPipeline(legacy, new MeasurementIdFactory());
            old.Observe(new TelemetrySample { ObservedAtUtc = T0, LapNumber = 1, SessionTimeSeconds = 0 });
            old.Observe(new TelemetrySample { ObservedAtUtc = T0.AddSeconds(1), LapNumber = 1, SessionTimeSeconds = 1 });
            old.End("session_end");
            var handler = new Handler();
            handler.Reply = body =>
            {
                if (!conflict) return AckAll(body);
                var rows = (System.Collections.IList)MeasurementJson.DeserializeDictionary(body)["lapSummaries"];
                var a = (System.Collections.Generic.Dictionary<string, object>)rows[1];
                var b = (System.Collections.Generic.Dictionary<string, object>)rows[2];
                return "{\"measurements\":{\"laps\":{\"stored\":true,\"received\":3,\"accepted\":[{\"id\":\"" + b["summaryUid"]
                    + "\",\"recordRevision\":1}],\"rejected\":[{\"id\":\"" + a["summaryUid"] + "\",\"index\":0,\"reason\":\"observation_invalid\",\"stage\":\"parser\"}]}}}";
            };
            using (var http = new HttpClient(handler))
            using (var host = new ObservationProducerHost(legacy, new MeasurementIdFactory(), Identity(), () => true, () => true,
                fence => new ObservationLedgerStore(path, fence), new HttpObservationSendTransport(http, 16384), () => "{}", null, () => T0.AddMinutes(1)))
            {
                Tick(host, 0, 1); Tick(host, 1, 1); Tick(host, 2, 2); Tick(host, 3, 2); host.EndSession("session_end");
                check("QMIX-input-" + conflict, legacy.LapCount == 1, "one real legacy lap before mixed attempt");
                var bypass = 0;
                var result = await host.SendAsync(() => "{}", Endpoint, host.Snapshot(), T0.AddMinutes(2), null,
                    () => { bypass++; return Task.CompletedTask; }, CancellationToken.None);
                var disk = new ObservationLedgerStore(path, new ObservationBindingFence(Identity().Binding));
                var retained = !conflict || (disk.EntryCount == 1 && disk.Entries[0].RowJson == result.Offered.Rows[1].RowJson);
                check("QMIX-trust-" + conflict, result.Offered.Rows.Count == 3 && disk.DeliveredTotal == (conflict ? 1 : 2)
                    && disk.EntryCount == (conflict ? 1 : 0) && legacy.LapCount == (conflict ? 1 : 0) && retained
                    && result.ObservationQuarantined == 0 && handler.Calls == 1 && bypass == 0,
                    "D=" + disk.DeliveredTotal + " E=" + disk.EntryCount + " L=" + legacy.LapCount + " Q=" + result.ObservationQuarantined
                    + " auth=" + handler.Authorization + " contentType=" + handler.ContentType + " generation=" + result.Binding.PairingGeneration + " body=" + handler.Body);
                File.WriteAllText(Path.Combine(dir, "request.json"), handler.Body);
            }
        }
    }

}
