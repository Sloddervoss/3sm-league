import { useEffect, useState } from "react";

export interface SectorLayoutState {
  contextKey: string;
  count: number;
}

export const validSectorLayoutCount = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16 ? value : 0;

/** Remember layout metadata, never sector times. A contradictory frame cannot reshape it. */
export function retainSectorLayout(previous: SectorLayoutState, contextKey: string, observed: number): SectorLayoutState {
  const count = validSectorLayoutCount(observed);
  if (previous.contextKey !== contextKey) return { contextKey, count };
  if (previous.count > 0 || count === 0) return previous;
  return { contextKey, count };
}

/** First trustworthy layout stays fixed until the selected device/track/transport context changes. */
export function useSectorLayoutCount(contextKey: string, observed: number): number {
  const [layout, setLayout] = useState<SectorLayoutState>(() => ({ contextKey, count: validSectorLayoutCount(observed) }));
  const current = retainSectorLayout(layout, contextKey, observed);
  useEffect(() => {
    setLayout(previous => retainSectorLayout(previous, contextKey, observed));
  }, [contextKey, observed]);
  return current.count;
}
