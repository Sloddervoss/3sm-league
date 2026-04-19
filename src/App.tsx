import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index.tsx";

// Lazy-loaded routes (keep Index eager for fastest initial paint)
const CalendarPage = lazy(() => import("./pages/CalendarPage.tsx"));
const StandingsPage = lazy(() => import("./pages/StandingsPage.tsx"));
const DriversPage = lazy(() => import("./pages/DriversPage.tsx"));
const TeamsPage = lazy(() => import("./pages/TeamsPage.tsx"));
const ResultsPage = lazy(() => import("./pages/ResultsPage.tsx"));
const SeasonsPage = lazy(() => import("./pages/SeasonsPage.tsx"));
const StewardPage = lazy(() => import("./pages/StewardPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.tsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.tsx"));
const KoppelPage = lazy(() => import("./pages/KoppelPage.tsx"));
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
        <AuthProvider>
<ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
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
                <Route path="/koppel" element={<KoppelPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
