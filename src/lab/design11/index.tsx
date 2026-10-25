import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "Endurance Night · 3SM",
  note:
    "Ontwerp 03 in de 3SM-huisstijl: bijna-zwart en grafiet, één warm oranje accent, en de baan als hart van de pitwall.",
};

/* ————— 3SM-huisstijl: bijna-zwart, grafiet, oranje. Niets anders. ————— */
const INK = "#0A0A0B";
const GRAPHITE = "#1B1B1F";
const ASH = "#8A8A91";
const BONE = "#D6D3D1";
const ORANGE = "#F97316";
const ORANGE_LIGHT = "#FB923C";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const wearTone = (w: number) => (w >= 92 ? ORANGE : w >= 85 ? ORANGE_LIGHT : BONE);

const gradeTone = (g: string) =>
  g === "A" ? BONE : g === "B" ? ASH : g === "C" ? ORANGE_LIGHT : ORANGE;

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
  accent = ORANGE,
  className = "",
  children,
}: {
  label?: string;
  hint?: ReactNode;
  accent?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] shadow-[0_40px_80px_-60px_rgba(0,0,0,1)] ${className}`}
      style={{ background: "linear-gradient(180deg, #141416 0%, #101012 55%, #0D0D0F 100%)" }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }}
      />
      {label && (
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div className="flex items-center gap-2.5">
            <span
              className="h-[11px] w-[3px] rounded-full"
              style={{ background: accent, boxShadow: `0 0 10px ${accent}99` }}
            />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#A1A1A6]">{label}</h2>
          </div>
          {hint && (
            <span className="truncate font-mono text-[9px] uppercase tracking-[0.2em] text-[#5C5C63]">{hint}</span>
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
    const inner = r - stroke - 10;
    const outer = inner + (i % 5 === 0 ? 6 : 3);
    const on = i / ticks <= pct;
    return (
      <line
        key={i}
        x1={size / 2 + Math.cos(a) * inner}
        y1={size / 2 + Math.sin(a) * inner}
        x2={size / 2 + Math.cos(a) * outer}
        y2={size / 2 + Math.sin(a) * outer}
        stroke={on ? color : "#242428"}
        strokeWidth={1}
        opacity={on ? 0.55 : 1}
      />
    );
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        {ticks > 0 && tickEls}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GRAPHITE} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function Stripes({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} aria-hidden="true">
      {[1, 0.6, 0.3].map((o, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{ height: 18 - i * 5, background: ORANGE, opacity: o }}
        />
      ))}
    </span>
  );
}

function PosChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div
      className="flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: `${tone}3d`, background: `${tone}0d` }}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8A8A91]">{label}</span>
      <span className="font-mono text-[15px] font-semibold leading-none tabular-nums" style={{ color: tone }}>
        {value}
      </span>
    </div>
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
      <Ring pct={wear / 100} size={82} stroke={6} color={tone}>
        <span className="font-mono text-[16px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
          {wear.toFixed(1)}
          <span className="ml-[1px] text-[9px] font-normal text-[#5C5C63]">%</span>
        </span>
        <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-[#5C5C63]">wear</span>
      </Ring>
      <div className={`flex flex-col gap-0.5 ${side === "right" ? "items-end" : "items-start"}`}>
        <span
          className="rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
          style={{ borderColor: `${tone}33`, color: tone, background: `${tone}0a` }}
        >
          {tag}
        </span>
        <div className="mt-1 font-mono text-[19px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
          {tempC}
          <span className="text-[10px] font-normal text-[#5C5C63]">°C</span>
        </div>
        <div className="text-[8.5px] uppercase tracking-[0.16em] text-[#5C5C63]">temperatuur</div>
      </div>
    </div>
  );
}

/* ————— TRACK MAP ————— */
function TrackMap({ f }: { f: PitwallFixture }) {
  const { trackMap } = f;
  const gt3 = trackMap.cars.filter((c) => c.cls === "GT3").length;
  const gt4 = trackMap.cars.length - gt3;

  return (
    <div className="flex flex-1 flex-col px-5 pb-4">
      <div
        className="relative overflow-hidden rounded-xl border border-white/[0.05]"
        style={{
          background:
            "radial-gradient(120% 120% at 50% -20%, #1A1A1E 0%, #101013 55%, #0B0B0D 100%)",
        }}
      >
        <svg
          viewBox={trackMap.viewBox}
          className="block h-auto w-full"
          role="img"
          aria-label={`Track map ${f.event.circuit}`}
        >
          <defs>
            <pattern id="d11-checker" width="7" height="9" patternUnits="userSpaceOnUse">
              <rect width="7" height="9" fill="#F5F5F4" />
              <rect width="3.5" height="4.5" fill="#0A0A0B" />
              <rect x="3.5" y="4.5" width="3.5" height="4.5" fill="#0A0A0B" />
            </pattern>
            <radialGradient id="d11-track-warm" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor={ORANGE} stopOpacity="0.16" />
              <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
            </radialGradient>
            <filter id="d11-self-glow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* fijne rasterlijnen, nauwelijks zichtbaar */}
          {[26, 64, 102, 140, 178].map((y) => (
            <line key={`h${y}`} x1="8" x2="412" y1={y} y2={y} stroke="#FFFFFF" strokeOpacity="0.025" strokeWidth="0.7" />
          ))}
          {[70, 140, 210, 280, 350].map((x) => (
            <line key={`v${x}`} x1={x} x2={x} y1="12" y2="180" stroke="#FFFFFF" strokeOpacity="0.025" strokeWidth="0.7" />
          ))}

          {/* baanribbon: donker grafiet, lichtere middenlijn */}
          <path
            d={trackMap.path}
            fill="none"
            stroke="#2B2B31"
            strokeWidth={21}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={trackMap.path}
            fill="none"
            stroke="#17171B"
            strokeWidth={15}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={trackMap.path}
            fill="none"
            stroke="#4A4A53"
            strokeWidth={1}
            strokeDasharray="4 7"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* start / finish */}
          <rect x="17" y="93.5" width="22" height="9" fill="url(#d11-checker)" opacity="0.95" />
          <text x="44" y="99" fill="#63636B" fontSize="6" fontFamily="ui-monospace, monospace" letterSpacing="0.6">
            S/F
          </text>

          {/* rijrichting op het rechte stuk onderaan */}
          <path d="M305 161 L296 166 L305 171 Z" fill="#55555E" />

          {/* auto's */}
          {trackMap.cars.map((car, i) => {
            const isSelf = car.self;
            const hollow = car.cls === "GT4";
            const fontSize = isSelf ? 8.6 : 7.2;
            const labelW = car.label.length * fontSize * 0.62 + 4.6;
            const labelY = car.y - 9;
            return (
              <g key={`${car.label}-${i}`}>
                {isSelf && (
                  <>
                    <circle cx={car.x} cy={car.y} r="16" fill="url(#d11-track-warm)" />
                    <circle
                      cx={car.x}
                      cy={car.y}
                      r="9"
                      fill="none"
                      stroke={ORANGE}
                      strokeOpacity="0.35"
                      strokeWidth="0.9"
                    />
                  </>
                )}
                <circle
                  cx={car.x}
                  cy={car.y}
                  r={isSelf ? 4 : 2.9}
                  fill={isSelf ? ORANGE : hollow ? "#0C0C0E" : "#7C7C84"}
                  stroke={isSelf ? ORANGE_LIGHT : hollow ? "#9A9AA2" : "#0A0A0B"}
                  strokeWidth={isSelf ? 1.2 : 1.3}
                  filter={isSelf ? "url(#d11-self-glow)" : undefined}
                />
                <rect
                  x={car.x - labelW / 2}
                  y={labelY - fontSize * 0.8}
                  width={labelW}
                  height={fontSize * 1.06}
                  rx="1.6"
                  fill="#0A0A0B"
                  fillOpacity={isSelf ? 0.5 : 0.62}
                />
                <text
                  x={car.x}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fontWeight={isSelf ? 700 : 600}
                  letterSpacing="0.2"
                  fontFamily="ui-monospace, monospace"
                  fill={isSelf ? ORANGE_LIGHT : "#C9C9D1"}
                >
                  {car.label}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.24em] text-[#5C5C63]">
          <span className="h-1 w-1 rounded-full" style={{ background: ORANGE }} />
          live positie
        </div>
        <div className="pointer-events-none absolute right-4 top-3 font-mono text-[8.5px] uppercase tracking-[0.24em] text-[#4A4A52]">
          ronde {f.event.lap} / {f.event.totalLaps}
        </div>
      </div>

      {/* legenda */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 border-t border-white/[0.05] pt-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: ORANGE, boxShadow: `0 0 8px ${ORANGE}aa` }}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: ORANGE_LIGHT }}>
              jij · P{f.self.pos}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: ASH }} />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#75757D]">GT3 · {gt3}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-[#8A8A91]" style={{ background: "#0C0C0E" }} />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#75757D]">GT4 · {gt4}</span>
          </span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#4A4A52]">
          {trackMap.cars.length} auto&apos;s op baan
        </span>
      </div>
    </div>
  );
}

export default function Design({ f }: { f: PitwallFixture }) {
  const lapPct = clamp01(f.event.lap / f.event.totalLaps);
  const fuelPct = clamp01(f.fuel.litres / f.fuel.tankLitres);
  const finishPct = clamp01(f.fuel.toFinishLitres / f.fuel.tankLitres);
  const lapsToGo = f.event.totalLaps - f.event.lap;
  const fuelEmptyLap = f.event.lap + f.fuel.lapsLeft;
  const windowCloseLap = f.event.lap + f.pit.windowInLaps;

  const flagIsGreen = /groen|green/i.test(f.event.flag);
  const flagTone = flagIsGreen ? BONE : ORANGE;

  const recommendation =
    f.pit.recommendation === "PIT_NOW"
      ? {
          text: "NU PITTEN",
          tone: ORANGE,
          sub: "Box vrijhouden — elke ronde die je later binnenkomt kost je de positie.",
        }
      : f.pit.recommendation === "PIT_SOON"
        ? {
            text: "PIT BINNENKORT",
            tone: ORANGE_LIGHT,
            sub: "Hou de box klaar; de stop valt binnen het huidige venster.",
          }
        : {
            text: "BLIJF BUITEN",
            tone: BONE,
            sub: "De stint heeft nog ruimte — geen actie nodig.",
          };

  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));

  const pace = f.pace;
  const paceMin = Math.min(...pace);
  const paceMax = Math.max(...pace);
  const paceAvg = pace.reduce((a, b) => a + b, 0) / pace.length;
  const paceLast = pace[pace.length - 1];
  const paceSpread = paceMax - paceMin;
  const minIdx = pace.indexOf(paceMin);
  const firstLap = Math.max(1, f.event.lap - pace.length + 1);

  const last5 = pace.slice(-5);
  const last5Max = Math.max(...last5);
  const last5Min = Math.min(...last5);

  const W = 720;
  const H = 200;
  const padX = 20;
  const padY = 26;
  const lo = paceMin - 0.5;
  const hi = paceMax + 0.5;
  const px = (i: number) => padX + (i / Math.max(1, pace.length - 1)) * (W - padX * 2);
  const py = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY - 24);
  const points = pace.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const areaPath = `M ${px(0).toFixed(1)} ${H - 24} L ${pace
    .map((v, i) => `${px(i).toFixed(1)} ${py(v).toFixed(1)}`)
    .join(" L ")} L ${px(pace.length - 1).toFixed(1)} ${H - 24} Z`;
  const xTicks = [0, 5, 10, 15, pace.length - 1].filter((v, i, a) => a.indexOf(v) === i && v < pace.length);

  const trackTempPct = clamp01(f.weather.trackC / 45);

  return (
    <div className="min-h-screen antialiased" style={{ background: INK, color: BONE }}>
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(760px 420px at 8% -8%, rgba(249,115,22,0.09), transparent 62%)," +
            "radial-gradient(900px 480px at 94% -6%, rgba(249,115,22,0.05), transparent 60%)," +
            "radial-gradient(700px 520px at 50% 112%, rgba(249,115,22,0.05), transparent 68%)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.022]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <main className="relative mx-auto max-w-[1480px] px-4 py-5 lg:px-8 lg:py-7">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* ————— KOP ————— */}
          <header
            className="relative overflow-hidden rounded-2xl border border-white/[0.07] lg:col-span-12"
            style={{
              background:
                "linear-gradient(112deg, rgba(249,115,22,0.09) 0%, #121214 38%, #101012 64%, rgba(249,115,22,0.05) 100%)",
            }}
          >
            <div
              className="pointer-events-none absolute -top-32 left-[62%] h-80 w-80 -translate-x-1/2 rounded-full opacity-80"
              style={{ background: "radial-gradient(circle, rgba(249,115,22,0.14), transparent 68%)" }}
            />
            <div className="relative grid gap-6 px-6 pb-5 pt-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-[0.32em] text-[#A1A1A6]">
                  <Stripes />
                  3SM Pitwall · nachtdienst
                </div>
                <h1 className="mt-3 text-3xl font-semibold leading-none tracking-tight text-white lg:text-[34px]">
                  {f.event.name}
                </h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-[#8A8A91]">
                  <span>{f.event.circuit}</span>
                  <span className="text-[#3F3F45]">·</span>
                  <span className="font-mono tabular-nums">
                    RONDE {f.event.lap}
                    <span className="text-[#5C5C63]"> / {f.event.totalLaps}</span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.18em]"
                    style={{ borderColor: `${flagTone}3d`, color: flagTone, background: `${flagTone}0c` }}
                  >
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: flagTone, boxShadow: flagIsGreen ? "none" : `0 0 6px ${flagTone}` }}
                    />
                    {f.event.flag}
                  </span>
                </div>
              </div>

              <div className="lg:px-10 lg:text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-[#5C5C63]">Resttijd</div>
                <div
                  className="mt-1 font-mono text-5xl font-semibold leading-none tracking-tight tabular-nums text-white lg:text-[54px]"
                  style={{ textShadow: "0 0 34px rgba(249,115,22,0.28)" }}
                >
                  {f.event.timeLeft}
                </div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#5C5C63]">
                  {lapsToGo} ronden te gaan
                </div>
              </div>

              <div className="lg:justify-self-end lg:text-right">
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#5C5C63]">Onze auto</div>
                <div className="mt-1.5 text-[17px] font-semibold text-white">{f.self.driver}</div>
                <div className="text-[12px] text-[#A1A1A6]">{f.self.team}</div>
                <div className="mt-0.5 text-[11px] text-[#5C5C63]">{f.self.car}</div>
                <div className="mt-3 flex gap-2 lg:justify-end">
                  <PosChip label="P" value={f.self.pos} tone={ORANGE_LIGHT} />
                  <PosChip label={f.self.cls} value={f.self.classPos} tone={BONE} />
                </div>
              </div>
            </div>

            <div className="relative flex items-center gap-3 px-6 pb-5">
              <div className="relative h-[3px] flex-1 rounded-full bg-white/[0.06]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${lapPct * 100}%`,
                    background: `linear-gradient(90deg, #7C2D12, ${ORANGE})`,
                    boxShadow: "0 0 14px rgba(249,115,22,0.35)",
                  }}
                />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0A0A0B]"
                  style={{ left: `${lapPct * 100}%`, background: "#FED7AA", boxShadow: `0 0 10px ${ORANGE}` }}
                />
              </div>
              <span className="font-mono text-[9px] tabular-nums text-[#5C5C63]">{Math.round(lapPct * 100)}%</span>
            </div>
          </header>

          {/* ————— TRACK MAP ————— */}
          <Panel
            className="lg:col-span-8"
            label="Track map"
            hint={
              <span className="flex items-center gap-2">
                <span className="h-1 w-1 animate-pulse rounded-full" style={{ background: ORANGE }} />
                circuit gilles villeneuve
              </span>
            }
          >
            <TrackMap f={f} />
          </Panel>

          {/* ————— BESLISSING ————— */}
          <Panel className="lg:col-span-4" label="Beslissing" hint="pitwall call" accent={recommendation.tone}>
            <div className="flex flex-1 flex-col justify-between gap-5 px-5 pb-5 pt-1">
              <div>
                <div className="flex items-start gap-3.5">
                  <div
                    className="mt-1 h-10 w-1 shrink-0 rounded-full"
                    style={{ background: recommendation.tone, boxShadow: `0 0 16px ${recommendation.tone}aa` }}
                  />
                  <div>
                    <div
                      className="font-mono text-[25px] font-semibold leading-none tracking-[0.04em]"
                      style={{ color: recommendation.tone, textShadow: `0 0 28px ${recommendation.tone}44` }}
                    >
                      {recommendation.text}
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-[#D6D3D1]">{f.pit.reason}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E6E76]">{recommendation.sub}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3.5 py-2.5">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[#5C5C63]">
                    brandstof is de limiet
                  </span>
                  <span className="h-px flex-1 bg-white/[0.07]" />
                  <span className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: ORANGE_LIGHT }}>
                    {f.fuel.lapsLeft} rnd
                  </span>
                </div>

                <div className="mt-4 space-y-px overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.04]">
                  <div className="flex items-baseline justify-between bg-[#101012] px-3.5 py-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#5C5C63]">
                      tank leeg
                    </span>
                    <span className="font-mono text-[11.5px] tabular-nums text-[#D6D3D1]">
                      ronde {fuelEmptyLap}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between bg-[#101012] px-3.5 py-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#5C5C63]">
                      venster sluit
                    </span>
                    <span className="font-mono text-[11.5px] tabular-nums text-[#D6D3D1]">
                      ronde {windowCloseLap}
                    </span>
                  </div>
                  {fuelEmptyLap === windowCloseLap && (
                    <div className="flex items-center gap-2 bg-[#101012] px-3.5 py-2">
                      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: ORANGE }} />
                      <span className="text-[10.5px] leading-snug text-[#8A8A91]">
                        Tank en venster vallen in dezelfde ronde — geen uitstel.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.05]">
                <div className="bg-[#101012] px-3.5 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">pitwindow</div>
                  <div className="mt-1 font-mono text-[19px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
                    {f.pit.windowInLaps}
                    <span className="ml-1 text-[9px] font-normal text-[#5C5C63]">rnd</span>
                  </div>
                </div>
                <div className="bg-[#101012] px-3.5 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">pitverlies</div>
                  <div className="mt-1 font-mono text-[19px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
                    {f.pit.pitLossSeconds}
                    <span className="ml-1 text-[9px] font-normal text-[#5C5C63]">s</span>
                  </div>
                </div>
                <div className="bg-[#101012] px-3.5 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">bijtanken</div>
                  <div className="mt-1 font-mono text-[19px] font-semibold leading-none tabular-nums" style={{ color: ORANGE }}>
                    +{f.fuel.toAddLitres}
                    <span className="ml-1 text-[9px] font-normal text-[#5C5C63]">L</span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— BANDENKRUIS ————— */}
          <Panel className="lg:col-span-7" label="Bandenkruis" hint={`set ${f.tyres.setLaps} rnd`} accent={ORANGE_LIGHT}>
            <div className="flex flex-1 flex-col justify-between px-5 pb-4">
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <TyreCorner tag="LV" wear={f.tyres.fl.wear} tempC={f.tyres.fl.tempC} side="left" />
                <TyreCorner tag="RV" wear={f.tyres.fr.wear} tempC={f.tyres.fr.tempC} side="right" />
              </div>

              <div className="my-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="font-mono text-[7.5px] uppercase tracking-[0.32em] text-[#4A4A52]">
                  vooras · achteras
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>

              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <TyreCorner tag="LA" wear={f.tyres.rl.wear} tempC={f.tyres.rl.tempC} side="left" />
                <TyreCorner tag="RA" wear={f.tyres.rr.wear} tempC={f.tyres.rr.tempC} side="right" />
              </div>

              <div className="mt-5 grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-lg border font-mono text-[18px] font-bold"
                    style={{
                      borderColor: `${gradeTone(f.tyres.grade)}55`,
                      color: gradeTone(f.tyres.grade),
                      background: `${gradeTone(f.tyres.grade)}0d`,
                    }}
                  >
                    {f.tyres.grade}
                  </div>
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-[#5C5C63]">compound</div>
                    <div className="mt-0.5 text-[12.5px] font-medium text-[#F5F5F4]">{f.tyres.compound}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-l border-white/[0.07] pl-3">
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#5C5C63]">
                      setleeftijd
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[#E7E5E4]">
                      {f.tyres.setLaps}
                      <span className="ml-0.5 text-[9px] text-[#5C5C63]">rnd</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#5C5C63]">bereik</div>
                    <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[#E7E5E4]">
                      {f.tyres.wearRange[0]}–{f.tyres.wearRange[1]}
                      <span className="ml-0.5 text-[9px] text-[#5C5C63]">%/rnd</span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="mt-2.5 flex items-start gap-2 text-[10.5px] leading-relaxed text-[#6E6E76]">
                <svg width="11" height="11" viewBox="0 0 12 12" className="mt-[2px] shrink-0" fill="none">
                  <circle cx="6" cy="6" r="5" stroke="#63636B" strokeWidth="1" />
                  <path d="M6 5v4M6 3.4v.2" stroke="#8A8A91" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                {f.tyres.note}
              </p>
            </div>
          </Panel>

          {/* ————— BRANDSTOF ————— */}
          <Panel className="lg:col-span-5" label="Brandstof" hint={`tank ${f.fuel.tankLitres} L`}>
            <div className="flex flex-1 flex-col items-center px-5 pb-4 pt-1">
              <Ring pct={fuelPct} size={176} stroke={9} color={ORANGE} ticks={28}>
                <div className="font-mono text-[9px] uppercase tracking-[0.26em] text-[#5C5C63]">aan boord</div>
                <div className="mt-0.5 font-mono text-[38px] font-semibold leading-none tracking-tight tabular-nums text-white">
                  {f.fuel.litres.toFixed(1)}
                  <span className="ml-1 text-[13px] font-normal text-[#5C5C63]">L</span>
                </div>
                <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#6E6E76]">
                  {Math.round(fuelPct * 100)}% van tank
                </div>
              </Ring>

              <div className="mt-4 grid w-full grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
                <div className="text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#5C5C63]">per ronde</div>
                  <div className="mt-1 font-mono text-[15px] tabular-nums text-[#E7E5E4]">
                    {f.fuel.perLap.toFixed(2)}
                  </div>
                </div>
                <div className="border-x border-white/[0.06] text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#5C5C63]">rondes over</div>
                  <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums" style={{ color: ORANGE_LIGHT }}>
                    {f.fuel.lapsLeft}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#5C5C63]">bijtanken</div>
                  <div className="mt-1 font-mono text-[15px] tabular-nums text-[#E7E5E4]">+{f.fuel.toAddLitres}</div>
                </div>
              </div>

              <div className="mt-3 w-full">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#5C5C63]">
                    nodig tot finish
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[#D6D3D1]">
                    {f.fuel.toFinishLitres} L
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${finishPct * 100}%`,
                      background: "linear-gradient(90deg, rgba(249,115,22,0.25), rgba(251,146,60,0.7))",
                    }}
                  />
                  <div
                    className="absolute -top-1 h-3.5 w-px bg-white/70"
                    style={{ left: `${fuelPct * 100}%`, boxShadow: `0 0 6px ${ORANGE}` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#5C5C63]">
                  <span>Tank leeg rond ronde {f.event.lap + f.fuel.lapsLeft}</span>
                  <span>{f.pit.windowInLaps} rnd venster</span>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— GATEN & TELEMETRIE ————— */}
          <Panel className="lg:col-span-4" label="Gaten & telemetrie" hint="live" accent={BONE}>
            <div className="flex flex-1 flex-col">
              <div className="grid grid-cols-2 gap-px border-y border-white/[0.05] bg-white/[0.05]">
                <div className="bg-[#101012] px-4 py-3.5">
                  <div className="truncate font-mono text-[8.5px] uppercase tracking-[0.18em] text-[#5C5C63]">
                    voor · {f.gaps.aheadName}
                  </div>
                  <div className="mt-1.5 font-mono text-[30px] font-semibold leading-none tabular-nums text-white">
                    {f.gaps.ahead}
                    <span className="ml-1 text-[10px] font-normal text-[#5C5C63]">s</span>
                  </div>
                </div>
                <div className="bg-[#101012] px-4 py-3.5">
                  <div className="truncate font-mono text-[8.5px] uppercase tracking-[0.18em] text-[#5C5C63]">
                    achter · {f.gaps.behindName}
                  </div>
                  <div className="mt-1.5 font-mono text-[30px] font-semibold leading-none tabular-nums text-[#E7E5E4]">
                    {f.gaps.behind}
                    <span className="ml-1 text-[10px] font-normal text-[#5C5C63]">s</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end justify-between px-4 pb-3 pt-3.5">
                <div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-[#5C5C63]">snelheid</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
                      {f.telemetry.speedKph}
                    </span>
                    <span className="font-mono text-[9px] text-[#5C5C63]">km/u</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[22px] font-semibold leading-none" style={{ color: ORANGE_LIGHT }}>
                    G{f.telemetry.gear}
                  </div>
                  <div className="mt-1 font-mono text-[9px] tabular-nums text-[#5C5C63]">
                    {f.telemetry.rpm} rpm
                  </div>
                </div>
              </div>

              <div className="px-4 pb-3.5">
                <div className="flex items-baseline justify-between font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">
                  <span>laatste 5 ronden</span>
                  <span className="tabular-nums text-[#8A8A91]">
                    {lapTime(Math.min(...last5))} best
                  </span>
                </div>
                <div className="mt-1.5 flex h-9 items-end gap-1.5">
                  {last5.map((v, i) => {
                    const h = last5.length > 1 ? 24 + ((last5Max - v) / Math.max(0.001, last5Max - last5Min)) * 76 : 60;
                    return (
                      <span
                        key={i}
                        className="flex-1 rounded-[2px]"
                        style={{
                          height: `${h}%`,
                          background: i === last5.length - 1 ? ORANGE : "rgba(255,255,255,0.16)",
                          boxShadow: i === last5.length - 1 ? `0 0 10px ${ORANGE}55` : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mt-auto grid grid-cols-3 gap-px border-t border-white/[0.05] bg-white/[0.05]">
                <div className="bg-[#101012] px-3 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#5C5C63]">S1</div>
                  <div className="mt-1 font-mono text-[12px] tabular-nums text-[#D6D3D1]">{f.telemetry.s1}</div>
                </div>
                <div className="bg-[#101012] px-3 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#5C5C63]">S2</div>
                  <div className="mt-1 font-mono text-[12px] tabular-nums text-[#D6D3D1]">{f.telemetry.s2}</div>
                </div>
                <div className="bg-[#101012] px-3 py-2.5">
                  <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#5C5C63]">S3</div>
                  <div className="mt-1 font-mono text-[12px] tabular-nums text-[#D6D3D1]">{f.telemetry.s3}</div>
                </div>
                <div className="col-span-3 grid grid-cols-2 gap-px bg-white/[0.05]">
                  <div className="bg-[#101012] px-3 py-2.5">
                    <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#5C5C63]">laatste ronde</div>
                    <div className="mt-1 font-mono text-[13px] tabular-nums text-[#F5F5F4]">
                      {f.telemetry.lastLap}
                    </div>
                  </div>
                  <div className="bg-[#101012] px-3 py-2.5">
                    <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#5C5C63]">beste ronde</div>
                    <div className="mt-1 font-mono text-[13px] tabular-nums" style={{ color: ORANGE_LIGHT }}>
                      {f.telemetry.bestLap}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— PACE ————— */}
          <Panel className="lg:col-span-8" label="Pace" hint="laatste 20 ronden">
            <div className="flex flex-1 flex-col justify-between px-4 pb-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Rondetijden">
                <defs>
                  <linearGradient id="d11-pace-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ORANGE} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="d11-pace-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#9A3412" />
                    <stop offset="55%" stopColor={ORANGE} />
                    <stop offset="100%" stopColor={ORANGE_LIGHT} />
                  </linearGradient>
                </defs>

                {xTicks.map((i) => (
                  <line
                    key={`x${i}`}
                    x1={px(i)}
                    x2={px(i)}
                    y1={padY - 8}
                    y2={H - 24}
                    stroke="#232327"
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
                      stroke="#2A2A30"
                      strokeWidth="1"
                      strokeDasharray={i === 1 ? "2 5" : "4 6"}
                    />
                    <text
                      x={W - padX}
                      y={py(v) - 5}
                      textAnchor="end"
                      fill="#63636B"
                      fontSize="8.5"
                      fontFamily="ui-monospace, monospace"
                    >
                      {lapTime(v)}
                    </text>
                  </g>
                ))}

                <text x={padX + 2} y={py(paceAvg) - 5} fill="#4A4A52" fontSize="8" fontFamily="ui-monospace, monospace">
                  GEM
                </text>

                <path d={areaPath} fill="url(#d11-pace-fill)" />
                <polyline
                  points={points}
                  fill="none"
                  stroke="url(#d11-pace-line)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ filter: "drop-shadow(0 0 7px rgba(249,115,22,0.35))" }}
                />

                <g>
                  <circle cx={px(minIdx)} cy={py(paceMin)} r="4.5" fill={ORANGE} opacity="0.2" />
                  <circle cx={px(minIdx)} cy={py(paceMin)} r="2" fill={ORANGE_LIGHT} />
                  <text
                    x={px(minIdx)}
                    y={py(paceMin) - 9}
                    textAnchor="middle"
                    fill={ORANGE_LIGHT}
                    fontSize="8.5"
                    fontFamily="ui-monospace, monospace"
                  >
                    {lapTime(paceMin)}
                  </text>
                </g>

                <g>
                  <circle cx={px(pace.length - 1)} cy={py(paceLast)} r="5" fill={ORANGE} opacity="0.16" />
                  <circle cx={px(pace.length - 1)} cy={py(paceLast)} r="2.4" fill={ORANGE} />
                </g>

                {xTicks.map((i) => (
                  <text
                    key={`t${i}`}
                    x={px(i)}
                    y={H - 6}
                    textAnchor={i === 0 ? "start" : i === pace.length - 1 ? "end" : "middle"}
                    fill="#4A4A52"
                    fontSize="8.5"
                    fontFamily="ui-monospace, monospace"
                  >
                    R{firstLap + i}
                  </text>
                ))}
              </svg>

              <div className="mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.05]">
                <div className="bg-[#101012] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">gemiddelde</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[#E7E5E4]">{lapTime(paceAvg)}</div>
                </div>
                <div className="bg-[#101012] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">snelste</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums" style={{ color: ORANGE_LIGHT }}>
                    {lapTime(paceMin)}
                  </div>
                </div>
                <div className="bg-[#101012] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">laatste</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums" style={{ color: ORANGE }}>
                    {lapTime(paceLast)}
                  </div>
                </div>
                <div className="bg-[#101012] px-3 py-2">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">spreiding</div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[#A1A1A6]">
                    {paceSpread.toFixed(1)}
                    <span className="ml-0.5 text-[9px] text-[#5C5C63]">s</span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* ————— KLASSEMENT ————— */}
          <Panel className="lg:col-span-8" label="Klassement per klasse" hint={`na ronde ${f.event.lap}`}>
            <div className="flex-1 px-4 pb-4">
              {classes.map((cls, ci) => {
                const rows = f.standings
                  .filter((s) => s.cls === cls)
                  .slice()
                  .sort((a, b) => a.classPos - b.classPos);
                const isOwn = cls === f.self.cls;
                return (
                  <div key={cls} className={ci > 0 ? "mt-4" : ""}>
                    <div className="flex items-center gap-3 px-1 pb-2">
                      <span
                        className="font-mono text-[10px] font-semibold tracking-[0.24em]"
                        style={{ color: isOwn ? ORANGE_LIGHT : "#A1A1A6" }}
                      >
                        {cls}
                      </span>
                      {isOwn && (
                        <span
                          className="rounded px-1 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em]"
                          style={{ background: `${ORANGE}1a`, color: ORANGE_LIGHT }}
                        >
                          ONZE KLASSE
                        </span>
                      )}
                      <span
                        className="h-px flex-1"
                        style={{
                          background: `linear-gradient(90deg, ${isOwn ? `${ORANGE}55` : "#3F3F45"}, transparent)`,
                        }}
                      />
                      <span className="font-mono text-[9px] text-[#5C5C63]">{rows.length} auto&apos;s</span>
                    </div>

                    <div className="grid grid-cols-[26px_30px_1fr_68px_76px_78px_32px] items-center gap-2 px-2 pb-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#4A4A52]">
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
                        className="grid grid-cols-[26px_30px_1fr_68px_76px_78px_32px] items-center gap-2 border-t border-white/[0.04] px-2 py-[7px]"
                        style={
                          s.isSelf
                            ? {
                                background: "rgba(249,115,22,0.055)",
                                boxShadow: `inset 2px 0 0 0 ${ORANGE}`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className="font-mono text-[12px] font-semibold tabular-nums"
                          style={{ color: s.pos === 1 ? ORANGE_LIGHT : "#A1A1A6" }}
                        >
                          {s.pos}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-[#5C5C63]">{s.classPos}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-[12.5px] ${
                                s.isSelf ? "font-semibold text-white" : "font-medium text-[#E7E5E4]"
                              }`}
                            >
                              {s.driver}
                            </span>
                            {s.isSelf && (
                              <span
                                className="rounded px-1 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em]"
                                style={{ background: `${ORANGE}1f`, color: ORANGE_LIGHT }}
                              >
                                WIJ
                              </span>
                            )}
                            {s.inPit && (
                              <span
                                className="rounded border px-1 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em]"
                                style={{ borderColor: `${ORANGE}66`, color: ORANGE_LIGHT, background: `${ORANGE}12` }}
                              >
                                PIT
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[10px] text-[#5C5C63]">{s.car}</div>
                        </div>
                        <span
                          className="text-right font-mono text-[10.5px] tabular-nums"
                          style={{ color: s.gap === "LEIDER" ? ORANGE_LIGHT : "#A1A1A6" }}
                        >
                          {s.gap}
                        </span>
                        <span className="text-right font-mono text-[10.5px] tabular-nums text-[#E7E5E4]">
                          {s.lastLap}
                        </span>
                        <span className="text-right font-mono text-[10.5px] tabular-nums text-[#75757D]">
                          {s.bestLap}
                        </span>
                        <span className="text-right font-mono text-[10.5px] tabular-nums text-[#75757D]">
                          {s.tyreAgeLaps}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* ————— WISSEL + WEER ————— */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Panel className="flex-1" label="Coureurswissel" hint="stintplan" accent={ORANGE}>
              <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                <div className="relative pl-5">
                  <div
                    className="absolute bottom-3 left-[4px] top-3 w-px"
                    style={{ background: `linear-gradient(to bottom, ${ORANGE}80, rgba(255,255,255,0.08), transparent)` }}
                  />

                  <div className="relative pb-5">
                    <span
                      className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#101012]"
                      style={{ background: ORANGE, boxShadow: `0 0 10px ${ORANGE}` }}
                    />
                    <div className="font-mono text-[8px] uppercase tracking-[0.2em]" style={{ color: `${ORANGE_LIGHT}c0` }}>
                      nu
                    </div>
                    <div className="mt-1 text-[13px] font-semibold leading-tight text-white">{f.rotation.current}</div>
                  </div>

                  <div className="relative pb-5">
                    <span className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#101012] bg-[#3F3F45]" />
                    <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5C5C63]">volgende</div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium leading-tight text-[#E7E5E4]">{f.rotation.next}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#A1A1A6]">
                        +{f.rotation.nextInMinutes}
                        <span className="text-[8px] text-[#5C5C63]"> min</span>
                      </span>
                    </div>
                  </div>

                  <div className="relative">
                    <span className="absolute -left-5 top-[5px] h-2.5 w-2.5 rounded-full border-2 border-[#101012] bg-[#2B2B31]" />
                    <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5C5C63]">daarna</div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-[13px] leading-tight text-[#A1A1A6]">{f.rotation.after}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E76]">
                        +{f.rotation.afterInMinutes}
                        <span className="text-[8px] text-[#5C5C63]"> min</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel className="flex-1" label="Weer" hint="nacht" accent={ORANGE_LIGHT}>
              <div className="flex flex-1 flex-col justify-between px-4 pb-4">
                <div className="flex items-stretch gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <svg width="18" height="72" viewBox="0 0 18 72" fill="none" className="shrink-0">
                      <rect x="6" y="8" width="6" height="48" rx="3" fill="#1B1B1F" stroke="#2B2B31" />
                      <rect
                        x="7.5"
                        y={56 - 43 * trackTempPct}
                        width="3"
                        height={43 * trackTempPct}
                        rx="1.5"
                        fill={ORANGE}
                      />
                      <circle cx="9" cy="60" r="6.5" fill="#1B1B1F" stroke="#2B2B31" />
                      <circle cx="9" cy="60" r="4" fill={ORANGE} opacity="0.85" />
                      {[14, 24, 34, 44].map((y) => (
                        <line key={y} x1="14" x2="17" y1={y} y2={y} stroke="#3F3F45" strokeWidth="1" />
                      ))}
                    </svg>
                    <span className="font-mono text-[7px] uppercase tracking-[0.14em] text-[#4A4A52]">baan</span>
                  </div>

                  <div className="flex-1">
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.05]">
                      <div className="bg-[#101012] px-3 py-2.5">
                        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">lucht</div>
                        <div className="mt-1 font-mono text-[22px] font-semibold leading-none tabular-nums text-[#F5F5F4]">
                          {f.weather.airC.toFixed(1)}
                          <span className="text-[9px] font-normal text-[#5C5C63]">°C</span>
                        </div>
                      </div>
                      <div className="bg-[#101012] px-3 py-2.5">
                        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#5C5C63]">baan</div>
                        <div
                          className="mt-1 font-mono text-[22px] font-semibold leading-none tabular-nums"
                          style={{ color: ORANGE_LIGHT }}
                        >
                          {f.weather.trackC.toFixed(1)}
                          <span className="text-[9px] font-normal text-[#5C5C63]">°C</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 font-mono text-[8.5px] tabular-nums text-[#4A4A52]">
                      baan {(f.weather.trackC - f.weather.airC).toFixed(1)}° warmer dan lucht
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
                  <div>
                    <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[#5C5C63]">rubber</div>
                    <div className="mt-1 text-[11.5px] text-[#D6D3D1]">{rubberLabel(f.weather.rubber)}</div>
                    <div className="mt-0.5 text-[10px] text-[#5C5C63]">droog · geen regen verwacht</div>
                  </div>
                  <div className="flex items-end gap-[3px] pb-1">
                    {[4, 7, 5, 9, 6, 3].map((h, i) => (
                      <span
                        key={i}
                        className="w-[3px] rounded-sm"
                        style={{
                          height: h * 2,
                          background: i < 3 ? "rgba(249,115,22,0.6)" : "rgba(255,255,255,0.09)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[#4A4A52]">
          <span className="flex items-center gap-2">
            <Stripes />
            3SM Pitwall · ontwerp 11 — endurance night
          </span>
          <span>
            {f.event.circuit} · {f.event.timeLeft} te gaan
          </span>
        </footer>
      </main>
    </div>
  );
}
