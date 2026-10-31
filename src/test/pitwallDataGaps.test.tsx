import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTyreTelemetry } from "../../supabase/functions/_shared/tyreTelemetry";
import { snapshotDto } from "../../supabase/functions/_shared/simhubAggregates";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";
import baseline from "../../tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json";
import { VehicleTelemetryPanel } from "../features/endurance/pitwall/VehicleTelemetryPanel";
import { LiveTrackPanel } from "../features/endurance/pitwall/LiveTrackPanel";
import type { V3Normalized } from "../features/endurance/pitwall/pitwallHelpers";

vi.mock("../features/endurance/pitwall/TrackProjection", () => ({ TrackProjection: () => null }));
afterEach(cleanup);
const tyreData = (raw: unknown) => ({ tyres: parseTyreTelemetry(raw) });
const panels = (v3: V3Normalized | null, live = true) => render(<>
  <VehicleTelemetryPanel v3={v3} live={live} />
  <LiveTrackPanel v3={v3} live={live} fallbackTrack="Testcircuit" />
</>);

describe("pitwall datagaten: bestaande genormaliseerde metingen", () => {
  it("behoudt de velden door de echte V3-parser en snapshot-DTO", () => {
    const normalized = parseTelemetryV3Envelope(baseline);
    const snapshot = snapshotDto(normalized);
    expect(snapshot.tyres).toEqual(normalized.tyres);
    panels(snapshot as V3Normalized);
    expect(screen.getByText("Compound-ID 4")).toBeTruthy();
    expect(screen.getByText("2 gebruikt")).toBeTruthy();
    expect(screen.getByText("3 beschikbaar")).toBeTruthy();
    expect(screen.getByText("Baan 31.5 °C")).toBeTruthy();
    expect(screen.getByText("Lucht 21.3 °C")).toBeTruthy();
    expect(screen.getByText("Rubber: moderate usage")).toBeTruthy();
    expect(screen.queryByText(/Compound M/)).toBeNull();
  });
  it("toont nul als meting en vertaalt uitsluitend de beschikbare-setsentinel", () => {
    panels(tyreData({ compoundId: 0, sets: { used: 0, available: 255 }, environment: { trackTempC: 0, airTempC: -5 } }));
    expect(screen.getByText("Compound-ID 0")).toBeTruthy();
    expect(screen.getByText("0 gebruikt")).toBeTruthy();
    expect(screen.getByText("onbeperkt beschikbaar")).toBeTruthy();
    expect(screen.getByText("Baan 0.0 °C")).toBeTruthy();
    expect(screen.getByText("Lucht -5.0 °C")).toBeTruthy();
  });
  it.each([null, {}, { tyres: null }, tyreData({ sets: { used: null } })])("verzint geen waarden bij ontbrekende blokken: %j", v3 => {
    const { container } = panels(v3);
    expect(container.querySelector("[data-pitwall-tyre-sets]")).toBeNull();
    expect(container.querySelector("[data-pitwall-environment]")).toBeNull();
  });
  it("houdt gedeeltelijke metingen gedeeltelijk", () => {
    panels(tyreData({ compoundId: 7, environment: { airTempC: 18 } }));
    expect(screen.getByText("Compound-ID 7")).toBeTruthy();
    expect(screen.getByText("Lucht 18.0 °C")).toBeTruthy();
    expect(screen.queryByText(/Sets:|Baan .*°C/)).toBeNull();
  });
  it("verbergt alle nieuwe metingen offline", () => {
    const { container } = panels(tyreData(baseline.tyres), false);
    expect(container.querySelector("[data-pitwall-tyre-sets]")).toBeNull();
    expect(container.querySelector("[data-pitwall-environment]")).toBeNull();
  });
  it("verbergt eigen banden buiten de auto, niet de sessieomgeving", () => {
    panels({ ...tyreData(baseline.tyres), session: { isInCar: false } });
    expect(screen.queryByText("Compound-ID 4")).toBeNull();
    expect(screen.getByText("Baan 31.5 °C")).toBeTruthy();
  });
  it.each([NaN, Infinity, -1, 256, 1.5])("toont ongeldige tellers niet: %s", n => {
    const v3 = tyreData({ compoundId: 1 });
    v3.tyres!.compoundId = n;
    v3.tyres!.sets.used = n;
    v3.tyres!.sets.available = n;
    const { container } = panels(v3);
    expect(container.querySelector("[data-pitwall-tyre-sets]")).toBeNull();
  });
  it.each([NaN, Infinity, -41, 101])("toont ongeldige temperatuur niet: %s", n => {
    const v3 = tyreData({ environment: { trackTempC: 20 } });
    v3.tyres!.environment.trackTempC = n;
    const { container } = panels(v3);
    expect(container.querySelector("[data-pitwall-environment]")).toBeNull();
  });
});
