/**
 * Plugin 0.7.2.0 — de isolatietest rond het nieuwe control-endpoint.
 *
 * Harde eis: de automatische update van 0.7.1.x naar 0.7.2.0 mag niet breken. Dit
 * bestand bewijst drie dingen met de ECHTE handlers (niet met een nabootsing):
 *
 *   1. `simhub-version` antwoordt ongewijzigd: dezelfde acht sleutels, en met
 *      SIMHUB_PLUGIN_VERSION=0.7.2.0 biedt hij 0.7.2.0 als nieuwste aan. Een
 *      0.7.1.x-client leest precies wat hij altijd las.
 *   2. `simhub-control` geeft bij een ontbrekende of kapotte configuratie een
 *      stabiel 503-antwoord — geen exception, geen lege body. Een 0.7.2.0-client
 *      valt daarmee terug op het vaste V3-basisprofiel.
 *   3. De update- en verzendroute lopen gewoon door terwijl control 503/500
 *      geeft: het versie-antwoord blijft 200 en een bestaand V3-frame parseert
 *      nog steeds. En een database zonder de 0.7.2.0-signatuur laat de ingest
 *      terugvallen op de oude RPC-aanroep in plaats van te falen.
 *
 * Draai met: deno test --allow-env --allow-read supabase/functions/_shared/plugin08_isolation_test.ts
 */
import { normalizeTelemetryEnvelope } from "./simhub.ts";
import {
  acceptedExtensions,
  compatProfile,
  resolveControl,
} from "./simhubControl.ts";
import { aggregateBatch, isMissingFunctionError, persistArguments } from "./simhubAggregates.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  env: {
    get(name: string): string | undefined;
    set(name: string, value: string): void;
    delete(name: string): void;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  readTextFile(path: string): Promise<string>;
};

type Handler = (request: Request) => Response | Promise<Response>;

// ---------------------------------------------------------------------------
// De echte handlers in de val laten lopen. `Deno.serve` wordt tijdelijk
// vervangen, zodat importeren geen poort opent en de handler los aanroepbaar is.
// ---------------------------------------------------------------------------
const handlers: Record<string, Handler> = {};
const originalServe = Deno.serve;

const captureServe = (slot: string) => {
  Deno.serve = ((handler: Handler) => {
    handlers[slot] = handler;
    return { finished: Promise.resolve(), shutdown: async () => {}, ref: () => {}, unref: () => {} };
  }) as typeof Deno.serve;
};

// 0.7.2.0 als nieuwste release, zoals de deploy hem zet.
Deno.env.set("SIMHUB_PLUGIN_VERSION", "0.7.2.0");
Deno.env.set("SIMHUB_PLUGIN_DLL_URL", "https://downloads.3stripemotorsport.cc/3SM.EnduranceConnector.dll");
Deno.env.set("SIMHUB_PLUGIN_SHA256", "a".repeat(64));
Deno.env.set("SIMHUB_PLUGIN_BYTE_LENGTH", "524288");
Deno.env.set("SIMHUB_PLUGIN_FILE_NAME", "3SM.EnduranceConnector.dll");
Deno.env.delete("SIMHUB_PLUGIN_SIGNATURE");

// Control zonder database: dit is precies de situatie "endpoint bestaat maar de
// configuratie is onbereikbaar", en het is de goedkoopste manier om de 503-route
// te raken zonder netwerk.
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.delete("SIMHUB_CONTROL_ADMIN_TOKEN");

captureServe("version");
await import("../simhub-version/index.ts");
captureServe("control");
await import("../simhub-control/index.ts");
Deno.serve = originalServe;

const get = (slot: string) => {
  const handler = handlers[slot];
  if (!handler) throw new Error(`handler ${slot} is niet gevangen`);
  return handler;
};

const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  JSON.parse(await response.text()) as Record<string, unknown>;

