import { PitwallPanel } from "./PitwallPanel";
import { formatLapTime } from "./pitwallHelpers";

/**
 * Mijn sessie — de vierde plek in de testmodus, waar de endurance-pitwall
 * "Coureur & wissel" heeft.
 *
 * Rijder en auto uit de telemetrie-identiteit, het aantal vastgelegde rondes,
 * de snelste en de mediaan uit `pitwall_sandbox_v1`. Alle waarden worden al
 * door de testpagina opgehaald; dit paneel rekent niets uit en suggereert geen
 * profielvoorziening. Een sessie van dit apparaat is niet de racehistorie van
 * een account.
 */
export function MySessionPanel({
  driverName,
  carName,
  recordedLaps,
  fastestSeconds,
  medianSeconds,
}: {
  driverName: string | null;
  carName: string | null;
  recordedLaps: number | null;
  fastestSeconds: number | null;
  medianSeconds: number | null;
}) {
  return (
    <PitwallPanel title="Mijn sessie" slot="my-session" meta="testmodus">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Rijder</p>
        <p className="mt-1 truncate font-heading text-[22px] font-black leading-tight text-white">{driverName ?? "—"}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">{carName ?? "Auto onbekend"}</p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-[#161C27] pt-2.5">
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Rondes</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-bold leading-none tabular-nums text-white" data-pitwall-session-laps="true">
            {recordedLaps != null ? String(recordedLaps) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Snelste</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-bold leading-none tabular-nums text-amber-300">
            {formatLapTime(fastestSeconds)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Mediaan</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-bold leading-none tabular-nums text-slate-200">
            {formatLapTime(medianSeconds)}
          </dd>
        </div>
      </dl>

      <p className="mt-2.5 text-[11px] text-slate-500">Sessie van dit apparaat; geen accounthistorie.</p>
    </PitwallPanel>
  );
}
