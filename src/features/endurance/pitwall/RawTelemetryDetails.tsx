import { useState } from "react";

/**
 * De raw-telemetrie achter een uitklapper, voor als de pitwall iets niet toont
 * wat de SimsHub wél stuurde.
 *
 * Waarom dit een eigen component is en geen `<details onClick={…}>` in de pagina:
 * een `onClick` met `preventDefault()` houdt de native toggle van `<details>`
 * tegen. Zonder `open` op het element komt de `[open]`-status er dan nooit, en
 * blijft de inhoud verborgen — ook als de state intussen wél op `true` staat. De
 * pagina zag er dus goed uit en was in een echte browser leeg.
 *
 * Daarom is dit een gecontroleerde uitklapper: `open={showRaw}` zet de status
 * vanuit de state, en `onToggle` houdt de state bij als de browser (of een
 * voorlezer) zelf toggelt. `preventDefault` blijft staan zodat de browser niet
 * én zelf toggelt én de state laat omzetten: één eigenaar van de status.
 */
export function RawTelemetryDetails({ value }: { value: unknown }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <details
      className="rounded-lg border border-white/10 bg-white/[0.02]"
      open={showRaw}
      onToggle={(event) => setShowRaw(event.currentTarget.open)}
      data-pitwall-raw={showRaw ? "open" : "dicht"}
    >
      <summary
        className="cursor-pointer px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 select-none"
        onClick={(event) => {
          // De state is de enige eigenaar van `open`; de native toggle zou er
          // een tweede eigenaar bij maken.
          event.preventDefault();
          setShowRaw((open) => !open);
        }}
      >
        {showRaw ? "Verberg" : "Toon"} raw telemetrie (JSON)
      </summary>
      {showRaw && (
        <pre className="max-h-[420px] overflow-auto border-t border-white/10 px-4 py-3 text-[10px] leading-relaxed text-gray-300">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </details>
  );
}
