import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const resultPosterPath = path.resolve(process.cwd(), "bot/resultPoster.js");

const source = () => readFileSync(resultPosterPath, "utf8");

describe("Discord result poster design", () => {
  it("labels the lowest-incident stat as cleanest drive", () => {
    expect(source()).toContain("title: 'CLEANEST DRIVE'");
    expect(source()).not.toContain("title: 'CLEAN DRIVE'");
  });

  it("uses a compact full track title instead of an ellipsis for Daytona", () => {
    expect(source()).toContain("Daytona International Speedway");
    expect(source()).toContain("Daytona Intl. Speedway");
  });

  it("keeps the primary trophy above the P1 card instead of overlapping it", () => {
    expect(source()).toContain("trophyIcon({ x: 800, y: 238, scale: 0.82");
    expect(source()).toContain("podiumCard({ x: 585, y: 392");
  });

  it("keeps non-primary podium names and points above the bottom gap bar", () => {
    expect(source()).toContain("const bottomBarHeight = primary ? 42 : 34;");
    expect(source()).toContain("const nonPrimaryNameY = 106;");
    expect(source()).toContain("const nonPrimaryPointsY = 136;");
  });
});
