import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const ANIMATION_ID = "pitwall-test-row-reorder";
const ROW_SELECTOR = "[data-timing-row-id]";
const DURATION_MS = 320;
const EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

interface Snapshot {
  resetKey: string;
  positions: Map<string, number>;
}

const measure = (root: HTMLElement): Map<string, number> => {
  const positions = new Map<string, number>();
  for (const element of root.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    const id = element.dataset.timingRowId;
    if (!id) continue;
    // offsetTop is de lay-outpositie en negeert een lopende transform. Zo kan
    // een tweede render tijdens de FLIP dezelfde rij niet opnieuw laten springen.
    positions.set(id, element.offsetTop);
  }
  return positions;
};

/**
 * Echte FLIP voor tabelrijen: meet vóór de nieuwe volgorde, laat de DOM
 * onmiddellijk de nieuwste data zien en speelt alleen het verschil terug met de
 * Web Animations API. Geen tussenstand, geen wachtrij:
 *
 * - eerste snapshot en iedere `resetKey`-wissel (context, filter, tab) ijken
 *   zonder animatie;
 * - een nieuwe beweging annuleert de vorige animatie van die rij;
 * - `enabled=false` (Beweging uit of prefers-reduced-motion) doet niets;
 * - een verborgen tab wist de basis, zodat terugkomst geen oude sprong speelt.
 */
export function useRowFlip(
  rootRef: RefObject<HTMLElement | null>,
  { enabled, resetKey }: { enabled: boolean; resetKey: string },
): void {
  const previous = useRef<Snapshot | null>(null);
  const animations = useRef(new Map<string, Animation>());

  const cancel = useCallback((id: string) => {
    const running = animations.current.get(id);
    if (!running) return;
    try {
      running.cancel();
    } catch {
      /* al afgelopen */
    }
    animations.current.delete(id);
  }, []);

  const cancelAll = useCallback(() => {
    for (const id of [...animations.current.keys()]) cancel(id);
  }, [cancel]);

  useEffect(() => {
    const onVisibility = () => {
      previous.current = null;
      cancelAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAll();
    };
  }, [cancelAll]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      // De tabel is weg (noData/gat). Bewaar geen oude basis: bij terugkomst
      // zou die een sprong animeren die nooit in beeld is gebeurd.
      previous.current = null;
      cancelAll();
      return;
    }
    if (document.hidden) {
      previous.current = null;
      cancelAll();
      return;
    }

    // Offline/datagat én Beweging uit hebben geen geldige vergelijkingsbasis.
    // De eerste teruggekeerde snapshot is een ijkpunt, ook als de tabel bleef staan.
    if (!enabled) {
      previous.current = null;
      cancelAll();
      return;
    }

    const next = measure(root);
    const before = previous.current;

    if (!before || before.resetKey !== resetKey) {
      previous.current = { resetKey, positions: next };
      cancelAll();
      return;
    }

    for (const [id, top] of next) {
      const oldTop = before.positions.get(id);
      if (oldTop == null) continue;
      const delta = oldTop - top;
      if (Math.abs(delta) < 2) continue;

      const element = [...root.querySelectorAll<HTMLElement>(ROW_SELECTOR)].find(
        (el) => el.dataset.timingRowId === id,
      );
      if (!element || typeof element.animate !== "function") continue;

      // Eén animatie per rij; een snelle volgende snapshot mag niet stapelen.
      cancel(id);
      try {
        for (const running of element.getAnimations?.() ?? []) {
          if (running.id === ANIMATION_ID) running.cancel();
        }
        const animation = element.animate(
          [{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: DURATION_MS, easing: EASING, fill: "both" },
        );
        animation.id = ANIMATION_ID;
        animations.current.set(id, animation);
        animation.onfinish = () => {
          if (animations.current.get(id) === animation) animations.current.delete(id);
        };
      } catch {
        /* browsers zonder WAAPI vallen terug op de directe, correcte volgorde */
      }
    }

    previous.current = { resetKey, positions: next };
  });
}
