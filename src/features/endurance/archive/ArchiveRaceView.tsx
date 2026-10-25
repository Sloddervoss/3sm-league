import { ArrowLeft, Flag, Timer, Users, Wrench } from "lucide-react";
import type { EnduranceArchiveTeam } from "../repository/archiveRepository";
import type { EnduranceStintRow } from "../repository/stintsRepository";
import type { EnduranceEvent } from "../core/types";
import { formatAmsterdam } from "../core/selectors";
import { Panel, SecondaryButton, StatusPill } from "../shared/ui";
import {
  archiveTotals,
  buildStintSegments,
  driverStintTotals,
  drivenStints,
  formatLapTime,
  formatStintDuration,
  groupStintsByTeam,
  rankArchiveTeams,
} from "./archiveDetail";

/**
 * Archiefdetail van één afgeronde race: uitslag per team (rondes, snelste
 * ronde, stops, coureurs), de totalen en de stintverdeling op de klok.
 *
 * Presentatie-only: de cijfers komen binnen via props, zodat de pagina los van
 * Supabase te testen is.
 */
export type ArchiveRaceViewProps = {
  event: EnduranceEvent;
  teams: EnduranceArchiveTeam[];
  stints: EnduranceStintRow[];
  /** Profielnaam van een coureur; onbekend profiel valt terug op een eerlijke melding. */
  nameOf: (id: string) => string | undefined;
  onBack: () => void;
  loading?: boolean;
  error?: string | null;
};

