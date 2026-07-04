import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Car,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Disc3,
  Flag,
  Gauge,
  Headphones,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { useLanguage } from "@/i18n/useLanguage";

const DISCORD_URL = "https://discord.gg/H7tZVuzBgT";

const setMetaTag = (selector: string, attr: "content" | "href", value: string) => {
  const element = document.head.querySelector(selector);
  if (element) element.setAttribute(attr, value);
};

const steps = [
  {
    number: "01",
    icon: MessageCircle,
    title: "Join de 3SM Discord",
    text: "Stap de paddock binnen. Op Discord vind je aankondigingen, vragen van andere coureurs, reminders en de praktische info rond elke raceavond.",
  },
  {
    number: "02",
    icon: UserPlus,
    title: "Maak je profiel compleet",
    text: "Registreer op de site en vul je iRacing naam en Customer ID in. Zo worden inschrijvingen, resultaten en standings netjes aan jou gekoppeld.",
  },
  {
    number: "03",
    icon: BadgeCheck,
    title: "Koppel Discord met /koppel",
    text: "Gebruik de koppel-flow zodat je Discord-account en 3SM-profiel bij elkaar horen. Teamrollen en updates kunnen daarna automatisch goed landen.",
  },
  {
    number: "04",
    icon: Flag,
    title: "Kies je race en schrijf je in",
    text: "Bekijk de kalender, check circuit en tijden, meld je aan en bereid je voor. Daarna zien we je op de grid.",
  },
];

const expectations = [
  { icon: CalendarDays, label: "Duidelijke planning", text: "Kalender, tijden en race-informatie staan op één plek." },
  { icon: Trophy, label: "Competitie met context", text: "Uitslagen, punten en standings geven elke race betekenis." },
  { icon: ShieldCheck, label: "Clean racing cultuur", text: "Hard racen mag, maar respect en racecraft blijven de basis." },
  { icon: Users, label: "Open community", text: "Begonnen in Nederland, maar welkom voor iedereen die leuk, fair en respectvol wil racen." },
];

const audience = [
  {
    icon: Gauge,
    title: "Voor fanatieke simracers",
    text: "Je wilt meer dan losse online lobbies: terugkerende races, herkenbare tegenstanders en een klassement dat ergens om draait.",
  },
  {
    icon: ShieldCheck,
    title: "Voor clean racers",
    text: "Je houdt van hard verdedigen en mooie gevechten, maar snapt dat ruimte, voorbereiding en respect de league beter maken.",
  },
  {
    icon: Users,
    title: "Voor community-rijders",
    text: "Je zoekt een community waar je vragen kunt stellen, samen kunt trainen en raceavonden samen beleeft — begonnen in Nederland, maar open voor coureurs uit elk land.",
  },
];

const requirements = [
  "Een actief iRacing account",
  "Een Discord account voor communicatie en updates",
  "Een compleet 3SM profiel met je exacte iRacing naam en Customer ID",
  "Respect voor regels, stewards en andere coureurs",
  "Voorbereiding op de raceavond: briefing lezen, verbinding checken en veilig rijden",
];

const raceNight = [
  { time: "Vooraf", title: "Kalender en briefing checken", text: "Bekijk circuit, sessietijden, inschrijving, Discord-updates en eventuele extra mededelingen." },
  { time: "Training", title: "Tempo vinden met de community", text: "Gebruik practice om lijnen, setup, banden en racepace te leren kennen voordat het serieus wordt." },
  { time: "Race", title: "Hard maar fair racen", text: "Vecht voor positie, maar geef ruimte. Een sterke battle is meer waard dan een onnodig incident." },
  { time: "Na afloop", title: "Resultaten en standings", text: "Uitslagen worden verwerkt, klassementen bijgewerkt en opvallende momenten besproken." },
];

const communityHighlights = [
  { icon: Flag, title: "Begonnen in Nederland", text: "De basis en sfeer zijn Nederlands, met herkenbare communicatie en een actieve paddock rond raceavonden." },
  { icon: Users, title: "Iedereen is welkom", text: "Je hoeft niet Nederlands te zijn. Als je hetzelfde doel hebt — leuk, fair en respectvol racen — pas je bij 3SM." },
  { icon: ShieldCheck, title: "Het doel blijft simpel", text: "Samen mooie battles rijden, elkaar ruimte geven en na afloop met plezier terugkijken op de race." },
];


