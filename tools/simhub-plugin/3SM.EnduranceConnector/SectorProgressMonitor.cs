using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Live sectorklok, afgeleid uit baanpositie — geen SDK-sectortijd.
    ///
    /// De SDK levert een sectortijd pas als de sector voorbij is. Deze klasse
    /// houdt bij waar elke sector begint en rekent per tick uit hoe lang je al in
    /// de huidige sector zit en hoe ver je erin bent. De grenzen komen bij
    /// voorkeur uit de sessiedata (SectorStartPct, via ReadSectorStarts); pas als
    /// die ontbreken worden ze geleerd uit het moment dat de sectorindex met
    /// precies één opschuift.
    ///
    /// Poorten, in dezelfde geest als de pitvisit-leerling: alleen tellen als de
    /// index en het aantal kloppen, de positie tussen 0 en 1 ligt, de auto niet in
    /// de pitstraat staat en we nog op dezelfde ronde zijn. Anders is er geen
    /// meting en blijft het blok leeg — er wordt niets geschat.
    /// </summary>
    public sealed class SectorProgressMonitor
    {
        public const int MaxSectors = 12;
        private const double MinPosition = 0.0;
        private const double MaxPosition = 1.0;
        private const double MaxLapSeconds = 1800.0;

        /// <summary>Eén tick aan uitkomst. Null betekent: geen betrouwbare meting.</summary>
        public struct Progress
        {
            public int Index;
            public int Count;
            public double ElapsedSeconds;
            public double ProgressPct;
            public bool Learned;
        }

        private readonly Dictionary<string, Dictionary<int, double>> _boundaries =
            new Dictionary<string, Dictionary<int, double>>(StringComparer.OrdinalIgnoreCase);

        private string _trackKey;
        private int _sector;
        private int _lap = -1;
        private double _sectorEntrySeconds;
        private double _lastLapSeconds;

        /// <summary>
        /// Grenzen uit de sessiedata overnemen voor deze baan. Levert de aanroeper
        /// minder grenzen dan sectoren, dan worden alleen de bruikbare overgenomen
        /// en leert de monitor de rest zelf.
        /// </summary>
        public void PublishBoundaries(string trackKey, double[] startsPct, int sectorCount)
        {
            if (string.IsNullOrEmpty(trackKey) || startsPct == null || startsPct.Length == 0) return;
            if (sectorCount < 2 || sectorCount > MaxSectors) return;

            Dictionary<int, double> map;
            if (!_boundaries.TryGetValue(trackKey, out map))
            {
                map = new Dictionary<int, double>();
                _boundaries[trackKey] = map;
            }

            // De publicatie bevat de grenzen ná sector 1: start[0] is het begin van
            // sector 2. Sector 1 begint per definitie op 0 en staat er dus niet in.
            for (var sector = 2; sector <= sectorCount; sector++)
            {
                var index = sector - 2;
                if (index >= startsPct.Length) break;
                var pct = startsPct[index];
                if (double.IsNaN(pct) || pct <= MinPosition || pct >= MaxPosition) continue;
                if (map.ContainsKey(sector)) continue;
                map[sector] = pct;
            }
        }

        /// <summary>
        /// Eén tick. Geeft null zodra één van de poorten niet rond is.
        /// </summary>
        public Progress? Update(
            string trackKey,
            double? lapSeconds,
            double? positionPct,
            int? sectorIndex,
            int? sectorCount,
            bool? onPitRoad,
            int completedLaps)
        {
            if (string.IsNullOrEmpty(trackKey)) return null;
            if (sectorCount == null || sectorCount < 2 || sectorCount > MaxSectors) return null;
            if (sectorIndex == null || sectorIndex < 1 || sectorIndex > sectorCount) return null;
            if (lapSeconds == null || lapSeconds < 0 || lapSeconds > MaxLapSeconds) return null;
            if (positionPct == null || positionPct < MinPosition || positionPct > MaxPosition) return null;
            if (onPitRoad == true) return null;

            var count = sectorCount.Value;
            var sector = sectorIndex.Value;
            var lap = lapSeconds.Value;
            var position = positionPct.Value;

            if (!string.Equals(trackKey, _trackKey, StringComparison.OrdinalIgnoreCase))
            {
                _trackKey = trackKey;
                _sector = 0;
                _lap = -1;
            }

            Dictionary<int, double> map;
            if (!_boundaries.TryGetValue(trackKey, out map))
            {
                map = new Dictionary<int, double>();
                _boundaries[trackKey] = map;
            }

            if (sector != _sector || completedLaps != _lap)
            {
                // Leren mag alleen bij een sprong van precies één sector op dezelfde
                // ronde, met een positie midden op de baan. Anders is het een
                // herstart, een reset of een pitpassage en leren we niets.
                // Een gepubliceerde grens is leidend: die komt uit de sessiedata en
                // wordt niet overschreven door een gelezen positie.
                if (sector == _sector + 1 && completedLaps == _lap && sector > 1
                    && position > MinPosition && position < MaxPosition
                    && !map.ContainsKey(sector))
                {
                    map[sector] = position;
                }
                _sectorEntrySeconds = sector == 1 ? 0.0 : lap;
                _sector = sector;
                _lap = completedLaps;
            }

            // Een nieuwere lap die terugvalt in laptijd betekent een nieuwe ronde:
            // de intrede van deze sector hoort dan bij deze lap, niet bij de vorige.
            if (lap < _lastLapSeconds && sector != 1)
            {
                _sectorEntrySeconds = 0.0;
            }
            _lastLapSeconds = lap;

            var start = Boundary(map, sector, count);
            var next = sector == count ? 1.0 : Boundary(map, sector + 1, count);
            double progress;
            if (sector == count && position < start)
            {
                progress = 1.0;
            }
            else if (next > start)
            {
                progress = (position - start) / (next - start);
            }
            else
            {
                progress = 0.0;
            }

            var learned = (sector == 1 || map.ContainsKey(sector))
                && (sector == count || map.ContainsKey(sector + 1));

            return new Progress
            {
                Index = sector,
                Count = count,
                ElapsedSeconds = Math.Max(0.0, lap - _sectorEntrySeconds),
                ProgressPct = Math.Max(0.0, Math.Min(100.0, progress * 100.0)),
                Learned = learned
            };
        }

        private static double Boundary(Dictionary<int, double> map, int sector, int count)
        {
            if (sector <= 1) return 0.0;
            double value;
            if (map.TryGetValue(sector, out value)) return value;
            // Geen grens bekend: gelijke delen, zodat de balk niet stilvalt.
            return (double)(sector - 1) / (double)count;
        }
    }
}
