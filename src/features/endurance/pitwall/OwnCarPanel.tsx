import { Car } from "lucide-react";
import { formatLapTime } from "./pitwallHelpers";

/**
 * De strook onder de kaart: welke auto dit is.
 *
 * Alleen identity-velden die we al ontvangen, plus laatste/beste ronde en de
 * gap tot de leider — die getallen stonden eerder in de bovenbalk en horen bij
 * de auto, niet bij een tweede statusbalk. Geen selectie van tegenstanders en
 * geen extra ophaalactie.
 */
export function OwnCarPanel({
  driverName,
  carName,
  teamName,
  lastLapSeconds,
  bestLapSeconds,
  gapToLeaderSeconds,
  carNumber,
  completedLaps,
}: {
  carNumber?: string | null;
  completedLaps?: number | null;
  driverName: string | null;
  carName: string | null;
  teamName: string | null;
  lastLapSeconds: number | null;
  bestLapSeconds: number | null;
  gapToLeaderSeconds: number | null;
}) {
  return (
    <section className="rounded-xl border border-[#1D2431] bg-[#0B0D11] px-3.5 py-3" data-pitwall-slot="own-car">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400"><Car className="mr-1 inline h-3 w-3" aria-hidden />Eigen auto{carNumber && ` #${carNumber}`}{completedLaps != null && ` · R${completedLaps}`}</p>
      <p className="mt-1 truncate font-heading text-[18px] font-black leading-tight text-white">{driverName ?? "—"}</p>
      {(carName || teamName) && (
        <p className="mt-0.5 text-[11px] text-slate-400">{[carName, teamName].filter(Boolean).join(" · ")}</p>
      )}

      <dl className="mt-2.5 grid grid-cols-3 gap-x-3 border-t border-[#161C27] pt-2">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Laatste</dt>
          <dd className="mt-0.5 font-mono text-[14px] font-bold tabular-nums text-amber-300">{formatLapTime(lastLapSeconds)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Beste</dt>
          <dd className="mt-0.5 font-mono text-[14px] font-bold tabular-nums text-fuchsia-300">{formatLapTime(bestLapSeconds)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Gap leider</dt>
          <dd className="mt-0.5 font-mono text-[14px] font-bold tabular-nums text-slate-200">
            {gapToLeaderSeconds != null ? `+${gapToLeaderSeconds.toFixed(1)}s` : "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