const exploreLinks = [
  { icon: CalendarDays, title: "Bekijk de racekalender", text: "Zie welke races eraan komen, welke circuits op de planning staan en waar je je kunt inschrijven.", to: "/calendar" },
  { icon: Trophy, title: "Volg de standings", text: "Bekijk kampioenschappen, punten en posities zodat je weet waar de competitie om draait.", to: "/standings" },
  { icon: Flag, title: "Bekijk race-uitslagen", text: "Kijk terug naar afgeronde races, resultaten en prestaties van coureurs op de baan.", to: "/results" },
  { icon: Car, title: "Ontdek teams", text: "Zie welke teams actief zijn en hoe de community op de site zichtbaar wordt.", to: "/teams" },
];

const faq = [
  {
    question: "Hoe kan ik meedoen met 3 Stripe Motorsport?",
    answer: "Join eerst de Discord, maak daarna een profiel aan op de site, vul je iRacing gegevens in, koppel Discord met /koppel en schrijf je via de kalender in voor een race of seizoen.",
  },
  {
    question: "Kan ik meedoen met deze Nederlandse iRacing community als ik nieuw ben?",
    answer: "Ja. Begin op Discord, maak een profiel aan en schrijf je in voor races zodra je weet welke klasse en kalender bij je past. Nieuwe coureurs zijn welkom zolang ze clean en fair racen.",
  },
  {
    question: "Is 3SM alleen voor Nederlandse coureurs?",
    answer: "Nee. 3SM is begonnen als Nederlandse community en een groot deel van de coureurs is Nederlands, maar iedereen is welkom zolang het doel hetzelfde is: leuk, fair en respectvol racen.",
  },
  {
    question: "Moet ik al ervaren zijn om mee te doen?",
    answer: "Nee. Ervaring helpt, maar de belangrijkste basis is veilig, respectvol en leergierig rijden. Nieuwe coureurs zijn welkom zolang ze de regels en andere rijders serieus nemen.",
  },
  {
    question: "Waarom moet ik mijn iRacing gegevens invullen?",
    answer: "Je iRacing naam en Customer ID zorgen dat inschrijvingen, geïmporteerde resultaten, standings, teams en profielen betrouwbaar aan de juiste coureur gekoppeld worden.",
  },
  {
    question: "Waar vind ik de volgende race?",
    answer: "De kalender op de site is je vaste startpunt voor races, circuits, tijden en inschrijven. Discord wordt gebruikt voor reminders, aankondigingen en praktische updates.",
  },
  {
    question: "Welke klasse rijden jullie?",
    answer: "Op dit moment focussen we op GT3 in iRacing. Als de community groeit, willen we later uitbreiden naar bijvoorbeeld multiclass of extra raceformats.",
  },
  {
    question: "Kan ik nog instappen?",
    answer: "Ja. De grid groeit en nieuwe coureurs kunnen nog aansluiten bij races, teams en seizoenen.",
  },
  {
    question: "Kan ik met een team meedoen?",
    answer: "Ja. Je kunt aansluiten bij een bestaand team of een nieuw team aanvragen. Teams krijgen een eigen Discord-sectie voor teamleden.",
  },
];

