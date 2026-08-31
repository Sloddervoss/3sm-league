# 3SM SimHub Endurance Connector — Release Runbook

Concrete operational runbook for releasing a new version of the 3SM SimHub Endurance
Connector. Complements the `3sm-simhub-release` Hermes skill (which holds the mandatory
rules and guardrails). Use this for the concrete steps, hostnames, and commands.

Two strictly separated phases — **BUILD + TEST + FREEZE** then **PUBLICATION** — and
publication requires explicit GO from Vincent.

## Environment / hosts

| Host | What it runs | SSH access |
|---|---|---|
| `Beest` `192.168.50.119` (user `vdevo`) | Windows build host, VS Build Tools + SimHub SDK; builds the Release DLL | agent key (`~/.ssh/id_ed25519`) |
| `3sm-web` `192.168.50.19` (root) | Webroot `/var/www/3sm`, site `/opt/3sm` (git checkout), release tooling `tools/simhub-plugin/` | agent key (`~/.ssh/hermes_3sm_ed25519`) |
| `3sm-docker` `192.168.50.23` (root) | Self-hosted Supabase stack; `supabase-edge-functions`; `docker-compose.override.yml` holds `SIMHUB_PLUGIN_*` env | agent key (`~/.ssh/hermes_3sm_ed25519`) |

Private keys live under `~/.hermes/keys/` on the Hermes VM. Never commit or log them.
Only public key / modulus / fingerprint / hash may appear in reports.

Before any Windows work, confirm Beest is on:
```bash
timeout 4 bash -c "echo > /dev/tcp/192.168.50.119/22" 2>/dev/null && echo OPEN || echo CLOSED
```

## Signing keys — critical

- SimHub releases MUST be signed with `~/.hermes/keys/3sm-simhub-release-private.pem`.
  Its public key (modulus `623ziGD…`) is the one embedded in the hardened connector.
- `~/.hermes/keys/3sm-simhub-release-public.pem` is the matching public key for verification.
- The OLD key `~/.hermes/keys/release-signing-private.pem` does NOT match the embedded
  updater public key — do not use it for SimHub releases. (Verified during 0.3.9.0.)
- Never generate a new key during a normal release.

`release.sh` (in `tools/simhub-plugin/`) must explicitly resolve to
`3sm-simhub-release-private.pem` with no silent fallback. Before each release, confirm the
live `/opt/3sm` checkout's `release.sh` matches git (report if it does not).

## Phase 1 — BUILD + TEST + FREEZE

### Scope / branch / version
1. Report: current live version, target version, reason, exact scope, what is NOT changed.
2. Use a clean worktree on a dedicated branch `release/simhub-X.Y.Z.W`; commits recorded.
3. Verify version consistency across `AssemblyInfo.cs` (`AssemblyVersion` +
   `AssemblyFileVersion`), displayed connector version, expected updater version, and the
   download filename `3SM.EnduranceConnector-X.Y.Z.W.dll`.

### Build (real Release build, on Beest)
Use the robust build script `~/.hermes/scripts/3sm-build-plugin.ps1` (not the repo
`build.ps1`, whose `vswhere` MSBuild glob can fail):
```bash
SCP=/home/hermes/.scripts/3sm-build-plugin.ps1
scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 "$SCP" vdevo@192.168.50.119:C:/Users/vdevo/3sm/build-plugin.ps1
ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 vdevo@192.168.50.119 \
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\vdevo\\3sm\\build-plugin.ps1 -SimHubPath 'C:\\Program Files (x86)\\SimHub'"
```
Success = `BUILD_OK: ...\bin\Release\3SM.EnduranceConnector.dll`.

Verify the Release artifact does NOT contain the test key define:
```bash
strings -e l 3SM.EnduranceConnector.dll | grep -c '<TEST-KEY-MODULUS>'   # expect 0
strings -e l 3SM.EnduranceConnector.dll | grep -c '623ziGD'              # expect >=1
```

### Test matrix
Run the release test matrix (see the skill). For updater changes this includes: updater
argument contract (10-arg), RSA manifest validation, SHA256/byteLength/version/fileName
validation, staging, install, rollback, crash recovery, WAITING_FOR_RESTART,
concurrency/mutex, state-store recovery, HTTP/download failure paths, upgrade from previous
release, and a next-version self-update test. No FAIL/BLOCKED without an explicit decision.

### Freeze
Record exactly one artifact: branch, commit, filename, version, byteLength, SHA256. Never
rebuild and publish different bytes. A rebuild invalidates the freeze and requires full
re-verification.

### Two distinct release artifacts — MACHINE vs HUMAN
Every release publishes two deliberately separate artifacts from the same frozen DLL:

