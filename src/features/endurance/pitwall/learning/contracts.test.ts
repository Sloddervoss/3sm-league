import { describe, expect, it } from "vitest";

import {
  MAX_LEARNING_PAYLOAD_BYTES,
  MAX_REASON_CODES,
  MAX_REASON_CODE_LENGTH,
  parseLearningContribution,
} from "./contracts";

const KNOWN_MODEL = "fuel-2026-11-a";
const KNOWN = { knownModelVersions: [KNOWN_MODEL] } as const;

type Payload = Record<string, unknown>;

function base(overrides: Payload = {}): Payload {
  return {
    schemaVersion: 1,
    target: "fuel",
    state: "shadow",
    modelVersion: KNOWN_MODEL,
    featureVersion: "pitwall-features-v1",
    policyVersion: "pitwall-policy-v1",
    trainedThrough: "2026-11-10T12:00:00Z",
    sourceFrameSequence: "18422",
    sourceObservedAt: "2026-11-11T10:00:00Z",
    contextMatch: true,
    decisive: false,
    reasonCodes: ["shadow_only"],
    estimate: 2.84,
    lower: 2.79,
    upper: 2.9,
    unit: "L/lap",
    independentSessions: 12,
    independentSets: null,
    ...overrides,
  };
}

function without(key: string, overrides: Payload = {}): Payload {
  const value = base(overrides);
  delete value[key];
  return value;
}

function tyreWear(overrides: Payload = {}): Payload {
  return base({
    target: "tyre_wear",
    unit: "percent_remaining",
    corner: "fl",
    estimate: 62.5,
    lower: 58,
    upper: 67,
    ...overrides,
  });
}

function active(overrides: Payload = {}): Payload {
  return base({
    state: "active",
    decisive: true,
    ...overrides,
  });
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function paddedTo(totalBytes: number): Payload {
  const seed = base({ padding: "" });
  const baseBytes = jsonBytes(seed);
  return base({ padding: "x".repeat(totalBytes - baseBytes) });
}

function paddedToUtf8(totalBytes: number): Payload {
  const seed = base({ padding: "" });
  const needed = totalBytes - jsonBytes(seed);
  const padding = "é".repeat(Math.floor(needed / 2)) + (needed % 2 === 1 ? "x" : "");
  return base({ padding });
}

describe("parseLearningContribution — geldige bijdragen", () => {
  it("levert een genormaliseerde fuel-bijdrage met expliciete null-corner", () => {
    const result = parseLearningContribution(base(), KNOWN);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      schemaVersion: 1,
      target: "fuel",
      state: "shadow",
      modelVersion: KNOWN_MODEL,
      unit: "L/lap",
      corner: null,
      estimate: 2.84,
      lower: 2.79,
      upper: 2.9,
      independentSessions: 12,
      independentSets: null,
      decisive: false,
      contextMatch: true,
    });
    expect(result?.reasonCodes).toEqual(["shadow_only"]);
    expect(Object.keys(result!).sort()).toEqual(
      [
        "contextMatch",
        "corner",
        "decisive",
        "estimate",
        "featureVersion",
        "independentSessions",
        "independentSets",
        "lower",
        "modelVersion",
        "policyVersion",
        "reasonCodes",
        "schemaVersion",
        "sourceFrameSequence",
        "sourceObservedAt",
        "state",
        "target",
        "trainedThrough",
        "unit",
        "upper",
      ].sort(),
    );
  });

  it("accepteert een volledig actieve, decisive fuel-bijdrage met bekende modelversie", () => {
    const result = parseLearningContribution(active(), KNOWN);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ target: "fuel", state: "active", decisive: true });
  });

  it("accepteert active zonder decisive zolang de metadata compleet is", () => {
    const result = parseLearningContribution(active({ decisive: false }), KNOWN);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ state: "active", decisive: false });
  });

  it("accepteert collecting, shadow en blocked zonder decisive", () => {
    for (const state of ["collecting", "shadow", "blocked"]) {
      const result = parseLearningContribution(base({ state }), KNOWN);
      expect(result, state).not.toBeNull();
      expect(result?.state, state).toBe(state);
      expect(result?.decisive, state).toBe(false);
    }
  });

  it("accepteert een tyre_wear-bijdrage per hoek en bewaart de hoek", () => {
    for (const corner of ["fl", "fr", "rl", "rr"]) {
      const result = parseLearningContribution(tyreWear({ corner }), KNOWN);
      expect(result, corner).not.toBeNull();
      expect(result).toMatchObject({
        target: "tyre_wear",
        unit: "percent_remaining",
        corner,
      });
    }
  });

  it("accepteert tyre_pace met s/lap", () => {
    const result = parseLearningContribution(
      base({ target: "tyre_pace", unit: "s/lap", estimate: 0.18, lower: 0.1, upper: 0.26 }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ target: "tyre_pace", unit: "s/lap", corner: null });
  });

  it("accepteert pit_loss met seconden", () => {
    const result = parseLearningContribution(
      base({ target: "pit_loss", unit: "s", estimate: 23.4, lower: 21.2, upper: 25.9 }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ target: "pit_loss", unit: "s", corner: null });
  });

  it("laat een volledig ontbrekende estimate triple als drie nulls", () => {
    const value = base();
    delete value.estimate;
    delete value.lower;
    delete value.upper;

    const result = parseLearningContribution(value, KNOWN);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ estimate: null, lower: null, upper: null });
  });

  it("bewaart echte nulwaarden als nul", () => {
    const result = parseLearningContribution(
      base({ estimate: 0, lower: 0, upper: 0 }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result?.estimate).toBe(0);
    expect(result?.lower).toBe(0);
    expect(result?.upper).toBe(0);
  });

  it("accepteert null voor nullable velden en vult die als null in", () => {
    const result = parseLearningContribution(
      base({
        modelVersion: null,
        trainedThrough: null,
        sourceFrameSequence: null,
        sourceObservedAt: null,
        independentSets: null,
      }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      modelVersion: null,
      trainedThrough: null,
      sourceFrameSequence: null,
      sourceObservedAt: null,
      independentSets: null,
    });
  });

  it("behandelt afwezige nullable velden als null", () => {
    const value = base();
    for (const key of [
      "modelVersion",
      "trainedThrough",
      "sourceFrameSequence",
      "sourceObservedAt",
      "independentSets",
      "corner",
    ]) {
      delete value[key];
    }

    const result = parseLearningContribution(value, KNOWN);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      modelVersion: null,
      trainedThrough: null,
      sourceFrameSequence: null,
      sourceObservedAt: null,
      independentSets: null,
      corner: null,
    });
  });

  it("negeert onbekende velden en gebruikt ze niet als bewijs", () => {
    const result = parseLearningContribution(
      base({ confidence: "high", model_version: "evil", decisiveReason: "trust-me" }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("confidence");
    expect(result).not.toHaveProperty("model_version");
    expect(result).not.toHaveProperty("decisiveReason");
  });
});

