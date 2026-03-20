/**
 * useRegistration — gedeelde hook voor race & seizoensinschrijving
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useRegistration() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("iracing_id, iracing_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const profileComplete = !!(profile as any)?.iracing_id && !!(profile as any)?.iracing_name;

  const { data: seasonRegs = [] } = useQuery({
    queryKey: ["season-registrations"],
    queryFn: async () => {
      const { data } = await supabase.from("season_registrations").select("*");
      return data || [];
    },
  });

  const { data: raceRegs = [] } = useQuery({
    queryKey: ["race-registrations"],
    queryFn: async () => {
      const { data } = await supabase.from("race_registrations").select("*");
      return data || [];
    },
  });

  // ── Helpers ────────────────────────────────────────────────
  const isRegisteredForSeason = (leagueId: string) =>
    !!user && seasonRegs.some((r: any) => r.league_id === leagueId && r.user_id === user.id);

  const isRegisteredForRace = (raceId: string, leagueId?: string) => {
    if (!user) return false;
    if (leagueId && isRegisteredForSeason(leagueId)) return true;
    return raceRegs.some((r: any) => r.race_id === raceId && r.user_id === user.id);
  };

  const isRegisteredViaSeason = (leagueId?: string) =>
    !!leagueId && isRegisteredForSeason(leagueId);

  const seasonRegCount = (leagueId: string) =>
    seasonRegs.filter((r: any) => r.league_id === leagueId).length;

  const raceRegCount = (raceId: string) =>
    raceRegs.filter((r: any) => r.race_id === raceId).length;

  // ── Mutations ──────────────────────────────────────────────
  const registerForSeason = useMutation({
    mutationFn: async (leagueId: string) => {
      const { error } = await (supabase as any).from("season_registrations").insert({
        league_id: leagueId, user_id: user!.id, status: "registered",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ingeschreven voor het seizoen!");
      queryClient.invalidateQueries({ queryKey: ["season-registrations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unregisterFromSeason = useMutation({
    mutationFn: async (leagueId: string) => {
      const { error } = await (supabase as any)
        .from("season_registrations").delete()
        .eq("league_id", leagueId).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Uitgeschreven van seizoen");
      queryClient.invalidateQueries({ queryKey: ["season-registrations"] });
    },
  });

  const registerForRace = useMutation({
    mutationFn: async (raceId: string) => {
      const { error } = await (supabase as any).from("race_registrations").insert({
        race_id: raceId, user_id: user!.id, status: "registered",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ingeschreven voor de race!");
      queryClient.invalidateQueries({ queryKey: ["race-registrations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unregisterFromRace = useMutation({
    mutationFn: async (raceId: string) => {
      const { error } = await (supabase as any)
        .from("race_registrations").delete()
        .eq("race_id", raceId).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Uitgeschreven van race");
      queryClient.invalidateQueries({ queryKey: ["race-registrations"] });
    },
  });

  return {
    user,
    profileComplete,
    isRegisteredForSeason,
    isRegisteredForRace,
    isRegisteredViaSeason,
    seasonRegCount,
    raceRegCount,
    registerForSeason,
    unregisterFromSeason,
    registerForRace,
    unregisterFromRace,
  };
}
