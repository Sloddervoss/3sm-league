using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Onderzoeksprotocol-markers. Elke marker is herhaalbaar: een tweede pitstop levert
    /// opnieuw pit_entry + pit_box + tyre_change, en dat is precies de bedoeling (een
    /// analyse moet per stint kunnen groeperen).
    /// </summary>
    public enum ResearchEventKind
    {
        Garage = 0,
        Stint = 1,
        PitEntry = 2,
        PitBox = 3,
        TyreChange = 4,
        Reset = 5,
        SessionEnd = 6,
    }

    public static class ResearchEventNames
    {
        public const string Garage = "garage";
        public const string Stint = "stint";
        public const string PitEntry = "pit_entry";
        public const string PitBox = "pit_box";
        public const string TyreChange = "tyre_change";
        public const string Reset = "reset";
        public const string SessionEnd = "session_end";

        public const string SourceAuto = "auto";
        public const string SourceManual = "manual";

        public static string ToWire(ResearchEventKind kind)
        {
            switch (kind)
            {
                case ResearchEventKind.Garage: return Garage;
                case ResearchEventKind.Stint: return Stint;
                case ResearchEventKind.PitEntry: return PitEntry;
                case ResearchEventKind.PitBox: return PitBox;
                case ResearchEventKind.TyreChange: return TyreChange;
                case ResearchEventKind.Reset: return Reset;
                case ResearchEventKind.SessionEnd: return SessionEnd;
                default: return "unknown";
            }
        }

        public static bool TryParse(string text, out ResearchEventKind kind)
        {
            kind = ResearchEventKind.Garage;
            if (string.IsNullOrEmpty(text)) return false;
            switch (text.Trim())
            {
                case Garage: kind = ResearchEventKind.Garage; return true;
                case Stint: kind = ResearchEventKind.Stint; return true;
                case PitEntry: kind = ResearchEventKind.PitEntry; return true;
                case PitBox: kind = ResearchEventKind.PitBox; return true;
                case TyreChange: kind = ResearchEventKind.TyreChange; return true;
                case Reset: kind = ResearchEventKind.Reset; return true;
                case SessionEnd: kind = ResearchEventKind.SessionEnd; return true;
                default: return false;
            }
        }

        public static IEnumerable<string> All
        {
            get
            {
                yield return Garage;
                yield return Stint;
                yield return PitEntry;
                yield return PitBox;
                yield return TyreChange;
                yield return Reset;
                yield return SessionEnd;
            }
        }
    }

    /// <summary>Eén marker zoals hij in de JSONL komt.</summary>
    public sealed class ResearchEventMarker
    {
        public ResearchEventKind Kind;
        public string Source = ResearchEventNames.SourceAuto;
        public DateTime AtUtc;
        public double? SessionTimeSeconds;
        public long Sequence;
        public readonly List<KeyValuePair<string, object>> Data = new List<KeyValuePair<string, object>>();

        public ResearchEventMarker Add(string key, object value)
        {
            if (key != null) Data.Add(new KeyValuePair<string, object>(key, value));
            return this;
        }
    }

    /// <summary>
    /// Detecteert de protocol-markers uit de flanken van de capture-state. Leest zelf niets
    /// uit de SDK: alles komt uit <see cref="ResearchTick"/>, dat de plugin vult met wat de
    /// bestaande capture al bepaalde.
    /// </summary>
    public sealed class ResearchEventDetector
    {
        /// <summary>Onder deze snelheid (km/u) op de pitstraat geldt de auto als "in het vak".</summary>
        public const double PitBoxSpeedKph = 5.0;

        /// <summary>Een sessietijd die zoveel seconden terugspringt, is een reset.</summary>
        public const double ResetSessionTimeJumpSeconds = 5.0;

        private bool _hasPrevious;
        private bool _wasInCar;
        private bool _wasOnPitRoad;
        private bool _wasRunning;
        private bool _inPitBox;
        private int? _lastSetsUsed;
        private double? _lastSessionTime;
        private int? _lastCompletedLaps;

        public void Reset()
        {
            _hasPrevious = false;
            _wasInCar = false;
            _wasOnPitRoad = false;
            _wasRunning = false;
            _inPitBox = false;
            _lastSetsUsed = null;
            _lastSessionTime = null;
            _lastCompletedLaps = null;
        }

        public IList<ResearchEventMarker> Observe(ResearchTick tick)
        {
            var markers = new List<ResearchEventMarker>(2);
            if (tick == null) return markers;

            var onPitRoad = tick.OnPitRoad.HasValue && tick.OnPitRoad.Value;
            if (_hasPrevious)
            {
                if (_wasRunning && !tick.GameRunning)
                {
                    markers.Add(new ResearchEventMarker
                    {
                        Kind = ResearchEventKind.SessionEnd,
                        AtUtc = tick.AtUtc,
                        SessionTimeSeconds = tick.SessionTimeSeconds,
                        Sequence = tick.Sequence,
                    }.Add("reason", "game_stopped"));
                }

                if (tick.GameRunning)
                {
                    // garage: van "in de auto" naar "niet in de auto".
                    if (_wasInCar && !tick.IsInCar)
                    {
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.Garage,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("sessionPhase", tick.SessionPhase));
                    }

                    // stint: in de auto stappen, of de pitstraat verlaten.
                    var enteredCar = tick.IsInCar && !_wasInCar;
                    var leftPitRoad = tick.IsInCar && _wasOnPitRoad && !onPitRoad;
                    if (enteredCar || leftPitRoad)
                    {
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.Stint,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("completedLaps", tick.CompletedLaps.HasValue ? (object)tick.CompletedLaps.Value : null)
                         .Add("reason", enteredCar ? "entered_car" : "left_pit_road"));
                    }

                    if (onPitRoad && !_wasOnPitRoad)
                    {
                        _inPitBox = false;
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.PitEntry,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("speedKph", tick.SpeedKph.HasValue ? (object)tick.SpeedKph.Value : null));
                    }

                    if (onPitRoad && !_inPitBox && tick.SpeedKph.HasValue && tick.SpeedKph.Value <= PitBoxSpeedKph)
                    {
                        _inPitBox = true;
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.PitBox,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("speedKph", tick.SpeedKph.Value));
                    }

                    if (!onPitRoad) _inPitBox = false;

                    // Bandenwissel: de set-teller loopt op (iRacing verhoogt TireSetsUsed
                    // alleen als er echt een nieuwe set onder gaat).
                    if (tick.SetsUsed.HasValue && _lastSetsUsed.HasValue && tick.SetsUsed.Value > _lastSetsUsed.Value)
                    {
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.TyreChange,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("setsUsed", tick.SetsUsed.Value)
                         .Add("previousSetsUsed", _lastSetsUsed.Value));
                    }

                    // Reset: sessietijd of ronde teller springt terug (auto terug naar de garage,
                    // sessie herstart, iRacing reconnect).
                    var timeJumpedBack = tick.SessionTimeSeconds.HasValue && _lastSessionTime.HasValue
                        && tick.SessionTimeSeconds.Value < _lastSessionTime.Value - ResetSessionTimeJumpSeconds;
                    var lapsJumpedBack = tick.CompletedLaps.HasValue && _lastCompletedLaps.HasValue
                        && tick.CompletedLaps.Value < _lastCompletedLaps.Value;
                    if (timeJumpedBack || lapsJumpedBack)
                    {
                        markers.Add(new ResearchEventMarker
                        {
                            Kind = ResearchEventKind.Reset,
                            AtUtc = tick.AtUtc,
                            SessionTimeSeconds = tick.SessionTimeSeconds,
                            Sequence = tick.Sequence,
                        }.Add("previousSessionTimeSeconds", _lastSessionTime.HasValue ? (object)_lastSessionTime.Value : null)
                         .Add("previousCompletedLaps", _lastCompletedLaps.HasValue ? (object)_lastCompletedLaps.Value : null));
                    }
                }
            }

            _hasPrevious = true;
            _wasInCar = tick.IsInCar;
            _wasOnPitRoad = onPitRoad;
            _wasRunning = tick.GameRunning;
            if (tick.SetsUsed.HasValue) _lastSetsUsed = tick.SetsUsed;
            if (tick.SessionTimeSeconds.HasValue) _lastSessionTime = tick.SessionTimeSeconds;
            if (tick.CompletedLaps.HasValue) _lastCompletedLaps = tick.CompletedLaps;
            return markers;
        }

        /// <summary>Handmatige marker (UI-knop). Herhaalbaar en met dezelfde vorm als de auto-marker.</summary>
        public static ResearchEventMarker Manual(ResearchEventKind kind, string note, ResearchTick tick)
        {
            var marker = new ResearchEventMarker
            {
                Kind = kind,
                Source = ResearchEventNames.SourceManual,
                AtUtc = tick == null ? DateTime.UtcNow : tick.AtUtc,
                SessionTimeSeconds = tick == null ? null : tick.SessionTimeSeconds,
                Sequence = tick == null ? 0 : tick.Sequence,
            };
            if (!string.IsNullOrEmpty(note)) marker.Add("note", note);
            return marker;
        }
    }
}
