import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import UpcomingRaces from "@/components/UpcomingRaces";

const CalendarPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <UpcomingRaces />
      </main>
      <Footer />
    </div>
  );
};

export default CalendarPage;
