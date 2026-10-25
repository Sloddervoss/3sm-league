/**
 * Ontwerp 06 — RACE REPORT.
 *
 * De pitwall als voorpagina van een krant: naamplaat, krantenkop, lead,
 * gedrukte kolommen, hairline-regels en een uitslag als resultatentabel.
 * Alle cijfers komen uit de fixture; de statusregel bovenaan houdt het
 * geheel live.
 */
import type { Corner, PitwallFixture, Standing } from "@/lab/fixture";

export const meta = {
  title: "06 — Race report",
  note: "Krantenpagina op de pitmuur: kop, lead, kolommen en gedrukte uitslag.",
};

const INK = "#14120F";
const ACCENT = "#A51C1C";

const CSS = `
.d06-paper {
  background-color: #F4F0E6;
  background-image: radial-gradient(rgba(20, 18, 15, 0.055) 0.5px, transparent 0.6px);
  background-size: 3px 3px;
}
.d06-serif {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
}
.d06-mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
@keyframes d06pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(224, 90, 79, 0.55); }
  50% { opacity: 0.45; box-shadow: 0 0 0 4px rgba(224, 90, 79, 0); }
}
.d06-live-dot { animation: d06pulse 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .d06-live-dot { animation: none; } }
`;

/* ---------- helpers ---------- */

const dec = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const dcomm = (s: string) => s.replace(/\./g, ",");

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, "0").replace(".", ",")}`;
};

const VERDICT: Record<
  PitwallFixture["pit"]["recommendation"],
  { tag: string }
> = {
  STAY_OUT: { tag: "Geen stop in het venster" },
  PIT_SOON: { tag: "Stop komt dichterbij" },
  PIT_NOW: { tag: "Venster is open" },
};

/* ---------- kleine bouwstenen ---------- */

function SectionHead({
  title,
  note,
  right,
  className = "",
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-3 border-b-2 border-[#14120F] pb-1.5 ${className}`}>
      <h3 className="d06-mono text-[10px] font-bold uppercase tracking-[0.28em]">{title}</h3>
      {note ? (
        <span className="d06-serif text-[11px] italic leading-none text-[#14120F]/55">{note}</span>
      ) : null}
      {right ? <div className="d06-mono ml-auto hidden text-[9px] uppercase tracking-[0.16em] text-[#14120F]/55 sm:block">{right}</div> : null}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="d06-mono text-[9px] uppercase leading-none tracking-[0.24em] text-[#14120F]/50">
      {children}
    </div>
  );
}

function CornerTile({ code, place, c }: { code: string; place: string; c: Corner }) {
  return (
    <div className="bg-[#F4F0E6] pt-2">
      <div className="border-t-2 border-[#14120F] pt-1.5">
        <div className="flex items-baseline justify-between">
          <span className="d06-mono text-[11px] font-bold tracking-[0.2em]">{code}</span>
          <span className="d06-mono text-[8px] uppercase tracking-[0.16em] text-[#14120F]/45">{place}</span>
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <span className="d06-mono text-[23px] leading-none tracking-[-0.02em]">
            {dec(c.wear)}
            <span className="ml-0.5 text-[10px] text-[#14120F]/50">%</span>
          </span>
          <span className="d06-mono pb-[2px] text-[11px] text-[#14120F]/60">{dec(c.tempC, 0)}°</span>
        </div>
        <div className="mt-2 h-[5px] w-full bg-[#14120F]/10">
          <div
            className="h-full"
            style={{ width: `${Math.min(100, Math.max(0, c.wear))}%`, backgroundColor: ACCENT }}
          />
        </div>
      </div>
    </div>
  );
}