describe("parseLearningContribution — eenheden en target", () => {
  it.each([
    ["fuel", "L/lap"],
    ["pit_loss", "s"],
    ["tyre_wear", "percent_remaining"],
    ["tyre_pace", "s/lap"],
  ])("accepteert alleen de vaste eenheid voor %s", (target, unit) => {
    const payload =
      target === "tyre_wear"
        ? tyreWear({ unit })
        : base({ target, unit, estimate: 1, lower: 0.5, upper: 1.5 });

    expect(parseLearningContribution(payload, KNOWN)).not.toBeNull();
  });

  it.each([
    ["fuel", "s"],
    ["fuel", "percent_remaining"],
    ["pit_loss", "L/lap"],
    ["pit_loss", "s/lap"],
    ["tyre_wear", "s"],
    ["tyre_wear", "s/lap"],
    ["tyre_pace", "percent_remaining"],
    ["tyre_pace", "L/lap"],
    ["fuel", "l/lap"],
  ])("weigert een verkeerde eenheid voor %s: %s", (target, unit) => {
    const payload =
      target === "tyre_wear"
        ? tyreWear({ unit })
        : base({ target, unit, estimate: 1, lower: 0.5, upper: 1.5 });

    expect(parseLearningContribution(payload, KNOWN)).toBeNull();
  });

  it("weigert een ontbrekende eenheid in plaats van die af te leiden", () => {
    expect(parseLearningContribution(without("unit"), KNOWN)).toBeNull();
  });

  it("weigert een onbekend target", () => {
    expect(parseLearningContribution(base({ target: "lap_time" }), KNOWN)).toBeNull();
  });

  it("weigert een onbekende state", () => {
    expect(parseLearningContribution(base({ state: "promoted" }), KNOWN)).toBeNull();
  });

  it("weigert een verkeerde schemaVersion", () => {
    for (const schemaVersion of [2, 0, "1", null, 1.5]) {
      expect(parseLearningContribution(base({ schemaVersion }), KNOWN), String(schemaVersion)).toBeNull();
    }
  });

  it("weigert een ontbrekende schemaVersion", () => {
    expect(parseLearningContribution(without("schemaVersion"), KNOWN)).toBeNull();
  });
});

