import { describe, expect, it } from "vitest";
import {
  derivePitStops,
  derivePitStopMeasurement,
  medianPitLaneSeconds,
  resolvePitStopMeasurement,
  type PitFlagSample,
} from "./pitStops";

const t = (seconden: number): string => new Date(Date.UTC(2026, 9, 24, 18, 0, 0) + seconden * 1000).toISOString();

const rij = (seconden: number, vlag: boolean | null): PitFlagSample => ({
  captured_at: t(seconden),
  in_pit_lane: vlag,
});

/** Eén schone stop: op 10 s naar binnen, op 70 s eruit. */
const eenStop = (): PitFlagSample[] => [rij(0, false), rij(10, true), rij(40, true), rij(70, false)];

describe("derivePitStops — pit-in en pit-uit uit de vlag", () => {
  it("meet één stop als het verschil tussen de overgangen", () => {
    const stops = derivePitStops(eenStop());
    expect(stops).toHaveLength(1);
    expect(stops[0].seconds).toBe(60);
    expect(stops[0].entryAt).toBe(t(10));
    expect(stops[0].exitAt).toBe(t(70));
  });

  it("geeft niets terug als de vlag nergens gevuld is", () => {
    // De race van 24-10: 260 events, in_pit_lane overal null.
    const events = Array.from({ length: 260 }, (_, i) => rij(i, null));
    expect(derivePitStops(events)).toEqual([]);
    expect(derivePitStopMeasurement(events).pitLaneSeconds).toBeNull();
    expect(derivePitStopMeasurement(events).source).toBe("none");
  });

  it("geeft niets terug bij een lege lijst", () => {
    expect(derivePitStopMeasurement([]).pitLaneSeconds).toBeNull();
  });

  it("verzint geen pit-in als de data al binnen de pit begint", () => {
    const stops = derivePitStops([rij(0, true), rij(40, true), rij(60, false)]);
    expect(stops).toEqual([]);
  });

  it("laat een stop zonder pit-uit open staan zonder duur", () => {
    const meting = derivePitStopMeasurement([rij(0, false), rij(10, true), rij(60, true)]);
    expect(meting.stops).toHaveLength(1);
    expect(meting.stops[0].exitAt).toBeNull();
    expect(meting.stops[0].seconds).toBeNull();
    expect(meting.pitLaneSeconds).toBeNull();
    expect(meting.source).toBe("none");
  });

  it("telt een flikkering van een seconde niet als stop", () => {
    const meting = derivePitStopMeasurement([rij(0, false), rij(10, true), rij(11, false)]);
    expect(meting.stops).toHaveLength(1);
    expect(meting.stops[0].seconds).toBeNull();
    expect(meting.pitLaneSeconds).toBeNull();
    expect(meting.sampleCount).toBe(0);
  });

  it("negeert een onderbreking langer dan een kwartier als stop", () => {
    const meting = derivePitStopMeasurement([rij(0, false), rij(10, true), rij(911, false)]);
    expect(meting.stops[0].seconds).toBeNull();
    expect(meting.pitLaneSeconds).toBeNull();
  });

  it("laat een gemiste waarneming de stop niet breken", () => {
    const stops = derivePitStops([rij(0, false), rij(10, true), rij(30, null), rij(70, false)]);
    expect(stops[0].seconds).toBe(60);
  });

  it("sorteert zelf, ook als de rijen nieuwste-eerst binnenkomen", () => {
    const stops = derivePitStops([...eenStop()].reverse());
    expect(stops).toHaveLength(1);
    expect(stops[0].seconds).toBe(60);
  });

  it("meet twee stops los van elkaar", () => {
    const stops = derivePitStops([
      rij(0, false), rij(10, true), rij(70, false),
      rij(100, false), rij(140, true), rij(230, false),
    ]);
    expect(stops.map((stop) => stop.seconds)).toEqual([60, 90]);
  });
});

