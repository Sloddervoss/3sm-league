import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, ChevronRight } from "lucide-react";
import NewDriverCard from "@/components/preview/NewDriverCard";
import PreviewModal from "@/components/preview/PreviewModal";
import DriverModal from "@/components/preview/DriverModal";

const TopDrivers = () => {
  const [selectedDriver, setSelectedDriver] = useState<any>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: ["drivers"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("user_id, position, points, incidents");
      const map = new Map<string, { races: number; wins: number; podiums: number; points: number; incidents: number }>();
      data?.forEach((r: any) => {
        const e = map.get(r.user_id) || { races: 0, wins: 0, podiums: 0, points: 0, incidents: 0 };
        e.races++; e.points += r.points;
        if (r.position === 1) e.wins++;
        if (r.position <= 3) e.podiums++;
        e.incidents += r.incidents || 0;
        map.set(r.user_id, e);
      });
      return map;
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name, color, logo_url");
      return data || [];
    },
  });

  const sorted = [...profiles]
    .sort((a: any, b: any) => (stats?.get(b.user_id)?.points || 0) - (stats?.get(a.user_id)?.points || 0))
    .slice(0, 6);

  if (!sorted.length) return null;

  return (
    <section className="py-20" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-7xl">

        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Users className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Community</span>
            </div>
            <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">TOP COUREURS</h2>
          </div>
          <Link to="/drivers" className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-orange-500 transition-colors">
            Alle coureurs <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((driver: any, i: number) => (
            <NewDriverCard
              key={driver.user_id}
              driver={driver}
              stats={stats?.get(driver.user_id)}
              team={teams.find((t: any) => t.id === driver.team_id)}
              rank={i + 1}
              onSelect={() => setSelectedDriver(driver)}
            />
          ))}
        </div>
      </div>

      <PreviewModal open={!!selectedDriver} onClose={() => setSelectedDriver(null)}>
        {selectedDriver && <DriverModal driver={selectedDriver} />}
      </PreviewModal>
    </section>
  );
};

export default TopDrivers;
