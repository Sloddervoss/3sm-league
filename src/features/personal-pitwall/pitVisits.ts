/**
 * Persoonlijke pitduur: bruto pit-in → pit-uit.
 *
 * De bron is een paar expliciete connectorflanken (`pit_in`/`pit_out`) met
 * eigen observed_at, sessietijd en SDK-tick. Dit is bewust géén netto
 * raceverlies en géén servicekostenpost. De waarde wordt nooit door
 * `computePitLoss` of de strategie-adviesketen gebruikt; de strategie toont
 * hem uitsluitend als aparte laatste-stop-benchmark.
 */
export type PersonalPitVisit = {
  visitKey: string;
  pitLaneSeconds: number;
  entryObservedAt: string | null;
  exitObservedAt: string | null;
  entrySessionSeconds: number | null;
  exitSessionSeconds: number | null;
  source: string;
};

export type PersonalPitDiagnostics = {
  pendingEdges: number;
  rejectedEdges: number;
  lastRejectReason: string | null;
};

export type PersonalPitFeed = {
  available: boolean;
  reason: string | null;
  sessionKey: string | null;
  visits: PersonalPitVisit[];
  diagnostics: PersonalPitDiagnostics;
};

export const EMPTY_PIT_DIAGNOSTICS: PersonalPitDiagnostics = { pendingEdges: 0, rejectedEdges: 0, lastRejectReason: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

const instant = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 40) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
};

/**
 * Valideert de RPC-uitkomst. Een misvormde stop wordt overgeslagen, niet
 * omgezet in een gok. Een duur buiten 5–900 s is geen meting en valt af.
 */
export function parsePersonalPitVisits(value: unknown): PersonalPitFeed {
  if (!isRecord(value)) {
    return { available: false, reason: "invalid", sessionKey: null, visits: [], diagnostics: EMPTY_PIT_DIAGNOSTICS };
  }
  const raw = Array.isArray(value.visits) ? value.visits : [];
  const visits: PersonalPitVisit[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!isRecord(item)) continue;
    const seconds = finite(item.pitLaneSeconds);
    if (seconds == null || seconds < 5 || seconds > 900) continue;
    const visitKey = text(item.visitKey, 80);
    if (visitKey == null) continue;
    const entrySessionSeconds = finite(item.entrySessionSeconds);
    const exitSessionSeconds = finite(item.exitSessionSeconds);
    if (entrySessionSeconds == null || exitSessionSeconds == null || exitSessionSeconds <= entrySessionSeconds) continue;
    visits.push({
      visitKey,
      pitLaneSeconds: Math.round(seconds * 1000) / 1000,
      entryObservedAt: instant(item.entryObservedAt),
      exitObservedAt: instant(item.exitObservedAt),
      entrySessionSeconds,
      exitSessionSeconds,
      source: text(item.source, 40) ?? "unknown",
    });
  }
  const diagnosticsRaw = isRecord(value.diagnostics) ? value.diagnostics : null;
  const diagnostics: PersonalPitDiagnostics = {
    pendingEdges: finite(diagnosticsRaw?.pendingEdges) ?? 0,
    rejectedEdges: finite(diagnosticsRaw?.rejectedEdges) ?? 0,
    lastRejectReason: text(diagnosticsRaw?.lastRejectReason, 80),
  };
  const sessionKey = text(value.sessionKey, 120);
  const available = value.available === true && visits.length > 0;
  const reason = available ? null : text(value.reason, 40) ?? (visits.length === 0 ? "no_completed_visit" : "invalid");
  return { available, reason, sessionKey, visits, diagnostics };
}

/** `47.312 s` of `1:02.450`; onbekend blijft een streepje. */
export function formatPitDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(3)} s`;
  const whole = Math.floor(seconds);
  const rest = seconds - whole;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.round(rest * 1000).toString().padStart(3, "0")}`;
}

export const PIT_DURATION_SEMANTICS = "Bruto pitstraattijd, service inbegrepen. Geen netto raceverlies.";
export const PIT_BENCHMARK_SEMANTICS = "Laatste gemeten stop · bruto benchmark · niet in het strategiemodel.";
