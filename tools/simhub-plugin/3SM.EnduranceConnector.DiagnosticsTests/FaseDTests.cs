using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

using ThreeSM.EnduranceConnector;

internal sealed class MutableClock
{
    public DateTime Value = new DateTime(2026, 9, 1, 10, 0, 0, DateTimeKind.Utc);
    public DateTime Now() { return Value; }
    public void Advance(double seconds) { Value = Value.AddSeconds(seconds); }
}

internal sealed class Reply
{
    public HttpStatusCode Status;
    public int DelayMs;
    public bool Throw;
    public bool IgnoreCancellation;
}

internal sealed class CaptureHandler : HttpMessageHandler
{
    private readonly object gate = new object();
    public readonly List<string> Bodies = new List<string>();
    public readonly List<string> AuthSchemes = new List<string>();
    public readonly Queue<Reply> Replies = new Queue<Reply>();
    public int Active;
    public int MaxActive;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var active = Interlocked.Increment(ref Active);
        if (active > MaxActive) MaxActive = active;
        try
        {
            var body = await request.Content.ReadAsStringAsync();
            lock (gate)
            {
                Bodies.Add(body);
                AuthSchemes.Add(request.Headers.Authorization == null ? null : request.Headers.Authorization.Scheme);
            }
            Reply reply = null;
            lock (Replies) { if (Replies.Count > 0) reply = Replies.Dequeue(); }
            if (reply == null) reply = new Reply { Status = HttpStatusCode.OK };
            if (reply.DelayMs > 0)
            {
                if (reply.IgnoreCancellation) await Task.Delay(reply.DelayMs);
                else await Task.Delay(reply.DelayMs, cancellationToken);
            }
            if (reply.Throw) throw new HttpRequestException("SENSITIVE_RAW_EXCEPTION_MESSAGE_C_USERS_TOKEN");
            return new HttpResponseMessage(reply.Status) { Content = new StringContent("{\"ignored\":true}") };
        }
        finally { Interlocked.Decrement(ref Active); }
    }
}

internal sealed class FakeNewData { public FakeRawData RawData { get; set; } }
internal sealed class FakeRawData { public FakeTelemetry Telemetry { get; set; } }
internal sealed class FakeTelemetry { public double SessionTime { get; set; } }

internal static class FaseDTests
{
    private static readonly Uri Endpoint = new Uri("https://api.3stripemotorsport.cc/functions/v1/simhub-diagnostic");
    private const string Token = "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678";
    private const string Device = "11111111-1111-1111-1111-111111111111";
    private static int passed;
    private static int failed;


    private static DiagnosticsClient Client(CaptureHandler handler, MutableClock clock, Func<UpdaterState> updater, double heartbeat = 60, double eventCooldown = 10)
    {
        var client = new DiagnosticsClient(Endpoint, updater ?? (() => UpdaterState.SafeDefaults()), handler,
            clock.Now, TimeSpan.FromSeconds(heartbeat), TimeSpan.FromSeconds(eventCooldown), TimeSpan.FromMilliseconds(50), false);
        client.Start(Token, Device, "0.3.10.0", "1.0.9735.26972");
        return client;
    }

    private static DiagnosticsObservation Healthy(long sequence)
    {
        return new DiagnosticsObservation
        {
            GameConnected = true, TelemetryAvailable = true, RawDataAvailable = true,
            RawTelemetryAvailable = true, SessionTimeReadOk = true,
            SessionTimeSeconds = 123.5 + sequence, Sequence = sequence,
            LastTelemetryAttemptUtc = new DateTime(2026, 9, 1, 9, 59, 59, DateTimeKind.Utc),
            LastSuccessfulIngestUtc = new DateTime(2026, 9, 1, 9, 59, 59, DateTimeKind.Utc),
            LastIngestHttpStatus = 202
        };
    }

