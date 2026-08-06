// Edge function: schone proxy naar de JRES/HiGHS optimalisatie-microservice.
// De browser kan niet direct bij de native microservice (127.0.0.1), dus roept
// de StintPlanner deze edge function aan; deze proxyt naar de microservice.
// Beveiligd: vereist super_admin rol (endurance-beheer is super-admin gated).
//
// Env: JRES_SOLVER_URL  (bv. http://host.docker.internal:8090/solve of intern netwerk alias)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, corsHeadersFor, jsonResponse, readBoundedJson } from "../_shared/simhub.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JRES_URL = Deno.env.get("JRES_SOLVER_URL") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  try {
    assertAllowedOrigin(req);
    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: user } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!user?.user) return jsonResponse(req, { error: "unauthorized" }, 401);
    const selfId = user.user.id;

    // Super-admin-check via dezelfde user_roles-tabel die de rest van endurance gebruikt.
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", selfId);
    const isSuperAdmin = (roles ?? []).some((r: { role: string }) => r.role === "super_admin");
    if (!isSuperAdmin) return jsonResponse(req, { error: "forbidden: super_admin required" }, 403);

    if (!JRES_URL) return jsonResponse(req, { error: "JRES_SOLVER_URL not configured" }, 500);

    const payload = (await readBoundedJson(req, 5_000_000)) as { input?: unknown; options?: unknown };
    if (!payload?.input) return jsonResponse(req, { error: "field 'input' required" }, 400);

    const upstream = await fetch(JRES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: payload.input, options: payload.options ?? {} }),
    });
    const upstreamJson = await upstream.json();
    return jsonResponse(req, upstreamJson, (upstreamJson as { status?: string })?.status === "error" ? 500 : 200);
  } catch (err) {
    return jsonResponse(req, { error: String((err as Error)?.message ?? err) }, 500);
  }
});
