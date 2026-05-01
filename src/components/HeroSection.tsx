import { motion } from "framer-motion";
import { ChevronRight, Calendar, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import heroBg from "@/assets/hero-bg.jpg";

const HeroSection = () => {
  return (
    <section className="relative min-h-[45vh] md:min-h-[55vh] flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <img src={heroBg} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      <div className="container mx-auto px-4 max-w-7xl relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end"
        >
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

          <a
            href="https://discord.gg/F6CM9kC2YY"
            onClick={(event) => {
              event.preventDefault();
              window.location.assign("https://discord.gg/F6CM9kC2YY");
            }}
            className="group relative z-20 block overflow-hidden rounded-lg border border-[#5865F2]/30 bg-card/45 p-5 backdrop-blur-md transition-all hover:border-[#5865F2]/70 hover:bg-card/65 lg:translate-y-10"
            aria-label="Join de 3 Stripe Motorsport Discord"
          >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#5865F2] via-primary to-transparent" />
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#5865F2] text-white shadow-lg shadow-[#5865F2]/20">
                <svg viewBox="0 0 245 240" aria-hidden="true" className="h-7 w-7 fill-current">
                  <path d="M104.4 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.3-5 10.2-11.1.1-6.1-4.5-11.1-10.2-11.1Zm36.4 0c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.2-5 10.2-11.1s-4.5-11.1-10.2-11.1Z" />
                  <path d="M189.5 20h-134C44.2 20 35 29.2 35 40.6v135.2c0 11.4 9.2 20.6 20.5 20.6h113.4l-5.3-18.5 12.8 11.9 12.1 11.2 21.5 19V40.6C210 29.2 200.8 20 189.5 20Zm-38.9 130.6s-3.6-4.3-6.6-8.1c13.1-3.7 18.1-11.9 18.1-11.9-4.1 2.7-8 4.6-11.5 5.9-5 2.1-9.8 3.4-14.5 4.2-9.6 1.8-18.4 1.3-25.9-.1-5.7-1.1-10.6-2.6-14.7-4.2-2.3-.9-4.8-2-7.3-3.4-.3-.2-.6-.3-.9-.5-.2-.1-.3-.2-.4-.3-1.8-1-2.8-1.7-2.8-1.7s4.8 8 17.5 11.8c-3 3.8-6.7 8.3-6.7 8.3-22.1-.7-30.5-15.2-30.5-15.2 0-32.2 14.4-58.3 14.4-58.3 14.4-10.8 28.1-10.5 28.1-10.5l1 1.2c-18 5.2-26.3 13-26.3 13s2.2-1.2 5.9-2.9c10.7-4.7 19.2-6 22.7-6.3.6-.1 1.1-.2 1.7-.2 6.1-.8 13-1 20.2-.2 9.5 1.1 19.7 3.9 30.1 9.6 0 0-7.9-7.5-24.9-12.7l1.4-1.6s13.7-.3 28.1 10.5c0 0 14.4 26.1 14.4 58.3 0 .1-8.5 14.6-30.6 15.3Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9ea7ff]">Discord</p>
                <h2 className="font-heading text-xl font-black leading-tight text-foreground">Join de community</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Praat mee, vind races en blijf op de hoogte van 3 Stripe.
                </p>
              </div>
              <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-[#9ea7ff]" />
            </div>
          </a>
        </motion.div>
      </div>

      {/* Decorative racing stripe */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-racing" />
    </section>
  );
};

export default HeroSection;
