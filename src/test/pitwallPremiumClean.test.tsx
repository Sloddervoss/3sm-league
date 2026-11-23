import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StandingsDerivation, StandingsRow } from "@/features/endurance/pitwall/standings";
import { PremiumMasthead } from "@/features/endurance/pitwall/test-premium/PremiumMasthead";
import { PremiumTimingPanel } from "@/features/endurance/pitwall/test-premium/PremiumTimingPanel";

const row = (id: string, position: number, extra: Partial<StandingsRow> = {}): StandingsRow => ({
  id,
  position,
  classPosition: position,
  lap: 48,
  carNumber: id,
  driverName: `Coureur ${id}`,
  teamName: `Team ${id}`,
  carClass: "GT3",
  lastLapSeconds: 102.4,
  bestLapSeconds: 101.8,
  gapToPlayerSeconds: position * 3.4,
  connected: true,
  isPlayer: false,
  ...extra,
});

const standings = (rows: StandingsRow[], extra: Partial<StandingsDerivation> = {}): StandingsDerivation => ({
  overallPosition: rows.find((entry) => entry.isPlayer)?.position ?? null,
  classPosition: null,
  rows,
  ahead: null,
  behind: null,
  aheadTrend: null,
  behindTrend: null,
  noData: false,
  ...extra,
});

const masthead = (overrides: Partial<Parameters<typeof PremiumMasthead>[0]> = {}) => (
  <PremiumMasthead
    deviceName="DESKTOP-GR4NN00"
    trackLabel="Road America · Full Course"
    driverName="Vincent"
    carName="Porsche 911 GT3 R"
    teamName="3SM Endurance"
    carNumber="17"
    connector="0.7.6.4"
    lastSeen="nu"
    telemetryAge="nu"
    state="live"
    sectorCount={3}
    refreshing={false}
    {...overrides}
  />
);

describe("premium pitwall clean hierarchy", () => {
  it("houdt de circuitnaam als zichtbaar hoofdonderwerp en de apparaatnaam als context", () => {
    const view = render(masthead());
    expect(view.container.querySelector(".ptp-mast-track")?.textContent).toBe("Road America · Full Course");
    expect(view.container.querySelector(".ptp-mast-title h1")?.textContent).toContain("DESKTOP-GR4NN00");
    // Zes bestaande meta-slots blijven aanwezig; circuit en team zijn daarvan
    // de bewust niet nóg eens getoonde kopieën.
    expect(view.container.querySelectorAll(".ptp-meta > div")).toHaveLength(6);
  });

  it("noemt de timingtoren één keer en houdt de live-stand lokaal zichtbaar", () => {
    const rows = [row("11", 1), row("12", 2), row("17", 3, { isPlayer: true, driverName: "Vincent" })];
    render(
      <PremiumTimingPanel
        v3={null}
        standings={standings(rows)}
        ownCarLabel="Porsche 911 GT3 R"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled={false}
        layoutSectorCount={3}
      />,
    );

    expect(screen.queryByText("Timing tower")).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Live timing" })).toHaveLength(1);
    expect(document.querySelector(".ptp-timing-count")?.textContent).toBe("3 auto's");
    expect(screen.getByText("Alles")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Klasse" })).toBeNull();
    expect(screen.getByRole("button", { name: "Live timing" })).toBeTruthy();
  });

  it("zet positie en gap vóór de rondetijden en houdt de gap een benoemde kolom", () => {
    const rows = [row("11", 1), row("17", 2, { isPlayer: true })];
    const view = render(
      <PremiumTimingPanel
        v3={null}
        standings={standings(rows)}
        ownCarLabel="Porsche 911 GT3 R"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled={false}
        layoutSectorCount={3}
      />,
    );

    const headers = [...view.container.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
    expect(headers.slice(0, 6)).toEqual(["P", "#", "Coureur", "Gap", "Laatste", "Beste"]);
    expect(screen.getByRole("columnheader", { name: "Gap tot jou" })).toBeTruthy();
  });

  it("vat de snapshot-uitleg samen zonder de bestaande waarschuwing te verliezen", () => {
    render(
      <PremiumTimingPanel
        v3={null}
        standings={standings([row("11", 1)])}
        ownCarLabel="Porsche 911 GT3 R"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled={false}
        layoutSectorCount={3}
      />,
    );

    expect(screen.getByText(/Snapshot, geen volledig klassement/)).toBeTruthy();
    expect(screen.getByText(/geen inhaalclaim/)).toBeTruthy();
    expect(screen.queryByText(/Scroll voor alle rijen/)).toBeNull();
  });
});
