using System;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// De regels voor "onbekend", "nul" en "SDK-sentinel" in de capture, op één plek en
    /// los van SimHub zodat ze te testen zijn.
    ///
    /// Het uitgangspunt is simpel en streng: een ontbrekende meting is null, een gemeten
    /// nul is nul, en een sentinel (iRacing's -1 / 32767 / 65535) is geen van beide maar
    /// "onbekend". Tot 0.7.1.2 gebeurde dat niet overal: ontbrekende brandstof werd 0,
    /// onPitRoad viel terug op false en wearfractie 0 werd weggefilterd. Daarmee was een
    /// verzonnen meting niet te onderscheiden van een echte.
    /// </summary>
    public static class CaptureValueRules
    {
        // iRacing publiceert -1 als "geen waarde" in verscheidene kanalen.
        public const double UnknownSentinel = -1.0;
        // Bovengrens voor de resterende reparatietijd (seconden) uit het contract.
        public const double MaxRepairSeconds = 86400.0;
        // Plausibele tankinhoud; alles daarboven is geen meting van deze auto.
        public const double MaxFuelLitres = 250.0;

        /// <summary>
        /// Brandstof in liters. Ontbrekend kanaal = null (was: 0). Een gemeten 0 blijft 0.
        /// Een negatieve of onmogelijk grote waarde is geen meting en wordt null.
        /// </summary>
        public static double? FuelLitres(double? raw)
        {
            if (!raw.HasValue) return null;
            var value = raw.Value;
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            if (value < 0.0 || value > MaxFuelLitres) return null;
            return value;
        }

        /// <summary>
        /// Brandstof als fractie van de tankinhoud. Zonder liters of zonder plausibele
        /// inhoud is het antwoord null: een onbekende tank kun je niet als 0% melden.
        /// </summary>
        public static double? FuelPercent(double? litres, double? capacity)
        {
            if (!litres.HasValue || !capacity.HasValue) return null;
            if (capacity.Value <= 0.0 || double.IsNaN(capacity.Value) || double.IsInfinity(capacity.Value)) return null;
            return (double?)Math.Round(Math.Min(1.0, litres.Value / capacity.Value), 4);
        }

        /// <summary>
        /// Resterende ronden. Alleen berekend als er zowel een brandstofmeting als een
        /// verbruik per ronde is; anders blijft de schatting van de sim staan (of null).
        /// </summary>
        public static double? LapsRemaining(double? litres, double fuelPerLapLitres, double? simEstimate)
        {
            if (litres.HasValue && litres.Value > 0.0 && fuelPerLapLitres > 0.0)
                return (double?)Math.Round(litres.Value / fuelPerLapLitres, 1);
            return simEstimate;
        }

        /// <summary>
        /// Resterende reparatietijd. 0 is een echte meting ("er staat niets meer open");
        /// de sentinel -1, alles buiten 0..86400 en NaN zijn null.
        /// </summary>
        public static double? RepairSeconds(double? raw)
        {
            if (!raw.HasValue) return null;
            var value = raw.Value;
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            if (value < 0.0 || value > MaxRepairSeconds) return null;
            if (value == UnknownSentinel) return null; // expliciet, ook al valt -1 al af
            return (double?)Math.Round(value, 1);
        }

        /// <summary>
        /// Het ruwe PitSvFlags-bitmasker is de INTENTIE van de rijder, geen uitkomst.
        /// Negatief (iRacing's "geen waarde") is null; 0 betekent "niets aangevinkt" en
        /// blijft 0.
        /// </summary>
        public static int? PitServiceFlags(int? raw)
        {
            if (!raw.HasValue) return null;
            return raw.Value < 0 ? (int?)null : raw;
        }

        /// <summary>
        /// Eén gedeelde pitstraat-waarneming: het ruwe SDK-kanaal eerst, de SimHub-property
        /// alleen als vangnet. Ontbreekt beide, dan is het antwoord null — niet false.
        /// </summary>
        public static bool? OnPitRoad(bool? sdkChannel, bool? property)
        {
            if (sdkChannel.HasValue) return sdkChannel;
            return property;
        }
    }
}
