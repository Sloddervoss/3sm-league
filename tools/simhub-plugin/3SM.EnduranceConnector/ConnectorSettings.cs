using System;

namespace ThreeSM.EnduranceConnector
{
    [Serializable]
    public sealed class ConnectorSettings
    {
        public int SchemaVersion = 0;
        // Veilige upgrade-default: bestaande installaties blijven lokaal tot een geslaagde pairing.
        public bool UseCentralRelay = false;
        // Remote Diagnostics is opt-out. Het pad blijft inert zonder geldige pairing/token.
        public bool DiagnosticsEnabled = true;
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
        // Enable only after the optional vehicle parser is deployed. Old receivers
        // reject new fields; default off also preserves existing installations.
        public bool ExtendedPitwallTelemetryEnabled = false;

        public string SpeedProperty = "DataCorePlugin.GameData.NewData.SpeedKmh";
        public string LapProperty = "DataCorePlugin.GameData.NewData.CurrentLap";
        public string CompletedLapsProperty = "DataCorePlugin.GameData.NewData.CompletedLaps";
        public string LapTimeProperty = "DataCorePlugin.GameData.NewData.CurrentLapTime";
        public string LastLapTimeProperty = "DataCorePlugin.GameData.NewData.LastLapTime";
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

        // V3: gap to leader (fallback property; null-tolerant).
        public string GapToLeaderProperty = "DataCorePlugin.GameData.NewData.F2Time";

        // V3/0.4.0 own-car field population (authoritative existing nullable fields).
        // NULL-tolerant: when the SimHub profile/current session lacks a property, the
        // recorded value stays null in the v3 payload (never a fake/derived number).
        public string SessionTimeRemainingProperty = "DataCorePlugin.GameData.NewData.SessionTimeRemain";
        public string SessionLapsRemainingProperty = "DataCorePlugin.GameData.NewData.SessionLapsRemainEx";
        public string CurrentLapElapsedProperty = "DataCorePlugin.GameData.NewData.LapCurrentLapTime";
        public string BestLapTimeProperty = "DataCorePlugin.GameData.NewData.BestLapTime";
        public string LapDistancePctProperty = "DataCorePlugin.GameData.NewData.LapDistPct";

        // Veilige versie-check en staged update. De plugin downloadt alleen van de vaste
        // 3SM-host; een extern updaterproces vervangt de geladen DLL na SimHub-exit.
        public string LastKnownRemoteVersion = string.Empty;
        public string LastKnownRemoteDllUrl = string.Empty;
        public string LastKnownRemoteSha256 = string.Empty;
        public string LastKnownRemoteFileName = string.Empty;
        public long LastKnownRemoteByteLength = 0;
        public string LastKnownRemoteSignature = string.Empty;
        public DateTime? LastVersionCheckUtc;
    }
}
