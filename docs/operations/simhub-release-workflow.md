# 3SM EnduranceConnector — release-workflow

## Overzicht

```
bump-version.sh  →  build (Windows)  →  manifest sign  →  DLL upload  →  Edge deploy
```

Het script `tools/simhub-plugin/release.sh` automatiseert de hele keten, maar kan ook stapsgewijs worden uitgevoerd.

## Vereisten

| Benodigdheid | Locatie |
|---|---|
| RSA-publieke sleutel | `tools/simhub-plugin/release-signing-public.pem` (in repo) |
| RSA-privatesleutel | `tools/simhub-plugin/release-signing-private.pem` **(NIET in repo)** |
| Windows-buildhost "Beest" | `192.168.50.119` (SSH-key auth, vdevo) |
| 3sm-web host | SSH-host `3sm-web` (voor nginx webroot en Docker-bridge) |
| 3sm-docker host | Bereikbaar via `ssh 3sm-web ssh 3sm-docker` |

### Privatesleutel genereren (eenmalig)

```bash
cd tools/simhub-plugin
# Genereer 2048-bit RSA-sleutelpaar
openssl genrsa -out release-signing-private.pem 2048
# Exporteer publieke sleutel
openssl rsa -in release-signing-private.pem -pubout -out release-signing-public.pem
# Importeer de publieke XML in EnduranceConnectorPlugin.cs
openssl rsa -in release-signing-private.pem -pubout | python3 -c "
import sys, xml.etree.ElementTree as ET, base64
key_data = sys.stdin.read().encode()
# De huidige public key XML staat in de ReleasePublicKeyXml constante.
# Gebruik RSACryptoServiceProvider.FromXmlString formaat.
"
```

### Windows-buildhost (Beest) inrichten (eenmalig)

Zie `~/.hermes/skills/gaming/simhub-plugin-windows-build/SKILL.md` voor volledige setup.

**Kort:**
1. OpenSSH Server installeren, firewall `sshd` rule op Private
2. Server SSH-sleutel `~/.ssh/id_ed25519` in `C:\ProgramData\ssh\administrators_authorized_keys`
3. VS Build Tools 2022 (MSBuild) + .NET 4.8 targeting pack
4. SimHub geïnstalleerd op `C:\Program Files (x86)\SimHub`
5. `C:\Users\vdevo\3sm\` aanmaken

## Scripts

### `tools/simhub-plugin/release.sh` (volledig geautomatiseerd)

```bash
# Volledige release (minor bump → build → sign → upload → deploy)
./tools/simhub-plugin/release.sh

# Alles behalve build (als DLL al op de server staat)
./tools/simhub-plugin/release.sh --skip-build
```

### `tools/simhub-plugin/bump-version.sh` (alleen versie)

```bash
# Minor bump: 0.1.0.0 → 0.2.0.0 (standaard)
./tools/simhub-plugin/bump-version.sh

# Patch bump: 0.1.0.0 → 0.1.1.0
./tools/simhub-plugin/bump-version.sh --patch

