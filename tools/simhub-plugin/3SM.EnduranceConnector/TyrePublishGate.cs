using System;
using System.Globalization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Bepaalt of het optionele `tyres`-blok in dit frame meegaat. Een bandenmeting
    /// verandert in de praktijk alleen bij een pitstop of een nieuwe set; elk frame
    /// opnieuw meesturen is dus bijna altijd dezelfde ~0,7 kB. De tracker blijft elke
    /// tick lopen (daar zit de detectie van een nieuwe set en van de pit-entry), dit
    /// hek bepaalt alleen het verzenden: bij wijziging, of anders één keer per interval.
    ///
    /// Geen SimHub-afhankelijkheid, zodat de logica los te testen is.
    /// </summary>
    public sealed class TyrePublishGate
    {
        public const int DefaultIntervalMilliseconds = 30000;

        private string _signature;
        private long _publishedAtMs;
        private bool _published;

        /// <summary>Laatst uitgezonden signatuur (null = er is nog niets uitgezonden).</summary>
        public string LastSignature { get { return _signature; } }

        /// <summary>
        /// True als dit blok verzonden moet worden: eerste keer, inhoud gewijzigd, het
        /// interval is verstreken, of <paramref name="force"/> staat aan (pitstraat).
        /// False = het blok is identiek en nog te jong.
        /// Een lege signatuur (geen meting) wordt nooit verzonden.
        /// </summary>
        public bool ShouldPublish(string signature, long nowMs, int intervalMilliseconds, bool force = false)
        {
            if (string.IsNullOrEmpty(signature)) return false;
            var interval = intervalMilliseconds > 0 ? intervalMilliseconds : DefaultIntervalMilliseconds;
            if (force || !_published || !string.Equals(signature, _signature, StringComparison.Ordinal))
            {
                _signature = signature;
                _publishedAtMs = nowMs;
                _published = true;
                return true;
            }
            if (nowMs - _publishedAtMs < interval) return false;
            _publishedAtMs = nowMs;
            return true;
        }

        /// <summary>Vergeet de vorige stand, zodat de volgende meting direct meegaat.</summary>
        public void Reset()
        {
            _signature = null;
            _publishedAtMs = 0;
            _published = false;
        }
    }

    /// <summary>
    /// Stabiele, korte vingerafdruk van een bandenblok. Hiermee vergelijkt het hek de
    /// inhoud van dit frame met de vorige. Bewust zonder JSON-serialisatie: dat kost per
    /// tick een eigen serializer en dat is precies wat we willen vermijden.
    /// </summary>
    public static class TyreSignature
    {
        public static string Of(V3Tyres tyres)
        {
            if (tyres == null) return null;
            var sb = new StringBuilder(192);
            Text(sb, tyres.ObservedAt);
            DoubleValue(sb, tyres.SessionTimeSeconds);
            IntValue(sb, tyres.Lap);
            Text(sb, tyres.Trigger);
            IntValue(sb, tyres.CompoundId);
            Zones(sb, tyres.WearPercent);
            Zones(sb, tyres.CarcassTempC);
            Sets(sb, tyres.Sets);
            Environment(sb, tyres.Environment);
            PitEntry(sb, tyres.PitEntry);
            return sb.ToString();
        }

        private static void Text(StringBuilder sb, string value)
        {
            sb.Append(value == null ? "-" : value).Append('|');
        }

        private static void DoubleValue(StringBuilder sb, double? value)
        {
            sb.Append(value.HasValue ? value.Value.ToString("R", CultureInfo.InvariantCulture) : "-").Append('|');
        }

        private static void IntValue(StringBuilder sb, int? value)
        {
            sb.Append(value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : "-").Append('|');
        }

        private static void Zones(StringBuilder sb, V3TyreZones zones)
        {
            if (zones == null) { sb.Append("-|"); return; }
            Row(sb, zones.FrontLeft);
            Row(sb, zones.FrontRight);
            Row(sb, zones.RearLeft);
            Row(sb, zones.RearRight);
        }

        private static void Row(StringBuilder sb, double?[] row)
        {
            if (row == null) { sb.Append("-|"); return; }
            for (var i = 0; i < row.Length; i++) DoubleValue(sb, row[i]);
            sb.Append(';');
        }

        private static void Sets(StringBuilder sb, V3TyreSets sets)
        {
            if (sets == null) { sb.Append("-|"); return; }
            IntValue(sb, sets.Used);
            IntValue(sb, sets.Available);
            IntValue(sb, sets.FrontLeft);
            IntValue(sb, sets.FrontRight);
            IntValue(sb, sets.RearLeft);
            IntValue(sb, sets.RearRight);
        }

        private static void Environment(StringBuilder sb, V3TyreEnvironment environment)
        {
            if (environment == null) { sb.Append("-|"); return; }
            DoubleValue(sb, environment.TrackTempC);
            DoubleValue(sb, environment.AirTempC);
            Text(sb, environment.RubberState);
        }

        private static void PitEntry(StringBuilder sb, V3TyrePitEntry pitEntry)
        {
            if (pitEntry == null) { sb.Append("-|"); return; }
            Text(sb, pitEntry.ObservedAt);
            DoubleValue(sb, pitEntry.SessionTimeSeconds);
            IntValue(sb, pitEntry.Lap);
            IntValue(sb, pitEntry.SetsUsed);
            Zones(sb, pitEntry.WearPercent);
            Zones(sb, pitEntry.CarcassTempC);
        }
    }
}
