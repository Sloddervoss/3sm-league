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

function eventPayload(overrides: Json = {}): Json {
  return {
    kind: "tyre_reading",
    observed_session_id: "obs-event-session",
    delivered_session_id: "delivery-event-1",
    segment_id: "seg-event",
    wear_before: 64,
    wear_after: 62,
    ...overrides,
  };
}

function binding(src: Json, data: Json): Json {
  return {
    deviceId: src.deviceId,
    observedSessionId: data.observed_session_id,
    sourceUid: src.sourceUid,
    recordRevision: src.recordRevision,
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
    expect(assessment.targets.fuel.warningReasons).toContain("driver_changed_unknown");
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
    const eventData = eventPayload({ wear_after: 0, wear_before: 5 });
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
