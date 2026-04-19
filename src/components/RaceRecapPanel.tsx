import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Flag, ChevronRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type RecapRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  leagues: { name: string } | null;
};

type RecapResult = {
  id: string;
  race_id: string;
  user_id: string;
  position: number | null;
  points: number | null;
  dnf: boolean | null;
  fastest_lap: boolean | null;
  best_lap: string | null;
  incidents: number | null;
  gap_to_leader: string | null;
  profiles: { display_name: string | null; iracing_name: string | null } | null;
};

const PODIUM_COLORS = [
  { text: "#facc15", bg: "rgba(250,204,21,0.10)", border: "rgba(250,204,21,0.25)" },
  { text: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.20)" },
  { text: "#d97706", bg: "rgba(217,119,6,0.08)",   border: "rgba(217,119,6,0.20)"  },
];

const driverName = (r: RecapResult) =>
  r.profiles?.display_name || r.profiles?.iracing_name || "Onbekend";

const RaceRecapPanel = () => {
  const { data: lastRace } = useQuery({
    queryKey: ["latest-completed-race"],
    queryFn: async (): Promise<RecapRace | null> => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name)")
        .eq("status", "completed")
        .order("race_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as RecapRace | null;
    },
  });

  const { data: results = [] } = useQuery({
    queryKey: ["latest-race-results", lastRace?.id],
    enabled: !!lastRace?.id,
    queryFn: async (): Promise<RecapResult[]> => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name)")
        .eq("race_id", lastRace!.id)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as RecapResult[];
    },
  });

  if (!lastRace || !results.length) return null;

  const finishers = results.filter((r) => !r.dnf);
  const podium = finishers.slice(0, 3);
  const fastest = results.find((r) => r.fastest_lap);
  const dnfCount = results.filter((r) => r.dnf).length;

  const finishersWithInc = finishers.filter((r) => r.incidents != null);
  const cleanest = finishersWithInc.length
    ? finishersWithInc.reduce((best, r) =>
        (r.incidents ?? 0) < (best.incidents ?? 0) ||
        ((r.incidents ?? 0) === (best.incidents ?? 0) && (r.position ?? 99) < (best.position ?? 99))
          ? r : best
      )
    : null;

  const totalInc = results.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
  const hasIncData = results.some((r) => r.incidents != null);

  const dateStr = new Date(lastRace.race_date).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Amsterdam",
  });

  return (
    <section className="py-20" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-7xl">

        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Flag className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Laatste Race</span>
            </div>
            <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">
              RACE RECAP
            </h2>
          </div>
          <Link
            to="/results"
            className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-orange-500 transition-colors"
          >
            Alle uitslagen <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #111118 0%, #0d0d14 100%)",
            border: "1px solid rgba(249,115,22,0.15)",
          }}
        >
          <div className="h-0.5" style={{ background: "linear-gradient(90deg, #f97316, transparent)" }} />

          {/* Race meta */}
          <div
            className="px-6 py-4 flex flex-wrap items-center gap-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <h3 className="font-heading font-black text-lg text-white">{lastRace.name}</h3>
            {lastRace.leagues?.name && (
              <span
                className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}
              >
                {lastRace.leagues.name}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-sm text-gray-500 ml-auto">
              <Clock className="w-3.5 h-3.5" />
              <span>{lastRace.track}</span>
              <span className="text-gray-700">·</span>
              <span>{dateStr}</span>
            </div>
          </div>

          {/* Podium + highlights */}
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">

            {/* Podium */}
            <div className="p-6">
              <div className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-4">Podium</div>
              <div className="space-y-2.5">
                {podium.map((r, i) => {
                  const c = PODIUM_COLORS[i];
                  return (
                    <div
                      key={r.user_id}
                      className="flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ background: c.bg, border: `1px solid ${c.border}` }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm shrink-0"
                        style={{ background: `${c.text}20`, color: c.text }}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-heading font-bold text-sm text-white truncate">
                          {driverName(r)}
                        </div>
                        {i > 0 && r.gap_to_leader && (
                          <div className="text-[10px] text-gray-600">+{r.gap_to_leader}</div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-heading font-black text-base" style={{ color: c.text }}>
                          {r.points}
                        </div>
                        <div className="text-[10px] text-gray-700">pts</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Highlights */}
            <div className="p-6">
              <div className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-4">Highlights</div>
              <div className="space-y-3">

                {fastest && (
                  <div
                    className="flex items-start gap-3 rounded-xl px-4 py-3"
                    style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
                  >
                    <span className="text-base shrink-0 leading-none mt-0.5">⚡</span>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-0.5">
                        Snelste ronde
                      </div>
                      <div className="font-heading font-bold text-sm text-white truncate">{driverName(fastest)}</div>
                      {fastest.best_lap && (
                        <div className="text-[11px] font-mono text-purple-300 mt-0.5">{fastest.best_lap}</div>
                      )}
                    </div>
                  </div>
                )}

                {cleanest && (
                  <div
                    className="flex items-start gap-3 rounded-xl px-4 py-3"
                    style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}
                  >
                    <span className="text-base shrink-0 leading-none mt-0.5">🧊</span>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-green-500 uppercase tracking-widest mb-0.5">
                        Clean drive
                      </div>
                      <div className="font-heading font-bold text-sm text-white truncate">{driverName(cleanest)}</div>
                      <div className="text-[11px] text-green-400 mt-0.5">{cleanest.incidents} inc</div>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div
                  className="flex items-center gap-4 rounded-xl px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="text-center">
                    <div className="font-heading font-black text-lg text-white leading-none">{finishers.length}</div>
                    <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">Finishers</div>
                  </div>
                  {dnfCount > 0 && (
                    <>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <div className="font-heading font-black text-lg text-red-400 leading-none">{dnfCount}</div>
                        <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">DNF</div>
                      </div>
                    </>
                  )}
                  {hasIncData && (
                    <>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <div className="font-heading font-black text-lg text-orange-400 leading-none">{totalInc}</div>
                        <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">Incidents</div>
                      </div>
                    </>
                  )}
                </div>

              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};

export default RaceRecapPanel;
