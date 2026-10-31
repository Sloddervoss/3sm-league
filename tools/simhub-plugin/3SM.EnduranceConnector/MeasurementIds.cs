using System;
using System.Globalization;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Duurzame identiteit van een meetgebeurtenis en van een rondeaggregaat.
    ///
    /// Waarom dit een eigen bestand is: het contract
    /// (docs/contracts/measurement-ids-v1.md, sectie 1) maakt onderscheid tussen
    ///   - <c>eventUid</c> / <c>summaryUid</c>: UUID's, één keer gemaakt, NOOIT opnieuw
    ///     verzonnen, bewaard in de outbox en bij elke herverzending hergebruikt;
    ///   - <c>eventId</c> / <c>summaryId</c>: leesbare labels die mogen veranderen en
    ///     die GEEN dedupe-sleutel zijn.
    ///
    /// De oude fout was dat het label de sleutel was: een nieuwe transportsessie begon
    /// opnieuw bij <c>evt-1</c> en daarmee verdween of verdubbelde data. Deze klasse
    /// houdt die twee soorten ID's daarom gescheiden, en de fabriek is injecteerbaar
    /// zodat tests deterministisch zijn en de plugin toch de echte generator gebruikt.
    ///
    /// Geen SimHub-referentie: puur, dus in de testharnas te compileren.
    /// </summary>
    public static class MeasurementIds
    {
        /// <summary>Maximale lengte van een lokaal label/context-ID volgens het contract.</summary>
        public const int MaxLocalIdLength = 64;
        /// <summary>Maximale lengte van <c>observedSessionId</c> volgens het contract.</summary>
        public const int MaxObservedSessionIdLength = 120;

        /// <summary>
        /// Canonieke vorm: kleine letters, 8-4-4-4-12. De Edge accepteert beide
        /// schrijfwijzen maar normaliseert naar kleine letters; wij doen dat zelf al,
        /// zodat de outbox en de ACK zonder conversie dezelfde sleutel hebben.
        /// </summary>
        public static string Format(Guid value)
        {
            return value.ToString("D").ToLowerInvariant();
        }

        /// <summary>Is dit een UUID in de vorm die het contract eist?</summary>
        public static bool IsUid(string value)
        {
            if (value == null || value.Length != 36) return false;
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                if (index == 8 || index == 13 || index == 18 || index == 23)
                {
                    if (character != '-') return false;
                    continue;
                }
                var isDigit = character >= '0' && character <= '9';
                var isLower = character >= 'a' && character <= 'f';
                var isUpper = character >= 'A' && character <= 'F';
                if (!isDigit && !isLower && !isUpper) return false;
            }
            return true;
        }

        /// <summary>
        /// Is dit een lokaal ID volgens <c>^[A-Za-z0-9._:-]{1,64}$</c>? Dit is de
        /// tekenlijst die de Edge voor <c>eventId</c>, <c>segmentId</c>,
        /// <c>pitVisitId</c> en de ID-arrays gebruikt.
        /// </summary>
        public static bool IsLocalId(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > MaxLocalIdLength) return false;
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                var allowed = (character >= 'A' && character <= 'Z')
                    || (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '.' || character == '_' || character == ':' || character == '-';
                if (!allowed) return false;
            }
            return true;
        }

        /// <summary>
        /// Maakt van vrije tekst een geldig lokaal ID. Nooit stilzwijgend een leeg ID:
        /// als er niets bruikbaars overblijft, komt er <paramref name="fallback"/> terug.
        /// </summary>
        public static string SanitizeLocalId(string value, string fallback)
        {
            if (string.IsNullOrEmpty(value)) return fallback;
            var builder = new StringBuilder(Math.Min(value.Length, MaxLocalIdLength));
            for (var index = 0; index < value.Length && builder.Length < MaxLocalIdLength; index++)
            {
                var character = value[index];
                var allowed = (character >= 'A' && character <= 'Z')
                    || (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '.' || character == '_' || character == ':' || character == '-';
                builder.Append(allowed ? character : '-');
            }
            var text = builder.ToString().Trim('-', '.', ':');
            return text.Length == 0 ? fallback : text;
        }

        /// <summary>
        /// Sanitiseert een sessie-ID voor <c>observedSessionId</c>. Leeg blijft leeg
        /// (null), want een verzonnen sessie-ID is erger dan geen.
        /// </summary>
        public static string SanitizeObservedSessionId(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var builder = new StringBuilder(Math.Min(value.Length, MaxObservedSessionIdLength));
            foreach (var character in value.Trim())
            {
                if (builder.Length >= MaxObservedSessionIdLength) break;
                var allowed = (character >= 'A' && character <= 'Z')
                    || (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '.' || character == '_' || character == ':' || character == '-';
                builder.Append(allowed ? character : '-');
            }
            var text = builder.ToString();
            return text.Length == 0 ? null : text;
        }

        /// <summary>Een nieuwe lokale segmentidentiteit (context, geen identiteit).</summary>
        public static string NewSegmentId(Guid value)
        {
            return "seg-" + value.ToString("N").Substring(0, 12).ToLowerInvariant();
        }
    }

    /// <summary>
    /// Maakt de UUID's en de leesbare labels. De UUID-generator is injecteerbaar:
    /// productie gebruikt <see cref="Guid.NewGuid()"/> (UUIDv4 uit de OS-RNG), tests
    /// een vaste reeks zodat een assertie op de wire-vorm mogelijk is.
    /// </summary>
    public sealed class MeasurementIdFactory
    {
        private readonly Func<Guid> _create;
        private long _eventLabels;
        private long _summaryLabels;

        public MeasurementIdFactory() : this(Guid.NewGuid) { }

        public MeasurementIdFactory(Func<Guid> create)
        {
            if (create == null) throw new ArgumentNullException("create");
            _create = create;
        }

        /// <summary>Nieuwe duurzame identiteit voor één meetgebeurtenis.</summary>
        public string NewEventUid()
        {
            return MeasurementIds.Format(_create());
        }

        /// <summary>Nieuwe duurzame identiteit voor één rondeaggregaat.</summary>
        public string NewSummaryUid()
        {
            return MeasurementIds.Format(_create());
        }

        /// <summary>
        /// Leesbaar label. Telt alleen lokaal op en is expliciet géén dedupe-sleutel:
        /// na een herstart begint de teller weer bij 1 en dat mag, want de UUID blijft.
        /// </summary>
        public string NextEventLabel()
        {
            _eventLabels++;
            return "evt-" + _eventLabels.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>Leesbaar label voor een ronde: het rondenummer plus een teller.</summary>
        public string NextSummaryLabel(int lapNumber)
        {
            _summaryLabels++;
            return "lap-" + lapNumber.ToString(CultureInfo.InvariantCulture)
                + "-" + _summaryLabels.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>Zet de labels voort na een herstart (optioneel; labels mogen hergebruikt worden).</summary>
        public void SeedLabels(long eventLabels, long summaryLabels)
        {
            if (eventLabels > _eventLabels) _eventLabels = eventLabels;
            if (summaryLabels > _summaryLabels) _summaryLabels = summaryLabels;
        }
    }

    /// <summary>
    /// Tijd op de draad. Het contract eist ISO-8601 mét zone en staat maximaal zes
    /// decimalen toe. <c>DateTime.ToString("o")</c> levert er zeven en wordt dus door
    /// de Edge geweigerd; daarom één vaste notatie met milliseconden.
    /// </summary>
    public static class MeasurementTime
    {
        public const string WireFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

        public static string Format(DateTime value)
        {
            return value.ToUniversalTime().ToString(WireFormat, CultureInfo.InvariantCulture);
        }

        public static string Format(DateTime? value)
        {
            return value.HasValue ? Format(value.Value) : null;
        }

        public static DateTime? Parse(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            DateTime parsed;
            if (!DateTime.TryParse(text, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed))
            {
                return null;
            }
            return DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
        }
    }
}
