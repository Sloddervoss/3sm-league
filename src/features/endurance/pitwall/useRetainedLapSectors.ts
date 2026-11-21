import { useState } from "react";
import { completedLap, freshPaceHistory, persistedMetrics, rowSectors, trackSectorCount } from "./paceSeries";
import type { V3Normalized } from "./pitwallHelpers";
import { buildSectorTimingIndex, type CarSectorTiming } from "./sectorTiming";
import { carRef, traceSector } from "./sectorTrace";
import { geldigeLaatsteRonde } from "./standings";

export type RetainedLapSectors = {
  seconds: number[];
  lap: number | null;
  /** Sessietijd waarop deze volledige ronde is waargenomen. */
  observedSessionTime: number | null;
  observedAtMs: number;
};

/**
 * Identiteit als losse, optionele delen. Een ontbrekend deel is "onbekend" en
 * mag geen wissel bewijzen; alleen twee bekende, verschillende waarden doen dat.
 * Zo kan een tussenframe zonder trackblok de bewezen sectoren niet wissen.
 */
type IdentityParts = {
  transport: string | null;
  trackId: number | null;
  trackName: string | null;
  config: string | null;
};

type State = {
  input: V3Normalized | null | undefined;
  /** Laatste niet-null frame; nodig om een bewaarde reeks nog aan een auto te koppelen. */
  lastInput: V3Normalized | null;
  context: string;
  /** Alleen transport/sessie/track-identiteit; nooit een meting. */
  identity: IdentityParts | null;
  /** Laatste bekende PACE-segment; ontbrekende PACE mag dit niet wissen. */
  segment: string | null;
  clock: number | null;
  count: number;
  laps: Map<string, RetainedLapSectors>;
  /**
   * Bevestigde ongeldigheden per auto en ronde. Deze blijven binnen de sessie
   * staan, ook als een later frame de invalidated-sector niet meer meezendt.
   * Zonder dit kan een oudere meting de ongeldige ronde weer tot "bewezen"
   * maken.
   */
  invalidated: Map<string, Set<string>>;
  stale: boolean;
};

const empty = (input: State["input"], context: string): State => ({
  input,
  lastInput: null,
  context,
  identity: null,
  segment: null,
  clock: null,
  count: 0,
  laps: new Map(),
  invalidated: new Map(),
  stale: true,
});

/** Sessie/track-identiteit. Ontbrekende metadata is "onbekend", geen wissel. */
const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
};

const identityOf = (input: V3Normalized | null | undefined): IdentityParts | null => {
  if (!input) return null;
  const parts: IdentityParts = {
    transport: nonEmpty(input.transportSessionId),
    trackId: typeof input.identity?.trackId === "number" && Number.isFinite(input.identity.trackId)
      ? input.identity.trackId
      : null,
    trackName: nonEmpty(input.identity?.trackName),
    config: nonEmpty(input.identity?.trackConfig),
  };
  if (parts.transport == null && parts.trackId == null && parts.trackName == null && parts.config == null) {
    return null;
  }
  return parts;
};

/** Alleen een component die aan beide kanten bekend is, kan een wissel bewijzen. */
const identityChangedFrom = (previous: IdentityParts | null, next: IdentityParts | null): boolean => {
  if (!previous || !next) return false;
  if (previous.transport != null && next.transport != null && previous.transport !== next.transport) return true;
  if (previous.trackId != null && next.trackId != null && previous.trackId !== next.trackId) return true;
  // trackName is alleen leidend als geen van beide kanten een numeriek trackId heeft.
  if (previous.trackId == null && next.trackId == null
    && previous.trackName != null && next.trackName != null && previous.trackName !== next.trackName) return true;
  if (previous.config != null && next.config != null && previous.config !== next.config) return true;
  return false;
};

/** Onbekende delen laten de laatst bekende waarde staan; bekende delen vullen aan. */
const mergeIdentity = (previous: IdentityParts | null, next: IdentityParts | null): IdentityParts | null => {
  if (!previous) return next;
  if (!next) return previous;
  return {
    transport: next.transport ?? previous.transport,
    trackId: next.trackId ?? previous.trackId,
    trackName: next.trackName ?? previous.trackName,
    config: next.config ?? previous.config,
  };
};

const segmentOf = (input: V3Normalized | null | undefined): string | null => {
  const history = freshPaceHistory(input);
  return history ? JSON.stringify([history.observedSessionId, history.segmentId]) : null;
};

/** Nieuwste observatie wint; gelijke standen mogen niet ouderd worden overschreven. */
const newerThan = (
  candidate: { lap: number | null; observedSessionTime: number | null },
  cached: RetainedLapSectors | undefined,
): boolean => {
  if (!cached) return true;
  if (candidate.lap == null) {
    // Een onbekende ronde mag een bekende ronde niet verdringen; twee
    // onbekende standen vergelijken alleen op observatietijd.
    return cached.lap == null && (
      candidate.observedSessionTime == null
      || cached.observedSessionTime == null
      || candidate.observedSessionTime >= cached.observedSessionTime
    );
  }
  if (cached.lap == null) return true;
  if (candidate.lap !== cached.lap) return candidate.lap > cached.lap;
  return candidate.observedSessionTime == null
    || cached.observedSessionTime == null
    || candidate.observedSessionTime >= cached.observedSessionTime;
};

