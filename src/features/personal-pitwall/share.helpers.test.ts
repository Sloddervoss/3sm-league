import { beforeEach, describe, expect, it } from "vitest";
import {
  captureShareTokenFromLocation,
  resetShareTokenBootstrapForTests,
  takeCapturedShareToken,
} from "@/lib/shareTokenBootstrap";
import {
  readShareToken,
  sharedViewerV3,
  type SharedRace,
} from "@/features/personal-pitwall/share";

const token = "b".repeat(64);

beforeEach(() => {
  resetShareTokenBootstrapForTests();
  delete (window as Window & { __3smTakeShareToken?: () => string | null }).__3smTakeShareToken;
  window.history.replaceState(null, "", "/");
});

describe("public share token bootstrap", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(readShareToken(`#t=${token}`)).toBe(token);
    expect(readShareToken(`t=${token}`)).toBe(token);
    expect(readShareToken(`#t=${token.toUpperCase()}`)).toBeNull();
    expect(readShareToken(`#t=${token}0`)).toBeNull();
    expect(readShareToken("#t=short")).toBeNull();
    expect(readShareToken("#other=1")).toBeNull();
  });

  it("consumes the one-shot inline token before the fragment fallback", () => {
    (window as Window & { __3smTakeShareToken?: () => string | null }).__3smTakeShareToken = () => token;
    window.history.replaceState(null, "", `/pitwall/shared#t=${"c".repeat(64)}`);
    expect(captureShareTokenFromLocation()).toBe(token);
    expect(window.location.hash).toBe("");
    expect(takeCapturedShareToken()).toBe(token);
    expect(takeCapturedShareToken()).toBeNull();
  });

  it("strips the fragment and keeps the token in memory only", () => {
    window.history.replaceState(null, "", `/pitwall/shared?ref=x#t=${token}`);
    expect(captureShareTokenFromLocation()).toBe(token);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?ref=x");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("does not capture a malformed fragment but still removes it", () => {
    window.history.replaceState(null, "", "/pitwall/shared#t=not-a-token");
    expect(captureShareTokenFromLocation()).toBeNull();
    expect(window.location.hash).toBe("");
  });
});

describe("shared viewer projection", () => {
  const base = {
    ok: true as const,
    created_at: "2026-11-19T10:00:00.000Z",
    expires_at: "2026-11-19T14:00:00.000Z",
    updated_at: "2026-11-19T10:30:00.000Z",
    circuit: { trackId: 42, name: "Spa", config: "Endurance" },
    track: { name: "Spa", config: "Endurance" },
    session: { driver: "Test", car: "GT3", state: "unknown" },
    v3: { identity: { trackName: "Spa", trackConfig: "Endurance", trackId: 42 } },
    laps: [],
    pace: null,
  } satisfies SharedRace;

  it("lifts only the bounded sector board into a local pace history", () => {
    const snapshot: SharedRace = {
      ...base,
      sectors: {
        available: true,
        reason: null,
        sectorCount: 3,
        cars: [
          {
            id: "car-abc123def456",
            sectorCount: 3,
            sectors: [
              {
                sectorIndex: 0,
                sectorCount: 3,
                lap: 18,
                seconds: 38.1,
                status: "verified",
                referenceSeconds: 38.4,
                revision: 1,
                completedSessionTimeSeconds: 1170,
                observedSessionTimeSeconds: 1200,
              },
            ],
            sectorBests: [{ sectorIndex: 0, lap: 18, seconds: 38.1 }],
            metrics: { observedSessionTimeSeconds: 1200, sectorCount: 3 },
          },
        ],
      },
    };

    const view = sharedViewerV3(snapshot);
    expect(view.identity?.trackId).toBe(42);
    expect(view.transportSessionId).toBe("shared");
    expect(view.paceHistory?.cars[0].id).toBe("car-abc123def456");
    expect((view.paceHistory?.cars[0].sectors?.[0] as unknown as { id: string }).id).toBe("car-abc123def456");
    expect(JSON.stringify(view)).not.toContain("sim-");
  });

  it("returns the base V3 unchanged when sectors are explicitly unavailable", () => {
    const snapshot: SharedRace = {
      ...base,
      sectors: { available: false, reason: "no_sector_data", sectorCount: 0, cars: [] },
    };
    const view = sharedViewerV3(snapshot);
    expect(view.paceHistory).toBeUndefined();
    expect(view.identity?.trackId).toBe(42);
  });
});
