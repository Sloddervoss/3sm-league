using System.Runtime.Serialization;

namespace ThreeSM.EnduranceConnector
{
    // Wire-contract voor POST /functions/v1/simhub-overlay.
    // De server bepaalt de binding en de volgorde; de plugin publiceert dit
    // alleen als SimHub-properties voor het Dash Studio-dashboard.
    [DataContract]
    public sealed class OverlaySnapshot
    {
        [DataMember(Name = "contract", Order = 1)] public string Contract { get; set; }
        [DataMember(Name = "serverTime", Order = 2)] public string ServerTime { get; set; }
        [DataMember(Name = "revision", Order = 3)] public string Revision { get; set; }
        [DataMember(Name = "current", Order = 4)] public OverlayStint Current { get; set; }
        [DataMember(Name = "next", Order = 5)] public OverlayStint Next { get; set; }
        [DataMember(Name = "order", Order = 6)] public OverlayStint[] Order { get; set; }
        [DataMember(Name = "pace", Order = 7)] public OverlayPace[] Pace { get; set; }
        [DataMember(Name = "event", Order = 8)] public OverlayEvent Event { get; set; }
        [DataMember(Name = "team", Order = 9)] public OverlayTeam Team { get; set; }
        [DataMember(Name = "race", Order = 10)] public OverlayRace Race { get; set; }
        [DataMember(Name = "warnings", Order = 11)] public string[] Warnings { get; set; }
        [DataMember(Name = "self", Order = 12)] public OverlaySelf Self { get; set; }
    }

    [DataContract]
    public sealed class OverlayStint
    {
        [DataMember(Name = "stintId", Order = 1)] public string StintId { get; set; }
        [DataMember(Name = "stintIndex", Order = 2)] public int? StintIndex { get; set; }
        [DataMember(Name = "driverId", Order = 3)] public string DriverId { get; set; }
        [DataMember(Name = "driverName", Order = 4)] public string DriverName { get; set; }
        [DataMember(Name = "startAt", Order = 5)] public string StartAt { get; set; }
        [DataMember(Name = "endAt", Order = 6)] public string EndAt { get; set; }
        [DataMember(Name = "minutesUntilStart", Order = 7)] public decimal? MinutesUntilStart { get; set; }
        [DataMember(Name = "status", Order = 8)] public string Status { get; set; }
        [DataMember(Name = "isOverdue", Order = 9)] public bool? IsOverdue { get; set; }
        [DataMember(Name = "tyreChange", Order = 10)] public bool? TyreChange { get; set; }
        [DataMember(Name = "expectedLaps", Order = 11)] public int? ExpectedLaps { get; set; }
        [DataMember(Name = "laps", Order = 12)] public int? Laps { get; set; }
        [DataMember(Name = "bestSeconds", Order = 13)] public decimal? BestSeconds { get; set; }
        [DataMember(Name = "averageSeconds", Order = 14)] public decimal? AverageSeconds { get; set; }
        [DataMember(Name = "driverShort", Order = 15)] public string DriverShort { get; set; }
        [DataMember(Name = "isSelf", Order = 16)] public bool? IsSelf { get; set; }
        [DataMember(Name = "isCurrent", Order = 17)] public bool? IsCurrent { get; set; }
        [DataMember(Name = "doubleStint", Order = 18)] public bool? DoubleStint { get; set; }
        [DataMember(Name = "minutesRemaining", Order = 19)] public decimal? MinutesRemaining { get; set; }
    }

    [DataContract]
    /// <summary>Wie de kijker is, zodat het dashboard "jij neemt over van X" kan tonen.</summary>
    public sealed class OverlaySelf
    {
        [DataMember(Name = "userId", Order = 1)] public string UserId { get; set; }
        [DataMember(Name = "iracingId", Order = 2)] public string IracingId { get; set; }
        [DataMember(Name = "isDriving", Order = 3)] public bool? IsDriving { get; set; }
    }

    // Zonder [DataContract] negeert DataContractJsonSerializer deze klasse en
    // blijven alle velden stil leeg -- geen exception, geen logregel.
    [DataContract]
    public sealed class OverlayPace
    {
        [DataMember(Name = "driverId", Order = 1)] public string DriverId { get; set; }
        [DataMember(Name = "driverName", Order = 2)] public string DriverName { get; set; }
        [DataMember(Name = "laps", Order = 3)] public int? Laps { get; set; }
        [DataMember(Name = "bestSeconds", Order = 4)] public decimal? BestSeconds { get; set; }
        [DataMember(Name = "averageSeconds", Order = 5)] public decimal? AverageSeconds { get; set; }
    }

    [DataContract]
    public sealed class OverlayEvent
    {
        [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
        [DataMember(Name = "name", Order = 2)] public string Name { get; set; }
        [DataMember(Name = "circuit", Order = 3)] public string Circuit { get; set; }
        [DataMember(Name = "configuration", Order = 4)] public string Configuration { get; set; }
        [DataMember(Name = "status", Order = 5)] public string Status { get; set; }
        [DataMember(Name = "startAt", Order = 6)] public string StartAt { get; set; }
        [DataMember(Name = "endAt", Order = 7)] public string EndAt { get; set; }
        [DataMember(Name = "expectedEndAt", Order = 8)] public string ExpectedEndAt { get; set; }
    }

    [DataContract]
    public sealed class OverlayTeam
    {
        [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
        [DataMember(Name = "name", Order = 2)] public string Name { get; set; }
        [DataMember(Name = "carNumber", Order = 3)] public string CarNumber { get; set; }
        [DataMember(Name = "carId", Order = 4)] public string CarId { get; set; }
    }

    [DataContract]
    public sealed class OverlayRace
    {
        [DataMember(Name = "plannedStartAt", Order = 1)] public string PlannedStartAt { get; set; }
        [DataMember(Name = "plannedEndAt", Order = 2)] public string PlannedEndAt { get; set; }
        [DataMember(Name = "plannedDurationMinutes", Order = 3)] public decimal? PlannedDurationMinutes { get; set; }
    }
}