const CircuitArtwork = () => (
  <div className="relative overflow-hidden rounded-3xl border border-border bg-card/45 p-4 shadow-2xl shadow-primary/10 backdrop-blur md:p-5">
    <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/25 blur-3xl" />
    <div className="absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
    <div className="relative rounded-2xl border border-white/10 bg-black/35 p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Join route</p>
          <p className="font-heading text-2xl font-black">3SM Race Route</p>
        </div>
        <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-primary">
          Open
        </div>
      </div>
      <svg viewBox="0 0 320 300" className="h-72 w-full md:h-80" role="img" aria-label="Routekaart met vier stappen om mee te doen met 3SM">
        <defs>
          <linearGradient id="trackGlow" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ef4444" />
            <stop offset="0.55" stopColor="#f97316" />
            <stop offset="1" stopColor="#facc15" />
          </linearGradient>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="320" height="300" rx="20" fill="rgba(15,23,42,0.58)" />
        <path d="M42 92 C66 38 149 34 176 83 C199 126 136 139 142 180 C148 228 250 225 269 171 C289 112 228 72 187 101" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="34" strokeLinecap="round" />
        <path d="M42 92 C66 38 149 34 176 83 C199 126 136 139 142 180 C148 228 250 225 269 171 C289 112 228 72 187 101" fill="none" stroke="rgba(2,6,23,0.72)" strokeWidth="20" strokeLinecap="round" />
        <path d="M42 92 C66 38 149 34 176 83 C199 126 136 139 142 180 C148 228 250 225 269 171 C289 112 228 72 187 101" fill="none" stroke="url(#trackGlow)" strokeWidth="5" strokeLinecap="round" strokeDasharray="28 14" filter="url(#softGlow)" />
        <path d="M36 238 H284" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        <path d="M58 55 H134" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
        <path d="M230 248 H284" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />

        {[
          { nr: "1", label: "Discord", x: 42, y: 92, tx: 58, ty: 82, anchor: "start" },
          { nr: "2", label: "Profiel", x: 176, y: 83, tx: 189, ty: 58, anchor: "start" },
          { nr: "3", label: "Koppelen", x: 142, y: 180, tx: 124, ty: 214, anchor: "middle" },
          { nr: "4", label: "Race", x: 269, y: 171, tx: 252, ty: 205, anchor: "middle" },
        ].map((point) => (
          <g key={point.nr}>
            <circle cx={point.x} cy={point.y} r="19" fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.42)" strokeWidth="3" />
            <circle cx={point.x} cy={point.y} r="12" fill="#0f172a" stroke="#fb923c" strokeWidth="3" />
            <text x={point.x} y={point.y + 5} textAnchor="middle" fill="white" fontSize="13" fontWeight="900">{point.nr}</text>
            <rect x={point.anchor === "middle" ? point.tx - 42 : point.tx - 8} y={point.ty - 18} width="84" height="28" rx="8" fill="rgba(15,23,42,0.86)" stroke="rgba(255,255,255,0.12)" />
            <text x={point.anchor === "middle" ? point.tx : point.tx + 34} y={point.ty} textAnchor="middle" fill="white" fontSize="10" fontWeight="900" letterSpacing="1.4">{point.label}</text>
          </g>
        ))}

        <g transform="translate(30 252)">
          <rect x="0" y="0" width="260" height="30" rx="10" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.11)" />
          <text x="16" y="20" fill="#fb923c" fontSize="9" fontWeight="900" letterSpacing="2">ROUTE</text>
          <text x="90" y="20" fill="white" fontSize="9.5" fontWeight="900">Discord → Profiel → Link → Race</text>
        </g>
      </svg>
    </div>
  </div>
);

