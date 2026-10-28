import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { TyreModelPanel } from "@/features/endurance/pitwall/TyreModelPanel";
import { RawTelemetryDetails } from "@/features/endurance/pitwall/RawTelemetryDetails";
import { gradeWord } from "@/features/endurance/pitwall/tyreCopy";
import { useTyreModel, tyreModelQueryKey } from "@/features/endurance/pitwall/useTyreModel";
import {
  loadTyreModel,
  naarTyreEstimate,
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
    // Graad en herkomst staan als twee losse woorden, geen kleur: C · zwak
    // naast geschat. Het graadwoord zegt hoe sterk de basis is, het
    // herkomstwoord waar het getal vandaan komt — ze zijn nooit elkaars gelijke.
    expect(screen.getByText("C · zwak")).toBeVisible();
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

/**
 * De fouten en randen die de eerste versie van dit paneel inslikte: een
 * mislukte call die als "nog geen meting" las, een waarschuwing over een bereik
 * dat niet bestond, en getallen die als advies lazen terwijl de server ze zelf
 * buiten advies had gezet.
 */
describe("fouten en randen van het bandenmodel", () => {
  it.each([
    ["42501: permission denied for function pitwall_tyre_estimate_v2"],
    ["PGRST202: Could not find the function public.pitwall_tyre_estimate_v2"],
    ["TypeError: fetch failed"],
  ])("toont de fout %s als foutregel in plaats van 'nog geen meting'", (fout) => {
    const view = render(<TyreModelPanel estimate={null} bron="geen" coverage={[]} v2Error={fout} />);

    const regel = view.container.querySelector('[data-pitwall-tyre-range="fout"]');
    expect(regel).not.toBeNull();
    expect(regel).toHaveTextContent("Bandenmodel niet geladen");
    expect(regel).toHaveTextContent(fout);
    expect(regel).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/Nog geen bandenmodel/)).not.toBeInTheDocument();
    view.unmount();
  });

  it("houdt de fout zichtbaar als de v1-terugval wél een antwoord had", async () => {
    const result = await loadTyreModel(
      {
        rpc: vi.fn(async (fn: string) =>
          fn === "pitwall_tyre_estimate_v2"
            ? { data: null, error: { code: "42501", message: "permission denied" } }
            : { data: { grade: "B", estimate: { weakest: "fl", per_corner: { fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2 } } } }, error: null },
        ),
      } as unknown as TyreRpcClient,
      { deviceId: "device-1", eventId: "event-1", teamId: "team-1" },
    );

    const view = render(
      <TyreModelPanel estimate={result.estimate} bron={result.source} coverage={[]} v2Error={result.v2Error} />,
    );

    expect(screen.getByText("v1 · terugval")).toBeVisible();
    const regel = view.container.querySelector("[data-pitwall-tyre-v2-error]");
    expect(regel).toHaveTextContent("42501");
    view.unmount();
  });

  it("leest een mislukte dekking niet als een lege dekking", () => {
    const view = render(
      <TyreModelPanel
        estimate={null}
        bron="geen"
        coverage={[]}
        coverageError="42501: permission denied for table tyre_coverage"
      />,
    );

    const regel = view.container.querySelector("[data-pitwall-tyre-coverage-error]");
    expect(regel).toHaveTextContent("Dekking laden mislukt");
    expect(regel).toHaveAttribute("role", "alert");
    expect(screen.getByText("mislukt")).toBeVisible();
    expect(screen.queryByText("nog leeg")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nog geen dekking/)).not.toBeInTheDocument();
    view.unmount();
  });

  it("waarschuwt alleen over een voorlopig bereik dat er echt is", () => {
    const zonderBereik = parseTyreEstimateV2({ grade: "D", voorlopig: true, stints: 0, range_laps: null });
    const eerste = render(<TyreModelPanel estimate={zonderBereik} bron="v2" coverage={[]} />);
    expect(eerste.container.querySelector("[data-pitwall-tyre-provisional]")).toBeNull();
    eerste.unmount();

    const metBereik = parseTyreEstimateV2({ grade: "B", usable: true, voorlopig: true, range_laps: { low: 10, high: 12 } });
    const tweede = render(<TyreModelPanel estimate={metBereik} bron="v2" coverage={[]} />);
    expect(tweede.container.querySelector("[data-pitwall-tyre-provisional]")).not.toBeNull();
    tweede.unmount();
  });

  it("toont 'laden' tot de eerste uitslag er is, in de kop én in de regel", () => {
    const view = render(<TyreModelPanel estimate={null} bron="geen" coverage={[]} modelLoading />);

    expect(view.container.querySelector('[data-pitwall-tyre-range="laden"]')).toHaveTextContent("Bandenmodel laden");
    // De kop mag tijdens de eerste load geen conclusie trekken: "geen model"
    // is een uitslag, niet een tussenstand.
    expect(screen.getByText("laden")).toBeVisible();
    expect(screen.queryByText("geen model")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nog geen bandenmodel/)).not.toBeInTheDocument();
    view.unmount();
  });

  it("noemt het bereik pas voorlopig als dat bereik er ook staat", () => {
    // Graad B zonder bereik: de kop zegt "rondes onbekend", dus een ondertitel
    // over een voorlopig bereik waarschuwt voor een getal dat er niet is.
    const zonderBereik = parseTyreEstimateV2({ grade: "B", usable: true, range_laps: null });
    const eerste = render(<TyreModelPanel estimate={zonderBereik} bron="v2" coverage={[]} />);

    expect(screen.getByText("rondes onbekend")).toBeVisible();
    expect(screen.queryByText(/voorlopig bereik/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gemeten bereik/)).not.toBeInTheDocument();
    expect(eerste.container.querySelector("[data-pitwall-tyre-subtitle]")).toBeNull();
    eerste.unmount();

    const metBereik = parseTyreEstimateV2({ grade: "B", usable: true, range_laps: { low: 10, high: 12 } });
    const tweede = render(<TyreModelPanel estimate={metBereik} bron="v2" coverage={[]} />);
    expect(screen.getByText(/voorlopig bereik/)).toBeVisible();
    tweede.unmount();
  });

  it("opent het raw-paneel: het details-element krijgt echt [open]", () => {
    const view = render(<RawTelemetryDetails value={{ speed: 212, gear: 5 }} />);
    const details = view.container.querySelector("details")!;
    const summary = screen.getByText(/Toon raw telemetrie/);

    // Dicht: geen [open], en dus geen inhoud — dezelfde staat als voor de fix.
    expect(details).not.toHaveAttribute("open");
    expect(view.container.querySelector("pre")).toBeNull();

    fireEvent.click(summary);

    // De kern van de bevinding: zonder [open] blijft de inhoud in een echte
    // browser verborgen, ook als de state al op "open" staat.
    expect(details).toHaveAttribute("open");
    expect(view.container.querySelector("pre")).toHaveTextContent("212");
    expect(screen.getByText(/Verberg raw telemetrie/)).toBeVisible();

    fireEvent.click(screen.getByText(/Verberg raw telemetrie/));

    expect(details).not.toHaveAttribute("open");
    expect(view.container.querySelector("pre")).toBeNull();
    view.unmount();
  });

  it("zet naast de graad nooit een tweede woord dat de herkomst tegenspreekt", () => {
    // De drie gevallen uit de keuring: PCBART (A met herkomst geschat), DESKTOP
    // (C met herkomst gemeten) en CAT-PC (A met een onbekend bereik). Het
    // graadwoord zegt hoe sterk de basis is, de herkomst waar het getal vandaan
    // komt; ze zijn nooit elkaars gelijke en dus nooit elkaars tegendeel.
    const gevallen = [
      { grade: "A", provenance: "estimated", label: "A · sterk", herkomst: "geschat" },
      { grade: "C", provenance: "measured", label: "C · zwak", herkomst: "gemeten" },
      { grade: "A", provenance: "measured", label: "A · sterk", herkomst: "gemeten" },
    ] as const;

    for (const geval of gevallen) {
      const estimate = parseTyreEstimateV2({
        grade: geval.grade,
        usable: true,
        stints: 3,
        wear_per_lap: 1.1,
        range_laps: geval.grade === "A" ? { low: 11, high: 14 } : { low: 8, high: 12 },
        provenance: geval.provenance,
      });

      const view = render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);
      const badges = view.container.querySelector("[data-pitwall-tyre-grade-label]")!.parentElement!;

      expect(within(badges).getByText(geval.label)).toBeVisible();
      expect(badges.querySelector("[data-pitwall-tyre-provenance-label]")).toHaveTextContent(geval.herkomst);
      // De herkomst wint: hij staat er altijd, ook als de graad sterk is.
      expect(geval.label).not.toContain(geval.herkomst);
      view.unmount();
    }
  });

  it("deelt geen enkel woord tussen de vier graden en de vier herkomsten", () => {
    const graadWoorden = (["A", "B", "C", "D"] as const).map((graad) => gradeWord(graad));
    const herkomstWoorden = (["measured", "last_known", "estimated", "none"] as const).map((herkomst) =>
      provenanceLabel(herkomst),
    );

    expect(new Set(graadWoorden).size).toBe(4);
    expect(graadWoorden.filter((woord) => herkomstWoorden.includes(woord))).toEqual([]);
  });

  it("zegt bij graad A één keer 'gemeten': als herkomst, niet als graad", () => {
    const estimate = parseTyreEstimateV2({
      grade: "A",
      usable: true,
      stints: 4,
      wear_per_lap: 1.1,
      range_laps: { low: 11, high: 14 },
      basis: { car_key: "bmw_m4_gt3", track_key: "spa", track_temp_c: 21, rondes_in_basis: 30 },
      provenance: "measured",
      voorlopig: false,
    });

    const view = render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);

    const badge = view.container.querySelector("[data-pitwall-tyre-grade-label]")!;
    expect(badge).toHaveTextContent("A · sterk");
    expect(badge).not.toHaveTextContent("gemeten");

    const badges = badge.parentElement!;
    expect(within(badges).getAllByText(/gemeten/)).toHaveLength(1);
    // De herkomst blijft ook machineleesbaar aanwezig.
    expect(badges.querySelector("[data-pitwall-tyre-provenance]")).toHaveAttribute(
      "data-pitwall-tyre-provenance",
      "measured",
    );
    view.unmount();
  });

  it("toont bij graad C geen tempo, ook niet als de server een helling meestuurt", () => {
    const c = parseTyreEstimateV2({ grade: "C", stints: 2, wear_per_lap: 1.2, range_laps: { low: 8, high: 12 } });
    const eerste = render(<TyreModelPanel estimate={c} bron="v2" coverage={[]} />);
    expect(eerste.container.textContent).not.toContain("/r");
    eerste.unmount();

    const b = parseTyreEstimateV2({ grade: "B", usable: true, stints: 2, wear_per_lap: 1.2, range_laps: { low: 8, high: 12 } });
    const tweede = render(<TyreModelPanel estimate={b} bron="v2" coverage={[]} />);
    expect(tweede.container.textContent).toContain("−1,2/r");
    tweede.unmount();
  });

  it("leest een bereik van 0–0 rondes als 'geen rondes over'", () => {
    const estimate = parseTyreEstimateV2({
      grade: "B",
      usable: true,
      stints: 3,
      range_laps: { low: 0, high: 0 },
      voorlopig: true,
    });

    const view = render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);

    expect(screen.getByText("geen rondes over")).toBeVisible();
    expect(screen.queryByText("0–0")).not.toBeInTheDocument();
    expect(screen.queryByText("rondes onbekend")).not.toBeInTheDocument();
    expect(view.container.querySelector("[data-pitwall-tyre-range]")).toHaveAttribute(
      "data-pitwall-tyre-range",
      "geen",
    );
    view.unmount();
  });

  it("toont een bereik dat de server zelf onbruikbaar noemt niet als antwoord", () => {
    const estimate = parseTyreEstimateV2({
      grade: "B",
      usable: false,
      voorlopig: true,
      stints: 1,
      wear_per_lap: 0.1,
      range_laps: { low: 295, high: 1181 },
      provenance: "estimated",
    });

    const view = render(<TyreModelPanel estimate={estimate} bron="v2" coverage={[]} />);

    const kop = view.container.querySelector("[data-pitwall-tyre-range]")!;
    expect(kop).toHaveAttribute("data-pitwall-tyre-range", "onbekend");
    expect(kop).toHaveTextContent("rondes onbekend");
    expect(kop).not.toHaveTextContent("295");

    // Het getal staat er nog wel, maar gedempt en met de reden erbij.
    const ruw = view.container.querySelector("[data-pitwall-tyre-range-raw]")!;
    expect(ruw).toHaveTextContent("295–1181");
    expect(ruw.className).toContain("text-gray-500");
    expect(ruw).toHaveTextContent("niet bruikbaar als advies");
    // Een onbruikbaar bereik is geen voorlopig advies.
    expect(view.container.querySelector("[data-pitwall-tyre-provisional]")).toBeNull();
    view.unmount();
  });

  it("geeft een onbruikbaar bereik niet door aan de beslissingsband", () => {
    const bruikbaar = naarTyreEstimate(
      parseTyreEstimateV2({ grade: "B", usable: true, wear_per_lap: 1.2, range_laps: { low: 10, high: 12 } }),
    );
    expect(bruikbaar?.lapsRange).toEqual({ low: 10, high: 12 });

    const onbruikbaar = naarTyreEstimate(
      parseTyreEstimateV2({ grade: "B", usable: false, wear_per_lap: 0.1, range_laps: { low: 295, high: 1181 } }),
    );
    expect(onbruikbaar?.grade).toBe("B");
    expect(onbruikbaar?.lapsRange).toBeNull();
    expect(onbruikbaar?.ratePerLap).toBeNull();
    expect(onbruikbaar?.lapsToThreshold).toBeNull();
  });

  it("leest de dekking uit alle vier de vormen die de client kan teruggeven", () => {
    const rij = { car_key: "bmw_m4_gt3", track_key: "spa", stints: 2, wear_labels: 6, grade: "B" };

    expect(parseTyreCoverage([rij])).toHaveLength(1);
    expect(parseTyreCoverage({ rows: [rij] })).toHaveLength(1);
    expect(parseTyreCoverage({ data: [rij] })).toHaveLength(1);
    expect(parseTyreCoverage({ data: { rows: [rij] } })).toHaveLength(1);
    expect(parseTyreCoverage({ data: [rij] })[0]).toMatchObject({ carKey: "bmw_m4_gt3", stints: 2, grade: "B" });

    // Alles wat geen lijst is blijft leeg, en liegt niet over een rij.
    expect(parseTyreCoverage({ data: null })).toEqual([]);
    expect(parseTyreCoverage(null)).toEqual([]);
  });
});

