/**
 * Plugin 0.8 — de twee meetreeksen van het frame naar de database-RPC.
 *
 * Waarom dit een eigen, importvrij bestand is: de Edge moet kunnen terugvallen
 * als de database nog de oude functie heeft. Deze module bevat die beslissing als
 * pure functies, zodat hij zonder Deno, ilovesupabase of netwerk te testen is.
 *
 * De regel die hieronder hard is: een 0.8-Edge mag NOOIT afhankelijk zijn van de
 * nieuwe signatuur. Vindt de RPC de acht-argumentversie niet (42883/PGRST202),
 * dan gaat hetzelfde frame alsnog met vijf argumenten weg en blijven de
 * meetreeksen in de logboeken staan. Een gemiste ronde is erger dan niets, maar
 * een verloren frame is erger dan een gemiste ronde.
 */
import type { NormalizedTelemetryEnvelope } from "./simhub.ts";

export type AggregateBatch = {
  events: unknown[];
  laps: unknown[];
};

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
 * Bouwt de RPC-argumenten. `withAggregates` is false zodra deze isolate heeft
 * gemerkt dat de database de nieuwe signatuur niet heeft: daarna blijven we bij
 * de vijf basisargumenten in plaats van elk frame opnieuw te falen.
 */
export const persistArguments = (
  base: Record<string, unknown>,
  batch: AggregateBatch | null,
  withAggregates: boolean,
): Record<string, unknown> => {
  if (!batch || !withAggregates) return base;
  return { ...base, p_events: batch.events, p_laps: batch.laps };
};
