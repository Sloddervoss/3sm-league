import { Activity, Disc3, Fuel, MapPin, Timer, Users, ListOrdered } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Het paneelvlak van de pitwall-look.
 *
 * Eén donkere tint boven de bijna zwarte pagina, een dunne blauwgrijze rand en
 * een kleine kop in kapitalen. Geen oranje randen: oranje is voor de eigen auto
 * en voor actieve bediening, niet voor iedere kaart.
 *
 * Dit is puur presentatie. Panelen krijgen hun inhoud van buiten; deze module
 * kent geen databron, geen berekening en geen status.
 */
export const PITWALL_PANEL_CLASS = "rounded-xl border border-[#1D2431] bg-[#0B0D11]";

export function PitwallPanel({
  title,
  meta,
  children,
  slot,
  className = "",
  bodyClassName = "",
  actions,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  /** data-pitwall-slot, zodat bestaande tests en CSS hun anker houden. */
  slot?: string;
  className?: string;
  bodyClassName?: string;
  actions?: ReactNode;
}) {
  const Icon = ({ pace: Activity, tyres: Disc3, fuel: Fuel, trackmap: MapPin, driver: Users, session: Timer, standings: ListOrdered } as Record<string, typeof Activity>)[slot ?? ''];
  return (
    <section data-pitwall-slot={slot} className={`flex min-w-0 flex-col ${PITWALL_PANEL_CLASS} ${className}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-[#161C27] px-3.5 py-2.5">
        <h3 className="font-heading text-[12px] font-black uppercase tracking-[0.16em] text-slate-300">{Icon && <Icon className="mr-1 inline h-3.5 w-3.5" aria-hidden />}{title}</h3>
        <div className="flex items-center gap-2">
          {meta != null && <span className="text-[11px] text-slate-500">{meta}</span>}
          {actions}
        </div>
      </header>
      <div className={`min-w-0 flex-1 px-3.5 py-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export type PitwallTone = "neutral" | "accent" | "positive" | "warning" | "negative" | "muted";

const toneClass: Record<PitwallTone, string> = {
  neutral: "text-white",
  accent: "text-orange-300",
  positive: "text-emerald-300",
  warning: "text-amber-300",
  negative: "text-red-300",
  muted: "text-slate-400",
};

/**
 * Eén waarde met een label erboven. De waarde is de hoofdzaak (24–32px), het
 * label blijft klein maar leesbaar (12px) — dat is het verschil met de oude
 * 9px-labels.
 */
export function PitwallMetric({
  label,
  value,
  tone = "neutral",
  hint,
  size = "lg",
  dataAttr,
}: {
  label: string;
  value: ReactNode;
  tone?: PitwallTone;
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
  dataAttr?: Record<string, string>;
}) {
  const sizeClass = size === "lg" ? "text-[26px] leading-none" : size === "md" ? "text-[18px] leading-none" : "text-[14px] leading-none";
  return (
    <div className="min-w-0" {...dataAttr}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1.5 font-mono font-bold tabular-nums ${sizeClass} ${toneClass[tone]}`}>{value}</p>
      {hint != null && <p className="mt-1 text-[11px] leading-tight text-slate-500">{hint}</p>}
    </div>
  );
}
