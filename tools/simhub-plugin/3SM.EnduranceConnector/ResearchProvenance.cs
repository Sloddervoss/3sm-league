using System;
using System.Globalization;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Herkomst van één research-waarde. De nummering is bewust: default(ResearchProvenance)
    /// is <see cref="Unavailable"/>, zodat een niet-ingevulde waarde nooit per ongeluk als
    /// meting de deur uit gaat.
    /// </summary>
    public enum ResearchProvenance
    {
        Unavailable = 0,
        Measured = 1,
        LastKnown = 2,
        Estimated = 3,
        Invalid = 4,
    }

    public static class ResearchProvenanceNames
    {
        public const string Measured = "measured";
        public const string LastKnown = "last_known";
        public const string Estimated = "estimated";
        public const string Unavailable = "unavailable";
        public const string Invalid = "invalid";

        public static string ToWire(ResearchProvenance provenance)
        {
            switch (provenance)
            {
                case ResearchProvenance.Measured: return Measured;
                case ResearchProvenance.LastKnown: return LastKnown;
                case ResearchProvenance.Estimated: return Estimated;
                case ResearchProvenance.Invalid: return Invalid;
                default: return Unavailable;
            }
        }

        public static bool TryParse(string text, out ResearchProvenance provenance)
        {
            provenance = ResearchProvenance.Unavailable;
            if (string.IsNullOrEmpty(text)) return false;
            switch (text.Trim())
            {
                case Measured: provenance = ResearchProvenance.Measured; return true;
                case LastKnown: provenance = ResearchProvenance.LastKnown; return true;
                case Estimated: provenance = ResearchProvenance.Estimated; return true;
                case Unavailable: provenance = ResearchProvenance.Unavailable; return true;
                case Invalid: provenance = ResearchProvenance.Invalid; return true;
                default: return false;
            }
        }

        /// <summary>Alleen deze herkomsten dragen een bruikbare waarde.</summary>
        public static bool CarriesValue(ResearchProvenance provenance)
        {
            return provenance == ResearchProvenance.Measured
                || provenance == ResearchProvenance.LastKnown
                || provenance == ResearchProvenance.Estimated;
        }
    }

    public static class ResearchRates
    {
        /// <summary>
        /// 0 betekent: de bron wordt niet op een vaste frequentie bijgewerkt, maar alleen
        /// wanneer de sim een refresh doet (iRacing doet dat voor wear/karkas in de pitstraat).
        /// Zo'n veld is in een 1 Hz-sample per definitie ouder dan het sample zelf; het
        /// tijdstip van de echte meting staat dan in <see cref="ResearchField.MeasuredAtUtc"/>.
        /// </summary>
        public const int OnSimRefresh = 0;
    }

    /// <summary>
    /// Plausibiliteitsgrenzen. Buiten deze grenzen is een waarde geen meting maar een
    /// sentinel of een parsefout: die gaat als <see cref="ResearchProvenance.Invalid"/>
    /// de deur uit (waarde weggelaten), nooit als getal.
    /// </summary>
    public static class ResearchLimits
    {
        public const double WearPercentMin = 0.0;
        public const double WearPercentMax = 100.0;
        public const double CarcassTempCMin = -40.0;
        public const double CarcassTempCMax = 300.0;
        public const double FuelLitresMin = 0.0;
        public const double FuelLitresMax = 250.0;
        public const double SpeedKphMin = 0.0;
        public const double SpeedKphMax = 600.0;
        public const double PedalPctMin = 0.0;
        public const double PedalPctMax = 100.0;
        public const double SteeringRadMin = -30.0;
        public const double SteeringRadMax = 30.0;
        public const double AccelMps2Min = -200.0;
        public const double AccelMps2Max = 200.0;
        // Wielsnelheid en remleidingdruk: de grenzen die ook de server-validator hanteert.
        public const double WheelSpeedMpsMin = 0.0;
        public const double WheelSpeedMpsMax = 200.0;
        public const double BrakePressureBarMin = 0.0;
        public const double BrakePressureBarMax = 250.0;
        public const double LapDistancePctMin = 0.0;
        public const double LapDistancePctMax = 1.0;
        public const double SessionTimeSecondsMin = 0.0;
        public const double SessionTimeSecondsMax = 604800.0;
        public const double LapTimeSecondsMin = 0.0;
        public const double LapTimeSecondsMax = 3600.0;
        public const double TemperatureCMin = -40.0;
        public const double TemperatureCMax = 100.0;
        public const int PositionMin = 1;
        public const int PositionMax = 128;
    }

    /// <summary>
    /// Eén waarde met herkomst. Onveranderlijk: een gebouwde field gaat direct de
    /// JSONL-wachtrij in en wordt daarna niet meer aangepast.
    /// </summary>
    public sealed class ResearchField
    {
        private ResearchField()
        {
            Provenance = ResearchProvenance.Unavailable;
        }

        public double? Number { get; private set; }
        public string Text { get; private set; }
        public bool? Flag { get; private set; }

        /// <summary>Herkomst van de waarde (Measured/LastKnown/Estimated/Unavailable/Invalid).</summary>
        public ResearchProvenance Provenance { get; private set; }

        /// <summary>
        /// Tijdstip van de laatste echte meting aan de bron, niet het sample-tijdstip.
        /// Null als de bron geen betrouwbaar tijdstip leverde.
        /// </summary>
        public DateTime? MeasuredAtUtc { get; private set; }

        /// <summary>Sampleperiode van de bron in ms; 0 = alleen bij een sim-refresh.</summary>
        public int RateMs { get; private set; }

        /// <summary>Korte, machinaal leesbare toelichting (bv. frozen_pit_snapshot).</summary>
        public string Reason { get; private set; }

        public bool HasValue
        {
            get { return Number.HasValue || Text != null || Flag.HasValue; }
        }

        public static ResearchField Numeric(double? value, ResearchProvenance provenance, DateTime? measuredAtUtc, int rateMs, string reason)
        {
            if (!value.HasValue) return Unavailable(reason ?? "no_value");
            if (double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return Invalid("not_finite");
            if (!ResearchProvenanceNames.CarriesValue(provenance)) return Invalid("provenance_without_value");
            return new ResearchField
            {
                Number = value.Value,
                Provenance = provenance,
                MeasuredAtUtc = measuredAtUtc,
                RateMs = rateMs,
                Reason = reason,
            };
        }

        public static ResearchField TextValue(string value, ResearchProvenance provenance, DateTime? measuredAtUtc, int rateMs, string reason)
        {
            if (string.IsNullOrEmpty(value)) return Unavailable(reason ?? "no_value");
            if (!ResearchProvenanceNames.CarriesValue(provenance)) return Invalid("provenance_without_value");
            return new ResearchField
            {
                Text = value,
                Provenance = provenance,
                MeasuredAtUtc = measuredAtUtc,
                RateMs = rateMs,
                Reason = reason,
            };
        }

        public static ResearchField FlagValue(bool? value, ResearchProvenance provenance, DateTime? measuredAtUtc, int rateMs, string reason)
        {
            if (!value.HasValue) return Unavailable(reason ?? "no_value");
            if (!ResearchProvenanceNames.CarriesValue(provenance)) return Invalid("provenance_without_value");
            return new ResearchField
            {
                Flag = value.Value,
                Provenance = provenance,
                MeasuredAtUtc = measuredAtUtc,
                RateMs = rateMs,
                Reason = reason,
            };
        }

        public static ResearchField Unavailable(string reason)
        {
            return new ResearchField { Provenance = ResearchProvenance.Unavailable, Reason = reason };
        }

        public static ResearchField Invalid(string reason)
        {
            return new ResearchField { Provenance = ResearchProvenance.Invalid, Reason = reason };
        }

        /// <summary>
        /// Waarde binnen [minimum, maximum] of null. Buiten de grens levert een Invalid-field:
        /// de waarde zelf verdwijnt, zodat een sentinel nooit als getal in het bestand staat.
        /// </summary>
        public static ResearchField Ranged(double? value, double minimum, double maximum, ResearchProvenance provenance,
            DateTime? measuredAtUtc, int rateMs, string reason, string outOfRangeReason)
        {
            if (!value.HasValue) return Unavailable(reason ?? "no_value");
            if (double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return Invalid("not_finite");
            if (value.Value < minimum || value.Value > maximum) return Invalid(outOfRangeReason ?? "out_of_range");
            return Numeric(value, provenance, measuredAtUtc, rateMs, reason);
        }
    }

    /// <summary>Invariante, cultuuronafhankelijke opmaak van researchwaarden.</summary>
    public static class ResearchFormat
    {
        public const string TimestampPattern = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

        public static string Timestamp(DateTime value)
        {
            return value.ToUniversalTime().ToString(TimestampPattern, CultureInfo.InvariantCulture);
        }

        public static string Timestamp(DateTime? value)
        {
            return value.HasValue ? Timestamp(value.Value) : null;
        }

        public static string Number(double value)
        {
            return value.ToString("0.######", CultureInfo.InvariantCulture);
        }

        public static string Number(double? value)
        {
            return value.HasValue ? Number(value.Value) : null;
        }
    }
}
