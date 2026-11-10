import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveStandings, type StandingsDerivation, type StandingsRow } from "../standings";
import type { V3Normalized } from "../pitwallHelpers";
import { PremiumTimingPanel, TIMING_SIGNAL_TTL_MS } from "./PremiumTimingPanel";

const row = (
  id: string,
  position: number,
  lap = 10,
  extra: Partial<StandingsRow> = {},
): StandingsRow => ({
  id,
  position,
  classPosition: position,
  lap,
  carNumber: id.toUpperCase(),
  driverName: `Coureur ${id}`,
  teamName: `Team ${id}`,
  carClass: "GT3",
  lastLapSeconds: 92.4,
  bestLapSeconds: 91.8,
  gapToPlayerSeconds: position * 1.5,
  connected: true,
  isPlayer: false,
  ...extra,
});

const standings = (rows: StandingsRow[], extra: Partial<StandingsDerivation> = {}): StandingsDerivation => ({
  overallPosition: rows.find((r) => r.isPlayer)?.position ?? null,
  classPosition: null,
  rows,
  ahead: null,
  behind: null,
  aheadTrend: null,
  behindTrend: null,
  noData: false,
  ...extra,
});

const v3: V3Normalized = { identity: {}, session: {}, timing: {}, opponents: [] };

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
let originalAnimate: typeof HTMLElement.prototype.animate;
let originalGetAnimations: typeof HTMLElement.prototype.getAnimations;
let originalOffsetTop: PropertyDescriptor | undefined;
let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  originalAnimate = HTMLElement.prototype.animate;
  originalGetAnimations = HTMLElement.prototype.getAnimations;
  originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");

  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.matches("[data-timing-row-id]") && this.parentElement) {
        const siblings = [...this.parentElement.children].filter((el) => el.matches("[data-timing-row-id]"));
        return Math.max(0, siblings.indexOf(this)) * 38;
      }
      return 0;
    },
  });

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.matches("[data-timing-row-id]")) {
      const siblings = this.parentElement
        ? [...this.parentElement.children].filter((el) => el.matches("[data-timing-row-id]"))
        : [];
      const index = Math.max(0, siblings.indexOf(this));
      return {
        top: index * 29,
        bottom: index * 29 + 29,
        height: 29,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: index * 29,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      top: 0,
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });

  animate = vi.fn(() => ({
    id: "",
    onfinish: null,
    cancel: vi.fn(),
  }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    writable: true,
    value: () => [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: originalRect,
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: originalAnimate,
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    writable: true,
    value: originalGetAnimations,
  });
  if (originalOffsetTop) Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
});

const renderPanel = (rows: StandingsRow[], overrides: Partial<ComponentProps<typeof PremiumTimingPanel>> = {}) =>
  render(
    <PremiumTimingPanel
      v3={v3}
      standings={standings(rows)}
      ownCarLabel="Mijn auto"
      ownCarNumber="17"
      live
      contextKey="device-1|session-a"
      motionEnabled
      {...overrides}
    />,
  );

