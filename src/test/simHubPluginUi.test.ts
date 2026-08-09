import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/SettingsControl.cs", "utf8");
const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const project = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/3SM.EnduranceConnector.csproj", "utf8");

describe("SimHub plugin settings UI resources", () => {
  it("legt per navigatieknop een stabiele paneelindex vast", () => {
    expect(settings).toContain("var paneIndex = i;");
    expect(settings).toContain("SelectPane(paneIndex)");
    expect(settings).not.toContain("SelectPane(i);");
  });

  it("kwalificeert embedded resources met de assembly namespace", () => {
    expect(plugin).toContain('typeof(EnduranceConnectorPlugin).Namespace + "." + resourceName');
    expect(project).toContain('<EmbeddedResource Include="Assets\\plugin-icon.png" />');
    expect(project).toContain('<EmbeddedResource Include="Assets\\wordmark.png" />');
  });

  it("leidt isInCar af uit de echte SimHub GameData-statussen", () => {
    expect(plugin).toContain("var isInCar = running && data.NewData != null && !data.NewData.Spectating && !data.GameInMenu && !data.GameReplay;");
    expect(plugin).toContain("Capture(pluginManager, central, isInCar)");
    expect(plugin).toContain("IsInCar = isInCar");
    expect(plugin).not.toContain("IsInCar = true");
  });

  it("toont de lokaal verzonden snapshot en een handmatige updatecontrole", () => {
    expect(plugin).toContain('public string LeftMenuTitle { get { return "3SM"; } }');
    expect(plugin).toContain("public string LastTelemetrySummary");
    expect(plugin).toContain("SetLastTelemetrySummary(envelope)");
    expect(plugin).toContain("public Task CheckForUpdateNowAsync()");
    expect(plugin).toContain("CheckForUpdateAsync(_shutdown.Token, true)");
    expect(settings).toContain('StyleSecondary("Nu op updates controleren")');
    expect(settings).toContain('new Binding("LastTelemetrySummary")');
    expect(settings).toContain('new Binding("UpdateStatus")');
    expect(plugin).not.toMatch(/File\.(Copy|Move)|Process\.Start/);
  });
});
