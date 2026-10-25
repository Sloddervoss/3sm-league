/**
 * Ontwerp 09 — RETRO 80s RACING.
 *
 * Zonsondergang-gradient, chroom-achtige randen, neonroze en oranje, fijne
 * gridlijnen. Koppen staan schuin en cursief; alle cijfers blijven rechtop,
 * tabulair en hoog contrast — de sfeer mag de data nooit in de weg zitten.
 *
 * Databron: alles komt uit de `f`-prop (PitwallFixture). Geen imports uit de
 * bestaande pitwall-map, geen externe libraries: alleen React, Tailwind en
 * inline SVG.
 */
import type { CSSProperties, ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "Retro 80s Racing",
  note: "Zonsondergang, chroom en neon — cijfers blijven strak",
};

const PINK = "#ff2d95";
const ORANGE = "#ff7a1a";
const AMBER = "#ffc857";
const CREAM = "#fff4e3";
const CYAN = "#57e6ff";
const GREEN = "#2ee08a";

/* ------------------------------------------------------------------ */
/* Stijlconstanten                                                     */
/* ------------------------------------------------------------------ */

/** Koppen: zware, schuine raceletters. */
const raceHead: CSSProperties = {
  fontFamily: "'Exo 2', 'Arial Black', Impact, sans-serif",
  fontStyle: "italic",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.015em",
  lineHeight: 0.95,
};

/** Labeltekst: klein, wijd gespatieerd. */
const label: CSSProperties = {
  fontFamily: "'Rajdhani', 'Arial Narrow', sans-serif",
  fontVariantNumeric: "tabular-nums",
};

/** Cijfers: rechtop, tabulair, nooit cursief. */
const mono: CSSProperties = {
  fontFamily: "'Exo 2', ui-monospace, SFMono-Regular, monospace",
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

const chromeEdge =
  "linear-gradient(160deg,#ffffff 0%,#c6d2e6 14%,#5f6c86 30%,#e9f0ff 46%,#95a2ba 62%,#f2f6ff 78%,#6e7b95 100%)";

const chromePlate =
  "linear-gradient(180deg,#ffffff 0%,#dbe6f7 26%,#7c8aa2 48%,#f4f8ff 58%,#a6b4ca 78%,#ffffff 100%)";

/* ------------------------------------------------------------------ */
/* Hulpjes                                                             */
/* ------------------------------------------------------------------ */

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Nederlands decimaalteken voor getallen die we zelf formatteren. */
const nl = (n: number, d = 1) => n.toFixed(d).replace(".", ",");

/** Seconden -> m:ss.s (voor de pace-as). */
const lapClock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/** Hoe heter de band, hoe heter de kleur. */
const heat = (wear: number) => (wear >= 95 ? PINK : wear >= 94 ? ORANGE : AMBER);

const verdict: Record<
  PitwallFixture["pit"]["recommendation"],
  { label: string; hint: string; tone: string }
> = {
  STAY_OUT: { label: "Blijf buiten", hint: "Geen stop nodig", tone: GREEN },
  PIT_SOON: { label: "Stop binnenkort", hint: "Bereid de stop voor", tone: AMBER },
  PIT_NOW: { label: "Nu binnen", hint: "Box nu", tone: PINK },
};

/* ------------------------------------------------------------------ */
/* Bouwstenen                                                          */
/* ------------------------------------------------------------------ */

function ChromeFrame({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`relative ${className}`}
      style={{
        padding: 1.5,
        background: chromeEdge,
        boxShadow: glow
          ? `0 0 28px -8px ${PINK}, 0 18px 40px -26px #000`
          : "0 16px 34px -26px #000",
      }}
    >
      <div
        className="relative h-full overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(28,11,42,.97) 0%, rgba(13,5,22,.98) 100%)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,244,227,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,244,227,.045) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative h-full">{children}</div>
      </div>
    </div>
  );
}

function Hazard({
  className = "",
  tone = PINK,
}: {
  className?: string;
  tone?: string;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        backgroundImage: `repeating-linear-gradient(115deg, ${tone} 0 7px, rgba(0,0,0,.45) 7px 14px)`,
        opacity: 0.75,
      }}
    />
  );
}

function PanelHead({
  kicker,
  title,
  right,
}: {
  kicker: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-white/10 px-3 pb-2 pt-2.5">
      <div className="min-w-0">
        <div
          className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/40"
          style={label}
        >
          {kicker}
        </div>
        <h2
          className="truncate text-[17px] sm:text-[18px]"
          style={{ ...raceHead, color: CREAM, textShadow: "0 0 18px rgba(255,45,149,.3)" }}
        >
          {title}
        </h2>
      </div>
      {right ? <div className="shrink-0 text-right">{right}</div> : null}
    </div>
  );
}

function Chip({
  children,
  tone = CREAM,
  solid = false,
}: {
  children: ReactNode;
  tone?: string;
  solid?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[2px] text-[8px] font-bold uppercase tracking-[0.18em]"
      style={{
        fontFamily: "'Rajdhani', sans-serif",
        color: solid ? "#170a24" : tone,
        background: solid ? tone : "transparent",
        boxShadow: solid ? "none" : `inset 0 0 0 1px ${tone}66`,
      }}
    >
      {children}
    </span>
  );
}

