const DEFAULT_TIMEOUT_MS = 25_000;

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function timeoutError(timeoutMs, cause = null) {
  const error = new Error(`fetch timeout na ${formatDuration(timeoutMs)}`);
  error.name = 'TimeoutError';
  if (cause) error.cause = cause;
  return error;
}

export function parseNetworkTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function isTransientNetworkErrorText(text) {
  return /\b(TypeError: )?fetch failed\b/i.test(text)
    || /\b(fetch timeout|TimeoutError|AbortError|aborted)\b/i.test(text)
    || /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/i.test(text);
}

export function createTimeoutFetch({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  return async function timeoutFetch(input, init = {}) {
    const controller = new AbortController();
    const upstreamSignal = init.signal;
    let timedOut = false;
    let timeoutId = null;

    const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true });

    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError(timeoutMs));
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw timeoutError(timeoutMs, error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
    }
  };
}

export function createNetworkHealthTracker({ log, throttleMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');

  let degraded = false;
  let lastLoggedAt = 0;

  return {
    isDegraded() {
      return degraded;
    },

    async recordFailure(context, detail) {
      const current = now();
      const shouldLog = !degraded || current - lastLoggedAt >= throttleMs;
      degraded = true;
      if (!shouldLog) return false;
      lastLoggedAt = current;
      await log('[network] Supabase/API tijdelijk onbereikbaar; bot blijft online, bestaande Discord-kanalen blijven werken, automatische sync probeert later opnieuw.', `${context}: ${detail}`);
      return true;
    },

    async recordSuccess(context) {
      if (!degraded) return false;
      degraded = false;
      lastLoggedAt = 0;
      await log('[network] Supabase/API verbinding hersteld; automatische bot-sync werkt weer.', context);
      return true;
    },
  };
}
