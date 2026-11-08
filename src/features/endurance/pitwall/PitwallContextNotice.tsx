import type { PitwallContextNotice as Notice } from "./pitwallHelpers";

/**
 * De melding boven de pitwall als er geen geldige racekoppeling is (fase 1).
 *
 * Bewust een eigen component: de tekst komt uit pitwallContextNotice() en niet uit
 * de JSX, zodat server en scherm hetzelfde verhaal vertellen en de tekst testbaar
 * is zonder een hele race te hoeven renderen.
 */
export const PitwallContextNotice = ({ notice }: { notice: Notice | null }) => {
  if (!notice) return null;
  return (
    <div
      role="status"
      className={
        notice.tone === "warning"
          ? "rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] font-medium text-amber-200"
          : "rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-slate-300"
      }
      data-pitwall-context-notice={notice.tone}
    >
      {notice.message}
    </div>
  );
};
