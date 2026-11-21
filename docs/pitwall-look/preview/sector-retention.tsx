/**
 * Browserfixture voor de sparse-sectorregressie.
 *
 * Dezelfde echte componenten en styles als de premium/klassieke Pitwall, maar
 * met een vaste, productievormige PACE-reeks: 16 tegenstanders waarvan de
 * connector per frame maar vier metingen stuurt. De pagina speelt de
 * opeenvolgende frames van de veldmelding af (718 -> 720 -> 722 -> 13 auto's)
 * zodat zichtbaar is dat een bewezen ronde blijft staan als de metingrotatie
 * even niets voor die auto bevat.
 *
 * Alleen voor lokaal bewijs; geen route, geen build-input.
 */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PremiumTimingPanel } from "../../../src/features/endurance/pitwall/test-premium/PremiumTimingPanel";
import { RaceTelemetryStrip } from "../../../src/features/endurance/pitwall/RaceTelemetryStrip";
import { StandingsWidget } from "../../../src/features/endurance/pitwall/StandingsWidget";
import { deriveStandings } from "../../../src/features/endurance/pitwall/standings";
import type { V3Normalized, V3Opponent } from "../../../src/features/endurance/pitwall/pitwallHelpers";
import type { PaceCar, PaceHistory, PaceSectorUpdate } from "../../../supabase/functions/_shared/paceCapture";
import "../../../src/index.css";
import "../../../src/features/endurance/pitwall/test-premium/testPremium.css";
import "../../../src/features/endurance/pitwall/pitwallTimingResponsive.css";

const SESSION = "transport-retention-fixture";

const opp = (
  id: string,
  carNumber: string,
  position: number,
  lap: number,
): V3Opponent => ({
  id,
  carNumber,
  driverName: `Coureur ${carNumber}`,
  teamName: `Team ${carNumber}`,
  carClass: "GT3",
  position,
  classPosition: position,
  lap,
  lastLapSeconds: 121.7,
  bestLapSeconds: 121.2,
  connected: true,
  isPlayer: id === "player",
  gapToPlayerSeconds: position - 1,
});

const FIELD: V3Opponent[] = [
  opp("player", "134", 1, 5),
  opp("leroy", "103", 2, 5),
  opp("bart", "128", 3, 2),
  opp("albert", "151", 4, 3),
  opp("f0820", "77", 5, 4),
  ...Array.from({ length: 11 }, (_, i) => opp(`car-${i}`, String(200 + i), i + 6, 5)),
];

const metric = (id: string, sectorLap: number, observed: number, sectors: number[] | null) => {
  const sum = sectors ? sectors.reduce((a, b) => a + b, 0) : 121.7;
  return {
    id,
    observedSessionTimeSeconds: observed,
    lastLapSeconds: sum,
    bestLapSeconds: Math.max(1, sum - 2),
    lastLapSectorSeconds: sectors,
    bestLapSectorSeconds: null,
    bestSectorSeconds: null,
    bestLapDeltaToFieldBestSeconds: null,
    bestLapDeltaToPlayerSeconds: null,
    lapValid: true,
    lapHighPrecision: null,
    trackPositionPercentRaw: null,
    sectorMismatchCount: 0,
    sectorCount: 3,
    sectorLap,
  };
};

const car = (
  id: string,
  sectorLap: number,
  observed: number,
  sectors: number[] | null,
  live: PaceSectorUpdate[] = [],
): PaceCar => ({
  id,
  laps: [],
  traces: [],
  sectors: live,
  sectorBests: [],
  metrics: metric(id, sectorLap, observed, sectors) as PaceCar["metrics"],
});

const liveUpdate = (id: string, lap: number, sectorIndex: number, seconds: number): PaceSectorUpdate => ({
  id,
  lap,
  sectorIndex,
  sectorCount: 3,
  seconds,
  completedSessionTimeSeconds: 560 + lap * 30 + sectorIndex,
  observedSessionTimeSeconds: 560 + lap * 30 + sectorIndex + 0.4,
  revision: 1,
  status: "verified",
  referenceSeconds: null,
});

