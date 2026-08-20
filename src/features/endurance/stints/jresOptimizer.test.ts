import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { marshalJresInput, buildJresStints, buildJresAvailability, parseJresOutput, enforceConsecutiveLimits, keyFor, runOptimize, type OptimizerFetcher } from "./jresOptimizer";

describe("jresOptimizer marshalling", () => {
  it("builds fixed stint segments covering the full race without gaps", () => {
    const state = createEnduranceSeed();
    const event = state.events[0];
    const segs = buildJresStints(event, 90);
    expect(segs[0].startTime).toBe(event.startAt);
    expect(segs.at(-1)?.endTime).toBe(event.endAt);
    // geen gaten
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
  });

  it("rounds segments to whole-hour boundaries to avoid the JRES half-hour heap crash", () => {
    const state = createEnduranceSeed();
    // Race die NIET op een heel uur start (JRES crasht anders op halve uren).
    const event = { ...state.events[0], startAt: "2026-09-12T14:37:00.000Z", endAt: "2026-09-12T20:23:00.000Z" };
    const segs = buildJresStints(event, 90);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.startTime.endsWith(":00:00.000Z")).toBe(true); // heel uur
      expect(s.endTime.endsWith(":00:00.000Z")).toBe(true); // heel uur
    }
    // dekt het (afgeronde) volledige venster zonder gaten
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
  });

  it("discretiseert tankduur naar beneden zodat een stint de tankduur nooit overschrijdt (bevinding 8)", () => {
    const state = createEnduranceSeed();
    // 90 min tank zoals in de UI; floor(90/60)=1 → segmenten van maximaal 1 uur.
    const segs = buildJresStints(state.events[0], 90);
    for (const s of segs) {
      const durMin = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60_000;
      expect(durMin).toBeLessThanOrEqual(90);
      // discretisatie op min. hele uren
      expect(durMin % 60).toBe(0);
    }
    // Behoud van dekking (geen gaten).
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
  });

  it("maps team members to driver/spotter roles", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { isDriver: true }, "user-sven": { isSpotter: true } },
    });
    const jaimy = inObj.teamMembers.find((m) => m.name === "user-jaimy");
    expect(jaimy?.isDriver).toBe(true);
    const sven = inObj.teamMembers.find((m) => m.name === "user-sven");
    expect(sven?.isSpotter).toBe(true);
  });

  it("sets consecutiveStints/minRest from driver options", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { maxConsecutiveStints: 2, minRestMinutes: 120 }, "user-sven": { maxConsecutiveStints: 3, minRestMinutes: 60 } },
    });
    expect(inObj.consecutiveStints).toBe(3); // max over coureurs: de grootste gewenste reeks telt
    expect(inObj.minimumRestHours).toBe(1); // 60/60
  });

  it("selects firstStintDriver from willingToStart", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { willingToStart: true }, "user-sven": {} },
    });
    expect(inObj.firstStintDriver).toBe("user-jaimy");
  });

  it("produces availability keys rounded to the hour (JRES spec)", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy"], { tankMinutes: 90 });
    const keys = Object.keys(inObj.availability["user-jaimy"]).sort();
    for (const k of keys) expect(k).toMatch(/T\d{2}:00:00\.000Z$/);
  });

  it("parses JRES output back into EnduranceStint drafts", () => {
    const state = createEnduranceSeed();
    const event = state.events[0];
    const stints = parseJresOutput(
      {
        schedule: [
          { id: 1, driver: "user-jaimy", spotter: "N/A", startTime: "2026-01-01T12:00:00Z", endTime: "2026-01-01T13:30:00Z" },
          { id: 2, driver: "user-sven", spotter: "N/A", startTime: "2026-01-01T13:30:00Z", endTime: "2026-01-01T15:00:00Z" },
        ],
      },
      event,
      "team-orange-31"
    );
    expect(stints).toHaveLength(2);
    expect(stints[0].driverId).toBe("user-jaimy");
    expect(stints[0].teamId).toBe("team-orange-31");
    expect(stints[0].status).toBe("draft");
    expect(stints[0].notes).toContain("JRES");
  });

  it("availability per coureur: géén eigen blokken = altijd Available, wél blokken = beschikbaar binnenblokkering", () => {
    const state = createEnduranceSeed();
    const event = state.events[0];
    const userIds = ["user-rookie", "user-jaimy"];
    const map = buildJresAvailability(state, event, userIds);
    // 1) Coureur zonder OWN blokken wordt over het hele venster 'Available'
    //    (niet 'Unavailable'), óók wanneer een teamgenoot wél blokken heeft.
    const rookie = Object.values(map["user-rookie"]);
    expect(rookie.length).toBeGreaterThan(0);
    expect(rookie.every((v) => v === "Available")).toBe(true);
    // 2) Coureur mét blokken krijgt 'Unavailable' daarbuiten en 'Preferred'/
    //    'Available' binnen de blokken.
    const jaimy = map["user-jaimy"];
    const values = Object.values(jaimy);
    expect(values).toContain("Unavailable");
    expect(values).toContain("Preferred");
    expect(values).toContain("Available");
  });

  it("buildJresAvailability: een 'unavailable'-blok maakt de bucket 'Unavailable', géén 'Available'", () => {
    // Regression: voorheen werd het EÉRSTE overlappende blok als 'Available'
    // behandeld tenzij 'preferred' — een 'unavailable'/'avoid'-blok telde dan
    // mee als beschikbaar, waardoor de optimizer coureurs op onbeschikbare
    // uren plande (live: Steven 15:00-17:00 terwijl hij 13-18u unavailable had).
    const state = createEnduranceSeed();
    const event = state.events[0];
    state.availability.push({
      id: "av-jaimy-off", eventId: event.id, userId: "user-jaimy",
      startAt: "2026-07-25T14:00:00.000Z", endAt: "2026-07-25T15:30:00.000Z",
      type: "unavailable", note: "Vaste afspraak",
    });
    const map = buildJresAvailability(state, event, ["user-jaimy"]);
    const jaimy = map["user-jaimy"];
    // T14 valt binnen het unavailable-blok → 'Unavailable', nooit 'Available'.
    const k14 = keyFor("2026-07-25T14:00:00.000Z");
    expect(jaimy[k14]).toBe("Unavailable");
    // De bestaande preferred (10-14) en available (15:30-17:30) blijven intact:
    // T11 valt in preferred, T15 valt in available (begint 15:30).
    const k11 = keyFor("2026-07-25T11:00:00.000Z");
    const k15 = keyFor("2026-07-25T15:00:00.000Z");
    expect(jaimy[k11]).toBe("Preferred");
    expect(jaimy[k15]).toBe("Available");
  });

  it("enforceConsecutiveLimits herverdeelt overtollige aaneengesloten stints naar een coureur binnen diens eigen limiet", () => {
    const base = createEnduranceSeed().events[0];
    const mk = (i: number, driverId: string, h: number) => ({
      id: `stint-${i}`, eventId: base.id, teamId: "t", driverId,
      originalStartAt: new Date(`2026-08-22T${String(h).padStart(2, "0")}:00:00Z`).toISOString(),
      originalEndAt: new Date(`2026-08-22T${String(h + 1).padStart(2, "0")}:00:00Z`).toISOString(),
      actualStartAt: new Date(`2026-08-22T${String(h).padStart(2, "0")}:00:00Z`).toISOString(),
      actualEndAt: new Date(`2026-08-22T${String(h + 1).padStart(2, "0")}:00:00Z`).toISOString(),
      expectedLaps: 10, fuelLitres: 10, tyreChange: false, doubleStint: false, notes: "", status: "draft" as const,
    });
    // JRES gaf: devos dubbel (h0+h1), ricky dubbel (h2+h3), weijts dubbel (h4+h5) — ongeldig voor de max=1.
    const input = [
      mk(1, "user-devos", 0), mk(2, "user-devos", 1),
      mk(3, "user-ricky", 2), mk(4, "user-ricky", 3),
      mk(5, "user-weijts", 4), mk(6, "user-weijts", 5),
    ];
    const opts = {
      "user-devos": { maxConsecutiveStints: 2 },
      "user-ricky": { maxConsecutiveStints: 2 },
      "user-weijts": { maxConsecutiveStints: 1 },
      "user-steven": { maxConsecutiveStints: 1 },
    };
    const out = enforceConsecutiveLimits(input, opts, {}, ["user-devos", "user-ricky", "user-weijts", "user-steven"]);
    // Weijts mag maar 1 achter elkaar; de 2e weijts-stint wordt herverdeeld.
    for (let i = 1; i < out.length; i++) {
      if (out[i].driverId === "user-weijts") expect(out[i - 1].driverId).not.toBe("user-weijts");
    }
    // devos en ricky mogen wél 2 — hun dubbel mag overeind blijven.
    expect(out[0]?.driverId).toBe("user-devos");
    expect(out[1]?.driverId).toBe("user-devos");
  });

  it("verplaatst NIET naar een coureur die in een later deel van de stint onbeschikbaar is (bevinding 7)", () => {
    const base = createEnduranceSeed().events[0];
    const mk = (i: number, driverId: string, h0: number, h1: number) => ({
      id: `stint-${i}`, eventId: base.id, teamId: "t", driverId,
      originalStartAt: new Date(`2026-08-22T${String(h0).padStart(2, "0")}:00:00Z`).toISOString(),
      originalEndAt: new Date(`2026-08-22T${String(h1).padStart(2, "0")}:00:00Z`).toISOString(),
      actualStartAt: new Date(`2026-08-22T${String(h0).padStart(2, "0")}:00:00Z`).toISOString(),
      actualEndAt: new Date(`2026-08-22T${String(h1).padStart(2, "0")}:00:00Z`).toISOString(),
      expectedLaps: 10, fuelLitres: 10, tyreChange: false, doubleStint: false, notes: "", status: "draft" as const,
    });
    // devos rijdt een dubbel (00-02 en 02-04); bij 'max 1' moet de 2e worden herverdeeld.
    const input = [mk(1, "user-devos", 0, 2), mk(2, "user-devos", 2, 4)];
    const opts = { "user-devos": { maxConsecutiveStints: 1 }, "user-ricky": { maxConsecutiveStints: 1 }, "user-steven": { maxConsecutiveStints: 1 } };
    // De te herverdelen stint is 02-04u. ricky is om 02:00 beschikbaar MAAR om
    // 03:00 (later deel van die stint) NIET. Een check die alleen het startuur
    // ziet, zou tóch naar ricky verplaatsen; de hele-dur-check moet uitwijken
    // naar steven die óók het tweede uur dekt.
    const availability = {
      "user-devos": { "2026-08-22T00:00:00.000Z": "Available", "2026-08-22T01:00:00.000Z": "Available", "2026-08-22T02:00:00.000Z": "Available" },
      "user-ricky": { "2026-08-22T02:00:00.000Z": "Available", "2026-08-22T03:00:00.000Z": "Unavailable", "2026-08-22T04:00:00.000Z": "Unavailable" },
      "user-steven": { "2026-08-22T02:00:00.000Z": "Available", "2026-08-22T03:00:00.000Z": "Available", "2026-08-22T04:00:00.000Z": "Available" },
    };
    const out = enforceConsecutiveLimits(input, opts, availability, ["user-devos", "user-ricky", "user-steven"]);
    expect(out).toHaveLength(2);
    expect(out[1]?.driverId).toBe("user-steven");
  });

  it("prefereert de rustigste volledig beschikbare coureur als vervanger", () => {
    const base = createEnduranceSeed().events[0];
    const mk = (i: number, driverId: string, h: number) => ({
      id: `stint-${i}`, eventId: base.id, teamId: "t", driverId,
      originalStartAt: new Date(`2026-08-22T${String(h).padStart(2, "0")}:00:00Z`).toISOString(),
      originalEndAt: new Date(`2026-08-22T${String(h + 1).padStart(2, "0")}:00:00Z`).toISOString(),
      actualStartAt: new Date(`2026-08-22T${String(h).padStart(2, "0")}:00:00Z`).toISOString(),
      actualEndAt: new Date(`2026-08-22T${String(h + 1).padStart(2, "0")}:00:00Z`).toISOString(),
      expectedLaps: 10, fuelLitres: 10, tyreChange: false, doubleStint: false, notes: "", status: "draft" as const,
    });
    const input = [mk(1, "user-devos", 4), mk(2, "user-devos", 5)];
    const opts = { "user-devos": { maxConsecutiveStints: 1 } };
    const availability = {
      "user-devos": { "2026-08-22T04:00:00.000Z": "Available", "2026-08-22T05:00:00.000Z": "Available" },
      "user-ricky": { "2026-08-22T05:00:00.000Z": "Available", "2026-08-22T06:00:00.000Z": "Available" },
      "user-steven": { "2026-08-22T05:00:00.000Z": "Available", "2026-08-22T06:00:00.000Z": "Available" },
    };
    const out = enforceConsecutiveLimits(input, opts, availability, ["user-devos", "user-ricky", "user-steven"]);
    expect(out).toHaveLength(2);
    expect(["user-ricky", "user-steven"]).toContain(out[1]?.driverId);
  });
});

