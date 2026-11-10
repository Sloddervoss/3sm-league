/**
 * Pure overgangsreducer voor de premium timingtabel.
 *
 * De tabel zelf toont altijd de nieuwste snapshot. Deze reducer voegt alleen
 * korte, eerlijke decoratie toe:
 *
 * - `moves` is het verschil in **positie per auto-id** sinds de vorige meting.
 *   Nooit een rij-index, klassefilter of arrayvolgorde.
 * - `lapFlash` markeert uitsluitend een opvolgende ronde (vorige + 1).
 * - De eerste snapshot, een contextwissel, offline/gat, een tabwissel of een
 *   onmogelijke ronde-sprong zet de vergelijking uit. Er wordt dan niets
 *   geanimeerd en niets geclaimd; de volgende snapshot is een nieuw ijkpunt.
 */

export type TimingResetReason = "context" | "offline" | "gap" | "hidden" | "lap-jump" | "manual";

export interface TimingSnapshotRow {
  id: string;
  position?: number | null;
  lap?: number | null;
}

export interface TimingTransitionState {
  contextKey: string | null;
  /** Er is een geldig ijkpunt; pas dan mogen er verschillen worden gemeld. */
  armed: boolean;
  positions: Record<string, number>;
  laps: Record<string, number>;
  /** Signed: +1 is een plaats gewonnen, -1 een plaats verloren. */
  moves: Record<string, number>;
  /** id → rondenummer dat zojuist met één steeg. */
  lapFlash: Record<string, number>;
  resetReason: TimingResetReason | null;
}

export type TimingTransitionAction =
  | {
      type: "snapshot";
      contextKey: string;
      rows: readonly TimingSnapshotRow[];
      live: boolean;
      /** Een expliciet datagat (geen aaneengesloten meting). */
      gap?: boolean;
    }
  | { type: "reset"; reason: TimingResetReason }
  | { type: "visibility"; hidden: boolean };

export const initialTimingState = (): TimingTransitionState => ({
  contextKey: null,
  armed: false,
  positions: {},
  laps: {},
  moves: {},
  lapFlash: {},
  resetReason: null,
});

const blank = (contextKey: string | null, reason: TimingResetReason | null): TimingTransitionState => ({
  contextKey,
  armed: false,
  positions: {},
  laps: {},
  moves: {},
  lapFlash: {},
  resetReason: reason,
});

const validPosition = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const validLap = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const collect = (rows: readonly TimingSnapshotRow[]) => {
  const positions: Record<string, number> = {};
  const laps: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    if (validPosition(row.position)) positions[row.id] = row.position;
    if (validLap(row.lap)) laps[row.id] = row.lap;
  }
  return { positions, laps };
};

export function reduceTimingTransitions(
  state: TimingTransitionState,
  action: TimingTransitionAction,
): TimingTransitionState {
  if (action.type === "reset") {
    return blank(state.contextKey, action.reason);
  }

  if (action.type === "visibility") {
    if (!action.hidden) return state;
    return blank(state.contextKey, "hidden");
  }

  if (!action.live || action.gap) {
    if (!state.armed && Object.keys(state.positions).length === 0 && Object.keys(state.moves).length === 0) {
      return state.contextKey === action.contextKey
        ? { ...state, contextKey: action.contextKey, resetReason: action.gap ? "gap" : "offline" }
        : blank(action.contextKey, action.gap ? "gap" : "offline");
    }
    return blank(action.contextKey, action.gap ? "gap" : "offline");
  }

  // Andere race, ander apparaat of andere sessie: nooit met de oude basis
  // vergelijken, ook niet als toevallig hetzelfde auto-id terugkomt.
  if (state.contextKey !== action.contextKey) {
    const { positions, laps } = collect(action.rows);
    return { ...blank(action.contextKey, "context"), armed: true, positions, laps };
  }

  if (!state.armed) {
    const { positions, laps } = collect(action.rows);
    return { ...blank(action.contextKey, null), armed: true, positions, laps };
  }

  const { positions, laps } = collect(action.rows);

  // Een sprong van meer dan één ronde (of terug in de tijd) is geen rondewissel
  // maar een gat of sessieherstart. Eerst opnieuw ijken, dan pas weer melden.
  for (const [id, lap] of Object.entries(laps)) {
    const previous = state.laps[id];
    if (previous != null && (lap < previous || lap - previous > 1)) {
      return blank(action.contextKey, "lap-jump");
    }
  }

  const moves: Record<string, number> = {};
  for (const [id, position] of Object.entries(positions)) {
    const previous = state.positions[id];
    if (previous != null && previous !== position) moves[id] = previous - position;
  }

  const lapFlash: Record<string, number> = {};
  for (const [id, lap] of Object.entries(laps)) {
    const previous = state.laps[id];
    if (previous != null && lap === previous + 1) lapFlash[id] = lap;
  }

  return {
    contextKey: action.contextKey,
    armed: true,
    positions,
    laps,
    moves,
    lapFlash,
    resetReason: null,
  };
}
