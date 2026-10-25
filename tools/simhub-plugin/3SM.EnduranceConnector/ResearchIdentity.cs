using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Pseudonimisering en sessie-identiteit. De recorder schrijft nooit een rijdersnaam:
    /// alleen <c>p-&lt;16 hex&gt;</c> = de eerste 16 tekens van SHA-256(salt | driverId).
    /// De salt staat lokaal naast de opname en gaat nooit mee met een export, zodat een
    /// geëxporteerd bestand niet meteen terug te rekenen is naar een iRacing-cust_id.
    /// </summary>
    public static class ResearchIdentity
    {
        public const string PseudonymPrefix = "p-";
        public const int PseudonymHexLength = 16;
        public const string SaltFileName = "salt.txt";

        /// <summary>
        /// Pseudonieme rijders-ID. Zelfde driver + zelfde salt = zelfde ID (stabiel over
        /// sessies heen); andere salt = ander ID. Case en omringende spaties tellen niet mee.
        /// </summary>
        public static string Pseudonym(string driverId, string salt)
        {
            if (string.IsNullOrWhiteSpace(driverId)) return null;
            var normalizedId = driverId.Trim().ToLowerInvariant();
            var normalizedSalt = salt ?? string.Empty;
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(normalizedSalt + "|" + normalizedId));
                var builder = new StringBuilder(PseudonymPrefix.Length + PseudonymHexLength);
                builder.Append(PseudonymPrefix);
                for (var index = 0; builder.Length < PseudonymPrefix.Length + PseudonymHexLength; index++)
                {
                    builder.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        /// <summary>Nieuwe salt (128 bits, hex). Wordt één keer per installatie gemaakt.</summary>
        public static string NewSalt()
        {
            var bytes = new byte[16];
            using (var random = RandomNumberGenerator.Create())
            {
                random.GetBytes(bytes);
            }
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (var value in bytes) builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            return builder.ToString();
        }

        /// <summary>
        /// Sessie-ID: sorteerbaar op tijd en uniek genoeg dat twee sessies nooit hetzelfde
        /// bestand raken. research-20261025T130500Z-1a2b3c4d
        /// </summary>
        public static string NewSessionId(DateTime utcNow)
        {
            var stamp = utcNow.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
            return "research-" + stamp + "-" + RandomSuffix(4);
        }

        /// <summary>Korte, ondoorzichtige suffix (hex) voor sessie- en bestandsnamen.</summary>
        public static string RandomSuffix(int bytes)
        {
            if (bytes <= 0) bytes = 4;
            var buffer = new byte[bytes];
            using (var random = RandomNumberGenerator.Create())
            {
                random.GetBytes(buffer);
            }
            var builder = new StringBuilder(bytes * 2);
            foreach (var value in buffer) builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            return builder.ToString();
        }
    }
}
