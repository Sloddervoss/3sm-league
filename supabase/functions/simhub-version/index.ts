import { jsonResponse } from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

/**
 * simhub-version — publieke, laagfrequente versie-check voor de 3SM SimHub-plugin.
 * Serveert alleen de laatst bekende pluginversie en (indien geconfigureerd) een
 * download-URL. Bevat GEEN credentials en doet GEEN schrijfacties; de plugin
 * vervangt nooit zelf de DLL (fail-closed: alleen een "nieuwe versie"-melding).
 */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "GET") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  const version = Deno.env.get("SIMHUB_PLUGIN_VERSION") ?? "";
  const dllUrl = Deno.env.get("SIMHUB_PLUGIN_DLL_URL") ?? "";

  return jsonResponse(request, {
    name: "3SM Endurance Connector",
    version: version || "unknown",
    dllUrl: dllUrl || null,
    checkedAt: new Date().toISOString(),
  });
});
