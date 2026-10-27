import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TyreModelPanel } from "@/features/endurance/pitwall/TyreModelPanel";
import {
  loadTyreModel,
  parseTyreCoverage,
  parseTyreEstimateV2,
  provenanceLabel,
  type TyreRpcClient,
} from "@/features/endurance/pitwall/strategy/tyreEstimateV2";

/**
 * De drie beloftes van het bandenmodel op de pitwall-testpagina:
 *
 * 1. een graad C met een bereik toont rondes (en nooit een percentage),
 * 2. een ontbrekende v2 valt terug op v1 in plaats van de pagina te breken,
 * 3. een lege dekking legt uit waaróm hij leeg is.
 */
describe("bandenmodel v2 op de pitwall-testpagina", () => {
  it("toont bij graad C het bereik in rondes en de herkomst, zonder percentage", () => {
    const estimate = parseTyreEstimateV2({
      grade: "C",
      grade_label: "één stint, ruime marge",
      usable: true,
      stints: 3,
      wear_per_lap: 1.2,
      range_laps: { low: 8, high: 12 },
      basis: {
        car_key: "bmw_m4_gt3",
        track_key: "spa",
        track_temp_c: 22.4,
        rondes_in_basis: 41,
      },
      provenance: "estimated",
      voorlopig: true,
    });

    const view = render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);

    expect(screen.getByText("8–12")).toBeVisible();
    expect(screen.getByText("8–12")).toHaveAttribute("aria-label", "8 tot 12 rondes");
    // Graad en herkomst staan als twee losse woorden, geen kleur: C · schatting.
    expect(screen.getByText("C · schatting")).toBeVisible();
    expect(screen.getByText("geschat")).toBeVisible();
    expect(screen.getByText(/voorlopig bereik/)).toBeVisible();
    expect(screen.getByText(/één stint, ruime marge/)).toBeVisible();
    expect(screen.getByText("3 stints")).toBeVisible();
    // Voorlopig betekent geen percentage: het bereik is het enige getal.
    expect(view.container.textContent).not.toContain("%");
    expect(screen.getByText("bmw_m4_gt3 · spa · 22 °C · 41 rondes in de basis")).toBeVisible();
    view.unmount();
  });

  it("valt terug op v1 als pitwall_tyre_estimate_v2 nog niet bestaat", async () => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "pitwall_tyre_estimate_v2") {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.pitwall_tyre_estimate_v2(p_device_id)",
          },
        };
      }
      return {
        data: {
          grade: "B",
          reason: "single_anchor",
          estimate: {
            weakest: "fl",
            threshold_pct: 40,
            per_corner: {
              fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2, laps_to_threshold: 11 },
            },
          },
          anchor: { lap: 7, laps_since: 3 },
        },
        error: null,
      };
    });

    const result = await loadTyreModel({ rpc } as unknown as TyreRpcClient, {
      deviceId: "device-1",
      eventId: "event-1",
      teamId: "team-1",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "pitwall_tyre_estimate_v2", { p_device_id: "device-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "pitwall_tyre_estimate_v1", {
      p_event_id: "event-1",
      p_team_id: "team-1",
    });
    expect(result.source).toBe("v1");
    expect(result.v2Error).toContain("PGRST202");
    expect(result.estimate?.grade).toBe("B");
    expect(result.estimate?.rangeLaps).toEqual({ low: 10, high: 12 });
    expect(result.estimate?.provenance).toBe("estimated");

    render(<TyreModelPanel estimate={result.estimate} bron={result.source} coverage={[]} />);
    expect(screen.getByText("v1 · terugval")).toBeVisible();
    expect(screen.getByText("10–12")).toBeVisible();
  });

  it("toont het lege antwoord van de RPC als geen data, zonder verzonnen getal", () => {
    // Letterlijk het vroege antwoord van pitwall_tyre_estimate_v2 bij 0 stints.
    const estimate = parseTyreEstimateV2({
      grade: "D",
      grade_label: "geen stints",
      usable: false,
      voorlopig: true,
      stints: 0,
      wear_per_lap: null,
      zwakste_hoek: null,
      range_laps: null,
      wear_now: null,
      threshold_pct: 40,
      basis: null,
      provenance: "unavailable",
    });

    render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);

    expect(screen.getByText("geen data")).toBeVisible();
    expect(screen.getByText("rondes onbekend")).toBeVisible();
    expect(screen.queryByText("0 stints")).not.toBeInTheDocument();
    expect(screen.getByText("Geen basis meegestuurd.")).toBeVisible();
    expect(screen.getByText(/niet bruikbaar voor een advies/)).toBeVisible();
  });

  it("legt bij een lege dekking uit dat één stop één meting oplevert", () => {
    render(<TyreModelPanel estimate={null} bron="geen" coverage={[]} />);

    expect(screen.getByText(/Eén stop levert één meting op/)).toBeVisible();
    expect(screen.getByText(/Nog geen dekking/)).toBeVisible();
    expect(screen.getByText(/Nog geen bandenmodel voor dit apparaat/)).toBeVisible();
  });

  it("toont per auto en circuit het aantal stints met de graad, meest gemeten eerst", () => {
    const coverage = parseTyreCoverage([
      { car_key: "porsche_992", track_key: "monza", stints: 1, wear_labels: 4, grade: "C", laatste_meting: "2026-10-27T20:00:00Z" },
      { car_key: "bmw_m4_gt3", track_key: "spa", stints: 3, wear_labels: 12, grade: "B", laatste_meting: "2026-10-27T21:00:00Z" },
    ]);

    render(<TyreModelPanel estimate={null} bron="geen" coverage={coverage} />);

    const rijen = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rijen).toHaveLength(2);
    expect(rijen[0]).toHaveTextContent("bmw_m4_gt3");
    expect(rijen[0]).toHaveTextContent("3 stints");
    expect(rijen[0]).toHaveTextContent("B");
    expect(rijen[1]).toHaveTextContent("1 stint");
    expect(screen.getByText("2 combinaties")).toBeVisible();
    // Een gevulde lijst hoeft de uitleg niet meer te tonen.
    expect(screen.queryByText(/Eén stop levert één meting op/)).not.toBeInTheDocument();
  });
});

