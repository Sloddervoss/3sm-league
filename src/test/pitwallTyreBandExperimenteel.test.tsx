import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TyreModelPanel } from "@/features/endurance/pitwall/TyreModelPanel";
import { DecisionBand } from "@/features/endurance/pitwall/DecisionBand";
import { advise } from "@/features/endurance/pitwall/strategy/advise";
import {
  bandExperimenteel,
  naarTyreEstimate,
  parseTyreEstimateV2,
  vanV1,
} from "@/features/endurance/pitwall/strategy/tyreEstimateV2";
import { parseTyreEstimate } from "@/features/endurance/pitwall/strategy/tyreGrade";
import type { StrategySnapshot } from "@/features/endurance/pitwall/strategy/types";

afterEach(cleanup);

/**
 * Het bandenbereik is sinds 31-10 een experiment (besluit Vincent): het blijft
 * zichtbaar — het is het enige getal dat het model rekent — maar het stuurt de
 * beslissing niet meer.
 *
 * Deze tests bewaken de drie beloftes van dat besluit:
 *
 * 1. `basis.band.soort = 'experimenteel'` zet in het modelpaneel de kop
 *    "Experimenteel bereik" en de regel "Experimenteel bereik: stuurt het advies
 *    niet." — met het getal er nog steeds bij.
 * 2. `beslissend = false` leidt nooit tot een groen of beslissend advies: het
 *    bereik komt niet in de bandenrij, niet in de vergelijking en niet in de
 *    beslissing.
 * 3. Ontbrekende velden vallen terug op "niet beslissend". Een server die zwijgt
 *    mag geen advies dragen.
 */

