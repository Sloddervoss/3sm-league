export interface ParsedPaceRow { averageLapSeconds: number; medianLapSeconds: number; bestLapSeconds: number; bestFiveAverageSeconds: number; consistencySeconds: number; validLaps: number; incidents: number; averageStintMinutes: number }

export const parseLapSeconds = (value: string) => {
  const clean = value.trim();
  if (/^\d+(\.\d+)?$/.test(clean)) return Number(clean);
  const match = clean.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) throw new Error(`Ongeldige rondetijd: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const parsePaceCsv = (text: string): ParsedPaceRow => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV bevat geen gegevensrij.");
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  const row = lines[1].split(",").map((value) => value.trim());
  const read = (...names: string[]) => { const index = headers.findIndex((header) => names.includes(header)); return index >= 0 ? row[index] : ""; };
  const lapValue = read("lap_times", "lap_times_seconds", "rondetijden");
  const laps = lapValue ? lapValue.split(/[;|]/).filter(Boolean).map(parseLapSeconds) : [];
  const average = read("average_lap", "average", "gemiddelde");
  const best = read("best_lap", "best", "snelste");
  if (!average && laps.length === 0) throw new Error("Kolom average_lap of lap_times ontbreekt.");
  const averageLapSeconds = average ? parseLapSeconds(average) : mean(laps);
  const bestLapSeconds = best ? parseLapSeconds(best) : Math.min(...laps);
  const validLaps = Number(read("valid_laps", "laps", "geldige_ronden") || laps.length);
  if (!Number.isFinite(validLaps) || validLaps < 1) throw new Error("Aantal geldige ronden is ongeldig.");
  const source = laps.length ? laps : Array.from({ length: validLaps }, () => averageLapSeconds);
  const variance = mean(source.map((value) => (value - mean(source)) ** 2));
  return {
    averageLapSeconds,
    medianLapSeconds: Number(read("median_lap", "median", "mediaan") || median(source)),
    bestLapSeconds,
    bestFiveAverageSeconds: Number(read("best_five_average", "best5") || mean([...source].sort((a, b) => a - b).slice(0, Math.min(5, source.length)))),
    consistencySeconds: Number(read("consistency", "deviation") || Math.sqrt(variance)),
    validLaps,
    incidents: Number(read("incidents") || 0),
    averageStintMinutes: Number(read("average_stint_minutes", "stint_minutes") || 0),
  };
};
