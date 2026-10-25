/**
 * Ontwerp 02 — BROADCAST TIMING TOWER.
 *
 * Visuele taal van een televisie-uitzending: diep donkerblauw, haarfijne
 * scheidingslijnen, kleine uppercase labels en een timingtoren die het beeld
 * domineert. De rest van de pitwall schikt zich eromheen als grafiek-elementen
 * in een broadcast-layout, niet als losse dashboardkaarten.
 *
 * Enige databron: de fixture die als prop `f` binnenkomt.
 */
import type { ReactNode } from "react";
import type { PitwallFixture, Standing } from "@/lab/fixture";

export const meta = {
  title: "Broadcast Timing Tower",
  note: "Diep donkerblauw, strakke timingtoren, sectorkleuren en haarfijne lijnen — televisie, geen dashboard",
};

/* ── Palet en type ─────────────────────────────────────────────────────────── */

const PURPLE = "#b06bff";
const GREEN = "#2ee6a0";
const YELLOW = "#f5c542";
const AMBER = "#ffb020";
const RED = "#ff3b46";
const BLUE = "#6f8cff";

const ML = "font-body text-[9px] font-semibold uppercase leading-none tracking-[0.24em] text-white/40";
const NUM = "font-heading tabular-nums";

/* ── Hulpjes ───────────────────────────────────────────────────────────────── */

function toSeconds(lap: string): number {
  if (!lap.includes(":")) return Number(lap) || 0;
  const [m, s] = lap.split(":");
  return Number(m) * 60 + Number(s);
}

function wearTone(wear: number): string {
  if (wear >= 92) return "#ff6b4a";
  if (wear >= 85) return AMBER;
  return GREEN;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-white/10 bg-[#070e1c] ${className}`}>{children}</section>;
}

function PanelHead({ label, right, tone }: { label: string; right?: ReactNode; tone?: string }) {
  return (
    <div className="relative flex items-center justify-between border-b border-white/10 px-3 py-1.5">
      {tone ? <span aria-hidden className="absolute left-0 top-0 h-full w-[2px]" style={{ background: tone }} /> : null}
      <span className={`${ML} text-[8.5px]`}>{label}</span>
      {right}
    </div>
  );
}

function Stat({ label, value, unit, strong }: { label: string; value: string; unit?: string; strong?: boolean }) {
  return (
    <div className="py-1">
      <div className={`${ML} text-[7.5px]`}>{label}</div>
      <div className={`${NUM} mt-1 leading-none ${strong ? "text-[18px] font-bold" : "text-[14px] font-semibold"} text-white/90`}>
        {value}
        {unit ? <span className="ml-1 text-[9px] font-medium tracking-wide text-white/35">{unit}</span> : null}
      </div>
    </div>
  );
}

/* ── Kop ───────────────────────────────────────────────────────────────────── */

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[#e01030] px-2 py-[3px]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      <span className="font-heading text-[8.5px] font-bold uppercase leading-none tracking-[0.22em] text-white">Live</span>
    </span>
  );
}

function FlagChip({ flag }: { flag: string }) {
  const tone = /groen|green/i.test(flag) ? GREEN : /geel|yellow/i.test(flag) ? YELLOW : RED;
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-[3px]"
      style={{ borderColor: `${tone}59`, backgroundColor: `${tone}1a` }}
    >
      <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true">
        <rect x="0.5" y="0.5" width="1" height="9" fill={tone} />
        <path d="M2 1.2h6v4.4H2z" fill={tone} opacity="0.85" />
      </svg>
      <span className="font-heading text-[8.5px] font-bold uppercase leading-none tracking-[0.2em]" style={{ color: tone }}>
        {flag}
      </span>
    </span>
  );
}