/** Graad B met een bereik en een expliciete band, zoals de RPC hem nu stuurt. */
const schatting = (band: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  parseTyreEstimateV2({
    grade: "B",
    usable: true,
    stints: 2,
    wear_per_lap: 1.2,
    range_laps: { low: 8, high: 12 },
    provenance: "estimated",
    voorlopig: false,
    ...extra,
    basis: {
      car_key: "bmw_m4_gt3",
      track_key: "spa",
      ...(band === undefined ? {} : { band }),
    },
  })!;

/** Dezelfde vorm als de migratie hem stuurt. */
const EXPERIMENTEEL = { soort: "experimenteel", beslissend: false, sigma: 0.4, stints: 2 };
/** De oude, beslissende vorm: alleen een expliciete `true` telt. */
const BESLISSEND = { soort: "modelmarge", beslissend: true, sigma: 0.4, stints: 2 };

/** Lengte van de race: de tank haalt de finish niet, dus er moet een grens zijn. */
const raceSnapshot = (tyreEstimate: ReturnType<typeof naarTyreEstimate>): StrategySnapshot => ({
  raceClockSeconds: 600,
  lapsCompleted: 10,
  currentLapSeconds: 90,
  fuelLitres: 30,
  tankCapacityLitres: 100,
  plannedLaps: 40,
  plannedDurationMinutes: null,
  fuelPerLapSamples: [2.9, 3.0, 2.95, 2.98, 3.01, 2.97, 3.0, 2.96],
  fuelPerLapPrior: null,
  sampleAgeSeconds: 1,
  pitLaneSeconds: 25,
  secondsPerLitre: 1,
  tyreSeconds: 30,
  tyreEstimate,
});

describe("basis.band = experimenteel in het modelpaneel", () => {
  it("toont de kop 'Experimenteel bereik' en de regel dat het advies er niet op rust", () => {
    const view = render(<TyreModelPanel estimate={schatting(EXPERIMENTEEL)} bron="v2" coverage={[]} />);

    // Het getal blijft staan: het bereik is niet verdwenen, het is alleen geen
    // advies meer.
    expect(screen.getByText("8–12")).toBeVisible();
    expect(view.container.querySelector("[data-pitwall-tyre-subtitle]")).toHaveTextContent(
      "Experimenteel bereik",
    );
    expect(screen.getByText("Experimenteel bereik: stuurt het advies niet.")).toBeVisible();
    // De oude, beslissende naam staat er niet meer naast.
    expect(view.container.textContent).not.toMatch(/Modelbereik/);
    expect(view.container.querySelector("[data-pitwall-tyre-modelbereik-note]")).toBeNull();
  });

  it("heet ook experimenteel als de server alleen de soort stuurt", () => {
    const view = render(
      <TyreModelPanel estimate={schatting({ soort: "experimenteel" })} bron="v2" coverage={[]} />,
    );

    expect(view.container.querySelector("[data-pitwall-tyre-subtitle]")).toHaveTextContent(
      "Experimenteel bereik",
    );
    expect(screen.getByText("Experimenteel bereik: stuurt het advies niet.")).toBeVisible();
  });
});

describe("beslissend = false stuurt de beslissing niet", () => {
  it("geeft de beslissingsband geen rondes, geen helling en geen grens", () => {
    const band = naarTyreEstimate(schatting(EXPERIMENTEEL))!;

    expect(band.grade).toBe("B");
    expect(band.experimenteel).toBe(true);
    expect(band.lapsRange).toBeNull();
    expect(band.ratePerLap).toBeNull();
    expect(band.lapsToThreshold).toBeNull();
    expect(band.limitPct).toBeNull();
    expect(band.samples).toBe(0);
  });

  it("houdt het bereik uit de bandenrij van het advies", () => {
    // Hetzelfde antwoord, twee banden: alleen de beslissende vorm laat het
    // bereik (8–12 rondes) in het advies door.
    const beslissend = advise(raceSnapshot(naarTyreEstimate(schatting(BESLISSEND))));
    const experimenteel = advise(raceSnapshot(naarTyreEstimate(schatting(EXPERIMENTEEL))));

    expect(beslissend.tyreFuel?.tyres.range).toEqual({ low: 8, high: 12 });
    expect(experimenteel.tyreFuel?.tyres.range).toBeNull();
    expect(experimenteel.tyreFuel?.tyres.laps).toBeNull();
    // De grens komt dus nooit uit het bereik: geen banden in de binding.
    expect(experimenteel.binding).not.toBe("tyres");
    expect(experimenteel.binding).not.toBe("both");
    expect(experimenteel.reasonCode).not.toBe("tyre_life");
    // En de tank is nog steeds de grens, met een eigen getal.
    expect(experimenteel.tyreFuel?.fuel.laps).not.toBeNull();
  });

  it("zet in de beslissingsband tekst in plaats van rondes", () => {
    const advies = advise(raceSnapshot(naarTyreEstimate(schatting(EXPERIMENTEEL))));
    const view = render(<DecisionBand advice={advies} />);

    const regel = view.container.querySelector("[data-pitwall-tyre-line]")!;
    expect(regel).toHaveAttribute("data-pitwall-tyre-line", "experimenteel");
    expect(regel).toHaveTextContent("geen advies · experimenteel bereik");
    // Geen enkel getal uit het bereik in de band: het bereik was 8–12 rondes.
    expect(regel.textContent).not.toMatch(/\d/);
    // En dus ook geen groene bandenregel: de banden zijn geen advies.
    expect(view.container.querySelector('[data-pitwall-tyre-action="NO_ADVICE"]')).not.toBeNull();
    expect(view.container.querySelector('[data-pitwall-tyre-action="NO_CHANGE"]')).toBeNull();
  });
});

describe("ontbrekende bandvelden zijn niet beslissend", () => {
  it("leest een ontbrekend band-blok als beslissend: false", () => {
    const estimate = schatting(undefined);

    expect(estimate.basis.band).toEqual({ soort: null, beslissend: false, sigma: null, stints: null });
    expect(bandExperimenteel(estimate)).toBe(true);
    expect(naarTyreEstimate(estimate)?.lapsRange).toBeNull();
  });

  it("leest een band zonder beslissend-veld als niet beslissend", () => {
    const zonderVeld = schatting({ soort: "modelmarge" });
    const leegBlok = schatting({});

    expect(zonderVeld.basis.band.beslissend).toBe(false);
    expect(bandExperimenteel(zonderVeld)).toBe(true);
    expect(naarTyreEstimate(zonderVeld)?.lapsRange).toBeNull();

    expect(leegBlok.basis.band.beslissend).toBe(false);
    expect(bandExperimenteel(leegBlok)).toBe(true);
  });

  it("valt voor een v1-antwoord terug op niet beslissend", () => {
    const v1 = parseTyreEstimate({
      grade: "B",
      reason: "single_anchor",
      estimate: {
        weakest: "fl",
        threshold_pct: 40,
        per_corner: { fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2, laps_to_threshold: 11 } },
      },
      anchor: { lap: 7, laps_since: 3 },
    })!;

    const estimate = vanV1(v1);
    expect(estimate.basis.band.beslissend).toBe(false);
    expect(bandExperimenteel(estimate)).toBe(true);
  });

  it("toont de experimentele regel ook bij een ontbrekend band-blok", () => {
    const view = render(<TyreModelPanel estimate={schatting(undefined)} bron="v2" coverage={[]} />);

    expect(view.container.querySelector("[data-pitwall-tyre-subtitle]")).toHaveTextContent(
      "Experimenteel bereik",
    );
    expect(screen.getByText("Experimenteel bereik: stuurt het advies niet.")).toBeVisible();
  });
});