/** Precies het frame dat de 0.7.1.x-connector vandaag verstuurt. */
const legacyFrame = () => ({
  protocolVersion: 3,
  sequence: 42,
  capturedAt: "2026-10-31T12:00:00.000Z",
  transportSessionId: "sess-1",
  identity: {
    currentDriverId: "Driver One", currentDriverName: "Driver One", carId: "car",
    carName: "Car", trackName: "Track", trackConfig: "GP",
  },
  session: {
    isInCar: true, sessionTimeSeconds: 1000, sessionTimeRemainingSeconds: 100,
    sessionLapsRemaining: 5, flags: ["green"], sessionState: "racing",
  },
  timing: { currentLapElapsedSeconds: 40, lastLapTimeSeconds: 120.5, bestLapTimeSeconds: 120.5, completedLaps: 3 },
  position: { position: 3, classPosition: 2, gapToLeaderSeconds: 1.5 },
  track: { lapDistancePct: 0.4, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 40.5, fuelPct: 0.5 },
  raceState: { incidents: 0 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
});

// ---------------------------------------------------------------------------
// 1. De updateroute is onaangeroerd
// ---------------------------------------------------------------------------
Deno.test("P08-I1 simhub-version biedt 0.7.2.0 aan met exact dezelfde vorm", async () => {
  const response = await get("version")(new Request("https://3stripemotorsport.cc/functions/v1/simhub-version"));
  if (response.status !== 200) throw new Error(`status ${response.status}`);
  const body = await bodyOf(response);

  const keys = Object.keys(body).sort();
  const expected = ["byteLength", "checkedAt", "dllUrl", "fileName", "name", "sha256", "signature", "version"].sort();
  if (keys.join(",") !== expected.join(",")) {
    throw new Error(`de vorm van simhub-version is veranderd: ${keys.join(",")}`);
  }
  if (body.version !== "0.7.2.0") throw new Error(`nieuwste versie is ${String(body.version)}`);
  if (!String(body.dllUrl).startsWith("https://downloads.3stripemotorsport.cc/")) {
    throw new Error("download-URL veranderd");
  }
  if (body.byteLength !== 524288) throw new Error("byteLength veranderd");
});

Deno.test("P08-I2 simhub-version deelt geen code met simhub-control", async () => {
  const version = await Deno.readTextFile("supabase/functions/simhub-version/index.ts");
  const control = await Deno.readTextFile("supabase/functions/simhub-control/index.ts");
  if (/simhub-control|simhubControl/.test(version)) {
    throw new Error("simhub-version verwijst naar het control-endpoint");
  }
  if (!/jsonResponse/.test(version)) throw new Error("simhub-version gebruikt niet meer de gedeelde jsonResponse");
  // Control mag de versie-route niet kennen: anders kan een storing daar de
  // update-ervaring beïnvloeden.
  if (/(SIMHUB_PLUGIN_VERSION|["'][^"']*simhub-version)/.test(control)) {
    throw new Error("simhub-control kent de versieroute; dat mag niet");
  }
});

// ---------------------------------------------------------------------------
// 2. Control faalt netjes
// ---------------------------------------------------------------------------
Deno.test("P08-I3 control geeft 503 zonder database en verklapt niets", async () => {
  const response = await get("control")(new Request("https://3stripemotorsport.cc/functions/v1/simhub-control", {
    method: "GET",
  }));
  if (response.status !== 503) throw new Error(`status ${response.status}, verwacht 503`);
  const body = await bodyOf(response);
  if (body.ok !== false) throw new Error("ok moet false zijn");
  if (body.error !== "control_unavailable") throw new Error(`error is ${String(body.error)}`);
  if (body.compatibility !== "v3-base-profile") throw new Error("geen expliciete compatibiliteitsmodus");
  if ("features" in body) throw new Error("een foutantwoord hoort geen beleid te bevatten");
});

Deno.test("P08-I4 control weigert POST zonder service-role", async () => {
  const response = await get("control")(new Request("https://3stripemotorsport.cc/functions/v1/simhub-control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { sendIntervalMs: 500 } }),
  }));
  if (response.status !== 403) throw new Error(`status ${response.status}, verwacht 403`);
  const body = await bodyOf(response);
  if (body.error !== "forbidden") throw new Error(`error is ${String(body.error)}`);
});

Deno.test("P08-I5 een 500 van control levert de compatibiliteitsmodus", () => {
  const negotiation = resolveControl({ ok: false, status: 500, error: "boom" });
  if (negotiation.mode !== "compat") throw new Error("geen compat-modus bij 500");
  if (negotiation.reason !== "control_http_500") throw new Error(`reden is ${String(negotiation.reason)}`);
  if (Object.keys(negotiation.features).length !== 0) throw new Error("features aan in compat-modus");
  if (acceptedExtensions(negotiation).length !== 0) throw new Error("extensies aan in compat-modus");
  if (negotiation.protocolVersion !== 3) throw new Error("protocolversie moet 3 blijven");
});

// ---------------------------------------------------------------------------
// 3. De bestaande routes lopen door terwijl control stuk is
// ---------------------------------------------------------------------------
Deno.test("P08-I6 update- en verzendroute werken terwijl control 500 geeft", async () => {
  // De client heeft net een 500 van control gekregen…
  const negotiation = resolveControl({ ok: false, status: 500 });
  if (negotiation.mode !== "compat") throw new Error("geen compat-modus");

  // …de updatecheck gaat gewoon door en ziet 0.7.2.0.
  const version = await get("version")(new Request("https://3stripemotorsport.cc/functions/v1/simhub-version"));
  if (version.status !== 200) throw new Error(`versieroute gaf ${version.status}`);
  const versionBody = await bodyOf(version);
  if (versionBody.version !== "0.7.2.0") throw new Error("versieroute biedt 0.7.2.0 niet meer aan");

  // …en de verzendroute parseert hetzelfde frame als altijd.
  const parsed = normalizeTelemetryEnvelope(legacyFrame());
  if (parsed.sequence !== 42 || parsed.timing.completedLaps !== 3) {
    throw new Error("de parser is geraakt door de control-storing");
  }
  // Zonder meetreeksen is de RPC-aanroep exact de oude: geen extra parameters.
  const base = { p_token_hash: "x", p_session_id: "s", p_sequence: 1, p_captured_at: "t", p_v3_normalized: {} };
  const args = persistArguments(base, aggregateBatch(parsed), true);
  if (Object.keys(args).length !== Object.keys(base).length) {
    throw new Error("de aanroep kreeg extra parameters zonder meetreeksen");
  }
});

Deno.test("P08-I7 een database zonder de 0.7.2.0-signatuur laat de ingest terugvallen", () => {
  if (!isMissingFunctionError({ code: "42883" })) throw new Error("42883 niet herkend");
  if (!isMissingFunctionError({ code: "PGRST202" })) throw new Error("PGRST202 niet herkend");
  if (!isMissingFunctionError({ message: "Could not find the function public.simhub_persist_v3(p_events, p_laps) in the schema cache" })) {
    throw new Error("PostgREST-tekst niet herkend");
  }
  if (isMissingFunctionError({ code: "23505", message: "duplicate key value" })) {
    throw new Error("een duplicaatfout wordt ten onrechte als ontbrekende functie gezien");
  }

  const batch = { events: [{ eventId: "e" }], laps: [] };
  const base = { p_token_hash: "x" };
  const met = persistArguments(base, batch, true);
  if (!("p_events" in met) || !("p_laps" in met)) throw new Error("meetreeksen niet doorgegeven");
  const zonder = persistArguments(base, batch, false);
  if ("p_events" in zonder) throw new Error("na terugval horen er geen extra parameters te zijn");
  if (Object.keys(zonder).length !== 1) throw new Error("terugval veranderde de basisaanroep");
});

Deno.test("P08-I8 de compatibiliteitsmodus is het vaste V3-basisprofiel", () => {
  const profile = compatProfile("control_missing");
  if (profile.protocolVersion !== 3) throw new Error("protocolversie");
  if (profile.schemaRevision !== 1) throw new Error("schemarevisie");
  if (profile.configRevision !== 0) throw new Error("revisie");
  if (profile.sendIntervalMs !== null || profile.sampleHz !== null || profile.payloadBudgetBytes !== null) {
    throw new Error("compat-profiel stuurt toch frequenties");
  }
  if (Object.keys(profile.features).length !== 0) throw new Error("compat-profiel zet features aan");
});
