import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { List, Trophy, Flag, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/i18n/useLanguage";
import { setSeoMeta } from "@/lib/seo";

const positionColors: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-300",
  3: "text-amber-600",
};

const PODIUM_COLORS = [
  { text: "#facc15", bg: "rgba(250,204,21,0.10)", border: "rgba(250,204,21,0.25)" },
  { text: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.20)" },
  { text: "#d97706", bg: "rgba(217,119,6,0.08)",   border: "rgba(217,119,6,0.20)"  },
];

const STALE = 5 * 60 * 1000;

type RaceDetailResult = {
  id: string;
  user_id: string;
  position: number | null;
  points: number | null;
  laps: number | null;
  best_lap: string | null;
  fastest_lap: boolean | null;
  incidents: number | null;
  dnf: boolean | null;
  gap_to_leader: string | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

type PublicProfile = {
  user_id: string | null;
  display_name: string | null;
  iracing_name: string | null;
};

type CompletedRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  round: number | null;
  leagues: {
    name: string;
    car_class: string | null;
  } | null;
};

type RaceWinner = {
  race_id: string;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

const loadPublicProfiles = async (userIds: string[]) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, PublicProfile>();

  const { data, error } = await supabase
    .from("public_profiles")
    .select("user_id, display_name, iracing_name")
    .in("user_id", ids);
  if (error) throw error;

  return new Map(
    ((data || []) as PublicProfile[])
      .filter((profile): profile is PublicProfile & { user_id: string } => Boolean(profile.user_id))
      .map((profile) => [profile.user_id, profile]),
  );
};

const loadRaceResults = async (raceId: string): Promise<RaceDetailResult[]> => {
  const { data, error } = await supabase
    .from("race_results")
    .select("*")
    .eq("race_id", raceId)
    .order("position", { ascending: true });
  if (error) throw error;

  const results = (data || []) as Omit<RaceDetailResult, "profiles">[];
  const profiles = await loadPublicProfiles(results.map((result) => result.user_id));
  return results.map((result) => ({ ...result, profiles: profiles.get(result.user_id) || null }));
};

