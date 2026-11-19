import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Presentatie-only focusmodus voor de premium pitwall-test.
 *
 * De hook kent geen data, apparaat of race. Hij regelt alleen:
 *
 * - focus aan/uit binnen dezelfde React-boom (geen route, geen link, geen remount);
 * - native fullscreen op de focuscontainer, inclusief `fullscreenchange`;
 * - Esc verlaat de focusweergave (in native fullscreen doet de browser zelf de
 *   eerste Esc en blijft de focusweergave bruikbaar);
 * - een eerlijke terugval wanneer fullscreen niet ondersteund of geweigerd wordt;
 * - herstel van scrollpositie en toetsenbordfocus bij het verlaten.
 *
 * De normale pitwall gebruikt `?pitwallFocus=1`; deze pagina is admin-only en
 * heeft geen publieke link. Daarom is de staat hier bewust lokaal en niet in de
 * URL: de presentatie hangt niet af van een profiel- of linkkeuze.
 */

export interface PitwallFocusOptions {
  /** Bij het verlaten: de pagina opent bijvoorbeeld de profieldock weer. */
  onExit?: () => void;
}

export interface PitwallFocusApi {
  active: boolean;
  fullscreen: boolean;
  /** Zichtbare, niet-bellende uitleg als fullscreen niet kan. */
  message: string | null;
  shellRef: RefObject<HTMLDivElement>;
  exitButtonRef: RefObject<HTMLButtonElement>;
  enter: (trigger?: HTMLElement | null) => void;
  exit: () => void;
  toggleFullscreen: () => Promise<void>;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/** Alleen ons eigen fullscreen-element telt; een andere fullscreen laat de focus staan. */
const isOurFullscreen = (element: Element | null, shell: HTMLElement | null): boolean =>
  Boolean(element && shell && element === shell);

export function usePitwallFocus(options: PitwallFocusOptions = {}): PitwallFocusApi {
  const [active, setActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const exitButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeRef = useRef(false);
  const savedFocusRef = useRef<HTMLElement | null>(null);
  const savedScrollRef = useRef(0);
  const onExitRef = useRef(options.onExit);
  onExitRef.current = options.onExit;

  /** Scrollherstel en focus terug naar de knop die de focus opende. */
  const restoreViewport = useCallback(() => {
    window.scrollTo(0, savedScrollRef.current);
    const saved = savedFocusRef.current;
    const visibleSaved = saved && saved.isConnected && !saved.closest("[hidden]") ? saved : null;
    const target = visibleSaved ?? document.querySelector<HTMLElement>("[data-pitwall-focus-entry]");
    if (!target || !target.isConnected) return;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
  }, []);

  const enter = useCallback((trigger?: HTMLElement | null) => {
    if (activeRef.current) return;
    const current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    savedFocusRef.current = current;
    savedScrollRef.current = typeof window.scrollY === "number" ? window.scrollY : 0;
    setMessage(null);
    setActive(true);
    activeRef.current = true;
  }, []);

  const exit = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setMessage(null);
    onExitRef.current?.();

    // Eerst uit native fullscreen; de browser vuurt daarna `fullscreenchange`.
    if (typeof document.exitFullscreen === "function" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        /* De browser kan het al verlaten hebben; de focusstaat is al uit. */
      });
    }
    setFullscreen(false);

    // De pagina moet eerst de dock/entry weer zichtbaar maken; één frame is
    // genoeg en houdt de scrollpositie gelijk (geen sprong naar boven).
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restoreViewport);
    } else {
      window.setTimeout(restoreViewport, 0);
    }
  }, [restoreViewport]);

  const toggleFullscreen = useCallback(async () => {
    if (!activeRef.current) return;
    const shell = shellRef.current;
    if (!shell) return;

    if (document.fullscreenElement === shell) {
      if (typeof document.exitFullscreen !== "function") {
        setMessage("Volledig scherm verlaten wordt niet ondersteund in deze browser. Gebruik “Focus verlaten”.");
        return;
      }
      try {
        await document.exitFullscreen();
        setMessage(null);
      } catch {
        setMessage("Volledig scherm kon niet worden verlaten. Gebruik “Focus verlaten”.");
      }
      return;
    }

    if (typeof shell.requestFullscreen !== "function" || document.fullscreenEnabled === false) {
      setMessage("Volledig scherm wordt niet ondersteund in deze browser. De focusweergave blijft actief.");
      return;
    }

    try {
      // Geen await vóór deze aanroep: de klik-activatie moet nog geldig zijn.
      await shell.requestFullscreen();
      setMessage(null);
    } catch {
      setMessage("Volledig scherm werd geweigerd. De focusweergave blijft actief; gebruik “Focus verlaten” om te sluiten.");
    }
  }, []);

  /* Native fullscreen kan ook buiten onze knop om veranderen (Esc, F11,
   * systeemvenster). De focusweergave blijft dan staan; alleen de knopstaat
   * volgt de browser. */
  useEffect(() => {
    const onChange = () => {
      const current = document.fullscreenElement ?? null;
      setFullscreen(isOurFullscreen(current, shellRef.current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!active) return;
    // Focus de expliciete uitgang, zodat toetsenbord en screenreader meteen
    // weten waar ze zijn. Esc doet hetzelfde.
    const button = exitButtonRef.current;
    if (button) {
      try {
        button.focus({ preventScroll: true });
      } catch {
        button.focus();
      }
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // In native fullscreen is Esc van de browser: die sluit fullscreen en de
      // focusweergave blijft bruikbaar. Een tweede Esc verlaat de focus.
      if (document.fullscreenElement) return;
      if (isEditable(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      exit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, exit]);

  /* Navigatie/unmount: nooit de browser in andermans fullscreen achterlaten. */
  useEffect(() => {
    return () => {
      activeRef.current = false;
      const current = document.fullscreenElement ?? null;
      if (current instanceof HTMLElement && current.dataset.ptpFocusShell === "true") {
        void document.exitFullscreen?.().catch(() => {
          /* unmount mag nooit throwen */
        });
      }
    };
  }, []);

  return {
    active,
    fullscreen,
    message,
    shellRef,
    exitButtonRef,
    enter,
    exit,
    toggleFullscreen,
  };
}
