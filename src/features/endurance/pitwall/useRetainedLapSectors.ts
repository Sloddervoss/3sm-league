import { useState } from "react";
import { freshMetrics, freshPaceHistory, rowSectors, trackSectorCount } from "./paceSeries";
import type { V3Normalized } from "./pitwallHelpers";
import { buildSectorTimingIndex } from "./sectorTiming";
import { geldigeLaatsteRonde } from "./standings";

export type RetainedLapSectors = {
  seconds: number[];
  lap: number | null;
  /** Sessietijd waarop deze volledige ronde is waargenomen. */
  observedSessionTime: number | null;
  observedAtMs: number;
};

type State = {
  input: V3Normalized | null | undefined;
  /** Laatste niet-null frame; nodig om een bewaarde reeks nog aan een auto te koppelen. */
  lastInput: V3Normalized | null;
  context: string;
  /** Alleen transport/sessie/track-identiteit; nooit een meting. */
  identity: string | null;
  /** Laatste bekende PACE-segment; ontbrekende PACE mag dit niet wissen. */
  segment: string | null;
  clock: number | null;
  count: number;
  laps: Map<string, RetainedLapSectors>;
  stale: boolean;
};

/**
 * Hoe lang een geverifieerde volledige ronde mag blijven staan wanneer een poll
 * geen nieuwe meting levert. Dit is presentatie, geen bewijs: na deze grens
 * verdwijnt de oude reeks in plaats van een halve minuut als "laatst gezien"
 * door te leven.
 */
export const RETAINED_SECTOR_TTL_SECONDS = 120;

const empty = (input: State["input"], context: string): State => ({
  input,
  lastInput: null,
  context,
  identity: null,
  segment: null,
  clock: null,
  count: 0,
  laps: new Map(),
  stale: true,
});

const identityOf = (input: V3Normalized | null | undefined): string | null =>
  input
    ? JSON.stringify([
        input.transportSessionId ?? "",
        input.identity?.trackId ?? input.identity?.trackName ?? "",
        input.identity?.trackConfig ?? "",
      ])
    : null;

const segmentOf = (input: V3Normalized | null | undefined): string | null => {
  const history = freshPaceHistory(input);
  return history ? JSON.stringify([history.observedSessionId, history.segmentId]) : null;
};

const expired = (entry: RetainedLapSectors, clock: number | null, nowMs: number): boolean => {
  if (clock != null && entry.observedSessionTime != null) {
    return clock - entry.observedSessionTime > RETAINED_SECTOR_TTL_SECONDS;
  }
  return nowMs - entry.observedAtMs > RETAINED_SECTOR_TTL_SECONDS * 1000;
};

