using System;
using System.Collections.Generic;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén DriverInfo-rij die voor de automodel-kolom nodig is. Alleen de bronvelden
    /// die iRacing zelf publiceert; CarID/CarPath zijn id's en nooit een modelnaam.
    /// </summary>
    public sealed class DriverIdentity
    {
        public string CarNumber { get; set; }
        public string UserName { get; set; }
        /// <summary>CarScreenName, anders CarScreenNameShort; null als geen van beide bruikbaar is.</summary>
        public string CarName { get; set; }

        // Ruwe bronvelden blijven binnen de parser; CarName is pas na de hele rij bekend.
        internal string ScreenName { get; set; }
        internal string ScreenNameShort { get; set; }
    }

    /// <summary>
    /// Pure regels voor <c>opponents[].carName</c>. Geen SimHub-referentie, zodat de
    /// net8-tests dezelfde code compileren als de net48-plugin.
    ///
    /// De naam komt uitsluitend uit <c>CarScreenName</c> of <c>CarScreenNameShort</c>.
    /// Nooit uit CarPath/CarID (dat zijn ids), CarClass (dat is een klasse) of de auto
    /// van de speler. Een te lange of lege waarde wordt null; niet stil afgekapt.
    /// </summary>
    public static class OpponentCarName
    {
        public const int MaxLength = 120;
        private static readonly object CacheGate = new object();
        private static string _cachedYaml;
        private static List<DriverIdentity> _cachedIdentities;

        /// <summary>Trim, verwerp sentinels/controltekens en alles boven de wire-limiet.</summary>
        public static string Clean(string value)
        {
            if (value == null) return null;
            var text = value.Trim();
            if (text.Length == 0) return null;
            if (string.Equals(text, "unknown", StringComparison.OrdinalIgnoreCase)) return null;
            if (text.Length > MaxLength) return null;
            for (var i = 0; i < text.Length; i++)
            {
                if (char.IsControl(text[i])) return null;
            }
            return text;
        }

        /// <summary>Volledige schermnaam eerst; de korte naam is alleen terugval.</summary>
        public static string Select(string carScreenName, string carScreenNameShort)
        {
            return Clean(carScreenName) ?? Clean(carScreenNameShort);
        }

        /// <summary>
        /// Veilige match op dezelfde sleutel als de bestaande ratingkoppeling:
        /// CarNumber exact en UserName gelijk (trim + case-ongevoelig). Een onbekend
        /// nummer, een andere coureur of een dubbel nummer levert null.
        /// </summary>
        public static string Resolve(IDictionary<string, RawChannelReader.DriverRating> ratings, string carNumber, string driverName)
        {
            if (ratings == null || string.IsNullOrEmpty(carNumber) || string.IsNullOrWhiteSpace(driverName)) return null;
            RawChannelReader.DriverRating rating;
            if (!ratings.TryGetValue(carNumber, out rating) || rating == null) return null;
            if (!rating.Matches(driverName)) return null;
            return Clean(rating.CarName);
        }

        /// <summary>
        /// Leest alleen het DriverInfo.Drivers-blok uit de sessie-YAML. Bewust geen
        /// algemene YAML-parser: de rest van het bestand is voor deze kolom irrelevant
        /// en een halve parser zou meer kunnen breken dan hij oplost.
        /// </summary>
        public static List<DriverIdentity> ParseDriverInfoYaml(string yaml)
        {
            var result = new List<DriverIdentity>();
            if (string.IsNullOrEmpty(yaml)) return result;
            var lines = yaml.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            var driverIndent = -1;
            var inDriverInfo = false;
            var driversIndent = -1;
            var index = 0;

            for (; index < lines.Length; index++)
            {
                var line = lines[index].TrimEnd();
                if (line.Length == 0) continue;
                var indent = line.Length - line.TrimStart(' ').Length;
                var trimmed = line.TrimStart(' ');
                if (!inDriverInfo)
                {
                    if (string.Equals(trimmed, "DriverInfo:", StringComparison.Ordinal))
                    {
                        inDriverInfo = true;
                        driverIndent = indent;
                    }
                    continue;
                }
                if (indent <= driverIndent) return result; // DriverInfo-blok is afgelopen
                if (string.Equals(trimmed, "Drivers:", StringComparison.Ordinal))
                {
                    driversIndent = indent;
                    index++;
                    break;
                }
            }
            if (!inDriverInfo || driversIndent < 0) return result;

            DriverIdentity current = null;
            for (; index < lines.Length; index++)
            {
                var line = lines[index].TrimEnd();
                if (line.Length == 0) continue;
                var indent = line.Length - line.TrimStart(' ').Length;
                var trimmed = line.TrimStart(' ');
                var dash = trimmed.StartsWith("-", StringComparison.Ordinal);
                // Lijstitems mogen op dezelfde inspringing als "Drivers:" staan;
                // een volgende sleutel op dat niveau (zonder '-') beëindigt de lijst.
                if (indent < driversIndent || (indent == driversIndent && !dash)) break;
                var entry = dash ? trimmed.Substring(1).Trim() : trimmed;
                if (dash)
                {
                    current = new DriverIdentity();
                    result.Add(current);
                }
                if (current == null || entry.Length == 0) continue;
                ParseField(entry, current);
            }

            foreach (var identity in result)
                identity.CarName = Select(identity.ScreenName, identity.ScreenNameShort);
            return result;
        }

        /// <summary>
        /// Cachet de laatste sessietekst. DriverInfo verandert alleen bij een sessie-
        /// of rijderswissel; dezelfde tekst hoeft dan niet elke tick opnieuw geparseerd
        /// te worden. De vergelijking is op volledige tekst, dus een gewijzigde YAML
        /// (andere coureur) kan nooit een oude naam teruggeven.
        /// </summary>
        public static List<DriverIdentity> ParseDriverInfoYamlCached(string yaml)
        {
            if (yaml == null) return new List<DriverIdentity>();
            lock (CacheGate)
            {
                if (_cachedYaml != null && string.Equals(_cachedYaml, yaml, StringComparison.Ordinal))
                    return _cachedIdentities;
                var parsed = ParseDriverInfoYaml(yaml);
                _cachedYaml = yaml;
                _cachedIdentities = parsed;
                return parsed;
            }
        }

        private static void ParseField(string text, DriverIdentity identity)
        {
            var colon = text.IndexOf(':');
            if (colon <= 0) return;
            var key = text.Substring(0, colon).Trim();
            var value = Unquote(text.Substring(colon + 1).Trim());
            switch (key)
            {
                case "CarNumber": identity.CarNumber = value; break;
                case "UserName": identity.UserName = value; break;
                case "CarScreenName": identity.ScreenName = value; break;
                case "CarScreenNameShort": identity.ScreenNameShort = value; break;
            }
        }

        private static string Unquote(string value)
        {
            if (value.Length < 2) return value;
            var quote = value[0];
            if ((quote != '"' && quote != '\'') || value[value.Length - 1] != quote) return value;
            var inner = value.Substring(1, value.Length - 2);
            if (quote == '\'') return inner.Replace("''", "'");
            return inner.Replace("\\\"", "\"").Replace("\\\\", "\\");
        }
    }
}
