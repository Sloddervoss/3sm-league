import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LanguageProvider } from "@/i18n/LanguageContext";
import Index from "./pages/Index.tsx";

// Lazy-loaded routes (keep Index eager for fastest initial paint)
const CalendarPage = lazy(() => import("./pages/CalendarPage.tsx"));
const StandingsPage = lazy(() => import("./pages/StandingsPage.tsx"));
const DriversPage = lazy(() => import("./pages/DriversPage.tsx"));
const TeamsPage = lazy(() => import("./pages/TeamsPage.tsx"));
const ResultsPage = lazy(() => import("./pages/ResultsPage.tsx"));
const RaceDetailPage = lazy(() => import("./pages/RaceDetailPage.tsx"));
const NewsPage = lazy(() => import("./pages/NewsPage.tsx"));
const HomepagePrototype = lazy(() => import("./pages/HomepagePrototype.tsx"));
const NewsDetailPage = lazy(() => import("./pages/NewsDetailPage.tsx"));
const NewsAuthorPage = lazy(() => import("./pages/NewsAuthorPage.tsx"));
const NewsCategoryOrDetailPage = lazy(() => import("./pages/NewsCategoryOrDetailPage.tsx"));
const SeasonsPage = lazy(() => import("./pages/SeasonsPage.tsx"));
const JoinPage = lazy(() => import("./pages/JoinPage.tsx"));
const EndurancePage = lazy(() => import("./features/endurance/shell/EndurancePage.tsx"));
const StewardPage = lazy(() => import("./pages/StewardPage.tsx"));
const NewsEditorPage = lazy(() => import("./pages/NewsEditorPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
// Local implementation test: the new Control Room temporarily owns /admin. Do not deploy until approved.
const AdminWorkspacePrototype = lazy(() => import("./pages/AdminWorkspacePrototype.tsx"));
const TrackIntelligenceTestPage = lazy(() => import("./pages/TrackIntelligenceTestPage.tsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.tsx"));
const KoppelPage = lazy(() => import("./pages/KoppelPage.tsx"));
const SimHubPairingPage = lazy(() => import("./pages/SimHubPairingPage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      <span className="text-xs text-muted-foreground">Laden...</span>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <LanguageProvider>
          <AuthProvider>
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<HomepagePrototype />} />
                  <Route path="/homepage-prototype" element={<Index />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/standings" element={<StandingsPage />} />
                  <Route path="/drivers" element={<DriversPage />} />
                  <Route path="/teams" element={<TeamsPage />} />
                  <Route path="/results" element={<ResultsPage />} />
                  <Route path="/results/:raceId" element={<RaceDetailPage />} />
                  <Route path="/news" element={<NewsPage />} />
                  <Route path="/news/author/:authorSlug" element={<NewsAuthorPage />} />
                  <Route path="/news/:categorySlug/:slug" element={<NewsDetailPage />} />
                  <Route path="/news/:categorySlug" element={<NewsCategoryOrDetailPage />} />
                  <Route path="/news/:slug" element={<NewsDetailPage />} />
                  <Route path="/seasons" element={<SeasonsPage />} />
                  <Route path="/meedoen" element={<JoinPage />} />
                  <Route path="/endurance/*" element={<EndurancePage />} />
                  <Route path="/stewards" element={<StewardPage />} />
                  <Route path="/news-editor" element={<NewsEditorPage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  {/* Local integration test: new Control Room at the real admin URL; do not deploy without approval. */}
                  <Route path="/admin" element={<AdminWorkspacePrototype />} />
                  <Route path="/admin/track-intelligence" element={<TrackIntelligenceTestPage />} />
                  <Route path="/admin/track-intelligence-test" element={<TrackIntelligenceTestPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/koppel" element={<KoppelPage />} />
                  <Route path="/simhub-koppelen" element={<SimHubPairingPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
