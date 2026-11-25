import { usePoolingPreference } from "./usePoolingPreference";

/**
 * Eén kleinwoord-knop: doen we mee aan het circuitgemiddelde of niet. Geen
 * tooltip, geen uitleg-regel; de stand staat ín de knop.
 */
export const PitPoolingToggle = () => {
  const { enabled, pending, failed, toggle } = usePoolingPreference();
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={enabled}
      className="mt-0.5 text-[10px] text-gray-500 transition hover:text-gray-300 disabled:opacity-50"
    >
      {failed ? "delen · opnieuw" : `delen · ${enabled ? "aan" : "uit"}`}
    </button>
  );
};
