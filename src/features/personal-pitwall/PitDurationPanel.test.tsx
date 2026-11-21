import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PitDurationPanel } from "./PitDurationPanel";
import { formatPitDuration, parsePersonalPitVisits, PIT_DURATION_SEMANTICS } from "./pitVisits";

const feed = {
  available: true,
  reason: null,
  sessionKey: "session-a",
  visits: [
    { visitKey: "pit:130", pitLaneSeconds: 38.125, entryLap: 10, exitLap: 10, driver: "Driver A", source: "tyre_observation_pit_edges" },
  ],
};

describe("personal pit visits", () => {
  it("parses only measured 5–900 s visits and keeps malformed rows out", () => {
    const parsed = parsePersonalPitVisits({
      available: true,
      sessionKey: "session-a",
      visits: [
        ...feed.visits,
        { visitKey: "too-short", pitLaneSeconds: 4.9 },
        { visitKey: "too-long", pitLaneSeconds: 901 },
        { visitKey: "", pitLaneSeconds: 40 },
        { visitKey: "no-number", pitLaneSeconds: "40" },
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

  it("shows the measured pit-in → pit-out duration and never calls it net loss", async () => {
    const load = vi.fn().mockResolvedValue(feed);
    render(<PitDurationPanel deviceId="device-a" enabled load={load} pollMs={60_000} />);

    const value = await screen.findByText("38.125 s");
    expect(value.closest("[data-pit-duration]")?.getAttribute("data-pit-duration")).toBe("38.125");
    expect(value.closest("[data-pit-visit]")?.getAttribute("data-pit-source")).toBe("tyre_observation_pit_edges");
    expect(screen.getByText(PIT_DURATION_SEMANTICS)).toBeTruthy();
    expect(screen.queryByText(/netto verlies/i)).toBeNull();
    expect(load).toHaveBeenCalledWith("device-a");
  });

  it("states an explicit empty session instead of showing a guess", async () => {
    const load = vi.fn().mockResolvedValue({ available: false, reason: "no_completed_visit", sessionKey: "session-a", visits: [] });
    render(<PitDurationPanel deviceId="device-a" enabled load={load} pollMs={60_000} />);
    await waitFor(() => expect(screen.getByText("Nog geen afgeronde pitstop in deze sessie.")).toBeTruthy());
    expect(screen.queryByText(/\d+\.\d{3} s/)).toBeNull();
  });

  it("does not run without the owner route or a device", () => {
    const load = vi.fn();
    const view = render(<PitDurationPanel deviceId={null} enabled load={load} />);
    expect(view.container.textContent).toBe("");
    expect(load).not.toHaveBeenCalled();
  });
});
