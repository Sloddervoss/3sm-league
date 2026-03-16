import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t border-border py-10 bg-racing-dark">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded bg-gradient-racing flex items-center justify-center shadow-lg shadow-primary/30">
                <span className="font-heading font-black text-white text-[11px] tracking-tight">3SM</span>
              </div>
              <span className="font-heading font-bold text-base">3 Stripe Motorsport</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              De officiële sim racing league voor iRacing. Race mee, klim in het klassement en bewijs jezelf op de baan.
            </p>
          </div>
          <div>
            <h4 className="font-heading font-bold text-sm uppercase tracking-wider mb-3 text-muted-foreground">Navigatie</h4>
            <div className="grid grid-cols-2 gap-1">
              {[
                { label: "Home", path: "/" },
                { label: "Kalender", path: "/calendar" },
                { label: "Standings", path: "/standings" },
                { label: "Drivers", path: "/drivers" },
                { label: "Teams", path: "/teams" },
                { label: "Results", path: "/results" },
                { label: "Seasons", path: "/seasons" },
              ].map((link) => (
                <Link key={link.path} to={link.path} className="text-xs text-muted-foreground hover:text-primary transition-colors py-0.5">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-heading font-bold text-sm uppercase tracking-wider mb-3 text-muted-foreground">Platform</h4>
            <div className="space-y-1">
              <Link to="/auth" className="block text-xs text-muted-foreground hover:text-primary transition-colors py-0.5">Inloggen / Registreren</Link>
              <Link to="/profile" className="block text-xs text-muted-foreground hover:text-primary transition-colors py-0.5">Mijn Profiel</Link>
              <Link to="/stewards" className="block text-xs text-muted-foreground hover:text-primary transition-colors py-0.5">Protest Indienen</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <span className="font-heading font-bold text-sm text-muted-foreground">
            3 Stripe Motorsport © 2026
          </span>
          <p className="text-xs text-muted-foreground">
            Powered by iRacing • Niet geaffilieerd met iRacing.com
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
