import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, readBoundedJson, sha256Hex } from "../_shared/simhub.ts";
import { resolveTelemetryContext } from "./context.ts";
import {
  MaxMeasurementBatchBytes,
  measurementBatchBytes,
} from "../_shared/simhubExtensions.ts";
import {
  afterAggregatesSuccess,
  afterMissingFunction,
  aggregateBatch,
  capabilityStatus,
  initialCapability,
  isMissingFunctionError,
  markSeriesOverBudget,
  mergeMeasurementAck,
  persistArguments,
  shouldAttemptAggregates,
  snapshotDto,
} from "../_shared/simhubAggregates.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/**
 * Heeft de database de acht-argumentversie van simhub_persist_v3?
 *
 * Deze toestand leeft per isolate en begint op "ja". Krijgt de RPC
 * 42883/PGRST202 terug (de migratie is nog niet toegepast, of is teruggedraaid),
 * dan gaat hetzelfde frame opnieuw weg met alleen de basisargumenten. Anders dan
 * voor 0.7.2.0 is dat geen permanente vlag meer: na AggregatesRetryMs wordt het
 * opnieuw geprobeerd, en de toestand staat in elk antwoord (`aggregates`). Eén
 * schema-cachefout mag de aggregaten niet voor de levensduur van dit isolate
 * uitschakelen.
 */
let aggregatesCapability = initialCapability(0);

const deviceToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  const token = authorization.slice(7).trim();
  return token.length >= 32 && token.length <= 160 ? token : "";
};

