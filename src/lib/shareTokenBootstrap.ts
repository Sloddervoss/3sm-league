/**
 * Bearer-token bootstrap for the public Pitwall link.
 *
 * The token lives in the URL fragment (`#t=<64 hex>`). It must leave the
 * address bar before any analytics, error logger or other site script can read
 * `location.href`. The inline script in index.html is the first executable
 * script on the page: it takes the token into a one-shot closure and replaces
 * the URL immediately. Any later script that calls the closure gets `null`.
 *
 * This module is imported by main.tsx before the application module graph is
 * loaded (App is a dynamic import), so even module-level analytics cannot see
 * the fragment. No storage, cookie, referrer or server log is involved.
 */

type TokenWindow = Window & {
  __3smTakeShareToken?: () => string | null;
};

let captured: string | null = null;

const TOKEN_RE = /^[0-9a-f]{64}$/;

export function isValidShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/**
 * Consume the one-shot token captured by the inline head script, then fall back
 * to the current fragment (direct rendering/tests). Always strips the fragment
 * from the visible URL.
 */
export function captureShareTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  const holder = window as TokenWindow;
  const take = holder.__3smTakeShareToken;
  if (typeof take === "function") {
    try {
      const token = take();
      if (isValidShareToken(token)) captured = token;
    } catch {
      /* ignore a broken inline bootstrap */
    }
    try {
      delete holder.__3smTakeShareToken;
    } catch {
      holder.__3smTakeShareToken = undefined;
    }
  }

  const hash = window.location.hash;
  if (hash) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const candidate = new URLSearchParams(raw).get("t") ?? "";
    if (!captured && isValidShareToken(candidate)) captured = candidate;
    const clean = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", clean);
  }

  return captured;
}

/** One-shot read. The page consumes it exactly once, like the URL fragment. */
export function takeCapturedShareToken(): string | null {
  const value = captured;
  captured = null;
  return value;
}

/** Test-only reset; never used by the application. */
export function resetShareTokenBootstrapForTests(): void {
  captured = null;
}
