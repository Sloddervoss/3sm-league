import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import StandingsPreview from "@/components/StandingsPreview";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Trophy } from "lucide-react";

const StandingsPage = () => {
  const { data: leagues } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leagues")
        .select("id, name, season, car_class")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  const selectedId = activeLeagueId ?? leagues?.[0]?.id ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Championship</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black">DRIVER STANDINGS</h1>
          </div>
        </section>

        {leagues && leagues.length > 1 && (
          <div className="border-b border-border bg-card/30 sticky top-16 z-40">
            <div className="container mx-auto px-4">
              <div className="flex overflow-x-auto gap-1 py-2">
                {leagues.map((l: any) => (
                  <button
                    key={l.id}
                    onClick={() => setActiveLeagueId(l.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      selectedId === l.id
                        ? "bg-gradient-racing text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    {l.name}
                    {l.season && <span className="text-xs opacity-70">{l.season}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedId && <StandingsPreview leagueId={selectedId} />}
      </main>
      <Footer />
    </div>
  );
};

export default StandingsPage;
