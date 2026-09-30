/**
 * Teampagina (/teams/<naam>).
 *
 * Zelfde aanpak als de coureurspagina: de popup blijft de normale interactie op
 * /teams/, deze pagina geeft het team een echte deelbare URL. De inhoud komt uit
 * TeamModal, zodat er geen tweede versie van dezelfde opmaak ontstaat.
 */
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import TeamModal from "@/components/preview/TeamModal";
import { useTeams } from "@/hooks/data/useSharedQueries";
import { teamSlug, setNoindex, clearNoindex } from "@/lib/entityLinks";
import { setSeoMeta } from "@/lib/seo";

const TeamProfilePage = () => {
  const { teamSlug: slugFromUrl } = useParams<{ teamSlug: string }>();
  const { data: teams = [], isLoading } = useTeams();

  const team = useMemo(() => {
    const wanted = String(slugFromUrl || "").toLowerCase();
    return teams.find((candidate) => teamSlug(candidate) === wanted) || null;
  }, [teams, slugFromUrl]);

  useEffect(() => {
    if (isLoading) return;
    if (!team) {
      setNoindex();
      setSeoMeta({
        title: "Team niet gevonden | 3 Stripe Motorsport",
        description: "Dit teampagina bestaat niet (meer). Bekijk het teamoverzicht van 3 Stripe Motorsport.",
        canonicalUrl: "https://3stripemotorsport.cc/teams/",
      });
      return;
    }
    clearNoindex();
    setSeoMeta({
      title: `${team.name} | 3SM team`,
      description: `Team ${team.name} in de 3 Stripe Motorsport iRacing league: coureurs, punten, overwinningen en podiums.`,
      canonicalUrl: `https://3stripemotorsport.cc/teams/${teamSlug(team)}/`,
    });
  }, [team, isLoading]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px] bg-[radial-gradient(circle_at_50%_38%,rgba(249,115,22,0.045),transparent_28%),linear-gradient(180deg,hsl(220,20%,7%)_0%,hsl(220,20%,7%)_100%)]">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <Link to="/teams" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-gray-500 transition-colors hover:text-orange-500">
            <ArrowLeft className="h-3.5 w-3.5" /> Alle teams
          </Link>

          {isLoading ? (
            <div className="animate-pulse rounded-2xl bg-white/[0.03] p-10 text-center text-sm text-gray-500 ring-1 ring-white/[0.06]">Team laden...</div>
          ) : team ? (
            <>
              <div className="mb-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500">
                <Shield className="h-4 w-4" /> Team
              </div>
              <h1 className="mb-6 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">{team.name}</h1>
              <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <TeamModal team={{ ...team, color: team.color || "#f97316" }} />
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] p-10 text-center ring-1 ring-white/[0.06]">
              <p className="text-sm text-gray-400">Dit team staat niet (meer) in het overzicht.</p>
              <Link to="/teams" className="mt-4 inline-block text-sm font-bold text-orange-500 hover:underline">
                Bekijk alle teams
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TeamProfilePage;
