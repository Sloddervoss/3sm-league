import { Link, useLocation } from "react-router-dom";
import { Flag, Calendar, Trophy, Users, Menu, X, LogIn, User, Settings, LogOut, Car, List, UserPlus, Newspaper } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";

const navItems = [
  { label: "Home", path: "/", icon: Flag },
  { label: "Kalender", path: "/calendar/", icon: Calendar },
  { label: "Standings", path: "/standings/", icon: Trophy },
  { label: "Coureurs", path: "/drivers/", icon: Users },
  { label: "Teams", path: "/teams/", icon: Car },
  { label: "Uitslagen", path: "/results/", icon: List },
  { label: "Nieuws", path: "/news/", icon: Newspaper },
  { label: "Seizoenen", path: "/seasons/", icon: Trophy },
  { label: "Meedoen", path: "/meedoen/", icon: UserPlus },
];

const Navbar = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isAdmin, isSuperAdmin, isSteward, isEditor, signOut } = useAuth();
  const { language, setLanguage } = useLanguage();

  const canEditNews = isAdmin || isSuperAdmin || isEditor;
  const canUseStewards = isAdmin || isSuperAdmin || isSteward;
  const showAdmin = isAdmin || isSuperAdmin;
  const showDesktop = showAdmin ? "xl:flex" : "lg:flex";
  const hideDesktop = showAdmin ? "xl:hidden" : "lg:hidden";
  const LanguageSwitch = ({ className = "" }: { className?: string }) => (
    <div
      className={`inline-flex h-8 items-center rounded-md border border-border bg-card/40 p-0.5 ${className}`}
      aria-label={language === "nl" ? "Taal kiezen" : "Choose language"}
      data-no-translate
    >
      {(["nl", "en"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          className={`h-7 min-w-9 rounded px-2 text-[11px] font-black uppercase tracking-wide transition-colors ${
            language === lang
              ? "bg-gradient-racing text-white shadow-sm shadow-primary/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={language === lang}
        >
          {lang === "nl" ? "NL" : "EN"}
        </button>
      ))}
    </div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded bg-gradient-racing flex items-center justify-center shadow-lg shadow-primary/30">
            <span className="font-heading font-black text-white text-[11px] tracking-tight">3SM</span>
          </div>
          <span className="font-heading font-bold text-lg tracking-wide hidden sm:block">
            3 Stripe <span className="text-gradient-racing">Motorsport</span>
          </span>
        </Link>

        {/* Desktop */}
        <div className={`hidden ${showDesktop} items-center gap-1.5`}>
          {navItems.map((item) => {
            const active = location.pathname === item.path || (item.path !== "/" && location.pathname === item.path.replace(/\/$/, ""));
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative px-3.5 py-2 rounded-md text-[15.5px] font-semibold transition-colors ${
                  active ? "bg-white/[0.035] text-white" : "text-gray-300 hover:bg-white/[0.025] hover:text-white"
                }`}
              >
                <span className="relative flex items-center gap-1.5 leading-none">
                  <item.icon className="w-3.5 h-3.5 shrink-0" />
                  {item.label}
                </span>
                {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-orange-500 rounded-full" />}
              </Link>
            );
          })}

          <div className="w-px h-6 bg-border mx-2" />
          <LanguageSwitch className="mr-2" />

          {user ? (
            <div className="flex items-center gap-1">
              {showAdmin && (
                <Link
                  to="/admin/"
                  className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname === "/admin" || location.pathname === "/admin/" ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5" />
                    Admin
                  </span>
                </Link>
              )}
              {canEditNews && (
                <Link
                  to="/news-editor/"
                  className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname === "/news-editor" || location.pathname === "/news-editor/" ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Newspaper className="w-3.5 h-3.5" />
                    Redactie
                  </span>
                </Link>
              )}
              {canUseStewards && (
                <Link
                  to="/stewards/"
                  className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname === "/stewards" ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" />
                    Stewards
                  </span>
                </Link>
              )}
              <Link
                to="/profile/"
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  Profiel
                </span>
              </Link>
              <button
                onClick={signOut}
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Uitloggen"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Link
              to="/auth/"
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-gradient-racing text-primary-foreground text-sm font-bold shadow-lg shadow-orange-950/20 ring-1 ring-orange-300/20 hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-4 h-4" />
              Inloggen
            </Link>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className={`${hideDesktop} text-foreground`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Sluit menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className={`${hideDesktop} bg-card border-b border-border px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-150`}
        >
          <div className="flex items-center justify-between py-3">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Taal</span>
            <LanguageSwitch />
          </div>
          {navItems.map((item) => {
            const active = location.pathname === item.path || (item.path !== "/" && location.pathname === item.path.replace(/\/$/, ""));
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
          <div className="h-px bg-border my-2" />
          {user ? (
            <>
              {showAdmin && (
                <Link to="/admin/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                  <Settings className="w-4 h-4" /> Admin
                </Link>
              )}
              {canEditNews && (
                <Link to="/news-editor/" onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium ${location.pathname === "/news-editor" || location.pathname === "/news-editor/" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Newspaper className="w-4 h-4" /> Redactie
                </Link>
              )}
              {canUseStewards && (
                <Link to="/stewards/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                  <Trophy className="w-4 h-4" /> Stewards
                </Link>
              )}
              <Link to="/profile/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                <User className="w-4 h-4" /> Profiel
              </Link>
              <button onClick={() => { signOut(); setMobileOpen(false); }} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground w-full text-left">
                <LogOut className="w-4 h-4" /> Uitloggen
              </button>
            </>
          ) : (
            <Link to="/auth/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium bg-primary text-primary-foreground">
              <LogIn className="w-4 h-4" /> Inloggen
            </Link>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
