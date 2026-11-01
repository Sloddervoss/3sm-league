import { linePath } from "./paceSeries";
import type { SeriesPoint } from "./paceSeries";
export function PaceSeriesGraph({own, reference, label, unit, distance = false}: {own: SeriesPoint[]; reference: SeriesPoint[]; label: string; unit: string; distance?: boolean}) {
  const clean = (points: SeriesPoint[]) => points.slice(-128).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const a = clean(own), b = clean(reference);
  const validA = a.length >= 2, validB = b.length >= 2;
  const all = [...(validA ? a : []), ...(validB ? b : [])];
  if (!all.length) return <p className="flex h-28 items-center justify-center text-[12px] text-slate-400">Geen gecontroleerde reeks beschikbaar.</p>;
  const loX = Math.min(...all.map(p=>p.x)), hiX = Math.max(...all.map(p=>p.x));
  const loY = Math.min(...all.map(p=>p.y)), hiY = Math.max(...all.map(p=>p.y));
  const x = (v:number) => 6 + (v-loX)/Math.max(hiX-loX,1)*308;
  const y = (v:number) => 90 - (v-loY)/Math.max(hiY-loY,0.1)*84;
  return <div><svg viewBox="0 0 320 96" className="h-28 w-full" role="img" aria-label={label} data-pitwall-pace-graph="true" preserveAspectRatio="none">
    {[0,1,2,3].map(i=><line key={i} x1="6" x2="314" y1={6+i*28} y2={6+i*28} stroke="#1F2634" />)}
    {[0,1,2,3,4].map(i=><line key={`v${i}`} y1="6" y2="90" x1={6+i*77} x2={6+i*77} stroke="#161C27" />)}
    {validA && a.filter(p=>p.marker).map((p,i)=><line key={`marker${i}`} x1={x(p.x)} x2={x(p.x)} y1="6" y2="90" stroke={p.marker==="pit" ? "#F4C15D" : "#42C98B"} strokeDasharray="2 2" />)}
    {validA && a.map((p,i)=><circle key={`a${i}`} cx={x(p.x)} cy={y(p.y)} r="2" fill="#F97316" />)}
    {validB && b.map((p,i)=><circle key={`b${i}`} cx={x(p.x)} cy={y(p.y)} r="2" fill="#42C98B" />)}
    {validA && <path data-pace-line="own" d={linePath(a,x,y,distance?1:1.01)} fill="none" stroke="#F97316" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
    {validB && <path data-pace-line="reference" d={linePath(b,x,y,distance?1:1.01)} fill="none" stroke="#42C98B" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
  </svg><p className="text-[10px] text-slate-500">{loY.toFixed(1)}–{hiY.toFixed(1)} {unit} · {distance ? "baanpositie" : "afgeronde ronde"}</p></div>;
}
