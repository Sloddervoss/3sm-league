import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLayeredTrackManifest,
  loadLayeredTrackManifest,
  loadLayeredTrackRuntime,
  normalizeTrackName,
  resetLayeredTrackRuntimeForTests,
  resolveLayeredTrackMap,
  type LayeredTrackManifest,
} from "@/lib/layeredTrackMaps";

const manifest: LayeredTrackManifest = {
  schemaVersion: 1,
  sourceSnapshot: "2026-05-05",
  count: 2,
  tracks: [
    { trackId: 202, name: "Oran Park Raceway - Grand Prix", configName: "Grand Prix", path: "/tracks/layered/track-202.svg" },
    { trackId: 523, name: "Circuit de Spa-Francorchamps - Grand Prix Pits", configName: "Grand Prix Pits", path: "/tracks/layered/track-523.svg" },
  ],
  aliases: { "Oran Park Raceway – Grand Prix": "Oran Park Raceway - Grand Prix" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetLayeredTrackRuntimeForTests();
});

describe("layered track map resolver", () => {
  it("normalizes only case and whitespace", () => {
    expect(normalizeTrackName("  ORAN   Park Raceway - Grand Prix ")).toBe("oran park raceway - grand prix");
  });

  it("resolves exact names and explicit aliases", () => {
    expect(resolveLayeredTrackMap("Oran Park Raceway - Grand Prix", manifest)).toBe("/tracks/layered/track-202.svg");
    expect(resolveLayeredTrackMap("Oran Park Raceway – Grand Prix", manifest)).toBe("/tracks/layered/track-202.svg");
  });

  it("gives an authoritative TrackID priority over a stale readable name", () => {
    expect(resolveLayeredTrackMap("Historische of hernoemde baan", manifest, 523)).toBe("/tracks/layered/track-523.svg");
    expect(resolveLayeredTrackMap("Oran Park Raceway - Grand Prix", manifest, 999999)).toBeNull();
  });

  it("never fuzzy-matches an incomplete or ambiguous circuit name", () => {
    expect(resolveLayeredTrackMap("Oran Park Raceway", manifest)).toBeNull();
    expect(resolveLayeredTrackMap("Circuit de Spa-Francorchamps", manifest)).toBeNull();
    expect(resolveLayeredTrackMap("Spa Grand Prix", manifest)).toBeNull();
  });

  it("validates manifest count and local asset paths", () => {
    expect(isLayeredTrackManifest(manifest)).toBe(true);
    expect(isLayeredTrackManifest({ ...manifest, count: 3 })).toBe(false);
    expect(isLayeredTrackManifest({ ...manifest, tracks: [{ ...manifest.tracks[0], path: "https://example.com/map.svg" }], count: 1 })).toBe(false);
    expect(isLayeredTrackManifest({ ...manifest, tracks: [manifest.tracks[0], { ...manifest.tracks[1], trackId: manifest.tracks[0].trackId }], count: 2 })).toBe(false);
  });
});

describe("runtime kill switch", () => {
  it("keeps the authoritative admin catalog available when rendering is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadLayeredTrackManifest()).toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads the manifest only when runtime config is enabled", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadLayeredTrackRuntime()).toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null and skips manifest fetch when disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadLayeredTrackRuntime()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on config, network, or invalid manifest errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadLayeredTrackRuntime()).toBeNull();
  });
});
