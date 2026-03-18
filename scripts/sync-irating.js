#!/usr/bin/env node
/**
 * iRating & Safety Rating sync script
 * Run manually: node scripts/sync-irating.js
 * Or via cron:  0 3 * * * cd /opt/3sm-source && node scripts/sync-irating.js
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL      || "http://localhost:8000";
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;   // service role key
const IRACING_EMAIL     = process.env.IRACING_EMAIL;
const IRACING_PASSWORD  = process.env.IRACING_PASSWORD;

if (!SUPABASE_KEY || !IRACING_EMAIL || !IRACING_PASSWORD) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, IRACING_EMAIL, IRACING_PASSWORD");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── iRacing auth ──────────────────────────────────────────────────────────────
function hashPassword(password, email) {
  const hash = crypto
    .createHash("sha256")
    .update(password + email.toLowerCase())
    .digest("binary");
  return Buffer.from(hash, "binary").toString("base64");
}

async function iracingLogin() {
  const resp = await fetch("https://members-ng.iracing.com/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: IRACING_EMAIL, password: hashPassword(IRACING_PASSWORD, IRACING_EMAIL) }),
  });
  if (!resp.ok) throw new Error(`iRacing auth mislukt: ${resp.status}`);
  const cookies = resp.headers.getSetCookie?.() ?? [resp.headers.get("set-cookie") ?? ""];
  return cookies.map(c => c.split(";")[0]).join("; ");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 iRating sync gestart...");

  // 1. Haal alle profielen op met een iRacing ID
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, iracing_id, display_name")
    .not("iracing_id", "is", null);

  if (error) throw new Error(error.message);
  if (!profiles?.length) { console.log("Geen profielen met iRacing ID."); return; }

  console.log(`👥 ${profiles.length} drivers gevonden`);

  // 2. Login op iRacing
  const cookieHeader = await iracingLogin();
  console.log("✅ iRacing ingelogd");

  // 3. Haal member data op (max 100 per request)
  const custIds = profiles.map(p => p.iracing_id).join(",");
  const memberResp = await fetch(
    `https://members-ng.iracing.com/data/member/get?cust_ids=${custIds}&include_licenses=1`,
    { headers: { Cookie: cookieHeader } },
  );
  if (!memberResp.ok) throw new Error(`iRacing member fetch mislukt: ${memberResp.status}`);

  const { link } = await memberResp.json();
  const dataResp = await fetch(link);
  const { members } = await dataResp.json();

  if (!members?.length) { console.log("Geen member data ontvangen."); return; }

  // 4. Update profielen
  let updated = 0;
  for (const member of members) {
    const profile = profiles.find(p => String(p.iracing_id) === String(member.cust_id));
    if (!profile) continue;

    // Pak road license (category_id 2), anders eerste beschikbare
    const license = member.licenses?.find(l => l.category_id === 2) ?? member.licenses?.[0];
    if (!license) continue;

    const irating = license.irating;
    const safetyRating = `${license.group_name} ${Number(license.safety_rating).toFixed(2)}`;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ irating, safety_rating: safetyRating })
      .eq("user_id", profile.user_id);

    if (updateError) {
      console.error(`❌ ${profile.display_name}: ${updateError.message}`);
    } else {
      console.log(`✅ ${profile.display_name}: iR ${irating} / ${safetyRating}`);
      updated++;
    }
  }

  console.log(`\n✅ Sync klaar — ${updated}/${profiles.length} drivers bijgewerkt`);
}

main().catch(err => { console.error("❌ Fout:", err.message); process.exit(1); });
