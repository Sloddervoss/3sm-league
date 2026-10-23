#!/usr/bin/env python3
"""3SM SimHub connector — release gate.

Blocks a publication (and any update flip) unless the whole chain is complete:
source -> build input list -> compiled artifact -> uploaded artifact -> signed
manifest -> live endpoint.

Exit codes: 0 = all checks PASS (warnings allowed), 1 = at least one FAIL,
2 = usage/environment error. Every check prints one line:
    PASS|FAIL|WARN  <id>  <detail>

Usage (publication gate, before the manifest flip):
  ./release-gate.py --version 0.5.26.0 \
      --dll  ./dist/3SM.EnduranceConnector-0.5.26.0.dll \
      --zip  ./dist/3SM.EnduranceConnector-0.5.26.0.zip \
      --manifest-url https://api.3stripemotorsport.cc/functions/v1/simhub-version \
      --live-version 0.5.25.0

Freeze gate (no endpoint yet, artifact not uploaded):
  ./release-gate.py --version 0.5.26.0 --dll ... --no-endpoint --live-version 0.5.25.0

The gate is read-only: it never uploads, signs or mutates anything.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clrpe  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CONNECTOR = os.path.join(HERE, "3SM.EnduranceConnector")
UPDATER = os.path.join(HERE, "3SM.EnduranceConnector.Updater")
OVERLAY = os.path.join(HERE, "overlay")
RELEASE_SH = os.path.join(HERE, "release.sh")

RESULTS = []

# Source files that legitimately declare no type (assembly attributes only).
TYPELESS_ALLOWED = {"AssemblyInfo.cs"}


def record(status, check, detail):
    RESULTS.append((status, check, detail))
    print("%-5s %s  %s" % (status, check, detail))


def ok(check, detail):
    record("PASS", check, detail)


def bad(check, detail):
    record("FAIL", check, detail)


def warn(check, detail):
    record("WARN", check, detail)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------- repo facts

def repo_facts():
    csproj = os.path.join(CONNECTOR, "3SM.EnduranceConnector.csproj")
    text = open(csproj, encoding="utf-8-sig").read()
    compile_items = [i.replace("\\", "/") for i in
                     re.findall(r'<Compile Include="([^"]+)"', text)]
    embedded = [i.replace("\\", "/") for i in
                re.findall(r'<EmbeddedResource Include="([^"]+)"', text)]
    assembly_info = open(os.path.join(CONNECTOR, "AssemblyInfo.cs"),
                         encoding="utf-8-sig").read()
    versions = re.findall(r'Assembly(?:File)?Version\("([^"]+)"\)', assembly_info)
    repo_cs = sorted(f for f in os.listdir(CONNECTOR) if f.endswith(".cs"))
    script = open(RELEASE_SH, encoding="utf-8").read()
    m = re.search(r'scp "\$SCRIPT_DIR"/3SM\.EnduranceConnector/\{([^}]+)\}', script)
    scp_cs = [x.strip() for x in m.group(1).split(",")] if m else []
    return {
        "compile": compile_items,
        "embedded": embedded,
        "versions": versions,
        "repo_cs": repo_cs,
        "scp": scp_cs,
        "script": script,
    }


def _strip_noise(src):
    """Blank out comments and string/char literals, preserving offsets."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            for _ in range(2):
                if i < n:
                    out[i] = " "
                    i += 1
        elif c in ('"', "'"):
            quote = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    out[i] = " "
                    i += 1
                    if i < n:
                        out[i] = " "
                        i += 1
                    continue
                if src[i] == quote:
                    i += 1
                    break
                if src[i] != "\n":
                    out[i] = " "
                i += 1
        else:
            i += 1
    return "".join(out)


TYPE_RE = re.compile(
    r"^[ \t]*(?:\[[^\]]*\]\s*)*(?:(?:public|internal|private|protected|static|"
    r"sealed|abstract|partial|unsafe|new|readonly)\s+)*"
    r"(?:class|struct|enum|interface)\s+([A-Za-z_]\w*)", re.M)