/**
 * Een volledige ronde uit de live sectorstand: alleen wanneer alle sectoren van
 * dezelfde, geverifieerde ronde aanwezig zijn. Een halve/mixende stand is geen
 * volledige ronde en wordt hier niet als bewaarde reeks opgeslagen.
 */
const liveLap = (timing: CarSectorTiming | undefined): { seconds: number[]; lap: number } | null => {
  if (!timing || timing.status !== "verified" || timing.mixedLaps) return null;
  if (timing.slots.length < 1 || timing.slots.length > 16) return null;
  const seconds: number[] = [];
  for (const slot of timing.slots) {
    if (!slot || slot.status === "invalidated" || slot.seconds == null || slot.seconds <= 0) return null;
    seconds.push(slot.seconds);
  }
  return seconds.length === timing.sectorCount ? { seconds, lap: timing.lap } : null;
};

function update(previous: State | null, input: State["input"], context: string, nowMs = Date.now()): State {
  // Een ontbrekende poll (null-frame) is geen identiteitswissel en geen
  // ongeldigheid: de laatste bewezen stand blijft staan, alleen gedimd.
  if (!input) {
    if (!previous || previous.context !== context) return empty(input, context);
    return { ...previous, input, lastInput: previous.lastInput, stale: true };
  }

  const identity = identityOf(input);
  const segment = segmentOf(input);
  const history = freshPaceHistory(input);
  const clock = typeof input.session?.sessionTimeSeconds === "number" && Number.isFinite(input.session.sessionTimeSeconds)
    ? input.session.sessionTimeSeconds
    : null;
  const observedCount = trackSectorCount(input);

  // Alleen een *bevestigde* wissel wist de reeks. Ontbrekende track- of
  // segmentmetadata in één frame is onbekend, geen nieuwe sessie.
  const identityChanged = previous != null && previous.context === context && identityChangedFrom(previous.identity, identity);
  const segmentChanged = previous != null && previous.context === context && previous.segment != null && segment != null && segment !== previous.segment;
  const clockRewound = previous != null && previous.clock != null && clock != null && clock < previous.clock - 0.001;
  const layoutChanged = observedCount > 0 && previous != null && previous.count > 0 && observedCount !== previous.count;
  const reset = !previous || previous.context !== context || identityChanged || segmentChanged || clockRewound || layoutChanged;
  const resetReason = !previous ? "first_frame"
    : previous.context !== context ? "context"
      : identityChanged ? "identity"
        : segmentChanged ? "segment"
          : clockRewound ? "clock"
            : layoutChanged ? "layout"
              : null;
  if (resetReason && previous) {
    traceSector("retained_reset", {
      scope: context,
      detail: {
        reason: resetReason,
        cars_before: previous.laps.size,
        had_track: identity != null && (identity.trackId != null || identity.trackName != null),
        observed_count: observedCount,
      },
    });
  }

  const laps = new Map<string, RetainedLapSectors>(reset ? undefined : [...(previous?.laps ?? [])]);
  const invalidated = new Map<string, Set<string>>(reset ? undefined : [...(previous?.invalidated ?? [])]);

  const opponents = (input.opponents ?? []).slice(0, 40);
  const live = buildSectorTimingIndex(history, opponents.map(o => ({ id: o.id, currentLap: o.lap })));

  for (const o of opponents) {
    const cached = laps.get(o.id);
    const completed = typeof o.lap === "number" && Number.isInteger(o.lap) && o.lap > 0 ? o.lap - 1 : null;
    const metrics = persistedMetrics(input, o.id);
    const historyCar = history?.cars.find(car => car.id === o.id);

    // Bevestigde ongeldigheden worden in deze sessie onthouden. Een later
    // frame dat de invalidated-sector niet meer bevat, maakt de ronde niet
    // opnieuw geldig.
    const seenInvalidated = new Set<string>(invalidated.get(o.id) ?? []);
    for (const sector of historyCar?.sectors ?? []) {
      if (sector && sector.status === "invalidated" && Number.isInteger(sector.lap)) {
        seenInvalidated.add(`${sector.lap}:${sector.sectorIndex}`);
        invalidated.set(o.id, seenInvalidated);
      }
    }
    const invalidatedCells = seenInvalidated;
    const invalidatedCachedLap = cached?.lap != null
      && [...invalidatedCells].some((key) => key.startsWith(`${cached.lap}:`));
    const cachedLapMarkedInvalid = cached?.lap != null && metrics?.lapValid === false && metrics.sectorLap === cached.lap;
    const cachedLapIsShortArtifact = cached?.lap != null && completed != null && completed === cached.lap &&
      o.lastLapSeconds != null && geldigeLaatsteRonde(o.lastLapSeconds, o.bestLapSeconds) == null;
    // Een lagere ronde is alleen een tellerreset als de meting niet
    // aantoonbaar ouder is. Een out-of-order poll mag de nieuwere reeks niet
    // wissen.
    const lapCounterWentBack = cached?.lap != null && completed != null && completed < cached.lap
      && (metrics?.observedSessionTimeSeconds == null || cached.observedSessionTime == null
        || metrics.observedSessionTimeSeconds >= cached.observedSessionTime);

    if (invalidatedCachedLap || cachedLapMarkedInvalid || cachedLapIsShortArtifact || lapCounterWentBack) {
      // Tijdelijke diagnose: waarom verdween deze cel? Alleen een gehashte
      // auto-referentie en een vaste reden, nooit een naam of ruwe data.
      traceSector("retained_lap_dropped", {
        scope: context,
        car: carRef(o.id),
        lap: cached?.lap ?? null,
        detail: {
          reason: invalidatedCachedLap ? "invalidated"
            : cachedLapMarkedInvalid ? "lap_marked_invalid"
              : cachedLapIsShortArtifact ? "short_artifact"
                : "lap_counter_back",
          retained: cached?.seconds.length ?? 0,
          observed_count: observedCount,
        },
      });
      laps.delete(o.id);
      continue;
    }

    // De live sectorstand is per sector nieuwer; bewaar hem als volledige
    // ronde zodat een tijdelijke lege stand de rij niet leegmaakt.
    const timing = live.get(o.id);
    const liveSectors = liveLap(timing);
    if (timing && !liveSectors) {
      traceSector("live_partial_composed", {
        scope: context,
        car: carRef(o.id),
        lap: timing.lap,
        detail: {
          slots: timing.slots.filter((slot) => slot?.seconds != null && slot.status !== "invalidated").length,
          count: timing.sectorCount,
          mixed_laps: timing.mixedLaps,
          status: timing.status,
        },
      });
    }
    const liveLapInvalidated = liveSectors != null
      && [...invalidatedCells].some((key) => key.startsWith(`${liveSectors.lap}:`));
    if (liveSectors && !liveLapInvalidated && newerThan({ lap: liveSectors.lap, observedSessionTime: clock }, cached)) {
      laps.set(o.id, { seconds: liveSectors.seconds, lap: liveSectors.lap, observedSessionTime: clock, observedAtMs: nowMs });
      continue;
    }

    const completedLapResult = completedLap(input, o.id, o.lap, o.lastLapSeconds);
    if (!completedLapResult) continue;
    // Een expliciet ongeldig verklaarde ronde komt niet terug via een oudere
    // meting die dezelfde ronde nog als geldig in zijn slot heeft.
    if ([...invalidatedCells].some((key) => key.startsWith(`${completedLapResult.lap}:`))) continue;
    const observed = metrics?.observedSessionTimeSeconds ?? clock ?? null;
    if (newerThan({ lap: completedLapResult.lap, observedSessionTime: observed }, cached)) {
      laps.set(o.id, {
        seconds: completedLapResult.seconds,
        lap: completedLapResult.lap,
        observedSessionTime: observed,
        observedAtMs: nowMs,
      });
    }
  }

  // Zacht begrensd: maximaal 40 auto's, elk met de bestaande 1–16 sectorlayout.
  while (laps.size > 40) laps.delete(laps.keys().next().value!);
  for (const [id, entry] of laps) {
    if (entry.seconds.length < 1 || entry.seconds.length > 16) laps.delete(id);
  }

  const count = observedCount >= 1 && observedCount <= 16
    ? observedCount
    : reset ? 0 : previous?.count ?? 0;

  return {
    input,
    lastInput: input,
    context,
    identity: reset ? identity : mergeIdentity(previous?.identity ?? null, identity),
    segment: segment ?? (reset ? null : previous?.segment ?? null),
    clock,
    count,
    laps,
    invalidated,
    stale: !history || opponents.every(o => rowSectors(input, o.id, o.lastLapSeconds) == null && !persistedMetrics(input, o.id)),
  };
}

/**
 * Alleen weergave-retentie. De cache wordt nooit als live sectorupdate, als
 * actuele rondetijd of als bewijs gebruikt. Een identiteitswissel, een
 * sessierestart, een andere sectordeling, een lagere ronde of een expliciete
 * ongeldigheid van precies die ronde wist hem; een ontbrekende of sparse poll
 * niet.
 *
 * Er is bewust geen tijdsgebonden verval: de connector levert met een vol veld
 * maar enkele metingen per frame, dus een auto kan tientallen seconden geen
 * nieuwe reeks hebben zonder dat de oude onwaar wordt. De waarde blijft staan
 * met ronde-identiteit en wordt gedimd zodra zij niet meer de laatste
 * afgeronde ronde is.
 */
export function useRetainedLapSectors(input: State["input"], context = ""): State {
  const [state, setState] = useState<State>(() => update(null, input, context));
  if (state.input === input && state.context === context) return state;
  const next = update(state, input, context);
  setState(next);
  return next;
}
