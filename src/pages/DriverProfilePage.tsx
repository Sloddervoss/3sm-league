/**
 * Coureursprofiel als volledige pagina (/drivers/<naam>).
 *
 * De popup op /drivers/ en /standings/ blijft de normale interactie; deze pagina
 * bestaat zodat een coureur een echte URL heeft die Google kan vinden en die je
 * kunt delen. De inhoud komt uit hetzelfde component als de popup, dus er is
 * één bron van waarheid en geen dubbele opmaak.
 */
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import DriverModal from "@/components/preview/DriverModal";
import { useDrivers } from "@/hooks/data/useSharedQueries";
import { driverDisplayName, driverSlug, setNoindex, clearNoindex } from "@/lib/entityLinks";
import { setSeoMeta } from "@/lib/seo";

const DriverProfilePage = () => {
  const { driverSlug: slugFromUrl } = useParams<{ driverSlug: string }>();
  const { data: profiles = [], isLoading } = useDrivers();

  const driver = useMemo(() => {
    const wanted = String(slugFromUrl || "").toLowerCase();
    return profiles.find((profile) => driverSlug(profile) === wanted) || null;
  }, [profiles, slugFromUrl]);

  useEffect(() => {
    if (isLoading) return;
    if (!driver) {
      setNoindex();
      setSeoMeta({
        title: "Coureur niet gevonden | 3 Stripe Motorsport",
        description: "Deze coureurspagina bestaat niet (meer). Bekijk het coureursoverzicht van 3 Stripe Motorsport.",
        canonicalUrl: "https://3stripemotorsport.cc/drivers/",
      });
      return;
    }
    clearNoindex();
    const name = driverDisplayName(driver);
    setSeoMeta({
      title: `${name} | 3SM coureur`,
      description: `Profiel van ${name}: team, iRating, overwinningen, podiums en race-uitslagen in de 3 Stripe Motorsport iRacing league.`,
      canonicalUrl: `https://3stripemotorsport.cc/drivers/${driverSlug(driver)}/`,
    });
  }, [driver, isLoading]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px] bg-[radial-gradient(circle_at_50%_38%,rgba(249,115,22,0.045),transparent_28%),linear-gradient(180deg,hsl(220,20%,7%)_0%,hsl(220,20%,7%)_100%)]">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <Link to="/drivers" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-gray-500 transition-colors hover:text-orange-500">
            <ArrowLeft className="h-3.5 w-3.5" /> Alle coureurs
          </Link>

          {isLoading ? (
            <div className="animate-pulse rounded-2xl bg-white/[0.03] p-10 text-center text-sm text-gray-500 ring-1 ring-white/[0.06]">Profiel laden...</div>
          ) : driver ? (
            <>
              <div className="mb-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500">
                <Users className="h-4 w-4" /> Coureur
              </div>
              <h1 className="mb-6 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">
                {driverDisplayName(driver)}
              </h1>
              <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <DriverModal driver={driver} />
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] p-10 text-center ring-1 ring-white/[0.06]">
              <p className="text-sm text-gray-400">Deze coureur staat niet (meer) in het overzicht.</p>
              <Link to="/drivers" className="mt-4 inline-block text-sm font-bold text-orange-500 hover:underline">
                Bekijk alle coureurs
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default DriverProfilePage;