# Release: zet op 1.0.0.0
./tools/simhub-plugin/bump-version.sh --release
```

### `~/.hermes/scripts/3sm-build-plugin.ps1` (Windows-build)

Wordt automatisch door `release.sh` naar Beest gekopieerd en uitgevoerd.

## Handmatige stappen (als release.sh niet werkt)

### 1. Versie bumpen
```bash
cd tools/simhub-plugin
bash bump-version.sh          # 0.3.0.0 → 0.4.0.0
git add 3SM.EnduranceConnector/AssemblyInfo.cs
git commit -m "chore(simhub): bump version to 0.4.0.0"
```

### 2. Bronbestanden syncen naar Windows
```bash
SSH_WIN="ssh -o BatchMode=yes vdevo@192.168.50.119"
WS="C:/Users/vdevo/3sm/simhub-plugin"
$SSH_WIN "powershell -NoP 'New-Item -ItemType Dir -Force \"$WS/3SM.EnduranceConnector/Assets\" -Force | Out-Null'"
scp 3SM.EnduranceConnector/{AssemblyInfo.cs,ConnectorSettings.cs,EnduranceConnectorPlugin.cs,SettingsControl.cs,TelemetryContracts.cs,3SM.EnduranceConnector.csproj} vdevo@192.168.50.119:"$WS/3SM.EnduranceConnector/"
scp 3SM.EnduranceConnector/Assets/* vdevo@192.168.50.119:"$WS/3SM.EnduranceConnector/Assets/"
scp 3SM.EnduranceConnector.Updater/{AssemblyInfo.cs,Program.cs,3SM.EnduranceConnector.Updater.csproj} vdevo@192.168.50.119:"$WS/3SM.EnduranceConnector.Updater/"
```

### 3. Builden op Windows
```bash
$SSH_WIN "powershell -NoP -Exec Bypass -File C:\Users\vdevo\3sm\build-plugin.ps1"
```

### 4. DLL terughalen en manifest ondertekenen
```bash
scp vdevo@192.168.50.119:"$WS/3SM.EnduranceConnector/bin/Release/3SM.EnduranceConnector.dll" /tmp/3sm-plugin/
cd /tmp/3sm-plugin
VERSION="0.4.0.0"
cp 3SM.EnduranceConnector.dll "3SM.EnduranceConnector-$VERSION.dll"
URL="https://3stripemotorsport.cc/downloads/3SM.EnduranceConnector-$VERSION.dll"
SHA256=$(sha256sum "3SM.EnduranceConnector-$VERSION.dll" | awk '{print $1}')
BYTES=$(stat -c%s "3SM.EnduranceConnector-$VERSION.dll")
FILE="3SM.EnduranceConnector-$VERSION.dll"
PAYLOAD="${VERSION}\n${URL}\n${SHA256}\n${BYTES}\n${FILE}"
SIGNATURE=$(printf "$PAYLOAD" | openssl dgst -sha256 -sign release-signing-private.pem | base64 -w0)
printf "$PAYLOAD" | openssl dgst -sha256 -verify release-signing-public.pem \
  -signature <(printf "$SIGNATURE" | base64 -d)
echo "SHA256=$SHA256"
echo "Signature=$SIGNATURE"
```

### 5. DLL uploaden naar webroot
```bash
ssh 3sm-web "sudo cp /tmp/3sm-downloads/3SM.EnduranceConnector-$VERSION.dll /var/www/3sm/downloads/"
# Of via SCP:
scp "3SM.EnduranceConnector-$VERSION.dll" 3sm-web:/var/www/3sm/downloads/
```

### 6. Edge-functie deployen
```bash
ssh 3sm-web \
  "ssh 3sm-docker 'cat > /opt/supabase/docker/volumes/functions/simhub-version/.env << EOF
SIMHUB_PLUGIN_VERSION=$VERSION
SIMHUB_PLUGIN_DLL_URL=$URL
SIMHUB_PLUGIN_SHA256=$SHA256
SIMHUB_PLUGIN_BYTE_LENGTH=$BYTES
SIMHUB_PLUGIN_FILE_NAME=$FILE
SIMHUB_PLUGIN_SIGNATURE=$SIGNATURE
EOF
cd /opt/supabase/docker && docker compose up -d --force-recreate functions'"
```

### 7. Cloudflare cache purgen
```bash
# Gebruik curl met Global API Key:
curl -X POST "https://api.cloudflare.com/client/v4/zones/0fc692bd06d0aaed0f1d46c8ef768d1d/purge_cache" \
  -H "X-Auth-Email: vdevos@hotmail.com" \
  -H "X-Auth-Key: [REDACTED]" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://3stripemotorsport.cc/downloads/3SM.EnduranceConnector-'"$VERSION"'.dll"]}'
```

### 8. GitHub pushen (na apart akkoord)
```bash
git push origin fix/endurance-multiuser-hardening
git checkout main && git merge fix/endurance-multiuser-hardening && git push origin main
```

## Hoe de ondertekening werkt

De plugin valideert release-metadata via een RSA-SHA256-handtekening.

**Manifest payload:**
```
{version}\n{dllUrl}\n{sha256}\n{byteLength}\n{fileName}
```

**Plugin-kant** (`EnduranceConnectorPlugin.cs:753-781`):
1. Leest `VersionResponse` uit de `simhub-version` Edge-functie
2. Bouwt dezelfde payload string
3. Verifieert met vaste `ReleasePublicKeyXml` (RSA publieke XML)
4. Valideert URL, versie, bestandsgrootte en bestandsnaam

**Release-kant** (`release.sh`):
1. Berekent SHA-256 van de DLL
2. Bouwt payload met versie, URL, SHA-256, byte count, bestandsnaam
3. `openssl dgst -sha256 -sign private.pem | base64` = signature
4. Plaatst alles in `simhub-version` Edge-functie `.env`

## Bestanden

| Bestand | Beschrijving |
|---|---|
| `tools/simhub-plugin/release.sh` | Volledige release-automatisering |
| `tools/simhub-plugin/bump-version.sh` | Versiebumping in AssemblyInfo.cs |
| `tools/simhub-plugin/release-signing-public.pem` | RSA-publieke sleutel (in repo) |
| `tools/simhub-plugin/release-signing-private.pem` | RSA-privatesleutel **(NIET in repo)** |
| `~/.hermes/scripts/3sm-build-plugin.ps1` | Windows PowerShell build-script |
| `supabase/functions/simhub-version/index.ts` | Release-metadata Edge-functie |
| `3SM.EnduranceConnector/EnduranceConnectorPlugin.cs` | Plugin met update-download en handtekeningvalidatie |
| `3SM.EnduranceConnector.Updater/Program.cs` | Atomaire DLL-vervanging met back-up/journal/recovery |