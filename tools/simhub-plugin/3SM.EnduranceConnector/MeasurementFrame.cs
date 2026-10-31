using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// De grenzen van één frame. Ze komen uit het contract (sectie 8) en worden hier
    /// toegepast vóór verzending: 20 gebeurtenissen, 3 rondes, 16.384 bytes voor de
    /// twee reeksen samen en 24.576 bytes voor de hele HTTP-body.
    /// </summary>
    public sealed class MeasurementLimits
    {
        public int MaxEventsPerFrame = 20;
        public int MaxLapsPerFrame = 3;
        public int MaxMeasurementBatchBytes = 16384;
        public int MaxFrameBodyBytes = 24576;

        public static MeasurementLimits Default()
        {
            return new MeasurementLimits();
        }
    }

    /// <summary>
    /// Wat er in dit frame meegaat en wat niet. Wat niet meegaat blijft in de outbox;
    /// <see cref="DeferredEvents"/> en <see cref="DeferredLaps"/> maken dat zichtbaar
    /// in plaats van stil te laten vallen.
    /// </summary>
    public sealed class MeasurementBatchPlan
    {
        public OutboxBatch Batch { get; set; }
        /// <summary>De JSON-leden die in het frame worden geschoven (zonder accolades).</summary>
        public string MembersJson { get; set; }
        /// <summary>
        /// Alleen de twee reeksen, zonder de vaste kop. Voor een frame dat
        /// <c>schemaRevision</c> en <c>capabilities</c> al zelf draagt: een lid twee keer in
        /// hetzelfde object is geen geldige JSON meer.
        /// </summary>
        public string SeriesJson { get; set; }
        /// <summary>Bytes van de twee reeksen samen, op dezelfde manier gemeten als de Edge.</summary>
        public int MeasurementBytes { get; set; }
        public int DeferredEvents { get; set; }
        public int DeferredLaps { get; set; }
        public string Reason { get; set; }

        public MeasurementBatchPlan()
        {
            Batch = new OutboxBatch();
        }

        public bool HasMeasurements { get { return !Batch.IsEmpty; } }
    }

    /// <summary>
    /// Kiest de rijen voor één frame binnen alle grenzen.
    ///
    /// Volgorde: eerst rondeaggregaten (max 3), dan gebeurtenissen (max 20). Rondes zijn
    /// zeldzaam en groot; als gebeurtenissen eerst mochten, zou een burst van twintig
    /// events de aggregaten telkens een frame laten wachten. Wat niet past wordt
    /// uitgesteld, nooit weggegooid.
    /// </summary>
    public static class MeasurementFramePlanner
    {
        public const int MaxEventsPerFrame = 20;
        public const int MaxLapsPerFrame = 3;
        public const int MaxMeasurementBatchBytes = 16384;
        public const int MaxFrameBodyBytes = 24576;

        public static MeasurementBatchPlan Plan(OutboxBatch due, string coreCapabilitiesJson, int coreBodyBytes,
            MeasurementLimits limits)
        {
            if (limits == null) limits = MeasurementLimits.Default();
            var plan = new MeasurementBatchPlan();
            if (due == null) return plan;

            var maxBody = Math.Min(limits.MaxFrameBodyBytes, MaxFrameBodyBytes);
            var maxBatch = Math.Min(limits.MaxMeasurementBatchBytes, MaxMeasurementBatchBytes);

            // De vaste leden (schemaRevision + capabilities) kosten altijd ruimte, ook
            // zonder metingen. Ze horen bij het frame, niet bij de batch.
            var head = BuildHead(coreCapabilitiesJson);
            // Vaste leden met lege reeksen: die ruimte is altijd bezet, ook zonder rijen.
            var fixedMembers = head + ",\"measurementEvents\":[],\"lapSummaries\":[]";
            var available = maxBody - coreBodyBytes - fixedMembers.Length - 2; // 2: komma en marge
            if (available <= 2)
            {
                plan.Reason = "frame_budget_exhausted";
                plan.DeferredEvents = due.Events.Count;
                plan.DeferredLaps = due.Laps.Count;
                plan.SeriesJson = Series(new string[0], new string[0]);
                plan.MembersJson = head + "," + plan.SeriesJson;
                return plan;
            }

            var events = new List<string>();
            var laps = new List<string>();
            var budget = Math.Min(available, maxBatch);
            var used = 0;
            var added = 0;

            AddSeries(due.Laps, limits.MaxLapsPerFrame, laps, ref used, ref added, budget, true);
            AddSeries(due.Events, limits.MaxEventsPerFrame, events, ref used, ref added, budget, false);

            plan.DeferredLaps = due.Laps.Count - laps.Count;
            plan.DeferredEvents = due.Events.Count - events.Count;
            plan.MeasurementBytes = MeasurementJson.Bytes(MeasurementJson.Batch(events, laps));
            plan.SeriesJson = Series(events, laps);
            plan.MembersJson = head + "," + plan.SeriesJson;

            // De batch in payloadvolgorde: rondes eerst, daarna events.
            for (var index = 0; index < laps.Count; index++) plan.Batch.Laps.Add(due.Laps[index]);
            for (var index = 0; index < events.Count; index++) plan.Batch.Events.Add(due.Events[index]);

            if (plan.DeferredEvents > 0 || plan.DeferredLaps > 0)
                plan.Reason = "deferred_by_budget";
            return plan;
        }

        private static void AddSeries(List<OutboxEntry> source, int max, List<string> rows,
            ref int used, ref int added, int budget, bool isLap)
        {
            if (source == null) return;
            for (var index = 0; index < source.Count && rows.Count < max; index++)
            {
                var row = source[index].RowJson;
                if (string.IsNullOrEmpty(row)) continue;
                var cost = MeasurementJson.Bytes(row) + (rows.Count == 0 ? 0 : 1);
                if (used + cost > budget) return;
                used += cost;
                added += cost;
                rows.Add(row);
            }
        }

        /// <summary>
        /// De vaste leden van de meetserie: <c>schemaRevision</c> en <c>capabilities</c>.
        /// Ze staan hier en niet in de envelope, omdat de envelope bevroren is en deze
        /// blokken additief zijn.
        /// </summary>
        private static string BuildHead(string capabilitiesJson)
        {
            var capabilities = string.IsNullOrEmpty(capabilitiesJson) ? "{\"revision\":1,\"supported\":{}}" : capabilitiesJson;
            return "\"schemaRevision\":" + MeasurementContract.SchemaRevision
                + ",\"capabilities\":" + capabilities;
        }

        /// <summary>De twee reeksen, zonder de vaste kop.</summary>
        private static string Series(IList<string> events, IList<string> laps)
        {
            return "\"measurementEvents\":[" + string.Join(",", ToArray(events))
                + "],\"lapSummaries\":[" + string.Join(",", ToArray(laps)) + "]";
        }

        private static string[] ToArray(IList<string> rows)
        {
            return rows == null ? new string[0] : new List<string>(rows).ToArray();
        }
    }

    /// <summary>Uitslag van één meetverzending, zodat de plugin het kan tonen zonder te gokken.</summary>
    public sealed class MeasurementSendResult
    {
        public bool Sent { get; set; }
        public int StatusCode { get; set; }
        public int EventsSent { get; set; }
        public int LapsSent { get; set; }
        public int DeferredEvents { get; set; }
        public int DeferredLaps { get; set; }
        public bool ConfirmationsSeen { get; set; }
        public bool Stored { get; set; }
        public string BlockError { get; set; }
        public string Error { get; set; }

        public string Summary
        {
            get
            {
                if (!Sent) return Error ?? "niets te versturen";
                return "events=" + EventsSent + " laps=" + LapsSent
                    + " uitgesteld=" + (DeferredEvents + DeferredLaps)
                    + " bevestigd=" + (ConfirmationsSeen ? "ja" : "nee")
                    + (string.IsNullOrEmpty(BlockError) ? "" : " reden=" + BlockError);
            }
        }
    }

    /// <summary>
    /// Verstuurt de meetserie MEE met het gewone frame (één POST, één rate-limit) en
    /// verwerkt daarna het ACK per rij.
    ///
    /// Waarom in hetzelfde frame: het contract kent de reeksen als frame-leden en de
    /// ingest telt één frame per 400 ms. Een tweede POST zou een tweede frame zijn en
    /// door de rate-limit geweigerd worden.
    /// </summary>
    public sealed class MeasurementSender
    {
        private readonly MeasurementOutbox _outbox;
        private readonly HttpClient _http;
        private readonly MeasurementLimits _limits;
        private readonly Func<string> _capabilitiesJson;

        public MeasurementSender(MeasurementOutbox outbox, HttpClient http, Func<string> capabilitiesJson,
            MeasurementLimits limits)
        {
            if (outbox == null) throw new ArgumentNullException("outbox");
            _outbox = outbox;
            _http = http;
            _capabilitiesJson = capabilitiesJson ?? (() => null);
            _limits = limits ?? MeasurementLimits.Default();
        }

        public MeasurementLimits Limits { get { return _limits; } }

        /// <summary>Welke rijen zouden in een frame van deze grootte passen?</summary>
        public MeasurementBatchPlan Plan(int coreBodyBytes, DateTime nowUtc)
        {
            // Alle rijen die nu mogen: de planner past de aantallen en het bytebudget toe,
            // zodat "uitgesteld" ook echt telt wat er deze keer niet in paste.
            var due = _outbox.Due(nowUtc, int.MaxValue, int.MaxValue);
            return MeasurementFramePlanner.Plan(due, SafeCapabilities(), coreBodyBytes, _limits);
        }

        /// <summary>
        /// Bouwt het frame met de meetserie erin. Geeft null als er niets te sturen is.
        /// De kern blijft byte-voor-byte gelijk; de meetsleutels worden ingeschoven.
        /// </summary>
        public string BuildBody(string coreBodyJson, int coreBodyBytes, DateTime nowUtc,
            out MeasurementBatchPlan plan)
        {
            plan = Plan(coreBodyBytes, nowUtc);
            if (!plan.HasMeasurements) return null;
            // Draagt de kern de vaste leden al — de envelope doet dat sinds 0.7.2.0 zelf —
            // dan gaan alleen de twee reeksen erbij. Hetzelfde lid twee keer in één object
            // is geen geldige JSON, ook niet als de waarde toevallig gelijk is.
            var members = MeasurementJson.FrameDeclaresMember(coreBodyJson, "schemaRevision")
                ? plan.SeriesJson
                : plan.MembersJson;
            return MeasurementJson.InjectIntoFrame(coreBodyJson, members);
        }

        /// <summary>
        /// Verstuurt één frame inclusief meetserie en verwerkt het ACK.
        ///
        /// Faalt de POST, dan blijven de rijen staan en gaat de backoff in. Lukt de POST
        /// maar ontbreekt de bevestiging per rij, dan blijven ze ook staan: een 202 is
        /// geen leveringsbewijs.
        /// </summary>
        public async Task<MeasurementSendResult> SendAsync(Uri endpoint, string token, string coreBodyJson,
            DateTime nowUtc, CancellationToken cancellationToken)
        {
            var result = new MeasurementSendResult();
            if (endpoint == null || string.IsNullOrEmpty(coreBodyJson))
            {
                result.Error = "invalid_request";
                return result;
            }
            int coreBytes;
            try
            {
                coreBytes = Encoding.UTF8.GetByteCount(coreBodyJson);
            }
            catch (Exception error)
            {
                result.Error = "encode_failed:" + error.GetType().Name;
                return result;
            }

            MeasurementBatchPlan plan;
            string body;
            try
            {
                body = BuildBody(coreBodyJson, coreBytes, nowUtc, out plan);
            }
            catch (Exception error)
            {
                result.Error = "frame_build_failed:" + error.GetType().Name;
                return result;
            }
            result.DeferredEvents = plan.DeferredEvents;
            result.DeferredLaps = plan.DeferredLaps;
            if (body == null)
            {
                result.Error = plan.Reason ?? "nothing_due";
                return result;
            }

            var sent = new List<OutboxEntry>(plan.Batch.Events.Count + plan.Batch.Laps.Count);
            sent.AddRange(plan.Batch.Events);
            sent.AddRange(plan.Batch.Laps);
            result.EventsSent = plan.Batch.Events.Count;
            result.LapsSent = plan.Batch.Laps.Count;

            string responseBody = null;
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                    {
                        result.StatusCode = (int)response.StatusCode;
                        result.Sent = true;
                        if (!response.IsSuccessStatusCode)
                        {
                            result.Error = "relay_http_" + result.StatusCode;
                            _outbox.MarkAttempt(sent, nowUtc, true);
                            return result;
                        }
                        responseBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                result.Error = "cancelled";
                return result;
            }
            catch (Exception error)
            {
                result.Error = "post_failed:" + error.GetType().Name;
                _outbox.MarkAttempt(sent, nowUtc, true);
                return result;
            }

            var ack = MeasurementAckParser.Parse(responseBody, plan.Batch);
            var outcome = _outbox.ApplyAck(ack, nowUtc);
            result.ConfirmationsSeen = outcome.Removed > 0;

            // Wat de server niet duurzaam heeft opgeslagen, blijft staan en gaat met
            // backoff opnieuw. Wat bevestigd is, is al uit de wachtrij verdwenen.
            var remaining = new List<OutboxEntry>();
            foreach (var entry in sent)
            {
                if (_outbox.Contains(entry.Uid)) remaining.Add(entry);
            }

            // "stored:true" terwijl er rijen uit deze batch blijven staan is geen
            // levering. Zonder deze regel zou dezelfde batch elk frame opnieuw gaan,
            // zonder wachttijd. Behandel het als niet opgeslagen, zodat de backoff geldt.
            var stored = outcome.Stored && remaining.Count == 0;
            if (outcome.Stored && remaining.Count > 0)
            {
                outcome.BlockError = "ack_without_row_confirmation";
            }
            result.Stored = stored;
            result.BlockError = outcome.BlockError;
            _outbox.MarkAttempt(remaining, nowUtc, !stored);
            if (!stored && string.IsNullOrEmpty(result.Error))
            {
                result.Error = "not_stored:" + (outcome.BlockError ?? "unknown");
            }
            return result;
        }

        private string SafeCapabilities()
        {
            try
            {
                return _capabilitiesJson();
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
