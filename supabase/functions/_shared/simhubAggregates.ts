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

export type AckId = {
  id: string;
  /** De revisie die de database heeft bevestigd. Zonder dit getal is een ACK
   *  bij meerdere revisies van dezelfde UUID niet eenduidig. */
  recordRevision: number | null;
};

export type AckSeries = {
  /** Aangeboden rijen in de oorspronkelijke payload, inclusief parserafwijzingen. */
  received: number;
  accepted: AckId[];
  duplicates: AckId[];
  superseded: AckId[];
  rejected: AckRejection[];
  block_error: string | null;
  /** false = deze reeks is niet duurzaam opgeslagen; een outbox mag hem niet opruimen. */
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

/**
 * Leest de bevestigingen. De database geeft sinds review 2 objecten
 * `{id, record_revision}`. Een kale string wordt nog gelezen (oudere database,
 * zelfde Edge), maar dan is de revisie onbekend en dat staat er als `null` —
 * nooit als "1".
 */
const ackIds = (value: unknown): AckId[] => {
  if (!Array.isArray(value)) return [];
  const out: AckId[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push({ id: entry, recordRevision: null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    const revision = typeof record.record_revision === "number" && Number.isInteger(record.record_revision)
      ? record.record_revision
      : null;
    out.push({ id: record.id, recordRevision: revision });
  }
  return out;
};

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
 * Twee harde regels sinds review 2:
 *
 *   1. Een databaseantwoord met `ok:false` is een fout, ook als het kernframe
 *      geaccepteerd is. Het wordt `stored:false` met de reden als
 *      `block_error`; het mag nooit als `stored:true` met lege uitslagen
 *      doorkomen.
 *   2. Beide kanten beschrijven dezelfde indexruimte: de oorspronkelijke
 *      payload. De database zag alleen de goedgekeurde rijen en nummert die
 *      opnieuw; de Edge vertaalt die index met `acceptedIndexes` terug.
 */
export const mergeMeasurementAck = (
  parserReport: NormalizedTelemetryEnvelope["measurementReport"],
  dbAck: unknown,
  stored: boolean,
): MeasurementAck => {
  const db = (dbAck && typeof dbAck === "object" ? dbAck : {}) as Record<string, unknown>;
  // Een databasefout is geen leeg succes. De reden gaat mee naar de client.
  const dbFailed = db.ok === false;
  const dbError = dbFailed
    ? (typeof db.error === "string" && db.error ? db.error : "measurement_batch_failed")
    : null;
  const storeSucceeded = stored && !dbFailed;
  const dbEvents = (db.events && typeof db.events === "object" ? db.events : {}) as Record<string, unknown>;
  const dbLaps = (db.laps && typeof db.laps === "object" ? db.laps : {}) as Record<string, unknown>;

  const series = (
    dbSide: Record<string, unknown>,
    parser: SeriesReport<unknown> | undefined,
  ): AckSeries => {
    const parserRejected: AckRejection[] = (parser?.rejected ?? []).map((entry: SeriesRejection) => ({
      id: entry.id ?? null,
      index: entry.index,
      reason: entry.reason,
      stage: "parser" as const,
    }));
    // De posities van de goedgekeurde rijen in de oorspronkelijke reeks. Zonder
    // deze vertaling zou een databaseafwijzing op index 1 bij een ingekorte
    // reeks naar de verkeerde rij wijzen.
    const acceptedIndexes = parser?.acceptedIndexes ?? [];
    const mapIndex = (index: number | null): number | null => {
      if (index === null) return null;
      if (!parser) return index;
      return index >= 0 && index < acceptedIndexes.length ? acceptedIndexes[index] : null;
    };

    if (!storeSucceeded) {
      const out = emptySeries(false);
      out.received = parser?.received ?? 0;
      out.block_error = dbError ?? parser?.blockError ?? "aggregates_unsupported";
      out.rejected = parserRejected;
      return out;
    }
    const databaseRejected = rejections(dbSide.rejected, "database")
      .map((entry) => ({ ...entry, index: mapIndex(entry.index) }))
      .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
    return {
      // Het totaal is de aangeboden reeks, niet wat de database na inkorting zag.
      received: parser?.received ?? (typeof dbSide.received === "number" ? dbSide.received : 0),
      accepted: ackIds(dbSide.accepted),
      duplicates: ackIds(dbSide.duplicates),
      superseded: ackIds(dbSide.superseded),
      rejected: [...parserRejected, ...databaseRejected]
        .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER)),
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
  !ack.events.stored || !ack.laps.stored
  || ack.events.rejected.length > 0 || ack.laps.rejected.length > 0
  || ack.events.block_error !== null || ack.laps.block_error !== null;
