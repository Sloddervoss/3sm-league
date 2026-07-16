import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centralRowToBridgeResponse } from "@/lib/centralSimHubRelay";

const migration = readFileSync("supabase/migrations/20260716170000_simhub_central_relay.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260716170000_simhub_central_relay.rollback.sql", "utf8");
const shared = readFileSync("supabase/functions/_shared/simhub.ts", "utf8");
const pairing = readFileSync("supabase/functions/simhub-pair/index.ts", "utf8");
const ingest = readFileSync("supabase/functions/simhub-ingest/index.ts", "utf8");
const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const pairingPage = readFileSync("src/pages/SimHubPairingPage.tsx", "utf8");
const centralRelay = readFileSync("src/lib/centralSimHubRelay.ts", "utf8");
const navbar = readFileSync("src/components/Navbar.tsx", "utf8");

const telemetry = {
  connected: true,
  sessionTimeSeconds: 3600,
  lap: 18,
  completedLaps: 17,
  lapTimeSeconds: 121.25,
  position: 4,
  classPosition: 2,
  speedKph: 247.1,
  fuelLitres: 44.8,
  fuelPerLapLitres: 3.2,
  estimatedLapsRemaining: 14,
  inPitLane: false,
  pitLimiter: false,
  stintElapsedSeconds: 2700,
  incidents: 2,
  flag: "green",
};

const latestRow = {
  device_id: "11111111-1111-4111-8111-111111111111",
  owner_user_id: "22222222-2222-4222-8222-222222222222",
  race_id: "33333333-3333-4333-8333-333333333333",
  team_id: "44444444-4444-4444-8444-444444444444",
  session_id: "simhub-session-one",
  sequence: 42,
  captured_at: "2026-07-16T16:00:00.000Z",
  received_at: "2026-07-16T16:00:00.250Z",
  connector_id: "SIM-PC",
  simhub_version: "9.11.21.0",
  game: "IRacing",
  telemetry,
};