function StandingRow({ s }: { s: Standing }) {
  return (
    <tr
      className={`border-b border-[#14120F]/10 align-baseline ${
        s.isSelf ? "bg-[#A51C1C]/[0.06]" : ""
      }`}
    >
      <td className="w-9 py-1.5 pl-1 pr-2">
        <span className={`d06-mono text-[12px] ${s.isSelf ? "font-bold" : ""}`}>{s.classPos}</span>
      </td>
      <td className="w-8 py-1.5 pr-2">
        <span className="d06-mono text-[10px] text-[#14120F]/45">{s.pos}</span>
      </td>
      <td className="py-1.5 pr-4">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`d06-serif text-[14px] leading-tight ${s.isSelf ? "font-bold" : ""}`}>
            {s.driver}
          </span>
          {s.isSelf ? (
            <span className="d06-mono bg-[#14120F] px-1 py-[2px] text-[8px] uppercase leading-none tracking-[0.14em] text-[#F4F0E6]">
              Wij
            </span>
          ) : null}
          {s.inPit ? (
            <span className="d06-mono border border-[#A51C1C] px-1 py-[1px] text-[8px] uppercase leading-none tracking-[0.14em] text-[#A51C1C]">
              Pit
            </span>
          ) : null}
        </span>
      </td>
      <td className="hidden py-1.5 pr-4 md:table-cell">
        <span className="d06-serif text-[12px] leading-tight text-[#14120F]/65">{s.car}</span>
      </td>
      <td className="py-1.5 pr-3 text-right">
        <span className="d06-mono text-[11px]">{dcomm(s.gap)}</span>
      </td>
      <td className="hidden py-1.5 pr-3 text-right sm:table-cell">
        <span className="d06-mono text-[11px]">{dcomm(s.lastLap)}</span>
      </td>
      <td className="hidden py-1.5 pr-3 text-right sm:table-cell">
        <span className="d06-mono text-[11px] text-[#14120F]/55">{dcomm(s.bestLap)}</span>
      </td>
      <td className="py-1.5 pr-1 text-right">
        <span className="d06-mono text-[10px] text-[#14120F]/70">{s.tyreAgeLaps} r</span>
      </td>
    </tr>
  );
}

