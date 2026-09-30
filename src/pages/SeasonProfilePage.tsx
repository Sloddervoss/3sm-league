/**
 * Seizoenspagina (/seasons/<naam-seizoen>).
 *
 * Dit is ook het antwoord op de groeigrens uit de structuur-analyse: de hubs
 * tonen een afgekapte lijst ("eerste 25 van N"), terwijl een seizoen zijn eigen
 * volledige stand en volledige uitslagenlijst houdt. Zo blijft elke uitslag
 * bereikbaar zonder dat een hub onbeperkt groeit.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Trophy } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useDriverNameMap, useLeagues } from "@/hooks/data/useSharedQueries";
import { driverPath, driverSlug, seasonLabel, seasonSlug, setNoindex, clearNoindex } from "@/lib/entityLinks";
import { setSeoMeta } from "@/lib/seo";

interface SeasonRace {
  id: string;
  name: string | null;
  track: string | null;
  race_date: string | null;
  round: number | null;
  status: string | null;
  race_results: { position: number | null; points: number | null; fastest_lap: boolean | null; user_id: string | null }[] | null;
}

const formatDateNl = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
};

const SeasonProfilePage = () => {
  const { seasonSlug: slugFromUrl } = useParams<{ seasonSlug: string }>();
  const navigate = useNavigate();
  const { data: leagues = [], isLoading: leaguesLoading } = useLeagues();
  const { data: profiles = [] } = useDrivers();
  const driverNames = useDriverNameMap();

  const league = useMemo(() => {
    const wanted = String(slugFromUrl || "").toLowerCase();
    return leagues.find((candidate) => seasonSlug(candidate) === wanted) || null;
  }, [leagues, slugFromUrl]);

  const { data: races = [], isLoading: racesLoading } = useQuery({
    queryKey: ["season-races", league?.id],
    enabled: Boolean(league?.id),
    queryFn: async (): Promise<SeasonRace[]> => {
      const { data } = await supabase
        .from("races")
        .select("id,name,track,race_date,round,status,race_results(position,points,fastest_lap,user_id)")
        .eq("league_id", league!.id)
        .order("race_date", { ascending: true });
      return (data || []) as SeasonRace[];
    },
  });

  const standings = useMemo(() => {
    const byUser = new Map<string, { user_id: string; display_name: string; total_points: number; wins: number }>();
    for (const race of races) {
      if (race.status !== "completed") continue;
      for (const result of race.race_results || []) {
        if (!result.user_id) continue;
        const entry = byUser.get(result.user_id) || {
          user_id: result.user_id,
          display_name: driverNames.get(result.user_id) || "Onbekende coureur",
          total_points: 0,
          wins: 0,
        };
        entry.total_points += result.points || 0;
        if (result.position === 1) entry.wins += 1;
        byUser.set(result.user_id, entry);
      }
    }
    return [...byUser.values()].sort((a, b) => b.total_points - a.total_points || b.wins - a.wins);
  }, [races, driverNames]);

  // Op deze nieuwe pagina opent een klik op een coureur diens profielpagina in
  // plaats van een popup: op /standings/ en /drivers/ blijft de popup zoals hij
  // was, hier is er nog geen popup om te verliezen.
  const openDriver = (userId: string) => {
    const profile = profiles.find((candidate) => candidate.user_id === userId);
    if (profile) navigate(driverPath(profile));
  };

  const label = league ? seasonLabel(league) : "";
  const completedRaces = races.filter((race) => race.status === "completed");

  useEffect(() => {
    if (leaguesLoading) return;
    if (!league) {
      setNoindex();
      setSeoMeta({
        title: "Seizoen niet gevonden | 3 Stripe Motorsport",
        description: "Dit seizoen bestaat niet (meer). Bekijk het seizoenoverzicht van 3 Stripe Motorsport.",
        canonicalUrl: "https://3stripemotorsport.cc/seasons/",
      });
      return;
    }
    clearNoindex();
    setSeoMeta({
      title: `${label} | 3SM seizoen`,
      description: `Seizoen ${label} van 3 Stripe Motorsport: stand, uitslagen en kalender van de iRacing league.`,
      canonicalUrl: `https://3stripemotorsport.cc/seasons/${seasonSlug(league)}/`,
    });
  }, [league, leaguesLoading, label]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px] bg-[radial-gradient(circle_at_50%_38%,rgba(249,115,22,0.045),transparent_28%),linear-gradient(180deg,hsl(220,20%,7%)_0%,hsl(220,20%,7%)_100%)]">
        <div className="container mx-auto max-w-5xl px-4 py-12">
          <Link to="/seasons" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-gray-500 transition-colors hover:text-orange-500">
            <ArrowLeft className="h-3.5 w-3.5" /> Alle seizoenen
          </Link>

          {leaguesLoading ? (
            <div className="animate-pulse rounded-2xl bg-white/[0.03] p-10 text-center text-sm text-gray-500 ring-1 ring-white/[0.06]">Seizoen laden...</div>
          ) : league ? (
            <>
              <div className="mb-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500">
                <Trophy className="h-4 w-4" /> Seizoen
              </div>
              <h1 className="mb-2 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">{label}</h1>
              <p className="mb-8 text-sm text-gray-500">
                {completedRaces.length} van {races.length} races verreden
                {league.car_class ? ` · ${league.car_class}` : ""}
              </p>

              <section className="mb-12">
                <h2 className="mb-4 font-heading text-xl font-black uppercase text-white">Stand</h2>
                {standings.length > 0 ? (
                  <NewStandingsTable
                    standings={standings}
                    leagueName={label}
                    variant="page"
                    onSelectDriver={openDriver}
                    driverHref={(userId) => {
                      const profile = profiles.find((candidate) => candidate.user_id === userId);
                      return profile ? driverPath(profile) : undefined;
                    }}
                  />
                ) : (
                  <p className="rounded-2xl bg-white/[0.03] p-6 text-sm text-gray-500 ring-1 ring-white/[0.06]">Nog geen uitslagen in dit seizoen.</p>
                )}
              </section>

              <section>
                <h2 className="mb-4 font-heading text-xl font-black uppercase text-white">Races</h2>
                {racesLoading ? (
                  <p className="text-sm text-gray-500">Races laden...</p>
                ) : (
                  <ul className="space-y-2">
                    {races.map((race) => {
                      const winner = (race.race_results || []).find((result) => result.position === 1);
                      const profile = winner?.user_id ? profiles.find((candidate) => candidate.user_id === winner.user_id) : null;
                      return (
                        <li key={race.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
                          <Link to={`/results/${race.id}`} className="flex items-center gap-3 text-sm text-white transition-colors hover:text-orange-500">
                            <CalendarDays className="h-4 w-4 text-orange-500" />
                            <span className="font-medium">{race.name || "Race"}</span>
                            {race.track && <span className="text-gray-500">· {race.track}</span>}
                          </Link>
                          <span className="text-xs text-gray-500">
                            {formatDateNl(race.race_date)}
                            {race.status === "completed" ? (
                              winner?.user_id ? (
                                <>
                                  {" · winnaar "}
                                  {profile ? (
                                    <Link to={driverPath(profile)} className="text-gray-300 hover:text-orange-500">
                                      {driverNames.get(winner.user_id) || "onbekend"}
                                    </Link>
                                  ) : (
                                    driverNames.get(winner.user_id) || "onbekend"
                                  )}
                                </>
                              ) : (
                                " · uitslag"
                              )
                            ) : (
                              " · gepland"
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] p-10 text-center ring-1 ring-white/[0.06]">
              <p className="text-sm text-gray-400">Dit seizoen staat niet (meer) in het overzicht.</p>
              <Link to="/seasons" className="mt-4 inline-block text-sm font-bold text-orange-500 hover:underline">
                Bekijk alle seizoenen
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default SeasonProfilePage;
