import { motion } from "framer-motion";
import { Flag, ChevronRight, Calendar, Trophy } from "lucide-react";
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

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="max-w-2xl"
        >
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
            De officiële sim racing league. Race mee in onze competities,
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
        </motion.div>
      </div>

      {/* Decorative racing stripe */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-racing" />
    </section>
  );
};

export default HeroSection;
