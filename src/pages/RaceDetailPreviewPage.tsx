import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Car, CloudSun, Flag, Link as LinkIcon, List, Share2, Sparkles, Trophy, Zap } from "lucide-react";

type Driver = {
  pos: number;
  name: string;
  car: string;
  start: number;
  laps: number;
  led: number;
  best: string;
  inc: number;
  status: string;
  badge?: "fastest" | "clean";
};

const drivers: Driver[] = [
  { pos: 1, name: "Vincent Weijts", car: "Porsche 911 GT3 R (992)", start: 7, laps: 19, led: 2, best: "1:36.580", inc: 3, status: "Running" },
  { pos: 2, name: "Kevin Vanzoest", car: "Porsche 911 GT3 R (992)", start: 4, laps: 19, led: 0, best: "1:36.878", inc: 13, status: "Running" },
  { pos: 3, name: "Jordy De Wit", car: "Mercedes-AMG GT3 2020", start: 6, laps: 19, led: 0, best: "1:37.031", inc: 6, status: "Running" },
  { pos: 4, name: "Jaimy Peters", car: "Porsche 911 GT3 R (992)", start: 1, laps: 19, led: 0, best: "1:35.700", inc: 5, status: "Running" },
  { pos: 5, name: "Ricky Godefrooij", car: "McLaren 720S GT3 EVO", start: 3, laps: 19, led: 17, best: "1:37.182", inc: 2, status: "Running" },
  { pos: 6, name: "Bjorn Vorderman", car: "Porsche 911 GT3 R (992)", start: 5, laps: 19, led: 0, best: "1:37.984", inc: 9, status: "Running" },
  { pos: 7, name: "Kevin Schreuder3", car: "Porsche 911 GT3 R (992)", start: 10, laps: 19, led: 0, best: "1:38.088", inc: 7, status: "Running" },
  { pos: 8, name: "Kevin Beuker", car: "Porsche 911 GT3 R (992)", start: 8, laps: 19, led: 0, best: "1:38.147", inc: 8, status: "Running" },
  { pos: 9, name: "Vincent deVos", car: "McLaren 720S GT3 EVO", start: 2, laps: 19, led: 0, best: "1:35.851", inc: 4, status: "Running", badge: "fastest" },
  { pos: 10, name: "Bram Duitscher", car: "Mercedes-AMG GT3 2020", start: 9, laps: 19, led: 0, best: "1:38.431", inc: 0, status: "Disconnected", badge: "clean" },
];

const podium = drivers.slice(0, 3);
const winner = drivers[0];
const pole = { name: "Jaimy Peters", lap: "1:35.700" };
const fastest = drivers.find((driver) => driver.badge === "fastest")!;
const cleanest = drivers.find((driver) => driver.badge === "clean")!;
const bigMover = drivers.reduce((best, driver) => (driver.start - driver.pos > best.start - best.pos ? driver : best), drivers[0]);
const mostLed = drivers.reduce((best, driver) => (driver.led > best.led ? driver : best), drivers[0]);

const carCounts = drivers.reduce<Record<string, number>>((acc, driver) => {
  const label = driver.car.replace(" (992)", "").replace(" 2020", "");
  acc[label] = (acc[label] || 0) + 1;
  return acc;
}, {});

const getDelta = (driver: Driver) => driver.start - driver.pos;

const deltaClass = (delta: number) => {
  if (delta > 0) return "border-green-500/25 bg-green-500/10 text-green-400";
  if (delta < 0) return "border-red-500/25 bg-red-500/10 text-red-400";
  return "border-muted/25 bg-muted/10 text-muted-foreground";
};

const medal = (pos: number) => {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return pos;
};

