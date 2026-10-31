import { useState } from "react";
import { finiteNonNegative, lapDifference } from "./elementPresentation";
import type { V3Normalized } from "./pitwallHelpers";
import type { PitwallPaceData, PitwallStrategyRow } from "./pitwallHelpers";
import { formatLapTime } from "./pitwallHelpers";
import { PitwallPanel } from "./PitwallPanel";
import { PaceGraph, type PacePoint } from "./PaceGraph";

interface Props {
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

/** Rondetijdhistorie, actuele snelheid en delta met expliciete eigen referentie.
 * Geen historische snelheid of leiderlijn zonder bron. Advieslogica blijft gelijk. */
export const PacePanel = ({ strategy, pace, lapTimes = [], points = [], v3, live = true }: Props) => {
  const [mode, setMode] = useState('lap');
  const speed = live && v3?.session?.isInCar !== false && finiteNonNegative(v3?.vehicle?.speedKph) ? v3.vehicle.speedKph : null;
  const difference = live ? lapDifference(v3?.timing?.lastLapTimeSeconds ?? pace?.lastLapSeconds, v3?.timing?.bestLapTimeSeconds ?? pace?.bestLapSeconds) : null;
  const modes = [{ id: 'lap', label: 'Rondetijd' }, ...(speed != null ? [{ id: 'speed', label: 'Snelheid' }] : []), ...(difference != null ? [{ id: 'delta', label: 'Delta' }] : [])];
  const active = modes.some(m => m.id === mode) ? mode : 'lap';
  const grafiek = <>
    <div className="mb-1 flex gap-3" aria-label="Pace-weergave">
      {modes.map(m => <button key={m.id} type="button" aria-pressed={active === m.id} onClick={() => setMode(m.id)} className={`text-[12px] font-bold ${active === m.id ? 'border-b border-orange-400 text-orange-300' : 'text-slate-400'}`}>{m.label}</button>)}
    </div>
    {active === 'lap' ? <><PaceGraph points={points} /><p className="text-[11px] text-orange-300">━ Eigen auto · rondetijd (s)</p></> : <div className="flex h-28 flex-col justify-center">
      <p className="font-mono text-[32px] font-bold text-white">{active === 'speed' ? `${speed?.toFixed(0)} km/h` : `${difference != null && difference >= 0 ? '+' : ''}${difference?.toFixed(3)} s`}</p>
      <p className="text-[12px] text-slate-400">{active === 'speed' ? 'Actuele snelheid · geen historische reeks' : 'Laatste ronde − beste ronde · eigen auto'}</p>
    </div>}
  </>;

  if (!strategy && points.length === 0 && speed == null && difference == null) {
    return (
      <PitwallPanel title="Pace" slot="pace">
        <p className="text-[12px] text-slate-500">Geen data</p>
      </PitwallPanel>
    );
  }

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