describe("runOptimize orchestration", () => {
  const seed = () => {
    const state = createEnduranceSeed();
    return { state, event: state.events[0], teamId: "team-orange-31", members: ["user-jaimy", "user-sven"] };
  };
  const okFetcher: OptimizerFetcher = async () => ({
    status: "ok",
    output: {
      schedule: [
        { id: 1, driver: "user-jaimy", spotter: "N/A", startTime: "2026-01-01T12:00:00Z", endTime: "2026-01-01T13:30:00Z" },
        { id: 2, driver: "user-sven", spotter: "N/A", startTime: "2026-01-01T13:30:00Z", endTime: "2026-01-01T15:00:00Z" },
      ],
    },
  });

  it("returns stints on ok from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, okFetcher);
    expect(r.ok).toBe(true);
    expect(r.stints).toHaveLength(2);
    expect(r.stints[0].driverId).toBe("user-jaimy");
    expect(r.message).toContain("2 stints");
  });

  it("surfaces infeasible from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => ({ status: "infeasible", output: { schedule: [], diagnosis: ["conflict"] } });
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad);
    expect(r.ok).toBe(false);
    expect(r.stints).toHaveLength(0);
    expect(r.message).toContain("Geen geldige planning");
  });

  it("surfaces error from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => ({ status: "error", error: "boom" });
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("boom");
  });

  it("guards against no members or too-short tank", async () => {
    const { state, event, teamId } = seed();
    const r = await runOptimize(state, event, [], teamId, { tankMinutes: 3 }, okFetcher);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Voeg eerst coureurs toe");
  });

  it("propagates scheduler/network exceptions", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => { throw new Error("net down"); };
    await expect(runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad)).rejects.toThrow("net down");
  });

  it("E2E: een coureur met maxConsecutiveStints=1 (of NULL/ongelimiteerd=default 1) krijgt na runOptimize nooit 2 stints achter elkaar", async () => {
    const state = createEnduranceSeed();
    const event = state.events[0]; // 11:00-17:00, 6u
    // Steven heeft GEEN maxConsecutiveStints ingesteld (NULL) → default = 1.
    // JRES geeft hem tóch twee opeenvolgende segmenten (net als de echte live
    // situatie waar Wijts/Steven een NULL-inschrijving hadden).
    const sched = [
      { id: 1, driver: "user-jaimy", spotter: "N/A", startTime: "2026-07-25T11:00:00Z", endTime: "2026-07-25T12:00:00Z" },
      { id: 2, driver: "user-sven", spotter: "N/A", startTime: "2026-07-25T12:00:00Z", endTime: "2026-07-25T13:00:00Z" },
      // Steven dubbel! 13:00-14:00 en 14:00-15:00 — overtreding voor default=1.
      { id: 3, driver: "user-steven", spotter: "N/A", startTime: "2026-07-25T13:00:00Z", endTime: "2026-07-25T14:00:00Z" },
      { id: 4, driver: "user-steven", spotter: "N/A", startTime: "2026-07-25T14:00:00Z", endTime: "2026-07-25T15:00:00Z" },
      // De rest netjes wisselen.
      { id: 5, driver: "user-jaimy", spotter: "N/A", startTime: "2026-07-25T15:00:00Z", endTime: "2026-07-25T16:00:00Z" },
      { id: 6, driver: "user-sven", spotter: "N/A", startTime: "2026-07-25T16:00:00Z", endTime: "2026-07-25T17:00:00Z" },
    ];
    const fetcher: OptimizerFetcher = async () => ({ status: "ok", output: { schedule: sched } });
    const members = ["user-jaimy", "user-sven", "user-steven"];
    const r = await runOptimize(state, event, members, "team-orange-31", {
      tankMinutes: 60,
      driverOpts: {
        "user-jaimy": { maxConsecutiveStints: 2 },
        "user-sven": { maxConsecutiveStints: 2 },
        // Steven: géén maxConsecutiveStints opgegeven (NULL) → moet default 1 zijn
        "user-steven": { willingToStart: false },
      },
    }, fetcher);
    expect(r.ok).toBe(true);
    expect(r.stints.length).toBe(6);
    // Steven mag na de post-correctie nooit meer gevolgd worden door Steven zelf.
    for (let i = 1; i < r.stints.length; i++) {
      if (r.stints[i].driverId === "user-steven") {
        expect(r.stints[i - 1].driverId).not.toBe("user-steven");
      }
    }
  });
});
