using System;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén ruwe lezing van de 12 wear-zones en 12 karkastemperaturen uit één tick.
    /// Wear staat in procenten (iRacing levert een fractie; de lezer doet ×100) en is
    /// NIET afgerond: de refresh-detectie moet op de ruwe waarde gebeuren.
    /// Index 0..3 = FL, FR, RL, RR; binnen een hoek 0..2 = left, middle, right.
    /// </summary>
    public sealed class TyreZoneReading
    {
        public TyreZoneReading(double?[][] wearPercent, double?[][] carcassTempC)
        {
            WearPercent = Normalize(wearPercent);
            CarcassTempC = Normalize(carcassTempC);
            HasWear = HasAny(WearPercent);
            HasCarcass = HasAny(CarcassTempC);
        }

        public double?[][] WearPercent { get; private set; }
        public double?[][] CarcassTempC { get; private set; }
        public bool HasWear { get; private set; }
        public bool HasCarcass { get; private set; }
        public bool IsEmpty { get { return !HasWear && !HasCarcass; } }

        internal static double?[][] Normalize(double?[][] zones)
        {
            var result = new double?[4][];
            for (var corner = 0; corner < 4; corner++)
            {
                result[corner] = new double?[3];
                if (zones == null || corner >= zones.Length || zones[corner] == null) continue;
                var source = zones[corner];
                for (var zone = 0; zone < 3 && zone < source.Length; zone++)
                {
                    var value = source[zone];
                    if (value.HasValue && (double.IsNaN(value.Value) || double.IsInfinity(value.Value))) continue;
                    result[corner][zone] = value;
                }
            }
            return result;
        }

        internal static bool HasAny(double?[][] zones)
        {
            if (zones == null) return false;
            for (var corner = 0; corner < zones.Length; corner++)
            {
                if (zones[corner] == null) continue;
                for (var zone = 0; zone < zones[corner].Length; zone++)
                    if (zones[corner][zone].HasValue) return true;
            }
            return false;
        }
    }

    /// <summary>
    /// Bevroren stand van wear + karkas op één moment. <see cref="ObservedAt"/> is het
    /// moment waarop de connector de waarde voor het eerst zag, niet het verzendmoment.
    /// </summary>
    public sealed class TyreSnapshot
    {
        public string ObservedAt { get; set; }
        public double? SessionTimeSeconds { get; set; }
        public int? Lap { get; set; }
        public int? SetsUsed { get; set; }
        /// <summary>session_start of sim_refresh.</summary>
        public string Trigger { get; set; }
        public double?[][] WearPercent { get; set; }
        public double?[][] CarcassTempC { get; set; }
        public DateTime CapturedUtc { get; set; }
    }

    /// <summary>
    /// State machine voor de bandenmeting. iRacing werkt de wear-kanalen alleen bij in de
    /// pitstraat bij, dus de stand die bij pit-entry geldt is de set die eraf ging: dat is
    /// het stint-anker. Deze klasse houdt de laatst gezien stand bij, detecteert de
    /// sim-refresh (wear of karkas verspringt) én de pit-entry-flank, en laat het anker
    /// 120 s meelopen.
    ///
    /// Bewust geen SimHub- of iRacing-referentie: dit is pure logica, zodat het te
    /// compileren en te testen is zonder de sim.
    /// </summary>
    public sealed class TyreSnapshotTracker
    {
        /// <summary>Een zone telt als gewijzigd boven 0,05 procentpunt (ruwe waarde, vóór afronding).</summary>
        public const double WearChangeThresholdPercent = 0.05;
        /// <summary>Karkas telt als gewijzigd boven 0,5 °C.</summary>
        public const double CarcassChangeThresholdC = 0.5;
        /// <summary>Hoe lang het pit-entry-anker meegaat.</summary>
        public const double PitEntryWindowSeconds = 120.0;
        // Kleine terugwaartse sprongen in sessietijd negeren; een echte sprong = nieuwe sessie.
        private const double ClockSkewToleranceSeconds = 5.0;

        private TyreSnapshot _last;
        private TyreSnapshot _pitEntry;
        private bool _refreshSeen;
        private bool _onPitRoad;

        /// <summary>Laatst gezien stand (de set die er nu op zit), of null.</summary>
        public TyreSnapshot Last { get { return _last; } }

        /// <summary>De stand van vóór de pit-refresh, of null buiten het venster.</summary>
        public TyreSnapshot PitEntry { get { return _pitEntry; } }

        public void Reset()
        {
            _last = null;
            _pitEntry = null;
            _refreshSeen = false;
            _onPitRoad = false;
        }

        /// <summary>
        /// Eén tick. Volgorde is bewust: eerst de pit-entry-flank bepalen (de stand van
        /// vóór deze tick is de set die eraf gaat), dan de refresh detecteren, dan het
        /// anker zetten, dan het venster sluiten.
        /// </summary>
        public void Update(TyreZoneReading reading, double? sessionTimeSeconds, int? lap, int? setsUsed, bool onPitRoad, DateTime utcNow)
        {
            var pitEntryFlank = onPitRoad && !_onPitRoad;
            _onPitRoad = onPitRoad;
            var sessionTime = Finite(sessionTimeSeconds);
            var previous = _last;

            if (reading != null && !reading.IsEmpty && (previous == null || Differs(reading, previous)))
            {
                _last = new TyreSnapshot
                {
                    ObservedAt = UtcText(utcNow),
                    SessionTimeSeconds = sessionTime,
                    Lap = lap,
                    SetsUsed = setsUsed,
                    Trigger = _refreshSeen ? "sim_refresh" : "session_start",
                    WearPercent = Clone(reading.WearPercent),
                    CarcassTempC = Clone(reading.CarcassTempC),
                    CapturedUtc = utcNow
                };
                _refreshSeen = true;
            }

            if (pitEntryFlank && _pitEntry == null)
            {
                // Voorkeur voor de stand van vóór deze tick: die is gegarandeerd van de
                // afgelegde set, ook als de sim-refresh en de pit-entry in dezelfde tick
                // vallen. Bestaat er nog niets, dan is de huidige lezing het beste dat we hebben.
                var source = previous ?? _last;
                if (source != null)
                {
                    _pitEntry = new TyreSnapshot
                    {
                        ObservedAt = UtcText(utcNow),
                        SessionTimeSeconds = sessionTime,
                        Lap = lap,
                        SetsUsed = setsUsed,
                        Trigger = "pit_entry",
                        WearPercent = Clone(source.WearPercent),
                        CarcassTempC = Clone(source.CarcassTempC),
                        CapturedUtc = utcNow
                    };
                }
            }

            ExpirePitEntry(sessionTime, utcNow);
        }

        private void ExpirePitEntry(double? sessionTimeSeconds, DateTime utcNow)
        {
            if (_pitEntry == null) return;
            double elapsed;
            if (_pitEntry.SessionTimeSeconds.HasValue && sessionTimeSeconds.HasValue)
                elapsed = sessionTimeSeconds.Value - _pitEntry.SessionTimeSeconds.Value;
            else
                elapsed = (utcNow - _pitEntry.CapturedUtc).TotalSeconds;
            if (elapsed > PitEntryWindowSeconds || elapsed < -ClockSkewToleranceSeconds) _pitEntry = null;
        }

        private static bool Differs(TyreZoneReading reading, TyreSnapshot snapshot)
        {
            return ChangedBeyond(reading.WearPercent, snapshot.WearPercent, WearChangeThresholdPercent)
                || ChangedBeyond(reading.CarcassTempC, snapshot.CarcassTempC, CarcassChangeThresholdC);
        }

        private static bool ChangedBeyond(double?[][] current, double?[][] previous, double threshold)
        {
            for (var corner = 0; corner < 4; corner++)
            {
                var left = current != null && corner < current.Length ? current[corner] : null;
                var right = previous != null && corner < previous.Length ? previous[corner] : null;
                for (var zone = 0; zone < 3; zone++)
                {
                    var a = left != null && zone < left.Length ? left[zone] : null;
                    var b = right != null && zone < right.Length ? right[zone] : null;
                    if (a.HasValue != b.HasValue) return true;
                    if (a.HasValue && Math.Abs(a.Value - b.Value) > threshold) return true;
                }
            }
            return false;
        }

        internal static double?[][] Clone(double?[][] zones)
        {
            return TyreZoneReading.Normalize(zones);
        }

        internal static string UtcText(DateTime utcNow)
        {
            return utcNow.ToUniversalTime().ToString("o");
        }

        private static double? Finite(double? value)
        {
            if (!value.HasValue) return null;
            if (double.IsNaN(value.Value) || double.IsInfinity(value.Value)) return null;
            return value;
        }
    }
}
