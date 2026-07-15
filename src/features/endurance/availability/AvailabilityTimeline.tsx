import type { AvailabilityBlock, EnduranceEvent, EndurancePersona } from "../core/types";

const colors = { available: "bg-emerald-500/70", preferred: "bg-lime-400/75", avoid: "bg-amber-500/70", unavailable: "bg-red-500/75", uncertain: "bg-orange-400/70" };

export const AvailabilityTimeline = ({ event, personas, blocks }: { event: EnduranceEvent; personas: EndurancePersona[]; blocks: AvailabilityBlock[] }) => {
  const windowStart = new Date(event.briefingStartAt).getTime();
  const windowEnd = new Date(event.expectedEndAt).getTime();
  const span = windowEnd - windowStart;
  return <div className="overflow-x-auto rounded-2xl bg-black/20 p-4 ring-1 ring-white/5"><div className="min-w-[720px]">
    <div className="mb-2 ml-36 flex justify-between text-[10px] font-bold text-gray-500"><span>Briefing</span><span>Race start</span><span>Halverwege</span><span>Verwachte finish</span></div>
    <div className="space-y-2">{personas.map((persona) => <div key={persona.id} className="grid grid-cols-[8rem_1fr] items-center gap-2"><span className="truncate text-xs font-bold text-gray-300">{persona.name}</span><div className="relative h-9 overflow-hidden rounded-lg bg-white/[0.035] ring-1 ring-white/5"><span className="absolute bottom-0 top-0 w-px bg-orange-500/30" style={{ left: `${((new Date(event.startAt).getTime() - windowStart) / span) * 100}%` }} />{blocks.filter((block) => block.userId === persona.id).map((block) => { const left = Math.max(0, ((new Date(block.startAt).getTime() - windowStart) / span) * 100); const right = Math.min(100, ((new Date(block.endAt).getTime() - windowStart) / span) * 100); return <div key={block.id} title={`${block.type}: ${block.note}`} className={`absolute inset-y-1 rounded-md ${colors[block.type]}`} style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} />; })}</div></div>)}</div>
  </div></div>;
};
