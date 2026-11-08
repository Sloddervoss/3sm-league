using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Leest rauwe iRacing-kanalen op twee routes, met dezelfde nullable-discipline:
    ///
    ///   A. property-pad  <c>DataCorePlugin.GameRawData.Telemetry.&lt;kanaal&gt;</c>
    ///      (aantoonbaar werkend voor scalar-kanalen, net als SessionFlags en PitsOpen)
    ///   B. reflectie      <c>NewData -> RawData -> Telemetry -> &lt;kanaal&gt;</c>
    ///      (bewezen voor het geneste Telemetry-object; PluginManager levert daar null)
    ///
    /// Falen beide, dan is het antwoord null. Nooit 0: 0 is een meting, null is "de sim
    /// zei niets". De PropertyInfo's worden per runtime-type gecachet, zodat dit per tick
    /// geen boomscan of herhaalde reflectie kost.
    /// </summary>
    public sealed class RawChannelReader
    {
        public const string TelemetryPropertyPrefix = "DataCorePlugin.GameRawData.Telemetry.";
        private const BindingFlags MemberFlags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.FlattenHierarchy;
        private static readonly Dictionary<string, PropertyInfo> MemberCache = new Dictionary<string, PropertyInfo>(64);
        private static readonly object MemberCacheGate = new object();

        private readonly object _newData;
        private readonly Func<string, object> _getProperty;

        public RawChannelReader(object newData, Func<string, object> getProperty)
        {
            _newData = newData;
            _getProperty = getProperty;
        }

        /// <summary>Numeriek kanaal binnen [minimum, maximum]; daarbuiten of onleesbaar = null.</summary>
        public double? ReadNumber(string channel, double minimum, double maximum)
        {
            var parsed = ToDouble(ReadValue(channel));
            if (!parsed.HasValue) return null;
            var number = parsed.Value;
            if (double.IsNaN(number) || double.IsInfinity(number)) return null;
            if (number < minimum || number > maximum) return null;
            return number;
        }

        /// <summary>Integer-kanaal binnen [minimum, maximum]; niet-integere waarden worden afgerond.</summary>
        public int? ReadInt(string channel, int minimum, int maximum)
        {
            var parsed = ReadNumber(channel, minimum, maximum);
            if (!parsed.HasValue) return null;
            var rounded = (int)Math.Round(parsed.Value, MidpointRounding.AwayFromZero);
            return rounded < minimum || rounded > maximum ? (int?)null : rounded;
        }

        /// <summary>Booleaans kanaal; 0/1 en "true"/"false" worden geaccepteerd.</summary>
        public bool? ReadBool(string channel)
        {
            var value = ReadValue(channel);
            if (value == null) return null;
            if (value is bool) return (bool)value;
            var text = value as string;
            if (text != null)
            {
                bool parsedBoolean;
                if (bool.TryParse(text.Trim(), out parsedBoolean)) return parsedBoolean;
            }
            var number = ToDouble(value);
            if (number.HasValue && !double.IsNaN(number.Value) && !double.IsInfinity(number.Value)) return number.Value != 0;
            return null;
        }

        /// <summary>Tekstkanaal; lege tekst en "unknown" leveren null (SimHub's standaard-sentinel).</summary>
        public string ReadText(string channel)
        {
            var value = ReadValue(channel);
            if (value == null) return null;
            var text = value as string;
            if (text == null)
            {
                var convertible = value as IConvertible;
                if (convertible == null) return null;
                try { text = convertible.ToString(CultureInfo.InvariantCulture); }
                catch { return null; }
            }
            text = text.Trim();
            if (text.Length == 0) return null;
            if (string.Equals(text, "unknown", StringComparison.OrdinalIgnoreCase)) return null;
            return text;
        }

        /// <summary>
        /// Waarde uit de sessie-YAML: <c>NewData.RawData.SessionData.SessionInfo.Sessions[n].&lt;member&gt;</c>.
        /// SessionTrackRubberState is geen telemetriekanaal, dus die komt altijd via dit pad.
        /// </summary>
        public string ReadSessionText(int sessionIndex, string member)
        {
            object node = _newData;
            var path = new[] { "RawData", "SessionData", "SessionInfo", "Sessions" };
            for (var i = 0; i < path.Length && node != null; i++) node = GetMember(node, path[i]);
            if (node == null) return null;
            object session;
            if (!TryIndex(node, sessionIndex, out session) || session == null) return null;
            var value = GetMember(session, member);
            if (value == null) return null;
            var text = value as string;
            if (text == null)
            {
                var convertible = value as IConvertible;
                if (convertible == null) return null;
                try { text = convertible.ToString(CultureInfo.InvariantCulture); }
                catch { return null; }
            }
            text = text.Trim();
            return text.Length == 0 ? null : text;
        }

        // Session YAML is refreshed much less frequently than telemetry. The caller caches
        // the result per session/track configuration; malformed layouts are never guessed.
        /// <summary>
        /// Sectorgrenzen uit de sessiedata. Twee routes, want SimHub levert SessionData
        /// afhankelijk van de versie als objectboom of als YAML-tekst:
        ///   1. objectboom  SessionInfo.SplitTimeInfo.Sectors[].SectorStartPct
        ///   2. YAML-tekst  dezelfde sleutels, maar als tekst geparseerd
        /// Beide falen => null. Nooit een geraden of gelijkmatige verdeling.
        /// </summary>
        public double[] ReadSectorStarts()
        {
            var fromObject = ReadSectorStartsFromObject();
            if (fromObject != null) return fromObject;
            var yaml = ReadSessionYamlText();
            return yaml == null ? null : ParseSectorStartsFromYaml(yaml);
        }

        private double[] ReadSectorStartsFromObject()
        {
            var root = SessionRoot();
            var split = GetMember(root, "SplitTimeInfo");
            if (split == null) split = GetMember(GetMember(GetMember(_newData, "RawData"), "SessionData"), "SplitTimeInfo");
            var sectors = GetMember(split, "Sectors") as IEnumerable;
            if (sectors == null) return null;
            var starts = new List<double>();
            foreach (var sector in sectors)
            {
                var value = ToDouble(GetMember(sector, "SectorStartPct"));
                if (!ValidSectorStart(value, starts)) return null;
                starts.Add(value.Value);
            }
            return starts.Count > 0 && starts[0] == 0 ? starts.ToArray() : null;
        }

        private static bool ValidSectorStart(double? value, List<double> starts)
        {
            return value.HasValue && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value)
                && value.Value >= 0 && value.Value < 1 && starts.Count < 16
                && (starts.Count == 0 || value.Value > starts[starts.Count - 1]);
        }

        /// <summary>Eerste sessie-YAML die als tekst beschikbaar is, of null.</summary>
        private string ReadSessionYamlText()
        {
            var direct = ReadText("SessionData");
            if (direct != null && direct.IndexOf("SplitTimeInfo", StringComparison.Ordinal) >= 0) return direct;

            object node = _newData;
            foreach (var member in new[] { "RawData", "SessionData" }) node = GetMember(node, member);
            var text = node as string;
            if (text != null && text.IndexOf("SplitTimeInfo", StringComparison.Ordinal) >= 0) return text;

            if (_getProperty != null)
            {
                try
                {
                    var value = _getProperty("DataCorePlugin.GameRawData.SessionData") as string;
                    if (value != null && value.IndexOf("SplitTimeInfo", StringComparison.Ordinal) >= 0) return value;
                }
                catch { }
            }
            return null;
        }

        /// <summary>
        /// Leest uitsluitend het SplitTimeInfo-blok uit de sessie-YAML. Bewust geen
        /// algemene YAML-parser: alleen de lijst met SectorStartPct-waarden is nodig en
        /// een halve parser zou meer kunnen breken dan hij oplost.
        /// </summary>
        public static double[] ParseSectorStartsFromYaml(string yaml)
        {
            if (string.IsNullOrEmpty(yaml)) return null;
            var lines = yaml.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            var inSplit = false;
            var inSectors = false;
            var splitIndent = -1;
            var sectorIndent = -1;
            var starts = new List<double>();
            foreach (var raw in lines)
            {
                var line = raw.TrimEnd();
                if (line.Length == 0) continue;
                var lineIndent = line.Length - line.TrimStart(' ').Length;
                var trimmed = line.TrimStart(' ');
                if (!inSplit)
                {
                    if (trimmed.StartsWith("SplitTimeInfo:", StringComparison.Ordinal)) { inSplit = true; splitIndent = lineIndent; }
                    continue;
                }
                if (lineIndent <= splitIndent) break;
                if (!inSectors)
                {
                    if (trimmed.StartsWith("Sectors:", StringComparison.Ordinal)) { inSectors = true; sectorIndent = lineIndent; }
                    continue;
                }
                var dash = trimmed.StartsWith("-", StringComparison.Ordinal);
                var entry = dash ? trimmed.Substring(1).Trim() : trimmed;
                if (!dash && lineIndent <= sectorIndent) break;
                var key = "SectorStartPct:";
                var at = entry.IndexOf(key, StringComparison.Ordinal);
                if (at < 0) continue;
                var rawValue = entry.Substring(at + key.Length).Trim().Trim('\'', '"');
                double parsed;
                if (!double.TryParse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) return null;
                var value = (double?)parsed;
                if (!ValidSectorStart(value, starts)) return null;
                starts.Add(parsed);
            }
            return starts.Count > 0 && starts[0] == 0 ? starts.ToArray() : null;
        }

