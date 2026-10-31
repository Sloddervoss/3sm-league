/**
 * simhub-control — connectorbeleid voor plugin 0.8.
 *
 * GET  /simhub-control   publieke, laagfrequente configuratie (geen geheimen).
 * POST /simhub-control   alleen met de service-role; schrijft het beleid.
 *
 * Twee harde eisen van Vincent, en hoe ze hier zijn ingebouwd:
 *
 *   1. De automatische update van 0.7.1.x naar 0.8 mag niet breken. Dit endpoint
 *      staat volledig LOS van `simhub-version`: het leest geen versie, het
 *      schrijft geen versie, het deelt geen code met die functie en het faalt
 *      onafhankelijk. `simhub-version` is hier niet aangeraakt.
 *
 *   2. Een ontbrekend of kapot control-endpoint mag niets blokkeren. Daarom
 *      geeft ELKE fout hier een stabiel JSON-antwoord met een HTTP-status (503),
 *      nooit een exception of een lege response: een 0.7.1.x-client die dit
 *      endpoint niet kent merkt niets, en een 0.8-client valt terug op het vaste
 *      V3-basisprofiel (zie _shared/simhubControl.ts → compatProfile()).
 *
 * Wat hier bewust NIET in zit: SDK-kanaalnamen met formules, downloadpaden,
 * DLL's, scripts, auth- of bindingsoverschrijving. De tabel heeft die kolommen
 * niet en deze functie accepteert ze niet.
 *
 * De Supabase-client wordt pas BIJ GEBRUIK geladen (dynamische import). Daardoor
 * kan dit bestand in een test worden geïmporteerd zonder netwerk, en kan een
 * ontbrekende configuratie nooit aan een importfout stuklopen.
 */

import {
  assertAllowedOrigin,
  consumeEdgeRateLimit,
  corsHeadersFor,
  readBoundedJson,
  sha256Hex,
} from "../_shared/simhub.ts";
import {
  MaxPayloadBudgetBytes,
  MaxSampleHz,
  MaxSendIntervalMs,
  MinPayloadBudgetBytes,
  MinSampleHz,
  MinSendIntervalMs,
  ServerProtocolVersion,
  ServerSchemaRevision,
  isExpired,
  controlWriteOutcome,
  parseConfigRow,
} from "../_shared/simhubControl.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const MAX_CONTROL_BODY_BYTES = 8192;

/** CORS voor deze route: GET en POST, in plaats van alleen POST. */
const controlHeaders = (request: Request): Record<string, string> => ({
  ...corsHeadersFor(request),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
});

const controlResponse = (request: Request, body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...controlHeaders(request),
      "Content-Type": "application/json",
      // Beleid verandert zelden en mag nooit uit een cache komen die een
      // teruggedraaide configuratie nog vasthoudt.
      "Cache-Control": "no-store",
    },
  },
);

const clientAddress = (request: Request): string => (
  request.headers.get("cf-connecting-ip")
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || "unknown"
);

const serverConfiguration = () => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { url, serviceRoleKey };
};

/**
 * Roept een PostgREST-RPC aan met de service-role.
 *
 * Bewust geen supabase-js: deze route doet twee calls, en een import van
 * esm.sh betekent een netwerkafhankelijkheid bij het opstarten van de functie.
 * Dat is precies wat je niet wilt in het endpoint dat moet blijven antwoorden
 * als er iets stuk is. Eén fetch naar /rest/v1/rpc is genoeg, is met Deno te
 * typechecken en heeft geen koude start nodig.
 */