function PaceChart({ values, lastLap }: { values: number[]; lastLap: number }) {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const lo = min - 0.2;
  const hi = max + 0.2;
  const W = 640;
  const H = 168;
  const PL = 42;
  const PR = 14;
  const PT = 16;
  const PB = 24;

  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
  const y = (v: number) => PT + ((v - lo) / (hi - lo)) * (H - PT - PB);

  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - PB} L${PL},${H - PB} Z`;
  const ticks = [min, (min + max) / 2, max];
  const lastIndex = n - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Rondetijden van de laatste rondes">
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PL}
            x2={W - PR}
            y1={y(t)}
            y2={y(t)}
            stroke={INK}
            strokeOpacity={0.12}
            strokeDasharray="2 4"
          />
          <text
            x={PL - 6}
            y={y(t) + 3}
            textAnchor="end"
            fontSize={8.5}
            fill={INK}
            fillOpacity={0.5}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {clock(t)}
          </text>
        </g>
      ))}

      <path d={area} fill={INK} fillOpacity={0.05} />
      <line
        x1={PL}
        x2={W - PR}
        y1={y(avg)}
        y2={y(avg)}
        stroke={ACCENT}
        strokeOpacity={0.55}
        strokeDasharray="5 3"
        strokeWidth={1}
      />
      <path d={line} fill="none" stroke={INK} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />

      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={1.7} fill={INK} fillOpacity={0.75} />
      ))}

      <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r={5.5} fill={ACCENT} fillOpacity={0.16} />
      <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r={2.9} fill={ACCENT} />

      <text
        x={x(lastIndex) - 8}
        y={y(values[lastIndex]) - 9}
        textAnchor="end"
        fontSize={9.5}
        fill={ACCENT}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {clock(values[lastIndex])}
      </text>

      <text
        x={PL}
        y={H - 8}
        fontSize={8.5}
        fill={INK}
        fillOpacity={0.5}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        R{lastLap - (n - 1)}
      </text>
      <text
        x={W - PR}
        y={H - 8}
        textAnchor="end"
        fontSize={8.5}
        fill={INK}
        fillOpacity={0.5}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        R{lastLap}
      </text>
    </svg>
  );
}

/* ---------- pagina ---------- */

export default function Design({ f }: { f: PitwallFixture }) {
  const classes = Array.from(new Set(f.standings.map((s) => s.cls)));
  const stopLap = f.event.lap + f.pit.windowInLaps;
  const reserve = f.fuel.litres - f.fuel.perLap * f.fuel.lapsLeft;
  const tankPct = Math.min(100, Math.max(0, (f.fuel.litres / f.fuel.tankLitres) * 100));
  const verdict = VERDICT[f.pit.recommendation];
  const verdictHead =
    f.pit.recommendation === "PIT_NOW"
      ? "Nu naar binnen"
      : f.pit.recommendation === "STAY_OUT"
        ? "Blijf buiten"
        : `Pit binnen ${f.pit.windowInLaps} ronden`;

  return (
    <div className="d06-paper d06-serif min-h-screen w-full text-[#14120F] antialiased">
      <style>{CSS}</style>

      <div className="mx-auto w-full max-w-[1180px] px-5 pb-16 sm:px-8">
        {/* statusregel */}
        <div className="relative -mx-5 overflow-hidden bg-[#14120F] text-[#F4F0E6] sm:-mx-8">
          <div className="d06-mono flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[10px] uppercase tracking-[0.18em] sm:px-8">
            <span className="inline-flex items-center gap-2 font-bold tracking-[0.3em]">
              <span className="d06-live-dot inline-block h-[6px] w-[6px] rounded-full bg-[#E05A4F]" />
              Live
            </span>
            <span className="h-[9px] w-px bg-[#F4F0E6]/25" />
            <span>
              Ronde <span className="font-bold">{f.event.lap}</span>/{f.event.totalLaps}
            </span>
            <span className="h-[9px] w-px bg-[#F4F0E6]/25" />
            <span>Nog {f.event.timeLeft}</span>
            <span className="h-[9px] w-px bg-[#F4F0E6]/25" />
            <span>Vlag {f.event.flag}</span>
            <span className="h-[9px] w-px bg-[#F4F0E6]/25" />
            <span>
              {f.telemetry.speedKph} km/u · V{f.telemetry.gear} ·{" "}
              {f.telemetry.rpm.toLocaleString("nl-NL")} t/m
            </span>
            <span className="ml-auto pl-3 text-[#F4F0E6]/60">
              S1 {dcomm(f.telemetry.s1)} · S2 {dcomm(f.telemetry.s2)} · S3 {dcomm(f.telemetry.s3)}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#F4F0E6]/15">
            <div
              className="h-full bg-[#E05A4F]"
              style={{ width: `${(f.event.lap / f.event.totalLaps) * 100}%` }}
            />
          </div>
        </div>

        {/* naamplaat */}
        <header className="pt-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="d06-mono text-[9px] uppercase tracking-[0.36em] text-[#14120F]/55">
                3 Stripe Motorsport · Race report van de pitmuur
              </div>
              <h1 className="d06-serif mt-2 text-[clamp(2.9rem,9vw,5.7rem)] font-black leading-[0.84] tracking-[-0.035em]">
                DE PITWALL
              </h1>
              <div className="d06-mono mt-3 text-[9px] uppercase leading-relaxed tracking-[0.16em] text-[#14120F]/70">
                {f.event.name} · {f.event.circuit} · zondag 25 oktober 2026 · editie 06
              </div>
            </div>

            {/* weer */}
            <div className="w-full shrink-0 border border-[#14120F] md:w-[250px]">
              <div className="flex items-center justify-between border-b border-[#14120F] px-3 py-1.5">
                <span className="d06-mono text-[9px] uppercase tracking-[0.28em]">Weer</span>
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
                </svg>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#14120F]/20">
                <div className="bg-[#F4F0E6] px-3 py-2">
                  <Label>Lucht</Label>
                  <div className="d06-mono mt-1 text-[17px] leading-none">{dec(f.weather.airC)}°</div>
                </div>
                <div className="bg-[#F4F0E6] px-3 py-2">
                  <Label>Baan</Label>
                  <div className="d06-mono mt-1 text-[17px] leading-none">{dec(f.weather.trackC)}°</div>
                </div>
              </div>
              <div className="d06-mono border-t border-[#14120F]/25 px-3 py-1.5 text-[8.5px] uppercase leading-relaxed tracking-[0.14em] text-[#14120F]/55">
                Rubber: {f.weather.rubber}
              </div>
            </div>
          </div>
        </header>

        {/* dubbele regel + datalijn */}
        <div className="mt-5" aria-hidden="true">
          <div className="h-[3px] bg-[#14120F]" />
          <div className="mt-[3px] h-px bg-[#14120F]" />
        </div>
        <div className="d06-mono flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-[#14120F]/25 py-1.5 text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">
          <span>{f.event.name}</span>
          <span className="hidden sm:inline">{f.self.team} · {f.self.car}</span>
          <span>Deelnemers: {f.standings.length} auto’s</span>
        </div>

        {/* kop + beslissing */}
        <section className="mt-7 grid gap-8 md:grid-cols-12 md:gap-9">
          <div className="md:col-span-8">
            <div className="flex items-center gap-2">
              <span className="d06-mono bg-[#A51C1C] px-1.5 py-[3px] text-[8px] uppercase leading-none tracking-[0.22em] text-[#F4F0E6]">
                Race report
              </span>
              <span className="d06-mono text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">
                {f.event.name} — ronde {f.event.lap} van {f.event.totalLaps}
              </span>
            </div>

            <h2 className="d06-serif mt-4 text-[clamp(2rem,4.9vw,3.65rem)] font-black leading-[0.94] tracking-[-0.025em]">
              De tank is eerder leeg dan de banden.
            </h2>

            <p className="d06-serif mt-4 max-w-[46ch] text-[16px] italic leading-[1.45] text-[#14120F]/75">
              {f.pit.windowInLaps} ronden marge en {dec(f.pit.pitLossSeconds, 0)} seconden verlies: de
              pitmuur legt de stop in ronde {stopLap}.
            </p>

            <div className="mt-5 border-t border-[#14120F]/25 pt-4 sm:columns-2 sm:gap-8">
              <p className="d06-serif text-[14px] leading-[1.62] first-letter:float-left first-letter:mr-2 first-letter:mt-[6px] first-letter:text-[50px] first-letter:font-bold first-letter:leading-[0.72]">
                {f.self.driver} ligt na {f.event.lap} van de {f.event.totalLaps} ronden derde overall en
                tweede in {f.self.cls}. Het gat naar voren is {dcomm(f.gaps.ahead)} seconden, de marge naar
                achteren {dcomm(f.gaps.behind.replace("-", ""))}. Voor de pitmuur is niet de vraag of de auto
                vooruit komt, maar hoe lang de brandstof meegaat.
              </p>
              <p className="d06-serif mt-3 text-[14px] leading-[1.62]">
                De rekensom is hard: {dec(f.fuel.litres)} liter bij {dec(f.fuel.perLap, 2)} liter per ronde
                geeft {f.fuel.lapsLeft} ronden, met {dec(reserve)} liter over. De bandenset is pas{" "}
                {f.tyres.setLaps} ronden oud en meet {dec(f.tyres.fl.wear)} tot {dec(f.tyres.rr.wear)} procent
                wear. De tank is de beperkende factor, niet het rubber.
              </p>
              <p className="d06-mono mt-3 text-[8px] uppercase tracking-[0.18em] text-[#14120F]/45">
                Van de pitmuur · {f.event.circuit}
              </p>
            </div>
          </div>

          {/* beslissing */}
          <aside className="md:col-span-4">
            <div className="border border-[#14120F]">
              <div className="d06-mono border-b border-[#14120F] bg-[#14120F] px-3.5 py-1.5 text-[9px] uppercase tracking-[0.3em] text-[#F4F0E6]">
                De beslissing
              </div>
              <div className="px-3.5 pb-3.5 pt-3">
                <div className="d06-mono text-[8px] uppercase tracking-[0.24em] text-[#A51C1C]">
                  Advies pitmuur
                </div>
                <div className="d06-serif mt-1.5 text-balance text-[26px] font-black uppercase leading-[0.98] tracking-[-0.01em]">
                  {verdictHead}
                </div>
                <p className="d06-serif mt-3 text-[13px] italic leading-[1.45] text-[#14120F]/80">
                  “{f.pit.reason}.”
                </p>

                <dl className="mt-4 border-t border-[#14120F]/25">
                  <div className="flex items-baseline justify-between border-b border-[#14120F]/15 py-2">
                    <dt className="d06-mono text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">
                      Pitvenster
                    </dt>
                    <dd className="d06-mono text-[12px]">
                      R{f.event.lap} – R{stopLap}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-[#14120F]/15 py-2">
                    <dt className="d06-mono text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">
                      Pitverlies
                    </dt>
                    <dd className="d06-mono text-[12px]">{dec(f.pit.pitLossSeconds, 0)} s</dd>
                  </div>
                  <div className="flex items-baseline justify-between py-2">
                    <dt className="d06-mono text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">
                      Marge
                    </dt>
                    <dd className="d06-mono text-[12px]">{f.pit.windowInLaps} ronden</dd>
                  </div>
                </dl>

                <div className="d06-mono mt-1 border-t-2 border-[#A51C1C] pt-2 text-[8px] uppercase tracking-[0.16em] text-[#14120F]/55">
                  {verdict.tag}
                </div>
              </div>
            </div>
          </aside>
        </section>

        {/* stand van zaken */}
        <section className="mt-7 grid grid-cols-2 gap-px border-y-2 border-[#14120F] bg-[#14120F]/20 md:grid-cols-4">
          <div className="bg-[#F4F0E6] px-3.5 py-3">
            <Label>Positie</Label>
            <div className="d06-mono mt-1 text-[26px] leading-none tracking-[-0.03em]">
              P{f.self.pos}
              <span className="ml-1 text-[11px] text-[#14120F]/50">/ {f.standings.length}</span>
            </div>
            <div className="d06-serif mt-1 text-[11px] italic text-[#14120F]/60">
              P{f.self.classPos} in {f.self.cls}
            </div>
          </div>
          <div className="bg-[#F4F0E6] px-3.5 py-3">
            <Label>Voor</Label>
            <div className="d06-mono mt-1 text-[26px] leading-none tracking-[-0.03em]">
              {dcomm(f.gaps.ahead)}
            </div>
            <div className="d06-serif mt-1 text-[11px] italic text-[#14120F]/60">{f.gaps.aheadName}</div>
          </div>
          <div className="bg-[#F4F0E6] px-3.5 py-3">
            <Label>Achter</Label>
            <div className="d06-mono mt-1 text-[26px] leading-none tracking-[-0.03em]">
              {dcomm(f.gaps.behind)}
            </div>
            <div className="d06-serif mt-1 text-[11px] italic text-[#14120F]/60">{f.gaps.behindName}</div>
          </div>
          <div className="bg-[#F4F0E6] px-3.5 py-3">
            <Label>Laatste ronde</Label>
            <div className="d06-mono mt-1 text-[26px] leading-none tracking-[-0.03em]">
              {dcomm(f.telemetry.lastLap)}
            </div>
            <div className="d06-serif mt-1 text-[11px] italic text-[#14120F]/60">
              best {dcomm(f.telemetry.bestLap)}
            </div>
          </div>
        </section>

        {/* banden + brandstof */}
        <div className="grid gap-9 md:grid-cols-12 md:gap-9">
          <section className="md:col-span-7">
            <SectionHead title="Banden" note="kruis, laatste meting" className="mt-9" />

            <div className="relative mt-5">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#14120F]/20" />
                <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-[#14120F]/20" />
                <div className="d06-mono absolute left-1/2 top-1/2 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[2px] border border-[#14120F]/30 bg-[#F4F0E6] text-[7px] uppercase tracking-[0.1em] text-[#14120F]/40 sm:grid">
                  Car
                </div>
              </div>

              <div className="relative grid grid-cols-2 gap-x-6 gap-y-3 sm:gap-x-14 sm:gap-y-4">
                <CornerTile code="LV" place="linksvoor" c={f.tyres.fl} />
                <CornerTile code="RV" place="rechtsvoor" c={f.tyres.fr} />
                <CornerTile code="LA" place="linksachter" c={f.tyres.rl} />
                <CornerTile code="RA" place="rechtsachter" c={f.tyres.rr} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-px border border-[#14120F]/25 bg-[#14120F]/20 sm:grid-cols-4">
              <div className="bg-[#F4F0E6] px-3 py-2">
                <Label>Setleeftijd</Label>
                <div className="d06-mono mt-1 text-[14px] leading-none">{f.tyres.setLaps} ronden</div>
              </div>
              <div className="bg-[#F4F0E6] px-3 py-2">
                <Label>Compound</Label>
                <div className="d06-serif mt-1 text-[13px] leading-none">{f.tyres.compound}</div>
              </div>
              <div className="bg-[#F4F0E6] px-3 py-2">
                <Label>Grade</Label>
                <div className="d06-mono mt-1 text-[14px] leading-none">
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center border border-[#14120F] text-[10px] font-bold">
                    {f.tyres.grade}
                  </span>
                </div>
              </div>
              <div className="bg-[#F4F0E6] px-3 py-2">
                <Label>Per ronde</Label>
                <div className="d06-mono mt-1 text-[14px] leading-none">
                  {dec(f.tyres.wearRange[0])}–{dec(f.tyres.wearRange[1])} %
                </div>
              </div>
            </div>

            <p className="d06-serif mt-2 text-[10.5px] italic leading-snug text-[#14120F]/55">
              † {f.tyres.note}. Wear in procenten, temperatuur in °C.
            </p>
          </section>

          <section className="md:col-span-5 md:border-l md:border-[#14120F]/20 md:pl-8">
            <SectionHead title="Brandstof" note="tank, bereik, bijtanken" className="mt-9" />

            <div className="mt-4 flex items-end justify-between gap-4 border-b border-[#14120F]/25 pb-3">
              <div>
                <Label>In de tank</Label>
                <div className="d06-mono mt-1 text-[42px] leading-[0.9] tracking-[-0.04em]">
                  {dec(f.fuel.litres)}
                  <span className="ml-1 text-[14px] tracking-normal text-[#14120F]/55">L</span>
                </div>
              </div>
              <div className="text-right">
                <Label>Rondes over</Label>
                <div className="d06-mono mt-1 text-[42px] leading-[0.9] tracking-[-0.04em] text-[#A51C1C]">
                  {f.fuel.lapsLeft}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="relative h-[18px] w-full border border-[#14120F]/40">
                <div className="h-full bg-[#14120F]" style={{ width: `${tankPct}%` }} />
                <div
                  className="absolute inset-y-0 w-[2px] bg-[#A51C1C]"
                  style={{ left: `calc(${tankPct}% - 2px)` }}
                />
              </div>
              <div className="d06-mono mt-1 flex justify-between text-[8px] uppercase tracking-[0.12em] text-[#14120F]/50">
                <span>0</span>
                <span>{dec(tankPct, 0)}% gevuld</span>
                <span>tank {dec(f.fuel.tankLitres)} L</span>
              </div>
            </div>

            <dl className="mt-4 border-y border-[#14120F]/25">
              {[
                ["Per ronde", `${dec(f.fuel.perLap, 2)} L`],
                ["Reserve na venster", `${dec(reserve)} L`],
                ["Bijtanken", `+${dec(f.fuel.toAddLitres)} L`],
                ["Nodig tot finish", `${dec(f.fuel.toFinishLitres, 2)} L`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-[#14120F]/12 py-2 last:border-b-0">
                  <dt className="d06-mono text-[8.5px] uppercase tracking-[0.2em] text-[#14120F]/55">{k}</dt>
                  <dd className="d06-mono text-[12px]">{v}</dd>
                </div>
              ))}
            </dl>

            <p className="d06-serif mt-2 text-[10.5px] italic leading-snug text-[#14120F]/55">
              Na {f.fuel.lapsLeft} ronden blijft er {dec(reserve)} liter over; het venster sluit in ronde{" "}
              {stopLap}.
            </p>
          </section>
        </div>

        {/* pace + wissel */}
        <div className="grid gap-9 md:grid-cols-12 md:gap-9">
          <section className="md:col-span-7">
            <SectionHead
              title="Rondetijden"
              note={`laatste ${f.pace.length} ronden — lager is beter`}
              className="mt-9"
            />
            <div className="mt-4 border border-[#14120F]/25 px-3 pb-2 pt-3">
              <div className="d06-mono mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[8.5px] uppercase tracking-[0.16em] text-[#14120F]/55">
                <span>
                  Gemiddelde{" "}
                  <span className="text-[#14120F]">
                    {clock(f.pace.reduce((a, b) => a + b, 0) / f.pace.length)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-px w-4 bg-[#A51C1C]" /> gemiddelde
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-3 bg-[#14120F]" /> rondetijd
                  </span>
                </span>
              </div>
              <PaceChart values={f.pace} lastLap={f.event.lap} />
            </div>
          </section>

          <section className="flex flex-col md:col-span-5 md:border-l md:border-[#14120F]/20 md:pl-8">
            <SectionHead title="Coureurswissel" note="stintplanning" className="mt-9" />

            <ol className="mt-4">
              {[
                { time: "Nu", name: f.rotation.current, role: "In de auto", live: true },
                { time: `+${f.rotation.nextInMinutes} min`, name: f.rotation.next, role: "Volgende", live: false },
                { time: `+${f.rotation.afterInMinutes} min`, name: f.rotation.after, role: "Daarna", live: false },
              ].map((n, i, arr) => (
                <li key={n.name} className="grid grid-cols-[54px_16px_1fr] items-stretch">
                  <div className="d06-mono pt-[5px] text-[9px] uppercase tracking-[0.12em] text-[#14120F]/50">
                    {n.time}
                  </div>
                  <div className="relative flex justify-center">
                    {i < arr.length - 1 ? (
                      <span className="absolute inset-y-0 w-px bg-[#14120F]/25" aria-hidden="true" />
                    ) : (
                      <span className="absolute top-0 h-[10px] w-px bg-[#14120F]/25" aria-hidden="true" />
                    )}
                    <span
                      className={`relative mt-[7px] h-[7px] w-[7px] rounded-full ${
                        n.live ? "bg-[#A51C1C]" : "bg-[#F4F0E6] ring-1 ring-[#14120F]/45"
                      }`}
                    />
                  </div>
                  <div className="pb-5 pt-[2px]">
                    <div className={`d06-serif text-[16px] leading-tight ${n.live ? "font-bold" : ""}`}>
                      {n.name}
                    </div>
                    <div className="d06-mono mt-0.5 text-[8px] uppercase tracking-[0.2em] text-[#14120F]/45">
                      {n.role}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="d06-mono mt-auto border-t border-[#14120F]/25 pt-2 text-[8px] uppercase leading-relaxed tracking-[0.14em] text-[#14120F]/55">
              Stint van {f.rotation.current}: {f.tyres.setLaps} ronden op deze set
            </div>
          </section>
        </div>

        {/* klassement */}
        <section className="mt-9">
          <SectionHead
            title="Klassement"
            note={`per klasse · na ronde ${f.event.lap}`}
            right={`${f.standings.length} auto’s · ${classes.length} klassen`}
          />

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse sm:min-w-[560px]">
              <thead>
                <tr className="d06-mono border-b border-[#14120F]/40 text-[8.5px] uppercase tracking-[0.18em] text-[#14120F]/55">
                  <th className="py-1.5 pl-1 pr-2 text-left font-normal">Kl</th>
                  <th className="w-8 py-1.5 pr-2 text-left font-normal">#</th>
                  <th className="py-1.5 pr-4 text-left font-normal">Coureur</th>
                  <th className="hidden py-1.5 pr-4 text-left font-normal md:table-cell">Auto</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Gat</th>
                  <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Laatste</th>
                  <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Beste</th>
                  <th className="py-1.5 pr-1 text-right font-normal">Banden</th>
                </tr>
              </thead>

              {classes.map((cls) => {
                const rows = f.standings
                  .filter((s) => s.cls === cls)
                  .sort((a, b) => a.classPos - b.classPos);
                const selfInClass = rows.find((s) => s.isSelf);

                return (
                  <tbody key={cls}>
                    <tr>
                      <td colSpan={8} className="pb-1 pt-4">
                        <div className="flex items-baseline justify-between border-b-2 border-[#14120F] pb-1">
                          <span className="d06-serif text-[15px] font-bold leading-none">{cls}</span>
                          <span className="d06-mono text-[8px] uppercase tracking-[0.18em] text-[#14120F]/50">
                            {rows.length} auto’s
                            {selfInClass ? ` · wij P${selfInClass.classPos}` : ""}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {rows.map((s) => (
                      <StandingRow key={s.pos} s={s} />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          <p className="d06-serif mt-2 text-[10.5px] italic leading-snug text-[#14120F]/55">
            Klassement per klasse, gesorteerd op positie in de klasse. GAT is het verschil met de algemene
            leider. PIT markeert een auto die op dit moment binnen is; “r” is de leeftijd van de bandenset
            in ronden.
          </p>
        </section>

        {/* voettekst */}
        <footer className="mt-9 border-t-[3px] border-[#14120F] pt-2">
          <div className="d06-mono flex flex-wrap items-center justify-between gap-x-5 gap-y-1 text-[8.5px] uppercase tracking-[0.16em] text-[#14120F]/55">
            <span>De Pitwall · editie 06 · {f.event.name}</span>
            <span className="hidden sm:inline">Samengesteld op de pitmuur uit live timing</span>
            <span>Pagina 06</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