def declared_types(path):
    """Top-level type full names declared in a .cs file.

    Nesting is decided by brace depth (namespace body = depth 1), not by
    indentation: indented declarations inside a `namespace { }` block are
    still top-level types.
    """
    raw = open(path, encoding="utf-8-sig", errors="replace").read()
    src = _strip_noise(raw)
    ns = None
    m = re.search(r"^\s*namespace\s+([\w.]+)", src, re.M)
    if m:
        ns = m.group(1)
    depth_at = {}
    depth = 0
    for i, ch in enumerate(src):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        depth_at[i] = depth
    names = []
    for match in TYPE_RE.finditer(src):
        d = depth_at.get(match.start(1), 99)
        if d > 1:  # nested inside another type
            continue
        name = match.group(1)
        names.append("%s.%s" % (ns, name) if ns else name)
    return names


# ------------------------------------------------------------------- checks

def check_source_parity(facts):
    compile_cs = [os.path.basename(c) for c in facts["compile"] if c.endswith(".cs")]
    missing_in_project = [f for f in facts["repo_cs"] if f not in compile_cs]
    missing_in_repo = [f for f in compile_cs if f not in facts["repo_cs"]]
    if missing_in_project or missing_in_repo:
        bad("G01-source-parity",
            "csproj<>repo mismatch: not compiled=%s missing-file=%s"
            % (missing_in_project, missing_in_repo))
    else:
        ok("G01-source-parity", "%d .cs files, all in csproj" % len(compile_cs))


def check_sync_parity(facts):
    compile_cs = [os.path.basename(c) for c in facts["compile"] if c.endswith(".cs")]
    not_synced = [f for f in compile_cs if f not in facts["scp"]]
    if not_synced:
        bad("G02-build-sync", "release.sh does not scp: %s" % not_synced)
    else:
        ok("G02-build-sync", "all %d Compile items reach the build host" % len(compile_cs))
    for needle, label in ((r"scp -r \"\$SCRIPT_DIR\"/overlay", "overlay dir"),
                          (r"Assets/\*", "Assets glob"),
                          (r"3SM\.EnduranceConnector\.Updater/\{", "updater sources")):
        if not re.search(needle, facts["script"]):
            bad("G02-build-sync", "release.sh misses %s" % label)
    # the build script itself must be versioned, not taken from a home dir
    if re.search(r"scp \"\$HOME/\.hermes/scripts/", facts["script"]):
        bad("G02-build-tooling",
            "release.sh copies the build script from $HOME/.hermes/scripts (unversioned)")
    else:
        ok("G02-build-tooling", "build script is versioned")
    if re.search(r"--skip-build", facts["script"]):
        warn("G02-skip-build",
             "--skip-build exists but STAGING is empty in that path; retry is not supported")


def check_artifact(dll_path, version, facts):
    if not os.path.exists(dll_path):
        bad("G03-artifact", "DLL not found: %s" % dll_path)
        return None
    asm = clrpe.Assembly(dll_path)
    base = os.path.basename(dll_path)
    expected_name = "3SM.EnduranceConnector-%s.dll" % version
    if base != expected_name:
        bad("G03-filename", "%s != %s" % (base, expected_name))
    else:
        ok("G03-filename", base)
    if asm.version != version:
        bad("G03-assembly-version", "DLL says %s, release says %s" % (asm.version, version))
    else:
        ok("G03-assembly-version", asm.version)
    if len(set(facts["versions"])) != 1 or facts["versions"][0] != version:
        bad("G03-source-version",
            "AssemblyInfo.cs says %s" % sorted(set(facts["versions"])))
    else:
        ok("G03-source-version", "AssemblyInfo.cs matches")
    return asm


def check_resources(asm, facts):
    """Every EmbeddedResource of the csproj must be inside the DLL, byte-identical."""
    expected = {}
    for item in facts["embedded"]:
        if "$(Configuration)" in item:
            continue  # the updater exe is checked separately
        src = os.path.normpath(os.path.join(CONNECTOR, item))
        if not os.path.exists(src):
            bad("G04-resource-source", "csproj references a missing file: %s" % src)
            continue
        expected[src] = sha256_file(src)

    by_name = {r["name"]: r for r in asm.resources}
    logical = {
        "Assets/plugin-icon.png": "ThreeSM.EnduranceConnector.Assets.plugin-icon.png",
        "Assets/plugin-icon-64.png": "ThreeSM.EnduranceConnector.Assets.plugin-icon-64.png",
        "Assets/wordmark.png": "ThreeSM.EnduranceConnector.Assets.wordmark.png",
        "../overlay/3SM Endurance Overlay.djson": "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson",
        "../overlay/3SM Endurance Overlay.djson.metadata": "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson.metadata",
        "../overlay/3SM Endurance Overlay.djson.ressources": "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson.ressources",
    }
    for src in expected:
        rel = os.path.relpath(src, CONNECTOR).replace("\\", "/")
        logical_name = logical.get(rel)
        if logical_name is None:
            bad("G04-resource-map", "no logical name known for %s" % rel)
            continue
        if logical_name not in by_name:
            bad("G04-resource-present", "DLL lacks %s (%s)" % (logical_name, rel))
            continue
        got, length, _payload = asm.resource_payload(logical_name)
        if got != expected[src]:
            bad("G04-resource-bytes", "%s differs: dll=%s repo=%s"
                % (rel, got[:12], expected[src][:12]))
        else:
            ok("G04-resource-bytes", "%s (%d bytes)" % (rel, length))


