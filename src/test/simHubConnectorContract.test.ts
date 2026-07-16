import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pluginRoot = "tools/simhub-plugin/3SM.EnduranceConnector";
const plugin = readFileSync(`${pluginRoot}/EnduranceConnectorPlugin.cs`, "utf8");
const contracts = readFileSync(`${pluginRoot}/TelemetryContracts.cs`, "utf8");
const project = readFileSync(`${pluginRoot}/3SM.EnduranceConnector.csproj`, "utf8");
const bridge = readFileSync("tools/simhub-bridge/server.mjs", "utf8");
const schema = JSON.parse(readFileSync("contracts/simhub-telemetry.v1.schema.json", "utf8"));

describe("3SM SimHub connector spike contract", () => {
  it("targets the documented SimHub plugin shape on .NET Framework 4.8", () => {
    expect(project).toContain("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>");
    expect(project).toContain("SimHub.Plugins.dll");
    expect(project).toContain("GameReaderCommon.dll");
    expect(plugin).toContain("IPlugin, IDataPlugin, IWPFSettingsV2");
    expect(plugin).toContain("public void DataUpdate(PluginManager pluginManager, ref GameData data)");
    expect(plugin).toContain("Task.Run(async () => await SendAsync(envelope)");
    expect(plugin).not.toContain("GameRawData");
    expect(plugin).not.toContain("async void DataUpdate");
  });

  it("keeps the plugin loopback-only and advisory", () => {
    expect(plugin).toContain("baseUri.IsLoopback");
    expect(plugin).toContain('new Uri(baseUri, "/v1/telemetry")');
    expect(plugin).not.toContain("supabase");
    expect(plugin).not.toContain("3stripemotorsport.cc");
    expect(plugin).not.toContain("adjust_future_stints");
  });

  it("keeps the C# DataMember names aligned with protocol v1", () => {
    const names = [...contracts.matchAll(/DataMember\(Name = "([^"]+)"/g)].map((match) => match[1]);
    const expected = [
      ...schema.required,
      ...schema.properties.source.required,
      ...schema.properties.race.required,
      ...schema.properties.telemetry.required,
    ];
    expect(new Set(names)).toEqual(new Set(expected));
    expect(schema.properties.protocolVersion.const).toBe(1);
  });

  it("protects the local bridge with auth, size and replay guards", () => {
    expect(bridge).toContain("payload is groter dan 32 KB");
    expect(bridge).toContain("ongeldig pairingtoken");
    expect(bridge).toContain("sequence is niet oplopend");
    expect(bridge).toContain("origin niet toegestaan");
    expect(bridge).not.toContain("0.0.0.0");
  });
});