function TopBar({ f }: { f: PitwallFixture }) {
  const progress = (f.event.lap / f.event.totalLaps) * 100;
  return (
    <header className="relative border-b border-white/10 bg-[#060c19]">
      <div className="mx-auto flex max-w-[1560px] items-center gap-5 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 items-stretch gap-[3px]">
            <span className="w-[5px] bg-[#ff3b30]" />
            <span className="w-[5px] bg-[#ff7a1a]" />
            <span className="w-[5px] bg-white/65" />
          </div>
          <div>
            <div className="font-heading text-[13px] font-extrabold uppercase leading-none tracking-[0.14em] text-white">3 Stripe</div>
            <div className="mt-1 font-body text-[8px] uppercase leading-none tracking-[0.32em] text-white/40">Motorsport · Endurance</div>
          </div>
        </div>

        <div className="h-8 w-px bg-white/10" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <LiveBadge />
            <FlagChip flag={f.event.flag} />
            <span className="font-body text-[8.5px] uppercase tracking-[0.3em] text-white/35">ronde {f.event.lap} / {f.event.totalLaps}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <h1 className="truncate font-heading text-[21px] font-extrabold uppercase leading-none tracking-tight text-white">{f.event.name}</h1>
            <span className="truncate font-body text-[10.5px] uppercase tracking-[0.18em] text-white/45">{f.event.circuit}</span>
          </div>
        </div>

        <div className="flex items-stretch border border-white/15 bg-white/[0.025]">
          <div className="px-4 py-1.5">
            <div className={`${ML} text-[7.5px]`}>Ronde</div>
            <div className={`${NUM} mt-1 text-[24px] font-bold leading-none text-white`}>
              {f.event.lap}
              <span className="text-[13px] font-medium text-white/30">/{f.event.totalLaps}</span>
            </div>
          </div>
          <div className="border-l border-white/10 px-4 py-1.5">
            <div className={`${ML} text-[7.5px]`}>Resttijd</div>
            <div className={`${NUM} mt-1 text-[24px] font-bold leading-none text-white`}>{f.event.timeLeft}</div>
          </div>
        </div>
      </div>
      <div className="h-[2px] w-full bg-white/[0.06]">
        <div className="h-full bg-[#ff3b30]" style={{ width: `${progress}%` }} />
      </div>
    </header>
  );
}

function PosBlock({ label, value, sub, tone, last }: { label: string; value: string; sub: string; tone: string; last?: boolean }) {
  return (
    <div className={`flex min-w-[92px] flex-col justify-center px-3.5 py-1.5 ${last ? "" : "border-r border-white/10"}`}>
      <div className={`${ML} text-[7.5px]`}>{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`${NUM} text-[24px] font-bold leading-none`} style={{ color: tone }}>
          {value}
        </span>
        <span className="font-body text-[8.5px] uppercase tracking-[0.18em] text-white/35">{sub}</span>
      </div>
    </div>
  );
}

function IdentityBar({ f }: { f: PitwallFixture }) {
  return (
    <div className="border-b border-white/10 bg-[#040a15]">
      <div className="mx-auto flex max-w-[1560px] items-stretch px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2">
          <svg width="34" height="18" viewBox="0 0 34 18" fill="none" aria-hidden="true" className="shrink-0">
            <rect x="9" y="1" width="16" height="16" rx="4" stroke="rgba(255,255,255,0.3)" />
            <rect x="12" y="4.5" width="10" height="3" rx="1" fill="rgba(255,255,255,0.18)" />
            <rect x="12" y="10.5" width="10" height="3" rx="1" fill="rgba(255,255,255,0.18)" />
            <rect x="4" y="2.5" width="4" height="4.5" rx="1" fill="rgba(255,255,255,0.22)" />
            <rect x="4" y="11" width="4" height="4.5" rx="1" fill="rgba(255,255,255,0.22)" />
            <rect x="26" y="2.5" width="4" height="4.5" rx="1" fill="rgba(255,255,255,0.22)" />
            <rect x="26" y="11" width="4" height="4.5" rx="1" fill="rgba(255,255,255,0.22)" />
          </svg>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-[15px] font-bold uppercase leading-none tracking-wide text-white">{f.self.driver}</span>
              <span className="font-body text-[8px] uppercase tracking-[0.28em] text-white/30">eigen auto</span>
            </div>
            <div className="mt-1 truncate font-body text-[10px] uppercase tracking-[0.16em] text-white/40">
              {f.self.team} <span className="text-white/20">/</span> {f.self.car}
            </div>
          </div>
        </div>
        <div className="flex items-stretch border-l border-white/10">
          <PosBlock label="Positie" value={`P${f.self.pos}`} sub="algemeen" tone="#ffffff" />
          <PosBlock label="Klasse" value={`K${f.self.classPos}`} sub={f.self.cls} tone={PURPLE} last />
        </div>
      </div>
    </div>
  );
}

/* ── Klassement: de toren ──────────────────────────────────────────────────── */

