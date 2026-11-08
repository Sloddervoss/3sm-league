import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RaceTelemetryStrip } from "@/features/endurance/pitwall/RaceTelemetryStrip";
import { LiveTrackPanel } from "@/features/endurance/pitwall/LiveTrackPanel";
import { PacePanel } from "@/features/endurance/pitwall/PacePanel";
import { FuelPanel } from "@/features/endurance/pitwall/FuelPanel";
import { StintDriverPanel } from "@/features/endurance/pitwall/StintDriverPanel";
import { StandingsWidget } from "@/features/endurance/pitwall/StandingsWidget";
import { VehicleTelemetryPanel } from "@/features/endurance/pitwall/VehicleTelemetryPanel";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import { finiteNonNegative, lapDifference, plannedProgress } from "@/features/endurance/pitwall/elementPresentation";
import { fixtureEvents, fixtureStints, fixtureStrategy, fixtureV3 } from "../../docs/pitwall-look/preview/fixtures";
import { parseWeatherTelemetry } from "../../supabase/functions/_shared/weatherTelemetry";
import { naarTyreEstimate, parseTyreEstimateV2 } from "@/features/endurance/pitwall/strategy/tyreEstimateV2";

const props = { standings: deriveStandings(fixtureV3, 40), ownCarLabel: "Eigen team", ownCarNumber: "45" };

describe("Elementen: afleidingen zijn presentatie, geen verzonnen bronnen", () => {
  it.each([undefined, null, NaN, Infinity, -1, "2"])("weigert ongeldig getal %s", n => expect(finiteNonNegative(n)).toBe(false));
  it("behoudt nul en een expliciete rondetijdreferentie", () => {
    expect(finiteNonNegative(0)).toBe(true);
    expect(lapDifference(103.162, 102.513)).toBeCloseTo(0.649);
    expect(lapDifference(0, 102)).toBeNull();
    expect(lapDifference(103, NaN)).toBeNull();
  });
  it("toont verstreken sessietijd inclusief nul, geen noemer", () => {
    render(<RaceTelemetryStrip v3={{ session: { sessionTimeSeconds: 0 }, timing: { lastLapTimeSeconds: 103.162, bestLapTimeSeconds: 102.513 } }} live />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("▲ +0.649 s")).toBeInTheDocument();
    expect(screen.queryByText(/\/ 28/)).not.toBeInTheDocument();
  });
  it("benoemt opgeslagen racetotalen als plan, nooit als gemeten noemer", () => {
    render(<RaceTelemetryStrip v3={fixtureV3} live plannedLaps={360} plannedDurationMinutes={360} />);
    expect(screen.getByText("Ronde · plan 360")).toBeInTheDocument();
    expect(screen.getByText("Sessie · plan 6:00:00")).toBeInTheDocument();
  });
  it("toont offline geen sessieklok of rondedelta", () => {
    render(<RaceTelemetryStrip v3={fixtureV3} live={false} />);
    expect(screen.queryByText("Verstreken sessie")).not.toBeInTheDocument();
    expect(screen.queryByText("Δ laatste − beste")).not.toBeInTheDocument();
  });
  it.each([0, 12.5, 100])("toont bewezen vocht %s zonder rubber als weer te interpreteren", wetness => {
    render(<LiveTrackPanel live fallbackTrack="Onbekend" v3={{ weather: parseWeatherTelemetry({ trackWetnessPct: wetness }), tyres: fixtureV3.tyres }} />);
    expect(screen.getByText(wetness === 0 ? "Baan droog (0%)" : `Baanvocht ${wetness.toFixed(0)}%`)).toBeInTheDocument();
    expect(screen.queryByText(/m\/s/)).not.toBeInTheDocument();
  });
  it("regen false bewijst niet droog; ontbrekend vocht blijft onbekend", () => {
    render(<LiveTrackPanel live fallbackTrack="Onbekend" v3={{ weather: parseWeatherTelemetry({ isRaining: false }) }} />);
    expect(screen.getByText("Geen regen gemeld")).toBeInTheDocument();
    expect(screen.queryByText(/Baan droog/)).not.toBeInTheDocument();
  });
  it("omgeving blijft offline verborgen", () => {
    render(<LiveTrackPanel live={false} fallbackTrack="Onbekend" v3={{ ...fixtureV3, weather: parseWeatherTelemetry({ trackWetnessPct: 0 }) }} />);
    expect(screen.queryByText(/Baan droog/)).not.toBeInTheDocument();
  });
});

