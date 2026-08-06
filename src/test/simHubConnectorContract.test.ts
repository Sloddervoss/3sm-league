import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pluginRoot = "tools/simhub-plugin/3SM.EnduranceConnector";
const plugin = readFileSync(`${pluginRoot}/EnduranceConnectorPlugin.cs`, "utf8");
const contracts = readFileSync(`${pluginRoot}/TelemetryContracts.cs`, "utf8");
const settings = readFileSync(`${pluginRoot}/ConnectorSettings.cs`, "utf8");
const project = readFileSync(`${pluginRoot}/3SM.EnduranceConnector.csproj`, "utf8");
const bridge = readFileSync("tools/simhub-bridge/server.mjs", "utf8");
const schema = JSON.parse(readFileSync("contracts/simhub-telemetry.v2.schema.json", "utf8"));

describe("3SM SimHub connector spike contract", () => {
  it("targets the documented SimHub plugin shape on .NET Framework 4.8", () => {
    expect(project).toContain("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>");
    expect(project).toContain("SimHub.Plugins.dll");
    expect(project).toContain("GameReaderCommon.dll");
    expect(plugin).toContain("IPlugin, IDataPlugin, IWPFSettingsV2");
    expect(plugin).toContain("public void DataUpdate(PluginManager pluginManager, ref GameData data)");
    expect(plugin).toContain("Task.Run(async () => await SendAsync(envelope, endpoint, token, _shutdown.Token)");
    expect(plugin).not.toContain("GameRawData");
    expect(plugin).not.toContain("async void DataUpdate");
  });

  it("uses central HTTPS with protected credentials and keeps loopback as fallback", () => {
    expect(settings).toContain('RelayBaseUrl = "https://api.3stripemotorsport.cc/functions/v1"');
    expect(settings).toContain("UseCentralRelay = false");
    expect(settings).toContain("SchemaVersion = 0");
    expect(settings).toContain("DeviceTokenProtected");
    expect(plugin).toContain("ProtectedData.Protect");
    expect(plugin).toContain("DataProtectionScope.CurrentUser");
    expect(plugin).toContain('ProductionRelayBaseUrl = "https://api.3stripemotorsport.cc/functions/v1"');
    expect(plugin).toContain("AllowAutoRedirect = false");
    expect(plugin).toContain("Task.Run(async () => await PairCoreAsync(code, _shutdown.Token).ConfigureAwait(false))");
    expect(plugin).toContain("Task.WaitAll");
    expect(plugin).toContain("lock (_settingsGate)");
    expect(plugin).not.toContain("Settings.RelayBaseUrl");
    expect(plugin).toContain("baseUri.IsLoopback");
    expect(plugin).toContain('new Uri(baseUri, "/v1/telemetry")');
    expect(plugin).not.toContain("supabase");
    expect(plugin).not.toContain("adjust_future_stints");
    expect(plugin).toContain("_deviceToken = UnprotectToken");
    expect(plugin).toContain("CancellationTokenSource");
    expect(plugin).toContain("lock (_sendGate)");
    expect(plugin).toContain("Settings.SchemaVersion < 3");
    expect(plugin).toContain("IsGuid(result.DeviceId)");
    expect(plugin).toContain("Guid.TryParseExact");
    expect(plugin).toContain("IsDeviceToken");
    expect(plugin).toContain("HttpCompletionOption.ResponseHeadersRead");
    expect(plugin).toContain("ReadBoundedResponseAsync");
    expect(plugin).toContain("cancellationToken.ThrowIfCancellationRequested()");
  });

  it("keeps the C# DataMember names aligned with protocol v1", () => {
    const telemetryContracts = contracts.split("public sealed class PairingRequest")[0];
    const names = [...telemetryContracts.matchAll(/DataMember\(Name = "([^"]+)"/g)].map((match) => match[1]);
    const expected = [
      ...schema.required,
      ...schema.properties.source.required,
      ...schema.properties.race.required,
      ...schema.properties.telemetry.required,
    ];
    expect(new Set(names)).toEqual(new Set(expected));
    expect(schema.properties.protocolVersion.enum).toContain(2);
    expect(schema.properties.source.properties.connectorId.maxLength).toBe(120);
    expect(schema.properties.source.properties.simHubVersion.maxLength).toBe(60);
    expect(schema.properties.telemetry.properties.sessionTimeSeconds.maximum).toBe(604800);
  });

  it("keeps the one-time pairing response separate from telemetry", () => {
    const pairingRequest = contracts.split("public sealed class PairingRequest")[1].split("public sealed class PairingResponse")[0];
    const pairingResponse = contracts.split("public sealed class PairingResponse")[1];
    for (const name of ["action", "code", "connectorId", "deviceName"]) {
      expect(pairingRequest).toContain(`DataMember(Name = "${name}"`);
    }
    for (const name of ["paired", "deviceToken", "deviceId", "ownerUserId", "error"]) {
      expect(pairingResponse).toContain(`DataMember(Name = "${name}"`);
    }
    expect(pairingResponse).not.toContain('DataMember(Name = "raceId"');
    expect(pairingResponse).not.toContain('DataMember(Name = "teamId"');
  });

  it("protects the local bridge with auth, size and replay guards", () => {
    expect(bridge).toContain("payload is groter dan 32 KB");
    expect(bridge).toContain("ongeldig pairingtoken");
    expect(bridge).toContain("sequence is niet oplopend");
    expect(bridge).toContain("origin niet toegestaan");
    expect(bridge).not.toContain("0.0.0.0");
  });
});
