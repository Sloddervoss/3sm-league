/**
 * Browserfixture: dezelfde gemeten stop op Mijn Pitwall en de admin-pitwalltest.
 *
 * Beide kolommen gebruiken het echte `PitDurationPanel`, dezelfde feedvorm en
 * dezelfde `.ptp-pit-benchmark`-slot als `PitwallPremiumView`. Het verschil is
 * alleen de geïnjecteerde lezer (owner vs. beheerder); er gaat geen RPC, token
 * of productie-data door deze fixture.
 */
import { createRoot } from "react-dom/client";
import { PitDurationPanel } from "../../../src/features/personal-pitwall/PitDurationPanel";
import type { PersonalPitFeed } from "../../../src/features/personal-pitwall/pitVisits";
import "../../../src/index.css";
import "../../../src/features/endurance/pitwall/test-premium/testPremium.css";

const stop = (visitKey: string): PersonalPitFeed => ({
  available: true,
  reason: null,
  sessionKey: "sim-42-s1",
  diagnostics: { pendingEdges: 0, rejectedEdges: 0, lastRejectReason: null },
  visits: [
    {
      visitKey,
      pitLaneSeconds: 38.125,
      entryObservedAt: "2026-11-21T12:00:00.000Z",
      exitObservedAt: "2026-11-21T12:00:38.125Z",
      entrySessionSeconds: 1001,
      exitSessionSeconds: 1039.125,
      source: "measurement_event_pit_edges",
    },
  ],
});

const ownerFeed = stop("pit-owner-1");
const adminFeed = stop("pit-admin-1");

function Fixture() {
  return (
    <div
      className="min-h-screen bg-[#07080A] p-6 text-slate-200"
      data-pitwall-test-premium="true"
      data-fixture="pit-duration-parity"
    >
      <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
        <section data-fixture-side="personal">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Mijn Pitwall · owner
          </p>
          <div className="ptp-pit-benchmark" data-pit-strategy-benchmark="gross">
            <PitDurationPanel
              deviceId="device-owner"
              enabled
              load={async () => ownerFeed}
              contextKey="device-owner|sim-42-s1"
              pollMs={60_000}
            />
          </div>
        </section>
        <section data-fixture-side="admin">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Pitwall Test · admin (niet-eigen device)
          </p>
          <div className="ptp-pit-benchmark" data-pit-strategy-benchmark="gross">
            <PitDurationPanel
              deviceId="device-admin"
              enabled
              load={async () => adminFeed}
              contextKey="device-admin|sim-42-s1"
              pollMs={60_000}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