function Legend() {
  const items: Array<[string, string]> = [
    [PURPLE, "snelste"],
    [GREEN, "op tempo"],
    [YELLOW, "verlies"],
  ];
  return (
    <div className="flex items-center gap-3">
      {items.map(([tone, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className="h-1.5 w-1.5" style={{ background: tone }} />
          <span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/35">{label}</span>
        </span>
      ))}
    </div>
  );
}

function TowerRow({ s, fastest }: { s: Standing; fastest: number }) {
  const delta = toSeconds(s.lastLap) - toSeconds(s.bestLap);
  const isFastest = Math.abs(toSeconds(s.bestLap) - fastest) < 0.001;
  const tone = isFastest ? PURPLE : delta <= 0.8 ? GREEN : YELLOW;

  return (
    <div
      className={`relative grid grid-cols-[32px_minmax(0,1fr)_60px_62px_56px_26px] items-center gap-2 border-b border-white/[0.055] px-3 py-[10px] ${
        s.isSelf ? "bg-white/[0.065]" : ""
      } ${s.inPit ? "bg-[#ffb020]/[0.045]" : ""}`}
    >
      {s.isSelf ? <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-[#ff3b46]" /> : null}
      <span className={`${NUM} text-[20px] font-bold leading-none ${s.isSelf ? "text-white" : "text-white/75"}`}>{s.classPos}</span>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`min-w-0 truncate font-heading text-[12.5px] font-semibold uppercase tracking-[0.01em] ${
              s.isSelf ? "text-white" : "text-white/85"
            }`}
          >
            {s.driver}
          </span>
          {s.isSelf ? (
            <span className="shrink-0 bg-[#ff3b46] px-1 py-[1px] font-heading text-[7px] font-bold leading-none tracking-[0.16em] text-white">JIJ</span>
          ) : null}
          {s.inPit ? (
            <span className="shrink-0 bg-[#ffb020] px-1 py-[1px] font-heading text-[7px] font-bold leading-none tracking-[0.16em] text-black">PIT</span>
          ) : null}
          <span className="ml-auto shrink-0 font-body text-[8px] tabular-nums uppercase tracking-[0.1em] text-white/25">P{s.pos}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="min-w-0 truncate font-body text-[9px] uppercase tracking-[0.1em] text-white/35">{s.car}</span>
          <span className="shrink-0 font-body text-[8px] tabular-nums text-white/25">{s.tyreAgeLaps}R</span>
        </div>
      </div>

      <span className={`${NUM} text-right text-[12px] font-semibold ${s.inPit ? "text-white/35" : s.gap === "LEIDER" ? "text-white/40" : "text-white/75"}`}>{s.gap}</span>
      <span className={`${NUM} text-right text-[12px] ${s.inPit ? "text-white/25" : "text-white/55"}`}>{s.lastLap}</span>
      <span className={`${NUM} text-right text-[12px] ${isFastest ? "text-[#b06bff]" : "text-white/50"}`}>{s.bestLap}</span>
      <span className="flex items-center justify-end gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-3 w-[4px]" style={{ background: tone, opacity: 0.95 - i * 0.24 }} />
        ))}
      </span>
    </div>
  );
}

