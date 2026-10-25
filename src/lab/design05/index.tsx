import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "Premium Glass",
  note: "Diep donker glas, één dominant beslissingspaneel en haarfijne lichte randen — de rest fluistert mee.",
};

/* ------------------------------------------------------------------ tokens */

const GOLD = "#E8CBA4";
const MINT = "#8AE3C6";
const AMBER = "#F0B45F";
const CORAL = "#F07A6A";
const ICE = "#A9C4FF";

const DISPLAY_FONT = {
  fontFamily: '"Exo 2", "Inter", system-ui, sans-serif',
} as const;

const NUM_FONT = {
  fontFamily: 'Rajdhani, "Exo 2", system-ui, sans-serif',
  fontVariantNumeric: "tabular-nums",
} as const;

const BODY_FONT = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Exo 2", system-ui, sans-serif',
} as const;

const GLASS_SHADOW =
  "inset 0 1px 0 0 rgba(255,255,255,0.07), inset 0 -1px 0 0 rgba(255,255,255,0.025), 0 32px 70px -40px rgba(0,0,0,0.95)";

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="180" height="180" filter="url(#n)" opacity="0.6"/></svg>',
)}")`;

/* ------------------------------------------------------------------- utils */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function lapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(2)}`;
}

function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mid = (x0 + x1) / 2;
    d += ` C ${mid.toFixed(2)} ${y0.toFixed(2)}, ${mid.toFixed(2)} ${y1.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

function wearTone(wear: number): string {
  if (wear >= 90) return MINT;
  if (wear >= 78) return AMBER;
  return CORAL;
}

function tempTone(temp: number): string {
  if (temp >= 95) return CORAL;
  if (temp >= 90) return AMBER;
  return "rgba(244,245,247,0.45)";
}

/* ------------------------------------------------------------- glass panel */

type PanelProps = {
  label: string;
  hint?: string;
  glow?: string;
  hero?: boolean;
  className?: string;
  children: ReactNode;
};

function Panel({ label, hint, glow, hero = false, className, children }: PanelProps) {
  return (
    <section
      className={cx(
        "relative flex flex-col overflow-hidden rounded-[26px] backdrop-blur-2xl",
        hero
          ? "rounded-[30px] border border-white/[0.13] bg-white/[0.055] p-7"
          : "border border-white/[0.09] bg-white/[0.035] p-5",
        className,
      )}
      style={{ boxShadow: GLASS_SHADOW }}
    >
      {glow ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(60% 70% at 88% -6%, ${glow}, transparent 70%)`,
          }}
        />
      ) : null}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
      />
      <header className="relative mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.3em] text-white/45">
          {label}
        </h2>
        {hint ? (
          <span
            className="text-[10px] uppercase tracking-[0.16em] text-white/30"
            style={NUM_FONT}
          >
            {hint}
          </span>
        ) : null}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- marks */

function StripesMark() {
  return (
    <svg viewBox="0 0 34 34" className="h-9 w-9 shrink-0" aria-hidden>
      <path d="M9 4 L14.5 4 L10.5 30 L5 30 Z" fill={CORAL} opacity="0.95" />
      <path d="M18 4 L23.5 4 L19.5 30 L14 30 Z" fill={AMBER} opacity="0.85" />
      <path d="M27 4 L32.5 4 L28.5 30 L23 30 Z" fill={GOLD} opacity="0.6" />
    </svg>
  );
}

function CarSilhouette() {
  return (
    <svg viewBox="0 0 64 132" className="h-[132px] w-[64px]" aria-hidden>
      <defs>
        <linearGradient id="d05-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
        <linearGradient id="d05-stripe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.55" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* wielen */}
      <rect x="1" y="22" width="10" height="20" rx="4" fill="rgba(255,255,255,0.2)" />
      <rect x="53" y="22" width="10" height="20" rx="4" fill="rgba(255,255,255,0.2)" />
      <rect x="1" y="88" width="10" height="20" rx="4" fill="rgba(255,255,255,0.2)" />
      <rect x="53" y="88" width="10" height="20" rx="4" fill="rgba(255,255,255,0.2)" />

      {/* body */}
      <path
        d="M32 5 C38.5 5 43 11 43 19 L45 56 L45 104 C45 116 40 127 32 127 C24 127 19 116 19 104 L19 56 L21 19 C21 11 25.5 5 32 5 Z"
        fill="url(#d05-body)"
        stroke="rgba(255,255,255,0.26)"
        strokeWidth="1"
      />
      {/* ruit */}
      <path
        d="M24 34 C26.5 26 37.5 26 40 34 L41 47 L23 47 Z"
        fill="rgba(255,255,255,0.14)"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="0.8"
      />
      {/* middenstrip */}
      <rect x="31.2" y="12" width="1.6" height="106" rx="0.8" fill="url(#d05-stripe)" />
      {/* achtervleugel */}
      <rect x="15" y="112" width="34" height="3" rx="1.5" fill="rgba(255,255,255,0.16)" />
    </svg>
  );
}

function PosTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cx(
        "min-w-[58px] rounded-2xl border px-3 py-2 text-center",
        accent ? "border-white/[0.14] bg-white/[0.07]" : "border-white/[0.07] bg-white/[0.03]",
      )}
    >
      <div className="text-[8px] uppercase tracking-[0.24em] text-white/35">{label}</div>
      <div
        className="mt-0.5 text-[22px] font-light leading-none"
        style={{ ...NUM_FONT, color: accent ? GOLD : "rgba(255,255,255,0.9)" }}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function TopBar({ f }: { f: PitwallFixture }) {
  const progress = (f.event.lap / f.event.totalLaps) * 100;
  const flag = f.event.flag.toLowerCase();
  const flagColor = flag.includes("rood")
    ? CORAL
    : flag.includes("geel")
      ? AMBER
      : MINT;
  return (
    <div
      className="relative overflow-hidden rounded-[30px] border border-white/[0.09] bg-white/[0.04] px-6 py-5 backdrop-blur-2xl"
      style={{ boxShadow: GLASS_SHADOW }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-full"
        style={{
          background:
            "radial-gradient(50% 120% at 4% 0%, rgba(232,203,164,0.10), transparent 60%)",
        }}
      />

      <div className="relative flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="flex items-center gap-4">
          <StripesMark />
          <div>
            <div className="text-[9px] uppercase tracking-[0.34em] text-white/35">
              3 Stripes Motorsport · Pitwall
            </div>
            <div className="mt-1 flex items-center gap-3">
              <h1
                className="text-[22px] font-light leading-none text-white/95"
                style={DISPLAY_FONT}
              >
                {f.event.name}
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: flagColor, boxShadow: `0 0 8px ${flagColor}` }}
                />
                <span className="text-[8.5px] uppercase tracking-[0.2em] text-white/55">
                  {f.event.flag}
                </span>
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-white/40">{f.event.circuit}</div>
          </div>
        </div>

        <div className="w-full max-w-[360px] flex-1">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] uppercase tracking-[0.24em] text-white/35">Ronde</span>
              <span className="text-[26px] font-light leading-none text-white/95" style={NUM_FONT}>
                {f.event.lap}
              </span>
              <span className="text-[11px] text-white/30" style={NUM_FONT}>
                / {f.event.totalLaps}
              </span>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-[0.24em] text-white/30">Resterend</div>
              <div className="text-[15px] leading-none text-white/80" style={NUM_FONT}>
                {f.event.timeLeft}
              </div>
            </div>
          </div>
          <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: `linear-gradient(90deg, rgba(232,203,164,0.45), ${GOLD})`,
                boxShadow: `0 0 12px rgba(232,203,164,0.4)`,
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="hidden text-right sm:block">
            <div className="text-[9px] uppercase tracking-[0.24em] text-white/30">Onze auto</div>
            <div className="text-[13px] leading-tight text-white/85">{f.self.driver}</div>
            <div className="max-w-[200px] truncate text-[10px] text-white/35">{f.self.car}</div>
          </div>
          <div className="hidden h-11 w-px bg-white/10 sm:block" />
          <div className="flex items-end gap-2.5">
            <PosTile label="Alg" value={f.self.pos} />
            <PosTile label={f.self.cls} value={f.self.classPos} accent />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- telemetrie */

function TelemetryStrip({ f }: { f: PitwallFixture }) {
  const cells: Array<{ label: string; value: string; unit?: string; tone?: string }> = [
    { label: "Snelheid", value: `${f.telemetry.speedKph}`, unit: "km/h" },
    { label: "Versnelling", value: `${f.telemetry.gear}` },
    { label: "Toeren", value: f.telemetry.rpm.toLocaleString("nl-NL") },
    { label: "S1", value: f.telemetry.s1 },
    { label: "S2", value: f.telemetry.s2 },
    { label: "S3", value: f.telemetry.s3 },
    { label: "Laatste", value: f.telemetry.lastLap },
    { label: "Beste", value: f.telemetry.bestLap, tone: MINT },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-white/[0.06] overflow-hidden rounded-[22px] border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl sm:grid-cols-4 lg:grid-cols-8">
      {cells.map((cell) => (
        <div key={cell.label} className="px-4 py-3">
          <div className="text-[8.5px] uppercase tracking-[0.24em] text-white/30">{cell.label}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span
              className="text-[18px] font-light leading-none"
              style={{ ...NUM_FONT, color: cell.tone ?? "rgba(255,255,255,0.86)" }}
            >
              {cell.value}
            </span>
            {cell.unit ? (
              <span className="text-[9px] text-white/30" style={NUM_FONT}>
                {cell.unit}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- beslissing */

type Recommendation = PitwallFixture["pit"]["recommendation"];

const REC: Record<
  Recommendation,
  { call: string; big: [string, string]; color: string; glow: string }
> = {
  STAY_OUT: {
    call: "Buiten blijven",
    big: ["STAY", "OUT"],
    color: MINT,
    glow: "rgba(138,227,198,0.14)",
  },
  PIT_SOON: {
    call: "Bereid de stop voor",
    big: ["PIT", "SOON"],
    color: AMBER,
    glow: "rgba(240,180,95,0.16)",
  },
  PIT_NOW: {
    call: "Nu naar binnen",
    big: ["PIT", "NOW"],
    color: CORAL,
    glow: "rgba(240,122,106,0.16)",
  },
};

function DecisionPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const rec = REC[f.pit.recommendation];
  const lapPct = (f.event.lap / f.event.totalLaps) * 100;
  const windowLap = f.event.lap + f.pit.windowInLaps;
  const windowPct = Math.min(
    (f.pit.windowInLaps / f.event.totalLaps) * 100,
    100 - lapPct,
  );

  return (
    <Panel label="Beslissing" glow={rec.glow} hero className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inset-0 rounded-full opacity-40"
              style={{ background: rec.color, boxShadow: `0 0 12px ${rec.color}` }}
            />
            <span className="relative h-2 w-2 rounded-full" style={{ background: rec.color }} />
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.26em]"
            style={{ ...NUM_FONT, color: rec.color }}
          >
            {rec.call}
          </span>
        </div>
      </div>

      <div
        className="mt-5 text-white"
        style={{ ...DISPLAY_FONT, fontSize: "clamp(46px, 6.2vw, 82px)", fontWeight: 300 }}
      >
        <div className="leading-[0.84] tracking-[-0.045em] text-white/95">{rec.big[0]}</div>
        <div
          className="leading-[0.84] tracking-[-0.045em]"
          style={{ color: rec.color, textShadow: `0 0 44px ${rec.color}33` }}
        >
          {rec.big[1]}
        </div>
      </div>

      <p className="mt-6 max-w-[34ch] text-[14px] font-light leading-relaxed text-white/60">
        {f.pit.reason}.
      </p>

      <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-black/25">
        {[
          { label: "Pitvenster", value: `${f.pit.windowInLaps}`, unit: "ronden" },
          { label: "Pitverlies", value: `${f.pit.pitLossSeconds}`, unit: "sec" },
          { label: "Setleeftijd", value: `${f.tyres.setLaps}`, unit: "ronden" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="border-r border-white/[0.06] px-4 py-3.5 last:border-r-0"
          >
            <div className="text-[8.5px] uppercase tracking-[0.22em] text-white/30">
              {stat.label}
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span
                className="text-[26px] font-light leading-none text-white/90"
                style={NUM_FONT}
              >
                {stat.value}
              </span>
              <span className="text-[9px] uppercase tracking-[0.1em] text-white/30">
                {stat.unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-7">
        <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/[0.16]"
            style={{ width: `${lapPct}%` }}
          />
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${lapPct}%`,
              width: `${windowPct}%`,
              background: `linear-gradient(90deg, ${AMBER}, rgba(240,180,95,0.3))`,
              boxShadow: `0 0 16px rgba(240,180,95,0.45)`,
            }}
          />
        </div>
        <div className="mt-2.5 grid grid-cols-3 text-[9px] uppercase tracking-[0.18em]">
          <span className="text-white/45">
            Nu · <span style={NUM_FONT}>{f.event.lap}</span>
          </span>
          <span className="text-center" style={{ color: AMBER }}>
            Venster · <span style={NUM_FONT}>{windowLap}</span>
          </span>
          <span className="text-right text-white/30">
            Finish · <span style={NUM_FONT}>{f.event.totalLaps}</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- gaten */

function GapsPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const ahead = Math.abs(Number.parseFloat(f.gaps.ahead));
  const behind = Math.abs(Number.parseFloat(f.gaps.behind));
  const total = ahead + behind || 1;

  return (
    <Panel label="Gaten" hint="live" className={className}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[9px] uppercase tracking-[0.24em] text-white/30">
            Voor ons · {f.gaps.aheadName}
          </div>
          <div className="mt-1.5 text-[11px] text-white/40">afstand tot de auto voor</div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[38px] font-light leading-none text-white/90"
            style={NUM_FONT}
          >
            {f.gaps.ahead}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">sec</span>
        </div>
      </div>

      <div className="my-4 h-px bg-gradient-to-r from-white/[0.12] via-white/[0.06] to-transparent" />

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[9px] uppercase tracking-[0.24em] text-white/30">
            Achter ons · {f.gaps.behindName}
          </div>
          <div className="mt-1.5 text-[11px] text-white/40">afstand tot de auto achter</div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[38px] font-light leading-none"
            style={{ ...NUM_FONT, color: MINT }}
          >
            {f.gaps.behind}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">sec</span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full"
            style={{ width: `${(ahead / total) * 100}%`, background: "rgba(255,255,255,0.35)" }}
          />
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full"
            style={{ width: `${(behind / total) * 100}%`, background: "rgba(138,227,198,0.55)" }}
          />
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- weer */

function WeatherPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const rows: Array<{ label: string; value: string; unit?: string }> = [
    { label: "Lucht", value: f.weather.airC.toFixed(1), unit: "°C" },
    { label: "Baan", value: f.weather.trackC.toFixed(1), unit: "°C" },
    { label: "Rubber", value: f.weather.rubber },
  ];

  return (
    <Panel label="Weer" hint="baanconditie" className={className}>
      <div className="flex flex-1 flex-col justify-center">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={cx(
              "flex items-center justify-between gap-4 py-3",
              index > 0 && "border-t border-white/[0.06]",
            )}
          >
            <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
              {row.label}
            </span>
            <span className="flex items-baseline gap-1 text-right">
              <span
                className={cx(
                  "font-light leading-none",
                  row.unit ? "text-[24px] text-white/88" : "text-[12px] text-white/65",
                )}
                style={{ ...NUM_FONT, ...(row.unit ? {} : BODY_FONT) }}
              >
                {row.value}
              </span>
              {row.unit ? (
                <span className="text-[11px] text-white/35" style={NUM_FONT}>
                  {row.unit}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="h-1 w-1 rounded-full" style={{ background: ICE, opacity: 0.7 }} />
        <span className="text-[9.5px] tracking-[0.08em] text-white/32">
          Meting aan de baanzijde; geen live sensor
        </span>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ banden */

type CornerCellProps = {
  code: string;
  wear: number;
  tempC: number;
  rear?: boolean;
};

function CornerCell({ code, wear, tempC, rear = false }: CornerCellProps) {
  const tone = wearTone(wear);
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/[0.07] px-3.5 py-3",
        rear ? "bg-white/[0.015]" : "bg-white/[0.035]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.22em] text-white/40">{code}</span>
        <span className="text-[11px]" style={{ ...NUM_FONT, color: tempTone(tempC) }}>
          {tempC}°
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1" style={NUM_FONT}>
        <span className="text-[26px] font-light leading-none" style={{ color: tone }}>
          {wear.toFixed(1)}
        </span>
        <span className="text-[10px] text-white/30">%</span>
      </div>
      <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, wear))}%`,
            background: `linear-gradient(90deg, ${tone}44, ${tone})`,
          }}
        />
      </div>
    </div>
  );
}

function TyresPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const { tyres } = f;
  const [rangeLo, rangeHi] = tyres.wearRange;

  return (
    <Panel
      label="Banden"
      hint={`${tyres.compound} · graad ${tyres.grade}`}
      className={className}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-3">
        <CornerCell code="LV" wear={tyres.fl.wear} tempC={tyres.fl.tempC} />
        <div className="row-span-2 flex items-center justify-center px-1">
          <CarSilhouette />
        </div>
        <CornerCell code="RV" wear={tyres.fr.wear} tempC={tyres.fr.tempC} />
        <CornerCell code="LA" wear={tyres.rl.wear} tempC={tyres.rl.tempC} rear />
        <CornerCell code="RA" wear={tyres.rr.wear} tempC={tyres.rr.tempC} rear />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.14em] text-white/30">
        <span>LV/RV/LA/RA = links/rechts voor/achter</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>% = profiel rest</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>° = temperatuur</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>bereik = % per ronde</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="text-[8.5px] uppercase tracking-[0.2em] text-white/30">Setleeftijd</div>
          <div className="mt-1 text-[16px] font-light leading-none text-white/85" style={NUM_FONT}>
            {tyres.setLaps} <span className="text-[9px] text-white/30">ronden</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="text-[8.5px] uppercase tracking-[0.2em] text-white/30">Compound</div>
          <div className="mt-1 truncate text-[12px] leading-none text-white/85">
            {tyres.compound}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div>
            <div className="text-[8.5px] uppercase tracking-[0.2em] text-white/30">Bereik</div>
            <div className="mt-1 text-[13px] leading-none text-white/85" style={NUM_FONT}>
              {rangeLo.toFixed(1)}–{rangeHi.toFixed(1)}
              <span className="ml-1 text-[8.5px] text-white/30">%/r</span>
            </div>
          </div>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full border text-[13px]"
            style={{ borderColor: `${GOLD}44`, color: GOLD, ...NUM_FONT }}
          >
            {tyres.grade}
          </div>
        </div>
      </div>

      <p className="mt-3.5 text-[9.5px] leading-relaxed text-white/32">{tyres.note}</p>
    </Panel>
  );
}

/* --------------------------------------------------------------- brandstof */

function FuelPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const { fuel } = f;
  const currentPct = Math.min(100, (fuel.litres / fuel.tankLitres) * 100);
  const addPct = Math.min(100 - currentPct, (fuel.toAddLitres / fuel.tankLitres) * 100);
  const afterLitres = fuel.litres + fuel.toAddLitres;

  const stats: Array<{ label: string; value: string; unit: string }> = [
    { label: "Per ronde", value: fuel.perLap.toFixed(2), unit: "L" },
    { label: "Rondes over", value: `${fuel.lapsLeft}`, unit: "r" },
    { label: "Bijtanken", value: `${fuel.toAddLitres}`, unit: "L" },
    { label: "Tot finish", value: fuel.toFinishLitres.toFixed(2), unit: "L" },
  ];

  return (
    <Panel label="Brandstof" hint={`${fuel.lapsLeft} ronden over`} className={className}>
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2" style={NUM_FONT}>
          <span className="text-[52px] font-light leading-none text-white/95">
            {fuel.litres.toFixed(1)}
          </span>
          <span className="text-[13px] text-white/35">L</span>
        </div>
        <div className="pb-1 text-right">
          <div className="text-[8.5px] uppercase tracking-[0.22em] text-white/30">In de tank</div>
          <div className="mt-1 text-[11px] text-white/40" style={NUM_FONT}>
            tank {fuel.tankLitres} L
          </div>
        </div>
      </div>

      <div className="relative mt-5 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${currentPct}%`,
            background: `linear-gradient(90deg, rgba(232,203,164,0.35), ${GOLD})`,
          }}
        />
        <div
          className="absolute inset-y-[3px] rounded-full"
          style={{
            left: `${currentPct}%`,
            width: `${addPct}%`,
            background: "rgba(138,227,198,0.3)",
          }}
        />
        <div
          className="absolute inset-y-0 w-px bg-white/50"
          style={{ left: `${currentPct + addPct}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[9px] tracking-[0.06em]">
        <span className="text-white/45" style={NUM_FONT}>
          {fuel.litres.toFixed(1)} L nu
        </span>
        <span className="text-center text-white/32" style={NUM_FONT}>
          {fuel.tankLitres} L
        </span>
        <span className="text-right" style={{ ...NUM_FONT, color: MINT }}>
          {afterLitres.toFixed(1)} L na tanken
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <div className="text-[8.5px] uppercase tracking-[0.2em] text-white/30">
              {stat.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className="text-[17px] font-light leading-none text-white/88"
                style={NUM_FONT}
              >
                {stat.value}
              </span>
              <span className="text-[9px] text-white/30" style={NUM_FONT}>
                {stat.unit}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- klassement */

function StandingsPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const classes = Array.from(new Set(f.standings.map((row) => row.cls)));
  const cols = "grid-cols-[24px_minmax(0,1fr)_52px_60px_30px]";

  return (
    <Panel label="Klassement" hint="per klasse" className={className}>
      <div
        className={cx(
          "grid items-center gap-2 border-b border-white/[0.07] px-2.5 pb-2 text-[8.5px] uppercase tracking-[0.2em] text-white/32",
          cols,
        )}
      >
        <span>#</span>
        <span>Coureur</span>
        <span className="text-right">Gat</span>
        <span className="text-right">Laatste</span>
        <span className="text-right">Set</span>
      </div>

      <div className="mt-1 flex flex-col">
        {classes.map((cls) => {
          const rows = f.standings
            .filter((row) => row.cls === cls)
            .sort((a, b) => a.classPos - b.classPos);
          return (
            <div key={cls} className="mt-2.5 first:mt-1">
              <div className="flex items-center gap-3 px-2.5 pb-1">
                <span
                  className="text-[9px] uppercase tracking-[0.28em]"
                  style={{ ...NUM_FONT, color: cls === f.self.cls ? GOLD : "rgba(255,255,255,0.4)" }}
                >
                  {cls}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-white/[0.12] to-transparent" />
                <span className="text-[9px] text-white/32">{rows.length} auto’s</span>
              </div>

              {rows.map((row) => (
                <div
                  key={`${cls}-${row.driver}`}
                  className={cx(
                    "relative mb-[3px] grid items-center gap-2 rounded-xl px-2.5 py-[7px] last:mb-0",
                    cols,
                    row.isSelf
                      ? "bg-white/[0.07] ring-1 ring-inset ring-white/[0.13]"
                      : "bg-transparent",
                  )}
                  style={
                    row.inPit && !row.isSelf
                      ? { background: "rgba(240,180,95,0.055)" }
                      : undefined
                  }
                >
                  {row.isSelf ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-[2px] rounded-full"
                      style={{ background: GOLD }}
                    />
                  ) : null}

                  <span
                    className="text-[13px] text-white/45"
                    style={NUM_FONT}
                  >
                    {row.classPos}
                  </span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cx(
                          "truncate text-[12.5px]",
                          row.isSelf ? "text-white" : "text-white/85",
                        )}
                      >
                        {row.driver}
                      </span>
                      {row.inPit ? (
                        <span
                          className="shrink-0 rounded px-1 py-[1px] text-[8px] uppercase tracking-[0.14em]"
                          style={{ background: "rgba(240,180,95,0.16)", color: AMBER }}
                        >
                          Pit
                        </span>
                      ) : null}
                      {row.isSelf ? (
                        <span
                          className="shrink-0 rounded px-1 py-[1px] text-[8px] uppercase tracking-[0.14em]"
                          style={{ background: "rgba(232,203,164,0.16)", color: GOLD }}
                        >
                          Wij
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[10px] text-white/30">{row.car}</div>
                  </div>

                  <span
                    className={cx(
                      "text-right text-[11.5px]",
                      row.isSelf ? "text-white/80" : "text-white/55",
                    )}
                    style={NUM_FONT}
                  >
                    {row.gap}
                  </span>
                  <span
                    className="text-right text-[11.5px] text-white/45"
                    style={NUM_FONT}
                  >
                    {row.lastLap}
                  </span>
                  <span className="text-right text-[10.5px] text-white/32" style={NUM_FONT}>
                    {row.tyreAgeLaps}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-4 pt-3 text-[9px] text-white/32">
        <span>Positie per klasse</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>Set = ronden op de band</span>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- coureurswissel */

function RotationPanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const chain = [
    {
      role: "Aan het stuur",
      name: f.rotation.current,
      when: "nu",
      tone: MINT,
    },
    {
      role: "Volgende",
      name: f.rotation.next,
      when: `over ${f.rotation.nextInMinutes} min`,
      tone: "rgba(255,255,255,0.55)",
    },
    {
      role: "Daarna",
      name: f.rotation.after,
      when: `over ${f.rotation.afterInMinutes} min`,
      tone: "rgba(255,255,255,0.28)",
    },
  ];

  return (
    <Panel label="Coureurswissel" hint={`${f.rotation.afterInMinutes} min vooruit`} className={className}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-[46px] font-light leading-none text-white/95"
              style={NUM_FONT}
            >
              {f.rotation.nextInMinutes}
            </span>
            <span className="text-[12px] text-white/35" style={NUM_FONT}>
              min
            </span>
          </div>
          <div className="mt-2 text-[9px] uppercase tracking-[0.24em] text-white/32">
            tot de volgende wissel
          </div>
          <div className="mt-1 text-[12px] text-white/65">{f.rotation.next}</div>
        </div>
        <div
          className="rounded-full border px-3 py-1 text-[8.5px] uppercase tracking-[0.2em]"
          style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
        >
          {f.self.cls} · P{f.self.classPos}
        </div>
      </div>

      <div className="mt-5 h-px bg-gradient-to-r from-white/[0.12] to-transparent" />

      <div className="my-auto flex flex-col py-4">
        {chain.map((entry, index) => (
          <div
            key={entry.role}
            className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 pb-6 last:pb-0"
          >
            {index < chain.length - 1 ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-[4px] top-3 w-px bg-gradient-to-b from-white/22 to-white/[0.04]"
              />
            ) : null}
            <span
              className="relative z-10 h-[9px] w-[9px] rounded-full"
              style={{
                background: entry.tone,
                boxShadow: index === 0 ? `0 0 14px ${MINT}66` : "0 0 0 3px rgba(255,255,255,0.04)",
              }}
            />
            <div className="min-w-0">
              <div className="text-[8.5px] uppercase tracking-[0.24em] text-white/32">
                {entry.role}
              </div>
              <div
                className={cx(
                  "truncate",
                  index === 0 ? "text-[15px] text-white/95" : "text-[13px] text-white/70",
                )}
              >
                {entry.name}
              </div>
            </div>
            <span
              className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-white/38"
              style={NUM_FONT}
            >
              {entry.when}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
        <div className="text-[8.5px] uppercase tracking-[0.22em] text-white/32">Nu aan boord</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="truncate text-[12px] text-white/75">{f.self.driver}</span>
          <span className="whitespace-nowrap text-[10px] text-white/38" style={NUM_FONT}>
            {f.tyres.setLaps} r op de set
          </span>
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- pace */

function PaceChart({ values }: { values: number[] }) {
  const W = 1000;
  const H = 200;
  const PT = 18;
  const PB = 16;
  const iw = W;
  const ih = H - PT - PB;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = min - 0.45;
  const hi = max + 0.45;

  const px = (index: number) =>
    values.length <= 1 ? 0 : (index / (values.length - 1)) * iw;
  const py = (value: number) => PT + (1 - (value - lo) / (hi - lo)) * ih;

  const points = values.map((value, index) => [px(index), py(value)] as [number, number]);
  const line = smoothPath(points);
  const area = `${line} L ${px(values.length - 1).toFixed(2)} ${PT + ih} L 0 ${PT + ih} Z`;

  const ticks = [0, 1, 2, 3].map((step) => {
    const t = step / 3;
    return { y: PT + t * ih, value: hi - t * (hi - lo) };
  });

  const last = points[points.length - 1];

  return (
    <div className="relative mt-5 h-[210px] w-full">
      <div className="absolute inset-y-0 left-12 right-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label="Rondetijden van de laatste twintig ronden"
        >
          <defs>
            <linearGradient id="d05-pace-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.22" />
              <stop offset="70%" stopColor={GOLD} stopOpacity="0.03" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="d05-pace-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(232,203,164,0.35)" />
              <stop offset="55%" stopColor={GOLD} />
              <stop offset="100%" stopColor="#F6E4CC" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <line
              key={tick.y}
              x1="0"
              x2={W}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(255,255,255,0.055)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill="url(#d05-pace-fill)" />
          <path
            d={line}
            fill="none"
            stroke={GOLD}
            strokeOpacity="0.18"
            strokeWidth="7"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line}
            fill="none"
            stroke="url(#d05-pace-line)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          <line
            x1="0"
            x2={W}
            y1={py(min)}
            y2={py(min)}
            stroke={MINT}
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />

          {values.map((_, index) => (
            <line
              key={`tick-${index}`}
              x1={px(index)}
              x2={px(index)}
              y1={PT + ih}
              y2={PT + ih + 4}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div
          className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${(last[0] / W) * 100}%`,
            top: `${(last[1] / H) * 100}%`,
            background: "#F6E4CC",
            boxShadow: `0 0 0 4px rgba(232,203,164,0.16), 0 0 18px rgba(232,203,164,0.5)`,
          }}
        />
      </div>

      {ticks.map((tick) => (
        <div
          key={`label-${tick.value}`}
          className="absolute left-0 -translate-y-1/2 text-[9.5px] text-white/32"
          style={{ ...NUM_FONT, top: `${((tick.y) / H) * 100}%` }}
        >
          {lapTime(tick.value)}
        </div>
      ))}

      <div
        className="absolute right-0 -translate-y-1/2 rounded-full px-2 py-[2px] text-[8.5px] uppercase tracking-[0.16em]"
        style={{
          top: `${(py(min) / H) * 100}%`,
          color: MINT,
          background: "rgba(10,12,16,0.7)",
        }}
      >
        snelste
      </div>
    </div>
  );
}

