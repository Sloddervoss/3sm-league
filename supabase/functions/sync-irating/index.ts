import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProfileRow = {
  user_id: string;
  iracing_id: number | string;
};

type IRacingLicense = {
  category_id: number;
  irating: number;
  group_name?: string;
  safety_rating: number | string;
};

type IRacingMember = {
  cust_id: number | string;
  licenses?: IRacingLicense[];
};

type IRacingLinkResponse = {
  link: string;
};

type IRacingMemberResponse = {
  members?: IRacingMember[];
};

async function hashPassword(password: string, email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const binary = String.fromCharCode(...hashArray);
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const iracingEmail = Deno.env.get("IRACING_EMAIL");
    const iracingPassword = Deno.env.get("IRACING_PASSWORD");

    if (!iracingEmail || !iracingPassword) {
      return new Response(
        JSON.stringify({ error: "IRACING_EMAIL en IRACING_PASSWORD secrets zijn niet ingesteld." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Authenticate with iRacing
    const hashedPwd = await hashPassword(iracingPassword, iracingEmail);
    const authResp = await fetch("https://members-ng.iracing.com/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: iracingEmail, password: hashedPwd }),
    });

    if (!authResp.ok) {
      const body = await authResp.text();
      throw new Error(`iRacing authenticatie mislukt (${authResp.status}): ${body}`);
    }

    // Extract cookies from auth response
    const setCookieHeader = authResp.headers.get("set-cookie") ?? "";
    const cookieHeader = setCookieHeader
      .split(/,(?=[^ ])/)
      .map((c) => c.split(";")[0].trim())
      .join("; ");

    // 2. Get all profiles that have an iracing_id
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, iracing_id")
      .not("iracing_id", "is", null);

    if (profilesError) throw new Error(profilesError.message);
    if (!profiles?.length) {
      return new Response(
        JSON.stringify({ updated: 0, message: "Geen profielen met iRacing ID gevonden." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const typedProfiles = profiles as ProfileRow[];
    const custIds = typedProfiles.map((p) => p.iracing_id).join(",");

    // 3. Fetch member data from iRacing (batched)
    const memberResp = await fetch(
      `https://members-ng.iracing.com/data/member/get?cust_ids=${custIds}&include_licenses=1`,
      { headers: { Cookie: cookieHeader } },
    );

    if (!memberResp.ok) {
      const body = await memberResp.text();
      throw new Error(`iRacing member fetch mislukt (${memberResp.status}): ${body}`);
    }

    const { link } = await memberResp.json() as IRacingLinkResponse;
    const dataResp = await fetch(link);
    const { members } = await dataResp.json() as IRacingMemberResponse;

    if (!members?.length) {
      return new Response(
        JSON.stringify({ updated: 0, message: "Geen member data ontvangen van iRacing." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Update each profile
    let updated = 0;
    const errors: string[] = [];

    for (const member of members) {
      const profile = typedProfiles.find(
        (p) => String(p.iracing_id) === String(member.cust_id),
      );
      if (!profile) continue;

      // Prefer road license (category_id 2), fall back to best available
      const licenses = member.licenses ?? [];
      const roadLicense = licenses.find((l) => l.category_id === 2);
      const license = roadLicense ?? licenses[0];
      if (!license) continue;

      const irating: number = license.irating;
      const groupName: string = license.group_name ?? "R";
      const safetyRating = `${groupName} ${Number(license.safety_rating).toFixed(2)}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ irating, safety_rating: safetyRating } as unknown as never)
        .eq("user_id", profile.user_id);

      if (updateError) {
        errors.push(`${member.cust_id}: ${updateError.message}`);
      } else {
        updated++;
      }
    }

    return new Response(
      JSON.stringify({ updated, total: profiles.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
