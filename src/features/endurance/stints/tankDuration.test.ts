import { describe, expect, it } from "vitest";
import { matchCarSpec, normaliseCarName, representativeLapSeconds, tankMinutesFromSpec, type CarSpec } from "./tankDuration";

const huracan: CarSpec = {
  car_id: "lamborghinievogt3",
  display_name: "Lamborghini Huracán GT3 EVO",
  tank_capacity_litres: 104,
  fuel_per_lap_prior_litres: 2.947,
};

const porsche: CarSpec = {
  car_id: "porsche911gt3r992",
  display_name: "Porsche 911 GT3 R (992)",
  tank_capacity_litres: 100,
  fuel_per_lap_prior_litres: 2.8,
};

describe("tankduur uit de autospecificatie", () => {
  it("rekent de tankduur uit liters, verbruik en rondetijd", () => {
    // 104 / 2,947 = 35,29 rondes x 95,67 s = 3376 s = 56,3 minuten
    expect(tankMinutesFromSpec(huracan, 95.67)).toBe(56);
  });

  it("geeft null zonder bruikbare spec in plaats van een verzonnen getal", () => {
    expect(tankMinutesFromSpec(null, 96)).toBeNull();
    expect(tankMinutesFromSpec({ ...huracan, tank_capacity_litres: null }, 96)).toBeNull();
    expect(tankMinutesFromSpec({ ...huracan, fuel_per_lap_prior_litres: 0 }, 96)).toBeNull();
    expect(tankMinutesFromSpec(huracan, null)).toBeNull();
  });

  it("vindt de auto ook als de namen verschillend geschreven zijn", () => {
    expect(matchCarSpec([porsche, huracan], "lamborghini-huracan-gt3-evo")?.car_id).toBe("lamborghinievogt3");
    expect(matchCarSpec([porsche, huracan], "lamborghinievogt3")?.car_id).toBe("lamborghinievogt3");
    expect(matchCarSpec([porsche, huracan], "porsche-911-gt3-r-992")?.car_id).toBe("porsche911gt3r992");
    expect(matchCarSpec([porsche, huracan], null)).toBeNull();
    expect(matchCarSpec([porsche, huracan], "ferrari-296-gt3")).toBeNull();
  });

  it("negeert accenten en leestekens bij het vergelijken", () => {
    expect(normaliseCarName("Lamborghini Huracán GT3 EVO")).toBe("lamborghinihuracangt3evo");
  });

  it("neemt de mediaan van de beste rondes, niet de uitschieter", () => {
    expect(representativeLapSeconds([95.3, 97.2])).toBeCloseTo(96.25, 2);
    expect(representativeLapSeconds([95.3])).toBe(95.3);
    expect(representativeLapSeconds([95.3, 97.2, 96.1])).toBe(96.1);
    expect(representativeLapSeconds([null, undefined, 0])).toBeNull();
  });
});