// Separate component so hooks run per expanded race, not for all races at once
const ExpandedRaceContent = ({ raceId }: { raceId: string }) => {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["race-results-detail", raceId],
    staleTime: STALE,
    queryFn: () => loadRaceResults(raceId),
  });


  if (isLoading) {
    return (
      <div className="border-t border-white/[0.07] px-4 py-6 sm:px-6">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />)}
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="border-t border-white/[0.07] px-6 py-8 text-center text-gray-400">
        <p className="text-sm">Geen resultaten beschikbaar voor deze race.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="border-t border-white/[0.07]"
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[500px] grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-2 bg-black/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
          <span>Pos</span>
          <span>Coureur</span>
          <span className="text-center">Ronden</span>
          <span className="text-center">Beste ronde</span>
          <span className="text-center hidden md:block">Inc.</span>
          <span className="text-center">Pts</span>
        </div>
        {results.map((result) => {
          return (
            <div
              key={result.id}
              className={`grid min-w-[500px] grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] items-center gap-2 border-b border-white/[0.05] px-4 py-3 transition-colors hover:bg-white/[0.025] ${result.position !== null && result.position <= 3 ? "racing-stripe-left" : ""}`}
            >
              <span className={`font-heading font-black text-lg ${positionColors[result.position!] || "text-muted-foreground"}`}>
                {result.dnf ? "DNF" : result.position}
              </span>
              <div>
                <span className="font-heading font-bold text-sm">
                  {result.profiles?.iracing_name || result.profiles?.display_name || "Onbekend"}
                </span>
                {result.fastest_lap && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold">FL</span>
                )}
              </div>
              <span className="text-center text-sm text-gray-400">{result.laps || "-"}</span>
              <span className="text-center font-mono text-sm text-gray-400">{result.best_lap || "-"}</span>
              <span className="hidden text-center text-sm text-gray-400 md:block">
                {result.incidents != null ? (
                  <span className={result.incidents > 4 ? "text-red-400" : ""}>{result.incidents}x</span>
                ) : "-"}
              </span>
              <span className="text-center font-heading font-black">{result.points}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

const ResultsPage = () => {
  const { language } = useLanguage();
  const [expandedRace, setExpandedRace] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRaceId = searchParams.get("race");

  const { data: races, isLoading } = useQuery({
    queryKey: ["completed-races"],
    staleTime: STALE,
    queryFn: async (): Promise<CompletedRace[]> => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name, car_class)")
        .eq("status", "completed")
        .order("race_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CompletedRace[];
    },
  });

  const { data: winners } = useQuery({
    queryKey: ["race-winners"],
    staleTime: STALE,
    queryFn: async (): Promise<RaceWinner[]> => {
      const { data, error } = await supabase
        .from("race_results")
        .select("race_id, user_id")
        .eq("position", 1);
      if (error) throw error;

      const winners = (data || []) as { race_id: string; user_id: string }[];
      const profiles = await loadPublicProfiles(winners.map((winner) => winner.user_id));
      return winners.map((winner) => ({
        race_id: winner.race_id,
        profiles: profiles.get(winner.user_id) || null,
      }));
    },
  });

  const latestRace = races?.[0];

  useEffect(() => {
    setSeoMeta(language === "en"
      ? {
          title: "iRacing Results & Standings | 3SM",
          description: "View 3SM iRacing results with winners, podiums, classifications, standings and race details from the Dutch sim racing league.",
          canonicalUrl: "https://3stripemotorsport.cc/results/",
          ogTitle: "3SM Race Results",
          ogDescription: "iRacing results, winners, podiums and race details from 3SM.",
        }
      : {
          title: "iRacing uitslagen & standings | 3SM",
          description: "Bekijk 3SM iRacing uitslagen met winnaars, podiums, klasseringen, standings en race-details van de Nederlandse sim racing league.",
          canonicalUrl: "https://3stripemotorsport.cc/results/",
          ogTitle: "3SM Race-uitslagen",
          ogDescription: "iRacing uitslagen, winnaars, podiums en race-details van 3SM.",
        });
  }, [language]);

  useEffect(() => {
    if (!requestedRaceId || !races?.some((race) => race.id === requestedRaceId)) return;

    setExpandedRace(requestedRaceId);
    const frame = requestAnimationFrame(() => {
      document.getElementById(`race-${requestedRaceId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => cancelAnimationFrame(frame);
  }, [requestedRaceId, races]);

  const toggleArchiveRace = (raceId: string) => {
    const nextParams = new URLSearchParams(searchParams);

    if (expandedRace === raceId) {
      setExpandedRace(null);
      nextParams.delete("race");
    } else {
      setExpandedRace(raceId);
      nextParams.set("race", raceId);
    }

    setSearchParams(nextParams, { replace: false });
  };

  // Same queryKey as ExpandedRaceContent — cache shared when user expands this race
  const { data: latestResults = [], isLoading: latestLoading } = useQuery({
    queryKey: ["race-results-detail", latestRace?.id],
    enabled: !!latestRace?.id,
    staleTime: STALE,
    queryFn: () => loadRaceResults(latestRace!.id),
  });

  // Spotlight computations
  const spFinishers = latestResults.filter((r) => !r.dnf);
  const spPodium = spFinishers.slice(0, 3);
  const spFastest = latestResults.find((r) => r.fastest_lap);
  const spDnfCount = latestResults.filter((r) => r.dnf).length;
  const spFinishersWithInc = spFinishers.filter((r) => r.incidents != null);
  const spCleanest = spFinishersWithInc.length
    ? spFinishersWithInc.reduce((best, r) =>
        (r.incidents ?? 0) < (best.incidents ?? 0) ||
        ((r.incidents ?? 0) === (best.incidents ?? 0) && (r.position ?? 99) < (best.position ?? 99))
          ? r : best
      )
    : null;
  const spTotalInc = latestResults.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
  const spHasIncData = latestResults.some((r) => r.incidents != null);

  const spDriverName = (r: RaceDetailResult) =>
    r.profiles?.iracing_name || r.profiles?.display_name || "Onbekend";

  useEffect(() => {
    if (!races?.length) return;

    const siteUrl = "https://3stripemotorsport.cc";
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: language === "en" ? "3 Stripe Motorsport race results" : "3 Stripe Motorsport race-uitslagen",
      description: language === "en"
        ? "Overview of completed 3SM iRacing races with circuits, rounds, winners and results."
        : "Overzicht van gereden 3SM iRacing races met circuits, rondes, winnaars en resultaten.",
      inLanguage: language === "en" ? "en" : "nl",
      url: `${siteUrl}/results/`,
      itemListElement: races.slice(0, 20).map((race, index) => {
        const winner = winners?.find((w) => w.race_id === race.id);
        const winnerName = winner?.profiles?.iracing_name || winner?.profiles?.display_name;

        return {
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "WebPage",
            name: language === "en" ? `${race.name} result` : `${race.name} uitslag`,
            description: winnerName
              ? (language === "en"
                  ? `${race.name} at ${race.track}: winner ${winnerName}.`
                  : `${race.name} op ${race.track}: winnaar ${winnerName}.`)
              : (language === "en"
                  ? `${race.name} at ${race.track}: iRacing race result from 3 Stripe Motorsport.`
                  : `${race.name} op ${race.track}: iRacing race-uitslag van 3 Stripe Motorsport.`),
            url: `${siteUrl}/results/${race.id}/`,
            isPartOf: {
              "@type": "WebSite",
              name: "3 Stripe Motorsport",
              url: siteUrl,
            },
            about: {
              "@type": "SportsOrganization",
              name: "3 Stripe Motorsport",
              sport: "Sim racing",
              url: siteUrl,
            },
          },
        };
      }),
    };

    const scriptId = "results-itemlist-jsonld";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(itemList);

    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, [language, races, winners]);

  return (
    <div className="min-h-screen bg-[#080a0f] text-white">
      <Navbar />
      <StickyRaceBar />
      <main className="relative overflow-hidden pt-[108px] [background-image:radial-gradient(circle_at_50%_16%,rgba(249,115,22,0.055),transparent_27%),linear-gradient(180deg,#080a0f_0%,#0b0e14_46%,#080a0f_100%)]">
        <section className="relative border-b border-white/[0.06] py-10 before:absolute before:inset-0 before:bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] before:bg-[size:44px_44px] before:[mask-image:linear-gradient(to_bottom,black,transparent_92%)] before:content-[''] sm:py-8">
          <div className="container relative mx-auto max-w-7xl px-4">
            <div className="mb-3 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.26em] text-orange-400 sm:text-xs">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10 ring-1 ring-orange-400/20"><List className="h-3.5 w-3.5" /></span>
              <span>3SM</span>
            </div>
            <h1 className="font-heading text-4xl font-black uppercase leading-[0.9] tracking-tight text-white sm:text-5xl">UITSLAGEN</h1>
            <p className="mt-4 text-[17px] leading-8 text-gray-300">Alle race uitslagen en klassementen</p>
          </div>
        </section>

        <section className="py-10 sm:py-12">
          <div className="container mx-auto max-w-7xl px-4">

            {/* Latest Result Spotlight */}
            {!isLoading && latestRace && (
              <div className="mb-14">
                <div className="mb-5 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.24em] text-orange-400 sm:text-xs">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10 ring-1 ring-orange-400/20"><Flag className="h-3.5 w-3.5" /></span>
                  <span>Laatste Uitslag</span>
                </div>

                {latestLoading ? (
                  <div className="h-48 animate-pulse rounded-[1.8rem] bg-white/[0.035] ring-1 ring-white/[0.07]" />
                ) : latestResults.length === 0 ? (
                  <div className="rounded-[1.8rem] bg-white/[0.025] px-6 py-8 text-center text-sm text-gray-400 ring-1 ring-white/[0.07]">
                    Nog geen detailresultaten beschikbaar.
                  </div>
                ) : (
                  <div className="relative overflow-hidden rounded-[1.8rem] bg-[radial-gradient(circle_at_85%_0%,rgba(249,115,22,0.12),transparent_34%),linear-gradient(145deg,#12161e_0%,#0c0f15_72%)] shadow-2xl shadow-black/35 ring-1 ring-orange-400/20">
                    <div className="h-0.5" style={{ background: "linear-gradient(90deg, transparent, #f97316, transparent)" }} />

                    {/* Race meta */}
                    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-black/10 px-5 py-5 sm:px-7">
                      <div className="flex items-center gap-2">
                        {latestRace.round != null && (
                          <span className="font-heading text-sm font-black text-gray-400">
                            R{String(latestRace.round).padStart(2, "0")}
                          </span>
                        )}
                        <h3 className="font-heading font-black text-lg">{latestRace.name}</h3>
                      </div>
                      {latestRace.leagues?.name && (
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-gray-300 ring-1 ring-white/[0.07]">
                          {latestRace.leagues.name}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2 text-sm text-gray-400">
                        <span>{latestRace.track}</span>
                        <span>·</span>
                        <span>
                          {new Date(latestRace.race_date).toLocaleDateString("nl-NL", {
                            day: "numeric", month: "long", timeZone: "Europe/Amsterdam",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Podium + highlights */}
                    <div className="grid divide-y divide-white/[0.07] md:grid-cols-2 md:divide-x md:divide-y-0">

                      {/* Podium */}
                      <div className="bg-gradient-to-br from-white/[0.025] to-transparent p-5 sm:p-7">
                        <div className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Podium</div>
                        <div className="space-y-2.5">
                          {spPodium.map((r, i) => {
                            const c = PODIUM_COLORS[i];
                            return (
                              <div
                                key={r.user_id}
                                className="flex items-center gap-3 rounded-xl px-4 py-3"
                                style={{ background: c.bg, border: `1px solid ${c.border}` }}
                              >
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-black"
                                  style={{ background: `${c.text}20`, color: c.text }}
                                >
                                  {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-heading font-bold text-sm truncate">{spDriverName(r)}</div>
                                  {i > 0 && r.gap_to_leader && (
                                    <div className="text-[10px] text-muted-foreground">+{r.gap_to_leader}</div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-heading font-black text-base" style={{ color: c.text }}>{r.points}</div>
                                  <div className="text-[10px] text-muted-foreground">pts</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Highlights */}
                      <div className="bg-black/[0.08] p-5 sm:p-7">
                        <div className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Highlights</div>
                        <div className="space-y-3">

                          {spFastest && (
                            <div
                              className="flex items-start gap-3 rounded-xl px-4 py-3"
                              style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
                            >
                              <span className="text-base shrink-0 leading-none mt-0.5">⚡</span>
                              <div className="min-w-0">
                                <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-0.5">Snelste ronde</div>
                                <div className="font-heading font-bold text-sm truncate">{spDriverName(spFastest)}</div>
                                {spFastest.best_lap && (
                                  <div className="text-[11px] font-mono text-purple-300 mt-0.5">{spFastest.best_lap}</div>
                                )}
                              </div>
                            </div>
                          )}

                          {spCleanest && (
                            <div
                              className="flex items-start gap-3 rounded-xl px-4 py-3"
                              style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}
                            >
                              <span className="text-base shrink-0 leading-none mt-0.5">🧊</span>
                              <div className="min-w-0">
                                <div className="text-[10px] font-black text-green-500 uppercase tracking-widest mb-0.5">Cleanste rit</div>
                                <div className="font-heading font-bold text-sm truncate">{spDriverName(spCleanest)}</div>
                                <div className="text-[11px] text-green-400 mt-0.5">{spCleanest.incidents} inc</div>
                              </div>
                            </div>
                          )}

                          <div
                            className="flex items-center gap-4 rounded-xl px-4 py-3"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                          >
                            <div className="text-center">
                              <div className="font-heading font-black text-lg leading-none">{spFinishers.length}</div>
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Gefinisht</div>
                            </div>
                            {spDnfCount > 0 && (
                              <>
                                <div className="w-px h-8 bg-border" />
                                <div className="text-center">
                                  <div className="font-heading font-black text-lg text-red-400 leading-none">{spDnfCount}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">DNF</div>
                                </div>
                              </>
                            )}
                            {spHasIncData && (
                              <>
                                <div className="w-px h-8 bg-border" />
                                <div className="text-center">
                                  <div className="font-heading font-black text-lg text-orange-400 leading-none">{spTotalInc}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Incidenten</div>
                                </div>
                              </>
                            )}
                          </div>

                        </div>
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col gap-4 border-t border-white/[0.07] bg-black/15 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                      <div className="text-xs leading-5 text-gray-400">
                        Kies tussen de deelbare racepagina of de snelle archiefweergave op deze pagina.
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/results/${latestRace.id}/`}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider text-white transition-colors hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                        >
                          Details & delen
                        </Link>
                        <button
                          onClick={() => toggleArchiveRace(latestRace.id)}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white/[0.045] px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider text-gray-300 ring-1 ring-white/[0.10] transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                        >
                          {expandedRace === latestRace.id ? "Sluit snelle uitslag" : "Snelle uitslag"}
                          {expandedRace === latestRace.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Race archive */}
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-[1.4rem] bg-white/[0.035] ring-1 ring-white/[0.06]" />)}
              </div>
            ) : !races?.length ? (
              <div className="py-24 text-center text-gray-400">
                <Flag className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-heading font-bold">GEEN RESULTATEN</p>
                <p className="text-sm mt-1">Er zijn nog geen race resultaten beschikbaar.</p>
              </div>
            ) : (
              <>
                <div className="mb-7">
                  <div className="mb-1 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.24em] text-orange-400 sm:text-xs">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10 ring-1 ring-orange-400/20"><Flag className="h-3.5 w-3.5" /></span>
                    <span>Race Archief</span>
                  </div>
                  <p className="ml-11 text-sm text-gray-400">Alle afgeronde races</p>
                </div>
              <div className="space-y-3">
                {races.map((race, i) => {
                  const winner = winners?.find((w) => w.race_id === race.id);
                  const isExpanded = expandedRace === race.id;

                  return (
                    <motion.div
                      key={race.id}
                      id={`race-${race.id}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`relative overflow-hidden rounded-[1.4rem] bg-gradient-to-r from-white/[0.04] to-white/[0.018] shadow-lg shadow-black/15 ring-1 ring-white/[0.075] transition before:absolute before:bottom-4 before:left-0 before:top-4 before:w-0.5 before:rounded-full before:bg-gradient-to-b before:from-orange-400 before:to-red-500 before:opacity-45 before:content-[''] hover:from-white/[0.055] hover:to-white/[0.025] hover:ring-orange-400/25 hover:before:opacity-100${i === 0 ? " scroll-mt-[120px]" : ""}`}
                    >
                      <button
                        onClick={() => toggleArchiveRace(race.id)}
                        className="flex w-full items-center gap-3 px-4 py-5 text-left transition-colors hover:bg-white/[0.025] sm:gap-5 sm:px-6"
                      >
                        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-black/20 ring-1 ring-white/[0.06]">
                          {race.round != null && (
                            <>
                              <span className="mb-0.5 text-[9px] font-black uppercase leading-none tracking-widest text-gray-600">Ronde</span>
                              <span className="font-heading text-lg font-black leading-none text-gray-400">{String(race.round).padStart(2, "0")}</span>
                            </>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-heading text-lg font-black text-white sm:text-xl">{race.name}</h3>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-400">
                            <span>{race.track}</span>
                            {race.leagues?.name && (
                              <span className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-gray-300 ring-1 ring-white/[0.07]">
                                {race.leagues.name}
                              </span>
                            )}
                            <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" })}</span>
                          </div>
                          {winner && (
                            <div className="flex items-center gap-1 mt-1.5 md:hidden">
                              <Trophy className="w-3 h-3 text-yellow-400 shrink-0" />
                              <span className="font-heading font-bold text-sm text-yellow-400 truncate">
                                {winner.profiles?.iracing_name || winner.profiles?.display_name || "Onbekend"}
                              </span>
                            </div>
                          )}
                        </div>
                        {winner && (
                          <div className="hidden md:flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="mb-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-500">Winnaar</div>
                              <div className="font-heading font-bold text-yellow-400">
                                {winner.profiles?.iracing_name || winner.profiles?.display_name || "Onbekend"}
                              </div>
                            </div>
                            <Trophy className="w-5 h-5 text-yellow-400" />
                          </div>
                        )}
                        <div className="shrink-0 text-gray-500">
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </div>
                      </button>

                      <div className="-mt-1 border-t border-white/[0.045] bg-black/[0.06] px-4 pb-4 pt-3 sm:px-6">
                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            to={`/results/${race.id}/`}
                            className="inline-flex items-center gap-1 text-xs font-heading font-bold text-orange-400 transition-colors hover:text-orange-300"
                          >
                            Details & delen
                          </Link>
                          <button
                            type="button"
                            onClick={() => toggleArchiveRace(race.id)}
                            className="inline-flex items-center gap-1 text-xs font-heading font-bold text-gray-500 transition-colors hover:text-white"
                          >
                            {isExpanded ? "Sluit snelle uitslag" : "Snelle uitslag"}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {isExpanded && <ExpandedRaceContent raceId={race.id} />}
                    </motion.div>
                  );
                })}
              </div>
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ResultsPage;
