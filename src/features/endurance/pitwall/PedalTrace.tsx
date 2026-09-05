import { useEffect, useState } from 'react';
import {appendPedalSample,pedalPath,type PedalSample} from './pedalHistory';
import type {V3Normalized} from './pitwallHelpers';
export function PedalTrace({v3,live}:{v3:V3Normalized|null;live:boolean}) {
  const [history,setHistory]=useState<{source:string;samples:PedalSample[]}>({source:'',samples:[]});
  const source=v3?.transportSessionId ?? '';
  const at=Date.parse(v3?.capturedAt ?? '');
  const throttle=v3?.vehicle?.throttlePct;
  const brake=v3?.vehicle?.brakePct;
  useEffect(()=>{
    if(!live){setHistory({source:'',samples:[]});return;}
    setHistory(old=>({source,samples:appendPedalSample(old.source===source?old.samples:[],at,throttle,brake)}));
  },[source,at,throttle,brake,live]);
  const samples=live&&history.source===source?history.samples:[];
  return <div className="mt-4"><div className="flex justify-between text-[9px] uppercase text-gray-500"><span>Gas / rem · ontvangen snapshots</span><span>30 sec</span></div><svg role="img" aria-label="Gas- en remhistorie van ontvangen telemetrie" viewBox="0 0 310 90" className="mt-2 h-24 w-full rounded border border-white/5 bg-black/20"><path d="M0 10 H300 M0 45 H300 M0 80 H300" stroke="#ffffff0d" fill="none"/><path d={pedalPath(samples,'throttle')} stroke="#34d399" strokeWidth="2" fill="none"/><path d={pedalPath(samples,'brake')} stroke="#f87171" strokeWidth="2" fill="none"/></svg>{samples.length<2&&<p className="mt-1 text-[10px] text-gray-500">Wacht op meerdere telemetriemetingen…</p>}</div>;
}
