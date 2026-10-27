using System.Runtime.Serialization;

namespace ThreeSM.EnduranceConnector
{
    // Telemetry V3 frozen wire contract (Phase A schema contracts/simhub-telemetry.v3.schema.json).
    // protocolVersion=3. No source.connectorId, no raceRunId, no device/event/team/authority fields,
    // no authority / gameSessionKey / strategy inputs. Optional vehicle extension is gated.
    // Nullable scalar members serialize as
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
        // 0.4.1 additive: bounded, null-tolerant opponent snapshot. Absent/null => steady/0.4.0
        // compatible (validator allows when present). Cap enforced in the connector.
        [DataMember(Name = "opponents", Order = 13)] public V3Opponent[] Opponents { get; set; }
        [DataMember(Name = "vehicle", Order = 14, EmitDefaultValue = false)] public V3Vehicle Vehicle { get; set; }
        // 0.7.0 additive: optional root block for the tyre measurement (12 wear zones,
        // 12 carcass temperatures, set counters, compound, environment, pit-entry anchor).
        // EmitDefaultValue=false: no tyres block at all when there is nothing to report, so a
        // 0.6.1.1 payload stays byte-identical. protocolVersion stays 3 (framing unchanged).
        [DataMember(Name = "tyres", Order = 15, EmitDefaultValue = false)] public V3Tyres Tyres { get; set; }
    }

    // Tyre measurement root block (optional, additive under protocolVersion 3).
    // Every member is nullable: null means "SimHub did not deliver it", never a fake 0.
    [DataContract]
    public sealed class V3Tyres
    {
        // Moment waarop de connector de wear/karkaswaarde voor het eerst zag (niet het
        // verzendmoment; dat is envelope.capturedAt). De leeftijd is capturedAt - observedAt.
        [DataMember(Name = "observedAt", Order = 1)] public string ObservedAt { get; set; }
        [DataMember(Name = "sessionTimeSeconds", Order = 2, EmitDefaultValue = false)] public double? SessionTimeSeconds { get; set; }
        [DataMember(Name = "lap", Order = 3, EmitDefaultValue = false)] public int? Lap { get; set; }
        // session_start (eerste waarneming deze sessie) of sim_refresh (de sim heeft de
        // wear-kanalen bijgewerkt; dat gebeurt alleen in de pitstraat).
        [DataMember(Name = "trigger", Order = 4, EmitDefaultValue = false)] public string Trigger { get; set; }
        [DataMember(Name = "wearPercent", Order = 5, EmitDefaultValue = false)] public V3TyreZones WearPercent { get; set; }
        [DataMember(Name = "carcassTempC", Order = 6, EmitDefaultValue = false)] public V3TyreZones CarcassTempC { get; set; }
        [DataMember(Name = "sets", Order = 7, EmitDefaultValue = false)] public V3TyreSets Sets { get; set; }
        [DataMember(Name = "compoundId", Order = 8, EmitDefaultValue = false)] public int? CompoundId { get; set; }
        [DataMember(Name = "environment", Order = 9, EmitDefaultValue = false)] public V3TyreEnvironment Environment { get; set; }
        // De stand van vóór de pit-refresh: het stint-anker. Sticky, 120 s na pit-entry.
        [DataMember(Name = "pitEntry", Order = 10, EmitDefaultValue = false)] public V3TyrePitEntry PitEntry { get; set; }
    }

    // Vier hoeken, elk drie zones in de volgorde [left, middle, right]. De zonenaam staat
    // in de key, niet in de array. Lengte is altijd 3; een lege hoek valt weg.
    [DataContract]
    public sealed class V3TyreZones
    {
        [DataMember(Name = "frontLeft", Order = 1, EmitDefaultValue = false)] public double?[] FrontLeft { get; set; }
        [DataMember(Name = "frontRight", Order = 2, EmitDefaultValue = false)] public double?[] FrontRight { get; set; }
        [DataMember(Name = "rearLeft", Order = 3, EmitDefaultValue = false)] public double?[] RearLeft { get; set; }
        [DataMember(Name = "rearRight", Order = 4, EmitDefaultValue = false)] public double?[] RearRight { get; set; }
    }

    // iRacing-tellers. available=255 betekent "onbeperkt" (SDK-tekst), geen aantal;
    // de plugin interpreteert dat niet, de lezer doet dat.
    [DataContract]
    public sealed class V3TyreSets
    {
        [DataMember(Name = "used", Order = 1, EmitDefaultValue = false)] public int? Used { get; set; }
        [DataMember(Name = "available", Order = 2, EmitDefaultValue = false)] public int? Available { get; set; }
        [DataMember(Name = "frontLeft", Order = 3, EmitDefaultValue = false)] public int? FrontLeft { get; set; }
        [DataMember(Name = "frontRight", Order = 4, EmitDefaultValue = false)] public int? FrontRight { get; set; }
        [DataMember(Name = "rearLeft", Order = 5, EmitDefaultValue = false)] public int? RearLeft { get; set; }
        [DataMember(Name = "rearRight", Order = 6, EmitDefaultValue = false)] public int? RearRight { get; set; }
    }

    [DataContract]
    public sealed class V3TyreEnvironment
    {
        [DataMember(Name = "trackTempC", Order = 1, EmitDefaultValue = false)] public double? TrackTempC { get; set; }
        [DataMember(Name = "airTempC", Order = 2, EmitDefaultValue = false)] public double? AirTempC { get; set; }
        // Ruwe sessie-YAML tekst (bv. "moderate usage"); geen enum, geen gok.
        [DataMember(Name = "rubberState", Order = 3, EmitDefaultValue = false)] public string RubberState { get; set; }
    }

    // Bevroren stand op de pit-entry-flank: de set die eraf ging.
    [DataContract]
    public sealed class V3TyrePitEntry
    {
        [DataMember(Name = "observedAt", Order = 1)] public string ObservedAt { get; set; }
        [DataMember(Name = "sessionTimeSeconds", Order = 2, EmitDefaultValue = false)] public double? SessionTimeSeconds { get; set; }
        [DataMember(Name = "lap", Order = 3, EmitDefaultValue = false)] public int? Lap { get; set; }
        [DataMember(Name = "setsUsed", Order = 4, EmitDefaultValue = false)] public int? SetsUsed { get; set; }
        [DataMember(Name = "wearPercent", Order = 5, EmitDefaultValue = false)] public V3TyreZones WearPercent { get; set; }
        [DataMember(Name = "carcassTempC", Order = 6, EmitDefaultValue = false)] public V3TyreZones CarcassTempC { get; set; }
    }

    [DataContract]
    public sealed class V3Tyre
    {
        [DataMember(Name = "wearPercent")] public double? WearPercent { get; set; }
        [DataMember(Name = "temperature")] public double? Temperature { get; set; }
        [DataMember(Name = "pressure")] public double? Pressure { get; set; }
    }

    [DataContract]
    public sealed class V3Vehicle
    {
        [DataMember(Name = "speedKph")] public double? SpeedKph { get; set; }
        [DataMember(Name = "throttlePct")] public double? ThrottlePct { get; set; }
        [DataMember(Name = "brakePct")] public double? BrakePct { get; set; }
        [DataMember(Name = "rpm")] public double? Rpm { get; set; }
        [DataMember(Name = "gear")] public string Gear { get; set; }
        [DataMember(Name = "sector1Seconds")] public double? Sector1Seconds { get; set; }
        [DataMember(Name = "sector2Seconds")] public double? Sector2Seconds { get; set; }
        [DataMember(Name = "sector3Seconds")] public double? Sector3Seconds { get; set; }
        [DataMember(Name = "tyreDataMode")] public string TyreDataMode { get; set; }
        [DataMember(Name = "pressureUnit")] public string PressureUnit { get; set; }
        [DataMember(Name = "temperatureUnit")] public string TemperatureUnit { get; set; }
        [DataMember(Name = "frontLeft")] public V3Tyre FrontLeft { get; set; }
        [DataMember(Name = "frontRight")] public V3Tyre FrontRight { get; set; }
        [DataMember(Name = "rearLeft")] public V3Tyre RearLeft { get; set; }
        [DataMember(Name = "rearRight")] public V3Tyre RearRight { get; set; }

        // 0.8.0 additief: kanalen die SimHub's GameRawData niet doorgeeft en die de plugin
        // rechtstreeks uit de iRacing-shared-memory leest (IrSdkMemoryReader). Alles nullable
        // en EmitDefaultValue=false: zonder lezer (of zonder rijdende sim) verandert de
        // payload byte-voor-byte niet. Eenheid staat in de naam (Bar/Deg/G), zodat de
        // server geen eenheid hoeft te raden; de plugin rekent de SDK-eenheden om
        // (rad -> deg, m/s² -> g).
        //
        // Geen `wheelSpeedKph`: iRacing publiceert in de live-telemetrie geen
        // LFspeed/RFspeed/LRspeed/RRspeed (gecontroleerd tegen alle 334 variabelen), dus
        // dat veld zou altijd vier nullen zijn. De server negeert het nog wel voor oude
        // connectors die het sturen.
        [DataMember(Name = "brakeLinePressureBar", EmitDefaultValue = false)] public V3WheelValues BrakeLinePressureBar { get; set; }
        [DataMember(Name = "steeringWheelAngleDeg", EmitDefaultValue = false)] public double? SteeringWheelAngleDeg { get; set; }
        [DataMember(Name = "latAccelG", EmitDefaultValue = false)] public double? LatAccelG { get; set; }
        [DataMember(Name = "longAccelG", EmitDefaultValue = false)] public double? LongAccelG { get; set; }
    }

    /// <summary>
    /// Vier hoeken met één nullable getal per hoek. Ontbrekende hoeken vallen weg
    /// (EmitDefaultValue=false), zodat een half gevulde meting geen nullen suggereert.
    /// </summary>
    [DataContract]
    public sealed class V3WheelValues
    {
        [DataMember(Name = "frontLeft", EmitDefaultValue = false)] public double? FrontLeft { get; set; }
        [DataMember(Name = "frontRight", EmitDefaultValue = false)] public double? FrontRight { get; set; }
        [DataMember(Name = "rearLeft", EmitDefaultValue = false)] public double? RearLeft { get; set; }
        [DataMember(Name = "rearRight", EmitDefaultValue = false)] public double? RearRight { get; set; }
    }

    [DataContract]
    public sealed class V3Opponent
    {
        [DataMember(Name = "id", Order = 1)] public string Id { get; set; }
        [DataMember(Name = "carNumber", Order = 2)] public string CarNumber { get; set; }
        [DataMember(Name = "driverName", Order = 3)] public string DriverName { get; set; }
        [DataMember(Name = "teamName", Order = 4)] public string TeamName { get; set; }
        [DataMember(Name = "carClass", Order = 5)] public string CarClass { get; set; }
        [DataMember(Name = "carClassId", Order = 6)] public string CarClassId { get; set; }
        [DataMember(Name = "position", Order = 7)] public int? Position { get; set; }
        [DataMember(Name = "classPosition", Order = 8)] public int? ClassPosition { get; set; }
        [DataMember(Name = "lap", Order = 9)] public int? Lap { get; set; }
        [DataMember(Name = "lapDistancePct", Order = 10)] public double? LapDistancePct { get; set; }
        [DataMember(Name = "gapToPlayerSeconds", Order = 11)] public double? GapToPlayerSeconds { get; set; }
        [DataMember(Name = "gapToLeaderSeconds", Order = 12)] public double? GapToLeaderSeconds { get; set; }
        [DataMember(Name = "lastLapSeconds", Order = 13)] public double? LastLapSeconds { get; set; }
        [DataMember(Name = "bestLapSeconds", Order = 14)] public double? BestLapSeconds { get; set; }
        [DataMember(Name = "inPit", Order = 15)] public bool? InPit { get; set; }
        [DataMember(Name = "speedKph", Order = 16)] public double? SpeedKph { get; set; }
        [DataMember(Name = "connected", Order = 17)] public bool Connected { get; set; }
        [DataMember(Name = "isPlayer", Order = 18)] public bool IsPlayer { get; set; }
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
        // Officiële iRacing-track-id voor de Pitwall-kaartkoppeling (op main sinds 8913ba3).
        [DataMember(Name = "trackId", Order = 7, EmitDefaultValue = false)] public int? TrackId { get; set; }
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
        // 0.5.0 additive: rijke vlag-presentatie. EmitDefaultValue=false zodat oude
        // receivers (en het bestaande schema) onveranderd blijven als de module uit staat.
        [DataMember(Name = "primaryFlag", Order = 7, EmitDefaultValue = false)] public string PrimaryFlag { get; set; }
        [DataMember(Name = "flagColour", Order = 8, EmitDefaultValue = false)] public string FlagColour { get; set; }
        [DataMember(Name = "flagSeverity", Order = 9, EmitDefaultValue = false)] public int FlagSeverity { get; set; }
        // Additive: genormaliseerde fase + startlichten + pitlane-open (null/null/false als onbekend).
        [DataMember(Name = "startLights", Order = 10, EmitDefaultValue = false)] public int? StartLights { get; set; }
        [DataMember(Name = "pitLaneOpen", Order = 11, EmitDefaultValue = false)] public bool? PitLaneOpen { get; set; }
        [DataMember(Name = "isStartSequence", Order = 12, EmitDefaultValue = false)] public bool IsStartSequence { get; set; }
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
        // Additive: stint-berekening (null tot er minstens één ronde data is).
        [DataMember(Name = "fuelPerLapLitres", Order = 3, EmitDefaultValue = false)] public double? FuelPerLapLitres { get; set; }
        [DataMember(Name = "lapsRemaining", Order = 4, EmitDefaultValue = false)] public double? LapsRemaining { get; set; }
        // Additive (0.6.0.1): tankinhoud uit de sessiegegevens, zodat de pitwall
        // liters kan rekenen zonder dat iemand de catalogus met de hand vult.
        [DataMember(Name = "fuelCapacityLitres", Order = 5, EmitDefaultValue = false)] public double? FuelCapacityLitres { get; set; }
    }

    [DataContract]
    public sealed class V3RaceState
    {
        [DataMember(Name = "incidents", Order = 1)] public int? Incidents { get; set; }
        [DataMember(Name = "incidentLimit", Order = 2, EmitDefaultValue = false)] public int? IncidentLimit { get; set; }
    }

    [DataContract]
    public sealed class V3PitService
    {
        [DataMember(Name = "pitServiceFlagsRaw", Order = 1)] public int? PitServiceFlagsRaw { get; set; }
        [DataMember(Name = "requiredRepairSeconds", Order = 2)] public double? RequiredRepairSeconds { get; set; }
        [DataMember(Name = "optionalRepairSeconds", Order = 3)] public double? OptionalRepairSeconds { get; set; }
    }
}
