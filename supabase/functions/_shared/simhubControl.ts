/**
 * Plugin 0.8 — de onderhandeling over connectorinstellingen, als pure logica.
 *
 * De brief (paragraaf 3) vraagt om een kleine handshake, geen dynamische plugin:
 * de connector meldt wat hij kan, de server antwoordt met frequenties, een
 * payloadbudget, welke features aan staan en welk updatebeleid geldt. Deze module
 * bevat de serverkant daarvan plus de fallback die een client hoort te gebruiken
 * als het endpoint ontbreekt of faalt.
 *
 * Twee regels die hier worden afgedwongen:
 *   1. Een onbereikbaar of kapot control-endpoint verandert NIETS aan de
 *      bestaande routes. De client valt terug op het vaste V3-basisprofiel en op
 *      zijn eigen lokale defaults; hij gaat niet proberen nieuwe rootkeys te
 *      sturen in de hoop dat ze genegeerd worden.
 *   2. Er komt nooit een uitvoerbare formule, SDK-kanaalnaam of downloadpad uit
 *      deze module. Wat er niet in staat, kan een client ook niet uitvoeren.
 *
 * Geen Deno- of npm-imports: testbaar met vitest en met `deno test`.
 */

/**
 * De grenzen van deze module zijn de grenzen van de INGEST, niet die van de
 * plugin. Een configuratie die hier door komt, moet de ingest ook doorstaan;
 * anders publiceert control beleid dat bij het eerste frame 429 of 413 geeft.
 *
 *   sendIntervalMs  >= 400  = de rate-limit in simhub_persist_v3
 *   payloadBudget   <= 24576 = de bodylimiet van readBoundedJson in simhub.ts
 *
 * De SQL-kant heeft dezelfde getallen in
 * simhub_connector_config_send_interval_range en _payload_budget_range, en
 * plugin08_review_repairs.sql controleert dat de 400 ms in de functiebody
 * dezelfde is als de constraint.
 */
export const MinSendIntervalMs = 400;
export const MaxSendIntervalMs = 10000;
export const MinSampleHz = 1;
export const MaxSampleHz = 50;
export const MinPayloadBudgetBytes = 4096;
export const MaxPayloadBudgetBytes = 24576;
/** De bodylimiet van de ingest; hetzelfde getal als readBoundedJson. */
export const IngestMaxBodyBytes = 24576;
/** De minimale tijd tussen twee frames in de ingest (rate-limit). */
export const IngestMinFrameIntervalMs = 400;

/** De schemarevisie die deze server aankan. */
export const ServerSchemaRevision = 1;
/** De protocolversie die deze server voor V3 accepteert. */
export const ServerProtocolVersion = 3;

export type FeatureFlags = Record<string, boolean>;

/**
 * Features die de server mag schakelen. Alles daarbuiten wordt bij het schrijven
 * weggefilterd (zie simhub_connector_config_apply) en hier bij het lezen ook:
 * een onbekende feature is nooit "aan".
 */
export const KnownFeatures = [
  "pitService",
  "wearObservation",
  "lapSummary",
  "directIrSdk",
  "measurementEvents",
  "lapSummaries",
  "environment",
  "opponents",
] as const;

export type ConnectorConfig = {
  configRevision: number;
  sendIntervalMs: number | null;
  sampleHz: number | null;
  payloadBudgetBytes: number | null;
  features: FeatureFlags;
  recommendedMinVersion: string | null;
  updateChannel: string | null;
  maintenanceWindow: Record<string, unknown> | null;
  expiresAt: string | null;
  updatedAt: string | null;
};

/**
 * De ingebouwde defaults. Ze zijn bewust gelijk aan "geen beleid": geen
 * frequentie, geen budget, geen feature aan. De client gebruikt dan zijn eigen
 * lokale grenzen, precies zoals voor 0.8.
 */
export const DefaultConfig: ConnectorConfig = {
  configRevision: 0,
  sendIntervalMs: null,
  sampleHz: null,
  payloadBudgetBytes: null,
  features: {},
  recommendedMinVersion: null,
  updateChannel: null,
  maintenanceWindow: null,
  expiresAt: null,
  updatedAt: null,
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const boundedInt = (value: unknown, min: number, max: number): number | null => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
};

