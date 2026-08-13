#!/usr/bin/env bash
set -euo pipefail

# Chromium bundled by Playwright needs NSS/NSPR shared libraries. The Hermes host
# intentionally has no sudo/root package install, so keep a reproducible user-local
# runtime instead of relying on an ad-hoc LD_LIBRARY_PATH in individual commands.
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/3sm-playwright-runtime"
LIB_ROOT="$CACHE_ROOT/root/usr/lib/x86_64-linux-gnu"
REQUIRED=(libnspr4.so libnss3.so libnssutil3.so libsmime3.so)

bundle_complete() {
  local candidate="$1"
  local library
  for library in "${REQUIRED[@]}"; do
    [[ -f "$candidate/$library" ]] || return 1
  done
}

missing=0
for library in "${REQUIRED[@]}"; do
  [[ -f "$LIB_ROOT/$library" ]] || missing=1
done

if [[ "$missing" -eq 1 ]]; then
  # Migrate the previously proven Hermes bundle once. From then on this project
  # owns a stable cache path and individual smoke commands need no env workaround.
  LEGACY_LIB_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/playwright-libs/root/usr/lib/x86_64-linux-gnu"
  if bundle_complete "$LEGACY_LIB_ROOT"; then
    mkdir -p "$LIB_ROOT"
    cp -a "$LEGACY_LIB_ROOT"/. "$LIB_ROOT"/
    missing=0
  fi
fi

if [[ "$missing" -eq 1 ]]; then
  command -v apt-get >/dev/null || { echo "apt-get is required to download the browser runtime" >&2; exit 1; }
  command -v dpkg-deb >/dev/null || { echo "dpkg-deb is required to unpack the browser runtime" >&2; exit 1; }
  mkdir -p "$CACHE_ROOT/packages" "$CACHE_ROOT/root"
  (
    cd "$CACHE_ROOT/packages"
    rm -f ./*.deb
    apt-get download libnss3 libnspr4 >/dev/null
    for package in ./*.deb; do dpkg-deb -x "$package" "$CACHE_ROOT/root"; done
  )
fi

for library in "${REQUIRED[@]}"; do
  [[ -f "$LIB_ROOT/$library" ]] || { echo "Browser runtime incomplete: $library is missing" >&2; exit 1; }
done

export LD_LIBRARY_PATH="$LIB_ROOT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
