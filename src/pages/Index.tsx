import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import NextRaceTeaser from "@/components/NextRaceTeaser";
import StickyRaceBar from "@/components/StickyRaceBar";
import StandingsPreview from "@/components/StandingsPreview";
import LatestResults from "@/components/LatestResults";
import ChampionshipLeader from "@/components/ChampionshipLeader";
import TopDrivers from "@/components/TopDrivers";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-16">
        <HeroSection />
        <NextRaceTeaser />
        <ChampionshipLeader />
        <LatestResults />
        <TopDrivers />
        <StandingsPreview />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
