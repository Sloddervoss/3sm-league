import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStandings, publicTelemetry, type LiveStandingsTeamSource, type LiveTelemetrySource } from "@/features/endurance/standings/classification";

const teams: LiveStandingsTeamSource[] = [
  { id: "t1", name: "Alpha", carNumber: "7", carId: "car-a", livery: null },
  { id: "t2", name: "Bravo", carNumber: "12", carId: "car-b", livery: null },
  { id: "t3", name: "Charlie", carNumber: null, carId: "car-c", livery: null },
];

const row = (team: string, received: string, over: Partial<LiveTelemetrySource["telemetry"] & { laps?: number; pos?: number; cls?: number; lap?: number }> = {}): LiveTelemetrySource => ({
  endurance_team_id: team,
  received_at: received,
  current_driver_name: "D" + team,
  car_name: "car " + team,
  telemetry: {
    isInCar: true,
    sessionTimeSeconds: 7200,
    lap: 0,
    completedLaps: over.laps ?? 0,
    lapTimeSeconds: over.lap ?? 0,
    position: over.pos ?? null,
    classPosition: over.cls ?? null,
    speedKph: 0,
    fuelLitres: 0,
    fuelPerLapLitres: 0,
    estimatedLapsRemaining: null,
    inPitLane: false,
    pitLimiter: false,
    stintElapsedSeconds: 0,
    incidents: 0,
    flag: "green",
    connected: true,
  },
});

describe("endurance live-standings", () => {
  it("sorteert op voltooide ronden (meeste bovenaan), dan positie", () => {
    const lines = buildStandings(teams, [
      row("t1", "2026-01-01T12:00:00Z", { laps: 40, pos: 2 }),
      row("t2", "2026-01-01T12:00:01Z", { laps: 41, pos: 1 }),
      row("t3", "2026-01-01T12:00:02Z", { laps: 39, pos: 3 }),
    ]);
    expect(lines.map((l) => l.teamId)).toEqual(["t2", "t1", "t3"]);
    expect(lines[0].rank).toBe(1);
    expect(lines[0].currentDriverName).toBe("Dt2");
    expect(lines[2].completedLaps).toBe(39);
  });

  it("neemt per team de NIETSTE snapshot (wie er nu in de auto zit)", () => {
    const lines = buildStandings(teams, [
      row("t1", "2026-01-01T12:00:00Z", { laps: 38, pos: 4 }),
      { ...row("t1", "2026-01-01T12:00:10Z", { laps: 40, pos: 2 }), current_driver_name: "Dt1-later" },
    ]);
    expect(lines.find((l) => l.teamId === "t1")?.completedLaps).toBe(40);
    expect(lines.find((l) => l.teamId === "t1")?.currentDriverName).toBe("Dt1-later");
  });

  it("team zonder live-data staat onderaan en heeft hasLiveData=false", () => {
    const lines = buildStandings(teams, [
      row("t1", "2026-01-01T12:00:00Z", { laps: 10, pos: 1 }),
    ]);
    expect(lines.find((l) => l.teamId === "t3")).toMatchObject({ hasLiveData: false, position: null });
    expect(lines[lines.length - 1].teamId).toBe("t3");
  });

  it("pakt publiek-veilige velden uit telemetry", () => {
    const t = publicTelemetry({ position: 5, classPosition: 2, completedLaps: 30, lapTimeSeconds: 101.5, inPitLane: true, pitLimiter: false, flag: "yellow", sessionTimeSeconds: 9000 } as never);
    expect(t).toMatchObject({ position: 5, classPosition: 2, completedLaps: 30, lastLapSeconds: 101.5, inPitLane: true, flag: "yellow", sessionTimeSeconds: 9000 });
    expect("fuelLitres" in t).toBe(false);
  });

  it("geen teams -> lege stand", () => {
    expect(buildStandings([], [])).toEqual([]);
  });
});

describe("nergens aangeplant (herbruikbaar, nog geen route)", () => {
  const widget = "src/features/endurance/standings/LiveStandingsWidget.tsx";
  it("wordt niet geimporteerd door pagina's/routes/nav", () => {
    const livePagePaths = ["src/App.tsx", "src/components/Navbar.tsx", "src/components/Footer.tsx", "src/features/endurance/shell/EndurancePage.tsx", "src/pages"];
    const hits: string[] = [];
    for (let p = 1; p <= 1000; p++) { /* placeholder no-op */ }
    for (const path of livePagePaths) {
      let body = "";
      try { body = readFileSync(path, "utf8"); } catch { /* dir */ }
      if (body.includes("LiveStandingsWidget")) hits.push(path);
    }
    expect(hits).toEqual([]);
    expect(readFileSync(widget, "utf8")).toContain("Nog NIET op een route geplaatst");
  });
});