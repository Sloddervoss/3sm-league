import { useMemo } from "react";

export type PacePoint = {
  lap: number;
  seconds: number;
  /** Pit in/out of een wissel op deze ronde: markeren op de tijdlijn. */
  marker?: "pit" | "swap";
};

interface Props {
  points: PacePoint[];
  /** Mediaan van de reeks, om de schaal te bepalen. */
  className?: string;
}

const W = 320;
const H = 96;
const PAD = 6;

/** Mediaan: één uitloopronde mag de schaal niet platdrukken. */
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const PaceGraph = ({ points, className = "" }: Props) => {
  const { path, markers, min, max, ref } = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.seconds) && p.seconds > 0 && p.seconds < 600);
    if (clean.length < 2) {
      return { path: "", markers: [] as Array<{ x: number; y: number; kind: string }>, min: 0, max: 0, ref: 0 };
    }

    const mid = median(clean.map((p) => p.seconds));
    // Alles buiten 12% van de mediaan is een uitloop- of pitronde: niet meeschalen.
    const inBand = clean.filter((p) => Math.abs(p.seconds - mid) <= mid * 0.12);
    const base = inBand.length >= 2 ? inBand : clean;

    const lo = Math.min(...base.map((p) => p.seconds));
    const hi = Math.max(...base.map((p) => p.seconds));
    const span = Math.max(hi - lo, 0.5);

    const x = (index: number) => PAD + (index / Math.max(clean.length - 1, 1)) * (W - PAD * 2);
    const y = (seconds: number) => H - PAD - ((seconds - lo) / span) * (H - PAD * 2);

    const d = clean
      .map((p, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(Math.min(Math.max(p.seconds, lo), hi)).toFixed(1)}`)
      .join(" ");

    const marks = clean
      .map((p, index) => ({ point: p, index }))
      .filter(({ point }) => point.marker)
      .map(({ point, index }) => ({ x: x(index), y: y(Math.min(Math.max(point.seconds, lo), hi)), kind: point.marker as string }));

    return { path: d, markers: marks, min: lo, max: hi, ref: mid };
  }, [points]);

  if (!path) {
    return (
      <div className={`rounded-xl border border-white/10 bg-black/40 px-3 py-2 ${className}`}>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Pace</h3>
        <p className="mt-2 text-[11px] text-gray-500">Nog geen geldige rondetijden.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-white/10 bg-black/40 px-3 py-2 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Pace</h3>
        <span className="font-mono text-[10px] text-gray-500">
          {min.toFixed(1)}–{max.toFixed(1)} s · mediaan {ref.toFixed(1)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-24 w-full" role="img" aria-label="Rondetijden">
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#2B3038" strokeWidth="1" />
        <path d={path} fill="none" stroke="#FF7417" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {markers.map((m, i) => (
          <line
            key={i}
            x1={m.x}
            x2={m.x}
            y1={PAD}
            y2={H - PAD}
            stroke={m.kind === "pit" ? "#F4C15D" : "#42C98B"}
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        ))}
      </svg>
      <p className="text-[9px] text-gray-600">Geldige rondes; uitloop boven 600 s telt niet mee in de schaal.</p>
    </div>
  );
};
