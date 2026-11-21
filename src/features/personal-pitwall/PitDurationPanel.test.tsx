import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PitDurationPanel } from "./PitDurationPanel";
import {
  EMPTY_PIT_DIAGNOSTICS,
  formatPitDuration,
  parsePersonalPitVisits,
  PIT_BENCHMARK_SEMANTICS,
  PIT_DURATION_SEMANTICS,
} from "./pitVisits";

const feed = {
  available: true,
  reason: null,
  sessionKey: "sim-42-s1",
  diagnostics: EMPTY_PIT_DIAGNOSTICS,
  visits: [
    {
      visitKey: "pit-seg-abc-1",
      pitLaneSeconds: 38.125,
      entryObservedAt: "2026-11-21T12:00:00.000Z",
      exitObservedAt: "2026-11-21T12:00:38.125Z",
      entrySessionSeconds: 100,
      exitSessionSeconds: 138.125,
      source: "measurement_event_pit_edges",
    },
  ],
};

describe("personal pit visits", () => {
  it("parses only measured 5–900 s visits and keeps malformed rows out", () => {
    const parsed = parsePersonalPitVisits({
      available: true,
      sessionKey: "sim-42-s1",
      visits: [
        ...feed.visits,
        { visitKey: "too-short", pitLaneSeconds: 4.9, entrySessionSeconds: 1, exitSessionSeconds: 5.9 },
        { visitKey: "too-long", pitLaneSeconds: 901, entrySessionSeconds: 1, exitSessionSeconds: 902 },
        { visitKey: "", pitLaneSeconds: 40, entrySessionSeconds: 1, exitSessionSeconds: 41 },
        { visitKey: "no-number", pitLaneSeconds: "40", entrySessionSeconds: 1, exitSessionSeconds: 41 },
        { visitKey: "backwards", pitLaneSeconds: 40, entrySessionSeconds: 41, exitSessionSeconds: 1 },
      ],
    });
    expect(parsed.visits).toHaveLength(1);
    expect(parsed.visits[0].pitLaneSeconds).toBe(38.125);
    expect(parsed.available).toBe(true);
  });

  it("formats seconds and minutes without inventing precision", () => {
    expect(formatPitDuration(47.312)).toBe("47.312 s");
    expect(formatPitDuration(62.45)).toBe("1:02.450");
    expect(formatPitDuration(null)).toBe("—");
    expect(formatPitDuration(Number.NaN)).toBe("—");
  });

  it("shows the measured pit-in → pit-out duration as a separate gross benchmark", async () => {
    const load = vi.fn().mockResolvedValue(feed);
    render(<PitDurationPanel deviceId="device-a" enabled load={load} pollMs={60_000} />);

    const value = await screen.findByText("38.125 s");
    expect(value.closest("[data-pit-duration]")?.getAttribute("data-pit-duration")).toBe("38.125");
    const card = value.closest("[data-pit-visit]");
    expect(card?.getAttribute("data-pit-source")).toBe("measurement_event_pit_edges");
    expect(card?.getAttribute("data-pit-benchmark")).toBe("gross");
    expect(screen.getByText(PIT_DURATION_SEMANTICS)).toBeTruthy();
    expect(screen.getByText(new RegExp(PIT_BENCHMARK_SEMANTICS))).toBeTruthy();
    expect(screen.queryByText(/netto verlies/i)).toBeNull();
    expect(load).toHaveBeenCalledWith("device-a");
  });

  it("states an explicit empty session instead of showing a guess", async () => {
    const load = vi.fn().mockResolvedValue({
      available: false,
      reason: "no_completed_visit",
      sessionKey: "sim-42-s1",
      visits: [],
      diagnostics: { pendingEdges: 1, rejectedEdges: 2, lastRejectReason: "clock_telemetry_gap" },
    });
    render(<PitDurationPanel deviceId="device-a" enabled load={load} pollMs={60_000} />);
    await waitFor(() => expect(screen.getByText("Nog geen afgeronde pitstop in deze sessie.")).toBeTruthy());
    expect(screen.queryByText(/\d+\.\d{3} s/)).toBeNull();
    expect(screen.getByText(/1 bronflank\(en\) wachten/)).toBeTruthy();
    expect(screen.getByText(/2 flank\(en\) afgekeurd · clock_telemetry_gap/)).toBeTruthy();
  });

  it("does not run without the owner route or a device", () => {
    const load = vi.fn();
    const view = render(<PitDurationPanel deviceId={null} enabled load={load} />);
    expect(view.container.textContent).toBe("");
    expect(load).not.toHaveBeenCalled();
  });
});
