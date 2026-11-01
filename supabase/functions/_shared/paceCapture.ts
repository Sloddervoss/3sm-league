/** Nullable, isolated PACE transport; no strategy inputs. Units are explicit. */
export type PaceMetric = {
  id: string; observedSessionTimeSeconds: number;
  lastLapSeconds: number | null; bestLapSeconds: number | null;
  lastLapSectorSeconds: number[] | null; bestLapSectorSeconds: number[] | null;
  bestSectorSeconds: (number | null)[] | null;
  bestLapDeltaToFieldBestSeconds: number | null; bestLapDeltaToPlayerSeconds: number | null;
  lapValid: boolean | null; lapHighPrecision: number | null; trackPositionPercentRaw: number | null;
  sectorMismatchCount: number;
};
export type PaceLap = {id: string; lap: number; seconds: number; observedSessionTimeSeconds: number; quality: "sampled"; observationId: string};
export type PaceChunk = {
  id: string; traceId: string; lap: number; chunkIndex: number; finalChunk: boolean;
  anchorSessionTimeMs: number | null; anchorUncertaintyMs: number | null; lapSeconds: number | null;
  provenance: "simhub-opponent-sampled"; speedUnit: "km/h" | null;
  points: [number, number | null, number | null][];
};
export type PaceCapture = {schemaRevision: 1; observedSessionId: string; segmentId: string; opponentMetrics: PaceMetric[]; opponentLaps: PaceLap[]; traceChunks: PaceChunk[]};
export type PaceTrace = Omit<PaceChunk, "chunkIndex"> & {chunkIndex?: number; complete: boolean; conflict?: boolean};
export type PaceCar = {id: string; metrics?: PaceMetric; laps: PaceLap[]; traces: PaceTrace[]};
export type PaceHistory = {schemaRevision: 1; observedSessionId: string; segmentId: string; transportSessionId: string; updatedAt: string; cars: PaceCar[]};
export const PaceLimits = {cars: 40, bins: 128, traces: 3, laps: 20, wireBytes: 4096, storageBytes: 524288} as const;
const object = (x: unknown): Record<string, unknown> => { if (!x || typeof x !== "object" || Array.isArray(x)) throw Error("pace_object"); return x as Record<string, unknown>; };
const keys = (r: Record<string, unknown>, allowed: string[]) => { if (Object.keys(r).some(k => !allowed.includes(k))) throw Error("pace_keys"); };
const num = (x: unknown, min: number, max: number, integer = false): number => { if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max || integer && !Number.isInteger(x)) throw Error("pace_number"); return x; };
const opt = (x: unknown, min: number, max: number, integer = false) => x == null ? null : num(x, min, max, integer);
const text = (x: unknown, max = 64): string => { if (typeof x !== "string" || !x.trim() || x.length > max) throw Error("pace_id"); return x; };
const bool = (x: unknown) => { if (x == null) return null; if (typeof x !== "boolean") throw Error("pace_bool"); return x; };
const list = (x: unknown, cap: number): unknown[] => { if (!Array.isArray(x) || x.length > cap) throw Error("pace_list"); return x; };
export const validatedSectors = (value: unknown, lap: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length !== 3 || typeof lap !== "number" || !Number.isFinite(lap) || lap <= 0 || lap > 86400) return null;
  if (value.some(x => typeof x !== "number" || !Number.isFinite(x) || x <= 0 || x > 86400)) return null;
  return Math.abs(value.reduce((a, b) => a + b, 0) - lap) <= 0.100000001 ? value : null;
};
/** Any malformed PACE affects only PACE, including unknown nested keys. */
export const parsePaceCapture = (value: unknown): PaceCapture | null => {
  if (value == null) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length + 14 > PaceLimits.wireBytes) return null;
    const r = object(value); keys(r, ["schemaRevision", "observedSessionId", "segmentId", "opponentMetrics", "opponentLaps", "traceChunks"]);
    if (r.schemaRevision !== 1) return null;
    const opponentMetrics = list(r.opponentMetrics, 4).map(v => {
      const m = object(v); keys(m, ["id", "observedSessionTimeSeconds", "lastLapSeconds", "bestLapSeconds", "lastLapSectorSeconds", "bestLapSectorSeconds", "bestSectorSeconds", "bestLapDeltaToFieldBestSeconds", "bestLapDeltaToPlayerSeconds", "lapValid", "lapHighPrecision", "trackPositionPercentRaw", "sectorMismatchCount"]);
      const lastLapSeconds = opt(m.lastLapSeconds, 0.001, 86400), bestLapSeconds = opt(m.bestLapSeconds, 0.001, 86400);
      return {id: text(m.id), observedSessionTimeSeconds: num(m.observedSessionTimeSeconds, 0, 86400), lastLapSeconds, bestLapSeconds,
        lastLapSectorSeconds: validatedSectors(m.lastLapSectorSeconds, lastLapSeconds), bestLapSectorSeconds: validatedSectors(m.bestLapSectorSeconds, bestLapSeconds),
        bestSectorSeconds: m.bestSectorSeconds == null ? null : list(m.bestSectorSeconds, 3).length === 3 ? (m.bestSectorSeconds as unknown[]).map(x => opt(x, 0.001, 86400)) : null,
        bestLapDeltaToFieldBestSeconds: opt(m.bestLapDeltaToFieldBestSeconds, 0, 86400), bestLapDeltaToPlayerSeconds: opt(m.bestLapDeltaToPlayerSeconds, -86400, 86400),
        lapValid: bool(m.lapValid), lapHighPrecision: opt(m.lapHighPrecision, 0, 100001), trackPositionPercentRaw: opt(m.trackPositionPercentRaw, -100001, 100001), sectorMismatchCount: num(m.sectorMismatchCount, 0, Number.MAX_SAFE_INTEGER, true)};
    });
    const opponentLaps = list(r.opponentLaps, 20).map(v => {
      const l = object(v); keys(l, ["id", "lap", "seconds", "observedSessionTimeSeconds", "quality", "observationId"]);
      if (l.quality !== "sampled") throw Error("pace_quality");
      return {id: text(l.id), lap: num(l.lap, 1, 100000, true), seconds: num(l.seconds, 0.001, 86400), observedSessionTimeSeconds: num(l.observedSessionTimeSeconds, 0, 86400), quality: "sampled" as const, observationId: text(l.observationId, 80)};
    });
    const traceChunks = list(r.traceChunks, 4).map(v => {
      const t = object(v); keys(t, ["id", "traceId", "lap", "chunkIndex", "finalChunk", "anchorSessionTimeMs", "anchorUncertaintyMs", "lapSeconds", "provenance", "speedUnit", "points"]);
      if (t.provenance !== "simhub-opponent-sampled" || t.speedUnit != null && t.speedUnit !== "km/h" || typeof t.finalChunk !== "boolean") throw Error("pace_provenance");
      let previous = -1, previousTime = -1;
      const points = list(t.points, 64).map(v => {
        const a = list(v, 3); if (a.length !== 3) throw Error("pace_point");
        const bin = num(a[0], 0, 127, true), time = opt(a[1], 0, 86400000, true), speed = opt(a[2], 0, 6000, true);
        if (bin <= previous || time !== null && time < previousTime) throw Error("pace_order");
        previous = bin; if (time !== null) previousTime = time;
        return [bin, time, t.speedUnit === "km/h" ? speed : null] as [number, number | null, number | null];
      });
      return {id: text(t.id), traceId: text(t.traceId, 80), lap: num(t.lap, 1, 100000, true), chunkIndex: num(t.chunkIndex, 0, 127, true), finalChunk: t.finalChunk,
        anchorSessionTimeMs: opt(t.anchorSessionTimeMs, 0, 86400000, true), anchorUncertaintyMs: opt(t.anchorUncertaintyMs, 0, 250, true), lapSeconds: opt(t.lapSeconds, 0.001, 86400),
        provenance: "simhub-opponent-sampled" as const, speedUnit: t.speedUnit === "km/h" ? "km/h" as const : null, points};
    });
    return {schemaRevision: 1, observedSessionId: text(r.observedSessionId), segmentId: text(r.segmentId), opponentMetrics, opponentLaps, traceChunks};
  } catch { return null; }
};
