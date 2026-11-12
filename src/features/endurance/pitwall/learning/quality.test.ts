import { describe, expect, it } from "vitest";

import {
  QUALITY_MAX_GAP_SECONDS,
  QUALITY_MIN_COVERED_FRACTION,
  QUALITY_MIN_SAMPLES_PER_GROUP,
  QUALITY_POLICY_VERSION,
  QUALITY_SCHEMA_VERSION,
  assessRecordQuality,
  type RecordQualityAssessment,
} from "./quality";
import { buildCanonicalContext, type CanonicalContext } from "./context";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "33333333-3333-4333-8333-333333333333";
const EVENT_UUID = "55555555-5555-4555-8555-555555555555";
const OWNER = "22222222-2222-4222-8222-222222222222";
const HASH = "0123456789abcdef0123456789abcdef";
const OBSERVED_AT = "2026-11-11T10:00:00.123Z";

type Json = Record<string, unknown>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Json)) deepFreeze(child);
  }
  return value;
}

function source(overrides: Json = {}): Json {
  return {
    sourceKind: "lap_summary",
    deviceId: "device-a",
    sourceUid: UUID,
    recordRevision: 1,
    contentHash: HASH,
    observedAt: OBSERVED_AT,
    sourceReceivedAt: "2026-11-11T10:00:02.456Z",
    ...overrides,
  };
}

function coverageGroup(overrides: Json = {}): Json {
  return { validDurationSeconds: 96, sampleCount: 60, maxGapSeconds: 1.2, ...overrides };
}

function payload(overrides: Json = {}): Json {
  return {
    observed_session_id: "obs-session-1",
    delivered_session_id: "delivery-session-9",
    segment_id: "seg-abc123",
    lap_number: 12,
    started_at: "2026-11-11T10:00:00Z",
    ended_at: "2026-11-11T10:02:00Z",
    complete: true,
    invalid_reasons: [],
    pit_lap: false,
    driver_changed: false,
    fuel_start_litres: 50,
    fuel_end_litres: 47.2,
    fuel_added_litres_observed: 0,
    valid_duration_seconds: 96,
    sample_count: 60,
    max_gap_seconds: 1.2,
    coverage: {
      fuel: coverageGroup(),
      temperature: coverageGroup(),
      load: coverageGroup(),
    },
    ...overrides,
  };
}

/**
 * Echte P1-vorm: `wear_before`/`wear_after` zijn jsonb-objecten met vier
 * hoeken, version en scale. Een scalaire wearwaarde bestaat niet op de draad.
 */
function wear(overrides: Json = {}): Json {
  return { version: 1, scale: "remaining_percent", fl: 64, fr: 64, rl: 64, rr: 64, ...overrides };
}

function eventPayload(overrides: Json = {}): Json {
  return {
    kind: "wear_value_changed",
    observed_session_id: "obs-event-session",
    delivered_session_id: "delivery-event-1",
    segment_id: "seg-event",
    wear_before: wear(),
    wear_after: wear({ fl: 62, fr: 62, rl: 62, rr: 62 }),
    ...overrides,
  };
}

function binding(src: Json, data: Json): Json {
  return {
    deviceId: src.deviceId,
    observedSessionId: data.observed_session_id,
    sourceUid: src.sourceUid,
    recordRevision: src.recordRevision,
    contentHash: src.contentHash,
    observedAt: src.observedAt,
  };
}

function claims(src: Json, data: Json, overrides: Json = {}): Json {
  return {
    provenance: "verified_historical_anchor",
    binding: binding(src, data),
    ownerUserId: OWNER,
    driverId: "sim-driver-17",
    carId: "car-gt3-1",
    trackId: "track-spa",
    layoutId: "layout-endurance",
    compoundId: 3,
    regime: "dry",
    ...overrides,
  };
}

function mustContext(value: CanonicalContext | null): CanonicalContext {
  if (value === null) throw new Error("expected a canonical context");
  return value;
}

function observedContext(overrides: Json = {}, src: Json = source(), data: Json = payload()): CanonicalContext {
  return mustContext(
    buildCanonicalContext({ source: src, payload: data, claims: claims(src, data, overrides) }),
  );
}

