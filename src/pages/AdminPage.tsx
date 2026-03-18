import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Trophy, Calendar, Trash2, Settings, Users, Car, Shield, BarChart2, Upload, Save, FileText, X, Check, ImagePlus, Clock, Pencil } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

type AdminTab = "overview" | "seasons" | "teams" | "results" | "points" | "drivers";

const DEFAULT_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const IRACING_TRACKS = [
  // Autodromo Enzo e Dino Ferrari
  "Autodromo Enzo e Dino Ferrari (Imola) - Grand Prix",
  // Autodromo Nazionale Monza
  "Autodromo Nazionale Monza - Grand Prix",
  "Autodromo Nazionale Monza - Junior",
  // Autódromo José Carlos Pace
  "Autódromo José Carlos Pace (Interlagos) - Grand Prix",
  "Autódromo José Carlos Pace (Interlagos) - Short",
  // Mugello
  "Autodromo Internazionale del Mugello - Grand Prix",
  // Barcelona
  "Circuit de Barcelona-Catalunya - Grand Prix",
  "Circuit de Barcelona-Catalunya - National",
  "Circuit de Barcelona-Catalunya - School",
  // Brands Hatch
  "Brands Hatch - Grand Prix",
  "Brands Hatch - Indy",
  // Le Mans
  "Circuit de la Sarthe - 24h Circuit",
  "Circuit de la Sarthe - 24h Circuit (No Chicanes)",
  // Monaco
  "Circuit de Monaco - Grand Prix",
  // Spa
  "Circuit de Spa-Francorchamps - Grand Prix",
  "Circuit de Spa-Francorchamps - Raidillon",
  // Gilles Villeneuve
  "Circuit Gilles Villeneuve - Grand Prix",
  // COTA
  "Circuit of the Americas - Grand Prix",
  // Paul Ricard
  "Circuit Paul Ricard - Grand Prix",
  "Circuit Paul Ricard - Mistral Chicane",
  "Circuit Paul Ricard - Short Chicane",
  // Zandvoort
  "Circuit Zandvoort - Grand Prix",
  "Circuit Zandvoort - Club",
  // Daytona
  "Daytona International Speedway - Oval",
  "Daytona International Speedway - Road Course",
  // Donington Park
  "Donington Park - Grand Prix",
  "Donington Park - National",
  // Fuji
  "Fuji International Speedway - Grand Prix",
  // Hockenheim
  "Hockenheimring Baden-Württemberg - Grand Prix",
  "Hockenheimring Baden-Württemberg - National",
  "Hockenheimring Baden-Württemberg - Short",
  // Hungaroring
  "Hungaroring - Grand Prix",
  // Indianapolis
  "Indianapolis Motor Speedway - Oval",
  "Indianapolis Motor Speedway - Road Course",
  // Kyalami
  "Kyalami Grand Prix Circuit - Grand Prix",
  // Laguna Seca
  "WeatherTech Raceway Laguna Seca - Full",
  // Lime Rock
  "Lime Rock Park - Full",
  "Lime Rock Park - Short",
  // Mid-Ohio
  "Mid-Ohio Sports Car Course - Full",
  "Mid-Ohio Sports Car Course - Short",
  // Nürburgring
  "Nürburgring - Combined",
  "Nürburgring GP-Strecke - Grand Prix",
  "Nürburgring GP-Strecke - Sprint",
  "Nürburgring Nordschleife - Nordschleife",
  "Nürburgring Nordschleife - Nordschleife + GP-Strecke",
  // Okayama
  "Okayama International Circuit - Full",
  "Okayama International Circuit - Short",
  // Oulton Park
  "Oulton Park - Fosters",
  "Oulton Park - International",
  "Oulton Park - Island",
  // Phoenix
  "Phoenix Raceway - Oval",
  "Phoenix Raceway - Road Course",
  // Portimão
  "Autodromo Internacional do Algarve (Portimão) - Grand Prix",
  // Red Bull Ring
  "Red Bull Ring - Grand Prix",
  "Red Bull Ring - National",
  // Road America
  "Road America - Full",
  // Road Atlanta
  "Road Atlanta - Full",
  "Road Atlanta - Short",
  // Sebring
  "Sebring International Raceway - Full",
  "Sebring International Raceway - Short",
  // Silverstone
  "Silverstone Circuit - Grand Prix",
  "Silverstone Circuit - International",
  "Silverstone Circuit - National",
  // Snetterton
  "Snetterton Circuit - 100",
  "Snetterton Circuit - 200",
  "Snetterton Circuit - 300",
  // Suzuka
  "Suzuka Circuit - Grand Prix",
  "Suzuka Circuit - East",
  // VIR
  "Virginia International Raceway - Full",
  "Virginia International Raceway - North",
  "Virginia International Raceway - Patriot",
  "Virginia International Raceway - South",
  // Watkins Glen
  "Watkins Glen International - Boot",
  "Watkins Glen International - Grand Prix",
  "Watkins Glen International - Short",
  // Zolder
  "Zolder - Grand Prix",
  // Assen
  "TT Circuit Assen - Grand Prix",
  // Bahrain
  "Bahrain International Circuit - Grand Prix",
  "Bahrain International Circuit - Outer",
  // Charlotte
  "Charlotte Motor Speedway - Oval",
  "Charlotte Motor Speedway - Roval",
].sort();

