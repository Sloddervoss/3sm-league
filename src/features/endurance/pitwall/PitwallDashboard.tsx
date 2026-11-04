import type { ReactNode } from "react";
import "./pitwallLook.css";

/**
 * Het raster van Vincents ontwerp, als losse presentatiecomponent.
 *
 * Volgorde: contextregel, KPI-strip, beslissingsband, dan circuit links (een
 * derde) naast live timing rechts (twee derde), daaronder vier panelen en tot
 * slot de bestaande aanvullende blokken achter ‘Meer analyse’.
 *
 * Er wordt niets verkleind om het te laten passen: onder 1280px gaan de twee
 * hoofdkolommen onder elkaar en staan de vier panelen twee aan twee; onder
 * 768px staat alles in één kolom.
 *
 * De component kent geen data. Iedere sleuf krijgt kant-en-klare inhoud van de
 * pagina die hem gebruikt — de echte endurance-pitwall en de pitwall-test
 * leveren zo hetzelfde raster.
 */
export function PitwallDashboard({
  context,
  kpi,
  decision,
  track,
  timing,
  panels,
  notice,
  extra,
}: {
  context?: ReactNode;
  kpi?: ReactNode;
  decision?: ReactNode;
  track: ReactNode;
  timing: ReactNode;
  panels: ReactNode[];
  /** Smalle strook boven de panelenrij; geen kaart tussen de vier panelen. */
  notice?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-3" data-pitwall-look="true">
      {context}
      {kpi}
      {decision}

      {/* Circuit links, live timing rechts. Op smalle schermen stapelen, niet krimpen. */}
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-pitwall-row="track-timing">
        <div className="min-w-0 space-y-3" data-pitwall-col="track">
          {track}
        </div>
        <div className="min-w-0" data-pitwall-col="timing">
          {timing}
        </div>
      </div>

      {notice && (
        <div data-pitwall-row="notice" className="min-w-0">
          {notice}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-pitwall-row="panels">
        {panels.map((panel, index) => (
          <div key={index} className="min-w-0">
            {panel}
          </div>
        ))}
      </div>

      {extra && (
        <details className="pitwall-more" data-pitwall-more="true">
          <summary className="cursor-pointer text-[12px] font-bold leading-6 text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400">
            Meer analyse
          </summary>
          <div className="space-y-3 pt-3" data-pitwall-extra="true">{extra}</div>
        </details>
      )}
    </div>
  );
}
