// ---------------------------------------------------------------------------
// Bronkeuze voor de pace-opname
// ---------------------------------------------------------------------------
// De plugin leest rondetijden uit twee bronnen: het rechtstreekse iRacing-beeld
// (CarIdxLastLapTime) en het SimHub-opponentobject. Tot 0.7.3.0 gold: zodra er
// een auto-index gevonden was, werd alleen de directe waarde gebruikt. Was die
// leeg, nul of -1, dan bleef de rondetijd leeg terwijl SimHub dezelfde auto wel
// een geldige tijd gaf. De uitkomst hing daardoor van de pc af in plaats van van
// de meting.
//
// Deze klasse beslist per waarneming welke bron bruikbaar is. De regels zijn
// bewust streng:
//
//   1. Een geldige directe tijd wint; die hoort bij dezelfde auto-index als de
//      ronde teller.
//   2. Terugval op SimHub mag alleen als de SimHub-teller precies één opschoof,
//      de directe teller (als die er is) hetzelfde zegt en de tijd nieuw is.
//      Een tellerbronwissel is geen bewijs.
//   3. De gevonden tijd hoort bij de ronde die net is afgerond en blijft daarna
//      staan zolang de auto op de volgende ronde rijdt en de tijd niet wijzigt.
//      De buffer keurt een rondetijd pas 0,25 s na de overgang; zonder dat
//      vasthouden zou de terugvaltijd de rondehistorie nooit bereiken.
//   4. Zonder bewijs blijft de tijd leeg - liever geen waarde dan een waarde bij
//      de verkeerde ronde.
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
            public double? DirectLap;
            public double? SimHubLap;
            public double? RawSimHubLast;
            public double? ProvenLast;
            public int? ProvenLap;
        }

        private readonly Dictionary<string, Seen> cars =
            new Dictionary<string, Seen>(StringComparer.Ordinal);

        /// <summary>Vergeet alle auto's; bij een nieuwe sessie, epoch of herstart.</summary>
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

            // De waarneming zelf houdt de rechtstreekse teller aan als die er is:
            // daar hangt de interpolatie aan. De terugval hieronder gebruikt zijn
            // eigen teller en eist overeenstemming als beide er zijn.
            var lap = directLap ?? simHubLap;
            choice.Lap = lap;

            Seen seen = null;
            var known = !string.IsNullOrEmpty(carId) && cars.TryGetValue(carId, out seen);
            var countersAgree = !directLap.HasValue || !simHubLap.HasValue
                || Math.Abs(directLap.Value - simHubLap.Value) < 0.000001;

            // 1. Een geldige rechtstreekse tijd wint altijd.
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
            else if (countersAgree && known)
            {
                // 2. Terugval op SimHub, maar alleen met bewijs: de SimHub-teller
                //    schuift precies één op en er staat een nieuwe tijd. Verdwijnt of
                //    verschijnt een teller, dan is dat een bronwissel en geen bewijs.
                var simHubLast = Valid(simHubLastLapSeconds);
                var sameCounters = seen.SimHubLap.HasValue == simHubLap.HasValue
                    && seen.DirectLap.HasValue == directLap.HasValue;
                // Elke teller moet op zichzelf precies één zijn opgeschoven. Een teller
                // die er net wel of net niet is, levert geen bewijs (en mag nooit de
                // waarde van een lege vorige meting opvragen).
                var countersAdvanced = (!simHubLap.HasValue
                        || (seen.SimHubLap.HasValue && Math.Abs(simHubLap.Value - (seen.SimHubLap.Value + 1)) < 0.000001))
                    && (!directLap.HasValue
                        || (seen.DirectLap.HasValue && Math.Abs(directLap.Value - (seen.DirectLap.Value + 1)) < 0.000001));
                var timeIsNew = simHubLast.HasValue
                    && (!seen.RawSimHubLast.HasValue
                        || Math.Abs(simHubLast.Value - seen.RawSimHubLast.Value) > 0.000001);
                var timedLap = simHubLap.HasValue ? simHubLap.Value - 1 : (double?)null;

                if (simHubLast.HasValue && timedLap.HasValue && timedLap.Value >= 0
                    && sameCounters && countersAdvanced && timeIsNew)
                {
                    choice.LastLapSeconds = simHubLast;
                    choice.LastLapSource = SourceSimHub;
                    choice.ReportedLap = (int)timedLap.Value;
                    seen.ProvenLast = simHubLast;
                    seen.ProvenLap = (int)timedLap.Value;
                }
                else if (seen.ProvenLast.HasValue && seen.ProvenLap.HasValue && simHubLap.HasValue
                    && Math.Abs(simHubLap.Value - (seen.ProvenLap.Value + 1)) < 0.000001
                    && simHubLast.HasValue
                    && Math.Abs(simHubLast.Value - seen.ProvenLast.Value) < 0.000001)
                {
                    // 3. Vasthouden: dezelfde ronde, dezelfde tijd. De buffer keurt
                    //    pas 0,25 s na de overgang en mag de tijd dan nog zien.
                    choice.LastLapSeconds = seen.ProvenLast;
                    choice.LastLapSource = SourceSimHub;
                    choice.ReportedLap = seen.ProvenLap;
                }

                // Een nieuwe ronde zonder nieuwe tijd maakt het oude bewijs ongeldig.
                if (seen.ProvenLap.HasValue && simHubLap.HasValue
                    && Math.Abs(simHubLap.Value - (seen.ProvenLap.Value + 1)) >= 0.000001
                    && Math.Abs(simHubLap.Value - seen.ProvenLap.Value) > 0.000001)
                {
                    seen.ProvenLast = null;
                    seen.ProvenLap = null;
                }
            }

            // 4. De beste ronde is een cumulatieve eigenschap van dezelfde auto en
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

                seen.DirectLap = directLap;
                seen.SimHubLap = simHubLap;
                var rawLast = Valid(simHubLastLapSeconds);
                if (rawLast.HasValue) seen.RawSimHubLast = rawLast;
            }

            return choice;
        }
    }
}
