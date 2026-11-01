import type { PaceHistory } from "../../../../supabase/functions/_shared/paceCapture";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readPitwallPace, type PaceSource } from "@/lib/simhubPace";
import { PaceSeriesGraph } from "./PaceSeriesGraph";
import { freshPaceHistory, newestTrace, completeReference, lapSeries, speedSeries, deltaSeries, type StoredTrace } from "./paceSeries";
import type { V3Normalized } from "./pitwallHelpers";
import type { PitwallPaceData, PitwallStrategyRow } from "./pitwallHelpers";
import { formatLapTime } from "./pitwallHelpers";
import { PitwallPanel } from "./PitwallPanel";
import { type PacePoint } from "./PaceGraph";

interface Props {
  paceSource?: PaceSource;
  v3?: V3Normalized | null;
  live?: boolean;
  strategy: PitwallStrategyRow | null;
  pace: PitwallPaceData | null;
  /** Rondetijden uit dezelfde bron als de tijdlijn, voor als het pace-blok leeg is. */
  lapTimes?: number[];
  /**
   * De punten voor de grafiek. Endurance: de tijdlijn met pitmarkeringen.
   * Testmodus: `lap_samples` van het apparaat. De grafiek zelf is dezelfde.
   */
  points?: PacePoint[];
}

