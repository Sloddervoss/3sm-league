import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import NewDriverCard from "@/components/preview/NewDriverCard";
import PreviewModal from "@/components/preview/PreviewModal";
import DriverModal from "@/components/preview/DriverModal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useTeams } from "@/hooks/data/useSharedQueries";
import { useState } from "react";
import { Users, Search } from "lucide-react";
import type { DriverModalProfile } from "@/lib/standingsTypes";
import type { Team } from "@/hooks/data/useSharedQueries";

type DriverStats = {
  races: number;
  wins: number;
  podiums: number;
  points: number;
  incidents: number;
};

type DriverResult = {
  user_id: string;
  position: number | null;
  points: number | null;
  incidents: number | null;
};

const DriversPage = () => {
  const [search, setSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<DriverModalProfile | null>(null);

  const { data: profiles = [], isLoading } = useDrivers();

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: async (): Promise<Map<string, DriverStats>> => {
      const { data } = await supabase
        .from("race_results")
        .select("user_id, position, points, incidents");
      const map = new Map<string, DriverStats>();
      ((data || []) as DriverResult[]).forEach((r) => {
        const e = map.get(r.user_id) || { races: 0, wins: 0, podiums: 0, points: 0, incidents: 0 };
        e.races++; e.points += r.points || 0;
        if (r.position === 1) e.wins++;
        if (r.position !== null && r.position <= 3) e.podiums++;
        e.incidents += r.incidents || 0;
        map.set(r.user_id, e);
      });
      return map;
    },
  });

  const { data: teams = [] } = useTeams();
  const drivers = profiles as DriverModalProfile[];
  const typedTeams = teams as Team[];

  const filtered = drivers.filter((p) =>
    !search || (p.display_name || p.iracing_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) =>
    (stats?.get(b.user_id)?.points || 0) - (stats?.get(a.user_id)?.points || 0)
  );

  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <div className="container mx-auto px-4 max-w-7xl py-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Community</span>
              </div>
              <h1 className="font-heading font-black text-4xl md:text-5xl text-white leading-none">COUREURS</h1>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Driver zoeken..."
                className="w-full pl-9 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#e5e7eb" }}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5,6].map((i) => (
                <div key={i} className="h-64 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }} />
              ))}
            </div>
          ) : !sorted.length ? (
            <div className="text-center py-24 text-gray-700">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-heading font-bold text-lg">Geen drivers gevonden</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((driver, i) => (
                <NewDriverCard
                  key={driver.user_id}
                  driver={driver}
                  stats={stats?.get(driver.user_id)}
                  team={typedTeams.find((t) => t.id === driver.team_id)}
                  rank={i + 1}
                  onSelect={() => setSelectedDriver(driver)}
                />
              ))}
            </div>
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

export default DriversPage;
