import { jsonResponse } from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

/**
 * simhub-version — publieke, laagfrequente release-metadata voor de 3SM SimHub-plugin.
 * Serveert versie, vaste download-URL en SHA-256. Bevat geen credentials en doet geen
 * schrijfacties. De plugin accepteert alleen de vaste 3SM-downloadhost en valideert
 * hash + DLL-versie voordat de externe updater wordt gestart.
 */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "GET") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  const version = Deno.env.get("SIMHUB_PLUGIN_VERSION") ?? "";
  const dllUrl = Deno.env.get("SIMHUB_PLUGIN_DLL_URL") ?? "";
  const sha256 = Deno.env.get("SIMHUB_PLUGIN_SHA256") ?? "";

  return jsonResponse(request, {
    name: "3SM Endurance Connector",
    version: version || "unknown",
    dllUrl: dllUrl || null,
    sha256: /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : null,
    checkedAt: new Date().toISOString(),
  });
});
