using System;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Leest de 12 wear-zones en 12 karkastemperaturen uit de ruwe iRacing-kanalen.
    ///
    /// De kern: <b>0 is een meting</b>. Een nieuwe band heeft wear 0,00 % en een koude
    /// band in de garage kan 0 °C zijn. 0.7.1.2 gooide wear 0 weg ("geen meting"), waardoor
    /// een verse set niet te onderscheiden was van een ontbrekend kanaal. Dat verschil is
    /// nu expliciet: het kanaal ontbreekt (null) of het is gemeten (0 of meer).
    ///
    /// Wear komt binnen als fractie (0..1) en gaat ×100 naar buiten, onafgerond, zodat de
    /// refresh-detectie op de ruwe waarde blijft werken.
    /// </summary>
    public static class TyreZoneReader
    {
        public const double MinTyreTempC = -40.0;
        public const double MaxTyreTempC = 300.0;
        // Boven 1.001 is geen wearfractie meer maar een ander kanaal of een fout.
        private const double MaxWearFraction = 1.001;

        // 4 hoeken × 3 zones in de volgorde [left, middle, right].
        public static readonly string[] WearChannels =
        {
            "LFwearL", "LFwearM", "LFwearR",
            "RFwearL", "RFwearM", "RFwearR",
            "LRwearL", "LRwearM", "LRwearR",
            "RRwearL", "RRwearM", "RRwearR",
        };

        // Dit is de garage-/pyrometerwaarde, NIET de oppervlaktetemperatuur.
        public static readonly string[] CarcassChannels =
        {
            "LFtempCL", "LFtempCM", "LFtempCR",
            "RFtempCL", "RFtempCM", "RFtempCR",
            "LRtempCL", "LRtempCM", "LRtempCR",
            "RRtempCL", "RRtempCM", "RRtempCR",
        };

        /// <summary>Leest beide sets. Ontbrekende kanalen blijven null; 0 blijft 0.</summary>
        public static TyreZoneReading Read(RawChannelReader channels)
        {
            var wear = new double?[4][];
            var carcass = new double?[4][];
            for (var corner = 0; corner < 4; corner++)
            {
                wear[corner] = new double?[3];
                carcass[corner] = new double?[3];
                for (var zone = 0; zone < 3; zone++)
                {
                    var index = corner * 3 + zone;
                    var fraction = channels == null ? null : channels.ReadNumber(WearChannels[index], 0.0, MaxWearFraction);
                    wear[corner][zone] = ReadWearPercent(fraction);
                    var temperature = channels == null ? null : channels.ReadNumber(CarcassChannels[index], MinTyreTempC, MaxTyreTempC);
                    carcass[corner][zone] = temperature;
                }
            }
            return new TyreZoneReading(wear, carcass);
        }

        /// <summary>Fractie (0..1) naar procenten, of null als het kanaal ontbreekt.</summary>
        public static double? ReadWearPercent(double? fraction)
        {
            if (!fraction.HasValue) return null;
            var value = fraction.Value;
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            if (value < 0.0 || value > MaxWearFraction) return null;
            return (double?)(value * 100.0);
        }
    }
}
