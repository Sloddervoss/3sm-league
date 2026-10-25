using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Kopregel van één research-sessie. Eén bestand per sessie, dus de kop staat altijd
    /// op regel 1 en wordt nooit herschreven.
    /// </summary>
    public sealed class ResearchSessionHeader
    {
        public int SchemaVersion = ResearchJsonl.SchemaVersion;
        public string PluginVersion;
        public string SimHubVersion;
        public string Simulator;
        public string SimulatorVersion;
        public string TrackName;
        public string TrackConfig;
        public int? TrackId;
        public string CarId;
        public string CarName;
        public string SessionId;
        public string TransportSessionId;
        public DateTime StartedAtUtc;
        public int SamplingIntervalMs;
        public int CaptureIntervalMs;
        public string DriverPseudoId;
        public int QueueCapacity;
    }

    /// <summary>
    /// Schrijft de JSONL-regels. Handgeschreven en cultuuronafhankelijk: geen
    /// DataContract-serializer op de achtergrondthread, geen verrassende key-volgorde en
    /// geen NaN/Infinity in het bestand (die zijn al bij de classificatie afgevangen).
    /// </summary>
    public static class ResearchJsonl
    {
        public const int SchemaVersion = 1;
        public const string LineEnding = "\n";

        public static string Header(ResearchSessionHeader header)
        {
            if (header == null) throw new ArgumentNullException("header");
            var sb = new StringBuilder(768);
            sb.Append("{\"type\":\"session_header\"");
            sb.Append(",\"schemaVersion\":").Append(header.SchemaVersion.ToString(CultureInfo.InvariantCulture));
            WriteOptionalString(sb, "pluginVersion", header.PluginVersion);
            WriteOptionalString(sb, "simHubVersion", header.SimHubVersion);
            WriteOptionalString(sb, "simulator", header.Simulator);
            WriteOptionalString(sb, "simulatorVersion", header.SimulatorVersion);

            // Eenheden: alles wat de recorder wegschrijft staat hier, zodat een lezer nooit
            // hoeft te raden. steeringWheelAngle is de ruwe iRacing-radiaal.
            sb.Append(",\"units\":{");
            sb.Append("\"speed\":\"kmh\",\"distance\":\"m\",\"acceleration\":\"m/s2\",\"steering\":\"rad\"");
            sb.Append(",\"pedals\":\"percent\",\"temperature\":\"C\",\"pressure\":\"kPa\",\"fuel\":\"L\"");
            sb.Append(",\"time\":\"s\",\"wear\":\"percent\"}");

            sb.Append(",\"track\":{");
            sb.Append("\"name\":");
            WriteQuotedValue(sb, header.TrackName);
            sb.Append(",\"config\":");
            WriteQuotedValue(sb, header.TrackConfig);
            if (header.TrackId.HasValue)
            {
                sb.Append(",\"id\":").Append(header.TrackId.Value.ToString(CultureInfo.InvariantCulture));
            }
            sb.Append('}');

            sb.Append(",\"car\":{");
            sb.Append("\"id\":");
            WriteQuotedValue(sb, header.CarId);
            sb.Append(",\"name\":");
            WriteQuotedValue(sb, header.CarName);
            sb.Append('}');

            WriteOptionalString(sb, "sessionId", header.SessionId);
            WriteOptionalString(sb, "transportSessionId", header.TransportSessionId);
            sb.Append(",\"startedAtUtc\":\"").Append(ResearchFormat.Timestamp(header.StartedAtUtc)).Append('"');

            sb.Append(",\"sampling\":{");
            sb.Append("\"contextMs\":").Append(header.SamplingIntervalMs.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"captureMs\":").Append(header.CaptureIntervalMs.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"tyres\":\"on_sim_refresh\"}");

            sb.Append(",\"queue\":{");
            sb.Append("\"capacity\":").Append(header.QueueCapacity.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"dropPolicy\":\"non_blocking_counted\"}");

            // Privacy: de recorder schrijft nooit een rijdersnaam. Alleen een pseudonieme ID
            // (SHA-256 met lokale salt) staat in de kop.
            sb.Append(",\"privacy\":{\"driverNames\":\"omitted\",\"opponentNames\":\"omitted\"");
            sb.Append(",\"pseudonym\":\"sha256(salt|driverId)\",\"localOnly\":true}");
            WriteOptionalString(sb, "driverPseudoId", header.DriverPseudoId);

            // Drops zijn per definitie pas bekend nadat er al geschreven is; de kop noemt het
            // beleid, de status- en session_end-records dragen de cumulatieve teller.
            sb.Append(",\"droppedSamplesAtOpen\":0");
            sb.Append(",\"dropAccounting\":\"cumulative in status/session_end records\"");
            sb.Append('}');
            return sb.ToString();
        }

        public static string Sample(DateTime atUtc, double? sessionTimeSeconds, long sequence,
            IList<KeyValuePair<string, ResearchField>> fields, int samplingIntervalMs)
        {
            var sb = new StringBuilder(1536);
            sb.Append("{\"type\":\"sample\",\"ts\":\"").Append(ResearchFormat.Timestamp(atUtc)).Append('"');
            if (sessionTimeSeconds.HasValue)
            {
                sb.Append(",\"sessionTimeSeconds\":").Append(ResearchFormat.Number(sessionTimeSeconds.Value));
            }
            sb.Append(",\"sequence\":").Append(sequence.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"fields\":{");
            if (fields != null)
            {
                var first = true;
                for (var index = 0; index < fields.Count; index++)
                {
                    var field = fields[index];
                    if (field.Key == null) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    WriteField(sb, field.Key, field.Value, atUtc, samplingIntervalMs);
                }
            }
            sb.Append("}}");
            return sb.ToString();
        }

        public static string Event(DateTime atUtc, double? sessionTimeSeconds, long sequence,
            string kind, string source, IList<KeyValuePair<string, object>> data)
        {
            var sb = new StringBuilder(320);
            sb.Append("{\"type\":\"event\",\"ts\":\"").Append(ResearchFormat.Timestamp(atUtc)).Append('"');
            if (sessionTimeSeconds.HasValue)
            {
                sb.Append(",\"sessionTimeSeconds\":").Append(ResearchFormat.Number(sessionTimeSeconds.Value));
            }
            sb.Append(",\"sequence\":").Append(sequence.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"kind\":\"").Append(Escape(kind)).Append('"');
            sb.Append(",\"source\":\"").Append(Escape(source ?? "auto")).Append('"');
            sb.Append(",\"data\":{");
            var first = true;
            if (data != null)
            {
                for (var index = 0; index < data.Count; index++)
                {
                    var item = data[index];
                    if (item.Key == null || item.Value == null) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append('"').Append(Escape(item.Key)).Append("\":");
                    WriteUntyped(sb, item.Value);
                }
            }
            sb.Append("}}");
            return sb.ToString();
        }

        public static string Status(DateTime atUtc, long written, long queued, long dropped, bool paused)
        {
            var sb = new StringBuilder(192);
            sb.Append("{\"type\":\"status\",\"ts\":\"").Append(ResearchFormat.Timestamp(atUtc)).Append('"');
            sb.Append(",\"written\":").Append(written.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"queued\":").Append(queued.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"droppedSamples\":").Append(dropped.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"paused\":").Append(paused ? "true" : "false");
            sb.Append('}');
            return sb.ToString();
        }

        public static string SessionEnd(DateTime atUtc, string reason, long samplesWritten, long eventsWritten,
            long droppedSamples, long bytesWritten, double durationSeconds, bool closedCleanly)
        {
            var sb = new StringBuilder(256);
            // Let op: dit is de samenvattende afsluitregel van het bestand, niet de
            // protocol-marker "session_end" (die is type=event, kind=session_end).
            sb.Append("{\"type\":\"session_close\",\"ts\":\"").Append(ResearchFormat.Timestamp(atUtc)).Append('"');
            sb.Append(",\"reason\":\"").Append(Escape(reason ?? "unknown")).Append('"');
            sb.Append(",\"samplesWritten\":").Append(samplesWritten.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"eventsWritten\":").Append(eventsWritten.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"droppedSamples\":").Append(droppedSamples.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"bytesWritten\":").Append(bytesWritten.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"durationSeconds\":").Append(ResearchFormat.Number(Math.Round(durationSeconds, 2)));
            sb.Append(",\"closedCleanly\":").Append(closedCleanly ? "true" : "false");
            sb.Append('}');
            return sb.ToString();
        }

        private static void WriteField(StringBuilder sb, string key, ResearchField field, DateTime sampleAtUtc, int samplingIntervalMs)
        {
            sb.Append('"').Append(Escape(key)).Append("\":{");
            if (field == null)
            {
                sb.Append("\"p\":\"unavailable\",\"r\":\"no_field\"}");
                return;
            }
            if (field.Number.HasValue) sb.Append("\"v\":").Append(ResearchFormat.Number(field.Number.Value));
            else if (field.Flag.HasValue) sb.Append("\"v\":").Append(field.Flag.Value ? "true" : "false");
            else if (field.Text != null) sb.Append("\"v\":").Append(Quote(field.Text));
            else sb.Append("\"v\":null");

            sb.Append(",\"p\":\"").Append(ResearchProvenanceNames.ToWire(field.Provenance)).Append('"');

            // Het meets-tijdstip staat er alleen als het afwijkt van het sample-tijdstip;
            // anders is het veld een meting op dit sample en zou de waarde dubbel staan.
            if (field.MeasuredAtUtc.HasValue && !SameInstant(field.MeasuredAtUtc.Value, sampleAtUtc))
            {
                sb.Append(",\"at\":\"").Append(ResearchFormat.Timestamp(field.MeasuredAtUtc.Value)).Append('"');
            }
            // Alleen markeren als de bron op een andere frequentie draait dan het sample.
            if (field.RateMs != samplingIntervalMs)
            {
                sb.Append(",\"rateMs\":").Append(field.RateMs.ToString(CultureInfo.InvariantCulture));
            }
            if (!string.IsNullOrEmpty(field.Reason))
            {
                sb.Append(",\"r\":\"").Append(Escape(field.Reason)).Append('"');
            }
            sb.Append('}');
        }

        private static bool SameInstant(DateTime left, DateTime right)
        {
            return Math.Abs((left.ToUniversalTime() - right.ToUniversalTime()).TotalMilliseconds) < 1.0;
        }

        private static void WriteUntyped(StringBuilder sb, object value)
        {
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            if (value is int) { sb.Append(((int)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is long) { sb.Append(((long)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is double)
            {
                var number = (double)value;
                if (double.IsNaN(number) || double.IsInfinity(number)) { sb.Append("null"); return; }
                sb.Append(ResearchFormat.Number(number));
                return;
            }
            sb.Append(Quote(value.ToString()));
        }

        private static void WriteOptionalString(StringBuilder sb, string key, string value)
        {
            sb.Append(",\"").Append(key).Append("\":");
            WriteQuotedValue(sb, value);
        }

        private static void WriteQuotedValue(StringBuilder sb, string value)
        {
            if (string.IsNullOrEmpty(value)) sb.Append("null");
            else sb.Append(Quote(value));
        }

        private static string Quote(string value)
        {
            return "\"" + Escape(value) + "\"";
        }

        /// <summary>JSON-string-escaping; alleen wat JSON echt eist.</summary>
        public static string Escape(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            StringBuilder builder = null;
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                string replacement = null;
                switch (character)
                {
                    case '"': replacement = "\\\""; break;
                    case '\\': replacement = "\\\\"; break;
                    case '\n': replacement = "\\n"; break;
                    case '\r': replacement = "\\r"; break;
                    case '\t': replacement = "\\t"; break;
                    case '\b': replacement = "\\b"; break;
                    case '\f': replacement = "\\f"; break;
                    default:
                        if (character < ' ' || character == '\u007f')
                        {
                            replacement = "\\u" + ((int)character).ToString("x4", CultureInfo.InvariantCulture);
                        }
                        break;
                }
                if (replacement == null)
                {
                    if (builder != null) builder.Append(character);
                    continue;
                }
                if (builder == null)
                {
                    builder = new StringBuilder(value.Length + 16);
                    builder.Append(value, 0, index);
                }
                builder.Append(replacement);
            }
            return builder == null ? value : builder.ToString();
        }
    }

    /// <summary>
    /// Minimale JSON-lezer voor het teruglezen en valideren van JSONL-regels (crash-herstel,
    /// tests, exportcontrole). Geen dependency, geen aannames over key-volgorde.
    /// </summary>
    public static class ResearchJsonParser
    {
        public static bool TryParse(string text, out Dictionary<string, object> result)
        {
            result = null;
            if (string.IsNullOrEmpty(text)) return false;
            try
            {
                var index = 0;
                var value = ParseValue(text, ref index, 0);
                SkipWhitespace(text, ref index);
                if (index != text.Length) return false;
                result = value as Dictionary<string, object>;
                return result != null;
            }
            catch (FormatException)
            {
                return false;
            }
            catch (IndexOutOfRangeException)
            {
                return false;
            }
        }

        private const int MaxDepth = 32;

        private static object ParseValue(string text, ref int index, int depth)
        {
            if (depth > MaxDepth) throw new FormatException("nesting too deep");
            SkipWhitespace(text, ref index);
            if (index >= text.Length) throw new FormatException("unexpected end");
            var character = text[index];
            switch (character)
            {
                case '{': return ParseObject(text, ref index, depth);
                case '[': return ParseArray(text, ref index, depth);
                case '"': return ParseString(text, ref index);
                case 't': Expect(text, ref index, "true"); return true;
                case 'f': Expect(text, ref index, "false"); return false;
                case 'n': Expect(text, ref index, "null"); return null;
                default: return ParseNumber(text, ref index);
            }
        }

        private static Dictionary<string, object> ParseObject(string text, ref int index, int depth)
        {
            index++; // {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == '}') { index++; return result; }
            while (true)
            {
                SkipWhitespace(text, ref index);
                if (index >= text.Length || text[index] != '"') throw new FormatException("expected key");
                var key = ParseString(text, ref index);
                SkipWhitespace(text, ref index);
                if (index >= text.Length || text[index] != ':') throw new FormatException("expected colon");
                index++;
                result[key] = ParseValue(text, ref index, depth + 1);
                SkipWhitespace(text, ref index);
                if (index >= text.Length) throw new FormatException("unterminated object");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == '}') { index++; return result; }
                throw new FormatException("expected comma");
            }
        }

        private static List<object> ParseArray(string text, ref int index, int depth)
        {
            index++; // [
            var result = new List<object>();
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == ']') { index++; return result; }
            while (true)
            {
                result.Add(ParseValue(text, ref index, depth + 1));
                SkipWhitespace(text, ref index);
                if (index >= text.Length) throw new FormatException("unterminated array");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == ']') { index++; return result; }
                throw new FormatException("expected comma");
            }
        }

        private static string ParseString(string text, ref int index)
        {
            if (text[index] != '"') throw new FormatException("expected string");
            index++;
            var builder = new StringBuilder();
            while (true)
            {
                if (index >= text.Length) throw new FormatException("unterminated string");
                var character = text[index++];
                if (character == '"') return builder.ToString();
                if (character != '\\') { builder.Append(character); continue; }
                if (index >= text.Length) throw new FormatException("unterminated escape");
                var escape = text[index++];
                switch (escape)
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (index + 4 > text.Length) throw new FormatException("short unicode escape");
                        var code = int.Parse(text.Substring(index, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                        builder.Append((char)code);
                        index += 4;
                        break;
                    default: throw new FormatException("unknown escape");
                }
            }
        }

        private static double ParseNumber(string text, ref int index)
        {
            var start = index;
            if (index < text.Length && (text[index] == '-' || text[index] == '+')) index++;
            while (index < text.Length)
            {
                var character = text[index];
                var digit = character >= '0' && character <= '9';
                if (digit || character == '.' || character == 'e' || character == 'E' || character == '+' || character == '-') index++;
                else break;
            }
            if (index == start) throw new FormatException("expected number");
            var slice = text.Substring(start, index - start);
            double parsed;
            if (!double.TryParse(slice, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) throw new FormatException("bad number");
            return parsed;
        }

        private static void Expect(string text, ref int index, string literal)
        {
            if (index + literal.Length > text.Length) throw new FormatException("short literal");
            if (string.CompareOrdinal(text, index, literal, 0, literal.Length) != 0) throw new FormatException("bad literal");
            index += literal.Length;
        }

        private static void SkipWhitespace(string text, ref int index)
        {
            while (index < text.Length)
            {
                var character = text[index];
                if (character != ' ' && character != '\t' && character != '\r' && character != '\n') return;
                index++;
            }
        }
    }

    /// <summary>Uitkomst van het teruglezen van één sessiebestand.</summary>
    public sealed class ResearchSessionSummary
    {
        public Dictionary<string, object> Header;
        public string SessionId;
        public int Records;
        public int Samples;
        public int Events;
        public int StatusRecords;
        public int SkippedLines;
        public bool HasTruncatedTail;
        public long DroppedSamples;
        public DateTime? FirstAtUtc;
        public DateTime? LastAtUtc;
        public readonly List<string> Problems = new List<string>();

        public string HeaderText(string key)
        {
            if (Header == null || key == null || !Header.ContainsKey(key)) return null;
            return Header[key] as string;
        }
    }

    /// <summary>
    /// Leest een JSONL-sessie terug. Een half geschreven laatste regel (crash midden in een
    /// write) wordt overgeslagen; de regels ervoor blijven bruikbaar. Een kapotte regel in
    /// het midden wordt gemeld maar gooit nooit.
    /// </summary>
    public static class ResearchJsonlReader
    {
        public static ResearchSessionSummary ReadFile(string path)
        {
            if (string.IsNullOrEmpty(path)) return new ResearchSessionSummary();
            string text;
            try { text = File.ReadAllText(path, Encoding.UTF8); }
            catch (IOException) { return new ResearchSessionSummary(); }
            catch (UnauthorizedAccessException) { return new ResearchSessionSummary(); }
            return ReadText(text);
        }

        public static ResearchSessionSummary ReadText(string text)
        {
            var summary = new ResearchSessionSummary();
            if (string.IsNullOrEmpty(text)) return summary;
            var lines = text.Split('\n');
            var lastContentIndex = -1;
            for (var index = 0; index < lines.Length; index++)
            {
                if (lines[index].Trim().Length > 0) lastContentIndex = index;
            }

            for (var index = 0; index < lines.Length; index++)
            {
                var raw = lines[index];
                var line = raw.EndsWith("\r", StringComparison.Ordinal) ? raw.Substring(0, raw.Length - 1) : raw;
                if (line.Trim().Length == 0) continue;

                Dictionary<string, object> record;
                if (!ResearchJsonParser.TryParse(line, out record))
                {
                    summary.SkippedLines++;
                    if (index == lastContentIndex)
                    {
                        // Precies het crash-geval: de laatste write was niet compleet.
                        summary.HasTruncatedTail = true;
                    }
                    else
                    {
                        summary.Problems.Add("corrupt_line_" + (index + 1).ToString(CultureInfo.InvariantCulture));
                    }
                    continue;
                }

                summary.Records++;
                var type = record.ContainsKey("type") ? record["type"] as string : null;
                if (summary.Header == null && string.Equals(type, "session_header", StringComparison.Ordinal))
                {
                    summary.Header = record;
                    summary.SessionId = ValueAsString(record, "sessionId");
                    summary.FirstAtUtc = ParseTimestamp(ValueAsString(record, "startedAtUtc"));
                }
                if (string.Equals(type, "sample", StringComparison.Ordinal))
                {
                    summary.Samples++;
                }
                else if (string.Equals(type, "event", StringComparison.Ordinal))
                {
                    summary.Events++;
                }
                else if (string.Equals(type, "status", StringComparison.Ordinal)
                    || string.Equals(type, "session_close", StringComparison.Ordinal))
                {
                    summary.StatusRecords++;
                    var dropped = ValueAsDouble(record, "droppedSamples");
                    if (dropped.HasValue && dropped.Value > summary.DroppedSamples) summary.DroppedSamples = (long)dropped.Value;
                }

                var at = ParseTimestamp(ValueAsString(record, "ts"));
                if (at.HasValue)
                {
                    if (!summary.LastAtUtc.HasValue || at.Value > summary.LastAtUtc.Value) summary.LastAtUtc = at.Value;
                }
            }
            return summary;
        }

        private static string ValueAsString(Dictionary<string, object> record, string key)
        {
            if (record == null || key == null || !record.ContainsKey(key)) return null;
            var value = record[key];
            return value as string ?? (value == null ? null : Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static double? ValueAsDouble(Dictionary<string, object> record, string key)
        {
            if (record == null || key == null || !record.ContainsKey(key)) return null;
            var value = record[key];
            if (value is double) return (double)value;
            if (value is bool) return (bool)value ? 1 : 0;
            if (value is string)
            {
                double parsed;
                if (double.TryParse((string)value, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) return parsed;
            }
            return null;
        }

        private static DateTime? ParseTimestamp(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            DateTime parsed;
            if (!DateTime.TryParse(text, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed)) return null;
            return DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
        }
    }
}
