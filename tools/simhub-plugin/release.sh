#!/usr/bin/env bash
# 3SM EnduranceConnector — volledige release.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSEMBLY="$SCRIPT_DIR/3SM.EnduranceConnector/AssemblyInfo.cs"
PRIVATE_KEY="${HOME}/.hermes/keys/release-signing-private.pem"
[ -f "$PRIVATE_KEY" ] || PRIVATE_KEY="$SCRIPT_DIR/release-signing-private.pem"
SSH_WIN="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no vdevo@192.168.50.119"
WS_WIN="C:/Users/vdevo/3sm/simhub-plugin"
BUILD_SCRIPT_WIN="C:/Users/vdevo/3sm/build-plugin.ps1"
STAGING="$(mktemp -d /tmp/3sm-release-XXXX)"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

echo "=== 3SM EnduranceConnector release ==="

read_version() { grep -oE 'AssemblyVersion\("[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' "$ASSEMBLY" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; }
CURRENT=$(read_version)
echo "Huidige versie: $CURRENT"

SKIP_BUILD=
case "${1:-}" in --skip-build) SKIP_BUILD=1 ;; esac

if [ -z "$SKIP_BUILD" ]; then
  bash "$SCRIPT_DIR/bump-version.sh" "${1:-}"
  NEW=$(read_version)
  echo "Nieuwe versie: $CURRENT → $NEW"
  git -C "$REPO_DIR" add "$ASSEMBLY"
  git -C "$REPO_DIR" commit -m "chore(simhub): bump version to $NEW"

  if ! timeout 3 bash -c "echo > /dev/tcp/192.168.50.119/22" 2>/dev/null; then
    echo "FOUT: Beest (192.168.50.119) is offline."; exit 1
  fi

  echo "Bronbestanden syncen..."
    scp "$SCRIPT_DIR/create-dirs.ps1" "vdevo@192.168.50.119:C:/Users/vdevo/3sm/create-dirs.ps1"
    $SSH_WIN "powershell -NoP -Exec Bypass -File C:\\Users\\vdevo\\3sm\\create-dirs.ps1"

  scp "$SCRIPT_DIR"/3SM.EnduranceConnector/{AssemblyInfo.cs,ConnectorSettings.cs,EnduranceConnectorPlugin.cs,SettingsControl.cs,TelemetryContracts.cs,3SM.EnduranceConnector.csproj} \
    "vdevo@192.168.50.119:$WS_WIN/3SM.EnduranceConnector/"
  scp "$SCRIPT_DIR"/3SM.EnduranceConnector/Assets/* \
    "vdevo@192.168.50.119:$WS_WIN/3SM.EnduranceConnector/Assets/"
  scp "$SCRIPT_DIR"/3SM.EnduranceConnector.Updater/{AssemblyInfo.cs,Program.cs,3SM.EnduranceConnector.Updater.csproj} \
    "vdevo@192.168.50.119:$WS_WIN/3SM.EnduranceConnector.Updater/"
  scp "$HOME/.hermes/scripts/3sm-build-plugin.ps1" \
    "vdevo@192.168.50.119:C:/Users/vdevo/3sm/build-plugin.ps1"

  echo "Plugin builden op Beest..."
  BUILD_OUTPUT=$($SSH_WIN "powershell -NoP -Exec Bypass -File C:\\Users\\vdevo\\3sm\\build-plugin.ps1" 2>&1)
  echo "$BUILD_OUTPUT"
  if ! grep -q "BUILD_OK" <<<"$BUILD_OUTPUT"; then echo "FOUT: Build mislukt."; exit 1; fi

  scp "vdevo@192.168.50.119:C:/Users/vdevo/3sm/3SM.EnduranceConnector/bin/Release/3SM.EnduranceConnector.dll" \
    "$STAGING/3SM.EnduranceConnector.dll"
fi

NEW="${NEW:-$(read_version)}"
DLL_PATH="$STAGING/3SM.EnduranceConnector.dll"
DLL_FILE="3SM.EnduranceConnector-$NEW.dll"
DLL_URL="https://3stripemotorsport.cc/downloads/$DLL_FILE"
SHA256=$(sha256sum "$DLL_PATH" | awk '{print $1}')
BYTES=$(stat -c%s "$DLL_PATH")

if [ -f "$PRIVATE_KEY" ]; then
  # Signeer het manifest: gebruik tijdelijk bestand voor robuuste openssl-verificatie
  MANIFEST_TMP="$(mktemp /tmp/3sm-manifest-XXXX)"
  cleanup_manifest() { rm -f "$MANIFEST_TMP" "${MANIFEST_TMP}.sig"; }
  trap cleanup_manifest EXIT
  printf '%s\n' "$NEW" "$DLL_URL" "$SHA256" "$BYTES" "$DLL_FILE" > "$MANIFEST_TMP"
  SIGNATURE=$(printf '%s\n' "$NEW" "$DLL_URL" "$SHA256" "$BYTES" "$DLL_FILE" | openssl dgst -sha256 -sign "$PRIVATE_KEY" | base64 -w0)
  printf '%s\n' "$NEW" "$DLL_URL" "$SHA256" "$BYTES" "$DLL_FILE" | openssl dgst -sha256 -verify "$SCRIPT_DIR/release-signing-public.pem" \
    -signature <(printf '%s' "$SIGNATURE" | base64 -d) >/dev/null 2>&1 || { echo "FOUT: Handtekeningverificatie"; exit 1; }
  echo "Manifest ondertekend en geverifieerd."
else
  SIGNATURE=""
  echo "WAARSCHUWING: release-signing-private.pem niet gevonden. Sla manifest-signing over."
fi

echo "DLL uploaden naar webroot..."
scp "$DLL_PATH" "3sm-web:/var/www/3sm/downloads/$DLL_FILE" >/dev/null 2>&1 || { echo "FOUT: Upload naar webroot mislukt."; exit 1; }
echo "  Gekopieerd naar 3sm-web:/var/www/3sm/downloads/$DLL_FILE"

echo "Edge-functie deployen..."
ssh -o BatchMode=yes 3sm-docker "cat > /opt/supabase/docker/volumes/functions/simhub-version/.env << EOF
SIMHUB_PLUGIN_VERSION=$NEW
SIMHUB_PLUGIN_DLL_URL=$DLL_URL
SIMHUB_PLUGIN_SHA256=$SHA256
SIMHUB_PLUGIN_BYTE_LENGTH=$BYTES
SIMHUB_PLUGIN_FILE_NAME=$DLL_FILE
SIMHUB_PLUGIN_SIGNATURE=$SIGNATURE
EOF
cd /opt/supabase/docker && docker compose up -d --force-recreate functions"

echo ""
echo "=== Release $NEW voltooid ==="
echo "DLL: $DLL_URL"
echo "SHA256: $SHA256"
echo ""
echo "Nog te doen:"
echo "  1. git push origin fix/endurance-multiuser-hardening"
echo "  2. git checkout main && git merge fix/endurance-multiuser-hardening && git push origin main"
echo "  3. Cloudflare cache purgen voor /downloads/"