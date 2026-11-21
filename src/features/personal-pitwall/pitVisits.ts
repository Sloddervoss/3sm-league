/**
 * Persoonlijke pitduur: bruto pit-in → pit-uit.
 *
 * Dit is bewust géén netto raceverlies en géén servicekostenpost. De waarde
 * komt uit de bron-tijdstempels van de pitflanken (sessietijd) en wordt nooit
 * gebruikt door `computePitLoss` of de strategie-adviesketen.
 */
export type PersonalPitVisit = {
  visitKey: string;
  pitLaneSeconds: number;
  entryLap: number | null;
  exitLap: number | null;
  driver: string | null;
  source: string;
};

export type PersonalPitFeed = {
  available: boolean;
  reason: string | null;
  sessionKey: string | null;
  visits: PersonalPitVisit[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const lap = (value: unknown): number | null => {
  const number = finite(value);
  return number != null && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : null;
};

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/**
 * Valideert de RPC-uitkomst. Een misvormde stop wordt overgeslagen, niet
 * omgezet in een gok. Een duur buiten 5–900 s is geen meting en valt af.
 */
export function parsePersonalPitVisits(value: unknown): PersonalPitFeed {
  if (!isRecord(value)) return { available: false, reason: "invalid", sessionKey: null, visits: [] };
  const raw = Array.isArray(value.visits) ? value.visits : [];
  const visits: PersonalPitVisit[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!isRecord(item)) continue;
    const seconds = finite(item.pitLaneSeconds);
    if (seconds == null || seconds < 5 || seconds > 900) continue;
    const visitKey = text(item.visitKey, 80);
    if (visitKey == null) continue;
    visits.push({
      visitKey,
      pitLaneSeconds: Math.round(seconds * 1000) / 1000,
      entryLap: lap(item.entryLap),
      exitLap: lap(item.exitLap),
      driver: text(item.driver, 120),
      source: text(item.source, 40) ?? "unknown",
    });
  }
  const sessionKey = text(value.sessionKey, 120);
  const available = value.available === true && visits.length > 0;
  const reason = available ? null : text(value.reason, 40) ?? (visits.length === 0 ? "no_completed_visit" : "invalid");
  return { available, reason, sessionKey, visits };
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
