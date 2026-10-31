using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// De wire-vorm van één meetgebeurtenis, precies zoals
    /// <c>supabase/functions/_shared/simhubExtensions.ts → parseMeasurementEvent</c>
    /// hem leest. Geen enkel veld hier is bedacht: de namen, de eenheden en de
    /// verplichtingen komen uit docs/contracts/measurement-ids-v1.md (secties 1, 2,
    /// 4, 5 en 6) en uit de parser zelf.
    ///
    /// Optionele leden hebben <c>EmitDefaultValue=false</c>: een ontbrekend veld
    /// betekent voor de Edge hetzelfde als <c>null</c> ("niet bekend"), en het houdt
    /// de batch onder het bytebudget. <c>recordRevision</c> valt niet weg (default
    /// 0, wij sturen altijd ≥1).
    /// </summary>
    [DataContract]
    public sealed class MeasurementEventDto
    {
        [DataMember(Name = "eventUid", Order = 1)] public string EventUid { get; set; }
        [DataMember(Name = "eventId", Order = 2, EmitDefaultValue = false)] public string EventId { get; set; }
        [DataMember(Name = "kind", Order = 3)] public string Kind { get; set; }
        [DataMember(Name = "segmentId", Order = 4, EmitDefaultValue = false)] public string SegmentId { get; set; }
        [DataMember(Name = "pitVisitId", Order = 5, EmitDefaultValue = false)] public string PitVisitId { get; set; }
        [DataMember(Name = "observedSessionId", Order = 6, EmitDefaultValue = false)] public string ObservedSessionId { get; set; }
        [DataMember(Name = "observedAt", Order = 7, EmitDefaultValue = false)] public string ObservedAt { get; set; }
        [DataMember(Name = "sessionTimeSeconds", Order = 8, EmitDefaultValue = false)] public double? SessionTimeSeconds { get; set; }
        [DataMember(Name = "sdkTick", Order = 9, EmitDefaultValue = false)] public long? SdkTick { get; set; }
        [DataMember(Name = "wearBefore", Order = 10, EmitDefaultValue = false)] public MeasurementWearV1Dto WearBefore { get; set; }
        [DataMember(Name = "wearAfter", Order = 11, EmitDefaultValue = false)] public MeasurementWearV1Dto WearAfter { get; set; }
        [DataMember(Name = "setGeneration", Order = 12, EmitDefaultValue = false)] public MeasurementSetGenerationV1Dto SetGeneration { get; set; }
        [DataMember(Name = "evidence", Order = 13, EmitDefaultValue = false)] public MeasurementEvidenceV1Dto Evidence { get; set; }
        [DataMember(Name = "confidence", Order = 14, EmitDefaultValue = false)] public double? Confidence { get; set; }
        [DataMember(Name = "recordRevision", Order = 15)] public int RecordRevision { get; set; }
        [DataMember(Name = "supersedesEventUid", Order = 16, EmitDefaultValue = false)] public string SupersedesEventUid { get; set; }
    }

    /// <summary>
    /// <c>wear_v1</c>: het percentage band dat NOG OVER IS (0..100), met verplichte
    /// schaal. Zonder <c>scale</c> is "12" niet te onderscheiden van "12 procent
    /// versleten" en is een analyse achteraf niet meer te repareren.
    /// </summary>
    [DataContract]
    public sealed class MeasurementWearV1Dto
    {
        [DataMember(Name = "version", Order = 1)] public int Version { get; set; }
        [DataMember(Name = "scale", Order = 2)] public string Scale { get; set; }
        [DataMember(Name = "fl", Order = 3)] public double FrontLeft { get; set; }
        [DataMember(Name = "fr", Order = 4)] public double FrontRight { get; set; }
        [DataMember(Name = "rl", Order = 5)] public double RearLeft { get; set; }
        [DataMember(Name = "rr", Order = 6)] public double RearRight { get; set; }
    }

    /// <summary>Setgeneratie per hoek: vier integers 0..1000, geen halve set.</summary>
    [DataContract]
    public sealed class MeasurementSetGenerationV1Dto
    {
        [DataMember(Name = "version", Order = 1)] public int Version { get; set; }
        [DataMember(Name = "fl", Order = 2)] public int FrontLeft { get; set; }
        [DataMember(Name = "fr", Order = 3)] public int FrontRight { get; set; }
        [DataMember(Name = "rl", Order = 4)] public int RearLeft { get; set; }
        [DataMember(Name = "rr", Order = 5)] public int RearRight { get; set; }
    }

    /// <summary>
    /// <c>evidence_v1</c>: welke kanalen zijn gebruikt. Niet "er was bewijs", maar
    /// de namen zelf — anders is een confidence-getal niet te controleren.
    /// </summary>
    [DataContract]
    public sealed class MeasurementEvidenceV1Dto
    {
        [DataMember(Name = "version", Order = 1)] public int Version { get; set; }
        [DataMember(Name = "source", Order = 2)] public string Source { get; set; }
        [DataMember(Name = "channels", Order = 3)] public string[] Channels { get; set; }
        [DataMember(Name = "note", Order = 4, EmitDefaultValue = false)] public string Note { get; set; }
    }

    /// <summary>Dekking van één metriekgroep; dezelfde drie velden voor elke groep.</summary>
    [DataContract]
    public sealed class MeasurementCoverageGroupDto
    {
        [DataMember(Name = "validDurationSeconds", Order = 1)] public double ValidDurationSeconds { get; set; }
        [DataMember(Name = "sampleCount", Order = 2)] public int SampleCount { get; set; }
        [DataMember(Name = "maxGapSeconds", Order = 3)] public double MaxGapSeconds { get; set; }
    }

    /// <summary>
    /// Dekking per groep, want temperatuur, brandstof en belasting kunnen
    /// onafhankelijk ontbreken. Alleen gevulde groepen gaan mee.
    /// </summary>
    [DataContract]
    public sealed class MeasurementLapCoverageDto
    {
        [DataMember(Name = "temperature", Order = 1, EmitDefaultValue = false)] public MeasurementCoverageGroupDto Temperature { get; set; }
        [DataMember(Name = "fuel", Order = 2, EmitDefaultValue = false)] public MeasurementCoverageGroupDto Fuel { get; set; }
        [DataMember(Name = "load", Order = 3, EmitDefaultValue = false)] public MeasurementCoverageGroupDto Load { get; set; }
    }

    /// <summary>
    /// De wire-vorm van één rondeaggregaat, precies zoals
    /// <c>simhubExtensions.ts → parseLapSummary</c> hem leest. <c>currentDriverId</c>
    /// staat er bewust NIET in: de server resolveert <c>currentDriverName</c> en
    /// weigert een client-ID.
    /// </summary>
    [DataContract]
    public sealed class MeasurementLapSummaryDto
    {
        [DataMember(Name = "summaryUid", Order = 1)] public string SummaryUid { get; set; }
        [DataMember(Name = "summaryId", Order = 2, EmitDefaultValue = false)] public string SummaryId { get; set; }
        [DataMember(Name = "segmentId", Order = 3, EmitDefaultValue = false)] public string SegmentId { get; set; }
        [DataMember(Name = "observedSessionId", Order = 4, EmitDefaultValue = false)] public string ObservedSessionId { get; set; }
        [DataMember(Name = "lapNumber", Order = 5)] public int LapNumber { get; set; }
        [DataMember(Name = "startedAt", Order = 6, EmitDefaultValue = false)] public string StartedAt { get; set; }
        [DataMember(Name = "endedAt", Order = 7, EmitDefaultValue = false)] public string EndedAt { get; set; }
        [DataMember(Name = "currentDriverName", Order = 8, EmitDefaultValue = false)] public string CurrentDriverName { get; set; }
        [DataMember(Name = "aggregationVersion", Order = 9)] public int AggregationVersion { get; set; }
        [DataMember(Name = "recordRevision", Order = 10)] public int RecordRevision { get; set; }
        [DataMember(Name = "supersedesSummaryUid", Order = 11, EmitDefaultValue = false)] public string SupersedesSummaryUid { get; set; }
        [DataMember(Name = "complete", Order = 12, EmitDefaultValue = false)] public bool? Complete { get; set; }
        [DataMember(Name = "invalidReasons", Order = 13, EmitDefaultValue = false)] public string[] InvalidReasons { get; set; }
        [DataMember(Name = "pitLap", Order = 14, EmitDefaultValue = false)] public bool? PitLap { get; set; }
        [DataMember(Name = "driverChanged", Order = 15, EmitDefaultValue = false)] public bool? DriverChanged { get; set; }
        [DataMember(Name = "trackTempCMean", Order = 16, EmitDefaultValue = false)] public double? TrackTempCMean { get; set; }
        [DataMember(Name = "trackTempCMin", Order = 17, EmitDefaultValue = false)] public double? TrackTempCMin { get; set; }
        [DataMember(Name = "trackTempCMax", Order = 18, EmitDefaultValue = false)] public double? TrackTempCMax { get; set; }
        [DataMember(Name = "airTempCMean", Order = 19, EmitDefaultValue = false)] public double? AirTempCMean { get; set; }
        [DataMember(Name = "fuelStartLitres", Order = 20, EmitDefaultValue = false)] public double? FuelStartLitres { get; set; }
        [DataMember(Name = "fuelEndLitres", Order = 21, EmitDefaultValue = false)] public double? FuelEndLitres { get; set; }
        [DataMember(Name = "fuelLevelIntegralLitreSeconds", Order = 22, EmitDefaultValue = false)] public double? FuelLevelIntegralLitreSeconds { get; set; }
        [DataMember(Name = "fuelAddedLitresObserved", Order = 23, EmitDefaultValue = false)] public double? FuelAddedLitresObserved { get; set; }
        [DataMember(Name = "absLatAccelIntegralGSeconds", Order = 24, EmitDefaultValue = false)] public double? AbsLatAccelIntegralGSeconds { get; set; }
        [DataMember(Name = "latAccelSquaredIntegralG2Seconds", Order = 25, EmitDefaultValue = false)] public double? LatAccelSquaredIntegralG2Seconds { get; set; }
        [DataMember(Name = "maxAbsLatAccelG", Order = 26, EmitDefaultValue = false)] public double? MaxAbsLatAccelG { get; set; }
        [DataMember(Name = "absLongAccelIntegralGSeconds", Order = 27, EmitDefaultValue = false)] public double? AbsLongAccelIntegralGSeconds { get; set; }
        [DataMember(Name = "coverage", Order = 28, EmitDefaultValue = false)] public MeasurementLapCoverageDto Coverage { get; set; }
        [DataMember(Name = "sampleCount", Order = 29, EmitDefaultValue = false)] public int? SampleCount { get; set; }
        [DataMember(Name = "maxGapSeconds", Order = 30, EmitDefaultValue = false)] public double? MaxGapSeconds { get; set; }
        [DataMember(Name = "validDurationSeconds", Order = 31, EmitDefaultValue = false)] public double? ValidDurationSeconds { get; set; }
        [DataMember(Name = "pitVisitIds", Order = 32, EmitDefaultValue = false)] public string[] PitVisitIds { get; set; }
        [DataMember(Name = "wearObservationIds", Order = 33, EmitDefaultValue = false)] public string[] WearObservationIds { get; set; }
    }

    /// <summary>
    /// De vaste getallen van het contract. Ze staan hier bij elkaar omdat de
    /// plugin ze moet toepassen vóór verzending: een rij die de Edge zeker zal
    /// weigeren hoeft de outbox niet in.
    /// </summary>
    public static class MeasurementContract
    {
        public const int WearVersion = 1;
        public const string WearScale = "remaining_percent";
        public const int EvidenceVersion = 1;
        public const int SetGenerationVersion = 1;
        /// <summary>Versie van het aggregatie-algoritme, niet van de waarneming.</summary>
        public const int AggregationVersion = 1;
        /// <summary>Schemarevisie van het frame; protocolVersion blijft 3.</summary>
        public const int SchemaRevision = 1;
        /// <summary>Revisie van het capabilities-blok.</summary>
        public const int CapabilitiesRevision = 1;
        public const int MaxWearPercent = 100;
        public const int MaxSetGeneration = 1000;
        public const int MaxRecordRevision = 100000;
        public const double MaxSessionTimeSeconds = 604800;
        public const int MaxEvidenceNoteLength = 200;
        public const int MaxEvidenceChannels = 8;
        public const int MaxInvalidReasons = 16;
    }

    /// <summary>
    /// De vier hoeken als één wear-lezing in procenten rest. Volgorde is
    /// [FL, FR, RL, RR], dezelfde als het bestaande bandenblok.
    /// </summary>
    public sealed class WearReading
    {
        public WearReading(double frontLeft, double frontRight, double rearLeft, double rearRight)
        {
            FrontLeft = frontLeft;
            FrontRight = frontRight;
            RearLeft = rearLeft;
            RearRight = rearRight;
        }

        public double FrontLeft { get; private set; }
        public double FrontRight { get; private set; }
        public double RearLeft { get; private set; }
        public double RearRight { get; private set; }

        public double Corner(int index)
        {
            switch (index)
            {
                case 0: return FrontLeft;
                case 1: return FrontRight;
                case 2: return RearLeft;
                case 3: return RearRight;
                default: throw new ArgumentOutOfRangeException("index");
            }
        }

        public bool IsValid
        {
            get
            {
                for (var corner = 0; corner < 4; corner++)
                {
                    var value = Corner(corner);
                    if (double.IsNaN(value) || double.IsInfinity(value)) return false;
                    if (value < 0 || value > MeasurementContract.MaxWearPercent) return false;
                }
                return true;
            }
        }

        public MeasurementWearV1Dto ToDto()
        {
            return new MeasurementWearV1Dto
            {
                Version = MeasurementContract.WearVersion,
                Scale = MeasurementContract.WearScale,
                FrontLeft = Round(FrontLeft),
                FrontRight = Round(FrontRight),
                RearLeft = Round(RearLeft),
                RearRight = Round(RearRight)
            };
        }

        /// <summary>Kopie met een nieuwe waarde voor één hoek; gebruikt door de ankerdetectie.</summary>
        public WearReading WithCorner(int index, double value)
        {
            var values = new[] { FrontLeft, FrontRight, RearLeft, RearRight };
            values[index] = value;
            return new WearReading(values[0], values[1], values[2], values[3]);
        }

        internal static double Round(double value)
        {
            // Drie decimalen op honderd procent: fijner dan de bron kan leveren en
            // toch compact op de draad.
            return Math.Round(value, 3, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>Setgeneratie per hoek, met een eigen teller per hoek.</summary>
    public sealed class SetGenerationReading
    {
        private readonly int[] _corners;

        public SetGenerationReading()
        {
            _corners = new int[4];
        }

        private SetGenerationReading(int[] corners)
        {
            _corners = corners;
        }

        public int Corner(int index) { return _corners[index]; }

        /// <summary>Verhoogt één hoek, begrensd op het contractmaximum.</summary>
        public void Increment(int index)
        {
            if (_corners[index] < MeasurementContract.MaxSetGeneration) _corners[index]++;
        }

        public SetGenerationReading Clone() { return new SetGenerationReading((int[])_corners.Clone()); }

        public MeasurementSetGenerationV1Dto ToDto()
        {
            return new MeasurementSetGenerationV1Dto
            {
                Version = MeasurementContract.SetGenerationVersion,
                FrontLeft = _corners[0],
                FrontRight = _corners[1],
                RearLeft = _corners[2],
                RearRight = _corners[3]
            };
        }
    }

    /// <summary>Bewijsgrond bij een anker: bron plus de gebruikte kanalen.</summary>
    public sealed class TyreEvidence
    {
        public TyreEvidence(string source, string[] channels, string note)
        {
            Source = source;
            Channels = channels ?? new string[0];
            Note = note;
        }

        public string Source { get; private set; }
        public string[] Channels { get; private set; }
        public string Note { get; private set; }

        public MeasurementEvidenceV1Dto ToDto()
        {
            return new MeasurementEvidenceV1Dto
            {
                Version = MeasurementContract.EvidenceVersion,
                Source = MeasurementIds.SanitizeLocalId(Source, "unknown"),
                Channels = Channels,
                Note = Trim(Note)
            };
        }

        private static string Trim(string note)
        {
            if (string.IsNullOrEmpty(note)) return null;
            var text = note.Trim();
            if (text.Length == 0) return null;
            return text.Length <= MeasurementContract.MaxEvidenceNoteLength
                ? text
                : text.Substring(0, MeasurementContract.MaxEvidenceNoteLength);
        }
    }

    /// <summary>
    /// Eén meetgebeurtenis met een duurzame identiteit. Deze klasse is de bron van
    /// waarheid voor de outbox: <see cref="EventUid"/> wordt hier één keer gezet en
    /// daarna nooit meer gewijzigd, ook niet bij een herverzending of een herstart.
    /// </summary>
    public sealed class MeasurementEventRecord
    {
        public string EventUid { get; set; }
        public string EventId { get; set; }
        public string Kind { get; set; }
        public string SegmentId { get; set; }
        public string PitVisitId { get; set; }
        public string ObservedSessionId { get; set; }
        public DateTime ObservedAtUtc { get; set; }
        public double? SessionTimeSeconds { get; set; }
        public long? SdkTick { get; set; }
        public WearReading WearBefore { get; set; }
        public WearReading WearAfter { get; set; }
        // De eigen waarnemingstijden van vóór en ná. Ze staan NIET op de draad (het
        // event heeft één observedAt); ze bepalen hier de ouderdom en de confidence.
        // De leeftijd van de "voor"-waarde gaat als feitelijke noot mee in evidence.
        public DateTime? WearBeforeObservedAtUtc { get; set; }
        public DateTime? WearAfterObservedAtUtc { get; set; }
        public long? WearBeforeSdkTick { get; set; }
        public long? WearAfterSdkTick { get; set; }
        public SetGenerationReading SetGeneration { get; set; }
        public TyreEvidence Evidence { get; set; }
        public double? Confidence { get; set; }
        public int RecordRevision { get; set; }
        public string SupersedesEventUid { get; set; }

        public MeasurementEventRecord()
        {
            RecordRevision = 1;
        }

        public MeasurementEventDto ToDto()
        {
            var dto = new MeasurementEventDto
            {
                EventUid = EventUid,
                EventId = MeasurementIds.IsLocalId(EventId) ? EventId : null,
                Kind = Kind,
                SegmentId = MeasurementIds.IsLocalId(SegmentId) ? SegmentId : null,
                PitVisitId = MeasurementIds.IsLocalId(PitVisitId) ? PitVisitId : null,
                ObservedSessionId = MeasurementIds.SanitizeObservedSessionId(ObservedSessionId),
                ObservedAt = MeasurementTime.Format(ObservedAtUtc),
                SessionTimeSeconds = SessionTimeSeconds,
                SdkTick = SdkTick,
                WearBefore = WearBefore == null ? null : WearBefore.ToDto(),
                WearAfter = WearAfter == null ? null : WearAfter.ToDto(),
                SetGeneration = SetGeneration == null ? null : SetGeneration.ToDto(),
                RecordRevision = RecordRevision < 1 ? 1 : RecordRevision,
                SupersedesEventUid = MeasurementIds.IsUid(SupersedesEventUid) ? SupersedesEventUid : null
            };
            if (Evidence != null) dto.Evidence = Evidence.ToDto();
            // Een wear-waarneming zonder bewijs of confidence is volgens het contract
            // geen waarneming. We sturen hem dan ook niet: validatie weigert hem eerst.
            if (dto.WearBefore != null || dto.WearAfter != null)
            {
                dto.Confidence = Confidence;
            }
            return dto;
        }

        public string ToJson()
        {
            return MeasurementJson.Serialize(ToDto());
        }

        /// <summary>
        /// Zelfcontrole tegen de Edge-regels. Een rij die hier niet door komt gaat de
        /// outbox niet in; dat is expliciet verlies met een reden, geen stille drop.
        /// </summary>
        public IList<string> Validate()
        {
            var problems = new List<string>();
            if (!MeasurementIds.IsUid(EventUid)) problems.Add("event_uid_invalid");
            if (!string.IsNullOrEmpty(EventId) && !MeasurementIds.IsLocalId(EventId)) problems.Add("event_id_invalid");
            if (string.IsNullOrEmpty(Kind) || !MeasurementIds.IsLocalId(Kind)) problems.Add("kind_invalid");
            if (!string.IsNullOrEmpty(PitVisitId) && !MeasurementIds.IsLocalId(PitVisitId)) problems.Add("pit_visit_id_invalid");
            if (!string.IsNullOrEmpty(SegmentId) && !MeasurementIds.IsLocalId(SegmentId)) problems.Add("segment_id_invalid");
            if (ObservedAtUtc == default(DateTime)) problems.Add("observed_at_missing");
            if (SessionTimeSeconds.HasValue && (SessionTimeSeconds.Value < 0 || SessionTimeSeconds.Value > MeasurementContract.MaxSessionTimeSeconds))
                problems.Add("session_time_out_of_range");
            if (SdkTick.HasValue && SdkTick.Value < 0) problems.Add("sdk_tick_invalid");
            if (WearBefore != null && !WearBefore.IsValid) problems.Add("wear_before_out_of_range");
            if (WearAfter != null && !WearAfter.IsValid) problems.Add("wear_after_out_of_range");
            var hasWear = WearBefore != null || WearAfter != null;
            if (hasWear && Evidence == null) problems.Add("evidence_missing");
            if (hasWear && !Confidence.HasValue) problems.Add("confidence_missing");
            if (Confidence.HasValue && (Confidence.Value < 0 || Confidence.Value > 1)) problems.Add("confidence_out_of_range");
            if (hasWear && Evidence != null)
            {
                if (string.IsNullOrEmpty(Evidence.Source) || !MeasurementIds.IsLocalId(Evidence.Source)) problems.Add("evidence_source_invalid");
                if (Evidence.Channels == null || Evidence.Channels.Length < 1 || Evidence.Channels.Length > MeasurementContract.MaxEvidenceChannels)
                    problems.Add("evidence_channels_invalid");
                else
                {
                    for (var index = 0; index < Evidence.Channels.Length; index++)
                        if (!MeasurementIds.IsLocalId(Evidence.Channels[index])) problems.Add("evidence_channel_invalid");
                }
            }
            if (RecordRevision < 1 || RecordRevision > MeasurementContract.MaxRecordRevision) problems.Add("record_revision_invalid");
            if (!string.IsNullOrEmpty(SupersedesEventUid) && !MeasurementIds.IsUid(SupersedesEventUid)) problems.Add("supersedes_invalid");
            return problems;
        }
    }

    /// <summary>
    /// Eén rondeaggregaat met een duurzame identiteit. <see cref="SummaryUid"/> wordt
    /// één keer gezet (bij het sluiten van de ronde) en daarna hergebruikt.
    /// </summary>
    public sealed class MeasurementLapSummaryRecord
    {
        public string SummaryUid { get; set; }
        public string SummaryId { get; set; }
        public string SegmentId { get; set; }
        public string ObservedSessionId { get; set; }
        public int LapNumber { get; set; }
        public DateTime? StartedAtUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }
        public string CurrentDriverName { get; set; }
        public int AggregationVersion { get; set; }
        public int RecordRevision { get; set; }
        public string SupersedesSummaryUid { get; set; }
        public bool? Complete { get; set; }
        public string[] InvalidReasons { get; set; }
        public bool? PitLap { get; set; }
        public bool? DriverChanged { get; set; }
        public double? TrackTempCMean { get; set; }
        public double? TrackTempCMin { get; set; }
        public double? TrackTempCMax { get; set; }
        public double? AirTempCMean { get; set; }
        public double? FuelStartLitres { get; set; }
        public double? FuelEndLitres { get; set; }
        public double? FuelLevelIntegralLitreSeconds { get; set; }
        public double? FuelAddedLitresObserved { get; set; }
        public double? AbsLatAccelIntegralGSeconds { get; set; }
        public double? LatAccelSquaredIntegralG2Seconds { get; set; }
        public double? MaxAbsLatAccelG { get; set; }
        public double? AbsLongAccelIntegralGSeconds { get; set; }
        public MeasurementLapCoverageDto Coverage { get; set; }
        public int? SampleCount { get; set; }
        public double? MaxGapSeconds { get; set; }
        public double? ValidDurationSeconds { get; set; }
        public string[] PitVisitIds { get; set; }
        public string[] WearObservationIds { get; set; }

        public MeasurementLapSummaryRecord()
        {
            AggregationVersion = MeasurementContract.AggregationVersion;
            RecordRevision = 1;
        }

        public MeasurementLapSummaryDto ToDto()
        {
            // Een rijderwissel binnen de ronde en tóch één naam is tegenstrijdig: het
            // contract weigert dat. Bij een wissel sturen we dus geen naam; de wissel
            // zelf blijft zichtbaar in driverChanged.
            var driverChanged = DriverChanged;
            var driverName = driverChanged == true ? null : CleanDriverName(CurrentDriverName);
            return new MeasurementLapSummaryDto
            {
                SummaryUid = SummaryUid,
                SummaryId = MeasurementIds.IsLocalId(SummaryId) ? SummaryId : null,
                SegmentId = MeasurementIds.IsLocalId(SegmentId) ? SegmentId : null,
                ObservedSessionId = MeasurementIds.SanitizeObservedSessionId(ObservedSessionId),
                LapNumber = LapNumber,
                StartedAt = MeasurementTime.Format(StartedAtUtc),
                EndedAt = MeasurementTime.Format(EndedAtUtc),
                CurrentDriverName = driverName,
                AggregationVersion = AggregationVersion < 1 ? 1 : AggregationVersion,
                RecordRevision = RecordRevision < 1 ? 1 : RecordRevision,
                SupersedesSummaryUid = MeasurementIds.IsUid(SupersedesSummaryUid) ? SupersedesSummaryUid : null,
                Complete = Complete,
                InvalidReasons = InvalidReasons == null || InvalidReasons.Length == 0
                    ? null
                    : InvalidReasons.Length <= MeasurementContract.MaxInvalidReasons
                        ? InvalidReasons
                        : Truncate(InvalidReasons),
                PitLap = PitLap,
                DriverChanged = driverChanged,
                TrackTempCMean = R(TrackTempCMean),
                TrackTempCMin = R(TrackTempCMin),
                TrackTempCMax = R(TrackTempCMax),
                AirTempCMean = R(AirTempCMean),
                FuelStartLitres = R(FuelStartLitres),
                FuelEndLitres = R(FuelEndLitres),
                FuelLevelIntegralLitreSeconds = R(FuelLevelIntegralLitreSeconds),
                FuelAddedLitresObserved = R(FuelAddedLitresObserved),
                AbsLatAccelIntegralGSeconds = R(AbsLatAccelIntegralGSeconds),
                LatAccelSquaredIntegralG2Seconds = R(LatAccelSquaredIntegralG2Seconds),
                MaxAbsLatAccelG = R(MaxAbsLatAccelG),
                AbsLongAccelIntegralGSeconds = R(AbsLongAccelIntegralGSeconds),
                Coverage = Coverage,
                SampleCount = SampleCount,
                MaxGapSeconds = R(MaxGapSeconds),
                ValidDurationSeconds = R(ValidDurationSeconds),
                PitVisitIds = Ids(PitVisitIds),
                WearObservationIds = Ids(WearObservationIds)
            };
        }

        public string ToJson()
        {
            return MeasurementJson.Serialize(ToDto());
        }

        /// <summary>Zelfcontrole tegen de Edge-regels (dekking, bereik, tegenstrijdigheid).</summary>
        public IList<string> Validate()
        {
            var problems = new List<string>();
            if (!MeasurementIds.IsUid(SummaryUid)) problems.Add("summary_uid_invalid");
            if (!string.IsNullOrEmpty(SummaryId) && !MeasurementIds.IsLocalId(SummaryId)) problems.Add("summary_id_invalid");
            if (!string.IsNullOrEmpty(SegmentId) && !MeasurementIds.IsLocalId(SegmentId)) problems.Add("segment_id_invalid");
            if (LapNumber < 0) problems.Add("lap_number_invalid");
            if (StartedAtUtc.HasValue && EndedAtUtc.HasValue && EndedAtUtc.Value < StartedAtUtc.Value) problems.Add("ended_before_started");
            if (DriverChanged == true && !string.IsNullOrEmpty(CurrentDriverName)) problems.Add("driver_changed_with_driver");
            if (TrackTempCMin.HasValue && TrackTempCMax.HasValue && TrackTempCMax.Value < TrackTempCMin.Value) problems.Add("track_temp_max_below_min");

            var hasTemperature = TrackTempCMean.HasValue || TrackTempCMin.HasValue || TrackTempCMax.HasValue || AirTempCMean.HasValue;
            var hasFuel = FuelLevelIntegralLitreSeconds.HasValue || FuelAddedLitresObserved.HasValue;
            var hasLoad = AbsLatAccelIntegralGSeconds.HasValue || LatAccelSquaredIntegralG2Seconds.HasValue
                || MaxAbsLatAccelG.HasValue || AbsLongAccelIntegralGSeconds.HasValue;
            if (hasTemperature && !CoverageRules.Has(Coverage, CoverageRules.GroupTemperature)) problems.Add("coverage_missing:temperature");
            if (hasFuel && !CoverageRules.Has(Coverage, CoverageRules.GroupFuel)) problems.Add("coverage_missing:fuel");
            if (hasLoad && !CoverageRules.Has(Coverage, CoverageRules.GroupLoad)) problems.Add("coverage_missing:load");
            if (Complete == true)
            {
                var verdict = CoverageRules.Evaluate(Coverage, StartedAtUtc, EndedAtUtc);
                if (!verdict.Complete) problems.Add("complete_without_coverage");
            }
            if (FuelStartLitres.HasValue && (FuelStartLitres.Value < 0 || FuelStartLitres.Value > 300)) problems.Add("fuel_start_out_of_range");
            if (FuelEndLitres.HasValue && (FuelEndLitres.Value < 0 || FuelEndLitres.Value > 300)) problems.Add("fuel_end_out_of_range");
            if (FuelLevelIntegralLitreSeconds.HasValue && FuelLevelIntegralLitreSeconds.Value < 0) problems.Add("fuel_integral_negative");
            if (AbsLatAccelIntegralGSeconds.HasValue && AbsLatAccelIntegralGSeconds.Value < 0) problems.Add("lat_integral_negative");
            if (LatAccelSquaredIntegralG2Seconds.HasValue && LatAccelSquaredIntegralG2Seconds.Value < 0) problems.Add("lat_squared_integral_negative");
            if (AbsLongAccelIntegralGSeconds.HasValue && AbsLongAccelIntegralGSeconds.Value < 0) problems.Add("long_integral_negative");
            if (MaxAbsLatAccelG.HasValue && (MaxAbsLatAccelG.Value < 0 || MaxAbsLatAccelG.Value > 10)) problems.Add("max_lat_out_of_range");
            if (PitVisitIds != null && PitVisitIds.Length > 32) problems.Add("pit_visit_ids_too_many");
            if (WearObservationIds != null && WearObservationIds.Length > 64) problems.Add("wear_observation_ids_too_many");
            return problems;
        }

        private static string[] Truncate(string[] values)
        {
            var copy = new string[MeasurementContract.MaxInvalidReasons];
            Array.Copy(values, copy, copy.Length);
            return copy;
        }

        private static string[] Ids(string[] values)
        {
            if (values == null || values.Length == 0) return null;
            var list = new List<string>(values.Length);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in values)
            {
                if (!MeasurementIds.IsLocalId(value)) continue;
                if (!seen.Add(value)) continue;
                list.Add(value);
            }
            return list.Count == 0 ? null : list.ToArray();
        }

        private static string CleanDriverName(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var text = value.Trim();
            if (text.Length > 64) text = text.Substring(0, 64);
            for (var index = 0; index < text.Length; index++)
            {
                var character = text[index];
                if (character < ' ' || character == '\u007f') return null;
            }
            return text.Length == 0 ? null : text;
        }

        private static double? R(double? value)
        {
            if (!value.HasValue) return null;
            var number = value.Value;
            if (double.IsNaN(number) || double.IsInfinity(number)) return null;
            return Math.Round(number, 4, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>
    /// De dekkinsregels, letterlijk dezelfde als
    /// <c>simhubExtensions.ts → coverageVerdict</c>. De plugin past ze toe vóór
    /// verzending, zodat "complete: true" ook echt iets betekent en niet pas op de
    /// server naar false wordt teruggezet.
    /// </summary>
    public static class CoverageRules
    {
        public const string GroupTemperature = "temperature";
        public const string GroupFuel = "fuel";
        public const string GroupLoad = "load";
        public const int MinSamplesPerGroup = 10;
        public const double MaxGapSeconds = 2.0;
        public const double MinCoveredFraction = 0.8;
        public const double MaxCoverageSeconds = 86400.0;

        public static readonly string[] Groups = { GroupTemperature, GroupFuel, GroupLoad };

        /// <summary>Is deze groep gedekt? Samples én een positieve meetduur.</summary>
        public static bool Has(MeasurementLapCoverageDto coverage, string group)
        {
            var entry = Group(coverage, group);
            return entry != null && entry.SampleCount > 0 && entry.ValidDurationSeconds > 0;
        }

        public static MeasurementCoverageGroupDto Group(MeasurementLapCoverageDto coverage, string group)
        {
            if (coverage == null) return null;
            switch (group)
            {
                case GroupTemperature: return coverage.Temperature;
                case GroupFuel: return coverage.Fuel;
                case GroupLoad: return coverage.Load;
                default: return null;
            }
        }

        /// <summary>Som van de groepsduur; de vlakke kolom is een afgeleide, geen eigen meting.</summary>
        public static int TotalSamples(MeasurementLapCoverageDto coverage)
        {
            var total = 0;
            foreach (var group in Groups)
            {
                var entry = Group(coverage, group);
                if (entry != null) total += entry.SampleCount;
            }
            return total;
        }

        public static double MaxGap(MeasurementLapCoverageDto coverage)
        {
            var max = 0.0;
            foreach (var group in Groups)
            {
                var entry = Group(coverage, group);
                if (entry != null && entry.MaxGapSeconds > max) max = entry.MaxGapSeconds;
            }
            return max;
        }

        public static double MaxDuration(MeasurementLapCoverageDto coverage)
        {
            var max = 0.0;
            foreach (var group in Groups)
            {
                var entry = Group(coverage, group);
                if (entry != null && entry.ValidDurationSeconds > max) max = entry.ValidDurationSeconds;
            }
            return max;
        }

        public sealed class Verdict
        {
            public bool Complete { get; set; }
            public string[] Reasons { get; set; }
        }

        public static Verdict Evaluate(MeasurementLapCoverageDto coverage, DateTime? startedAtUtc, DateTime? endedAtUtc)
        {
            var reasons = new List<string>();
            var windowSeconds = double.NaN;
            if (startedAtUtc.HasValue && endedAtUtc.HasValue)
            {
                windowSeconds = (endedAtUtc.Value - startedAtUtc.Value).TotalSeconds;
            }
            if (double.IsNaN(windowSeconds) || windowSeconds <= 0) reasons.Add("coverage_window_missing");

            var covered = 0.0;
            foreach (var group in Groups)
            {
                var entry = Group(coverage, group);
                if (entry == null)
                {
                    reasons.Add("coverage_missing:" + group);
                    continue;
                }
                if (entry.SampleCount < MinSamplesPerGroup) reasons.Add("coverage_samples:" + group);
                if (entry.MaxGapSeconds > MaxGapSeconds) reasons.Add("coverage_gap:" + group);
                if (entry.ValidDurationSeconds <= 0) reasons.Add("coverage_duration:" + group);
                covered += entry.ValidDurationSeconds;
            }
            if (!double.IsNaN(windowSeconds) && windowSeconds > 0
                && covered < windowSeconds * MinCoveredFraction - 1e-6)
            {
                reasons.Add("coverage_duration:window");
            }
            return new Verdict
            {
                Complete = reasons.Count == 0,
                Reasons = Distinct(reasons).ToArray()
            };
        }

        private static List<string> Distinct(List<string> values)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var result = new List<string>(values.Count);
            foreach (var value in values)
            {
                if (seen.Add(value)) result.Add(value);
            }
            return result;
        }
    }

    /// <summary>
    /// Één plek voor het serialiseren van meetrijen. De outbox bewaart de
    /// geserialiseerde rij letterlijk, zodat een herverzending na een herstart
    /// byte-voor-byte dezelfde inhoud heeft en het bytebudget exact te meten is.
    /// </summary>
    public static class MeasurementJson
    {
        public static string Serialize<T>(T value)
        {
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        public static T Deserialize<T>(string json)
        {
            if (string.IsNullOrEmpty(json)) return default(T);
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                return (T)serializer.ReadObject(stream);
            }
        }

        /// <summary>
        /// Leest JSON als woordenboek met eigen code in plaats van met
        /// <c>DataContractJsonSerializer</c>. Reden: die serializer levert voor een
        /// genest object soms een kale <c>object</c> zonder leden, waardoor een ACK met
        /// een geneste <c>measurements</c>-structuur stil als "geen bevestiging" zou
        /// worden gelezen. Een parser van honderd regels is hier voorspelbaar, werkt op
        /// net48 en net8 en kan niet stil data laten vallen.
        ///
        /// Vorm: Dictionary&lt;string, object&gt;, List&lt;object&gt;, string, double, bool, null.
        /// </summary>
        public static Dictionary<string, object> DeserializeDictionary(string json)
        {
            if (json == null) throw new ArgumentNullException("json");
            var reader = new JsonReader(json, 0);
            var value = reader.ReadValue(0) as Dictionary<string, object>;
            if (value == null) throw new FormatException("json is geen object");
            return value;
        }

        private sealed class JsonReader
        {
            private readonly string _text;
            private int _index;
            private const int MaxDepth = 32;

            public JsonReader(string text, int index)
            {
                _text = text;
                _index = index;
            }

            public object ReadValue(int depth)
            {
                if (depth > MaxDepth) throw new FormatException("json te diep genest");
                SkipWhitespace();
                if (_index >= _text.Length) throw new FormatException("onverwacht einde");
                var character = _text[_index];
                switch (character)
                {
                    case '{': return ReadObject(depth);
                    case '[': return ReadArray(depth);
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default: return ReadNumber();
                }
            }

            private Dictionary<string, object> ReadObject(int depth)
            {
                var result = new Dictionary<string, object>(StringComparer.Ordinal);
                _index++; // {
                SkipWhitespace();
                if (_index < _text.Length && _text[_index] == '}') { _index++; return result; }
                while (true)
                {
                    SkipWhitespace();
                    if (_index >= _text.Length || _text[_index] != '"') throw new FormatException("sleutel verwacht");
                    var key = ReadString();
                    SkipWhitespace();
                    if (_index >= _text.Length || _text[_index] != ':') throw new FormatException(": verwacht");
                    _index++;
                    result[key] = ReadValue(depth + 1);
                    SkipWhitespace();
                    if (_index >= _text.Length) throw new FormatException("} verwacht");
                    var separator = _text[_index];
                    if (separator == ',') { _index++; continue; }
                    if (separator == '}') { _index++; return result; }
                    throw new FormatException(", of } verwacht");
                }
            }

            private List<object> ReadArray(int depth)
            {
                var result = new List<object>();
                _index++; // [
                SkipWhitespace();
                if (_index < _text.Length && _text[_index] == ']') { _index++; return result; }
                while (true)
                {
                    result.Add(ReadValue(depth + 1));
                    SkipWhitespace();
                    if (_index >= _text.Length) throw new FormatException("] verwacht");
                    var separator = _text[_index];
                    if (separator == ',') { _index++; continue; }
                    if (separator == ']') { _index++; return result; }
                    throw new FormatException(", of ] verwacht");
                }
            }

            private string ReadString()
            {
                _index++; // "
                var builder = new StringBuilder();
                while (_index < _text.Length)
                {
                    var character = _text[_index++];
                    if (character == '"') return builder.ToString();
                    if (character != '\\') { builder.Append(character); continue; }
                    if (_index >= _text.Length) throw new FormatException("escape onvolledig");
                    var escape = _text[_index++];
                    switch (escape)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (_index + 4 > _text.Length) throw new FormatException("unicode onvolledig");
                            var hex = _text.Substring(_index, 4);
                            int code;
                            if (!int.TryParse(hex, System.Globalization.NumberStyles.HexNumber,
                                System.Globalization.CultureInfo.InvariantCulture, out code))
                                throw new FormatException("unicode ongeldig");
                            builder.Append((char)code);
                            _index += 4;
                            break;
                        default: throw new FormatException("escape onbekend");
                    }
                }
                throw new FormatException("string niet afgesloten");
            }

            private object ReadNumber()
            {
                var start = _index;
                while (_index < _text.Length)
                {
                    var character = _text[_index];
                    var numeric = (character >= '0' && character <= '9') || character == '-' || character == '+'
                        || character == '.' || character == 'e' || character == 'E';
                    if (!numeric) break;
                    _index++;
                }
                if (start == _index) throw new FormatException("getal verwacht");
                var text = _text.Substring(start, _index - start);
                double parsed;
                if (!double.TryParse(text, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out parsed))
                {
                    throw new FormatException("getal ongeldig");
                }
                return parsed;
            }

            private void Expect(string literal)
            {
                if (_index + literal.Length > _text.Length
                    || string.CompareOrdinal(_text, _index, literal, 0, literal.Length) != 0)
                {
                    throw new FormatException(literal + " verwacht");
                }
                _index += literal.Length;
            }

            private void SkipWhitespace()
            {
                while (_index < _text.Length)
                {
                    var character = _text[_index];
                    if (character != ' ' && character != '\t' && character != '\r' && character != '\n') return;
                    _index++;
                }
            }
        }

        public static int Bytes(string json)
        {
            return string.IsNullOrEmpty(json) ? 0 : Encoding.UTF8.GetByteCount(json);
        }

        /// <summary>
        /// Bouwt de twee reeksen als één compact JSON-object. De volgorde en de
        /// sleutelnamen zijn die van <c>measurementBatchBytes</c> in
        /// simhubExtensions.ts, zodat onze bytecontrole dezelfde maat gebruikt als
        /// de Edge.
        /// </summary>
        public static string Batch(IList<string> eventRows, IList<string> lapRows)
        {
            var builder = new StringBuilder(1024);
            builder.Append("{\"measurementEvents\":[");
            AppendRows(builder, eventRows);
            builder.Append("],\"lapSummaries\":[");
            AppendRows(builder, lapRows);
            builder.Append("]}");
            return builder.ToString();
        }

        private static void AppendRows(StringBuilder builder, IList<string> rows)
        {
            if (rows == null) return;
            for (var index = 0; index < rows.Count; index++)
            {
                if (index > 0) builder.Append(',');
                builder.Append(rows[index]);
            }
        }

        /// <summary>
        /// Hangt de meetsleutels in een al geserialiseerd frame. Eén punt, zodat de
        /// plugin geen tweede serializerij hoeft te kennen en een kapot frame nooit
        /// stilzwijgend "opgelapt" wordt.
        /// </summary>
        public static string InjectIntoFrame(string frameJson, string measurementMembers)
        {
            if (string.IsNullOrEmpty(measurementMembers)) return frameJson;
            if (string.IsNullOrEmpty(frameJson)) throw new ArgumentException("frameJson is leeg", "frameJson");
            var trimmed = frameJson.TrimEnd();
            if (trimmed.Length < 2 || trimmed[0] != '{' || trimmed[trimmed.Length - 1] != '}')
            {
                throw new ArgumentException("frameJson is geen JSON-object", "frameJson");
            }
            var head = trimmed.Substring(0, trimmed.Length - 1);
            var hasMembers = head.Length > 1;
            return head + (hasMembers ? "," : string.Empty) + measurementMembers + "}";
        }
    }
}