function referenceContext(overrides: Json = {}): CanonicalContext {
  const src = source({
    sourceUid: OTHER_UUID,
    observedAt: "2026-11-11T11:00:00.123Z",
    sourceReceivedAt: "2026-11-11T11:00:02.456Z",
  });
  const data = payload({
    observed_session_id: "obs-session-reference",
    delivered_session_id: "delivery-reference",
  });
  return observedContext(overrides, src, data);
}

function qualityInput(overrides: Json = {}): Json {
  return {
    source: source(),
    payload: payload(),
    annotations: { resetOrTow: false },
    ...overrides,
  };
}

function assess(
  input: unknown = qualityInput(),
  observed: CanonicalContext | null = observedContext(),
  reference: CanonicalContext | null = referenceContext(),
): RecordQualityAssessment {
  const value = assessRecordQuality(input, {
    observedContext: observed,
    referenceContext: reference,
  });
  if (value === null) throw new Error("expected a quality assessment");
  return value;
}

describe("recordkwaliteit (T10)", () => {
  it("houdt NULL-flags onbekend en leidt geen normale ronde af", () => {
    const assessment = assess(
      qualityInput({ payload: payload({ pit_lap: null, driver_changed: null }) }),
    );

    expect(assessment.reported.pitLap).toEqual({ status: "absent", value: null, reason: null });
    expect(assessment.reported.driverChanged).toEqual({
      status: "absent",
      value: null,
      reason: null,
    });
    expect(assessment.reported.pitLap.value).not.toBe(false);
    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("pit_lap_unknown");
    expect(assessment.targets.fuel.blockingReasons).toContain("driver_changed_unknown");
    expect(assessment.targets.fuel.warningReasons).not.toContain("driver_changed_unknown");
  });

  it("scheidt bewezen pitronde van bewezen niet-pitronde", () => {
    const pit = assess(qualityInput({ payload: payload({ pit_lap: true }) }));
    expect(pit.targets.fuel.eligible).toBe(false);
    expect(pit.targets.fuel.blockingReasons).toContain("pit_lap_true");

    const normal = assess(qualityInput());
    expect(normal.reported.pitLap).toEqual({ status: "observed", value: false, reason: null });
    expect(normal.targets.fuel.eligible).toBe(true);
  });

  it("bewaart een echte nul met aanwezigheid en onderscheidt afwezigheid", () => {
    const zero = assess(
      qualityInput({
        payload: payload({ fuel_start_litres: 0, fuel_end_litres: 0, fuel_added_litres_observed: 0 }),
      }),
    );
    expect(zero.fuel.startLitres).toEqual({ status: "observed", value: 0, reason: null });
    expect(zero.fuel.usedLitres).toEqual({ status: "observed", value: 0, reason: null });
    expect(zero.targets.fuel.label).toMatchObject({ status: "available", value: 0, unit: "L/lap" });
    expect(zero.targets.fuel.eligible).toBe(false);
    expect(zero.targets.fuel.blockingReasons).toContain("fuel_zero_rate");

    const absent = assess(qualityInput({ payload: payload({ fuel_start_litres: null }) }));
    expect(absent.fuel.startLitres).toEqual({ status: "absent", value: null, reason: null });
    expect(absent.targets.fuel.eligible).toBe(false);
    expect(absent.targets.fuel.blockingReasons).toContain("fuel_start_missing");
  });

  it("verwerpt complete=true wanneer de fuelgroep te weinig dekking heeft", () => {
    const assessment = assess(
      qualityInput({
        payload: payload({
          coverage: {
            fuel: coverageGroup({ validDurationSeconds: 40 }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );

    expect(assessment.reported.complete).toEqual({ status: "observed", value: true, reason: null });
    expect(assessment.coverage.status).toBe("rejected");
    expect(assessment.coverage.reasons).toContain("coverage_fuel_duration");
    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("coverage_fuel_duration");
  });

  it("telt parallelle coveragegroepen nooit op", () => {
    const forty = coverageGroup({ validDurationSeconds: 40 });
    const assessment = assess(
      qualityInput({
        payload: payload({
          coverage: { fuel: forty, temperature: forty, load: forty },
        }),
      }),
    );

    // 3 × 40 s is samen 120 s, maar elke groep dekt slechts 33,3% van het venster.
    expect(assessment.coverage.status).toBe("rejected");
    for (const group of ["fuel", "temperature", "load"] as const) {
      expect(assessment.coverage.reasons).toContain(`coverage_${group}_duration`);
    }
  });

  it("leidt complete niet af uit een ogenschijnlijk volledige coverage", () => {
    const assessment = assess(qualityInput({ payload: payload({ complete: false }) }));

    expect(assessment.reported.complete).toEqual({ status: "observed", value: false, reason: null });
    expect(assessment.coverage.status).toBe("incomplete");
    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("coverage_complete_unproven");
  });

  it("blokkeert fuel bij een bewezen driverwissel binnen de ronde", () => {
    const assessment = assess(qualityInput({ payload: payload({ driver_changed: true }) }));

    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("driver_changed_in_lap");
  });

  it("scheidt een bekend te groot gat van een onbekend gat", () => {
    const tooLarge = assess(
      qualityInput({
        payload: payload({
          max_gap_seconds: 2.5,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 2.5 }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );
    expect(tooLarge.reported.gap).toMatchObject({ status: "observed", value: 2.5, exceedsPolicy: true });
    expect(tooLarge.targets.fuel.blockingReasons).toContain("coverage_fuel_gap");

    const unknown = assess(
      qualityInput({
        payload: payload({
          max_gap_seconds: null,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: null }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );
    expect(unknown.reported.gap.status).toBe("absent");
    expect(unknown.reported.gap.exceedsPolicy).toBeNull();
    expect(unknown.targets.fuel.blockingReasons).toContain("coverage_fuel_gap_unknown");

    const boundary = assess(
      qualityInput({
        payload: payload({
          max_gap_seconds: QUALITY_MAX_GAP_SECONDS,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: QUALITY_MAX_GAP_SECONDS }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );
    expect(boundary.targets.fuel.eligible).toBe(true);
  });

  it("maakt reset/tow expliciet en laat afwezigheid onbekend", () => {
    const observed = assess(
      qualityInput({ annotations: { resetOrTow: true } }),
    );
    expect(observed.reported.resetOrTow).toEqual({ status: "observed", value: true, reason: null });
    expect(observed.targets.fuel.blockingReasons).toContain("reset_or_tow_observed");

    const absent = assess(qualityInput({ annotations: {} }));
    expect(absent.reported.resetOrTow).toEqual({ status: "absent", value: null, reason: null });
    expect(absent.targets.fuel.blockingReasons).toContain("reset_or_tow_unknown");

    const clear = assess(qualityInput());
    expect(clear.reported.resetOrTow).toEqual({ status: "observed", value: false, reason: null });
    expect(clear.targets.fuel.eligible).toBe(true);
  });

  it("maakt onbekende compound/regime targetgericht blokkerend of waarschuwend", () => {
    const fuelAssessment = assess(
      qualityInput(),
      observedContext({ regime: undefined }),
      referenceContext({ regime: undefined }),
    );
    expect(fuelAssessment.targets.fuel.eligible).toBe(true);
    expect(fuelAssessment.targets.fuel.warningReasons).toContain("context_regime_unknown");
    expect(fuelAssessment.targets.fuel.blockingReasons).not.toContain("context_regime_unknown");

    const eventSource = source({
      sourceKind: "measurement_event",
      sourceUid: EVENT_UUID,
      observedAt: "2026-11-11T10:05:00.123Z",
    });
    const eventData = eventPayload();
    const eventObserved = observedContext({ regime: undefined }, eventSource, eventData);
    const eventReference = referenceContext({ regime: undefined });
    const wearAssessment = assess(
      { source: eventSource, payload: eventData, annotations: {} },
      eventObserved,
      eventReference,
    );
    expect(wearAssessment.targets.tyre_wear.eligible).toBe(false);
    expect(wearAssessment.targets.tyre_wear.blockingReasons).toContain("context_regime_unknown");
  });

  it("houdt pit_loss en tyre_pace gescheiden van niet-aanwezige labels", () => {
    const assessment = assess();

    expect(assessment.targets.pit_loss.eligible).toBe(false);
    expect(assessment.targets.pit_loss.label).toMatchObject({
      status: "missing",
      sourceClass: "lap",
    });
    expect(assessment.targets.pit_loss.label.reasons).toContain("pit_stop_duration_missing");

    expect(assessment.targets.tyre_pace.eligible).toBe(false);
    expect(assessment.targets.tyre_pace.label.reasons).toContain("lap_time_seconds_missing");
  });

  it("levert een wear-label uit een event zonder de bron te promoveren", () => {
    const eventSource = source({
      sourceKind: "measurement_event",
      sourceUid: EVENT_UUID,
      observedAt: "2026-11-11T10:05:00.123Z",
    });
    const eventData = eventPayload({
      wear_after: wear({ fl: 0, fr: 0, rl: 0, rr: 0 }),
      wear_before: wear({ fl: 5, fr: 5, rl: 5, rr: 5 }),
    });
    const observed = observedContext({}, eventSource, eventData);
    const assessment = assess(
      { source: eventSource, payload: eventData, annotations: { resetOrTow: false } },
      observed,
      referenceContext(),
    );

    expect(assessment.wear.afterPercent).toEqual({ status: "observed", value: 0, reason: null });
    expect(assessment.targets.tyre_wear.eligible).toBe(true);
    expect(assessment.targets.tyre_wear.label).toMatchObject({
      status: "available",
      value: 0,
      unit: "percent_remaining",
      sourceClass: "event",
    });
    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("fuel_source_class_event");
  });

  it("sanitiseert niet-eindige en onmogelijke getallen met redenen", () => {
    const assessment = assess(
      qualityInput({
        payload: payload({
          fuel_start_litres: -5,
          fuel_end_litres: Number.POSITIVE_INFINITY,
          coverage: {
            fuel: coverageGroup({ sampleCount: -1, validDurationSeconds: Number.NaN, maxGapSeconds: -2 }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );

    expect(assessment.fuel.startLitres.status).toBe("invalid");
    expect(assessment.fuel.startLitres.reason).toBe("fuel_start_litres_negative");
    expect(assessment.fuel.endLitres.status).toBe("invalid");
    expect(assessment.fuel.endLitres.reason).toBe("fuel_end_litres_not_finite");
    expect(assessment.coverage.groups.find((group) => group.group === "fuel")?.status).toBe("invalid");
    expect(assessment.targets.fuel.blockingReasons).toEqual(
      expect.arrayContaining(["fuel_level_invalid", "coverage_fuel_invalid"]),
    );
  });

  it("controleert timestamporde expliciet", () => {
    const assessment = assess(
      qualityInput({
        payload: payload({
          started_at: "2026-11-11T10:02:00Z",
          ended_at: "2026-11-11T10:00:00Z",
        }),
      }),
    );

    expect(assessment.coverage.windowSeconds).toBeNull();
    expect(assessment.coverage.reasons).toContain("coverage_window_order");
    expect(assessment.targets.fuel.blockingReasons).toContain("coverage_fuel_window_missing");
  });

  it("gooit niet op gewone malformed JSON en eist een geldige bron-envelope", () => {
    expect(assessRecordQuality("not-json")).toBeNull();
    expect(assessRecordQuality(null)).toBeNull();
    expect(assessRecordQuality([])).toBeNull();
    expect(assessRecordQuality({ source: source(), payload: "not-an-object" })).toBeNull();
    expect(
      assessRecordQuality({ source: source({ contentHash: "nope" }), payload: payload() }),
    ).toBeNull();
  });

  it("werkt samen met T09: geldige bron matcht, oude layout en onbekende basis blokkeren", () => {
    const positive = assess();
    expect(positive.schemaVersion).toBe(QUALITY_SCHEMA_VERSION);
    expect(positive.policyVersion).toBe(QUALITY_POLICY_VERSION);
    expect(positive.targets.fuel.eligible).toBe(true);
    expect(positive.targets.fuel.label.value).toBeCloseTo(2.8, 10);
    expect(positive.targets.fuel.blockingReasons).toEqual([]);
    expect(positive.targets.fuel.warningReasons).toEqual([]);

    const oldLayout = assess(
      qualityInput(),
      observedContext(),
      referenceContext({ layoutId: "layout-short" }),
    );
    expect(oldLayout.targets.fuel.eligible).toBe(false);
    expect(oldLayout.targets.fuel.blockingReasons).toContain("context_layout_mismatch");

    const unknownBaseline = assess(qualityInput(), observedContext(), null);
    expect(unknownBaseline.targets.fuel.eligible).toBe(false);
    expect(unknownBaseline.targets.fuel.blockingReasons).toContain("context_owner_unknown");
    expect(unknownBaseline.targets.fuel.blockingReasons).toContain("context_layout_unknown");
  });

  it("houdt de quality-drempels gelijk aan het bestaande broncontract", () => {
    expect(QUALITY_MIN_SAMPLES_PER_GROUP).toBe(10);
    expect(QUALITY_MIN_COVERED_FRACTION).toBe(0.8);
    expect(QUALITY_MAX_GAP_SECONDS).toBe(2);
  });

  it("bindt een aangeleverde observedContext aan de invoerbron, niet aan zichzelf", () => {
    const observed = observedContext();
    const reference = referenceContext();
    const data = payload();
    const cases: Array<{ name: string; src: Json; reason: string }> = [
      { name: "sourceKind", src: source({ sourceKind: "measurement_event" }), reason: "observed_context_source_kind_mismatch" },
      { name: "deviceId", src: source({ deviceId: "device-b" }), reason: "observed_context_device_mismatch" },
      { name: "sourceUid", src: source({ sourceUid: OTHER_UUID }), reason: "observed_context_source_uid_mismatch" },
      { name: "recordRevision", src: source({ recordRevision: 2 }), reason: "observed_context_revision_mismatch" },
      { name: "contentHash", src: source({ contentHash: "fedcba9876543210fedcba9876543210" }), reason: "observed_context_content_hash_mismatch" },
      {
        name: "observedAt",
        src: source({ observedAt: "2026-11-11T10:00:00.124Z" }),
        reason: "observed_context_observed_at_mismatch",
      },
      {
        name: "sourceReceivedAt",
        src: source({ sourceReceivedAt: "2026-11-11T10:00:02.457Z" }),
        reason: "observed_context_source_received_at_mismatch",
      },
    ];

    for (const testCase of cases) {
      const assessment = assess(
        qualityInput({ source: testCase.src, payload: data }),
        observed,
        reference,
      );
      expect(assessment.targets.fuel.eligible, testCase.name).toBe(false);
      expect(assessment.targets.fuel.blockingReasons, testCase.name).toContain(testCase.reason);
      expect(assessment.targets.fuel.blockingReasons, testCase.name).toContain(
        "observed_context_binding_failed",
      );
      expect(assessment.reasons, testCase.name).toContain("observed_context_binding_failed");
    }

    const session = assess(
      qualityInput({ payload: payload({ observed_session_id: "obs-session-other" }) }),
      observed,
      reference,
    );
    expect(session.targets.fuel.eligible).toBe(false);
    expect(session.targets.fuel.blockingReasons).toContain("observed_context_session_mismatch");

    const segment = assess(
      qualityInput({ payload: payload({ segment_id: "seg-other" }) }),
      observed,
      reference,
    );
    expect(segment.targets.fuel.eligible).toBe(false);
    expect(segment.targets.fuel.blockingReasons).toContain("observed_context_segment_mismatch");

    // Transport-sessie is een ander domein: ongelijkheid is geen contextfout.
    const transport = assess(
      qualityInput({ payload: payload({ delivered_session_id: "delivery-other" }) }),
      observed,
      reference,
    );
    expect(transport.targets.fuel.eligible).toBe(true);
  });

  it("laat een onbekende observedContext onbekend en een andere referentie gewoon matchen", () => {
    const unknown = assess(qualityInput(), null, referenceContext());
    expect(unknown.targets.fuel.eligible).toBe(false);
    expect(unknown.targets.fuel.blockingReasons).toContain("context_owner_unknown");
    expect(unknown.targets.fuel.blockingReasons).not.toContain("observed_context_binding_failed");

    // De referentie is een historisch record met een andere sourceUid; dat mag.
    const observed = observedContext();
    const reference = referenceContext();
    expect(reference.source.sourceUid).not.toBe(observed.source.sourceUid);
    const positive = assess(qualityInput(), observed, reference);
    expect(positive.targets.fuel.eligible).toBe(true);
  });

  it("gebruikt echte SDK-redenen en blokkeert reset-, sessie- en sprongclaims targetbreed", () => {
    const cases = ["session_time_reset", "session_changed", "lap_boundary_gap", "session_end", "plugin_stop"];
    for (const reason of cases) {
      const assessment = assess(
        qualityInput({ payload: payload({ invalid_reasons: [reason] }) }),
      );
      expect(assessment.targets.fuel.eligible, reason).toBe(false);
      expect(assessment.targets.fuel.blockingReasons, reason).toContain("invalid_reason_global");
      expect(assessment.targets.fuel.blockingReasons, reason).toContain(`invalid_reason:${reason}`);
      expect(assessment.reported.complete.value, reason).toBe(true);
      expect(assessment.reported.resetOrTow.value, reason).toBe(false);
    }
  });

  it("behandelt een onbekende reden fail-closed zonder hem als reset te hernoemen", () => {
    const assessment = assess(
      qualityInput({ payload: payload({ invalid_reasons: ["reset_detected"] }) }),
    );

    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("invalid_reason_unrecognized");
    expect(assessment.targets.fuel.blockingReasons).toContain("invalid_reason:reset_detected");
    expect(assessment.reported.invalidReasons).toEqual(["reset_detected"]);
  });

  it("scopet echte coverage-redenen per groep en detecteert tegenspraak", () => {
    const fuelReason = assess(
      qualityInput({
        payload: payload({
          invalid_reasons: ["coverage_gap:fuel"],
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 1 }),
            temperature: coverageGroup(),
            load: coverageGroup(),
          },
        }),
      }),
    );
    expect(fuelReason.targets.fuel.eligible).toBe(false);
    expect(fuelReason.targets.fuel.blockingReasons).toContain(
      "invalid_reason_contradicts_coverage",
    );
    expect(fuelReason.targets.fuel.blockingReasons).toContain("invalid_reason:coverage_gap:fuel");

    // Een temperatuurprobleem mag een onafhankelijk fuel-label niet blind maken.
    const thermalOnly = assess(
      qualityInput({
        payload: payload({
          invalid_reasons: ["coverage_gap:temperature"],
          max_gap_seconds: 1,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 1 }),
            temperature: coverageGroup({ maxGapSeconds: 1 }),
            load: coverageGroup({ maxGapSeconds: 1 }),
          },
        }),
      }),
    );
    expect(thermalOnly.targets.fuel.eligible).toBe(false);
    expect(thermalOnly.targets.fuel.blockingReasons).toContain("source_invalid_reasons");
    // De specifieke temperatuurreden wordt niet als fuelreden hernoemd; alleen
    // de generieke P1-auditregel sluit de lap-target.
    expect(thermalOnly.targets.fuel.blockingReasons).not.toContain(
      "invalid_reason:coverage_gap:temperature",
    );
    expect(thermalOnly.coverage.status).toBe("unknown");
    expect(thermalOnly.coverage.reasons).toContain(
      "invalid_reason_contradicts_coverage:coverage_gap:temperature",
    );

    // Een consistente temperatuurfout laat de fuelgroep ook ongemoeid op
    // groepsniveau, maar de niet-lege invalid_reasons blijft de auditgrens.
    const thermalFail = assess(
      qualityInput({
        payload: payload({
          invalid_reasons: ["coverage_gap:temperature"],
          max_gap_seconds: 3,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 1 }),
            temperature: coverageGroup({ maxGapSeconds: 3 }),
            load: coverageGroup({ maxGapSeconds: 1 }),
          },
        }),
      }),
    );
    expect(thermalFail.targets.fuel.eligible).toBe(false);
    expect(thermalFail.targets.fuel.blockingReasons).toContain("source_invalid_reasons");
    expect(thermalFail.coverage.status).toBe("rejected");
  });

  it("faalt gesloten op een malformed invalid_reasons-lijst", () => {
    const assessment = assess(
      qualityInput({ payload: payload({ invalid_reasons: "not-a-list" }) }),
    );

    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("invalid_reasons_malformed");
  });

  it("weigert een toekomstig rondevenster tegen sourceReceivedAt", () => {
    const assessment = assess(
      qualityInput({
        payload: payload({
          started_at: "2099-01-01T10:00:00Z",
          ended_at: "2099-01-01T10:02:00Z",
        }),
      }),
    );

    expect(assessment.coverage.windowSeconds).toBeNull();
    expect(assessment.coverage.status).not.toBe("certified");
    expect(assessment.targets.fuel.eligible).toBe(false);
    expect(assessment.targets.fuel.blockingReasons).toContain("coverage_window_future");
  });

  it("eist een expliciete numerieke nul voor refuel en een volledige lapidentiteit", () => {
    const noRefuelData = payload();
    delete noRefuelData.fuel_added_litres_observed;
    const missingRefuel = assess(qualityInput({ payload: noRefuelData }));
    expect(missingRefuel.targets.fuel.eligible).toBe(false);
    expect(missingRefuel.targets.fuel.blockingReasons).toContain("refuel_unknown");

    const malformedRefuel = assess(
      qualityInput({ payload: payload({ fuel_added_litres_observed: "0" }) }),
    );
    expect(malformedRefuel.targets.fuel.eligible).toBe(false);
    expect(malformedRefuel.targets.fuel.blockingReasons).toContain(
      "fuel_added_litres_observed_invalid",
    );

    const noLapData = payload();
    delete noLapData.lap_number;
    const missingLap = assess(qualityInput({ payload: noLapData }));
    expect(missingLap.targets.fuel.eligible).toBe(false);
    expect(missingLap.targets.fuel.blockingReasons).toContain("lap_number_missing");

    const invalidLap = assess(qualityInput({ payload: payload({ lap_number: 0 }) }));
    expect(invalidLap.targets.fuel.eligible).toBe(false);
    expect(invalidLap.targets.fuel.blockingReasons).toContain("lap_number_invalid");

    const missingDriver = assess(
      qualityInput({ payload: payload({ driver_changed: null }) }),
    );
    expect(missingDriver.targets.fuel.eligible).toBe(false);
    expect(missingDriver.targets.fuel.blockingReasons).toContain("driver_changed_unknown");

    const noSessionData = payload();
    delete noSessionData.observed_session_id;
    const missingSession = assess(qualityInput({ payload: noSessionData }), null, referenceContext());
    expect(missingSession.targets.fuel.eligible).toBe(false);
    expect(missingSession.targets.fuel.blockingReasons).toContain("observed_session_missing");

    const noSegmentData = payload();
    delete noSegmentData.segment_id;
    const missingSegment = assess(qualityInput({ payload: noSegmentData }), null, referenceContext());
    expect(missingSegment.targets.fuel.eligible).toBe(false);
    expect(missingSegment.targets.fuel.blockingReasons).toContain("segment_id_missing");
  });

  it("behandelt een tegenstrijdig root-gat als onbekend en blokkerend", () => {
    const contradictory = assess(
      qualityInput({
        payload: payload({
          max_gap_seconds: 30,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 1 }),
            temperature: coverageGroup({ maxGapSeconds: 1 }),
            load: coverageGroup({ maxGapSeconds: 1 }),
          },
        }),
      }),
    );
    expect(contradictory.reported.gap.exceedsPolicy).toBe(true);
    expect(contradictory.targets.fuel.eligible).toBe(false);
    expect(contradictory.targets.fuel.blockingReasons).toContain(
      "max_gap_seconds_contradicts_coverage_gap",
    );
    expect(contradictory.targets.fuel.blockingReasons).not.toContain(
      "reported_max_gap_exceeds_policy",
    );
    expect(contradictory.coverage.status).toBe("unknown");

    // Een consistent rootgat wijst naar de temperatuurgroep; fuel blijft eigen beleid.
    const thermalGap = assess(
      qualityInput({
        payload: payload({
          max_gap_seconds: 30,
          coverage: {
            fuel: coverageGroup({ maxGapSeconds: 1 }),
            temperature: coverageGroup({ maxGapSeconds: 30 }),
            load: coverageGroup({ maxGapSeconds: 1 }),
          },
        }),
      }),
    );
    expect(thermalGap.reported.gap.exceedsPolicy).toBe(true);
    expect(thermalGap.targets.fuel.eligible).toBe(true);
    expect(thermalGap.coverage.status).toBe("rejected");

    const invalid = assess(
      qualityInput({ payload: payload({ max_gap_seconds: -1 }) }),
    );
    expect(invalid.targets.fuel.eligible).toBe(false);
    expect(invalid.targets.fuel.blockingReasons).toContain("reported_gap_invalid");
  });

  it("accepteert alleen echte wear-objecten met een bekend ankertype", () => {
    const eventSource = source({
      sourceKind: "measurement_event",
      sourceUid: EVENT_UUID,
      observedAt: "2026-11-11T10:05:00.123Z",
    });
    const observed = (data: Json) => observedContext({}, eventSource, data);

    const positiveData = eventPayload({
      wear_after: wear({ fl: 0, fr: 0, rl: 0, rr: 0 }),
    });
    const positive = assess(
      { source: eventSource, payload: positiveData, annotations: { resetOrTow: false } },
      observed(positiveData),
      referenceContext(),
    );
    expect(positive.targets.tyre_wear.eligible).toBe(true);
    expect(positive.targets.tyre_wear.label).toMatchObject({
      status: "available",
      value: 0,
      unit: "percent_remaining",
    });

    const arbitraryKindData = eventPayload({ kind: "tyre_reading" });
    const arbitraryKind = assess(
      { source: eventSource, payload: arbitraryKindData, annotations: { resetOrTow: false } },
      observed(arbitraryKindData),
      referenceContext(),
    );
    expect(arbitraryKind.targets.tyre_wear.eligible).toBe(false);
    expect(arbitraryKind.targets.tyre_wear.blockingReasons).toContain("wear_source_kind_unknown");

    const scalarData = eventPayload({ wear_after: 42 });
    const scalar = assess(
      { source: eventSource, payload: scalarData, annotations: { resetOrTow: false } },
      observed(scalarData),
      referenceContext(),
    );
    expect(scalar.targets.tyre_wear.eligible).toBe(false);
    expect(scalar.wear.afterPercent).toMatchObject({
      status: "invalid",
      reason: "wear_shape_unsupported",
    });

    const cornerData = eventPayload({ wear_after: wear({ fl: 60, fr: 61, rl: 62, rr: 63 }) });
    const corner = assess(
      { source: eventSource, payload: cornerData, annotations: { resetOrTow: false } },
      observed(cornerData),
      referenceContext(),
    );
    expect(corner.targets.tyre_wear.eligible).toBe(false);
    expect(corner.wear.afterPercent).toMatchObject({
      status: "invalid",
      reason: "wear_corner_ambiguous",
    });
  });

  it("is deterministisch, gesorteerd/gededupliceerd en muteert niet", () => {
    const frozen = deepFreeze(qualityInput());
    const before = JSON.stringify(frozen);
    const first = assess(frozen);
    const second = assess(frozen);

    expect(second).toEqual(first);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(first.targets.fuel.blockingReasons).toEqual([...first.targets.fuel.blockingReasons].sort());
    expect(new Set(first.targets.fuel.blockingReasons).size).toBe(
      first.targets.fuel.blockingReasons.length,
    );
  });
});
