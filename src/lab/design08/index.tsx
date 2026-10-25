import type { ReactNode } from "react";
import type { PitwallFixture, Standing } from "@/lab/fixture";

export const meta = {
  title: "08 — Scandinavisch minimal",
  note: "Bijna wit papier, haarlijnen in plaats van kaders, één terracotta accent. De beslissing staat bovenaan; al het andere leest als voetnoot.",
};

/* ------------------------------------------------------------------ */
/* Rustige bouwstenen                                                  */
/* ------------------------------------------------------------------ */

const PAPER = "#FAF9F6";
const INK = "#1C1B18";
const MUTED = "#8B857C";
const LINE = "#E4E0D8";
const ACCENT = "#B25A3B";

const shell = "mx-auto w-full max-w-[1120px] px-8 py-10 sm:px-10";

function Label({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <div
      className="text-[9.5px] font-medium uppercase leading-none tracking-[0.18em]"
      style={{ color: accent ? ACCENT : MUTED }}
    >
      {children}
    </div>
  );
}

function Hair({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full ${className}`} style={{ background: LINE }} />;
}

function Stat({
  label,
  value,
  unit,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <Label accent={accent}>{label}</Label>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className="text-[22px] font-light leading-none tabular-nums tracking-[-0.01em]"
          style={{ color: accent ? ACCENT : INK }}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[10px] leading-none" style={{ color: MUTED }}>
            {unit}
          </span>
        ) : null}
      </div>
      {sub ? (
        <div className="mt-1.5 truncate text-[11px] leading-none" style={{ color: MUTED }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bandenkruis                                                         */
/* ------------------------------------------------------------------ */

function CornerCell({
  code,
  long,
  wear,
  tempC,
}: {
  code: string;
  long: string;
  wear: number;
  tempC: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium tracking-[0.06em]" style={{ color: INK }}>
          {code}
        </span>
        <span className="text-[9.5px]" style={{ color: MUTED }}>
          {long}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[19px] font-light leading-none tabular-nums" style={{ color: INK }}>
          {wear.toFixed(1)}
        </span>
        <span className="text-[10px]" style={{ color: MUTED }}>
          % over
        </span>
      </div>
      <div className="mt-2 h-[2px] w-full" style={{ background: LINE }}>
        <div
          className="h-[2px]"
          style={{ width: `${Math.max(0, Math.min(100, wear))}%`, background: INK, opacity: 0.55 }}
        />
      </div>
      <div className="mt-1.5 text-[10px] tabular-nums" style={{ color: MUTED }}>
        {tempC} °C
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pace-grafiek                                                        */
/* ------------------------------------------------------------------ */

function paceLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, "0")}`;
}

function PaceChart({ pace }: { pace: number[] }) {
  const W = 420;
  const H = 96;
  const pad = 6;
  const min = Math.min(...pace);
  const max = Math.max(...pace);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, pace.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const points = pace.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const mean = pace.reduce((a, b) => a + b, 0) / pace.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[96px] w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1={0} y1={y(max)} x2={W} y2={y(max)} stroke={LINE} strokeWidth={1} />
        <line x1={0} y1={y(mean)} x2={W} y2={y(mean)} stroke={LINE} strokeWidth={1} strokeDasharray="2 4" />
        <line x1={0} y1={y(min)} x2={W} y2={y(min)} stroke={LINE} strokeWidth={1} />
        <polyline
          points={points}
          fill="none"
          stroke={INK}
          strokeWidth={1.3}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(pace.length - 1)} cy={y(pace[pace.length - 1])} r={2.4} fill={ACCENT} />
      </svg>
      <div className="mt-2 flex items-baseline justify-between text-[10px] tabular-nums" style={{ color: MUTED }}>
        <span>snelste {paceLabel(min)}</span>
        <span>gemiddeld {paceLabel(mean)}</span>
        <span>traagste {paceLabel(max)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Klassement                                                          */
/* ------------------------------------------------------------------ */

function StandingRow({ row }: { row: Standing }) {
  return (
    <div
      className="grid grid-cols-[26px_1fr_58px_64px_42px] items-center gap-3 py-[7px] pl-2"
      style={{
        borderLeft: row.isSelf ? `2px solid ${ACCENT}` : "2px solid transparent",
        background: row.isSelf ? "#F5F2EC" : "transparent",
      }}
    >
      <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>
        {row.classPos}
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-[12.5px] leading-tight ${row.isSelf ? "font-semibold" : "font-normal"}`}
          style={{ color: INK }}
        >
          {row.driver}
          {row.inPit ? (
            <span className="ml-2 text-[9px] uppercase tracking-[0.12em]" style={{ color: ACCENT }}>
              pit
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[10px] leading-tight" style={{ color: MUTED }}>
          {row.car}
        </span>
      </span>
      <span className="text-right text-[11px] tabular-nums" style={{ color: INK }}>
        {row.gap}
      </span>
      <span className="text-right text-[11px] tabular-nums" style={{ color: MUTED }}>
        {row.lastLap}
      </span>
      <span className="text-right text-[10px] tabular-nums" style={{ color: MUTED }}>
        {row.tyreAgeLaps}r
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ontwerp                                                             */
/* ------------------------------------------------------------------ */

export default function Design({ f }: { f: PitwallFixture }) {
  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));
  const decision =
    f.pit.recommendation === "PIT_NOW"
      ? "Nu binnen"
      : f.pit.recommendation === "PIT_SOON"
        ? "Binnenkort binnen"
        : "Blijf buiten";

  const fuelPct = Math.min(100, (f.fuel.litres / f.fuel.tankLitres) * 100);
  const addPct = Math.min(100 - fuelPct, (f.fuel.toAddLitres / f.fuel.tankLitres) * 100);

  return (
    <div className="min-h-screen font-sans antialiased" style={{ background: PAPER, color: INK }}>
      <div className={shell}>
        {/* kop ------------------------------------------------------- */}
        <header>
          <div className="flex items-center justify-between">
            <Label>3SM pitwall · endurance</Label>
            <div className="flex items-center gap-2">
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: INK }} />
              <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
                {f.event.flag}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-[30px] font-light leading-[1.05] tracking-[-0.02em] sm:text-[34px]">
                {f.event.name}
              </h1>
              <div className="mt-3 text-[12px]" style={{ color: MUTED }}>
                {f.event.circuit}
                <span className="mx-2" style={{ color: LINE }}>
                  /
                </span>
                ronde <span className="tabular-nums">{f.event.lap}</span> van{" "}
                <span className="tabular-nums">{f.event.totalLaps}</span>
              </div>
            </div>

            <div className="text-right">
              <Label>resterend</Label>
              <div className="mt-2 text-[26px] font-light leading-none tabular-nums tracking-[-0.01em]">
                {f.event.timeLeft}
              </div>
            </div>
          </div>
        </header>

        <Hair className="mt-8" />

        {/* positie en gaten ------------------------------------------ */}
        <section className="grid grid-cols-2 gap-y-6 sm:grid-cols-4">
          {[
            {
              label: "positie",
              value: String(f.self.pos),
              unit: `P${f.self.classPos} ${f.self.cls}`,
              sub: `${f.self.driver} · ${f.self.team}`,
            },
            { label: "voor", value: f.gaps.ahead, unit: "s", sub: f.gaps.aheadName },
            { label: "achter", value: f.gaps.behind, unit: "s", sub: f.gaps.behindName },
            {
              label: "laatste ronde",
              value: f.telemetry.lastLap,
              sub: `best ${f.telemetry.bestLap}`,
            },
          ].map((cell, i) => (
            <div
              key={cell.label}
              className={i === 0 ? "pr-6" : "sm:border-l sm:pl-6"}
              style={{ borderColor: LINE }}
            >
              <Stat label={cell.label} value={cell.value} unit={cell.unit} sub={cell.sub} />
            </div>
          ))}
        </section>

        <Hair className="mt-8" />

        {/* beslissing + weer ---------------------------------------- */}
        <section className="grid gap-10 pt-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <Label accent>beslissing</Label>
            <div className="mt-4 border-l-2 pl-5" style={{ borderColor: ACCENT }}>
              <div className="text-[34px] font-light leading-none tracking-[-0.02em]" style={{ color: ACCENT }}>
                {decision}
              </div>
              <p className="mt-3 max-w-[42ch] text-[12.5px] leading-relaxed" style={{ color: INK }}>
                {f.pit.reason}
              </p>
              <div className="mt-6 flex gap-10">
                <Stat label="pitwindow" value={String(f.pit.windowInLaps)} unit="ronden" />
                <Stat label="pitverlies" value={String(f.pit.pitLossSeconds)} unit="s" />
              </div>
            </div>
          </div>

          <div className="lg:col-span-4">
            <Label>weer</Label>
            <div className="mt-4">
              {[
                { k: "lucht", v: `${f.weather.airC} °C` },
                { k: "baan", v: `${f.weather.trackC} °C` },
                { k: "rubber", v: f.weather.rubber },
              ].map((row, i) => (
                <div key={row.k}>
                  {i > 0 ? <Hair /> : null}
                  <div className="flex items-baseline justify-between py-2.5">
                    <span className="text-[11.5px]" style={{ color: MUTED }}>
                      {row.k}
                    </span>
                    <span className="text-[12px] tabular-nums" style={{ color: INK }}>
                      {row.v}
                    </span>
                  </div>
                </div>
              ))}
              <Hair />
            </div>
          </div>
        </section>

        <Hair className="mt-10" />

        {/* banden + brandstof --------------------------------------- */}
        <section className="grid gap-10 pt-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="flex items-baseline justify-between">
              <Label>banden</Label>
              <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                set {f.tyres.setLaps} ronden
              </span>
            </div>

            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] gap-x-6">
              <div className="space-y-7">
                <CornerCell code="LV" long="linksvoor" wear={f.tyres.fl.wear} tempC={f.tyres.fl.tempC} />
                <CornerCell code="LA" long="linksachter" wear={f.tyres.rl.wear} tempC={f.tyres.rl.tempC} />
              </div>

              <div className="w-[104px] border-x px-4" style={{ borderColor: LINE }}>
                <Label>compound</Label>
                <div className="mt-2 text-[12.5px] leading-tight">{f.tyres.compound}</div>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="text-[9.5px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                    grade
                  </span>
                  <span className="text-[15px] font-light" style={{ color: ACCENT }}>
                    {f.tyres.grade}
                  </span>
                </div>
                <div className="mt-5">
                  <Label>bereik</Label>
                  <div className="mt-1.5 text-[11px] tabular-nums leading-tight">
                    {f.tyres.wearRange[0].toFixed(1)} – {f.tyres.wearRange[1].toFixed(1)} s
                  </div>
                  <div className="mt-1 text-[9.5px]" style={{ color: MUTED }}>
                    per ronde
                  </div>
                </div>
              </div>

              <div className="space-y-7">
                <CornerCell code="RV" long="rechtsvoor" wear={f.tyres.fr.wear} tempC={f.tyres.fr.tempC} />
                <CornerCell code="RA" long="rechtsachter" wear={f.tyres.rr.wear} tempC={f.tyres.rr.tempC} />
              </div>
            </div>

            <p className="mt-6 text-[10.5px] italic leading-relaxed" style={{ color: MUTED }}>
              {f.tyres.note}
            </p>
          </div>

          <div className="lg:col-span-5">
            <Label>brandstof</Label>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-[40px] font-light leading-none tabular-nums tracking-[-0.02em]">
                {f.fuel.litres.toFixed(1)}
              </span>
              <span className="text-[11px]" style={{ color: MUTED }}>
                liter in de tank
              </span>
            </div>

            <div className="mt-5">
              <div className="flex h-[3px] w-full" style={{ background: LINE }}>
                <div style={{ width: `${fuelPct}%`, background: INK }} />
                <div style={{ width: `${addPct}%`, background: ACCENT, opacity: 0.55 }} />
              </div>
              <div className="mt-2 flex justify-between text-[9.5px] tabular-nums" style={{ color: MUTED }}>
                <span>0</span>
                <span>
                  bijtanken +{f.fuel.toAddLitres} L · tank {f.fuel.tankLitres} L
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-6">
              {[
                { label: "per ronde", value: `${f.fuel.perLap.toFixed(2)} L` },
                { label: "rondes over", value: String(f.fuel.lapsLeft) },
                { label: "nodig tot finish", value: `${f.fuel.toFinishLitres.toFixed(1)} L` },
                { label: "bijtanken", value: `+${f.fuel.toAddLitres} L` },
              ].map((row, i) => (
                <div key={row.label} className={i > 1 ? "mt-4" : ""}>
                  <Label>{row.label}</Label>
                  <div className="mt-1.5 text-[13px] tabular-nums">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Hair className="mt-10" />

        {/* klassement ---------------------------------------------- */}
        <section className="pt-8">
          <div className="flex items-baseline justify-between">
            <Label>klassement</Label>
            <span className="text-[10px] tabular-nums" style={{ color: MUTED }}>
              ronde {f.event.lap} / {f.event.totalLaps}
            </span>
          </div>

          <div className="mt-5 grid gap-x-12 gap-y-7 md:grid-cols-2">
            {classes.map((cls) => {
              const rows = f.standings.filter((s) => s.cls === cls);
              return (
                <div key={cls}>
                  <div className="flex items-baseline justify-between pb-2">
                    <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: INK }}>
                      {cls}
                    </span>
                    <span className="text-[10px]" style={{ color: MUTED }}>
                      {rows.length} auto&apos;s
                    </span>
                  </div>
                  <Hair />
                  {rows.map((row) => (
                    <StandingRow key={`${row.cls}-${row.pos}-${row.driver}`} row={row} />
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <Hair className="mt-8" />

        {/* pace + wissel -------------------------------------------- */}
        <section className="grid gap-10 pt-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="flex items-baseline justify-between">
              <Label>pace</Label>
              <span className="text-[10px]" style={{ color: MUTED }}>
                laatste {f.pace.length} ronden
              </span>
            </div>
            <div className="mt-4">
              <PaceChart pace={f.pace} />
            </div>
            <div className="mt-3 flex gap-7 text-[10px] tabular-nums" style={{ color: MUTED }}>
              <span>S1 {f.telemetry.s1}</span>
              <span>S2 {f.telemetry.s2}</span>
              <span>S3 {f.telemetry.s3}</span>
              <span style={{ color: INK }}>
                {f.telemetry.speedKph} km/u · V{f.telemetry.gear} · {f.telemetry.rpm} rpm
              </span>
            </div>
          </div>

          <div className="lg:col-span-5">
            <Label>coureurswissel</Label>
            <div className="mt-4">
              {[
                { tag: "nu", name: f.rotation.current, when: "in de auto", on: true },
                { tag: "straks", name: f.rotation.next, when: `over ${f.rotation.nextInMinutes} min`, on: false },
                { tag: "daarna", name: f.rotation.after, when: `over ${f.rotation.afterInMinutes} min`, on: false },
              ].map((row, i) => (
                <div key={row.tag}>
                  {i > 0 ? <Hair /> : null}
                  <div className="flex items-baseline justify-between py-2.5">
                    <div className="flex items-baseline gap-4">
                      <span
                        className="w-[42px] shrink-0 text-[9px] uppercase tracking-[0.16em]"
                        style={{ color: row.on ? ACCENT : MUTED }}
                      >
                        {row.tag}
                      </span>
                      <span
                        className={`text-[13px] ${row.on ? "font-medium" : "font-light"}`}
                        style={{ color: INK }}
                      >
                        {row.name}
                      </span>
                    </div>
                    <span className="text-[10px] tabular-nums" style={{ color: MUTED }}>
                      {row.when}
                    </span>
                  </div>
                </div>
              ))}
              <Hair />
            </div>
          </div>
        </section>

        <footer className="mt-12 flex items-baseline justify-between border-t pt-4" style={{ borderColor: LINE }}>
          <span className="text-[9.5px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            {f.self.team} · {f.self.car}
          </span>
          <span className="text-[9.5px] tabular-nums" style={{ color: MUTED }}>
            {f.event.name} · {f.event.flag}
          </span>
        </footer>
      </div>
    </div>
  );
}
