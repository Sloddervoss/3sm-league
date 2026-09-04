/* 0.4.3 — DEV-ONLY closing-rate helper (browser-local diagnostics fallback).
 * NOT the production source of truth. Production closing rate is derived SERVER-SIDE
 * (see supabase migration 20260904_pitwall_0403_server_closing_rate.sql) and delivered
 * via get_pitwall_data.opponent_trends. This module exists only so a DEV Pitwall can
 * visually validate the layout without a live server-backed data feed.
 * Unit: seconds of gap change per minute (s/min). Sign: + = closing, - = opening.
 */
import { deriveClosingRate, formatClosingRate, type TrendResult } from "./closingRate";
import type { OppoGapSample } from "./closingRate";

/** Recent gap samples per opponent id, bounded length + age. DEV-only. */
export class OpponentHistory {
  private history = new Map<string, OppoGapSample[]>();
  private maxSamples = 40;
  private maxAgeSeconds = 120;

  record(opponents: Array<{ id: string; gapToPlayerSeconds?: number | null | undefined }>, t: number): void {
    const cutoff = t - this.maxAgeSeconds;
    for (const o of opponents) {
      const id = o.id;
      if (o.gapToPlayerSeconds == null) continue;
      const arr = (this.history.get(id) ?? []).filter((s) => s.t > cutoff);
      arr.push({ t, s: o.gapToPlayerSeconds });
      this.history.set(id, arr.slice(-this.maxSamples));
    }
  }

  trendFor(id: string): number | null {
    const samples = this.history.get(id);
    if (!samples) return null;
    const res = deriveClosingRate(samples);
    return res.reliable ? res.closingRatePerMin : null;
  }

  reset(): void {
    this.history.clear();
  }
}

export type { TrendResult };
export { formatClosingRate };