const JoinPage = () => {
  const { language, t } = useLanguage();

  useEffect(() => {
    const meta = language === "en"
      ? {
          title: "Join 3SM - Dutch iRacing & Discord Community",
          description: "Looking for an iRacing community in the Netherlands? Join 3 Stripe Motorsport: a Dutch iRacing league with Discord, calendar, standings and results.",
          ogTitle: "Join the 3SM iRacing community",
          ogDescription: "Looking for an iRacing community in the Netherlands or a Discord where you can race? At 3SM you join a Dutch iRacing league.",
        }
      : {
          title: "Meedoen met 3SM - iRacing Nederland & Discord Community",
          description: "Zoek je een iRacing community in Nederland? Doe mee met 3 Stripe Motorsport: een Nederlandse iRacing league met Discord, kalender, standings en uitslagen.",
          ogTitle: "Meedoen met de 3SM iRacing community",
          ogDescription: "Zoek je een iRacing community in Nederland of een Discord waar je mee kunt racen? Bij 3SM sluit je aan bij een Nederlandse iRacing league.",
        };

    document.title = meta.title;
    setMetaTag('meta[name="description"]', "content", meta.description);
    setMetaTag('meta[property="og:title"]', "content", meta.ogTitle);
    setMetaTag('meta[property="og:description"]', "content", meta.ogDescription);
    setMetaTag('meta[property="og:url"]', "content", "https://3stripemotorsport.cc/meedoen/");
    setMetaTag('link[rel="canonical"]', "href", "https://3stripemotorsport.cc/meedoen/");

    const schemaId = "join-page-faq-schema";
    document.getElementById(schemaId)?.remove();
    const script = document.createElement("script");
    script.id = schemaId;
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(({ question, answer }) => ({
        "@type": "Question",
        name: t(question),
        acceptedAnswer: { "@type": "Answer", text: t(answer) },
      })),
    });
    document.head.appendChild(script);

    return () => document.getElementById(schemaId)?.remove();
  }, [language, t]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_8%,rgba(239,68,68,0.24),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(249,115,22,0.18),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.02),rgba(0,0,0,0.46))]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-racing" />
          <div className="container relative z-10 mx-auto grid max-w-7xl gap-10 px-4 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,33rem)] lg:items-center lg:py-24">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }}>
              <div className="mb-5 flex items-center gap-3">
                <div className="h-px w-10 bg-gradient-racing" />
                <span className="text-sm font-black uppercase tracking-[0.24em] text-primary">Meedoen met de 3SM iRacing community</span>
              </div>
              <h1 className="font-heading text-4xl font-black leading-[0.88] md:text-6xl xl:text-7xl">
                iRacing community voor
                <br />
                <span className="text-gradient-racing">clean racing</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Zoek je een iRacing community in Nederland of een Discord waar je mee kunt racen? Bij 3SM sluit je aan bij een Nederlandse iRacing league met kalender, standings en uitslagen.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={DISCORD_URL}
                  className="inline-flex items-center gap-2 rounded-md bg-gradient-racing px-5 py-3 font-heading text-sm font-black uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <MessageCircle className="h-4 w-4" />
                  Join de Discord
                  <ChevronRight className="h-4 w-4" />
                </a>
                <Link
                  to="/calendar/"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-5 py-3 font-heading text-sm font-black uppercase tracking-wider text-foreground backdrop-blur transition-colors hover:border-primary/50"
                >
                  <CalendarDays className="h-4 w-4" />
                  Bekijk kalender
                </Link>
              </div>
              <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Open", "Community"],
                  ["Clean", "Racing"],
                  ["Live", "Standings"],
                  ["Team", "Community"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-border bg-card/35 p-3 backdrop-blur">
                    <p className="font-heading text-2xl font-black text-foreground">{value}</p>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.75, delay: 0.1 }}>
              <CircuitArtwork />
            </motion.div>
          </div>
        </section>

        <section className="container mx-auto max-w-7xl px-4 py-16">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-[0.24em] text-primary">Waarom 3 Stripe Motorsport?</span>
              </div>
              <h2 className="font-heading text-3xl font-black leading-tight md:text-5xl">
                Geen losse lobby, maar een herkenbare competitie.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">
                3SM combineert de sfeer van een community die in Nederland is begonnen met de structuur van een echte iRacing league: geplande GT3-races, duidelijke communicatie, standings, teams en ruimte om later door te groeien naar multi-class races.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {expectations.map(({ icon: Icon, label, text }) => (
                <div key={label} className="card-hover rounded-xl border border-border bg-card/55 p-5">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-racing text-white shadow-lg shadow-primary/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-heading text-xl font-black">{label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-racing-dark/80 py-16">
          <div className="container mx-auto max-w-7xl px-4">
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Zo doe je mee</p>
              <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Van interesse naar startgrid in vier stappen</h2>
              <p className="mt-4 text-muted-foreground">
                De flow is bewust duidelijk: eerst de community binnen, daarna je profiel en iRacing gegevens op orde, vervolgens Discord koppelen en inschrijven voor de race die je wilt rijden.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {steps.map(({ number, icon: Icon, title, text }) => (
                <div key={number} className="relative overflow-hidden rounded-xl border border-border bg-card/70 p-5">
                  <span className="absolute right-4 top-3 font-heading text-5xl font-black text-white/5">{number}</span>
                  <div className="relative z-10">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-heading text-xl font-black">{title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-7xl px-4 py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Voor wie is 3SM?</p>
            <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Als je competitie zoekt zonder de community kwijt te raken.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {audience.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-border bg-card/45 p-6">
                <Icon className="mb-5 h-8 w-8 text-primary" />
                <h3 className="font-heading text-2xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container mx-auto grid max-w-7xl gap-8 px-4 pb-16 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-2xl border border-border bg-card/45 p-6 md:p-8">
            <div className="mb-6 flex items-center gap-3">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              <h2 className="font-heading text-3xl font-black">Wat heb je nodig?</h2>
            </div>
            <div className="space-y-3">
              {requirements.map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border border-border bg-background/45 p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm font-medium text-foreground md:text-base">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-[#5865F2]/30 bg-[#5865F2]/10 p-6 md:p-8">
            <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#5865F2]/30 blur-3xl" />
            <Headphones className="mb-5 h-9 w-9 text-[#9ea7ff]" />
            <h2 className="font-heading text-3xl font-black">Discord is de paddock, de site is het scorebord.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Discord is waar de community praat, vragen stelt en raceavonden voorbereidt. De site blijft de officiële plek voor kalender, profielen, teams, inschrijvingen, uitslagen en standings.
            </p>
            <a
              href={DISCORD_URL}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-4 py-2.5 font-heading text-sm font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90"
            >
              Naar Discord
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section className="border-y border-border bg-card/25 py-16">
          <div className="container mx-auto max-w-7xl px-4">
            <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
              <div className="lg:sticky lg:top-28">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Raceavond</p>
                <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Wat kun je verwachten?</h2>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  3SM wil serieus racen toegankelijk houden. Op dit moment ligt de focus vooral op GT3-races, met duidelijke informatie vooraf, herkenbare stappen op de avond zelf en resultaten waar je later op terug kunt kijken.
                </p>
              </div>
              <div className="space-y-4">
                {raceNight.map(({ time, title, text }, index) => (
                  <div key={title} className="grid gap-4 rounded-xl border border-border bg-card/50 p-5 sm:grid-cols-[7rem_1fr]">
                    <div className="flex items-center gap-3 sm:block">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-racing font-heading font-black text-white sm:mb-3">
                        {index + 1}
                      </div>
                      <p className="font-heading text-sm font-black uppercase tracking-[0.18em] text-primary">{time}</p>
                    </div>
                    <div>
                      <h3 className="font-heading text-xl font-black">{title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-7xl px-4 py-16">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Community</p>
              <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Begonnen in Nederland, open voor dezelfde race-mentaliteit.</h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">
                3SM heeft een Nederlandse basis en sfeer, maar draait niet om landsgrenzen. Het gaat om coureurs die samen leuke raceavonden willen rijden: serieus genoeg voor competitie, ontspannen genoeg voor een community.
              </p>
            </div>
            <div className="grid gap-3">
              {communityHighlights.map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex gap-4 rounded-xl border border-border bg-card/55 p-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-heading text-xl font-black">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card/25 py-16">
          <div className="container mx-auto max-w-7xl px-4">
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">De 3SM mentaliteit</p>
                <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Hard racen. Slim racen. Respectvol racen.</h2>
                <p className="mt-5 leading-relaxed text-muted-foreground">
                  De mooiste battles ontstaan wanneer coureurs elkaar vertrouwen. Daarom kiest 3SM voor heldere verwachtingen: voorbereid aan de start verschijnen, ruimte laten waar nodig en incidenten netjes via de steward-flow afhandelen.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Gauge, title: "Pace", text: "Snelheid telt, maar consistentie wint kampioenschappen." },
                  { icon: Wrench, title: "Prep", text: "Ken de baan, check de briefing en kom klaar voor de race." },
                  { icon: Disc3, title: "Control", text: "Rust houden in gevechten maakt de league beter voor iedereen." },
                ].map(({ icon: Icon, title, text }) => (
                  <div key={title} className="rounded-xl border border-border bg-background/55 p-5">
                    <Icon className="mb-4 h-6 w-6 text-primary" />
                    <h3 className="font-heading text-xl font-black">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-7xl px-4 py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Verder kijken</p>
            <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Bekijk wat er op de grid gebeurt.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Meedoen begint met de community, maar de site laat zien hoe de league leeft: geplande races, klassementen, uitslagen, coureurs en teams.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {exploreLinks.map(({ icon: Icon, title, text, to }) => (
              <Link key={to} to={to} className="group flex h-full min-h-[19rem] flex-col rounded-2xl border border-border bg-card/45 p-6 transition-colors hover:border-primary/50 hover:bg-card/65">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-heading text-2xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
                <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-black uppercase tracking-wider text-primary">
                  Open pagina
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="container mx-auto max-w-5xl px-4 py-16">
          <div className="mb-8 text-center">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Veelgestelde vragen</p>
            <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Alles wat je wilt weten voor je instapt</h2>
          </div>
          <div className="space-y-3">
            {faq.map(({ question, answer }) => (
              <details key={question} className="group rounded-xl border border-border bg-card/55 p-5 open:border-primary/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-lg font-black">
                  {question}
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 group-open:text-primary" />
                </summary>
                <p className="mt-4 leading-relaxed text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="container mx-auto max-w-7xl px-4 pb-20">
          <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-card to-accent/10 p-8 md:p-10">
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[linear-gradient(135deg,transparent,rgba(255,255,255,0.05))]" />
            <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Klaar om mee te rijden?</p>
                <h2 className="mt-3 font-heading text-3xl font-black md:text-5xl">Pak je plek op de 3SM grid.</h2>
                <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
                  Start bij Discord, maak je profiel compleet en meld je aan voor de race die bij jou past. De community ziet je op de baan.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a href={DISCORD_URL} className="inline-flex items-center justify-center gap-2 rounded-md bg-gradient-racing px-5 py-3 font-heading text-sm font-black uppercase tracking-wider text-white hover:opacity-90">
                  Join de Discord
                  <ArrowRight className="h-4 w-4" />
                </a>
                <Link to="/calendar/" className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background/60 px-5 py-3 font-heading text-sm font-black uppercase tracking-wider text-foreground hover:border-primary/50">
                  Bekijk kalender
                  <Clock3 className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default JoinPage;
