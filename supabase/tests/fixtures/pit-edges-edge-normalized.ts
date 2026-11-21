// Regenerates the edge-normalized pit events used by the Node SQL test.
// It runs the real Edge normalizer (parseMeasurementEvent), not a copy.
//
//   ~/.deno/bin/deno run --allow-read --allow-env \
//     supabase/tests/fixtures/pit-edges-edge-normalized.ts \
//     > supabase/tests/fixtures/pit-edges-edge-normalized.json
import { parseMeasurementEvent } from "../../functions/_shared/simhubExtensions.ts";

const raw = JSON.parse(
  await Deno.readTextFile(new URL("./pit-edges-connector.json", import.meta.url)),
);
const normalized = raw.map((value: unknown, index: number) =>
  parseMeasurementEvent(value, index)
);
console.log(JSON.stringify(normalized, null, 2));
