using System.Runtime.Serialization;

namespace ThreeSM.EnduranceConnector
{
    [DataContract]
    public sealed class TelemetryEnvelope
    {
        [DataMember(Name = "protocolVersion", Order = 1)] public int ProtocolVersion { get; set; }
        [DataMember(Name = "sequence", Order = 2)] public long Sequence { get; set; }
        [DataMember(Name = "capturedAt", Order = 3)] public string CapturedAt { get; set; }
        [DataMember(Name = "source", Order = 4)] public TelemetrySource Source { get; set; }
        [DataMember(Name = "race", Order = 5)] public RaceIdentity Race { get; set; }
        [DataMember(Name = "telemetry", Order = 6)] public TelemetryValues Telemetry { get; set; }
    }

    [DataContract]
    public sealed class TelemetrySource
    {
        [DataMember(Name = "connectorId", Order = 1)] public string ConnectorId { get; set; }
        [DataMember(Name = "simHubVersion", Order = 2)] public string SimHubVersion { get; set; }
        [DataMember(Name = "game", Order = 3)] public string Game { get; set; }
    }

    [DataContract]
    public sealed class RaceIdentity
    {
        [DataMember(Name = "eventId", Order = 1)] public string EventId { get; set; }
        [DataMember(Name = "teamId", Order = 2)] public string TeamId { get; set; }
        [DataMember(Name = "sessionId", Order = 3)] public string SessionId { get; set; }
        [DataMember(Name = "driverId", Order = 4)] public string DriverId { get; set; }
        [DataMember(Name = "currentDriverId", Order = 5)] public string CurrentDriverId { get; set; }
        [DataMember(Name = "currentDriverName", Order = 6)] public string CurrentDriverName { get; set; }
        [DataMember(Name = "carId", Order = 7)] public string CarId { get; set; }
        [DataMember(Name = "carName", Order = 8)] public string CarName { get; set; }
        [DataMember(Name = "trackName", Order = 9)] public string TrackName { get; set; }
        [DataMember(Name = "trackConfig", Order = 10)] public string TrackConfig { get; set; }
    }

    [DataContract]
    public sealed class TelemetryValues
    {
        [DataMember(Name = "connected", Order = 1)] public bool Connected { get; set; }
        [DataMember(Name = "sessionTimeSeconds", Order = 2)] public double SessionTimeSeconds { get; set; }
        [DataMember(Name = "lap", Order = 3)] public int Lap { get; set; }
        [DataMember(Name = "completedLaps", Order = 4)] public int CompletedLaps { get; set; }
        [DataMember(Name = "lapTimeSeconds", Order = 5)] public double? LapTimeSeconds { get; set; }
        [DataMember(Name = "position", Order = 6)] public int? Position { get; set; }
        [DataMember(Name = "classPosition", Order = 7)] public int? ClassPosition { get; set; }
        [DataMember(Name = "speedKph", Order = 8)] public double SpeedKph { get; set; }
        [DataMember(Name = "fuelLitres", Order = 9)] public double FuelLitres { get; set; }
        [DataMember(Name = "fuelPerLapLitres", Order = 10)] public double? FuelPerLapLitres { get; set; }
        [DataMember(Name = "estimatedLapsRemaining", Order = 11)] public double? EstimatedLapsRemaining { get; set; }
        [DataMember(Name = "inPitLane", Order = 12)] public bool InPitLane { get; set; }
        [DataMember(Name = "pitLimiter", Order = 13)] public bool PitLimiter { get; set; }
        [DataMember(Name = "stintElapsedSeconds", Order = 14)] public double StintElapsedSeconds { get; set; }
        [DataMember(Name = "incidents", Order = 15)] public int? Incidents { get; set; }
        [DataMember(Name = "flag", Order = 16)] public string Flag { get; set; }
        [DataMember(Name = "isInCar", Order = 17)] public bool IsInCar { get; set; }
    }

    [DataContract]
    public sealed class PairingRequest
    {
        [DataMember(Name = "action", Order = 1)] public string Action { get; set; }
        [DataMember(Name = "code", Order = 2)] public string Code { get; set; }
        [DataMember(Name = "connectorId", Order = 3)] public string ConnectorId { get; set; }
        [DataMember(Name = "deviceName", Order = 4)] public string DeviceName { get; set; }
    }

    [DataContract]
    public sealed class PairingResponse
    {
        [DataMember(Name = "paired", Order = 1)] public bool Paired { get; set; }
        [DataMember(Name = "deviceToken", Order = 2)] public string DeviceToken { get; set; }
        [DataMember(Name = "deviceId", Order = 3)] public string DeviceId { get; set; }
        [DataMember(Name = "ownerUserId", Order = 4)] public string OwnerUserId { get; set; }
        [DataMember(Name = "error", Order = 5)] public string Error { get; set; }
    }

    [DataContract]
    public sealed class VersionResponse
    {
        [DataMember(Name = "name", Order = 1)] public string Name { get; set; }
        [DataMember(Name = "version", Order = 2)] public string Version { get; set; }
        [DataMember(Name = "dllUrl", Order = 3)] public string DllUrl { get; set; }
        [DataMember(Name = "sha256", Order = 4)] public string Sha256 { get; set; }
        [DataMember(Name = "byteLength", Order = 5)] public long ByteLength { get; set; }
        [DataMember(Name = "fileName", Order = 6)] public string FileName { get; set; }
        [DataMember(Name = "signature", Order = 7)] public string Signature { get; set; }
        [DataMember(Name = "checkedAt", Order = 8)] public string CheckedAt { get; set; }
    }
}
