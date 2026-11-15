/**
 * T13-S2A interop: read the ACTUAL C#-serializer fixtures from the artifact
 * proof root and run the unchanged, approved Deno reader/classifier and the
 * real opt-in V3 lap-row envelope parser.
 *
 * The fixtures are not handwritten here. Each `*.observation.json` and
 * `*.row.json` file is the exact string produced by DataContractJsonSerializer
 * in MeasurementObservationCaptureTests.ExportFixtures.
 *
 * Usage:
 *   deno run --deny-net --allow-read=<fixture-dir> \
 *     scripts/pitwall-learning/producer-observation-interop.ts <fixture-dir>
 */

import {
  classifyLapObservation,
  parseLapObservation,
} from "../../supabase/functions/_shared/observationV1.ts";
import { parseLapSummariesReport } from "../../supabase/functions/_shared/simhubExtensions.ts";

type Meta = {
  case: string;
  kind: "observation" | "legacy" | "refused" | "envelope";
  expect: "accept" | "legacy" | "quarantine" | "reject" | "refused_local";
  code?: string;
  observationFile?: string;
  rowFile?: string;
  startedAt?: string;
  endedAt?: string;
  authenticatedDeviceId?: string;
  note?: string;
};

const directory = Deno.args[0];
if (!directory) {
  console.error("usage: producer-observation-interop.ts <fixture-dir>");
  Deno.exit(2);
}

const decoder = new TextDecoder();
const readText = (name: string): string =>
  decoder.decode(Deno.readFileSync(`${directory}/${name}`));
const exists = (name: string): boolean => {
  try {
    Deno.statSync(`${directory}/${name}`);
    return true;
  } catch {
    return false;
  }
};

let passed = 0;
let failed = 0;
const check = (id: string, ok: boolean, evidence: string): void => {
  if (ok) {
    passed++;
    console.log(`PASS ${id} ${evidence}`);
  } else {
    failed++;
    console.log(`FAIL ${id} ${evidence}`);
  }
};

// Only the classifier's tolerance is a limit on the ERROR between declared
// and actual edge. The edge magnitude itself is unbounded up to 86400 s.
const expectedEdges: Record<string, { before: number; after: number }> = {
  "edge-after-50": { before: 0, after: 0.05 },
  "edge-before-50": { before: 0.05, after: 0 },
  "edge-both-50": { before: 0.05, after: 0.05 },
  "edge-after-90s": { before: 0, after: 89.95 },
  "edge-20hz": { before: 0, after: 0.05 },
};

const names = [...Deno.readDirSync(directory)]
  .map((entry) => entry.name)
  .filter((name) => name.endsWith(".meta.json"))
  .sort();

for (const metaFile of names) {
  const meta = JSON.parse(readText(metaFile)) as Meta;
  const id = `INTEROP-${meta.case}`;

  if (meta.kind === "refused") {
    check(
      id,
      !exists(`${meta.case}.observation.json`) && !!meta.code,
      `local refusal ${meta.code}, no observation file`,
    );
    continue;
  }

  if (meta.kind === "legacy") {
    const row = JSON.parse(readText(meta.rowFile!));
    const result = classifyLapObservation({
      row,
      authenticatedDeviceId: meta.authenticatedDeviceId,
    });
    check(
      id,
      result.disposition === "legacy" &&
        result.code === "observation_absent" &&
        !("observation" in row),
      `legacy ${result.disposition}/${result.code}`,
    );
    continue;
  }

  if (meta.kind === "envelope") continue;

  const raw = readText(meta.observationFile!);
  const observation = JSON.parse(raw);
  const result = classifyLapObservation({
    row: {
      observation,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
    },
    authenticatedDeviceId: meta.authenticatedDeviceId,
  });
  check(
    id,
    result.disposition === meta.expect &&
      (meta.code === undefined || result.code === meta.code),
    `expected ${meta.expect}/${
      meta.code ?? "-"
    } got ${result.disposition}/${result.code}`,
  );

  if (meta.expect === "accept") {
    const parsed = parseLapObservation(observation);
    const uuidPreserved = observation.capture?.deviceId ===
      "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    const unicodePreserved = meta.case !== "full-context" ||
      observation.context?.trackName === "Baan 漢字";
    check(
      `${id}-PARSE`,
      parsed.ok && uuidPreserved && unicodePreserved &&
        new TextEncoder().encode(raw).byteLength <= 2048,
      `parser ok=${parsed.ok} uuidCase=${uuidPreserved} unicode=${unicodePreserved} bytes=${
        new TextEncoder().encode(raw).byteLength
      }`,
    );
    if (meta.case === "full-context") {
      const serializedAgain = JSON.stringify(
        parsed.ok ? parsed.observation : null,
      );
      check(
        `${id}-RESHAPE`,
        parsed.ok && serializedAgain === raw,
        "server JSON.stringify(parsed) equals C# bytes",
      );
    }
    const expectedEdge = expectedEdges[meta.case];
    if (expectedEdge) {
      check(
        `${id}-EDGE`,
        parsed.ok &&
          parsed.observation.interval.edgeBeforeSeconds ===
            expectedEdge.before &&
          parsed.observation.interval.edgeAfterSeconds === expectedEdge.after,
        `edgeBefore=${expectedEdge.before} edgeAfter=${expectedEdge.after} parsed=${
          parsed.ok
            ? `${parsed.observation.interval.edgeBeforeSeconds}/${parsed.observation.interval.edgeAfterSeconds}`
            : "no"
        }`,
      );
    }
  }
}

