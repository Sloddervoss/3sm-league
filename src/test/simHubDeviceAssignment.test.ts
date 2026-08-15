import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pairing = readFileSync("supabase/functions/simhub-pair/index.ts", "utf8");
const version = readFileSync("supabase/functions/simhub-version/index.ts", "utf8");
const relay = readFileSync("src/lib/centralSimHubRelay.ts", "utf8");
const panel = readFileSync("src/features/endurance/devices/DeviceAssignmentPanel.tsx", "utf8");
const workspace = readFileSync("src/features/endurance/workspace/RaceWorkspace.tsx", "utf8");
const connectorSettings = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/ConnectorSettings.cs", "utf8");
const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const contracts = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContracts.cs", "utf8");

describe("SimHub device assignment + safe update check (Fase 4)", () => {
  it("exposes super-admin assign/clear edge actions backed by server-side RPCs", () => {
    expect(pairing).toContain('action === "assign"');
    expect(pairing).toContain("simhub_assign_device_to_entry");
    expect(pairing).toContain('action === "clear"');
    expect(pairing).toContain("simhub_clear_device_entry");
    expect(pairing).toContain("super_admin_required");
  });

  it("wires server-side assignment helpers and per-team filtering in the relay", () => {
    expect(relay).toContain("assignCentralSimHubDevice");
    expect(relay).toContain("clearCentralSimHubDeviceAssignment");
    expect(relay).toContain("listCentralSimHubDevicesForTeam");
    expect(relay).toContain("endurance_team_id ?? row.team_id");
  });

  it("adds the devices tab reachable by endurance-managers and super-admin", () => {
      expect(workspace).toContain('id: "devices", label: "Apparaten"');
      expect(workspace).toContain("<DeviceAssignmentPanel event={event} />");
      expect(panel).toContain("useAuth()");
      expect(panel).toContain("assignCentralSimHubDevice");
      expect(panel).toContain("isSuperAdmin || isEnduranceManager");
      expect(panel).toContain("Device-koppeling is beschikbaar voor endurance-managers en super-admin.");
      expect(panel).not.toContain('from("');
    });

  it("serves a read-only version endpoint with no credentials or writes", () => {
    expect(version).toContain("simhub-version");
    expect(version).toContain("SIMHUB_PLUGIN_VERSION");
    expect(version).toContain("SIMHUB_PLUGIN_SHA256");
    expect(version).toContain("SIMHUB_PLUGIN_BYTE_LENGTH");
    expect(version).toContain("SIMHUB_PLUGIN_FILE_NAME");
    expect(version).toContain("SIMHUB_PLUGIN_SIGNATURE");
    expect(version).toContain("dllUrl");
    expect(version).toContain("sha256");
    expect(version).not.toContain("service_role");
    expect(version).not.toContain("Bearer");
  });

  it("plugin update-check is rate-limited and stages replacement in an external updater", () => {
    expect(connectorSettings).toContain("LastKnownRemoteVersion");
    expect(connectorSettings).toContain("LastVersionCheckUtc");
    expect(connectorSettings).toContain("LastKnownRemoteDllUrl");
    expect(connectorSettings).toContain("LastKnownRemoteSha256");
    expect(connectorSettings).toContain("LastKnownRemoteByteLength");
    expect(connectorSettings).toContain("LastKnownRemoteSignature");
    expect(plugin).toContain("CheckForUpdateAsync");
    expect(plugin).toContain("TimeSpan.FromHours(24)");
    expect(plugin).toContain("klaar voor éénklik-installatie");
    expect(plugin).toContain("IsAllowedPluginDownload");
    expect(plugin).toContain("ExtractUpdater");
    expect(plugin).not.toMatch(/File\.(Copy|Move|Replace)\(/);
    expect(contracts).toContain("public sealed class VersionResponse");
    expect(contracts).toContain('DataMember(Name = "sha256"');
    expect(contracts).toContain('DataMember(Name = "signature"');
  });
});