function Stat({
  label: lbl,
  value,
  unit,
  tone = CREAM,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="bg-black/35 px-2 py-1.5 ring-1 ring-white/10">
      <div
        className="text-[9px] uppercase tracking-[0.2em] text-white/40"
        style={label}
      >
        {lbl}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="text-[20px] leading-tight"
          style={{ ...mono, fontWeight: 700, color: tone }}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[10px] text-white/40" style={label}>
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GapCard({
  lbl,
  name,
  value,
  tone,
}: {
  lbl: string;
  name: string;
  value: string;
  tone: string;
}) {
  return (
    <div
      className="relative overflow-hidden bg-black/35 px-2.5 py-2"
      style={{ boxShadow: `inset 0 0 0 1px ${tone}44` }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] uppercase tracking-[0.26em] text-white/40"
          style={label}
        >
          {lbl}
        </span>
        <span
          aria-hidden
          className="h-1.5 w-1.5"
          style={{ background: tone }}
        />
      </div>
      <div
        className="mt-1 text-[26px] leading-none"
        style={{ ...mono, fontWeight: 700, color: tone }}
      >
        {value}
      </div>
      <div
        className="mt-1 truncate text-[11px] text-white/55"
        style={label}
      >
        {name}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Achtergrond                                                         */
/* ------------------------------------------------------------------ */

function Sun() {
  const stripes = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const y = 300 + i * 23;
    const h = 4 + i * 2.4;
    return <rect key={i} x="0" y={y} width="600" height={h} fill="#000" />;
  });

  return (
    <svg viewBox="0 0 600 600" className="h-auto w-full" aria-hidden>
      <defs>
        <linearGradient id="d09-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="42%" stopColor="#ffb13c" />
          <stop offset="74%" stopColor="#ff4f8b" />
          <stop offset="100%" stopColor="#b81f74" />
        </linearGradient>
        <radialGradient id="d09-halo">
          <stop offset="0%" stopColor="#ff5fa2" stopOpacity="0.5" />
          <stop offset="68%" stopColor="#ff2d95" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ff2d95" stopOpacity="0" />
        </radialGradient>
        <mask id="d09-sunmask">
          <rect width="600" height="600" fill="#fff" />
          {stripes}
        </mask>
      </defs>
      <circle cx="300" cy="300" r="299" fill="url(#d09-halo)" />
      <g mask="url(#d09-sunmask)">
        <circle cx="300" cy="300" r="212" fill="url(#d09-sun)" />
      </g>
    </svg>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg,#07030d 0%,#150726 20%,#3a0b3c 42%,#77124f 60%,#b81f52 74%,#e8552f 87%,#ff9a3c 100%)",
        }}
      />
      <div className="absolute left-1/2 top-[16%] w-[min(80vw,720px)] -translate-x-1/2 opacity-50 sm:top-[10%]">
        <Sun />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-[48vh]"
        style={{
          backgroundImage: `linear-gradient(180deg, transparent 0%, rgba(255,45,149,.12) 32%, rgba(255,45,149,.24) 100%), repeating-linear-gradient(90deg, rgba(255,45,149,.55) 0 1px, transparent 1px 68px), repeating-linear-gradient(0deg, rgba(255,45,149,.45) 0 1px, transparent 1px 68px)`,
          transform: "perspective(340px) rotateX(72deg)",
          transformOrigin: "top center",
          maskImage: "linear-gradient(180deg, transparent 0%, #000 45%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 45%)",
          opacity: 0.5,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 85% at 50% -5%, transparent 38%, rgba(5,2,10,.86) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,.26) 0 1px, transparent 1px 3px)",
          opacity: 0.32,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kop                                                                 */
/* ------------------------------------------------------------------ */

function Header({ f }: { f: PitwallFixture }) {
  const pct = clamp((f.event.lap / f.event.totalLaps) * 100);
  const green = f.event.flag.toLowerCase().startsWith("groen");

  return (
    <header className="relative">
      <div
        className="h-[3px] w-full"
        style={{
          background:
            "linear-gradient(90deg,#7d8aa3,#fff,#c6d2e6,#5f6c86,#fff,#7d8aa3)",
        }}
      />

      <div className="flex flex-col gap-4 px-1 pt-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex items-end gap-[3px]">
              {[PINK, ORANGE, CREAM].map((c, i) => (
                <span
                  key={c}
                  className="block w-[4px]"
                  style={{
                    height: 12 + i * 4,
                    background: c,
                    transform: "skewX(-16deg)",
                    boxShadow: `0 0 10px ${c}`,
                  }}
                />
              ))}
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.42em] text-white/60"
              style={label}
            >
              3SM Pitwall
            </span>
            <span
              className="ml-1 hidden items-center gap-1.5 text-[9px] uppercase tracking-[0.3em] text-white/40 sm:flex"
              style={label}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ background: PINK }}
              />
              live
            </span>
          </div>

          <h1
            className="mt-2 text-[34px] sm:text-[48px] lg:text-[58px]"
            style={{
              ...raceHead,
              transform: "skewX(-7deg)",
              transformOrigin: "left bottom",
              background: chromePlate,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter:
                "drop-shadow(3px 3px 0 rgba(9,3,16,.92)) drop-shadow(0 0 26px rgba(255,45,149,.35))",
            }}
          >
            {f.event.name}
          </h1>

          <p
            className="mt-1 text-[11px] uppercase tracking-[0.26em] text-white/55"
            style={label}
          >
            {f.event.circuit}
          </p>
        </div>

        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3 lg:gap-6">
          <div className="text-right">
            <div
              className="text-[9px] uppercase tracking-[0.3em] text-white/40"
              style={label}
            >
              Vlag
            </div>
            <div
              className="mt-1 flex items-center justify-end gap-1.5 px-2 py-1"
              style={{
                background: green ? "rgba(46,224,138,.12)" : "rgba(255,200,87,.12)",
                boxShadow: `inset 0 0 0 1px ${green ? "rgba(46,224,138,.45)" : "rgba(255,200,87,.45)"}`,
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse"
                style={{ background: green ? GREEN : AMBER }}
              />
              <span
                className="text-[12px] font-bold uppercase tracking-[0.18em]"
                style={{ ...label, color: green ? "#7cf3b8" : AMBER }}
              >
                {f.event.flag}
              </span>
            </div>
          </div>

          <div className="text-right">
            <div
              className="text-[9px] uppercase tracking-[0.3em] text-white/40"
              style={label}
            >
              Nog te gaan
            </div>
            <div
              className="text-[20px] leading-none sm:text-[30px]"
              style={{
                ...mono,
                fontWeight: 700,
                color: CREAM,
                textShadow: "0 0 22px rgba(255,122,26,.45)",
              }}
            >
              {f.event.timeLeft}
            </div>
          </div>

          <div className="text-right">
            <div
              className="text-[9px] uppercase tracking-[0.3em] text-white/40"
              style={label}
            >
              Ronde
            </div>
            <div className="flex items-baseline justify-end gap-1">
              <span
                className="text-[20px] leading-none sm:text-[30px]"
                style={{ ...mono, fontWeight: 700, color: CREAM }}
              >
                {f.event.lap}
              </span>
              <span className="text-[11px] text-white/45" style={label}>
                / {f.event.totalLaps}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 px-1">
        <div
          className="relative h-[10px] w-full overflow-hidden"
          style={{
            background: "rgba(255,255,255,.08)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${ORANGE}, ${PINK})`,
              boxShadow: `0 0 18px ${PINK}`,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(8,4,15,.6) 0 1px, transparent 1px 10%)",
            }}
          />
        </div>
        <div
          className="mt-1 flex justify-between text-[9px] uppercase tracking-[0.24em] text-white/35"
          style={label}
        >
          <span>start</span>
          <span style={{ color: AMBER }}>{Math.round(pct)}% afgelegd</span>
          <span>finish</span>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Positie & gaten                                                     */
/* ------------------------------------------------------------------ */

function PositionPanel({ f }: { f: PitwallFixture }) {
  return (
    <ChromeFrame className="lg:col-span-5" glow>
      <PanelHead
        kicker="Positie & gaten"
        title="Waar sta je"
        right={
          <div className="flex gap-1">
            <Chip tone={PINK} solid>
              {f.self.cls}
            </Chip>
            <Chip tone={CREAM}>{f.self.car.split(" ")[0]}</Chip>
          </div>
        }
      />

      <div className="px-3 py-3">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <div className="flex items-baseline">
              <span className="text-[13px] text-white/45" style={label}>
                P
              </span>
              <span
                className="text-[64px] leading-[0.78]"
                style={{ ...mono, fontWeight: 700, color: CREAM }}
              >
                {f.self.pos}
              </span>
            </div>
            <div
              className="mt-1 text-[11px] uppercase tracking-[0.2em]"
              style={{ ...label, color: PINK }}
            >
              P{f.self.classPos} in {f.self.cls}
            </div>
          </div>

          <div className="min-w-0 flex-1 border-l border-white/10 pl-3">
            <div
              className="truncate text-[15px]"
              style={{ ...raceHead, color: CREAM }}
            >
              {f.self.driver}
            </div>
            <div className="truncate text-[11px] text-white/50" style={label}>
              {f.self.team}
            </div>
            <div className="truncate text-[11px] text-white/35" style={label}>
              {f.self.car}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <GapCard
            lbl="Voor"
            name={f.gaps.aheadName}
            value={f.gaps.ahead}
            tone={ORANGE}
          />
          <GapCard
            lbl="Achter"
            name={f.gaps.behindName}
            value={f.gaps.behind}
            tone={CYAN}
          />
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Telemetrie                                                          */
/* ------------------------------------------------------------------ */

function TelemetryPanel({ f }: { f: PitwallFixture }) {
  const rpmSegments = 10;
  const litSegments = Math.round((f.telemetry.rpm / 1000) * 1);
  const sectors = ["s1", "s2", "s3"] as const;

  return (
    <ChromeFrame className="lg:col-span-3">
      <PanelHead kicker="Telemetrie" title="Nu aan boord" />
      <div className="px-3 py-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div
              className="text-[9px] uppercase tracking-[0.28em] text-white/40"
              style={label}
            >
              Snelheid
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="text-[42px] leading-none"
                style={{ ...mono, fontWeight: 700, color: CREAM }}
              >
                {f.telemetry.speedKph}
              </span>
              <span className="text-[10px] text-white/40" style={label}>
                km/u
              </span>
            </div>
          </div>

          <div className="text-center">
            <div
              className="text-[9px] uppercase tracking-[0.28em] text-white/40"
              style={label}
            >
              Versn.
            </div>
            <div
              className="mt-1 flex h-11 w-11 items-center justify-center text-[22px]"
              style={{
                ...mono,
                fontWeight: 700,
                color: "#170a24",
                background: chromePlate,
                clipPath: "polygon(0 0,100% 0,100% 72%,50% 100%,0 72%)",
              }}
            >
              {f.telemetry.gear}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-[3px]">
          {Array.from({ length: rpmSegments }).map((_, i) => {
            const on = i < litSegments;
            const tone = i >= 8 ? PINK : i >= 6 ? ORANGE : AMBER;
            return (
              <span
                key={i}
                className="h-3 flex-1"
                style={{
                  background: on ? tone : "rgba(255,255,255,.08)",
                  boxShadow: on ? `0 0 8px ${tone}88` : "none",
                }}
              />
            );
          })}
        </div>
        <div
          className="mt-1 flex justify-between text-[9px] uppercase tracking-[0.2em] text-white/30"
          style={label}
        >
          <span>rpm</span>
          <span style={{ color: "rgba(255,244,227,.7)" }}>
            {f.telemetry.rpm.toLocaleString("nl-NL")}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {sectors.map((k) => (
            <div key={k} className="bg-black/35 px-2 py-1.5 ring-1 ring-white/10">
              <div
                className="text-[9px] uppercase tracking-[0.22em] text-white/35"
                style={label}
              >
                {k.toUpperCase()}
              </div>
              <div
                className="text-[14px] leading-tight"
                style={{ ...mono, fontWeight: 600, color: CREAM }}
              >
                {f.telemetry[k]}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 divide-y divide-white/5 border-t border-white/10">
          <div className="flex items-baseline justify-between pt-1.5">
            <span
              className="text-[9px] uppercase tracking-[0.24em] text-white/35"
              style={label}
            >
              Laatste
            </span>
            <span
              className="text-[13px]"
              style={{ ...mono, fontWeight: 600, color: CREAM }}
            >
              {f.telemetry.lastLap}
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1.5">
            <span
              className="text-[9px] uppercase tracking-[0.24em] text-white/35"
              style={label}
            >
              Beste
            </span>
            <span
              className="text-[13px]"
              style={{ ...mono, fontWeight: 600, color: CYAN }}
            >
              {f.telemetry.bestLap}
            </span>
          </div>
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Beslissing                                                          */
/* ------------------------------------------------------------------ */

function DecisionPanel({ f }: { f: PitwallFixture }) {
  const v = verdict[f.pit.recommendation];
  const emptyLap = f.event.lap + f.fuel.lapsLeft;

  return (
    <ChromeFrame className="lg:col-span-4" glow>
      <Hazard className="h-[6px] w-full" tone={v.tone} />
      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] uppercase tracking-[0.34em] text-white/40"
            style={label}
          >
            Beslissing
          </span>
          <span
            className="inline-block h-2 w-2 animate-pulse"
            style={{ background: v.tone, boxShadow: `0 0 12px ${v.tone}` }}
          />
        </div>

        <div
          className="mt-2 text-[26px] sm:text-[30px]"
          style={{
            ...raceHead,
            color: v.tone,
            textShadow: `0 0 30px ${v.tone}55`,
          }}
        >
          {v.label}
        </div>
        <div
          className="mt-1 text-[9px] uppercase tracking-[0.24em] text-white/35"
          style={label}
        >
          {v.hint}
        </div>

        <p className="mt-2 text-[14px] leading-snug text-white/85">
          {f.pit.reason}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Pitwindow"
            value={String(f.pit.windowInLaps)}
            unit="ronden"
            tone={AMBER}
          />
          <Stat
            label="Pitverlies"
            value={String(f.pit.pitLossSeconds)}
            unit="sec"
            tone={ORANGE}
          />
        </div>

        <div
          className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[9px] uppercase tracking-[0.2em]"
          style={label}
        >
          <span className="text-white/35">Tank leeg</span>
          <span style={{ color: CREAM }}>&asymp; ronde {emptyLap}</span>
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Bandenkruis                                                         */
/* ------------------------------------------------------------------ */

function TyreCard({
  code,
  hint,
  corner,
}: {
  code: string;
  hint: string;
  corner: PitwallFixture["tyres"]["fl"];
}) {
  const tone = heat(corner.wear);
  return (
    <div
      className="relative overflow-hidden bg-black/40 px-2.5 py-2"
      style={{ boxShadow: `inset 0 0 0 1px ${tone}3d, inset 0 0 26px -18px ${tone}` }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ ...label, color: CREAM }}
        >
          {code}
        </span>
        <span className="text-[11px] text-white/50" style={label}>
          {corner.tempC}&deg;C
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className="text-[24px] leading-none"
          style={{ ...mono, fontWeight: 700, color: tone }}
        >
          {nl(corner.wear, 1)}
        </span>
        <span className="text-[10px] text-white/35" style={label}>
          %
        </span>
      </div>
      <div
        className="mt-2 h-[6px] w-full overflow-hidden"
        style={{ background: "rgba(255,255,255,.1)" }}
      >
        <div
          className="h-full"
          style={{
            width: `${clamp(corner.wear)}%`,
            background: `linear-gradient(90deg, ${AMBER}, ${tone})`,
          }}
        />
      </div>
      <div
        className="mt-1 text-[9px] uppercase tracking-[0.18em] text-white/30"
        style={label}
      >
        {hint}
      </div>
    </div>
  );
}

function TyreCross({ f }: { f: PitwallFixture }) {
  const t = f.tyres;
  return (
    <ChromeFrame className="lg:col-span-5">
      <PanelHead
        kicker="Banden"
        title="Kruis"
        right={<Chip tone={AMBER}>{t.compound}</Chip>}
      />
      <div className="px-3 py-3">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1fr_minmax(112px,0.85fr)_1fr] sm:grid-rows-2">
          <div className="sm:col-start-1 sm:row-start-1">
            <TyreCard code="LV" hint="links voor" corner={t.fl} />
          </div>
          <div className="sm:col-start-3 sm:row-start-1">
            <TyreCard code="RV" hint="rechts voor" corner={t.fr} />
          </div>

          <div
            className="col-span-2 flex flex-col items-center justify-center bg-[#0c0617]/80 px-2 py-3 text-center ring-1 ring-white/10 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1"
          >
            <span
              className="text-[8px] uppercase tracking-[0.26em] text-white/35"
              style={label}
            >
              Compound
            </span>
            <span style={{ ...raceHead, fontSize: 15, color: CREAM }}>
              {t.compound}
            </span>

            <div
              className="my-1.5 flex h-12 w-12 items-center justify-center"
              style={{
                background:
                  "conic-gradient(from 200deg,#fff,#8b98b0 30%,#fff 55%,#5f6c86 78%,#fff)",
              }}
            >
              <span
                className="flex h-[42px] w-[42px] items-center justify-center text-[19px]"
                style={{
                  fontFamily: "'Exo 2', sans-serif",
                  fontWeight: 800,
                  color: "#170a24",
                  background: chromePlate,
                  clipPath: "polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)",
                }}
              >
                {t.grade}
              </span>
            </div>
            <span
              className="text-[8px] uppercase tracking-[0.26em] text-white/35"
              style={label}
            >
              Grade
            </span>

            <div
              className="my-1.5 h-px w-10"
              style={{
                background: "linear-gradient(90deg,transparent,#fff8,transparent)",
              }}
            />

            <span
              className="text-[19px] leading-none"
              style={{ ...mono, fontWeight: 700, color: CREAM }}
            >
              {t.setLaps}
            </span>
            <span
              className="text-[8px] uppercase tracking-[0.22em] text-white/35"
              style={label}
            >
              ronden oud
            </span>
            <span
              className="mt-1 text-[10px]"
              style={{ ...label, color: AMBER }}
            >
              {nl(t.wearRange[0], 1)}&ndash;{nl(t.wearRange[1], 1)} %/r
            </span>
          </div>

          <div className="sm:col-start-1 sm:row-start-2">
            <TyreCard code="LA" hint="links achter" corner={t.rl} />
          </div>
          <div className="sm:col-start-3 sm:row-start-2">
            <TyreCard code="RA" hint="rechts achter" corner={t.rr} />
          </div>
        </div>

        <p className="mt-2 text-[10px] leading-snug text-white/35">{t.note}</p>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Brandstof                                                           */
/* ------------------------------------------------------------------ */

function FuelPanel({ f }: { f: PitwallFixture }) {
  const pct = clamp((f.fuel.litres / f.fuel.tankLitres) * 100);
  const segments = 16;

  return (
    <ChromeFrame className="lg:col-span-4">
      <PanelHead
        kicker="Brandstof"
        title="Tank & stint"
        right={
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40" style={label}>
            {Math.round(pct)}% vol
          </span>
        }
      />
      <div className="px-3 py-3">
        <div className="flex items-end justify-between">
          <div>
            <div
              className="text-[9px] uppercase tracking-[0.26em] text-white/40"
              style={label}
            >
              In de tank
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="text-[38px] leading-none"
                style={{ ...mono, fontWeight: 700, color: CREAM }}
              >
                {nl(f.fuel.litres, 1)}
              </span>
              <span className="text-[12px] text-white/45" style={label}>
                L
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[9px] uppercase tracking-[0.26em] text-white/40"
              style={label}
            >
              Rondes over
            </div>
            <div
              className="text-[38px] leading-none"
              style={{ ...mono, fontWeight: 700, color: AMBER }}
            >
              {f.fuel.lapsLeft}
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-[3px]">
          {Array.from({ length: segments }).map((_, i) => {
            const on = ((i + 0.5) / segments) * 100 <= pct;
            const tone = i < 3 ? PINK : i < 6 ? ORANGE : AMBER;
            return (
              <span
                key={i}
                className="h-4 flex-1"
                style={{
                  background: on ? tone : "rgba(255,255,255,.08)",
                  boxShadow: on ? `0 0 8px ${tone}66` : "none",
                }}
              />
            );
          })}
        </div>
        <div
          className="mt-1 flex justify-between text-[9px] uppercase tracking-[0.2em] text-white/30"
          style={label}
        >
          <span>leeg</span>
          <span>
            {nl(f.fuel.litres, 1)} / {f.fuel.tankLitres} L
          </span>
          <span>vol</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Per ronde"
            value={nl(f.fuel.perLap, 2)}
            unit="L"
            tone={CREAM}
          />
          <Stat label="Tank" value={String(f.fuel.tankLitres)} unit="L" />
          <Stat
            label="Bijtanken"
            value={nl(f.fuel.toAddLitres, 1)}
            unit="L"
            tone={ORANGE}
          />
          <Stat
            label="Tot finish"
            value={nl(f.fuel.toFinishLitres, 2)}
            unit="L"
            tone={AMBER}
          />
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Weer                                                                */
/* ------------------------------------------------------------------ */

function WeatherPanel({ f }: { f: PitwallFixture }) {
  const delta = f.weather.trackC - f.weather.airC;
  const gauge = clamp((f.weather.trackC / 40) * 100);

  return (
    <ChromeFrame className="lg:col-span-3">
      <PanelHead kicker="Weer" title="Omstandigheden" />
      <div className="px-3 py-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Lucht" value={nl(f.weather.airC, 1)} unit="°C" tone={CYAN} />
          <Stat label="Baan" value={nl(f.weather.trackC, 1)} unit="°C" tone={ORANGE} />
        </div>

        <div className="mt-3">
          <div
            className="flex items-baseline justify-between text-[9px] uppercase tracking-[0.2em] text-white/35"
            style={label}
          >
            <span>baantemperatuur</span>
            <span style={{ color: AMBER }}>+{nl(delta, 1)} &deg;C</span>
          </div>
          <div
            className="mt-1 h-2 w-full overflow-hidden"
            style={{ background: "rgba(255,255,255,.1)" }}
          >
            <div
              className="h-full"
              style={{
                width: `${gauge}%`,
                background: `linear-gradient(90deg, ${CYAN}, ${AMBER}, ${PINK})`,
              }}
            />
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-2">
          <div
            className="text-[9px] uppercase tracking-[0.26em] text-white/35"
            style={label}
          >
            Rubber
          </div>
          <div className="text-[13px] leading-snug" style={{ color: CREAM }}>
            {f.weather.rubber}
          </div>
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Pace-grafiek                                                        */
/* ------------------------------------------------------------------ */

function PaceChart({ f }: { f: PitwallFixture }) {
  const data = f.pace;
  const n = data.length;

  if (n < 2) {
    return (
      <div className="px-3 py-6 text-[12px] text-white/40" style={label}>
        Geen pace-data.
      </div>
    );
  }

  const W = 780;
  const H = 250;
  const padT = 16;
  const padR = 14;
  const padB = 30;
  const padL = 56;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(0.4, max - min);
  const lo = min - span * 0.28;
  const hi = max + span * 0.28;

  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + ((v - lo) / (hi - lo)) * (H - padT - padB);

  const pts: Array<[number, number]> = data.map((v, i) => [x(i), y(v)]);
  const line = pts
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${padL.toFixed(
    1,
  )},${(H - padB).toFixed(1)} Z`;

  const avg = data.reduce((a, b) => a + b, 0) / n;
  const last = data[n - 1];
  const bestIdx = data.indexOf(min);
  const avgY = y(avg);
  const gridRows = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Rondetijden van de laatste ${n} ronden`}
    >
      <defs>
        <linearGradient id="d09-pace-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PINK} stopOpacity="0.42" />
          <stop offset="55%" stopColor={ORANGE} stopOpacity="0.14" />
          <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="d09-pace-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={ORANGE} />
          <stop offset="55%" stopColor={PINK} />
          <stop offset="100%" stopColor="#ff9ad4" />
        </linearGradient>
      </defs>

      {gridRows.map((fr) => {
        const value = lo + fr * (hi - lo);
        const gy = padT + fr * (H - padT - padB);
        return (
          <g key={fr}>
            <line
              x1={padL}
              x2={W - padR}
              y1={gy}
              y2={gy}
              stroke="rgba(255,244,227,.14)"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
            <text
              x={padL - 8}
              y={gy + 3.5}
              textAnchor="end"
              fontSize="11"
              fill="rgba(255,244,227,.42)"
              style={{ fontFamily: "'Exo 2', sans-serif", fontVariantNumeric: "tabular-nums" }}
            >
              {lapClock(value)}
            </text>
          </g>
        );
      })}

      {[0, 5, 10, 15].map((step) => {
        if (step >= n) return null;
        const i = n - 1 - step;
        return (
          <line
            key={step}
            x1={x(i)}
            x2={x(i)}
            y1={padT}
            y2={H - padB}
            stroke="rgba(255,244,227,.08)"
            strokeWidth="1"
          />
        );
      })}

      <path d={area} fill="url(#d09-pace-fill)" />
      <path
        d={line}
        fill="none"
        stroke="url(#d09-pace-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <line
        x1={padL}
        x2={W - padR}
        y1={avgY}
        y2={avgY}
        stroke={AMBER}
        strokeWidth="1"
        strokeDasharray="6 5"
        opacity="0.8"
      />
      <text
        x={W - padR}
        y={avgY - 6}
        textAnchor="end"
        fontSize="10"
        fill={AMBER}
        style={{ fontFamily: "'Rajdhani', sans-serif", letterSpacing: 1 }}
      >
        GEM {lapClock(avg)}
      </text>

      {pts.map(([px, py], i) => (
        <circle
          key={i}
          cx={px}
          cy={py}
          r={i === n - 1 ? 4 : 2.2}
          fill={i === n - 1 ? CREAM : "rgba(255,244,227,.65)"}
          stroke={i === n - 1 ? PINK : "none"}
          strokeWidth={i === n - 1 ? 2 : 0}
        />
      ))}

      <circle
        cx={x(bestIdx)}
        cy={y(min)}
        r="7"
        fill="none"
        stroke={CYAN}
        strokeWidth="1.5"
        opacity="0.85"
      />

      <circle
        cx={x(n - 1)}
        cy={y(last)}
        r="10"
        fill="none"
        stroke={CREAM}
        strokeWidth="1"
        opacity="0.18"
      />

      <text
        x={padL}
        y={H - 8}
        fontSize="10"
        fill="rgba(255,244,227,.35)"
        style={{ fontFamily: "'Rajdhani', sans-serif", letterSpacing: 1.4 }}
      >
        −{n - 1} RONDEN
      </text>
      <text
        x={W - padR}
        y={H - 8}
        textAnchor="end"
        fontSize="10"
        fill="rgba(255,244,227,.35)"
        style={{ fontFamily: "'Rajdhani', sans-serif", letterSpacing: 1.4 }}
      >
        NU
      </text>
    </svg>
  );
}

function PacePanel({ f }: { f: PitwallFixture }) {
  const n = f.pace.length;
  const min = n ? Math.min(...f.pace) : 0;
  const avg = n ? f.pace.reduce((a, b) => a + b, 0) / n : 0;
  const last = n ? f.pace[n - 1] : 0;

  return (
    <ChromeFrame className="lg:col-span-7">
      <PanelHead
        kicker={`Pace · laatste ${n} ronden`}
        title="Rondetijden"
        right={
          <div className="flex items-center gap-2 text-right">
            <div>
              <div className="text-[8px] uppercase tracking-[0.2em] text-white/35" style={label}>
                Snelste
              </div>
              <div className="text-[12px]" style={{ ...mono, fontWeight: 600, color: CYAN }}>
                {lapClock(min)}
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <div className="text-[8px] uppercase tracking-[0.2em] text-white/35" style={label}>
                Laatste
              </div>
              <div className="text-[12px]" style={{ ...mono, fontWeight: 600, color: CREAM }}>
                {lapClock(last)}
              </div>
            </div>
          </div>
        }
      />
      <div className="px-1.5 py-2">
        <PaceChart f={f} />
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-3 py-1.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/35" style={label}>
          Snelste ronde
        </span>
        <span className="text-[10px] text-white/55" style={label}>
          gemiddeld {lapClock(avg)} · laatste {last > min ? "+" : ""}
          {nl(last - min, 1)} s t.o.v. snelste
        </span>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Coureurswissel                                                      */
/* ------------------------------------------------------------------ */

function RotationRow({
  tag,
  name,
  note,
  tone,
}: {
  tag: string;
  name: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-white/5 py-2 last:border-0">
      <span
        className="w-1 self-stretch"
        style={{ background: tone, boxShadow: `0 0 10px ${tone}` }}
      />
      <div className="min-w-0 flex-1 pl-1">
        <div
          className="text-[8px] uppercase tracking-[0.28em] text-white/35"
          style={label}
        >
          {tag}
        </div>
        <div className="truncate text-[15px]" style={{ ...raceHead, color: CREAM }}>
          {name}
        </div>
      </div>
      <span className="shrink-0 text-[11px]" style={{ ...label, color: tone }}>
        {note}
      </span>
    </div>
  );
}

function RotationPanel({ f }: { f: PitwallFixture }) {
  const total = Math.max(1, f.rotation.afterInMinutes);
  const split = clamp((f.rotation.nextInMinutes / total) * 100);

  return (
    <ChromeFrame className="lg:col-span-5">
      <PanelHead
        kicker="Coureurswissel"
        title="Wie rijdt wanneer"
        right={<Chip tone={GREEN}>2 wissels</Chip>}
      />
      <div className="px-3 py-3">
        <div className="relative h-3 w-full" style={{ background: "rgba(255,255,255,.08)" }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: `${split}%`, background: `linear-gradient(90deg, ${PINK}, ${ORANGE})` }}
          />
          <div
            className="absolute inset-y-0"
            style={{
              left: `${split}%`,
              right: 0,
              background: "linear-gradient(90deg, rgba(255,200,87,.9), rgba(255,244,227,.3))",
            }}
          />
          <div
            className="absolute inset-y-[-4px] w-px bg-white/70"
            style={{ left: `${split}%` }}
          />
        </div>
        <div
          className="mt-1.5 flex justify-between text-[9px] uppercase tracking-[0.2em] text-white/30"
          style={label}
        >
          <span>nu</span>
          <span style={{ color: AMBER }}>{f.rotation.nextInMinutes}&prime;</span>
          <span>{f.rotation.afterInMinutes}&prime;</span>
        </div>

        <div className="mt-2">
          <RotationRow
            tag="Aan het stuur"
            name={f.rotation.current}
            note="nu"
            tone={PINK}
          />
          <RotationRow
            tag="Volgende"
            name={f.rotation.next}
            note={`over ${f.rotation.nextInMinutes} min`}
            tone={ORANGE}
          />
          <RotationRow
            tag="Daarna"
            name={f.rotation.after}
            note={`over ${f.rotation.afterInMinutes} min`}
            tone={AMBER}
          />
        </div>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Klassement                                                          */
/* ------------------------------------------------------------------ */

function StandingsPanel({ f }: { f: PitwallFixture }) {
  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));
  const anyPit = f.standings.some((s) => s.inPit);

  return (
    <ChromeFrame className="lg:col-span-12">
      <PanelHead
        kicker="Klassement"
        title="Per klasse"
        right={
          <div className="flex items-center gap-2">
            <Chip tone={PINK}>jij</Chip>
            {anyPit ? <Chip tone={AMBER}>pit</Chip> : null}
          </div>
        }
      />
      <div className="overflow-x-auto px-1.5 pb-2">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr
              className="text-[9px] uppercase tracking-[0.2em] text-white/30"
              style={label}
            >
              <th className="w-8 px-2 py-2 font-medium">Kl</th>
              <th className="w-9 px-2 py-2 font-medium">Pos</th>
              <th className="px-2 py-2 font-medium">Coureur</th>
              <th className="px-2 py-2 font-medium">Auto</th>
              <th className="px-2 py-2 text-right font-medium">Gat</th>
              <th className="px-2 py-2 text-right font-medium">Laatste</th>
              <th className="px-2 py-2 text-right font-medium">Beste</th>
              <th className="px-2 py-2 text-right font-medium">Banden</th>
            </tr>
          </thead>

          {classes.map((cls) => {
            const rows = f.standings
              .filter((s) => s.cls === cls)
              .slice()
              .sort((a, b) => a.classPos - b.classPos);

            return (
              <tbody key={cls}>
                <tr>
                  <td colSpan={8} className="px-2 pb-1 pt-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[12px] uppercase tracking-[0.26em]"
                        style={{ ...raceHead, color: CREAM }}
                      >
                        {cls}
                      </span>
                      <span
                        className="h-px flex-1"
                        style={{
                          background:
                            "linear-gradient(90deg, rgba(255,45,149,.6), rgba(255,45,149,0))",
                        }}
                      />
                      <span
                        className="text-[9px] uppercase tracking-[0.2em] text-white/35"
                        style={label}
                      >
                        {rows.length} auto&apos;s
                      </span>
                    </div>
                  </td>
                </tr>

                {rows.map((s) => (
                  <tr
                    key={`${cls}-${s.pos}`}
                    style={{
                      background: s.isSelf
                        ? "linear-gradient(90deg, rgba(255,45,149,.24), rgba(255,122,26,.05) 55%, transparent)"
                        : s.inPit
                          ? "rgba(255,200,87,.07)"
                          : undefined,
                      boxShadow: s.isSelf
                        ? `inset 3px 0 0 ${PINK}`
                        : s.inPit
                          ? `inset 3px 0 0 ${AMBER}80`
                          : undefined,
                    }}
                  >
                    <td
                      className="px-2 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/35"
                      style={label}
                    >
                      {s.cls}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className="text-[14px]"
                        style={{ ...mono, fontWeight: 700, color: CREAM }}
                      >
                        {s.classPos}
                      </span>
                      <span className="ml-1 text-[9px] text-white/25" style={label}>
                        P{s.pos}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {s.isSelf ? (
                          <span
                            className="px-1 py-[1px] text-[8px] font-bold uppercase tracking-[0.18em]"
                            style={{ background: PINK, color: "#170a24", ...label }}
                          >
                            jij
                          </span>
                        ) : null}
                        {s.inPit ? (
                          <span
                            className="px-1 py-[1px] text-[8px] font-bold uppercase tracking-[0.18em]"
                            style={{ background: AMBER, color: "#170a24", ...label }}
                          >
                            pit
                          </span>
                        ) : null}
                        <span
                          className="truncate text-[13px]"
                          style={{
                            color: s.isSelf ? "#ffffff" : "rgba(255,244,227,.82)",
                            fontWeight: s.isSelf ? 700 : 500,
                          }}
                        >
                          {s.driver}
                        </span>
                      </div>
                    </td>
                    <td
                      className="max-w-[220px] truncate px-2 py-1.5 text-[11px] text-white/40"
                      style={label}
                    >
                      {s.car}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right text-[12px]"
                      style={{
                        ...mono,
                        fontWeight: 600,
                        color: s.gap === "LEIDER" ? AMBER : "rgba(255,244,227,.8)",
                      }}
                    >
                      {s.gap}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right text-[12px]"
                      style={{ ...mono, color: "rgba(255,244,227,.72)" }}
                    >
                      {s.lastLap}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right text-[12px]"
                      style={{ ...mono, color: "rgba(87,230,255,.85)" }}
                    >
                      {s.bestLap}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right text-[11px]"
                      style={{
                        ...label,
                        color: s.tyreAgeLaps >= 24 ? PINK : "rgba(255,244,227,.55)",
                      }}
                    >
                      {s.tyreAgeLaps} r
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </ChromeFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */

export default function Design({ f }: { f: PitwallFixture }) {
  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden pb-8 text-[#fff4e3]"
      style={{
        background: "#08040f",
        fontFamily: "'Rajdhani', 'Arial Narrow', sans-serif",
      }}
    >
      <Backdrop />

      <div className="relative z-10 mx-auto max-w-[1320px] px-3 pt-3 sm:px-5">
        <Header f={f} />

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
          <PositionPanel f={f} />
          <TelemetryPanel f={f} />
          <DecisionPanel f={f} />

          <TyreCross f={f} />
          <FuelPanel f={f} />
          <WeatherPanel f={f} />

          <PacePanel f={f} />
          <RotationPanel f={f} />

          <StandingsPanel f={f} />
        </div>

        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 px-1 pt-2">
          <span
            className="text-[8px] uppercase tracking-[0.3em] text-white/25"
            style={label}
          >
            3SM pitwall · ontwerp 09
          </span>
          <span
            className="text-[13px]"
            style={{
              fontFamily: "'Brush Script MT','Segoe Script','Bradley Hand',cursive",
              color: "rgba(255,244,227,.5)",
            }}
          >
            three stripes, one sunset
          </span>
        </footer>
      </div>
    </div>
  );
}
