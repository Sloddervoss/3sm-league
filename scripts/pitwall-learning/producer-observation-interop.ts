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

console.log(`SUMMARY PASS=${passed} FAIL=${failed}`);
Deno.exit(failed === 0 ? 0 : 1);
