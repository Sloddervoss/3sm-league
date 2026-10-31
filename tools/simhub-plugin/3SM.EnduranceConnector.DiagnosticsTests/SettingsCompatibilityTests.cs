using System;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text;
using ThreeSM.EnduranceConnector;

// FASE 1 (baseline) + acceptatie voor het verwijderen van de researchvelden:
// een bestaande 0.7.1.2-configuratie moet zonder fout blijven laden.
//
// De fixture is geschreven door de ECHTE 0.7.1.2-code (DataContractJsonSerializer op
// ConnectorSettings), inclusief ResearchEnabled/ResearchDirectory en de volledige
// vlaggeninstellingen. Latere versies mogen die sleutels negeren, maar niet weigeren.
internal static class SettingsCompatibilityTests
{
    internal static string LegacyFileName { get { return Path.Combine(AppContext.BaseDirectory, "Fixtures", "connector-settings-0.7.1.2.json"); } }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var json = File.Exists(LegacyFileName) ? File.ReadAllText(LegacyFileName, Encoding.UTF8) : null;
        Check("S01", json != null && json.Trim().Length > 0, "0.7.1.2-configuratie aanwezig: " + LegacyFileName);
        if (json == null) return count;

        ConnectorSettings settings = null;
        Exception failure = null;
        try { settings = Deserialize(json); }
        catch (Exception error) { failure = error; }
        Check("S02", failure == null && settings != null, "oude configuratie laadt zonder fout" + (failure == null ? string.Empty : ": " + failure.GetType().Name + " " + failure.Message));
        if (settings == null) return count;

        Check("S03", settings.SchemaVersion == 8, "schemanummer blijft staan (" + settings.SchemaVersion + ")");
        Check("S04", settings.UseCentralRelay, "koppeling blijft centraal");
        Check("S05", settings.DiagnosticsEnabled, "diagnostiek blijft aan (opt-out)");
        Check("S06", settings.RelayBaseUrl == "https://api.3stripemotorsport.cc/functions/v1", "relay-URL blijft " + settings.RelayBaseUrl);
        Check("S07", settings.DeviceId == "11111111-1111-1111-1111-111111111111", "device-id blijft behouden");
        Check("S08", settings.BoundRaceId == "race-road-america-6h" && settings.BoundTeamId == "team-orange-31",
            "binding blijft behouden (" + settings.BoundRaceId + "/" + settings.BoundTeamId + ")");
        Check("S09", settings.SendIntervalMilliseconds == 1000, "verzendinterval blijft 1000 ms");
        Check("S10", settings.TyreTelemetryEnabled && settings.TyreSnapshotIntervalMilliseconds == 30000, "bandenblok blijft aan met 30 s-hartslag");
        Check("S11", settings.IrSdkDirectRead && settings.IrSdkDirectReadEnabled.HasValue && settings.IrSdkDirectReadEnabled.Value,
            "directe SDK-lezer blijft aan");
        Check("S12", settings.AutoUpdateEnabled && settings.LastAutoUpdateRestartUtcTicks == 0L, "auto-update blijft aan zonder herstartbudget");
        Check("S13", settings.LastKnownRemoteVersion == "0.8.0.0", "aangekondigde versie blijft " + settings.LastKnownRemoteVersion);
        Check("S14", settings.LastKnownRemoteSha256.Length == 64 && settings.LastKnownRemoteSha256.StartsWith("9f2c", StringComparison.Ordinal), "releasehash blijft bewaard");
        Check("S15", settings.FlagProperty == "DataCorePlugin.GameData.NewData.Flag", "vlagproperty blijft " + settings.FlagProperty);
        Check("S16", settings.FuelProperty == "DataCorePlugin.GameData.NewData.Fuel", "brandstofproperty blijft " + settings.FuelProperty);
        Check("S17", settings.ConnectorId == "PCBART", "connectornaam blijft " + settings.ConnectorId);

        // Sleutel die een toekomstige versie toevoegt mag een bestaande installatie niet breken.
        var withUnknown = json.TrimEnd().TrimEnd('}') + ",\"SomeFutureFeature\":{\"enabled\":true}}";
        ConnectorSettings future = null;
        Exception futureFailure = null;
        try { future = Deserialize(withUnknown); }
        catch (Exception error) { futureFailure = error; }
        Check("S18", futureFailure == null && future != null && future.DeviceId == settings.DeviceId,
            "onbekende, toekomstige sleutel wordt genegeerd" + (futureFailure == null ? string.Empty : ": " + futureFailure.Message));

        // Ontbrekende sleutels: de migratieregel "ontbrekend = aan" blijft overeind.
        ConnectorSettings bare = null;
        Exception bareFailure = null;
        try { bare = Deserialize("{\"SchemaVersion\":8}"); }
        catch (Exception error) { bareFailure = error; }
        Check("S19", bareFailure == null && bare != null && bare.IrSdkDirectRead, "zonder IrSdkDirectReadEnabled blijft de SDK-lezer aan" + (bareFailure == null ? string.Empty : ": " + bareFailure.GetType().Name + " " + bareFailure.Message));
        Check("S20", bare != null && bare.SendIntervalMilliseconds == 1000, "zonder intervallsleutel blijft 1000 ms" + (bareFailure == null ? string.Empty : ": " + bareFailure.GetType().Name + " " + bareFailure.Message));