const clock = (iso: string): string =>
  formatAmsterdam(iso, { dateStyle: undefined, timeStyle: undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
    <p className="mt-1 font-heading text-xl font-black text-white tabular-nums">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
  </div>
);

export const ArchiveRaceView = ({ event, teams, stints, nameOf, onBack, loading = false, error = null }: ArchiveRaceViewProps) => {
  const standings = rankArchiveTeams(teams);
  const totals = archiveTotals(standings);
  const stintsByTeam = groupStintsByTeam(drivenStints(stints));
  const hasTelemetry = totals.laps > 0 || totals.stops > 0 || totals.fastestLapSeconds != null;
  const teamsWithStints = standings.filter((team) => (stintsByTeam.get(team.teamId) ?? []).length > 0);

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="green">Afgerond</StatusPill>
              {event.configuration && <StatusPill>{event.configuration}</StatusPill>}
            </div>
            <h1 className="mt-3 font-heading text-2xl font-black text-white sm:text-3xl">{event.name}</h1>
            <p className="mt-1 text-sm text-gray-400">{event.circuit} · {formatAmsterdam(event.startAt)}</p>
          </div>
          <SecondaryButton onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Terug naar archief
          </SecondaryButton>
        </div>
      </Panel>

      {loading && <Panel><p className="text-sm text-gray-400">Uitslag laden…</p></Panel>}

      {!loading && error && (
        <Panel>
          <p role="alert" className="text-sm text-red-300">De uitslag kon niet geladen worden: {error}</p>
          <p className="mt-2 text-sm text-gray-400">Dit is geen lege race — probeer het zo opnieuw.</p>
        </Panel>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Teams" value={String(totals.teams)} />
            <Stat label="Rondes" value={String(totals.laps)} hint="alle teams samen" />
            <Stat label="Snelste ronde" value={formatLapTime(totals.fastestLapSeconds)} hint="snelste van de race" />
            <Stat label="Stops" value={String(totals.stops)} />
            <Stat label="Coureurs" value={String(totals.drivers)} />
          </div>

          <Panel>
            <div className="mb-4 flex items-center gap-2">
              <Flag className="h-4 w-4 text-orange-400" />
              <h2 className="font-heading text-xl font-black text-white">Uitslag</h2>
            </div>

            {!hasTelemetry && (
              <p className="text-sm text-gray-400">Geen telemetrie bewaard voor deze race. De uitslag kan niet uit de stint- en rondedata opgebouwd worden.</p>
            )}

            {hasTelemetry && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <caption className="sr-only">Uitslag per team met rondes, snelste ronde, stops en coureurs</caption>
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      <th scope="col" className="py-2 pr-3">#</th>
                      <th scope="col" className="py-2 pr-3">Team</th>
                      <th scope="col" className="py-2 pr-3 text-right">Rondes</th>
                      <th scope="col" className="py-2 pr-3 text-right">Snelste ronde</th>
                      <th scope="col" className="py-2 pr-3 text-right">Stops</th>
                      <th scope="col" className="py-2">Coureurs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((team) => (
                      <tr key={team.teamId} className="border-t border-white/5 align-top">
                        <td className="py-3 pr-3 font-heading font-black text-orange-300 tabular-nums">{team.position ?? "—"}</td>
                        <td className="py-3 pr-3">
                          <span className="font-bold text-white">{team.teamName}</span>
                          {team.carNumber && <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[11px] font-bold text-gray-300">#{team.carNumber}</span>}
                        </td>
                        <td className="py-3 pr-3 text-right font-bold text-white tabular-nums">{team.laps}</td>
                        <td className="py-3 pr-3 text-right text-gray-200 tabular-nums">{formatLapTime(team.bestLapSeconds)}</td>
                        <td className="py-3 pr-3 text-right text-gray-200 tabular-nums">{team.stops}</td>
                        <td className="py-3 text-gray-300">{team.drivers.length ? team.drivers.join(" · ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <div className="mb-1 flex items-center gap-2">
              <Timer className="h-4 w-4 text-orange-400" />
              <h2 className="font-heading text-xl font-black text-white">Stintverdeling</h2>
            </div>
            <p className="mb-4 text-sm text-gray-400">Wie reed wanneer, en hoe lang. De balk loopt van de start tot het einde van de race; gaten zijn momenten zonder stint.</p>

            {!teamsWithStints.length && (
              <p className="text-sm text-gray-400">Geen stints bewaard voor deze race.</p>
            )}

            <div className="space-y-6">
              {teamsWithStints.map((team) => {
                const teamStints = stintsByTeam.get(team.teamId) ?? [];
                const segments = buildStintSegments(teamStints, { startAt: event.startAt, endAt: event.endAt }, nameOf);
                const perDriver = driverStintTotals(segments);
                return (
                  <div key={team.teamId}>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-black text-white">{team.teamName}{team.carNumber ? ` · #${team.carNumber}` : ""}</h3>
                      <p className="text-xs text-gray-500">{teamStints.length} stint{teamStints.length === 1 ? "" : "s"} · {formatStintDuration(teamStints.reduce((sum, stint) => sum + stint.minutes, 0))} rijtijd</p>
                    </div>

                    <div className="relative h-8 w-full overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/5" role="img" aria-label={`Stintverdeling ${team.teamName}`}>
                      {segments.map((segment, index) => (
                        <div
                          key={segment.id}
                          className="absolute inset-y-0 border-r border-black/40"
                          style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%`, background: segment.color }}
                          title={`${index + 1}. ${segment.driverName} · ${clock(segment.startAt)}–${clock(segment.endAt)} (${formatStintDuration(segment.minutes)})`}
                        />
                      ))}
                    </div>

                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                      {perDriver.map((driver) => (
                        <li key={driver.driverId ?? "onbekend"} className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: driver.color }} aria-hidden="true" />
                          <span className="font-bold text-white">{driver.driverName}</span>
                          <span className="text-gray-400">{driver.stints} stint{driver.stints === 1 ? "" : "s"} · {formatStintDuration(driver.minutes)}</span>
                        </li>
                      ))}
                    </ul>

                    <ol className="mt-2 grid gap-1 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-3">
                      {segments.map((segment, index) => (
                        <li key={`${segment.id}-regel`} className="rounded-lg bg-black/20 px-2 py-1.5">
                          <span className="font-bold text-gray-300">#{index + 1}</span> {segment.driverName}
                          <span className="ml-1 tabular-nums">{clock(segment.startAt)}–{clock(segment.endAt)}</span>
                          <span className="ml-1 text-gray-500">({formatStintDuration(segment.minutes)})</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Rijtijd per coureur komt uit de stinttijden in de database.</span>
              <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Stops zijn de pitlane-rondes uit de telemetrie.</span>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
};
