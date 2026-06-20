import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Profile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: string | null;
};

type NormalizedRace = {
  track_id: string | null;
  track_name: string;
  race_date: string | null;
  subsession_id: string | null;
  series_name: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IRACING_EMAIL = Deno.env.get("IRACING_EMAIL") ?? "";
const IRACING_PASSWORD = Deno.env.get("IRACING_PASSWORD") ?? "";
const MEMBER_DELAY_MS = Number(Deno.env.get("TRACK_INTELLIGENCE_MEMBER_DELAY_MS") ?? "1000");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanString = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const base64FromBytes = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
};

const hashPassword = async (password: string, email: string) => {
  const data = new TextEncoder().encode(password + email.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64FromBytes(new Uint8Array(digest));
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 12_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const iracingLogin = async () => {
  // Legacy iRacing auth: POST to /auth, extract session cookie.
  // OAuth PKCE flow produces a session cookie that is NOT recognized
  // by the /data API endpoints (member_recent_races etc.), giving 401.
  // This approach uses the same login mechanism as the official
  // iracing-data-api npm package.
  const password = await hashPassword(IRACING_PASSWORD, IRACING_EMAIL);
  const response = await fetchWithTimeout("https://members-ng.iracing.com/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "3SM Track Intelligence Test/1.0",
      "Accept": "application/json",
      "Origin": "https://members.iracing.com",
      "Referer": "https://members.iracing.com/",
    },
    body: JSON.stringify({ email: IRACING_EMAIL, password }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`iRacing auth mislukt: HTTP ${response.status}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  const setCookieStr = response.headers.get("set-cookie") ?? "";
  const cookie = (setCookieStr ? setCookieStr.split(/,(?=[^;]+?=)/) : [])
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("iRacing auth gaf geen sessie-cookie terug");
  return cookie;
};

const fetchIRacingData = async (path: string, cookie: string) => {
  // iRacing's /data API accepts the established members-ng session cookie directly.
  // Routing the same path through /bff/pub/proxy returns 401 for these stats endpoints
  // even after OAuth succeeds, which made every Track Intelligence member sync fail.
  const response = await fetchWithTimeout(`https://members-ng.iracing.com${path}`, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "3SM Track Intelligence Test/1.0",
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`iRacing request mislukt: ${response.status} ${path}${body ? ` — ${body.replace(/\s+/g, " ").slice(0, 180)}` : ""}`);
  }
  const json = await response.json();
  if (json?.link) {
    const linked = await fetch(json.link, { headers: { "Accept": "application/json" } });
    if (!linked.ok) throw new Error(`iRacing data-link mislukt: ${linked.status}`);
    return await linked.json();
  }
  return json;
};

const normalizeRace = (raw: Record<string, unknown>): NormalizedRace | null => {
  const track = raw.track && typeof raw.track === "object" ? raw.track as Record<string, unknown> : {};
  const trackName = cleanString(raw.track_name) ?? cleanString(track.track_name) ?? cleanString(track.name);
  if (!trackName) return null;
  return {
    track_id: cleanString(raw.track_id) ?? cleanString(track.track_id) ?? cleanString(track.id),
    track_name: trackName,
    race_date: cleanString(raw.race_date) ?? cleanString(raw.start_time) ?? cleanString(raw.session_start_time),
    subsession_id: cleanString(raw.subsession_id) ?? cleanString(raw.session_id),
    series_name: cleanString(raw.series_name) ?? cleanString(raw.series_short_name) ?? cleanString(raw.license_category),
  };
};

const getRecentRaces = async (custId: string, cookie: string): Promise<NormalizedRace[]> => {
  const data = await fetchIRacingData(`/data/stats/member_recent_races?cust_id=${encodeURIComponent(custId)}`, cookie);
  const candidates = Array.isArray(data)
    ? data
    : Array.isArray(data?.races)
      ? data.races
      : Array.isArray(data?.recent_races)
        ? data.recent_races
        : Array.isArray(data?.data)
          ? data.data
          : [];
  return candidates
    .map((item: unknown) => item && typeof item === "object" ? normalizeRace(item as Record<string, unknown>) : null)
    .filter((item: NormalizedRace | null): item is NormalizedRace => !!item);
};

const getDedupeKey = (race: NormalizedRace, customerId: string) => {
  if (race.subsession_id) return `subsession:${race.subsession_id}`;
  const date = race.race_date ? new Date(race.race_date).toISOString().slice(0, 10) : "unknown-date";
  return `combo:${customerId}:${race.track_id ?? race.track_name.toLowerCase()}:${date}`;
};

const upsertRace = async (supabase: ReturnType<typeof createClient>, profile: Profile, race: NormalizedRace) => {
  const now = new Date().toISOString();
  const payload = {
    member_id: profile.user_id,
    iracing_customer_id: String(profile.iracing_id),
    iracing_name: profile.iracing_name ?? profile.display_name,
    track_id: race.track_id,
    track_name: race.track_name,
    race_date: race.race_date,
    subsession_id: race.subsession_id,
    series_name: race.series_name,
    source: "iracing_recent_races",
    dedupe_key: getDedupeKey(race, String(profile.iracing_id)),
    first_seen_at: now,
    last_seen_at: now,
  };

  if (race.subsession_id) {
    const { error } = await supabase
      .from("member_track_history")
      .upsert(payload, { onConflict: "member_id,source,dedupe_key" });
    if (error) throw error;
    return 1;
  }

  const raceDate = race.race_date ? new Date(race.race_date).toISOString().slice(0, 10) : null;
  let query = supabase
    .from("member_track_history")
    .select("id, first_seen_at")
    .eq("member_id", profile.user_id)
    .eq("source", "iracing_recent_races")
    .eq("iracing_customer_id", String(profile.iracing_id))
    .eq(race.track_id ? "track_id" : "track_name", race.track_id ?? race.track_name)
    .is("subsession_id", null)
    .limit(1);
  if (raceDate) {
    query = query.gte("race_date", `${raceDate}T00:00:00.000Z`).lt("race_date", `${raceDate}T23:59:59.999Z`);
  }
  const { data: existing, error: selectError } = await query;
  if (selectError) throw selectError;
  if (existing?.[0]) {
    const { error } = await supabase.from("member_track_history").update({ last_seen_at: now }).eq("id", existing[0].id);
    if (error) throw error;
    return 0;
  }
  const { error } = await supabase.from("member_track_history").insert(payload);
  if (error) throw error;
  return 1;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase env vars ontbreken");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Niet ingelogd");

    const { data: roles, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", ["admin", "super_admin"]);
    if (roleError) throw roleError;
    if (!roles?.length) throw new Error("Geen adminrechten voor Track Intelligence sync");

    if (!IRACING_EMAIL || !IRACING_PASSWORD) throw new Error("IRACING_EMAIL/IRACING_PASSWORD ontbreken in de Edge Function env");

    const body = await req.json().catch(() => ({}));
    const runId = cleanString(body.run_id);

    const { data: profiles, error: profileError } = await serviceClient
      .from("profiles")
      .select("user_id, display_name, iracing_name, iracing_id")
      .not("iracing_id", "is", null);
    if (profileError) throw profileError;

    const linkedProfiles = (profiles || []).filter((profile: Profile) => cleanString(profile.iracing_id));
    let cookie: string;
    try {
      cookie = await iracingLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = {
        members_total: linkedProfiles.length,
        members_success: 0,
        members_failed: linkedProfiles.length,
        created_records: 0,
        error_summary: message,
      };
      if (runId) {
        await serviceClient.from("track_intelligence_runs").update(result).eq("id", runId);
      }
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let membersSuccess = 0;
    let membersFailed = 0;
    let createdRecords = 0;
    const errors: string[] = [];

    for (const [index, profile] of linkedProfiles.entries()) {
      if (index > 0) await sleep(MEMBER_DELAY_MS);
      try {
        const races = await getRecentRaces(String(profile.iracing_id), cookie);
        for (const race of races) createdRecords += await upsertRace(serviceClient, profile, race);
        membersSuccess++;
      } catch (error) {
        membersFailed++;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${profile.display_name ?? profile.iracing_name ?? profile.iracing_id}: ${message}`);
      }
    }

    const result = {
      members_total: linkedProfiles.length,
      members_success: membersSuccess,
      members_failed: membersFailed,
      created_records: createdRecords,
      error_summary: errors.join("\n") || null,
    };

    if (runId) {
      await serviceClient.from("track_intelligence_runs").update(result).eq("id", runId);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
