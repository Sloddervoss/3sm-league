import { describe, expect, it } from "vitest";
import { assessPitSegment, derivePitSegments, describeLegacyPitStop, pairPitTelemetryEvents } from "./pitSegments";

const t = (s: string) => `2026-11-11T12:${s}Z`;
const flags = { damage: false, tow: false, reset: false, gap: false };
function evidence(n: number, at = t("00:00")) {
  const source = { sourceKind: "measurement_event", deviceId: "device", sourceUid: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, recordRevision: 1, contentHash: "a".repeat(32), observedAt: at, sourceReceivedAt: t("03:00") };
  const payload = { kind: "pit_service_completed", observed_session_id: "sdk", delivered_session_id: "transport", segment_id: "seg", invalid_reasons: [] };
  return { source, payload, contextEvidence: { source, payload, claims: { provenance: "inline_observed", ownerUserId: "11111111-1111-1111-1111-111111111111", driverId: "driver", carId: "car", trackId: "track", layoutId: "layout" } } };
}
function fixture() {
  const anchors = { basis: "distance_metres", layoutId: "layout", originId: "survey", orientation: "forward", lapWrap: 0, start: 100, end: 500 };
  return { asOf: t("05:00"), predictorCutoff: t("00:00"), maxReferenceAgeSeconds: 600,
    pitEntryAt: t("00:10"), pitExitAt: t("01:00"),
    outcome: { startAt: t("00:00"), endAt: t("01:10"), anchors, flags, evidence: evidence(1), physicalCarId: "chassis", physicalSessionId: "race" },
    reference: { normalTrack: true, startAt: t("00:00").replace("12:", "11:"), endAt: t("00:40").replace("12:", "11:"), anchors: { ...anchors }, flags, evidence: evidence(2, t("00:40").replace("12:", "11:")), physicalCarId: "chassis", physicalSessionId: "race", knownAt: t("00:00").replace("12:", "11:") },
  };
}

