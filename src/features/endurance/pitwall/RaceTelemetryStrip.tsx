import { rowSectors, trackSectorCount } from "./paceSeries";
import { fieldSectorBests, sectorDeltas } from "./sectorField";
import { lapDifference } from './elementPresentation';
import type { ReactNode } from 'react';
import type { V3Normalized } from './pitwallHelpers';
import { preciseLapTime as lap } from './telemetryFormat';

const clock = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const finiteClock = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

const second = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';

/**
 * De KPI-strip: dezelfde velden als voorheen, in drie visuele groepen.
 *
 * - sectoren (S1/S2/S3),
 * - laatste en beste ronde,
 * - positie, klassepositie, ronde en resttijd.
 *
 * Geen noemers die we niet hebben: geen "P6 / 16", geen "103 / 360". `P` en `K`
 * blijven losse waarden, en de ronde is de teller van voltooide rondes — niet
 * omgedoopt tot de lopende ronde.
 *
 * De rondedelta vergelijkt uitsluitend laatste met beste; sessietijd is geen stinttijd.
 */
export function RaceTelemetryStrip({ v3, live, plannedLaps, plannedDurationMinutes }: { v3: V3Normalized | null; live: boolean; plannedLaps?: number | null; plannedDurationMinutes?: number | null }) {
  const data = live ? v3 : null;
  const planLaps = typeof plannedLaps === "number" && Number.isSafeInteger(plannedLaps) && plannedLaps > 0 ? plannedLaps : null;
  const planMinutes = typeof plannedDurationMinutes === "number" && Number.isSafeInteger(plannedDurationMinutes) && plannedDurationMinutes > 0 ? plannedDurationMinutes : null;
  const pos = data?.position?.position;
  const cls = data?.position?.classPosition;
  const last = data?.timing?.lastLapTimeSeconds;
  const best = data?.timing?.bestLapTimeSeconds;
  const laps = data?.timing?.completedLaps;
  const difference = lapDifference(last, best);
  const player = data?.opponents?.find(o=>o.isPlayer);
  const sectors = player ? rowSectors(data,player.id,player.lastLapSeconds) : null;
  const rest = data?.session?.sessionTimeRemainingSeconds;
  // Waar verliezen we tijd? Per sector het verschil met de snelste tijd in het veld.
  // Alleen binnen dezelfde sectordeling; anders blijft het verschil leeg.
  const sectorBest = fieldSectorBests((data?.opponents ?? []).map(o => ({ id: o.id, sectors: rowSectors(data,o.id,o.lastLapSeconds) })));
  const deltas = sectors ? sectorDeltas(sectors, sectorBest) : null;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[5fr_6fr_8fr]"
      data-pitwall-kpi="true"
    >
      <KpiGroup label={sectors ? "Sectoren laatste ronde" : "Sectoren · niet gecontroleerd"} group="sectoren" className={trackSectorCount(data)>3 ? "pitwall-many-sectors" : ""}>
        {trackSectorCount(data) === 0 && <Cell label="Sectorindeling onbekend" value="—" compact />}
        {Array.from({length:trackSectorCount(data)},(_,i)=><Cell key={i} compact={trackSectorCount(data)>3} label={`S${i+1}`} value={second(sectors?.[i])} hint={deltas?.[i] != null ? <span className={deltas[i]! > 0 ? "text-red-300" : "text-emerald-300"}>{deltas[i]! > 0 ? "+" : ""}{deltas[i]!.toFixed(3)}</span> : undefined} />)}
      </KpiGroup>

      <KpiGroup label="Rondetijd" group="rondetijd">
        <Cell label="Laatste" value={lap(last)} tone="text-white" />
        <Cell label="Beste" value={lap(best)} tone="text-emerald-300" />
        {difference != null && <Cell label="Δ laatste − beste" value={`${difference > 0 ? '▲ +' : difference < 0 ? '▼ ' : ''}${difference.toFixed(3)} s`} tone={difference > 0 ? "text-red-300" : "text-emerald-300"} />}
      </KpiGroup>

      <KpiGroup label="Positie" group="positie">
        <Cell label="P" value={pos != null ? `P${pos}` : '—'} />
        <Cell label="K" value={cls != null ? `K${cls}` : '—'} tone="text-sky-300" />
        <Cell label={planLaps != null ? `Ronde · plan ${planLaps}` : "Ronde"} value={laps != null ? String(laps) : '—'} />
        {finiteClock(data?.session?.sessionTimeSeconds) && <Cell label={planMinutes != null ? `Sessie · plan ${clock(planMinutes * 60)}` : "Verstreken sessie"} value={clock(data?.session?.sessionTimeSeconds)} />}
        <Cell label="Resttijd" value={clock(rest)} tone="text-emerald-300" />
      </KpiGroup>
    </div>
  );
}

function KpiGroup({
  label,
  group,
  className = '',
  children,
}: {
  label: string;
  group: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-[#1D2431] bg-[#0B0D11] px-4 py-2.5 ${className}`} data-pitwall-kpi-group={group}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-start gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function Cell({ label, value, tone = 'text-white', compact = false, hint }: { label: string; value: string; tone?: string; compact?: boolean; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono ${compact ? "text-[18px]" : "text-[26px]"} font-bold leading-none tabular-nums ${tone}`}>{value}</p>
      {hint != null && <p className="mt-0.5 font-mono text-[10px] leading-none tabular-nums" title="Verschil met de snelste beschikbare laatste ronde in het veld, alle klassen">{hint}</p>}
    </div>
  );
}