describe("Timing: uitsluitend tabs met inhoud en juiste scope", () => {
  it("verbergt tabs zonder bron", () => {
    render(<StandingsWidget {...props} />);
    expect(screen.queryByRole("button", { name: "Stints" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pitstops" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gebeurtenissen" })).not.toBeInTheDocument();
  });
  it("filtert klasse zonder de momentopname als volledig veld te presenteren", () => {
    render(<StandingsWidget {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Klasse" }));
    fireEvent.click(screen.getByRole("button", { name: "LMP2" }));
    expect(screen.getByText("F. Jansen")).toBeInTheDocument();
    expect(screen.queryByText("M. vd Berg")).not.toBeInTheDocument();
    expect(screen.getByText(/geen volledig klassement/)).toBeInTheDocument();
  });
  it("toont echte teamplanning en eigen opgeslagen pit/events, geen verzonnen tellers", () => {
    render(<StandingsWidget {...props} plannedStints={fixtureStints} events={fixtureEvents} />);
    fireEvent.click(screen.getByRole("button", { name: "Stints" }));
    expect(screen.getByText(/Eigen team · planning/)).toBeInTheDocument();
    expect(screen.getByText(/Jason · 32 ronden gepland/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pitstops" }));
    expect(screen.getByText(/geen volledig wedstrijdtotaal/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Gebeurtenissen" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(fixtureEvents.length);
    fireEvent.click(screen.getByRole("button", { name: "Live timing" }));
    expect(screen.getByRole("region", { name: "Live timing — scrollbaar klassement" })).toBeInTheDocument();
  });
  it("herstelt actieve tab wanneer zijn bron verdwijnt", () => {
    const { rerender } = render(<StandingsWidget {...props} events={fixtureEvents} />);
    fireEvent.click(screen.getByRole("button", { name: "Gebeurtenissen" }));
    rerender(<StandingsWidget {...props} events={[]} />);
    expect(screen.getByRole("button", { name: "Live timing" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Pace: uitsluitend echte reeksen", () => {
  it("maakt actuele snelheid of laatste-minus-beste nooit tot een grafiek", () => {
    render(<PacePanel strategy={null} pace={null} v3={fixtureV3} live />);
    fireEvent.click(screen.getByRole("button", {name:"Snelheid"}));
    expect(screen.getByText("Geen gecontroleerde reeks beschikbaar.")).toBeInTheDocument();
    expect(screen.queryByText("187 km/h")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Delta"}));
    expect(screen.queryByText("+0.649 s")).not.toBeInTheDocument();
    expect(screen.getByText(/vaste opgenomen referentie/)).toBeInTheDocument();
  });
  it("houdt tabs bereikbaar en vertelt eerlijk dat de reeks ontbreekt", () => {
    render(<PacePanel strategy={fixtureStrategy} pace={null} live={false} v3={fixtureV3} />);
    fireEvent.click(screen.getByRole("button", {name:"Snelheid"}));
    expect(screen.getByText("Geen gecontroleerde reeks beschikbaar.")).toBeInTheDocument();
  });
});

describe("Planning en bestaand strategievenster", () => {
  it("rekent uitsluitend expliciet geplande tijd, klemt voortgang", () => {
    const stint = { ...fixtureStints[0], actual_start_at: null, actual_end_at: null, original_start_at: "2026-11-01T10:00:00Z", original_end_at: "2026-11-01T11:00:00Z" };
    expect(plannedProgress(stint, Date.parse("2026-11-01T10:30:00Z"))).toEqual({ elapsed: 1800, remaining: 1800, percent: 50 });
    expect(plannedProgress(stint, Date.parse("2026-11-01T12:00:00Z"))?.percent).toBe(100);
    expect(plannedProgress({ ...stint, original_end_at: "ongeldig" }, Date.now())).toBeNull();
  });
  it("benoemt tijd als planning, samples niet als gereden ronden", () => {
    render(<StintDriverPanel strategy={fixtureStrategy} plannedStints={fixtureStints.slice(1)} currentStint={fixtureStints[0]} driverName="Vincent" nowMs={Date.parse(fixtureV3.capturedAt!)} />);
    expect(screen.getByText(/geen gemeten stinttimer/)).toBeInTheDocument();
    expect(screen.getByText(/wissel gepland over/)).toBeInTheDocument();
    expect(screen.getByText(/22 geldige samples/)).toBeInTheDocument();
  });
  it("neemt venster ongewijzigd over en laat alle planningsregels bereikbaar", () => {
    render(<FuelPanel strategy={fixtureStrategy} window={{ earliestLap: 149, latestLap: 163, stopsRequired: 1, lapsOnFuel: 21, saveRequired: false, lapsToSave: 0 }} plannedStints={fixtureStints} />);
    expect(screen.getByText("R149–163")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Pitwindow ronde 149 tot 163, huidige ronde 142/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Volledige stintplanning" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Δ vs racegem. \+0.040 L\/r/)).toBeInTheDocument();
  });
  it("spreekt zichzelf niet tegen als de tank zonder reserve genoeg is en met reserve niet", () => {
    const krap = {
      ...fixtureStrategy,
      current_fuel_litres: 30,
      fuel_per_lap_litres: 3,
      race_fuel_per_lap_litres: null,
      fuel_to_finish_litres: 30,
      fuel_sufficient_to_finish: true,
      fuel_laps_remaining: 10,
      valid_fuel_sample_count: 12,
    };
    render(<FuelPanel strategy={krap} />);
    // De bestaande regel rekent zonder reserve; de scenarioregel zegt dat erbij.
    expect(screen.getByText("Voldoende (zonder reserve)")).toBeInTheDocument();
    expect(screen.getByText(/Met 0.5 ronde reserve: 1.5 L tekort/)).toBeInTheDocument();
  });
  it("verzint zonder bron geen venster of stintlijst", () => {
    render(<FuelPanel strategy={fixtureStrategy} />);
    expect(screen.queryByText(/Pitwindow/)).not.toBeInTheDocument();
    expect(screen.queryByText("Stintplanning")).not.toBeInTheDocument();
  });
});

describe("Banden: restbalken en bestaand experimenteel model", () => {
  it("balk is restpercentage en geen slijtageschatting", () => {
    render(<VehicleTelemetryPanel v3={fixtureV3} live />);
    expect(screen.getByRole("meter", { name: "LV resterend" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getAllByRole("meter")).toHaveLength(4);
  });
  it("laat een modelbereik experimenteel en niet adviserend", () => {
    const model = parseTyreEstimateV2({ grade: "B", usable: true, range_laps: { low: 12, high: 18 }, provenance: "estimated" });
    expect(model).not.toBeNull();
    render(<VehicleTelemetryPanel v3={fixtureV3} live tyreModel={model} tyreEstimate={naarTyreEstimate(model)} />);
    expect(screen.getByText(/Experimenteel bereik: 12–18 rondes/)).toBeInTheDocument();
    expect(screen.getByText(/stuurt geen advies/)).toBeInTheDocument();
  });
  it("toont offline geen modellevensduur of restbalken", () => {
    render(<VehicleTelemetryPanel v3={fixtureV3} live={false} />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/Modelbereik/)).not.toBeInTheDocument();
  });
});
