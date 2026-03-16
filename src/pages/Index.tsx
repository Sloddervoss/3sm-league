import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import UpcomingRaces from "@/components/UpcomingRaces";
import StandingsPreview from "@/components/StandingsPreview";
import LatestResults from "@/components/LatestResults";
import ChampionshipLeader from "@/components/ChampionshipLeader";
import TopDrivers from "@/components/TopDrivers";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <HeroSection />
        <UpcomingRaces />
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