function Tower({ f }: { f: PitwallFixture }) {
  const groups = Array.from(new Set(f.standings.map((s) => s.cls))).map((cls) => {
    const rows = f.standings.filter((s) => s.cls === cls).sort((a, b) => a.classPos - b.classPos);
    const fastest = Math.min(...rows.map((r) => toSeconds(r.bestLap)));
    return { cls, rows, fastest };
  });

  return (
    <Panel className="flex flex-col">
      <div className="flex items-end justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-heading text-[15px] font-extrabold uppercase leading-none tracking-[0.14em] text-white">Klassement</h2>
          <span className="font-body text-[8px] uppercase tracking-[0.3em] text-white/30">live timing</span>
        </div>
        <Legend />
      </div>

      <div className="grid grid-cols-[32px_minmax(0,1fr)_60px_62px_56px_26px] gap-2 border-b border-white/10 bg-white/[0.015] px-3 py-1.5">
        {["K", "coureur / auto", "gap", "laatste", "beste", ""].map((h, i) => (
          <span key={i} className={`${ML} text-[7.5px] ${i >= 2 && i <= 4 ? "text-right" : ""}`}>
            {h}
          </span>
        ))}
      </div>

      <div className="flex-1">
        {groups.map((g) => (
          <div key={g.cls}>
            <div className="flex items-center justify-between border-y border-white/10 bg-white/[0.03] px-3 py-[3px]">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5" style={{ background: g.cls === "GT3" ? "#9fb3d9" : "#d8b07a" }} />
                <span className="font-heading text-[9.5px] font-bold uppercase leading-none tracking-[0.22em] text-white/70">{g.cls}</span>
                <span className="font-body text-[8px] uppercase tracking-[0.16em] text-white/25">{g.rows.length} auto&apos;s</span>
              </div>
              <span className="font-body text-[7.5px] uppercase tracking-[0.2em] text-white/20">klassepositie · rondetijden</span>
            </div>
            {g.rows.map((s) => (
              <TowerRow key={`${s.cls}-${s.classPos}`} s={s} fastest={g.fastest} />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-white/10 px-3 py-1.5">
        <span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/25">kleurblokjes: laatste ronde t.o.v. eigen beste</span>
        <span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/20">3sm endurance · sectortiming</span>
      </div>
    </Panel>
  );
}

/* ── Sectoren + onboard ────────────────────────────────────────────────────── */

function SectorPanel({ f }: { f: PitwallFixture }) {
  const sectors: Array<{ code: string; time: string; tone: string }> = [
    { code: "S1", time: f.telemetry.s1, tone: PURPLE },
    { code: "S2", time: f.telemetry.s2, tone: GREEN },
    { code: "S3", time: f.telemetry.s3, tone: YELLOW },
  ];

  return (
    <Panel>
      <PanelHead
        label="Sectoren · laatste ronde"
        right={<span className={`${NUM} text-[11px] font-semibold text-white/70`}>{f.telemetry.lastLap}</span>}
      />
      <div className="grid grid-cols-3 divide-x divide-white/10">
        {sectors.map((s) => (
          <div key={s.code} className="relative pb-1.5 pt-2">
            <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: s.tone }} />
            <div className="px-2.5">
              <div className="font-body text-[7.5px] font-semibold uppercase leading-none tracking-[0.22em]" style={{ color: s.tone }}>
                {s.code}
              </div>
              <div className={`${NUM} mt-1 text-[15px] font-semibold leading-none text-white/90`}>{s.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 bg-white/[0.015]">
        <div className="px-2.5 py-1.5">
          <div className={`${ML} text-[7px]`}>Versnelling</div>
          <div className={`${NUM} mt-1 text-[15px] font-bold leading-none text-white`}>{f.telemetry.gear}</div>
        </div>
        <div className="px-2.5 py-1.5">
          <div className={`${ML} text-[7px]`}>Snelheid</div>
          <div className={`${NUM} mt-1 text-[15px] font-bold leading-none text-white`}>
            {f.telemetry.speedKph}
            <span className="ml-1 text-[8px] font-medium tracking-wide text-white/35">km/h</span>
          </div>
        </div>
        <div className="px-2.5 py-1.5">
          <div className={`${ML} text-[7px]`}>RPM</div>
          <div className={`${NUM} mt-1 text-[15px] font-bold leading-none text-white`}>{f.telemetry.rpm}</div>
        </div>
      </div>
    </Panel>
  );
}

/* ── Gaten ─────────────────────────────────────────────────────────────────── */

function GapCell({ dir, name, gap, tone }: { dir: string; name: string; gap: string; tone: string }) {
  const up = dir === "voor";
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1">
        <svg width="7" height="8" viewBox="0 0 7 8" aria-hidden="true" style={{ transform: up ? "none" : "rotate(180deg)" }}>
          <path d="M3.5 0 7 6H0z" fill={tone} />
        </svg>
        <span className={`${ML} text-[7.5px]`}>{dir}</span>
      </div>
      <div className={`${NUM} mt-1.5 text-[21px] font-bold leading-none`}>{gap}</div>
      <div className="mt-1 truncate font-body text-[9px] uppercase tracking-[0.12em] text-white/40">{name}</div>
    </div>
  );
}

function GapsPanel({ f }: { f: PitwallFixture }) {
  return (
    <Panel>
      <PanelHead label="Gaten" right={<span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/25">ronde {f.event.lap}</span>} />
      <div className="grid grid-cols-2 divide-x divide-white/10">
        <GapCell dir="voor" name={f.gaps.aheadName} gap={f.gaps.ahead} tone={AMBER} />
        <GapCell dir="achter" name={f.gaps.behindName} gap={f.gaps.behind} tone={BLUE} />
      </div>
    </Panel>
  );
}

/* ── Beslissing ────────────────────────────────────────────────────────────── */

function DecisionPanel({ f }: { f: PitwallFixture }) {
  const rec = f.pit.recommendation;
  const label = rec === "PIT_NOW" ? "NU NAAR BINNEN" : rec === "STAY_OUT" ? "BUITEN BLIJVEN" : "BINNENKORT BINNEN";
  const tone = rec === "PIT_NOW" ? RED : rec === "STAY_OUT" ? GREEN : AMBER;
  const lossInLaps = f.pit.pitLossSeconds / toSeconds(f.telemetry.lastLap);

  return (
    <Panel>
      <span className="block h-[2px] w-full" style={{ background: tone }} />
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className={`${ML} text-[8px]`}>Beslissing</span>
          <span className="font-body text-[8px] font-semibold uppercase tracking-[0.2em]" style={{ color: tone }}>
            {rec}
          </span>
        </div>
        <div className="mt-1.5 font-heading text-[20px] font-extrabold uppercase leading-none tracking-tight" style={{ color: tone }}>
          {label}
        </div>
        <p className="mt-2 font-body text-[11px] leading-snug text-white/55">{f.pit.reason}</p>

        <div className="mt-2.5 grid grid-cols-2 divide-x divide-white/10 border-y border-white/10">
          <div className="py-1.5 pr-2">
            <div className={`${ML} text-[7px]`}>Pitwindow</div>
            <div className={`${NUM} mt-1 text-[16px] font-bold leading-none text-white`}>
              {f.pit.windowInLaps}
              <span className="ml-1 text-[9px] font-medium tracking-wide text-white/35">ronden</span>
            </div>
          </div>
          <div className="py-1.5 pl-2">
            <div className={`${ML} text-[7px]`}>Pitverlies</div>
            <div className={`${NUM} mt-1 text-[16px] font-bold leading-none text-white`}>
              {f.pit.pitLossSeconds.toFixed(1)}
              <span className="ml-1 text-[9px] font-medium tracking-wide text-white/35">s</span>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between font-body text-[8px] uppercase tracking-[0.16em] text-white/35">
          <span>open t/m ronde {f.event.lap + f.pit.windowInLaps}</span>
          <span>&asymp; {lossInLaps.toFixed(2)} ronde</span>
        </div>

        <div className="relative mt-2 h-[4px] w-full overflow-hidden bg-white/[0.07]">
          <div
            className="absolute inset-0"
            style={{ background: `repeating-linear-gradient(135deg, ${tone}44 0 3px, transparent 3px 6px)` }}
          />
          <div className="absolute inset-y-0 left-0 w-[2px]" style={{ background: tone }} />
        </div>
      </div>
    </Panel>
  );
}

/* ── Coureurswissel ────────────────────────────────────────────────────────── */

function RotationPanel({ f }: { f: PitwallFixture }) {
  const next = f.rotation.nextInMinutes;
  const after = f.rotation.afterInMinutes;
  const span = after || 1;
  const rows: Array<{ name: string; when: string; tone: string; dim: boolean }> = [
    { name: f.rotation.current, when: "nu", tone: "#ffffff", dim: false },
    { name: f.rotation.next, when: `+${next} min`, tone: AMBER, dim: true },
    { name: f.rotation.after, when: `+${after} min`, tone: "rgba(255,255,255,0.55)", dim: true },
  ];

  return (
    <Panel>
      <PanelHead label="Coureurswissel" right={<span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/25">stintplanning</span>} />
      <div className="px-3 py-2">
        <div className="flex flex-col gap-[7px]">
          {rows.map((r, i) => (
            <div key={`${r.name}-${i}`} className="flex items-center gap-2">
              <span className="h-[5px] w-[5px] shrink-0" style={{ background: r.tone }} />
              <span className={`min-w-0 flex-1 truncate font-heading text-[11.5px] font-semibold uppercase ${r.dim ? "text-white/55" : "text-white"}`}>
                {r.name}
              </span>
              <span className={`${NUM} shrink-0 text-[9px] uppercase tracking-[0.1em] text-white/35`}>{r.when}</span>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex h-[6px] w-full overflow-hidden bg-white/[0.07]">
          <div style={{ width: `${(next / span) * 100}%`, background: "#ffffff" }} />
          <div style={{ width: `${((after - next) / span) * 100}%`, background: "rgba(255,255,255,0.28)" }} />
          <div className="flex-1" style={{ background: "rgba(255,255,255,0.12)" }} />
        </div>
        <div className="mt-1 flex justify-between font-body text-[7.5px] uppercase tracking-[0.16em] text-white/25">
          <span>start</span>
          <span>+{next}</span>
          <span>+{after} min</span>
        </div>
      </div>
    </Panel>
  );
}

/* ── Bandenkruis ───────────────────────────────────────────────────────────── */

function TyreCell({ code, axis, wear, tempC }: { code: string; axis: string; wear: number; tempC: number }) {
  const tone = wearTone(wear);
  return (
    <div className="border border-white/10 bg-white/[0.025] px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="font-heading text-[8.5px] font-bold uppercase leading-none tracking-[0.16em] text-white/60">{code}</span>
        <span className="font-body text-[7.5px] uppercase leading-none tracking-[0.14em] text-white/25">{axis}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`${NUM} text-[19px] font-bold leading-none text-white`}>{wear.toFixed(1)}</span>
        <span className="font-body text-[8px] text-white/30">%</span>
        <span className={`${NUM} ml-auto text-[9.5px] text-white/50`}>{tempC}&deg;C</span>
      </div>
      <div className="mt-1.5 h-[3px] w-full bg-white/[0.09]">
        <div className="h-full" style={{ width: `${Math.min(100, wear)}%`, background: tone }} />
      </div>
    </div>
  );
}

function TyrePanel({ f }: { f: PitwallFixture }) {
  const t = f.tyres;
  return (
    <Panel>
      <PanelHead
        label="Banden"
        right={
          <span className={`${NUM} text-[9px] uppercase tracking-[0.12em] text-white/45`}>
            set {t.setLaps} ronden
          </span>
        }
      />
      <div className="px-2.5 py-2">
        <div className="grid grid-cols-2 gap-1.5">
          <TyreCell code="LV" axis="voor" wear={t.fl.wear} tempC={t.fl.tempC} />
          <TyreCell code="RV" axis="voor" wear={t.fr.wear} tempC={t.fr.tempC} />
        </div>

        <div className="my-1.5 flex items-center gap-2">
          <span className="h-px flex-1 bg-white/10" />
          <svg width="40" height="16" viewBox="0 0 40 16" fill="none" aria-hidden="true">
            <rect x="12" y="1" width="16" height="14" rx="3.5" stroke="rgba(255,255,255,0.22)" />
            <rect x="9" y="2.5" width="3" height="4" rx="1" fill="rgba(255,255,255,0.28)" />
            <rect x="9" y="9.5" width="3" height="4" rx="1" fill="rgba(255,255,255,0.28)" />
            <rect x="28" y="2.5" width="3" height="4" rx="1" fill="rgba(255,255,255,0.28)" />
            <rect x="28" y="9.5" width="3" height="4" rx="1" fill="rgba(255,255,255,0.28)" />
            <path d="M14 4h4l2 2h6" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
          </svg>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <TyreCell code="LA" axis="achter" wear={t.rl.wear} tempC={t.rl.tempC} />
          <TyreCell code="RA" axis="achter" wear={t.rr.wear} tempC={t.rr.tempC} />
        </div>

        <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2">
          <span className="border border-white/15 px-1.5 py-[2px] font-heading text-[8px] font-bold uppercase leading-none tracking-[0.14em] text-white/75">
            {t.compound}
          </span>
          <span className="border px-1.5 py-[2px] font-heading text-[8px] font-bold uppercase leading-none tracking-[0.1em]" style={{ borderColor: `${AMBER}66`, color: AMBER }}>
            grade {t.grade}
          </span>
          <span className="ml-auto text-right">
            <span className={`${ML} text-[7px]`}>bereik</span>
            <span className={`${NUM} ml-1.5 text-[10px] text-white/70`}>
              {t.wearRange[0]} – {t.wearRange[1]}
            </span>
          </span>
        </div>
        <p className="mt-1.5 font-body text-[8.5px] leading-snug tracking-wide text-white/30">{t.note}</p>
      </div>
    </Panel>
  );
}

/* ── Brandstof ─────────────────────────────────────────────────────────────── */

function FuelPanel({ f }: { f: PitwallFixture }) {
  const fuel = f.fuel;
  const pctNow = Math.min(100, (fuel.litres / fuel.tankLitres) * 100);
  const pctAdded = Math.min(100, ((fuel.litres + fuel.toAddLitres) / fuel.tankLitres) * 100);

  return (
    <Panel>
      <PanelHead label="Brandstof" right={<span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/25">tank {fuel.tankLitres} l</span>} />
      <div className="px-3 py-2">
        <div className="flex items-end justify-between">
          <div>
            <div className={`${NUM} text-[30px] font-bold leading-none text-white`}>
              {fuel.litres.toFixed(1)}
              <span className="ml-1 text-[12px] font-medium tracking-wide text-white/35">l</span>
            </div>
            <div className={`${ML} mt-1 text-[7.5px]`}>in de tank</div>
          </div>
          <div className="text-right">
            <div className={`${NUM} text-[22px] font-bold leading-none`} style={{ color: AMBER }}>
              {fuel.lapsLeft}
            </div>
            <div className={`${ML} mt-1 text-[7.5px]`}>ronden over</div>
          </div>
        </div>

        <div className="relative mt-2.5 h-[7px] w-full bg-white/[0.08]">
          <div className="absolute inset-y-0 left-0" style={{ width: `${pctNow}%`, background: "#ffffff" }} />
          <div
            className="absolute inset-y-0"
            style={{
              left: `${pctNow}%`,
              width: `${Math.max(0, pctAdded - pctNow)}%`,
              background: `repeating-linear-gradient(135deg, ${AMBER} 0 3px, ${AMBER}55 3px 6px)`,
            }}
          />
        </div>
        <div className="mt-1 flex justify-between font-body text-[7.5px] uppercase tracking-[0.16em] text-white/25">
          <span>0</span>
          <span>
            na bijtanken <span className={`${NUM} text-white/45`}>{(fuel.litres + fuel.toAddLitres).toFixed(1)} l</span>
          </span>
          <span>{fuel.tankLitres} l</span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-3 border-t border-white/10 pt-1">
          <Stat label="Per ronde" value={fuel.perLap.toFixed(2)} unit="l" />
          <Stat label="Bijtanken" value={fuel.toAddLitres.toFixed(0)} unit="l" />
          <Stat label="Nodig tot finish" value={fuel.toFinishLitres.toFixed(2)} unit="l" />
          <Stat label="Tankinhoud" value={fuel.tankLitres.toFixed(0)} unit="l" />
        </div>
      </div>
    </Panel>
  );
}

/* ── Weer ──────────────────────────────────────────────────────────────────── */

function WeatherPanel({ f }: { f: PitwallFixture }) {
  return (
    <Panel>
      <PanelHead label="Weer" right={<span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/25">omstandigheden</span>} />
      <div className="grid grid-cols-2 divide-x divide-white/10">
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <circle cx="5" cy="5" r="2.4" stroke="rgba(255,255,255,0.45)" />
              <path d="M5 0v1.4M5 8.6V10M0 5h1.4M8.6 5H10M1.5 1.5l1 1M7.5 7.5l1 1M8.5 1.5l-1 1M2.5 7.5l-1 1" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
            </svg>
            <span className={`${ML} text-[7px]`}>lucht</span>
          </div>
          <div className={`${NUM} mt-1 text-[19px] font-bold leading-none text-white`}>{f.weather.airC}&deg;</div>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1 7.5h8M1 9h5" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
              <path d="M3 5.5V1.5a1 1 0 0 1 2 0v4" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
            </svg>
            <span className={`${ML} text-[7px]`}>baan</span>
          </div>
          <div className={`${NUM} mt-1 text-[19px] font-bold leading-none`} style={{ color: "#ff8a5c" }}>
            {f.weather.trackC}&deg;
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-3 py-1.5">
        <span className={`${ML} text-[7px]`}>rubber</span>
        <span className="font-body text-[9px] uppercase tracking-[0.12em] text-white/50">{f.weather.rubber}</span>
      </div>
    </Panel>
  );
}

/* ── Pace-grafiek ──────────────────────────────────────────────────────────── */

function PacePanel({ f }: { f: PitwallFixture }) {
  const values = f.pace;
  const W = 1480;
  const H = 172;
  const padL = 44;
  const padR = 18;
  const padT = 16;
  const padB = 24;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = Math.floor((min - 0.25) * 2) / 2;
  const hi = Math.ceil((max + 0.25) * 2) / 2;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const x = (i: number) => padL + (i / Math.max(1, values.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.5) ticks.push(Number(v.toFixed(1)));

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L${padL} ${(padT + innerH).toFixed(1)} Z`;

  const rolling = values.map((_, i) => {
    const from = Math.max(0, i - 4);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const rollLine = rolling.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const fastestIdx = values.indexOf(min);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const startLap = f.event.lap - values.length + 1;

  return (
    <Panel>
      <div className="flex items-end justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-heading text-[12px] font-extrabold uppercase leading-none tracking-[0.16em] text-white">Pace</h2>
          <span className="font-body text-[8px] uppercase tracking-[0.26em] text-white/30">
            laatste {values.length} ronden · seconde per ronde
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-3" style={{ background: PURPLE }} />
            <span className="font-body text-[7.5px] uppercase tracking-[0.16em] text-white/30">rondetijd</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-3 border-t border-dashed border-white/40" />
            <span className="font-body text-[7.5px] uppercase tracking-[0.16em] text-white/30">gemiddelde 5</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5" style={{ background: AMBER }} />
            <span className="font-body text-[7.5px] uppercase tracking-[0.16em] text-white/30">snelste ronde</span>
          </span>
        </div>
      </div>

      <div className="px-1.5 pb-1 pt-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Rondetijden van de laatste ronden">
          <defs>
            <linearGradient id="paceFill02" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PURPLE} stopOpacity="0.35" />
              <stop offset="100%" stopColor={PURPLE} stopOpacity="0" />
            </linearGradient>
          </defs>

          {values.map((_, i) => (
            <line
              key={`vline-${i}`}
              x1={x(i)}
              x2={x(i)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(255,255,255,0.045)"
              strokeWidth="1"
            />
          ))}

          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fill="rgba(255,255,255,0.32)" fontSize="8" fontFamily="Rajdhani, sans-serif">
                {t.toFixed(1)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#paceFill02)" />
          <path d={line} fill="none" stroke={PURPLE} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          <path d={rollLine} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3 3" />

          {values.map((v, i) =>
            i === values.length - 1 ? (
              <circle key={`dot-${i}`} cx={x(i)} cy={y(v)} r="2.4" fill="#ffffff" />
            ) : null,
          )}

          <circle cx={x(fastestIdx)} cy={y(min)} r="3" fill={AMBER} />
          <text x={x(fastestIdx)} y={y(min) - 7} textAnchor="middle" fill={AMBER} fontSize="8.5" fontFamily="Rajdhani, sans-serif" fontWeight="600">
            {min.toFixed(1)}
          </text>

          <line x1={x(values.length - 1)} x2={x(values.length - 1)} y1={padT} y2={padT + innerH} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2 3" />

          {values.map((_, i) =>
            i % 2 === 0 || i === values.length - 1 ? (
              <text key={`x-${i}`} x={x(i)} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="Rajdhani, sans-serif">
                {startLap + i}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-4 font-body text-[7.5px] uppercase tracking-[0.18em] text-white/30">
          <span>
            snelste <span className={`${NUM} text-[#ffb020]`}>{min.toFixed(1)}</span>
          </span>
          <span>
            gemiddeld <span className={`${NUM} text-white/55`}>{avg.toFixed(1)}</span>
          </span>
          <span>
            traagste <span className={`${NUM} text-white/55`}>{max.toFixed(1)}</span>
          </span>
          <span>
            spreiding <span className={`${NUM} text-white/55`}>{(max - min).toFixed(1)}</span>
          </span>
        </span>
        <span className="font-body text-[7.5px] uppercase tracking-[0.18em] text-white/22">
          ronde {startLap} – {f.event.lap}
        </span>
      </div>
    </Panel>
  );
}

/* ── Ontwerp ───────────────────────────────────────────────────────────────── */

export default function Design({ f }: { f: PitwallFixture }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040814] font-body text-white antialiased selection:bg-[#b06bff]/40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "88px 100%",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-52 left-1/2 h-[520px] w-[1000px] -translate-x-1/2"
        style={{ background: "radial-gradient(ellipse at center, rgba(90,120,255,0.16), rgba(4,8,20,0) 70%)" }}
      />

      <div className="relative">
        <TopBar f={f} />
        <IdentityBar f={f} />

        <main className="mx-auto max-w-[1560px] px-4 py-3">
          <div className="grid grid-cols-12 items-start gap-2.5">
            <div className="col-span-3 flex flex-col gap-2.5">
              <SectorPanel f={f} />
              <GapsPanel f={f} />
              <DecisionPanel f={f} />
              <RotationPanel f={f} />
            </div>

            <div className="col-span-6">
              <Tower f={f} />
            </div>

            <div className="col-span-3 flex flex-col gap-2.5">
              <TyrePanel f={f} />
              <FuelPanel f={f} />
              <WeatherPanel f={f} />
            </div>
          </div>

          <div className="mt-2.5">
            <PacePanel f={f} />
          </div>
        </main>
      </div>
    </div>
  );
}