const rpc = async (
  url: string,
  serviceRoleKey: string,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> => {
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "apikey": serviceRoleKey,
      "authorization": `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    // De statuscode en een korte tekst zijn genoeg; de body kan een
    // Postgres-fout bevatten en die hoort niet naar buiten.
    return { data: null, error: { status: response.status, message: await response.text().catch(() => "") } };
  }
  const text = await response.text();
  if (!text) return { data: null, error: null };
  try {
    return { data: JSON.parse(text), error: null };
  } catch {
    return { data: null, error: { status: 502, message: "invalid_json_from_database" } };
  }
};

/**
 * Is deze aanvraag van de service-role? Vergeleken via een hash, zodat de
 * vergelijking zelf geen informatie over de sleutel prijsgeeft en er geen
 * vroege uitgang op het eerste afwijkende teken is.
 */
const isServiceRole = async (request: Request): Promise<boolean> => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;
  const { serviceRoleKey } = serverConfiguration();
  const adminToken = Deno.env.get("SIMHUB_CONTROL_ADMIN_TOKEN") ?? "";
  if (!serviceRoleKey && !adminToken) return false;
  const given = await sha256Hex(token);
  const candidates = await Promise.all(
    [serviceRoleKey, adminToken].filter(Boolean).map((secret) => sha256Hex(secret)),
  );
  return candidates.some((candidate) => candidate === given);
};

const configBody = (row: unknown) => {
  const config = parseConfigRow(row);
  const expired = isExpired(config);
  return {
    ok: true,
    serverTime: new Date().toISOString(),
    protocolVersion: ServerProtocolVersion,
    schemaRevision: ServerSchemaRevision,
    limits: {
      minSendIntervalMs: MinSendIntervalMs,
      maxSendIntervalMs: MaxSendIntervalMs,
      minSampleHz: MinSampleHz,
      maxSampleHz: MaxSampleHz,
      minPayloadBudgetBytes: MinPayloadBudgetBytes,
      maxPayloadBudgetBytes: MaxPayloadBudgetBytes,
    },
    // Verlopen beleid wordt als zodanig gemeld en niet stilzwijgend toegepast.
    // Een client die `expired: true` ziet, gebruikt zijn eigen defaults.
    expired,
    configRevision: expired ? 0 : config.configRevision,
    sendIntervalMs: expired ? null : config.sendIntervalMs,
    sampleHz: expired ? null : config.sampleHz,
    payloadBudgetBytes: expired ? null : config.payloadBudgetBytes,
    features: expired ? {} : config.features,
    recommendedMinVersion: config.recommendedMinVersion,
    updateChannel: config.updateChannel,
    maintenanceWindow: expired ? null : config.maintenanceWindow,
    expiresAt: config.expiresAt,
    updatedAt: config.updatedAt,
  };
};

/**
 * Het antwoord bij een storing. Bewust 503 en geen 500: het is een tijdelijke
 * onbeschikbaarheid van beleid, geen fout in het verzoek van de client. De vorm
 * is stabiel zodat elke client hem kan laten vallen zonder te crashen.
 */
const unavailable = (request: Request, reason: string): Response =>
  controlResponse(request, {
    ok: false,
    error: "control_unavailable",
    reason,
    // Expliciet: de client moet het vaste V3-basisprofiel blijven sturen.
    compatibility: "v3-base-profile",
    serverTime: new Date().toISOString(),
  }, 503);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return controlResponse(request, { ok: true });
  if (request.method !== "GET" && request.method !== "POST") {
    return controlResponse(request, { error: "method_not_allowed" }, 405);
  }

  try {
    assertAllowedOrigin(request);

    const addressAllowed = await consumeEdgeRateLimit(
      `control-address:${clientAddress(request)}`,
      120,
      60 * 1000,
    );
    if (!addressAllowed) return controlResponse(request, { error: "rate_limited" }, 429);

    const { url, serviceRoleKey } = serverConfiguration();

    if (request.method === "GET") {
      if (!url || !serviceRoleKey) return unavailable(request, "server_not_configured");
      try {
        const { data, error } = await rpc(url, serviceRoleKey, "simhub_connector_config_public", {});
        if (error) return unavailable(request, "config_read_failed");
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return unavailable(request, "config_missing");
        return controlResponse(request, configBody(row));
      } catch {
        // Ook een netwerkstoring eindigt hier: nooit een exception naar buiten,
        // altijd een antwoord waar een client op kan terugvallen.
        return unavailable(request, "config_read_failed");
      }
    }

    // POST — schrijven mag alleen met de service-role.
    if (!(await isServiceRole(request))) {
      return controlResponse(request, { error: "forbidden" }, 403);
    }
    if (!url || !serviceRoleKey) return unavailable(request, "server_not_configured");

    const body = await readBoundedJson(request, MAX_CONTROL_BODY_BYTES);
    const record = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    if (!record) return controlResponse(request, { error: "invalid_payload" }, 422);

    const config = record.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return controlResponse(request, { error: "invalid_payload" }, 422);
    }

    const expected = record.expectedRevision;
    if (expected !== undefined && expected !== null
      && (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0)) {
      return controlResponse(request, { error: "invalid_payload" }, 422);
    }

    const { data, error } = await rpc(url, serviceRoleKey, "simhub_connector_config_apply", {
      p_config: config,
      p_expected_revision: expected ?? null,
    });
    if (error) return controlResponse(request, { error: "write_failed" }, 503);

    // De vertaling van databaseresultaat naar HTTP-status staat in
    // _shared/simhubControl.ts, zodat dezelfde regel getest kan worden zonder
    // netwerk. out_of_range is een invoerfout (400) met de reden erbij, geen
    // 503 write_failed.
    const outcome = controlWriteOutcome(Array.isArray(data) ? data[0] : data);
    return controlResponse(request, outcome.body, outcome.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return controlResponse(request, { error: message }, 403);
    if (message === "payload_too_large") return controlResponse(request, { error: message }, 413);
    if (message === "unsupported_media_type") return controlResponse(request, { error: message }, 415);
    if (message === "invalid_json") return controlResponse(request, { error: message }, 400);
    return unavailable(request, "internal_error");
  }
});
