/**
 * Browserfixture voor de persoonlijke pitduur.
 *
 * Gebruikt het echte `PitDurationPanel` met een geïnjecteerde owner-load; geen
 * RPC, geen share-token en geen productie-data. Alleen lokaal bewijs.
 */
import { createRoot } from "react-dom/client";
import { PitDurationPanel } from "../../../src/features/personal-pitwall/PitDurationPanel";
import type { PersonalPitFeed } from "../../../src/features/personal-pitwall/pitVisits";
import "../../../src/index.css";
import "../../../src/features/endurance/pitwall/test-premium/testPremium.css";

const feed: PersonalPitFeed = {
  available: true,
  reason: null,
  sessionKey: "sim-42-s1",
  diagnostics: { pendingEdges: 0, rejectedEdges: 0, lastRejectReason: null },
  visits: [
    {
      visitKey: "pit-seg-abc-1",
      pitLaneSeconds: 38.125,
      entryObservedAt: "2026-11-21T12:00:00.000Z",
      exitObservedAt: "2026-11-21T12:00:38.125Z",
      entrySessionSeconds: 1001,
      exitSessionSeconds: 1039.125,
      source: "measurement_event_pit_edges",
    },
    {
      visitKey: "pit-seg-abc-2",
      pitLaneSeconds: 41.75,
      entryObservedAt: "2026-11-21T11:47:00.000Z",
      exitObservedAt: "2026-11-21T11:47:41.750Z",
      entrySessionSeconds: 200,
      exitSessionSeconds: 241.75,
      source: "measurement_event_pit_edges",
    },
  ],
};

function Fixture() {
  return (
    <div className="min-h-screen bg-[#07080A] p-6 text-slate-200" data-pitwall-test-premium="true" data-fixture="pit-duration">
      <div className="max-w-md">
        <PitDurationPanel deviceId="fixture-device" enabled load={async () => feed} pollMs={60_000} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
