import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import type { PaceCar, PaceHistory } from "../../../supabase/functions/_shared/paceCapture";
import { parsePersonalPitVisits, type PersonalPitFeed } from "@/features/personal-pitwall/pitVisits";
import { takeCapturedShareToken } from "@/lib/shareTokenBootstrap";

/**
 * Personal Pitwall share transport.
 *
 * Owner calls use the normal authenticated client. The public reader uses a
 * deliberately separate client with auth persistence, URL detection and token
 * refresh disabled: a spectator page must never reuse an owner's browser
 * session or trigger private queries. The bearer token lives only in memory;
 * the inline head bootstrap in index.html and main.tsx remove it from the
 * address bar before any app/analytics module loads, so it cannot leak through
 * Referer, history sync, analytics or caches.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
}

const reader = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    // Never share the owner's storage key: opening a public link must not
    // initialise/recover (and thereby clear) the signed-in Supabase session.
    storageKey: "sb-3sm-shared-reader",
  },
});

type Rpc = (name: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const ownerRpc = supabase.rpc.bind(supabase) as unknown as Rpc;
const anonRpc = reader.rpc.bind(reader) as unknown as Rpc;

export interface MyPitwallDevice {
  id: string;
  name: string;
  status: string | null;
  last_seen_at: string | null;
  online: boolean;
  telemetry_received_at: string | null;
  fresh: boolean;
  session_key: string | null;
  track_name: string | null;
  track_config: string | null;
  driver_name: string | null;
  session_state: string | null;
  shareable: boolean;
  /**
   * Why sharing is unavailable. The server is the source of truth; the UI only
   * explains it. null/undefined means shareable.
   */
  shareable_reason?: "not_fresh" | "no_session" | "no_track" | "session_ended" | "session_inactive" | "session_unproven" | null;
  share_active: boolean;
  share_created_at: string | null;
  share_expires_at: string | null;
}

export interface MyPitwallDevices {
  devices: MyPitwallDevice[];
}

export interface ShareCreated {
  ok: true;
  token: string;
  expires_at: string;
  created_at: string;
  session_key: string;
  track_name: string;
  track_config: string | null;
}

export type ShareCreateResult = ShareCreated | { ok: false; code: string };

export interface SharedRace {
  ok: true;
  created_at: string;
  expires_at: string;
  updated_at: string;
  circuit?: { trackId: number | null; name: string; config: string | null };
  track: { name: string; config: string | null };
  session: { driver: string | null; car: string | null; state: string | null };
  v3: Partial<V3Normalized>;
  /**
   * Bounded, whitelisted public sector projection. Keys match v3.opponents[].id
   * (stable pseudonymous car keys). `available:false` is an explicit statement,
   * never a guess.
   */
  sectors?: {
    available: boolean;
    reason: string | null;
    sectorCount: number;
    cars: SharedSectorCar[];
  };
  laps: Array<{ lap: number; seconds: number }>;
  pace: { fastest: number | null; median: number | null; count: number } | null;
}

export interface SharedSectorCar {
  id: string;
  sectorCount: number | null;
  sectors: Array<{
    sectorIndex: number;
    sectorCount: number;
    lap: number;
    seconds: number | null;
    status: "provisional" | "verified" | "invalidated";
    referenceSeconds: number | null;
    revision: number | null;
    completedSessionTimeSeconds: number | null;
    observedSessionTimeSeconds: number | null;
  }>;
  sectorBests: Array<{ sectorIndex: number; lap: number | null; seconds: number }>;
  metrics?: Record<string, unknown> | null;
}

export type SharedRaceResult = SharedRace | { ok: false; code: "invalid" | "ended" | "stale" | "waiting" | string };

const asRpcError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return new Error(error.message);
  }
  return new Error("Pitwall-verzoek mislukt");
};

export async function listMyPitwallDevices(): Promise<MyPitwallDevices> {
  const { data, error } = await ownerRpc("pitwall_my_devices_v2");
  if (error) throw asRpcError(error);
  const payload = data as MyPitwallDevices | null;
  return { devices: Array.isArray(payload?.devices) ? payload.devices : [] };
}

export async function loadOwnerDeviceDetail(deviceId: string): Promise<SimHubDeviceDetail> {
  const { data, error } = await ownerRpc("pitwall_owner_device_detail_v2", { p_device_id: deviceId });
  if (error) throw asRpcError(error);
  return data as SimHubDeviceDetail;
}

/**
 * Persoonlijke, afgeronde pitbezoeken voor één device in de huidige sessie.
 * De server rekent de duur uit de bron-tijdstempels van de pitflanken; deze
 * client doet geen tweede berekening en gebruikt de waarde nooit voor advies.
 */
