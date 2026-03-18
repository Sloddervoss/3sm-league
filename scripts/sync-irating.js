#!/usr/bin/env node
/**
 * iRating & Safety Rating sync script
 * Run manually:  node scripts/sync-irating.js
 * Setup:         npm install axios @supabase/supabase-js (in project root)
 */

import crypto from "crypto";
import https from "https";
import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.SUPABASE_URL     || "http://localhost:8000";
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const IRACING_EMAIL    = process.env.IRACING_EMAIL;
const IRACING_PASSWORD = process.env.IRACING_PASSWORD;

if (!SUPABASE_KEY || !IRACING_EMAIL || !IRACING_PASSWORD) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, IRACING_EMAIL, IRACING_PASSWORD");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Low-level HTTPS helper (no fetch/axios deps) ──────────────────────────────
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── iRacing auth ──────────────────────────────────────────────────────────────
function hashPassword(password, email) {
  return crypto
    .createHash("sha256")
    .update(password + email.toLowerCase())
    .digest("base64");
}

async function iracingLogin() {
  const payload = JSON.stringify({
    email: IRACING_EMAIL,
    password: hashPassword(IRACING_PASSWORD, IRACING_EMAIL),
  });

  const resp = await httpsRequest(
    "https://members-ng.iracing.com/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://members.iracing.com",
        "Referer": "https://members.iracing.com/",
        "Connection": "keep-alive",
      },
    },
    payload,
  );

  if (resp.status !== 200) {
    throw new Error(`iRacing auth mislukt: ${resp.status} — ${resp.body}`);
  }

  // Verzamel cookies uit set-cookie header
  const raw = resp.headers["set-cookie"] ?? [];
  const cookies = (Array.isArray(raw) ? raw : [raw])
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  if (!cookies) throw new Error("iRacing auth: geen cookies ontvangen — controleer email/wachtwoord");
  return cookies;
}

async function iracingFetch(path, cookieHeader) {
  const resp = await httpsRequest(
    `https://members-ng.iracing.com${path}`,
    {
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    },
  );
  if (resp.status !== 200) throw new Error(`iRacing fetch mislukt: ${resp.status} ${path}`);
  return JSON.parse(resp.body);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 iRating sync gestart...");

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, iracing_id, display_name")
    .not("iracing_id", "is", null);

  if (error) throw new Error(error.message);
  if (!profiles?.length) { console.log("Geen profielen met iRacing ID."); return; }
  console.log(`👥 ${profiles.length} drivers gevonden`);

  const cookieHeader = await iracingLogin();
  console.log("✅ iRacing ingelogd");

  const custIds = profiles.map(p => p.iracing_id).join(",");
  const { link } = await iracingFetch(
    `/data/member/get?cust_ids=${custIds}&include_licenses=1`,
    cookieHeader,
  );

  // iRacing geeft een S3 link terug voor de data
  const dataResp = await httpsRequest(link, {
    headers: { "Accept": "application/json" },
  });
  const { members } = JSON.parse(dataResp.body);

  if (!members?.length) { console.log("Geen member data ontvangen."); return; }

  let updated = 0;
  for (const member of members) {
    const profile = profiles.find(p => String(p.iracing_id) === String(member.cust_id));
    if (!profile) continue;

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
