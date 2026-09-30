import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import { driverPath } from "@/lib/entityLinks";
import PreviewModal from "@/components/preview/PreviewModal";
import DriverModal from "@/components/preview/DriverModal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useTeams, useLeagues } from "@/hooks/data/useSharedQueries";
import { useState, useEffect } from "react";
import { Trophy } from "lucide-react";
import type { DriverModalProfile, StandingRow, StandingsProfile, StandingsRaceResult } from "@/lib/standingsTypes";
import { useLanguage } from "@/i18n/useLanguage";
import { setSeoMeta } from "@/lib/seo";
import { selectDefaultStandingsLeagueId, type StandingsSeasonRace } from "@/lib/standingsSeason";

const StandingsPage = () => {
  const { language } = useLanguage();

  useEffect(() => {
    setSeoMeta(language === "en"
      ? {
          title: "3SM Standings & Championship | 3 Stripe Motorsport",
          description: "View the current 3SM standings: championship points, positions, teams and driver performance in the iRacing league.",
          canonicalUrl: "https://3stripemotorsport.cc/standings/",
          ogTitle: "3SM Standings",
          ogDescription: "Current 3SM iRacing standings with points, positions, teams and drivers.",
        }
      : {
          title: "3SM Standings & Klassement | 3 Stripe Motorsport",
          description: "Bekijk de actuele 3SM standings: kampioenschapspunten, posities, teams en prestaties van coureurs in de iRacing league.",
          canonicalUrl: "https://3stripemotorsport.cc/standings/",
          ogTitle: "3SM Standings & Klassement",
          ogDescription: "Actuele 3SM iRacing standings met punten, posities, teams en coureurs.",
        });
  }, [language]);

  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DriverModalProfile | null>(null);

  const { data: leagues = [], isLoading: leaguesLoading } = useLeagues();
  const { data: teams = [] } = useTeams();
  const { data: profiles = [] } = useDrivers();

  const { data: seasonRaces = [], isLoading: seasonRacesLoading } = useQuery({
    queryKey: ["standings-season-schedule"],
    queryFn: async (): Promise<StandingsSeasonRace[]> => {
      // race_results(count) laat de default-keuze zien welk seizoen al uitslagen
      // heeft, zonder alle uitslagrijen op te halen.
      const { data, error } = await supabase
        .from("races")
        .select("league_id, race_date, status, race_results(count)")
        .not("league_id", "is", null);
      if (error) throw error;
      return (data || []) as unknown as StandingsSeasonRace[];
    },
  });

  const defaultLeagueId = seasonRacesLoading ? null : selectDefaultStandingsLeagueId(leagues, seasonRaces);
  const selectedId = activeLeagueId ?? defaultLeagueId;

  const { data: standingsRows = [], isLoading: standingsLoading } = useQuery({
    queryKey: ["standings-full", selectedId],
    enabled: !!selectedId,
    queryFn: async (): Promise<StandingRow[]> => {
      const { data: res } = await supabase
        .from("race_results")
        .select("user_id, position, points, fastest_lap, race_id, races(league_id)");
      const filtered = ((res || []) as StandingsRaceResult[]).filter((r) => r.races?.league_id === selectedId);
      const map = new Map<string, { total_points: number; wins: number; podiums: number; fl: number }>();
      filtered.forEach((r) => {
        const e = map.get(r.user_id) || { total_points: 0, wins: 0, podiums: 0, fl: 0 };
        e.total_points += r.points || 0;
        if (r.position === 1) e.wins++;
        if (r.position !== null && r.position <= 3) e.podiums++;
        if (r.fastest_lap) e.fl++;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      // Naam en team worden bij het renderen opgezocht uit useDrivers() en
      // useTeams(). Deze query haalt alleen de uitslagen op en hoeft dus niet op
      // die twee te wachten; de profiles-call die hier stond was dubbel werk,
      // want useDrivers() haalt dezelfde rijen al op (~200 ms, gemeten).
      return userIds.map((uid) => {
        const stats = map.get(uid)!;
        return {
          user_id: uid,
          display_name: "",
          total_points: stats.total_points,
          wins: stats.wins,
          podiums: stats.podiums,
          fl: stats.fl,
          team_id: undefined,
        };
      }).sort((a, b) =>
        b.total_points - a.total_points ||
        b.wins - a.wins ||
        (b.podiums || 0) - (a.podiums || 0) ||
        (b.fl || 0) - (a.fl || 0)
      );
    },
  });

  // De teamnaam en -kleur worden pas bij het renderen opgezocht. Ze zijn geen
  // invoer voor de query zelf: die had alleen het league-id nodig. Door de
  // opzoeking hier te doen hoeft de uitslagquery niet te wachten op `teams`,
  // dat een eigen, trage round-trip is.
  const profielPerUser = new Map((profiles as { user_id: string; display_name?: string; team_id?: string }[])
    .map((p) => [p.user_id, p]));
  const teamPerId = new Map(teams.map((t) => [t.id, t]));
  const standings = standingsRows.map((row) => {
    const prof = profielPerUser.get(row.user_id);
    const team = teamPerId.get(prof?.team_id ?? "");
    return {
      ...row,
      display_name: prof?.display_name || "Unknown",
      team_id: prof?.team_id,
      team: team ? { name: team.name, color: team.color } : undefined,
    };
  });

  const selectedLeague = leagues.find((l) => l.id === selectedId);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px] bg-[radial-gradient(circle_at_50%_38%,rgba(249,115,22,0.045),transparent_28%),linear-gradient(180deg,hsl(220,20%,7%)_0%,hsl(220,20%,7%)_100%)]">
        <div className="container mx-auto px-4 max-w-5xl py-12">

          {/* Header */}
          <div className="mb-5 md:mb-7">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500"><Trophy className="h-4 w-4" /> Championship</div>
            <h1 className="mt-2 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">Coureurs stand</h1>
          </div>

          {/* League tabs. Het laadskelet staat in dezelfde conditie als de echte
              balk: staan ze naast elkaar, dan duwt de echte balk het skelet en
              alles eronder 74 px opzij (gemeten CLS 0,0538). */}
          {leagues.length > 1 ? (
            <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
              {leagues.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLeagueId(l.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all shrink-0"
                  style={
                    selectedId === l.id
                      ? { background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)", color: "#f97316" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#6b7280" }
                  }
                >
                  {l.name}
                  {l.season && <span className="text-xs opacity-60">{l.season}</span>}
                </button>
              ))}
            </div>
          ) : (leaguesLoading || seasonRacesLoading || standingsLoading) ? (
            <div className="mb-8 h-[42px] animate-pulse rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]" aria-hidden="true" />
          ) : null}

          {/* Tijdens het laden een skelet met de gemeten hoogte van alles wat er
              komt: de seizoensbalk (42 px), de tussenruimte (32 px) en de kaart
              (1026 px mobiel / 1018 px desktop) = 1100 / 1092 px. Zonder dat
              groeide het vlak na het laden met 738 px. En: de lege staat van de
              tabel ('Nog geen resultaten beschikbaar') verscheen hier voorheen
              terwijl de uitslagen nog onderweg waren, want de uitslagenquery had
              geen laadvlag. */}
          {/* Kaartskelet op de gemeten hoogte (1026 px mobiel / 1018 px desktop).
              Ook zichtbaar terwijl de uitslagen zelf nog laden: voorheen viel de
              pagina terug op de lege staat van de tabel ('Nog geen resultaten
              beschikbaar') omdat de uitslagenquery geen laadvlag had. */}
          {seasonRacesLoading || standingsLoading ? (
            <div className="animate-pulse rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] min-h-[1026px] lg:min-h-[1018px]" role="status" aria-label="Standings laden" />
          ) : (
            <NewStandingsTable
              standings={standings}
              leagueName={selectedLeague?.name}
              variant="page"
              onSelectDriver={(uid) => {
                const driver = (profiles as DriverModalProfile[]).find((p) => p.user_id === uid);
                if (driver) setSelectedDriver(driver);
              }}
              driverHref={(uid) => {
                const driver = (profiles as DriverModalProfile[]).find((p) => p.user_id === uid);
                return driver ? driverPath(driver) : undefined;
              }}
            />
          )}
        </div>
      </main>
      <Footer />

      <PreviewModal open={!!selectedDriver} onClose={() => setSelectedDriver(null)}>
        {selectedDriver && <DriverModal driver={selectedDriver} />}
      </PreviewModal>
    </div>
  );
};

export default StandingsPage;
