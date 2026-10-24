import { useMemo } from "react";
import type { PitwallStrategyRow, V3Normalized } from "./pitwallHelpers";
import { advise, buildStrategySnapshot } from "./strategy";
import type { Advice } from "./strategy/types";

/**
 * Dunne laag tussen de bestaande pitwalldata en de rekenkern.
 *
 * Bewust geen eigen polling: de hook rekent op wat usePitwallData al ophaalt.
 * Twee pollers naast elkaar zouden verschillende momentopnames door elkaar
 * gooien, en dan klopt de leeftijd van de meting niet meer.
 */
export interface PitwallStrategyInput {
  strategy: PitwallStrategyRow | null;
  v3: V3Normalized | null;
  plannedLaps?: number | null;
  plannedDurationMinutes?: number | null;
  pitLaneSeconds?: number | null;
  secondsPerLitre?: number | null;
  tyreSeconds?: number | null;
  fuelPerLapSamples?: number[];
  nowMs?: number;
}

export function usePitwallStrategy(input: PitwallStrategyInput): Advice {
  const {
    strategy,
    v3,
    plannedLaps,
    plannedDurationMinutes,
    pitLaneSeconds,
    secondsPerLitre,
    tyreSeconds,
    fuelPerLapSamples,
    nowMs,
  } = input;

  return useMemo(
    () =>
      advise(
        buildStrategySnapshot({
          strategy,
          v3,
          nowMs: nowMs ?? Date.now(),
          plannedLaps,
          plannedDurationMinutes,
          pitLaneSeconds,
          secondsPerLitre,
          tyreSeconds,
          fuelPerLapSamples,
        }),
      ),
    [
      strategy,
      v3,
      plannedLaps,
      plannedDurationMinutes,
      pitLaneSeconds,
      secondsPerLitre,
      tyreSeconds,
      fuelPerLapSamples,
      nowMs,
    ],
  );
}