def check_types(asm, facts):
    """Every source file that is compiled must contribute its types to the DLL."""
    missing = []
    typed = 0
    untyped = []
    for name in facts["repo_cs"]:
        types = declared_types(os.path.join(CONNECTOR, name))
        if not types:
            if name not in TYPELESS_ALLOWED:
                untyped.append(name)
            continue
        typed += 1
        for full in types:
            if full not in asm.type_set:
                missing.append("%s -> %s" % (name, full))
    if missing:
        bad("G05-compiled-files", "types missing from DLL: %s" % missing)
    elif untyped:
        bad("G05-compiled-files",
            "no type found in %s; the per-file check cannot see them" % untyped)
    else:
        ok("G05-compiled-files",
            "top-level types of %d source files all present in DLL" % typed)


def check_updater(asm, expect_hash=None):
    res = "ThreeSM.EnduranceConnector.Assets.3SM.EnduranceConnector.Updater.exe"
    if res not in {r["name"] for r in asm.resources}:
        bad("G06-updater-embedded", "embedded updater missing -> self-update impossible")
        return
    got, length, payload = asm.resource_payload(res)
    ok("G06-updater-embedded", "sha256=%s bytes=%d" % (got, length))
    if expect_hash and got != expect_hash:
        bad("G06-updater-hash", "updater hash %s != expected %s" % (got, expect_hash))
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".exe")
    tmp.write(payload)
    tmp.close()
    try:
        up = clrpe.Assembly(tmp.name)
        ok("G06-updater-version", "%s %s" % (up.assembly_name, up.version))
        for lit in ("--simulate-crash", "--simulate-failure"):
            if lit.encode("utf-16-le") in payload:
                warn("G06-updater-testcode",
                     "production updater accepts %s (crash injection shipped)" % lit)
    finally:
        os.unlink(tmp.name)


def check_keys(asm_path, public_key_pem):
    data = open(asm_path, "rb").read()
    # production modulus from the public PEM
    try:
        out = subprocess.run(["openssl", "rsa", "-pubin", "-in", public_key_pem,
                              "-modulus", "-noout"],
                             capture_output=True, text=True, check=True).stdout
        mod_hex = out.strip().split("=", 1)[1]
        mod_b64 = base64.b64encode(bytes.fromhex(mod_hex)).decode()
    except Exception as exc:  # noqa: BLE001
        bad("G07-key-read", "cannot read public key %s: %s" % (public_key_pem, exc))
        return
    if mod_b64.encode("utf-16-le") in data:
        ok("G07-prod-key", "embedded public key matches %s" % os.path.basename(public_key_pem))
    else:
        bad("G07-prod-key", "embedded public key does NOT match the signing key")
    # the test key that must never ship (prefix of the RSA_TEST_KEY modulus)
    if "lhXlfzwFlm1RkUvcn0gNPDOS9X1B".encode("utf-16-le") in data:
        bad("G07-test-key", "RSA_TEST_KEY material is present in the artifact")
    else:
        ok("G07-test-key", "test key absent")


