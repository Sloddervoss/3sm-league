using System;

namespace ThreeSM.EnduranceConnector
{
    [Serializable]
    public sealed class ConnectorSettings
    {
        public int SchemaVersion = 0;
        // Veilige upgrade-default: bestaande installaties blijven lokaal tot een geslaagde pairing.
        public bool UseCentralRelay = false;
        public string RelayBaseUrl = "https://api.3stripemotorsport.cc/functions/v1";
        public string DeviceTokenProtected = string.Empty;
        public string DeviceId = string.Empty;
        // Legacy v2-binding blijft bewaard zodat een DLL-rollback bestaande pairings niet verbreekt.
        public string BoundRaceId = string.Empty;
        public string BoundTeamId = string.Empty;
        public string BoundOwnerUserId = string.Empty;

        // Geavanceerde lokale fallback voor ontwikkeling en offline simulatie.
        public string BridgeUrl = "http://127.0.0.1:8787";
        public string PairingToken = "local-3sm-simhub-spike";
        public string EventId = "event-road-america-6h";
        public string TeamId = "team-orange-31";
        public string DriverId = "user-jaimy";

        public string ConnectorId = Environment.MachineName;
        public int SendIntervalMilliseconds = 1000;

        public string SpeedProperty = "DataCorePlugin.GameData.NewData.SpeedKmh";
        public string LapProperty = "DataCorePlugin.GameData.NewData.CurrentLap";
        public string CompletedLapsProperty = "DataCorePlugin.GameData.NewData.CompletedLaps";
        public string LapTimeProperty = "DataCorePlugin.GameData.NewData.CurrentLapTime";
        public string PositionProperty = "DataCorePlugin.GameData.NewData.Position";
        public string ClassPositionProperty = "DataCorePlugin.GameData.NewData.PositionInClass";
        public string FuelProperty = "DataCorePlugin.GameData.NewData.Fuel";
        public string FuelPerLapProperty = "DataCorePlugin.GameData.NewData.FuelPerLap";
        public string EstimatedLapsProperty = "DataCorePlugin.GameData.NewData.FuelLaps";
        public string PitLaneProperty = "DataCorePlugin.GameData.NewData.IsInPitLane";
        public string PitLimiterProperty = "DataCorePlugin.GameData.NewData.PitLimiterOn";
        public string IncidentsProperty = "DataCorePlugin.GameData.NewData.Incidents";
        public string FlagProperty = "DataCorePlugin.GameData.NewData.Flag";
        public string SessionTimeProperty = "DataCorePlugin.GameData.NewData.SessionTime";

        // Envelope v2: huidige coureur, auto en circuit (fail-closed naar null als de
        // property ontbreekt; pad is per SimHub-profiel configureerbaar).
        public string CurrentDriverIdProperty = "DataCorePlugin.GameData.NewData.DriverId";
        public string CurrentDriverNameProperty = "DataCorePlugin.GameData.NewData.CurrentDriverName";
        public string CarIdProperty = "DataCorePlugin.GameData.NewData.CarId";
        public string CarNameProperty = "DataCorePlugin.GameData.NewData.CarName";
        public string TrackNameProperty = "DataCorePlugin.GameData.NewData.TrackName";
        public string TrackConfigProperty = "DataCorePlugin.GameData.NewData.TrackConfig";

        // ------------------------------------------------------------------
        // Envelope v3 (Phase C): nieuwe property-paden voor de V3-structuur.
        // Alle CarIdx-arrayleden worden altijd via playerCarIdx gelezen (met
        // bounds-checking); de directe niet-CarIdx-varianten (bv. PitSvFlags,
        // LapDistPct) dienen alleen als fallback wanneer playerCarIdx ongeldig is.
        // ------------------------------------------------------------------
        public string PlayerCarIdxProperty = "DataCorePlugin.GameData.NewData.PlayerCarIdx";
        public string CurrentLapElapsedProperty = "DataCorePlugin.GameData.NewData.LapCurrentLapTime";
        public string SessionTimeRemainingProperty = "DataCorePlugin.GameData.NewData.SessionTimeRemain";
        public string SessionLapsRemainingProperty = "DataCorePlugin.GameData.NewData.SessionLapsRemainEx";
        public string GapToLeaderProperty = "DataCorePlugin.GameData.NewData.F2Time";
        public string LapDistanceProperty = "DataCorePlugin.GameData.NewData.LapDistPct";
        public string FuelPctProperty = "DataCorePlugin.GameData.NewData.FuelLevelPct";
        public string PlayerCarDriverIncidentCountProperty = "DataCorePlugin.GameData.NewData.PlayerCarDriverIncidentCount";
        public string PitServiceFlagsProperty = "DataCorePlugin.GameData.NewData.PitSvFlags";
        public string RequiredRepairProperty = "DataCorePlugin.GameData.NewData.PitRepairLeft";
        public string OptionalRepairProperty = "DataCorePlugin.GameData.NewData.PitOptRepairLeft";
        public string CarIdxLapDistPctProperty = "DataCorePlugin.GameData.NewData.CarIdxLapDistPct";
        public string CarIdxPositionProperty = "DataCorePlugin.GameData.NewData.CarIdxPosition";
        public string CarIdxClassPositionProperty = "DataCorePlugin.GameData.NewData.CarIdxClassPosition";
        public string CarIdxF2TimeProperty = "DataCorePlugin.GameData.NewData.CarIdxF2Time";
        public string CarIdxLastLapTimeProperty = "DataCorePlugin.GameData.NewData.CarIdxLastLapTime";
        public string CarIdxBestLapTimeProperty = "DataCorePlugin.GameData.NewData.CarIdxBestLapTime";
        public string CarIdxCurrentLapProperty = "DataCorePlugin.GameData.NewData.CarIdxLapCurrentLapTime";
        public string CarIdxTrackSurfaceProperty = "DataCorePlugin.GameData.NewData.CarIdxTrackSurface";
        public string CarIdxOnPitRoadProperty = "DataCorePlugin.GameData.NewData.CarIdxOnPitRoad";

        // Veilige versie-check: alleen een "nieuwe versie beschikbaar"-melding.
        // De plugin vervangt nooit zelf de DLL en stuurt geen credentials.
        public string LastKnownRemoteVersion = string.Empty;
        public string LastKnownRemoteDllUrl = string.Empty;
        public DateTime? LastVersionCheckUtc;
    }
}
