/**
 * Plugin 0.7.2.0 — de twee meetreeksen van het frame naar de database-RPC.
 *
 * Drie verantwoordelijkheden, alle drie als pure functies zodat ze zonder Deno,
 * Supabase of netwerk te testen zijn:
 *
 *   1. `aggregateBatch` — welke reeksen gaan mee als RPC-parameter.
 *   2. `snapshotDto` — het kernframe ZONDER de meetserie, want dat is wat in
 *      `simhub_telemetry_latest.v3_normalized` belandt en die snapshot is
 *      browserleesbaar. Meetreeksen horen in hun eigen, afgeschermde tabellen.
 *   3. `mergeMeasurementAck` — het antwoord per rij dat de connector terugkrijgt
 *      (geaccepteerd, duplicaat, superseded, afgekeurd met reden). Een frame-ACK
 *      alleen is geen leveringsbewijs: een outbox die daarop opruimt, verliest
 *      meetgegevens.
 *
 * Plus de capability-detectie: een database zonder de nieuwe signatuur mag de
 * ingest niet stukmaken, maar die toestand mag ook niet voor altijd blijven
 * hangen. Daarom een TTL met herprobe in plaats van een permanente vlag.
 */
import type { NormalizedTelemetryEnvelope } from "./simhub.ts";
import type { SeriesRejection, SeriesReport } from "./simhubExtensions.ts";

export type AggregateBatch = {
  events: unknown[];
  laps: unknown[];
};

/** Hoe lang een "de database kent de signatuur niet" geldig blijft. */
export const AggregatesRetryMs = 60_000;

/**
 * De reeksen die de parser heeft goedgekeurd, of null als er niets te sturen is.
 * Beide leeg betekent: geen extra argumenten, dus exact de oude aanroep.
 */
export const aggregateBatch = (normalized: NormalizedTelemetryEnvelope): AggregateBatch | null => {
  const events = normalized.measurementEvents ?? null;
  const laps = normalized.lapSummaries ?? null;
  const hasEvents = Array.isArray(events) && events.length > 0;
  const hasLaps = Array.isArray(laps) && laps.length > 0;
  if (!hasEvents && !hasLaps) return null;
  return {
    events: hasEvents ? events : [],
    laps: hasLaps ? laps : [],
  };
};

/**
 * Het kernframe zonder de meetserie en zonder het parserrapport.
 *
 * Waarom dit een eigen functie is en niet een `delete` op het object: dezelfde
 * DTO gaat ook naar de rest van de ingest (tegenstanders, context), dus het
 * origineel mag niet veranderen. En de sleutels moeten op één plek benoemd
 * staan, anders voegt iemand er ooit een derde meetsleutel aan toe die vergeten
 * wordt.
 */
export const MeasurementSnapshotKeys = ["measurementEvents", "lapSummaries", "measurementReport"] as const;

export const snapshotDto = (normalized: NormalizedTelemetryEnvelope): Record<string, unknown> => {
  const core = { ...(normalized as unknown as Record<string, unknown>) };
  for (const key of MeasurementSnapshotKeys) delete core[key];
  return core;
};

type MaybeError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined;

/**
 * Is deze fout "de functie bestaat niet in deze vorm"?
 *
 * PostgREST geeft PGRST202 ("Could not find the function ... in the schema
 * cache") bij een onbekende signatuur; de Postgres-foutcode is 42883. Beide
 * betekenen hetzelfde voor ons: de database heeft nog de vijf- of
 * zes-argumentversie, dus de meetreeksen kunnen er niet bij.
 */
export const isMissingFunctionError = (error: MaybeError): boolean => {
  if (!error) return false;
  const code = (error.code ?? "").toString().toUpperCase();
  if (code === "42883" || code === "PGRST202") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("could not find the function")
    || text.includes("function public.simhub_persist_v3")
    && text.includes("does not exist");
};

/**
 * Bouwt de RPC-argumenten. `withAggregates` is false zolang deze isolate denkt
 * dat de database de nieuwe signatuur niet heeft: dan blijven we bij de vijf
 * basisargumenten in plaats van elk frame opnieuw te falen.
 */
export const persistArguments = (
  base: Record<string, unknown>,
  batch: AggregateBatch | null,
  withAggregates: boolean,
): Record<string, unknown> => {
  if (!batch || !withAggregates) return base;
  return { ...base, p_events: batch.events, p_laps: batch.laps };
};

// ---------------------------------------------------------------------------
// Capability: herstelbaar in plaats van permanent uit
// ---------------------------------------------------------------------------

export type AggregatesCapability = {
  /** Mag deze isolate de achtargumentversie proberen? */
  supported: boolean;
  /** Wanneer de laatste mislukking is vastgesteld (epoch ms). */
  checkedAt: number;
  /** Reden van de laatste mislukking; null als alles werkt. */
  reason: string | null;
};

export const initialCapability = (now = 0): AggregatesCapability => ({
  supported: true,
  checkedAt: now,
  reason: null,
});