describe("herkomst van het bandengetal", () => {
  it("gebruikt dezelfde vier woorden als de rest van de pitwall", () => {
    expect(provenanceLabel("measured")).toBe("gemeten");
    expect(provenanceLabel("last_known")).toBe("laatst bekend");
    expect(provenanceLabel("estimated")).toBe("geschat");
    expect(provenanceLabel("none")).toBe("geen data");
  });

  it("leest de Nederlandse tokens van de server ook, en valt anders terug op de graad", () => {
    expect(parseTyreEstimateV2({ grade: "A", provenance: "gemeten" })?.provenance).toBe("measured");
    expect(parseTyreEstimateV2({ grade: "B", provenance: "laatst bekend" })?.provenance).toBe("last_known");
    // `unavailable` is het token van de RPC voor "geen data", ook bij graad C.
    expect(parseTyreEstimateV2({ grade: "C", provenance: "unavailable" })?.provenance).toBe("none");
    expect(parseTyreEstimateV2({ grade: "C", provenance: "unavailable" })).toMatchObject({ voorlopig: true });
    // Onbekend token: alleen A is een echte meting, de rest is voorlopig werk.
    expect(parseTyreEstimateV2({ grade: "B", provenance: "iets-nieuws" })?.provenance).toBe("estimated");
    expect(parseTyreEstimateV2({ grade: "D" })?.provenance).toBe("none");
  });

  it("verzint niets bij een ontbrekend veld", () => {
    const estimate = parseTyreEstimateV2({ grade: "C" });
    expect(estimate?.stints).toBeNull();
    expect(estimate?.rangeLaps).toBeNull();
    expect(estimate?.wearPerLapPp).toBeNull();
    expect(estimate?.gradeLabel).toBeNull();
    // Zonder `voorlopig`-veld is alles behalve A voorlopig.
    expect(estimate?.voorlopig).toBe(true);
    // Zonder geldige graad is er geen model.
    expect(parseTyreEstimateV2({ grade: "E" })).toBeNull();
    expect(parseTyreEstimateV2(null)).toBeNull();
  });
});
