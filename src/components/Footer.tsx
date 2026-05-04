import type { SVGProps } from "react";
import { Link } from "react-router-dom";

const DISCORD_URL = "https://discord.gg/F6CM9kC2YY";
const INSTAGRAM_URL = "https://www.instagram.com/3stripemotorsport";

const DiscordIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 245 240" aria-hidden="true" fill="currentColor" {...props}>
    <path d="M104.4 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.3-5 10.2-11.1.1-6.1-4.5-11.1-10.2-11.1Zm36.4 0c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.2-5 10.2-11.1s-4.5-11.1-10.2-11.1Z" />
    <path d="M189.5 20h-134C44.2 20 35 29.2 35 40.6v135.2c0 11.4 9.2 20.6 20.5 20.6h113.4l-5.3-18.5 12.8 11.9 12.1 11.2 21.5 19V40.6C210 29.2 200.8 20 189.5 20Zm-38.9 130.6s-3.6-4.3-6.6-8.1c13.1-3.7 18.1-11.9 18.1-11.9-4.1 2.7-8 4.6-11.5 5.9-5 2.1-9.8 3.4-14.5 4.2-9.6 1.8-18.4 1.3-25.9-.1-5.7-1.1-10.6-2.6-14.7-4.2-2.3-.9-4.8-2-7.3-3.4-.3-.2-.6-.3-.9-.5-.2-.1-.3-.2-.4-.3-1.8-1-2.8-1.7-2.8-1.7s4.8 8 17.5 11.8c-3 3.8-6.7 8.3-6.7 8.3-22.1-.7-30.5-15.2-30.5-15.2 0-32.2 14.4-58.3 14.4-58.3 14.4-10.8 28.1-10.5 28.1-10.5l1 1.2c-18 5.2-26.3 13-26.3 13s2.2-1.2 5.9-2.9c10.7-4.7 19.2-6 22.7-6.3.6-.1 1.1-.2 1.7-.2 6.1-.8 13-1 20.2-.2 9.5 1.1 19.7 3.9 30.1 9.6 0 0-7.9-7.5-24.9-12.7l1.4-1.6s13.7-.3 28.1 10.5c0 0 14.4 26.1 14.4 58.3 0 .1-8.5 14.6-30.6 15.3Z" />
  </svg>
);

const InstagramIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect width="18" height="18" x="3" y="3" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const socialLinks = [
  {
    label: "Discord",
    href: DISCORD_URL,
    icon: DiscordIcon,
    className: "hover:border-[#5865F2]/70 hover:bg-[#5865F2]/15 hover:text-[#9ea7ff]",
  },
  {
    label: "Instagram",
    href: INSTAGRAM_URL,
    icon: InstagramIcon,
    className: "hover:border-primary/70 hover:bg-primary/10 hover:text-primary",
  },
];

const Footer = () => {
  return (
    <footer className="border-t border-border py-10 bg-racing-dark">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-8 mb-8 md:grid-cols-[1.6fr_1.2fr_1fr_auto]">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded bg-gradient-racing flex items-center justify-center shadow-lg shadow-primary/30">
                <span className="font-heading font-black text-white text-[11px] tracking-tight">3SM</span>
              </div>
              <span className="font-heading font-bold text-base">3 Stripe Motorsport</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Driven by passion. Powered by community.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Samen bouwen we aan de ultieme sim racing experience.
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
          <div className="md:justify-self-end">
            <h4 className="font-heading font-bold text-sm uppercase tracking-wider mb-3 text-muted-foreground">Socials</h4>
            <div className="flex gap-2">
              {socialLinks.map(({ label, href, icon: Icon, className }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open 3 Stripe Motorsport op ${label}`}
                  title={label}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/25 text-muted-foreground transition-colors ${className}`}
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <span className="font-heading font-bold text-sm text-muted-foreground">
            3 Stripe Motorsport © 2026
          </span>
          <p className="text-xs text-muted-foreground">
            Powered by Sloddervos — Niet geaffilieerd met iRacing.com
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
