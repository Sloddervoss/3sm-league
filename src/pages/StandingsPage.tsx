import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import StandingsPreview from "@/components/StandingsPreview";

const StandingsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <StandingsPreview />
      </main>
      <Footer />
    </div>
  );
};

export default StandingsPage;