const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

/**
 * Leest de rij van `simhub_connector_config_public()` en begrenst hem opnieuw.
 * De database heeft dezelfde grenzen als CHECK; dit is de tweede, goedkope wacht
 * zodat een verkeerd geschreven rij nooit als beleid bij een client belandt.
 */
export const parseConfigRow = (value: unknown): ConnectorConfig => {
  const row = asRecord(value);
  if (!row) return { ...DefaultConfig };

  const featuresIn = asRecord(row.features) ?? {};
  const features: FeatureFlags = {};
  for (const key of KnownFeatures) {
    if (featuresIn[key] === true || featuresIn[key] === false) features[key] = featuresIn[key] as boolean;
  }

  const expiresAt = boundedText(row.expires_at ?? row.expiresAt, 40);

  return {
    configRevision: boundedInt(row.config_revision ?? row.configRevision, 1, 2147483647) ?? 0,
    sendIntervalMs: boundedInt(row.send_interval_ms ?? row.sendIntervalMs, MinSendIntervalMs, MaxSendIntervalMs),
    sampleHz: boundedInt(row.sample_hz ?? row.sampleHz, MinSampleHz, MaxSampleHz),
    payloadBudgetBytes: boundedInt(
      row.payload_budget_bytes ?? row.payloadBudgetBytes,
      MinPayloadBudgetBytes,
      MaxPayloadBudgetBytes,
    ),
    features,
    recommendedMinVersion: boundedText(row.recommended_min_version ?? row.recommendedMinVersion, 60),
    updateChannel: boundedText(row.update_channel ?? row.updateChannel, 16),
    maintenanceWindow: asRecord(row.maintenance_window ?? row.maintenanceWindow),
    expiresAt: expiresAt && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null,
    updatedAt: boundedText(row.updated_at ?? row.updatedAt, 40),
  };
};

/** Is de configuratie verlopen? Dan geldt hij niet en gelden de defaults. */
export const isExpired = (config: ConnectorConfig, now: Date = new Date()): boolean => {
  if (!config.expiresAt) return false;
  const at = Date.parse(config.expiresAt);
  return Number.isFinite(at) && at <= now.getTime();
};

// ---------------------------------------------------------------------------
// Wat de connector meldt
// ---------------------------------------------------------------------------

export type NegotiationRequest = {
  /** Protocolversies die de connector kan, bijvoorbeeld [3]. */
  protocolVersions: number[];
  /** Schemarevisies die de connector kan. */
  schemaRevisions: number[];
  connectorVersion: string | null;
  /** Lokale bovengrenzen van de connector; de server gaat daar nooit boven. */
  limits?: {
    minSendIntervalMs?: number | null;
    maxSampleHz?: number | null;
    maxPayloadBytes?: number | null;
  } | null;
};

export const parseNegotiationRequest = (value: unknown): NegotiationRequest | null => {
  const body = asRecord(value);
  if (!body) return null;
  const numbers = (input: unknown, max: number): number[] => Array.isArray(input)
    ? input.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry <= max)
    : [];
  const limits = asRecord(body.limits);
  return {
    protocolVersions: numbers(body.protocolVersions, 1000),
    schemaRevisions: numbers(body.schemaRevisions, 1000),
    connectorVersion: boundedText(body.connectorVersion, 60),
    limits: limits ? {
      minSendIntervalMs: boundedInt(limits.minSendIntervalMs, 1, MaxSendIntervalMs),
      maxSampleHz: boundedInt(limits.maxSampleHz, 1, MaxSampleHz),
      maxPayloadBytes: boundedInt(limits.maxPayloadBytes, 1, MaxPayloadBudgetBytes),
    } : null,
  };
};

// ---------------------------------------------------------------------------
// Het antwoord
// ---------------------------------------------------------------------------

export type Negotiation = {
  /**
   * `negotiated`: de server heeft geantwoord en de client mag de aangeboden
   * features gebruiken. `compat`: geen bruikbaar antwoord; alleen het vaste
   * V3-basisprofiel, geen nieuwe rootkeys.
   */
  mode: "negotiated" | "compat";
  reason: string | null;
  protocolVersion: number;
  schemaRevision: number;
  configRevision: number;
  sendIntervalMs: number | null;
  sampleHz: number | null;
  payloadBudgetBytes: number | null;
  features: FeatureFlags;
  recommendedMinVersion: string | null;
  updateChannel: string | null;
  maintenanceWindow: Record<string, unknown> | null;
  expiresAt: string | null;
};

