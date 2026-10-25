/**
 * Labpagina: toont elk pitwall-ontwerp uit src/lab/designNN/ als volledige pagina.
 * Ontwerpen worden automatisch gevonden; een ontbrekend ontwerp laat de rest staan.
 */
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { fixture } from "@/lab/fixture";

type LabModule = {
  meta?: { title?: string; note?: string };
  default: React.ComponentType<{ f: typeof fixture }>;
};

const modules = import.meta.glob<LabModule>("../lab/design*/index.tsx", { eager: true });

const ontwerpen = Object.entries(modules)
  .map(([pad, mod]) => ({
    id: (pad.match(/design(\d+)/) ?? [])[1] ?? pad,
    title: mod.meta?.title ?? pad,
    note: mod.meta?.note ?? "",
    Component: mod.default,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

export default function PitwallLabPage() {
  const { id } = useParams<{ id?: string }>();
  const gekozen = useMemo(
    () => ontwerpen.find((o) => o.id === (id ?? "").padStart(2, "0")) ?? ontwerpen[0],
    [id],
  );

  if (!gekozen) {
    return (
      <div className="min-h-screen bg-black p-10 text-white">
        <h1 className="text-2xl font-bold">Nog geen ontwerpen gevonden</h1>
        <p className="mt-2 text-white/60">Plaats een ontwerp in src/lab/designNN/index.tsx.</p>
      </div>
    );
  }

  const { Component, title, note } = gekozen;
  return (
    <div data-lab="pitwall" data-design={gekozen.id} className="min-h-screen bg-black">
      <Component f={fixture} />
      <footer className="border-t border-white/10 bg-black px-4 py-2 text-[10px] font-mono text-white/40">
        ontwerp {gekozen.id} · {title}{note ? ` · ${note}` : ""}
      </footer>
    </div>
  );
}