describe("pit segment semantics (synthetic trusted facts, not historical coverage)", () => {
  it("retains gross without inventing a reference", () => {
    const input = fixture();
    expect(assessPitSegment({ ...input, reference: null })?.grossPitLaneSeconds).toBe(50);
    expect(assessPitSegment({ ...input, reference: null })?.netDeltaSeconds).toBeNull();
  });
  it("compares exactly the same A→B and retains a positive non-null delta", () => {
    const result = assessPitSegment(fixture());
    expect(result?.segmentSeconds).toBe(70);
    expect(result?.normalSeconds).toBe(40);
    expect(result?.netDeltaSeconds).toBe(30);
    expect(result?.pitLossLabelEligible).toBe(true);
  });
  it("does not equate equal-length spans at different locations", () => {
    const input = fixture();
    input.reference.anchors = { ...input.reference.anchors, start: 200, end: 600 };
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it.each(["damage", "tow", "reset", "gap"])("retains gross but excludes %s", key => {
    const input = fixture();
    input.outcome.flags = { ...flags, [key]: true };
    const result = assessPitSegment(input)!;
    expect(result.grossPitLaneSeconds).toBe(50);
    expect(result.netDeltaSeconds).toBeNull();
    expect(result.serviceLabelEligible).toBe(false);
    expect(result.reasons).toContain(`${key}_observed`);
  });
  it.each([null, {}, { damage: false }, { ...flags, tow: null }])("unknown flags are not false: %j", value => {
    const input = fixture();
    expect(assessPitSegment({ ...input, outcome: { ...input.outcome, flags: value } })?.netDeltaSeconds).toBeNull();
  });
  it.each(["ownerUserId", "driverId", "carId", "trackId", "layoutId"])("rejects reference context mismatch %s", key => {
    const input = fixture();
    const claims = input.reference.evidence.contextEvidence.claims;
    Object.assign(claims, { [key]: key === "ownerUserId" ? "22222222-2222-2222-2222-222222222222" : "other" });
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it.each(["sourceUid", "contentHash", "deviceId", "recordRevision", "observedAt", "sourceReceivedAt"])("binds context to analysed source: %s", key => {
    const input = fixture();
    // Split the source objects: fixtures otherwise intentionally share them.
    input.outcome.evidence.contextEvidence.source = { ...input.outcome.evidence.source, [key]: key === "recordRevision" ? 2 : key.endsWith("At") ? t("00:01") : key === "sourceUid" ? "22222222-2222-2222-2222-222222222222" : key === "contentHash" ? "b".repeat(32) : "other" };
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("accepts a reference with another UID, not another SDK session", () => {
    const input = fixture();
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30);
    input.reference.evidence.payload.observed_session_id = "other-sdk";
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("transport session is not SDK session", () => {
    const input = fixture();
    input.reference.evidence.payload.delivered_session_id = "a-different-delivery";
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30);
  });
  it("owner at receipt cannot provide observation ownership", () => {
    const input = fixture();
    const contextEvidence = { ...input.outcome.evidence.contextEvidence, claims: undefined, ownerAtReceiptUserId: "11111111-1111-1111-1111-111111111111", currentSnapshot: { carId: "car", trackId: "track" } };
    expect(assessPitSegment({ ...input, outcome: { ...input.outcome, evidence: { ...input.outcome.evidence, contextEvidence } } })?.netDeltaSeconds).toBeNull();
  });
  it.each(["session_time_reset", "lap_boundary_gap", "session_changed", "new_unknown_reason"])("uses T10 source gates: %s", reason => {
    const input = fixture();
    input.outcome.evidence.payload.invalid_reasons.push(reason);
    expect(assessPitSegment(input)?.reasons).toContain("source_invalid_reasons");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it.each([{ invalid_reasons: {} }, { invalid_reasons: [null] }, { max_gap_seconds: 3 }, { driver_changed: true }])("rejects malformed or adverse source facts %j", patch => {
    const input = fixture();
    Object.assign(input.outcome.evidence.payload, patch);
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it.each([{ lapWrap: null }, { lapWrap: 0, start: 500, end: 100 }, { orientation: "reverse" }, { basis: "label" }, { originId: "different" }, { lapWrap: 2 }])("does not infer ambiguous wrap/basis %j", patch => {
    const input = fixture();
    Object.assign(input.reference.anchors, patch);
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("qualifies explicitly matching wrapped sectors", () => {
    const input = fixture();
    input.outcome.anchors = { ...input.outcome.anchors, basis: "sector_boundary", start: 3, end: 1, lapWrap: 1 };
    input.reference.anchors = { ...input.outcome.anchors };
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30);
  });
  it("keeps signed negative delta, not a positive training label", () => {
    const input = fixture();
    input.reference.endAt = input.reference.startAt.replace("00:00Z", "02:00Z");
    const result = assessPitSegment(input)!;
    expect(result.netDeltaSeconds).toBe(-50);
    expect(result.pitLossLabelEligible).toBe(false);
    expect(result.reasons).toContain("negative_delta_not_pit_loss_label");
  });
  it("does not treat genuine zero delta as absent", () => {
    const input = fixture();
    input.reference.endAt = input.reference.startAt.replace("00:00Z", "01:10Z");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(0);
  });
  it.each([null, "bad", t("00:00"), t("00:01")])("incomplete/invalid/reversed exit does not yield net %j", exit => {
    expect(assessPitSegment({ ...fixture(), pitExitAt: exit })?.netDeltaSeconds).toBeNull();
  });
  it("zero gross remains zero with an explicit exclusion reason", () => {
    const input = fixture();
    input.pitExitAt = input.pitEntryAt;
    expect(assessPitSegment(input)?.grossPitLaneSeconds).toBe(0);
    expect(assessPitSegment(input)?.reasons).toContain("pitlane_zero");
  });
  it.each([{}, null, [], { evidence: { source: {}, contextEvidence: { payload: [] } }, anchors: { start: [] }, flags: [] }])("nested ordinary malformed JSON never throws %j", outcome => {
    expect(() => assessPitSegment({ ...fixture(), outcome })).not.toThrow();
  });
  it("separates stale retrospective measurement from predictor availability", () => {
    const result = assessPitSegment(fixture())!;
    expect(result.netDeltaSeconds).toBe(30);
    expect(result.predictorReferenceEligible).toBe(false);
    expect(result.predictorReasons).toContain("reference_stale");
  });
  it("positive reference has explicit knownAt, revision receipt and cutoff", () => {
    const input = fixture();
    input.maxReferenceAgeSeconds = 7200;
    input.reference.knownAt = input.reference.endAt;
    input.reference.evidence.source.sourceReceivedAt = input.reference.endAt;
    expect(assessPitSegment(input)?.predictorReferenceEligible).toBe(true);
    expect(assessPitSegment({ ...input, reference: { ...input.reference, knownAt: null } })?.predictorReferenceEligible).toBe(false);
  });
  it("reference after outcome can be retrospective only", () => {
    const input = fixture();
    input.reference.startAt = t("02:00"); input.reference.endAt = t("02:40");
    input.reference.knownAt = t("03:00");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30);
    expect(assessPitSegment(input)?.predictorReasons).toContain("reference_after_cutoff");
  });
  it("reference beyond explicit asOf is excluded", () => {
    const input = fixture(); input.reference.evidence.source.sourceReceivedAt = t("06:00");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("100ns reference receipt cannot sneak before predictor cutoff", () => {
    const input = fixture(); input.maxReferenceAgeSeconds = 7200;
    input.reference.knownAt = input.reference.endAt;
    input.reference.evidence.source.sourceReceivedAt = t("00:00.0000001");
    expect(assessPitSegment(input)?.predictorReasons).toContain("reference_revision_after_cutoff");
  });
  it("100ns and PG microsecond durations survive JSON output", () => {
    const input = fixture(); input.pitEntryAt = t("00:10.0000001"); input.pitExitAt = t("00:10.0000012");
    const result = assessPitSegment(input)!;
    expect(result.grossPitLaneSeconds).toBe(0.0000011);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.provenance[0].observedAt).toBe(input.outcome.evidence.source.observedAt);
  });
  it.each([["1969-12-31T23:59:59.9999999Z", "1970-01-01T00:00:00Z"], ["0001-01-01T00:00:00.0000001Z", "0001-01-01T00:00:00.0000002Z"], ["0000-01-01T01:00:00.0000001+01:00", "0000-01-01T00:00:00.0000002Z"]])("exact calendar/offset duration %s", (a, b) => {
    expect(describeLegacyPitStop({ pit_entry_at: a, pit_exit_at: b })?.grossPitLaneSeconds).toBe(0.0000001);
  });
});

const SERVICE_BINDING = { sourceKind: "measurement_event", deviceId: "device", sourceUid: "00000000-0000-0000-0000-000000000001", recordRevision: 1, contentHash: "a".repeat(32), observedSessionId: "sdk", physicalCarId: "chassis", physicalSessionId: "race", layoutId: "layout", ownerUserId: "11111111-1111-1111-1111-111111111111" };

describe("service semantics", () => {
  const interval = (component: string, start: string, end: string) => ({ component, startAt: t(start), endAt: t(end), performed: true });
  const service = { binding: { ...SERVICE_BINDING }, intervals: [interval("fuel", "00:10", "00:30"), interval("tyres", "00:20", "00:40"), interval("fuel", "00:22", "00:25")], complete: true };
  it("computes partial overlap and nesting as actual union, not max or sum", () => {
    const result = assessPitSegment({ ...fixture(), services: service })!;
    expect(result.serviceUnionSeconds).toBe(30);
    expect(result.serviceCoverage).toBe("complete");
    expect(result.predictedServiceSeconds).toBeNull();
    expect(result.serviceLabelEligible).toBe(false);
    expect(result.netDeltaSeconds).toBe(30); expect(result.grossPitLaneSeconds).toBe(50);
  });
  it.each([["parallel", 20], ["sequential", 40]])("only confirmed %s rules compose predictions", (mode, expected) => {
    const services = { ...service, components: [{ component: "fuel", seconds: 20 }, { component: "tyres", seconds: 20 }], componentsComplete: true, ruleset: { id: "verified-rule", verified: true, mode, physicalSessionId: "race", layoutId: "layout" } };
    const result = assessPitSegment({ ...fixture(), services })!;
    expect(result.predictedServiceSeconds).toBe(expected);
    expect(result.serviceLabelEligible).toBe(true);
    expect(result.serviceUnionSeconds).toBe(30);
    expect(result.grossPitLaneSeconds).toBe(50);
  });
  it("selected/requested service is not performed", () => {
    const result = assessPitSegment({ ...fixture(), services: { ...service, intervals: [{ ...service.intervals[0], performed: false, requested: true }] } })!;
    expect(result.serviceUnionSeconds).toBeNull(); expect(result.serviceCoverage).toBe("unknown");
  });
  it("retains partial measured union without declaring unknown components complete", () => {
    const result = assessPitSegment({ ...fixture(), services: { ...service, intervals: [service.intervals[0], null] } })!;
    expect(result.serviceUnionSeconds).toBe(20); expect(result.serviceCoverage).toBe("partial");
  });
  it("repair is descriptive, not a standard service basis", () => {
    const result = assessPitSegment({ ...fixture(), services: { ...service, intervals: [interval("repair", "00:10", "00:50")] } })!;
    expect(result.serviceUnionSeconds).toBe(40); expect(result.serviceLabelEligible).toBe(false);
    expect(result.serviceReasons).toContain("nonstandard_service");
  });
  it.each([null, { intervals: [null] }, { intervals: [{}] }, { intervals: [], ruleset: [] }, { intervals: Array(33).fill({}) }])("malformed services never throw %j", services => {
    expect(() => assessPitSegment({ ...fixture(), services })).not.toThrow();
    expect(assessPitSegment({ ...fixture(), services })?.serviceLabelEligible).toBe(false);
  });
});

describe("bounded revision capture", () => {
  it("duplicates are idempotent; corrections replace, not multiply stops", () => {
    const a = fixture(), b = fixture(); b.outcome.evidence.source.recordRevision = 2;
    b.outcome.evidence.source.contentHash = "b".repeat(32); b.outcome.endAt = t("01:20");
    expect(derivePitSegments({ asOf: a.asOf, segments: [a, a, b] })?.map(x => x.netDeltaSeconds)).toEqual([40]);
    expect(a.outcome.evidence.source.recordRevision).toBe(1);
  });
  it("future correction and conflict are filtered before revision selection", () => {
    const a = fixture(), b = fixture(); b.outcome.evidence.source.recordRevision = 2;
    b.outcome.evidence.source.sourceReceivedAt = t("05:00.0000001");
    const c = structuredClone(b); c.outcome.evidence.source.contentHash = "b".repeat(32);
    expect(derivePitSegments({ asOf: a.asOf, segments: [b, c, a] })?.map(x => x.netDeltaSeconds)).toEqual([30]);
  });
  it("current conflicting correction fails closed independent of order", () => {
    const a = fixture(), b = fixture(); b.outcome.evidence.source.contentHash = "b".repeat(32);
    const first = derivePitSegments({ asOf: a.asOf, segments: [a, b] });
    expect(first).toEqual(derivePitSegments({ asOf: a.asOf, segments: [b, a] }));
    expect(first?.[0].netDeltaSeconds).toBeNull(); expect(first?.[0].reasons).toContain("revision_or_adapter_conflict");
  });
  it("rejects excessive batches and malformed nested records", () => {
    expect(derivePitSegments({ asOf: fixture().asOf, segments: Array(101).fill(fixture()) })).toBeNull();
    expect(derivePitSegments({ asOf: fixture().asOf, segments: [null, {}, { outcome: { evidence: [] } }] })).toEqual([]);
  });
});

function edge(kind: "pit_entry" | "pit_exit", at: string, sequence: number) {
  return { row: { event_id: "event", team_id: "team", race_run_id: "run", device_id: "device", session_id: "delivered", event_type: kind, event_key: `${kind}:${sequence}`, sequence, captured_at: at, in_pit_lane: kind === "pit_entry", completed_laps: 5 },
    availableAt: t("03:00"), continuity: { ownerUserId: "11111111-1111-1111-1111-111111111111", observedSessionId: "sdk", layoutId: "layout", physicalCarId: "chassis", physicalSessionId: "race", continuityId: "continuous-window", flags: { ...flags } } };
}
describe("actual telemetry edge shapes and legacy stops", () => {
  const pair = (events: unknown[]) => pairPitTelemetryEvents({ asOf: t("05:00"), events })!;
  it("automatically pairs real field names and retries once, without P1 impersonation", () => {
    const entry = edge("pit_entry", t("00:10"), 1), exit = edge("pit_exit", t("01:00"), 2);
    const result = pair([exit, entry, entry]);
    expect(result).toHaveLength(1); expect(result[0].grossPitLaneSeconds).toBe(50);
    expect(result[0].entry).toEqual(entry.row); expect(result[0]).not.toHaveProperty("sourceKind");
  });
  it("one incomplete stop and one orphan exit stay unknown", () => {
    expect(pair([edge("pit_entry", t("00:10"), 1)])[0].reasons).toContain("entry_without_exit");
    expect(pair([edge("pit_exit", t("00:10"), 1)])[0].reasons).toContain("exit_without_entry");
  });
  it.each(["ownerUserId", "observedSessionId", "layoutId", "physicalCarId", "physicalSessionId", "continuityId"])("never pairs across adapter %s", key => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", t("01:00"), 2);
    Object.assign(b.continuity, { [key]: "other" });
    expect(pair([a, b]).every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it.each(["device_id", "session_id", "event_id", "team_id", "race_run_id"])("never pairs across raw %s", key => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", t("01:00"), 2);
    Object.assign(b.row, { [key]: "other" });
    expect(pair([a, b]).every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it.each(["damage", "tow", "reset", "gap"])("does not bridge a %s barrier", key => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_entry", t("00:20"), 2), c = edge("pit_exit", t("01:00"), 3);
    Object.assign(b.continuity.flags, { [key]: true });
    expect(pair([a, b, c]).every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it("unknown continuity is never coalesced false", () => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", t("01:00"), 2);
    expect(pair([{ ...a, continuity: null }, b]).every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it("100ns chronology sorts before pairing, not lexical input order", () => {
    const a = edge("pit_entry", t("00:10.0000001"), 2), b = edge("pit_exit", t("00:10.0000002"), 1);
    expect(pair([b, a])[0].grossPitLaneSeconds).toBe(0.0000001);
  });
  it("future conflict cannot poison an available pair", () => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", t("01:00"), 2);
    const conflict = { ...a, availableAt: t("05:00.0000001"), continuity: null };
    expect(pair([a, b, conflict])[0].grossPitLaneSeconds).toBe(50);
  });
  it("legacy raw archive is diagnostic only; identifiers remain exact", () => {
    const input = { id: "raw-ID", event_id: "event", team_id: "team", race_run_id: null, device_id: "device", session_id: "null", pit_entry_at: t("00:10"), pit_exit_at: t("01:00"), pit_lane_seconds: 50 };
    const result = describeLegacyPitStop(input)!;
    expect(result.grossPitLaneSeconds).toBe(50); expect(result.netDeltaSeconds).toBeNull();
    expect(result.identifiers.session_id).toBe("null"); expect(result.identifiers.race_run_id).toBeNull();
    expect(result).not.toHaveProperty("recordRevision"); expect(result).not.toHaveProperty("contentHash");
  });
  it("stored gross can survive missing exit, but never becomes net", () => {
    const result = describeLegacyPitStop({ pit_entry_at: t("00:10"), pit_exit_at: null, pit_lane_seconds: 50 })!;
    expect(result.grossPitLaneSeconds).toBe(50); expect(result.netDeltaSeconds).toBeNull();
  });
  it.each([-1, NaN, Infinity, "50"])("rejects invalid legacy duration %j", value => {
    expect(describeLegacyPitStop({ pit_lane_seconds: value })?.grossPitLaneSeconds).toBeNull();
  });
  it("visible lap counter reset prevents pairing even with unchanged adapter IDs", () => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", t("01:00"), 2);
    b.row.completed_laps = 0;
    expect(pair([a, b]).every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it("invalid available event time is not silently skipped across a stop", () => {
    const a = edge("pit_entry", t("00:10"), 1), b = edge("pit_exit", "bad", 2);
    expect(pair([a, b])).toBeNull();
  });
});

describe("source capability and exact chronology regressions", () => {
  it("real P1 event payload without trusted adapter context/anchors has no net label", () => {
    const input = fixture();
    // Exact field shape from capture_measurement_events_insert; no archived pit edges.
    const payload = { kind: "pit_service_completed", observed_session_id: "sdk", delivered_session_id: "transport", segment_id: "seg", observed_at: t("00:00"), session_time_seconds: 100, sdk_tick: 30, wear_after: { version: 1, scale: "remaining_percent", fl: 60, fr: 60, rl: 60, rr: 60 }, evidence: { version: 1, source: "pit_service", channels: ["pit_service_flags", "wear_percent", "tire_sets"] } };
    const result = assessPitSegment({ ...input, outcome: { ...input.outcome, anchors: null, flags: null, evidence: { source: input.outcome.evidence.source, payload } } })!;
    expect(result.grossPitLaneSeconds).toBe(50); expect(result.netDeltaSeconds).toBeNull();
    expect(result.serviceUnionSeconds).toBeNull(); expect(result.pitLossLabelEligible).toBe(false);
  });
  it("a lap-summary cannot bypass T10 complete/coverage source gate", () => {
    const input = fixture();
    input.outcome.evidence.source.sourceKind = "lap_summary";
    Object.assign(input.outcome.evidence.payload, { started_at: t("00:00"), ended_at: t("01:10"), complete: true, coverage: null });
    expect(assessPitSegment(input)?.reasons).toContain("source_coverage_unqualified");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("a reference must be proven normal, not simply lack a true pit flag", () => {
    const input = fixture(); input.reference.normalTrack = false;
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
  it("staleness comparison preserves a 100ns boundary", () => {
    const input = fixture(); input.maxReferenceAgeSeconds = 3560;
    expect(assessPitSegment(input)?.predictorReasons).not.toContain("reference_stale");
    input.predictorCutoff = t("00:00.0000001");
    expect(assessPitSegment(input)?.predictorReasons).toContain("reference_stale");
  });
  it("net arithmetic uses exact tick differences before numeric JSON conversion", () => {
    const input = fixture(); input.outcome.endAt = t("01:10.0000001");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30.0000001);
  });
  it("future reference corrections cannot create an earlier conflict", () => {
    const a = fixture(), b = fixture();
    b.reference.evidence.source.recordRevision = 2; b.reference.evidence.source.sourceReceivedAt = t("05:00.0000001");
    expect(derivePitSegments({ asOf: a.asOf, segments: [b, a] })?.[0].netDeltaSeconds).toBe(30);
    b.reference.evidence.source.sourceReceivedAt = t("04:00"); b.reference.endAt = b.reference.startAt.replace("00:00Z", "00:50Z");
    expect(derivePitSegments({ asOf: a.asOf, segments: [b, a] })?.[0].netDeltaSeconds).toBe(20);
  });
  it("JSON key order does not turn a duplicate into a revision conflict", () => {
    const a = fixture(); const b = Object.fromEntries(Object.entries(a).reverse());
    expect(derivePitSegments({ asOf: a.asOf, segments: [a, b] })?.[0].netDeltaSeconds).toBe(30);
  });
  it("service rules bind to the actual physical session and layout", () => {
    const services = { binding: { ...SERVICE_BINDING }, intervals: [], complete: true, components: [{ component: "fuel", seconds: 20 }], componentsComplete: true,
      ruleset: { id: "rule", verified: true, mode: "parallel", physicalSessionId: "other", layoutId: "layout" } };
    expect(assessPitSegment({ ...fixture(), services })?.predictedServiceSeconds).toBeNull();
  });
  it("unknown measured component has only partial descriptive union", () => {
    const services = { binding: { ...SERVICE_BINDING }, complete: true, intervals: [{ component: "unknown", performed: true, startAt: t("00:10"), endAt: t("00:30") }] };
    const result = assessPitSegment({ ...fixture(), services })!;
    expect(result.serviceUnionSeconds).toBe(20); expect(result.serviceCoverage).toBe("partial");
    expect(result.serviceReasons).toContain("service_component_unknown");
  });
  it("an asOf cutoff does not expose future gross duration", () => {
    const input = fixture(); input.asOf = t("00:59.9999999");
    expect(assessPitSegment(input)?.grossPitLaneSeconds).toBeNull();
  });
  it("complete synthetic lap evidence passes T10, but exact future skew cannot", () => {
    const input = fixture(); input.outcome.evidence.source.sourceKind = "lap_summary";
    const group = { sampleCount: 30, validDurationSeconds: 70, maxGapSeconds: 1 };
    Object.assign(input.outcome.evidence.payload, { started_at: t("00:00"), ended_at: t("01:10"), complete: true,
      lap_number: 5, driver_changed: false, pit_lap: true, coverage: { fuel: group, temperature: group, load: group }, max_gap_seconds: 1 });
    expect(assessPitSegment(input)?.netDeltaSeconds).toBe(30);
    Object.assign(input.outcome.evidence.payload, { started_at: t("06:50.0000001"), ended_at: t("08:00.0000001") });
    expect(assessPitSegment(input)?.reasons).toContain("source_window_future");
    expect(assessPitSegment(input)?.netDeltaSeconds).toBeNull();
  });
});

describe("retry idempotency and semantic revision identity", () => {
  const derive = (segments: unknown[], asOf = fixture().asOf) => derivePitSegments({ asOf, segments })!;
  it("treats a later outcome receipt of the same revision as a retry in either order", () => {
    const a = fixture(), b = structuredClone(a);
    b.outcome.evidence.source.sourceReceivedAt = t("04:00");
    b.reference.evidence.source.sourceReceivedAt = t("03:30");
    const x = derive([a, b]), y = derive([b, a]);
    expect(x).toHaveLength(1); expect(x[0].netDeltaSeconds).toBe(30);
    expect(x[0].reasons).not.toContain("revision_or_adapter_conflict");
    expect(y).toEqual(x);
  });
  it("keeps aliased context evidence bound when the canonical retry is selected", () => {
    const a = fixture(), b = structuredClone(a);
    b.outcome.evidence.contextEvidence.source = b.outcome.evidence.source;
    b.outcome.evidence.source.sourceReceivedAt = t("04:00");
    expect(derive([b, a])[0].netDeltaSeconds).toBe(30);
  });
  it("quarantines adapter-fact disagreement at the same revision and hash, in every reason array", () => {
    const a = fixture(), b = structuredClone(a);
    b.outcome.endAt = t("01:20");
    const x = derive([a, b]), y = derive([b, a]);
    expect(x).toEqual(y);
    expect(x[0].netDeltaSeconds).toBeNull();
    expect(x[0].reasons).toContain("revision_or_adapter_conflict");
    expect(x[0].predictorReasons).toContain("revision_or_adapter_conflict");
    expect(x[0].serviceReasons).toContain("revision_or_adapter_conflict");
    expect(x[0].grossPitLaneSeconds).toBe(50);
  });
  it("still quarantines a conflicting hash at the highest revision", () => {
    const a = fixture(), b = structuredClone(a);
    b.outcome.evidence.source.contentHash = "b".repeat(32);
    expect(derive([a, b])[0].netDeltaSeconds).toBeNull();
  });
  it("ignores a retry that only becomes visible after asOf", () => {
    const a = fixture(), b = structuredClone(a);
    b.outcome.evidence.source.sourceReceivedAt = t("05:00.0000001");
    b.reference.evidence.source.sourceReceivedAt = t("03:30");
    const x = derive([a, b]);
    expect(x).toHaveLength(1); expect(x[0].netDeltaSeconds).toBe(30);
  });
});

describe("pairing retries, bounds and native ordering", () => {
  const pair = (events: unknown[], asOf = t("05:00")) => pairPitTelemetryEvents({ asOf, events });
  it("ignores a later visibility retry instead of breaking a valid pair", () => {
    const entry = edge("pit_entry", t("00:10"), 1), exit = edge("pit_exit", t("01:00"), 2);
    const retry = structuredClone(entry); retry.availableAt = t("04:00");
    for (const events of [[retry, entry, exit], [exit, entry, retry]]) {
      const r = pair(events)!;
      expect(r).toHaveLength(1); expect(r[0].grossPitLaneSeconds).toBe(50);
    }
  });
  it("filters a retry that is only visible after asOf", () => {
    const entry = edge("pit_entry", t("00:10"), 1), exit = edge("pit_exit", t("01:00"), 2);
    const retry = structuredClone(entry); retry.availableAt = t("05:00.0000001");
    const r = pair([entry, exit, retry])!;
    expect(r).toHaveLength(1); expect(r[0].grossPitLaneSeconds).toBe(50);
  });
  it("dedupes an exact unbound duplicate into one orphan and never pairs it", () => {
    const a = edge("pit_entry", t("00:10"), 1); delete (a.row as Record<string, unknown>).event_id;
    const b = edge("pit_exit", t("01:00"), 2); delete (b.row as Record<string, unknown>).event_id;
    const one = pair([a, a])!;
    expect(one).toHaveLength(1);
    expect(one[0].entry).toEqual(a.row); expect(one[0].grossPitLaneSeconds).toBeNull();
    expect(pair([a, b, a, b])).toHaveLength(2);
    expect(pair([a, b])!.every(x => x.grossPitLaneSeconds === null)).toBe(true);
  });
  it("uses native sequence only when both edges have one", () => {
    const at = t("00:10");
    const e1 = edge("pit_entry", at, 1), x2 = edge("pit_exit", at, 2);
    const zero = pair([e1, x2])!;
    expect(zero).toHaveLength(1); expect(zero[0].grossPitLaneSeconds).toBe(0);
    expect(zero[0].reasons).toContain("pitlane_zero");
    const e2 = edge("pit_entry", at, 2), x1 = edge("pit_exit", at, 1);
    const reversed = pair([e2, x1])!;
    expect(reversed).toHaveLength(2);
    expect(reversed.every(x => x.grossPitLaneSeconds === null)).toBe(true);
    const noSeqEntry = structuredClone(e1), noSeqExit = structuredClone(x2);
    delete (noSeqEntry.row as Record<string, unknown>).sequence; delete (noSeqExit.row as Record<string, unknown>).sequence;
    expect(pair([noSeqExit, noSeqEntry])).toEqual(pair([noSeqEntry, noSeqExit]));
    expect((pair([noSeqEntry, noSeqExit])![0].entry as Record<string, unknown>)?.sequence).toBeUndefined();
  });
});

describe("service asOf and trusted adapter binding", () => {
  const interval = (component: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ component, startAt: t(start), endAt: t(end), performed: true, ...extra });
  const svc = (intervals: unknown[], extra: Record<string, unknown> = {}) => ({ binding: { ...SERVICE_BINDING }, intervals, complete: true, ...extra });
  it("does not count an interval that ends after asOf and keeps observed work partial", () => {
    const input = fixture(); input.asOf = t("00:30");
    const r = assessPitSegment({ ...input, services: svc([interval("fuel", "00:10", "00:20"), interval("tyres", "00:25", "00:40")]) })!;
    expect(r.serviceUnionSeconds).toBe(10);
    expect(r.serviceCoverage).toBe("partial");
    expect(r.serviceReasons).toContain("service_after_as_of");
    expect(r.serviceLabelEligible).toBe(false);
  });
  it("never clips a future interval end into completed work", () => {
    const input = fixture(); input.asOf = t("00:30");
    const r = assessPitSegment({ ...input, services: svc([interval("tyres", "00:25", "00:40")]) })!;
    expect(r.serviceUnionSeconds).toBeNull();
    expect(r.serviceCoverage).toBe("unknown");
    expect(r.serviceReasons).toContain("service_after_as_of");
  });
  it("keeps a completed past interval descriptive partial while the pit window is open", () => {
    const input = fixture(); input.asOf = t("00:30");
    const r = assessPitSegment({ ...input, services: svc([interval("fuel", "00:10", "00:20")]) })!;
    expect(r.serviceUnionSeconds).toBe(10);
    expect(r.serviceCoverage).toBe("partial");
    expect(r.serviceReasons).toContain("service_pit_window_open");
    expect(r.netDeltaSeconds).toBeNull();
  });
  it("keeps complete coverage for a genuinely closed stop and past intervals", () => {
    const r = assessPitSegment({ ...fixture(), services: svc([interval("fuel", "00:10", "00:30")], {
      components: [{ component: "fuel", seconds: 20 }], componentsComplete: true,
      ruleset: { id: "rule", verified: true, mode: "parallel", physicalSessionId: "race", layoutId: "layout" } }) })!;
    expect(r.serviceUnionSeconds).toBe(20);
    expect(r.serviceCoverage).toBe("complete");
    expect(r.serviceLabelEligible).toBe(true);
    expect(r.serviceReasons).not.toContain("service_after_as_of");
  });
  it("compares the interval end to asOf at 100ns", () => {
    const input = fixture(); input.asOf = t("00:30");
    const atBoundary = assessPitSegment({ ...input, services: svc([interval("fuel", "00:10", "00:30")]) })!;
    expect(atBoundary.serviceUnionSeconds).toBe(20);
    expect(atBoundary.serviceReasons).not.toContain("service_after_as_of");
    const after = assessPitSegment({ ...input, services: svc([interval("fuel", "00:10", "00:30.0000001")]) })!;
    expect(after.serviceUnionSeconds).toBeNull();
    expect(after.serviceReasons).toContain("service_after_as_of");
  });
  it.each(["sourceKind", "deviceId", "sourceUid", "recordRevision", "contentHash", "observedSessionId", "physicalCarId", "physicalSessionId", "layoutId", "ownerUserId"] as const)("rejects a foreign binding %s", key => {
    const wrong = key === "sourceKind" ? "lap_summary" : key === "recordRevision" ? 2 : key === "sourceUid" || key === "ownerUserId" ? "22222222-2222-2222-2222-222222222222" : key === "contentHash" ? "b".repeat(32) : "other";
    const r = assessPitSegment({ ...fixture(), services: svc([interval("fuel", "00:10", "00:20")], { binding: { ...SERVICE_BINDING, [key]: wrong } }) })!;
    expect(r.serviceUnionSeconds).toBeNull(); expect(r.serviceCoverage).toBe("unknown");
    expect(r.serviceReasons).toContain("service_binding_mismatch");
  });
  it.each([undefined, {}, { sourceKind: "measurement_event" }, { ...SERVICE_BINDING, recordRevision: "1" }])("requires an explicit valid binding, not an implicit stop %j", binding => {
    const services = { intervals: [interval("fuel", "00:10", "00:20")], complete: true };
    const r = assessPitSegment({ ...fixture(), services: binding === undefined ? services : { ...services, binding } })!;
    expect(r.serviceUnionSeconds).toBeNull(); expect(r.serviceCoverage).toBe("unknown");
    expect(r.serviceReasons).toContain("service_binding_missing");
  });
  it("never counts an interval asserting another SDK session or layout", () => {
    const r = assessPitSegment({ ...fixture(), services: svc([interval("fuel", "00:10", "00:20", { sessionId: "other-session", layoutId: "other-layout" })]) })!;
    expect(r.serviceUnionSeconds).toBeNull(); expect(r.serviceCoverage).toBe("unknown");
    expect(r.serviceReasons).toContain("service_interval_binding_mismatch");
    const block = assessPitSegment({ ...fixture(), services: svc([interval("fuel", "00:10", "00:20")], { physicalSessionId: "other" }) })!;
    expect(block.serviceUnionSeconds).toBeNull(); expect(block.serviceReasons).toContain("service_binding_mismatch");
    const mixed = assessPitSegment({ ...fixture(), services: svc([
      interval("fuel", "00:10", "00:20", { observedSessionId: "other-session" }),
      interval("tyres", "00:25", "00:35"),
    ]) })!;
    expect(mixed.serviceUnionSeconds).toBe(10); expect(mixed.serviceCoverage).toBe("partial");
  });
  it("documents a real empty union 0 separately from a non-null prediction", () => {
    const r = assessPitSegment({ ...fixture(), services: svc([], { components: [{ component: "fuel", seconds: 20 }], componentsComplete: true,
      ruleset: { id: "rule", verified: true, mode: "parallel", physicalSessionId: "race", layoutId: "layout" } }) })!;
    expect(r.serviceUnionSeconds).toBe(0); expect(r.serviceCoverage).toBe("complete");
    expect(r.predictedServiceSeconds).toBe(20); expect(r.serviceLabelEligible).toBe(true);
  });
});

describe("unknown observation time is not future", () => {
  it("reports a null observedAt as unknown on both outcome and reference", () => {
    const input = fixture();
    input.outcome.evidence.source.observedAt = null;
    input.reference.evidence.source.observedAt = null;
    const r = assessPitSegment(input)!;
    expect(r.reasons).toContain("source_observation_unknown");
    expect(r.reasons).not.toContain("source_observation_after_as_of");
    expect(r.reasons).toContain("reference_source_observation_unknown");
    expect(r.netDeltaSeconds).toBeNull();
  });
  it("still reports a genuinely later observedAt as after asOf", () => {
    const input = fixture(); input.outcome.evidence.source.observedAt = t("06:00");
    const r = assessPitSegment(input)!;
    expect(r.reasons).toContain("source_observation_after_as_of");
    expect(r.reasons).not.toContain("source_observation_unknown");
  });
});

describe("legacy rounding tolerance is exact and inclusive", () => {
  it.each([[49.999, false], [49.998, true], [50, false], [50.001, false], [50.002, true]] as const)("measured %s disagrees=%s", (measured, disagrees) => {
    const r = describeLegacyPitStop({ pit_entry_at: t("00:10"), pit_exit_at: t("01:00"), pit_lane_seconds: measured })!;
    expect(r.grossPitLaneSeconds).toBe(50);
    expect(r.reasons.includes("legacy_duration_disagrees")).toBe(disagrees);
  });
});