export async function readPersonalPitVisits(deviceId: string): Promise<PersonalPitFeed> {
  const { data, error } = await ownerRpc("pitwall_personal_pit_visits_v1", {
    p_device_id: deviceId,
    p_limit: 5,
  });
  if (error) throw asRpcError(error);
  return parsePersonalPitVisits(data);
}

export async function createPersonalShare(deviceId: string, ttlSeconds = 14400): Promise<ShareCreateResult> {
  const { data, error } = await ownerRpc("pitwall_share_create_v2", {
    p_device_id: deviceId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw asRpcError(error);
  return data as ShareCreateResult;
}

export async function revokePersonalShare(deviceId: string): Promise<{ ok: boolean; revoked: number }> {
  const { data, error } = await ownerRpc("pitwall_share_revoke_v1", { p_device_id: deviceId });
  if (error) throw asRpcError(error);
  return data as { ok: boolean; revoked: number };
}

/**
 * Public read. Only the dedicated anon client is used and only the token is
 * sent. An HTTP/network failure is surfaced to the page, which clears the race
 * data immediately instead of leaving a stale dashboard on screen.
 */
export async function readSharedRace(token: string): Promise<SharedRaceResult> {
  const { data, error } = await anonRpc("pitwall_shared_snapshot_v2", { p_token: token });
  if (error) throw asRpcError(error);
  return data as SharedRaceResult;
}

/** Read `#t=<64 hex>` without accepting longer, shortened or encoded values. */
export function readShareToken(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const token = new URLSearchParams(raw).get("t") ?? "";
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

/** Remove the fragment (and therefore the bearer token) from the visible URL. */
export function stripShareTokenFromAddress(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  const clean = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", clean);
}

export function buildShareUrl(token: string, origin = window.location.origin): string {
  return `${origin}/pitwall/shared#t=${token}`;
}

/**
 * One-shot token for the shared page. main.tsx already consumed the inline
 * head bootstrap before the app module graph loaded; this is the fallback for
 * direct rendering and tests. The fragment is always removed.
 */
export function takeShareTokenForPage(): string | null {
  const captured = takeCapturedShareToken();
  if (captured) return captured;
  const token = readShareToken(window.location.hash);
  stripShareTokenFromAddress();
  return token;
}

/**
 * Rebuild the viewer V3 from the server's bounded public sector projection.
 *
 * The server deliberately does not send `paceHistory` or the reusable
 * transport id. Only the whitelisted sector board is lifted into the existing
 * timing components, with the already-pseudonymous car keys. When the board is
 * unavailable the base V3 is returned unchanged and the UI states that sectors
 * are unavailable instead of inventing a layout.
 */
export function sharedViewerV3(snapshot: SharedRace): V3Normalized {
  const base = (snapshot.v3 ?? {}) as V3Normalized;
  const board = snapshot.sectors;
  if (!board?.available || !Array.isArray(board.cars) || board.cars.length === 0) return base;

  const updatedAt = Number.isFinite(Date.parse(snapshot.updated_at))
    ? snapshot.updated_at
    : new Date().toISOString();

  const cars: PaceCar[] = board.cars
    .filter((car) => typeof car?.id === "string" && car.id.length > 0 && car.id.length <= 64)
    .map((car) => {
      const metrics = car.metrics && typeof car.metrics === "object"
        ? ({ id: car.id, ...car.metrics } as unknown as PaceCar["metrics"])
        : undefined;
      return {
        id: car.id,
        laps: [],
        traces: [],
        sectors: Array.isArray(car.sectors)
          ? car.sectors.map((sector) => ({ ...sector, id: car.id })) as PaceCar["sectors"]
          : [],
        sectorBests: Array.isArray(car.sectorBests) ? car.sectorBests as PaceCar["sectorBests"] : [],
        ...(metrics ? { metrics } : {}),
      };
    });

  if (cars.length === 0) return base;

  const history: PaceHistory = {
    schemaRevision: 1,
    // Local sentinel values only; they are never sent back to the server.
    observedSessionId: "shared",
    segmentId: "shared",
    transportSessionId: "shared",
    updatedAt,
    cars,
  };

  return {
    ...base,
    transportSessionId: "shared",
    paceHistory: history,
  };
}

/** Clipboard with a legacy fallback for browsers without the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** OS share sheet when available; the caller keeps copy as the fallback. */
export async function shareWithOs(url: string): Promise<"shared" | "unsupported" | "cancelled"> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return "unsupported";
  try {
    await navigator.share({
      title: "3SM · Live Pitwall",
      text: "Volg deze race live op de 3SM Pitwall.",
      url,
    });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}
