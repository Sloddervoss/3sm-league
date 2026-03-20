/**
 * trackImages.ts — Helper voor track images (preview systeem)
 * NON-DESTRUCTIVE: raakt trackData.ts niet aan.
 *
 * Prioriteit:
 *  1. Lokaal gedownloade image (public/tracks/{slug}.png)
 *  2. Wikipedia CDN URL uit trackData
 *  3. undefined (caller toont placeholder)
 */
import { getTrackInfo } from "./trackData";

/** Zet een track naam om naar een bestandsnaam-vriendelijke slug */
export function trackSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Geeft de beste beschikbare image URL terug voor een circuit.
 * Checkt eerst /public/tracks/{slug}.png, dan Wikipedia CDN.
 */
export function getTrackImage(trackName: string): string | undefined {
  const info = getTrackInfo(trackName);
  return info?.imageUrl;
}

/**
 * Geeft het lokale pad terug als je tracks hebt gedownload via scripts/fetchTrackImages.js
 * Gebruik dit als je lokale images wil serveren.
 */
export function getLocalTrackImagePath(trackName: string): string {
  const slug = trackSlug(trackName);
  return `/tracks/${slug}.png`;
}