// Real opt-in envelope parser on actual C# rows (legacy + observation).
const legacyRow = JSON.parse(readText("envelope-legacy.row.json"));
const observedRow = JSON.parse(readText("envelope-observed.row.json"));
const onReport = parseLapSummariesReport([legacyRow, observedRow], {
  observationCapture: "on",
  authenticatedDeviceId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
});
check(
  "ENVELOPE-ON",
  onReport.blockError === null &&
    onReport.received === 2 &&
    onReport.rows.length === 2 &&
    onReport.rejected.length === 0 &&
    !("observation" in onReport.rows[0]) &&
    onReport.rows[1].observation?.interval.samples === 4 &&
    onReport.rows[1].observation?.capture.deviceId ===
      "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
  `rows=${onReport.rows.length} rejected=${onReport.rejected.length} samples=${
    onReport.rows[1]?.observation?.interval.samples ?? "-"
  } blockError=${onReport.blockError ?? "null"}`,
);

// Default mode stays the old receiver: the observation key is unknown and
// costs only its own row.
const offReport = parseLapSummariesReport([legacyRow, observedRow], {});
check(
  "ENVELOPE-OFF",
  offReport.rows.length === 1 &&
    offReport.rejected.length === 1 &&
    offReport.rejected[0].reason.includes("unknown fields"),
  `rows=${offReport.rows.length} rejected=${offReport.rejected.length}`,
);

// The same real opt-in envelope path on actual rows whose observation edges
// are the normal 50 ms (and the approved 90 s) values.
const edgeRows = [
  JSON.parse(readText("edge-after-50.row.json")),
  JSON.parse(readText("edge-before-50.row.json")),
  JSON.parse(readText("edge-after-90s.row.json")),
];
const edgeOn = parseLapSummariesReport(edgeRows, {
  observationCapture: "on",
  authenticatedDeviceId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
});
check(
  "ENVELOPE-EDGE-ON",
  edgeOn.blockError === null &&
    edgeOn.received === 3 &&
    edgeOn.rows.length === 3 &&
    edgeOn.rejected.length === 0 &&
    edgeOn.rows[0].observation?.interval.samples === 3 &&
    edgeOn.rows[0].observation?.interval.edgeBeforeSeconds === 0 &&
    edgeOn.rows[0].observation?.interval.edgeAfterSeconds === 0.05 &&
    edgeOn.rows[1].observation?.interval.samples === 2 &&
    edgeOn.rows[1].observation?.interval.edgeBeforeSeconds === 0.05 &&
    edgeOn.rows[1].observation?.interval.edgeAfterSeconds === 0 &&
    edgeOn.rows[2].observation?.interval.samples === 2 &&
    edgeOn.rows[2].observation?.interval.edgeAfterSeconds === 89.95,
  `rows=${edgeOn.rows.length} rejected=${edgeOn.rejected.length} edges=${
    edgeOn.rows.map((row) =>
      `${row.observation?.interval.edgeBeforeSeconds}/${row.observation?.interval.edgeAfterSeconds}`
    ).join(",")
  } blockError=${edgeOn.blockError ?? "null"}`,
);