    private static Dictionary<string, object> Parse(string body)
    {
        var settings = new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true };
        var serializer = new DataContractJsonSerializer(typeof(Dictionary<string, object>), settings);
        using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(body)))
            return (Dictionary<string, object>)serializer.ReadObject(stream);
    }
    private static void Check(string id, bool condition, string evidence)
    {
        if (condition) { passed++; Console.WriteLine("PASS " + id + " " + evidence); }
        else { failed++; Console.WriteLine("FAIL " + id + " " + evidence); }
    }

    private static async Task BasicMatrix()
    {
        // D01
        var h1 = new CaptureHandler(); var c1clock = new MutableClock();
        using (var c = Client(h1, c1clock, null)) { c.Observe(Healthy(7)); await c.TriggerAsync(); }
        Check("D01", h1.Bodies.Count == 1 && (string)Parse(h1.Bodies[0])["type"] == "heartbeat", "enabled heartbeat=1");

        // D02: plugin gate semantics — disabled means the diagnostics client is not constructed.
        var settings = new ConnectorSettings { DiagnosticsEnabled = false };
        var h2 = new CaptureHandler();
        if (settings.DiagnosticsEnabled) using (var unused = Client(h2, new MutableClock(), null)) await unused.TriggerAsync();
        Check("D02", h2.Bodies.Count == 0, "DiagnosticsEnabled=false traffic=0");

        // D03
        var h3 = new CaptureHandler(); var clock3 = new MutableClock();
        using (var c = new DiagnosticsClient(Endpoint, () => UpdaterState.SafeDefaults(), h3, clock3.Now,
            TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(1), false))
        { c.Start(null, null, "0.3.10.0", "simhub"); await c.TriggerAsync(); }
        Check("D03", h3.Bodies.Count == 0, "no token/device traffic=0");

        // D04 exact heartbeat schema
        var expectedHeartbeat = new[] { "type","deviceId","connectorVersion","simHubVersion","gameConnected","telemetryAvailable","rawDataAvailable","rawTelemetryAvailable","sessionTimeReadOk","sessionTimeSeconds","sessionTimeReader","sequence","lastTelemetryAttemptUtc","lastSuccessfulIngestUtc","lastIngestHttpStatus","diagnosticCode","updaterState","updaterCurrentVersion","updaterTargetVersion","lastUpdateResult","lastUpdateUtc","clientReportedAtUtc" };
        var d4 = Parse(h1.Bodies[0]);
        Check("D04", d4.Keys.OrderBy(x => x).SequenceEqual(expectedHeartbeat.OrderBy(x => x)) && (string)d4["sessionTimeReader"] == "RawDataReflection", "exact 22-key heartbeat schema");

        // D05
        var h5 = new CaptureHandler(); var clock5 = new MutableClock();
        using (var c = Client(h5, clock5, null))
        {
            c.Observe(Healthy(1)); await c.TriggerAsync(); clock5.Advance(59); await c.TriggerAsync();
            clock5.Advance(1); await c.TriggerAsync();
        }
        Check("D05", h5.Bodies.Count == 2, "requests at t=0/60 only");

        // D06-D09 state machine/cooldown
        var h6 = new CaptureHandler(); var clock6 = new MutableClock();
        using (var c = Client(h6, clock6, null))
        {
            c.Observe(Healthy(1)); await c.TriggerAsync();
            var broken = Healthy(2); broken.SessionTimeReadOk = false; broken.SessionTimeSeconds = null;
            c.Observe(broken); await c.TriggerAsync();
            var afterChange = h6.Bodies.Count;
            c.Observe(broken); clock6.Advance(11); await c.TriggerAsync();
            Check("D06", afterChange == 2 && (string)Parse(h6.Bodies[1])["code"] == "SESSION_TIME_READ_FAILED", "one state-change event");
            Check("D07", h6.Bodies.Count == 2, "same status no event spam");
            c.Observe(Healthy(3)); await c.TriggerAsync();
            var recoveryCount = h6.Bodies.Count;
            clock6.Advance(11); c.Observe(Healthy(4)); await c.TriggerAsync();
            Check("D08", recoveryCount == 3 && (string)Parse(h6.Bodies[2])["code"] == "OK" && h6.Bodies.Count == 3, "single OK recovery");

            var rawMissing = Healthy(5); rawMissing.RawDataAvailable = false;
            c.Observe(rawMissing); await c.TriggerAsync(); // first error is sent
            var rawTelemetryMissing = Healthy(6); rawTelemetryMissing.RawTelemetryAvailable = false;
            c.Observe(rawTelemetryMissing); await c.TriggerAsync(); // within cooldown: latest remains pending
            var beforeCooldown = h6.Bodies.Count;
            clock6.Advance(10); await c.TriggerAsync();
            Check("D09", beforeCooldown == 4 && h6.Bodies.Count == 5 && (string)Parse(h6.Bodies[4])["code"] == "RAW_TELEMETRY_UNAVAILABLE", "latest-only pending event, no burst");
        }

        // D10-D11 updater state read-only, missing/corrupt stable
        var temp = Path.Combine(Path.GetTempPath(), "3sm-fased-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            var store = new UpdaterStateStore(temp);
            var state = new UpdaterState { state = "FAILED", lastUpdateResult = "failure:hash", lastUpdateErrorCode = "HASH_FAILED" };
            store.Save(state);
            var before = File.ReadAllBytes(store.FilePath);
            var h10 = new CaptureHandler(); var clock10 = new MutableClock();
            using (var c = Client(h10, clock10, store.LoadReadOnly)) { c.Observe(Healthy(1)); await c.TriggerAsync(); }
            var after = File.ReadAllBytes(store.FilePath);
            Check("D10", before.SequenceEqual(after) && Directory.GetFiles(temp).Length == 1, "updater store bytes/files unchanged");
            File.WriteAllText(store.FilePath, "{CORRUPT-SENSITIVE-PATH-C:\\\\Users\\\\x}");
            var corruptBefore = File.ReadAllBytes(store.FilePath);
            UpdaterState loaded = store.LoadReadOnly();
            var corruptAfter = File.ReadAllBytes(store.FilePath);
            File.Delete(store.FilePath);
            var missing = store.LoadReadOnly();
            Check("D11", corruptBefore.SequenceEqual(corruptAfter) && loaded.state == "IDLE" && missing.state == "IDLE" && Directory.GetFiles(temp).Length == 0, "missing/corrupt safe defaults, zero mutation");
        }
        finally { try { Directory.Delete(temp, true); } catch { } }

        // D12 exact fixed SessionTime reflection path
        var reader = new SessionTelemetryReader(); bool rawAvailable;
        var value = reader.ReadWithHealth(new FakeNewData { RawData = new FakeRawData { Telemetry = new FakeTelemetry { SessionTime = 456.75 } } }, out rawAvailable);
        Check("D12", rawAvailable && value == 456.75, "RawDataReflection SessionTime=456.75");

        // D13-D18 fault isolation and no retry loops
        await FaultCase("D13", new Reply { DelayMs = 6000 }, "timeout");
        await FaultCase("D14", new Reply { Throw = true }, "connection failure");
        await FaultCase("D15", new Reply { Status = HttpStatusCode.Unauthorized }, "401");
        await FaultCase("D16", new Reply { Status = HttpStatusCode.Forbidden }, "403");
        await FaultCase("D17", new Reply { Status = (HttpStatusCode)429 }, "429");
        await FaultCase("D18", new Reply { Status = HttpStatusCode.InternalServerError }, "500");

        // D19 prolonged offline bounded: only normal heartbeat cadence; no backlog/inflight growth.
        var h19 = new CaptureHandler(); for (var i = 0; i < 5; i++) h19.Replies.Enqueue(new Reply { Throw = true });
        var clock19 = new MutableClock();
        using (var c = Client(h19, clock19, null))
        {
            c.Observe(Healthy(1));
            for (var second = 0; second < 180; second++) { await c.TriggerAsync(); clock19.Advance(1); }
        }
        Check("D19", h19.Bodies.Count == 3 && h19.MaxActive == 1, "180s offline requests=3 maxInflight=1");

        // D20-D22 privacy allowlist/token/log/raw message.
        var allBodies = string.Join("\n", h1.Bodies.Concat(h6.Bodies).ToArray());
        var forbidden = new[] { Token, "Authorization", "SENSITIVE_RAW_EXCEPTION_MESSAGE", "C:\\Users", "stackTrace", "telemetry\"" };
        Check("D20", forbidden.All(x => allBodies.IndexOf(x, StringComparison.OrdinalIgnoreCase) < 0), "payload privacy allowlist");
        Check("D21", h1.AuthSchemes.All(x => x == "Bearer") && allBodies.IndexOf(Token, StringComparison.Ordinal) < 0, "token only in Authorization header, never body");
        Check("D22", allBodies.IndexOf("SENSITIVE_RAW_EXCEPTION_MESSAGE", StringComparison.Ordinal) < 0, "raw exception message absent");

        // D23-D24 lifecycle observations.
        var h23 = new CaptureHandler(); var clock23 = new MutableClock();
        using (var c = Client(h23, clock23, null))
        {
            c.Observe(new DiagnosticsObservation { GameConnected = false, Sequence = -1 }); await c.TriggerAsync();
            var startBody = Parse(h23.Bodies[0]);
            Check("D23", !(bool)startBody["gameConnected"], "startup without game heartbeat stable");
            clock23.Advance(60); c.Observe(Healthy(1)); await c.TriggerAsync();
            clock23.Advance(60); c.Observe(new DiagnosticsObservation { GameConnected = false, Sequence = 1 }); await c.TriggerAsync();
            var connectBody = Parse(h23.Bodies[1]); var disconnectBody = Parse(h23.Bodies[h23.Bodies.Count - 1]);
            Check("D24", (bool)connectBody["gameConnected"] && !(bool)disconnectBody["gameConnected"], "connect/disconnect lifecycle reflected");
        }

        // D25 sequence remains owned by telemetry; diagnostics only observes a copy.
        var h25 = new CaptureHandler(); var clock25 = new MutableClock(); long telemetrySequence = -1;
        using (var c = Client(h25, clock25, null))
        {
            for (var i = 0; i < 10; i++) { telemetrySequence++; var obs = Healthy(telemetrySequence); c.Observe(obs); await c.TriggerAsync(); clock25.Advance(1); }
        }
        Check("D25", telemetrySequence == 9 && h25.Bodies.Count == 1 && Convert.ToInt64(Parse(h25.Bodies[0])["sequence"]) == 0, "telemetry sequence 0..9; diagnostics cadence independent");
    }

    private static async Task FaultCase(string id, Reply reply, string label)
    {
        var h = new CaptureHandler(); h.Replies.Enqueue(reply); var clock = new MutableClock(); var sequence = 0;
        using (var c = Client(h, clock, null))
        {
            c.Observe(Healthy(sequence));
            var request = c.TriggerAsync();
            for (var i = 0; i < 5; i++) { sequence++; await Task.Delay(20); }
            await request;
            await c.TriggerAsync(); // same cadence: must not immediately retry
        }
        Check(id, sequence == 5 && h.Bodies.Count == 1 && h.MaxActive == 1, label + " telemetry counter=5 requests=1");
    }

    private static async Task NonInterferenceDuringDispose(string id, string action)
    {
        var handler = new CaptureHandler();
        handler.Replies.Enqueue(new Reply { DelayMs = 6000, IgnoreCancellation = true });
        var clock = new MutableClock();
        var diagnosticsGate = new object();
        DiagnosticsClient current = Client(handler, clock, null);
        current.Observe(Healthy(0));
        var request = current.TriggerAsync();
        for (var i = 0; i < 100 && Volatile.Read(ref handler.Active) == 0; i++) await Task.Delay(10);

        var telemetryTimes = new List<long>();
        var stopwatch = Stopwatch.StartNew();
        var telemetry = Task.Run(async () =>
        {
            for (var sequence = 0; sequence < 7; sequence++)
            {
                var target = sequence * 1000L;
                var wait = target - stopwatch.ElapsedMilliseconds;
                if (wait > 0) await Task.Delay((int)wait);
                telemetryTimes.Add(stopwatch.ElapsedMilliseconds);
                DiagnosticsClient observed;
                lock (diagnosticsGate) observed = current;
                if (observed != null) observed.Observe(Healthy(sequence));
            }
        });

        await Task.Delay(150);
        var dispose = Task.Run(() =>
        {
            DiagnosticsClient stopped;
            lock (diagnosticsGate) { stopped = current; current = null; }
            if (stopped != null) stopped.Dispose();
        });
        await Task.WhenAll(telemetry, dispose, request);
        var maxGap = telemetryTimes.Zip(telemetryTimes.Skip(1), (a, b) => b - a).DefaultIfEmpty(0).Max();
        var ok = telemetryTimes.Count == 7 && maxGap <= 1300 && handler.Bodies.Count == 1 && handler.MaxActive == 1 && current == null;
        Check(id, ok, action + " timeout maxGapMs=" + maxGap + " telemetry=7 diagRequests=" + handler.Bodies.Count + " maxInflight=" + handler.MaxActive);
    }

    private static async Task Concurrent60Seconds()
    {
        var handler = new CaptureHandler();
        handler.Replies.Enqueue(new Reply { Status = HttpStatusCode.OK });
        handler.Replies.Enqueue(new Reply { DelayMs = 6000 });
        handler.Replies.Enqueue(new Reply { Status = (HttpStatusCode)429 });
        handler.Replies.Enqueue(new Reply { Status = HttpStatusCode.InternalServerError });
        handler.Replies.Enqueue(new Reply { Throw = true });
        var clock = new MutableClock();
        var client = Client(handler, clock, null, 60, 10);
        var times = new List<long>();
        var sw = Stopwatch.StartNew();
        long sequence = -1;
        double sessionTime = 1000;
        client.Observe(Healthy(0));
        var diagTasks = new List<Task> { client.TriggerAsync() };
        for (var second = 0; second < 60; second++)
        {
            var target = second * 1000L;
            var wait = target - sw.ElapsedMilliseconds;
            if (wait > 0) await Task.Delay((int)wait);
            sequence++;
            sessionTime += 1.0;
            times.Add(sw.ElapsedMilliseconds);
            var obs = Healthy(sequence); obs.SessionTimeSeconds = sessionTime; client.Observe(obs);
            if (second == 5) { var e = Healthy(sequence); e.SessionTimeReadOk = false; e.SessionTimeSeconds = null; client.Observe(e); diagTasks.Add(client.TriggerAsync()); }
            if (second == 20) { client.Observe(Healthy(sequence)); diagTasks.Add(client.TriggerAsync()); }
            if (second == 35) { var e = Healthy(sequence); e.RawTelemetryAvailable = false; client.Observe(e); diagTasks.Add(client.TriggerAsync()); }
            if (second == 50) { client.Observe(Healthy(sequence)); diagTasks.Add(client.TriggerAsync()); }
            clock.Advance(1);
        }
        await Task.WhenAll(diagTasks.ToArray());
        client.Dispose();
        var maxGap = times.Zip(times.Skip(1), (a, b) => b - a).DefaultIfEmpty(0).Max();
        var bounded = handler.MaxActive == 1 && handler.Bodies.Count <= 5;
        var cadence = sequence == 59 && sessionTime == 1060 && maxGap <= 1300;
        Console.WriteLine((cadence && bounded ? "PASS" : "FAIL") + " CONCURRENT60 telemetry=60 sequence=0..59 sessionTime=1060 maxGapMs=" + maxGap + " diagRequests=" + handler.Bodies.Count + " maxInflight=" + handler.MaxActive);
        if (!(cadence && bounded)) failed++;
    }

    public static int Main()
    {
        try
        {
            BasicMatrix().GetAwaiter().GetResult();
            NonInterferenceDuringDispose("DISABLE_TIMEOUT", "disable during").GetAwaiter().GetResult();
            NonInterferenceDuringDispose("UNPAIR_TIMEOUT", "unpair during").GetAwaiter().GetResult();
            Concurrent60Seconds().GetAwaiter().GetResult();
        }
        catch (Exception error)
        {
            failed++;
            Console.WriteLine("HARNESS_EXCEPTION_TYPE=" + error.GetType().FullName);
        }
        Console.WriteLine("SUMMARY PASS=" + passed + " FAIL=" + failed);
        return failed == 0 && passed == 27 ? 0 : 1;
    }
}