/**
 * Het vaste basisprofiel: precies wat een 0.7.x-connector al verstuurt. Dit is
 * wat een client gebruikt als het control-endpoint ontbreekt, 404 geeft, 5xx
 * geeft of te langzaam antwoordt. Er zitten geen nieuwe rootkeys in.
 */
export const compatProfile = (reason: string): Negotiation => ({
  mode: "compat",
  reason,
  protocolVersion: ServerProtocolVersion,
  schemaRevision: ServerSchemaRevision,
  configRevision: 0,
  sendIntervalMs: null,
  sampleHz: null,
  payloadBudgetBytes: null,
  features: {},
  recommendedMinVersion: null,
  updateChannel: null,
  maintenanceWindow: null,
  expiresAt: null,
});

export type ControlFetchResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error?: string };

/**
 * De kern van de terugvalregel. Een client die dit gebruikt, kan niets breken:
 * bij welk falen dan ook komt er `compat` uit, en dat betekent "stuur exact wat
 * je vóór 0.8 stuurde".
 */
export const resolveControl = (
  result: ControlFetchResult,
  now: Date = new Date(),
): Negotiation => {
  if (!result.ok) return compatProfile(`control_http_${result.status}`);
  const body = asRecord(result.body);
  if (!body) return compatProfile("control_invalid_body");

  const config = parseConfigRow(body.config ?? body);
  if (config.configRevision === 0) return compatProfile("control_no_config");
  if (isExpired(config, now)) return compatProfile("control_expired");

  return {
    mode: "negotiated",
    reason: null,
    protocolVersion: ServerProtocolVersion,
    schemaRevision: ServerSchemaRevision,
    configRevision: config.configRevision,
    sendIntervalMs: config.sendIntervalMs,
    sampleHz: config.sampleHz,
    payloadBudgetBytes: config.payloadBudgetBytes,
    features: config.features,
    recommendedMinVersion: config.recommendedMinVersion,
    updateChannel: config.updateChannel,
    maintenanceWindow: config.maintenanceWindow,
    expiresAt: config.expiresAt,
  };
};

/**
 * Past het serverbeleid toe binnen de lokale grenzen van de connector. De
 * uitkomst is nooit ruimer dan wat de connector zelf aankan, en nooit ruimer dan
 * wat de server toestaat.
 */
export const applyLocalLimits = (
  negotiation: Negotiation,
  request: NegotiationRequest | null,
): Negotiation => {
  if (negotiation.mode !== "negotiated" || !request?.limits) return negotiation;
  const out = { ...negotiation };
  const { minSendIntervalMs, maxSampleHz, maxPayloadBytes } = request.limits;
  if (out.sendIntervalMs !== null && minSendIntervalMs && out.sendIntervalMs < minSendIntervalMs) {
    out.sendIntervalMs = minSendIntervalMs;
  }
  if (out.sampleHz !== null && maxSampleHz && out.sampleHz > maxSampleHz) {
    out.sampleHz = maxSampleHz;
  }
  if (out.payloadBudgetBytes !== null && maxPayloadBytes && out.payloadBudgetBytes > maxPayloadBytes) {
    out.payloadBudgetBytes = maxPayloadBytes;
  }
  // De server mag een feature niet AANzetten die de connector niet meldt.
  if (request.schemaRevisions.length && !request.schemaRevisions.includes(ServerSchemaRevision)) {
    out.schemaRevision = Math.min(...request.schemaRevisions);
  }
  return out;
};

/**
 * Welke uitbreidingen de server in dit antwoord accepteert. Een feature die niet
 * expliciet aan staat, staat hier niet in — en een client hoort dan ook geen
 * bijbehorend blok te sturen.
 */
export const acceptedExtensions = (negotiation: Negotiation): string[] =>
  negotiation.mode === "negotiated"
    ? KnownFeatures.filter((feature) => negotiation.features[feature] === true)
    : [];
