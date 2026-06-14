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

const genericTrackNames = new Set([
  "circuit",
  "circuit - medium",
  "circuit - short",
  "ev circuit",
  "international",
  "national",
  "oval",
  "raceway",
  "roval",
  "road course",
  "short",
  "medium",
  "long",
  "touring",
  "classic",
  "historic",
  "full course",
  "grand prix",
  "north",
  "south",
  "east",
  "west",
]);

const isUsableTrackName = (value: unknown): boolean => {
  const trackName = cleanString(value);
  if (!trackName) return false;
  const normalized = trackName.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (normalized.length < 8 || normalized.length > 140) return false;
  if (genericTrackNames.has(normalized)) return false;
  if (/^\d+(\.\d+)?$/.test(normalized)) return false;
  if (/^(?:circuit|road course|oval|raceway|roval)\s*-\s*(?:short|medium|long|classic|historic|national|international)$/i.test(trackName)) return false;
  return true;
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

    // Store tracks into member_track_history.
    // Do this explicitly instead of relying on upsert(onConflict), because older DBs may not
    // have the matching unique constraint yet. This keeps extension data usable for the test site.
    const now = new Date().toISOString();
    let createdRecords = 0;
    let updatedRecords = 0;
    let ignoredTracks = 0;
    const errors: string[] = [];

    for (const track of tracks) {
      const trackName = cleanString(track.name);
      if (!trackName) continue;
      if (!isUsableTrackName(trackName)) {
        ignoredTracks++;
        continue;
      }

      const normalizedTrackName = trackName.toLowerCase();
      const dedupeKey = `ext:${memberIracingId}:${normalizedTrackName}`;

      const basePayload = {
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
        last_seen_at: now,
      };

      const { data: existing, error: existingError } = await supabase
        .from("member_track_history")
        .select("id")
        .eq("member_id", memberUserId)
        .eq("source", "extension_scan")
        .eq("dedupe_key", dedupeKey)
        .limit(1);

      if (existingError) {
        errors.push(`${trackName}: bestaande record lookup faalde: ${existingError.message}`);
        continue;
      }

      if (existing?.[0]?.id) {
        const { error: updateError } = await supabase
          .from("member_track_history")
          .update(basePayload)
          .eq("id", existing[0].id);

        if (updateError) {
          errors.push(`${trackName}: update faalde: ${updateError.message}`);
        } else {
          updatedRecords++;
        }
      } else {
        const { error: insertError } = await supabase
          .from("member_track_history")
          .insert({
            ...basePayload,
            first_seen_at: now,
          });

        if (insertError) {
          errors.push(`${trackName}: insert faalde: ${insertError.message}`);
        } else {
          createdRecords++;
        }
      }
    }

    const savedRecords = createdRecords + updatedRecords;
    if (savedRecords === 0) {
      throw new Error(
        `Geen tracks opgeslagen voor ${memberIracingName}. ` +
        (errors.length ? `Eerste fout: ${errors[0]}` : "Er zijn geen geldige tracknamen ontvangen.")
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        member_name: memberIracingName,
        member_id: memberUserId,
        iracing_cust_id: memberIracingId,
        tracks_found: tracks.length,
        ignored_tracks: ignoredTracks,
        created_records: createdRecords,
        updated_records: updatedRecords,
        saved_records: savedRecords,
        errors,
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