describe("central SimHub relay", () => {
  it("maps latest-only rows back onto the strict browser contract", () => {
    const response = centralRowToBridgeResponse(latestRow);
    expect(response.payload.sequence).toBe(42);
    expect(response.payload.race.eventId).toBe(latestRow.race_id);
    expect(response.payload.race.teamId).toBe(latestRow.team_id);
    expect(response.payload.race.driverId).toBeNull();
    expect(response.payload.telemetry.fuelLitres).toBe(44.8);
  });

  it("rejects unknown telemetry fields received through realtime", () => {
    expect(() => centralRowToBridgeResponse({ ...latestRow, telemetry: { ...telemetry, rawIracingData: "forbidden" } })).toThrow(/onbekende|ontbrekende/);
  });

  it("stores only hashes and latest snapshots behind authenticated RLS", () => {
    expect(migration).toContain("code_hash TEXT NOT NULL UNIQUE");
    expect(migration).toContain("token_hash TEXT NOT NULL UNIQUE");
    expect(migration).not.toMatch(/device_token\s+TEXT/i);
    expect(migration).toContain("simhub_telemetry_latest");
    expect(migration).not.toContain("simhub_request_buckets");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("TO authenticated");
    expect(migration).toContain("can_manage_simhub()");
    expect(migration).toContain("expires_at TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("simhub_device_sessions");
    expect(migration).toContain("is_active_simhub_device");
    expect(migration).toContain("race.race_date > now() - interval '36 hours'");
    expect(migration).not.toContain("GRANT SELECT ON public.simhub_devices TO authenticated");
    expect(migration).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.simhub_telemetry_latest");
  });

  it("drops the telemetry policy owner before its helper functions during rollback", () => {
    const dropLatest = rollback.indexOf("DROP TABLE IF EXISTS public.simhub_telemetry_latest");
    const dropActiveHelper = rollback.indexOf("DROP FUNCTION IF EXISTS public.is_active_simhub_device(UUID)");
    expect(dropLatest).toBeGreaterThan(-1);
    expect(dropActiveHelper).toBeGreaterThan(dropLatest);
  });

  it("keeps exchange and ingest atomic, service-only, rate-limited and replay-safe", () => {
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("consumed_at = now()");
    expect(migration).toContain("interval '400 milliseconds'");
    expect(migration).not.toContain("simhub_request_buckets");
    expect(migration).toContain("simhub_create_pairing_code");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("p_sequence <= v_session_sequence");
    expect(migration).toContain("simhub_revoke_device");
    expect(migration).toContain("DELETE FROM public.simhub_telemetry_latest");
    expect(migration).toContain("v_session_count >= 64");
    expect(migration).toContain("DELETE FROM public.simhub_device_sessions");
    expect(migration).toContain("p_captured_at < v_now - interval '1 hour'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot");
  });

  it("validates origin, body size and exact telemetry shape at the edge", () => {
    expect(shared).toContain("assertAllowedOrigin");
    expect(shared).toContain("payload_too_large");
    expect(shared).toContain("contains unknown or missing fields");
    expect(shared).toContain('"https://3stripemotorsport.cc"');
    expect(ingest).toContain("parseTelemetryEnvelope");
    expect(ingest).toContain('result.result === "rate_limited"');
    expect(ingest).toContain('result.result === "replayed"');
    expect(shared).toContain("consumeEdgeRateLimit");
    expect(shared).toContain("new Uint32Array(4096)");
    expect(ingest).toContain("600, 60 * 1000");
    expect(ingest).toContain("ingest-address:");
    expect(pairing).toContain("30, 10 * 60 * 1000");
    expect(ingest).not.toContain("ingest-device:");

    expect(pairing).toContain('error: "super_admin_required"');
    expect(pairing).toContain('row.role === "super_admin"');
    expect(pairing).not.toContain('["admin", "super_admin", "moderator"]');
    expect(migration).not.toContain("role_record.role IN (");
    expect(migration.match(/role_record\.role = 'super_admin'::public\.app_role/g)).toHaveLength(5);
  });

  it("uses a short single-use website code and DPAPI-protected device token", () => {
    expect(pairing).toContain("10 * 60 * 1000");
    expect(pairing).toContain("randomPairCode");
    expect(pairing).toContain("randomDeviceToken");
    expect(pairing).toContain("simhub_exchange_pairing_code");
    expect(plugin).toContain("ProtectedData.Protect");
    expect(plugin).toContain("DataProtectionScope.CurrentUser");
    expect(plugin).toContain('BuildRelayEndpoint("simhub-pair")');
    expect(plugin).toContain('BuildRelayEndpoint("simhub-ingest")');
  });

  it("exposes pairing and RLS telemetry without opening the Endurance MVP", () => {
    expect(app).toContain('<Route path="/simhub-koppelen" element={<SimHubPairingPage />} />');
    expect(pairingPage).toContain('to="/auth?redirect=/simhub-koppelen"');
    expect(pairingPage).toContain("createCentralSimHubPairingCode");
    expect(pairingPage).toContain("revokeCentralSimHubDevice");
    expect(pairingPage).toContain('table: "simhub_telemetry_latest"');
    expect(pairingPage).toContain("readCentralSimHubTelemetry");
    expect(pairingPage).toContain("createBusyRef.current");
    expect(pairingPage).toContain("revokeBusyRef.current");
    expect(pairingPage).toContain('change.eventType === "DELETE"');
    expect(pairingPage).toContain('status === "SUBSCRIBED"');
    expect(pairingPage).toContain("if (!active) return");
    expect(centralRelay).toContain("error.context.clone().json()");
    expect(pairingPage).toContain("const staff = isSuperAdmin");
    expect(navbar).toMatch(/isSuperAdmin\s*&&\s*\([\s\S]*?to="\/simhub-koppelen"/);
  });
});
