export interface LayeredTrackEntry {
  trackId: number;
  name: string;
  configName: string;
  path: string;
}

export interface LayeredTrackManifest {
  schemaVersion: number;
  sourceSnapshot: string;
  count: number;
  tracks: LayeredTrackEntry[];
  aliases?: Record<string, string>;
}

interface LayeredTrackRuntimeConfig {
  enabled: boolean;
}

export const TRACK_MANIFEST_URL = "/tracks/layered/manifest.json";
export const TRACK_RUNTIME_CONFIG_URL = "/tracks/layered/runtime.json";

export function normalizeTrackName(track: string): string {
  return track.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isLayeredTrackManifest(value: unknown): value is LayeredTrackManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LayeredTrackManifest>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.count === "number" &&
    Array.isArray(candidate.tracks) &&
    candidate.count === candidate.tracks.length &&
    candidate.tracks.every((track) =>
      typeof track?.trackId === "number" &&
      typeof track?.name === "string" &&
      typeof track?.path === "string" &&
      /^\/tracks\/layered\/track-\d+\.svg$/.test(track.path),
    )
  );
}

export function resolveLayeredTrackMap(
  trackName: string,
  manifest: LayeredTrackManifest | null | undefined,
): string | null {
  if (!manifest || typeof trackName !== "string") return null;
  const normalized = normalizeTrackName(trackName);
  if (!normalized) return null;

  const exact = manifest.tracks.find((track) => normalizeTrackName(track.name) === normalized);
  if (exact) return exact.path;

  const aliasTarget = Object.entries(manifest.aliases ?? {}).find(
    ([alias]) => normalizeTrackName(alias) === normalized,
  )?.[1];
  if (!aliasTarget) return null;

  return manifest.tracks.find((track) => normalizeTrackName(track.name) === normalizeTrackName(aliasTarget))?.path ?? null;
}

let runtimePromise: Promise<LayeredTrackManifest | null> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadLayeredTrackRuntime(): Promise<LayeredTrackManifest | null> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        const config = await fetchJson(TRACK_RUNTIME_CONFIG_URL) as Partial<LayeredTrackRuntimeConfig>;
        if (config.enabled !== true) return null;
        const manifest = await fetchJson(TRACK_MANIFEST_URL);
        return isLayeredTrackManifest(manifest) ? manifest : null;
      } catch {
        return null;
      }
    })();
  }
  return runtimePromise;
}

export function resetLayeredTrackRuntimeForTests(): void {
  runtimePromise = null;
}