const frame = (sessionTime: number, cars: PaceCar[], opponents: V3Opponent[]): V3Normalized => ({
  transportSessionId: SESSION,
  capturedAt: new Date().toISOString(),
  identity: { trackId: 596, trackName: "Spa", trackConfig: "Full Course", currentDriverName: "Jaimy", carName: "Porsche 911 GT3 R" },
  session: { sessionTimeSeconds: sessionTime, isInCar: true, sessionTimeRemainingSeconds: 3200 },
  timing: { lastLapTimeSeconds: 121.7, bestLapTimeSeconds: 121.2, completedLaps: 5 },
  position: { position: 1, classPosition: 1, gapToLeaderSeconds: 0 },
  opponents,
  paceHistory: {
    schemaRevision: 1,
    observedSessionId: "obs-retention",
    segmentId: "seg-retention",
    transportSessionId: SESSION,
    updatedAt: new Date().toISOString(),
    cars,
  } as PaceHistory,
});

const POLLS: Array<{ label: string; frame: V3Normalized }> = [
  {
    label: "seq 718 · 4 pace-auto's, 1 volledige set",
    frame: frame(600, [
      car("player", 4, 598, [40.1, 40.2, 40.3]),
      car("leroy", 4, 597, null),
      car("bart", 1, 519, null),
      car("albert", 2, 559, null),
    ], FIELD),
  },
  {
    label: "seq 720 · 5 volledige sets in de opslag",
    // De connector stuurt vier metingen per frame in rotatie: de reeks van
    // Leroy/Bart/Albert is al 12–80 s oud toen de browser dit frame leest, en
    // f0820's rij is al een ronde verder dan de reeks in zijn metingslot.
    frame: frame(602, [
      car("player", 4, 601, [40.1, 40.2, 40.3]),
      car("leroy", 4, 590, [35.503, 52.35, 33.853]),
      car("bart", 1, 519, [38.1, 40.2, 43.1]),
      car("albert", 2, 559, [39.1, 41.2, 44.1]),
      car("f0820", 3, 600, [36.5, 37.5, 38.5]),
    ], FIELD.map((o) => (o.id === "f0820" ? { ...o, lap: 5 } : o))),
  },
  {
    label: "seq 722 · f0820's slot weer mid-lap (4 sets)",
    frame: frame(604, [
      car("player", 4, 603, [40.1, 40.2, 40.3]),
      car("leroy", 4, 603, [35.503, 52.35, 33.853]),
      car("bart", 1, 523, [38.1, 40.2, 43.1]),
      car("albert", 2, 563, [39.1, 41.2, 44.1]),
      car("f0820", 4, 604, null),
    ], FIELD.map((o) => (o.id === "f0820" ? { ...o, lap: 5 } : o))),
  },
  {
    label: "13 auto's · veld herschikt",
    frame: frame(604, [
      car("player", 4, 603, [40.1, 40.2, 40.3]),
      car("leroy", 4, 603, [35.503, 52.35, 33.853]),
      car("bart", 1, 523, [38.1, 40.2, 43.1]),
      car("albert", 2, 563, [39.1, 41.2, 44.1]),
      car("f0820", 4, 604, null),
    ], [...FIELD.filter((o) => o.id !== "car-10" && o.id !== "car-9" && o.id !== "car-8")].reverse()),
  },
  {
    // Een tussenframe zonder trackidentiteit en met alleen de eigen PACE-auto.
    // Dit is geen baanwissel: de bewezen reeksen moeten blijven staan.
    label: "tussenframe · trackidentiteit ontbreekt, PACE sparse",
    frame: (() => {
      const next = frame(606, [car("player", 4, 605, [40.1, 40.2, 40.3])], FIELD);
      next.identity = undefined;
      return next;
    })(),
  },
  {
    label: "herstel · volledig frame, dezelfde sessie",
    frame: frame(608, [
      car("player", 4, 607, [40.1, 40.2, 40.3]),
      car("leroy", 4, 607, [35.503, 52.35, 33.853]),
      car("bart", 1, 527, [38.1, 40.2, 43.1]),
      car("albert", 2, 567, [39.1, 41.2, 44.1]),
      car("f0820", 3, 606, [36.5, 37.5, 38.5]),
    ], FIELD),
  },
  {
    // S1 van de volgende ronde is binnen, S2/S3 nog niet. De complete R3
    // blijft als geheel staan; er ontstaat geen half-omgewisselde rij.
    label: "gedeeltelijke live-rij · alleen S1 van R4",
    frame: frame(610, [
      car("player", 4, 609, [40.1, 40.2, 40.3]),
      car("leroy", 4, 609, [35.503, 52.35, 33.853]),
      car("bart", 1, 529, [38.1, 40.2, 43.1]),
      car("albert", 2, 569, [39.1, 41.2, 44.1]),
      car("f0820", 3, 610, [36.5, 37.5, 38.5], [liveUpdate("f0820", 4, 0, 36.2)]),
    ], FIELD),
  },
  {
    // Alle drie de sectoren dragen nu R4: de rij mag in één keer om.
    label: "complete live-rij · S1–S3 van R4",
    frame: frame(612, [
      car("player", 4, 611, [40.1, 40.2, 40.3]),
      car("leroy", 4, 611, [35.503, 52.35, 33.853]),
      car("bart", 1, 531, [38.1, 40.2, 43.1]),
      car("albert", 2, 571, [39.1, 41.2, 44.1]),
      car("f0820", 4, 612, [36.2, 37.2, 38.2], [0, 1, 2].map((index) => liveUpdate("f0820", 4, index, 36.2 + index))),
    ], FIELD),
  },
];