        // De strengste variant: een lezer die ieder lid eist, moet het volledige
        // 0.7.1.2-bestand nog steeds accepteren (extra researchsleutels worden genegeerd).
        ConnectorSettings strict = null;
        Exception strictFailure = null;
        try { strict = DeserializeStrict(json); }
        catch (Exception error) { strictFailure = error; }
        Check("S21", strictFailure == null && strict != null && strict.DeviceId == settings.DeviceId,
            "volledig 0.7.1.2-bestand laadt ook met een lezer die ieder lid eist" + (strictFailure == null ? string.Empty : ": " + strictFailure.Message));
        return count;
    }

    // SimHub bewaart plugininstellingen als JSON-POCO (publieke velden, onbekende sleutels
    // genegeerd, ontbrekende sleutels blijven op hun initiele waarde). Dat is precies wat
    // System.Text.Json met IncludeFields doet; DataContractJsonSerializer eist elk lid en
    // is daarvoor te streng (zie S21, die de oude, volledige 0.7.1.2-file wel leest).
    internal static ConnectorSettings Deserialize(string json)
    {
        var options = new JsonSerializerOptions { IncludeFields = true };
        // DataContractJsonSerializer schrijft datums als "/Date(1761851645000)/"; dat is
        // het formaat dat een 0.7.1.2-installatie op schijf heeft staan.
        options.Converters.Add(new LegacyMsDateConverter());
        return JsonSerializer.Deserialize<ConnectorSettings>(json, options);
    }

    /// <summary>Leest het Microsoft-datumformaat uit een bestaand (0.7.1.2-)bestand.</summary>
    internal sealed class LegacyMsDateConverter : JsonConverter<DateTime?>
    {
        public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Null) return null;
            var text = reader.GetString();
            if (string.IsNullOrEmpty(text)) return null;
            var start = text.IndexOf('(');
            var end = text.IndexOf(')', start + 1);
            if (start < 0 || end < 0) throw new JsonException("Onverwachte datumnotatie: " + text);
            var inner = text.Substring(start + 1, end - start - 1);
            var sign = inner.IndexOfAny(new[] { '+', '-' });
            if (sign > 0) inner = inner.Substring(0, sign);
            long milliseconds;
            if (!long.TryParse(inner, out milliseconds)) throw new JsonException("Onverwachte datumnotatie: " + text);
            return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds).UtcDateTime;
        }

        public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
        {
            if (!value.HasValue) { writer.WriteNullValue(); return; }
            writer.WriteStringValue(value.Value.ToUniversalTime().ToString("o"));
        }
    }

    internal static string Serialize(ConnectorSettings settings)
    {
        var options = new JsonSerializerOptions { IncludeFields = true };
        return JsonSerializer.Serialize(settings, options);
    }

    // De strengste lezer die SimHub zou kunnen gebruiken: DataContractJsonSerializer eist
    // ieder lid. Een volledig 0.7.1.2-bestand (met researchsleutels, zonder nieuwe leden)
    // moet ook daar doorheen komen. Zo is het verwijderen van velden onder beide
    // serialisatievormen bewezen veilig.
    internal static string SerializeStrict(ConnectorSettings settings)
    {
        var serializer = new DataContractJsonSerializer(typeof(ConnectorSettings));
        using (var stream = new MemoryStream())
        {
            serializer.WriteObject(stream, settings);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    internal static ConnectorSettings DeserializeStrict(string json)
    {
        var serializer = new DataContractJsonSerializer(typeof(ConnectorSettings));
        using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
        {
            return (ConnectorSettings)serializer.ReadObject(stream);
        }
    }

    /// <summary>
    /// Schrijft de 0.7.1.2-vormige configuratie (zoals SimHub hem op schijf had) naar
    /// stdout. Alleen gebruikt om de fixture eenmalig vast te leggen met de oude code.
    /// </summary>
    internal static string DumpLegacySettings()
    {
        var settings = new ConnectorSettings
        {
            SchemaVersion = 8,
            UseCentralRelay = true,
            DiagnosticsEnabled = true,
            DeviceTokenProtected = string.Empty,
            DeviceId = "11111111-1111-1111-1111-111111111111",
            BoundRaceId = "race-road-america-6h",
            BoundTeamId = "team-orange-31",
            BoundOwnerUserId = "user-vincent",
            ConnectorId = "PCBART",
            SendIntervalMilliseconds = 1000,
            IrSdkDirectReadEnabled = true,
            ResearchEnabled = true,
            ResearchDirectory = "D:\\3SM\\research",
            LastKnownRemoteVersion = "0.8.0.0",
            LastKnownRemoteDllUrl = "https://3stripemotorsport.cc/downloads/3SM.EnduranceConnector-0.8.0.0.dll",
            LastKnownRemoteSha256 = "9f2c1d3e4b5a69789f2c1d3e4b5a69789f2c1d3e4b5a69789f2c1d3e4b5a6978",
            LastKnownRemoteFileName = "3SM.EnduranceConnector.dll",
            LastKnownRemoteByteLength = 262144,
            LastKnownRemoteSignature = "c2lnbmF0dXJl",
            LastVersionCheckUtc = new DateTime(2026, 10, 30, 21, 14, 5, DateTimeKind.Utc),
            AutoUpdateEnabled = true,
        };
        // Een realistische maar compacte vlaggenconfiguratie: alleen de velden die een
        // bestaande installatie echt op schijf heeft staan.
        settings.Flags.ShowGreen = true;
        settings.Flags.ShowMeatball = true;
        settings.Flags.SendFlagFields = true;
        settings.Flags.PropertyPrefix = "THREESM.Flags";
        settings.Flags.ActivePresetName = "iRacing standaard";
        return SerializeStrict(settings);
    }
}
