import type { PitwallPaceData, PitwallStrategyRow } from "./pitwallHelpers";
import { formatLapTime } from "./pitwallHelpers";
import { PitwallPanel } from "./PitwallPanel";
import { PaceGraph, type PacePoint } from "./PaceGraph";

interface Props {
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

/**
 * Het pace-paneel: één oranje lijn met de bestaande pacewaarden eronder.
 *
 * De waarden zijn exact die van `PacePanel` van voor deze look: laatste, beste,
 * stintgemiddelde, doel en — alleen als beide kanten bekend zijn — het verschil.
 * Er wordt niets bijgerekend en er is geen tweede lijn.
 */
export const PacePanel = ({ strategy, pace, lapTimes = [], points = [] }: Props) => {
  const grafiek = <PaceGraph points={points} />;

  if (!strategy && points.length === 0) {
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
        <p className="mt-2 text-[12px] text-slate-500">Nog geen rondetijd in deze stint</p>
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
