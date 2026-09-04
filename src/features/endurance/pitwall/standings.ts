/* Pitwall 0.4.2 — live standings derivation from the bounded opponent snapshot.
 * Pure functions (no React), unit-testable. Source of truth: v3_normalized.opponents
 * (0.4.1 connector) + v3_normalized.position (own car). No table queries, no history.
 */
import type { V3Normalized, V3Opponent } from "./pitwallHelpers";

export interface StandingsRow extends V3Opponent {
  /** True for the player's own car row. */
  isPlayer: boolean;
}

export interface StandingsDerivation {
  /** Own car overall position (from own v3_normalized.position, fallback: player row). */
  overallPosition: number | null;
  /** Own car class position. */
  classPosition: number | null;
  /** Sorted standings (by overall position asc, player first when tied). Bound ≤ cap+1. */
  rows: StandingsRow[];
  /** Directly ahead: nearest active connected opponent in race order. null if none/unavailable. */
  ahead: V3Opponent | null;
  /** Directly behind: nearest active connected opponent behind. null if none/unavailable. */
  behind: V3Opponent | null;
  /** Closing rate (s/lap, + = opponent closing) for the ahead car. null when unreliable. */
  aheadTrend: number | null;
  /** Closing rate (s/lap, + = opponent closing) for the behind car. null when unreliable. */
  behindTrend: number | null;
  /** True when no opponent array present (clean empty state). */
  noData: boolean;
}

/** A row participates in ahead/behind if it is active + connected + not the player. */
const isActiveRow = (o: V3Opponent): boolean =>
  o.connected !== false && !o.isPlayer;

/** Sort key: overall position asc; missing position sorts last; player first only when tied. */
const positionKey = (o: V3Opponent): number =>
  typeof o.position === "number" ? o.position : Number.MAX_SAFE_INTEGER;

const playerRank = (o: V3Opponent): number => (o.isPlayer ? 0 : 1);

const fallbackOwnPosition = (rows: V3Opponent[]): number | null => {
  const player = rows.find((o) => o.isPlayer);
  return typeof player?.position === "number" ? player.position : null;
};

/** Derive standings from the current V3 snapshot. Bound ≤ opponent cap + player.
 *  Optional `trends`: opponent-id → closingRatePerLap (from bounded OpponentHistory). */
export function deriveStandings(
  v3?: V3Normalized | null,
  maxRows = 40,
  trends?: Record<string, number | null> | null,
): StandingsDerivation {
  const opponents = v3?.opponents ?? [];
  const noData = !Array.isArray(v3?.opponents) || opponents.length === 0;

  const rows = [...opponents]
    .sort((a, b) => {
      const pos = positionKey(a) - positionKey(b);
      return pos !== 0 ? pos : playerRank(a) - playerRank(b);
    })
    .slice(0, maxRows + 1)
    .map((o) => ({ ...o, isPlayer: !!o.isPlayer }));

  // Own overall/class position: prefer own v3.position; fallback to player row in snapshot.
  const ownOverall = v3?.position?.position ?? fallbackOwnPosition(rows);
  const ownClass = v3?.position?.classPosition ?? null;

  // Direct ahead = lowest position strictly < ownOverall among active rows.
  // Direct behind = highest position strictly > ownOverall among active rows.
  let ahead: V3Opponent | null = null;
  let behind: V3Opponent | null = null;
  if (typeof ownOverall === "number") {
    const active = opponents.filter(isActiveRow);
    const withPos = active.filter((o) => typeof o.position === "number") as Array<V3Opponent & { position: number }>;
    const aheadCand = withPos.filter((o) => o.position < ownOverall).sort((a, b) => b.position - a.position);
    const behindCand = withPos.filter((o) => o.position > ownOverall).sort((a, b) => a.position - b.position);
    ahead = aheadCand[0] ?? null;
    behind = behindCand[0] ?? null;
  }

  return {
    overallPosition: ownOverall,
    classPosition: ownClass,
    rows,
    ahead,
    behind,
    aheadTrend: ahead ? (trends?.[ahead.id] ?? null) : null,
    behindTrend: behind ? (trends?.[behind.id] ?? null) : null,
    noData,
  };
}

/** Render a gap value: prefer gapToPlayer for ahead/behind, else null. */
export function renderGap(o: V3Opponent | null, useLeader = false): string {
  if (!o) return "—";
  const secs = useLeader ? o.gapToLeaderSeconds : o.gapToPlayerSeconds;
  if (secs == null || isNaN(secs) || !isFinite(secs)) return "—";
  return `${secs >= 0 ? "+" : ""}${secs.toFixed(1)}s`;
}

export function renderPosition(value: number | null | undefined): string {
  return typeof value === "number" && value > 0 ? String(value) : "—";
}