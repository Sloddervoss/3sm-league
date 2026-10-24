import { describe, expect, it } from "vitest";
import { applyDeltaFrame, diffFrames, frameSize, nextFrame } from "../../supabase/functions/_shared/delta";

// Bewust los getypeerd: het protocol gaat over paden, niet over een schema.
const basis: Record<string, any> = {
  fuel: { fuelLitres: 60, capacity: 104 },
  timing: { completedLaps: 10, lastLapTimeSeconds: 97.2 },
  vehicle: { speedKph: 210.4, gear: 4 },
  opponents: [
    { id: "a", gap: 1.2 },
    { id: "b", gap: -0.4 },
  ],
};

describe("delta-protocol", () => {
  it("stuurt niets als er niets veranderd is", () => {
    const frame = nextFrame(basis, structuredClone(basis), 2);
    expect(frame.kind).toBe("delta");
    expect(frame.kind === "delta" && frame.ops).toEqual([]);
    expect(frameSize(frame)).toBeLessThan(40);
  });

  it("stuurt alleen het veld dat veranderd is", () => {
    const na = structuredClone(basis);
    na.vehicle.speedKph = 214.9;
    const frame = nextFrame(basis, na, 3);
    expect(frame.kind === "delta" && frame.ops).toEqual([["vehicle.speedKph", 214.9]]);
    expect(frameSize(frame)).toBeLessThan(60);
  });

  it("zet een delta terug op de basis", () => {
    const na = structuredClone(basis);
    na.vehicle.speedKph = 214.9;
    na.timing.completedLaps = 11;
    na.opponents[1].gap = -0.9;

    const frame = nextFrame(basis, na, 4);
    const terug = applyDeltaFrame(basis, frame.kind === "delta" ? frame.ops : []);
    expect(terug).toEqual(na);
  });

  it("laat de basis ongemoeid", () => {
    const voor = structuredClone(basis);
    applyDeltaFrame(basis, [["vehicle.speedKph", 300]]);
    expect(basis).toEqual(voor);
  });

  it("neemt een heel nieuw veld in één op", () => {
    const na = structuredClone(basis);
    na.vehicle.drs = true;
    const frame = nextFrame(basis, na, 5);
    expect(frame.kind === "delta" && frame.ops).toEqual([["vehicle.drs", true]]);
  });

  it("vervangt een kortere lijst in zijn geheel", () => {
    const na = { ...basis, opponents: [basis.opponents[0]] };
    const frame = nextFrame(basis, na, 6);
    const terug = applyDeltaFrame(basis, frame.kind === "delta" ? frame.ops : []);
    expect(terug.opponents).toEqual([basis.opponents[0]]);
  });

  it("weigert een pad dat niet bestaat", () => {
    expect(() => applyDeltaFrame(basis, [["remmen.temperatuur", 400]])).toThrow(/bestaat niet/);
  });

  it("begint met een keyframe als er geen basis is", () => {
    const frame = nextFrame(null, basis, 1);
    expect(frame.kind).toBe("keyframe");
    expect(frameSize(frame)).toBeGreaterThan(150);
  });

  it("vergelijkt diep, niet op referentie", () => {
    const kopie = structuredClone(basis);
    expect(diffFrames(basis, kopie)).toEqual([]);
  });
});
