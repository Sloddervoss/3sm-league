/**
 * Ontwerp 10 — DENSE PIT WALL.
 *
 * Eén bron (`PitwallFixture`), geen imports uit de bestaande pitwall.
 * Visuele taal: industriële grijstinten, haarlijnen, monospace cijfers,
 * strakke tabelletjes. Eén alertkleur (amber) voor alles wat actie vraagt.
 * Alle afgeleide getallen worden uit de fixture berekend, niet ingevuld.
 */
import type { ReactNode } from "react";
import type { PitwallFixture } from "@/lab/fixture";

export const meta = {
  title: "Dense Pit Wall",
  note: "pitmuur-dichtheid, één alertkleur, elk cijfer telt",
};

/* ---------- helpers ---------- */

const ALERT = "text-amber-400";
const ALERT_BG = "bg-amber-400";
const mono = "font-mono tabular-nums";

const sgn = (n: number, d = 1) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(d)}`;
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const parseLap = (s: string) => {
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(s);
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/* ---------- bouwstenen ---------- */

function Panel({
  title,
  right,
  children,
  className = "",
  alert = false,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  alert?: boolean;
}) {
  return (
    <section className={`flex min-w-0 flex-col border border-neutral-800 bg-[#101214] ${className}`}>
      <header
        className={`flex items-baseline justify-between gap-2 border-b px-2 py-[3px] ${
          alert ? "border-amber-500/40 bg-[#1b1710]" : "border-neutral-800 bg-[#171a1d]"
        }`}
      >
        <h2 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{title}</h2>
        {right ? <span className={`text-[9px] ${mono} text-neutral-500`}>{right}</span> : null}
      </header>
      <div className="px-2 py-[5px]">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  unit,
  tone = "normal",
  strong = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "normal" | "muted" | "alert";
  strong?: boolean;
}) {
  const vc =
    tone === "alert" ? ALERT : tone === "muted" ? "text-neutral-400" : strong ? "text-neutral-100" : "text-neutral-200";
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-neutral-800/70 py-[2px] last:border-b-0">
      <span className="truncate text-[9px] uppercase tracking-[0.08em] text-neutral-500">{label}</span>
      <span className={`shrink-0 text-[11px] ${mono} ${vc} ${strong ? "font-semibold" : ""}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[9px] text-neutral-500">{unit}</span> : null}
      </span>
    </div>
  );
}

function Bar({ pct, alert = false, h = "h-[3px]" }: { pct: number; alert?: boolean; h?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full bg-neutral-800 ${h}`}>
      <div className={`${h} ${alert ? ALERT_BG : "bg-neutral-400"}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/* ---------- pace ---------- */

function PaceChart({ pace, bestLap }: { pace: number[]; bestLap: number }) {
  const W = 320;
  const H = 96;
  const padL = 27;
  const padR = 5;
  const padT = 7;
  const padB = 13;

  const lo = Math.min(bestLap, ...pace) - 0.15;
  const hi = Math.max(...pace) + 0.12;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, pace.length - 1);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);

  const pts = pace.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [lo + (hi - lo) * 0.04, (lo + hi) / 2, hi - (hi - lo) * 0.04];
  const worst = pace.indexOf(Math.max(...pace));
  const last = pace[pace.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Rondetijden laatste 20 ronden">
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(t)}
            y2={y(t)}
            stroke="#2a2e33"
            strokeWidth={i === 2 ? 0 : 0.6}
            strokeDasharray={i === 2 ? "" : "2 3"}
          />
          <text x={padL - 3} y={y(t) + 2.6} textAnchor="end" fontSize={7} fill="#6b7076" className={mono}>
            {t.toFixed(1)}
          </text>
        </g>
      ))}

      {/* bestelijn van de sessie */}
      <line
        x1={padL}
        x2={W - padR}
        y1={y(bestLap)}
        y2={y(bestLap)}
        stroke="#7c848c"
        strokeWidth={0.7}
        strokeDasharray="4 2"
      />
      <text x={W - padR} y={y(bestLap) - 2} textAnchor="end" fontSize={6.5} fill="#7c848c" className={mono}>
        BEST {bestLap.toFixed(3)}
      </text>

      <polyline points={pts} fill="none" stroke="#cfd4d9" strokeWidth={1.1} />
      {pace.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === pace.length - 1 ? 2 : 1.1} fill="#cfd4d9" />
      ))}

      <circle cx={x(worst)} cy={y(pace[worst])} r={2.6} fill="none" stroke="#fbbf24" strokeWidth={0.9} />
      <text
        x={Math.min(W - padR - 12, x(worst) + 4)}
        y={y(pace[worst]) + 8}
        fontSize={6.5}
        fill="#fbbf24"
        className={mono}
      >
        {pace[worst].toFixed(1)}
      </text>

      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#2a2e33" strokeWidth={0.8} />
      <text x={padL} y={H - 3} fontSize={6.5} fill="#6b7076" className={mono}>
        R{pace.length} GELEDEN
      </text>
      <text x={W - padR} y={H - 3} textAnchor="end" fontSize={6.5} fill="#9aa1a8" className={mono}>
        NU {last.toFixed(3)}
      </text>
    </svg>
  );
}

/* ---------- ontwerp ---------- */

export default function Design({ f }: { f: PitwallFixture }) {
  const bestLapS = parseLap(f.telemetry.bestLap);
  const lastLapS = parseLap(f.telemetry.lastLap);
  const lapDelta = lastLapS - bestLapS;

  // gaten
  const ahead = Number(f.gaps.ahead.replace("+", ""));
  const behind = Number(f.gaps.behind.replace("+", ""));
  const lost = f.pit.pitLossSeconds;

  // telemetrie
  const sectors = [f.telemetry.s1, f.telemetry.s2, f.telemetry.s3].map(Number);
  const sectorSum = sectors.reduce((a, b) => a + b, 0);

  // banden
  const corners = [
    { code: "LV", c: f.tyres.fl, axle: "voor" },
    { code: "RV", c: f.tyres.fr, axle: "voor" },
    { code: "LA", c: f.tyres.rl, axle: "acht" },
    { code: "RA", c: f.tyres.rr, axle: "acht" },
  ];
  const wears = corners.map((k) => k.c.wear);
  const wearSpread = Math.max(...wears) - Math.min(...wears);
  const degRate = f.tyres.wearRange[1];
  const restLaps = (w: number) => Math.max(0, (100 - w) / degRate);

  // brandstof
  const lapsOnFuel = f.fuel.litres / f.fuel.perLap;
  const afterRefuel = f.fuel.litres + f.fuel.toAddLitres;
  const lapsAfterRefuel = afterRefuel / f.fuel.perLap;
  const rangeToLap = f.event.lap + Math.floor(lapsAfterRefuel);
  const windowMargin = lapsOnFuel - f.pit.windowInLaps;

  // klassement
  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));
  const byClass = (cls: string) =>
    f.standings.filter((s) => s.cls === cls).sort((a, b) => a.classPos - b.classPos);
  const pitCars = f.standings.filter((s) => s.inPit).length;

  // coureurswissel
  const lapsToChange = Math.round((f.rotation.nextInMinutes * 60) / lastLapS);
  const stintMinutes = f.rotation.afterInMinutes - f.rotation.nextInMinutes;

  // pace
  const pBest = Math.min(...f.pace);
  const pWorst = Math.max(...f.pace);
  const pFirst = avg(f.pace.slice(0, 5));
  const pLast = avg(f.pace.slice(-5));
  const trend = pLast - pFirst;

  const recLabel =
    f.pit.recommendation === "PIT_NOW"
      ? "NU BINNEN"
      : f.pit.recommendation === "PIT_SOON"
        ? "STOP NADERT"
        : "BLIJF BUITEN";

  return (
    <div className="min-h-screen bg-[#0a0b0c] px-2 py-2 text-neutral-300 antialiased">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-[3px]">
        {/* ============ KOP ============ */}
        <div className="grid grid-cols-12 gap-[3px]">
          <div className="col-span-12 flex min-w-0 flex-col justify-center border border-neutral-800 bg-[#14171a] px-2 py-[5px] lg:col-span-4">
            <div className="flex items-baseline gap-2">
              <span className="text-[8px] font-semibold tracking-[0.22em] text-neutral-500">3SM PITWALL</span>
              <span className="text-[9px] tracking-[0.1em] text-neutral-500">/ ENDURANCE</span>
            </div>
            <div className="mt-[1px] truncate text-[15px] font-semibold leading-tight tracking-wide text-neutral-50">
              {f.event.name}
            </div>
            <div className="truncate text-[10px] leading-tight text-neutral-500">{f.event.circuit}</div>
          </div>

          <div className="col-span-12 grid grid-cols-12 gap-[3px] lg:col-span-4 lg:grid-cols-4">
            <div className="col-span-6 flex min-w-0 flex-col justify-center border border-neutral-800 bg-[#14171a] px-2 py-[5px] lg:col-span-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Ronde</span>
                <span className={`text-[9px] ${mono} text-neutral-500`}>{f.event.totalLaps - f.event.lap} te gaan</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-[19px] font-semibold leading-none ${mono} text-neutral-50`}>{f.event.lap}</span>
                <span className={`text-[11px] ${mono} text-neutral-500`}>/{f.event.totalLaps}</span>
              </div>
              <div className="mt-[4px]">
                <Bar pct={(f.event.lap / f.event.totalLaps) * 100} />
              </div>
            </div>

            <div className="col-span-3 flex min-w-0 flex-col justify-center border border-neutral-800 bg-[#14171a] px-2 py-[5px] lg:col-span-1">
              <span className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Rest</span>
              <span className={`text-[19px] font-semibold leading-none ${mono} text-neutral-50`}>
                {f.event.timeLeft}
              </span>
              <span className={`mt-[3px] text-[9px] ${mono} text-neutral-500`}>
                1 r = {lastLapS.toFixed(1)} s
              </span>
            </div>

            <div className="col-span-3 flex min-w-0 flex-col justify-center border border-neutral-800 bg-[#14171a] px-2 py-[5px] lg:col-span-1">
              <span className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Vlag</span>
              <span className="mt-[2px] flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full bg-neutral-200" />
                <span className="text-[12px] font-semibold uppercase tracking-wide text-neutral-100">
                  {f.event.flag}
                </span>
              </span>
              <span className={`mt-[3px] text-[9px] ${mono} text-neutral-500`}>
                {pitCars} in pit
              </span>
            </div>
          </div>

          <div className="col-span-12 flex min-w-0 items-stretch gap-2 border border-neutral-700 bg-[#181b1f] px-2 py-[5px] lg:col-span-4">
            <div className="flex flex-col justify-center border-r border-neutral-700 pr-3">
              <span className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Pos</span>
              <span className={`text-[19px] font-semibold leading-none ${mono} text-neutral-50`}>{f.self.pos}</span>
            </div>
            <div className="flex flex-col justify-center border-r border-neutral-700 pr-3">
              <span className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Klasse</span>
              <span className={`text-[19px] font-semibold leading-none ${mono} text-neutral-50`}>
                {f.self.classPos}
                <span className="ml-1 text-[10px] font-normal text-neutral-400">{f.self.cls}</span>
              </span>
            </div>
            <div className="flex min-w-0 flex-col justify-center">
              <span className="truncate text-[12px] font-semibold leading-tight text-neutral-50">{f.self.driver}</span>
              <span className="truncate text-[10px] leading-tight text-neutral-400">{f.self.team}</span>
              <span className="truncate text-[9px] leading-tight text-neutral-500">{f.self.car}</span>
            </div>
          </div>
        </div>

        {/* ============ BESLISSING / GATEN / TELEMETRIE ============ */}
        <div className="grid grid-cols-12 gap-[3px]">
          <Panel
            title="Beslissing"
            right={f.pit.recommendation}
            alert
            className="col-span-12 border-l-2 border-l-amber-500 lg:col-span-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div>
                <div className={`text-[26px] font-bold leading-none tracking-tight ${ALERT}`}>{recLabel}</div>
                <div className="mt-[5px] text-[10px] leading-snug text-neutral-300">{f.pit.reason}</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Venster sluit</div>
                <div className={`text-[15px] font-semibold leading-none ${mono} text-neutral-100`}>
                  R{f.event.lap + f.pit.windowInLaps}
                </div>
                <div className={`text-[9px] ${mono} text-neutral-500`}>over {f.pit.windowInLaps} r</div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-px border border-neutral-800 bg-neutral-800">
              {[
                { k: "Pitvenster", v: `${f.pit.windowInLaps}`, u: "ronden" },
                { k: "Pitverlies", v: f1(lost), u: "sec" },
                { k: "Brandstof", v: f1(lapsOnFuel), u: "ronden" },
                { k: "Marge", v: sgn(windowMargin, 1), u: "r vs venster" },
              ].map((m) => (
                <div key={m.k} className="bg-[#101214] px-1.5 py-1">
                  <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">{m.k}</div>
                  <div className={`text-[14px] font-semibold leading-none ${mono} text-neutral-100`}>{m.v}</div>
                  <div className="text-[8px] leading-tight text-neutral-600">{m.u}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Gaten" right="t.o.v. eigen auto" className="col-span-12 sm:col-span-6 lg:col-span-4">
            <div className="mb-1 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Voor</div>
                <div className={`text-[24px] font-semibold leading-none ${mono} text-neutral-100`}>{f.gaps.ahead}</div>
                <div className="truncate text-[9px] leading-tight text-neutral-500">{f.gaps.aheadName}</div>
              </div>
              <div className="min-w-0 text-right">
                <div className="text-[8px] uppercase tracking-[0.16em] text-neutral-500">Achter</div>
                <div className={`text-[24px] font-semibold leading-none ${mono} text-neutral-100`}>{f.gaps.behind}</div>
                <div className="truncate text-[9px] leading-tight text-neutral-500">{f.gaps.behindName}</div>
              </div>
            </div>

            <div className="mt-1 border-t border-neutral-800 pt-1">
              <Row label="Na stop · voor" value={sgn(ahead + lost)} unit="s" tone="muted" />
              <Row label="Na stop · achter" value={sgn(behind - lost)} unit="s" tone="alert" />
              <Row label="Pitverlies" value={f1(lost)} unit="s" tone="muted" />
              <Row
                label="Afstand achter"
                value={`~${Math.round((Math.abs(behind) * f.telemetry.speedKph) / 3.6)}`}
                unit="m"
                tone="muted"
              />
            </div>
          </Panel>

          <Panel title="Telemetrie" right={`${f.telemetry.speedKph} km/u · versnelling ${f.telemetry.gear}`} className="col-span-12 sm:col-span-6 lg:col-span-4">
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-baseline gap-1">
                <span className={`text-[26px] font-semibold leading-none ${mono} text-neutral-50`}>
                  {f.telemetry.speedKph}
                </span>
                <span className="text-[9px] text-neutral-500">km/u</span>
                <span className="mx-1 h-3 w-px bg-neutral-700" />
                <span className={`text-[15px] ${mono} text-neutral-200`}>G{f.telemetry.gear}</span>
                <span className={`text-[10px] ${mono} text-neutral-500`}>{f.telemetry.rpm} rpm</span>
              </div>
              <div className="text-right">
                <div className="text-[8px] uppercase tracking-[0.14em] text-neutral-500">Laatste</div>
                <div className={`text-[13px] leading-none ${mono} text-neutral-100`}>{f.telemetry.lastLap}</div>
                <div className={`text-[9px] leading-tight ${mono} ${ALERT}`}>{sgn(lapDelta, 3)} vs best</div>
              </div>
            </div>

            <div className="mt-1.5 flex items-baseline justify-between text-[9px]">
              <span className="text-neutral-500">SECTOREN</span>
              <span className={`${mono} text-neutral-500`}>som {sectorSum.toFixed(3)} = laatste ronde</span>
            </div>
            <div className="mt-[2px] flex h-[6px] w-full gap-px overflow-hidden">
              {sectors.map((s, i) => (
                <div
                  key={i}
                  className={i === 2 ? "bg-neutral-500" : i === 1 ? "bg-neutral-600" : "bg-neutral-700"}
                  style={{ width: `${(s / sectorSum) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-[3px] flex items-baseline justify-between text-[8px] uppercase tracking-[0.08em] text-neutral-500">
              <span>Split</span>
              <span>aandeel · vs gem. sector</span>
            </div>
            <div className="mt-[1px] grid grid-cols-3 gap-2">
              {["S1", "S2", "S3"].map((k, i) => (
                <div key={k} className="border-b border-neutral-800/70 pb-[2px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">{k}</span>
                    <span className={`text-[10px] ${mono} text-neutral-200`}>
                      {[f.telemetry.s1, f.telemetry.s2, f.telemetry.s3][i]}
                    </span>
                  </div>
                  <div className={`text-right text-[8px] leading-tight ${mono} text-neutral-500`}>
                    {((sectors[i] / sectorSum) * 100).toFixed(1)}%
                    <span className="ml-1 text-neutral-600">{sgn(sectors[i] - sectorSum / 3, 3)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex items-baseline justify-between text-[9px]">
              <span className="uppercase tracking-[0.1em] text-neutral-500">Best</span>
              <span className={`${mono} text-neutral-300`}>{f.telemetry.bestLap}</span>
            </div>
          </Panel>
        </div>

        {/* ============ BANDEN / BRANDSTOF / PACE ============ */}
        <div className="grid grid-cols-12 gap-[3px]">
          <Panel
            title="Bandenkruis"
            right={`set ${f.tyres.setLaps} r · ${f.tyres.compound}`}
            className="col-span-12 md:col-span-6 lg:col-span-4"
          >
            <div className="grid grid-cols-2 gap-px bg-neutral-800">
              {corners.map(({ code, c, axle }) => {
                const hot = c.wear >= 95;
                return (
                  <div key={code} className="bg-[#0d0f11] px-1.5 py-[5px]">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[9px] font-semibold tracking-[0.1em] text-neutral-400">{code}</span>
                      <span className="text-[7px] uppercase tracking-[0.1em] text-neutral-600">{axle}</span>
                    </div>
                    <div className="mt-[2px] flex items-baseline gap-1">
                      <span
                        className={`text-[16px] font-semibold leading-none ${mono} ${hot ? ALERT : "text-neutral-100"}`}
                      >
                        {c.wear.toFixed(1)}
                      </span>
                      <span className="text-[8px] text-neutral-500">% slijtage</span>
                    </div>
                    <div className="mt-[3px]">
                      <Bar pct={((c.wear - 80) / 20) * 100} alert={hot} h="h-[4px]" />
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className={`text-[10px] ${mono} text-neutral-300`}>{c.tempC}°C</span>
                      <span className={`text-[9px] ${mono} text-neutral-500`}>
                        rest {restLaps(c.wear).toFixed(1)} r
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-1 grid grid-cols-3 gap-px bg-neutral-800">
              <div className="bg-[#101214] px-1.5 py-1">
                <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Grade</div>
                <div className={`text-[13px] font-semibold leading-none ${mono} text-neutral-100`}>{f.tyres.grade}</div>
              </div>
              <div className="bg-[#101214] px-1.5 py-1">
                <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Setleeftijd</div>
                <div className={`text-[13px] font-semibold leading-none ${mono} text-neutral-100`}>
                  {f.tyres.setLaps} r
                </div>
              </div>
              <div className="bg-[#101214] px-1.5 py-1">
                <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Spreiding</div>
                <div className={`text-[13px] font-semibold leading-none ${mono} text-neutral-100`}>
                  {f2(wearSpread)} %
                </div>
              </div>
            </div>

            <div className="mt-1 flex items-baseline justify-between text-[9px]">
              <span className="uppercase tracking-[0.08em] text-neutral-500">Bereik slijtage</span>
              <span className={`${mono} text-neutral-300`}>
                {f2(f.tyres.wearRange[0])}–{f2(f.tyres.wearRange[1])} %/r
              </span>
            </div>
            <div className="mt-[3px] text-[8px] leading-tight text-neutral-500">{f.tyres.note}</div>
          </Panel>

          <Panel
            title="Brandstof"
            right={`${f.fuel.litres.toFixed(1)} / ${f.fuel.tankLitres} L`}
            className="col-span-12 md:col-span-6 lg:col-span-4"
          >
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[8px] uppercase tracking-[0.14em] text-neutral-500">In tank</div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-[24px] font-semibold leading-none ${mono} text-neutral-50`}>
                    {f.fuel.litres.toFixed(1)}
                  </span>
                  <span className="text-[9px] text-neutral-500">L</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[8px] uppercase tracking-[0.14em] text-neutral-500">Ronden over</div>
                <div className={`text-[24px] font-semibold leading-none ${mono} ${ALERT}`}>
                  {Math.floor(lapsOnFuel)}
                </div>
                <div className={`text-[8px] ${mono} text-neutral-500`}>{f1(lapsOnFuel)} berekend</div>
              </div>
            </div>

            <div className="relative mt-1.5">
              <Bar pct={(f.fuel.litres / f.fuel.tankLitres) * 100} alert h="h-[8px]" />
              <div className="mt-[2px] flex justify-between text-[8px] text-neutral-600">
                <span className={mono}>0</span>
                <span className={mono}>tank {f.fuel.tankLitres} L</span>
              </div>
            </div>

            <div className="mt-1">
              <Row label="Per ronde" value={f2(f.fuel.perLap)} unit="L" />
              <Row label="Bijtanken" value={`+${f.fuel.toAddLitres}`} unit="L" strong />
              <Row label="Na tanken" value={f1(afterRefuel)} unit={`L · ${f1(lapsAfterRefuel)} r`} />
              <Row label="Rijdt dan tot" value={`R${rangeToLap}`} tone="muted" />
              <Row label="Nodig tot finish" value={f2(f.fuel.toFinishLitres)} unit="L" />
            </div>
          </Panel>

          <Panel
            title="Pace"
            right={`${f.pace.length} r · spreiding ${(pWorst - pBest).toFixed(2)} s`}
            className="col-span-12 lg:col-span-4"
          >
            <PaceChart pace={f.pace} bestLap={bestLapS} />
            <div className="mt-1 grid grid-cols-4 gap-px bg-neutral-800">
              {[
                { k: "Snelste", v: pBest.toFixed(3) },
                { k: "Traagste", v: pWorst.toFixed(3) },
                { k: "Laatste 5", v: pLast.toFixed(3) },
                { k: "Trend", v: sgn(trend, 3) },
              ].map((s, i) => (
                <div key={s.k} className="bg-[#101214] px-1.5 py-1">
                  <div className="text-[8px] uppercase tracking-[0.08em] text-neutral-500">{s.k}</div>
                  <div
                    className={`text-[11px] leading-none ${mono} ${
                      i === 3 && trend > 0 ? ALERT : "text-neutral-200"
                    }`}
                  >
                    {s.v}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex items-baseline justify-between text-[8px] text-neutral-600">
              <span>Seconden · gemiddelde over {f.pace.length} ronden</span>
              <span className={mono}>
                gem {avg(f.pace).toFixed(3)} · best {mmss(bestLapS)}
              </span>
            </div>
          </Panel>
        </div>

        {/* ============ KLASSEMENT / WISSEL / WEER ============ */}
        <div className="grid grid-cols-12 gap-[3px]">
          <section className="col-span-12 flex min-w-0 flex-col border border-neutral-800 bg-[#101214] lg:col-span-8">
            <header className="flex items-baseline justify-between gap-2 border-b border-neutral-800 bg-[#171a1d] px-2 py-[3px]">
              <h2 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                Klassement per klasse
              </h2>
              <span className={`text-[9px] ${mono} text-neutral-500`}>
                totaal {f.standings.length} · {pitCars} in pit
              </span>
            </header>
            <div className="flex flex-col gap-[3px] bg-[#0d0f11] p-[3px] sm:flex-row">
              {classes.map((cls) => {
                const rows = byClass(cls);
                return (
                  <div key={cls} className="min-w-0 flex-1 border border-neutral-800 bg-[#101214]">
                    <div className="flex items-baseline justify-between border-b border-neutral-800 bg-[#14171a] px-1.5 py-[3px]">
                      <span className="text-[9px] font-semibold tracking-[0.12em] text-neutral-200">{cls}</span>
                      <span className={`text-[8px] ${mono} text-neutral-500`}>{rows.length} auto's</span>
                    </div>
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>
                        <col className="w-[20px]" />
                        <col className="w-[20px]" />
                        <col />
                        <col className="w-[42px]" />
                        <col className="w-[46px]" />
                        <col className="w-[24px]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-neutral-800 text-[7.5px] uppercase tracking-[0.1em] text-neutral-500">
                          <th className="px-1 py-[2px] text-left font-normal">K</th>
                          <th className="px-0.5 py-[2px] text-left font-normal">P</th>
                          <th className="px-1 py-[2px] text-left font-normal">Coureur / auto</th>
                          <th className="px-1 py-[2px] text-right font-normal">Gap</th>
                          <th className="px-1 py-[2px] text-right font-normal">Laatste</th>
                          <th className="px-1 py-[2px] text-right font-normal">Bnd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => (
                          <tr
                            key={`${s.cls}-${s.pos}`}
                            className={`border-b border-neutral-800/60 last:border-b-0 ${
                              s.isSelf ? "bg-[#1d2126]" : s.inPit ? "bg-[#16181b]" : ""
                            }`}
                          >
                            <td
                              className={`border-l-2 px-1 py-[2px] text-[9px] ${mono} ${
                                s.isSelf ? "border-l-neutral-300 text-neutral-100" : "border-l-transparent text-neutral-400"
                              }`}
                            >
                              {s.classPos}
                            </td>
                            <td className={`px-0.5 py-[2px] text-[9px] ${mono} text-neutral-500`}>{s.pos}</td>
                            <td className="min-w-0 px-1 py-[2px]">
                              <div className="flex items-center gap-1">
                                <span
                                  className={`truncate text-[9.5px] leading-tight ${
                                    s.isSelf ? "font-semibold text-neutral-50" : "text-neutral-300"
                                  }`}
                                >
                                  {s.driver}
                                </span>
                                {s.inPit ? (
                                  <span
                                    className={`shrink-0 border border-amber-500/60 px-[2px] text-[7px] font-semibold leading-[10px] ${ALERT}`}
                                  >
                                    PIT
                                  </span>
                                ) : null}
                              </div>
                              <div className="truncate text-[8px] leading-tight text-neutral-600">{s.car}</div>
                            </td>
                            <td
                              className={`px-1 py-[2px] text-right text-[9px] ${mono} ${
                                s.isSelf ? "text-neutral-100" : "text-neutral-400"
                              }`}
                            >
                              {s.gap}
                            </td>
                            <td className={`px-1 py-[2px] text-right text-[9px] ${mono} text-neutral-300`}>
                              {s.lastLap}
                            </td>
                            <td
                              className={`px-1 py-[2px] text-right text-[9px] ${mono} ${
                                s.tyreAgeLaps >= 25 ? ALERT : "text-neutral-500"
                              }`}
                            >
                              {s.tyreAgeLaps}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            <div className="flex items-baseline justify-between border-t border-neutral-800 px-2 py-[2px] text-[8px] text-neutral-500">
              <span>K = klassepositie · P = overall · Bnd = bandenleeftijd in ronden</span>
              <span className={mono}>eigen rij gemarkeerd</span>
            </div>
          </section>

          <div className="col-span-12 flex min-w-0 flex-col gap-[3px] lg:col-span-4">
            <Panel title="Coureurswissel" right={`over ${f.rotation.nextInMinutes} min`}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[8px] uppercase tracking-[0.14em] text-neutral-500">Nu</div>
                  <div className="truncate text-[12px] font-semibold leading-tight text-neutral-50">
                    {f.rotation.current}
                  </div>
                </div>
                <div className={`text-[14px] ${mono} text-neutral-600`}>→</div>
                <div className="min-w-0 text-right">
                  <div className="text-[8px] uppercase tracking-[0.14em] text-neutral-500">Volgende</div>
                  <div className="truncate text-[12px] font-semibold leading-tight text-neutral-200">
                    {f.rotation.next}
                  </div>
                </div>
              </div>

              <div className="relative mt-2 h-[10px] w-full bg-neutral-800">
                <div
                  className="absolute inset-y-0 left-0 bg-neutral-600"
                  style={{
                    width: `${(f.rotation.nextInMinutes / f.rotation.afterInMinutes) * 100}%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 w-[2px] bg-neutral-200"
                  style={{
                    left: `${(f.rotation.nextInMinutes / f.rotation.afterInMinutes) * 100}%`,
                  }}
                />
                <div className="absolute inset-y-0 right-0 w-[2px] bg-neutral-500" />
              </div>
              <div className="mt-[2px] flex justify-between text-[8px] text-neutral-600">
                <span className={mono}>0</span>
                <span className={mono}>{f.rotation.nextInMinutes}m</span>
                <span className={mono}>{f.rotation.afterInMinutes}m</span>
              </div>

              <div className="mt-1">
                <Row label="Wissel in ronden" value={`~${lapsToChange}`} unit="r" tone="muted" />
                <Row label="Daarna" value={f.rotation.after} tone="muted" />
                <Row label="Stintlengte" value={`${stintMinutes}`} unit="min" />
              </div>
            </Panel>

            <Panel title="Weer" right="baan / lucht" className="flex-1">
              <div className="grid grid-cols-3 gap-px bg-neutral-800">
                <div className="bg-[#101214] px-1.5 py-1">
                  <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Lucht</div>
                  <div className={`text-[15px] font-semibold leading-none ${mono} text-neutral-100`}>
                    {f.weather.airC.toFixed(1)}
                    <span className="text-[8px] text-neutral-500">°C</span>
                  </div>
                </div>
                <div className="bg-[#101214] px-1.5 py-1">
                  <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Baan</div>
                  <div className={`text-[15px] font-semibold leading-none ${mono} text-neutral-100`}>
                    {f.weather.trackC.toFixed(1)}
                    <span className="text-[8px] text-neutral-500">°C</span>
                  </div>
                </div>
                <div className="bg-[#101214] px-1.5 py-1">
                  <div className="text-[8px] uppercase tracking-[0.1em] text-neutral-500">Δ baan</div>
                  <div className={`text-[15px] font-semibold leading-none ${mono} text-neutral-400`}>
                    {sgn(f.weather.trackC - f.weather.airC)}
                  </div>
                </div>
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[9px]">
                <span className="uppercase tracking-[0.08em] text-neutral-500">Rubber</span>
                <span className="text-neutral-300">{f.weather.rubber}</span>
              </div>
              <div className="mt-1 border-t border-neutral-800 pt-1">
                <Row
                  label="Bandentemp gem."
                  value={((f.tyres.fl.tempC + f.tyres.fr.tempC + f.tyres.rl.tempC + f.tyres.rr.tempC) / 4).toFixed(1)}
                  unit="°C"
                  tone="muted"
                />
                <Row
                  label="Voor − achter"
                  value={sgn(
                    (f.tyres.fl.tempC + f.tyres.fr.tempC) / 2 - (f.tyres.rl.tempC + f.tyres.rr.tempC) / 2,
                  )}
                  unit="°C"
                  tone="muted"
                />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