const DriversList = () => {
  const queryClient = useQueryClient();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-all-profiles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_get_all_profiles");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_get_user_roles");
      if (error) throw error;
      return data || [];
    },
  });

  const isAdmin = (userId: string) =>
    (userRoles || []).some((r: any) => r.user_id === userId && r.role === "admin");

  const toggleAdmin = useMutation({
    mutationFn: async ({ userId, grant }: { userId: string; grant: boolean }) => {
      const fn = grant ? "admin_grant_role" : "admin_revoke_role";
      const { error } = await (supabase as any).rpc(fn, { target_user_id: userId, target_role: "admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDriver = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase as any).rpc("admin_delete_user", { target_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Driver verwijderd");
      queryClient.invalidateQueries({ queryKey: ["admin-all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-card rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_8rem_6rem_5rem_5rem_3rem] gap-3 px-4 py-2.5 bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span>Driver</span>
        <span>iRacing ID</span>
        <span>iRating</span>
        <span>Safety</span>
        <span>Admin</span>
        <span></span>
      </div>
      {profiles?.map((p: any) => {
        const admin = isAdmin(p.user_id);
        return (
          <div key={p.user_id} className="grid grid-cols-[1fr_8rem_6rem_5rem_5rem_3rem] gap-3 px-4 py-3 items-center border-b border-border/40 hover:bg-secondary/20 transition-colors">
            <div>
              <div className="font-heading font-bold text-sm">{p.display_name || p.iracing_name || "—"}</div>
              {p.iracing_name && p.display_name !== p.iracing_name && (
                <div className="text-xs text-muted-foreground">{p.iracing_name}</div>
              )}
            </div>
            <span className="text-xs font-mono text-muted-foreground">{p.iracing_id || "—"}</span>
            <span className="text-sm font-heading font-bold">{p.irating ? p.irating.toLocaleString() : "—"}</span>
            <span className="text-sm text-muted-foreground">{p.safety_rating || "—"}</span>
            <button
              onClick={() => toggleAdmin.mutate({ userId: p.user_id, grant: !admin })}
              disabled={toggleAdmin.isPending}
              className={`text-xs px-2 py-1 rounded font-bold transition-colors ${admin ? "bg-accent/20 text-accent border border-accent/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30" : "bg-secondary text-muted-foreground border border-border hover:bg-accent/10 hover:text-accent"}`}
            >
              {admin ? "Admin" : "—"}
            </button>
            <button
              onClick={() => {
                if (confirm(`Weet je zeker dat je ${p.display_name || p.iracing_name} wilt verwijderen?`)) {
                  deleteDriver.mutate(p.user_id);
                }
              }}
              disabled={deleteDriver.isPending}
              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      {!profiles?.length && (
        <div className="py-12 text-center text-muted-foreground text-sm">Geen drivers gevonden.</div>
      )}
    </div>
  );
};

const AdminPage = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const [newLeague, setNewLeague] = useState({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
  const [races, setRaces] = useState<{ name: string; track: string; date: string; time: string; race_type: string; race_duration: string; practice_duration: string; qualifying_duration: string; start_type: string; weather: string }[]>([]);
  const [showLeagueForm, setShowLeagueForm] = useState(false);
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);
  const [editingLeagueData, setEditingLeagueData] = useState({ name: "", description: "", season: "", car_class: "" });

  const [newTeam, setNewTeam] = useState({ name: "", description: "", color: "#f97316", logo_url: "" });
  const [newTeamLogoPreview, setNewTeamLogoPreview] = useState<string>("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamLogo, setEditingTeamLogo] = useState<string>("");
  const [editingTeamCurrentLogo, setEditingTeamCurrentLogo] = useState<string>("");
  const [showTeamForm, setShowTeamForm] = useState(false);

  const [importRaceId, setImportRaceId] = useState("");
  const [importRows, setImportRows] = useState<
    { position: number; display_name: string; laps: number; best_lap: string; incidents: number; fastest_lap: boolean; iracing_cust_id?: string; new_irating?: number; new_license_level?: number; new_license_sub_level?: number }[]
  >([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]);
  const [pointsConfig] = useState<number[]>(DEFAULT_POINTS);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"manual" | "csv">("csv");

  const [selectedLeagueForPoints, setSelectedLeagueForPoints] = useState("");
  const [leaguePoints, setLeaguePoints] = useState<number[]>(DEFAULT_POINTS);

  const { data: leagues } = useQuery({
    queryKey: ["admin-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leagues").select("*, races(*)");
      if (error) throw error;
      return data;
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name, description, color, created_at, team_memberships(id, user_id, profiles(display_name, iracing_name))");
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, display_name, iracing_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("races").select("id, name, track, race_date, league_id, status, leagues(name)").order("race_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: totalDrivers } = useQuery({
    queryKey: ["total-drivers"],
    queryFn: async () => {
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: seasonRegistrations } = useQuery({
    queryKey: ["admin-season-registrations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("season_registrations")
        .select("league_id, user_id, status, created_at");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: creationRequests } = useQuery({
    queryKey: ["team-creation-requests"],
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("team_creation_requests")
        .select("*, profiles(display_name, iracing_name)")
        .eq("status", "pending");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: totalResults } = useQuery({
    queryKey: ["total-results"],
    queryFn: async () => {
      const { count } = await supabase.from("race_results").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const createLeague = useMutation({
    mutationFn: async () => {
      const { data: league, error } = await supabase
        .from("leagues")
        .insert({ name: newLeague.name, description: newLeague.description, season: newLeague.season, car_class: newLeague.car_class, created_by: user!.id })
        .select().single();
      if (error) throw error;
      if (races.length > 0) {
        const { error: re } = await supabase.from("races").insert(
          races.map((r, i) => ({ league_id: league.id, round: i + 1, name: r.name, track: r.track, race_date: `${r.date}T${r.time}:00`, status: "upcoming" as const, race_type: r.race_type || null, race_duration: r.race_duration || null, practice_duration: r.practice_duration || null, qualifying_duration: r.qualifying_duration || null, start_type: r.start_type || null, weather: r.weather || null } as any))
        );
        if (re) throw re;
      }
      return league;
    },
    onSuccess: () => {
      toast.success("Seizoen aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      setShowLeagueForm(false);
      setNewLeague({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
      setRaces([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLeague = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leagues").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Verwijderd"); queryClient.invalidateQueries({ queryKey: ["admin-leagues"] }); },
  });

  const updateLeague = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editingLeagueData }) => {
      const { error } = await supabase.from("leagues").update({ name: data.name, description: data.description || null, season: data.season || null, car_class: data.car_class || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Seizoen bijgewerkt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      setEditingLeagueId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTeam = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").insert({ name: newTeam.name, description: newTeam.description || null, color: newTeam.color, logo_url: newTeamLogoPreview || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      setShowTeamForm(false);
      setNewTeam({ name: "", description: "", color: "#f97316", logo_url: "" });
      setNewTeamLogoPreview("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Team verwijderd"); queryClient.invalidateQueries({ queryKey: ["admin-teams"] }); },
  });

  const approveCreationRequest = useMutation({
    mutationFn: async (req: any) => {
      // Create the new team
      const { data: team, error: teamErr } = await (supabase as any).from("teams").insert({
        name: req.team_name,
        description: req.team_description || null,
        color: req.team_color || "#f97316",
        logo_url: req.logo_url || null,
      }).select().single();
      if (teamErr) throw teamErr;
      // Set team_id on the requester's profile
      await supabase.from("profiles").update({ team_id: team.id } as any).eq("user_id", req.user_id);
      // Create team_membership
      await (supabase as any).from("team_memberships").insert({ user_id: req.user_id, team_id: team.id, role: "driver" });
      // Delete request
      await (supabase as any).from("team_creation_requests").delete().eq("id", req.id);
    },
    onSuccess: () => {
      toast.success("Team aangemaakt en goedgekeurd!");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const denyCreationRequest = useMutation({
    mutationFn: async (reqId: string) => {
      await (supabase as any).from("team_creation_requests").delete().eq("id", reqId);
    },
    onSuccess: () => {
      toast.success("Aanvraag afgewezen.");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
    },
  });

  const updateTeamLogo = useMutation({
    mutationFn: async ({ teamId, logoUrl }: { teamId: string; logoUrl: string }) => {
      const { error } = await (supabase as any).from("teams").update({ logo_url: logoUrl || null }).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logo bijgewerkt!");
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      setEditingTeamId(null);
      setEditingTeamLogo("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const importResults = useMutation({
    mutationFn: async () => {
      if (!importRaceId) throw new Error("Selecteer een race");
      let iRatingUpdates = 0;
      for (const row of importRows) {
        if (!row.display_name.trim()) continue;
        // Match by iRacing Customer ID first, then by name
        const profile = profiles?.find((p: any) =>
          (row.iracing_cust_id && String((p as any).iracing_id) === String(row.iracing_cust_id)) ||
          (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
          (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
        );
        if (!profile) { toast.error(`Driver niet gevonden: ${row.display_name}`); continue; }
        const pts = (pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0);
        const { error } = await supabase.from("race_results").upsert(
          { race_id: importRaceId, user_id: profile.user_id, position: row.position, points: pts, fastest_lap: row.fastest_lap, laps: row.laps, best_lap: row.best_lap || null, incidents: row.incidents, dnf: false },
          { onConflict: "race_id,user_id" }
        );
        if (error) throw error;
        // Auto-update iRating + safety rating from CSV data
        if (row.new_irating && row.new_license_level && row.new_license_sub_level != null) {
          const licLetters = ["", "R", "D", "C", "B", "A"];
          const licIdx = Math.min(Math.ceil(row.new_license_level / 4), 5);
          const safetyRating = `${licLetters[licIdx]} ${(row.new_license_sub_level / 100).toFixed(2)}`;
          await supabase.from("profiles").update({ irating: row.new_irating, safety_rating: safetyRating } as any).eq("user_id", profile.user_id);
          iRatingUpdates++;
        }
      }
      await supabase.from("races").update({ status: "completed" }).eq("id", importRaceId);
      if (iRatingUpdates > 0) toast.success(`iRating bijgewerkt voor ${iRatingUpdates} drivers`);
    },
    onSuccess: () => {
      toast.success("Resultaten geïmporteerd!");
      queryClient.invalidateQueries({ queryKey: ["all-results-with-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      queryClient.invalidateQueries({ queryKey: ["completed-races"] });
      setImportRaceId("");
      setImportRows([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePointsConfig = useMutation({
    mutationFn: async () => {
      if (!selectedLeagueForPoints) throw new Error("Selecteer een league");
      const { error } = await supabase.from("points_config").upsert(
        leaguePoints.map((pts, i) => ({ league_id: selectedLeagueForPoints, position: i + 1, points: pts })),
        { onConflict: "league_id,position" }
      );
      if (error) throw error;
    },
    onSuccess: () => toast.success("Punten systeem opgeslagen!"),
    onError: (err: Error) => toast.error(err.message),
  });

  const generateRaceSlots = () => {
    setRaces(Array.from({ length: newLeague.raceCount }, (_, i) => ({ name: `Race ${i + 1}`, track: "", date: "", time: "20:00", race_type: "Feature", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min", start_type: "Standing", weather: "Fixed" })));
  };

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-16 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Settings className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="font-heading text-2xl font-black mb-2">GEEN TOEGANG</h1>
            <p className="text-muted-foreground">Je hebt admin rechten nodig om deze pagina te bekijken.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const nextRace = allRaces?.find((r: any) => r.status !== "completed");
  const activeLeague = leagues?.find((l: any) => l.status === "active");

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Dashboard", icon: BarChart2 },
    { id: "seasons", label: "Seizoenen", icon: Trophy },
    { id: "teams", label: "Teams", icon: Car },
    { id: "drivers", label: "Drivers", icon: Users },
    { id: "results", label: "Resultaten", icon: Upload },
    { id: "points", label: "Punten", icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-10 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Admin</span>
            </div>
            <h1 className="font-heading text-4xl font-black">ADMIN PANEL</h1>
          </div>
        </section>

        <div className="border-b border-border bg-card/30 sticky top-16 z-40">
          <div className="container mx-auto px-4">
            <div className="flex overflow-x-auto gap-1 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? "bg-gradient-racing text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="py-10">
          <div className="container mx-auto px-4">

            {activeTab === "overview" && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                  {[
                    { label: "Drivers", value: totalDrivers ?? 0, icon: Users, color: "text-blue-400" },
                    { label: "Teams", value: teams?.length ?? 0, icon: Car, color: "text-green-400" },
                    { label: "Seizoenen", value: leagues?.length ?? 0, icon: Trophy, color: "text-yellow-400" },
                    { label: "Resultaten", value: totalResults ?? 0, icon: BarChart2, color: "text-accent" },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-card border border-border rounded-lg p-5 text-center">
                      <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
                      <div className="font-heading font-black text-3xl">{stat.value}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  {nextRace && (
                    <div className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                      <div className="text-sm font-medium text-primary uppercase tracking-[0.1em] flex items-center gap-2 mb-1"><Calendar className="w-4 h-4" />Volgende Race</div>
                      <h3 className="font-heading font-black text-xl">{(nextRace as any).name}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{(nextRace as any).track} — {new Date((nextRace as any).race_date).toLocaleString("nl-NL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  )}
                  {activeLeague && (
                    <div className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                      <div className="text-sm font-medium text-accent uppercase tracking-[0.1em] flex items-center gap-2 mb-1"><Trophy className="w-4 h-4" />Actief Seizoen</div>
                      <h3 className="font-heading font-black text-xl">{activeLeague.name}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{activeLeague.season} {activeLeague.car_class && `• ${activeLeague.car_class}`} • {(activeLeague as any).races?.length || 0} races</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "seasons" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">SEIZOENEN</h2>
                  <button onClick={() => { setShowLeagueForm(!showLeagueForm); if (!showLeagueForm) generateRaceSlots(); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
                    <Plus className="w-4 h-4" />Nieuw Seizoen
                  </button>
                </div>
                {showLeagueForm && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
                    <h3 className="font-heading text-lg font-bold mb-4">NIEUW SEIZOEN</h3>
                    <div className="grid gap-4 md:grid-cols-2 mb-4">
                      {[
                        { label: "Naam *", key: "name", placeholder: "GT3 Championship" },
                        { label: "Seizoen", key: "season", placeholder: "2026 S1" },
                        { label: "Auto Klasse", key: "car_class", placeholder: "GT3" },
                      ].map(({ label, key, placeholder }) => (
                        <div key={key}>
                          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{label}</label>
                          <input type="text" value={(newLeague as any)[key]} onChange={(e) => setNewLeague({ ...newLeague, [key]: e.target.value })} placeholder={placeholder} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                      ))}
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Aantal Races</label>
                        <input type="number" min={1} max={24} value={newLeague.raceCount} onChange={(e) => setNewLeague({ ...newLeague, raceCount: parseInt(e.target.value) || 1 })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
                        <textarea value={newLeague.description} onChange={(e) => setNewLeague({ ...newLeague, description: e.target.value })} rows={2} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                      </div>
                    </div>
                    <button onClick={generateRaceSlots} className="mb-4 px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Genereer {newLeague.raceCount} race slots</button>
                    {races.length > 0 && (
                      <div className="space-y-3 mb-4">
                        {races.map((race, i) => {
                          const upd = (key: string, val: string) => { const u = [...races]; (u[i] as any)[key] = val; setRaces(u); };
                          return (
                            <div key={i} className="p-3 bg-secondary/50 rounded-md border border-border/50 space-y-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input type="text" value={race.name} onChange={(e) => upd("name", e.target.value)} placeholder={`Race ${i + 1}`} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                <select value={race.track} onChange={(e) => upd("track", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  <option value="">Circuit kiezen...</option>
                                  {IRACING_TRACKS.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <input type="date" value={race.date} onChange={(e) => upd("date", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                <input type="time" value={race.time} onChange={(e) => upd("time", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                                  <select value={race.race_type} onChange={(e) => upd("race_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Sprint", "Feature", "Endurance"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Duur race</label>
                                  <input type="text" value={race.race_duration} onChange={(e) => upd("race_duration", e.target.value)} placeholder="60 min / 30 laps" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                                  <select value={race.start_type} onChange={(e) => upd("start_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Standing", "Rolling"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                                  <input type="text" value={race.practice_duration} onChange={(e) => upd("practice_duration", e.target.value)} placeholder="15 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                                  <input type="text" value={race.qualifying_duration} onChange={(e) => upd("qualifying_duration", e.target.value)} placeholder="10 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                                  <select value={race.weather} onChange={(e) => upd("weather", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Fixed", "Dynamic"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => createLeague.mutate()} disabled={!newLeague.name || createLeague.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createLeague.isPending ? "Aanmaken..." : "Aanmaken"}</button>
                      <button onClick={() => setShowLeagueForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
                    </div>
                  </motion.div>
                )}
                <div className="space-y-3">
                  {leagues?.map((league: any) => {
                    const regs = (seasonRegistrations || []).filter((r: any) => r.league_id === league.id);
                    const isEditing = editingLeagueId === league.id;
                    return (
                      <div key={league.id} className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-heading font-bold text-lg">{league.name}</h3>
                            <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                              {league.season && <span>{league.season}</span>}
                              {league.car_class && <span>• {league.car_class}</span>}
                              <span>• {(league as any).races?.length || 0} races</span>
                              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{regs.length} ingeschreven</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (isEditing) { setEditingLeagueId(null); return; }
                                setEditingLeagueId(league.id);
                                setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" });
                              }}
                              className="p-2 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteLeague.mutate(league.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>

                        {isEditing && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-border space-y-3">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seizoen bewerken</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {([["Naam", "name", "GT3 Championship"], ["Seizoen", "season", "2026 S1"], ["Auto klasse", "car_class", "GT3"], ["Beschrijving", "description", ""]] as const).map(([label, key, ph]) => (
                                <div key={key}>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
                                  <input type="text" value={(editingLeagueData as any)[key]} onChange={(e) => setEditingLeagueData({ ...editingLeagueData, [key]: e.target.value })} placeholder={ph} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => updateLeague.mutate({ id: league.id, data: editingLeagueData })} disabled={updateLeague.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50">
                                <Save className="w-3 h-3" /> Opslaan
                              </button>
                              <button onClick={() => setEditingLeagueId(null)} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border">Annuleren</button>
                            </div>
                          </motion.div>
                        )}

                        {regs.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Ingeschreven deelnemers</p>
                            <div className="flex flex-wrap gap-2">
                              {regs.map((r: any) => {
                                const p = (profiles || []).find((p: any) => p.user_id === r.user_id);
                                return (
                                  <span key={r.user_id} className="px-2.5 py-1 rounded-full bg-secondary text-xs font-medium border border-border">
                                    {p?.display_name || p?.iracing_name || r.user_id.slice(0, 8)}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!leagues?.length && <div className="text-center py-16 text-muted-foreground"><Trophy className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Nog geen seizoenen.</p></div>}
                </div>
              </div>
            )}

            {activeTab === "teams" && (
              <div>
                {/* Team creation requests */}
                {creationRequests && creationRequests.length > 0 && (
                  <div className="mb-8">
                    <h2 className="font-heading text-xl font-black mb-4 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-yellow-400" />
                      NIEUWE TEAM AANVRAGEN
                      <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-sm font-bold">{creationRequests.length}</span>
                    </h2>
                    <div className="space-y-3">
                      {creationRequests.map((req: any) => (
                        <div key={req.id} className="bg-card border border-yellow-500/20 rounded-lg p-4 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {req.logo_url ? (
                              <img src={req.logo_url} alt={req.team_name} className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                            ) : (
                              <div className="w-3 h-10 rounded-sm shrink-0" style={{ backgroundColor: req.team_color || "#f97316" }} />
                            )}
                            <div>
                              <div className="font-heading font-bold text-base" style={{ color: req.team_color || "#f97316" }}>{req.team_name}</div>
                              {req.team_description && <div className="text-xs text-muted-foreground">{req.team_description}</div>}
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Aangevraagd door <span className="font-medium text-foreground">{req.profiles?.display_name || req.profiles?.iracing_name || "Onbekend"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => approveCreationRequest.mutate(req)}
                              disabled={approveCreationRequest.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" /> Goedkeuren
                            </button>
                            <button
                              onClick={() => denyCreationRequest.mutate(req.id)}
                              disabled={denyCreationRequest.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" /> Afwijzen
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">TEAMS</h2>
                  <button onClick={() => setShowTeamForm(!showTeamForm)} className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
                    <Plus className="w-4 h-4" />Nieuw Team
                  </button>
                </div>
                {showTeamForm && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
                    <h3 className="font-heading text-lg font-bold mb-4">NIEUW TEAM</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Naam *</label>
                        <input type="text" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} placeholder="Red Bull Racing" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Kleur</label>
                        <div className="flex gap-2">
                          <input type="color" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="w-12 h-10 rounded-md border border-border cursor-pointer bg-secondary" />
                          <input type="text" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="flex-1 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Logo</label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                            <ImagePlus className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{newTeamLogoPreview ? "Logo geladen" : "Logo uploaden..."}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const img = new Image();
                                const url = URL.createObjectURL(file);
                                img.onload = () => {
                                  const canvas = document.createElement("canvas");
                                  const max = 256;
                                  const scale = Math.min(max / img.width, max / img.height, 1);
                                  canvas.width = Math.round(img.width * scale);
                                  canvas.height = Math.round(img.height * scale);
                                  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                  setNewTeamLogoPreview(canvas.toDataURL("image/png"));
                                  URL.revokeObjectURL(url);
                                };
                                img.src = url;
                              }}
                            />
                          </label>
                          {newTeamLogoPreview && (
                            <div className="flex items-center gap-2">
                              <img src={newTeamLogoPreview} alt="preview" className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                              <button onClick={() => setNewTeamLogoPreview("")} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
                        <input type="text" value={newTeam.description} onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={() => createTeam.mutate()} disabled={!newTeam.name || createTeam.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createTeam.isPending ? "Aanmaken..." : "Team Aanmaken"}</button>
                      <button onClick={() => { setShowTeamForm(false); setNewTeamLogoPreview(""); }} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
                    </div>
                  </motion.div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {teams?.map((team: any) => (
                    <div key={team.id} className="bg-card border border-border rounded-lg p-5" style={{ borderTopColor: team.color, borderTopWidth: 3 }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md border border-border bg-secondary/50 flex items-center justify-center" style={{ backgroundColor: team.color + "33" }}>
                            <Car className="w-5 h-5 text-muted-foreground/50" />
                          </div>
                          <div>
                            <h3 className="font-heading font-bold text-lg">{team.name}</h3>
                            <p className="text-xs text-muted-foreground">{(team as any).team_memberships?.length || 0} drivers</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              if (editingTeamId === team.id) {
                                setEditingTeamId(null);
                                setEditingTeamLogo("");
                                setEditingTeamCurrentLogo("");
                              } else {
                                setEditingTeamId(team.id);
                                setEditingTeamLogo("");
                                setEditingTeamCurrentLogo("");
                                supabase.from("teams").select("logo_url").eq("id", team.id).single()
                                  .then(({ data }) => setEditingTeamCurrentLogo((data as any)?.logo_url || ""));
                              }
                            }}
                            className="p-2 text-muted-foreground hover:text-primary transition-colors"
                            title="Logo wijzigen"
                          >
                            <ImagePlus className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteTeam.mutate(team.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>

                      {/* Inline logo editor */}
                      {editingTeamId === team.id && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-3 p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Logo wijzigen</p>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors text-xs text-muted-foreground">
                              <ImagePlus className="w-3.5 h-3.5" />
                              {editingTeamLogo ? "Ander bestand" : "Kies afbeelding..."}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const img = new Image();
                                  const url = URL.createObjectURL(file);
                                  img.onload = () => {
                                    const canvas = document.createElement("canvas");
                                    const max = 256;
                                    const scale = Math.min(max / img.width, max / img.height, 1);
                                    canvas.width = Math.round(img.width * scale);
                                    canvas.height = Math.round(img.height * scale);
                                    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                    setEditingTeamLogo(canvas.toDataURL("image/png"));
                                    URL.revokeObjectURL(url);
                                  };
                                  img.src = url;
                                }}
                              />
                            </label>
                            {(editingTeamLogo || editingTeamCurrentLogo) && (
                              <img
                                src={editingTeamLogo || editingTeamCurrentLogo}
                                alt="preview"
                                className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50"
                              />
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateTeamLogo.mutate({ teamId: team.id, logoUrl: editingTeamLogo })}
                              disabled={!editingTeamLogo || updateTeamLogo.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                              <Save className="w-3 h-3" /> Opslaan
                            </button>
                            {editingTeamCurrentLogo && (
                              <button
                                onClick={() => { updateTeamLogo.mutate({ teamId: team.id, logoUrl: "" }); setEditingTeamCurrentLogo(""); }}
                                disabled={updateTeamLogo.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X className="w-3 h-3" /> Verwijderen
                              </button>
                            )}
                            <button onClick={() => { setEditingTeamId(null); setEditingTeamLogo(""); setEditingTeamCurrentLogo(""); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">Annuleren</button>
                          </div>
                        </motion.div>
                      )}

                      {(team as any).team_memberships?.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                          {(team as any).team_memberships.map((m: any) => (
                            <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.color }} />
                              {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {!teams?.length && <div className="col-span-2 text-center py-16 text-muted-foreground"><Car className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Nog geen teams.</p></div>}
                </div>
              </div>
            )}

            {activeTab === "results" && (
              <div>
                <h2 className="font-heading text-2xl font-black mb-6">RESULTATEN IMPORTEREN</h2>

                {/* Mode toggle */}
                <div className="flex gap-2 mb-6">
                  <button onClick={() => setImportMode("csv")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "csv" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    <FileText className="w-4 h-4" /> CSV Upload
                  </button>
                  <button onClick={() => setImportMode("manual")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "manual" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    <Upload className="w-4 h-4" /> Handmatig
                  </button>
                </div>

                <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                  {/* Race selector — always shown */}
                  <div className="mb-6">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Selecteer Race *</label>
                    <select value={importRaceId} onChange={(e) => setImportRaceId(e.target.value)} className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Kies een race...</option>
                      {allRaces?.map((race: any) => (
                        <option key={race.id} value={race.id}>{race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL")})</option>
                      ))}
                    </select>
                  </div>

                  {/* ── CSV MODE ── */}
                  {importMode === "csv" && (
                    <div>
                      {/* Info box */}
                      <div className="mb-5 p-4 rounded-md bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
                        <div className="font-bold mb-1">📄 iRacing CSV Export</div>
                        <p className="text-xs leading-relaxed mb-2">Download de race resultaten als CSV van <strong>members.iracing.com</strong> → Race Results → Export. De CSV wordt automatisch ingelezen en gekoppeld aan drivers op basis van iRacing naam of Customer ID.</p>
                        <p className="text-xs text-blue-400 font-bold">Verwacht formaat: FinPos, CustID, Display Name, Laps, Best Lap Time, Incidents (iRacing standaard export)</p>
                      </div>

                      {/* File upload */}
                      <div className="mb-5">
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">CSV Bestand</label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{csvFileName || "Kies CSV bestand..."}</span>
                            <input
                              type="file"
                              accept=".csv,.txt"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setCsvFileName(file.name);
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  const text = ev.target?.result as string;
                                  if (!text) return;
                                  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                                  if (lines.length < 2) { toast.error("CSV lijkt leeg"); return; }

                                  // Detect header row — skip metadata rows (iRacing CSV has 2 header rows)
                                  let headerLineIdx = 0;
                                  for (let li = 0; li < Math.min(lines.length, 5); li++) {
                                    if (lines[li].toLowerCase().includes("fin pos") || lines[li].toLowerCase().includes("finpos") || lines[li].toLowerCase().startsWith('"fin pos"')) { headerLineIdx = li; break; }
                                  }
                                  const header = lines[headerLineIdx].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
                                  const finPosIdx        = header.findIndex(h => h === "fin pos" || h === "finpos" || h === "pos" || h === "finish");
                                  const custIdIdx        = header.findIndex(h => h === "cust id" || h.includes("custid") || h.includes("customerid"));
                                  const nameIdx          = header.findIndex(h => h === "name" || h.includes("display name") || h.includes("driver"));
                                  const lapsIdx          = header.findIndex(h => h === "laps comp" || h === "laps" || h === "laps completed");
                                  const bestLapIdx       = header.findIndex(h => h === "fastest lap time" || h.includes("best lap") || h.includes("bestlap") || h.includes("fastest lap"));
                                  const incIdx           = header.findIndex(h => h === "inc" || h.includes("incident"));
                                  const newIRatingIdx    = header.findIndex(h => h === "new irating");
                                  const newLicLevelIdx   = header.findIndex(h => h === "new license level");
                                  const newLicSubIdx     = header.findIndex(h => h === "new license sub-level");

                                  const parsed = lines.slice(headerLineIdx + 1).map((line, i) => {
                                    const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
                                    if (cols.length < 3) return null;
                                    const pos      = finPosIdx >= 0  ? parseInt(cols[finPosIdx]) || i + 1 : i + 1;
                                    const name     = nameIdx >= 0    ? cols[nameIdx]   : `Driver ${i + 1}`;
                                    const laps     = lapsIdx >= 0    ? parseInt(cols[lapsIdx]) || 0 : 0;
                                    const bestLap  = bestLapIdx >= 0 ? cols[bestLapIdx] : "";
                                    const incidents= incIdx >= 0     ? parseInt(cols[incIdx]) || 0 : 0;
                                    const custId   = custIdIdx >= 0  ? cols[custIdIdx] : undefined;
                                    const newIR    = newIRatingIdx >= 0    ? parseInt(cols[newIRatingIdx]) || undefined : undefined;
                                    const newLL    = newLicLevelIdx >= 0   ? parseInt(cols[newLicLevelIdx]) || undefined : undefined;
                                    const newLS    = newLicSubIdx >= 0     ? parseInt(cols[newLicSubIdx]) || undefined : undefined;
                                    return { position: pos, display_name: name, laps, best_lap: bestLap, incidents, fastest_lap: false, iracing_cust_id: custId, new_irating: newIR, new_license_level: newLL, new_license_sub_level: newLS };
                                  }).filter((r): r is NonNullable<typeof r> => !!r && !!r.display_name && !isNaN(r.position));

                                  if (parsed.length === 0) { toast.error("Geen geldige rijen gevonden in CSV"); return; }
                                  setImportRows(parsed);
                                  toast.success(`${parsed.length} drivers geladen uit CSV`);
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>
                          {csvFileName && (
                            <button onClick={() => { setCsvFileName(null); setImportRows([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Preview of parsed rows */}
                      {importRows.length > 0 && importRows[0].display_name && (
                        <div className="mb-5">
                          <div className="text-sm font-medium text-muted-foreground mb-2">{importRows.length} drivers geladen — preview:</div>
                          <div className="bg-secondary/30 rounded-md border border-border overflow-hidden">
                            <div className="grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                              <span>Pos</span><span>Driver</span><span>Laps</span><span>Best Lap</span><span>Inc.</span><span className="text-center">FL</span>
                            </div>
                            {importRows.slice(0, 10).map((row, i) => {
                              const matched = profiles?.find((p: any) =>
                                (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                                (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
                              );
                              return (
                                <div key={i} className={`grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 items-center border-b border-border/30 text-sm ${matched ? "" : "opacity-60"}`}>
                                  <span className="font-heading font-bold">{row.position}</span>
                                  <div>
                                    <span>{row.display_name}</span>
                                    {matched ? <span className="ml-2 text-[10px] text-green-400 font-bold">✓ gevonden</span> : <span className="ml-2 text-[10px] text-red-400 font-bold">✗ niet gevonden</span>}
                                  </div>
                                  <span className="text-muted-foreground">{row.laps}</span>
                                  <span className="font-mono text-muted-foreground text-xs">{row.best_lap || "—"}</span>
                                  <span className="text-muted-foreground">{row.incidents}x</span>
                                  <div className="flex items-center justify-center">
                                    <input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" />
                                  </div>
                                </div>
                              );
                            })}
                            {importRows.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground">...en {importRows.length - 10} meer</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── MANUAL MODE ── */}
                  {importMode === "manual" && (
                    <div>
                      <div className="overflow-x-auto mb-4">
                        <div className="min-w-[640px]">
                          <div className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                            <span>Pos</span><span>Driver</span><span className="text-center">Laps</span><span className="text-center">Best Lap</span><span className="text-center">Inc.</span><span className="text-center">FL</span><span></span>
                          </div>
                          {importRows.map((row, i) => (
                            <div key={i} className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 items-center">
                              <div className="py-2 rounded-md bg-secondary border border-border text-center text-sm font-heading font-bold">{row.position}</div>
                              <input type="text" value={row.display_name} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], display_name: e.target.value }; setImportRows(u); }} placeholder="Driver naam" list="driver-names-import" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="number" min={0} value={row.laps} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], laps: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="text" value={row.best_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], best_lap: e.target.value }; setImportRows(u); }} placeholder="1:23.456" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="number" min={0} value={row.incidents} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], incidents: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <div className="flex items-center justify-center"><input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" /></div>
                              <button onClick={() => setImportRows(importRows.filter((_, j) => j !== i))} className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                          <datalist id="driver-names-import">
                            {profiles?.map((p: any) => <option key={p.user_id} value={p.display_name || p.iracing_name || ""} />)}
                          </datalist>
                        </div>
                      </div>
                      <button onClick={() => setImportRows([...importRows, { position: importRows.length + 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }])} className="flex items-center gap-1 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4">
                        <Plus className="w-4 h-4" /> Driver toevoegen
                      </button>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="border-t border-border pt-4">
                    <div className="text-xs text-muted-foreground mb-3 flex flex-wrap gap-2">
                      <span className="font-bold uppercase tracking-wider">Punten preview:</span>
                      {importRows.slice(0, 8).map((row) => (
                        <span key={row.position} className="px-2 py-0.5 rounded bg-secondary">P{row.position}: {(pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0)} pts</span>
                      ))}
                    </div>
                    <button onClick={() => importResults.mutate()} disabled={!importRaceId || importResults.isPending} className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity">
                      <Upload className="w-4 h-4" />{importResults.isPending ? "Importeren..." : "Resultaten Importeren"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "drivers" && (
              <div>
                <h2 className="font-heading text-2xl font-black mb-6">DRIVERS</h2>
                <DriversList />
              </div>
            )}

            {activeTab === "points" && (
              <div>
                <h2 className="font-heading text-2xl font-black mb-6">PUNTEN SYSTEEM</h2>
                <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                  <div className="mb-6">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">League / Seizoen</label>
                    <select value={selectedLeagueForPoints} onChange={(e) => setSelectedLeagueForPoints(e.target.value)} className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Kies een league...</option>
                      {leagues?.map((l: any) => <option key={l.id} value={l.id}>{l.name} {l.season && `(${l.season})`}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
                    {leaguePoints.map((pts, i) => (
                      <div key={i} className="bg-secondary/50 rounded-md p-3 border border-border">
                        <div className="text-xs font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">P{i + 1}</div>
                        <input type="number" min={0} value={pts} onChange={(e) => { const u = [...leaguePoints]; u[i] = parseInt(e.target.value) || 0; setLeaguePoints(u); }} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm font-heading font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 flex-wrap mb-6">
                    <button onClick={() => savePointsConfig.mutate()} disabled={!selectedLeagueForPoints || savePointsConfig.isPending} className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity">
                      <Save className="w-4 h-4" />{savePointsConfig.isPending ? "Opslaan..." : "Opslaan"}
                    </button>
                    <button onClick={() => setLeaguePoints(DEFAULT_POINTS)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Reset standaard</button>
                  </div>
                  <div className="p-4 bg-secondary/30 rounded-md border border-border">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Standaard F1-stijl systeem</div>
                    <div className="flex flex-wrap gap-2">
                      {DEFAULT_POINTS.map((p, i) => <span key={i} className="text-xs px-2 py-1 rounded bg-secondary">P{i + 1}: {p}</span>)}
                      <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">Fastest Lap: +1</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AdminPage;