describe("parseLearningContribution — getallen", () => {
  it.each([
    ["estimate", Number.NaN],
    ["estimate", Number.POSITIVE_INFINITY],
    ["estimate", Number.NEGATIVE_INFINITY],
    ["lower", Number.NaN],
    ["lower", Number.POSITIVE_INFINITY],
    ["upper", Number.NaN],
    ["upper", Number.NEGATIVE_INFINITY],
  ])("weigert niet-eindige %s (%s)", (key, value) => {
    expect(parseLearningContribution(base({ [key]: value }), KNOWN)).toBeNull();
  });

  it.each([
    ["estimate", "2.8"],
    ["lower", "2.7"],
    ["upper", true],
    ["estimate", null],
  ])("weigert niet-numerieke %s zonder coercie", (key, value) => {
    expect(parseLearningContribution(base({ [key]: value }), KNOWN)).toBeNull();
  });

  it("weigert een gedeeltelijke estimate triple", () => {
    for (const overrides of [
      { lower: null },
      { upper: null },
      { estimate: null },
      { estimate: null, lower: null },
    ]) {
      expect(parseLearningContribution(base(overrides), KNOWN), JSON.stringify(overrides)).toBeNull();
    }
  });

  it("weigert een niet-geordend interval", () => {
    expect(parseLearningContribution(base({ lower: 2.9, estimate: 2.84 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ estimate: 2.84, upper: 2.8 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ lower: 2.95, upper: 2.9 }), KNOWN)).toBeNull();
  });

  it("weigert een restprofiel buiten 0..100", () => {
    expect(parseLearningContribution(tyreWear({ estimate: 100.1, upper: 100.1 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(tyreWear({ lower: -0.1 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(tyreWear({ upper: 101 }), KNOWN)).toBeNull();
  });

  it("accepteert de randen van het restprofiel", () => {
    expect(
      parseLearningContribution(tyreWear({ estimate: 100, lower: 100, upper: 100 }), KNOWN),
    ).not.toBeNull();
    expect(
      parseLearningContribution(tyreWear({ estimate: 0, lower: 0, upper: 0 }), KNOWN),
    ).not.toBeNull();
  });

  it("weigert negatieve fysieke waarden voor fuel en pit_loss", () => {
    expect(parseLearningContribution(base({ estimate: -0.1, lower: -0.2 }), KNOWN)).toBeNull();
    expect(
      parseLearningContribution(
        base({ target: "pit_loss", unit: "s", estimate: -1, lower: -2, upper: 1 }),
        KNOWN,
      ),
    ).toBeNull();
  });

  it.each([
    ["independentSessions", -1],
    ["independentSessions", 1.5],
    ["independentSessions", Number.NaN],
    ["independentSessions", Number.POSITIVE_INFINITY],
    ["independentSessions", "12"],
    ["independentSessions", null],
    ["independentSets", -1],
    ["independentSets", 1.5],
    ["independentSets", "1"],
  ])("weigert een ongeldige teller %s=%s", (key, value) => {
    expect(parseLearningContribution(base({ [key]: value }), KNOWN)).toBeNull();
  });

  it("accepteert 0 als echte teller", () => {
    const result = parseLearningContribution(
      base({ independentSessions: 0, independentSets: 0 }),
      KNOWN,
    );

    expect(result).not.toBeNull();
    expect(result?.independentSessions).toBe(0);
    expect(result?.independentSets).toBe(0);
  });
});

describe("parseLearningContribution — decisive en context", () => {
  it.each(["collecting", "shadow", "blocked"])(
    "weigert decisive in state %s",
    (state) => {
      expect(parseLearningContribution(base({ state, decisive: true }), KNOWN)).toBeNull();
    },
  );

  it("weigert decisive zonder modelVersion", () => {
    expect(parseLearningContribution(active({ modelVersion: null }), KNOWN)).toBeNull();
  });

  it("weigert decisive zonder trainedThrough", () => {
    expect(parseLearningContribution(active({ trainedThrough: null }), KNOWN)).toBeNull();
  });

  it("weigert decisive zonder sourceObservedAt", () => {
    expect(parseLearningContribution(active({ sourceObservedAt: null }), KNOWN)).toBeNull();
  });

  it("weigert decisive met contextMatch=false", () => {
    expect(parseLearningContribution(active({ contextMatch: false }), KNOWN)).toBeNull();
  });

  it("weigert active met contextMatch=false, ook zonder decisive", () => {
    expect(parseLearningContribution(active({ decisive: false, contextMatch: false }), KNOWN)).toBeNull();
  });

  it("weigert decisive zonder estimate", () => {
    const value = active();
    delete value.estimate;
    delete value.lower;
    delete value.upper;

    expect(parseLearningContribution(value, KNOWN)).toBeNull();
  });

  it("weigert een ontbrekende contextMatch in plaats van false te verzinnen", () => {
    expect(parseLearningContribution(without("contextMatch"), KNOWN)).toBeNull();
  });

  it("weigert een ontbrekende decisive in plaats van false te verzinnen", () => {
    expect(parseLearningContribution(without("decisive"), KNOWN)).toBeNull();
  });

  it("weigert niet-booleaanse contextMatch en decisive", () => {
    expect(parseLearningContribution(base({ contextMatch: "true" }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ contextMatch: 1 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ decisive: "false" }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ decisive: 0 }), KNOWN)).toBeNull();
  });

  it("accepteert expliciete false op contextMatch in een niet-actieve state", () => {
    const result = parseLearningContribution(base({ contextMatch: false }), KNOWN);

    expect(result).not.toBeNull();
    expect(result?.contextMatch).toBe(false);
  });
});

describe("parseLearningContribution — modelversie-allowlist", () => {
  it("weigert een onbekende modelversie", () => {
    expect(parseLearningContribution(base(), { knownModelVersions: ["other-model"] })).toBeNull();
  });

  it("weigert een modelversie zonder allowlist", () => {
    expect(parseLearningContribution(base())).toBeNull();
  });

  it("weigert een modelversie met een lege allowlist", () => {
    expect(parseLearningContribution(base(), { knownModelVersions: [] })).toBeNull();
  });

  it("vergelijkt de modelversie exact", () => {
    expect(
      parseLearningContribution(base({ modelVersion: KNOWN_MODEL.toUpperCase() }), KNOWN),
    ).toBeNull();
  });

  it("accepteert null modelVersion zonder allowlist", () => {
    const result = parseLearningContribution(base({ modelVersion: null }));

    expect(result).not.toBeNull();
    expect(result?.modelVersion).toBeNull();
  });

  it("weigert een actieve bijdrage zonder allowlist", () => {
    expect(parseLearningContribution(active())).toBeNull();
  });
});

describe("parseLearningContribution — hoeken", () => {
  it("eist een hoek voor tyre_wear", () => {
    expect(parseLearningContribution(without("corner", tyreWear()), KNOWN)).toBeNull();
    expect(parseLearningContribution(tyreWear({ corner: null }), KNOWN)).toBeNull();
  });

  it("weigert een onbekende of verkeerd geschreven hoek", () => {
    expect(parseLearningContribution(tyreWear({ corner: "FL" }), KNOWN)).toBeNull();
    expect(parseLearningContribution(tyreWear({ corner: "center" }), KNOWN)).toBeNull();
    expect(parseLearningContribution(tyreWear({ corner: 1 }), KNOWN)).toBeNull();
  });

  it("weigert een hoek op een niet-tyre_wear target", () => {
    expect(parseLearningContribution(base({ corner: "fl" }), KNOWN)).toBeNull();
  });

  it("normaliseert een afwezige of null hoek op een niet-tyre_wear target naar null", () => {
    expect(parseLearningContribution(base({ corner: null }), KNOWN)).toMatchObject({ corner: null });
    expect(parseLearningContribution(without("corner"), KNOWN)).toMatchObject({ corner: null });
  });
});

describe("parseLearningContribution — strings en reasonCodes", () => {
  it("weigert ontbrekende verplichte versies", () => {
    expect(parseLearningContribution(without("featureVersion"), KNOWN)).toBeNull();
    expect(parseLearningContribution(without("policyVersion"), KNOWN)).toBeNull();
    expect(parseLearningContribution(without("reasonCodes"), KNOWN)).toBeNull();
  });

  it("weigert lege of te lange versies", () => {
    for (const key of ["featureVersion", "policyVersion", "modelVersion"]) {
      expect(parseLearningContribution(base({ [key]: "" }), KNOWN), `${key} empty`).toBeNull();
      expect(parseLearningContribution(base({ [key]: "   " }), KNOWN), `${key} blank`).toBeNull();
      expect(parseLearningContribution(base({ [key]: "v".repeat(129) }), KNOWN), `${key} long`).toBeNull();
    }
  });

  it("weigert een niet-string versie", () => {
    expect(parseLearningContribution(base({ featureVersion: 1 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ policyVersion: null }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ sourceFrameSequence: 123 }), KNOWN)).toBeNull();
  });

  it("accepteert een lege reasonCodes-lijst", () => {
    const result = parseLearningContribution(base({ reasonCodes: [] }), KNOWN);

    expect(result).not.toBeNull();
    expect(result?.reasonCodes).toEqual([]);
  });

  it("weigert een niet-array of niet-string reasonCodes", () => {
    expect(parseLearningContribution(base({ reasonCodes: "shadow_only" }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ reasonCodes: [1] }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ reasonCodes: [""] }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ reasonCodes: ["   "] }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ reasonCodes: [null] }), KNOWN)).toBeNull();
  });

  it("begrenst het aantal reasonCodes", () => {
    const max = Array.from({ length: MAX_REASON_CODES }, (_, index) => `code_${index}`);
    expect(parseLearningContribution(base({ reasonCodes: max }), KNOWN)).not.toBeNull();

    const tooMany = [...max, "one_more"];
    expect(parseLearningContribution(base({ reasonCodes: tooMany }), KNOWN)).toBeNull();
  });

  it("begrenst de lengte van één reasonCode", () => {
    const max = "r".repeat(MAX_REASON_CODE_LENGTH);
    expect(parseLearningContribution(base({ reasonCodes: [max] }), KNOWN)).not.toBeNull();

    const tooLong = "r".repeat(MAX_REASON_CODE_LENGTH + 1);
    expect(parseLearningContribution(base({ reasonCodes: [tooLong] }), KNOWN)).toBeNull();
  });

  it("kopieert reasonCodes zodat de invoer niet meebeweegt", () => {
    const input = base();
    const result = parseLearningContribution(input, KNOWN);

    (input.reasonCodes as string[]).push("later");
    expect(result?.reasonCodes).toEqual(["shadow_only"]);
  });
});

