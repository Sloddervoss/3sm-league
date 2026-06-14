import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXTENSION_API_KEY = Deno.env.get("EXTENSION_API_KEY") ?? "";

const cleanString = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

type TrackInput = {
  name: string;
  owned?: boolean;
};

type UploadBody = {
  api_key?: string;
  tracks?: TrackInput[];
  candidates?: { name: string; owned: boolean }[];
  iracing_cust_id?: string | null;
  uploader_name?: string | null;
  page_url?: string | null;
  scanned_at?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase env vars ontbreken");
    }

    const body: UploadBody = await req.json().catch(() => ({}));

    // Check extension API key
    if (EXTENSION_API_KEY && body.api_key !== EXTENSION_API_KEY) {
      throw new Error("Ongeldige API key. De extension moet worden bijgewerkt.");
    }

    const tracks = body.tracks || [];
    const iracingCustId = cleanString(body.iracing_cust_id);
    const uploaderName = cleanString(body.uploader_name);

    if (tracks.length === 0) {
      throw new Error("Geen tracks om te uploaden. Scan eerst een iRacing-pagina.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up member by iRacing Customer ID
    let memberUserId: string | null = null;
    let memberName: string | null = null;

    if (iracingCustId) {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name")
        .eq("iracing_id", iracingCustId)
        .limit(1);

      if (!profileError && profiles?.length > 0) {
        memberUserId = profiles[0].user_id;
        memberName = profiles[0].display_name || profiles[0].iracing_name || null;
      }
    }

    // If no match by iRacing ID, try matching by uploader name
    if (!memberUserId && uploaderName) {
      const { data: profileByName, error: nameError } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id")
        .or(`display_name.ilike.%${uploaderName}%,iracing_name.ilike.%${uploaderName}%`)
        .limit(1);

      if (!nameError && profileByName?.length > 0) {
        memberUserId = profileByName[0].user_id;
        memberName = profileByName[0].display_name || profileByName[0].iracing_name || null;
      }
    }

    // If no match by uploader name, try matching by candidates (legacy)
    if (!memberUserId && body.candidates?.length) {
      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id")
        .not("iracing_id", "is", null);

      if (allProfiles?.length) {
        for (const candidate of (body.candidates || [])) {
          const match = allProfiles.find(
            (p: { iracing_name?: string | null; display_name?: string | null }) =>
              p.iracing_name?.toLowerCase() === candidate.name.toLowerCase() ||
              p.display_name?.toLowerCase() === candidate.name.toLowerCase()
          );
          if (match) {
            memberUserId = match.user_id;
            memberName = match.display_name || match.iracing_name || null;
            break;
          }
        }
      }
    }

    if (!memberUserId) {
      throw new Error(
        `Geen 3 Stripe member gevonden met iRacing ID ${iracingCustId || "onbekend"}. ` +
        "Zorg dat je iRacing Customer ID op je profiel staat op 3stripemotorsport.cc."
      );
    }

    // Get member's iRacing ID from profile
    const { data: memberProfile } = await supabase
      .from("profiles")
      .select("iracing_id, iracing_name, display_name")
      .eq("user_id", memberUserId)
      .single();

    const memberIracingId = cleanString(memberProfile?.iracing_id) || iracingCustId || "unknown";
    const memberIracingName = memberProfile?.iracing_name || memberProfile?.display_name || memberName || "unknown";

    // Upsert tracks into member_track_history
    const now = new Date().toISOString();
    let createdRecords = 0;

    for (const track of tracks) {
      const trackName = cleanString(track.name);
      if (!trackName) continue;

      const dedupeKey = `ext:${memberIracingId}:${trackName.toLowerCase()}`;

      const payload = {
        member_id: memberUserId,
        iracing_customer_id: memberIracingId,
        iracing_name: memberIracingName,
        track_name: trackName,
        track_id: null,
        race_date: null,
        subsession_id: null,
        series_name: null,
        source: "extension_scan",
        dedupe_key: dedupeKey,
        first_seen_at: now,
        last_seen_at: now,
      };

      const { error } = await supabase
        .from("member_track_history")
        .upsert(payload, { onConflict: "member_id,source,dedupe_key" });

      if (!error) createdRecords++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        member_name: memberIracingName,
        member_id: memberUserId,
        iracing_cust_id: memberIracingId,
        tracks_found: tracks.length,
        created_records: createdRecords,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});