function update(previous: State | null, input: State["input"], context: string, nowMs = Date.now()): State {
  // Een ontbrekende poll (null-frame) is geen identiteitswissel. Bewaar de
  // laatste bekende context, maar markeer hem als stale en begrens de leeftijd.
  if (!input) {
    if (!previous || previous.context !== context) return empty(input, context);
    const laps = new Map<string, RetainedLapSectors>();
    for (const [id, entry] of previous.laps) {
      if (!expired(entry, previous.clock, nowMs)) laps.set(id, entry);
    }
    return { ...previous, input, lastInput: previous.lastInput, laps, stale: true };
  }

  const identity = identityOf(input);
  const segment = segmentOf(input);
  const history = freshPaceHistory(input);
  const clock = typeof input.session?.sessionTimeSeconds === "number" && Number.isFinite(input.session.sessionTimeSeconds)
    ? input.session.sessionTimeSeconds
    : null;
  const observedCount = trackSectorCount(input);

  const identityChanged = previous != null && previous.context === context && previous.identity != null && identity !== previous.identity;
  const segmentChanged = previous != null && previous.context === context && previous.segment != null && segment != null && segment !== previous.segment;
  const clockRewound = previous != null && previous.clock != null && clock != null && clock < previous.clock - 0.001;
  const layoutChanged = observedCount > 0 && previous != null && previous.count > 0 && observedCount !== previous.count;
  const reset = !previous || previous.context !== context || identityChanged || segmentChanged || clockRewound || layoutChanged;

  const laps = new Map<string, RetainedLapSectors>(
    reset ? undefined : [...(previous?.laps ?? [])].filter(([, entry]) => !expired(entry, clock, nowMs)),
  );
  // Een reeks zonder bekende ronde kan niet als "laatst geverifieerd" blijven
  // staan: alleen de ronde-identiteit maakt hem later controleerbaar.
  for (const [id, entry] of laps) if (entry.lap == null) laps.delete(id);
  const opponents = (input.opponents ?? []).slice(0, 40);
  const live = buildSectorTimingIndex(history, opponents.map(o => ({ id: o.id, currentLap: o.lap })));

  for (const o of opponents) {
    const cached = laps.get(o.id);
    const completed = typeof o.lap === "number" && Number.isInteger(o.lap) && o.lap > 0 ? o.lap - 1 : null;
    const metrics = freshMetrics(input, o.id);
    const historyCar = history?.cars.find(car => car.id === o.id);
    const invalidated = Array.isArray(historyCar?.sectors) && historyCar.sectors.some(sector =>
      sector && sector.status === "invalidated" && (completed == null || sector.lap >= completed),
    );

    // Een expliciete ongeldigheid (reset/tow, ongeldige laatste ronde of een
    // geannuleerde sectorreeks) wist de bewaarde reeks. Een ontbrekende poll
    // doet dat niet.
    if (invalidated ||
        (metrics?.lapValid === false && completed != null && metrics.sectorLap === completed) ||
        (o.lastLapSeconds != null && geldigeLaatsteRonde(o.lastLapSeconds, o.bestLapSeconds) == null) ||
        (completed != null && cached?.lap != null && completed < cached.lap)) {
      laps.delete(o.id);
      continue;
    }

    // Reeds bewezen live sectorupdates zijn nieuwer; de volledige-rondecache
    // blijft als fallback staan tot een nieuwere volledige ronde hem vervangt.
    if (live.has(o.id)) continue;

    const seconds = rowSectors(input, o.id, o.lastLapSeconds);
    if (seconds && (completed == null || completed > 0) && (cached?.lap == null || (completed != null && completed > cached.lap))) {
      laps.delete(o.id);
      laps.set(o.id, {
        seconds,
        lap: completed,
        observedSessionTime: clock ?? metrics?.observedSessionTimeSeconds ?? null,
        observedAtMs: nowMs,
      });
    }
  }

  // Zacht begrensd: maximaal 40 auto's, elk met de bestaande 1–16 sectorlayout.
  while (laps.size > 40) laps.delete(laps.keys().next().value!);
  for (const [id, entry] of laps) {
    if (entry.seconds.length < 1 || entry.seconds.length > 16 || expired(entry, clock, nowMs)) laps.delete(id);
  }

  const count = observedCount >= 1 && observedCount <= 16
    ? observedCount
    : reset ? 0 : previous?.count ?? 0;

  return {
    input,
    lastInput: input,
    context,
    identity,
    segment: segment ?? (reset ? null : previous?.segment ?? null),
    clock,
    count,
    laps,
    stale: !history || opponents.every(o => freshMetrics(input, o.id) == null),
  };
}

/**
 * Alleen weergave-retentie. De cache wordt nooit als live sectorupdate, als
 * actuele rondetijd of als bewijs gebruikt. Een identiteitswissel, een
 * sessierestart, een andere sectordeling of een expliciete ongeldigheid wist
 * hem; een ontbrekende poll niet.
 */
export function useRetainedLapSectors(input: State["input"], context = ""): State {
  const [state, setState] = useState<State>(() => update(null, input, context));
  if (state.input === input && state.context === context) return state;
  const next = update(state, input, context);
  setState(next);
  return next;
}