const StatCard = ({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) => (
  <div className="bg-card border border-border rounded-lg p-4 card-hover">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">
      <span>{icon}</span>
      {label}
    </div>
    <div className="font-heading text-xl font-black leading-none">{value}</div>
    <div className="text-xs text-muted-foreground mt-1">{sub}</div>
  </div>
);

const RaceDetailPreviewPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />

      <main className="pt-[108px]">
        <section className="py-8 md:py-12 bg-gradient-to-b from-card/60 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <Link to="/results" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors">
                <ArrowLeft className="w-4 h-4" /> Terug naar uitslagen
              </Link>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-orange-400">
                <Sparkles className="w-3.5 h-3.5" /> JSON preview
              </div>
            </div>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🇬🇧</span>
                  <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">Road</span>
                  <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">Hosted</span>
                </div>
                <h1 className="font-heading text-4xl md:text-6xl font-black tracking-tight">
                  <span className="text-gradient-racing">Oulton Park Circuit</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground font-heading font-semibold mt-1">
                  International · 19 laps · 13 mei 2026
                </p>
              </div>
              <div className="text-left lg:text-right text-muted-foreground">
                <div className="font-heading text-2xl font-black">#85717343</div>
                <div className="text-xs uppercase tracking-[0.2em]">Subsession ID</div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-4 rounded-lg border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-card to-transparent p-4 border-glow">
              <div className="w-1 h-12 rounded-full bg-gradient-racing" />
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black">Race winner</div>
                <div className="font-heading text-2xl font-black">{winner.name} <span className="text-base text-muted-foreground">#{winner.pos}</span></div>
              </div>
              <div className="ml-auto hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
                <span><b className="text-orange-400">{winner.laps}</b> laps</span>
                <span className="opacity-30">|</span>
                <span><b className="text-orange-400">{winner.best}</b> best lap</span>
                <span className="opacity-30">|</span>
                <span><b className="text-orange-400">{winner.inc}</b>x</span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-10">
          <div className="container mx-auto px-4 space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard icon="🏁" label="Pole" value={pole.name} sub={pole.lap} />
              <StatCard icon="⚡" label="Fastest lap" value={fastest.name} sub={`${fastest.best} — lap 10`} />
              <StatCard icon="⬆️" label="Big mover" value={`+${getDelta(bigMover)}`} sub={`${bigMover.name} P${bigMover.start} → P${bigMover.pos}`} />
              <StatCard icon="🧹" label="Cleanest" value={cleanest.name} sub={`${cleanest.inc} incidents`} />
              <StatCard icon="👑" label="Most led" value={mostLed.name} sub={`${mostLed.led} van 19 laps`} />
              <StatCard icon="🏎️" label="Grid" value="10" sub="3 GT3 modellen" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-heading text-2xl font-black flex items-center gap-2"><List className="w-5 h-5 text-accent" /> Race resultaat</h2>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-2 py-1 rounded bg-secondary border border-border">10 coureurs</span>
                    <span className="px-2 py-1 rounded bg-secondary border border-border">19 laps</span>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[3.5rem_1fr_4rem_5rem_5rem_4rem] md:grid-cols-[3.5rem_1fr_4rem_4rem_6rem_5rem_4rem] gap-2 px-4 py-2 bg-secondary/40 text-[10px] font-black uppercase tracking-widest text-muted-foreground min-w-[720px]">
                    <span>Pos</span><span>Coureur</span><span className="text-center">Laps</span><span className="text-center hidden md:block">Lead</span><span className="text-right">Best</span><span className="text-center">Grid</span><span className="text-center">Inc</span>
                  </div>
                  <div className="overflow-x-auto">
                    {drivers.map((driver) => {
                      const delta = getDelta(driver);
                      return (
                        <div key={driver.name} className={`grid grid-cols-[3.5rem_1fr_4rem_5rem_5rem_4rem] md:grid-cols-[3.5rem_1fr_4rem_4rem_6rem_5rem_4rem] gap-2 px-4 py-3 items-center border-t border-border/50 min-w-[720px] hover:bg-secondary/20 transition-colors ${driver.pos <= 3 ? "racing-stripe-left" : ""}`}>
                          <span className="font-heading font-black text-lg">{medal(driver.pos)}</span>
                          <div className="min-w-0">
                            <div className="font-heading font-black truncate flex items-center gap-2">
                              {driver.name}
                              {driver.badge === "fastest" && <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/15 text-purple-300">FASTEST LAP</span>}
                              {driver.badge === "clean" && <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/15 text-green-300">CLEAN</span>}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{driver.car}</div>
                          </div>
                          <span className="text-center text-sm font-heading">{driver.laps}</span>
                          <span className={`text-center text-sm font-heading hidden md:block ${driver.led ? "text-yellow-400 font-black" : "text-muted-foreground"}`}>{driver.led}</span>
                          <span className="text-right text-sm font-mono text-muted-foreground">{driver.best}</span>
                          <span className="text-center"><span className={`inline-flex min-w-12 justify-center rounded-full border px-2 py-0.5 text-xs font-heading font-black ${deltaClass(delta)}`}>{delta > 0 ? `+${delta}` : delta}</span></span>
                          <span className={`text-center text-sm font-heading ${driver.inc === 0 ? "text-green-400 font-black" : driver.inc > 8 ? "text-red-400" : "text-muted-foreground"}`}>{driver.inc}x</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="space-y-4">
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3">Deze race</div>
                  <div className="grid grid-cols-3 gap-2">
                    <button className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors flex items-center justify-center gap-1"><Share2 className="w-3 h-3" /> Deel</button>
                    <button className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors flex items-center justify-center gap-1"><LinkIcon className="w-3 h-3" /> Link</button>
                    <Link to="/results" className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors text-center">Uitslag</Link>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-accent" /> Race overview</h3>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Track</span><span className="font-heading font-bold text-right">Oulton Park — International</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span className="font-heading font-bold">~1:10:09</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SOF</span><span className="font-heading font-bold">1.084</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Lead changes</span><span className="font-heading font-bold">3</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cautions</span><span className="font-heading font-bold">0</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avg lap</span><span className="font-mono text-green-400">1:39.048</span></div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><CloudSun className="w-4 h-4 text-sky-400" /> Conditions</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[ ["26°C", "Temp"], ["45%", "Humidity"], ["3", "Wind"], ["Dry", "Track"] ].map(([value, label]) => (
                      <div key={label} className="rounded bg-secondary/40 border border-border py-3 text-center"><div className="font-heading text-lg font-black">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
                    ))}
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Car className="w-4 h-4 text-muted-foreground" /> Grid cars</h3>
                  <div className="space-y-3">
                    {Object.entries(carCounts).map(([car, count], index) => (
                      <div key={car}>
                        <div className="flex justify-between text-sm mb-1"><span className="font-heading font-bold">{car}</span><span className="text-muted-foreground">{count}</span></div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full rounded-full ${index === 0 ? "bg-gradient-racing" : index === 1 ? "bg-sky-500" : "bg-purple-500"}`} style={{ width: `${(count / drivers.length) * 100}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>

            <div className="space-y-4">
              <h2 className="font-heading text-2xl font-black flex items-center gap-2"><Trophy className="w-5 h-5 text-accent" /> Race highlights</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-lg p-5 card-hover">
                  <div className="font-heading text-lg font-black mb-1 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-green-400" /> Pole ≠ win</div>
                  <p className="text-sm text-muted-foreground">{pole.name} pakte pole, maar {winner.name} won de race vanaf P{winner.start}. Volledig automatisch uit qualifying + race results.</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-5 card-hover">
                  <div className="font-heading text-lg font-black mb-1 flex items-center gap-2"><Flag className="w-4 h-4 text-yellow-400" /> 17 laps aan kop</div>
                  <p className="text-sm text-muted-foreground">{mostLed.name} leidde {mostLed.led} van de 19 laps. De winnaar leidde alleen de laatste {winner.led} laps.</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-5 card-hover">
                  <div className="font-heading text-lg font-black mb-1 flex items-center gap-2"><Zap className="w-4 h-4 text-purple-400" /> Fastest vs cleanest</div>
                  <p className="text-sm text-muted-foreground">{fastest.name} reed de snelste ronde ({fastest.best}), terwijl {cleanest.name} de enige 0x-race reed.</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Preview note:</strong> deze pagina gebruikt nu een JSON-derived fixture uit de aangeleverde race om live te kunnen previewen. De layout-regels zijn statisch; de race-inhoud kan straks automatisch uit Supabase/JSON-import komen zodra we de extra velden opslaan.
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default RaceDetailPreviewPage;
