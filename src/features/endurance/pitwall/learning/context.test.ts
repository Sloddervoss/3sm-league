import { describe, expect, it } from "vitest";

import {
  buildCanonicalContext,
  compareCanonicalContexts,
  CONTEXT_POLICY_VERSION,
  CONTEXT_SCHEMA_VERSION,
  parseSourceRecordEnvelope,
  type CanonicalContext,
} from "./context";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "33333333-3333-4333-8333-333333333333";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER_OWNER = "44444444-4444-4444-8444-444444444444";
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

function payload(overrides: Json = {}): Json {
  return {
    observed_session_id: "obs-session-old",
    delivered_session_id: "delivery-session-9",
    segment_id: "seg-abc123",
    lap_number: 12,
    driver_changed: null,
    ...overrides,
  };
}

function binding(src: Json = source(), data: Json = payload()): Json {
  return {
    deviceId: src.deviceId,
    observedSessionId: data.observed_session_id,
    sourceUid: src.sourceUid,
    recordRevision: src.recordRevision,
    contentHash: src.contentHash,
    observedAt: src.observedAt,
  };
}

function fullClaims(src: Json = source(), data: Json = payload(), overrides: Json = {}): Json {
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

function input(overrides: Json = {}): Json {
  const src = (overrides.source as Json | undefined) ?? source();
  const data = (overrides.payload as Json | undefined) ?? payload();
  return {
    source: src,
    payload: data,
    claims: fullClaims(src, data),
    ...overrides,
  };
}

function mustContext(value: CanonicalContext | null): CanonicalContext {
  if (value === null) throw new Error("expected a canonical context");
  return value;
}

describe("canonicale context (T09)", () => {
  it("bouwt een volledige context met gescheiden owner, driver en device", () => {
    const context = mustContext(
      buildCanonicalContext(
        input({
          ownerAtReceiptUserId: OTHER_OWNER,
        }),
      ),
    );

    expect(context.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(context.policyVersion).toBe(CONTEXT_POLICY_VERSION);
    expect(context.identity.owner).toMatchObject({ status: "known", value: OWNER });
    expect(context.identity.driver).toMatchObject({ status: "known", value: "sim-driver-17" });
    expect(context.identity.device).toMatchObject({ status: "known", value: "device-a" });
    expect(context.identity.owner.value).not.toBe(context.identity.driver.value);
    expect(context.identity.owner.value).not.toBe(context.identity.device.value);
    expect(context.car.value).toBe("car-gt3-1");
    expect(context.track.value).toBe("track-spa");
    expect(context.layout.value).toBe("layout-endurance");
    expect(context.compound.value).toBe(3);
    expect(context.regime.value).toBe("dry");
    expect(context.contextStatus).toBe("complete");

    // Ontvangst-eigendom is administratie, geen observatie-eigendom.
    expect(context.ownerAtReceipt).toEqual({ userId: OTHER_OWNER, basis: "at_receipt_only" });
    expect(context.identity.owner.value).toBe(OWNER);
    // Ruwe instant blijft exact bewaard.
    expect(context.source.observedAt).toBe(OBSERVED_AT);
    expect(context.source.deliveredSessionId).toBe("delivery-session-9");
  });

  it("maakt owner onbekend als alleen device-eigenaar bij ontvangst bekend is", () => {
    const context = mustContext(
      buildCanonicalContext({
        source: source(),
        payload: payload(),
        ownerAtReceiptUserId: OTHER_OWNER,
        claims: null,
      }),
    );

    expect(context.identity.owner.status).toBe("unknown");
    expect(context.identity.owner.value).toBeNull();
    expect(context.reasons).toContain("owner_at_receipt_only");
    expect(context.reasons).not.toContain("owner_history_unknown");
    expect(context.contextStatus).toBe("unknown");
  });

  it("verwerpt een oude observatie met een anker van een nieuwe sessie", () => {
    const data = payload({ observed_session_id: "obs-session-old" });
    const context = mustContext(
      buildCanonicalContext({
        source: source(),
        payload: data,
        claims: fullClaims(source(), data, {
          binding: {
            ...binding(source(), data),
            observedSessionId: "obs-session-new",
          },
        }),
      }),
    );

    expect(context.car.status).toBe("unknown");
    expect(context.track.status).toBe("unknown");
    expect(context.compound.status).toBe("unknown");
    expect(context.reasons).toContain("anchor_session_mismatch");
    // Transport- en SDK-sessie zijn verschillende domeinen; ongelijkheid is
    // geen late-delivery-bewijs.
    expect(context.source.observedSessionId).toBe("obs-session-old");
    expect(context.source.deliveredSessionId).toBe("delivery-session-9");
    expect(context.reasons.join(" ")).not.toContain("late");
  });

  it("laat een driverhandoff zonder bewijs onbekend in plaats van te gokken", () => {
    const data = payload({ driver_changed: true });
    const context = mustContext(
      buildCanonicalContext({
        source: source(),
        payload: data,
        claims: fullClaims(source(), data),
      }),
    );
    const reference = mustContext(buildCanonicalContext(input()));

    expect(context.identity.driver.status).toBe("unknown");
    expect(context.identity.driver.value).toBeNull();
    expect(context.identity.driver.reasons).toContain("driver_handoff_unproven");

    const comparison = compareCanonicalContexts(context, reference, "fuel");
    expect(comparison.dimensions.driver).toEqual({
      status: "unknown",
      reason: "context_driver_unknown",
    });
    expect(comparison.contextMatch).toBe(false);
    expect(comparison.blockingReasons).toContain("context_driver_unknown");
  });

  it("laat een ongeldige driverwisselvlag niet als bekende driver doorgaan", () => {
    const data = payload({ driver_changed: "true" });
    const context = mustContext(
      buildCanonicalContext({
        source: source(),
        payload: data,
        claims: fullClaims(source(), data),
      }),
    );

    expect(context.identity.driver.status).toBe("unknown");
    expect(context.identity.driver.reasons).toContain("driver_changed_invalid");
  });

  it("negeert een current snapshot volledig als historische context", () => {
    const context = mustContext(
      buildCanonicalContext(
        input({
          currentSnapshot: {
            car_id: "car-from-latest",
            track_name: "latest-track",
            track_config: "latest-layout",
            owner_user_id: OWNER,
          },
          claims: null,
        }),
      ),
    );

    expect(context.car.status).toBe("unknown");
    expect(context.track.status).toBe("unknown");
    expect(context.layout.status).toBe("unknown");
    expect(context.reasons).toContain("current_snapshot_ignored");
    expect(context.reasons).toContain("car_unknown");
  });

  it("houdt dezelfde auto met een andere layout uit elkaar", () => {
    const reference = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { layoutId: "layout-short" }) })),
    );
    const observed = mustContext(buildCanonicalContext(input()));

    const comparison = compareCanonicalContexts(observed, reference, "fuel");

    expect(comparison.dimensions.car.status).toBe("match");
    expect(comparison.dimensions.track.status).toBe("match");
    expect(comparison.dimensions.layout).toEqual({
      status: "mismatch",
      reason: "context_layout_mismatch",
    });
    expect(comparison.contextMatch).toBe(false);
    expect(comparison.blockingReasons).toContain("context_layout_mismatch");
  });

  it("bewijst geen match wanneer beide kanten onbekend zijn", () => {
    const reference = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { compoundId: undefined }) })),
    );
    const observed = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { compoundId: undefined }) })),
    );

    const fuel = compareCanonicalContexts(observed, reference, "fuel");
    expect(fuel.dimensions.compound).toEqual({
      status: "unknown",
      reason: "context_compound_unknown",
    });
    expect(fuel.warningReasons).toContain("context_compound_unknown");
    expect(fuel.contextMatch).toBe(true); // fuel wacht niet op een wear-dimensie

    const wear = compareCanonicalContexts(observed, reference, "tyre_wear");
    expect(wear.dimensions.compound.status).toBe("unknown");
    expect(wear.blockingReasons).toContain("context_compound_unknown");
    expect(wear.contextMatch).toBe(false);
  });

  it("maakt éénzijdig onbekende context onbekend, niet mismatch of match", () => {
    const known = mustContext(buildCanonicalContext(input()));
    const withoutCompound = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { compoundId: undefined }) })),
    );

    const comparison = compareCanonicalContexts(known, withoutCompound, "tyre_wear");
    expect(comparison.dimensions.compound).toEqual({
      status: "unknown",
      reason: "context_compound_unknown",
    });
    expect(comparison.dimensions.car.status).toBe("match");
  });

  it("eist ankerbinding op device, sessie, sourceUID, revisie en tijd", () => {
    const data = payload();
    const src = source();
    const cases: Array<{ name: string; binding: Json; reason: string }> = [
      {
        name: "device",
        binding: { ...binding(src, data), deviceId: "device-b" },
        reason: "anchor_device_mismatch",
      },
      {
        name: "sourceUID",
        binding: { ...binding(src, data), sourceUid: OTHER_UUID },
        reason: "anchor_source_uid_mismatch",
      },
      {
        name: "revisie",
        binding: { ...binding(src, data), recordRevision: 2 },
        reason: "anchor_revision_mismatch",
      },
      {
        name: "contentHash",
        binding: { ...binding(src, data), contentHash: "fedcba9876543210fedcba9876543210" },
        reason: "anchor_hash_mismatch",
      },
      {
        name: "tijd",
        binding: { ...binding(src, data), observedAt: "2026-11-11T10:00:00.124Z" },
        reason: "anchor_observed_at_mismatch",
      },
    ];

    for (const testCase of cases) {
      const context = mustContext(
        buildCanonicalContext({
          source: src,
          payload: data,
          claims: fullClaims(src, data, { binding: testCase.binding }),
        }),
      );
      expect(context.car.status, testCase.name).toBe("unknown");
      expect(context.reasons, testCase.name).toContain(testCase.reason);
    }

    const missingBinding = mustContext(
      buildCanonicalContext({
        source: src,
        payload: data,
        claims: fullClaims(src, data, { binding: undefined }),
      }),
    );
    expect(missingBinding.reasons).toContain("anchor_binding_missing");
  });

  it("bewijst geen historisch anker zonder waarnemingsmoment", () => {
    const src = source({ observedAt: null });
    const data = payload();
    const context = mustContext(
      buildCanonicalContext({
        source: src,
        payload: data,
        claims: fullClaims(src, data),
      }),
    );

    expect(context.car.status).toBe("unknown");
    expect(context.contextStatus).not.toBe("complete");
    expect(context.reasons).toContain("anchor_observed_at_missing");
    expect(context.reasons).not.toContain("anchor_observed_at_mismatch");
  });

  it("scheidt owner-, driver- en device-ongelijkheid", () => {
    const base = mustContext(buildCanonicalContext(input()));
    const otherOwner = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { ownerUserId: OTHER_OWNER }) })),
    );
    const otherDriver = mustContext(
      buildCanonicalContext(input({ claims: fullClaims(source(), payload(), { driverId: "sim-driver-99" }) })),
    );
    const otherDeviceSource = source({ deviceId: "device-b" });
    const otherDevice = mustContext(
      buildCanonicalContext({
        source: otherDeviceSource,
        payload: payload(),
        claims: fullClaims(otherDeviceSource, payload()),
      }),
    );

    expect(compareCanonicalContexts(base, otherOwner, "fuel").dimensions.owner.status).toBe("mismatch");
    expect(compareCanonicalContexts(base, otherDriver, "fuel").dimensions.driver.status).toBe("mismatch");
    expect(compareCanonicalContexts(base, otherDevice, "fuel").dimensions.device.status).toBe("mismatch");
  });

  it("maakt een ontbrekende referentie expliciet onbekend, nooit match", () => {
    const observed = mustContext(buildCanonicalContext(input()));
    const comparison = compareCanonicalContexts(observed, null, "fuel");

    expect(comparison.contextMatch).toBe(false);
    expect(comparison.blockingReasons).toEqual(
      expect.arrayContaining([
        "context_owner_unknown",
        "context_driver_unknown",
        "context_device_unknown",
        "context_car_unknown",
        "context_track_unknown",
        "context_layout_unknown",
      ]),
    );
  });

  it("valideert bronidentiteit exact zonder String()-coercie", () => {
    expect(parseSourceRecordEnvelope(source())).not.toBeNull();
    expect(parseSourceRecordEnvelope(source({ sourceUid: "not-a-uuid" }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ contentHash: HASH.toUpperCase() }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ recordRevision: 0 }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ recordRevision: 1.5 }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ deviceId: "" }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ deviceId: 42 }))).toBeNull();
    expect(parseSourceRecordEnvelope(source({ sourceKind: "frame" }))).toBeNull();
  });

  it("eist een expliciete tijdzone en bewaart de ruwe instant", () => {
    expect(buildCanonicalContext(input({ source: source({ observedAt: "2026-11-11" }) }))).toBeNull();
    expect(
      buildCanonicalContext(input({ source: source({ observedAt: "2026-11-11T10:00:00" }) })),
    ).toBeNull();
    expect(
      buildCanonicalContext(
        input({ source: source({ observedAt: "2026-11-11T10:00:00.1234567+02:00" }), claims: null }),
      )?.source.observedAt,
    ).toBe("2026-11-11T10:00:00.1234567+02:00");
    expect(
      buildCanonicalContext(
        input({ source: source({ observedAt: "2026-11-11T10:00:00.1234567+02:00" }), claims: null }),
      )?.reasons,
    ).not.toContain("anchor_observed_at_mismatch");
  });

  it("is deterministisch en muteert de invoer niet", () => {
    const frozen = deepFreeze(input());
    const before = JSON.stringify(frozen);
    const first = mustContext(buildCanonicalContext(frozen));
    const second = mustContext(buildCanonicalContext(frozen));

    expect(second).toEqual(first);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(compareCanonicalContexts(first, second, "fuel")).toEqual(
      compareCanonicalContexts(first, second, "fuel"),
    );
  });
});
