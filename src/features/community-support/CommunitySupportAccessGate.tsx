import { useEffect, type ReactNode } from "react";
import { Navigate, Link } from "react-router-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { COMMUNITY_SUPPORT_PUBLIC, canManageCommunitySupport, canViewCommunitySupport } from "./model";

const LoadingState = () => {
  const { language } = useLanguage();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="flex min-h-[70vh] items-center justify-center px-4 pt-24">
        <div role="status" className="flex items-center gap-3 text-sm text-gray-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500/25 border-t-orange-400" />
          {language === "en" ? "Checking access…" : "Toegang controleren…"}
        </div>
      </main>
    </div>
  );
};

const SignInState = ({ management }: { management: boolean }) => {
  const { language } = useLanguage();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 pt-24">
        <section className="w-full rounded-[1.75rem] bg-card/65 p-8 text-center shadow-2xl shadow-black/25 ring-1 ring-white/[0.07]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-400/20"><LockKeyhole className="h-5 w-5" /></div>
          <h1 className="mt-5 font-heading text-2xl font-black">COMMUNITY SUPPORT</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">{language === "en" ? "This environment is currently available to Super-admins only." : "Deze omgeving is momenteel alleen beschikbaar voor Super-admins."}</p>
          <Link to={`/auth/?redirect=${encodeURIComponent(management ? "/support-beheer/" : "/support/")}`} className="mt-6 inline-flex rounded-xl bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/30">{language === "en" ? "Log in" : "Inloggen"}</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export const CommunitySupportAccessGate = ({ children, management = false }: { children: ReactNode; management?: boolean }) => {
  const { user, isSuperAdmin, loading, rolesLoading } = useAuth();
  const allowed = management ? canManageCommunitySupport(isSuperAdmin) : canViewCommunitySupport(isSuperAdmin);

  useEffect(() => {
    if (!management && COMMUNITY_SUPPORT_PUBLIC) return;
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = robots?.content;
    if (robots) robots.content = "noindex, nofollow";
    return () => { if (robots && previous !== undefined) robots.content = previous; };
  }, [management]);

  if (!management && COMMUNITY_SUPPORT_PUBLIC) return children;
  if (loading || rolesLoading) return <LoadingState />;
  if (!user) return <SignInState management={management} />;
  if (!allowed) return <Navigate to="/" replace />;
  return children;
};

export const ManagementBadge = () => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200 ring-1 ring-orange-400/20">
    <ShieldCheck className="h-3.5 w-3.5" /> Super-admin
  </span>
);