describe("parseLearningContribution — tijdmetadata", () => {
  it("accepteert een volledige ISO-tijd met zone", () => {
    expect(
      parseLearningContribution(
        active({ sourceObservedAt: "2026-11-11T10:00:00+01:00" }),
        KNOWN,
      ),
    ).not.toBeNull();
  });

  it("accepteert een date-only trainedThrough", () => {
    expect(parseLearningContribution(active({ trainedThrough: "2026-11-10" }), KNOWN)).not.toBeNull();
  });

  it("weigert een date-only sourceObservedAt in een echte active+decisive bijdrage", () => {
    expect(
      parseLearningContribution(active({ sourceObservedAt: "2026-11-11" }), KNOWN),
    ).toBeNull();
  });

  it.each(["collecting", "shadow", "active", "blocked"])(
    "weigert een date-only sourceObservedAt in state %s",
    (state) => {
      expect(
        parseLearningContribution(base({ state, sourceObservedAt: "2026-11-11" }), KNOWN),
        state,
      ).toBeNull();
    },
  );

  it("accepteert een volledig gezoneerd observatie-UTC-middernacht", () => {
    expect(
      parseLearningContribution(active({ sourceObservedAt: "2026-11-11T00:00:00Z" }), KNOWN),
    ).not.toBeNull();
  });

  it("accepteert een observatie met expliciete offset", () => {
    expect(
      parseLearningContribution(active({ sourceObservedAt: "2026-11-11T00:00:00+02:00" }), KNOWN),
    ).not.toBeNull();
  });

  it.each([
    "not-a-date",
    "2026-11-11T10:00:00",
    "2026-02-30",
    "2026-13-01",
    "2026-11-11T25:00:00Z",
    "2026-11-11T10:60:00Z",
    "",
  ])("weigert een ongeldige tijd: %s", (value) => {
    expect(parseLearningContribution(active({ sourceObservedAt: value }), KNOWN)).toBeNull();
    expect(parseLearningContribution(active({ trainedThrough: value }), KNOWN)).toBeNull();
  });

  it("weigert een niet-string tijd", () => {
    expect(parseLearningContribution(base({ sourceObservedAt: 123 }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ trainedThrough: null }), KNOWN)).not.toBeNull();
    expect(parseLearningContribution(active({ trainedThrough: null }), KNOWN)).toBeNull();
  });

  it("laat ontbrekende tijdmetadata in een niet-actieve state als null", () => {
    const value = base();
    delete value.trainedThrough;
    delete value.sourceObservedAt;

    const result = parseLearningContribution(value, KNOWN);

    expect(result).not.toBeNull();
    expect(result?.trainedThrough).toBeNull();
    expect(result?.sourceObservedAt).toBeNull();
  });
});

