import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { isDemoMode } from "@/integrations/supabase/client";
import StickyRaceBar from "@/components/StickyRaceBar";
import Index from "./pages/Index.tsx";
import CalendarPage from "./pages/CalendarPage.tsx";
import StandingsPage from "./pages/StandingsPage.tsx";
import DriversPage from "./pages/DriversPage.tsx";
import TeamsPage from "./pages/TeamsPage.tsx";
import ResultsPage from "./pages/ResultsPage.tsx";
import SeasonsPage from "./pages/SeasonsPage.tsx";
import StewardPage from "./pages/StewardPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import PreviewPage from "./pages/PreviewPage.tsx";
import DriverProfilePreview from "./pages/preview/DriverProfilePreview.tsx";
import RaceDetailPreview from "./pages/preview/RaceDetailPreview.tsx";
import TeamProfilePreview from "./pages/preview/TeamProfilePreview.tsx";
import StandingsFullPreview from "./pages/preview/StandingsFullPreview.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minuten — voorkomt constant refetchen bij navigatie
      retry: 1,
    },
  },
});

const DemoBanner = () => (
  <div className="fixed bottom-0 left-0 right-0 z-[100] bg-yellow-500/95 backdrop-blur text-black text-xs font-bold flex items-center justify-between px-4 py-2 border-t-2 border-yellow-400">
    <span>⚡ DEMO MODUS — Nep testdata, auto-ingelogd als admin (Vincent de Vos)</span>
    <button
      onClick={async () => {
        const { resetDemoData } = await import("@/integrations/supabase/mockClient");
        resetDemoData();
      }}
      className="px-3 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors text-black font-bold ml-4 shrink-0"
    >
      Reset data
    </button>
  </div>
);

const EXCLUDED_PATHS = ["/calendar", "/admin", "/stewards", "/profile"];

const AppLayout = () => {
  const location = useLocation();
  const showBar = !EXCLUDED_PATHS.includes(location.pathname);
  return (
    <div className="overflow-x-hidden">
      {isDemoMode && <DemoBanner />}
      {showBar && <StickyRaceBar />}
      <div style={{ paddingTop: showBar ? 44 : 0 }}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/standings" element={<StandingsPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/seasons" element={<SeasonsPage />} />
          <Route path="/stewards" element={<StewardPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/preview/driver" element={<DriverProfilePreview />} />
          <Route path="/preview/race" element={<RaceDetailPreview />} />
          <Route path="/preview/team" element={<TeamProfilePreview />} />
          <Route path="/preview/standings" element={<StandingsFullPreview />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppLayout />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
