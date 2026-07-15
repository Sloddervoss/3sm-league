import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Panel = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={cn("rounded-[1.5rem] bg-card/65 p-5 shadow-2xl shadow-black/20 ring-1 ring-white/[0.07]", className)}>{children}</section>
);

export const SectionHeading = ({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) => (
  <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      {eyebrow && <p className="mb-1 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">{eyebrow}</p>}
      <h2 className="font-heading text-xl font-black text-white sm:text-2xl">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-400">{description}</p>}
    </div>
    {action}
  </div>
);

export const PrimaryButton = ({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-4 py-2 text-sm font-black text-white shadow-lg shadow-orange-950/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45", className)}>{children}</button>
);

export const SecondaryButton = ({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white/[0.045] px-4 py-2 text-sm font-bold text-gray-200 ring-1 ring-white/10 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45", className)}>{children}</button>
);

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block space-y-1.5 text-sm font-semibold text-gray-300">
    <span>{label}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
  </label>
);

export const inputClass = "min-h-10 w-full rounded-xl border-0 bg-black/25 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-orange-500/55";

export const StatusPill = ({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "orange" | "green" | "red" | "blue" }) => {
  const tones = { neutral: "bg-white/5 text-gray-300 ring-white/10", orange: "bg-orange-500/10 text-orange-300 ring-orange-500/25", green: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25", red: "bg-red-500/10 text-red-300 ring-red-500/25", blue: "bg-sky-500/10 text-sky-300 ring-sky-500/25" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ring-1", tones[tone])}>{children}</span>;
};
