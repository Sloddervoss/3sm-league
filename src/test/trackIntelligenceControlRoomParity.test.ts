import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Track Intelligence Control Room parity", () => {
  it("retains the original compact Top 30 coverage planning view", () => {
    const legacy = read("src/pages/TrackIntelligenceTestPage.tsx");
    const controlRoom = read("src/features/control-room/track/TrackIntelligenceModule.tsx");

    expect(legacy).toContain("const trackCoverageLimit = 30");
    expect(legacy).toContain("Trackdekking top {trackCoverageLimit}");
    expect(controlRoom).toContain("insights.slice(0, 30)");
    expect(controlRoom).toContain("Trackdekking top 30");
    expect(controlRoom).toContain("maxTrackMembers");
    expect(controlRoom).toContain("topCoverageTracks.map");
  });

  it("keeps scanner coverage behind one compact accessible dialog button", () => {
    const controlRoom = read("src/features/control-room/track/TrackIntelligenceModule.tsx");
    const dataHook = read("src/features/control-room/track/useTrackIntelligence.ts");

    expect(controlRoom).toContain("Scannerdekking");
    expect(controlRoom).toContain('aria-haspopup="dialog"');
    expect(controlRoom).toContain('role="dialog"');
    expect(controlRoom).toContain('aria-modal="true"');
    expect(controlRoom).toContain("Nog niet gescand");
    expect(controlRoom).toContain("xl:grid-cols-5");
    expect(dataHook).toContain("buildTrackScannerCoverage(historyRows || [], linkedProfiles || [])");
  });
});
