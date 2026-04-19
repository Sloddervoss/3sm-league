import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import HeroSection from "@/components/HeroSection";
import NextRaceTeaser from "@/components/NextRaceTeaser";
import LatestResults from "@/components/LatestResults";
import ChampionshipLeader from "@/components/ChampionshipLeader";
import TopDrivers from "@/components/TopDrivers";
import StandingsStrip from "@/components/StandingsStrip";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <HeroSection />
        <NextRaceTeaser />
        <ChampionshipLeader />
        <LatestResults />
        <TopDrivers />
        <StandingsStrip />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
