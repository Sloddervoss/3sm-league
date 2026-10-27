import { describe, expect, it } from "vitest";
import { pitBoxRepair } from "./pitService";

/**
 * De reparatiestrook: drie woorden, en elk woord heeft één oorzaak.
 *
 * De tests hangen aan de gevallen die op de baan echt voorkomen: een kapotte
 * auto die niet weg mag, een optionele reparatie, een connector die zweeg, en
 * de gewone stop zonder schade — die laatste hoort géén strook te geven.
 */

describe("pitBoxRepair", () => {
  it("geeft niets buiten de pitstraat", () => {
    expect(pitBoxRepair({ onPitRoad: false, requiredRepairSeconds: 42, optionalRepairSeconds: 0 })).toBeNull();
    // Een meting die zweeg is geen "niet in de box" en ook geen "wel": niets.
    expect(pitBoxRepair({ onPitRoad: null, requiredRepairSeconds: 42, optionalRepairSeconds: null })).toBeNull();
  });

  it("noemt een verplichte reparatie verplicht, met de tijd", () => {
    expect(pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: 42.4, optionalRepairSeconds: 0 })).toEqual({
      phase: "IN_BOX",
      repair: "mandatory",
      repairSeconds: 42.4,
    });
  });

  it("noemt een optionele reparatie optioneel als verplicht nul is", () => {
    // Nul verplichte tijd is een meting: de auto mag weg. Dan is de optionele
    // tijd tijdwinst en geen voorwaarde.
    expect(pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: 0, optionalRepairSeconds: 8 })).toEqual({
      phase: "IN_BOX",
      repair: "optional",
      repairSeconds: 8,
    });
  });

  it("zegt onbekend als de verplichte tijd ontbreekt", () => {
    expect(pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: null, optionalRepairSeconds: 8 })).toEqual({
      phase: "IN_BOX",
      repair: "unknown",
      repairSeconds: null,
    });
  });

  it("verzint geen tijd bij onbekend", () => {
    // Ook als de optionele tijd er wél is: welke van de twee de auto kost is
    // dan niet te zeggen, dus tonen we geen seconden.
    const uitkomst = pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: undefined, optionalRepairSeconds: 8 });
    expect(uitkomst?.repairSeconds).toBeNull();
  });

  it("geeft geen strook als er niets te repareren is", () => {
    // 0 én 0 is gemeten "niets aan de hand", geen onbekend en geen 0 seconden.
    expect(pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: 0, optionalRepairSeconds: 0 })).toBeNull();
  });

  it("negeert onbruikbare getallen in plaats van ze als tijd te lezen", () => {
    expect(pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: -1, optionalRepairSeconds: null })?.repair).toBe(
      "unknown",
    );
    expect(
      pitBoxRepair({ onPitRoad: true, requiredRepairSeconds: Number.NaN, optionalRepairSeconds: null })?.repair,
    ).toBe("unknown");
  });
});
