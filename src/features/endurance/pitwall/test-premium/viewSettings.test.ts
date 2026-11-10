import { describe, expect, it } from "vitest";
import {
  MOTION_STORAGE_KEY,
  VIEW_STORAGE_KEY,
  parseViewParam,
  prefersReducedMotion,
  readStoredMotion,
  readStoredView,
  resolveMotion,
  resolveView,
  safeStorage,
  withoutPitwallViewParam,
  writeStoredMotion,
  writeStoredView,
  type StorageLike,
} from "./viewSettings";

const memoryStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
};

const throwingStorage = (): StorageLike => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
});

describe("pitwall-test weergave-instellingen", () => {
  it("default is de nieuwe weergave", () => {
    expect(readStoredView(memoryStorage())).toBe("premium");
    expect(resolveView("", memoryStorage())).toEqual({ view: "premium", overridden: false });
  });

  it("leest en schrijft de lokale keuze", () => {
    const storage = memoryStorage();
    expect(writeStoredView("classic", storage)).toBe(true);
    expect(storage.data[VIEW_STORAGE_KEY]).toBe("classic");
    expect(readStoredView(storage)).toBe("classic");
  });

  it("valt bij onbekende of beschadigde opslag terug op nieuw", () => {
    expect(readStoredView(memoryStorage({ [VIEW_STORAGE_KEY]: "iets-anders" }))).toBe("premium");
    expect(readStoredView(throwingStorage())).toBe("premium");
    expect(writeStoredView("classic", throwingStorage())).toBe(false);
  });

  it("leest de noodoverride uit de URL", () => {
    expect(parseViewParam("?pitwallView=classic")).toBe("classic");
    expect(parseViewParam("?foo=1&pitwallView=PREMIUM")).toBe("premium");
    expect(parseViewParam("?pitwallView=nieuw")).toBe("premium");
    expect(parseViewParam("?pitwallView=onzin")).toBeNull();
    expect(resolveView("?pitwallView=classic", memoryStorage({ [VIEW_STORAGE_KEY]: "premium" }))).toEqual({
      view: "classic",
      overridden: true,
    });
  });

  it("haalt alleen de weergaveparameter uit de URL", () => {
    expect(withoutPitwallViewParam("?a=1&pitwallView=classic&b=2")).toBe("?a=1&b=2");
    expect(withoutPitwallViewParam("?pitwallView=classic")).toBe("");
  });
});

describe("beweging", () => {
  it("staat standaard aan en respecteert een expliciete keuze", () => {
    expect(resolveMotion(null, false)).toEqual({ enabled: true, locked: false });
    expect(resolveMotion(false, false)).toEqual({ enabled: false, locked: false });
    expect(resolveMotion(true, false)).toEqual({ enabled: true, locked: false });
  });

  it("systeemvoorkeur voor minder beweging wint altijd", () => {
    expect(resolveMotion(null, true)).toEqual({ enabled: false, locked: true });
    expect(resolveMotion(true, true)).toEqual({ enabled: false, locked: true });
  });

  it("leest en schrijft de bewegingkeuze veilig", () => {
    const storage = memoryStorage();
    expect(readStoredMotion(storage)).toBeNull();
    expect(writeStoredMotion(false, storage)).toBe(true);
    expect(storage.data[MOTION_STORAGE_KEY]).toBe("off");
    expect(readStoredMotion(storage)).toBe(false);
    expect(readStoredMotion(memoryStorage({ [MOTION_STORAGE_KEY]: "kapot" }))).toBeNull();
    expect(writeStoredMotion(true, throwingStorage())).toBe(false);
  });

  it("leest de media-query zonder te crashen", () => {
    expect(prefersReducedMotion(() => ({ matches: true }) as MediaQueryList)).toBe(true);
    expect(prefersReducedMotion(() => {
      throw new Error("geen matchMedia");
    })).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });

  it("geeft null als localStorage niet beschikbaar is", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    try {
      expect(safeStorage()).toBeNull();
      expect(readStoredView()).toBe("premium");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});