declare global {
  interface Window {
    __pitwallPoll?: (index: number) => void;
    __pitwallPollCount?: number;
  }
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const fixed = Number(params.get("poll"));
  const [step, setStep] = useState(Number.isInteger(fixed) && fixed >= 0 && fixed < POLLS.length ? fixed : 0);

  const apply = useCallback((index: number) => {
    setStep(Math.max(0, Math.min(POLLS.length - 1, index)));
  }, []);

  useEffect(() => {
    window.__pitwallPoll = apply;
    window.__pitwallPollCount = POLLS.length;
    return () => {
      delete window.__pitwallPoll;
      delete window.__pitwallPollCount;
    };
  }, [apply]);

  useEffect(() => {
    if (params.has("poll")) return;
    const timer = window.setInterval(() => setStep((value) => Math.min(POLLS.length - 1, value + 1)), 3_000);
    return () => window.clearInterval(timer);
  }, [params]);

  const v3 = POLLS[step].frame;
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);

  return (
    <div
      className="min-h-screen bg-[#07080A] p-4 text-slate-200"
      data-pitwall-test-premium="true"
      data-fixture="sector-retention"
      data-poll={step}
      data-poll-label={POLLS[step].label}
    >
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-300" data-poll-caption>
        Poll {step + 1}/{POLLS.length} · {POLLS[step].label}
      </p>
      <div className="ptp-root" data-motion="off">
        <div className="ptp-kpi">
          <RaceTelemetryStrip v3={v3} live showClassPosition={false} sectorCountOverride={3} stableLayout contextKey="retention-fixture" />
        </div>
        <div className="ptp-main">
          <div className="ptp-timing-col">
            <PremiumTimingPanel
              v3={v3}
              standings={standings}
              ownCarLabel="Jaimy"
              ownCarNumber="134"
              live
              contextKey="retention-fixture"
              gap={false}
              motionEnabled={false}
              layoutSectorCount={3}
            />
          </div>
        </div>
        <section className="mt-6 rounded-xl border border-[#1D2431] bg-[#0B0D11] p-3" data-classic-fixture>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Klassieke route · gedeelde tabel</p>
          <StandingsWidget v3={v3} standings={standings} ownCarLabel="Jaimy" ownCarNumber="134" live />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
