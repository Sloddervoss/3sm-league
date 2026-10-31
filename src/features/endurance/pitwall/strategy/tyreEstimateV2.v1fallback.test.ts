import { describe, expect, it } from "vitest";
import type { TyreEstimate } from "./tyreGrade";
import {
  loadTyreModel,
  naarTyreEstimate,
  parseTyreEstimateV2,
  vanV1,
  type TyreRpcClient,
} from "./tyreEstimateV2";

/**
 * De v1-terugval is fail-closed.
 *
 * v1 kent geen actualiteit, geen context en geen prior. Een antwoord van v1 mag
 * daarom nooit als bruikbaar advies doorgaan: geen rondes, geen bruikbaar, en
 * altijd voorlopig. Deze tests bewaken precies die drie velden en het pad dat ze
 * zou omzeilen (`naarTyreEstimate`, dat de beslissingsband voedt).
 */
const v1MetBereik = (): TyreEstimate => ({
  grade: "B",
  source: "server",
  weakest: "fl",
  restPct: 61,
  ratePerLap: 1.8,
  marginPp: 0.2,
  sigmaLaps: 1,
  lapsToThreshold: 11,
  lapsRange: { low: 10, high: 12 },
  pctRange: null,
  cause: null,
  causeLap: null,
  causeLaps: null,
  limitPct: 40,
  samples: 2,
});

describe("v1-terugval is niet-bruikbaar en voorlopig", () => {
  it("levert geen rondes-advies, ook niet als v1 een bereik stuurt", () => {
    const estimate = vanV1(v1MetBereik());

    expect(estimate.grade).toBe("B");
    expect(estimate.usable).toBe(false);
    expect(estimate.voorlopig).toBe(true);
    expect(estimate.rangeLaps).toBeNull();
    // De helling mag staan (dat is wat v1 zegt), maar zonder bereik.
    expect(estimate.wearPerLapPp).toBe(1.8);
  });

  it("geeft de beslissingsband geen getallen om op te adviseren", () => {
    const estimate = vanV1(v1MetBereik());
    const band = naarTyreEstimate(estimate);

    // De graad mag door (die zegt v1), maar zonder bereik, helling of advies.
    expect(band?.grade).toBe("B");
    expect(band?.lapsRange).toBeNull();
    expect(band?.ratePerLap).toBeNull();
    expect(band?.lapsToThreshold).toBeNull();
    expect(band?.limitPct).toBeNull();
    expect(band?.samples).toBe(0);
  });

  it("houdt graad A uit v1 ook voorlopig: v1 heeft geen actualiteitsbewijs", () => {
    const estimate = vanV1({ ...v1MetBereik(), grade: "A", lapsRange: { low: 10, high: 12 } });

    expect(estimate.usable).toBe(false);
    expect(estimate.voorlopig).toBe(true);
    expect(estimate.rangeLaps).toBeNull();
  });

  it("valt bij een v2-fout terug op v1 zonder dat het antwoord bruikbaar wordt", async () => {
    const rpc = async (fn: string) =>
      fn === "pitwall_tyre_estimate_v2"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : {
            data: {
              grade: "B",
              estimate: { weakest: "fl", per_corner: { fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2 } } },
            },
            error: null,
          };

    const result = await loadTyreModel({ rpc } as unknown as TyreRpcClient, {
      deviceId: "device-1",
      eventId: "event-1",
      teamId: "team-1",
    });

    expect(result.source).toBe("v1");
    expect(result.estimate?.usable).toBe(false);
    expect(result.estimate?.voorlopig).toBe(true);
    expect(result.estimate?.rangeLaps).toBeNull();
    // De fout blijft zichtbaar: een terugval mag hem niet wegpoetsen.
    expect(result.v2Error).toContain("42501");
  });
});

describe("de nieuwe redenen en context uit v2", () => {
  it("leest context_onbekend en prior_variatie_onbekend", () => {
    const estimate = parseTyreEstimateV2({
      grade: "B",
      usable: false,
      voorlopig: true,
      wear_per_lap: 1.25,
      range_laps: null,
      basis: {
        car_key: null,
        track_key: null,
        context: { car_key: null, track_key: null, onbekend: true },
        gedeeld: { rate: 2, stints: 2, rondes: 18, accounts: 2, spreiding: null, spreiding_bekend: false },
        redenen: ["prior_variatie_onbekend", "context_onbekend"],
      },
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.basis.context?.onbekend).toBe(true);
    expect(estimate?.basis.redenen).toEqual(["context_onbekend", "prior_variatie_onbekend"]);
    expect(estimate?.basis.gedeeld?.spreidingBekend).toBe(false);
    expect(estimate?.rangeLaps).toBeNull();
  });

  it("leest de spreiding van de prior als de server hem wel kent", () => {
    const estimate = parseTyreEstimateV2({
      grade: "B",
      usable: true,
      basis: {
        car_key: "bmw",
        track_key: "spa:gp",
        context: { car_key: "bmw", track_key: "spa:gp", onbekend: false },
        gedeeld: { rate: 2, stints: 2, rondes: 18, accounts: 2, spreiding: 0.7071, spreiding_bekend: true },
      },
    });

    expect(estimate?.basis.context).toEqual({ carKey: "bmw", trackKey: "spa:gp", onbekend: false });
    expect(estimate?.basis.gedeeld?.spreiding).toBe(0.7071);
    expect(estimate?.basis.gedeeld?.spreidingBekend).toBe(true);
  });

  it("leidt onbekend af als de server het veld weglaat maar sleutels mist", () => {
    const estimate = parseTyreEstimateV2({
      grade: "C",
      basis: { context: { car_key: "bmw" } },
    });

    expect(estimate?.basis.context?.onbekend).toBe(true);
  });
});