1. **MACHINE artifact:** versioned `.dll` for the automatic updater. This is the artifact in
   the signed manifest; its SHA256/byteLength/signature are frozen.
2. **HUMAN artifact:** versioned `.zip` containing the byte-identical canonical
   `3SM.EnduranceConnector.dll`, current `INSTALLEREN.txt`, and optionally `SHA256.txt`.

The public-facing website button points to the HUMAN ZIP. The updater always uses only the
MACHINE DLL. The ZIP is never part of the updater manifest and must not alter the updater
DLL hash/signature. If a stable `3SM.EnduranceConnector-latest.zip` alias is used, update it
only after the versioned ZIP is independently verified (HTTP 200, ZIP content-type, opens
correctly, installation text present, inner DLL hash exactly matches the frozen MACHINE DLL).

## Phase 2 — PUBLICATION (only after explicit GO)

Order matters: artifact → download → sign → config → manifest last.

1. **Capture current production** (before changing anything):
   ```bash
   curl -sS "https://api.3stripemotorsport.cc/functions/v1/simhub-version"
   ```
   Note live version, dllUrl, sha256, byteLength, fileName, signature. Back up the edge
   config:
   ```bash
   ssh -o IdentitiesOnly=yes -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23 \
     "cp /opt/supabase/docker/docker-compose.override.yml /opt/supabase/docker/docker-compose.override.yml.pre-<ver>"
   ```
2. **Upload frozen artifact** to `3sm-web:/var/www/3sm/downloads/3SM.EnduranceConnector-<ver>.dll`; `chmod 0644`; verify server-side `stat -c%s` == byteLength and `sha256sum` == frozen SHA. STOP on mismatch.
3. **Download verify** (before manifest switch): HTTP success, `application/octet-stream`, no HTML fallback, exact byteLength, exact SHA256, byte-identical to frozen artifact.
4. **Sign manifest** with `3sm-simhub-release-private.pem`. Payload = exactly
   `BuildManifestPayload()` (`<version>\n<dllUrl>\n<sha256>\n<byteLength>\n<fileName>`,
   no trailing newline):
   ```bash
   MANIFEST=$(printf '%s\n%s\n%s\n%s\n%s' "$VER" "$DLL_URL" "$SHA" "$BYTES" "$FN")
   SIG=$(printf '%s' "$MANIFEST" | openssl dgst -sha256 -sign ~/.hermes/keys/3sm-simhub-release-private.pem | base64 -w0)
   printf '%s' "$MANIFEST" | openssl dgst -sha256 -verify ~/.hermes/keys/3sm-simhub-release-public.pem \
     -signature <(printf '%s' "$SIG" | base64 -d)
   ```
   Optionally confirm the real Release-DLL verification logic accepts the signature (via a
   reflection harness against `ValidateReleaseManifest`).
5. **Update edge config** on `3sm-docker`: patch `SIMHUB_PLUGIN_VERSION/DLL_URL/SHA256/BYTE_LENGTH/FILE_NAME/SIGNATURE` in `docker-compose.override.yml` (exactly the format release.sh uses), then validate before any restart:
   ```bash
   ssh ... root@192.168.50.23 "cd /opt/supabase/docker && docker compose config -q"
   ```
   Then restart only the needed service:
   ```bash
   ssh ... root@192.168.50.23 "cd /opt/supabase/docker && docker compose up -d --force-recreate functions"
   ```
   Do not touch DB/frontend/other services.
6. **Flip the manifest last** — this is the moment the live `simhub-version` changes, only
   after steps 2-5 are all verified.

## Post-publication verification (independent)
Check live version, live dllUrl, live SHA256, live byteLength, live fileName, live signature,
signature valid against embedded public key, download HTTP status, content-type, download
byteLength, download SHA256, and byte-identity with the frozen artifact. Then a short
connector sanity check if practical (plugin loads, no load error, update-check accepts the
manifest, no RSA/hash/version error, telemetry unaffected). Only then report `RELEASED`.

## Updater compatibility
Check every release whether the current live version can self-update to the new one.

**Historical exception:** 0.3.8.0 has a proven self-update defect (6 args vs required 10).
`0.3.8.0 -> 0.3.9.0` must be done once manually via the official install method (stop
SimHub → replace DLL → restart). From 0.3.9.0 the hardened updater is the basis.

## Rollback
Keep the previous artifact + manifest/config values + config backup. If a release is live and
wrong: stop further distribution, then restore the previous known-good manifest/artifact state
in a controlled way.

## Security
Never log/share private signing key contents, device tokens, bearer tokens, Authorization
headers, passwords, or secrets. The private key is used only on the authorized release host.
Only public key/modulus/fingerprint/hash may appear in reports.