/**
 * Instellingen voor de pitwall-testweergave.
 *
 * Deze module is bewust vrij van React: de noodoverride uit de URL, de blijvende
 * lokale keuze en de systeemvoorkeur voor minder beweging zijn alle drie los te
 * testen. Opslag mag nooit de pagina laten breken; elke lees- of schrijffout
 * valt terug op de standaard (nieuwe weergave, beweging aan).
 */

export type PitwallTestView = "classic" | "premium";

export const VIEW_STORAGE_KEY = "3sm.pitwall-test.view.v1";
export const MOTION_STORAGE_KEY = "3sm.pitwall-test.motion.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isView = (value: unknown): value is PitwallTestView => value === "classic" || value === "premium";

export function safeStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `?pitwallView=classic` is de noodrem; `nieuw` is een leesbare alias. */
export function parseViewParam(search: string): PitwallTestView | null {
  try {
    const query = search.startsWith("?") ? search.slice(1) : search;
    const raw = new URLSearchParams(query).get("pitwallView")?.trim().toLowerCase();
    if (raw === "classic") return "classic";
    if (raw === "premium" || raw === "nieuw") return "premium";
  } catch {
    /* onleesbare query: geen override */
  }
  return null;
}

export function readStoredView(storage: StorageLike | null = safeStorage()): PitwallTestView {
  try {
    const raw = storage?.getItem(VIEW_STORAGE_KEY);
    return isView(raw) ? raw : "premium";
  } catch {
    return "premium";
  }
}

export function writeStoredView(view: PitwallTestView, storage: StorageLike | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VIEW_STORAGE_KEY, view);
    return true;
  } catch {
    return false;
  }
}

export function resolveView(
  search: string,
  storage: StorageLike | null = safeStorage(),
): { view: PitwallTestView; overridden: boolean } {
  const param = parseViewParam(search);
  if (param) return { view: param, overridden: true };
  return { view: readStoredView(storage), overridden: false };
}

export function withoutPitwallViewParam(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.delete("pitwallView");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export function readStoredMotion(storage: StorageLike | null = safeStorage()): boolean | null {
  try {
    const raw = storage?.getItem(MOTION_STORAGE_KEY);
    if (raw === "on") return true;
    if (raw === "off") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredMotion(enabled: boolean, storage: StorageLike | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(MOTION_STORAGE_KEY, enabled ? "on" : "off");
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(
  matchMedia: ((query: string) => Pick<MediaQueryList, "matches">) | undefined = typeof window !== "undefined"
    ? (query) => window.matchMedia(query)
    : undefined,
): boolean {
  try {
    return Boolean(matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

/**
 * De systeemvoorkeur is geen suggestie: bij `reduce` staat beweging uit en kan
 * de knop hem niet forceren. Zonder voorkeur is de standaard aan.
 */
export function resolveMotion(
  stored: boolean | null,
  reducedMotion: boolean,
): { enabled: boolean; locked: boolean } {
  if (reducedMotion) return { enabled: false, locked: true };
  return { enabled: stored ?? true, locked: false };
}
