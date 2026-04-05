import { motion } from "framer-motion";
import { Flag, Trophy, Clock, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const positionColors: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-300",
  3: "text-amber-600",
};

const LatestResults = () => {
  const { data: lastRace } = useQuery({
    queryKey: ["latest-completed-race"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name)")
        .eq("status", "completed")
        .order("race_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const { data: results } = useQuery({
    queryKey: ["latest-race-results", lastRace?.id],
    enabled: !!lastRace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name)")
        .eq("race_id", lastRace!.id)
        .order("position", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: penalties } = useQuery({
    queryKey: ["latest-race-penalties", lastRace?.id],
    enabled: !!lastRace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("penalties")
        .select("race_id, user_id, penalty_type, points_deduction")
        .eq("race_id", lastRace!.id);
      if (error) return [];
      return data as { race_id: string; user_id: string; penalty_type: string; points_deduction: number }[];
    },
  });

  if (!lastRace || !results?.length) return null;

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flag className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Laatste Race</span>
            </div>
            <h2 className="font-heading text-3xl md:text-4xl font-black">RACE UITSLAG</h2>
          </div>
          <Link to="/results" className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
            Alle uitslagen →
          </Link>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden racing-stripe-left overflow-x-auto">
          {/* Race header */}
          <div className="px-5 py-4 bg-secondary/30 border-b border-border">
            <h3 className="font-heading font-black text-lg">{lastRace.name}</h3>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-1">
              <span>{lastRace.track}</span>
              {(lastRace as any).leagues?.name && <span className="text-xs px-2 py-0.5 rounded bg-secondary">{(lastRace as any).leagues.name}</span>}
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{new Date(lastRace.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}</span>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-5 py-2.5 bg-secondary/20 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border min-w-[320px]">
            <span>Pos</span><span>Driver</span><span className="text-center hidden md:block">Best Lap</span><span className="text-center">Pts</span>
          </div>

          {results.map((result: any, i: number) => (
            <motion.div
              key={result.id}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-5 py-3 items-center border-b border-border/40 hover:bg-secondary/20 transition-colors min-w-[320px]"
            >
              <span className={`font-heading font-black text-xl ${positionColors[result.position] || "text-muted-foreground"}`}>
                {result.dnf ? "DNF" : result.position}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-heading font-bold truncate">{result.profiles?.display_name || result.profiles?.iracing_name || "Unknown"}</span>
                {result.fastest_lap && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold shrink-0">FL</span>}
              </div>
              <span className="text-center text-sm font-mono text-muted-foreground hidden md:block">{result.best_lap || "—"}</span>
              <span className="text-center font-heading font-black text-lg flex items-center justify-center gap-1">
                {result.points}
                {(() => {
                  const pen = penalties?.find((p) => p.race_id === result.race_id && p.user_id === result.user_id);
                  if (!pen || pen.penalty_type === "warning") return null;
                  const label = pen.penalty_type === "disqualification" ? "DSQ — Steward beslissing" : `-${pen.points_deduction} punt${pen.points_deduction !== 1 ? "en" : ""} — Steward beslissing`;
                  return (
                    <span className="group relative cursor-default">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-popover border border-border text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {label}
                      </span>
                    </span>
                  );
                })()}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LatestResults;
