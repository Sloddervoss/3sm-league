// ---------------------------------------------------------------------------
// Bronkeuze voor de pace-opname
// ---------------------------------------------------------------------------
// De plugin leest rondetijden uit twee bronnen: het rechtstreekse iRacing-beeld
// (CarIdxLastLapTime) en het SimHub-opponentobject. Tot 0.7.3.0 gold: zodra er
// een auto-index gevonden was, werd alleen de directe waarde gebruikt. Was die
// leeg, nul of -1, dan bleef de rondetijd leeg terwijl SimHub dezelfde auto wel
// een geldige tijd gaf. Dat maakte de uitkomst afhankelijk van de pc in plaats
// van van de meting.
//
// Deze klasse beslist per waarneming welke bron bruikbaar is. De regel is bewust
// streng: een SimHub-tijd wordt alleen overgenomen als de ronde teller sinds de
// vorige waarneming met precies één is opgeschoven en de tijd nieuw is. Dan
// hoort de tijd aantoonbaar bij de ronde die net is afgerond. Zonder dat bewijs
// blijft de tijd leeg - liever geen waarde dan een waarde bij de verkeerde ronde.
//
// Geen SimHub-typen in dit bestand: het is puur en dus los te testen.
// ---------------------------------------------------------------------------
using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Uitkomst van de bronkeuze voor één auto in één waarneming.</summary>
    public struct PaceSourceChoice
    {
        public double? LastLapSeconds;
        public double? BestLapSeconds;
        /// <summary>Ronde waar de laatst gemeten tijd bij hoort (voor de buffer).</summary>
        public int? ReportedLap;
        public double? Lap;
        public string LastLapSource;
        public string BestLapSource;
    }

    public sealed class PaceSourceSelector
    {
        public const string SourceDirect = "direct";
        public const string SourceSimHub = "simhub";

        private const double MinLapSeconds = 0.001;
        private const double MaxLapSeconds = 86400;

        private sealed class Seen
        {
            public double? Lap;
            public double? RawLastLapSeconds;
            public double? BestLapSeconds;
        }

        private readonly Dictionary<string, Seen> cars =
            new Dictionary<string, Seen>(StringComparer.Ordinal);

        /// <summary>Vergeet alle auto's; bij een nieuwe sessie of een herstart.</summary>
        public void Reset()
        {
            cars.Clear();
        }

        /// <summary>Aantal auto's dat nu een vorige waarneming heeft.</summary>
        public int CarCount
        {
            get { return cars.Count; }
        }

        private static double? Valid(double? value)
        {
            if (!value.HasValue) return null;
            var seconds = value.Value;
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return null;
            return seconds >= MinLapSeconds && seconds <= MaxLapSeconds ? (double?)seconds : null;
        }

        /// <summary>
        /// Kiest de rondetijd voor één auto. <paramref name="carId"/> is de stabiele
        /// identiteit van de auto binnen deze sessie (dezelfde sleutel als in het
        /// SimHub-opponentobject), zodat de ronde-geschiedenis per auto klopt.
        /// </summary>
        public PaceSourceChoice Choose(
            string carId,
            double? directLastLapSeconds,
            double? directBestLapSeconds,
            double? directCompletedLap,
            double? directLap,
            double? simHubLastLapSeconds,
            double? simHubBestLapSeconds,
            double? simHubLap)
        {
            var choice = new PaceSourceChoice();

            var lap = directLap ?? simHubLap;
            choice.Lap = lap;

            Seen seen = null;
            var known = !string.IsNullOrEmpty(carId) && cars.TryGetValue(carId, out seen);

            // 1. De rechtstreekse waarde heeft altijd voorrang: die hoort bij de
            //   zelfde auto-index als de ronde teller.
            var directLast = Valid(directLastLapSeconds);
            if (directLast.HasValue)
            {
                choice.LastLapSeconds = directLast;
                choice.LastLapSource = SourceDirect;
                if (directCompletedLap.HasValue && directCompletedLap.Value >= 0)
                {
                    choice.ReportedLap = (int)directCompletedLap.Value;
                }
            }
            else
            {
                // 2. Terugval op SimHub, maar alleen met bewijs van de ronde-overgang:
                //    de teller schuift precies één op en er staat een nieuwe tijd.
                var simHubLast = Valid(simHubLastLapSeconds);
                var lapAdvanced = known && seen.Lap.HasValue && lap.HasValue && lap.Value == seen.Lap.Value + 1;
                var timeIsNew = known && simHubLast.HasValue
                    && (!seen.RawLastLapSeconds.HasValue
                        || Math.Abs(simHubLast.Value - seen.RawLastLapSeconds.Value) > 0.000001);

                if (simHubLast.HasValue && lapAdvanced && timeIsNew)
                {
                    choice.LastLapSeconds = simHubLast;
                    choice.LastLapSource = SourceSimHub;
                    choice.ReportedLap = (int)seen.Lap.Value;
                }
            }

            // 3. De beste ronde is een cumulatieve eigenschap van dezelfde auto en
            //    hoort niet bij één ronde-overgang; hij mag dus uit de andere bron
            //    komen. Zonder ronde teller weten we niet over welke auto het gaat.
            var directBest = Valid(directBestLapSeconds);
            if (directBest.HasValue)
            {
                choice.BestLapSeconds = directBest;
                choice.BestLapSource = SourceDirect;
            }
            else
            {
                var simHubBest = Valid(simHubBestLapSeconds);
                if (simHubBest.HasValue && lap.HasValue)
                {
                    choice.BestLapSeconds = simHubBest;
                    choice.BestLapSource = SourceSimHub;
                }
            }

            if (!string.IsNullOrEmpty(carId))
            {
                if (!known)
                {
                    if (cars.Count >= 64) return choice;
                    seen = new Seen();
                    cars[carId] = seen;
                }

                seen.Lap = lap;
                seen.RawLastLapSeconds = Valid(simHubLastLapSeconds) ?? seen.RawLastLapSeconds;
                if (choice.BestLapSeconds.HasValue) seen.BestLapSeconds = choice.BestLapSeconds;
            }

            return choice;
        }
    }
}
