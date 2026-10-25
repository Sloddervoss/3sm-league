import type { ReactNode } from "react";
import type { Corner, PitwallFixture, Standing } from "@/lab/fixture";

export const meta = {
  title: "TELEMETRY TERMINAL",
  note: "Fosforgroen op bijna-zwart: een engineersterminal met ASCII-kaders, strak uitgelijnde kolommen en scanlines, waarbij de cijfers leidend blijven.",
};

/* ------------------------------------------------------------------ */
/* tokens + helpers                                                    */
/* ------------------------------------------------------------------ */

const LBL = "text-[10px] uppercase tracking-[0.16em] text-[#4f8a66]";
const LBL_TIGHT = "text-[9px] uppercase tracking-[0.12em] text-[#3f7352]";
const NUM = "tabular-nums";

function toSeconds(lap: string): number {
  const parts = lap.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[parts.length - 1] ?? 0;
}

function secToLap(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

function wearTone(w: number): string {
  if (w >= 88) return "text-[#4dff9c]";
  if (w >= 75) return "text-[#ffc35c]";
  return "text-[#ff6f61]";
}

function tempTone(t: number): string {
  if (t >= 96) return "text-[#ff6f61]";
  if (t >= 78) return "text-[#4dff9c]";
  return "text-[#6fe3ff]";
}

function flagTone(flag: string): { text: string; dot: string } {
  const f = flag.toLowerCase();
  if (f.startsWith("rood") || f.includes("red")) return { text: "text-[#ff6f61]", dot: "bg-[#ff6f61]" };
  if (f.startsWith("geel") || f.includes("yellow")) return { text: "text-[#ffc35c]", dot: "bg-[#ffc35c]" };
  return { text: "text-[#4dff9c]", dot: "bg-[#4dff9c]" };
}

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function Bar({
  value,
  max,
  segments = 16,
  tone = "bg-[#2fbd74]",
  className = "",
}: {
  value: number;
  max: number;
  segments?: number;
  tone?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const filled = Math.round(pct * segments);
  return (
    <div className={`flex gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={`h-[5px] flex-1 ${i < filled ? tone : "bg-[#0f2418]"}`}
        />
      ))}
    </div>
  );
}

function Panel({
  code,
  title,
  meta,
  children,
  className = "",
  tone = "border-[#173d28]",
}: {
  code: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <section className={`relative border ${tone} bg-[#060c08]/90 ${className}`}>
      <CornerMark pos="tl" />
      <CornerMark pos="tr" />
      <CornerMark pos="bl" />
      <CornerMark pos="br" />
      <header className="flex items-baseline justify-between gap-2 border-b border-[#12301f] bg-[#08120c] px-2.5 py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[10px] text-[#2f6b46]">{code}</span>
          <h2 className="truncate text-[11px] uppercase tracking-[0.2em] text-[#d9ffe8]">{title}</h2>
        </div>
        <div className={`shrink-0 ${LBL_TIGHT}`}>{meta}</div>
      </header>
      <div className="px-2.5 py-2">{children}</div>
    </section>
  );
}

function CornerMark({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const map: Record<string, string> = {
    tl: "left-[-1px] top-[-1px]",
    tr: "right-[-1px] top-[-1px]",
    bl: "left-[-1px] bottom-[-1px]",
    br: "right-[-1px] bottom-[-1px]",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute select-none text-[10px] leading-none text-[#2c6042] ${map[pos]}`}
    >
      +
    </span>
  );
}

function KV({ k, v, tone = "text-[#d6ffe6]" }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-[#12291c] py-[5px] last:border-b-0">
      <span className={LBL}>{k}</span>
      <span className={`${NUM} text-[12px] ${tone}`}>{v}</span>
    </div>
  );
}

function RowLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center">
      <span className={`${LBL_TIGHT} [writing-mode:vertical-rl]`}>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */

function Header({ f }: { f: PitwallFixture }) {
  const flag = flagTone(f.event.flag);
  return (
    <header className="border border-[#1d4a31] bg-[#07100a]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#12301f] px-2.5 py-1.5">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] text-[#3f7352]">
          <span className="text-[#4dff9c]">3SM</span>
          <span>/</span>
          <span>PITWALL</span>
          <span>/</span>
          <span>TERMINAL</span>
          <span className="text-[#234b35]">::</span>
          <span className="text-[#2f6b46]">READ-ONLY FEED</span>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="flex items-center gap-1.5 text-[#a9ecc1]">
            <span className={`inline-block h-[6px] w-[6px] ${flag.dot} pw4-pulse`} />
            <span className={LBL_TIGHT}>FLAG</span>
            <span className={`uppercase tracking-[0.18em] ${flag.text}`}>{f.event.flag}</span>
          </span>
          <span className="text-[#a9ecc1]">
            <span className={LBL_TIGHT}>LAP</span>{" "}
            <span className={`${NUM} text-[13px] text-[#e4fff0]`}>
              {String(f.event.lap).padStart(3, "0")}
            </span>
            <span className="text-[#3f7352]">/{f.event.totalLaps}</span>
          </span>
          <span className="text-[#a9ecc1]">
            <span className={LBL_TIGHT}>T-</span>{" "}
            <span className={`${NUM} text-[13px] text-[#e4fff0]`}>{f.event.timeLeft}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-2 px-2.5 py-2 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-[#2f6b46]">▌</span>
            <h1 className="truncate text-[17px] uppercase tracking-[0.14em] text-[#e4fff0] pw4-glow sm:text-[20px]">
              {f.event.name}
            </h1>
          </div>
          <p className="mt-0.5 truncate pl-[15px] text-[11px] tracking-[0.08em] text-[#4f8a66]">
            {f.event.circuit} <span className="text-[#234b35]">//</span> {f.self.cls}{" "}
            <span className="text-[#234b35]">//</span> {f.self.car}
          </p>
        </div>
        <div className="flex items-end gap-5 md:justify-end">
          <div>
            <div className={LBL}>POS TOTAAL</div>
            <div className={`${NUM} text-[22px] leading-none text-[#e4fff0]`}>
              P{f.self.pos}
            </div>
          </div>
          <div>
            <div className={LBL}>POS KLASSE</div>
            <div className={`${NUM} text-[22px] leading-none text-[#4dff9c]`}>
              P{f.self.classPos}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className={LBL}>COUREUR</div>
            <div className="truncate text-[12px] uppercase tracking-[0.1em] text-[#d9ffe8]">
              {f.self.driver}
            </div>
            <div className="truncate text-[10px] text-[#3f7352]">{f.self.team}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* telemetry strip                                                     */
/* ------------------------------------------------------------------ */

function TelemetryStrip({ f }: { f: PitwallFixture }) {
  const t = f.telemetry;
  const delta = toSeconds(t.lastLap) - toSeconds(t.bestLap);

  return (
    <div className="mt-3 grid grid-cols-2 border border-[#173d28] bg-[#060c08] sm:grid-cols-4 xl:grid-cols-8">
      <Cell label="SPD" unit="KM/H">
        <span className={`${NUM} text-[20px] text-[#e4fff0]`}>{t.speedKph}</span>
        <Bar value={t.speedKph} max={300} segments={10} tone="bg-[#2fbd74]" className="mt-1.5" />
      </Cell>
      <Cell label="GEAR" unit="VERSN.">
        <span className={`${NUM} text-[20px] text-[#e4fff0]`}>{t.gear}</span>
        <div className="mt-1.5 flex gap-[2px]">
          {[1, 2, 3, 4, 5, 6].map((g) => (
            <span
              key={g}
              className={`h-[5px] flex-1 ${g <= t.gear ? "bg-[#4dff9c]" : "bg-[#0f2418]"}`}
            />
          ))}
        </div>
      </Cell>
      <Cell label="RPM" unit="MIN">
        <span className={`${NUM} text-[20px] text-[#e4fff0]`}>{t.rpm}</span>
        <Bar value={t.rpm} max={8000} segments={10} tone="bg-[#ffc35c]" className="mt-1.5" />
      </Cell>
      <Cell label="S1" unit="SEC">
        <span className={`${NUM} text-[16px] text-[#d6ffe6]`}>{t.s1}</span>
        <span className="mt-1.5 block text-[9px] text-[#3f7352]">SECTOR 1</span>
      </Cell>
      <Cell label="S2" unit="SEC">
        <span className={`${NUM} text-[16px] text-[#d6ffe6]`}>{t.s2}</span>
        <span className="mt-1.5 block text-[9px] text-[#3f7352]">SECTOR 2</span>
      </Cell>
      <Cell label="S3" unit="SEC">
        <span className={`${NUM} text-[16px] text-[#d6ffe6]`}>{t.s3}</span>
        <span className="mt-1.5 block text-[9px] text-[#3f7352]">SECTOR 3</span>
      </Cell>
      <Cell label="LAATSTE" unit="ROND">
        <span className={`${NUM} text-[16px] text-[#e4fff0]`}>{t.lastLap}</span>
        <span className={`mt-1.5 block ${NUM} text-[9px] text-[#ffc35c]`}>
          Δ +{delta.toFixed(3)}
        </span>
      </Cell>
      <Cell label="BEST" unit="ROND">
        <span className={`${NUM} text-[16px] text-[#4dff9c]`}>{t.bestLap}</span>
        <span className="mt-1.5 block text-[9px] text-[#3f7352]">SESSIE</span>
      </Cell>
    </div>
  );
}

function Cell({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="border-b border-r border-[#102a1c] px-2.5 py-2 last:border-r-0">
      <div className="flex items-baseline justify-between">
        <span className={LBL_TIGHT}>{label}</span>
        <span className="text-[8px] tracking-[0.1em] text-[#264a35]">{unit}</span>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* decision                                                            */
/* ------------------------------------------------------------------ */

const DECISION_MAP: Record<
  PitwallFixture["pit"]["recommendation"],
  { gloss: string; tone: string; border: string; bg: string }
> = {
  STAY_OUT: {
    gloss: "BLIJF BUITEN",
    tone: "text-[#4dff9c]",
    border: "border-[#1d4a31]",
    bg: "bg-[#06120b]",
  },
  PIT_SOON: {
    gloss: "BIJNA BINNEN",
    tone: "text-[#ffc35c]",
    border: "border-[#6a4f1d]",
    bg: "bg-[#12100a]",
  },
  PIT_NOW: {
    gloss: "NU BINNEN",
    tone: "text-[#ff6f61]",
    border: "border-[#7a2a25]",
    bg: "bg-[#140a09]",
  },
};

function Decision({ f }: { f: PitwallFixture }) {
  const d = DECISION_MAP[f.pit.recommendation];
  const windowTight = f.pit.windowInLaps <= f.fuel.lapsLeft;

  return (
    <section className={`mt-3 border ${d.border} ${d.bg}`}>
      <div className="grid md:grid-cols-[auto_1fr_auto]">
        <div className="flex items-center gap-3 border-b border-[#1a2a1f] px-3 py-2 md:border-b-0 md:border-r">
          <span className={LBL}>BESLISSING</span>
          <span className={`${d.tone} text-[14px] tracking-[0.18em] pw4-glow sm:text-[16px]`}>
            {f.pit.recommendation}
          </span>
          <span className={`text-[10px] uppercase tracking-[0.16em] ${d.tone} opacity-70`}>
            [{d.gloss}]
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <span className="text-[11px] text-[#2f6b46]">&gt;</span>
          <span className={LBL}>REDEN</span>
          <span className="truncate text-[11px] tracking-[0.04em] text-[#c8f4d8]">
            {f.pit.reason}
          </span>
        </div>

        <div className="flex items-center gap-5 border-t border-[#1a2a1f] px-3 py-2 md:border-l md:border-t-0">
          <div>
            <div className={LBL}>PITVENSTER</div>
            <div className={`${NUM} text-[12px] ${windowTight ? "text-[#ffc35c]" : "text-[#d6ffe6]"}`}>
              +{f.pit.windowInLaps} RONDEN
            </div>
          </div>
          <div>
            <div className={LBL}>PITVERLIES</div>
            <div className={`${NUM} text-[12px] text-[#d6ffe6]`}>
              {f.pit.pitLossSeconds.toFixed(1)} S
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* tyres                                                               */
/* ------------------------------------------------------------------ */

function CornerTile({ label, c }: { label: string; c: Corner }) {
  const toneClass = wearTone(c.wear);
  const barTone =
    c.wear >= 88 ? "bg-[#4dff9c]" : c.wear >= 75 ? "bg-[#ffc35c]" : "bg-[#ff6f61]";

  return (
    <div className="border border-[#143424] bg-[#070e0a] px-2 py-[7px]">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.2em] text-[#6fb98c]">{label}</span>
        <span className="text-[8px] tracking-[0.1em] text-[#2c5a40]">WEAR %</span>
      </div>
      <div className="mt-[3px] flex items-baseline justify-between gap-1">
        <span className={`${NUM} text-[21px] leading-none ${toneClass}`}>
          {c.wear.toFixed(1)}
          <span className="text-[9px] text-[#4f8a66]">%</span>
        </span>
        <span className={`${NUM} text-[13px] ${tempTone(c.tempC)}`}>
          {c.tempC}
          <span className="text-[8px] text-[#4f8a66]">°C</span>
        </span>
      </div>
      <Bar value={c.wear} max={100} segments={12} tone={barTone} className="mt-1.5" />
    </div>
  );
}

function Tyres({ f }: { f: PitwallFixture }) {
  const t = f.tyres;
  const grades = ["A", "B", "C", "D"] as const;

  return (
    <Panel
      code="[02]"
      title="BANDEN"
      meta={<span>{t.compound.toUpperCase()}</span>}
      className="h-full"
    >
      <div className="grid grid-cols-[13px_1fr_1fr] gap-x-2 gap-y-2">
        <RowLabel>VOOR</RowLabel>
        <CornerTile label="LV" c={t.fl} />
        <CornerTile label="RV" c={t.fr} />

        <RowLabel>ACHTER</RowLabel>
        <CornerTile label="LA" c={t.rl} />
        <CornerTile label="RA" c={t.rr} />
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-dotted border-[#173d28] pt-2">
        <KV k="SETLEEFTIJD" v={`${t.setLaps} RONDEN`} />
        <KV k="COMPOUND" v={t.compound.toUpperCase()} />
        <KV k="SLIJTAGE" v={`${t.wearRange[0].toFixed(1)}–${t.wearRange[1].toFixed(1)} %/R`} />
        <div className="flex items-baseline justify-between gap-3 py-[5px]">
          <span className={LBL}>GRADE</span>
          <span className={`${NUM} text-[11px] tracking-[0.1em]`}>
            {grades.map((g) => (
              <span
                key={g}
                className={
                  g === t.grade
                    ? "mx-[1px] border border-[#4dff9c] px-[3px] text-[#4dff9c]"
                    : "mx-[1px] px-[3px] text-[#2f6b46]"
                }
              >
                {g}
              </span>
            ))}
          </span>
        </div>
      </div>

      <p className={`mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-[#4f8a66]`}>
        <span className="text-[#2f6b46]">!</span>
        <span>{t.note}</span>
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* fuel                                                                */
/* ------------------------------------------------------------------ */

function Fuel({ f }: { f: PitwallFixture }) {
  const fu = f.fuel;
  const pct = (fu.litres / fu.tankLitres) * 100;
  const afterRefuel = fu.litres + fu.toAddLitres;
  const buffer = fu.litres - fu.perLap * fu.lapsLeft;
  const low = fu.lapsLeft <= f.pit.windowInLaps + 1;

  return (
    <Panel
      code="[03]"
      title="BRANDSTOF"
      meta={<span>{pct.toFixed(0)}% TANK</span>}
      className="h-full"
      tone={low ? "border-[#5e4a20]" : "border-[#173d28]"}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className={`${NUM} text-[26px] leading-none text-[#e4fff0]`}>
            {fu.litres.toFixed(1)}
          </span>
          <span className="text-[10px] text-[#4f8a66]">L</span>
        </div>
        <span className={`${NUM} text-[11px] text-[#4f8a66]`}>/ {fu.tankLitres.toFixed(1)} L</span>
      </div>

      <Bar
        value={fu.litres}
        max={fu.tankLitres}
        segments={24}
        tone={low ? "bg-[#ffc35c]" : "bg-[#4dff9c]"}
        className="mt-2"
      />

      <div className="mt-1.5 flex justify-between text-[8px] tracking-[0.08em] text-[#2c5a40]">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100%</span>
      </div>

      <div className="mt-2">
        <KV k="PER RONDE" v={`${fu.perLap.toFixed(2)} L`} />
        <KV
          k="RONDES OVER"
          v={fu.lapsLeft}
          tone={low ? "text-[#ffc35c]" : "text-[#d6ffe6]"}
        />
        <KV k="BUFFER" v={`${buffer >= 0 ? "+" : ""}${buffer.toFixed(2)} L`} />
        <KV k="BIJTANKEN" v={`+${fu.toAddLitres.toFixed(1)} L`} tone="text-[#6fe3ff]" />
        <KV k="NA BIJTANKEN" v={`${afterRefuel.toFixed(1)} L`} />
        <KV k="FINISH NODIG" v={`${fu.toFinishLitres.toFixed(2)} L`} />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* gaps                                                                */
/* ------------------------------------------------------------------ */

function Gaps({ f }: { f: PitwallFixture }) {
  return (
    <Panel code="[04]" title="GATEN" meta={<span>{f.self.cls}</span>}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 border border-[#143424] bg-[#070e0a] px-2 py-[6px]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#ffc35c]">▲</span>
            <span className={LBL}>VOOR</span>
          </div>
          <span className="truncate text-[11px] uppercase tracking-[0.1em] text-[#c8f4d8]">
            {f.gaps.aheadName}
          </span>
          <span className={`${NUM} w-[52px] text-right text-[15px] text-[#ffc35c]`}>
            {f.gaps.ahead}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border border-[#1d4a31] bg-[#0b1a11] px-2 py-[6px]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#4dff9c]">●</span>
            <span className={LBL}>ZELF</span>
          </div>
          <span className="truncate text-[11px] uppercase tracking-[0.1em] text-[#e4fff0]">
            {f.self.driver}
          </span>
          <span className={`${NUM} w-[52px] text-right text-[15px] text-[#4dff9c]`}>—</span>
        </div>

        <div className="flex items-center justify-between gap-2 border border-[#143424] bg-[#070e0a] px-2 py-[6px]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#6fe3ff]">▼</span>
            <span className={LBL}>ACHTER</span>
          </div>
          <span className="truncate text-[11px] uppercase tracking-[0.1em] text-[#c8f4d8]">
            {f.gaps.behindName}
          </span>
          <span className={`${NUM} w-[52px] text-right text-[15px] text-[#6fe3ff]`}>
            {f.gaps.behind}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[9px] text-[#3f7352]">
        <span className="tracking-[0.1em]">INTERVAL IN SECONDEN</span>
        <span className="text-[#2c5a40]">Δ T.O.V. ZELF</span>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* standings                                                           */
/* ------------------------------------------------------------------ */

const STANDING_COLS =
  "grid grid-cols-[26px_26px_minmax(0,1fr)_112px_50px_58px_58px_42px_40px] items-baseline gap-x-2";

function StandingRow({ s }: { s: Standing }) {
  const self = s.isSelf;
  return (
    <div
      className={`${STANDING_COLS} border-b border-[#0f2418] px-1.5 py-[5px] text-[11px] ${
        self ? "bg-[#0d2416] text-[#e4fff0]" : "text-[#9adcb1]"
      }`}
    >
      <span className={`${NUM} text-right text-[#4f8a66]`}>{s.pos}</span>
      <span className={`${NUM} text-right ${self ? "text-[#4dff9c]" : "text-[#3f7352]"}`}>
        {s.classPos}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={`truncate uppercase tracking-[0.06em] ${self ? "text-[#e4fff0]" : ""}`}>
          {s.driver}
        </span>
        {self ? (
          <span className="shrink-0 border border-[#2f7d50] px-1 text-[8px] tracking-[0.1em] text-[#4dff9c]">
            SELF
          </span>
        ) : null}
      </span>
      <span className="truncate text-[10px] uppercase tracking-[0.04em] text-[#3f7352]">
        {s.car}
      </span>
      <span className={`${NUM} text-right ${s.pos === 1 ? "text-[#4dff9c]" : "text-[#9adcb1]"}`}>
        {s.gap}
      </span>
      <span className={`${NUM} text-right text-[#9adcb1]`}>{s.lastLap}</span>
      <span className={`${NUM} text-right text-[#4f8a66]`}>{s.bestLap}</span>
      <span className={`${NUM} text-right text-[#6fb98c]`}>{s.tyreAgeLaps}</span>
      <span className="text-right">
        {s.inPit ? (
          <span className="border border-[#6a4f1d] bg-[#1a1509] px-1 text-[8px] tracking-[0.1em] text-[#ffc35c]">
            PIT
          </span>
        ) : (
          <span className="text-[8px] tracking-[0.1em] text-[#264a35]">—</span>
        )}
      </span>
    </div>
  );
}

function Standings({ f }: { f: PitwallFixture }) {
  const classes = Array.from(new Set(f.standings.map((s) => s.cls))).sort((a, b) =>
    a === f.self.cls ? -1 : b === f.self.cls ? 1 : a.localeCompare(b),
  );

  return (
    <Panel
      code="[05]"
      title="KLASSEMENT"
      meta={<span>{f.standings.length} AUTO'S / PER KLASSE</span>}
      className="min-w-0"
    >
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div
            className={`${STANDING_COLS} border-b border-[#173d28] px-1.5 pb-1 text-[8px] uppercase tracking-[0.14em] text-[#3f7352]`}
          >
            <span className="text-right">P</span>
            <span className="text-right">KL</span>
            <span>COUREUR</span>
            <span>AUTO</span>
            <span className="text-right">GAT</span>
            <span className="text-right">LAATSTE</span>
            <span className="text-right">BEST</span>
            <span className="text-right">BND</span>
            <span className="text-right">STAT</span>
          </div>

          {classes.map((cls) => {
            const rows = f.standings
              .filter((s) => s.cls === cls)
              .sort((a, b) => a.classPos - b.classPos);
            const lead = rows[0];
            const mine = cls === f.self.cls;

            return (
              <div key={cls} className="mt-1.5 first:mt-0">
                <div className="flex items-baseline justify-between gap-2 border-b border-[#173d28] bg-[#08120c] px-1.5 py-[3px]">
                  <span className="flex items-baseline gap-2 text-[10px] tracking-[0.16em]">
                    <span className="text-[#4dff9c]">▸</span>
                    <span className="text-[#d9ffe8]">{cls} KLASSE</span>
                    {mine ? (
                      <span className="text-[8px] tracking-[0.1em] text-[#4f8a66]">JOUW KLASSE</span>
                    ) : null}
                  </span>
                  <span className="text-[9px] text-[#3f7352]">
                    LEIDER <span className="text-[#9adcb1]">{lead?.driver}</span>
                  </span>
                </div>
                {rows.map((s) => (
                  <StandingRow key={`${s.pos}-${s.driver}`} s={s} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[8px] tracking-[0.1em] text-[#2f6b46]">
        <span>P = TOTAAL</span>
        <span>KL = KLASSE</span>
        <span>BND = BANDLEEFTIJD IN RONDEN</span>
        <span className="text-[#ffc35c]">PIT = IN DE PITSTRAAT</span>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* pace chart                                                          */
/* ------------------------------------------------------------------ */

function PaceChart({ pace, bestLap }: { pace: number[]; bestLap: string }) {
  const W = 540;
  const H = 150;
  const padL = 44;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const n = pace.length;
  const best = toSeconds(bestLap);
  const lo = Math.min(best, ...pace) - 0.12;
  const hi = Math.max(...pace) + 0.12;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const pts = pace.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${y(lo).toFixed(1)} ${pts} ${x(n - 1).toFixed(1)},${y(lo).toFixed(1)}`;

  const avg = pace.reduce((a, b) => a + b, 0) / n;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  pace.forEach((v, i) => {
    sx += i;
    sy += v;
    sxx += i * i;
    sxy += i * v;
  });
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;

  const ticks = [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Rondetijden verloop"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        <defs>
          <linearGradient id="pw4-pace-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4dff9c" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#4dff9c" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="#12301f"
              strokeWidth="1"
            />
            <text x={padL - 5} y={y(v) + 2.5} fill="#3f7352" fontSize="7" textAnchor="end">
              {secToLap(v)}
            </text>
          </g>
        ))}

        {[0, 5, 10, 15, 19].map((i) => (
          <line
            key={i}
            x1={x(i)}
            x2={x(i)}
            y1={padT}
            y2={H - padB}
            stroke="#0f2418"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ))}

        <line
          x1={padL}
          x2={W - padR}
          y1={y(best)}
          y2={y(best)}
          stroke="#2fbd74"
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.55"
        />

        <polygon points={area} fill="url(#pw4-pace-fill)" />
        <polyline
          points={pts}
          fill="none"
          stroke="#4dff9c"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {pace.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={1.5} fill="#4dff9c" opacity="0.85" />
        ))}

        <circle cx={x(n - 1)} cy={y(pace[n - 1])} r={3.2} fill="#e4fff0" />
        <circle cx={x(n - 1)} cy={y(pace[n - 1])} r={6} fill="none" stroke="#4dff9c" opacity="0.5" />

        <text x={padL} y={H - 4} fill="#2f6b46" fontSize="7">
          -{n}
        </text>
        <text x={x(10)} y={H - 4} fill="#2f6b46" fontSize="7" textAnchor="middle">
          -10
        </text>
        <text x={W - padR} y={H - 4} fill="#2f6b46" fontSize="7" textAnchor="end">
          NU
        </text>
        <text x={W - padR} y={padT + 7} fill="#2f6b46" fontSize="7" textAnchor="end">
          BEST {bestLap}
        </text>
      </svg>

      <div className="mt-1 grid grid-cols-3 gap-2 border-t border-dotted border-[#173d28] pt-1.5">
        <div>
          <div className={LBL_TIGHT}>LAATSTE</div>
          <div className={`${NUM} text-[12px] text-[#e4fff0]`}>{secToLap(pace[n - 1])}</div>
        </div>
        <div>
          <div className={LBL_TIGHT}>GEMIDDELDE</div>
          <div className={`${NUM} text-[12px] text-[#9adcb1]`}>{secToLap(avg)}</div>
        </div>
        <div className="text-right">
          <div className={LBL_TIGHT}>TREND</div>
          <div
            className={`${NUM} text-[12px] ${slope > 0.01 ? "text-[#ffc35c]" : slope < -0.01 ? "text-[#4dff9c]" : "text-[#9adcb1]"}`}
          >
            {slope >= 0 ? "+" : ""}
            {slope.toFixed(3)} S/R
          </div>
        </div>
      </div>
    </div>
  );
}

function Pace({ f }: { f: PitwallFixture }) {
  return (
    <Panel
      code="[06]"
      title="PACE"
      meta={<span>{f.pace.length} RONDEN</span>}
    >
      <PaceChart pace={f.pace} bestLap={f.telemetry.bestLap} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* rotation + weather                                                  */
/* ------------------------------------------------------------------ */

function Rotation({ f }: { f: PitwallFixture }) {
  const r = f.rotation;
  const total = r.afterInMinutes;
  const firstPct = Math.max(6, Math.min(94, (r.nextInMinutes / total) * 100));

  return (
    <Panel code="[07]" title="COUREURSWISSEL" meta={<span>STINT PLAN</span>} className="h-full">
      <div className="flex items-baseline justify-between">
        <div className="min-w-0">
          <div className={LBL}>NU IN AUTO</div>
          <div className="truncate text-[12px] uppercase tracking-[0.08em] text-[#e4fff0]">
            {r.current}
          </div>
        </div>
        <span className="border border-[#2f7d50] px-1 text-[8px] tracking-[0.1em] text-[#4dff9c]">
          ON TRACK
        </span>
      </div>

      <div className="mt-2.5 flex h-[26px] w-full border border-[#143424] bg-[#050b07]">
        <div
          className="flex items-center justify-center border-r border-[#2f7d50] bg-[#0f2a1a] px-1"
          style={{ width: `${firstPct}%` }}
        >
          <span className={`${NUM} text-[8px] text-[#4dff9c]`}>{r.nextInMinutes}M</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-1">
          <span className={`${NUM} text-[8px] text-[#6fb98c]`}>
            {r.afterInMinutes - r.nextInMinutes}M
          </span>
        </div>
      </div>

      <div className="mt-1.5 space-y-[5px]">
        <div className="flex items-baseline justify-between gap-2 border-b border-dotted border-[#12291c] pb-[5px]">
          <span className="flex items-baseline gap-2">
            <span className="text-[9px] text-[#ffc35c]">+{r.nextInMinutes}M</span>
            <span className="truncate text-[11px] uppercase tracking-[0.06em] text-[#d6ffe6]">
              {r.next}
            </span>
          </span>
          <span className={LBL_TIGHT}>VOLGENDE</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="text-[9px] text-[#3f7352]">+{r.afterInMinutes}M</span>
            <span className="truncate text-[11px] uppercase tracking-[0.06em] text-[#9adcb1]">
              {r.after}
            </span>
          </span>
          <span className={LBL_TIGHT}>DAARNA</span>
        </div>
      </div>
    </Panel>
  );
}

function Weather({ f }: { f: PitwallFixture }) {
  const w = f.weather;
  return (
    <Panel code="[08]" title="WEER" meta={<span>BAAN</span>} className="h-full">
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-[#143424] bg-[#070e0a] px-2 py-[6px]">
          <div className={LBL_TIGHT}>LUCHT</div>
          <div className={`${NUM} text-[19px] leading-none text-[#6fe3ff]`}>
            {w.airC.toFixed(1)}
            <span className="text-[9px] text-[#4f8a66]">°C</span>
          </div>
        </div>
        <div className="border border-[#143424] bg-[#070e0a] px-2 py-[6px]">
          <div className={LBL_TIGHT}>BAAN</div>
          <div className={`${NUM} text-[19px] leading-none text-[#ffc35c]`}>
            {w.trackC.toFixed(1)}
            <span className="text-[9px] text-[#4f8a66]">°C</span>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <KV k="RUBBER" v={<span className="uppercase">{w.rubber}</span>} />
        <KV k="TRACK Δ" v={`+${(w.trackC - w.airC).toFixed(1)} °C`} />
      </div>

      <div className="mt-1.5">
        <div className="flex items-baseline justify-between">
          <span className={LBL_TIGHT}>BAANTEMPERATUUR</span>
          <span className={`${NUM} text-[9px] text-[#4f8a66]`}>10–50 °C</span>
        </div>
        <Bar
          value={w.trackC}
          max={50}
          segments={20}
          tone="bg-[#ffc35c]"
          className="mt-1"
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* footer                                                              */
/* ------------------------------------------------------------------ */

function Footer({ f }: { f: PitwallFixture }) {
  const progress = f.event.lap / f.event.totalLaps;
  const remaining = f.event.totalLaps - f.event.lap;
  const flag = flagTone(f.event.flag);

  return (
    <footer className="mt-3 border border-[#173d28] bg-[#060c08] px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2 text-[9px] tracking-[0.14em] text-[#3f7352]">
          <span className="text-[#4dff9c]">RACE</span>
          <span className="text-[#234b35]">|</span>
          <span className={`${NUM} text-[#9adcb1]`}>
            {String(f.event.lap).padStart(3, "0")}/{f.event.totalLaps}
          </span>
          <span className="text-[#234b35]">|</span>
          <span className={`${NUM} text-[#9adcb1]`}>{remaining} RONDEN TE GAAN</span>
        </div>
        <div className="flex items-center gap-3 text-[9px] tracking-[0.12em] text-[#3f7352]">
          <span className={flag.text}>FLAG: {f.event.flag.toUpperCase()}</span>
          <span className="text-[#234b35]">|</span>
          <span className={NUM}>{f.event.timeLeft}</span>
          <span className="text-[#234b35]">|</span>
          <span className={NUM}>{(progress * 100).toFixed(1)}%</span>
        </div>
      </div>
      <Bar value={progress * 100} max={100} segments={60} tone="bg-[#2fbd74]" className="mt-1.5" />
      <div className="mt-1.5 flex items-center justify-between text-[9px] tracking-[0.1em] text-[#264a35]">
        <span>3SM PITWALL // DESIGN 04 // TELEMETRY TERMINAL</span>
        <span className="flex items-center gap-1">
          EOF<span className="pw4-cursor text-[#4dff9c]">▌</span>
        </span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Design({ f }: { f: PitwallFixture }) {
  return (
    <div
      className="relative min-h-screen w-full bg-[#040706] font-mono text-[#a9ecc1] antialiased"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
    >
      <style>{`
        .pw4-scanlines {
          background-image: repeating-linear-gradient(
            180deg,
            rgba(120, 255, 170, 0.05) 0px,
            rgba(120, 255, 170, 0.05) 1px,
            rgba(0, 0, 0, 0) 1px,
            rgba(0, 0, 0, 0) 3px
          );
        }
        .pw4-vignette {
          background: radial-gradient(120% 80% at 50% 0%, rgba(30, 90, 55, 0.14) 0%, rgba(0,0,0,0) 55%),
                      radial-gradient(100% 100% at 50% 100%, rgba(0, 0, 0, 0.65) 0%, rgba(0,0,0,0) 60%);
        }
        .pw4-glow { text-shadow: 0 0 10px rgba(96, 255, 160, 0.28); }
        .pw4-cursor { animation: pw4-blink 1.1s steps(1, end) infinite; }
        .pw4-pulse { animation: pw4-pulse 1.8s ease-in-out infinite; }
        @keyframes pw4-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }
        @keyframes pw4-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-0 pw4-scanlines opacity-70" aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-0 pw4-vignette" aria-hidden />

      <div className="relative z-10 mx-auto max-w-[1560px] px-3 py-4 sm:px-5 sm:py-5">
        <Header f={f} />
        <TelemetryStrip f={f} />
        <Decision f={f} />

        <div className="mt-3 grid gap-3 xl:grid-cols-12">
          <div className="flex flex-col gap-3 xl:col-span-7">
            <div className="grid gap-3 lg:grid-cols-[1.08fr_0.92fr]">
              <Tyres f={f} />
              <Fuel f={f} />
            </div>
            <Standings f={f} />
          </div>

          <div className="flex flex-col gap-3 xl:col-span-5">
            <Gaps f={f} />
            <Pace f={f} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Rotation f={f} />
              <Weather f={f} />
            </div>
          </div>
        </div>

        <Footer f={f} />
      </div>
    </div>
  );
}