describe("premium timing — echte tabel, echte rerender", () => {
  it("rendert een semantische tabel met kolomkoppen, klassekoppen en een benoemd scrollvlak", () => {
    const view = renderPanel([
      row("a", 1),
      row("b", 2),
      row("me", 3, 10, { isPlayer: true, driverName: "Vincent" }),
      row("c", 4, 10, { carClass: "LMP2" }),
    ]);

    const region = screen.getByRole("region", { name: "Live timing — scrollbaar klassement" });
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector("table")).not.toBeNull();
    expect(region.querySelectorAll("thead th[scope='col']").length).toBeGreaterThan(6);
    const classHeaders = region.querySelectorAll("th[scope='colgroup']");
    expect(classHeaders).toHaveLength(2);
    expect(classHeaders[0].textContent).toContain("GT3");
    expect(classHeaders[1].textContent).toContain("LMP2");
    expect(region.querySelectorAll("tbody tr[data-timing-row-id]")).toHaveLength(4);
    expect(region.querySelector("tbody tr[data-premium-own-row='true']")?.textContent).toContain("Vincent");
  });

  it("toont de nieuwste rijvolgorde meteen en animeert alleen de echte id-gebonden positiewissel", async () => {
    const first = [row("b", 1), row("a", 2), row("c", 3), row("me", 4, 10, { isPlayer: true })];
    const view = renderPanel(first);
    expect(animate).not.toHaveBeenCalled();

    const aBefore = view.container.querySelector("tr[data-timing-row-id='a']");
    const bBefore = view.container.querySelector("tr[data-timing-row-id='b']");
    expect(aBefore).not.toBeNull();

    view.rerender(
      <PremiumTimingPanel
        v3={v3}
        standings={standings([row("a", 1), row("b", 2), row("c", 3), row("me", 4, 10, { isPlayer: true })])}
        ownCarLabel="Mijn auto"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled
      />,
    );

    // De DOM is direct de nieuwe volgorde; niets bevroren of in een wachtrij.
    await waitFor(() => {
      const ids = [...view.container.querySelectorAll("tbody tr[data-timing-row-id]")].map(
        (el) => (el as HTMLElement).dataset.timingRowId,
      );
      expect(ids.slice(0, 2)).toEqual(["a", "b"]);
    });

    // Zelfde key, dus hetzelfde echte rij-element is verplaatst.
    expect(view.container.querySelector("tr[data-timing-row-id='a']")).toBe(aBefore);
    expect(view.container.querySelector("tr[data-timing-row-id='b']")).toBe(bBefore);

    await waitFor(() => {
      const rowA = view.container.querySelector("tr[data-timing-row-id='a']") as HTMLElement;
      const rowB = view.container.querySelector("tr[data-timing-row-id='b']") as HTMLElement;
      expect(within(rowA).getByText("+1")).toBeTruthy();
      expect(within(rowB).getByText("-1")).toBeTruthy();
    });

    expect(animate).toHaveBeenCalled();
    const frames = animate.mock.calls.map(([keyframes]) => keyframes as Keyframe[]);
    expect(frames.some((f) => String(f[0]?.transform).includes("translate3d"))).toBe(true);
    expect(vi.mocked(animate).mock.calls.every(([, options]) => options.duration === 320)).toBe(true);

    // Een tweede beweging annuleert de lopende animatie van dezelfde rij.
    const firstAnimation = animate.mock.results[0].value as { cancel: ReturnType<typeof vi.fn> };
    view.rerender(
      <PremiumTimingPanel
        v3={v3}
        standings={standings([row("b", 1), row("a", 2), row("c", 3), row("me", 4, 10, { isPlayer: true })])}
        ownCarLabel="Mijn auto"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled
      />,
    );
    await waitFor(() => expect(firstAnimation.cancel).toHaveBeenCalled());
  });

  it("reset de basis bij offline en een verborgen tab, zonder oude beweging bij terugkomst", async () => {
    const view = renderPanel([row("b", 1), row("a", 2)]);
    const props = {
      v3,
      ownCarLabel: "Mijn auto",
      ownCarNumber: "17",
      contextKey: "device-1|session-a",
      motionEnabled: true,
    };

    // Offline: vergelijking uit, geen beweging.
    view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1), row("b", 2)])} live={false} />);
    await waitFor(() => expect(view.container.querySelector(".ptp-move")).toBeNull());
    expect(animate).not.toHaveBeenCalled();

    // Weer live met juist een andere volgorde: eerst ijken, geen oude sprong.
    view.rerender(<PremiumTimingPanel {...props} standings={standings([row("b", 1), row("a", 2)])} live />);
    await waitFor(() => expect(view.container.querySelector(".ptp-move")).toBeNull());
    expect(animate).not.toHaveBeenCalled();

    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    try {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      view.rerender(<PremiumTimingPanel {...props} standings={standings([row("b", 1), row("a", 2)])} live />);
      await waitFor(() => expect(view.container.querySelector(".ptp-move")).toBeNull());
      expect(animate).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(document, "hidden", descriptor);
      else Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });

  it("ijkt een gecachete tabel opnieuw na een RPC-datagat met gewijzigde volgorde", () => {
    const before = [row("a", 1), row("b", 2)];
    const after = [row("b", 1), row("a", 2)];
    const props = { v3, ownCarLabel: "Mijn auto", ownCarNumber: "17", live: true, contextKey: "device-1|session-a", motionEnabled: true };
    const view = renderPanel(before);
    view.rerender(<PremiumTimingPanel {...props} standings={standings(before)} gap />);
    expect(view.container.querySelectorAll("[data-timing-row-id]")).toHaveLength(2);
    view.rerender(<PremiumTimingPanel {...props} standings={standings(after)} gap={false} />);
    expect(animate).not.toHaveBeenCalled();
    expect(view.container.querySelector(".ptp-move")).toBeNull();
    // De volgende echte positiewijziging animeert wel: geen permanent uitgezette hook.
    view.rerender(<PremiumTimingPanel {...props} standings={standings(before)} gap={false} />);
    expect(animate).toHaveBeenCalled();
  });

  it("animeert niet bij de eerste snapshot, een contextwissel of als beweging uit staat", async () => {
    const view = renderPanel([row("a", 1), row("b", 2)]);
    expect(animate).not.toHaveBeenCalled();

    view.rerender(
      <PremiumTimingPanel
        v3={v3}
        standings={standings([row("a", 2), row("b", 1)])}
        ownCarLabel="Mijn auto"
        ownCarNumber="17"
        live
        contextKey="device-2|session-b"
        motionEnabled
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector("tr[data-timing-row-id='a']")).not.toBeNull();
    });
    expect(view.container.querySelector(".ptp-move")).toBeNull();
    expect(animate).not.toHaveBeenCalled();

    view.rerender(
      <PremiumTimingPanel
        v3={v3}
        standings={standings([row("a", 1), row("b", 2)])}
        ownCarLabel="Mijn auto"
        ownCarNumber="17"
        live
        contextKey="device-2|session-b"
        motionEnabled={false}
      />,
    );
    expect(animate).not.toHaveBeenCalled();
  });

  it("markeert een nieuwe ronde kort en toont PIT alleen uit de bron", async () => {
    const view = renderPanel([row("a", 1, 10), row("b", 2, 10)]);
    expect(screen.queryByText("PIT")).toBeNull();

    view.rerender(
      <PremiumTimingPanel
        v3={v3}
        standings={standings([row("a", 1, 11, { inPit: true }), row("b", 2, 10)])}
        ownCarLabel="Mijn auto"
        ownCarNumber="17"
        live
        contextKey="device-1|session-a"
        motionEnabled
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector("tr[data-timing-row-id='a'] .ptp-lap-flash")).not.toBeNull();
      expect(within(view.container.querySelector("tr[data-timing-row-id='a']") as HTMLElement).getByText("PIT")).toBeTruthy();
    });
    expect(view.container.querySelectorAll(".ptp-move")).toHaveLength(0);
  });

  it("laat een klassefilter geen schijnbare positiewissel of animatie veroorzaken", async () => {
    const rows = [
      row("gt3-a", 1, 10, { carClass: "GT3" }),
      row("gt3-b", 2, 10, { carClass: "GT3" }),
      row("lmp-a", 3, 10, { carClass: "LMP2" }),
    ];
    const view = renderPanel(rows);

    fireEvent.click(screen.getByRole("button", { name: "Klasse" }));
    const filter = view.container.querySelector(".ptp-class-filter") as HTMLElement;
    expect(filter).not.toBeNull();
    fireEvent.click(within(filter).getByRole("button", { name: /LMP2/ }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("tbody tr[data-timing-row-id]")).toHaveLength(1);
      expect(view.container.querySelector("tr[data-timing-row-id='lmp-a']")).not.toBeNull();
    });
    expect(view.container.querySelector(".ptp-move")).toBeNull();
    expect(animate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Live timing" }));
    expect(view.container.querySelectorAll("tbody tr[data-timing-row-id]")).toHaveLength(3);
  });

  it("houdt de eigen-rijknop werkend zonder de tabel te bevriezen", async () => {
    const view = renderPanel([
      row("a", 1),
      row("b", 2),
      row("me", 3, 10, { isPlayer: true, driverName: "Vincent" }),
    ]);
    const ownButton = screen.getByRole("button", { name: /Eigen rij/ });
    expect(() => fireEvent.click(ownButton)).not.toThrow();
    expect(view.container.querySelector("tr[data-timing-row-id='me']")).not.toBeNull();
  });

  it("toont in de eigen focuscel dezelfde gap tot de auto voor je als de klassieke strook", () => {
    const ahead = row("a", 1, 10, { gapToPlayerSeconds: -2.4 });
    const me = row("me", 2, 10, { isPlayer: true, driverName: "Vincent" });
    const view = renderPanel([ahead, me], { standings: standings([ahead, me], { ahead }) });

    const own = view.container.querySelector(".ptp-focus-cell[data-tone='own']") as HTMLElement;
    expect(own.textContent).toContain("P2");
    expect(own.textContent).toContain("-2.4s");
  });

  it("toont een expliciet streepje voor een ontbrekende of ongeldige Safety Rating", () => {
    const view = renderPanel([
      row("a", 1, 10, { safetyRating: 5.5, licenseClass: "A" }),
      row("b", 2, 10, { safetyRating: 2.4, licenseClass: "Z" }),
      row("c", 3, 10, { safetyRating: 2.4, licenseClass: "A" }),
    ]);

    expect(view.container.querySelector("tr[data-timing-row-id='a'] .ptp-sr")?.textContent).toBe("—");
    expect(view.container.querySelector("tr[data-timing-row-id='b'] .ptp-sr")?.textContent).toBe("—");
    expect(view.container.querySelector("tr[data-timing-row-id='c'] .ptp-sr")?.textContent).toBe("A 2.40");
  });

  it("onderdrukt een ongeldige reset/tow-ronde ook als de verse PACE-meting een tijd heeft", () => {
    const paceV3: V3Normalized = {
      ...v3,
      transportSessionId: "transport-1",
      session: { sessionTimeSeconds: 1000 },
      timing: {},
      opponents: [
        {
          id: "a",
          position: 1,
          lap: 11,
          carClass: "GT3",
          carNumber: "17",
          driverName: "Coureur a",
          lastLapSeconds: 40,
          bestLapSeconds: 92,
          connected: true,
        },
      ],
      paceHistory: {
        schemaRevision: 1,
        observedSessionId: "session-1",
        segmentId: "segment-1",
        transportSessionId: "transport-1",
        updatedAt: new Date().toISOString(),
        cars: [
          {
            id: "a",
            laps: [],
            traces: [],
            metrics: {
              id: "a",
              observedSessionTimeSeconds: 998,
              lastLapSeconds: 40,
              bestLapSeconds: 92,
              lastLapSectorSeconds: [10, 10, 20],
              bestLapSectorSeconds: null,
              bestSectorSeconds: null,
              bestLapDeltaToFieldBestSeconds: null,
              bestLapDeltaToPlayerSeconds: null,
              lapValid: true,
              lapHighPrecision: null,
              trackPositionPercentRaw: null,
              sectorMismatchCount: 0,
              sectorCount: 3,
              sectorLap: 10,
              sectorSource: "simhub",
              sectorErrorSeconds: 0,
            },
          },
        ],
      },
    };
    const derived = deriveStandings(paceV3, 40);
    const view = renderPanel(derived.rows, { v3: paceV3, standings: derived });
    const timingRow = view.container.querySelector("tr[data-timing-row-id='a']") as HTMLElement;

    const last = timingRow.querySelector("[data-timing='last-lap']") as HTMLElement;
    expect(last.textContent).toBe("—");
    expect(last.getAttribute("title")).toBe(
      "Laatste ronde ongeldig (reset of baanverlating) — telt niet als rondetijd",
    );

    expect((timingRow.querySelector("[data-timing='best-lap']") as HTMLElement).textContent).toBe("1:32.000");
    expect((timingRow.querySelector("[data-timing='car-number']") as HTMLElement).textContent).toBe("17");

    const sector = timingRow.querySelector(".ptp-col-sector") as HTMLElement;
    expect(sector.textContent).toBe("10.000");
    expect(sector.getAttribute("title")).toBe("Gecontroleerde laatste ronde · simhub · afwijking 0.000 s");
    expect(timingRow.querySelector("td[data-timing='last-lap']")).toBe(last);
  });

  it("laat +1 en de rondeflits na de TTL verdwijnen en herflitst niet op een identiek frame", () => {
    vi.useFakeTimers();
    try {
      const first = [row("a", 2, 10), row("b", 1, 10)];
      const view = renderPanel(first);
      const props = {
        v3,
        ownCarLabel: "Mijn auto",
        ownCarNumber: "17",
        live: true,
        contextKey: "device-1|session-a",
        motionEnabled: true,
      };

      view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1, 11), row("b", 2, 10)])} />);
      const rowA = () => view.container.querySelector("tr[data-timing-row-id='a']") as HTMLElement;
      expect(within(rowA()).getByText("+1")).toBeTruthy();
      expect(rowA().querySelector(".ptp-lap-flash")).not.toBeNull();

      // Identieke frames mogen de timer niet verlengen of opnieuw flitsen.
      view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1, 11), row("b", 2, 10)])} />);
      expect(rowA().querySelector(".ptp-lap-flash")).not.toBeNull();

      act(() => vi.advanceTimersByTime(TIMING_SIGNAL_TTL_MS - 1));
      expect(within(rowA()).queryByText("+1")).toBeTruthy();
      expect(rowA().querySelector(".ptp-lap-flash")).not.toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(rowA().querySelector(".ptp-move")).toBeNull();
      expect(rowA().querySelector(".ptp-lap-flash")).toBeNull();
      expect(rowA().getAttribute("data-lap-flash")).toBeNull();

      // Hetzelfde frame na expiratie is gewone data, geen tweede flits.
      view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1, 11), row("b", 2, 10)])} />);
      expect(rowA().querySelector(".ptp-move")).toBeNull();
      expect(rowA().querySelector(".ptp-lap-flash")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ruimt een lopende signaaltimer op bij een contextwissel", () => {
    vi.useFakeTimers();
    try {
      const view = renderPanel([row("a", 1, 10), row("b", 2, 10)]);
      const props = {
        v3,
        ownCarLabel: "Mijn auto",
        ownCarNumber: "17",
        live: true,
        motionEnabled: true,
      };

      view.rerender(
        <PremiumTimingPanel {...props} contextKey="device-1|session-a" standings={standings([row("a", 1, 11), row("b", 2, 10)])} />,
      );
      expect(view.container.querySelector(".ptp-lap-flash")).not.toBeNull();
      expect(vi.getTimerCount()).toBe(1);

      view.rerender(
        <PremiumTimingPanel {...props} contextKey="device-2|session-b" standings={standings([row("a", 1, 11), row("b", 2, 10)])} />,
      );
      expect(view.container.querySelector(".ptp-lap-flash")).toBeNull();
      expect(view.container.querySelector(".ptp-move")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      act(() => vi.advanceTimersByTime(TIMING_SIGNAL_TTL_MS * 4));
      expect(view.container.querySelector(".ptp-lap-flash")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bewaart geen FLIP-basis als een datagat de tabel weghaalt", async () => {
    const view = renderPanel([row("b", 1), row("a", 2)]);
    const props = {
      v3,
      ownCarLabel: "Mijn auto",
      ownCarNumber: "17",
      live: true,
      contextKey: "device-1|session-a",
      motionEnabled: true,
    };

    view.rerender(
      <PremiumTimingPanel
        {...props}
        standings={standings([], { noData: true, overallPosition: null })}
      />,
    );
    expect(view.container.querySelector("table")).toBeNull();

    view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1), row("b", 2)])} />);
    await waitFor(() => expect(view.container.querySelector("tr[data-timing-row-id='a']")).not.toBeNull());
    expect(animate).not.toHaveBeenCalled();
  });
});