const clientAddress = (request: Request): string => (
  request.headers.get("cf-connecting-ip")
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || "unknown"
);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("server_not_configured");
    assertAllowedOrigin(request);

    // Auth gate: Bearer token
    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

    // Rate limit by client address
    const addressAllowed = await consumeEdgeRateLimit(`ingest-v3-address:${clientAddress(request)}`, 600, 60 * 1000);
    if (!addressAllowed) return jsonResponse(request, { error: "rate_limited" }, 429);

    // Read and parse raw body
    const rawBody = await readBoundedJson(request);
    const root = rawBody as Record<string, unknown>;
    const version = root?.protocolVersion;

    // V1/V2 dispatch to existing production handler path
    if (version === 1 || version === 2) {
      // Reuse the existing simhub-ingest handler's 15-param RPC
      const envelope = (await import("../_shared/simhub.ts")).parseTelemetryEnvelope(rawBody);
      const { data, error } = await service.rpc("simhub_ingest_snapshot", {
        p_token_hash: await sha256Hex(token),
        p_session_id: envelope.race.sessionId,
        p_sequence: envelope.sequence,
        p_captured_at: envelope.capturedAt,
        p_connector_id: envelope.source.connectorId,
        p_simhub_version: envelope.source.simHubVersion,
        p_game: envelope.source.game,
        p_telemetry: envelope.telemetry,
        p_driver_id: envelope.race.driverId,
        p_current_driver_id: envelope.race.currentDriverId,
        p_current_driver_name: envelope.race.currentDriverName,
        p_car_id: envelope.race.carId,
        p_car_name: envelope.race.carName,
        p_track_name: envelope.race.trackName,
        p_track_config: envelope.race.trackConfig,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("empty_ingest_result");
      if (result.result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (result.result === "rate_limited") return jsonResponse(request, { error: "rate_limited" }, 429);
      if (result.result === "session_limit") return jsonResponse(request, { error: "device_session_limit" }, 409);
      if (result.result === "replayed") return jsonResponse(request, { error: "replayed" }, 409);
      if (result.result !== "accepted") return jsonResponse(request, { error: result.result }, 400);
      return jsonResponse(request, { accepted: true, receivedAt: result.received_at }, 202);
    }

    // V3 dispatch via context resolution + Phase E persistence
    if (version === 3) {
      const context = await resolveTelemetryContext(token, rawBody, service, sha256Hex);

      if (context.result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (context.result === "revoked") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (context.result === "unsupported_version") return jsonResponse(request, { error: "invalid_payload" }, 422);
      if (context.result === "invalid_payload") return jsonResponse(request, { error: "invalid_payload" }, 422);
      if (context.result === "not_bound") return jsonResponse(request, { error: context.result }, 403);
      if (context.result === "not_authority") return jsonResponse(request, { error: context.result }, 403);

      // Transactionality, write-time authority, source baselines and all event
      // writes live in the service-role-only database RPC; Edge makes one call.
      //
      // De snapshot krijgt een KERN-DTO: de meetserie gaat als aparte parameters
      // mee en hoort niet in simhub_telemetry_latest.v3_normalized, want die
      // snapshot is browserleesbaar. De database heeft daarnaast een trigger die
      // de sleutels alsnog verwijdert (tweede wachter).
      const baseArguments = {
        p_token_hash: await sha256Hex(token),
        p_session_id: context.normalized!.transportSessionId,
        p_sequence: context.normalized!.sequence,
        p_captured_at: context.normalized!.capturedAt,
        p_v3_normalized: snapshotDto(context.normalized!),
      };
      // 0.7.2.0: de meetreeksen gaan als aparte parameters mee — alleen als er
      // iets te sturen is én de database de signatuur (nog) lijkt te hebben.
      const batch = aggregateBatch(context.normalized!);
      // Bytebudget op BATCH-niveau (review 2, punt 7). Het aantal is geen
      // grens: twintig rijen met maximaal bewijs kunnen samen meer zijn dan de
      // HTTP-body toestaat. Te groot betekent: de meetserie gaat niet mee, de
      // core-telemetrie wel, en de client ziet `payload_too_large` per reeks.
      const batchBytes = measurementBatchBytes(
        context.normalized!.measurementEvents ?? null,
        context.normalized!.lapSummaries ?? null,
      );
      const batchOverBudget = batch !== null && batchBytes > MaxMeasurementBatchBytes;
      const batchToSend = batchOverBudget ? null : batch;
      const now = Date.now();
      const attemptAggregates = batchToSend !== null && shouldAttemptAggregates(aggregatesCapability, now);
      let { data, error } = await service.rpc(
        "simhub_persist_v3",
        persistArguments(baseArguments, batchToSend, attemptAggregates),
      );
      let aggregatesStored = attemptAggregates;
      if (error && batchToSend && isMissingFunctionError(error)) {
        // De database kent de acht-argumentversie niet. Terugvallen en de
        // toestand met tijdstip onthouden, zodat er na de TTL een herprobe komt.
        aggregatesCapability = afterMissingFunction(Date.now());
        aggregatesStored = false;
        console.warn(
          "simhub_persist_v3 zonder meetreeksen: database heeft de 0.7.2.0-signatuur niet",
          JSON.stringify({ events: batchToSend.events.length, laps: batchToSend.laps.length }),
        );
        ({ data, error } = await service.rpc("simhub_persist_v3", baseArguments));
      } else if (!error && attemptAggregates) {
        aggregatesCapability = afterAggregatesSuccess(Date.now());
      }
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const result = row?.result;
      // Het antwoord per rij. Bij een afgekeurd frame is er niets opgeslagen en
      // dat zegt het rapport met zoveel woorden.
      const measurements = mergeMeasurementAck(
        context.normalized?.measurementReport ?? null,
        row?.measurement_ack,
        batchToSend === null ? !batchOverBudget : aggregatesStored && result === "accepted",
      );
      if (batchOverBudget) {
        // Zichtbaar per reeks, met de maat erbij in de log. Nooit stil.
        markSeriesOverBudget(measurements, context.normalized?.measurementReport ?? null);
        console.warn("simhub-ingest-v3 meetbatch boven bytebudget", JSON.stringify({
          batchBytes, limitBytes: MaxMeasurementBatchBytes,
        }));
      }
      const aggregateStatus = capabilityStatus(aggregatesCapability, Date.now());

      if (result === "not_authority" || result === "not_bound" || result === "not_registered") {
        return jsonResponse(request, { error: result, measurements, aggregates: aggregateStatus }, 403);
      }
      if (result === "invalid_device" || result === "revoked") {
        return jsonResponse(request, { error: "invalid_device", measurements, aggregates: aggregateStatus }, 401);
      }
      if (result === "replayed") {
        return jsonResponse(request, { error: "replayed", measurements, aggregates: aggregateStatus }, 409);
      }
      // Een vol sessieregister is een throttle-toestand, geen serverfout. Zonder
      // deze twee regels belandde session_limit op de generieke 500 hieronder en
      // leek de plugin kapot terwijl hij alleen zijn sessieplafond raakte.
      if (result === "session_limit") {
        return jsonResponse(request, { error: "device_session_limit", measurements, aggregates: aggregateStatus }, 409);
      }
      if (result === "rate_limited") {
        return jsonResponse(request, { error: "rate_limited", measurements, aggregates: aggregateStatus }, 429);
      }
      if (result === "invalid_payload") {
        return jsonResponse(request, { error: result, measurements, aggregates: aggregateStatus }, 422);
      }
      if (result !== "accepted") {
        return jsonResponse(request, { error: "internal_error", measurements, aggregates: aggregateStatus }, 500);
      }

      // 0.4.3: server-side opponent sampled history (UI-independent). Best-effort:
      // sampling failure must NOT break core telemetry ingest (option B). Only when
      // opponents exist and a race run is active.
      try {
        const opponents = context.normalized?.opponents ?? null;
        if (
          Array.isArray(opponents) && opponents.length > 0 &&
          context.raceRunId && context.eventId && context.teamId && context.deviceId
        ) {
          await service.rpc("record_opponent_gap_samples", {
            p_race_run_id: context.raceRunId,
            p_event_id: context.eventId,
            p_team_id: context.teamId,
            p_device_id: context.deviceId,
            p_session_id: context.normalized!.transportSessionId,
            p_seq: context.normalized!.sequence,
            p_captured_at: context.normalized!.capturedAt,
            p_opponents: opponents,
          });
        }
      } catch (sampleErr) {
        // Option B (documented): sampling failure is non-fatal; core ingest already done.
        console.error("simhub-ingest-v3 opponent sampling non-fatal", (sampleErr as Error).message ?? "unknown");
      }

      return jsonResponse(request, {
        accepted: true,
        receivedAt: row.received_at,
        measurements,
        aggregates: aggregateStatus,
      }, 202);
    }

    // Unknown protocol version
    return jsonResponse(request, { error: "invalid_payload" }, 422);

  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return jsonResponse(request, { error: message }, 403);
    if (message === "payload_too_large") return jsonResponse(request, { error: message }, 413);
    if (message === "unsupported_media_type") return jsonResponse(request, { error: message }, 415);
    if (message === "invalid_json") return jsonResponse(request, { error: message }, 400);
    if (/^(payload|source|race|telemetry|sequence|capturedAt|unsupported protocolVersion)/.test(message)) {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }
    console.error("simhub-ingest-v3 internal failure", error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});