function PacePanel({ f, className }: { f: PitwallFixture; className?: string }) {
  const { pace } = f;
  const min = Math.min(...pace);
  const max = Math.max(...pace);
  const avg = pace.reduce((sum, value) => sum + value, 0) / pace.length;
  const last = pace[pace.length - 1];

  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Gemiddeld", value: lapTime(avg) },
    { label: "Spreiding", value: `±${(max - min).toFixed(2)}` },
    { label: "Snelste", value: lapTime(min), tone: MINT },
    { label: "Laatste", value: lapTime(last), tone: GOLD },
  ];

  return (
    <Panel label="Pace" hint="laatste 20 ronden" className={className}>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-[8.5px] uppercase tracking-[0.22em] text-white/34">
                {stat.label}
              </div>
              <div
                className="mt-1 text-[19px] font-light leading-none"
                style={{ ...NUM_FONT, color: stat.tone ?? "rgba(255,255,255,0.82)" }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-[9px] uppercase tracking-[0.18em] text-white/30">
          <span className="flex items-center gap-2">
            <span className="h-px w-6" style={{ background: GOLD }} />
            Rondetijd
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-px w-6"
              style={{
                backgroundImage: `linear-gradient(90deg, ${MINT} 50%, transparent 50%)`,
                backgroundSize: "4px 1px",
                opacity: 0.6,
              }}
            />
            Snelste ronde
          </span>
        </div>
      </div>

      <PaceChart values={pace} />

      <div className="mt-1 flex justify-between pl-12 text-[9px] uppercase tracking-[0.16em] text-white/30">
        <span>-20</span>
        <span>-15</span>
        <span>-10</span>
        <span>-5</span>
        <span style={{ color: "rgba(232,203,164,0.55)" }}>nu</span>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- ontwerp 05 */

export default function Design({ f }: { f: PitwallFixture }) {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-[#07080B] text-white antialiased"
      style={BODY_FONT}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 620px at 10% -12%, rgba(232,203,164,0.16), transparent 62%)," +
            "radial-gradient(950px 520px at 92% 4%, rgba(120,150,255,0.12), transparent 66%)," +
            "radial-gradient(1100px 720px at 48% 112%, rgba(138,227,198,0.08), transparent 62%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: GRAIN,
          opacity: 0.05,
          mixBlendMode: "overlay",
        }}
      />

      <main className="relative mx-auto w-full max-w-[1480px] px-5 pb-12 pt-6 lg:px-8">
        <div className="flex flex-col gap-5">
          <TopBar f={f} />
          <TelemetryStrip f={f} />

          <div className="grid grid-cols-12 gap-5">
            <DecisionPanel f={f} className="col-span-12 lg:col-span-7 lg:row-span-2" />
            <GapsPanel f={f} className="col-span-12 sm:col-span-6 lg:col-span-5" />
            <WeatherPanel f={f} className="col-span-12 sm:col-span-6 lg:col-span-5" />

            <TyresPanel f={f} className="col-span-12 lg:col-span-7" />
            <FuelPanel f={f} className="col-span-12 lg:col-span-5" />

            <StandingsPanel f={f} className="col-span-12 lg:col-span-7" />
            <RotationPanel f={f} className="col-span-12 lg:col-span-5" />

            <PacePanel f={f} className="col-span-12" />
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1">
            <span className="text-[9px] uppercase tracking-[0.3em] text-white/30">
              Pitwall 05 · Premium Glass
            </span>
            <span className="text-[9px] tracking-[0.1em] text-white/26">
              Waarden uit de meetbron van deze sessie
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