def fetch_manifest(url):
    req = urllib.request.Request(url, headers={
        "Cache-Control": "no-cache",
        "User-Agent": "3SM-release-gate/1.0",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        ctype = resp.headers.get("Content-Type", "")
        body = resp.read(65536)
    return json.loads(body), ctype


def verify_signature(payload, signature_b64, public_key_pem):
    tmpdir = tempfile.mkdtemp()
    try:
        msg = os.path.join(tmpdir, "payload")
        sig = os.path.join(tmpdir, "payload.sig")
        open(msg, "wb").write(payload.encode("utf-8"))
        open(sig, "wb").write(base64.b64decode(signature_b64))
        proc = subprocess.run(["openssl", "dgst", "-sha256", "-verify", public_key_pem,
                               "-signature", sig, msg],
                              capture_output=True, text=True)
        return proc.returncode == 0
    finally:
        for f in ("payload", "payload.sig"):
            p = os.path.join(tmpdir, f)
            if os.path.exists(p):
                os.unlink(p)
        os.rmdir(tmpdir)


def check_manifest(manifest, ctype, local_dll, version, public_key_pem, download=True):
    required = ("version", "dllUrl", "sha256", "byteLength", "fileName", "signature")
    missing = [k for k in required if not manifest.get(k)]
    if missing:
        bad("G08-manifest-fields", "missing/null: %s" % missing)
        return
    payload = "\n".join([manifest["version"], manifest["dllUrl"], manifest["sha256"],
                         str(manifest["byteLength"]), manifest["fileName"]])
    if verify_signature(payload, manifest["signature"], public_key_pem):
        ok("G08-signature", "RSA-SHA256 over the 5-line payload verified")
    else:
        bad("G08-signature", "signature does NOT verify with %s"
            % os.path.basename(public_key_pem))
    if not verify_signature(payload.replace(manifest["sha256"], "0" * 64),
                            manifest["signature"], public_key_pem):
        ok("G08-signature-negative", "tampered payload is rejected")
    else:
        bad("G08-signature-negative", "verification accepts a tampered payload")

    local_sha = sha256_file(local_dll)
    local_len = os.path.getsize(local_dll)
    for field, want in (("version", version),
                        ("sha256", local_sha),
                        ("byteLength", local_len),
                        ("fileName", "3SM.EnduranceConnector-%s.dll" % version)):
        got = manifest[field]
        if str(got) != str(want):
            bad("G08-manifest-%s" % field, "%r != %r" % (got, want))
        else:
            ok("G08-manifest-%s" % field, str(got))
    if manifest["dllUrl"] != "https://3stripemotorsport.cc/downloads/" + manifest["fileName"]:
        bad("G08-manifest-url", manifest["dllUrl"])

    if download:
        req = urllib.request.Request(manifest["dllUrl"], headers={
            "Cache-Control": "no-cache",
            "User-Agent": "3SM-release-gate/1.0",
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            ctype_dl = resp.headers.get("Content-Type", "")
            status = resp.status
        if status != 200:
            bad("G09-download-http", "HTTP %s" % status)
        elif sha256_file_bytes(body) != local_sha:
            bad("G09-download-bytes", "served bytes differ from the frozen artifact")
        elif len(body) != local_len:
            bad("G09-download-length", "%d != %d" % (len(body), local_len))
        elif "text/html" in ctype_dl.lower():
            bad("G09-download-type", "served as %s (nginx/HTML fallback)" % ctype_dl)
        else:
            ok("G09-download-bytes", "HTTPS %s bytes=%d sha256=%s"
               % (ctype_dl, len(body), local_sha[:12]))


def sha256_file_bytes(body):
    return hashlib.sha256(body).hexdigest()


def check_zip(zip_path, local_dll, version):
    if not zip_path or not os.path.exists(zip_path):
        bad("G10-zip", "human artifact missing (%s)" % zip_path)
        return
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if "3SM.EnduranceConnector.dll" not in names:
            bad("G10-zip-name", "inner DLL must be canonically named; got %s" % names)
            return
        inner = hashlib.sha256(zf.read("3SM.EnduranceConnector.dll")).hexdigest()
        if inner != sha256_file(local_dll):
            bad("G10-zip-dll", "inner DLL differs from the frozen MACHINE artifact")
        else:
            ok("G10-zip-dll", "inner DLL byte-identical to the updater artifact")
        if "INSTALLEREN.txt" not in names:
            bad("G10-zip-instructions", "INSTALLEREN.txt missing")
        else:
            text = zf.read("INSTALLEREN.txt").decode("utf-8", "replace")
            if version not in text:
                bad("G10-zip-instructions", "instructions do not mention %s" % version)
            else:
                ok("G10-zip-instructions", "mentions %s" % version)
        if "SHA256.txt" in names:
            listed = zf.read("SHA256.txt").decode("utf-8", "replace").split()[0].lower()
            if listed != inner:
                bad("G10-zip-sha-file", "SHA256.txt says %s" % listed[:12])
            else:
                ok("G10-zip-sha-file", "matches")


def check_version_gate(version, live_version):
    def parse(v):
        return tuple(int(x) for x in v.split("."))
    if parse(version) <= parse(live_version):
        bad("G11-version-gate",
            "%s is not strictly higher than live %s -> nobody is offered the update"
            % (version, live_version))
    else:
        ok("G11-version-gate", "%s > live %s" % (version, live_version))


def check_leftovers(dll_path):
    directory = os.path.dirname(os.path.abspath(dll_path))
    stray = [f for f in os.listdir(directory)
             if ".3sm-" in f]
    if stray:
        bad("G12-leftovers", "staging leftovers next to the artifact: %s" % stray)
    else:
        ok("G12-leftovers", "no .3sm-* leftovers")


def check_website_link(repo_root):
    """The public download button must not point at the cached alias."""
    page = os.path.join(repo_root, "src", "pages", "SimHubPairingPage.tsx")
    if not os.path.exists(page):
        warn("G13-site-link", "SimHubPairingPage.tsx not found; skipping")
        return
    text = open(page, encoding="utf-8").read()
    links = re.findall(r'href="(/downloads/[^"]+)"', text)
    if not links:
        warn("G13-site-link", "no /downloads/ link found in the pairing page")
    elif any("latest" in link for link in links):
        bad("G13-site-link",
            "button serves the cached alias %s (up to 4h stale after a release)"
            % [l for l in links if "latest" in l])
    elif any(re.search(r"3SM\.EnduranceConnector-\d+\.\d+\.\d+\.\d+\.zip", l) for l in links):
        ok("G13-site-link", "button links the versioned ZIP")
    else:
        warn("G13-site-link", "unexpected download link %s" % links)


def check_repo_alias(repo_root):
    """Release artifacts must not be tracked in the site tree at all."""
    public = os.path.join(repo_root, "public", "downloads")
    if not os.path.isdir(public):
        ok("G14-repo-artifacts", "no public/downloads in the repo")
        return
    artifacts = sorted(f for f in os.listdir(public) if f.endswith((".dll", ".zip")))
    if not artifacts:
        ok("G14-repo-artifacts", "no artifacts tracked under public/downloads")
        return
    versions = sorted({m.group(1) for f in artifacts
                       for m in [re.search(r"-(\d+\.\d+\.\d+\.\d+)\.(?:dll|zip)$", f)] if m},
                      key=lambda v: tuple(int(x) for x in v.split(".")))
    newest = versions[-1] if versions else "?"
    warn("G14-repo-artifacts",
         "%d release artifacts tracked under public/downloads (newest %s); "
         "they are dead weight and only harmless while deploy.sh keeps "
         "--exclude='downloads/'" % (len(artifacts), newest))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--dll", required=True)
    ap.add_argument("--zip")
    ap.add_argument("--manifest-url",
                    default="https://api.3stripemotorsport.cc/functions/v1/simhub-version")
    ap.add_argument("--live-version")
    ap.add_argument("--public-key",
                    default=os.path.join(HERE, "3sm-simhub-release-public.pem"))
    ap.add_argument("--no-endpoint", action="store_true",
                    help="freeze mode: skip manifest + download checks")
    ap.add_argument("--expect-updater-hash")
    args = ap.parse_args()

    print("=== 3SM release gate — version %s ===" % args.version)
    facts = repo_facts()

    check_source_parity(facts)
    check_sync_parity(facts)
    asm = check_artifact(args.dll, args.version, facts)
    if asm is None:
        return finish()
    check_resources(asm, facts)
    check_types(asm, facts)
    check_updater(asm, args.expect_updater_hash)
    check_keys(args.dll, args.public_key)
    check_leftovers(args.dll)
    repo_root = os.path.abspath(os.path.join(HERE, "..", ".."))
    check_website_link(repo_root)
    check_repo_alias(repo_root)
    if args.live_version:
        check_version_gate(args.version, args.live_version)
    if not args.no_endpoint:
        manifest, ctype = fetch_manifest(args.manifest_url)
        check_manifest(manifest, ctype, args.dll, args.version, args.public_key)
    if args.zip:
        check_zip(args.zip, args.dll, args.version)
    return finish()


def finish():
    fails = [r for r in RESULTS if r[0] == "FAIL"]
    warns = [r for r in RESULTS if r[0] == "WARN"]
    passes = [r for r in RESULTS if r[0] == "PASS"]
    print("\n%d checks: %d PASS, %d FAIL, %d WARN"
          % (len(RESULTS), len(passes), len(fails), len(warns)))
    print("GATE: %s" % ("BLOCKED" if fails else "OPEN"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
