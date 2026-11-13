using System;
using System.Collections.Generic;

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

        // Internal source-only opt-in/kill switch. No UI, handshake claim or migration.
        [System.Runtime.Serialization.OptionalField]
        public bool ObservationEnabled = false;
        // Nullable distinguishes absent historical metadata from a real persisted epoch.
        [System.Runtime.Serialization.OptionalField]
        public long? ObservationPairingGeneration;
        [System.Runtime.Serialization.OptionalField]
        public bool ObservationPairingGenerationKnown = false;
        // Clearing knownness must not turn NULL+known-invalid into pristine absence.
        [System.Runtime.Serialization.OptionalField]
        public bool ObservationPairingGenerationPoisoned = false;

        public ObservationPairingBinding ObservationBinding()
        {
            var generation = ObservationPairingGeneration;
            var known = !ObservationPairingGenerationPoisoned && ObservationPairingGenerationKnown && generation.HasValue
                && generation.Value >= 0 && generation.Value <= 9007199254740991L;
            return new ObservationPairingBinding(DeviceId, BoundOwnerUserId, generation ?? 0, known);
        }

        // Missing/corrupt/overflow history is NOT adopted as known zero. Only a validated
        // new Pair commit may persist this next value together with device/owner/token.
        public long? NextObservationGeneration()
        {
            var binding = ObservationBinding();
            return binding.PairingGenerationKnown && binding.PairingGeneration < 9007199254740991L
                ? (long?)(binding.PairingGeneration + 1) : null;
        }

        public void InvalidateObservationGeneration()
        {
            if (ObservationPairingGenerationKnown && !ObservationPairingGeneration.HasValue)
                ObservationPairingGenerationPoisoned = true;
            ObservationPairingGenerationKnown = false;
        }

        // Caller holds _settingsGate and the shared host transition lease. Inputs have
        // already passed the real Pair response validation. This is the production
        // protect/combined-save boundary, also executed by the local runtime tests.
        // Return the raw token only after durable save, never via a publication callback.
        public string CommitNewPair(string device, string owner, string token, string priorToken,
            Func<string, string> protect, Action save, Action<Exception> rollbackFailed)
        {
            var oldProtected = DeviceTokenProtected;
            var oldDevice = DeviceId;
            var oldOwner = BoundOwnerUserId;
            var oldRace = BoundRaceId;
            var oldTeam = BoundTeamId;
            var oldCentral = UseCentralRelay;
            try
            {
                var next = NextObservationGeneration();
                var fresh = !string.Equals(device, oldDevice, StringComparison.OrdinalIgnoreCase)
                    && (string.IsNullOrEmpty(priorToken) || !string.Equals(token, priorToken, StringComparison.Ordinal));
                if (!next.HasValue && fresh && !ObservationPairingGeneration.HasValue
                    && !ObservationPairingGenerationKnown && !ObservationPairingGenerationPoisoned)
                    next = 1;
                var protectedToken = protect(token);
                // Preserve invalid/overflow/lost-provenance evidence on refusal.
                if (next.HasValue) ObservationPairingGeneration = next;
                InvalidateObservationGeneration();
                ObservationPairingGenerationKnown = next.HasValue;
                DeviceTokenProtected = protectedToken;
                DeviceId = device;
                BoundOwnerUserId = owner;
                BoundRaceId = string.Empty;
                BoundTeamId = string.Empty;
                UseCentralRelay = true;
                save();
                return token;
            }
            catch
            {
                DeviceTokenProtected = oldProtected;
                DeviceId = oldDevice;
                BoundOwnerUserId = oldOwner;
                BoundRaceId = oldRace;
                BoundTeamId = oldTeam;
                UseCentralRelay = oldCentral;
                // A local rollback is not server undo. Keep attempted high-watermark
                // and refuse restored OBS authority, including when rollback save fails.
                InvalidateObservationGeneration();
                try { save(); }
                catch (Exception error) { rollbackFailed(error); }
                throw;
            }
        }

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
        public bool ExtendedPitwallTelemetryEnabled = true;

        // 0.7.2.0: directe lezer van de iRacing-shared-memory (Local\IRSDKMemMapFileName)
        // voor de kanalen die SimHub's GameRawData niet doorgeeft: wielsnelheid, remdruk
        // per wiel, stuurhoek en lat/long-versnelling. Read-only, geen ReadProcessMemory
        // en geen tweede programma.
        //
        // Null = de sleutel stond niet in het configuratiebestand. Dat betekent AAN,
        // zodat een bestaande installatie zonder migratie hetzelfde gedrag krijgt als
        // een verse. false = de gebruiker heeft hem bewust uitgezet.
        public bool? IrSdkDirectReadEnabled;

        /// <summary>Effectieve stand van de directe lezer (ontbrekende sleutel = aan).</summary>
        public bool IrSdkDirectRead { get { return IrSdkDirectReadEnabled != false; } }

        // 0.7.0: optioneel root-blok `tyres` (12 wear-zones, karkas, sets, omgeving).
        // Zelfde regel als hierboven: pas aanzetten als de relay/validator het blok kent,
        // want een oude receiver weigert een onbekende root-key met 422. Default uit.
        public bool TyreTelemetryEnabled = true;

        // 0.7.1: het bandenblok hoeft niet elk frame mee. De plugin stuurt het opnieuw zodra
        // de inhoud verandert en anders één keer per dit interval (hartslag). Zo blijft de
        // pitwall bij en gaat er niet 1× per seconde een blok van ~0,7 kB over de lijn.
        // 0 of negatief = de standaardwaarde (30 s), zodat een oud configuratiebestand
        // zonder deze sleutel hetzelfde gedrag krijgt als een verse installatie.
        public int TyreSnapshotIntervalMilliseconds = 30000;

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

        // Auto-update: op de achtergrond downloaden en op een veilig moment toepassen
        // (nooit tijdens een game; maximaal één automatische herstart per 24 uur).
        public bool AutoUpdateEnabled = true;
        public long LastAutoUpdateRestartUtcTicks = 0L;
    }
}
