import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "07 — BRUTALIST",
  note: "Beton, zwarte randen en harde offset-schaduwen: elk cijfer is een blok, elke beslissing een stempel.",
};

/* ------------------------------------------------------------------ tokens */

const INK = "#0B0B0B";
const ORANGE = "#FF4D00";
const BONE = "#F3EEE4";
const SAND = "#D9D1C2";

const box = "border-[3px] border-black bg-white";
const shadow = "shadow-[8px_8px_0_0_#0B0B0B]";
const shadowSm = "shadow-[4px_4px_0_0_#0B0B0B]";
const label = "text-[10px] font-bold uppercase tracking-[0.26em]";
const display = { fontFamily: "'Exo 2', system-ui, sans-serif" };

const hazard = {
  backgroundImage: `repeating-linear-gradient(45deg, ${INK} 0 10px, ${ORANGE} 10px 20px)`,
};

/* ----------------------------------------------------------------- helpers */

const n1 = (v: number) => v.toFixed(1);
const n2 = (v: number) => v.toFixed(2);
const num = (v: number) => (Number.isInteger(v) ? String(v) : n1(v));

const secLap = (t: string): number => {
  const parts = t.split(":");
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(t);
};

const lapLabel = (s: number, dec: 1 | 3 = 1): string => {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(dec).padStart(dec === 1 ? 4 : 6, "0")}`;
};

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

const RECO: Record<string, string> = {
  STAY_OUT: "BLIJF BUITEN",
  PIT_SOON: "BIJNA PIT",
  PIT_NOW: "PIT NU",
};

/* -------------------------------------------------------------- primitives */

function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${box} ${className}`}>
      <div className="flex items-stretch justify-between gap-2 border-b-[3px] border-black bg-black">
        <h2 className={`${label} px-3 py-1.5 text-white`}>{title}</h2>
        {right !== undefined ? (
          <div className={`${label} bg-[#FF4D00] px-3 py-1.5 text-black`}>{right}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Stat({
  k,
  v,
  unit,
  tone = "light",
  big = false,
}: {
  k: string;
  v: ReactNode;
  unit?: string;
  tone?: "light" | "dark" | "orange";
  big?: boolean;
}) {
  const skin =
    tone === "dark"
      ? "bg-black text-white"
      : tone === "orange"
        ? "bg-[#FF4D00] text-black"
        : "bg-white text-black";
  return (
    <div className={`px-3 py-2 ${skin}`}>
      <div className={`${label} opacity-60`}>{k}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          style={display}
          className={`font-black leading-[0.9] tracking-[-0.04em] tabular-nums ${
            big ? "text-[clamp(1.9rem,3.4vw,2.7rem)]" : "text-[clamp(1.3rem,2.2vw,1.8rem)]"
          }`}
        >
          {v}
        </span>
        {unit ? <span className={`${label} opacity-60`}>{unit}</span> : null}
      </div>
    </div>
  );
}

function Tyre({
  code,
  name,
  wear,
  tempC,
  hot,
}: {
  code: string;
  name: string;
  wear: number;
  tempC: number;
  hot: boolean;
}) {
  return (
    <div className={`relative flex h-full flex-col p-3 ${hot ? "bg-[#FF4D00]" : "bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <div style={display} className="text-lg font-black leading-none tracking-[-0.03em]">
              {code}
            </div>
            {hot ? (
              <span className="border-[2px] border-black bg-black px-1 text-[8px] font-bold uppercase leading-[1.35] tracking-[0.12em] text-white">
                piek
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">
            {name}
          </div>
        </div>
        <div className="text-right">
          <div style={display} className="text-sm font-black leading-none tabular-nums">
            {tempC}°
          </div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">C</div>
        </div>
      </div>

      <div className="mt-3 flex items-end gap-1">
        <span
          style={display}
          className="text-[clamp(2rem,4.6vw,2.9rem)] font-black leading-[0.78] tracking-[-0.05em] tabular-nums"
        >
          {n1(wear)}
        </span>
        <span className="mb-1 text-[11px] font-black">%</span>
      </div>

      <div className="mt-auto h-3 w-full border-[2px] border-black bg-white">
        <div className="h-full bg-black" style={{ width: `${Math.min(100, Math.max(0, wear))}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- view */

export default function Design({ f }: { f: PitwallFixture }) {
  const tyreCorners = [
    { code: "LV", name: "voor links", c: f.tyres.fl },
    { code: "RV", name: "voor rechts", c: f.tyres.fr },
    { code: "LA", name: "achter links", c: f.tyres.rl },
    { code: "RA", name: "achter rechts", c: f.tyres.rr },
  ];
  const maxWear = Math.max(f.tyres.fl.wear, f.tyres.fr.wear, f.tyres.rl.wear, f.tyres.rr.wear);

  const lapsToGo = f.event.totalLaps - f.event.lap;
  const lapPct = Math.min(1, f.event.lap / f.event.totalLaps);
  const segments = 30;
  const filledSegments = Math.round(lapPct * segments);

  const stintOnFullTank = f.fuel.tankLitres / f.fuel.perLap;
  const finishedInTank = f.fuel.toFinishLitres <= f.fuel.tankLitres;
  const tankFill = Math.min(1, f.fuel.litres / f.fuel.tankLitres);
  const tankBars = 22;
  const tankLit = Math.round(tankFill * tankBars);

  const paceMin = Math.min(...f.pace);
  const paceMax = Math.max(...f.pace);
  const paceAvg = avg(f.pace);
  const trend = avg(f.pace.slice(-5)) - avg(f.pace.slice(0, 5));
  const lastVsBest =
    secLap(f.telemetry.lastLap) - secLap(f.telemetry.bestLap);
  const fastestIdx = f.pace.indexOf(paceMin);

  const lo = paceMin - 0.12;
  const hi = paceMax + 0.12;
  const W = 780;
  const H = 250;
  const PAD_L = 62;
  const PAD_R = 14;
  const PAD_T = 16;
  const PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const nx = (i: number) => PAD_L + (plotW * i) / Math.max(1, f.pace.length - 1);
  const ny = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;
  const barW = Math.max(6, plotW / f.pace.length - 5);
  const barX = (i: number) =>
    Math.min(Math.max(PAD_L, nx(i) - barW / 2), W - PAD_R - barW);
  const baseline = PAD_T + plotH;
  const points = f.pace.map((v, i) => `${nx(i)},${ny(v)}`).join(" ");

  const classes = Array.from(new Set(f.standings.map((s) => s.cls))).map((cls) => {
    const rows = f.standings.filter((s) => s.cls === cls);
    const self = rows.find((r) => r.isSelf);
    return {
      cls,
      count: rows.length,
      selfPos: self ? self.classPos : null,
      leader: rows.find((r) => r.classPos === 1)?.driver ?? "—",
    };
  });

  const recTone = f.pit.recommendation === "STAY_OUT" ? INK : ORANGE;

  return (
    <div
      className="min-h-screen bg-[#F3EEE4] p-3 text-black sm:p-5 lg:p-8"
      style={{ fontFamily: "'Rajdhani', 'Exo 2', system-ui, sans-serif" }}
    >
      <div className="mx-auto flex max-w-[1360px] flex-col gap-5 lg:gap-6">
        {/* ------------------------------------------------------------ KOP */}
        <header className={`${shadow} border-[3px] border-black bg-[#0B0B0B] text-white`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-[#FF4D00] px-3 py-1.5">
            <span className={`${label} text-[#FF4D00]`}>3SM pitwall / ontwerp 07</span>
            <span className={`${label} text-white/50`}>brutalist — {f.event.circuit}</span>
          </div>

          <div className="grid lg:grid-cols-[1fr_400px]">
            <div className="border-b-[3px] border-white/20 px-4 py-4 lg:border-b-0 lg:border-r-[3px]">
              <h1
                style={display}
                className="text-[clamp(1.9rem,5vw,4rem)] font-black uppercase leading-[0.86] tracking-[-0.045em]"
              >
                {f.event.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`${label} bg-[#FF4D00] px-2 py-1 text-black`}>
                  live · ronde {f.event.lap}
                </span>
                <span className={`${label} text-white/55`}>{f.event.circuit}</span>
                <span className={`${label} text-white/55`}>nog {lapsToGo} rondes</span>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-2">
                <div>
                  <div className={`${label} text-white/45`}>aan het stuur</div>
                  <div
                    style={display}
                    className="text-[clamp(1.4rem,2.6vw,2rem)] font-black uppercase leading-none tracking-[-0.03em]"
                  >
                    {f.self.driver}
                  </div>
                </div>
                <div className={`${label} pb-1 text-white/55`}>
                  {f.self.team}
                  <br />
                  {f.self.car}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x-[3px] divide-white/20">
              <div className="border-b-[3px] border-white/20 px-4 py-3">
                <div className={`${label} text-white/45`}>ronde</div>
                <div className="flex items-baseline gap-1">
                  <span
                    style={display}
                    className="text-[clamp(2.4rem,4.6vw,3.6rem)] font-black leading-[0.8] tracking-[-0.05em] tabular-nums"
                  >
                    {f.event.lap}
                  </span>
                  <span className={`${label} text-white/50`}>/{f.event.totalLaps}</span>
                </div>
              </div>

              <div className="border-b-[3px] border-white/20 px-4 py-3">
                <div className={`${label} text-white/45`}>resterend</div>
                <div
                  style={display}
                  className="text-[clamp(1.5rem,2.6vw,2rem)] font-black leading-none tracking-[-0.03em] tabular-nums"
                >
                  {f.event.timeLeft}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className={`${label} text-white/45`}>vlag</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="h-4 w-4 border-[2px] border-[#FF4D00] bg-[#FF4D00]" />
                  <span
                    style={display}
                    className="text-lg font-black uppercase leading-none tracking-[-0.02em]"
                  >
                    {f.event.flag}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3">
                <div className={`${label} text-white/45`}>klasse</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span style={display} className="text-lg font-black leading-none">
                    P{f.self.classPos}
                  </span>
                  <span className={`${label} text-white/50`}>{f.self.cls}</span>
                </div>
              </div>
            </div>
          </div>

          {/* rondebalk */}
          <div className="flex h-3 gap-[3px] border-t-[3px] border-black bg-[#1A1A1A] px-[3px] py-[3px]">
            {Array.from({ length: segments }).map((_, i) => (
              <span
                key={i}
                className="h-full flex-1"
                style={{ background: i < filledSegments ? ORANGE : "#2E2E2E" }}
              />
            ))}
          </div>

          {/* eigen status */}
          <div className="flex flex-wrap items-stretch border-t-[3px] border-black bg-white text-black">
            <div className="flex items-end gap-1 bg-[#FF4D00] px-4 py-2">
              <span style={display} className="text-3xl font-black leading-none tracking-[-0.05em]">
                P{f.self.pos}
              </span>
              <span className={`${label} pb-1`}>/{f.standings.length}</span>
            </div>
            <div className="border-l-[3px] border-black px-4 py-2">
              <div className={`${label} opacity-65`}>klasse</div>
              <div style={display} className="text-lg font-black leading-tight">
                P{f.self.classPos} {f.self.cls}
              </div>
            </div>
            <div className="min-w-[160px] grow border-l-[3px] border-black px-4 py-2">
              <div className={`${label} opacity-65`}>wagen</div>
              <div className="text-sm font-bold uppercase leading-tight">{f.self.car}</div>
            </div>
            <div className="border-l-[3px] border-black px-4 py-2">
              <div className={`${label} opacity-65`}>laatste</div>
              <div style={display} className="text-lg font-black leading-tight tabular-nums">
                {f.telemetry.lastLap}
              </div>
            </div>
            <div className="border-l-[3px] border-black px-4 py-2">
              <div className={`${label} opacity-65`}>beste</div>
              <div style={display} className="text-lg font-black leading-tight tabular-nums">
                {f.telemetry.bestLap}
              </div>
            </div>
          </div>
        </header>

        {/* -------------------------------------------------------- TELEMETRIE */}
        <div
          className={`${box} grid grid-cols-2 divide-x-[3px] divide-black lg:grid-cols-[1.05fr_0.8fr_1.25fr_1.15fr_1.5fr]`}
        >
          <div className="divide-y-[3px] divide-black">
            <Stat k="snelheid" v={f.telemetry.speedKph} unit="km/h" big />
            <Stat k="versnelling" v={`V${f.telemetry.gear}`} big tone="orange" />
          </div>

          <div className="flex flex-col justify-center px-3 py-2">
            <div className={`${label} opacity-60`}>rpm</div>
            <div
              style={display}
              className="text-[clamp(1.6rem,2.8vw,2.2rem)] font-black leading-none tracking-[-0.04em] tabular-nums"
            >
              {f.telemetry.rpm.toLocaleString("en-US")}
            </div>
            <div className="mt-2 flex gap-[2px]">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="h-2 flex-1 border-[1.5px] border-black"
                  style={{ background: i < 11 ? INK : "#FFFFFF" }}
                />
              ))}
            </div>
          </div>

          <div className="border-t-[3px] border-black px-3 py-2 lg:border-t-0">
            <div className={`${label} opacity-60`}>sectoren</div>
            <div className="mt-1 space-y-0.5">
              {[
                ["S1", f.telemetry.s1],
                ["S2", f.telemetry.s2],
                ["S3", f.telemetry.s3],
              ].map(([code, val]) => (
                <div key={code} className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-65">
                    {code}
                  </span>
                  <span style={display} className="text-base font-black leading-none tabular-nums">
                    {val}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t-[2px] border-black pt-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-65">
                ronde
              </span>
              <span style={display} className="text-base font-black leading-none tabular-nums">
                {f.telemetry.lastLap}
              </span>
            </div>
          </div>

          <div className="border-t-[3px] border-black lg:border-t-0">
            <Stat k="laatste ronde" v={f.telemetry.lastLap} />
            <div className="h-[3px] bg-black" />
            <Stat k="beste ronde" v={f.telemetry.bestLap} tone="light" />
          </div>

          <div className="col-span-2 bg-black px-3 py-3 text-white lg:col-span-1">
            <div className={`${label} text-white/60`}>t.o.v. beste ronde</div>
            <div className="flex items-baseline gap-1">
              <span
                style={display}
                className="text-[clamp(1.9rem,3.4vw,2.7rem)] font-black leading-none tracking-[-0.05em] tabular-nums text-[#FF4D00]"
              >
                +{lastVsBest.toFixed(3)}
              </span>
              <span className={`${label} text-white/55`}>s</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className={`${label} text-white/55`}>referentie</span>
              <span className="text-xs font-black tabular-nums">{f.telemetry.bestLap}</span>
            </div>
          </div>
        </div>

        {/* -------------------------------------------- GATEN + BESLISSING */}
        <div className="grid gap-5 lg:grid-cols-12 lg:gap-6">
          <div className={`${box} ${shadowSm} lg:col-span-5`}>
            <div className="flex items-stretch justify-between border-b-[3px] border-black bg-black">
              <h2 className={`${label} px-3 py-1.5 text-white`}>gaten</h2>
              <span className={`${label} bg-white px-3 py-1.5 text-black`}>
                p{f.self.pos} / {f.standings.length}
              </span>
            </div>

            <div className="grid grid-cols-2 divide-x-[3px] divide-black">
              <div className="p-3">
                <div className={`${label} opacity-65`}>voor · p{f.self.pos - 1}</div>
                <div
                  style={display}
                  className="mt-1 text-[clamp(2.2rem,5vw,3.2rem)] font-black leading-none tracking-[-0.05em] tabular-nums"
                >
                  {f.gaps.ahead}
                </div>
                <div className="mt-1 truncate text-sm font-bold uppercase">{f.gaps.aheadName}</div>
                <div className={`${label} opacity-60`}>seconden</div>
              </div>

              <div className="bg-black p-3 text-white">
                <div className={`${label} text-white/50`}>achter · p{f.self.pos + 1}</div>
                <div
                  style={display}
                  className="mt-1 text-[clamp(2.2rem,5vw,3.2rem)] font-black leading-none tracking-[-0.05em] tabular-nums text-[#FF4D00]"
                >
                  {f.gaps.behind}
                </div>
                <div className="mt-1 truncate text-sm font-bold uppercase">{f.gaps.behindName}</div>
                <div className={`${label} text-white/45`}>seconden</div>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x-[3px] divide-black border-t-[3px] border-black">
              <div className="px-2 py-2">
                <div className={`${label} opacity-65`}>laatste</div>
                <div style={display} className="text-base font-black tabular-nums">
                  {f.telemetry.lastLap}
                </div>
              </div>
              <div className="px-2 py-2">
                <div className={`${label} opacity-65`}>beste</div>
                <div style={display} className="text-base font-black tabular-nums">
                  {f.telemetry.bestLap}
                </div>
              </div>
              <div className="px-2 py-2">
                <div className={`${label} opacity-65`}>nog</div>
                <div style={display} className="text-base font-black tabular-nums">
                  {lapsToGo} R
                </div>
              </div>
            </div>
          </div>

          <div className={`${shadow} lg:col-span-7`}>
            <section className="border-[3px] border-black bg-white">
              <div className="flex flex-wrap items-stretch justify-between border-b-[3px] border-black bg-black">
                <h2 className={`${label} px-3 py-1.5 text-white`}>beslissing</h2>
                <span className={`${label} bg-[#FF4D00] px-3 py-1.5 text-black`}>
                  {f.pit.recommendation}
                </span>
              </div>

              <div style={{ background: recTone }} className="border-b-[3px] border-black px-4 py-4">
                <div
                  style={{ ...display, color: f.pit.recommendation === "STAY_OUT" ? "#FFFFFF" : INK }}
                  className="text-[clamp(2.6rem,6.6vw,4.8rem)] font-black uppercase leading-[0.82] tracking-[-0.055em]"
                >
                  {RECO[f.pit.recommendation] ?? f.pit.recommendation}
                </div>
                <p className="mt-3 max-w-[42ch] text-base font-bold leading-tight text-black">
                  {f.pit.reason}
                </p>
              </div>

              <div className="grid grid-cols-2 divide-x-[3px] divide-black border-b-[3px] border-black">
                <div className="px-4 py-3">
                  <div className={`${label} opacity-65`}>pitwindow</div>
                  <div className="flex items-baseline gap-1">
                    <span
                      style={display}
                      className="text-[clamp(2rem,4vw,2.9rem)] font-black leading-none tracking-[-0.05em] tabular-nums"
                    >
                      {f.pit.windowInLaps}
                    </span>
                    <span className={`${label} opacity-65`}>rondes</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className={`${label} opacity-65`}>pitverlies</div>
                  <div className="flex items-baseline gap-1">
                    <span
                      style={display}
                      className="text-[clamp(2rem,4vw,2.9rem)] font-black leading-none tracking-[-0.05em] tabular-nums"
                    >
                      {f.pit.pitLossSeconds}
                    </span>
                    <span className={`${label} opacity-65`}>sec</span>
                  </div>
                </div>
              </div>

              <div className="h-3 w-full" style={hazard} aria-hidden />
            </section>
          </div>
        </div>

        {/* ------------------------------------------------ BANDEN + BRANDSTOF */}
        <div className="grid gap-5 lg:grid-cols-12 lg:gap-6">
          <div className={`${box} ${shadowSm} lg:col-span-7`}>
            <div className="flex flex-wrap items-stretch justify-between border-b-[3px] border-black bg-black">
              <h2 className={`${label} px-3 py-1.5 text-white`}>banden</h2>
              <span className={`${label} bg-[#FF4D00] px-3 py-1.5 text-black`}>
                set {f.tyres.setLaps} rondes
              </span>
            </div>

            <div className="grid grid-cols-2">
              {tyreCorners.map((t, i) => (
                <div
                  key={t.code}
                  className={[
                    i % 2 === 0 ? "border-r-[3px] border-black" : "",
                    i > 1 ? "border-t-[3px] border-black" : "",
                  ].join(" ")}
                >
                  <Tyre
                    code={t.code}
                    name={t.name}
                    wear={t.c.wear}
                    tempC={t.c.tempC}
                    hot={t.c.wear === maxWear}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 divide-x-[3px] divide-black border-t-[3px] border-black">
              <div className="px-3 py-2">
                <div className={`${label} opacity-65`}>compound</div>
                <div className="text-sm font-black uppercase leading-tight">{f.tyres.compound}</div>
              </div>
              <div className="px-3 py-2">
                <div className={`${label} opacity-65`}>setleeftijd</div>
                <div className="text-sm font-black uppercase leading-tight">
                  {f.tyres.setLaps} rondes
                </div>
              </div>
              <div className="bg-black px-3 py-2 text-white">
                <div className={`${label} text-white/50`}>grade</div>
                <div style={display} className="text-xl font-black leading-none">
                  {f.tyres.grade}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[132px_1fr] border-t-[3px] border-black">
              <div className="border-r-[3px] border-black px-3 py-2">
                <div className={`${label} opacity-65`}>bereik</div>
                <div style={display} className="text-base font-black tabular-nums">
                  {n1(f.tyres.wearRange[0])} – {n1(f.tyres.wearRange[1])}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-65">
                  wear / ronde
                </div>
              </div>
              <div className="px-3 py-2 text-[11px] font-semibold uppercase leading-tight opacity-70">
                {f.tyres.note}
              </div>
            </div>
          </div>

          <div className={`${box} ${shadowSm} lg:col-span-5`}>
            <div className="flex flex-wrap items-stretch justify-between border-b-[3px] border-black bg-black">
              <h2 className={`${label} px-3 py-1.5 text-white`}>brandstof</h2>
              <span className={`${label} bg-[#FF4D00] px-3 py-1.5 text-black`}>
                {finishedInTank ? "past in tank" : "extra stop nodig"}
              </span>
            </div>

            <div className="grid grid-cols-2 divide-x-[3px] divide-black">
              <div className="px-3 py-3">
                <div className={`${label} opacity-65`}>aan boord</div>
                <div className="flex items-baseline gap-1">
                  <span
                    style={display}
                    className="text-[clamp(2.2rem,4.6vw,3.2rem)] font-black leading-[0.8] tracking-[-0.05em] tabular-nums"
                  >
                    {n1(f.fuel.litres)}
                  </span>
                  <span className={`${label} opacity-65`}>l</span>
                </div>
              </div>
              <div className="bg-black px-3 py-3 text-white">
                <div className={`${label} text-white/50`}>rondes over</div>
                <div className="flex items-baseline gap-1">
                  <span
                    style={display}
                    className="text-[clamp(2.2rem,4.6vw,3.2rem)] font-black leading-[0.8] tracking-[-0.05em] tabular-nums text-[#FF4D00]"
                  >
                    {f.fuel.lapsLeft}
                  </span>
                  <span className={`${label} text-white/45`}>r</span>
                </div>
              </div>
            </div>

            <div className="border-t-[3px] border-black px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className={`${label} opacity-65`}>tank</span>
                <span className={`${label} tabular-nums`}>
                  {n1(f.fuel.litres)} / {num(f.fuel.tankLitres)} L
                </span>
              </div>
              <div className="mt-1 flex gap-[2px] border-[2px] border-black bg-white p-[2px]">
                {Array.from({ length: tankBars }).map((_, i) => (
                  <span
                    key={i}
                    className="h-4 flex-1"
                    style={{ background: i < tankLit ? INK : SAND }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-[0.16em] opacity-65">
                <span>leeg</span>
                <span>vol</span>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x-[3px] divide-black border-t-[3px] border-black">
              <Stat k="per ronde" v={n2(f.fuel.perLap)} unit="l" />
              <Stat k="bijtanken" v={f.fuel.toAddLitres} unit="l" />
            </div>
            <div className="border-t-[3px] border-black">
              <Stat k="nodig tot finish" v={n2(f.fuel.toFinishLitres)} unit="l" tone="dark" big />
            </div>
            <div className="border-t-[3px] border-black px-3 py-1.5">
              <div className="flex items-center justify-between">
                <span className={`${label} opacity-65`}>max stint volle tank</span>
                <span className="text-xs font-black tabular-nums">{n1(stintOnFullTank)} R</span>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------ PACE */}
        <Panel
          title="pace · laatste 20 rondes"
          right={`gem ${lapLabel(paceAvg)}`}
          className={shadowSm}
        >
          <div className="grid lg:grid-cols-[1fr_200px]">
            <div className="border-b-[3px] border-black p-2 lg:border-b-0 lg:border-r-[3px]">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="h-auto w-full"
                role="img"
                aria-label="Rondetijden van de laatste twintig rondes"
              >
                <rect x="0" y="0" width={W} height={H} fill={BONE} />
                {[hi, (hi + lo) / 2, lo].map((t, idx) => (
                  <g key={idx}>
                    <line
                      x1={PAD_L}
                      y1={ny(t)}
                      x2={W - PAD_R}
                      y2={ny(t)}
                      stroke={INK}
                      strokeWidth={idx === 2 ? 2 : 1}
                      strokeDasharray={idx === 2 ? undefined : "3 5"}
                      opacity={idx === 2 ? 0.9 : 0.35}
                    />
                    <text
                      x={PAD_L - 8}
                      y={ny(t) + 3.5}
                      textAnchor="end"
                      fontSize="11"
                      fontWeight="700"
                      fill={INK}
                      opacity="0.6"
                      style={{ letterSpacing: "0.06em" }}
                    >
                      {lapLabel(t)}
                    </text>
                  </g>
                ))}

                {f.pace.map((v, i) => (
                  <rect
                    key={`b-${i}`}
                    x={barX(i)}
                    y={ny(v)}
                    width={barW}
                    height={Math.max(1, baseline - ny(v))}
                    fill={i === f.pace.length - 1 ? INK : ORANGE}
                    opacity={i === f.pace.length - 1 ? 0.92 : 0.55}
                  />
                ))}

                {f.pace.map((v, i) =>
                  i % 5 === 0 ? (
                    <line
                      key={`v-${i}`}
                      x1={nx(i)}
                      y1={PAD_T}
                      x2={nx(i)}
                      y2={baseline}
                      stroke={INK}
                      strokeWidth="1"
                      opacity="0.18"
                    />
                  ) : null,
                )}

                <polyline
                  points={points}
                  fill="none"
                  stroke={INK}
                  strokeWidth="3"
                  strokeLinejoin="miter"
                />

                {f.pace.map((v, i) => (
                  <rect
                    key={`p-${i}`}
                    x={nx(i) - 3}
                    y={ny(v) - 3}
                    width={6}
                    height={6}
                    fill={i === f.pace.length - 1 ? ORANGE : INK}
                    stroke={INK}
                    strokeWidth={i === f.pace.length - 1 ? 2 : 0}
                  />
                ))}

                <g>
                  <rect
                    x={nx(fastestIdx) - 34}
                    y={ny(paceMin) - 26}
                    width="68"
                    height="17"
                    fill={INK}
                  />
                  <text
                    x={nx(fastestIdx)}
                    y={ny(paceMin) - 14}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#FFFFFF"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    SNELST
                  </text>
                </g>

                {[0, 5, 10, 15, 19].map((i) => (
                  <text
                    key={`x-${i}`}
                    x={nx(i)}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill={INK}
                    opacity="0.55"
                    style={{ letterSpacing: "0.08em" }}
                  >
                    {i === 19 ? "NU" : `-${19 - i}`}
                  </text>
                ))}
                <text
                  x={W - PAD_R}
                  y={H - 8}
                  textAnchor="end"
                  fontSize="8"
                  fontWeight="700"
                  fill={INK}
                  opacity="0.4"
                  style={{ letterSpacing: "0.2em" }}
                >
                  RONDES TERUG
                </text>
              </svg>
            </div>

            <div className="divide-y-[3px] divide-black">
              <Stat k="snelste" v={lapLabel(paceMin)} tone="light" />
              <Stat k="gemiddelde" v={lapLabel(paceAvg)} tone="light" />
              <Stat
                k="trend 5 vs 5"
                v={`${trend >= 0 ? "+" : ""}${trend.toFixed(2)}`}
                unit="s"
                tone={trend > 0 ? "orange" : "dark"}
              />
              <Stat k="laatste" v={f.telemetry.lastLap} tone="light" />
            </div>
          </div>
        </Panel>

        {/* ------------------------------------ KLASSEMENT + WISSEL + WEER */}
        <div className="grid gap-5 lg:grid-cols-12 lg:gap-6">
          <div className={`${box} ${shadowSm} min-w-0 lg:col-span-8`}>
            <div className="flex flex-wrap items-stretch justify-between border-b-[3px] border-black bg-black">
              <h2 className={`${label} px-3 py-1.5 text-white`}>klassement per klasse</h2>
              <span className={`${label} bg-[#FF4D00] px-3 py-1.5 text-black`}>
                ronde {f.event.lap} / {f.event.totalLaps}
              </span>
            </div>

            <div className="flex flex-wrap divide-x-[3px] divide-black border-b-[3px] border-black">
              {classes.map((c) => (
                <div key={c.cls} className="flex items-baseline gap-2 px-3 py-2">
                  <span className={`${label} border-[2px] border-black px-1.5 py-0.5`}>{c.cls}</span>
                  <span style={display} className="text-lg font-black leading-none tabular-nums">
                    {c.selfPos !== null ? `P${c.selfPos}` : "—"}
                    <span className="text-[10px] font-bold opacity-50">/{c.count}</span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-65">
                    leider {c.leader}
                  </span>
                </div>
              ))}
            </div>

            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="bg-black text-white">
                    {["pos", "kl", "coureur", "gap", "laatste", "band/pit"].map((h) => (
                      <th
                        key={h}
                        className={`${label} border-r-[2px] border-white/25 px-2 py-1.5 last:border-r-0`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {f.standings.map((s) => (
                    <tr
                      key={`${s.pos}-${s.driver}`}
                      className={
                        s.isSelf
                          ? "bg-[#FF4D00] text-black"
                          : "border-t-[2px] border-black odd:bg-white even:bg-[#F7F2E9]"
                      }
                    >
                      <td className="px-2 py-1.5">
                        <span
                          style={display}
                          className="text-lg font-black leading-none tabular-nums"
                        >
                          {s.pos}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`${label} border-[2px] border-black px-1 py-0.5 ${
                            s.isSelf ? "bg-black text-white" : "bg-white"
                          }`}
                        >
                          {s.cls}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[13px] leading-tight ${
                              s.isSelf ? "font-black uppercase" : "font-bold uppercase"
                            }`}
                          >
                            {s.driver}
                          </span>
                          {s.isSelf ? (
                            <span className={`${label} bg-black px-1 py-0.5 text-white`}>wij</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] font-semibold uppercase leading-tight opacity-65">
                          {s.car}
                        </div>
                      </td>
                      <td
                        style={display}
                        className="px-2 py-1.5 text-sm font-black tabular-nums"
                      >
                        {s.gap}
                      </td>
                      <td
                        style={display}
                        className="px-2 py-1.5 text-sm font-bold tabular-nums"
                      >
                        {s.lastLap}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`${label} border-[2px] border-black px-1 py-0.5 ${
                              s.inPit ? "bg-black text-white" : "bg-white"
                            }`}
                          >
                            {s.inPit ? "PIT" : "BAAN"}
                          </span>
                          <span className="text-xs font-black tabular-nums">{s.tyreAgeLaps}R</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t-[3px] border-black px-3 py-1.5">
              <span className={`${label} opacity-65`}>
                gap t.o.v. leider · band = rondes op de set
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-4 lg:gap-6">
            <Panel
              title="coureurswissel"
              right={`+${f.rotation.nextInMinutes} min`}
              className={shadowSm}
            >
              <div className="divide-y-[3px] divide-black">
                <div className="bg-[#FF4D00] px-3 py-2">
                  <div className={`${label} opacity-60`}>nu</div>
                  <div
                    style={display}
                    className="text-xl font-black uppercase leading-none tracking-[-0.03em]"
                  >
                    {f.rotation.current}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className={`${label} opacity-65`}>volgende</span>
                    <span style={display} className="text-xs font-black tabular-nums">
                      +{f.rotation.nextInMinutes} MIN
                    </span>
                  </div>
                  <div
                    style={display}
                    className="text-lg font-black uppercase leading-tight tracking-[-0.02em]"
                  >
                    {f.rotation.next}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className={`${label} opacity-65`}>daarna</span>
                    <span style={display} className="text-xs font-black tabular-nums">
                      +{f.rotation.afterInMinutes} MIN
                    </span>
                  </div>
                  <div
                    style={display}
                    className="text-lg font-black uppercase leading-tight tracking-[-0.02em]"
                  >
                    {f.rotation.after}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="weer" right="droog" className={shadowSm}>
              <div className="grid grid-cols-2 divide-x-[3px] divide-black">
                <div className="px-3 py-2">
                  <div className={`${label} opacity-65`}>lucht</div>
                  <div className="flex items-baseline gap-1">
                    <span
                      style={display}
                      className="text-3xl font-black leading-none tracking-[-0.05em] tabular-nums"
                    >
                      {n1(f.weather.airC)}
                    </span>
                    <span className={`${label} opacity-65`}>°c</span>
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className={`${label} opacity-65`}>baan</div>
                  <div className="flex items-baseline gap-1">
                    <span
                      style={display}
                      className="text-3xl font-black leading-none tracking-[-0.05em] tabular-nums"
                    >
                      {n1(f.weather.trackC)}
                    </span>
                    <span className={`${label} opacity-65`}>°c</span>
                  </div>
                </div>
              </div>
              <div className="border-t-[3px] border-black px-3 py-2">
                <div className={`${label} opacity-65`}>rubber</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex h-4 flex-1 gap-[2px]">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="h-full flex-1 border-[2px] border-black"
                        style={{ background: i === 0 ? ORANGE : "#FFFFFF" }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em]">
                    {f.weather.rubber === "moderately low usage" ? "matig laag" : f.weather.rubber}
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* --------------------------------------------------------- VOETBALK */}
        <footer className="border-[3px] border-black bg-black">
          <div className="h-3 w-full" style={hazard} aria-hidden />
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className={`${label} text-white`}>3SM pitwall · ontwerp 07 · brutalist</span>
            <span className={`${label} text-white/45`}>
              {f.event.name} — {f.event.circuit}
            </span>
            <span className={`${label} bg-white px-2 py-1 text-black`}>
              {f.self.driver} · P{f.self.pos}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
