#!/usr/bin/env bash
# 3SM EnduranceConnector — volledige release.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSEMBLY="$SCRIPT_DIR/3SM.EnduranceConnector/AssemblyInfo.cs"
# SimHub-release signing key: HOORT bij de public key die in de connector is gehard
# (modulus 623ziGD... / eb6df3). De oude key (release-signing-private.pem) past daar NIET op.
# Geen stille fallback naar de oude key; als de juiste key ontbreekt faalt de release hard.
PRIVATE_KEY="${HOME}/.hermes/keys/3sm-simhub-release-private.pem"
[ -f "$PRIVATE_KEY" ] || PRIVATE_KEY="$SCRIPT_DIR/3sm-simhub-release-private.pem"
SSH_WIN="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no vdevo@192.168.50.119"
WS_WIN="C:/Users/vdevo/3sm/simhub-plugin"
BUILD_SCRIPT_WIN="C:/Users/vdevo/3sm/build-plugin.ps1"
STAGING="$(mktemp -d /tmp/3sm-release-XXXX)"
MANIFEST_TMP=""
cleanup() { rm -rf "$STAGING"; [ -z "$MANIFEST_TMP" ] || rm -f "$MANIFEST_TMP" "${MANIFEST_TMP}.sig"; }
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
  BUILD_OUTPUT=$($SSH_WIN "powershell -NoP -Exec Bypass -File C:\\Users\\vdevo\\3sm\\build-plugin.ps1 -WorkspaceRoot C:\\Users\\vdevo\\3sm\\simhub-plugin" 2>&1)
  echo "$BUILD_OUTPUT"
  if ! grep -q "BUILD_OK" <<<"$BUILD_OUTPUT"; then echo "FOUT: Build mislukt."; exit 1; fi

  scp "vdevo@192.168.50.119:C:/Users/vdevo/3sm/simhub-plugin/3SM.EnduranceConnector/bin/Release/3SM.EnduranceConnector.dll" \
    "$STAGING/3SM.EnduranceConnector.dll"
fi

NEW="${NEW:-$(read_version)}"
DLL_PATH="$STAGING/3SM.EnduranceConnector.dll"
DLL_FILE="3SM.EnduranceConnector-$NEW.dll"
DLL_URL="https://3stripemotorsport.cc/downloads/$DLL_FILE"
SHA256=$(sha256sum "$DLL_PATH" | awk '{print $1}')
BYTES=$(stat -c%s "$DLL_PATH")
BUILT_VERSION=$($SSH_WIN "powershell -NoP -Command \"[System.Reflection.AssemblyName]::GetAssemblyName('C:\\Users\\vdevo\\3sm\\simhub-plugin\\3SM.EnduranceConnector\\bin\\Release\\3SM.EnduranceConnector.dll').Version.ToString()\"")
BUILT_VERSION=$(tr -d '\r\n' <<<"$BUILT_VERSION")
[ "$BUILT_VERSION" = "$NEW" ] || { echo "FOUT: assemblyversie $BUILT_VERSION komt niet overeen met release $NEW"; exit 1; }

if [ -f "$PRIVATE_KEY" ]; then
  PUBLIC_KEY="${HOME}/.hermes/keys/3sm-simhub-release-public.pem"
  [ -f "$PUBLIC_KEY" ] || PUBLIC_KEY="$SCRIPT_DIR/3sm-simhub-release-public.pem"
  MANIFEST_TMP="$(mktemp /tmp/3sm-manifest-XXXX)"
  write_manifest() {
    # Moet byte-voor-byte overeenkomen met BuildManifestPayload(): geen newline na fileName.
    printf '%s\n%s\n%s\n%s\n%s' "$NEW" "$DLL_URL" "$SHA256" "$BYTES" "$DLL_FILE"
  }
  write_manifest > "$MANIFEST_TMP"
  SIGNATURE=$(write_manifest | openssl dgst -sha256 -sign "$PRIVATE_KEY" | base64 -w0)
  write_manifest | openssl dgst -sha256 -verify "$PUBLIC_KEY" \
    -signature <(printf '%s' "$SIGNATURE" | base64 -d) >/dev/null 2>&1 || { echo "FOUT: Handtekeningverificatie"; exit 1; }
  echo "Manifest ondertekend en geverifieerd."
else
  echo "FOUT: private signing key ontbreekt; unsigned release wordt geweigerd."
  exit 1
fi

echo "DLL uploaden naar webroot..."
scp "$DLL_PATH" "3sm-web:/var/www/3sm/downloads/$DLL_FILE" >/dev/null 2>&1 || { echo "FOUT: Upload naar webroot mislukt."; exit 1; }
ssh 3sm-web "chmod 0644 '/var/www/3sm/downloads/$DLL_FILE' && test \"\$(stat -c%s '/var/www/3sm/downloads/$DLL_FILE')\" = '$BYTES' && test \"\$(sha256sum '/var/www/3sm/downloads/$DLL_FILE' | cut -d' ' -f1)\" = '$SHA256'" \
  || { echo "FOUT: gepubliceerd artifact is niet leesbaar of wijkt af."; exit 1; }
echo "  Gekopieerd naar 3sm-web:/var/www/3sm/downloads/$DLL_FILE"

echo "Edge-functie env bijwerken in docker-compose.override.yml..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=no 3sm-docker \
  python3 - "$NEW" "$DLL_URL" "$SHA256" "$BYTES" "$DLL_FILE" "$SIGNATURE" <<'PYEOF'
import re
import sys

version, dll_url, sha256, byte_length, file_name, signature = sys.argv[1:]
path = "/opt/supabase/docker/docker-compose.override.yml"
values = {
    "SIMHUB_PLUGIN_VERSION": version,
    "SIMHUB_PLUGIN_DLL_URL": dll_url,
    "SIMHUB_PLUGIN_SHA256": sha256,
    "SIMHUB_PLUGIN_BYTE_LENGTH": byte_length,
    "SIMHUB_PLUGIN_FILE_NAME": file_name,
    "SIMHUB_PLUGIN_SIGNATURE": signature,
}
with open(path, "r", encoding="utf-8") as handle:
    content = handle.read()
for key, value in values.items():
    pattern = rf'({re.escape(key)}:) ".*"'
    content, count = re.subn(pattern, rf'\g<1> "{value}"', content, count=1)
    if count != 1:
        raise SystemExit(f"FOUT: {key} niet exact eenmaal gevonden")
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PYEOF

ssh -o BatchMode=yes -o StrictHostKeyChecking=no 3sm-docker \
  "cd /opt/supabase/docker && docker compose config -q" \
  || { echo "FOUT: docker-compose-configuratie is ongeldig; endpoint blijft ongewijzigd."; exit 1; }

echo "Edge-functie container herstarten..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=no 3sm-docker "cd /opt/supabase/docker && docker compose up -d --force-recreate functions"
echo ""

echo "=== Release $NEW voltooid ==="
echo "DLL: $DLL_URL"
echo "SHA256: $SHA256"
echo ""
echo "Nog te doen:"
echo "  1. git push origin fix/endurance-multiuser-hardening"
echo "  2. git checkout main && git merge fix/endurance-multiuser-hardening && git push origin main"
echo "  3. Cloudflare cache purgen voor /downloads/"