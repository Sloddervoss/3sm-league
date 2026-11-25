using System;

namespace ThreeSM.EnduranceConnector
{
    // Layout positions include sector 1 at zero. A running time needs an observed
    // entry on this lap; a current sector index alone is not an entry timestamp.
    public sealed class SectorProgressMonitor
    {
        public const int MaxSectors = 12; // existing optional V3 wire limit
        private const double MaxGapSeconds = 2.0;
        private const double MaxStep = 0.10;

        public struct Progress
        {
            public int Index;
            public int Count;
            public double ElapsedSeconds;
            public double ProgressPct;
            public bool Learned;
        }

        private string _track;
        private string _session;
        private double[] _published;
        private double?[] _learned = new double?[MaxSectors];
        private int _count;
        private int _sector;
        private int _lap;
        private double _time;
        private double _position;
        private double? _entry;

        public void BeginContext(string track, string session)
        {
            if (string.Equals(track, _track, StringComparison.OrdinalIgnoreCase)
                && string.Equals(session, _session, StringComparison.Ordinal)) return;
            _track = track;
            _session = session;
            _published = null;
            Array.Clear(_learned, 0, _learned.Length);
            _count = 0;
            Interrupt();
        }

        public bool HasPublishedLayout { get { return _published != null; } }

        public void PublishBoundaries(double[] starts)
        {
            if (starts == null || starts.Length < 2 || starts.Length > MaxSectors || starts[0] != 0) return;
            for (var i = 1; i < starts.Length; i++)
                if (!Finite(starts[i]) || starts[i] <= starts[i - 1] || starts[i] >= 1) return;
            _published = (double[])starts.Clone();
        }

        public void Interrupt()
        {
            _sector = 0;
            _entry = null;
        }

        public Progress? Update(double? lapSeconds, double? position, int? sectorIndex,
            int? sectorCount, bool? onPitRoad, int? completedLaps)
        {
            var count = _published != null ? _published.Length : sectorCount.GetValueOrDefault();
            if (count < 2 || count > MaxSectors || count != _count)
            {
                _count = count;
                Array.Clear(_learned, 0, _learned.Length);
                Interrupt();
            }
            if (string.IsNullOrEmpty(_track) || string.IsNullOrEmpty(_session) || onPitRoad != false
                || count < 2 || count > MaxSectors || !sectorIndex.HasValue || sectorIndex < 1 || sectorIndex > count
                || !completedLaps.HasValue || completedLaps < 0
                || !lapSeconds.HasValue || !Finite(lapSeconds.Value) || lapSeconds < 0 || lapSeconds > 1800
                || !position.HasValue || !Finite(position.Value) || position < 0 || position > 1)
            {
                Interrupt();
                return null;
            }

            var index = sectorIndex.Value;
            var lap = completedLaps.Value;
            var time = lapSeconds.Value;
            var pct = position.Value;
            var step = pct - _position;
            var dt = time - _time;

            if (_sector != 0 && lap == _lap + 1 && _sector == count && index == 1
                && step < 0 && step + 1 <= MaxStep && time <= MaxGapSeconds && time < _time)
                _entry = 0;
            else if (_sector != 0 && lap == _lap && dt >= 0 && dt <= MaxGapSeconds && step >= 0 && step <= MaxStep)
            {
                if (index != _sector)
                {
                    _entry = null;
                    if (index == _sector + 1 && dt > 0 && step > 0)
                    {
                        var start = Boundary(index);
                        if (!start.HasValue)
                        {
                            // The index transition is evidence; do not invent evenly spaced boundaries.
                            var before = Boundary(index - 1);
                            var after = Boundary(index + 1);
                            if ((!before.HasValue || pct > before.Value) && (!after.HasValue || pct < after.Value))
                                _learned[index - 1] = start = pct;
                        }
                        if (start.HasValue && _position <= start.Value && start.Value <= pct)
                            _entry = _time + dt * ((start.Value - _position) / step);
                    }
                }
            }
            else _entry = null;

            _sector = index;
            _lap = lap;
            _time = time;
            _position = pct;
            if (!_entry.HasValue) return null;

            var from = Boundary(index);
            var to = Boundary(index + 1);
            var known = from.HasValue && to.HasValue && to.Value > from.Value;
            return new Progress
            {
                Index = index, Count = count, ElapsedSeconds = time - _entry.Value,
                // A clock can run before the next boundary is known. The UI hides that bar.
                ProgressPct = known ? Math.Max(0, Math.Min(100, (pct - from.Value) / (to.Value - from.Value) * 100)) : 0,
                Learned = known
            };
        }

        private double? Boundary(int index)
        {
            if (index <= 1) return 0;
            if (index > _count) return 1;
            return _published != null ? (double?)_published[index - 1] : _learned[index - 1];
        }

        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }
}
