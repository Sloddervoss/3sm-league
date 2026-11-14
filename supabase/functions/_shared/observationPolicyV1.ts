/**
 * S2E2 — minimale Edge-composer voor het optionele `observation.policy`-feit.
 *
 * De bron van waarheid is de databasefunctie
 * `public.simhub_observation_policy_v1(p_token_hash)`. Die leidt de owner af
 * uit de al gevalideerde device-tokenbinding en het bestaande
 * `pitwall_learning.account_policy`. Deze module:
 *
 * - doet niets en roept niets aan zolang de ontvanger niet `on` is;
 * - gebruikt uitsluitend de tokenhash die de Edge-route al voor deze aanvraag
 *   berekende (nooit een owner of hash uit de body);
 * - doet hooguit één begrensde lookup per geaccepteerd antwoord;
 * - geeft bij elke fout/ontbrekende RPC/timeout/malformaat `undefined` terug,
 *   zodat de bestaande geaccepteerde 202 en ACK byte-vormig gelijk blijven;
 * - publiceert nooit meer dan `captureAllowed` en `policyVersion`;
 * - cachet niets (geen isolate- of globaal geheugen van accountrechten).
 */

export const ObservationPolicyRpc = "simhub_observation_policy_v1";

/** Bovengrens op één policy-lookup; daarna valt de 202 terug op "geen policy". */
export const ObservationPolicyTimeoutMs = 750;

/** Exact de vorm die de database accepteert: lowercase SHA-256, 64 tekens. */
export const ObservationTokenHashPattern = /^[0-9a-f]{64}$/;

/**
 * S2E5: de additieve kolom die `simhub_persist_v3` sinds de policy-in-persist-
 * migratie teruggeeft. De naam staat hier één keer, zodat de Edge en de tests
 * niet uit elkaar kunnen lopen.
 */
export const ObservationPolicyField = "observation_policy";

export type ObservationPolicyV1 = {
  captureAllowed: boolean;
  policyVersion: number | null;
};

type RpcResult = { data: unknown; error: unknown };

export type ObservationPolicyRpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => RpcResult | PromiseLike<RpcResult>;

const deny = (): ObservationPolicyV1 => ({
  captureAllowed: false,
  policyVersion: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Leest alleen het contract: `captureAllowed` moet een echte JSON-boolean zijn
 * en een allow vereist een positief, integraal `policyVersion`. Extra velden
 * worden genegeerd en dus nooit doorgegeven (geen owner/token/hash-lek).
 */
export const readObservationPolicy = (
  value: unknown,
): ObservationPolicyV1 | undefined => {
  let root = value;
  if (Array.isArray(root)) {
    if (root.length !== 1) return undefined;
    root = root[0];
  }
  if (!isRecord(root)) return undefined;

  const allowed = root.captureAllowed;
  if (typeof allowed !== "boolean") return undefined;
  if (!allowed) return deny();

  const version = root.policyVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    // Een allow zonder geldige versie is geen publiceerbaar feit.
    return undefined;
  }
  return { captureAllowed: true, policyVersion: version };
};

const timeoutMarker = Symbol("observation-policy-timeout");

const withTimeout = async <T>(
  pending: PromiseLike<T>,
  timeoutMs: number,
): Promise<T | typeof timeoutMarker> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return timeoutMarker;
  let timer: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(pending),
      new Promise<typeof timeoutMarker>((resolve) => {
        timer = setTimeout(() => resolve(timeoutMarker), timeoutMs) as
          unknown as number;
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Eén begrensde lookup. Elke fout is `undefined`: de aanroeper laat het
 * policyveld dan weg en de geaccepteerde telemetrie verandert niet.
 */
export const composeObservationPolicy = async (
  tokenHash: string,
  rpc: ObservationPolicyRpcFn,
  timeoutMs: number = ObservationPolicyTimeoutMs,
): Promise<ObservationPolicyV1 | undefined> => {
  if (!ObservationTokenHashPattern.test(tokenHash)) return undefined;
  try {
    const outcome = await withTimeout(
      Promise.resolve(rpc(ObservationPolicyRpc, { p_token_hash: tokenHash })),
      timeoutMs,
    );
    if (outcome === timeoutMarker) return undefined;
    if (!outcome || outcome.error) return undefined;
    return readObservationPolicy(outcome.data);
  } catch {
    return undefined;
  }
};

/**
 * De enige ingang voor de Edge-route. `mode` komt uit de bestaande
 * observation-capability; alles behalve `on` betekent nul RPC's en geen veld.
 */
export const maybeComposeObservationPolicy = async (
  mode: string,
  tokenHash: string,
  rpc: ObservationPolicyRpcFn,
  timeoutMs: number = ObservationPolicyTimeoutMs,
): Promise<ObservationPolicyV1 | undefined> => {
  if (mode !== "on") return undefined;
  return await composeObservationPolicy(tokenHash, rpc, timeoutMs);
};

/**
 * S2E5 — het policyfeit uit hetzelfde persist-resultaat.
 *
 * `present` onderscheidt twee dingen die op het eerste gezicht hetzelfde
 * lijken:
 *   * het veld ontbreekt volledig -> deze database heeft de additieve migratie
 *     niet; de aanroeper mag de bestaande, begrensde losse lookup gebruiken
 *     (uitrolvolgorde is dan niet fragiel);
 *   * het veld bestaat maar is null/onbruikbaar -> de leesactie in de database
 *     is fail-closed mislukt; dan publiceren we niets en doen we ook geen
 *     tweede hop. Stilzwijgend alsnog een tweede RPC doen zou de oude hop
 *     terugbrengen op precies het pad dat we wilden verwijderen.
 */
export type PersistedObservationPolicy = {
  present: boolean;
  policy: ObservationPolicyV1 | undefined;
};

export const readPersistedObservationPolicy = (
  row: unknown,
): PersistedObservationPolicy => {
  if (!isRecord(row) || !Object.hasOwn(row, ObservationPolicyField)) {
    return { present: false, policy: undefined };
  }
  return { present: true, policy: readObservationPolicy(row[ObservationPolicyField]) };
};

/**
 * De enige ingang voor het geaccepteerde 202-pad van de V3-route.
 *
 * - mode !== "on": niets doen, niets lezen, geen RPC (default off).
 * - veld aanwezig: gebruik het feit uit dezelfde transactie; geen extra hop.
 * - veld afwezig: val terug op de bestaande begrensde lookup (750ms).
 */
export const resolveObservationPolicy = async (
  mode: string,
  row: unknown,
  tokenHash: string,
  rpc: ObservationPolicyRpcFn,
  timeoutMs: number = ObservationPolicyTimeoutMs,
): Promise<ObservationPolicyV1 | undefined> => {
  if (mode !== "on") return undefined;
  const persisted = readPersistedObservationPolicy(row);
  if (persisted.present) return persisted.policy;
  return await composeObservationPolicy(tokenHash, rpc, timeoutMs);
};
