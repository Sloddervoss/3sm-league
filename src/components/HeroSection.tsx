import { ChevronRight, Calendar, Trophy, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import heroBg from "@/assets/hero-bg.webp";
import heroBgDesktop from "@/assets/hero-bg-desktop.webp";
import heroBgMobile from "@/assets/hero-bg-mobile.webp";

const HeroSection = () => {
  return (
    <section className="relative min-h-[45vh] md:min-h-[55vh] flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <picture>
          <source srcSet={heroBgMobile} media="(max-width: 768px)" />
          <source srcSet={heroBgDesktop} media="(max-width: 1400px)" />
          <img src={heroBg} alt="" className="w-full h-full object-cover" fetchPriority="high" width="1920" height="1080" />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px w-8 bg-gradient-racing" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.2em]">
                iRacing League
              </span>
            </div>

            <h1 className="font-heading text-4xl md:text-6xl font-black leading-[0.9] mb-4">
              3 STRIPE
              <br />
              <span className="text-gradient-racing">MOTORSPORT</span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground mb-6 max-w-lg leading-relaxed">
              De officiele sim racing league. Race mee in onze competities,
              klim in het klassement en bewijs jezelf op de baan.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                to="/calendar"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-gradient-racing text-primary-foreground font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
              >
                <Calendar className="w-4 h-4" />
                Kalender
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                to="/standings"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border bg-card/50 backdrop-blur text-foreground font-heading font-bold text-sm uppercase tracking-wider hover:border-primary/50 transition-colors"
              >
                <Trophy className="w-4 h-4" />
                Bekijk stand
              </Link>
            </div>
          </div>

          <Link
            to="/meedoen"
            className="group relative z-20 mb-8 block overflow-hidden rounded-lg border border-primary/30 bg-card/45 p-4 backdrop-blur-md transition-all hover:border-primary/70 hover:bg-card/65 sm:p-5 lg:mb-0 lg:translate-y-10"
            aria-label="Lees hoe je meedoet met 3 Stripe Motorsport"
          >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-racing" />
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-racing text-white shadow-lg shadow-primary/20 sm:h-12 sm:w-12">
                <UserPlus className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Meedoen</p>
                <h2 className="font-heading text-xl font-black leading-tight text-foreground">Word onderdeel van de grid</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Bekijk hoe je aansluit bij de iRacing community van 3SM.
                </p>
              </div>
              <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </div>
          </Link>
        </div>
      </div>

      {/* Decorative racing stripe */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-racing" />
    </section>
  );
};

export default HeroSection;
