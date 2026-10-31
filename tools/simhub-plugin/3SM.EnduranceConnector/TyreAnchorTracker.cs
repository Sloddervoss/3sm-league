using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén anker-kandidaat: een moment waarop de wear van een set is waargenomen,
    /// met het bewijs dat we hebben en de onzekerheid die overblijft.
    ///
    /// Dit vervangt de "sim_refresh"-claim van <see cref="TyreSnapshotTracker"/>. Die
    /// noemde een temperatuurverandering al een refresh, en dat is geen bewijs: iRacing
    /// werkt de wear-kanalen alleen bij als er iets met de banden gebeurt, maar een
    /// nieuwe SDK-tick of een koudere karkaswaarde bewijst dat niet.
    ///
    /// Daarom: <see cref="Kind"/> zegt WAT we zagen, <see cref="Evidence"/> zegt
    /// WAARMEE, <see cref="Confidence"/> hoe zeker, en <see cref="Confirmed"/> is
    /// alleen true als de sim een expliciet refreshsignaal gaf (een opgehoogde
    /// <c>TireSetsUsed</c>-teller samen met een wear-sprong omhoog).
    /// </summary>
    public sealed class TyreAnchor
    {
        /// <summary>De meetgebeurtenis zoals hij de outbox in gaat; hier één keer gemaakt.</summary>
        public MeasurementEventRecord Record { get; internal set; }

        public string AnchorId { get { return Record == null ? null : Record.EventUid; } }
        /// <summary>De wear-waarneming waar een ronde naar mag verwijzen: dezelfde UUID.</summary>
        public string ObservationId { get { return AnchorId; } }
        public string Kind { get { return Record == null ? null : Record.Kind; } }
        public DateTime ObservedAtUtc { get { return Record == null ? default(DateTime) : Record.ObservedAtUtc; } }
        public long? SdkTick { get { return Record == null ? null : Record.SdkTick; } }
        public WearReading WearBefore { get { return Record == null ? null : Record.WearBefore; } }
        public WearReading WearAfter { get { return Record == null ? null : Record.WearAfter; } }
        public DateTime? WearBeforeObservedAtUtc { get { return Record == null ? null : Record.WearBeforeObservedAtUtc; } }
        public DateTime? WearAfterObservedAtUtc { get { return Record == null ? null : Record.WearAfterObservedAtUtc; } }
        public SetGenerationReading SetGeneration { get { return Record == null ? null : Record.SetGeneration; } }
        public TyreEvidence Evidence { get { return Record == null ? null : Record.Evidence; } }
        public double Confidence { get { return Record == null || !Record.Confidence.HasValue ? 0 : Record.Confidence.Value; } }
        public string PitVisitId { get { return Record == null ? null : Record.PitVisitId; } }
        public int ChangedCorners { get; internal set; }
        /// <summary>
        /// Alleen true bij een expliciet refreshsignaal van de sim. Bij twijfel false:
        /// een kandidaat is geen bevestiging.
        /// </summary>
        public bool Confirmed { get; internal set; }
    }

    /// <summary>
    /// De ankerdetectie. Leest wear per hoek uit de SDK-lezing, houdt de laatst
    /// waargenomen stand bij en maakt van elke relevante verandering een gebeurtenis
    /// met bewijs.
    ///
    /// Geen SimHub-referentie: puur, dus testbaar zonder sim.
    /// </summary>
    public sealed class TyreAnchorTracker
    {
        /// <summary>Een zone telt als gewijzigd boven 0,05 procentpunt (ruwe waarde).</summary>
        public const double WearChangeThresholdPercent = 0.05;

        public const string KindSessionStart = "session_start";
        public const string KindWearValueChanged = "wear_value_changed";
        public const string KindPitServiceCompleted = "pit_service_completed";
        public const string KindWearRefreshConfirmed = "wear_refresh_confirmed";

        public const string SourceWearChannels = "wear_channels";
        public const string SourceTyreSets = "tire_sets_used";
        public const string SourcePitService = "pit_service";

        private readonly MeasurementIdFactory _ids;
        private readonly string _segmentToken;
        private readonly List<TyreAnchor> _created = new List<TyreAnchor>();

        private WearReading _baselineWear;
        private DateTime? _baselineAtUtc;
        private long? _baselineTick;
        private int? _baselineSetsUsed;
        private SetGenerationReading _generation = new SetGenerationReading();
        private string _segmentId;
        private string _observedSessionId;

        public TyreAnchorTracker(MeasurementIdFactory ids, string segmentToken)
        {
            if (ids == null) throw new ArgumentNullException("ids");
            _ids = ids;
            _segmentToken = MeasurementIds.SanitizeLocalId(segmentToken, "seg");
        }

        public SetGenerationReading Generation { get { return _generation; } }

        /// <summary>De nieuwe ankers sinds de vorige keer; de lijst wordt geleegd.</summary>
        public IList<TyreAnchor> Drain()
        {
            if (_created.Count == 0) return new TyreAnchor[0];
            var copy = _created.ToArray();
            _created.Clear();
            return copy;
        }

        /// <summary>
        /// Nieuwe sessie: de generaties beginnen opnieuw en de eerste wear-lezing wordt
        /// weer een <c>session_start</c>-anker. De setgeneratie is lokaal en per segment.
        /// </summary>
        public void Reset()
        {
            _baselineWear = null;
            _baselineAtUtc = null;
            _baselineTick = null;
            _baselineSetsUsed = null;
            _generation = new SetGenerationReading();
            _segmentId = null;
            _observedSessionId = null;
            _created.Clear();
        }

        /// <summary>
        /// Eén tick. <paramref name="pitServiceCompleted"/> betekent: dit bezoek is
        /// afgerond en de servicelijst was niet leeg. Dat is een aanwijzing, geen bewijs
        /// dat de wear opnieuw gemeten is.
        /// </summary>
        public void Observe(TelemetrySample sample, string pitVisitId, bool pitServiceCompleted)
        {
            if (sample == null || sample.Wear == null || !sample.Wear.IsValid) return;
            var wear = sample.Wear;
            if (!string.IsNullOrEmpty(sample.SegmentId)) _segmentId = sample.SegmentId;
            if (!string.IsNullOrEmpty(sample.ObservedSessionId)) _observedSessionId = sample.ObservedSessionId;

            if (_baselineWear == null)
            {
                _baselineWear = wear;
                _baselineAtUtc = sample.ObservedAtUtc;
                _baselineTick = sample.SdkTick;
                _baselineSetsUsed = sample.TyreSetsUsed;
                Emit(sample, pitVisitId, KindSessionStart, null, wear, null, sample.ObservedAtUtc,
                    null, sample.SdkTick, SourceWearChannels, new[] { "wear_percent" },
                    0.9, false, 0,
                    "eerste wear-waarneming in dit segment; geen refreshbewijs");
                return;
            }

            var changed = ChangedCorners(_baselineWear, wear);
            var anyIncrease = AnyCornerIncreased(_baselineWear, wear, out var increased);
            var setsIncremented = sample.TyreSetsUsed.HasValue && _baselineSetsUsed.HasValue
                && sample.TyreSetsUsed.Value > _baselineSetsUsed.Value;

            if (changed > 0)
            {
                // Alleen een wear-sprong omhoog kan een nieuwe set zijn. Een daling is
                // een bijgewerkte wearwaarde en zegt niets over een bandenwissel.
                if (setsIncremented && anyIncrease)
                {
                    for (var corner = 0; corner < 4; corner++)
                        if (increased[corner]) _generation.Increment(corner);
                    Emit(sample, pitVisitId, KindWearRefreshConfirmed, _baselineWear, wear,
                        _baselineAtUtc, sample.ObservedAtUtc, _baselineTick, sample.SdkTick,
                        SourceTyreSets, new[] { "tire_sets_used", "wear_percent", "tire_sets" },
                        0.95, true, changed,
                        "wear sprong omhoog en TireSetsUsed nam toe");
                }
                else
                {
                    Emit(sample, pitVisitId, KindWearValueChanged, _baselineWear, wear,
                        _baselineAtUtc, sample.ObservedAtUtc, _baselineTick, sample.SdkTick,
                        SourceWearChannels, new[] { "wear_percent", "sdk_tick" },
                        0.4, false, changed,
                        setsIncremented
                            ? "wear veranderde, maar niet omhoog: geen nieuwe set bewezen"
                            : "wear veranderde zonder refreshsignaal van de sim");
                }
                _baselineWear = wear;
                _baselineAtUtc = sample.ObservedAtUtc;
                _baselineTick = sample.SdkTick;
                _baselineSetsUsed = sample.TyreSetsUsed ?? _baselineSetsUsed;
                return;
            }

            if (pitServiceCompleted)
            {
                // Ongewijzigde wear na een afgeronde pitservice. Dat kan betekenen dat de
                // sim de waarde niet opnieuw heeft gemeten, of dat de banden niet gewisseld
                // zijn. Beide zijn mogelijk; daarom een kandidaat met lage confidence.
                Emit(sample, pitVisitId, KindPitServiceCompleted, _baselineWear, wear,
                    _baselineAtUtc, sample.ObservedAtUtc, _baselineTick, sample.SdkTick,
                    SourcePitService, new[] { "pit_service_flags", "wear_percent", "tire_sets" },
                    0.25, false, 0,
                    "wear ongewijzigd na pitservice: geen bewijs dat opnieuw gemeten is");
                _baselineAtUtc = sample.ObservedAtUtc;
                _baselineTick = sample.SdkTick;
                _baselineSetsUsed = sample.TyreSetsUsed ?? _baselineSetsUsed;
            }
        }

        private void Emit(TelemetrySample sample, string pitVisitId, string kind, WearReading before,
            WearReading after, DateTime? beforeAtUtc, DateTime afterAtUtc, long? beforeTick, long? afterTick,
            string source, string[] channels, double confidence, bool confirmed, int changedCorners,
            string note)
        {
            var record = new MeasurementEventRecord
            {
                EventUid = _ids.NewEventUid(),
                EventId = _ids.NextEventLabel(),
                Kind = kind,
                SegmentId = MeasurementIds.SanitizeLocalId(_segmentId ?? ("seg-" + _segmentToken), "seg"),
                PitVisitId = MeasurementIds.IsLocalId(pitVisitId) ? pitVisitId : null,
                ObservedSessionId = _observedSessionId,
                ObservedAtUtc = afterAtUtc,
                SessionTimeSeconds = sample.SessionTimeSeconds,
                SdkTick = afterTick,
                WearBefore = before,
                WearAfter = after,
                WearBeforeObservedAtUtc = beforeAtUtc,
                WearAfterObservedAtUtc = afterAtUtc,
                WearBeforeSdkTick = beforeTick,
                WearAfterSdkTick = afterTick,
                SetGeneration = _generation.Clone(),
                Evidence = new TyreEvidence(source, channels, EvidenceNote(note, beforeAtUtc, afterAtUtc)),
                Confidence = confidence,
                RecordRevision = 1
            };
            _created.Add(new TyreAnchor
            {
                Record = record,
                ChangedCorners = changedCorners,
                Confirmed = confirmed
            });
        }

        /// <summary>
        /// De ouderdom van de "voor"-waarde is een feit dat de lezer nodig heeft: de
        /// bevroren stand kan van een eerdere pitstop zijn. De wire heeft één
        /// <c>observedAt</c>, dus de leeftijd gaat als noot mee in het bewijs in plaats
        /// van als verzonnen tweede tijdstip.
        /// </summary>
        private static string EvidenceNote(string note, DateTime? beforeAtUtc, DateTime afterAtUtc)
        {
            if (!beforeAtUtc.HasValue) return note;
            var age = (afterAtUtc - beforeAtUtc.Value).TotalSeconds;
            if (age < 0 || double.IsNaN(age)) return note;
            var ageText = "wear_before_age=" + Math.Round(age, 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + "s";
            if (string.IsNullOrEmpty(note)) return ageText;
            var text = note + "; " + ageText;
            return text.Length <= MeasurementContract.MaxEvidenceNoteLength
                ? text
                : text.Substring(0, MeasurementContract.MaxEvidenceNoteLength);
        }

        private static int ChangedCorners(WearReading before, WearReading after)
        {
            var changed = 0;
            for (var corner = 0; corner < 4; corner++)
                if (Math.Abs(after.Corner(corner) - before.Corner(corner)) > WearChangeThresholdPercent) changed++;
            return changed;
        }

        private static bool AnyCornerIncreased(WearReading before, WearReading after, out bool[] increased)
        {
            increased = new bool[4];
            var any = false;
            for (var corner = 0; corner < 4; corner++)
            {
                if (after.Corner(corner) - before.Corner(corner) > WearChangeThresholdPercent)
                {
                    increased[corner] = true;
                    any = true;
                }
            }
            return any;
        }
    }
}