/**
 * De query's zelf: de sleutel hangt aan het apparaat, en de v1-terugval krijgt
 * event en team via de fetch. Stond de binding in de sleutel, dan vroeg de
 * pagina v2 twee keer — de tweede keer alleen omdat de detail-RPC terugkwam.
 */
describe("de query's van het bandenmodel", () => {
  const wrapper = (client: QueryClient) =>
    ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

  it("vraagt v2 één keer, ook als event en team pas later binnenkomen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) =>
      fn === "tyre_coverage"
        ? { data: [], error: null }
        : { data: { grade: "B", usable: true, range_laps: { low: 10, high: 12 } }, error: null },
    );

    const hook = renderHook(
      ({ eventId, teamId }: { eventId: string | null; teamId: string | null }) =>
        useTyreModel({
          client: { rpc } as unknown as TyreRpcClient,
          deviceId: "device-1",
          eventId,
          teamId,
          enabled: true,
        }),
      { initialProps: { eventId: null as string | null, teamId: null as string | null }, wrapper: wrapper(client) },
    );

    await waitFor(() => expect(hook.result.current.estimate?.grade).toBe("B"));
    hook.rerender({ eventId: "event-1", teamId: "team-1" });
    await waitFor(() => expect(hook.result.current.bron).toBe("v2"));

    const v2Calls = rpc.mock.calls.filter(([fn]) => fn === "pitwall_tyre_estimate_v2");
    expect(v2Calls).toHaveLength(1);
    expect(v2Calls[0][1]).toEqual({ p_device_id: "device-1" });
    // De sleutel noemt het apparaat en niets anders.
    expect(tyreModelQueryKey("device-1")).toEqual(["pitwall-test", "tyre-model", "device-1"]);

    hook.unmount();
    client.clear();
  });

  it("probeert v1 opnieuw zodra event en team voor het eerst binnenkomen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
      if (fn === "tyre_coverage") return { data: [], error: null };
      if (fn === "pitwall_tyre_estimate_v2") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      return {
        data: { grade: "B", estimate: { weakest: "fl", per_corner: { fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2 } } } },
        error: null,
      };
    });

    const hook = renderHook(
      ({ eventId, teamId }: { eventId: string | null; teamId: string | null }) =>
        useTyreModel({
          client: { rpc } as unknown as TyreRpcClient,
          deviceId: "device-1",
          eventId,
          teamId,
          enabled: true,
        }),
      { initialProps: { eventId: null as string | null, teamId: null as string | null }, wrapper: wrapper(client) },
    );

    // Eerste fetch: v2 stuk en nog geen binding, dus v1 is niet eens geprobeerd.
    await waitFor(() => expect(hook.result.current.bron).toBe("geen"));
    expect(rpc.mock.calls.filter(([fn]) => fn === "pitwall_tyre_estimate_v1")).toHaveLength(0);

    hook.rerender({ eventId: "event-1", teamId: "team-1" });

    // Zonder de refetch zou dit pas bij de verversing van 15 s gebeuren.
    await waitFor(() => expect(hook.result.current.bron).toBe("v1"));

    const v1Calls = rpc.mock.calls.filter(([fn]) => fn === "pitwall_tyre_estimate_v1");
    expect(v1Calls).toHaveLength(1);
    expect(v1Calls[0][1]).toEqual({ p_event_id: "event-1", p_team_id: "team-1" });
    // De sleutel is niet veranderd: het blijft één query op het apparaat.
    expect(tyreModelQueryKey("device-1")).toEqual(["pitwall-test", "tyre-model", "device-1"]);

    hook.unmount();
    client.clear();
  });

  it("geeft event en team aan de v1-terugval mee vanuit de fetch", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "pitwall_tyre_estimate_v2") return { data: null, error: { code: "PGRST202", message: "not found" } };
      if (fn === "pitwall_tyre_estimate_v1") {
        return {
          data: { grade: "B", estimate: { weakest: "fl", per_corner: { fl: { value: 61, rate_per_lap: -1.8, sigma: 1.2 } } } },
          error: null,
        };
      }
      return { data: [], error: null };
    });

    const hook = renderHook(
      () =>
        useTyreModel({
          client: { rpc } as unknown as TyreRpcClient,
          deviceId: "device-1",
          eventId: "event-1",
          teamId: "team-1",
          enabled: true,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(hook.result.current.bron).toBe("v1"));

    expect(rpc).toHaveBeenCalledWith("pitwall_tyre_estimate_v1", { p_event_id: "event-1", p_team_id: "team-1" });
    expect(hook.result.current.v2Error).toContain("PGRST202");
    expect(hook.result.current.estimate?.rangeLaps).not.toBeNull();

    hook.unmount();
    client.clear();
  });

  it("houdt 'laden' aan tot de eerste uitslag en meldt daarna de fout", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let antwoord: (value: { data: unknown; error: unknown }) => void = () => {};
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "tyre_coverage") return { data: [], error: null };
      return new Promise<{ data: unknown; error: unknown }>((resolve) => {
        antwoord = resolve;
      });
    });

    const hook = renderHook(
      () => useTyreModel({ client: { rpc } as unknown as TyreRpcClient, deviceId: "device-1", enabled: true }),
      { wrapper: wrapper(client) },
    );

    expect(rpc).toHaveBeenCalledWith("pitwall_tyre_estimate_v2", { p_device_id: "device-1" });
    expect(hook.result.current.modelLoading).toBe(true);
    expect(hook.result.current.v2Error).toBeNull();

    await act(async () => {
      antwoord({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    });

    await waitFor(() => expect(hook.result.current.modelLoading).toBe(false));
    expect(hook.result.current.estimate).toBeNull();
    expect(hook.result.current.bron).toBe("geen");
    expect(hook.result.current.v2Error).toContain("PGRST202");

    hook.unmount();
    client.clear();
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

/**
 * Waar het bandencijfer vandaan komt, in gewone taal onder het bereik.
 *
 * Deze regel bestaat omdat een bereik zonder herkomst een getal is waar niemand
 * iets mee kan: "9–13 rondes" uit je eigen stint is iets anders dan hetzelfde
 * bereik uit de gedeelde stints van andere rijders. De eis is daarom letterlijk:
 * één regel, geen jargon, geen Engels, en bij een eigen meting helemaal niets.
 *
 * De vijf bronnen zijn die van de migratie (`basis.bron`): eigen, exact, auto,
 * circuit, algemeen. `basis.prior_n` is `n_eff` — de gewogen meetbasis in
 * rondes, geen aantal stints — dus zegt de regel "rondes"; het aantal stints
 * staat in de leesbare opbouw van de server, die als titeltip meegaat.
 */
describe("waar het bandencijfer vandaan komt", () => {
  /** Een graad B met bereik, zodat er ook echt een getal staat om uit te leggen. */
  const metBron = (
    bron: "eigen" | "exact" | "auto" | "circuit" | "algemeen",
    priorN: number | null,
    extra: { modelBron?: string | null; priorBron?: string | null } = {},
  ) =>
    parseTyreEstimateV2({
      grade: "B",
      usable: true,
      stints: 2,
      wear_per_lap: 1.1,
      range_laps: { low: 9, high: 13 },
      provenance: "estimated",
      basis: {
        car_key: "bmw_m4_gt3",
        track_key: "spa",
        track_temp_c: 21,
        rondes_in_basis: 18,
        rondes_effectief: 59,
        bron,
        prior_rate: 1.23,
        prior_n: priorN,
        prior_level: bron === "eigen" ? "exact" : bron,
        prior_bron: extra.priorBron ?? null,
      },
      model_bron: extra.modelBron ?? null,
    });

  it("leest de velden van de nieuwe migratie, zonder ze te verzinnen", () => {
    const estimate = metBron("auto", 41.37, {
      priorBron: "algemeen: 12 stints, 40 rondes over alle auto's en circuits · deze auto op andere circuits: 7 stints, 90 rondes",
    });

    expect(estimate?.basis.bron).toBe("auto");
    expect(estimate?.basis.priorRate).toBe(1.23);
    expect(estimate?.basis.priorN).toBe(41.37);
    expect(estimate?.basis.priorLevel).toBe("auto");
    expect(estimate?.basis.priorBron).toContain("deze auto op andere circuits");
    expect(estimate?.modelBron).toBeNull();

    // Zonder die velden blijft alles leeg; geen bron betekent geen bewering.
    const kaal = parseTyreEstimateV2({ grade: "B", basis: { car_key: "bmw_m4_gt3" } });
    expect(kaal?.basis.bron).toBeNull();
    expect(kaal?.basis.priorN).toBeNull();
    expect(kaal?.basis.priorRate).toBeNull();
    expect(kaal?.basis.priorLevel).toBeNull();
    expect(kaal?.basis.priorBron).toBeNull();
    expect(kaal?.modelBron).toBeNull();
    // Een onbekend token wordt geen verzonnen bron.
    expect(parseTyreEstimateV2({ grade: "B", basis: { bron: "iets-nieuws" } })?.basis.bron).toBeNull();
  });

  it("zegt bij een eigen meting niets extra's: dat is de gewone situatie", () => {
    const view = render(<TyreModelPanel estimate={metBron("eigen", 4, { modelBron: "eigen stint" })} bron="v2" coverage={[]} />);

    expect(view.container.querySelector("[data-pitwall-tyre-prior]")).toBeNull();
    expect(view.container.textContent).not.toContain("andere rijders");
    // Het bereik zelf staat er gewoon, ongewijzigd.
    expect(screen.getByText("9–13")).toBeVisible();
    view.unmount();
  });

  it("zegt bij bron auto op welk circuit je nog niets zelf hebt", () => {
    const view = render(<TyreModelPanel estimate={metBron("auto", 41)} bron="v2" coverage={[]} />);

    const regel = view.container.querySelector("[data-pitwall-tyre-prior]")!;
    expect(regel).toHaveAttribute("data-pitwall-tyre-prior", "auto");
    expect(regel).toHaveTextContent(
      "Nog geen eigen meting op dit circuit — gebaseerd op 41 rondes van andere rijders met deze auto",
    );
    // Eenenveertig rondes is geen dunne basis: geen waarschuwing erbij.
    expect(view.container.querySelector("[data-pitwall-tyre-prior-warning]")).toBeNull();
    view.unmount();
  });

  it("zegt bij bron circuit dat de auto nog niet meedoet", () => {
    const view = render(<TyreModelPanel estimate={metBron("circuit", 7)} bron="v2" coverage={[]} />);

    const regel = view.container.querySelector("[data-pitwall-tyre-prior]")!;
    expect(regel).toHaveAttribute("data-pitwall-tyre-prior", "circuit");
    expect(regel).toHaveTextContent(
      "Nog geen eigen meting met deze auto — gebaseerd op 7 rondes van andere rijders op dit circuit",
    );
    view.unmount();
  });

  it("zegt bij bron exact dat het om deze auto op dit circuit gaat", () => {
    const view = render(<TyreModelPanel estimate={metBron("exact", 12)} bron="v2" coverage={[]} />);

    const regel = view.container.querySelector("[data-pitwall-tyre-prior]")!;
    expect(regel).toHaveAttribute("data-pitwall-tyre-prior", "exact");
    expect(regel).toHaveTextContent(
      "Nog geen eigen meting — gebaseerd op 12 rondes van andere rijders met deze auto op dit circuit",
    );
    view.unmount();
  });

  it("zegt bij bron algemeen dat het van allerlei auto's en circuits komt", () => {
    const view = render(<TyreModelPanel estimate={metBron("algemeen", 40)} bron="v2" coverage={[]} />);

    const regel = view.container.querySelector("[data-pitwall-tyre-prior]")!;
    expect(regel).toHaveAttribute("data-pitwall-tyre-prior", "algemeen");
    expect(regel).toHaveTextContent(
      "Nog geen eigen meting — gebaseerd op 40 rondes van andere rijders, van andere auto's en circuits",
    );
    view.unmount();
  });

  it("waarschuwt onder de drie rondes dat het een grove schatting is", () => {
    const twee = render(<TyreModelPanel estimate={metBron("auto", 2.5)} bron="v2" coverage={[]} />);

    expect(twee.container.querySelector("[data-pitwall-tyre-prior]")).toHaveTextContent(
      "gebaseerd op 2,5 rondes",
    );
    expect(twee.container.querySelector("[data-pitwall-tyre-prior-warning]")).toHaveTextContent(
      "Grove schatting: hier liggen minder dan drie rondes van andere rijders onder. Zie het als een richting, niet als een belofte.",
    );
    twee.unmount();

    // Eén ronde is enkelvoud, en nog steeds een grove schatting.
    const een = render(<TyreModelPanel estimate={metBron("circuit", 1)} bron="v2" coverage={[]} />);
    expect(een.container.querySelector("[data-pitwall-tyre-prior]")).toHaveTextContent("gebaseerd op 1 ronde van");
    expect(een.container.querySelector("[data-pitwall-tyre-prior-warning]")).not.toBeNull();
    een.unmount();

    // Drie rondes is de grens: daar houdt de waarschuwing op.
    const drie = render(<TyreModelPanel estimate={metBron("auto", 3)} bron="v2" coverage={[]} />);
    expect(drie.container.querySelector("[data-pitwall-tyre-prior-warning]")).toBeNull();
    drie.unmount();
  });

  it("zet de opbouw van de server als titeltip bij de regel, niet als tweede zin", () => {
    const opbouw =
      "algemeen: 12 stints, 40 rondes over alle auto's en circuits · andere auto's op dit circuit: 7 stints, 90 rondes";
    const view = render(
      <TyreModelPanel estimate={metBron("circuit", 7, { priorBron: opbouw })} bron="v2" coverage={[]} />,
    );

    const regel = view.container.querySelector("[data-pitwall-tyre-prior] p")!;
    expect(regel).toHaveAttribute("title", opbouw);
    expect(regel).toHaveTextContent(
      "Nog geen eigen meting met deze auto — gebaseerd op 7 rondes van andere rijders op dit circuit",
    );
    view.unmount();

    // De korte omschrijving van de server wint van de lange opbouw; een lege
    // omschrijving ("algemeen beeld") herhaalt de regel en valt terug op de opbouw.
    const kort = render(
      <TyreModelPanel
        estimate={metBron("auto", 41, { modelBron: "Spa + Lamborghini Huracan GT3", priorBron: opbouw })}
        bron="v2"
        coverage={[]}
      />,
    );
    expect(kort.container.querySelector("[data-pitwall-tyre-prior] p")).toHaveAttribute(
      "title",
      "Spa + Lamborghini Huracan GT3",
    );
    kort.unmount();

    const leeg = render(
      <TyreModelPanel estimate={metBron("algemeen", 40, { modelBron: "algemeen beeld", priorBron: opbouw })} bron="v2" coverage={[]} />,
    );
    expect(leeg.container.querySelector("[data-pitwall-tyre-prior] p")).toHaveAttribute("title", opbouw);
    leeg.unmount();
  });

  it("houdt de regel vrij van jargon en Engels, en zegt niets als de bron ontbreekt", () => {
    const view = render(<TyreModelPanel estimate={metBron("auto", 41)} bron="v2" coverage={[]} />);
    const regel = view.container.querySelector("[data-pitwall-tyre-prior]")!;
    const tekst = regel.textContent ?? "";

    expect(tekst).not.toMatch(/prior|model_bron|\bbron\b|\bbasis\b|\bn_eff\b|\bown\b|\bcar\b|\btrack\b|\bexact\b/i);
    view.unmount();

    // Zonder bron verzinnen we geen herkomst: dan blijft de regel weg.
    const zonder = parseTyreEstimateV2({
      grade: "B",
      usable: true,
      range_laps: { low: 9, high: 13 },
      basis: { car_key: "bmw_m4_gt3", prior_n: 41 },
    });
    const tweede = render(<TyreModelPanel estimate={zonder} bron="v2" coverage={[]} />);
    expect(tweede.container.querySelector("[data-pitwall-tyre-prior]")).toBeNull();
    tweede.unmount();
  });

  it("legt niets uit over een bereik dat er niet staat", () => {
    const zonderBereik = parseTyreEstimateV2({
      grade: "B",
      usable: true,
      range_laps: null,
      basis: { car_key: "bmw_m4_gt3", track_key: "spa", bron: "auto", prior_n: 41 },
    });

    const view = render(<TyreModelPanel estimate={zonderBereik} bron="v2" coverage={[]} />);

    expect(screen.getByText("rondes onbekend")).toBeVisible();
    expect(view.container.querySelector("[data-pitwall-tyre-prior]")).toBeNull();
    view.unmount();
  });
});
