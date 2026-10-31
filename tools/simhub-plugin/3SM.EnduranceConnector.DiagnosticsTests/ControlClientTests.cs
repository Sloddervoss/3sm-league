using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using ThreeSM.EnduranceConnector;

// De configuratieclient: beleid ophalen, begrenzen en bij elk falen terugvallen op
// het vaste V3-basisprofiel. Nooit blokkeren, nooit stil een vreemde waarde toepassen.
internal static class ControlClientTests
{
    private static readonly DateTime Now = new DateTime(2026, 10, 31, 15, 0, 0, DateTimeKind.Utc);

    private sealed class ControlRelay : HttpMessageHandler
    {
        public HttpStatusCode Status = HttpStatusCode.OK;
        public string Body = "{}";
        public bool Throw;
        public int DelayMs;
        public int Calls;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            if (DelayMs > 0) await Task.Delay(DelayMs, cancellationToken);
            if (Throw) throw new HttpRequestException("geen netwerk");
            return new HttpResponseMessage(Status) { Content = new StringContent(Body) };
        }
    }

    private static string Body(
        int configRevision = 7,
        int sendIntervalMs = 750,
        int sampleHz = 12,
        int payloadBudgetBytes = 20000,
        bool expired = false,
        string expiresAt = "\"2099-01-01T00:00:00.000Z\"",
        string features = "{\"lapSummary\":true,\"wearObservation\":true,\"measurementEvents\":false,\"onbekend\":true,",
        string tail = "\"pitService\":\"ja\"")
    {
        return "{\"ok\":true,\"serverTime\":\"2026-10-31T15:00:00.000Z\",\"protocolVersion\":3,\"schemaRevision\":1,"
            + "\"limits\":{\"minSendIntervalMs\":400,\"maxSendIntervalMs\":10000,\"minSampleHz\":1,\"maxSampleHz\":50,"
            + "\"minPayloadBudgetBytes\":4096,\"maxPayloadBudgetBytes\":24576},"
            + "\"expired\":" + (expired ? "true" : "false")
            + ",\"configRevision\":" + configRevision
            + ",\"sendIntervalMs\":" + sendIntervalMs
            + ",\"sampleHz\":" + sampleHz
            + ",\"payloadBudgetBytes\":" + payloadBudgetBytes
            + ",\"features\":" + features + tail + "},"
            + "\"recommendedMinVersion\":\"0.7.2.0\",\"updateChannel\":\"stable\",\"maintenanceWindow\":null,"
            + "\"expiresAt\":" + expiresAt + ",\"updatedAt\":\"2026-10-31T14:00:00.000Z\"}";
    }

    private static ConnectorControlClient Client(ControlRelay relay, string token = "token")
    {
        return new ConnectorControlClient(new Uri("https://example.test/functions/v1"), new HttpClient(relay), token, () => Now);
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        // ------------------------------------------------------------- defaults
        var defaults = ConnectorControlState.Default();
        Check("C01", !defaults.Negotiated && !defaults.AllowsExtensions
            && defaults.SendIntervalMs == 1000 && defaults.SampleHz == 20 && defaults.PayloadBudgetBytes == 24000,
            "zonder beleid gelden lokale defaults en gaan er geen nieuwe rootkeys mee");

        // -------------------------------------------------------------- beleid
        var negotiated = ConnectorControlState.Parse(Body(), Now);
        Check("C02", negotiated.Negotiated && negotiated.ConfigRevision == 7
            && negotiated.SendIntervalMs == 750 && negotiated.SampleHz == 12
            && negotiated.PayloadBudgetBytes == 20000 && negotiated.AllowsExtensions,
            "een bruikbaar antwoord levert beleid op (" + negotiated.Summary + ")");
        Check("C03", negotiated.FeatureEnabled("lapSummary") && negotiated.FeatureEnabled("wearObservation")
            && !negotiated.FeatureEnabled("measurementEvents"),
            "features volgen het antwoord: true aan, false uit");
        Check("C04", !negotiated.FeatureEnabled("onbekend") && !negotiated.FeatureEnabled("pitService"),
            "een onbekende feature en een niet-boolese waarde zijn nooit aan");
        Check("C05", negotiated.RecommendedMinVersion == "0.7.2.0" && negotiated.UpdateChannel == "stable",
            "de aanbevolen minimumversie en het kanaal worden bewaard");

        // Begrenzen op lokale grenzen.
        var clamped = ConnectorControlState.Parse(Body(sendIntervalMs: 100, sampleHz: 200, payloadBudgetBytes: 999999), Now);
        Check("C06", clamped.SendIntervalMs == 500 && clamped.SampleHz == 20 && clamped.PayloadBudgetBytes == 24000,
            "waarden buiten de lokale grenzen worden begrensd, niet overgenomen ("
            + clamped.SendIntervalMs + "/" + clamped.SampleHz + "/" + clamped.PayloadBudgetBytes + ")");
        var tooSlow = ConnectorControlState.Parse(Body(sendIntervalMs: 99999), Now);
        Check("C07", tooSlow.SendIntervalMs == 10000, "een te langzaam interval wordt op het maximum gezet");

        // Verlopen en onbruikbaar beleid.
        Check("C08", !ConnectorControlState.Parse(Body(expired: true), Now).Negotiated,
            "expired:true betekent lokaal beleid, geen overgenomen configuratie");
        Check("C09", !ConnectorControlState.Parse(Body(expiresAt: "\"2020-01-01T00:00:00.000Z\""), Now).Negotiated,
            "een verlopen expiresAt geldt niet");
        Check("C10", ConnectorControlState.Parse(Body(expiresAt: "\"2020-01-01T00:00:00.000Z\""), Now).Reason == "control_expired",
            "de reden van een verlopen configuratie staat erbij");
        Check("C11", !ConnectorControlState.Parse(Body(configRevision: 0), Now).Negotiated,
            "zonder configRevision is er geen beleid");
        Check("C12", !ConnectorControlState.Parse("{\"ok\":false,\"reason\":\"config_read_failed\"}", Now).Negotiated
            && ConnectorControlState.Parse("{\"ok\":false,\"reason\":\"config_read_failed\"}", Now).Reason == "control_config_read_failed",
            "een 503-antwoord wordt compat met de reden");
        Check("C13", ConnectorControlState.Parse("dit is geen json", Now).Reason == "control_invalid_body",
            "onleesbare JSON wordt compat, geen exception");
        Check("C14", ConnectorControlState.Parse("", Now).Reason == "control_invalid_body",
            "een lege body wordt compat");

        // ---------------------------------------------------------- capability
        var capabilities = ConnectorCapabilities.Implemented();
        var capabilitiesJson = capabilities.ToJson();
        var parsedCapabilities = MeasurementJson.DeserializeDictionary(capabilitiesJson);
        var supported = parsedCapabilities["supported"] as Dictionary<string, object>;
        Check("C15", Convert.ToInt32(parsedCapabilities["revision"]) == 1 && supported != null
            && supported.Count == 7 && supported.ContainsKey("measurementEvents")
            && supported.ContainsKey("lapSummaries") && supported.ContainsKey("directIrSdk"),
            "capabilities noemen de geïmplementeerde features met een versie");
        Check("C16", supported != null && supported.Values.All(value => value is double)
            && capabilitiesJson.Contains("\"wearObservation\":1"),
            "de capability-versies zijn integers in JSON");

        // ----------------------------------------------------------- netwerk
        var relay = new ControlRelay { Body = Body() };
        var client = Client(relay);
        var fetched = client.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        Check("C17", fetched.Negotiated && relay.Calls == 1 && fetched.FetchedAtUtc == Now,
            "de client haalt het beleid op en onthoudt wanneer");
        Check("C18", client.Current.Negotiated && !client.ShouldRefresh(Now.AddSeconds(60))
            && client.ShouldRefresh(Now.AddSeconds(901)),
            "het beleid wordt niet vaker dan het interval opgehaald");

        var failing = new ControlRelay { Status = HttpStatusCode.ServiceUnavailable, Body = "{\"ok\":false}" };
        var failingClient = Client(failing);
        var failed = failingClient.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        Check("C19", !failed.Negotiated && failed.Reason == "control_http_503" && !failed.AllowsExtensions,
            "een 503 blokkeert niets: compat met de status als reden");
        Check("C20", failingClient.ShouldRefresh(Now.AddSeconds(61)),
            "na een storing wordt het na een minuut opnieuw geprobeerd");

        var throwing = new ControlRelay { Throw = true };
        var throwingClient = Client(throwing);
        var thrown = throwingClient.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        Check("C21", !thrown.Negotiated && thrown.SendIntervalMs == 1000,
            "een netwerkexception levert compat met lokale defaults, geen crash");

        var slow = new ControlRelay { Body = Body(), DelayMs = 5000 };
        var slowClient = Client(slow);
        var started = DateTime.UtcNow;
        var timedOut = slowClient.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        var elapsed = (DateTime.UtcNow - started).TotalSeconds;
        Check("C22", !timedOut.Negotiated && timedOut.Reason == "control_timeout" && elapsed < 4.5,
            "een traag endpoint wordt na 3 s afgebroken en blokkeert de verzending niet ("
            + Math.Round(elapsed, 1) + " s)");

        // ------------------------------------------------------------- cache
        var directory = Path.Combine(Path.GetTempPath(), "3sm-control-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var cachePath = Path.Combine(directory, "control.json");
        var cachedClient = Client(new ControlRelay { Body = Body() });
        cachedClient.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        cachedClient.SaveCache(cachePath);

        var restarted = Client(new ControlRelay { Status = HttpStatusCode.ServiceUnavailable });
        restarted.LoadCache(cachePath);
        Check("C23", restarted.Current.Negotiated && restarted.Current.Reason == "control_cache"
            && restarted.Current.SendIntervalMs == 750 && restarted.Current.FeatureEnabled("lapSummary"),
            "na een herstart geldt de bewaarde configuratie, met de features");
        Check("C24", restarted.Current.AllowsExtensions,
            "een geldige cache staat de additieve blokken toe");

        // Een bewaarde configuratie die verlopen is, geldt niet meer.
        var expiredPath = Path.Combine(directory, "control-expired.json");
        File.WriteAllText(expiredPath,
            "{\"version\":1,\"configRevision\":5,\"schemaRevision\":1,\"sendIntervalMs\":700,"
            + "\"sampleHz\":10,\"payloadBudgetBytes\":16000,\"features\":\"lapSummary=1\","
            + "\"expiresAt\":\"2020-01-01T00:00:00.000Z\",\"fetchedAt\":\"2020-01-01T00:00:00.000Z\"}");
        var expiredRestart = Client(new ControlRelay { Status = HttpStatusCode.ServiceUnavailable });
        expiredRestart.LoadCache(expiredPath);
        Check("C25", !expiredRestart.Current.Negotiated && expiredRestart.Current.SendIntervalMs == 1000,
            "een verlopen cache wordt niet toegepast en zet geen beleid");

        // ------------------------------------------------------------ grenzen
        var limits = negotiated.ToMeasurementLimits();
        Check("C26", limits.MaxEventsPerFrame == 20 && limits.MaxLapsPerFrame == 3
            && limits.MaxMeasurementBatchBytes == 16384 && limits.MaxFrameBodyBytes == 20000,
            "het serverbudget wordt de bodylimiet en de aantallen blijven die van het contract");
        var smallBudget = ConnectorControlState.Parse(Body(payloadBudgetBytes: 4096), Now).ToMeasurementLimits();
        Check("C27", smallBudget.MaxFrameBodyBytes == 4096,
            "een klein serverbudget verkleint de body, niet de batchregels van het contract");

        var compat = ConnectorControlState.Compat("test");
        compat.Features["lapSummary"] = true;
        Check("C28", !compat.FeatureEnabled("lapSummary") && !compat.AllowsExtensions,
            "in compatmodus staat geen enkele nieuwe feature aan, ook niet als de lijst gevuld is");

        return count;
    }
}
