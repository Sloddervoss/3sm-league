using System;
using System.Reflection;

namespace ThreeSM.EnduranceConnector
{
    // Haalt de rauwe iRacing-sessietijd veilig op uit het fixed pad
    //   NewData.RawData -> Telemetry -> SessionTime
    // door reflectie. Reden: de connector heeft GEEN iRacing-SDK-referentie, en
    // PluginManager.GetPropertyValue(...) levert null op dit nested pad (runtime-bewezen).
    //
    // Eigenschappen:
    //   - geen dure object-tree enumeration per update: alleen het vaste pad lezen
    //   - cachet PropertyInfo's per runtime-type (re-resolve bij type-verschil)
    //   - accepteert double en andere veilige numerieke types (float/decimal/int/long/...)
    //   - alleen finite, >= 0 waarden worden geaccepteerd (geen NaN/Infinity/negatief)
    //   - GEEN Stopwatch-fallback en GEEN GuessedElapsedGameTime-fallback: bij fout/null
    //     retourneert hij null (en laat de connector zo een ongeldige/ontbrekende sessietijd zien)
    public sealed class SessionTelemetryReader
    {
        public SessionTelemetryReader() { }

        /// <summary>Leest NewData.RawData.Telemetry.SessionTime als double? (finite, >= 0) of null.</summary>
        public double? Read(object newData)
        {
            if (newData == null) return null;
            try
            {
                object rawData = GetMember(newData, ref _rawDataProp, "RawData");
                if (rawData == null) return null;
                object telemetry = GetMember(rawData, ref _telemetryProp, "Telemetry");
                if (telemetry == null) return null;
                object value = GetMember(telemetry, ref _sessionTimeProp, "SessionTime");
                return ToFiniteNonNegativeSeconds(value);
            }
            catch { return null; }
        }

        private PropertyInfo _rawDataProp;
        private PropertyInfo _telemetryProp;
        private PropertyInfo _sessionTimeProp;

        private static object GetMember(object target, ref PropertyInfo cache, string memberName)
        {
            if (target == null) return null;
            var prop = cache;
            // Her-resolve als dit member nog niet eerder voor dit runtime-type is gecached.
            if (prop == null || prop.DeclaringType != target.GetType())
            {
                prop = target.GetType().GetProperty(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.FlattenHierarchy);
                cache = prop;  // cache bijhouden; null-safe
            }
            if (prop == null || !prop.CanRead) return null;
            try { return prop.GetValue(target, null); }
            catch { return null; }
        }

        internal static double? ToFiniteNonNegativeSeconds(object value)
        {
            if (value == null) return null;
            double d;
            if (value is double) d = (double)value;
            else if (value is float) d = (float)value;
            else if (value is decimal) d = (double)(decimal)value;
            else if (value is TimeSpan) d = ((TimeSpan)value).TotalSeconds;
            else if (value is int) d = (int)value;
            else if (value is long) d = (long)value;
            else if (value is short) d = (short)value;
            else if (value is byte) d = (byte)value;
            else if (value is uint) d = (uint)value;
            else if (value is ulong) d = (ulong)value;
            else return null;  // geen veilig numeriek type
            if (double.IsNaN(d) || double.IsInfinity(d)) return null;
            if (d < 0) return null;
            return d;
        }
    }
}