public string ReadTrackConfiguration()
        {
            var weekend = GetMember(SessionRoot(), "WeekendInfo")
                ?? GetMember(GetMember(GetMember(_newData, "RawData"), "SessionData"), "WeekendInfo");
            return Convert.ToString(GetMember(weekend, "TrackID"), CultureInfo.InvariantCulture) + ":"
                + Convert.ToString(GetMember(weekend, "TrackName"), CultureInfo.InvariantCulture) + ":"
                + Convert.ToString(GetMember(weekend, "TrackConfigName"), CultureInfo.InvariantCulture);
        }
        public Dictionary<string, int> ReadCarIndices()
        {
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
            var drivers = GetMember(GetMember(SessionRoot(), "DriverInfo"), "Drivers") as IEnumerable;
            if (drivers == null) return result;
            foreach (var driver in drivers)
            {
                var number = Convert.ToString(GetMember(driver, "CarNumber"), CultureInfo.InvariantCulture);
                var index = ToDouble(GetMember(driver, "CarIdx"));
                if (!string.IsNullOrEmpty(number) && index.HasValue && index >= 0 && index < 64 && index == Math.Floor(index.Value))
                    result[number] = (int)index.Value;
            }
            return result;
        }
        private object SessionRoot()
        { return GetMember(GetMember(GetMember(_newData, "RawData"), "SessionData"), "SessionInfo"); }

        private object ReadValue(string channel)
        {
            if (string.IsNullOrEmpty(channel)) return null;
            // Route A: property-pad.
            if (_getProperty != null)
            {
                object value;
                try { value = _getProperty(TelemetryPropertyPrefix + channel); }
                catch { value = null; }
                if (value != null) return value;
            }
            // Route B: reflectie op het vaste pad.
            if (_newData == null) return null;
            var rawData = GetMember(_newData, "RawData");
            if (rawData == null) return null;
            var telemetry = GetMember(rawData, "Telemetry");
            if (telemetry == null) return null;
            return GetMember(telemetry, channel);
        }

        private static object GetMember(object target, string member)
        {
            if (target == null || string.IsNullOrEmpty(member)) return null;
            var dictionary = target as IDictionary;
            if (dictionary != null) return dictionary.Contains(member) ? dictionary[member] : null;
            var type = target.GetType();
            var key = type.FullName + "|" + member;
            PropertyInfo property;
            lock (MemberCacheGate)
            {
                if (!MemberCache.TryGetValue(key, out property))
                {
                    property = type.GetProperty(member, MemberFlags);
                    MemberCache[key] = property; // null ook cachen: ontbrekend blijft ontbrekend
                }
            }
            if (property == null || !property.CanRead) return null;
            try { return property.GetValue(target, null); }
            catch { return null; }
        }

        private static bool TryIndex(object collection, int index, out object item)
        {
            item = null;
            if (collection == null || index < 0) return false;
            var list = collection as IList;
            if (list != null)
            {
                if (index >= list.Count) return false;
                item = list[index];
                return true;
            }
            var enumerable = collection as IEnumerable;
            if (enumerable == null) return false;
            var position = 0;
            foreach (var entry in enumerable)
            {
                if (position == index) { item = entry; return true; }
                position++;
            }
            return false;
        }

        private static double? ToDouble(object value)
        {
            if (value == null) return null;
            if (value is double) return (double)value;
            if (value is float) return (float)value;
            if (value is decimal) return (double)(decimal)value;
            if (value is int) return (int)value;
            if (value is long) return (long)value;
            if (value is short) return (short)value;
            if (value is byte) return (byte)value;
            if (value is uint) return (uint)value;
            if (value is ulong) return (ulong)value;
            if (value is bool) return (bool)value ? 1d : 0d;
            var text = value as string;
            if (text == null) return null;
            double parsed;
            if (double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) return parsed;
            if (double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.CurrentCulture, out parsed)) return parsed;
            return null;
        }
    }
}
