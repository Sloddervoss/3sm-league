using System.Runtime.Serialization;

namespace ThreeSM.EnduranceConnector
{
    // Telemetry V3 frozen wire contract (Phase A schema contracts/simhub-telemetry.v3.schema.json).
    // protocolVersion=3. No source.connectorId, no raceRunId, no device/event/team/authority fields,
    // no tyres / fastRepair / gameSessionKey / strategy fields. Nullable scalar members serialize as
    // JSON null via DataContractJsonSerializer and satisfy the V3 schema's nullable type unions.
    [DataContract]
    public sealed class TelemetryEnvelopeV3
    {
        [DataMember(Name = "protocolVersion", Order = 1)] public int ProtocolVersion { get; set; }
        [DataMember(Name = "sequence", Order = 2)] public long Sequence { get; set; }
        [DataMember(Name = "capturedAt", Order = 3)] public string CapturedAt { get; set; }
        [DataMember(Name = "transportSessionId", Order = 4)] public string TransportSessionId { get; set; }
        [DataMember(Name = "identity", Order = 5)] public V3Identity Identity { get; set; }
        [DataMember(Name = "session", Order = 6)] public V3Session Session { get; set; }
        [DataMember(Name = "timing", Order = 7)] public V3Timing Timing { get; set; }
        [DataMember(Name = "position", Order = 8)] public V3Position Position { get; set; }
        [DataMember(Name = "track", Order = 9)] public V3Track Track { get; set; }
        [DataMember(Name = "fuel", Order = 10)] public V3Fuel Fuel { get; set; }
        [DataMember(Name = "raceState", Order = 11)] public V3RaceState RaceState { get; set; }
        [DataMember(Name = "pitService", Order = 12)] public V3PitService PitService { get; set; }
    }

    [DataContract]
    public sealed class V3Identity
    {
        [DataMember(Name = "currentDriverId", Order = 1)] public string CurrentDriverId { get; set; }
        [DataMember(Name = "currentDriverName", Order = 2)] public string CurrentDriverName { get; set; }
        [DataMember(Name = "carId", Order = 3)] public string CarId { get; set; }
        [DataMember(Name = "carName", Order = 4)] public string CarName { get; set; }
        [DataMember(Name = "trackName", Order = 5)] public string TrackName { get; set; }
        [DataMember(Name = "trackConfig", Order = 6)] public string TrackConfig { get; set; }
    }

    [DataContract]
    public sealed class V3Session
    {
        [DataMember(Name = "isInCar", Order = 1)] public bool IsInCar { get; set; }
        [DataMember(Name = "sessionTimeSeconds", Order = 2)] public double? SessionTimeSeconds { get; set; }
        [DataMember(Name = "sessionTimeRemainingSeconds", Order = 3)] public double? SessionTimeRemainingSeconds { get; set; }
        [DataMember(Name = "sessionLapsRemaining", Order = 4)] public int? SessionLapsRemaining { get; set; }
        [DataMember(Name = "flags", Order = 5)] public string[] Flags { get; set; }
        [DataMember(Name = "sessionState", Order = 6)] public string SessionState { get; set; }
    }

    [DataContract]
    public sealed class V3Timing
    {
        [DataMember(Name = "currentLapElapsedSeconds", Order = 1)] public double? CurrentLapElapsedSeconds { get; set; }
        [DataMember(Name = "lastLapTimeSeconds", Order = 2)] public double? LastLapTimeSeconds { get; set; }
        [DataMember(Name = "bestLapTimeSeconds", Order = 3)] public double? BestLapTimeSeconds { get; set; }
        [DataMember(Name = "completedLaps", Order = 4)] public int? CompletedLaps { get; set; }
    }

    [DataContract]
    public sealed class V3Position
    {
        [DataMember(Name = "position", Order = 1)] public int? Position { get; set; }
        [DataMember(Name = "classPosition", Order = 2)] public int? ClassPosition { get; set; }
        [DataMember(Name = "gapToLeaderSeconds", Order = 3)] public double? GapToLeaderSeconds { get; set; }
    }

    [DataContract]
    public sealed class V3Track
    {
        [DataMember(Name = "lapDistancePct", Order = 1)] public double? LapDistancePct { get; set; }
        [DataMember(Name = "trackSurface", Order = 2)] public string TrackSurface { get; set; }
        [DataMember(Name = "onPitRoad", Order = 3)] public bool? OnPitRoad { get; set; }
    }

    [DataContract]
    public sealed class V3Fuel
    {
        [DataMember(Name = "fuelLitres", Order = 1)] public double? FuelLitres { get; set; }
        [DataMember(Name = "fuelPct", Order = 2)] public double? FuelPct { get; set; }
    }

    [DataContract]
    public sealed class V3RaceState
    {
        [DataMember(Name = "incidents", Order = 1)] public int? Incidents { get; set; }
    }

    [DataContract]
    public sealed class V3PitService
    {
        [DataMember(Name = "pitServiceFlagsRaw", Order = 1)] public int? PitServiceFlagsRaw { get; set; }
        [DataMember(Name = "requiredRepairSeconds", Order = 2)] public double? RequiredRepairSeconds { get; set; }
        [DataMember(Name = "optionalRepairSeconds", Order = 3)] public double? OptionalRepairSeconds { get; set; }
    }
}