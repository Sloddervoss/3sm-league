using System;

namespace ThreeSM.EnduranceConnector
{
    [Serializable]
    public sealed class ConnectorSettings
    {
        public int SchemaVersion = 0;
        public string RelayBaseUrl = "https://api.3stripemotorsport.cc/functions/v1";
        public string DeviceTokenProtected = string.Empty;
        public string DeviceId = string.Empty;
        // Legacy v2-binding blijft bewaard zodat een DLL-rollback bestaande pairings niet verbreekt.
        public string BoundRaceId = string.Empty;
        public string BoundTeamId = string.Empty;
        public string BoundOwnerUserId = string.Empty;

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

        // Veilige versie-check en staged update. De plugin downloadt alleen van de vaste
        // 3SM-host; een extern updaterproces vervangt de geladen DLL na SimHub-exit.
        public string LastKnownRemoteVersion = string.Empty;
        public string LastKnownRemoteDllUrl = string.Empty;
        public string LastKnownRemoteSha256 = string.Empty;
        public long LastKnownRemoteByteLength;
        public string LastKnownRemoteFileName = string.Empty;
        public string LastKnownRemoteSignature = string.Empty;
        public DateTime? LastVersionCheckUtc;
    }
}
