/**
 * Pitwall-ontwerp 01 — SWISS / EDITORIAL.
 *
 * Een gedrukt raceprogramma dat toevallig live data toont: strak typografisch
 * grid, haarlijnen, veel papier, één rood accent. Geen glow, geen gradients,
 * geen effecten — alleen regels, cijfers en witruimte.
 *
 * Volledig self-contained: alleen react, tailwind-classes en inline SVG.
 */
import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

const INK = "#0f0f0f";
const RED = "#c3261c";
const RED_ON_DARK = "#e4553f";

export const meta = {
  title: "Raceprogramma",
  note: "Swiss/editorial · typografisch grid, haarlijnen, één rood accent",
};

/* ── typografie-hulpjes ──────────────────────────────────────────────────── */

function Micro({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "strong" | "faint";
}) {
  const kleur =
    tone === "strong" ? "text-black/65" : tone === "faint" ? "text-black/30" : "text-black/45";
  return (
    <div
      className={
        "text-[9.5px] font-semibold uppercase leading-none tracking-[0.26em] " +
        kleur +
        " " +
        className
      }
    >
      {children}
    </div>
  );
}

function Band({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-black">
      <div className="flex items-center gap-3 pt-2.5">
        <span className="font-mono text-[10px] tabular-nums" style={{ color: RED }}>
          {n}
        </span>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.3em]">{title}</h2>
        <span className="h-px flex-1 bg-black/15" />
      </div>
      <div className="pb-9 pt-4">{children}</div>
    </section>
  );
}

/* ── tijdnotatie ─────────────────────────────────────────────────────────── */

