import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save } from "lucide-react";

const DEFAULT_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

type LeagueOption = { id: string; name: string; season: string | null };

const PointsAdmin = () => {
  const [selectedLeague, setSelectedLeague] = useState("");
  const [leaguePoints, setLeaguePoints] = useState<number[]>(DEFAULT_POINTS);

  const { data: savedPoints } = useQuery({
    queryKey: ["points-config", selectedLeague],
    enabled: !!selectedLeague,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("points_config")
        .select("position, points")
        .eq("league_id", selectedLeague)
        .order("position", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!selectedLeague) return;
    if (savedPoints && savedPoints.length > 0) {
      setLeaguePoints(savedPoints.map((r) => r.points));
    } else if (savedPoints) {
      setLeaguePoints(DEFAULT_POINTS);
    }
  }, [savedPoints, selectedLeague]);

  const { data: leagues = [] } = useQuery({
    queryKey: ["leagues-for-points"],
    queryFn: async (): Promise<LeagueOption[]> => {
      const { data, error } = await supabase.from("leagues").select("id, name, season");
      if (error) throw error;
      return data || [];
    },
  });

  const queryClient = useQueryClient();

  const savePointsConfig = useMutation({
    mutationFn: async () => {
      if (!selectedLeague) throw new Error("Selecteer een league");
      const leagueId = selectedLeague;
      const rows = leaguePoints.map((pts, i) => ({ league_id: leagueId, position: i + 1, points: pts }));
      const { error } = await supabase.from("points_config").upsert(rows, { onConflict: "league_id,position" });
      if (error) throw error;
      return { leagueId, rows: rows.map(({ position, points }) => ({ position, points })) };
    },
    onSuccess: ({ leagueId, rows }) => {
      queryClient.setQueryData(["points-config", leagueId], rows);
      toast.success("Punten systeem opgeslagen!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <h2 className="font-heading text-2xl font-black mb-6">PUNTEN SYSTEEM</h2>
      <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
        <div className="mb-6">
          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">League / Seizoen</label>
          <select
            value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}
            className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Kies een league...</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.season ? ` (${l.season})` : ""}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
          {leaguePoints.map((pts, i) => (
            <div key={i} className="bg-secondary/50 rounded-md p-3 border border-border">
              <div className="text-xs font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">P{i + 1}</div>
              <input
                type="number"
                min={0}
                value={pts}
                onChange={(e) => {
                  const updated = [...leaguePoints];
                  updated[i] = parseInt(e.target.value) || 0;
                  setLeaguePoints(updated);
                }}
                className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm font-heading font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap mb-6">
          <button
            onClick={() => savePointsConfig.mutate()}
            disabled={!selectedLeague || savePointsConfig.isPending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Save className="w-4 h-4" />
            {savePointsConfig.isPending ? "Opslaan..." : "Opslaan"}
          </button>
          <button
            onClick={() => setLeaguePoints(DEFAULT_POINTS)}
            className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors"
          >
            Reset standaard
          </button>
        </div>
        <div className="p-4 bg-secondary/30 rounded-md border border-border">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Standaard F1-stijl systeem</div>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_POINTS.map((p, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded bg-secondary">P{i + 1}: {p}</span>
            ))}
            <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">Fastest Lap: +1</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PointsAdmin;
