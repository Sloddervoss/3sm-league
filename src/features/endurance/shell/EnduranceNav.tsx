import { Archive, CalendarDays, ListChecks, Settings2 } from "lucide-react";

export type EnduranceSection = "upcoming" | "mine" | "archive" | "manage";

const items = [
  { id: "upcoming", label: "Aankomende races", icon: CalendarDays },
  { id: "mine", label: "Mijn races", icon: ListChecks },
  { id: "archive", label: "Endurance-archief", icon: Archive },
] as const;

export const EnduranceNav = ({ section, onChange, showManage }: { section: EnduranceSection; onChange: (section: EnduranceSection) => void; showManage: boolean }) => <div className="overflow-x-auto"><div className="flex min-w-max gap-2 rounded-2xl bg-black/25 p-2 ring-1 ring-white/5">{items.map((item) => <button key={item.id} type="button" onClick={() => onChange(item.id)} className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition ${section === item.id ? "bg-white/[0.09] text-white ring-1 ring-white/10" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}><item.icon className="h-4 w-4" />{item.label}</button>)}{showManage && <button type="button" onClick={() => onChange("manage")} className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition ${section === "manage" ? "bg-orange-500 text-white" : "text-orange-300 hover:bg-orange-500/10"}`}><Settings2 className="h-4 w-4" />Racebeheer</button>}</div></div>;
