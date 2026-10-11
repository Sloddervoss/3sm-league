import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/SettingsControl.cs", "utf8");
const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const project = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/3SM.EnduranceConnector.csproj", "utf8");

describe("SimHub plugin settings UI resources", () => {
  it("legt per navigatieknop een stabiele paneelindex vast", () => {
    // De lusvariabele mag nooit zelf in de lambda belanden (sluitingsfout: elke knop
    // zou dan het laatste paneel openen). Sinds 0.5.6.0 heet de kopie 'index'.
    expect(settings).toMatch(/var \w+ = i;/);
    expect(settings).toMatch(/SelectPane\(\w+\)/);
    expect(settings).not.toContain("SelectPane(i);");
  });

  it("kwalificeert embedded resources met de assembly namespace", () => {
    expect(plugin).toContain('typeof(EnduranceConnectorPlugin).Namespace + "." + resourceName');
    expect(project).toContain('<EmbeddedResource Include="Assets\\plugin-icon.png" />');
    expect(project).toContain('<EmbeddedResource Include="Assets\\wordmark.png" />');
  });

  it("leidt isInCar af uit de echte SimHub GameData-statussen", () => {
    expect(plugin).toContain("var isInCar = running && data.NewData != null && !data.NewData.Spectating && !data.GameInMenu && !data.GameReplay;");
    expect(plugin).toContain("CaptureV3(pluginManager, data, isInCar, out observation)");
    expect(plugin).toContain("IsInCar = isInCar");
    expect(plugin).not.toContain("IsInCar = true");
  });

  it("leest coureur, auto, posities en vlag primair uit de echte SimHub SDK", () => {
    expect(plugin).toContain("snapshot.PlayerName");
    expect(plugin).toContain("snapshot.CarModel");
    expect(plugin).toContain("snapshot.Position");
    expect(plugin).toContain("player.PositionInClass");
    expect(plugin).toContain("snapshot.Flag_Name");
    expect(plugin).toContain("snapshot.Flag_Checkered");
    expect(plugin).toContain("GetNullableString(manager, Settings.CurrentDriverNameProperty)");
  });

  it("maakt de koppeling met de 3SM-site dominant en dynamisch zichtbaar", () => {
    // Sinds 0.5.6.0 via UiKit.Eyebrow (dat de tekst zelf naar hoofdletters omzet).
    expect(settings).toMatch(/Eyebrow\("Apparaatstatus"\)/i);
    expect(settings).toContain('"✓ Gekoppeld met de 3SM-site"');
    expect(settings).toContain('"Nog niet gekoppeld aan de 3SM-site"');
    expect(settings).toContain("pairingCode.IsEnabled = !paired");
    expect(settings).toContain("pairButton.IsEnabled = !paired");
    expect(settings).toContain('Binding("IsPaired")');
    expect(settings).toContain('"✓ Gekoppeld met de 3SM-site"');
  });

  it("toont de lokaal verzonden snapshot en een handmatige updatecontrole", () => {
    expect(plugin).toContain('public string LeftMenuTitle { get { return "3SM"; } }');
    expect(plugin).toContain("public string LastTelemetrySummary");
    expect(plugin).toContain("SetLastTelemetrySummary(envelope)");
    expect(plugin).toContain("public Task CheckForUpdateNowAsync()");
    expect(plugin).toContain("CheckForUpdateAsync(_shutdown.Token, true)");
    // Sinds 0.5.6.0 heten de stijlen UiKit.Secondary/Primary; de knoppen zelf blijven.
    expect(settings).toContain('"Nu op updates controleren"');
    expect(settings).toContain('"Update installeren en SimHub herstarten"');
    expect(settings).toContain('Binding("UpdateAvailable")');
    expect(settings).toContain('Binding("LastTelemetrySummary")');
    expect(settings).toContain('Binding("UpdateStatus")');
    expect(plugin).toContain("InstallAvailableUpdateAsync");
    expect(plugin).toContain('Verb = "runas"');
    expect(plugin).not.toMatch(/File\.(Copy|Move|Replace)\(/);
  });
});
