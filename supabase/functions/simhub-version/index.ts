import { jsonResponse } from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

/**
 * simhub-version — publieke, laagfrequentie versie-check voor de 3SM SimHub-plugin.
 * Serveert release metadata voor het updater manifest.
 *
 * Channel targeting (backward-compatible):
 * - Geen channel / channel=stable → stable manifest (huidige SIMHUB_PLUGIN_*)
 * - channel=canary → canary manifest (SIMHUB_PLUGIN_CANARY_*) alleen als ALLE
 *   canary velden consistent zijn geconfigureerd.
 * - ongeldige/missende canary config → terugval naar stable.
 */
function buildManifest(
  version: string,
  dllUrl: string,
  sha256: string,
  byteLengthText: string,
  fileName: string,
  signature: string,
): Record<string, unknown> {
  const byteLength = /^\d+$/.test(byteLengthText) ? Number(byteLengthText) : 0;
  return {
    name: "3SM Endurance Connector",
    version: version || null,
    dllUrl: dllUrl || null,
    sha256: /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : null,
    byteLength: Number.isSafeInteger(byteLength) && byteLength > 0 ? byteLength : null,
    fileName: fileName || null,
    signature: /^[A-Za-z0-9+/]+={0,2}$/.test(signature) ? signature : null,
    checkedAt: new Date().toISOString(),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "GET") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const channel = url.searchParams.get("channel")?.toLowerCase() ?? "";

  // Canary channel — alleen als ALLE canary config consistent is
  if (channel === "canary") {
    const cVer = Deno.env.get("SIMHUB_PLUGIN_CANARY_VERSION") ?? "";
    const cUrl = Deno.env.get("SIMHUB_PLUGIN_CANARY_DLL_URL") ?? "";
    const cSha = Deno.env.get("SIMHUB_PLUGIN_CANARY_SHA256") ?? "";
    const cLen = Deno.env.get("SIMHUB_PLUGIN_CANARY_BYTE_LENGTH") ?? "";
    const cFn = Deno.env.get("SIMHUB_PLUGIN_CANARY_FILE_NAME") ?? "";
    const cSig = Deno.env.get("SIMHUB_PLUGIN_CANARY_SIGNATURE") ?? "";

    // Canary is alleen actief als ALLE velden non-empty zijn
    if (cVer && cUrl && cSha && cLen && cFn && cSig) {
      return jsonResponse(request, buildManifest(cVer, cUrl, cSha, cLen, cFn, cSig));
    }
    // Incomplete canary config → val terug naar stable (stille fallback)
  }

  // Stable channel (default)
  const version = Deno.env.get("SIMHUB_PLUGIN_VERSION") ?? "";
  const dllUrl = Deno.env.get("SIMHUB_PLUGIN_DLL_URL") ?? "";
  const sha256 = Deno.env.get("SIMHUB_PLUGIN_SHA256") ?? "";
  const byteLengthText = Deno.env.get("SIMHUB_PLUGIN_BYTE_LENGTH") ?? "";
  const fileName = Deno.env.get("SIMHUB_PLUGIN_FILE_NAME") ?? "";
  const signature = Deno.env.get("SIMHUB_PLUGIN_SIGNATURE") ?? "";

  return jsonResponse(request, buildManifest(version, dllUrl, sha256, byteLengthText, fileName, signature));
});