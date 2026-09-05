import type { V3Normalized } from './pitwallHelpers';
import {preciseLapTime as lap} from './telemetryFormat';
export function RaceTelemetryStrip({v3,live}:{v3:V3Normalized|null;live:boolean}) {
  const data=live?v3:null;
  const cells = [
    ['S1 · LAATSTE RONDE',data?.vehicle?.sector1Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['S2',data?.vehicle?.sector2Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['S3',data?.vehicle?.sector3Seconds?.toFixed(3) ?? '—','text-gray-200'],
    ['LAATSTE RONDE',lap(data?.timing?.lastLapTimeSeconds),'text-amber-300'],
    ['BESTE RONDE',lap(data?.timing?.bestLapTimeSeconds),'text-fuchsia-400'],
    ['HUIDIGE RONDE',lap(data?.timing?.currentLapElapsedSeconds),'text-emerald-300'],
  ];
  return <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 xl:grid-cols-6">{cells.map(([label,value,color])=><div key={label} className="min-w-0 bg-[#0c1016] px-3 py-2"><p className="truncate text-[8px] font-bold tracking-wider text-gray-500">{label}</p><p className={`mt-1 font-mono text-lg font-black tabular-nums ${color}`}>{value}</p></div>)}</div>;
}