describe("parseLearningContribution — payloadgrens", () => {
  it("accepteert een payload van precies 8 KiB UTF-8", () => {
    const payload = paddedTo(MAX_LEARNING_PAYLOAD_BYTES);

    expect(jsonBytes(payload)).toBe(MAX_LEARNING_PAYLOAD_BYTES);
    expect(parseLearningContribution(payload, KNOWN)).not.toBeNull();
  });

  it("weigert een payload van 8 KiB + 1 byte", () => {
    const payload = paddedTo(MAX_LEARNING_PAYLOAD_BYTES + 1);

    expect(jsonBytes(payload)).toBe(MAX_LEARNING_PAYLOAD_BYTES + 1);
    expect(parseLearningContribution(payload, KNOWN)).toBeNull();
  });

  it("meet de payloadgrens in UTF-8-bytes, niet in tekens", () => {
    const payload = paddedToUtf8(MAX_LEARNING_PAYLOAD_BYTES + 1);

    expect(jsonBytes(payload)).toBe(MAX_LEARNING_PAYLOAD_BYTES + 1);
    expect(parseLearningContribution(payload, KNOWN)).toBeNull();
  });

  it("weigert een grote geneste payload zonder diep te verwerken", () => {
    expect(
      parseLearningContribution(base({ padding: "x".repeat(MAX_LEARNING_PAYLOAD_BYTES * 2) }), KNOWN),
    ).toBeNull();
  });

  it("weigert een te diep geneste onbekende waarde", () => {
    let nested: Payload = { value: "leaf" };
    for (let index = 0; index < 12; index += 1) nested = { nested };

    expect(parseLearningContribution(base({ extra: nested }), KNOWN)).toBeNull();
  });
});