function fmtLap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, "0")}`;
}

/* ── bandenhoek ──────────────────────────────────────────────────────────── */

function CornerCell({
  id,
  wear,
  tempC,
  hot,
  className = "",
}: {
  id: string;
  wear: number;
  tempC: number;
  hot: boolean;
  className?: string;
}) {
  return (
    <div className={"py-4 " + className}>
      <div className="flex items-baseline justify-between">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.24em]"
          style={{ color: hot ? RED : "rgba(15,15,15,0.42)" }}
        >
          {id}
        </span>
        <span className="text-[10px] tabular-nums text-black/40">{tempC} °C</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[34px] font-light leading-none tabular-nums tracking-[-0.03em] sm:text-[38px]">
          {wear.toFixed(1)}
        </span>
        <span className="text-[10px] text-black/40">%</span>
      </div>
      <div className="mt-3 h-[2px] w-full bg-black/10">
        <div
          className="h-full"
          style={{
            width: `${Math.max(0, Math.min(100, wear))}%`,
            backgroundColor: hot ? RED : INK,
          }}
        />
      </div>
    </div>
  );
}

/* ── pace-grafiek (inline SVG) ───────────────────────────────────────────── */

function PaceChart({ laps }: { laps: number[] }) {
  const W = 900;
  const H = 210;
  const top = 12;
  const bottom = 22;
  const n = laps.length;
  const min = Math.min(...laps);
  const max = Math.max(...laps);
  const lo = min - 0.15;
  const hi = max + 0.15;
  const px = (i: number) => (n <= 1 ? W / 2 : (i * W) / (n - 1));
  const py = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const points = laps.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const last = laps[n - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Rondetijden van de laatste ronden"
    >
      {[0.25, 0.5, 0.75].map((k) => (
        <line
          key={k}
          x1={0}
          x2={W}
          y1={top + k * (H - top - bottom)}
          y2={top + k * (H - top - bottom)}
          stroke={INK}
          strokeOpacity={0.08}
          strokeWidth={1}
        />
      ))}
      <polygon
        points={`0,${H - bottom} ${points} ${W},${H - bottom}`}
        fill={INK}
        fillOpacity={0.05}
      />
      <line
        x1={0}
        x2={W}
        y1={py(min)}
        y2={py(min)}
        stroke={RED}
        strokeOpacity={0.6}
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <polyline
        points={points}
        fill="none"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {laps.map((v, i) => (
        <circle
          key={i}
          cx={px(i)}
          cy={py(v)}
          r={i === n - 1 ? 4 : 2}
          fill={i === n - 1 ? RED : INK}
        />
      ))}
      <line
        x1={px(n - 1)}
        x2={px(n - 1)}
        y1={py(last)}
        y2={H - bottom}
        stroke={RED}
        strokeOpacity={0.45}
        strokeWidth={1}
      />
      <line
        x1={0}
        x2={W}
        y1={H - bottom}
        y2={H - bottom}
        stroke={INK}
        strokeOpacity={0.25}
        strokeWidth={1}
      />
    </svg>
  );
}

/* ── ontwerp ─────────────────────────────────────────────────────────────── */

const REC_LABEL: Record<"PIT_NOW" | "PIT_SOON" | "STAY_OUT", string> = {
  PIT_NOW: "PIT NOW",
  PIT_SOON: "PIT SOON",
  STAY_OUT: "STAY OUT",
};

export default function Design({ f }: { f: PitwallFixture }) {
  const t = f.tyres;

  const corners = [
    { id: "LV", c: t.fl },
    { id: "RV", c: t.fr },
    { id: "LA", c: t.rl },
    { id: "RA", c: t.rr },
  ];
  const hottest = corners.reduce((a, b) => (b.c.wear > a.c.wear ? b : a)).id;

  const klassen = Array.from(new Set(f.standings.map((s) => s.cls))).sort((a, b) =>
    a === f.self.cls ? -1 : b === f.self.cls ? 1 : a.localeCompare(b),
  );

  const tankPct = Math.max(0, Math.min(100, (f.fuel.litres / f.fuel.tankLitres) * 100));
  const paceMin = Math.min(...f.pace);
  const paceMax = Math.max(...f.pace);
  const paceLast = f.pace[f.pace.length - 1];
  const paceAvg = f.pace.reduce((sum, v) => sum + v, 0) / f.pace.length;
  const paceDelta = paceLast - paceMin;

  const stint = [
    { label: "Nu", name: f.rotation.current, minutes: 0 },
    { label: "Volgende", name: f.rotation.next, minutes: f.rotation.nextInMinutes },
    { label: "Daarna", name: f.rotation.after, minutes: f.rotation.afterInMinutes },
  ];

  const ROW = "grid grid-cols-12 items-center gap-x-2 sm:gap-x-3";

  return (
    <div className="min-h-screen bg-[#f2f0e9] font-heading text-[#0f0f0f] antialiased">
      <div className="h-1 bg-[#0f0f0f]" />

      <div className="mx-auto max-w-[1200px] px-5 pb-8 md:px-10">
        {/* ── 01 kop ───────────────────────────────────────────────────── */}
        <header className="pt-6">
          <div className="flex items-center justify-between border-b border-black pb-2">
            <Micro tone="strong">3 Stripes Motorsport</Micro>
            <Micro className="hidden sm:block">Pitwall · raceprogramma</Micro>
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5" style={{ backgroundColor: RED }} />
              <Micro tone="strong">{f.event.flag}</Micro>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-6 border-b border-black pb-7 pt-6">
            <div className="col-span-12 md:col-span-8">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] tabular-nums" style={{ color: RED }}>
                  01
                </span>
                <Micro>
                  Ronde {f.event.lap} van {f.event.totalLaps}
                </Micro>
              </div>

              <h1 className="mt-4 text-[46px] font-black leading-[0.86] tracking-[-0.045em] sm:text-[62px] lg:text-[76px]">
                {f.event.name}
              </h1>

              <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[15px] font-medium">{f.event.circuit}</span>
                <span className="hidden h-2.5 w-px bg-black/25 sm:block" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-black/45">
                  Sessiebest {f.telemetry.bestLap}
                </span>
              </div>
            </div>

            <div className="col-span-12 mt-8 md:col-span-4 md:mt-0 md:border-l md:border-black/20 md:pl-6">
              <Micro>Resterend</Micro>
              <div className="mt-1 text-[42px] font-light leading-none tabular-nums tracking-[-0.03em] sm:text-[52px]">
                {f.event.timeLeft}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-black/15 pt-3">
                <div>
                  <Micro>Afstand</Micro>
                  <div className="mt-1.5 text-[15px] tabular-nums">
                    {f.event.lap}
                    <span className="text-black/40"> / {f.event.totalLaps}</span>
                  </div>
                </div>
                <div>
                  <Micro>Klassering</Micro>
                  <div className="mt-1.5 text-[15px] tabular-nums">
                    P{f.self.pos}
                    <span className="text-black/40"> · K{f.self.classPos}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* eigen auto */}
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-5 border-b border-black py-5">
            <div className="col-span-7 md:col-span-4">
              <Micro>Jouw auto</Micro>
              <div className="mt-1.5 text-[17px] font-semibold leading-tight">{f.self.driver}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/50">
                {f.self.team} · {f.self.cls}
              </div>
            </div>

            <div className="order-3 col-span-12 md:order-none md:col-span-5">
              <div className="text-[13px] leading-snug">{f.self.car}</div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-black/40">
                {f.telemetry.speedKph} km/u · V{f.telemetry.gear} · {f.telemetry.rpm} tpm · S1{" "}
                {f.telemetry.s1}
              </div>
            </div>

            <div className="col-span-5 flex justify-end gap-7 md:col-span-3 md:border-l md:border-black/20 md:pl-6">
              <div>
                <Micro>Algemeen</Micro>
                <div className="mt-1.5 text-[38px] font-black leading-none tabular-nums tracking-[-0.04em]">
                  P{f.self.pos}
                </div>
              </div>
              <div>
                <Micro>Klasse</Micro>
                <div
                  className="mt-1.5 text-[38px] font-black leading-none tabular-nums tracking-[-0.04em]"
                  style={{ color: RED }}
                >
                  K{f.self.classPos}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── 02 gaten ─────────────────────────────────────────────────── */}
        <Band n="02" title="Gaten">
          <div className="grid grid-cols-2">
            <div className="pr-5 sm:pr-10">
              <Micro>Voor je — {f.gaps.aheadName}</Micro>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[42px] font-light leading-none tabular-nums tracking-[-0.03em] sm:text-[52px]">
                  {f.gaps.ahead}
                </span>
                <span className="font-mono text-[10px] text-black/40">s</span>
              </div>
            </div>
            <div className="border-l border-black/20 pl-5 sm:pl-10">
              <Micro>Achter je — {f.gaps.behindName}</Micro>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[42px] font-light leading-none tabular-nums tracking-[-0.03em] sm:text-[52px]">
                  {f.gaps.behind}
                </span>
                <span className="font-mono text-[10px] text-black/40">s</span>
              </div>
            </div>
          </div>
        </Band>

        {/* ── 03 beslissing ────────────────────────────────────────────── */}
        <Band n="03" title="Beslissing">
          <div className="bg-[#0f0f0f] px-5 py-6 text-[#f2f0e9] sm:px-7 sm:py-8">
            <div className="grid grid-cols-12 gap-y-7 md:gap-x-8">
              <div className="col-span-12 md:col-span-7">
                <span className="mb-3 block h-[3px] w-8" style={{ backgroundColor: RED_ON_DARK }} />
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.26em] text-white/45">
                  Aanbeveling
                </div>
                <div className="mt-2 text-[50px] font-black leading-[0.86] tracking-[-0.04em] sm:text-[64px]">
                  {REC_LABEL[f.pit.recommendation]}
                </div>
                <div
                  className="mt-2.5 font-mono text-[10px] tracking-[0.18em]"
                  style={{ color: RED_ON_DARK }}
                >
                  {f.pit.recommendation}
                </div>
                <p className="mt-5 max-w-[40ch] text-[14px] leading-relaxed text-white/75">
                  {f.pit.reason}
                </p>
              </div>

              <div className="col-span-12 md:col-span-5 md:border-l md:border-white/20 md:pl-8">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.26em] text-white/45">
                    Pitwindow
                  </span>
                  <span className="text-[30px] font-light leading-none tabular-nums">
                    {f.pit.windowInLaps}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45">
                      rondes
                    </span>
                  </span>
                </div>

                <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-white/15 pt-4">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.26em] text-white/45">
                    Pitverlies
                  </span>
                  <span className="text-[30px] font-light leading-none tabular-nums">
                    {f.pit.pitLossSeconds.toFixed(1)}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45">
                      s
                    </span>
                  </span>
                </div>

                <div className="mt-4 border-t border-white/15 pt-4 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/40">
                  Tank leeg in {f.fuel.lapsLeft} rondes
                </div>
              </div>
            </div>
          </div>
        </Band>

        {/* ── 04 banden · 05 brandstof ─────────────────────────────────── */}
        <div className="grid grid-cols-12">
          <div className="col-span-12 lg:col-span-7 lg:pr-8">
            <Band n="04" title="Banden">
              <div className="flex items-baseline justify-between">
                <Micro>Vooras</Micro>
                <Micro tone="faint">Links / rechts</Micro>
              </div>

              <div className="mt-2 grid grid-cols-2 border-t border-black/20">
                <CornerCell id={corners[0].id} wear={corners[0].c.wear} tempC={corners[0].c.tempC} hot={hottest === corners[0].id} className="pr-5" />
                <CornerCell id={corners[1].id} wear={corners[1].c.wear} tempC={corners[1].c.tempC} hot={hottest === corners[1].id} className="border-l border-black/20 pl-5" />
                <CornerCell id={corners[2].id} wear={corners[2].c.wear} tempC={corners[2].c.tempC} hot={hottest === corners[2].id} className="border-t border-black/20 pr-5" />
                <CornerCell id={corners[3].id} wear={corners[3].c.wear} tempC={corners[3].c.tempC} hot={hottest === corners[3].id} className="border-l border-t border-black/20 pl-5" />
              </div>
              <div className="mt-2 flex justify-end">
                <Micro>Achteras</Micro>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-x-6 border-t border-black/15 pt-4">
                <div>
                  <Micro>Setleeftijd</Micro>
                  <div className="mt-1.5 text-[26px] font-light leading-none tabular-nums">
                    {t.setLaps}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.16em] text-black/40">
                      rondes
                    </span>
                  </div>
                </div>
                <div>
                  <Micro>Compound</Micro>
                  <div className="mt-1.5 text-[15px] font-medium leading-tight">{t.compound}</div>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-4 border-t border-black/15 pt-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center border border-black">
                  <span className="text-[24px] font-black leading-none">{t.grade}</span>
                </div>
                <div>
                  <Micro>Grade</Micro>
                  <div className="mt-1.5 max-w-[34ch] text-[10px] leading-snug text-black/50">
                    {t.note}
                  </div>
                </div>
              </div>

              <div className="mt-5 border-t border-black/15 pt-4">
                <Micro>Betrouwbaarheidsbereik</Micro>
                <div className="mt-1.5 text-[15px] tabular-nums">
                  {t.wearRange[0]} — {t.wearRange[1]}
                </div>
              </div>
            </Band>
          </div>

          <div className="col-span-12 lg:col-span-5 lg:border-l lg:border-black/20 lg:pl-8">
            <Band n="05" title="Brandstof">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <Micro>Aan boord</Micro>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-[42px] font-light leading-none tabular-nums tracking-[-0.03em]">
                      {f.fuel.litres.toFixed(1)}
                    </span>
                    <span className="font-mono text-[10px] text-black/40">
                      L / {f.fuel.tankLitres} L
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <Micro>Rondes over</Micro>
                  <div className="mt-1.5 text-[42px] font-black leading-none tabular-nums tracking-[-0.04em]">
                    {f.fuel.lapsLeft}
                  </div>
                </div>
              </div>

              <div className="mt-5 h-[3px] w-full bg-black/10">
                <div className="h-full" style={{ width: `${tankPct}%`, backgroundColor: INK }} />
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-black/35">
                <span>Leeg</span>
                <span className="tabular-nums">{f.fuel.tankLitres} L</span>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-px bg-black/15 sm:grid-cols-3">
                <div className="bg-[#f2f0e9] py-3 sm:pr-3">
                  <Micro>Per ronde</Micro>
                  <div className="mt-1.5 text-[17px] tabular-nums">
                    {f.fuel.perLap.toFixed(2)}
                    <span className="ml-1 text-[9px] text-black/40">L</span>
                  </div>
                </div>
                <div className="bg-[#f2f0e9] py-3 sm:px-3">
                  <Micro>Bij te tanken</Micro>
                  <div className="mt-1.5 text-[17px] tabular-nums" style={{ color: RED }}>
                    {f.fuel.toAddLitres}
                    <span className="ml-1 text-[9px]" style={{ color: RED }}>
                      L
                    </span>
                  </div>
                </div>
                <div className="bg-[#f2f0e9] py-3 sm:pl-3">
                  <Micro>Tot finish</Micro>
                  <div className="mt-1.5 text-[17px] tabular-nums">
                    {f.fuel.toFinishLitres}
                    <span className="ml-1 text-[9px] text-black/40">L</span>
                  </div>
                </div>
              </div>
            </Band>
          </div>
        </div>

        {/* ── 06 klassement ────────────────────────────────────────────── */}
        <Band n="06" title="Klassement">
          <div className={`${ROW} border-b border-black pb-2`}>
            <div className="col-span-1">
              <Micro>Pos</Micro>
            </div>
            <div className="col-span-1 hidden sm:block">
              <Micro>Kl</Micro>
            </div>
            <div className="col-span-7 sm:col-span-4">
              <Micro>Coureur / auto</Micro>
            </div>
            <div className="col-span-2 text-right">
              <Micro>Gat</Micro>
            </div>
            <div className="col-span-2 hidden text-right sm:block">
              <Micro>Laatste</Micro>
            </div>
            <div className="col-span-2 text-right">
              <Micro>Banden</Micro>
            </div>
          </div>

          {klassen.map((cls, gi) => {
            const rijen = f.standings.filter((s) => s.cls === cls).sort((a, b) => a.pos - b.pos);
            return (
              <div key={cls}>
                <div
                  className={
                    "flex items-baseline justify-between border-b border-black/15 pb-1.5 " +
                    (gi === 0 ? "pt-4" : "pt-6")
                  }
                >
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.28em]">{cls}</h3>
                  <span className="font-mono text-[10px] tabular-nums text-black/40">
                    {rijen.length} auto&apos;s
                  </span>
                </div>

                {rijen.map((s) => {
                  const dim = s.isSelf ? "text-[#f2f0e9]/55" : "text-black/45";
                  return (
                    <div
                      key={s.driver}
                      className={
                        `${ROW} border-b py-3 text-[13px] ` +
                        (s.isSelf
                          ? "border-black bg-[#0f0f0f] text-[#f2f0e9]"
                          : "border-black/10")
                      }
                    >
                      <div className="col-span-1 text-[15px] font-medium tabular-nums">{s.pos}</div>
                      <div className={`col-span-1 hidden text-[11px] tabular-nums sm:block ${dim}`}>
                        {s.classPos}
                      </div>
                      <div className="col-span-7 sm:col-span-4">
                        <div className="flex items-baseline gap-2">
                          <span className={s.isSelf ? "font-semibold" : "font-medium"}>
                            {s.driver}
                          </span>
                          {s.isSelf && (
                            <span className="border border-current px-1 py-px text-[8px] font-semibold uppercase leading-none tracking-[0.16em]">
                              jij
                            </span>
                          )}
                          {s.inPit && (
                            <span
                              className="text-[8px] font-bold uppercase leading-none tracking-[0.18em]"
                              style={{ color: s.isSelf ? RED_ON_DARK : RED }}
                            >
                              pit
                            </span>
                          )}
                        </div>
                        <div className={`mt-0.5 truncate text-[11px] ${dim}`}>{s.car}</div>
                      </div>
                      <div className="col-span-2 text-right tabular-nums">{s.gap}</div>
                      <div className={`col-span-2 hidden text-right tabular-nums sm:block ${dim}`}>
                        {s.lastLap}
                      </div>
                      <div className={`col-span-2 text-right tabular-nums ${dim}`}>
                        {s.tyreAgeLaps} r
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Band>

        {/* ── 07 rondetijden ───────────────────────────────────────────── */}
        <Band n="07" title="Rondetijden">
          <div className="grid grid-cols-12 gap-x-8 gap-y-6">
            <div className="col-span-12 md:col-span-9">
              <div className="mb-4 flex items-baseline justify-between">
                <Micro>Laatste {f.pace.length} rondes</Micro>
                <Micro className="tabular-nums">traagste {fmtLap(paceMax)}</Micro>
              </div>
              <PaceChart laps={f.pace} />
            </div>

            <div className="col-span-12 md:col-span-3 md:border-l md:border-black/20 md:pl-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-1 md:gap-x-0">
                <div>
                  <Micro>Snelste</Micro>
                  <div className="mt-1.5 text-[20px] font-light leading-none tabular-nums">
                    {fmtLap(paceMin)}
                  </div>
                </div>
                <div className="md:border-t md:border-black/15 md:pt-3">
                  <Micro>Laatste</Micro>
                  <div className="mt-1.5 text-[20px] font-light leading-none tabular-nums">
                    {fmtLap(paceLast)}
                  </div>
                </div>
                <div className="md:border-t md:border-black/15 md:pt-3">
                  <Micro>Gemiddelde</Micro>
                  <div className="mt-1.5 text-[20px] font-light leading-none tabular-nums">
                    {fmtLap(paceAvg)}
                  </div>
                </div>
                <div className="md:border-t md:border-black/15 md:pt-3">
                  <Micro>Verschil</Micro>
                  <div className="mt-1.5 text-[20px] font-light leading-none tabular-nums">
                    +{paceDelta.toFixed(3)}
                    <span className="ml-1 text-[9px] text-black/40">s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Band>

        {/* ── 08 coureurswissel · 09 weer ──────────────────────────────── */}
        <div className="grid grid-cols-12">
          <div className="col-span-12 md:col-span-8 md:pr-8">
            <Band n="08" title="Coureurswissel">
              <div className="sm:grid sm:grid-cols-3">
                {stint.map((s, i) => (
                  <div
                    key={s.label}
                    className={
                      "flex flex-col py-4 sm:py-0 " +
                      (i === 0
                        ? "sm:pr-6"
                        : "border-t border-black/15 sm:border-l sm:border-t-0 sm:border-black/15 sm:pl-6")
                    }
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <Micro>{s.label}</Micro>
                      <span className="font-mono text-[10px] tabular-nums text-black/50">
                        {i === 0 ? "0 min" : `+${s.minutes} min`}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {i === 0 && (
                        <span className="h-2 w-2 shrink-0" style={{ backgroundColor: RED }} />
                      )}
                      <span
                        className={
                          "text-[18px] leading-tight " + (i === 0 ? "font-semibold" : "font-medium")
                        }
                      >
                        {s.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Band>
          </div>

          <div className="col-span-12 md:col-span-4 md:border-l md:border-black/20 md:pl-8">
            <Band n="09" title="Weer">
              <div className="flex items-baseline justify-between gap-4">
                <Micro>Lucht</Micro>
                <div className="text-[26px] font-light leading-none tabular-nums">
                  {f.weather.airC.toFixed(1)}
                  <span className="ml-1 text-[10px] text-black/40">°C</span>
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-black/15 pt-3">
                <Micro>Baan</Micro>
                <div className="text-[26px] font-light leading-none tabular-nums">
                  {f.weather.trackC.toFixed(1)}
                  <span className="ml-1 text-[10px] text-black/40">°C</span>
                </div>
              </div>
              <div className="mt-3 border-t border-black/15 pt-3">
                <Micro>Rubberstate</Micro>
                <div className="mt-1.5 text-[12px] leading-snug">{f.weather.rubber}</div>
              </div>
            </Band>
          </div>
        </div>

        {/* ── colofon ──────────────────────────────────────────────────── */}
        <footer className="flex items-center justify-between gap-4 border-t-2 border-black pt-2.5">
          <Micro>3 Stripes Motorsport</Micro>
          <Micro className="hidden text-center sm:block">
            {f.event.name} · ronde {f.event.lap}/{f.event.totalLaps}
          </Micro>
          <Micro>Einde programma</Micro>
        </footer>
      </div>
    </div>
  );
}
