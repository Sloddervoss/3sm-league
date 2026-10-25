import { useMemo, useRef } from "react";
import type { PitwallStrategyRow, V3Normalized } from "./pitwallHelpers";
import { advise, buildStrategySnapshot } from "./strategy";
import type { Advice } from "./strategy/types";
import { recordTyreSample, type TyreSample } from "./strategy/tyreWear";
import type { TyreEstimate } from "./strategy/tyreGrade";

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
  /** Bandenslijtage per ronde uit de server, als die er al is. */
  tyreSamples?: TyreSample[];
  /** Het bandenbeeld uit de pitwall-RPC (`tyre_estimate`, S2); null als het er niet is. */
  tyreEstimate?: TyreEstimate | null;
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
    tyreSamples,
    tyreEstimate,
    nowMs,
  } = input;

  // De bandenslijtage per ronde komt uit de live stroom: één meting per ronde.
  // De reeks hoort bij deze sessie; een andere transport-sessie begint opnieuw.
  const recorder = useRef<{ key: string; samples: TyreSample[] }>({ key: "", samples: [] });

  return useMemo(() => {
    const samples = tyreSamples ?? recordLiveTyreSample(recorder.current, v3);

    return advise(
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
        tyreSamples: samples,
        tyreEstimate: tyreEstimate ?? null,
      }),
    );
  }, [
    strategy,
    v3,
    plannedLaps,
    plannedDurationMinutes,
    pitLaneSeconds,
    secondsPerLitre,
    tyreSeconds,
    fuelPerLapSamples,
    tyreSamples,
    tyreEstimate,
    nowMs,
  ]);
}

/**
 * De live lezing als meting van deze ronde vastleggen. Zonder rondeteller of
 * zonder vier wielen is er niets om vast te leggen; dan blijft de reeks zoals
 * hij was. De laatste lezing van een ronde overschrijft de eerdere, want de
 * slijtage loopt tijdens de ronde op en pas aan het eind staat er wat de ronde
 * kostte.
 */
function recordLiveTyreSample(
  state: { key: string; samples: TyreSample[] },
  v3: V3Normalized | null,
): TyreSample[] {
  const key = v3?.transportSessionId ?? "";
  if (key !== state.key) {
    state.key = key;
    state.samples = [];
  }

  const lap = v3?.timing?.completedLaps;
  const auto = v3?.vehicle;
  if (lap == null || !auto) return state.samples;

  const hoek = (t: { wearPercent?: number | null } | null | undefined): number =>
    typeof t?.wearPercent === "number" && Number.isFinite(t.wearPercent) ? t.wearPercent : NaN;

  state.samples = recordTyreSample(state.samples, {
    lap,
    lapTime: v3?.timing?.lastLapTimeSeconds ?? null,
    fl: hoek(auto.frontLeft),
    fr: hoek(auto.frontRight),
    rl: hoek(auto.rearLeft),
    rr: hoek(auto.rearRight),
  });

  return state.samples;
}
