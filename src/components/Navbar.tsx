import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Flag, Calendar, Trophy, Users, Menu, X, LogIn, User, Settings, LogOut, Car, List } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { label: "Home", path: "/", icon: Flag },
  { label: "Kalender", path: "/calendar", icon: Calendar },
  { label: "Stand", path: "/standings", icon: Trophy },
  { label: "Coureurs", path: "/drivers", icon: Users },
  { label: "Teams", path: "/teams", icon: Car },
  { label: "Uitslagen", path: "/results", icon: List },
  { label: "Seizoenen", path: "/seasons", icon: Trophy },
];

const Navbar = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isAdmin, signOut } = useAuth();

  const showDesktop = isAdmin ? "xl:flex" : "lg:flex";
  const hideDesktop = isAdmin ? "xl:hidden" : "lg:hidden";

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
        <div className={`hidden ${showDesktop} items-center gap-0`}>
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 bg-gradient-racing rounded-md"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <item.icon className="w-3.5 h-3.5" />
                  {item.label}
                </span>
              </Link>
            );
          })}

          <div className="w-px h-6 bg-border mx-2" />

          {user ? (
            <div className="flex items-center gap-1">
              {isAdmin && (
                <>
                  <Link
                    to="/admin"
                    className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === "/admin" ? "text-accent" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5" />
                      Admin
                    </span>
                  </Link>
                  <Link
                    to="/stewards"
                    className={`relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === "/stewards" ? "text-accent" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5" />
                      Stewards
                    </span>
                  </Link>
                </>
              )}
              <Link
                to="/profile"
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
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Link
              to="/auth"
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-gradient-racing text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
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
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${hideDesktop} bg-card border-b border-border px-4 pb-4`}
        >
          {navItems.map((item) => {
            const active = location.pathname === item.path;
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
              {isAdmin && (
                <>
                  <Link to="/admin" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                    <Settings className="w-4 h-4" /> Admin
                  </Link>
                  <Link to="/stewards" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                    <Trophy className="w-4 h-4" /> Stewards
                  </Link>
                </>
              )}
              <Link to="/profile" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
                <User className="w-4 h-4" /> Profiel
              </Link>
              <button onClick={() => { signOut(); setMobileOpen(false); }} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground w-full text-left">
                <LogOut className="w-4 h-4" /> Uitloggen
              </button>
            </>
          ) : (
            <Link to="/auth" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium bg-primary text-primary-foreground">
              <LogIn className="w-4 h-4" /> Inloggen
            </Link>
          )}
        </motion.div>
      )}
    </nav>
  );
};

export default Navbar;
