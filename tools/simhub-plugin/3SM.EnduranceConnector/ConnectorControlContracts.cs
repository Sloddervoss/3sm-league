using System;
using System.Collections.Generic;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Wat deze connector kan, met een eigen versie per feature. Dit is de clientkant
    /// van de handshake uit de brief (sectie 3) en dezelfde vorm als
    /// <c>simhubExtensions.ts → SimHubCapabilities</c>.
    ///
    /// Een ontbrekende sleutel betekent "deze connector kan het niet", niet "uit".
    /// Of een feature op dit moment beschikbaar is (kanaal aanwezig, niet stale) hoort
    /// in de kwaliteitsmetadata van het frame, niet hier.
    /// </summary>
    public sealed class ConnectorCapabilities
    {
        private readonly Dictionary<string, int> _supported;

        public ConnectorCapabilities(int revision, Dictionary<string, int> supported)
        {
            Revision = revision < 1 ? MeasurementContract.CapabilitiesRevision : revision;
            _supported = supported ?? new Dictionary<string, int>(StringComparer.Ordinal);
        }

        public int Revision { get; private set; }

        public IDictionary<string, int> Supported { get { return _supported; } }

        /// <summary>
        /// De features die deze connector daadwerkelijk implementeert. Ze staan hier
        /// met de versie van hun contract; een feature die nog niet af is hoort hier
        /// niet te staan, ook niet met versie 0.
        /// </summary>
        public static ConnectorCapabilities Implemented()
        {
            return new ConnectorCapabilities(MeasurementContract.CapabilitiesRevision,
                new Dictionary<string, int>(StringComparer.Ordinal)
                {
                    { "pitService", 1 },
                    { "wearObservation", 1 },
                    { "lapSummary", 1 },
                    { "directIrSdk", 1 },
                    { "measurementEvents", 1 },
                    { "lapSummaries", 1 },
                    { "environment", 1 }
                });
        }

        /// <summary>Compacte JSON voor het <c>capabilities</c>-lid in het frame.</summary>
        public string ToJson()
        {
            var builder = new StringBuilder(160);
            builder.Append("{\"revision\":").Append(Revision).Append(",\"supported\":{");
            var first = true;
            foreach (var pair in _supported)
            {
                if (!first) builder.Append(',');
                first = false;
                builder.Append('"').Append(pair.Key).Append("\":").Append(pair.Value);
            }
            builder.Append("}}");
            return builder.ToString();
        }
    }

    /// <summary>
    /// Het beleid dat op dit moment geldt. <see cref="Mode"/> is <c>negotiated</c>
    /// (de server antwoordde bruikbaar) of <c>compat</c> (geen bruikbaar antwoord:
    /// alleen het vaste V3-basisprofiel).
    ///
    /// De waarden zijn altijd begrensd op de lokale grenzen van de connector, ook als
    /// de server ruimer of krapper is. Een configuratie kan de plugin dus nooit
    /// sneller, groter of anders laten zenden dan hij aankan.
    /// </summary>
    public sealed class ConnectorControlState
    {
        public const string ModeNegotiated = "negotiated";
        public const string ModeCompat = "compat";

        // Lokale grenzen. De server mag hier nooit bovenop.
        public const int LocalMinSendIntervalMs = 500;
        public const int LocalMaxSendIntervalMs = 10000;
        public const int LocalDefaultSendIntervalMs = 1000;
        public const int LocalMinSampleHz = 1;
        public const int LocalMaxSampleHz = 20;
        public const int LocalDefaultSampleHz = 20;
        public const int LocalMinPayloadBudgetBytes = 4096;
        public const int LocalMaxPayloadBudgetBytes = 24000;
        public const int LocalDefaultPayloadBudgetBytes = 24000;

        // Dezelfde grenzen als de ingest.
        public const int ServerMinSendIntervalMs = 400;
        public const int ServerMaxSendIntervalMs = 10000;
        public const int ServerMinSampleHz = 1;
        public const int ServerMaxSampleHz = 50;
        public const int ServerMinPayloadBudgetBytes = 4096;
        public const int ServerMaxPayloadBudgetBytes = 24576;

        /// <summary>De features die de server mag schakelen (zelfde lijst als simhubControl.ts).</summary>
        public static readonly string[] KnownFeatures =
        {
            "pitService", "wearObservation", "lapSummary", "directIrSdk",
            "measurementEvents", "lapSummaries", "environment", "opponents"
        };

        public ConnectorControlState()
        {
            Mode = ModeCompat;
            ProtocolVersion = 3;
            SchemaRevision = MeasurementContract.SchemaRevision;
            SendIntervalMs = LocalDefaultSendIntervalMs;
            SampleHz = LocalDefaultSampleHz;
            PayloadBudgetBytes = LocalDefaultPayloadBudgetBytes;
            Features = new Dictionary<string, bool>(StringComparer.Ordinal);
        }

        public string Mode { get; set; }
        public string Reason { get; set; }
        public int ProtocolVersion { get; set; }
        public int SchemaRevision { get; set; }
        public int ConfigRevision { get; set; }
        public int SendIntervalMs { get; set; }
        public int SampleHz { get; set; }
        public int PayloadBudgetBytes { get; set; }
        public Dictionary<string, bool> Features { get; set; }
        public string RecommendedMinVersion { get; set; }
        public string UpdateChannel { get; set; }
        public DateTime? ExpiresAtUtc { get; set; }
        public DateTime? FetchedAtUtc { get; set; }

        public bool Negotiated { get { return string.Equals(Mode, ModeNegotiated, StringComparison.Ordinal); } }

        /// <summary>
        /// Mag deze versie de additieve rootkeys sturen? Alleen na een bruikbaar antwoord:
        /// een oudere server weigert ze met 422 en dan verlies je het hele frame.
        /// </summary>
        public bool AllowsExtensions { get { return Negotiated; } }

        /// <summary>Staat deze feature aan? Een onbekende of ontbrekende feature is nooit aan.</summary>
        public bool FeatureEnabled(string feature)
        {
            if (!Negotiated || Features == null || string.IsNullOrEmpty(feature)) return false;
            bool enabled;
            return Features.TryGetValue(feature, out enabled) && enabled;
        }

        public MeasurementLimits ToMeasurementLimits()
        {
            var limits = MeasurementLimits.Default();
            limits.MaxFrameBodyBytes = Math.Min(MeasurementFramePlanner.MaxFrameBodyBytes, PayloadBudgetBytes);
            return limits;
        }

        /// <summary>Geen beleid, geen nieuwe rootkeys, lokale defaults.</summary>
        public static ConnectorControlState Compat(string reason)
        {
            var state = new ConnectorControlState { Mode = ModeCompat, Reason = reason };
            return state;
        }

        public static ConnectorControlState Default()
        {
            return Compat("control_not_fetched");
        }

        public string Summary
        {
            get
            {
                return Mode + " rev=" + ConfigRevision + " send=" + SendIntervalMs + "ms sample=" + SampleHz
                    + "Hz budget=" + PayloadBudgetBytes + "B"
                    + (string.IsNullOrEmpty(Reason) ? "" : " (" + Reason + ")");
            }
        }

        /// <summary>
        /// Leest het antwoord van <c>GET /simhub-control</c>. Elke fout of afwijking
        /// eindigt in <c>compat</c> met een reden: deze functie gooit nooit, want de
        /// verzending mag niet afhangen van beleid.
        /// </summary>
        public static ConnectorControlState Parse(string json, DateTime nowUtc)
        {
            Dictionary<string, object> root;
            try
            {
                root = MeasurementJson.DeserializeDictionary(json);
            }
            catch (Exception)
            {
                return Compat("control_invalid_body");
            }
            if (root == null) return Compat("control_invalid_body");

            var ok = Bool(root, "ok");
            if (ok.HasValue && !ok.Value)
            {
                var reason = Text(root, "reason") ?? Text(root, "error") ?? "control_error";
                return Compat("control_" + reason);
            }
            if (Bool(root, "expired") == true) return Compat("control_expired");

            var revision = Integer(root, "configRevision");
            if (!revision.HasValue || revision.Value < 1) return Compat("control_no_config");

            var expiresAt = MeasurementTime.Parse(Text(root, "expiresAt"));
            if (expiresAt.HasValue && expiresAt.Value <= nowUtc) return Compat("control_expired");

            var state = new ConnectorControlState
            {
                Mode = ModeNegotiated,
                Reason = null,
                ConfigRevision = revision.Value,
                ProtocolVersion = Clamp(Integer(root, "protocolVersion") ?? 3, 3, 3),
                SchemaRevision = Clamp(Integer(root, "schemaRevision") ?? MeasurementContract.SchemaRevision,
                    1, MeasurementContract.SchemaRevision),
                SendIntervalMs = Clamp(Integer(root, "sendIntervalMs") ?? LocalDefaultSendIntervalMs,
                    LocalMinSendIntervalMs, LocalMaxSendIntervalMs),
                SampleHz = Clamp(Integer(root, "sampleHz") ?? LocalDefaultSampleHz, LocalMinSampleHz, LocalMaxSampleHz),
                PayloadBudgetBytes = Clamp(Integer(root, "payloadBudgetBytes") ?? LocalDefaultPayloadBudgetBytes,
                    LocalMinPayloadBudgetBytes, LocalMaxPayloadBudgetBytes),
                RecommendedMinVersion = Text(root, "recommendedMinVersion"),
                UpdateChannel = Text(root, "updateChannel"),
                ExpiresAtUtc = expiresAt,
                FetchedAtUtc = nowUtc
            };

            var features = Object(root, "features");
            if (features != null)
            {
                foreach (var feature in KnownFeatures)
                {
                    var value = Bool(features, feature);
                    if (value.HasValue) state.Features[feature] = value.Value;
                }
            }

            // Een beleid dat lager is dan de ingest toestaat zou bij het eerste frame 429
            // geven. De server hoort dat zelf al te begrenzen; dit is de tweede wacht.
            if (state.SendIntervalMs < ServerMinSendIntervalMs) state.SendIntervalMs = ServerMinSendIntervalMs;
            if (state.SendIntervalMs > ServerMaxSendIntervalMs) state.SendIntervalMs = ServerMaxSendIntervalMs;
            if (state.SampleHz < ServerMinSampleHz) state.SampleHz = ServerMinSampleHz;
            if (state.SampleHz > ServerMaxSampleHz) state.SampleHz = ServerMaxSampleHz;
            if (state.PayloadBudgetBytes < ServerMinPayloadBudgetBytes) state.PayloadBudgetBytes = ServerMinPayloadBudgetBytes;
            if (state.PayloadBudgetBytes > ServerMaxPayloadBudgetBytes) state.PayloadBudgetBytes = ServerMaxPayloadBudgetBytes;
            if (state.PayloadBudgetBytes > LocalMaxPayloadBudgetBytes) state.PayloadBudgetBytes = LocalMaxPayloadBudgetBytes;

            return state;
        }

        /// <summary>Is de gecachte configuratie nog geldig op dit moment?</summary>
        public bool IsUsableAt(DateTime nowUtc)
        {
            if (!Negotiated) return false;
            if (ExpiresAtUtc.HasValue && ExpiresAtUtc.Value <= nowUtc) return false;
            return true;
        }

        internal static int Clamp(int value, int minimum, int maximum)
        {
            if (value < minimum) return minimum;
            return value > maximum ? maximum : value;
        }

        internal static string Text(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            var text = value as string;
            if (text == null) return null;
            var trimmed = text.Trim();
            return trimmed.Length == 0 ? null : trimmed;
        }

        internal static int? Integer(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            if (value == null) return null;
            if (value is double)
            {
                var number = (double)value;
                if (Math.Abs(number - Math.Floor(number)) > 1e-9) return null;
                if (number < int.MinValue || number > int.MaxValue) return null;
                return (int)number;
            }
            if (value is int) return (int)value;
            if (value is long)
            {
                var number = (long)value;
                return number < int.MinValue || number > int.MaxValue ? (int?)null : (int)number;
            }
            return null;
        }

        internal static bool? Bool(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            if (value is bool) return (bool)value;
            return null;
        }

        internal static Dictionary<string, object> Object(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            return value as Dictionary<string, object>;
        }
    }
}
