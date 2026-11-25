import { usePoolingPreference } from "./usePoolingPreference";

/**
 * Eén regel onder het geleerde verlies: doet deze rijder mee aan het
 * circuitgemiddelde? Klein en zonder uitleg-blok; de tooltip zegt waar het over
 * gaat en de knop doet meteen wat er staat.
 */
export const PitPoolingToggle = () => {
  const { enabled, pending, failed, toggle } = usePoolingPreference();
  return (
    <div className="mt-1 flex items-baseline justify-between gap-2 text-[10px] text-gray-500">
      <span>
        Race-stops delen voor het circuitgemiddelde ·{" "}
        <span className={enabled ? "text-emerald-400" : "text-gray-400"}>{enabled ? "aan" : "uit"}</span>
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title="Alleen anoniem: baan, layout en tijden. Geen namen, geen apparaat, geen ruwe data."
        className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300 transition hover:border-white/30 hover:text-white disabled:opacity-50"
      >
        {failed ? "opnieuw" : enabled ? "uitzetten" : "aanzetten"}
      </button>
    </div>
  );
};