const edgeOff = parseLapSummariesReport(edgeRows, {});
check(
  "ENVELOPE-EDGE-OFF",
  edgeOff.rows.length === 0 &&
    edgeOff.rejected.length === 3 &&
    edgeOff.rejected.every((row) => row.reason.includes("unknown fields")),
  `rows=${edgeOff.rows.length} rejected=${edgeOff.rejected.length}`,
);

// T13-S2B: rows produced by the actual sampler -> accumulator -> explicit
// composer -> DataContractJsonSerializer path. The legacy row is the real
// pre-S2B pipeline row; both are synthetic fixtures, not live telemetry.
const pipelineDevice = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
const pipelineLegacyRow = JSON.parse(readText("pipeline-legacy.row.json"));
const pipelineObservedRow = JSON.parse(readText("pipeline-observed.row.json"));

const pipelineOn = parseLapSummariesReport(
  [pipelineLegacyRow, pipelineObservedRow],
  {
    observationCapture: "on",
    authenticatedDeviceId: pipelineDevice,
  },
);
check(
  "PIPELINE-ENVELOPE-ON",
  pipelineOn.blockError === null &&
    pipelineOn.received === 2 &&
    pipelineOn.rows.length === 2 &&
    pipelineOn.rejected.length === 0 &&
    !("observation" in pipelineOn.rows[0]) &&
    pipelineOn.rows[1].observation?.interval.samples === 60 &&
    pipelineOn.rows[1].observation?.interval.edgeAfterSeconds === 0.05 &&
    pipelineOn.rows[1].observation?.capture.deviceId === pipelineDevice &&
    pipelineOn.rows[1].observedSessionId === "sim-a",
  `rows=${pipelineOn.rows.length} rejected=${pipelineOn.rejected.length} samples=${
    pipelineOn.rows[1]?.observation?.interval.samples ?? "-"
  }`,
);

const pipelineOff = parseLapSummariesReport(
  [pipelineLegacyRow, pipelineObservedRow],
  {},
);
check(
  "PIPELINE-ENVELOPE-OFF",
  pipelineOff.rows.length === 1 &&
    pipelineOff.rejected.length === 1 &&
    pipelineOff.rejected[0].reason.includes("unknown fields"),
  `rows=${pipelineOff.rows.length} rejected=${pipelineOff.rejected.length}`,
);

const pipelineWrongDevice = parseLapSummariesReport([pipelineObservedRow], {
  observationCapture: "on",
  authenticatedDeviceId: "99999999-8888-4777-8666-555555555555",
});
check(
  "PIPELINE-DEVICE-MISMATCH",
  pipelineWrongDevice.rows.length === 0 &&
    pipelineWrongDevice.rejected.length === 1 &&
    pipelineWrongDevice.rejected[0].reason.includes(
      "observation_device_mismatch",
    ),
  `rows=${pipelineWrongDevice.rows.length} rejected=${pipelineWrongDevice.rejected.length}`,
);

// Synthetic row-window control around the same real C# observation bytes.
const pipelineBadWindow = JSON.parse(JSON.stringify(pipelineObservedRow));
pipelineBadWindow.endedAt = "2026-09-27T10:00:02.900Z";
const pipelineWindow = parseLapSummariesReport([pipelineBadWindow], {
  observationCapture: "on",
  authenticatedDeviceId: pipelineDevice,
});
check(
  "PIPELINE-WINDOW-MISMATCH",
  pipelineWindow.rows.length === 0 &&
    pipelineWindow.rejected.length === 1 &&
    pipelineWindow.rejected[0].reason.includes(
      "observation_interval_outside_row",
    ),
  `rows=${pipelineWindow.rows.length} rejected=${pipelineWindow.rejected.length}`,
);

console.log(`SUMMARY PASS=${passed} FAIL=${failed}`);
Deno.exit(failed === 0 ? 0 : 1);
