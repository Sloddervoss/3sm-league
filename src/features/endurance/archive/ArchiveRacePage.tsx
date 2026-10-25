import { useEffect } from "react";
import { useDriverNameMap } from "@/hooks/data/useSharedQueries";
import type { EnduranceEvent } from "../core/types";
import { useEnduranceArchiveSummary } from "../repository/archiveRepository";
import { useEnduranceStints } from "../repository/stintsRepository";
import { ArchiveRaceView } from "./ArchiveRaceView";

/**
 * Archiefdetail (/endurance/archief/:eventId) — koppelt de bestaande bronnen aan
 * de weergave: de RPC `get_endurance_archive_summary` voor de cijfers per team
 * en `endurance_stints` voor de stintverdeling. Geen nieuwe tabellen, geen DDL.
 */
export const ArchiveRacePage = ({ event, onBack }: { event: EnduranceEvent; onBack: () => void }) => {
  const summary = useEnduranceArchiveSummary(event.id);
  const stints = useEnduranceStints(event.id);
  const driverNames = useDriverNameMap();

  useEffect(() => {
    const vorige = document.title;
    document.title = `${event.name} · Endurance-archief`;
    return () => { document.title = vorige; };
  }, [event.name]);

  const error = summary.error instanceof Error ? summary.error.message : null;
  // De stintverdeling is een aanvulling: valt die weg, dan blijft de uitslag
  // staan en melden we het verschil eerlijk in plaats van een lege balk te tonen.
  const stintError = stints.error instanceof Error ? stints.error.message : null;

  return (
    <ArchiveRaceView
      event={event}
      teams={summary.data ?? []}
      stints={stints.data ?? []}
      nameOf={(id) => driverNames.get(id)}
      onBack={onBack}
      loading={summary.isLoading}
      error={error ?? (stintError ? `stints: ${stintError}` : null)}
    />
  );
};
