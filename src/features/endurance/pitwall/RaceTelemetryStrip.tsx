import type { V3Normalized } from './pitwallHelpers';
import {preciseLapTime as lap} from './telemetryFormat';
const clock = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export function RaceTelemetryStrip({v3,live}:{v3:V3Normalized|null;live:boolean}) {
  const data=live?v3:null;
  const pos = data?.position?.position;
  const cls = data?.position?.classPosition;
  const cells: Array<[string, string, string]> = [
    ['P', pos != null ? `P${pos}` : '—','text-white'],
    ['K', cls != null ? `K${cls}` : '—','text-sky-300'],
    ['S1',data?.vehicle?.sector1Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['S2',data?.vehicle?.sector2Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['S3',data?.vehicle?.sector3Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['LAATSTE RONDE',lap(data?.timing?.lastLapTimeSeconds),'text-amber-300'],
    ['BESTE RONDE',lap(data?.timing?.bestLapTimeSeconds),'text-fuchsia-400'],
    ['RONDE',data?.timing?.completedLaps != null ? String(data.timing.completedLaps) : '—','text-gray-200'],
    ['RESTTIJD',clock(data?.session?.sessionTimeRemainingSeconds),'text-emerald-300'],
  ];
  return <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-5 xl:grid-cols-9 tabular-nums">{cells.map(([label,value,color])=><div key={label} className="bg-black/60 px-2.5 py-1.5"><p className="text-[9px] font-black uppercase tracking-widest text-gray-500">{label}</p><p className={`font-mono text-sm font-bold ${color}`}>{value}</p></div>)}</div>;
}
