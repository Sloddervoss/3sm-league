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
  sessionKey: "session-fixture",
  visits: [
    { visitKey: "pit:130", pitLaneSeconds: 38.125, entryLap: 10, exitLap: 10, driver: "Coureur 134", source: "tyre_observation_pit_edges" },
    { visitKey: "pit:80", pitLaneSeconds: 41.75, entryLap: 6, exitLap: 6, driver: "Coureur 134", source: "tyre_observation_pit_edges" },
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