describe("medianPitLaneSeconds", () => {
  it("neemt de middelste waarde bij een oneven aantal", () => {
    const stops = derivePitStops([
      rij(0, false), rij(10, true), rij(50, false),      // 40
      rij(100, false), rij(110, true), rij(190, false),  // 80
      rij(300, false), rij(310, true), rij(450, false),  // 140
    ]);
    expect(medianPitLaneSeconds(stops)).toBe(80);
  });

  it("middelt de twee middelste waarden bij een even aantal", () => {
    const stops = derivePitStops([
      rij(0, false), rij(10, true), rij(50, false),      // 40
      rij(100, false), rij(110, true), rij(190, false),  // 80
    ]);
    expect(medianPitLaneSeconds(stops)).toBe(60);
  });

  it("laat één uitschieter de mediaan niet verschuiven", () => {
    const stops = derivePitStops([
      rij(0, false), rij(10, true), rij(50, false),        // 40
      rij(100, false), rij(110, true), rij(150, false),    // 40
      rij(200, false), rij(210, true), rij(250, false),    // 40
      rij(300, false), rij(310, true), rij(610, false),    // 300 (reparatie)
    ]);
    expect(medianPitLaneSeconds(stops)).toBe(40);
  });

  it("telt alleen bruikbare stops mee", () => {
    const meting = derivePitStopMeasurement([
      rij(0, false), rij(10, true), rij(50, false),
      rij(100, false), rij(110, true), // open, telt niet mee
    ]);
    expect(meting.sampleCount).toBe(1);
    expect(meting.pitLaneSeconds).toBe(40);
  });
});

describe("resolvePitStopMeasurement — server boven tijdlijn", () => {
  it("gebruikt de gemeten waarde van de server", () => {
    const meting = resolvePitStopMeasurement({
      pit_loss: { pitLaneSeconds: 62.4, sampleCount: 3, source: "measured", lastStopAt: t(700) },
      pit_lane_seconds: 62.4,
      timeline: [],
    });
    expect(meting.pitLaneSeconds).toBe(62.4);
    expect(meting.sampleCount).toBe(3);
    expect(meting.source).toBe("measured");
    expect(meting.lastStopAt).toBe(t(700));
  });

  it("leidt uit de tijdlijn af als de server niets heeft", () => {
    const meting = resolvePitStopMeasurement({
      pit_loss: { pitLaneSeconds: null, sampleCount: 0, source: "none", lastStopAt: null },
      timeline: eenStop().map((rij) => ({ captured_at: rij.captured_at, in_pit_lane: rij.in_pit_lane })),
    });
    expect(meting.pitLaneSeconds).toBe(60);
    expect(meting.source).toBe("measured");
  });

  it("valt terug op de tijdlijn als de oudere functie geen pit_loss-blok geeft", () => {
    const meting = resolvePitStopMeasurement({
      timeline: eenStop().map((rij) => ({ captured_at: rij.captured_at, in_pit_lane: rij.in_pit_lane })),
    });
    expect(meting.pitLaneSeconds).toBe(60);
  });

  it("geeft none terug als er niets te meten valt", () => {
    const meting = resolvePitStopMeasurement({ pit_loss: null, pit_lane_seconds: null, timeline: [] });
    expect(meting).toEqual({ pitLaneSeconds: null, sampleCount: 0, source: "none", lastStopAt: null, stops: [] });
  });

  it("overleeft een leeg antwoord", () => {
    expect(resolvePitStopMeasurement(undefined).source).toBe("none");
    expect(resolvePitStopMeasurement(null).pitLaneSeconds).toBeNull();
  });

  it("neemt een losse pit_lane_seconds zonder blok over", () => {
    const meting = resolvePitStopMeasurement({ pit_lane_seconds: 58.2 });
    expect(meting.pitLaneSeconds).toBe(58.2);
    expect(meting.source).toBe("measured");
  });
});
