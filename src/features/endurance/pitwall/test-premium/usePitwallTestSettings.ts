import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseViewParam,
  readStoredMotion,
  resolveMotion,
  resolveView,
  prefersReducedMotion,
  writeStoredMotion,
  writeStoredView,
  type PitwallTestView,
} from "./viewSettings";

/**
 * React-brug voor de testweergave. De URL-override wint bij het openen, maar
 * een bewuste klik van de gebruiker schrijft de lokale keuze en haalt de
 * override uit de URL — anders zou de knop onder een noodoverride niets lijken
 * te doen.
 */
export function usePitwallTestSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const [view, setViewState] = useState<PitwallTestView>(() => resolveView(search).view);
  const [overridden, setOverridden] = useState<boolean>(() => resolveView(search).overridden);
  const [storedMotion, setStoredMotionState] = useState<boolean | null>(() => readStoredMotion());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => prefersReducedMotion());
  // Het opruimen van onze eigen URL-parameter mag de zojuist gekozen weergave
  // niet overschrijven met de (mogelijk geweigerde) opslag. Externe navigatie —
  // browser back/forward of een nieuwe URL — moet wel gewoon winnen.
  const selfRemoval = useRef(false);

  useEffect(() => {
    const hasParam = parseViewParam(search) !== null;
    if (!hasParam && selfRemoval.current) {
      selfRemoval.current = false;
      return;
    }
    const resolved = resolveView(search);
    setViewState(resolved.view);
    setOverridden(resolved.overridden);
  }, [search]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const chooseView = useCallback(
    (next: PitwallTestView) => {
      setViewState(next);
      writeStoredView(next);
      setOverridden(false);
      if (searchParams.has("pitwallView")) {
        selfRemoval.current = true;
        const cleaned = new URLSearchParams(searchParams);
        cleaned.delete("pitwallView");
        setSearchParams(cleaned, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const motion = resolveMotion(storedMotion, reducedMotion);
  const toggleMotion = useCallback(() => {
    if (motion.locked) return;
    const next = !motion.enabled;
    setStoredMotionState(next);
    writeStoredMotion(next);
  }, [motion.enabled, motion.locked]);

  return {
    view,
    chooseView,
    overridden,
    motionEnabled: motion.enabled,
    motionLocked: motion.locked,
    toggleMotion,
  };
}
