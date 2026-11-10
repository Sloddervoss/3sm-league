import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StandingsDerivation, StandingsRow } from "../standings";
import type { V3Normalized } from "../pitwallHelpers";
import { PremiumTimingPanel } from "./PremiumTimingPanel";

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

    // Weer live: eerst ijken, nog steeds geen oude sprong.
    view.rerender(<PremiumTimingPanel {...props} standings={standings([row("a", 1), row("b", 2)])} live />);
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
});