describe("parseLearningContribution — fail-closed zonder throw", () => {
  it.each([null, undefined, 42, "payload", [], true])(
    "weigert een niet-object invoer: %s",
    (input) => {
      expect(() => parseLearningContribution(input, KNOWN)).not.toThrow();
      expect(parseLearningContribution(input, KNOWN)).toBeNull();
    },
  );

  it("weigert accessor-eigenschappen zonder de getter uit te voeren", () => {
    const input = base();
    let called = false;
    Object.defineProperty(input, "estimate", {
      enumerable: true,
      configurable: true,
      get() {
        called = true;
        throw new Error("getter must not run");
      },
    });

    expect(() => parseLearningContribution(input, KNOWN)).not.toThrow();
    expect(parseLearningContribution(input, KNOWN)).toBeNull();
    expect(called).toBe(false);
  });

  it("weigert een cyclische payload zonder throw", () => {
    const input = base();
    input.self = input;

    expect(() => parseLearningContribution(input, KNOWN)).not.toThrow();
    expect(parseLearningContribution(input, KNOWN)).toBeNull();
  });

  it("weigert BigInt en functies zonder throw", () => {
    expect(parseLearningContribution(base({ estimate: 1n }), KNOWN)).toBeNull();
    expect(parseLearningContribution(base({ featureVersion: () => "v1" }), KNOWN)).toBeNull();
  });

  it("weigert een class-instance zonder throw", () => {
    class PayloadClass {
      schemaVersion = 1;
      target = "fuel";
    }

    expect(parseLearningContribution(new PayloadClass(), KNOWN)).toBeNull();
  });

  it("pollueert Object.prototype niet via een __proto__-sleutel", () => {
    const input = JSON.parse(
      JSON.stringify(base()).replace("{", '{"__proto__":{"polluted":true},'),
    );

    const result = parseLearningContribution(input, KNOWN);

    expect(result).not.toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(result).not.toHaveProperty("polluted");
  });
});
