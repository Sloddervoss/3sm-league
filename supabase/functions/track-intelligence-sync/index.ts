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

const base64UrlFromBytes = (bytes: Uint8Array) => base64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const hashPassword = async (password: string, email: string) => {
  const data = new TextEncoder().encode(password + email.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64FromBytes(new Uint8Array(digest));
};

const getCodeVerifier = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
};

const getCodeChallenge = async (verifier: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
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

type CookieJar = Map<string, string>;

const mergeSetCookie = (jar: CookieJar, response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? response.headers.get("set-cookie")!.split(/,(?=[^;]+?=)/) : []);
  setCookies.forEach((cookie) => {
    const pair = cookie.split(";")[0]?.trim();
    if (!pair) return;
    const [name, ...valueParts] = pair.split("=");
    if (name) jar.set(name, valueParts.join("="));
  });
};

const cookieHeader = (jar: CookieJar) => Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");

const requestWithCookies = async (url: string, jar: CookieJar, init: RequestInit = {}) => {
  const headers = new Headers(init.headers ?? {});
  const cookies = cookieHeader(jar);
  if (cookies) headers.set("Cookie", cookies);
  headers.set("User-Agent", "3SM Track Intelligence Test/1.0");
  const response = await fetchWithTimeout(url, { ...init, headers, redirect: "manual" }, 20_000);
  mergeSetCookie(jar, response);
  return response;
};

const followGetRedirects = async (startUrl: string, jar: CookieJar, maxRedirects = 8) => {
  let url = startUrl;
  let response = await requestWithCookies(url, jar, { method: "GET" });
  for (let i = 0; i < maxRedirects && response.status >= 300 && response.status < 400; i += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    url = new URL(location, url).toString();
    response = await requestWithCookies(url, jar, { method: "GET" });
  }
  return { response, url };
};

const extractInitializedId = (url: string) => new URL(url).searchParams.get("initialized_id");

const iracingLogin = async () => {
  const jar: CookieJar = new Map();
  const verifier = getCodeVerifier();
  const challenge = await getCodeChallenge(verifier);
  const domain = "members-ng.iracing.com";
  const redirectUri = `https://members-ng.iracing.com/bff/pub/initialize?DOMAIN=${domain}`;
  const authorizeUrl = new URL("https://oauth.iracing.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: "iracing_ui",
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "iracing.auth",
  }).toString();

  const { response: startResponse } = await followGetRedirects(authorizeUrl.toString(), jar);
  const loginHtml = await startResponse.text();
  const action = loginHtml.match(/<form[^>]*action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!action) throw new Error(`iRacing OAuth loginformulier niet gevonden: HTTP ${startResponse.status}`);

  const loginBody = new URLSearchParams({
    email: IRACING_EMAIL,
    password: await hashPassword(IRACING_PASSWORD, IRACING_EMAIL),
    rememberMe: "on",
    offer_remember_me: "true",
  });
  let currentUrl = new URL(action, "https://oauth.iracing.com").toString();
  let loginResponse = await requestWithCookies(currentUrl, jar, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody,
  });

  let initializedId: string | null = null;
  for (let i = 0; i < 8 && loginResponse.status >= 300 && loginResponse.status < 400; i += 1) {
    const location = loginResponse.headers.get("location");
    if (!location) break;
    currentUrl = new URL(location, currentUrl).toString();
    initializedId = extractInitializedId(currentUrl) ?? initializedId;
    loginResponse = await requestWithCookies(currentUrl, jar, { method: "GET" });
  }
  initializedId = initializedId ?? extractInitializedId(currentUrl);
  if (!initializedId) {
    const body = await loginResponse.text().catch(() => "");
    throw new Error(`iRacing OAuth login gaf geen initialized_id: HTTP ${loginResponse.status}${body ? ` — ${body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 180)}` : ""}`);
  }

  const verifyResponse = await requestWithCookies("https://members-ng.iracing.com/bff/pub/verify", jar, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams({ initialized_id: initializedId, redirect_uri: redirectUri, code_verifier: verifier, client_id: "iracing_ui" }),
  });
  if (!verifyResponse.ok) throw new Error(`iRacing OAuth verify mislukt: HTTP ${verifyResponse.status}`);
  const verifyJson = await verifyResponse.json();
  const verifiedId = cleanString(verifyJson?.verified_id);
  if (!verifiedId) throw new Error(`iRacing OAuth verify gaf geen verified_id terug`);

  await followGetRedirects(`https://members-ng.iracing.com/bff/pub/establish?verified_id=${encodeURIComponent(verifiedId)}`, jar);
  const cookie = cookieHeader(jar);
  if (!cookie) throw new Error("iRacing OAuth gaf geen sessie-cookie terug");
  return cookie;
};

const fetchIRacingData = async (path: string, cookie: string) => {
  const response = await fetchWithTimeout(`https://members-ng.iracing.com/bff/pub/proxy${path}`, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "3SM Track Intelligence Test/1.0",
      "Accept": "application/json",
    },
  });
  if (!response.ok) throw new Error(`iRacing request mislukt: ${response.status} ${path}`);
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
      if (index > 0) await sleep(Math.max(MEMBER_DELAY_MS, 1000));
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
