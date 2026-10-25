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