/**
 * Mag er nu een poging met meetreeksen gedaan worden?
 *
 * Na een 42883/PGRST202 is `supported` false, maar na `AggregatesRetryMs` wordt
 * het opnieuw geprobeerd. Zonder dat zou één schema-cachefout de aggregaten voor
 * de hele levensduur van een Edge-isolate uitschakelen en zou een later
 * toegepaste migratie nooit meer gevonden worden.
 */
export const shouldAttemptAggregates = (state: AggregatesCapability, now: number): boolean =>
  state.supported || now - state.checkedAt >= AggregatesRetryMs;

/** Na een geslaagde opslag (ook na een eerdere mislukking). */
export const afterAggregatesSuccess = (now: number): AggregatesCapability => ({
  supported: true,
  checkedAt: now,
  reason: null,
});

/** Na 42883/PGRST202: onthouden, met tijdstip, zodat er een herprobe komt. */
export const afterMissingFunction = (now: number): AggregatesCapability => ({
  supported: false,
  checkedAt: now,
  reason: "missing_function",
});

/** Wat de client in het antwoord ziet. Nooit stil: een degradatie is zichtbaar. */
export type AggregatesStatus = {
  supported: boolean;
  degraded: boolean;
  reason: string | null;
  retryInMs: number | null;
};

export const capabilityStatus = (state: AggregatesCapability, now: number): AggregatesStatus => ({
  supported: state.supported,
  degraded: !state.supported,
  reason: state.reason,
  retryInMs: state.supported ? null : Math.max(0, AggregatesRetryMs - (now - state.checkedAt)),
});

// ---------------------------------------------------------------------------
// Het ACK-rapport per rij
// ---------------------------------------------------------------------------

export type AckRejection = {
  id: string | null;
  index: number | null;
  reason: string;
  /** Waar de afkeuring vandaan komt: de parser (Edge) of de database. */
  stage: "parser" | "database";
};

export type AckSeries = {
  received: number;
  accepted: string[];
  duplicates: string[];
  superseded: string[];
  rejected: AckRejection[];
  block_error: string | null;
  /** Alleen gevuld als de meetserie niet bij de database aankwam. */
  stored: boolean;
};

export type MeasurementAck = {
  events: AckSeries;
  laps: AckSeries;
};

const emptySeries = (stored: boolean): AckSeries => ({
  received: 0,
  accepted: [],
  duplicates: [],
  superseded: [],
  rejected: [],
  block_error: null,
  stored,
});

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const rejections = (value: unknown, stage: "parser" | "database"): AckRejection[] =>
  Array.isArray(value)
    ? value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : null,
        index: typeof entry.index === "number" ? entry.index : null,
        reason: typeof entry.reason === "string" ? entry.reason : "unknown",
        stage,
      }))
    : [];

/**
 * Voegt het parserrapport en het databaserapport samen tot één antwoord.
 *
 * De database is leidend voor wat er is opgeslagen. Wat de parser al had
 * afgekeurd, is nooit bij de database aangekomen en staat er dus niet in; die
 * rijen worden hier toegevoegd met stage 'parser'. Zonder database-ACK (de
 * terugvalmodus) meldt het antwoord eerlijk dat er niets is opgeslagen.
 */
export const mergeMeasurementAck = (
  parserReport: NormalizedTelemetryEnvelope["measurementReport"],
  dbAck: unknown,
  stored: boolean,
): MeasurementAck => {
  const db = (dbAck && typeof dbAck === "object" ? dbAck : {}) as Record<string, unknown>;
  const dbEvents = (db.events && typeof db.events === "object" ? db.events : {}) as Record<string, unknown>;
  const dbLaps = (db.laps && typeof db.laps === "object" ? db.laps : {}) as Record<string, unknown>;

  const series = (
    dbSide: Record<string, unknown>,
    parser: SeriesReport<unknown> | undefined,
  ): AckSeries => {
    if (!stored) {
      const out = emptySeries(false);
      out.received = parser?.rows.length ?? 0;
      out.block_error = parser?.blockError ?? "aggregates_unsupported";
      out.rejected = (parser?.rejected ?? []).map((entry: SeriesRejection) => ({
        id: entry.id ?? null,
        index: entry.index,
        reason: entry.reason,
        stage: "parser" as const,
      }));
      return out;
    }
    return {
      received: typeof dbSide.received === "number" ? dbSide.received : (parser?.rows.length ?? 0),
      accepted: strings(dbSide.accepted),
      duplicates: strings(dbSide.duplicates),
      superseded: strings(dbSide.superseded),
      rejected: [
        ...(parser?.rejected ?? []).map((entry: SeriesRejection) => ({
          id: entry.id ?? null,
          index: entry.index,
          reason: entry.reason,
          stage: "parser" as const,
        })),
        ...rejections(dbSide.rejected, "database"),
      ],
      block_error: typeof dbSide.block_error === "string" ? dbSide.block_error : (parser?.blockError ?? null),
      stored: true,
    };
  };

  return {
    events: series(dbEvents, parserReport?.events),
    laps: series(dbLaps, parserReport?.laps),
  };
};

/** Is er iets misgegaan dat de connector moet zien? */
export const ackHasRejections = (ack: MeasurementAck): boolean =>
  ack.events.rejected.length > 0 || ack.laps.rejected.length > 0
  || ack.events.block_error !== null || ack.laps.block_error !== null;
