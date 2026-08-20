#!/usr/bin/env python3
"""Generate self-contained 3SM layered iRacing track maps and a deterministic manifest."""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

SOURCE = Path("/tmp/mm-clone/from-iracing")
METADATA = SOURCE / "iracing-tracks-metadata.json"
OUTPUT = Path("public/tracks/layered")
LAYERS = ("background", "inactive", "pitroad", "active", "start-finish")


def repair_text(value: str) -> str:
    if "Ã" not in value and "Â" not in value:
        return value
    try:
        return value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def data_uri(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def render_svg(folder: Path, track_id: int, name: str) -> str:
    uris = {layer: data_uri(folder / f"{layer}.svg") for layer in LAYERS}
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" role="img" aria-label="{name.replace('&', '&amp;').replace('"', '&quot;')}">
  <title>{name.replace('&', '&amp;').replace('<', '&lt;')}</title>
  <metadata>3SM layered track map; iRacing TrackID {track_id}</metadata>
  <defs>
    <filter id="backgroundColor" color-interpolation-filters="sRGB"><feFlood flood-color="#111827" result="color"/><feComposite in="color" in2="SourceAlpha" operator="in"/></filter>
    <filter id="inactiveColor" color-interpolation-filters="sRGB"><feFlood flood-color="#64748b" result="color"/><feComposite in="color" in2="SourceAlpha" operator="in"/></filter>
    <filter id="activeColor" color-interpolation-filters="sRGB"><feFlood flood-color="#f97316" result="color"/><feComposite in="color" in2="SourceAlpha" operator="in"/></filter>
    <filter id="finishColor" color-interpolation-filters="sRGB"><feFlood flood-color="#f8fafc" result="color"/><feComposite in="color" in2="SourceAlpha" operator="in"/></filter>
    <filter id="activeGlow" color-interpolation-filters="sRGB"><feFlood flood-color="#f97316" result="color"/><feComposite in="color" in2="SourceAlpha" operator="in" result="orange"/><feGaussianBlur in="orange" stdDeviation="7"/></filter>
  </defs>
  <image href="{uris['background']}" width="1920" height="1080" opacity=".22" filter="url(#backgroundColor)"/>
  <image href="{uris['inactive']}" width="1920" height="1080" opacity=".72" filter="url(#inactiveColor)"/>
  <image href="{uris['pitroad']}" width="1920" height="1080" opacity=".46" filter="url(#inactiveColor)"/>
  <image href="{uris['active']}" width="1920" height="1080" opacity=".34" filter="url(#activeGlow)"/>
  <image href="{uris['active']}" width="1920" height="1080" filter="url(#activeColor)"/>
  <image href="{uris['start-finish']}" width="1920" height="1080" filter="url(#finishColor)"/>
</svg>'''


def main() -> None:
    metadata = json.loads(METADATA.read_text(encoding="utf-8-sig"))
    configs = [config for track in metadata["tracks"] for config in track["configurations"]]
    OUTPUT.mkdir(parents=True, exist_ok=True)

    entries = []
    for config in sorted(configs, key=lambda item: int(item["track_id"])):
        track_id = int(config["track_id"])
        name = repair_text(config["track_name_and_config"])
        source_folder = SOURCE / config["svg_local_path"]
        missing = [layer for layer in LAYERS if not (source_folder / f"{layer}.svg").exists()]
        if missing:
            raise FileNotFoundError(f"TrackID {track_id}: missing {missing}")
        filename = f"track-{track_id}.svg"
        (OUTPUT / filename).write_text(render_svg(source_folder, track_id, name), encoding="utf-8")
        entries.append({
            "trackId": track_id,
            "name": name,
            "configName": repair_text(config.get("config_name", "")),
            "path": f"/tracks/layered/{filename}",
        })

    manifest = {
        "schemaVersion": 1,
        "sourceSnapshot": "2026-05-05",
        "count": len(entries),
        "tracks": entries,
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "LAYERED_TRACK_MAPS_OK", "count": len(entries), "output": str(OUTPUT)}))


if __name__ == "__main__":
    main()
