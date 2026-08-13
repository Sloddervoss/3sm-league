declare const Deno: { env: { get(name: string): string | undefined } };

export type IRacingClient = {
  fetchData<T = unknown>(path: string): Promise<T>;
};

const base64FromBytes = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
};

const hashPassword = async (password: string, email: string) => {
  const data = new TextEncoder().encode(password + email.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64FromBytes(new Uint8Array(digest));
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};

const safeSnippet = async (response: Response) =>
  (await response.text().catch(() => "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 180);

export async function createIRacingClient(userAgent = "3SM Endurance Sync/1.0"): Promise<IRacingClient> {
  const email = Deno.env.get("IRACING_EMAIL") ?? "";
  const password = Deno.env.get("IRACING_PASSWORD") ?? "";
  if (!email || !password) throw new Error("iRacing-servercredentials ontbreken");

  const jar = new Map<string, string>();
  const mergeCookie = (response: Response, sourceUrl: string) => {
    if (new URL(sourceUrl).hostname !== "members-ng.iracing.com") return;
    const cookies = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? (response.headers.get("set-cookie")?.split(/,(?=[^;]+?=)/) ?? []);
    for (const raw of cookies) {
      const pair = raw.split(";")[0]?.trim();
      const equals = pair?.indexOf("=") ?? -1;
      if (pair && equals > 0) jar.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
  };
  const cookieHeader = () => Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
  const oauthFetch = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    headers.set("User-Agent", userAgent);
    if (cookieHeader()) headers.set("Cookie", cookieHeader());
    const response = await fetchWithTimeout(url, { ...init, headers, redirect: "manual" });
    mergeCookie(response, url);
    return response;
  };
  const followRedirects = async (url: string, max = 8) => {
    let currentUrl = url;
    let response = await oauthFetch(currentUrl);
    for (let count = 0; count < max && response.status >= 300 && response.status < 400; count += 1) {
      const location = response.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      response = await oauthFetch(currentUrl);
    }
    return response;
  };

  const base64Url = (bytes: Uint8Array) => base64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirectUri = "https://members-ng.iracing.com/bff/pub/initialize?DOMAIN=members-ng.iracing.com";
  const authorize = new URL("https://oauth.iracing.com/oauth2/authorize");
  authorize.search = new URLSearchParams({ client_id: "iracing_ui", response_type: "code", redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", scope: "iracing.auth" }).toString();

  const start = await followRedirects(authorize.toString());
  const html = await start.text();
  const legacyAction = html.match(/<form[^>]*action=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
  const startUrl = new URL(start.url);
  const action = legacyAction ?? (startUrl.hostname === "oauth.iracing.com" && startUrl.pathname === "/u/start" ? start.url : null);
  if (!action) throw new Error(`iRacing OAuth-loginroute niet gevonden: HTTP ${start.status}`);

  let currentUrl = new URL(action, "https://oauth.iracing.com").toString();
  let response = await oauthFetch(currentUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email, password: await hashPassword(password, email), rememberMe: "yes", offer_remember_me: "true" }) });
  let initializedId: string | null = null;
  for (let count = 0; count < 8 && response.status >= 300 && response.status < 400; count += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    currentUrl = new URL(location, currentUrl).toString();
    initializedId = new URL(currentUrl).searchParams.get("initialized_id") ?? initializedId;
    response = await oauthFetch(currentUrl);
  }
  initializedId = initializedId ?? new URL(currentUrl).searchParams.get("initialized_id");
  if (!initializedId) throw new Error(`iRacing OAuth gaf geen initialized_id: HTTP ${response.status} ${await safeSnippet(response)}`);

  const verified = await oauthFetch("https://members-ng.iracing.com/bff/pub/verify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ initialized_id: initializedId, redirect_uri: redirectUri, code_verifier: verifier, client_id: "iracing_ui" }) });
  if (!verified.ok) throw new Error(`iRacing OAuth-verify mislukt: HTTP ${verified.status}`);
  const verifiedId = String((await verified.json())?.verified_id ?? "").trim();
  if (!verifiedId) throw new Error("iRacing OAuth-verify gaf geen verified_id");
  await followRedirects(`https://members-ng.iracing.com/bff/pub/establish?verified_id=${encodeURIComponent(verifiedId)}`);
  if (!cookieHeader()) throw new Error("iRacing OAuth gaf geen server-side sessiecookie");

  return {
    async fetchData<T>(path: string): Promise<T> {
      if (!path.startsWith("/data/")) throw new Error("Alleen iRacing Data API-paden zijn toegestaan");
      const result = await fetchWithTimeout(`https://members-ng.iracing.com/bff/pub/proxy${path}`, { headers: { Cookie: cookieHeader(), "User-Agent": userAgent, Accept: "application/json" } });
      if (!result.ok) throw new Error(`iRacing Data API mislukt: HTTP ${result.status} ${path}`);
      const json = await result.json();
      if (json?.link) {
        const link = new URL(String(json.link));
        if (!link.hostname.endsWith("iracing.com") && !link.hostname.endsWith("amazonaws.com")) throw new Error("iRacing data-linkhost niet toegestaan");
        const linked = await fetchWithTimeout(link.toString(), { headers: { Accept: "application/json" } });
        if (!linked.ok) throw new Error(`iRacing data-link mislukt: HTTP ${linked.status}`);
        return await linked.json() as T;
      }
      return json as T;
    },
  };
}
