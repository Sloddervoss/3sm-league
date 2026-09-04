/* 0.4.3 — DEV-ONLY closing-rate formula (browser-local diagnostics, layout validation).
 * NOT production authority. Production rate is server-derived s/min via
 * get_pitwall_data.opponent_trends (see migration 20260904_pitwall_0403_server_closing_rate.sql).
 * This mirrors the server formula so DEV layout validation is consistent.
 * Unit: seconds of gap change per MINUTE. Sign: + = closing, - = opening.
 */
export interface OppoGapSample {
  /** timestamp (epoch seconds) */
  t: number;
  /** signed gap to player in seconds. Positive = behind, negative = ahead. */
  s: number;
}

export interface TrendResult {
  /** seconds gained/lost per minute. Positive = opponent closing. null when unreliable. */
  closingRatePerMin: number | null;
  samplesUsed: number;
  reliable: boolean;
}

export const MinTrendSamples = 3;
export const TrendWindowSeconds = 60;

/** Least-squares slope of gap(s) vs time, negated and x60 to give s/min (mirrors server). */
export function deriveClosingRate(
  samples: OppoGapSample[],
  opts: { minSamples?: number; windowSeconds?: number } = {},
): TrendResult {
  const minSamples = opts.minSamples ?? MinTrendSamples;
  const window = opts.windowSeconds ?? TrendWindowSeconds;
  if (!samples || samples.length < minSamples) {
    return { closingRatePerMin: null, samplesUsed: 0, reliable: false };
  }
  const now = Math.max(...samples.map((s) => s.t));
  const cutoff = now - window;
  const inWindow = samples
    .filter((s) => s.t >= cutoff && Number.isFinite(s.s))
    .sort((a, b) => a.t - b.t);
  if (inWindow.length < minSamples) {
    return { closingRatePerMin: null, samplesUsed: inWindow.length, reliable: false };
  }
  const n = inWindow.length;
  const meanT = inWindow.reduce((a, s) => a + s.t, 0) / n;
  const meanS = inWindow.reduce((a, s) => a + s.s, 0) / n;
  let num = 0, den = 0;
  for (const s of inWindow) {
    num += (s.t - meanT) * (s.s - meanS);
    den += (s.t - meanT) ** 2;
  }
  if (den === 0) return { closingRatePerMin: null, samplesUsed: n, reliable: false };
  const dGapPerSec = num / den; // Δgap/Δsecond
  const closingRatePerMin = -60 * dGapPerSec; // negate: shrinking gap => closing(+)
  return { closingRatePerMin: Number.isFinite(closingRatePerMin) ? closingRatePerMin : null, samplesUsed: n, reliable: Number.isFinite(closingRatePerMin) };
}

export function formatClosingRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const prefix = rate >= 0 ? "+" : "−";
  return `${prefix}${Math.abs(rate).toFixed(2)} s/min`;
}