/** Twee echte reeksen, ontbrekende/ongecontroleerde data blijft leeg. Advies ongewijzigd. */
const PacePresentation = ({ strategy, pace, lapTimes = [], points = [], v3, live = true, remoteHistory, remoteError, chosenId, onChoose }: Props & {remoteHistory?: PaceHistory | null; remoteError?: boolean; chosenId?: string | null; onChoose?: (id:string | null)=>void}) => {
  const [mode, setMode] = useState('lap');
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const choices = v3?.opponents?.filter(o => !o.isPlayer && o.connected !== false) ?? [];
  const selected = choices.find(o => o.id === (chosenId ?? referenceId)) ?? choices.find(o => o.position === 1) ?? null;
  const history = live ? freshPaceHistory(v3, remoteHistory ?? v3?.paceHistory) : null;
  const ownId = v3?.opponents?.find(o=>o.isPlayer)?.id;
  const own = history?.cars.find(c=>c.id===ownId);
  const other = selected ? history?.cars.find(c=>c.id===selected.id) : undefined;
  const trace = newestTrace(own);
  const pin = useRef<{key:string; trace:StoredTrace | null}>({key:"",trace:null});
  const pinKey = `${history?.segmentId}:${trace?.traceId}:${selected?.id}`;
  if (pin.current.key !== pinKey) pin.current = {key:pinKey, trace:null};
  if (!pin.current.trace) pin.current.trace = completeReference(other);
  const [deltaOwn, deltaRef] = deltaSeries(trace, pin.current.trace);
  const ownLaps = own ? lapSeries(own) : live ? points.slice(-20).filter(p=>Number.isFinite(p.lap) && Number.isFinite(p.seconds) && p.seconds>0 && p.seconds<=86400).map(p=>({x:p.lap,y:p.seconds,marker:p.marker})) : [];
  const ownSeries = mode === "lap" ? ownLaps : mode === "speed" ? speedSeries(trace) : deltaOwn;
  const refSeries = mode === "lap" ? lapSeries(other) : mode === "speed" ? speedSeries(newestTrace(other)) : deltaRef;
  const modes = [{id:"lap",label:"Rondetijd"},{id:"speed",label:"Snelheid"},{id:"delta",label:"Delta"}];
  const grafiek = <>
    <div className="mb-1 flex gap-3" aria-label="Pace-weergave">
      {modes.map(m=><button key={m.id} type="button" aria-pressed={mode===m.id} onClick={()=>setMode(m.id)} className={`text-[12px] font-bold ${mode===m.id ? "border-b border-orange-400 text-orange-300" : "text-slate-400"}`}>{m.label}</button>)}
    </div>
    <label className="flex gap-2 text-[11px] text-slate-400">Vergelijk
      <select aria-label="Vergelijkingsauto" value={selected?.id ?? ""} onChange={e=>{setReferenceId(e.target.value || null); onChoose?.(e.target.value || null);}} className="min-w-0 max-w-40 bg-slate-950 text-slate-200">
        <option value="">Geen referentie</option>
        {choices.map(o=><option key={o.id} value={o.id}>{o.driverName ?? o.carNumber ?? o.id}</option>)}
      </select>
    </label>
    <PaceSeriesGraph own={ownSeries} reference={refSeries} label={modes.find(m=>m.id===mode)!.label} unit={mode==="speed"?"km/h":"s"} distance={mode!=="lap"} />
    <p className="text-[11px] text-orange-300">━ Eigen auto{selected && <span className="text-emerald-300"> · ━ {selected.driverName ?? selected.id}</span>}</p>
    {selected && refSeries.length<2 && <p className="text-[11px] text-slate-400">Vergelijkingsreeks ontbreekt of is niet gecontroleerd.</p>}
    {mode==="delta" && <p className="text-[11px] text-slate-400">Eigen tijd − vaste opgenomen referentie op dezelfde baanpositie; positief is langzamer.</p>}
    {remoteError && <p className="text-[11px] text-slate-400">Pace-opslag niet beschikbaar.</p>}
  </>;

  // Uitlooprondes (pit, spin, herstart) mogen het gemiddelde niet bepalen.
  const eigen = lapTimes.filter((n) => Number.isFinite(n) && n > 0 && n < 600);

  const lastLap = pace?.lastLapSeconds ?? (eigen.length ? eigen[eigen.length - 1] : null);
  const bestLap = pace?.bestLapSeconds ?? (eigen.length ? Math.min(...eigen) : null);
  const stintAvg = pace?.stintAvgSeconds ?? (eigen.length ? eigen.reduce((a, b) => a + b, 0) / eigen.length : null);
  const target = pace?.targetSeconds;
  const delta = lastLap != null && target != null ? lastLap - target : null;

  const showAny = lastLap != null || stintAvg != null || target != null;

  if (!showAny) {
    return (
      <PitwallPanel title="Pace" slot="pace">
        {grafiek}
        <p className="mt-2 text-[12px] text-slate-500">Geen aanvullende stintwaarden; grafiek toont opgeslagen rondes</p>
      </PitwallPanel>
    );
  }

  return (
    <PitwallPanel title="Pace" slot="pace" meta="eigen auto">
      {grafiek}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {lastLap != null && <Value label="Laatste" value={formatLapTime(lastLap)} tone="text-white" />}
        {bestLap != null && <Value label="Beste" value={formatLapTime(bestLap)} tone="text-slate-200" />}
        {stintAvg != null && <Value label="Stint gem." value={formatLapTime(stintAvg)} tone="text-slate-200" />}
        {target != null && <Value label="Doel" value={formatLapTime(target)} tone="text-slate-200" />}
      </dl>
      {delta != null && (
        <p className={`mt-2.5 text-[12px] font-bold ${delta < 0 ? "text-emerald-300" : "text-orange-300"}`} data-pitwall-pace-delta="true">
          Δ laatste t.o.v. doel {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}s
        </p>
      )}
    </PitwallPanel>
  );
};

function Value({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[18px] font-bold tabular-nums leading-none ${tone}`}>{value}</dd>
    </div>
  );
}

export const PacePanel = (props: Props) => props.paceSource ? <ConnectedPacePanel {...props} /> : <PacePresentation {...props} />;
function ConnectedPacePanel(props: Props) {
  const [chosenId,setChosenId] = useState<string | null>(null);
  const choices = props.v3?.opponents?.filter(o=>!o.isPlayer && o.connected!==false) ?? [];
  const selected = choices.find(o=>o.id===chosenId) ?? choices.find(o=>o.position===1) ?? null;
  const source = props.paceSource!;
  const query = useQuery({
    queryKey: ["pitwall-pace",source.deviceId,source.eventId,source.teamId,selected?.id],
    enabled: props.live!==false && !!(source.deviceId || source.eventId && source.teamId),
    queryFn: ()=>readPitwallPace(source,selected?.id ?? null), refetchInterval:1000,retry:false,
  });
  return <PacePresentation {...props} remoteHistory={query.data} remoteError={query.isError} chosenId={chosenId} onChoose={setChosenId} />;
}
