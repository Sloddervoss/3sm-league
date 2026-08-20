import { type CSSProperties, useEffect, useState } from "react";
import { getTrackInfo } from "@/lib/trackData";
import { loadLayeredTrackRuntime, resolveLayeredTrackMap } from "@/lib/layeredTrackMaps";

export interface TrackMapProps {
  track: string;
  trackId?: number | null;
  className?: string;
  style?: CSSProperties;
  fallbackStyle?: CSSProperties;
  alt?: string;
  decorative?: boolean;
  loading?: "eager" | "lazy";
  fallback?: React.ReactNode;
}

/** Shared circuit renderer. Runtime/config/asset failures fail closed to the old map. */
export function TrackMap({
  track,
  trackId = null,
  className,
  style,
  fallbackStyle,
  alt,
  decorative = true,
  loading = "lazy",
  fallback = null,
}: TrackMapProps) {
  const oldImage = getTrackInfo(track)?.imageUrl;
  const [layeredImage, setLayeredImage] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>(oldImage);

  useEffect(() => {
    let active = true;
    setLayeredImage(null);
    setSource(oldImage);
    void loadLayeredTrackRuntime().then((manifest) => {
      if (!active || !manifest) return;
      const resolved = resolveLayeredTrackMap(track, manifest, trackId);
      if (resolved) {
        setLayeredImage(resolved);
        setSource(resolved);
      }
    });
    return () => { active = false; };
  }, [oldImage, track, trackId]);

  if (!source) return <>{fallback}</>;

  return (
    <img
      src={source}
      alt={decorative ? "" : (alt ?? `${track} circuit map`)}
      aria-hidden={decorative || undefined}
      role={decorative ? "presentation" : undefined}
      className={className}
      style={source === layeredImage ? style : { ...style, ...fallbackStyle }}
      loading={loading}
      onError={() => {
        if (source === layeredImage && oldImage && oldImage !== source) {
          setSource(oldImage);
        } else {
          setSource(undefined);
        }
      }}
    />
  );
}
