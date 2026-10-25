import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "Endurance Night",
  note:
    "Pitlane om 03:00 — zwart asfalt, radiale meters in neon-cyaan en magenta dat alleen oplicht waar de klok druk zet.",
};

const CYAN = "#3ef0ff";
const MAGENTA = "#ff3d9a";
const AMBER = "#ffb347";
const GREEN = "#4ade80";
const TRACK = "#111a28";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const wearTone = (w: number) => (w >= 92 ? MAGENTA : w >= 85 ? AMBER : CYAN);

const gradeTone = (g: string) =>
  g === "A" ? GREEN : g === "B" ? CYAN : g === "C" ? AMBER : MAGENTA;

const lapTime = (s: number) => {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, "0")}`;
};

const rubberLabel = (raw: string) => {
  const key = raw.toLowerCase();
  if (key.includes("low")) return "weinig rubber";
  if (key.includes("moderate")) return "matig rubber";
  if (key.includes("heavy") || key.includes("high")) return "veel rubber";
  return raw;
};

function Panel({
  label,
  hint,
  accent,
  className = "",
  children,
}: {
  label?: string;
  hint?: string;
  accent?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080d16]/85 shadow-[0_30px_70px_-45px_rgba(0,0,0,0.95)] backdrop-blur-[2px] ${className}`}
    >
      {accent && (
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}80, transparent)` }}
        />
      )}
      {label && (
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <span
              className="h-1 w-1 rounded-full"
              style={{ background: accent ?? CYAN, boxShadow: `0 0 8px ${accent ?? CYAN}` }}
            />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              {label}
            </h2>
          </div>
          {hint && (
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
              {hint}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function Ring({
  pct,
  size,
  stroke,
  color,
  ticks = 0,
  children,
}: {
  pct: number;
  size: number;
  stroke: number;
  color: string;
  ticks?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * clamp01(pct);

  const tickEls = Array.from({ length: ticks }, (_, i) => {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
    const inner = r - stroke - 12;
    const outer = inner + (i % 6 === 0 ? 7 : 3);
    const on = i / ticks <= pct;
    return (
      <line
        key={i}
        x1={size / 2 + Math.cos(a) * inner}
        y1={size / 2 + Math.sin(a) * inner}
        x2={size / 2 + Math.cos(a) * outer}
        y2={size / 2 + Math.sin(a) * outer}
        stroke={on ? color : "#1b2534"}
        strokeWidth={1}
        opacity={on ? 0.6 : 1}
      />
    );
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        {ticks > 0 && tickEls}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ filter: `drop-shadow(0 0 5px ${color}77)` }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function PosChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div
      className="flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: `${tone}44`, background: `${tone}0d` }}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className="font-mono text-[15px] font-semibold leading-none tabular-nums" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function Meta({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-[15px] tabular-nums text-slate-200">{value}</span>
        {unit && <span className="font-mono text-[9px] uppercase tracking-wide text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

function CarOutline() {
  return (
    <svg
      viewBox="0 0 92 200"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.9]"
      style={{ width: 78, height: 170 }}
      fill="none"
      aria-hidden="true"
    >
      <rect x="10" y="8" width="72" height="184" rx="26" stroke={CYAN} strokeOpacity="0.32" strokeWidth="1.3" />
      <path
        d="M24 66h44l-5-19c-1.6-6-6-9-12-9H41c-6 0-10.4 3-12 9l-5 19Z"
        stroke={CYAN}
        strokeOpacity="0.38"
        strokeWidth="1"
      />
      <path d="M22 140h48l-4 16c-1 4-4 6-9 6H35c-5 0-8-2-9-6l-4-16Z" stroke={CYAN} strokeOpacity="0.2" strokeWidth="1" />
      <line x1="46" y1="66" x2="46" y2="140" stroke={CYAN} strokeOpacity="0.12" strokeWidth="1" strokeDasharray="2 6" />
      {[
        { x: 2, y: 34 },
        { x: 80, y: 34 },
        { x: 2, y: 140 },
        { x: 80, y: 140 },
      ].map((w, i) => (
        <rect
          key={i}
          x={w.x}
          y={w.y}
          width="10"
          height="26"
          rx="4"
          stroke={MAGENTA}
          strokeOpacity="0.32"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

function TyreCorner({
  tag,
  wear,
  tempC,
  side,
}: {
  tag: string;
  wear: number;
  tempC: number;
  side: "left" | "right";
}) {
  const tone = wearTone(wear);
  return (
    <div className={`flex items-center gap-3.5 ${side === "right" ? "flex-row-reverse text-right" : ""}`}>
      <Ring pct={wear / 100} size={80} stroke={6} color={tone}>
        <span className="font-mono text-[16px] font-semibold leading-none tabular-nums text-slate-100">
          {wear.toFixed(1)}
          <span className="ml-[1px] text-[9px] font-normal text-slate-500">%</span>
        </span>
        <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-slate-500">wear</span>
      </Ring>
      <div className={`flex flex-col gap-0.5 ${side === "right" ? "items-end" : "items-start"}`}>
        <span
          className="rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
          style={{ borderColor: `${tone}33`, color: tone, background: `${tone}0a` }}
        >
          {tag}
        </span>
        <div className="mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums text-slate-100">
          {tempC}
          <span className="text-[10px] font-normal text-slate-500">°C</span>
        </div>
        <div className="text-[8.5px] uppercase tracking-[0.16em] text-slate-500">temperatuur</div>
      </div>
    </div>
  );
}

export default function Design({ f }: { f: PitwallFixture }) {
  const lapPct = clamp01(f.event.lap / f.event.totalLaps);
  const fuelPct = clamp01(f.fuel.litres / f.fuel.tankLitres);

  const flagTone =
    f.event.flag === "groen"
      ? GREEN
      : /rood|red/i.test(f.event.flag)
        ? "#f87171"
        : /geel|yellow/i.test(f.event.flag)
          ? AMBER
          : CYAN;

  const recommendation =
    f.pit.recommendation === "PIT_NOW"
      ? { text: "NU PITTEN", tone: MAGENTA, sub: "Nu naar binnen — anders verlies je de ronde erna." }
      : f.pit.recommendation === "PIT_SOON"
        ? { text: "PIT BINNENKORT", tone: MAGENTA, sub: "Hou de box vrij; het venster opent over enkele ronden." }
        : { text: "BLIJF BUITEN", tone: CYAN, sub: "Blijf rijden — de stint heeft nog ruimte." };

  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));

  const pace = f.pace;
  const paceMin = Math.min(...pace);
  const paceMax = Math.max(...pace);
  const paceAvg = pace.reduce((a, b) => a + b, 0) / pace.length;
  const paceLast = pace[pace.length - 1];
  const paceSpread = paceMax - paceMin;
  const minIdx = pace.indexOf(paceMin);
  const firstLap = Math.max(1, f.event.lap - pace.length + 1);

  const W = 720;
  const H = 214;
  const padX = 18;
  const padY = 26;
  const lo = paceMin - 0.5;
  const hi = paceMax + 0.5;
  const px = (i: number) => padX + (i / Math.max(1, pace.length - 1)) * (W - padX * 2);
  const py = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY - 22);
  const points = pace.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const areaPath = `M ${px(0).toFixed(1)} ${H - 22} L ${pace
    .map((v, i) => `${px(i).toFixed(1)} ${py(v).toFixed(1)}`)
    .join(" L ")} L ${px(pace.length - 1).toFixed(1)} ${H - 22} Z`;

  const xTicks = [0, 5, 10, 15, pace.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="min-h-screen bg-[#05080f] text-slate-200 antialiased">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 520px at 10% -10%, rgba(255,61,154,0.11), transparent 62%)," +
            "radial-gradient(1100px 620px at 92% -4%, rgba(62,240,255,0.12), transparent 60%)," +
            "radial-gradient(900px 620px at 55% 112%, rgba(62,240,255,0.06), transparent 65%)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <main className="relative mx-auto max-w-[1440px] px-4 py-5 lg:px-8 lg:py-7">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* ————— KOP ————— */}
          <header
            className="relative overflow-hidden rounded-2xl border border-white/[0.08] lg:col-span-12"
            style={{
              background:
                "linear-gradient(115deg, rgba(255,61,154,0.10) 0%, rgba(8,13,22,0.92) 42%, rgba(62,240,255,0.10) 100%)",
            }}
          >
            <div
              className="pointer-events-none absolute -top-28 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-70"
              style={{ background: "radial-gradient(circle, rgba(62,240,255,0.16), transparent 68%)" }}
            />
            <div className="relative grid gap-6 px-6 pb-5 pt-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.32em] text-cyan-300/80">
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ background: CYAN, boxShadow: `0 0 10px ${CYAN}` }}
                  />
                  3SM Pitwall · nachtdienst
                </div>
                <h1 className="mt-3 text-3xl font-semibold leading-none tracking-tight text-white lg:text-[34px]">
                  {f.event.name}
                </h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-slate-400">
                  <span>{f.event.circuit}</span>
                  <span className="text-slate-700">·</span>
                  <span className="font-mono tabular-nums">
                    RONDE {f.event.lap}
                    <span className="text-slate-500"> / {f.event.totalLaps}</span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.18em]"
                    style={{ borderColor: `${flagTone}44`, color: flagTone, background: `${flagTone}10` }}
                  >
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: flagTone, boxShadow: `0 0 6px ${flagTone}` }}
                    />
                    {f.event.flag}
                  </span>
                </div>
              </div>

              <div className="lg:px-8 lg:text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-slate-500">Resttijd</div>
                <div
                  className="mt-1 font-mono text-5xl font-semibold leading-none tracking-tight tabular-nums text-white lg:text-[54px]"
                  style={{ textShadow: "0 0 30px rgba(62,240,255,0.30)" }}
                >
                  {f.event.timeLeft}
                </div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.22em] text-slate-500">
                  {f.event.totalLaps - f.event.lap} ronden te gaan
                </div>
              </div>

              <div className="lg:justify-self-end lg:text-right">
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-slate-500">Onze auto</div>
                <div className="mt-1.5 text-[17px] font-semibold text-white">{f.self.driver}</div>
                <div className="text-[12px] text-slate-400">{f.self.team}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{f.self.car}</div>
                <div className="mt-3 flex gap-2 lg:justify-end">
                  <PosChip label="P" value={f.self.pos} tone={CYAN} />
                  <PosChip label={f.self.cls} value={f.self.classPos} tone={MAGENTA} />
                </div>
              </div>
            </div>

            <div className="relative flex items-center gap-3 px-6 pb-5">
              <div className="relative h-[3px] flex-1 overflow-visible rounded-full bg-white/[0.07]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${lapPct * 100}%`,
                    background: `linear-gradient(90deg, ${CYAN}, ${MAGENTA})`,
                    boxShadow: "0 0 12px rgba(62,240,255,0.45)",
                  }}
                />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#05080f]"
                  style={{ left: `${lapPct * 100}%`, background: "#eafcff", boxShadow: `0 0 10px ${CYAN}` }}
                />
              </div>
              <span className="font-mono text-[9px] tabular-nums text-slate-500">
                {Math.round(lapPct * 100)}%
              </span>
            </div>
          </header>

          {/* ————— GATEN + TELEMETRIE ————— */}
          <Panel className="lg:col-span-7" label="Gaten & telemetrie" hint="live" accent={CYAN}>
            <div className="flex flex-1 flex-col">
              <div className="grid flex-1 grid-cols-2 gap-px border-y border-white/[0.05] bg-white/[0.05] sm:grid-cols-3">
                <div className="flex flex-col justify-center bg-[#080d16] px-5 py-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
                    Voor · {f.gaps.aheadName}
                  </div>
                  <div className="mt-2 font-mono text-[34px] font-semibold leading-none tabular-nums text-white">
                    {f.gaps.ahead}
                    <span className="ml-1 text-[11px] font-normal text-slate-500">s</span>
                  </div>
                  <div className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                    gat naar voren
                  </div>
                </div>
                <div className="flex flex-col justify-center bg-[#080d16] px-5 py-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
                    Achter · {f.gaps.behindName}
                  </div>
                  <div className="mt-2 font-mono text-[34px] font-semibold leading-none tabular-nums text-white">
                    {f.gaps.behind}
                    <span className="ml-1 text-[11px] font-normal text-slate-500">s</span>
                  </div>
                  <div className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                    gat naar achteren
                  </div>
                </div>
                <div className="col-span-2 flex flex-col justify-center bg-[#080d16] px-5 py-4 sm:col-span-1">
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">Snelheid</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-[34px] font-semibold leading-none tabular-nums text-slate-100">
                      {f.telemetry.speedKph}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">km/u</span>
                  </div>
                  <div className="mt-2.5 flex gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                    <span style={{ color: CYAN }}>G{f.telemetry.gear}</span>
                    <span>{f.telemetry.rpm} rpm</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 px-5 py-4 sm:grid-cols-5">
                <Meta label="S1" value={f.telemetry.s1} />
                <Meta label="S2" value={f.telemetry.s2} />
                <Meta label="S3" value={f.telemetry.s3} />
                <Meta label="Laatste" value={f.telemetry.lastLap} />
                <Meta label="Beste" value={f.telemetry.bestLap} />
              </div>
            </div>
          </Panel>

          {/* ————— BRANDSTOF ————— */}
          <Panel className="lg:col-span-5" label="Brandstof" hint={`tank ${f.fuel.tankLitres} L`} accent={CYAN}>
            <div className="flex flex-1 flex-col items-center justify-between px-5 pb-4 pt-1">
              <Ring pct={fuelPct} size={188} stroke={9} color={CYAN} ticks={30}>
                <div className="font-mono text-[9px] uppercase tracking-[0.26em] text-slate-500">aan boord</div>
                <div className="mt-0.5 font-mono text-[42px] font-semibold leading-none tracking-tight tabular-nums text-white">
                  {f.fuel.litres.toFixed(1)}
                  <span className="ml-1 text-[13px] font-normal text-slate-500">L</span>
                </div>
                <div className="mt-1.5 font-mono text-[10px] tabular-nums text-slate-500">
                  {Math.round(fuelPct * 100)}% van tank
                </div>
              </Ring>

              <div className="mt-2 grid w-full grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
                <div className="text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">per ronde</div>
                  <div className="mt-1 font-mono text-[15px] tabular-nums text-slate-200">
                    {f.fuel.perLap.toFixed(2)}
                  </div>
                </div>
                <div className="border-x border-white/[0.06] text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">rondes over</div>
                  <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums" style={{ color: AMBER }}>
                    {f.fuel.lapsLeft}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">bijtanken</div>
                  <div className="mt-1 font-mono text-[15px] tabular-nums text-slate-200">
                    +{f.fuel.toAddLitres}
                  </div>
                </div>
              </div>

              <div className="mt-3 w-full">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                    nodig tot finish
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-300">
                    {f.fuel.toFinishLitres} L
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${clamp01(f.fuel.toFinishLitres / f.fuel.tankLitres) * 100}%`,
                      background: "linear-gradient(90deg, rgba(62,240,255,0.35), rgba(62,240,255,0.8))",
                    }}
                  />
                  <div
                    className="absolute -top-1 h-3.5 w-px bg-white/70"
                    style={{ left: `${fuelPct * 100}%`, boxShadow: `0 0 6px ${CYAN}` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-slate-500">
                  <span>Tank leeg rond ronde {f.event.lap + f.fuel.lapsLeft}</span>
                  <span>{f.pit.windowInLaps} rnd venster</span>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— BANDENKRUIS ————— */}
          <Panel className="lg:col-span-5" label="Bandenkruis" hint={`set ${f.tyres.setLaps} rnd`} accent={MAGENTA}>
            <div className="flex flex-1 flex-col justify-between px-5 pb-4">
              <div className="relative">
                <CarOutline />
                <div className="relative grid grid-cols-2 gap-x-4">
                  <TyreCorner tag="LV" wear={f.tyres.fl.wear} tempC={f.tyres.fl.tempC} side="left" />
                  <TyreCorner tag="RV" wear={f.tyres.fr.wear} tempC={f.tyres.fr.tempC} side="right" />
                  <div className="col-span-2 flex flex-col items-center justify-center py-2">
                    <span className="font-mono text-[7.5px] uppercase tracking-[0.3em] text-slate-600">voor</span>
                    <span className="mt-1 h-6 w-px bg-gradient-to-b from-white/10 to-transparent" />
                  </div>
                  <TyreCorner tag="LA" wear={f.tyres.rl.wear} tempC={f.tyres.rl.tempC} side="left" />
                  <TyreCorner tag="RA" wear={f.tyres.rr.wear} tempC={f.tyres.rr.tempC} side="right" />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-[-6px] flex justify-center">
                  <span className="font-mono text-[7.5px] uppercase tracking-[0.3em] text-slate-600">achter</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-lg border font-mono text-[18px] font-bold"
                    style={{
                      borderColor: `${gradeTone(f.tyres.grade)}55`,
                      color: gradeTone(f.tyres.grade),
                      background: `${gradeTone(f.tyres.grade)}0f`,
                      boxShadow: `inset 0 0 18px ${gradeTone(f.tyres.grade)}12`,
                    }}
                  >
                    {f.tyres.grade}
                  </div>
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-slate-500">
                      compound
                    </div>
                    <div className="mt-0.5 text-[12.5px] font-medium text-slate-100">{f.tyres.compound}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-l border-white/[0.07] pl-3">
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">
                      setleeftijd
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] tabular-nums text-slate-200">
                      {f.tyres.setLaps}
                      <span className="ml-0.5 text-[9px] text-slate-500">rnd</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">bereik</div>
                    <div className="mt-0.5 font-mono text-[13px] tabular-nums text-slate-200">
                      {f.tyres.wearRange[0]}–{f.tyres.wearRange[1]}
                      <span className="ml-0.5 text-[9px] text-slate-500">%/rnd</span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="mt-2.5 flex items-start gap-2 text-[10.5px] leading-relaxed text-slate-500">
                <svg width="11" height="11" viewBox="0 0 12 12" className="mt-[2px] shrink-0" fill="none">
                  <circle cx="6" cy="6" r="5" stroke="#475569" strokeWidth="1" />
                  <path d="M6 5v4M6 3.4v.2" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                {f.tyres.note}
              </p>
            </div>
          </Panel>

          {/* ————— PACE ————— */}
          <Panel className="lg:col-span-7" label="Pace" hint="laatste 20 ronden" accent={CYAN}>
            <div className="flex flex-1 flex-col justify-between px-4 pb-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Rondetijden">
                <defs>
                  <linearGradient id="d03-pace-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity="0.20" />
                    <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="d03-pace-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1f6f7d" />
                    <stop offset="45%" stopColor={CYAN} />
                    <stop offset="100%" stopColor={MAGENTA} />
                  </linearGradient>
                </defs>

                {xTicks.map((i) => (
                  <line
                    key={`x${i}`}
                    x1={px(i)}
                    x2={px(i)}
                    y1={padY - 6}
                    y2={H - 22}
                    stroke="#16202f"
                    strokeWidth="1"
                  />
                ))}

                {[paceMax, paceAvg, paceMin].map((v, i) => (
                  <g key={i}>
                    <line
                      x1={padX}
                      x2={W - padX}
                      y1={py(v)}
                      y2={py(v)}
                      stroke="#1e293b"
                      strokeWidth="1"
                      strokeDasharray={i === 1 ? "2 5" : "4 6"}
                    />
                    <text
                      x={W - padX}
                      y={py(v) - 5}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="8.5"
                      fontFamily="ui-monospace, monospace"
                    >
                      {lapTime(v)}
                    </text>
                  </g>
                ))}

                <text
                  x={padX + 2}
                  y={py(paceAvg) - 5}
                  fill="#475569"
                  fontSize="8"
                  fontFamily="ui-monospace, monospace"
                >
                  GEM
                </text>

                <path d={areaPath} fill="url(#d03-pace-fill)" />
                <polyline
                  points={points}
                  fill="none"
                  stroke="url(#d03-pace-line)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ filter: "drop-shadow(0 0 6px rgba(62,240,255,0.35))" }}
                />

                <g>
                  <circle cx={px(minIdx)} cy={py(paceMin)} r="4" fill={CYAN} opacity="0.25" />
                  <circle cx={px(minIdx)} cy={py(paceMin)} r="2" fill={CYAN} />
                  <text
                    x={px(minIdx)}
                    y={py(paceMin) - 9}
                    textAnchor="middle"
                    fill={CYAN}
                    fontSize="8.5"
                    fontFamily="ui-monospace, monospace"
                  >
                    {lapTime(paceMin)}
                  </text>
                </g>

                <g>
                  <circle cx={px(pace.length - 1)} cy={py(paceLast)} r="4.5" fill={MAGENTA} opacity="0.2" />
                  <circle cx={px(pace.length - 1)} cy={py(paceLast)} r="2.4" fill={MAGENTA} />
                </g>

                {xTicks.map((i) => (
                  <text
                    key={`t${i}`}
                    x={px(i)}
                    y={H - 6}
                    textAnchor={i === 0 ? "start" : i === pace.length - 1 ? "end" : "middle"}
                    fill="#475569"
                    fontSize="8.5"
                    fontFamily="ui-monospace, monospace"
                  >
                    R{firstLap + i}
                  </text>
                ))}
              </svg>

              <div className="mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.05]">
                <div className="bg-[#080d16] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-500">gemiddelde</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums text-slate-200">{lapTime(paceAvg)}</div>
                </div>
                <div className="bg-[#080d16] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-500">snelste</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums" style={{ color: CYAN }}>
                    {lapTime(paceMin)}
                  </div>
                </div>
                <div className="bg-[#080d16] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-500">laatste</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums" style={{ color: MAGENTA }}>
                    {lapTime(paceLast)}
                  </div>
                </div>
                <div className="bg-[#080d16] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-500">spreiding</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums text-slate-400">
                    {paceSpread.toFixed(1)}
                    <span className="ml-0.5 text-[9px] text-slate-500">s</span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— BESLISSING ————— */}
          <Panel className="lg:col-span-6" label="Beslissing" hint="pitwall call" accent={recommendation.tone}>
            <div className="flex flex-1 flex-col justify-center gap-5 px-5 pb-5">
              <div className="flex items-start gap-4">
                <div
                  className="mt-1 h-11 w-1 shrink-0 rounded-full"
                  style={{ background: recommendation.tone, boxShadow: `0 0 14px ${recommendation.tone}aa` }}
                />
                <div>
                  <div
                    className="font-mono text-[26px] font-semibold leading-none tracking-[0.05em]"
                    style={{ color: recommendation.tone, textShadow: `0 0 26px ${recommendation.tone}55` }}
                  >
                    {recommendation.text}
                  </div>
                  <p className="mt-2.5 max-w-lg text-[13px] leading-relaxed text-slate-300">{f.pit.reason}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{recommendation.sub}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.05]">
                <div className="bg-[#080d16] px-4 py-2.5">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                    pitwindow
                  </div>
                  <div className="mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums text-slate-100">
                    {f.pit.windowInLaps}
                    <span className="ml-1 text-[9px] font-normal text-slate-500">rnd</span>
                  </div>
                </div>
                <div className="bg-[#080d16] px-4 py-2.5">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                    pitverlies
                  </div>
                  <div className="mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums text-slate-100">
                    {f.pit.pitLossSeconds}
                    <span className="ml-1 text-[9px] font-normal text-slate-500">s</span>
                  </div>
                </div>
                <div className="bg-[#080d16] px-4 py-2.5">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                    brandstof
                  </div>
                  <div className="mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums" style={{ color: AMBER }}>
                    {f.fuel.lapsLeft}
                    <span className="ml-1 text-[9px] font-normal text-slate-500">rnd</span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— COUREURSWISSEL ————— */}
          <Panel className="lg:col-span-3" label="Coureurswissel" hint="stintplan" accent={MAGENTA}>
            <div className="flex flex-1 flex-col justify-center px-4 pb-4">
              <div className="relative pl-5">
                <div className="absolute bottom-3 left-[4px] top-3 w-px bg-gradient-to-b from-cyan-300/50 via-white/10 to-transparent" />

                <div className="relative pb-5">
                  <span
                    className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#080d16]"
                    style={{ background: CYAN, boxShadow: `0 0 10px ${CYAN}` }}
                  />
                  <div className="font-mono text-[8px] uppercase tracking-[0.2em]" style={{ color: `${CYAN}b0` }}>
                    nu
                  </div>
                  <div className="mt-1 text-[13px] font-semibold leading-tight text-white">{f.rotation.current}</div>
                </div>

                <div className="relative pb-5">
                  <span className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#080d16] bg-slate-600" />
                  <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-500">volgende</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium leading-tight text-slate-200">{f.rotation.next}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                      +{f.rotation.nextInMinutes}
                      <span className="text-[8px] text-slate-500"> min</span>
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <span className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#080d16] bg-slate-700" />
                  <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-500">daarna</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] leading-tight text-slate-400">{f.rotation.after}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                      +{f.rotation.afterInMinutes}
                      <span className="text-[8px] text-slate-500"> min</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— WEER ————— */}
          <Panel className="lg:col-span-3" label="Weer" hint="03:00" accent={MAGENTA}>
            <div className="flex flex-1 flex-col justify-between px-4 pb-4">
              <div className="flex items-start gap-3">
                <svg width="40" height="40" viewBox="0 0 54 54" fill="none" className="mt-0.5 shrink-0">
                  <circle cx="27" cy="27" r="21" stroke="#1e293b" strokeWidth="1" strokeDasharray="2 4" />
                  <path
                    d="M31 16a13 13 0 1 0 0 22 15 15 0 0 1 0-22Z"
                    fill="#0b1420"
                    stroke={CYAN}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    style={{ filter: "drop-shadow(0 0 6px rgba(62,240,255,0.45))" }}
                  />
                  <circle cx="38.5" cy="17" r="1.1" fill={MAGENTA} />
                  <circle cx="43" cy="24" r="0.8" fill={CYAN} opacity="0.7" />
                </svg>
                <div>
                  <div className="text-[12px] font-medium text-slate-200">Droog</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
                    geen regen verwacht
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.05]">
                <div className="bg-[#080d16] px-3.5 py-2.5">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">lucht</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold leading-none tabular-nums text-slate-100">
                    {f.weather.airC.toFixed(1)}
                    <span className="text-[10px] font-normal text-slate-500">°C</span>
                  </div>
                </div>
                <div className="bg-[#080d16] px-3.5 py-2.5">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">baan</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold leading-none tabular-nums" style={{ color: AMBER }}>
                    {f.weather.trackC.toFixed(1)}
                    <span className="text-[10px] font-normal text-slate-500">°C</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
                <div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">rubber</div>
                  <div className="mt-1 text-[11.5px] text-slate-300">{rubberLabel(f.weather.rubber)}</div>
                  <div className="mt-0.5 font-mono text-[9px] tabular-nums text-slate-500">
                    baan {(f.weather.trackC - f.weather.airC).toFixed(1)}° warmer dan lucht
                  </div>
                </div>
                <div className="flex items-end gap-[3px] pb-1">
                  {[4, 7, 5, 9, 6, 3].map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-sm"
                      style={{
                        height: h * 2,
                        background: i < 3 ? "rgba(62,240,255,0.55)" : "rgba(255,255,255,0.10)",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— KLASSEMENT ————— */}
          <Panel className="lg:col-span-12" label="Klassement per klasse" hint="na ronde 42" accent={CYAN}>
            <div className="overflow-x-auto px-2 pb-4">
              <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                {classes.map((cls) => {
                  const rows = f.standings
                    .filter((s) => s.cls === cls)
                    .slice()
                    .sort((a, b) => a.classPos - b.classPos);
                  const isOwn = cls === f.self.cls;
                  return (
                    <div key={cls} className="min-w-[480px] md:min-w-0">
                      <div className="flex items-center gap-3 px-3 pb-2 pt-2">
                        <span className="font-mono text-[10px] font-semibold tracking-[0.24em] text-slate-300">
                          {cls}
                        </span>
                        <span
                          className="h-px flex-1"
                          style={{ background: `linear-gradient(90deg, ${isOwn ? CYAN : "#334155"}55, transparent)` }}
                        />
                        <span className="font-mono text-[9px] text-slate-500">{rows.length} auto&apos;s</span>
                      </div>

                      <div className="grid grid-cols-[26px_32px_1fr_66px_78px_78px_32px] items-center gap-2 px-3 pb-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
                        <span>pos</span>
                        <span>kl</span>
                        <span>coureur</span>
                        <span className="text-right">gat</span>
                        <span className="text-right">laatste</span>
                        <span className="text-right">beste</span>
                        <span className="text-right">bnd</span>
                      </div>

                      {rows.map((s) => (
                        <div
                          key={`${cls}-${s.pos}`}
                          className={`grid grid-cols-[26px_32px_1fr_66px_78px_78px_32px] items-center gap-2 border-t border-white/[0.04] px-3 py-[7px] ${
                            s.isSelf ? "" : "hover:bg-white/[0.02]"
                          }`}
                          style={
                            s.isSelf
                              ? { background: "rgba(62,240,255,0.055)", boxShadow: `inset 2px 0 0 0 ${CYAN}` }
                              : undefined
                          }
                        >
                          <span
                            className="font-mono text-[12px] font-semibold tabular-nums"
                            style={{ color: s.pos === 1 ? CYAN : "#94a3b8" }}
                          >
                            {s.pos}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-slate-500">{s.classPos}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`truncate text-[12.5px] ${
                                  s.isSelf ? "font-semibold text-white" : "font-medium text-slate-200"
                                }`}
                              >
                                {s.driver}
                              </span>
                              {s.isSelf && (
                                <span
                                  className="rounded px-1 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em]"
                                  style={{ background: `${CYAN}1f`, color: CYAN }}
                                >
                                  WIJ
                                </span>
                              )}
                              {s.inPit && (
                                <span
                                  className="rounded px-1 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em]"
                                  style={{ background: `${MAGENTA}1a`, color: MAGENTA, boxShadow: `0 0 10px ${MAGENTA}22` }}
                                >
                                  PIT
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-slate-500">{s.car}</div>
                          </div>
                          <span
                            className="text-right font-mono text-[10.5px] tabular-nums"
                            style={{ color: s.gap === "LEIDER" ? CYAN : "#94a3b8" }}
                          >
                            {s.gap}
                          </span>
                          <span className="text-right font-mono text-[10.5px] tabular-nums text-slate-300">
                            {s.lastLap}
                          </span>
                          <span className="text-right font-mono text-[10.5px] tabular-nums text-slate-500">
                            {s.bestLap}
                          </span>
                          <span className="text-right font-mono text-[10.5px] tabular-nums text-slate-500">
                            {s.tyreAgeLaps}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1 font-mono text-[9px] uppercase tracking-[0.22em] text-slate-600">
          <span className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full" style={{ background: CYAN, boxShadow: `0 0 6px ${CYAN}` }} />
            3SM Pitwall · ontwerp 03 — endurance night
          </span>
          <span>
            {f.event.circuit} · {f.event.timeLeft} te gaan
          </span>
        </footer>
      </main>
    </div>
  );
}
