import { useState } from "react";
import { freshMetrics, freshPaceHistory, rowSectors, trackSectorCount } from "./paceSeries";
import type { V3Normalized } from "./pitwallHelpers";
import { buildSectorTimingIndex } from "./sectorTiming";
import { geldigeLaatsteRonde } from "./standings";

type LapSectors = { seconds: number[]; lap: number | null };
type State = {
  input: V3Normalized | null | undefined;
  context: string;
  scope: string | null;
  clock?: number;
  count: number;
  laps: Map<string, LapSectors>;
};

function update(previous: State | null, input: State["input"], context: string): State {
  const history = freshPaceHistory(input);
  const scope = history ? JSON.stringify([input?.transportSessionId, history.observedSessionId, history.segmentId, input?.identity?.trackId, input?.identity?.trackConfig]) : null;
  const clock = input?.session?.sessionTimeSeconds;
  const count = trackSectorCount(input);
  const reset = !previous || previous.context !== context || !scope || scope !== previous.scope ||
    (clock != null && previous.clock != null && clock < previous.clock - 0.001) ||
    (count > 0 && previous.count > 0 && count !== previous.count);
  const laps = new Map(reset ? undefined : previous.laps);
  for (const [id, entry] of laps) if (entry.lap == null) laps.delete(id);
  const opponents = (input?.opponents ?? []).slice(0, 40);
  const live = buildSectorTimingIndex(history, opponents.map(o => ({ id: o.id, currentLap: o.lap })));
  for (const o of opponents) {
    const cached = laps.get(o.id);
    const m = freshMetrics(input, o.id);
    const completed = typeof o.lap === "number" ? o.lap - 1 : null;
    if (live.has(o.id) || (completed != null && cached?.lap != null && completed < cached.lap) ||
        (m?.lapValid === false && completed != null && m.sectorLap === completed) ||
        (o.lastLapSeconds != null && geldigeLaatsteRonde(o.lastLapSeconds, o.bestLapSeconds) == null)) {
      laps.delete(o.id);
      continue;
    }
    // Accept only the existing strict full-lap validation, with a known lap.
    const seconds = rowSectors(input, o.id, o.lastLapSeconds);
    const lap = completed != null && Number.isInteger(completed) && completed > 0 ? completed : null;
    if (seconds && (cached?.lap == null || (lap != null && lap > cached.lap))) {
      laps.delete(o.id);
      laps.set(o.id, { seconds, lap });
    }
  }
  while (laps.size > 40) laps.delete(laps.keys().next().value!);
  return { input, context, scope, clock, count: count || (reset ? 0 : previous.count), laps };
}

/** Display-only retention: never uses cached results as live sectors or lap metrics. */
export function useRetainedLapSectors(input: State["input"], context = ""): State {
  const [state, setState] = useState<State>(() => update(null, input, context));
  if (state.input === input && state.context === context) return state;
  const next = update(state, input, context);
  setState(next);
  return next;
}
