import { parseTyreTelemetry } from "./tyreTelemetry.ts";

declare const Deno: {
  test(name: string, test: () => void | Promise<void>): void;
};

const block = (extra: Record<string, unknown> = {}) => ({
  wearPercent: {
    fl: { l: 95.73, m: 93.21, r: 91.41 },
    fr: { l: 89.76, m: 91.07, r: 94.92 },
    rl: { l: 95.38, m: 93.46, r: 93.15 },
    rr: { l: 92.64, m: 92.74, r: 94.52 },
  },
  ...extra,
});

// De ingest schreef observed_at altijd NULL omdat de parser deze vier velden
// wel toeliet maar niet teruggaaf. Zonder deze test kan dat stil terugkomen.
Deno.test("observedAt, sessietijd, ronde en trigger overleven de normalisatie", () => {
  const parsed = parseTyreTelemetry(block({
    observedAt: "2026-11-05T20:19:14.859Z",
    sessionTimeSeconds: 2300.0,
    lap: 11,
    trigger: "sim_refresh",
  }));

  if (!parsed) throw new Error("blok werd geweigerd");
  if (parsed.observedAt !== "2026-11-05T20:19:14.859Z") throw new Error(`observedAt: ${parsed.observedAt}`);
  if (parsed.sessionTimeSeconds !== 2300) throw new Error(`sessionTimeSeconds: ${parsed.sessionTimeSeconds}`);
  if (parsed.lap !== 11) throw new Error(`lap: ${parsed.lap}`);
  if (parsed.trigger !== "sim_refresh") throw new Error(`trigger: ${parsed.trigger}`);
});

Deno.test("ontbrekende tijdvelden blijven null en verzinnen niets", () => {
  const parsed = parseTyreTelemetry(block());

  if (!parsed) throw new Error("blok werd geweigerd");
  if (parsed.observedAt !== null) throw new Error(`observedAt: ${parsed.observedAt}`);
  if (parsed.sessionTimeSeconds !== null) throw new Error(`sessionTimeSeconds: ${parsed.sessionTimeSeconds}`);
  if (parsed.lap !== null) throw new Error(`lap: ${parsed.lap}`);
  if (parsed.trigger !== null) throw new Error(`trigger: ${parsed.trigger}`);
});

Deno.test("een onbruikbare observedAt wordt geweigerd in plaats van doorgegeven", () => {
  let rejected = false;
  try {
    parseTyreTelemetry(block({ observedAt: "gisteren" }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("ongeldige observedAt werd aangenomen");
});
