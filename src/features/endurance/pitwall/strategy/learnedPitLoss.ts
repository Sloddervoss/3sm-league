/**
 * Het geleerde pitverlies van deze auto op deze baan.
 *
 * De pitstraattijd die de pitwall al toont is een bruto mediaan: er zit service
 * in en er zit het stuk baan in dat je toch had gereden. Wat een stop écht
 * kost, is die tijd min de stretch — de rijtijd over precies dat stuk baan op
 * racetempo. Die stretch leert de connector op groene ronden, de server neemt de
 * mediaan, en dit bestand is alleen de vertaling naar het scherm.
 *
 * Onder drie metingen zegt de server `insufficient` en tonen we niets: een halve
 * meting is geen verlies.
 */

export type LearnedPitLossSource = "personal" | "insufficient" | "none" | "unauthenticated" | "missing_context";

export interface LearnedPitLoss {
  source: LearnedPitLossSource;
  samples: number;
  laneSeconds: number | null;
  standingSeconds: number | null;
  stretchSeconds: number | null;
  lossSeconds: number | null;
  /** Mediaan over race-stops van leden die delen toestaan; altijd apart gehouden. */
  circuit: CircuitPitLoss | null;
}

export interface CircuitPitLoss {
  source: "circuit" | "none";
  samples: number;
  laneSeconds: number | null;
  standingSeconds: number | null;
  stretchSeconds: number | null;
  lossSeconds: number | null;
}

/** Wat de pitwall toont: eigen meting gaat vóór, circuit is een startwaarde. */
export interface PitLossDisplay {
  kind: "personal" | "circuit";
  seconds: number;
  samples: number;
}

export interface PitLossScope {
  car: string | null;
  track: string | null;
  config: string | null;
}

export interface PitLossRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Alleen `personal` met een echt verlies is een getal op het scherm. */
export function mapLearnedPitLoss(raw: unknown): LearnedPitLoss | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const source = record.source;
  if (source !== "personal" && source !== "insufficient" && source !== "none"
    && source !== "unauthenticated" && source !== "missing_context") return null;
  const samples = num(record.samples) ?? 0;
  if (samples < 0 || !Number.isInteger(samples)) return null;
  const loss = num(record.lossSeconds);
  if (source === "personal" && (loss === null || loss < 0)) return null;
  return {
    source,
    samples,
    laneSeconds: num(record.laneSeconds),
    standingSeconds: num(record.standingSeconds),
    stretchSeconds: num(record.stretchSeconds),
    lossSeconds: source === "personal" ? loss : null,
    circuit: mapCircuitPitLoss(record.circuit),
  };
}

export function mapCircuitPitLoss(raw: unknown): CircuitPitLoss | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const samples = num(record.samples) ?? 0;
  if (!Number.isInteger(samples) || samples < 0) return null;
  const loss = num(record.lossSeconds);
  const source = record.source === "circuit" && loss !== null && loss >= 0 ? "circuit" : "none";
  return {
    source,
    samples,
    laneSeconds: num(record.laneSeconds),
    standingSeconds: num(record.standingSeconds),
    stretchSeconds: num(record.stretchSeconds),
    lossSeconds: source === "circuit" ? loss : null,
  };
}

/**
 * Eén regel in het blok. Eigen meting wint altijd; het circuitgetal vult alleen
 * de leegte en wordt nooit als eigen meting gepresenteerd.
 */
export function pickPitLossDisplay(value: LearnedPitLoss | null | undefined): PitLossDisplay | null {
  if (value == null) return null;
  if (value.source === "personal" && value.lossSeconds != null) {
    return { kind: "personal", seconds: value.lossSeconds, samples: value.samples };
  }
  const circuit = value.circuit;
  if (circuit?.source === "circuit" && circuit.lossSeconds != null) {
    return { kind: "circuit", seconds: circuit.lossSeconds, samples: circuit.samples };
  }
  return null;
}

export function hasLearnedLoss(value: LearnedPitLoss | null | undefined): value is LearnedPitLoss {
  return value != null && value.source === "personal" && value.lossSeconds != null;
}

export async function loadLearnedPitLoss(client: PitLossRpcClient, scope: PitLossScope): Promise<LearnedPitLoss | null> {
  if (!scope.car || !scope.track) return null;
  const { data, error } = await client.rpc("pitwall_pit_loss_learned_v1", {
    p_car: scope.car,
    p_track: scope.track,
    p_track_config: scope.config ?? "",
  });
  if (error) return null;
  return mapLearnedPitLoss(data);
}
