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
 * De waarden komen uit dezelfde velden als voor deze look-update; er wordt hier
 * niets berekend of aangevuld.
 */
export function RaceTelemetryStrip({ v3, live }: { v3: V3Normalized | null; live: boolean }) {
  const data = live ? v3 : null;
  const pos = data?.position?.position;
  const cls = data?.position?.classPosition;
  const last = data?.timing?.lastLapTimeSeconds;
  const best = data?.timing?.bestLapTimeSeconds;
  const laps = data?.timing?.completedLaps;
  const rest = data?.session?.sessionTimeRemainingSeconds;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[5fr_4fr_6fr]"
      data-pitwall-kpi="true"
    >
      <KpiGroup label="Sectoren" group="sectoren">
        <Cell label="S1" value={second(data?.vehicle?.sector1Seconds)} />
        <Cell label="S2" value={second(data?.vehicle?.sector2Seconds)} />
        <Cell label="S3" value={second(data?.vehicle?.sector3Seconds)} />
      </KpiGroup>

      <KpiGroup label="Rondetijd" group="rondetijd">
        <Cell label="Laatste" value={lap(last)} tone="text-white" />
        <Cell label="Beste" value={lap(best)} tone="text-emerald-300" />
      </KpiGroup>

      <KpiGroup label="Positie" group="positie">
        <Cell label="P" value={pos != null ? `P${pos}` : '—'} />
        <Cell label="K" value={cls != null ? `K${cls}` : '—'} tone="text-sky-300" />
        <Cell label="Ronde" value={laps != null ? String(laps) : '—'} />
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

function Cell({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono text-[26px] font-bold leading-none tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
